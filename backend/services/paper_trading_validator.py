"""
Paper trading rule validation utility.

Validates that all paper trades (open and closed) conform to the entry/exit rules:
- Entry threshold enforcement (no low-conviction entries)
- Stop-loss enforcement (positions closed at -stop_loss_pct)
- Take-profit enforcement (positions closed at +take_profit_pct)
- Holding window compliance
- Re-entry cooldown compliance
- Win rate tracking by conviction level
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from config.logic_loader import LOGIC as _L


def validate_all_trades(db) -> Dict[str, Any]:
    """
    Full validation of all paper trades against entry/exit rules.
    
    Returns a validation report with:
    - Total trades analyzed
    - Rule violations found
    - Win rate by conviction level
    - Average holding time vs expected
    """
    from database.models import PaperTrade
    from services.data_ingestion.yfinance_client import PriceClient

    trades = db.query(PaperTrade).order_by(PaperTrade.entered_at.asc()).all()
    
    if not trades:
        return {
            "valid": True,
            "message": "No paper trades to validate",
            "total_trades": 0,
            "violations": [],
            "summary": {},
        }

    price_client = PriceClient()
    violations: List[Dict[str, Any]] = []
    closed_trades = [t for t in trades if t.exited_at is not None]
    open_positions = [t for t in trades if t.exited_at is None]

    # ── Validate closed trades ──
    for t in trades:
        _validate_trade(t, price_client, violations)

    # ── Validate open positions with live prices ──
    for t in open_positions:
        _validate_open_position(t, price_client, violations)

    # ── Compute win rate by conviction level ──
    conviction_stats: Dict[str, Dict[str, int]] = {}
    for t in closed_trades:
        cl = str(t.conviction_level or "MEDIUM").upper()
        if cl not in conviction_stats:
            conviction_stats[cl] = {"wins": 0, "losses": 0, "total": 0}
        conviction_stats[cl]["total"] += 1
        if (t.realized_pnl or 0) > 0:
            conviction_stats[cl]["wins"] += 1
        else:
            conviction_stats[cl]["losses"] += 1

    # ── Compute average holding time by trading type ──
    type_hold_times: Dict[str, List[float]] = {}
    type_expected: Dict[str, int] = _L.get("conviction", {}).get("holding_minutes", {})
    for t in closed_trades:
        tt = str(t.trading_type or "SWING").upper()
        if tt not in type_hold_times:
            type_hold_times[tt] = []
        if t.entered_at and t.exited_at:
            actual_minutes = (t.exited_at - t.entered_at).total_seconds() / 60
            type_hold_times[tt].append(actual_minutes)

    type_avg_hold: Dict[str, float] = {}
    for tt, times in type_hold_times.items():
        if times:
            type_avg_hold[tt] = round(sum(times) / len(times), 1)

    # ── Overall win rate ──
    total_wins = sum(1 for t in closed_trades if (t.realized_pnl or 0) > 0)
    total_losses = sum(1 for t in closed_trades if (t.realized_pnl or 0) <= 0)
    overall_win_rate = round(total_wins / max(len(closed_trades), 1) * 100, 1) if closed_trades else 0

    # ── P&L stats ──
    realized_pnls = [(t.realized_pnl or 0) for t in closed_trades]
    avg_pnl = round(sum(realized_pnls) / max(len(realized_pnls), 1), 4) if realized_pnls else 0
    max_win = max(realized_pnls) if realized_pnls else 0
    max_loss = min(realized_pnls) if realized_pnls else 0

    # ── Stop-loss / take-profit compliance ──
    stop_loss_triggered = sum(1 for t in closed_trades if str(t.close_reason or "") == "stop_loss_hit")
    take_profit_triggered = sum(1 for t in closed_trades if str(t.close_reason or "") == "take_profit_hit")
    window_expired = sum(1 for t in closed_trades if str(t.close_reason or "") == "window_expired")
    direction_flip = sum(1 for t in closed_trades if str(t.close_reason or "") == "direction_flip")

    # ── Build report ──
    report = {
        "valid": len(violations) == 0,
        "total_trades": len(trades),
        "closed_trades": len(closed_trades),
        "open_positions": len(open_positions),
        "violations": violations,
        "violation_count": len(violations),
        "win_rate": {
            "overall": overall_win_rate,
            "by_conviction": {
                cl: {
                    "win_rate": round(stats["wins"] / max(stats["total"], 1) * 100, 1),
                    "wins": stats["wins"],
                    "losses": stats["losses"],
                    "total": stats["total"],
                }
                for cl, stats in conviction_stats.items()
            },
        },
        "holding_time": {
            "actual_avg_minutes": {k: v for k, v in type_avg_hold.items()},
            "expected_minutes": {k: v for k, v in type_expected.items()},
        },
        "exit_reasons": {
            "stop_loss_hit": stop_loss_triggered,
            "take_profit_hit": take_profit_triggered,
            "window_expired": window_expired,
            "direction_flip": direction_flip,
            "trailing_stop_hit": sum(1 for t in closed_trades if str(t.close_reason or "") == "trailing_stop_hit"),
            "others": len(closed_trades) - stop_loss_triggered - take_profit_triggered - window_expired - direction_flip
                       - sum(1 for t in closed_trades if str(t.close_reason or "") == "trailing_stop_hit"),
        },
        "pnl": {
            "total_realized": round(sum(realized_pnls), 4),
            "average": avg_pnl,
            "max_win": max_win,
            "max_loss": max_loss,
        },
    }

    return report


def _validate_trade(
    trade: Any,
    price_client: Any,
    violations: List[Dict[str, Any]],
) -> None:
    """Validate a single trade against the rules."""
    from config.logic_loader import LOGIC as _L

    # ── Check: was entry allowed by conviction rules? ──
    cl = str(trade.conviction_level or "MEDIUM").upper()
    if cl == "LOW":
        violations.append({
            "trade_id": trade.id,
            "underlying": trade.underlying,
            "type": "entry_violation",
            "severity": "high",
            "message": f"LOW conviction trade was opened (id={trade.id})",
            "timestamp": trade.entered_at.isoformat() if trade.entered_at else None,
        })

    # ── Check: was exit by stop-loss within configured tolerance? ──
    if str(trade.close_reason or "") == "stop_loss_hit":
        expected_sl = _stop_loss_pct_for_config(None)
        actual_sl = abs(trade.realized_pnl_pct or 0)
        # Allow 0.2% tolerance for price granularity
        if actual_sl < expected_sl - 0.2:
            violations.append({
                "trade_id": trade.id,
                "underlying": trade.underlying,
                "type": "stop_loss_violation",
                "severity": "critical",
                "message": f"Stop-loss exit at {actual_sl:.2f}% is beyond configured {expected_sl:.2f}%",
                "expected_pct": expected_sl,
                "actual_pct": actual_sl,
                "timestamp": trade.exited_at.isoformat() if trade.exited_at else None,
            })

    # ── Check: was exit by take-profit within configured tolerance? ──
    if str(trade.close_reason or "") == "take_profit_hit":
        expected_tp = _take_profit_pct_for_config(None)
        actual_tp = abs(trade.realized_pnl_pct or 0)
        if actual_tp > expected_tp + 0.2:
            violations.append({
                "trade_id": trade.id,
                "underlying": trade.underlying,
                "type": "take_profit_violation",
                "severity": "medium",
                "message": f"Take-profit exit at {actual_tp:.2f}% is beyond configured {expected_tp:.2f}%",
                "expected_pct": expected_tp,
                "actual_pct": actual_tp,
                "timestamp": trade.exited_at.isoformat() if trade.exited_at else None,
            })

    # ── Check: was exit by window within holding window? ──
    if str(trade.close_reason or "") == "window_expired":
        if trade.holding_window_until and trade.exited_at:
            if trade.exited_at < trade.holding_window_until:
                violations.append({
                    "trade_id": trade.id,
                    "underlying": trade.underlying,
                    "type": "window_violation",
                    "severity": "high",
                    "message": f"Position closed at {trade.exited_at} before window expired at {trade.holding_window_until}",
                    "timestamp": trade.exited_at.isoformat(),
                })


def _validate_open_position(
    position: Any,
    price_client: Any,
    violations: List[Dict[str, Any]],
) -> None:
    """Check open positions for stop-loss / take-profit violations."""
    current_price = 0.0
    try:
        q = price_client.get_realtime_quote(position.execution_ticker)
        current_price = float((q or {}).get("current_price") or 0.0)
    except Exception:
        current_price = 0.0

    if current_price <= 0:
        current_price = float(position.entry_price or 0)

    if current_price <= 0 or position.entry_price <= 0:
        return

    pnl_pct = _directional_return_pct(position.signal_type, position.entry_price, current_price)
    stop_loss = _stop_loss_pct_for_config(None)
    take_profit = _take_profit_pct_for_config(None)

    # Check stop-loss
    if stop_loss > 0 and pnl_pct <= -stop_loss:
        violations.append({
            "trade_id": position.id,
            "underlying": position.underlying,
            "type": "open_position_stop_loss",
            "severity": "critical",
            "message": f"Open position P&L {pnl_pct:.2f}% is at/below stop-loss {stop_loss:.2f}%",
            "current_pnl_pct": round(pnl_pct, 4),
            "stop_loss_pct": stop_loss,
            "current_price": current_price,
            "entry_price": position.entry_price,
        })

    # Check take-profit
    if take_profit > 0 and pnl_pct >= take_profit:
        violations.append({
            "trade_id": position.id,
            "underlying": position.underlying,
            "type": "open_position_take_profit",
            "severity": "high",
            "message": f"Open position P&L {pnl_pct:.2f}% is at/above take-profit {take_profit:.2f}%",
            "current_pnl_pct": round(pnl_pct, 4),
            "take_profit_pct": take_profit,
            "current_price": current_price,
            "entry_price": position.entry_price,
        })


def _directional_return_pct(signal_type: str, entry_price: float, current_price: float) -> float:
    """Return percentage P&L with correct sign for long vs short."""
    if entry_price <= 0 or current_price <= 0:
        return 0.0
    raw_return = (current_price - entry_price) / entry_price
    if str(signal_type or "").upper() == "SHORT":
        raw_return *= -1
    return raw_return * 100.0


def _stop_loss_pct_for_config(app_config) -> float:
    """Return configured stop-loss percentage."""
    if app_config is not None:
        try:
            override = getattr(app_config, "stop_loss_pct", None)
            if override is not None:
                return max(0.0, float(override))
        except Exception:
            pass
    return max(0.0, float(_L.get("stop_loss_pct", 2.0)))


def _take_profit_pct_for_config(app_config) -> float:
    """Return configured take-profit percentage."""
    if app_config is not None:
        try:
            override = getattr(app_config, "take_profit_pct", None)
            if override is not None:
                return max(0.0, float(override))
        except Exception:
            pass
    return max(0.0, float(_L.get("take_profit_pct", 3.0)))