"""
Paper trading simulation service.

Auto-executes a $100 paper trade for every directional signal fired during
extended market hours (4:00am–8:00pm ET, Mon–Fri).

Position lifecycle (mirrors what a real trader following every signal would do):
- Same ticker + same leverage → hold, no change
- Different ticker OR different leverage OR direction flip → close old, open new
- HOLD signal → close any open position, nothing new
"""

from datetime import datetime, time as time_cls
from zoneinfo import ZoneInfo
from typing import Optional, Dict, Any, List

PAPER_TRADE_AMOUNT = 100.0
_MARKET_TZ = ZoneInfo("America/New_York")

# Extended trading hours Mon–Fri
_EXTENDED_OPEN  = time_cls(4, 0)
_EXTENDED_CLOSE = time_cls(20, 0)
_REGULAR_OPEN   = time_cls(9, 30)
_REGULAR_CLOSE  = time_cls(16, 0)


def _directional_return_pct(signal_type: str, entry_price: float, current_price: float) -> float:
    """Return percentage P&L with correct sign for long vs short paper trades."""
    if entry_price <= 0 or current_price <= 0:
        return 0.0

    raw_return = (current_price - entry_price) / entry_price
    if str(signal_type or "").upper() == "SHORT":
        raw_return *= -1

    return raw_return * 100.0


def _directional_pnl(signal_type: str, entry_price: float, current_price: float, amount: float) -> float:
    """Convert directional return into dollar P&L for the paper notional."""
    return amount * (_directional_return_pct(signal_type, entry_price, current_price) / 100.0)


def market_status() -> Dict[str, Any]:
    """Return current market session for display and gate-keeping."""
    now_et = datetime.now(_MARKET_TZ)
    t = now_et.time()

    if now_et.weekday() >= 5:
        return {"status": "closed", "label": "Closed (Weekend)", "tradeable": False}

    if _REGULAR_OPEN <= t <= _REGULAR_CLOSE:
        return {"status": "open", "label": "Market Open", "tradeable": True}
    if _EXTENDED_OPEN <= t < _REGULAR_OPEN:
        return {"status": "pre-market", "label": "Pre-Market", "tradeable": True}
    if _REGULAR_CLOSE < t <= _EXTENDED_CLOSE:
        return {"status": "after-hours", "label": "After-Hours", "tradeable": True}
    return {"status": "closed", "label": "Closed", "tradeable": False}


def process_signals(
    db,
    recommendations: List[Dict[str, Any]],
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    request_id: str,
) -> List[Dict[str, Any]]:
    """
    Process all per-symbol recommendations from one analysis run.

    recommendations: list of dicts with keys:
        underlying, execution_ticker, signal_type (LONG/SHORT/HOLD), leverage, action

    Returns a list of action summaries for SSE logging.
    """
    from database.models import PaperTrade

    session = market_status()
    if not session["tradeable"]:
        return [{"skipped": True, "reason": "market_closed", "session": session["label"]}]

    now = datetime.utcnow()
    actions = []

    for rec in recommendations:
        underlying = str(rec.get("underlying") or rec.get("symbol") or "").upper()
        execution_ticker = str(rec.get("execution_ticker") or rec.get("entry_symbol") or "").upper()
        signal_type = str(rec.get("signal_type") or "HOLD").upper()
        leverage = str(rec.get("leverage") or "1x")

        if not underlying:
            continue

        # Get current price for the execution ticker
        price_data = quotes_by_symbol.get(execution_ticker) or quotes_by_symbol.get(underlying) or {}
        entry_price = float(price_data.get("current_price") or price_data.get("price") or 0.0)

        # Find current open position for this underlying
        open_pos = (
            db.query(PaperTrade)
            .filter(PaperTrade.underlying == underlying, PaperTrade.exited_at.is_(None))
            .first()
        )

        action_summary: Dict[str, Any] = {
            "underlying": underlying,
            "execution_ticker": execution_ticker,
            "signal_type": signal_type,
            "leverage": leverage,
            "session": session["label"],
        }

        # HOLD: do nothing — leave any open position running, don't open if flat
        if signal_type == "HOLD":
            action_summary["action"] = "no_change"
            action_summary["reason"] = "hold_signal"
            actions.append(action_summary)
            continue

        # Directional signal — check if we need to change anything
        position_unchanged = (
            open_pos is not None
            and open_pos.execution_ticker == execution_ticker
            and open_pos.leverage == leverage
            and open_pos.signal_type == signal_type
        )

        if position_unchanged:
            action_summary["action"] = "held"
            action_summary["reason"] = "same_ticker_leverage_direction"
            actions.append(action_summary)
            continue

        # Close existing position if any
        if open_pos and entry_price > 0:
            _close_position(open_pos, entry_price, now, db)
            action_summary["closed_pnl"] = open_pos.realized_pnl

        # Open new position
        if entry_price > 0:
            shares = round(PAPER_TRADE_AMOUNT / entry_price, 6)
            new_trade = PaperTrade(
                underlying=underlying,
                execution_ticker=execution_ticker,
                signal_type=signal_type,
                leverage=leverage,
                market_session=session["status"],
                amount=PAPER_TRADE_AMOUNT,
                shares=shares,
                entry_price=entry_price,
                entered_at=now,
                analysis_request_id=request_id,
            )
            db.add(new_trade)
            action_summary["action"] = "opened"
            action_summary["entry_price"] = entry_price
        else:
            action_summary["action"] = "skipped"
            action_summary["reason"] = "no_price_available"

        actions.append(action_summary)

    db.commit()
    return actions


def _close_position(pos, exit_price: float, now: datetime, db) -> None:
    pnl_pct = _directional_return_pct(pos.signal_type, pos.entry_price, exit_price)
    pos.exit_price = exit_price
    pos.exited_at = now
    pos.realized_pnl = round(_directional_pnl(pos.signal_type, pos.entry_price, exit_price, pos.amount), 4)
    pos.realized_pnl_pct = round(pnl_pct, 4)


def get_summary(db) -> Dict[str, Any]:
    """Build the full paper trading summary with live unrealized P&L."""
    from database.models import PaperTrade
    from services.data_ingestion.yfinance_client import PriceClient

    trades = db.query(PaperTrade).order_by(PaperTrade.entered_at.asc()).all()
    price_client = PriceClient()

    closed = [t for t in trades if t.exited_at is not None]
    open_positions_raw = [t for t in trades if t.exited_at is None]

    closed_metrics = []
    for t in closed:
        pnl = _directional_pnl(t.signal_type, t.entry_price, float(t.exit_price or t.entry_price), t.amount)
        pnl_pct = _directional_return_pct(t.signal_type, t.entry_price, float(t.exit_price or t.entry_price))
        closed_metrics.append({
            "trade": t,
            "realized_pnl": round(pnl, 4),
            "realized_pnl_pct": round(pnl_pct, 4),
        })

    realized_pnl = sum(item["realized_pnl"] for item in closed_metrics)
    wins = [item for item in closed_metrics if item["realized_pnl"] > 0]
    losses = [item for item in closed_metrics if item["realized_pnl"] <= 0]

    open_pnl = 0.0
    open_positions = []
    for t in open_positions_raw:
        try:
            q = price_client.get_realtime_quote(t.execution_ticker)
            current = float(q.get("current_price") or t.entry_price) if q else t.entry_price
        except Exception:
            current = t.entry_price
        unrealized = round(_directional_pnl(t.signal_type, t.entry_price, current, t.amount), 4)
        unrealized_pct = round(_directional_return_pct(t.signal_type, t.entry_price, current), 4)
        open_pnl += unrealized
        open_positions.append({
            "id": t.id,
            "underlying": t.underlying,
            "execution_ticker": t.execution_ticker,
            "signal_type": t.signal_type,
            "leverage": t.leverage,
            "amount": t.amount,
            "shares": t.shares,
            "entry_price": t.entry_price,
            "current_price": current,
            "entered_at": _utc_iso(t.entered_at),
            "market_session": t.market_session,
            "unrealized_pnl": unrealized,
            "unrealized_pnl_pct": unrealized_pct,
        })

    total_deployed = PAPER_TRADE_AMOUNT * len(trades)
    total_pnl = realized_pnl + open_pnl

    # Equity curve: cumulative realized P&L per closed trade
    equity_curve = []
    running = 0.0
    for item in closed_metrics:
        t = item["trade"]
        running += item["realized_pnl"]
        equity_curve.append({
            "at": _utc_iso(t.exited_at),
            "cumulative_pnl": round(running, 4),
            "trade_pnl": item["realized_pnl"],
            "trade_pnl_pct": item["realized_pnl_pct"],
            "ticker": t.execution_ticker,
            "underlying": t.underlying,
        })

    closed_trades = []
    for item in reversed(closed_metrics):
        t = item["trade"]
        closed_trades.append({
            "id": t.id,
            "underlying": t.underlying,
            "execution_ticker": t.execution_ticker,
            "signal_type": t.signal_type,
            "leverage": t.leverage,
            "amount": t.amount,
            "shares": t.shares,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "entered_at": _utc_iso(t.entered_at),
            "exited_at": _utc_iso(t.exited_at),
            "realized_pnl": item["realized_pnl"],
            "realized_pnl_pct": item["realized_pnl_pct"],
            "market_session": t.market_session,
        })

    return {
        "market": market_status(),
        "summary": {
            "total_trades": len(trades),
            "open_positions": len(open_positions),
            "closed_trades": len(closed),
            "total_deployed": total_deployed,
            "realized_pnl": round(realized_pnl, 4),
            "open_pnl": round(open_pnl, 4),
            "total_pnl": round(total_pnl, 4),
            "total_pnl_pct": round((total_pnl / max(total_deployed, 1)) * 100, 2) if total_deployed else 0,
            "win_count": len(wins),
            "loss_count": len(losses),
            "win_rate": round(len(wins) / max(len(closed), 1) * 100, 1) if closed else 0,
            "avg_win": round(sum(item["realized_pnl"] for item in wins) / max(len(wins), 1), 4) if wins else 0,
            "avg_loss": round(sum(item["realized_pnl"] for item in losses) / max(len(losses), 1), 4) if losses else 0,
        },
        "open_positions": open_positions,
        "closed_trades": closed_trades,
        "equity_curve": equity_curve,
    }


def _utc_iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    from datetime import timezone
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()
