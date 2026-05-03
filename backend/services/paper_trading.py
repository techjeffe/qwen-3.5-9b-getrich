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


def _allow_extended_hours_trading(db=None) -> bool:
    if db is None:
        return True
    try:
        from services.app_config import get_or_create_app_config
        config = get_or_create_app_config(db)
        return bool(getattr(config, "allow_extended_hours_trading", True))
    except Exception:
        return True


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


def _resolve_position_market_price(open_pos, quotes_by_symbol: Dict[str, Dict[str, Any]]) -> float:
    """Price an existing position using its current execution ticker, not an incoming replacement ticker."""
    if open_pos is None:
        return 0.0
    price_data = (
        quotes_by_symbol.get(str(getattr(open_pos, "execution_ticker", "") or "").upper())
        or quotes_by_symbol.get(str(getattr(open_pos, "underlying", "") or "").upper())
        or {}
    )
    return float(price_data.get("current_price") or price_data.get("price") or 0.0)


def market_status(allow_extended_hours: bool = True) -> Dict[str, Any]:
    """Return current market session for display and gate-keeping."""
    now_et = datetime.now(_MARKET_TZ)
    t = now_et.time()

    if now_et.weekday() >= 5:
        return {"status": "closed", "label": "Closed (Weekend)", "tradeable": False}

    if _REGULAR_OPEN <= t <= _REGULAR_CLOSE:
        return {"status": "open", "label": "Market Open", "tradeable": True}
    if _EXTENDED_OPEN <= t < _REGULAR_OPEN:
        return {
            "status": "pre-market",
            "label": "Pre-Market" if allow_extended_hours else "Pre-Market (Trading Disabled)",
            "tradeable": allow_extended_hours,
        }
    if _REGULAR_CLOSE < t <= _EXTENDED_CLOSE:
        return {
            "status": "after-hours",
            "label": "After-Hours" if allow_extended_hours else "After-Hours (Trading Disabled)",
            "tradeable": allow_extended_hours,
        }
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


def _same_market_day(a: Optional[datetime], b: Optional[datetime]) -> bool:
    if a is None or b is None:
        return False
    if a.tzinfo is None:
        a = a.replace(tzinfo=timezone.utc)
    if b.tzinfo is None:
        b = b.replace(tzinfo=timezone.utc)
    return a.astimezone(_MARKET_TZ).date() == b.astimezone(_MARKET_TZ).date()


def _min_same_day_exit_edge_pct(app_config) -> float:
    try:
        override = getattr(app_config, "min_same_day_exit_edge_pct", None) if app_config is not None else None
        if override is not None:
            return max(0.0, float(override))
    except Exception:
        pass
    return max(0.0, float(_L.get("min_same_day_exit_edge_pct", 0.5)))


def _entry_threshold_for_session(session_status: str, app_config) -> float:
    """Return the minimum directional score required to enter a new position.

    Uses app_config entry_threshold override when set, else falls back to
    logic_config defaults.  pre-market/after-hours sessions use the
    closed_market threshold; open sessions use the normal threshold.
    """
    try:
        if app_config is not None:
            override = getattr(app_config, "entry_threshold", None)
            if override is not None:
                return max(0.0, float(override))
    except Exception:
        pass

    thresholds = _L.get("entry_thresholds", {})
    if session_status in ("pre-market", "after-hours"):
        return max(0.0, float(thresholds.get("closed_market", thresholds.get("normal", 0.42))))
    return max(0.0, float(thresholds.get("normal", 0.42)))


def _stop_loss_pct_for_config(app_config) -> float:
    """Return configured stop-loss percentage."""
    try:
        if app_config is not None:
            override = getattr(app_config, "stop_loss_pct", None)
            if override is not None:
                return max(0.0, float(override))
    except Exception:
        pass
    return max(0.0, float(_L.get("stop_loss_pct", 2.0)))


def _take_profit_pct_for_config(app_config) -> float:
    """Return configured take-profit percentage."""
    try:
        if app_config is not None:
            override = getattr(app_config, "take_profit_pct", None)
            if override is not None:
                return max(0.0, float(override))
    except Exception:
        pass
    return max(0.0, float(_L.get("take_profit_pct", 3.0)))


def _same_day_exit_edge_blocks_close(open_pos, exit_price: float, now: datetime, threshold_pct: float) -> bool:
    """
    Block tiny same-day winners from being closed just to churn the account.
    Loss-cutting remains allowed.
    """
    if open_pos is None or threshold_pct <= 0 or exit_price <= 0:
        return False
    entered_at = getattr(open_pos, "entered_at", None)
    if not _same_market_day(entered_at, now):
        return False
    pnl_pct = _directional_return_pct(open_pos.signal_type, float(open_pos.entry_price or 0.0), exit_price)
    return pnl_pct > 0 and pnl_pct < threshold_pct


def _portfolio_cap_for_config(app_config) -> Optional[float]:
    """Return the configured portfolio cap in USD, or None if uncapped."""
    try:
        if app_config is not None:
            override = getattr(app_config, "vol_sizing_portfolio_cap_usd", None)
            if override is not None:
                return max(0.0, float(override))
    except Exception:
        pass
    cap = _L.get("vol_sizing", {}).get("portfolio_cap_usd")
    return max(0.0, float(cap)) if cap is not None else None


def _get_alpaca_system_open_exposure(broker, db, app_config=None) -> Optional[float]:
    """Return total |market_value| of Alpaca positions in tickers this system trades.

    Covers both the fixed execution tickers from INSTRUMENT_SPECS (TQQQ, SPXL, etc.)
    and any custom symbols the user has added (NVDA, TSLA, etc.). Positions opened
    outside this system are still counted — the risk is real regardless of who opened
    them — and logged as a warning. Returns None on API error so the caller falls back
    to the DB total.
    """
    try:
        from services.trading_instruments import INSTRUMENT_SPECS
        from database.models import PaperTrade as _PT

        # Fixed execution tickers (leveraged ETF proxies for default symbols).
        _our_tickers: set = set()
        for spec in INSTRUMENT_SPECS.values():
            for direction in ("bull", "bear"):
                _our_tickers.update(spec.get(direction, {}).values())

        # Custom symbols trade directly under their own ticker.
        if app_config is not None:
            for sym in (getattr(app_config, "custom_symbols", None) or []):
                sym = str(sym or "").upper().strip()
                if sym:
                    _our_tickers.add(sym)

        _db_tickers = {
            str(p.execution_ticker or "").upper()
            for p in db.query(_PT).filter(_PT.exited_at.is_(None)).all()
            if p.execution_ticker
        }

        positions = broker.get_positions()
        total = 0.0
        for p in positions:
            sym = str(p.get("symbol") or "").upper()
            if sym not in _our_tickers:
                continue
            mv = abs(float(p.get("market_value") or 0))
            total += mv
            if sym not in _db_tickers:
                print(
                    f"[cap] external position in {sym} (${mv:.2f}) not opened by this system"
                    f" — counting against portfolio cap"
                )
        return total
    except Exception as exc:
        print(f"[cap] could not fetch Alpaca positions for exposure baseline: {exc}")
        return None


def _compute_vol_normalized_amount(
    base_amount: float,
    conviction_level: str,
    atr_pct: float,
) -> float:
    """
    Compute position size using volatility targeting.

    Formula: size = (target_daily_vol_pct/100 * base) / (atr_14d_pct/100)
    Scaled by conviction level, then clamped to [min_mult, max_mult] × base.

    When ATR is unavailable (0), falls back to conviction-scaled base amount.
    """
    cfg = _L.get("vol_sizing", {})
    if not cfg.get("enabled", True):
        return base_amount

    target_vol = float(cfg.get("target_daily_vol_pct", 1.0)) / 100.0
    scalars = cfg.get("conviction_scalars", {"HIGH": 1.5, "MEDIUM": 1.0, "LOW": 0.5})
    conviction_scalar = float(scalars.get(str(conviction_level).upper(), 1.0))
    min_mult = float(cfg.get("min_size_multiple", 0.25))
    max_mult = float(cfg.get("max_size_multiple", 5.0))

    if atr_pct > 0:
        vol_size = (target_vol * base_amount) / (atr_pct / 100.0)
    else:
        vol_size = base_amount

    scaled = vol_size * conviction_scalar
    return round(max(base_amount * min_mult, min(base_amount * max_mult, scaled)), 2)


def close_expired_positions(db, alpaca_pending: Optional[list] = None) -> List[Dict[str, Any]]:
    """
    Close any open positions whose conviction window has expired.
    Called at the start of each analysis run and from process_signals.
    Respects logic_config: close_on_window_expiry and close_expired_during_closed_hours.

    alpaca_pending: if provided, (trade_obj, "close") tuples for actual closes
    (not trailing activations) are appended so the caller can forward them to Alpaca.
    """
    from database.models import PaperTrade
    from services.data_ingestion.yfinance_client import PriceClient

    _cv = _L["conviction"]
    if not _cv.get("close_on_window_expiry", True):
        return []

    session = market_status(_allow_extended_hours_trading(db))
    _hold_overnight = False
    _cfg = None
    try:
        from services.app_config import get_or_create_app_config as _get_cfg
        _cfg = _get_cfg(db)
        _hold_overnight = bool(getattr(_cfg, "hold_overnight", False))
    except Exception:
        pass
    if not session["tradeable"] and (_hold_overnight or not _cv.get("close_expired_during_closed_hours", True)):
        return []

    _trail_on_expiry = bool(_cv.get("trail_on_window_expiry", True))
    if _cfg is not None:
        try:
            _trail_on_expiry = bool(getattr(_cfg, "trail_on_window_expiry", _trail_on_expiry))
        except Exception:
            pass

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
    _ts_cfg = _L.get("trailing_stop", {})
    _tight_pct = float(_ts_cfg.get("tighten_factor", 0.5)) * float(_L["stop_loss_pct"]) / 100.0
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
        if _trail_on_expiry:
            # Activate trailing stop instead of closing — lets winners run
            if pos.signal_type == "LONG":
                cur_best = float(pos.best_price_seen or 0) or float(pos.entry_price or 0)
                best = max(cur_best, exit_price)
                new_stop = round(best * (1.0 - _tight_pct), 4)
            else:
                cur_best = float(pos.best_price_seen or 0)
                best = min(cur_best, exit_price) if cur_best > 0 else exit_price
                new_stop = round(best * (1.0 + _tight_pct), 4)
            pos.best_price_seen = best
            pos.trailing_stop_price = new_stop
            pos.holding_window_until = None  # prevent re-triggering expiry
            closed.append({
                "underlying": pos.underlying,
                "execution_ticker": pos.execution_ticker,
                "signal_type": pos.signal_type,
                "exit_price": exit_price,
                "realized_pnl": None,
                "reason": "trailing_activated",
                "trailing_stop_price": new_stop,
            })
        else:
            _close_position(pos, exit_price, now, db, reason="window_expired")
            if alpaca_pending is not None:
                alpaca_pending.append((pos, "close"))
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

    # Load app config once — used for re-entry cooldown and Alpaca dispatch
    _app_config = None
    try:
        from services.app_config import get_or_create_app_config as _get_cfg_rc
        _app_config = _get_cfg_rc(db)
    except Exception:
        pass

    # Re-entry cooldown: same-direction re-entry blocked for this many minutes after a close
    _reentry_cooldown = int(_L.get("reentry_cooldown_minutes", 0))
    if _app_config is not None:
        _rc_override = getattr(_app_config, "reentry_cooldown_minutes", None)
        if _rc_override is not None:
            _reentry_cooldown = int(_rc_override)
    _min_same_day_edge_pct = _min_same_day_exit_edge_pct(_app_config)

    # Collect (paper_trade_obj, "open"|"close") for Alpaca dispatch after commit
    _alpaca_pending: list = []

    # Always check for expired windows first, even if market is closed.
    # Pass _alpaca_pending so actual window-expired closes are queued for Alpaca
    # dispatch at the end of this function alongside all other lifecycle events.
    expired_actions = close_expired_positions(db, alpaca_pending=_alpaca_pending)

    def _expired_action(ea: Dict[str, Any]) -> Dict[str, Any]:
        action = "trailing" if ea.get("reason") == "trailing_activated" else "closed"
        return {**ea, "action": action, "auto_expired": True}

    session = market_status(_allow_extended_hours_trading(db))
    if not session["tradeable"]:
        return [_expired_action(ea) for ea in expired_actions] or [
            {"skipped": True, "reason": "market_closed", "session": session["label"]}
        ]

    now = datetime.utcnow()
    actions: List[Dict[str, Any]] = [_expired_action(ea) for ea in expired_actions]

    # Portfolio cap — seed running exposure from Alpaca when connected so external
    # positions in our execution tickers count against the cap. Falls back to DB.
    _portfolio_cap = _portfolio_cap_for_config(_app_config)
    _open_exposure = 0.0
    if _portfolio_cap is not None:
        _alpaca_mode = (getattr(_app_config, "alpaca_execution_mode", None) or "off")
        _alpaca_exposure: Optional[float] = None
        if _alpaca_mode != "off":
            try:
                from services.alpaca_broker import get_broker_from_keychain as _gbfk
                _cap_broker = _gbfk(mode=_alpaca_mode)
                if _cap_broker:
                    _alpaca_exposure = _get_alpaca_system_open_exposure(_cap_broker, db, _app_config)
            except Exception:
                pass
        if _alpaca_exposure is not None:
            _open_exposure = _alpaca_exposure
        else:
            try:
                from database.models import PaperTrade as _PT
                _open_exposure = sum(
                    float(p.amount or 0)
                    for p in db.query(_PT).filter(_PT.exited_at.is_(None)).all()
                )
            except Exception:
                _open_exposure = 0.0

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
        existing_pos_price = _resolve_position_market_price(open_pos, quotes_by_symbol)

        if open_pos and open_pos.trailing_stop_price is not None and existing_pos_price > 0:
            stop_px = float(open_pos.trailing_stop_price or 0)
            if stop_px > 0:
                _trailing_stop_hit = (
                    (open_pos.signal_type == "LONG" and existing_pos_price <= stop_px) or
                    (open_pos.signal_type == "SHORT" and existing_pos_price >= stop_px)
                )
            if _trailing_stop_hit:
                _close_position(open_pos, existing_pos_price, now, db, reason="trailing_stop_hit")
                action_summary["closed_pnl"] = open_pos.realized_pnl
                action_summary["exit_price"] = existing_pos_price
                _alpaca_pending.append((open_pos, "close"))
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
        if open_pos and existing_pos_price > 0 and not window_blocks_close:
            if _same_day_exit_edge_blocks_close(open_pos, existing_pos_price, now, _min_same_day_edge_pct):
                action_summary["action"] = "held"
                action_summary["reason"] = "min_same_day_exit_edge"
                action_summary["exit_edge_pct"] = round(
                    _directional_return_pct(open_pos.signal_type, open_pos.entry_price, existing_pos_price),
                    4,
                )
                action_summary["min_same_day_exit_edge_pct"] = _min_same_day_edge_pct
                actions.append(action_summary)
                continue
            _close_position(
                open_pos, existing_pos_price, now, db,
                reason="direction_flip" if is_direction_flip else "ticker_leverage_change",
            )
            action_summary["closed_pnl"] = open_pos.realized_pnl
            action_summary["exit_price"] = existing_pos_price
            _alpaca_pending.append((open_pos, "close"))
            if _portfolio_cap is not None:
                _open_exposure = max(0.0, _open_exposure - float(open_pos.amount or 0))
        elif window_blocks_close:
            action_summary["action"] = "held"
            action_summary["reason"] = "conviction_window_blocks_flip"
            action_summary["holding_window_until"] = _utc_iso(open_pos.holding_window_until)
            actions.append(action_summary)
            continue

        # Re-entry cooldown: skip same-direction re-entry if too soon after a close
        if entry_price > 0 and _reentry_cooldown > 0:
            _recent = (
                db.query(PaperTrade)
                .filter(
                    PaperTrade.underlying == underlying,
                    PaperTrade.exited_at.isnot(None),
                    PaperTrade.signal_type == signal_type,
                )
                .order_by(PaperTrade.exited_at.desc())
                .first()
            )
            if _recent and _recent.exited_at:
                _exited = _recent.exited_at
                if _exited.tzinfo is None:
                    _exited = _exited.replace(tzinfo=timezone.utc)
                _now_utc = now.replace(tzinfo=timezone.utc)
                if _now_utc < _exited + timedelta(minutes=_reentry_cooldown):
                    action_summary["action"] = "skipped"
                    action_summary["reason"] = "reentry_cooldown"
                    actions.append(action_summary)
                    continue

        # ── Stop-loss / Take-profit check on existing position ──
        if open_pos is not None and existing_pos_price > 0 and signal_type == open_pos.signal_type:
            _stop_loss = _stop_loss_pct_for_config(_app_config)
            _take_profit = _take_profit_pct_for_config(_app_config)
            if _stop_loss > 0 or _take_profit > 0:
                _pnl_pct = _directional_return_pct(open_pos.signal_type, float(open_pos.entry_price or 0), existing_pos_price)
                if _stop_loss > 0 and _pnl_pct <= -_stop_loss:
                    _close_position(open_pos, existing_pos_price, now, db, reason="stop_loss_hit")
                    action_summary["closed_pnl"] = open_pos.realized_pnl
                    action_summary["exit_price"] = existing_pos_price
                    action_summary["pnl_pct"] = round(_pnl_pct, 4)
                    action_summary["action"] = "closed"
                    action_summary["reason"] = "stop_loss_hit"
                    _alpaca_pending.append((open_pos, "close"))
                    actions.append(action_summary)
                    continue
                if _take_profit > 0 and _pnl_pct >= _take_profit:
                    _close_position(open_pos, existing_pos_price, now, db, reason="take_profit_hit")
                    action_summary["closed_pnl"] = open_pos.realized_pnl
                    action_summary["exit_price"] = existing_pos_price
                    action_summary["pnl_pct"] = round(_pnl_pct, 4)
                    action_summary["action"] = "closed"
                    action_summary["reason"] = "take_profit_hit"
                    _alpaca_pending.append((open_pos, "close"))
                    actions.append(action_summary)
                    continue

        # ── Entry threshold gate ──
        # (directional signals only — HOLD signals skip this)
        # We gate on conviction_level: only HIGH conviction gets an automatic pass.
        # MEDIUM requires the configured entry threshold; LOW is always blocked.
        _threshold = _entry_threshold_for_session(session["status"], _app_config)
        _conviction = str(conviction_level or "MEDIUM").upper()
        if _conviction == "LOW":
            action_summary["action"] = "skipped"
            action_summary["reason"] = "low_conviction_blocked"
            action_summary["entry_threshold"] = _threshold
            actions.append(action_summary)
            continue

        # Open new position — size using volatility targeting, then apply portfolio cap
        _base_amount = trade_amount if trade_amount and trade_amount > 0 else _L["paper_trade_amount"]
        _atr_pct = float(rec.get("atr_pct") or 0.0)
        if getattr(_app_config, "alpaca_fixed_order_size", False):
            _amount = _base_amount
        else:
            _amount = _compute_vol_normalized_amount(_base_amount, conviction_level, _atr_pct)

        if _portfolio_cap is not None:
            _remaining = max(0.0, _portfolio_cap - _open_exposure)
            if _remaining <= 0.0:
                action_summary["action"] = "skipped"
                action_summary["reason"] = "portfolio_cap_reached"
                action_summary["portfolio_cap_usd"] = _portfolio_cap
                action_summary["open_exposure_usd"] = round(_open_exposure, 2)
                actions.append(action_summary)
                continue
            _amount = min(_amount, _remaining)

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
            _alpaca_pending.append((new_trade, "open"))
            if _portfolio_cap is not None:
                _open_exposure += _amount
            action_summary["action"] = "opened"
            action_summary["entry_price"] = entry_price
            action_summary["amount"] = round(_amount, 2)
            action_summary["holding_window_until"] = _utc_iso(window_until)
        else:
            action_summary["action"] = "skipped"
            action_summary["reason"] = "no_price_available"

        actions.append(action_summary)

    # Close any open position whose underlying was not covered by this run.
    # Absence of a recommendation = thesis gone; treat the same as a HOLD with no window.
    covered_underlyings = {
        str(rec.get("underlying") or rec.get("symbol") or "").upper()
        for rec in recommendations
        if str(rec.get("underlying") or rec.get("symbol") or "").strip()
    }
    orphaned = (
        db.query(PaperTrade)
        .filter(PaperTrade.exited_at.is_(None))
        .all()
    )
    for pos in orphaned:
        if pos.underlying in covered_underlyings:
            continue
        price_data = quotes_by_symbol.get(pos.execution_ticker) or quotes_by_symbol.get(pos.underlying) or {}
        exit_price = float(price_data.get("current_price") or price_data.get("price") or pos.entry_price or 0.0)
        if exit_price > 0:
            if _same_day_exit_edge_blocks_close(pos, exit_price, now, _min_same_day_edge_pct):
                actions.append({
                    "underlying": pos.underlying,
                    "execution_ticker": pos.execution_ticker,
                    "signal_type": pos.signal_type,
                    "action": "held",
                    "reason": "min_same_day_exit_edge",
                    "exit_edge_pct": round(_directional_return_pct(pos.signal_type, pos.entry_price, exit_price), 4),
                    "min_same_day_exit_edge_pct": _min_same_day_edge_pct,
                    "session": session["label"],
                })
                continue
            _close_position(pos, exit_price, now, db, reason="no_recommendation")
            _alpaca_pending.append((pos, "close"))
            actions.append({
                "underlying": pos.underlying,
                "execution_ticker": pos.execution_ticker,
                "signal_type": pos.signal_type,
                "action": "closed",
                "reason": "no_recommendation",
                "exit_price": exit_price,
                "closed_pnl": pos.realized_pnl,
                "session": session["label"],
            })

    db.commit()
    _dispatch_alpaca_orders(db, _alpaca_pending, _app_config)
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


def _dispatch_alpaca_orders(db, pending: list, config) -> None:
    """Fire-and-forget Alpaca order dispatch after paper trades are committed."""
    if not pending or config is None:
        return
    try:
        from services.alpaca_broker import maybe_execute_alpaca_order
        for trade, event in pending:
            maybe_execute_alpaca_order(db, trade, event, config)
    except ImportError:
        pass
    except Exception as exc:
        print(f"[alpaca] order dispatch error: {exc}")


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
    configured_trade_amount = float(_L["paper_trade_amount"])
    try:
        from services.app_config import get_or_create_app_config
        config = get_or_create_app_config(db)
        configured_trade_amount = float(getattr(config, "paper_trade_amount", None) or configured_trade_amount)
    except Exception:
        pass

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
        "market": market_status(_allow_extended_hours_trading(db)),
        "paper_trade_amount": round(configured_trade_amount, 2),
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
