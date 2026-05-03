"""
Configuration API router.
"""

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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
from services.remote_snapshot import trigger_remote_snapshot_delivery
from services.symbol_proxy_terms import generate_proxy_terms_for_symbol
from services.secret_store import (
    get_telegram_credentials,
    clear_telegram_secrets,
    get_telegram_secret_status,
    save_telegram_secrets,
)


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

async def _generate_symbol_keywords_background(symbols: List[str], model_name: str) -> None:
    """Generate/persist symbol proxy terms in a fresh DB session."""
    from database.engine import SessionLocal

    db = SessionLocal()
    try:
        config = get_or_create_app_config(db)
        symbol_proxy_terms = dict(getattr(config, "symbol_proxy_terms", {}) or {})
        for symbol in symbols:
            result = await generate_proxy_terms_for_symbol(
                symbol=symbol,
                model_name=model_name,
                force_refresh=False,
            )
            normalized_symbol = str(result.get("symbol") or symbol).upper().strip()
            terms = list(result.get("terms") or [])
            if normalized_symbol and terms:
                symbol_proxy_terms[normalized_symbol] = terms
        config.symbol_proxy_terms = symbol_proxy_terms
        db.add(config)
        db.commit()
    except Exception as exc:
        print(f"Background symbol keyword generation error: {exc}")
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
        model_name = str(getattr(config, "extraction_model", "") or "").strip()
        if model_name:
            background_tasks.add_task(_generate_symbol_keywords_background, added_custom_symbols, model_name)
            notices.append(f"Generating symbol proxy terms for {', '.join(added_custom_symbols)} in the background.")
        else:
            notices.append("Skipped symbol keyword generation because extraction model is not configured.")
    response = config_to_dict_with_stats(db, config)
    if notices:
        response["notices"] = notices
    return response


@router.post("/config/custom-symbol-keywords/refresh", tags=["Config"])
async def refresh_custom_symbol_keywords(
    payload: Dict[str, Any],
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    config = get_or_create_app_config(db)
    extraction_model = str(getattr(config, "extraction_model", "") or "").strip()
    if not extraction_model:
        raise HTTPException(status_code=400, detail="Configure extraction_model before refreshing symbol keywords.")

    custom_symbols = {
        str(symbol or "").upper().strip()
        for symbol in (getattr(config, "custom_symbols", []) or [])
        if str(symbol or "").strip()
    }
    requested_symbols = [
        str(symbol or "").upper().strip()
        for symbol in (payload.get("symbols") or [])
        if str(symbol or "").strip()
    ]
    symbols = sorted(set(requested_symbols or list(custom_symbols)))
    if not symbols:
        raise HTTPException(status_code=400, detail="No custom symbols available to refresh.")

    invalid = [symbol for symbol in symbols if symbol not in custom_symbols]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Symbols are not configured as custom: {', '.join(invalid)}")

    symbol_proxy_terms = dict(getattr(config, "symbol_proxy_terms", {}) or {})
    traces: Dict[str, Dict[str, Any]] = {}
    for symbol in symbols:
        result = await generate_proxy_terms_for_symbol(
            symbol=symbol,
            model_name=extraction_model,
            force_refresh=True,
        )
        normalized_symbol = str(result.get("symbol") or symbol).upper().strip()
        terms = list(result.get("terms") or [])
        if normalized_symbol and terms:
            symbol_proxy_terms[normalized_symbol] = terms
        traces[normalized_symbol] = dict(result.get("trace") or {})

    config.symbol_proxy_terms = symbol_proxy_terms
    db.add(config)
    db.commit()
    db.refresh(config)

    return {
        "ok": True,
        "refreshed_symbols": symbols,
        "symbol_proxy_terms": {symbol: symbol_proxy_terms.get(symbol, []) for symbol in symbols},
        "trace": traces,
    }


@router.get("/admin/remote-snapshot-secrets", tags=["Admin"])
async def get_remote_snapshot_secrets(
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    return get_telegram_secret_status()


@router.put("/admin/remote-snapshot-secrets", tags=["Admin"])
async def put_remote_snapshot_secrets(
    payload: Dict[str, Any],
    background_tasks: BackgroundTasks,
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    try:
        previous = get_telegram_credentials()
        next_bot_token = str(payload.get("bot_token") or "")
        next_chat_id = str(payload.get("chat_id") or "")
        changed = (
            str(previous.get("bot_token") or "").strip() != next_bot_token.strip()
            or str(previous.get("chat_id") or "").strip() != next_chat_id.strip()
        )
        saved = save_telegram_secrets(
            bot_token=str(payload.get("bot_token") or ""),
            chat_id=str(payload.get("chat_id") or ""),
        )
        config = get_or_create_app_config(db)
        if not bool(getattr(config, "remote_snapshot_enabled", False)):
            config.remote_snapshot_enabled = True
            db.add(config)
            db.commit()
            db.refresh(config)

        latest_analysis = (
            db.query(AnalysisResult)
            .order_by(AnalysisResult.timestamp.desc(), AnalysisResult.id.desc())
            .first()
        )
        if changed and latest_analysis and latest_analysis.request_id:
            background_tasks.add_task(trigger_remote_snapshot_delivery, latest_analysis.request_id, True)
            saved["test_delivery_started"] = True
            saved["test_delivery_request_id"] = latest_analysis.request_id
        else:
            saved["test_delivery_started"] = False
            saved["test_delivery_request_id"] = None
            if changed and not latest_analysis:
                saved["test_delivery_note"] = "No completed analysis run is available yet."
        saved["remote_snapshot_enabled"] = True
        return saved
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.delete("/admin/remote-snapshot-secrets", tags=["Admin"])
async def delete_remote_snapshot_secrets(
    _admin: None = Depends(require_admin_token),
) -> Dict[str, Any]:
    try:
        return clear_telegram_secrets()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/admin/remote-snapshot-send", tags=["Admin"])
async def send_remote_snapshot_now(
    background_tasks: BackgroundTasks,
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    latest_analysis = (
        db.query(AnalysisResult)
        .order_by(AnalysisResult.timestamp.desc(), AnalysisResult.id.desc())
        .first()
    )
    if not latest_analysis or not latest_analysis.request_id:
        raise HTTPException(status_code=400, detail="No completed analysis run is available yet.")

    background_tasks.add_task(trigger_remote_snapshot_delivery, latest_analysis.request_id, True)
    return {
        "ok": True,
        "request_id": latest_analysis.request_id,
        "message": "Remote snapshot send has been queued.",
    }


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
    config.last_remote_snapshot_sent_at = None
    config.last_remote_snapshot_request_id = None
    config.last_remote_snapshot_net_pnl = None
    config.last_remote_snapshot_recommendation_fingerprint = None
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
