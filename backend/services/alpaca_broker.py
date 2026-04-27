"""
Alpaca brokerage integration.
Routes real orders to Alpaca paper-api or live api based on trading_mode stored
in the OS keychain. All order attempts (success and failure) are written to the
alpaca_orders table so there is always a complete audit trail.
"""
from __future__ import annotations

import time as _time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

PAPER_BASE = "https://paper-api.alpaca.markets"
LIVE_BASE  = "https://api.alpaca.markets"

_TERMINAL_STATUSES = frozenset({"filled", "cancelled", "expired", "rejected", "error"})


class CircuitBreakerError(Exception):
    """Raised when a safety limit would be breached; live trading is auto-disabled."""


# ── Broker client ─────────────────────────────────────────────────────────────

class AlpacaBroker:
    def __init__(self, api_key: str, secret_key: str, mode: str = "paper") -> None:
        self.mode    = mode  # "paper" | "live"
        self._base   = PAPER_BASE if mode == "paper" else LIVE_BASE
        self._headers: Dict[str, str] = {
            "APCA-API-KEY-ID":     api_key,
            "APCA-API-SECRET-KEY": secret_key,
            "Content-Type":        "application/json",
        }

    def get_account(self) -> Dict[str, Any]:
        return self._get("/v2/account")

    def get_positions(self) -> List[Dict[str, Any]]:
        result = self._get("/v2/positions")
        return result if isinstance(result, list) else []

    def place_order(
        self,
        symbol: str,
        side: str,
        notional: Optional[float] = None,
        qty: Optional[float] = None,
        order_type: str = "market",
        time_in_force: str = "day",
        limit_price: Optional[float] = None,
        extended_hours: bool = False,
        client_order_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "symbol":        symbol.upper(),
            "side":          side,
            "type":          order_type,
            "time_in_force": time_in_force,
        }
        if extended_hours:
            # Alpaca requires limit orders + explicit qty for extended hours.
            # Notional/fractional is not supported outside regular hours.
            payload["extended_hours"] = True
            payload["type"] = "limit"
            payload["time_in_force"] = "day"
            if limit_price:
                payload["limit_price"] = str(round(limit_price, 2))
            if qty:
                payload["qty"] = str(round(qty, 6))
        else:
            if notional is not None:
                payload["notional"] = str(round(notional, 2))
            elif qty is not None:
                payload["qty"] = str(round(qty, 6))
        if client_order_id:
            payload["client_order_id"] = client_order_id
        return self._post("/v2/orders", payload)

    def cancel_order(self, order_id: str) -> None:
        self._delete(f"/v2/orders/{order_id}")

    def cancel_all_orders(self) -> List[Dict[str, Any]]:
        """Cancel every open order. Returns list of cancellation responses."""
        result = self._delete("/v2/orders")
        return result if isinstance(result, list) else []

    def close_position(self, symbol: str) -> Dict[str, Any]:
        return self._delete(f"/v2/positions/{symbol.upper()}")

    def get_position(self, symbol: str) -> Dict[str, Any]:
        return self._get(f"/v2/positions/{symbol.upper()}")

    def get_order(self, order_id: str) -> Dict[str, Any]:
        return self._get(f"/v2/orders/{order_id}")

    def get_order_by_client_id(self, client_order_id: str) -> Dict[str, Any]:
        return self._get(f"/v2/orders:by_client_order_id?client_order_id={client_order_id}")

    def modify_order(
        self,
        order_id: str,
        qty: Optional[float] = None,
        limit_price: Optional[float] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if qty is not None:
            payload["qty"] = str(round(qty, 6))
        if limit_price is not None:
            payload["limit_price"] = str(round(limit_price, 2))
        r = httpx.patch(self._base + f"/v2/orders/{order_id}", headers=self._headers, json=payload, timeout=10)
        r.raise_for_status()
        return r.json()

    def list_orders(self, status: str = "open", limit: int = 50) -> List[Dict[str, Any]]:
        result = self._get(f"/v2/orders?status={status}&limit={limit}")
        return result if isinstance(result, list) else []

    def get_account_configurations(self) -> Dict[str, Any]:
        return self._get("/v2/account/configurations")

    def patch_account_configurations(self, **kwargs: Any) -> Dict[str, Any]:
        r = httpx.patch(self._base + "/v2/account/configurations", headers=self._headers, json=kwargs, timeout=10)
        r.raise_for_status()
        return r.json()

    def get_portfolio_history(
        self,
        period: str = "1M",
        timeframe: str = "1D",
        extended_hours: bool = False,
    ) -> Dict[str, Any]:
        params = f"period={period}&timeframe={timeframe}&extended_hours={'true' if extended_hours else 'false'}"
        return self._get(f"/v2/account/portfolio/history?{params}")

    def get_account_activities(
        self,
        activity_type: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        path = "/v2/account/activities"
        if activity_type:
            path += f"/{activity_type}"
        path += f"?page_size={limit}"
        result = self._get(path)
        return result if isinstance(result, list) else []

    def _get(self, path: str) -> Any:
        r = httpx.get(self._base + path, headers=self._headers, timeout=10)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: Dict) -> Any:
        r = httpx.post(self._base + path, headers=self._headers, json=body, timeout=10)
        r.raise_for_status()
        return r.json()

    def _delete(self, path: str) -> Any:
        r = httpx.delete(self._base + path, headers=self._headers, timeout=10)
        r.raise_for_status()
        try:
            return r.json()
        except Exception:
            return {}


# ── Keychain helpers ──────────────────────────────────────────────────────────

def get_broker_from_keychain(mode: Optional[str] = None) -> Optional[AlpacaBroker]:
    """
    Load credentials from OS keychain.
    mode='paper' | 'live' selects a specific credential set.
    If None, uses live credentials when configured, else paper.
    """
    try:
        from services.secret_store import get_alpaca_credentials, get_alpaca_credentials_for_mode
        creds = get_alpaca_credentials_for_mode(mode) if mode else get_alpaca_credentials()
        if not creds.get("api_key") or not creds.get("secret_key"):
            return None
        return AlpacaBroker(
            api_key=creds["api_key"],
            secret_key=creds["secret_key"],
            mode=creds.get("mode", "paper"),
        )
    except Exception:
        return None


def is_alpaca_configured() -> bool:
    try:
        from services.secret_store import get_alpaca_secret_status
        return bool(get_alpaca_secret_status().get("configured"))
    except Exception:
        return False


# ── Position helpers ──────────────────────────────────────────────────────────

def _is_direct_short(paper_trade) -> bool:
    """
    True when signal_type is SHORT but execution_ticker == underlying,
    meaning no inverse ETF was mapped and a real short-sell is required.
    """
    return (
        str(getattr(paper_trade, "signal_type", "")).upper() == "SHORT"
        and str(getattr(paper_trade, "execution_ticker", "")).upper()
        == str(getattr(paper_trade, "underlying", "")).upper()
    )


def _has_live_open_order(db, paper_trade_id) -> bool:
    """
    Return True if a non-error AlpacaOrder exists for this paper trade, meaning
    the open leg was actually submitted to Alpaca (regardless of fill status).
    Error-status rows indicate a skipped/failed open (e.g. short selling disabled,
    circuit breaker fired) — those should not trigger a close.
    """
    if paper_trade_id is None:
        return False
    from database.models import AlpacaOrder
    return (
        db.query(AlpacaOrder)
        .filter(
            AlpacaOrder.paper_trade_id == paper_trade_id,
            AlpacaOrder.status != "error",
        )
        .first()
    ) is not None


def _is_extended_hours_now(config=None) -> bool:
    """Return True during Alpaca-supported pre/post-market windows when enabled."""
    from datetime import time as time_cls
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
    now_et = datetime.now(_ET)
    if now_et.weekday() >= 5:
        return False
    t = now_et.time()
    allow_ext = True
    if config is not None:
        allow_ext = bool(getattr(config, "allow_extended_hours_trading", True))
    if not allow_ext:
        return False
    reg_open  = time_cls(9, 30)
    reg_close = time_cls(16, 0)
    ext_open  = time_cls(4, 0)
    ext_close = time_cls(20, 0)
    return ext_open <= t < reg_open or reg_close < t <= ext_close


# ── Circuit breakers ──────────────────────────────────────────────────────────

def _get_alpaca_live_open_exposure(broker: "AlpacaBroker") -> Optional[float]:
    """Sum |market_value| of all open live positions. Returns None on error."""
    try:
        positions = broker.get_positions()
        return sum(abs(float(p.get("market_value") or 0)) for p in positions)
    except Exception as exc:
        print(f"[alpaca] could not fetch live positions for exposure check: {exc}")
        return None


def _get_alpaca_live_daily_pnl(broker: "AlpacaBroker") -> Optional[float]:
    """Return today's P&L from the live account (equity − last_equity). Returns None on error."""
    try:
        account = broker.get_account()
        equity = float(account.get("equity") or 0)
        last_equity = float(account.get("last_equity") or 0)
        return equity - last_equity
    except Exception as exc:
        print(f"[alpaca] could not fetch account for daily P&L check: {exc}")
        return None


def _get_alpaca_live_recent_pnls(db, n: int) -> Optional[List[float]]:
    """Return P&L for the last n completed live round-trips from AlpacaOrder records.

    Returns None on error (caller skips the check). Returns a short list if
    fewer than n round-trips have been completed — the caller handles that.
    """
    from database.models import AlpacaOrder

    _epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    try:
        orders = (
            db.query(AlpacaOrder)
            .filter(
                AlpacaOrder.trading_mode == "live",
                AlpacaOrder.status == "filled",
                AlpacaOrder.filled_avg_price.isnot(None),
                AlpacaOrder.filled_qty.isnot(None),
                AlpacaOrder.paper_trade_id.isnot(None),
            )
            .all()
        )
        by_trade: Dict[int, List] = {}
        for o in orders:
            by_trade.setdefault(o.paper_trade_id, []).append(o)

        completed: List[tuple] = []
        for trade_orders in by_trade.values():
            buys = [o for o in trade_orders if o.side == "buy"]
            sells = [o for o in trade_orders if o.side == "sell"]
            if not (buys and sells):
                continue
            buy = max(buys, key=lambda o: o.filled_at or _epoch)
            sell = max(sells, key=lambda o: o.filled_at or _epoch)
            qty = min(float(buy.filled_qty), float(sell.filled_qty))
            if qty <= 0:
                continue
            pnl = (float(sell.filled_avg_price) - float(buy.filled_avg_price)) * qty
            close_time = max(buy.filled_at or _epoch, sell.filled_at or _epoch)
            completed.append((close_time, pnl))

        completed.sort(key=lambda x: x[0], reverse=True)
        return [pnl for _, pnl in completed[:n]]
    except Exception as exc:
        print(f"[alpaca] could not compute live consecutive P&L: {exc}")
        return None


def _check_circuit_breakers(db, config, pending_notional: float = 0.0) -> None:
    """
    Raise CircuitBreakerError and auto-disable live trading if a limit is breached.
    Checks: max total open exposure, daily loss limit, consecutive loss streak.

    In live mode every check reads from the real Alpaca account / AlpacaOrder
    audit table. In paper/sim mode every check reads from the PaperTrade ledger.
    The two data sources are never mixed.

    pending_notional: notional of the order about to be placed; added to the
    current open exposure so a single order cannot overshoot the configured max.
    """
    from database.models import PaperTrade

    is_live = getattr(config, "alpaca_execution_mode", None) == "live"
    live_broker = get_broker_from_keychain(mode="live") if is_live else None

    # ── Max total open exposure ──────────────────────────────────────────────
    max_exposure = getattr(config, "alpaca_max_total_exposure_usd", None)
    if max_exposure and max_exposure > 0:
        if is_live:
            if live_broker is None:
                print("[alpaca] exposure check: no live broker configured, skipping")
            else:
                live_exposure = _get_alpaca_live_open_exposure(live_broker)
                if live_exposure is None:
                    print("[alpaca] exposure check: live position fetch failed, skipping")
                else:
                    open_exposure = live_exposure + pending_notional
                    if open_exposure >= max_exposure:
                        _disable_live_trading(db, config, f"max total exposure ${max_exposure:.0f} reached (current ${open_exposure:.0f})")
                        raise CircuitBreakerError(f"Max total exposure ${max_exposure:.0f} reached")
        else:
            open_exposure = (
                sum(float(t.amount or 0) for t in db.query(PaperTrade).filter(PaperTrade.exited_at.is_(None)).all())
                + pending_notional
            )
            if open_exposure >= max_exposure:
                _disable_live_trading(db, config, f"max total exposure ${max_exposure:.0f} reached (current ${open_exposure:.0f})")
                raise CircuitBreakerError(f"Max total exposure ${max_exposure:.0f} reached")

    # ── Daily loss limit ─────────────────────────────────────────────────────
    daily_limit = getattr(config, "alpaca_daily_loss_limit_usd", None)
    if daily_limit and daily_limit > 0:
        if is_live:
            if live_broker is None:
                print("[alpaca] daily loss check: no live broker configured, skipping")
            else:
                today_pnl = _get_alpaca_live_daily_pnl(live_broker)
                if today_pnl is None:
                    print("[alpaca] daily loss check: account fetch failed, skipping")
                elif today_pnl <= -daily_limit:
                    _disable_live_trading(db, config, f"daily loss limit ${daily_limit:.0f} hit (P&L ${today_pnl:.2f})")
                    raise CircuitBreakerError(f"Daily loss limit ${daily_limit:.0f} hit")
        else:
            today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            today_pnl = sum(
                float(t.realized_pnl or 0)
                for t in db.query(PaperTrade)
                .filter(PaperTrade.exited_at >= today_start, PaperTrade.realized_pnl.isnot(None))
                .all()
            )
            if today_pnl <= -daily_limit:
                _disable_live_trading(db, config, f"daily loss limit ${daily_limit:.0f} hit (P&L ${today_pnl:.2f})")
                raise CircuitBreakerError(f"Daily loss limit ${daily_limit:.0f} hit")

    # ── Consecutive loss streak ──────────────────────────────────────────────
    max_consec = getattr(config, "alpaca_max_consecutive_losses", None)
    if max_consec and max_consec > 0:
        if is_live:
            recent_pnls = _get_alpaca_live_recent_pnls(db, max_consec)
            if recent_pnls is None:
                print("[alpaca] consecutive loss check: could not compute live P&L, skipping")
            elif len(recent_pnls) >= max_consec and all(pnl < 0 for pnl in recent_pnls):
                _disable_live_trading(db, config, f"{max_consec} consecutive losses")
                raise CircuitBreakerError(f"{max_consec} consecutive losses reached")
        else:
            recent = (
                db.query(PaperTrade)
                .filter(PaperTrade.exited_at.isnot(None), PaperTrade.realized_pnl.isnot(None))
                .order_by(PaperTrade.exited_at.desc())
                .limit(max_consec)
                .all()
            )
            if len(recent) >= max_consec and all(float(t.realized_pnl or 0) < 0 for t in recent):
                _disable_live_trading(db, config, f"{max_consec} consecutive losses")
                raise CircuitBreakerError(f"{max_consec} consecutive losses reached")


def _disable_live_trading(db, config, reason: str) -> None:
    try:
        config.alpaca_execution_mode = "off"
        config.alpaca_live_trading_enabled = False
        db.add(config)
        db.commit()
        print(f"[alpaca] CIRCUIT BREAKER — live trading auto-disabled: {reason}")
    except Exception as exc:
        print(f"[alpaca] failed to auto-disable live trading: {exc}")
    # Best-effort cancel all open orders so no in-flight exposure remains
    try:
        broker = get_broker_from_keychain(mode="live")
        if broker:
            cancelled = broker.cancel_all_orders()
            if cancelled:
                print(f"[alpaca] circuit breaker: cancelled {len(cancelled)} open order(s)")
    except Exception as exc:
        print(f"[alpaca] circuit breaker: cancel_all_orders failed (non-fatal): {exc}")


# ── DB record helpers ─────────────────────────────────────────────────────────

def _record_alpaca_order(
    db,
    paper_trade_id: Optional[int],
    side: str,
    symbol: str,
    notional: Optional[float],
    qty: Optional[float],
    response: Dict[str, Any],
    trading_mode: str,
    extended_hours: bool = False,
    limit_price: Optional[float] = None,
) -> None:
    from database.models import AlpacaOrder
    from sqlalchemy.exc import IntegrityError

    def _parse_dt(raw: Any) -> Optional[datetime]:
        if not raw:
            return None
        try:
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except Exception:
            return None

    order = AlpacaOrder(
        paper_trade_id   = paper_trade_id,
        alpaca_order_id  = response.get("id"),
        client_order_id  = response.get("client_order_id"),
        symbol           = symbol.upper(),
        side             = side,
        notional         = notional,
        qty              = qty or (float(response.get("qty") or 0) or None),
        order_type       = response.get("type", "market"),
        time_in_force    = response.get("time_in_force", "day"),
        limit_price      = limit_price,
        extended_hours   = extended_hours,
        status           = response.get("status"),
        filled_qty       = float(response.get("filled_qty") or 0) or None,
        filled_avg_price = float(response.get("filled_avg_price") or 0) or None,
        submitted_at     = _parse_dt(response.get("submitted_at")),
        filled_at        = _parse_dt(response.get("filled_at")),
        trading_mode     = trading_mode,
        raw_response     = response,
    )
    try:
        db.add(order)
        db.commit()
    except IntegrityError:
        db.rollback()


def _record_alpaca_order_error(
    db,
    paper_trade_id: Optional[int],
    side: str,
    symbol: str,
    notional: Optional[float],
    error_msg: str,
    trading_mode: str,
    client_order_id: Optional[str] = None,
) -> None:
    from database.models import AlpacaOrder
    order = AlpacaOrder(
        paper_trade_id  = paper_trade_id,
        client_order_id = client_order_id,
        symbol          = symbol.upper(),
        side            = side,
        notional        = notional,
        status          = "error",
        trading_mode    = trading_mode,
        error_message   = error_msg,
    )
    try:
        db.add(order)
        db.commit()
    except Exception:
        db.rollback()


# ── Main hook ─────────────────────────────────────────────────────────────────

def maybe_execute_alpaca_order(db, paper_trade, event: str, config) -> None:
    """
    Optionally route a paper trade open/close to Alpaca.
    event: "open" | "close"
    Never raises — all failures are logged to alpaca_orders and printed.
    """
    execution_mode = str(getattr(config, "alpaca_execution_mode", "off") or "off").strip().lower()
    if execution_mode not in {"paper", "live"}:
        return

    broker = get_broker_from_keychain(mode=execution_mode)
    if broker is None:
        return

    symbol       = str(getattr(paper_trade, "execution_ticker", "") or getattr(paper_trade, "underlying", "")).upper()
    signal_type  = str(getattr(paper_trade, "signal_type", "LONG")).upper()
    notional     = float(getattr(paper_trade, "amount", 100.0) or 100.0)
    shares       = float(getattr(paper_trade, "shares", 0.0) or 0.0)
    entry_price  = float(getattr(paper_trade, "entry_price", 0.0) or 0.0)
    paper_id     = getattr(paper_trade, "id", None)
    direct_short = _is_direct_short(paper_trade)
    allow_short  = bool(getattr(config, "alpaca_allow_short_selling", False))

    # ── Determine Alpaca side ────────────────────────────────────────────────
    if event == "open":
        if direct_short:
            if not allow_short:
                print(f"[alpaca] skipping direct short on {symbol}: alpaca_allow_short_selling disabled")
                _record_alpaca_order_error(
                    db, paper_id, "sell", symbol, notional,
                    f"short selling disabled; no inverse ETF mapped for {symbol}",
                    broker.mode,
                )
                return
            side = "sell"   # real Alpaca short-sell
        else:
            side = "buy"    # long, or buying the inverse ETF for a short signal

        try:
            _check_circuit_breakers(db, config, pending_notional=notional)
        except CircuitBreakerError as exc:
            _record_alpaca_order_error(db, paper_id, side, symbol, notional, f"circuit breaker: {exc}", broker.mode)
            return

        max_pos = getattr(config, "alpaca_max_position_usd", None)
        if max_pos and max_pos > 0:
            notional = min(notional, max_pos)

    elif event == "close":
        # Guard: only close if a live open order was actually placed for this trade.
        # A skipped or failed open (direct short disabled, circuit breaker, etc.)
        # produces only an error row, so _has_live_open_order returns False and we
        # skip — preventing a stray close order from creating unintended exposure.
        if not _has_live_open_order(db, paper_id):
            print(
                f"[alpaca] skipping close for {symbol} (paper_id={paper_id}): "
                "no successful open order on record"
            )
            return
        # Closing a direct short means buying back to cover; everything else is a sell
        side = "buy" if direct_short else "sell"
    else:
        return

    # ── Build order parameters ───────────────────────────────────────────────
    ext_hours  = _is_extended_hours_now(config)
    slippage   = float(getattr(config, "alpaca_limit_slippage_pct", 0.002) or 0.002)
    limit_price: Optional[float] = None
    qty:         Optional[float] = None
    use_notional: Optional[float] = None
    order_type = str(getattr(config, "alpaca_order_type", "market") or "market")
    time_in_force = "day"

    if ext_hours:
        # Pre/post-market: Alpaca requires explicit extended_hours + limit + qty.
        if shares > 0:
            qty = shares
        elif entry_price > 0:
            qty = round(notional / entry_price, 6)
        else:
            _record_alpaca_order_error(
                db, paper_id, side, symbol, notional,
                "extended hours order skipped: no price for qty calculation",
                broker.mode,
            )
            return
        limit_price = round(
            entry_price * (1 + slippage) if side == "buy" else entry_price * (1 - slippage),
            2,
        )
        limit_price = max(0.01, limit_price)
        order_type = "limit"
    elif event == "close":
        # Prefer the live Alpaca position qty so the close exactly matches what
        # Alpaca holds (handles partial fills, manual adjustments, etc.).
        live_qty: Optional[float] = None
        try:
            pos_data = broker.get_position(symbol)
            raw_q = pos_data.get("qty") or pos_data.get("available_shares")
            if raw_q is not None:
                live_qty = abs(float(raw_q))
        except Exception as _pos_exc:
            print(f"[alpaca] get_position({symbol}) failed, falling back to paper shares: {_pos_exc}")
        if live_qty and live_qty > 0:
            qty = live_qty
        elif shares > 0:
            qty = shares
        else:
            use_notional = notional  # last-resort fallback
    else:
        use_notional = notional

    client_order_id = f"gr-{paper_id}-{event[:1]}-{int(_time.time())}"

    try:
        response = broker.place_order(
            symbol          = symbol,
            side            = side,
            notional        = use_notional,
            qty             = qty,
            order_type      = order_type,
            time_in_force   = time_in_force,
            limit_price     = limit_price,
            extended_hours  = ext_hours,
            client_order_id = client_order_id,
        )
        _record_alpaca_order(
            db, paper_id, side, symbol, use_notional, qty,
            response, broker.mode, ext_hours, limit_price,
        )
    except Exception as exc:
        _record_alpaca_order_error(
            db, paper_id, side, symbol, use_notional or notional,
            str(exc), broker.mode, client_order_id,
        )
        print(f"[alpaca] order failed (non-fatal): {exc}")


# ── Fill polling ──────────────────────────────────────────────────────────────

def poll_unfilled_orders(db) -> int:
    """
    Query Alpaca for the current status of any pending (non-terminal) orders
    and update the alpaca_orders rows. Returns count of rows updated.
    For rows missing alpaca_order_id (e.g. response lost), falls back to
    get_order_by_client_id to recover the Alpaca order ID.
    """
    from database.models import AlpacaOrder

    broker = get_broker_from_keychain(mode="live")
    if broker is None:
        return 0

    pending = (
        db.query(AlpacaOrder)
        .filter(
            AlpacaOrder.filled_at.is_(None),
            AlpacaOrder.status.notin_(list(_TERMINAL_STATUSES)),
            AlpacaOrder.error_message.is_(None),
        )
        .all()
    )

    updated = 0
    for order in pending:
        try:
            if order.alpaca_order_id:
                data = broker.get_order(order.alpaca_order_id)
            elif order.client_order_id:
                # Fallback: recover order ID via our own client_order_id
                data = broker.get_order_by_client_id(order.client_order_id)
                recovered_id = data.get("id")
                if recovered_id:
                    order.alpaca_order_id = recovered_id
            else:
                continue

            new_status = data.get("status")
            if not new_status or new_status == order.status:
                continue
            order.status           = new_status
            order.filled_qty       = float(data.get("filled_qty") or 0) or None
            order.filled_avg_price = float(data.get("filled_avg_price") or 0) or None
            raw_filled = data.get("filled_at")
            if raw_filled:
                try:
                    order.filled_at = datetime.fromisoformat(str(raw_filled).replace("Z", "+00:00"))
                except Exception:
                    pass
            order.raw_response = data
            updated += 1
        except Exception as exc:
            oid = order.alpaca_order_id or order.client_order_id or order.id
            print(f"[alpaca] poll: order {oid} error: {exc}")

    if updated:
        db.commit()
    return updated


# ── Startup reconciliation ────────────────────────────────────────────────────

def reconcile_on_startup(db) -> None:
    """
    Compare open AlpacaOrder rows (no filled_at, non-terminal) against live
    Alpaca positions. Logs any orphans — positions open in our DB but absent
    from Alpaca. Does NOT auto-close anything; operator must intervene.
    """
    from database.models import AlpacaOrder

    broker = get_broker_from_keychain(mode="live")
    if broker is None:
        return

    try:
        positions   = broker.get_positions()
        alpaca_syms = {p.get("symbol", "").upper() for p in positions}
    except Exception as exc:
        print(f"[alpaca] reconcile_on_startup: failed to fetch positions: {exc}")
        return

    open_buy_orders = (
        db.query(AlpacaOrder)
        .filter(
            AlpacaOrder.filled_at.is_(None),
            AlpacaOrder.status.notin_(list(_TERMINAL_STATUSES)),
            AlpacaOrder.side == "buy",
        )
        .all()
    )

    for order in open_buy_orders:
        if order.symbol not in alpaca_syms:
            print(
                f"[alpaca] ORPHAN: {order.symbol} is open in our DB "
                f"(AlpacaOrder id={order.id}, alpaca_order_id={order.alpaca_order_id}) "
                f"but NOT found in Alpaca {broker.mode} positions. Manual review required."
            )
