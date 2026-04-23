"""
Configuration API router.
"""

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.engine import get_db
from database.models import (
    AnalysisResult, Post, PriceHistory, Trade, TradeClose, TradeExecution,
    TradeSnapshot, TradingSignal,
)
from security import require_admin_token
from services.app_config import (
    config_to_dict_with_stats,
    get_or_create_app_config,
    update_app_config,
)
from services.ollama import get_ollama_status


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


@router.put("/config", tags=["Config"])
async def put_config(
    payload: Dict[str, Any],
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    config = update_app_config(db, payload)
    return config_to_dict_with_stats(db, config)


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
    for model in (TradeClose, TradeExecution, TradeSnapshot, TradingSignal, Trade, AnalysisResult, Post):
        deleted = db.query(model).delete(synchronize_session=False)
        counts[model.__tablename__] = deleted

    # Clear last-run metadata so the dashboard doesn't think a stale run is current
    config = get_or_create_app_config(db)
    config.last_analysis_started_at = None
    config.last_analysis_completed_at = None
    config.last_analysis_request_id = None
    db.add(config)
    db.commit()

    total = sum(counts.values())
    return {"ok": True, "deleted": counts, "total_rows_deleted": total}


@router.get("/admin/price-history/status", tags=["Admin"])
async def price_history_status(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Return per-symbol row counts and date ranges for stored price history."""
    config = get_or_create_app_config(db)
    symbols: List[str] = list(config.tracked_symbols or ["USO", "BITO", "QQQ", "SPY"])

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
        }

    return {
        "symbols": per_symbol,
        "total_rows": sum(v["rows"] for v in per_symbol.values()),
        "all_ready": all(v["ready"] for v in per_symbol.values()),
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
