"""
Alpaca brokerage admin routes.
All routes require the admin token (if ADMIN_API_TOKEN is set).
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.engine import get_db
from security import require_admin_token
from services.alpaca_broker import get_broker_from_keychain, poll_unfilled_orders
from services.app_config import get_or_create_app_config, update_app_config
from services.secret_store import (
    clear_alpaca_secrets,
    get_alpaca_secret_status,
    save_alpaca_secrets,
    get_alpaca_credentials_for_mode,
)

router = APIRouter(prefix="/alpaca", tags=["Alpaca"])


class AlpacaSecretsPayload(BaseModel):
    api_key: str
    secret_key: str
    trading_mode: str = "paper"


class AlpacaSettingsPayload(BaseModel):
    alpaca_live_trading_enabled:   Optional[bool]  = None
    alpaca_allow_short_selling:    Optional[bool]  = None
    alpaca_max_position_usd:       Optional[float] = None
    alpaca_max_total_exposure_usd: Optional[float] = None
    alpaca_order_type:             Optional[str]   = None
    alpaca_limit_slippage_pct:     Optional[float] = None
    alpaca_daily_loss_limit_usd:   Optional[float] = None
    alpaca_max_consecutive_losses: Optional[int]   = None


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def get_alpaca_status(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Key config status, live trading settings, and account info if keys are valid."""
    secret_status = get_alpaca_secret_status()
    config = get_or_create_app_config(db)

    account_info: Optional[Dict[str, Any]] = None
    if secret_status.get("live", {}).get("configured"):
        try:
            broker = get_broker_from_keychain(mode="live")
            if broker:
                account_info = broker.get_account()
        except Exception as exc:
            account_info = {"error": str(exc)}
    elif secret_status.get("paper", {}).get("configured"):
        try:
            broker = get_broker_from_keychain(mode="paper")
            if broker:
                account_info = broker.get_account()
        except Exception as exc:
            account_info = {"error": str(exc)}

    return {
        "secrets":                   secret_status,
        "live_trading_enabled":      bool(getattr(config, "alpaca_live_trading_enabled",   False)),
        "allow_short_selling":       bool(getattr(config, "alpaca_allow_short_selling",    False)),
        "max_position_usd":          getattr(config, "alpaca_max_position_usd",            None),
        "max_total_exposure_usd":    getattr(config, "alpaca_max_total_exposure_usd",      None),
        "order_type":                str(getattr(config,  "alpaca_order_type",             "market") or "market"),
        "limit_slippage_pct":        float(getattr(config, "alpaca_limit_slippage_pct",    0.002) or 0.002),
        "daily_loss_limit_usd":      getattr(config, "alpaca_daily_loss_limit_usd",        None),
        "max_consecutive_losses":    getattr(config, "alpaca_max_consecutive_losses",      3),
        "account":                   account_info,
    }


# ── Secrets ───────────────────────────────────────────────────────────────────

@router.post("/secrets")
async def save_alpaca_keys(
    payload: AlpacaSecretsPayload,
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    """Store Alpaca API key + secret in the OS keychain."""
    try:
        result = save_alpaca_secrets(payload.api_key, payload.secret_key, payload.trading_mode)
        return {"ok": True, "status": result}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.delete("/secrets")
async def clear_alpaca_keys(
    mode: Optional[str] = Query(default=None, pattern="^(paper|live)$"),
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    """Remove Alpaca API keys from the OS keychain. Pass ?mode=paper or ?mode=live to clear only one slot."""
    result = clear_alpaca_secrets(mode=mode)
    return {"ok": True, "status": result}


# ── Connection test ───────────────────────────────────────────────────────────

@router.post("/test-connection")
async def test_alpaca_connection(
    mode: Optional[str] = Query(default=None, pattern="^(paper|live)$"),
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    """Validate stored keys by calling GET /v2/account on Alpaca. Pass ?mode=paper|live to test a specific slot."""
    broker = get_broker_from_keychain(mode=mode)
    if broker is None:
        slot = f"{mode} " if mode else ""
        raise HTTPException(status_code=400, detail=f"Alpaca {slot}API keys not configured")
    try:
        account = broker.get_account()
        return {"ok": True, "mode": broker.mode, "account": account}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alpaca connection failed: {exc}")


# ── Live account / positions ──────────────────────────────────────────────────

@router.get("/account")
async def get_alpaca_account(
    mode: Optional[str] = Query(default=None, pattern="^(paper|live)$"),
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    broker = get_broker_from_keychain(mode=mode)
    if broker is None:
        slot = f" for {mode}" if mode else ""
        raise HTTPException(status_code=400, detail=f"Alpaca API keys not configured{slot}")
    try:
        account = broker.get_account()
        if isinstance(account, dict):
            account["trading_mode"] = broker.mode
        return account
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/positions")
async def get_alpaca_positions(
    mode: Optional[str] = Query(default=None, pattern="^(paper|live)$"),
    _admin: None = Depends(require_admin_token),
) -> List[Dict[str, Any]]:
    broker = get_broker_from_keychain(mode=mode)
    if broker is None:
        slot = f" for {mode}" if mode else ""
        raise HTTPException(status_code=400, detail=f"Alpaca API keys not configured{slot}")
    try:
        positions = broker.get_positions()
        for position in positions:
            if isinstance(position, dict):
                position["trading_mode"] = broker.mode
        return positions
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ── Order log ─────────────────────────────────────────────────────────────────

@router.get("/orders")
async def get_alpaca_orders(
    limit: int = 50,
    mode: Optional[str] = Query(default=None, pattern="^(paper|live)$"),
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Return recent AlpacaOrder rows from our DB (newest first)."""
    from database.models import AlpacaOrder

    query = db.query(AlpacaOrder)
    if mode:
        query = query.filter(AlpacaOrder.trading_mode == mode)
    rows = query.order_by(AlpacaOrder.created_at.desc()).limit(min(limit, 200)).all()
    return [
        {
            "id":               o.id,
            "paper_trade_id":   o.paper_trade_id,
            "alpaca_order_id":  o.alpaca_order_id,
            "symbol":           o.symbol,
            "side":             o.side,
            "notional":         o.notional,
            "qty":              o.qty,
            "order_type":       o.order_type,
            "limit_price":      o.limit_price,
            "extended_hours":   o.extended_hours,
            "status":           o.status,
            "filled_qty":       o.filled_qty,
            "filled_avg_price": o.filled_avg_price,
            "trading_mode":     o.trading_mode,
            "error_message":    o.error_message,
            "submitted_at":     o.submitted_at.isoformat() if o.submitted_at else None,
            "filled_at":        o.filled_at.isoformat()    if o.filled_at    else None,
            "created_at":       o.created_at.isoformat()   if o.created_at   else None,
        }
        for o in rows
    ]


@router.post("/poll-orders")
async def poll_orders(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Manually trigger a fill-status poll for all pending Alpaca orders."""
    updated = poll_unfilled_orders(db)
    return {"ok": True, "updated_count": updated}


# ── Settings ──────────────────────────────────────────────────────────────────

@router.put("/settings")
async def update_alpaca_settings(
    payload: AlpacaSettingsPayload,
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Update Alpaca-related AppConfig fields (guards, limits, kill switch)."""
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    config = update_app_config(db, data)
    return {
        "ok":                        True,
        "live_trading_enabled":      bool(getattr(config, "alpaca_live_trading_enabled",   False)),
        "allow_short_selling":       bool(getattr(config, "alpaca_allow_short_selling",    False)),
        "max_position_usd":          getattr(config, "alpaca_max_position_usd",            None),
        "max_total_exposure_usd":    getattr(config, "alpaca_max_total_exposure_usd",      None),
        "order_type":                str(getattr(config,  "alpaca_order_type",             "market") or "market"),
        "limit_slippage_pct":        float(getattr(config, "alpaca_limit_slippage_pct",    0.002) or 0.002),
        "daily_loss_limit_usd":      getattr(config, "alpaca_daily_loss_limit_usd",        None),
        "max_consecutive_losses":    getattr(config, "alpaca_max_consecutive_losses",      3),
    }


# ── Cancel all orders ─────────────────────────────────────────────────────────

@router.post("/cancel-all-orders")
async def cancel_all_orders(
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    """Cancel every open order on Alpaca. Wired to the circuit-breaker kill switch."""
    broker = get_broker_from_keychain()
    if broker is None:
        raise HTTPException(status_code=400, detail="Alpaca API keys not configured")
    try:
        cancelled = broker.cancel_all_orders()
        return {"ok": True, "cancelled_count": len(cancelled), "orders": cancelled}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ── Account configurations ────────────────────────────────────────────────────

@router.get("/account/configurations")
async def get_account_configurations(
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    """Return Alpaca account-level settings (e.g. shorting_enabled)."""
    broker = get_broker_from_keychain()
    if broker is None:
        raise HTTPException(status_code=400, detail="Alpaca API keys not configured")
    try:
        return broker.get_account_configurations()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ── Portfolio history ─────────────────────────────────────────────────────────

@router.get("/portfolio-history")
async def get_portfolio_history(
    period: str = "1M",
    timeframe: str = "1D",
    extended_hours: bool = False,
    mode: Optional[str] = Query(default=None, pattern="^(paper|live)$"),
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    """Return Alpaca account equity curve for the given period/timeframe."""
    broker = get_broker_from_keychain(mode=mode)
    if broker is None:
        slot = f" for {mode}" if mode else ""
        raise HTTPException(status_code=400, detail=f"Alpaca API keys not configured{slot}")
    try:
        history = broker.get_portfolio_history(period=period, timeframe=timeframe, extended_hours=extended_hours)
        if isinstance(history, dict):
            history["trading_mode"] = broker.mode
        return history
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ── Account activities ────────────────────────────────────────────────────────

@router.get("/activities")
async def get_account_activities(
    activity_type: Optional[str] = None,
    limit: int = 100,
    mode: Optional[str] = Query(default=None, pattern="^(paper|live)$"),
    _admin: None = Depends(require_admin_token),
) -> List[Dict[str, Any]]:
    """Return Alpaca account activities (fills, fees, dividends, etc.)."""
    broker = get_broker_from_keychain(mode=mode)
    if broker is None:
        slot = f" for {mode}" if mode else ""
        raise HTTPException(status_code=400, detail=f"Alpaca API keys not configured{slot}")
    try:
        activities = broker.get_account_activities(activity_type=activity_type, limit=min(limit, 500))
        for activity in activities:
            if isinstance(activity, dict):
                activity["trading_mode"] = broker.mode
        return activities
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
