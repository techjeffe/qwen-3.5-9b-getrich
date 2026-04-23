"""
Paper trading simulation service.

Auto-executes a configurable paper trade for every directional signal fired during
extended market hours (4:00am–8:00pm ET, Mon–Fri).

Position lifecycle (mirrors what a real trader following every signal would do):
- Same ticker + same leverage → hold, no change
- Different ticker OR different leverage OR direction flip → close old, open new
- HOLD signal → close any open position (thesis gone), stay flat
"""

from datetime import datetime, timedelta, time as time_cls, timezone
from zoneinfo import ZoneInfo
from typing import Optional, Dict, Any, List

from config.logic_loader import LOGIC as _L

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


def _window_active(pos, now: datetime) -> bool:
    """Return True if the position's conviction holding window has not yet expired."""
    win = getattr(pos, "holding_window_until", None)
    if not win:
        return False
    if win.tzinfo is None:
        win = win.replace(tzinfo=timezone.utc)
    now_utc = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)
    return now_utc < win


def close_expired_positions(db) -> List[Dict[str, Any]]:
    """
    Close any open positions whose conviction window has expired.
    Called at the start of each analysis run and from process_signals.
    Respects logic_config: close_on_window_expiry and close_expired_during_closed_hours.
    """
    from database.models import PaperTrade
    from services.data_ingestion.yfinance_client import PriceClient

    _cv = _L["conviction"]
    if not _cv.get("close_on_window_expiry", True):
        return []

    session = market_status()
    if not session["tradeable"] and not _cv.get("close_expired_during_closed_hours", True):
        return []

    now = datetime.utcnow()
    now_utc = now.replace(tzinfo=timezone.utc)

    open_positions = (
        db.query(PaperTrade)
        .filter(PaperTrade.exited_at.is_(None), PaperTrade.holding_window_until.isnot(None))
        .all()
    )

    expired = []
    for pos in open_positions:
        win = pos.holding_window_until
        if win.tzinfo is None:
            win = win.replace(tzinfo=timezone.utc)
        if now_utc >= win:
            expired.append(pos)

    if not expired:
        return []

    price_client = PriceClient()
    closed = []
    for pos in expired:
        exit_price = 0.0
        try:
            quote = price_client.get_realtime_quote(pos.execution_ticker)
            exit_price = float((quote or {}).get("current_price") or 0.0)
        except Exception:
            exit_price = 0.0
        if exit_price <= 0:
            exit_price = float(pos.entry_price or 0.0)
        if exit_price <= 0:
            continue
        _close_position(pos, exit_price, now, db, reason="window_expired")
        closed.append({
            "underlying": pos.underlying,
            "execution_ticker": pos.execution_ticker,
            "signal_type": pos.signal_type,
            "exit_price": exit_price,
            "realized_pnl": pos.realized_pnl,
            "reason": "window_expired",
        })

    if closed:
        db.commit()
    return closed


def process_signals(
    db,
    recommendations: List[Dict[str, Any]],
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    request_id: str,
    trade_amount: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    Process all per-symbol recommendations from one analysis run.

    recommendations: list of dicts with keys:
        underlying, execution_ticker, signal_type (LONG/SHORT/HOLD), leverage,
        conviction_level (HIGH/MEDIUM/LOW), trading_type, holding_minutes

    Position lifecycle:
    - Same ticker + same leverage + same direction → hold (no change)
    - Direction flip → always close old and open new (overrides conviction window)
    - HOLD signal + active conviction window → keep position (window protects it)
    - HOLD signal + expired/no window → close position, go flat
    """
    from database.models import PaperTrade

    _cv = _L["conviction"]

    # Always check for expired windows first, even if market is closed
    expired_actions = close_expired_positions(db)

    session = market_status()
    if not session["tradeable"]:
        return [
            {**ea, "action": "closed", "auto_expired": True} for ea in expired_actions
        ] or [{"skipped": True, "reason": "market_closed", "session": session["label"]}]

    now = datetime.utcnow()
    actions: List[Dict[str, Any]] = [
        {**ea, "action": "closed", "auto_expired": True}
        for ea in expired_actions
    ]

    for rec in recommendations:
        underlying = str(rec.get("underlying") or rec.get("symbol") or "").upper()
        execution_ticker = str(rec.get("execution_ticker") or rec.get("entry_symbol") or "").upper()
        signal_type = str(rec.get("signal_type") or "HOLD").upper()
        leverage = str(rec.get("leverage") or "1x")
        conviction_level = str(rec.get("conviction_level") or "MEDIUM").upper()
        trading_type = str(rec.get("trading_type") or "SWING").upper()
        holding_minutes = int(rec.get("holding_minutes") or _cv["holding_minutes"].get(trading_type, 720))

        if not underlying:
            continue

        price_data = quotes_by_symbol.get(execution_ticker) or quotes_by_symbol.get(underlying) or {}
        entry_price = float(price_data.get("current_price") or price_data.get("price") or 0.0)

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
            "conviction_level": conviction_level,
            "trading_type": trading_type,
            "session": session["label"],
        }

        # ── Trailing stop check (before signal processing) ────────────────────
        _prev_signal_type = open_pos.signal_type if open_pos else None
        _trailing_stop_hit = False
        if open_pos and open_pos.trailing_stop_price is not None and entry_price > 0:
            stop_px = float(open_pos.trailing_stop_price or 0)
            if stop_px > 0:
                _trailing_stop_hit = (
                    (open_pos.signal_type == "LONG" and entry_price <= stop_px) or
                    (open_pos.signal_type == "SHORT" and entry_price >= stop_px)
                )
            if _trailing_stop_hit:
                _close_position(open_pos, entry_price, now, db, reason="trailing_stop_hit")
                action_summary["closed_pnl"] = open_pos.realized_pnl
                action_summary["exit_price"] = entry_price
                open_pos = None
                # If new signal is HOLD or same direction, stay flat this run
                if signal_type == "HOLD" or signal_type == _prev_signal_type:
                    action_summary["action"] = "closed"
                    action_summary["reason"] = "trailing_stop_hit"
                    actions.append(action_summary)
                    continue
                # Direction flip after stop: fall through to open new position below
                action_summary["reason"] = "trailing_stop_hit_then_flip"

        # ── HOLD signal ───────────────────────────────────────────────────────
        if signal_type == "HOLD":
            if (
                open_pos
                and _cv.get("hold_signal_respects_window", True)
                and _window_active(open_pos, now)
            ):
                action_summary["action"] = "held"
                action_summary["reason"] = "conviction_window_active"
                action_summary["holding_window_until"] = _utc_iso(open_pos.holding_window_until)
            elif open_pos:
                # HOLD with no active window — set trailing stop instead of forcing close
                _pos_prices = quotes_by_symbol.get(open_pos.execution_ticker) or quotes_by_symbol.get(underlying) or {}
                current_px = float(_pos_prices.get("current_price") or _pos_prices.get("price") or 0.0)
                if current_px > 0:
                    _ts_cfg = _L.get("trailing_stop", {})
                    _tight_pct = float(_ts_cfg.get("tighten_factor", 0.5)) * float(_L["stop_loss_pct"]) / 100.0
                    if open_pos.signal_type == "LONG":
                        cur_best = float(open_pos.best_price_seen or 0) or float(open_pos.entry_price or 0)
                        best = max(cur_best, current_px)
                        new_stop = round(best * (1.0 - _tight_pct), 4)
                    else:
                        cur_best = float(open_pos.best_price_seen or 0)
                        best = min(cur_best, current_px) if cur_best > 0 else current_px
                        new_stop = round(best * (1.0 + _tight_pct), 4)
                    open_pos.best_price_seen = best
                    open_pos.trailing_stop_price = new_stop
                    action_summary["action"] = "trailing"
                    action_summary["reason"] = "hold_signal_trailing_stop"
                    action_summary["trailing_stop_price"] = new_stop
                else:
                    action_summary["action"] = "held"
                    action_summary["reason"] = "hold_signal_no_price"
            else:
                action_summary["action"] = "no_change"
                action_summary["reason"] = "hold_signal_no_position"
            actions.append(action_summary)
            continue

        # ── Directional signal ────────────────────────────────────────────────
        position_unchanged = (
            open_pos is not None
            and open_pos.execution_ticker == execution_ticker
            and open_pos.leverage == leverage
            and open_pos.signal_type == signal_type
        )

        if position_unchanged:
            # Optionally reset the holding window when the thesis is re-confirmed
            if _cv.get("reset_window_on_confirmation", True):
                _type_rank = {"VOLATILE_EVENT": 0, "SCALP": 1, "SWING": 2, "POSITION": 3}
                old_rank = _type_rank.get((open_pos.trading_type or "SWING").upper(), 2)
                new_rank = _type_rank.get(trading_type.upper(), 2)
                _max_mins = _cv.get("max_holding_minutes", {}).get(trading_type, holding_minutes * 3)
                entered_naive = open_pos.entered_at
                hard_cap = entered_naive + timedelta(minutes=_max_mins) if entered_naive else None
                proposed = now + timedelta(minutes=holding_minutes)
                if new_rank >= old_rank:
                    new_window = min(proposed, hard_cap) if hard_cap else proposed
                else:
                    cur_win = open_pos.holding_window_until
                    new_window = min(cur_win, proposed) if cur_win else proposed
                open_pos.holding_window_until = new_window
                open_pos.conviction_level = conviction_level
                open_pos.trading_type = trading_type
                # Thesis re-confirmed: clear any trailing stop
                open_pos.trailing_stop_price = None
                open_pos.best_price_seen = None
                action_summary["action"] = "held"
                action_summary["reason"] = "window_reset" if new_rank >= old_rank else "window_shortened"
                action_summary["holding_window_until"] = _utc_iso(new_window)
            else:
                action_summary["action"] = "held"
                action_summary["reason"] = "same_ticker_leverage_direction"
            actions.append(action_summary)
            continue

        # Close existing position — direction flip overrides window when config allows (default: always)
        is_direction_flip = open_pos is not None and open_pos.signal_type != signal_type
        window_blocks_close = (
            open_pos is not None
            and is_direction_flip
            and not _cv.get("flip_overrides_window", True)
            and _window_active(open_pos, now)
        )
        if open_pos and entry_price > 0 and not window_blocks_close:
            _close_position(
                open_pos, entry_price, now, db,
                reason="direction_flip" if is_direction_flip else "ticker_leverage_change",
            )
            action_summary["closed_pnl"] = open_pos.realized_pnl
        elif window_blocks_close:
            action_summary["action"] = "held"
            action_summary["reason"] = "conviction_window_blocks_flip"
            action_summary["holding_window_until"] = _utc_iso(open_pos.holding_window_until)
            actions.append(action_summary)
            continue

        # Open new position
        _amount = trade_amount if trade_amount and trade_amount > 0 else _L["paper_trade_amount"]
        if entry_price > 0:
            window_until = datetime.utcnow() + timedelta(minutes=holding_minutes)
            shares = round(_amount / entry_price, 6)
            new_trade = PaperTrade(
                underlying=underlying,
                execution_ticker=execution_ticker,
                signal_type=signal_type,
                leverage=leverage,
                market_session=session["status"],
                amount=_amount,
                shares=shares,
                entry_price=entry_price,
                entered_at=now,
                analysis_request_id=request_id,
                conviction_level=conviction_level,
                trading_type=trading_type,
                holding_period_hours=round(holding_minutes / 60, 2),
                holding_window_until=window_until,
            )
            db.add(new_trade)
            action_summary["action"] = "opened"
            action_summary["entry_price"] = entry_price
            action_summary["holding_window_until"] = _utc_iso(window_until)
        else:
            action_summary["action"] = "skipped"
            action_summary["reason"] = "no_price_available"

        actions.append(action_summary)

    db.commit()
    return actions


def close_positions_for_removed_symbols(db, removed_symbols: List[str]) -> List[Dict[str, Any]]:
    """Close open paper trades for symbols removed from custom tracking."""
    from database.models import PaperTrade
    from services.data_ingestion.yfinance_client import PriceClient

    normalized_symbols = sorted({str(symbol or "").upper().strip() for symbol in removed_symbols if str(symbol or "").strip()})
    if not normalized_symbols:
        return []

    open_positions = (
        db.query(PaperTrade)
        .filter(PaperTrade.underlying.in_(normalized_symbols), PaperTrade.exited_at.is_(None))
        .all()
    )
    if not open_positions:
        return []

    now = datetime.utcnow()
    price_client = PriceClient()
    closed_positions: List[Dict[str, Any]] = []

    for pos in open_positions:
        exit_price = 0.0
        try:
            quote = price_client.get_realtime_quote(pos.execution_ticker)
            exit_price = float((quote or {}).get("current_price") or 0.0)
        except Exception:
            exit_price = 0.0

        if exit_price <= 0:
            exit_price = float(pos.entry_price or 0.0)
        if exit_price <= 0:
            continue

        _close_position(pos, exit_price, now, db, reason="symbol_removed_from_config")
        closed_positions.append({
            "underlying": pos.underlying,
            "execution_ticker": pos.execution_ticker,
            "signal_type": pos.signal_type,
            "exit_price": exit_price,
            "realized_pnl": pos.realized_pnl,
            "reason": "symbol_removed_from_config",
        })

    if closed_positions:
        db.commit()

    return closed_positions


def _close_position(pos, exit_price: float, now: datetime, db, reason: Optional[str] = None) -> None:
    pnl_pct = _directional_return_pct(pos.signal_type, pos.entry_price, exit_price)
    pos.exit_price = exit_price
    pos.exited_at = now
    pos.realized_pnl = round(_directional_pnl(pos.signal_type, pos.entry_price, exit_price, pos.amount), 4)
    pos.realized_pnl_pct = round(pnl_pct, 4)
    if reason:
        pos.close_reason = reason


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
        now_utc = datetime.utcnow().replace(tzinfo=timezone.utc)
        win = t.holding_window_until
        if win and win.tzinfo is None:
            win = win.replace(tzinfo=timezone.utc)
        window_active = bool(win and now_utc < win)
        window_remaining_minutes = (
            round((win - now_utc).total_seconds() / 60) if window_active else None
        )
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
            "conviction_level": t.conviction_level,
            "trading_type": t.trading_type,
            "holding_period_hours": t.holding_period_hours,
            "holding_window_until": _utc_iso(t.holding_window_until),
            "window_active": window_active,
            "window_remaining_minutes": window_remaining_minutes,
            "trailing_stop_price": t.trailing_stop_price,
            "best_price_seen": t.best_price_seen,
        })

    total_deployed = sum(float(t.amount or _L["paper_trade_amount"]) for t in trades)
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
            "conviction_level": t.conviction_level,
            "trading_type": t.trading_type,
            "holding_period_hours": t.holding_period_hours,
            "close_reason": t.close_reason,
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
