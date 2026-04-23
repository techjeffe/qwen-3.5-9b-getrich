"""
Configuration API router.
"""

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from database.engine import get_db
from database.models import (
    AnalysisResult, Post, PriceHistory, ScrapedArticle, Trade, TradeClose, TradeExecution,
    TradeSnapshot, TradingSignal,
)
from security import require_admin_token
from services.app_config import (
    config_to_dict_with_stats,
    get_or_create_app_config,
    update_app_config,
)
from services.ollama import get_ollama_status
from services.paper_trading import close_positions_for_removed_symbols


router = APIRouter()


@router.get("/config", tags=["Config"])
async def get_config(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    config = get_or_create_app_config(db)
    payload = config_to_dict_with_stats(db, config)
    try:
        ollama = get_ollama_status(timeout=3)
        payload["available_models"] = ollama.get("available_models") or []
    except Exception:
        payload["available_models"] = []
    return payload


def _pull_history_background(symbols: List[str]) -> None:
    """Pull price history for newly added symbols in a fresh DB session."""
    from database.engine import SessionLocal
    from services.data_ingestion.yfinance_client import PriceClient
    db = SessionLocal()
    try:
        client = PriceClient()
        client.pull_and_store_history(symbols=symbols, db=db, delay_seconds=1.0)
    except Exception as exc:
        print(f"Background price-history pull error: {exc}")
    finally:
        db.close()


@router.put("/config", tags=["Config"])
async def put_config(
    payload: Dict[str, Any],
    background_tasks: BackgroundTasks,
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    existing_config = get_or_create_app_config(db)
    previous_custom_symbols = {
        str(symbol or "").upper().strip()
        for symbol in (getattr(existing_config, "custom_symbols", []) or [])
        if str(symbol or "").strip()
    }
    config = update_app_config(db, payload)
    current_custom_symbols = {
        str(symbol or "").upper().strip()
        for symbol in (getattr(config, "custom_symbols", []) or [])
        if str(symbol or "").strip()
    }
    added_custom_symbols = sorted(current_custom_symbols - previous_custom_symbols)
    removed_custom_symbols = sorted(previous_custom_symbols - current_custom_symbols)
    notices: List[str] = []
    if removed_custom_symbols:
        closed_positions = close_positions_for_removed_symbols(db, removed_custom_symbols)
        if closed_positions:
            closed_underlyings = sorted({str(item.get("underlying") or "").upper() for item in closed_positions if item.get("underlying")})
            symbol_list = ", ".join(closed_underlyings)
            noun = "paper trade was" if len(closed_underlyings) == 1 else "paper trades were"
            notices.append(f"Removed custom symbol{'' if len(closed_underlyings) == 1 else 's'} {symbol_list}; matching open {noun} closed.")
    if added_custom_symbols:
        background_tasks.add_task(_pull_history_background, added_custom_symbols)
        notices.append(f"Pulling price history for {', '.join(added_custom_symbols)} in the background.")
    response = config_to_dict_with_stats(db, config)
    if notices:
        response["notices"] = notices
    return response


@router.post("/admin/reset-data", tags=["Admin"])
async def reset_data(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Wipe all analysis, trade, and post data while preserving app config.
    Deletion order respects FK constraints (children before parents).
    """
    counts: Dict[str, int] = {}
    for model in (TradeClose, TradeExecution, TradeSnapshot, TradingSignal, Trade, AnalysisResult, ScrapedArticle, Post):
        deleted = db.query(model).delete(synchronize_session=False)
        counts[model.__tablename__] = deleted

    # Clear last-run metadata so the dashboard doesn't think a stale run is current
    config = get_or_create_app_config(db)
    config.last_analysis_started_at = None
    config.last_analysis_completed_at = None
    config.last_analysis_request_id = None
    config.analysis_lock_request_id = None
    config.analysis_lock_acquired_at = None
    config.analysis_lock_expires_at = None
    db.add(config)
    db.commit()

    total = sum(counts.values())
    return {"ok": True, "deleted": counts, "total_rows_deleted": total}


@router.get("/admin/price-history/status", tags=["Admin"])
async def price_history_status(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Return per-symbol row counts and date ranges for all stored price history."""
    from sqlalchemy import func, distinct
    config = get_or_create_app_config(db)
    tracked: set = set(config.tracked_symbols or ["USO", "BITO", "QQQ", "SPY"])

    # All symbols with stored history (including previously removed ones)
    stored_symbols = [
        row[0] for row in db.query(distinct(PriceHistory.symbol)).all()
    ]
    symbols = sorted(tracked | set(stored_symbols))

    per_symbol: Dict[str, Any] = {}
    for symbol in symbols:
        q = db.query(PriceHistory).filter(PriceHistory.symbol == symbol)
        count = q.count()
        if count > 0:
            earliest = q.order_by(PriceHistory.date.asc()).first().date
            latest   = q.order_by(PriceHistory.date.desc()).first().date
        else:
            earliest = latest = None
        per_symbol[symbol] = {
            "rows": count,
            "earliest_date": earliest,
            "latest_date": latest,
            "ready": count >= 200,
            "tracked": symbol in tracked,
        }

    return {
        "symbols": per_symbol,
        "total_rows": sum(v["rows"] for v in per_symbol.values()),
        "all_ready": all(v["ready"] for v in per_symbol.values() if v["tracked"]),
    }


@router.post("/admin/price-history/pull", tags=["Admin"])
async def pull_price_history(
    payload: Optional[Dict[str, Any]] = None,
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Pull historical OHLCV for all tracked symbols from yfinance (slow, resumable)."""
    from services.data_ingestion.yfinance_client import PriceClient

    config  = get_or_create_app_config(db)
    symbols: List[str] = list(config.tracked_symbols or ["USO", "BITO", "QQQ", "SPY"])
    if payload and payload.get("symbols"):
        symbols = [str(s).upper().strip() for s in payload["symbols"] if s]
    delay = float((payload or {}).get("delay_seconds", 3.0))

    client  = PriceClient()
    results = await asyncio.to_thread(
        client.pull_and_store_history,
        symbols=symbols,
        db=db,
        delay_seconds=delay,
    )

    total_rows    = sum(r.get("rows", 0) for r in results.values())
    rate_limited  = any(r.get("status") == "rate_limited" for r in results.values())

    return {
        "ok": not rate_limited,
        "rate_limited": rate_limited,
        "symbols": results,
        "total_rows_added": total_rows,
    }
