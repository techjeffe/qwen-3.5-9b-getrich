"""
Analysis API Router
Implements the /analyze and /analyze/stream endpoints
"""

import uuid
import json
import time
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import List, Dict, Any, Optional, AsyncGenerator, Tuple
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    SentimentScore,
    TradingSignal,
    RedTeamReview,
    RedTeamDebug,
    RedTeamSignalChange,
    BacktestResults,
    ModelInputDebug,
    ModelInputArticle,
)
from database.engine import get_db, SessionLocal
from database.models import Post, AnalysisResult, Trade, TradeSnapshot, TradeExecution, TradeClose, TradingSignal as TradingSignalModel
from security import require_admin_token
from services.data_ingestion.scraper import TruthSocialScraper
from services.data_ingestion.parser import RSSFeedParser
from services.data_ingestion.yfinance_client import PriceClient
from services.data_ingestion.market_validation import MarketValidationClient
from services.ollama import get_ollama_status
from services.sentiment.engine import SentimentEngine
from services.sentiment.prompts import (
    get_symbol_specialist_focus,
    format_symbol_specialist_context_prompt,
    expand_proxy_terms_for_matching,
    normalize_text_for_matching,
    format_red_team_review_prompt,
)
from services.backtesting.optimization import RollingWindowOptimizer
from services.app_config import (
    build_enabled_rss_feed_map,
    get_or_create_app_config,
    mark_analysis_started,
    mark_analysis_completed,
    resolve_rss_articles_per_feed,
    resolve_web_research_items_per_symbol,
    resolve_web_research_recency_days,
    DEFAULT_SNAPSHOT_RETENTION_LIMIT,
)
from services.pnl_tracker import PnLTracker, persist_recommendation_trades
from services.runtime_health import record_analysis_result, record_data_pull
from services.trading_instruments import build_execution_recommendation
from services.web_research import fetch_recent_symbol_web_context


router = APIRouter()

# Module-level price cache to avoid hitting yfinance on every request.
# TTL of 5 minutes matches yfinance's own guidance and keeps well under rate limits.
_price_cache: Dict[str, Any] = {}
_price_cache_ts: Dict[str, float] = {}
_PRICE_CACHE_TTL = 300  # seconds


def _resolve_price_cache_ttl(quote: Optional[Dict[str, Any]]) -> int:
    """Use shorter cache windows when the market is active or in extended-hours."""
    if not quote:
        return _PRICE_CACHE_TTL
    session = str(quote.get("session") or "closed").lower()
    is_stale = bool(quote.get("is_stale"))
    if session in {"regular", "premarket", "postmarket"} and not is_stale:
        return 30
    if session in {"regular", "premarket", "postmarket"}:
        return 90
    return _PRICE_CACHE_TTL


def _utc_iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _format_recommendation_text(rec: Optional[Dict[str, Any]]) -> str:
    if not rec:
        return "No recommendation"
    action = str(rec.get("action", "") or "").upper().strip()
    symbol = str(rec.get("symbol", "") or "").upper().strip()
    leverage = str(rec.get("leverage", "") or "").strip()
    if not action and not symbol:
        return "No recommendation"
    parts = [part for part in [action, symbol, leverage] if part]
    return " ".join(parts)


def _recommendations_by_underlying(signal: Optional[TradingSignal]) -> Dict[str, Dict[str, Any]]:
    recs: Dict[str, Dict[str, Any]] = {}
    for rec in (getattr(signal, "recommendations", None) or []):
        key = str(rec.get("underlying_symbol") or rec.get("symbol") or "").upper().strip()
        if key:
            recs[key] = rec
    return recs


def _build_red_team_signal_changes(
    blue_team_signal: Optional[TradingSignal],
    consensus_signal: Optional[TradingSignal],
    red_team_review: Optional[RedTeamReview],
) -> List[RedTeamSignalChange]:
    blue_map = _recommendations_by_underlying(blue_team_signal)
    consensus_map = _recommendations_by_underlying(consensus_signal)
    review_map = {
        str(review.symbol or "").upper().strip(): review
        for review in (red_team_review.symbol_reviews if red_team_review else [])
        if str(review.symbol or "").strip()
    }
    symbols = sorted(set(blue_map.keys()) | set(consensus_map.keys()) | set(review_map.keys()))
    changes: List[RedTeamSignalChange] = []

    for symbol in symbols:
        blue_text = _format_recommendation_text(blue_map.get(symbol))
        consensus_text = _format_recommendation_text(consensus_map.get(symbol))
        changed = blue_text != consensus_text
        review = review_map.get(symbol)
        if blue_text == "No recommendation" and consensus_text != "No recommendation":
            change_type = "added"
        elif blue_text != "No recommendation" and consensus_text == "No recommendation":
            change_type = "removed"
        elif changed:
            blue_action = str((blue_map.get(symbol) or {}).get("action", "") or "").upper()
            consensus_action = str((consensus_map.get(symbol) or {}).get("action", "") or "").upper()
            blue_leverage = str((blue_map.get(symbol) or {}).get("leverage", "") or "")
            consensus_leverage = str((consensus_map.get(symbol) or {}).get("leverage", "") or "")
            change_type = "direction_flip" if blue_action and consensus_action and blue_action != consensus_action else (
                "leverage_change" if blue_leverage != consensus_leverage else "ticker_change"
            )
        else:
            change_type = "unchanged"

        changes.append(
            RedTeamSignalChange(
                symbol=symbol,
                blue_team_recommendation=blue_text,
                consensus_recommendation=consensus_text,
                changed=changed,
                change_type=change_type,
                rationale=str(getattr(review, "rationale", "") or ""),
                evidence=list(getattr(review, "evidence", []) or []),
            )
        )

    return changes

SYMBOL_RELEVANCE_TERMS: Dict[str, List[str]] = {
    "USO": [
        # Commodity and supply terms
        "oil", "crude", "gasoline", "distillate", "refinery", "opec", "energy",
        "barrel", "petroleum", "diesel", "brent", "wti", "tanker", "pipeline",
        "natural gas", "lng", "shale", "fracking", "shipping lane",
        "supply disruption", "crude export", "crude imports", "oilfield",
        # Geo-political terms that are OIL-SPECIFIC — not country names alone,
        # which would pull in all geopolitical news regardless of oil relevance
        "strait of hormuz", "oil sanction", "energy sanction", "oil supply",
        "oil production", "oil export", "oil shipment", "energy supply",
        "hormuz", "hormuz shipping", "hormuz transit",
        "opec cut", "opec quota", "output cut", "production cut",
        "russia oil", "iran oil", "iranian oil", "venezuela oil",
    ],
    "BITO": [
        "bitcoin", "btc", "crypto", "cryptocurrency", "blockchain",
        "stablecoin", "defi", "nft", "altcoin", "ethereum", "eth",
        "sec crypto", "cftc crypto", "crypto regulation", "crypto etf",
        "digital asset", "mining", "halving", "satoshi",
        "m2", "liquidity", "dollar strength",
    ],
    "QQQ": [
        "tech", "technology", "ai", "artificial intelligence", "semiconductor",
        "chip", "software", "nasdaq", "megacap", "cloud", "data center",
        "apple", "microsoft", "nvidia", "google", "meta", "amazon",
        "antitrust", "big tech", "interest rate", "rate cut", "rate hike",
        "earnings", "valuation", "growth stock",
    ],
    "SPY": [
        "economy", "economic", "fed", "federal reserve", "rates", "inflation",
        "unemployment", "labor market", "jobs report", "earnings season",
        "credit spread", "high yield", "recession", "gdp", "growth",
        "stock market", "s&p", "dow jones", "wall street", "risk appetite",
        "tariff", "trade war", "fiscal policy",
    ],
}


@router.post("/trades/{trade_id}/execute", tags=["Analysis"])
async def record_trade_execution(
    trade_id: int,
    payload: Dict[str, Any],
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
):
    """Record the user's actual trade execution for a recommendation."""
    executed_action = str(payload.get("executed_action", "")).upper().strip()
    if executed_action not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="executed_action must be BUY or SELL")

    try:
        executed_price = float(payload.get("executed_price"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="executed_price must be a positive number")
    if executed_price <= 0:
        raise HTTPException(status_code=400, detail="executed_price must be a positive number")

    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    tracker = PnLTracker()
    execution = tracker.record_execution(
        db=db,
        trade_id=trade_id,
        executed_action=executed_action,
        executed_price=executed_price,
        notes=str(payload.get("notes", "")).strip(),
    )
    return {
        "id": execution.id,
        "trade_id": trade_id,
        "executed_action": execution.executed_action,
        "executed_price": execution.executed_price,
        "executed_at": execution.executed_at.isoformat(),
    }


@router.post("/trades/{trade_id}/close", tags=["Analysis"])
async def record_trade_close(
    trade_id: int,
    payload: Dict[str, Any],
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
):
    """Record the user's closing price for a trade, locking in realized P&L."""
    try:
        closed_price = float(payload.get("closed_price"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="closed_price must be a positive number")
    if closed_price <= 0:
        raise HTTPException(status_code=400, detail="closed_price must be a positive number")

    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    existing = db.query(TradeClose).filter(TradeClose.trade_id == trade_id).first()
    if existing:
        existing.closed_price = closed_price
        existing.notes = str(payload.get("notes", "")).strip() or None
        db.commit()
        db.refresh(existing)
        close = existing
    else:
        close = TradeClose(
            trade_id=trade_id,
            closed_price=closed_price,
            notes=str(payload.get("notes", "")).strip() or None,
        )
        db.add(close)
        db.commit()
        db.refresh(close)

    from services.pnl_tracker import calculate_return_pct, ensure_utc
    closed_return_pct = calculate_return_pct(
        action=trade.action,
        entry_price=trade.entry_price,
        exit_price=closed_price,
    )
    return {
        "id": close.id,
        "trade_id": trade_id,
        "closed_price": close.closed_price,
        "closed_at": ensure_utc(close.closed_at).isoformat(),
        "closed_return_pct": round(closed_return_pct, 4),
    }


@router.delete("/trades/{trade_id}", tags=["Analysis"])
async def delete_trade(
    trade_id: int,
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
):
    """Delete an unexecuted trade recommendation. Blocked if a user execution exists."""
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    execution = db.query(TradeExecution).filter(TradeExecution.trade_id == trade_id).first()
    if execution:
        raise HTTPException(status_code=409, detail="Cannot delete a trade that has been executed")

    db.query(TradeSnapshot).filter(TradeSnapshot.trade_id == trade_id).delete()
    db.query(TradeClose).filter(TradeClose.trade_id == trade_id).delete()
    db.delete(trade)
    db.commit()
    return {"deleted": trade_id}


@router.delete("/trades/{trade_id}/execution", tags=["Analysis"])
async def delete_trade_execution(
    trade_id: int,
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
):
    """Remove an accidental execution record, reverting the trade to unexecuted."""
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    execution = db.query(TradeExecution).filter(TradeExecution.trade_id == trade_id).first()
    if not execution:
        raise HTTPException(status_code=404, detail="No execution record found for this trade")

    db.delete(execution)
    db.commit()
    return {"deleted_execution": trade_id}


@router.get("/prices", tags=["Market Data"])
async def get_market_prices(
    symbols: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return session-aware quotes for the requested symbols, defaulting to tracked config."""
    client = PriceClient()
    config = get_or_create_app_config(db)
    requested_symbols = [
        str(symbol).upper().strip()
        for symbol in (symbols.split(",") if symbols else (config.tracked_symbols or ["USO", "BITO", "QQQ", "SPY"]))
        if str(symbol).strip()
    ]
    now = time.monotonic()
    result = {}
    symbols_to_fetch = []

    for symbol in requested_symbols:
        cached_ts = _price_cache_ts.get(symbol, 0.0)
        cache_ttl = int((_price_cache.get(symbol) or {}).get("cache_ttl_seconds") or _PRICE_CACHE_TTL)
        if symbol in _price_cache and (now - cached_ts) < cache_ttl:
            result[symbol] = _price_cache[symbol]
        else:
            symbols_to_fetch.append(symbol)

    if symbols_to_fetch:
        print(f"Fetching fresh prices from yfinance: {', '.join(symbols_to_fetch)}")
        for symbol in symbols_to_fetch:
            quote = client.get_realtime_quote(symbol)
            if not quote:
                continue
            price = quote.get("current_price") or quote.get("previous_close")
            if not price:
                continue
            prev = quote.get("previous_close") or price
            change_pct = round((price - prev) / prev * 100, 2) if prev else 0.0
            cache_ttl = _resolve_price_cache_ttl(quote)
            entry = {
                "price": round(price, 2),
                "change": round(price - prev, 2),
                "change_pct": change_pct,
                "day_low": round(quote.get("day_low") or price, 2),
                "day_high": round(quote.get("day_high") or price, 2),
                "session": quote.get("session") or "closed",
                "as_of": _utc_iso(quote.get("timestamp")),
                "source": quote.get("source") or "unknown",
                "is_stale": bool(quote.get("is_stale")),
                "cache_ttl_seconds": cache_ttl,
            }
            _price_cache[symbol] = entry
            _price_cache_ts[symbol] = now
            result[symbol] = entry

    return result


@router.get("/ollama/status", tags=["System"])
async def get_ollama_runtime_status():
    """Return reachability and active model details from Ollama."""
    try:
        return get_ollama_status()
    except Exception as exc:
        import os as _os

        return {
            "reachable": False,
            "ollama_root": _os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate").replace("/api/generate", ""),
            "configured_model": _os.getenv("OLLAMA_MODEL", "").strip(),
            "active_model": "",
            "available_models": [],
            "resolution": "unreachable",
            "error": str(exc),
        }


@router.get("/analysis-snapshots", tags=["System"])
async def list_analysis_snapshots(limit: int = 10, db: Session = Depends(get_db)):
    """List recent persisted analysis snapshots for Advanced Mode comparison."""
    config = get_or_create_app_config(db)
    retention_limit = max(1, min(100, int(getattr(config, "snapshot_retention_limit", DEFAULT_SNAPSHOT_RETENTION_LIMIT))))
    capped_limit = max(1, min(retention_limit, int(limit)))
    results = (
        db.query(AnalysisResult)
        .order_by(AnalysisResult.timestamp.desc())
        .limit(capped_limit)
        .all()
    )
    items = []
    for result in results:
        metadata = result.run_metadata or {}
        snapshot = metadata.get("dataset_snapshot") or {}
        signal_data = result.signal or {}
        trade_recommendations = []
        trade_rows = (
            db.query(Trade)
            .filter(Trade.analysis_id == result.id)
            .order_by(Trade.id.asc())
            .all()
        )
        for trade in trade_rows:
            trade_recommendations.append(
                {
                    "action": trade.action,
                    "symbol": trade.symbol,
                    "leverage": trade.leverage,
                    "underlying_symbol": trade.underlying_symbol or trade.symbol,
                }
            )
        recommendations = (
            signal_data.get("recommendations")
            or snapshot.get("trading_signal", {}).get("recommendations")
            or trade_recommendations
        )
        items.append(
            {
                "request_id": result.request_id,
                "timestamp": _utc_iso(result.timestamp),
                "model_name": metadata.get("model_name") or "",
                "extraction_model": snapshot.get("extraction_model") or "",
                "reasoning_model": snapshot.get("reasoning_model") or "",
                "risk_profile": snapshot.get("risk_profile") or metadata.get("risk_profile") or "",
                "symbols": metadata.get("symbols") or [],
                "posts_scraped": metadata.get("posts_scraped") or 0,
                "snapshot_available": bool(snapshot),
                "snapshot_article_count": len(snapshot.get("posts") or []),
                "signal_type": signal_data.get("signal_type") or "HOLD",
                "confidence_score": signal_data.get("confidence_score") or 0.0,
                "recommendations": recommendations or [],
            }
        )
    return {"items": items}


def _load_saved_analysis_response(analysis: AnalysisResult) -> AnalysisResponse:
    """Reconstruct a full analysis response from a persisted analysis row."""
    metadata = analysis.run_metadata or {}
    snapshot = metadata.get("dataset_snapshot") or {}
    sentiment_data = analysis.sentiment_data or {}
    signal_data = analysis.signal or {}
    backtest_data = analysis.backtest_results or {}
    blue_signal_data = metadata.get("blue_team_signal") or {}
    red_team_debug_payload = metadata.get("red_team_debug") or snapshot.get("red_team_debug") or {}

    sentiment_scores_payload = sentiment_data.get("sentiment_scores") or {}
    aggregated_payload = sentiment_data.get("aggregated_sentiment") or {}
    market_validation = sentiment_data.get("market_validation") or snapshot.get("market_validation") or {}
    model_inputs_payload = snapshot.get("model_inputs") or {}

    sentiment_scores = {
        symbol: SentimentScore(
            market_bluster=float((payload or {}).get("market_bluster", 0.0) or 0.0),
            policy_change=float((payload or {}).get("policy_change", 0.0) or 0.0),
            confidence=float((payload or {}).get("confidence", 0.0) or 0.0),
            reasoning=str((payload or {}).get("reasoning", "") or ""),
        )
        for symbol, payload in sentiment_scores_payload.items()
    }

    aggregated_sentiment = None
    if aggregated_payload:
        aggregated_sentiment = SentimentScore(
            market_bluster=float(aggregated_payload.get("market_bluster", 0.0) or 0.0),
            policy_change=float(aggregated_payload.get("policy_change", 0.0) or 0.0),
            confidence=float(aggregated_payload.get("confidence", 0.0) or 0.0),
            reasoning=str(aggregated_payload.get("reasoning", "") or ""),
        )

    trading_signal = TradingSignal(
        signal_type=str(signal_data.get("signal_type", "HOLD") or "HOLD"),
        confidence_score=float(signal_data.get("confidence_score", 0.0) or 0.0),
        urgency=str(signal_data.get("urgency", "LOW") or "LOW"),
        entry_symbol=str(signal_data.get("entry_symbol", "") or ""),
        recommendations=list(signal_data.get("recommendations") or []),
        conviction_level=str(signal_data.get("conviction_level", "LOW") or "LOW"),
        holding_period_hours=int(signal_data.get("holding_period_hours", 2) or 2),
        trading_type=str(signal_data.get("trading_type", "VOLATILE_EVENT") or "VOLATILE_EVENT"),
        action_if_already_in_position=str(signal_data.get("action_if_already_in_position", "HOLD") or "HOLD"),
        entry_price=signal_data.get("entry_price"),
        stop_loss_pct=float(signal_data.get("stop_loss_pct", 2.0) or 2.0),
        take_profit_pct=float(signal_data.get("take_profit_pct", 3.0) or 3.0),
        position_size_usd=float(signal_data.get("position_size_usd", 1000.0) or 1000.0),
    )
    blue_team_signal = None
    if blue_signal_data:
        blue_team_signal = TradingSignal(
            signal_type=str(blue_signal_data.get("signal_type", "HOLD") or "HOLD"),
            confidence_score=float(blue_signal_data.get("confidence_score", 0.0) or 0.0),
            urgency=str(blue_signal_data.get("urgency", "LOW") or "LOW"),
            entry_symbol=str(blue_signal_data.get("entry_symbol", "") or ""),
            recommendations=list(blue_signal_data.get("recommendations") or []),
            conviction_level=str(blue_signal_data.get("conviction_level", "LOW") or "LOW"),
            holding_period_hours=int(blue_signal_data.get("holding_period_hours", 2) or 2),
            trading_type=str(blue_signal_data.get("trading_type", "VOLATILE_EVENT") or "VOLATILE_EVENT"),
            action_if_already_in_position=str(blue_signal_data.get("action_if_already_in_position", "HOLD") or "HOLD"),
            entry_price=blue_signal_data.get("entry_price"),
            stop_loss_pct=float(blue_signal_data.get("stop_loss_pct", 2.0) or 2.0),
            take_profit_pct=float(blue_signal_data.get("take_profit_pct", 3.0) or 3.0),
            position_size_usd=float(blue_signal_data.get("position_size_usd", 1000.0) or 1000.0),
        )
    red_team_payload = metadata.get("red_team_review") or {}

    backtest_results = None
    if backtest_data:
        backtest_results = BacktestResults(
            total_return=float(backtest_data.get("total_return", 0.0) or 0.0),
            win_rate=float(backtest_data.get("win_rate", 0.0) or 0.0),
            max_drawdown=float(backtest_data.get("max_drawdown", 0.0) or 0.0),
            sharpe_ratio=float(backtest_data.get("sharpe_ratio", 0.0) or 0.0),
            total_trades=int(backtest_data.get("total_trades", 0) or 0),
            lookback_days=int(backtest_data.get("lookback_days", snapshot.get("lookback_days", 14)) or 14),
        )

    return AnalysisResponse(
        request_id=analysis.request_id,
        timestamp=analysis.timestamp,
        symbols_analyzed=list(metadata.get("symbols") or snapshot.get("symbols") or []),
        posts_scraped=int(metadata.get("posts_scraped", 0) or 0),
        sentiment_scores=sentiment_scores,
        aggregated_sentiment=aggregated_sentiment,
        trading_signal=trading_signal,
        blue_team_signal=blue_team_signal,
        market_validation=market_validation,
        red_team_review=RedTeamReview.model_validate(red_team_payload) if red_team_payload else None,
        red_team_debug=RedTeamDebug.model_validate(red_team_debug_payload) if red_team_debug_payload else None,
        model_inputs=ModelInputDebug.model_validate(model_inputs_payload) if model_inputs_payload else None,
        backtest_results=backtest_results,
        processing_time_ms=float(metadata.get("processing_time_ms", 0.0) or 0.0),
        status="SUCCESS",
    )


@router.get("/analysis-snapshots/{request_id}", tags=["System"])
async def get_analysis_snapshot_detail(request_id: str, db: Session = Depends(get_db)):
    """Return the persisted full analysis payload for one saved run."""
    analysis = db.query(AnalysisResult).filter(AnalysisResult.request_id == request_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Saved analysis snapshot not found")
    return _load_saved_analysis_response(analysis)


@router.post("/analysis-snapshots/{request_id}/rerun", tags=["Analysis"])
async def rerun_analysis_snapshot(
    request_id: str,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
):
    """Re-run a frozen analysis dataset snapshot with a different model."""
    analysis = db.query(AnalysisResult).filter(AnalysisResult.request_id == request_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Saved analysis snapshot not found")

    metadata = analysis.run_metadata or {}
    snapshot = metadata.get("dataset_snapshot") or {}
    if not snapshot:
        raise HTTPException(status_code=400, detail="This analysis does not contain a reusable dataset snapshot")

    requested_model = str(payload.get("model_name", "") or "").strip()
    rerun_extraction = str(payload.get("extraction_model", "") or "").strip() or None
    rerun_reasoning = str(payload.get("reasoning_model", "") or "").strip() or None

    # Support both single-model (model_name) and two-stage (extraction_model + reasoning_model).
    # extraction_model alone also works as a single-model override.
    effective_model = requested_model or rerun_extraction or ""
    if not effective_model:
        raise HTTPException(status_code=400, detail="model_name or extraction_model is required")

    started = time.time()
    rerun_request_id = str(uuid.uuid4())[:8]
    symbols = snapshot.get("symbols") or metadata.get("symbols") or []
    prompt_overrides = snapshot.get("prompt_overrides") or {}
    posts = _restore_snapshot_posts(snapshot.get("posts") or [])
    price_context = snapshot.get("price_context") or {}
    saved_model_inputs = snapshot.get("model_inputs") or {}
    web_context_by_symbol = saved_model_inputs.get("web_context_by_symbol") or {}
    web_items_by_symbol = saved_model_inputs.get("web_items_by_symbol") or {}
    saved_secret_trace = snapshot.get("secret_trace") or metadata.get("secret_trace") or {}
    quotes_by_symbol = _restore_snapshot_quotes(snapshot.get("quotes_by_symbol") or {})
    market_validation = snapshot.get("market_validation") or {}
    include_backtest = bool(snapshot.get("include_backtest", False))
    lookback_days = int(snapshot.get("lookback_days") or 14)

    if not posts:
        raise HTTPException(status_code=400, detail="Saved snapshot is missing article data")

    mark_analysis_started(db, rerun_request_id)

    try:
        previous_state = _latest_previous_analysis_state(db)
        previous_response = previous_state.get("response") if previous_state else None
        sentiment_results, sentiment_trace = await _analyze_sentiment(
            posts,
            symbols,
            price_context,
            prompt_overrides,
            effective_model,
            extraction_model=rerun_extraction,
            reasoning_model=rerun_reasoning,
            web_context_by_symbol=web_context_by_symbol,
        )
        # Use the risk_profile stored in the snapshot so reruns reproduce the original leverage logic.
        # Fall back to current config only for old snapshots that predate risk_profile storage.
        _snapshot_risk = str(snapshot.get("risk_profile") or "")
        if not _snapshot_risk:
            _rerun_cfg = get_or_create_app_config(db)
            _snapshot_risk = str(getattr(_rerun_cfg, "risk_profile", "moderate") or "moderate")
        use_closed_market_hysteresis = (
            _is_closed_market_session(quotes_by_symbol)
            and previous_response is not None
            and abs(int(previous_response.posts_scraped or 0) - len(posts)) <= 5
            and _max_sentiment_input_delta(sentiment_results, previous_response) <= 0.20
        )
        blue_team_signal = _generate_trading_signal(
            sentiment_results,
            quotes_by_symbol,
            risk_profile=_snapshot_risk,
            previous_signal=(previous_response.blue_team_signal or previous_response.trading_signal) if previous_response else None,
            stability_mode="closed_market_hysteresis" if use_closed_market_hysteresis else "normal",
        )
        if previous_response and not _material_change_gate(
            symbols=symbols,
            posts_count=len(posts),
            sentiment_results=sentiment_results,
            price_context=price_context,
            quotes_by_symbol=quotes_by_symbol,
            previous_state=previous_state,
            candidate_signal=blue_team_signal,
        ):
            blue_team_signal = previous_response.blue_team_signal or previous_response.trading_signal or blue_team_signal
        quotes_by_symbol = _ensure_execution_quotes(blue_team_signal, quotes_by_symbol)
        if blue_team_signal.entry_symbol in quotes_by_symbol:
            blue_team_signal.entry_price = quotes_by_symbol[blue_team_signal.entry_symbol].get("current_price")
        red_team_review, red_team_debug = await _run_red_team_review(
            model_name=rerun_reasoning or effective_model,
            symbols=symbols,
            posts=posts,
            sentiment_results=sentiment_results,
            trading_signal=blue_team_signal,
            price_context=price_context,
            quotes_by_symbol=quotes_by_symbol,
            market_validation=market_validation,
        )
        trading_signal = _build_consensus_trading_signal(
            blue_team_signal,
            red_team_review,
            quotes_by_symbol=quotes_by_symbol,
            risk_profile=_snapshot_risk,
        )
        if red_team_debug:
            red_team_debug.signal_changes = _build_red_team_signal_changes(blue_team_signal, trading_signal, red_team_review)
        quotes_by_symbol = _ensure_execution_quotes(trading_signal, quotes_by_symbol)
        if trading_signal.entry_symbol in quotes_by_symbol:
            trading_signal.entry_price = quotes_by_symbol[trading_signal.entry_symbol].get("current_price")

        backtest_results = None
        if include_backtest:
            backtest_results = await _run_backtest(symbols, sentiment_results, lookback_days)

        processing_time_ms = (time.time() - started) * 1000
        restored_model_inputs = snapshot.get("model_inputs") or _build_model_input_debug(
            posts,
            price_context,
            market_validation,
            symbols,
            prompt_overrides,
            web_context_by_symbol=web_context_by_symbol,
            web_items_by_symbol=web_items_by_symbol,
        )

        response = AnalysisResponse(
            request_id=rerun_request_id,
            timestamp=datetime.utcnow(),
            symbols_analyzed=symbols,
            posts_scraped=len(posts),
            sentiment_scores={
                symbol: SentimentScore(
                    market_bluster=sentiment.get("bluster_score", 0.0),
                    policy_change=sentiment.get("policy_score", 0.0),
                    confidence=sentiment.get("confidence", 0.5),
                    reasoning=sentiment.get("reasoning", ""),
                )
                for symbol, sentiment in sentiment_results.items()
            },
            aggregated_sentiment=_aggregate_sentiment(sentiment_results),
            trading_signal=trading_signal,
            blue_team_signal=blue_team_signal,
            market_validation=market_validation,
            red_team_review=red_team_review,
            red_team_debug=red_team_debug,
            model_inputs=ModelInputDebug.model_validate(restored_model_inputs),
            backtest_results=backtest_results,
            processing_time_ms=processing_time_ms,
            status="SUCCESS",
        )
        rerun_secret_trace = dict(saved_secret_trace or {})
        rerun_secret_trace["request_id"] = rerun_request_id
        rerun_secret_trace["models"] = {
            **dict((saved_secret_trace or {}).get("models") or {}),
            "active_model": effective_model,
            "extraction_model": rerun_extraction or "",
            "reasoning_model": rerun_reasoning or "",
            "risk_profile": _snapshot_risk,
        }
        rerun_secret_trace["blue_team_signal"] = blue_team_signal.model_dump(mode="json") if blue_team_signal else {}
        rerun_secret_trace["trading_signal"] = trading_signal.model_dump(mode="json") if trading_signal else {}
        rerun_secret_trace["red_team_review"] = red_team_review.model_dump(mode="json") if red_team_review else {}
        rerun_secret_trace["red_team_debug"] = red_team_debug.model_dump(mode="json") if red_team_debug else {}
        _save_analysis_result(
            db,
            rerun_request_id,
            response,
            quotes_by_symbol,
            model_name=effective_model,
            dataset_snapshot=snapshot,
            extraction_model=rerun_extraction or "",
            reasoning_model=rerun_reasoning or "",
            risk_profile=_snapshot_risk,
            secret_trace=rerun_secret_trace,
            sentiment_results=sentiment_results,
        )
        mark_analysis_completed(db, rerun_request_id)
        record_analysis_result(
            status="success",
            request_id=rerun_request_id,
            duration_ms=processing_time_ms,
            active_model=effective_model,
        )
        return response
    except Exception as exc:
        record_analysis_result(
            status="failed",
            request_id=rerun_request_id,
            active_model=effective_model,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "Snapshot rerun failed",
                "message": str(exc),
                "timestamp": datetime.utcnow().isoformat(),
            },
        )


def _sse(message: str) -> str:
    return f"data: {json.dumps({'type': 'log', 'message': message})}\n\n"


def _sse_result(data: dict) -> str:
    return f"data: {json.dumps({'type': 'result', 'data': data})}\n\n"


def _sse_error(message: str) -> str:
    return f"data: {json.dumps({'type': 'error', 'message': message})}\n\n"


def _sse_article(source: str, title: str, description: str, keywords: list) -> str:
    return f"data: {json.dumps({'type': 'article', 'source': source, 'title': title, 'description': description, 'keywords': keywords})}\n\n"


@router.post(
    "/analyze/stream",
    summary="Run full analysis pipeline with real-time progress",
    tags=["Analysis"]
)
async def analyze_market_stream(request: AnalysisRequest):
    """SSE endpoint streaming progress events then the final result."""

    async def generate() -> AsyncGenerator[str, None]:
        start_time = time.time()
        request_id = str(uuid.uuid4())[:8]
        db = SessionLocal()
        pipeline_events: List[str] = []
        stage_times: Dict[str, float] = {}

        def emit(message: str) -> str:
            pipeline_events.append(message)
            return _sse(message)
        
        def mark_stage_complete(stage_name: str) -> None:
            """Track when each pipeline stage completes for progress estimation."""
            elapsed = time.time() - start_time
            stage_times[stage_name] = elapsed

        try:
            config = get_or_create_app_config(db)
            effective_request = _apply_request_defaults(request, config)
            prompt_overrides = config.symbol_prompt_overrides or {}
            # ── Preflight: verify Ollama is reachable ────────────────────────
            try:
                ollama_status = get_ollama_status()
                ollama_root = str(ollama_status.get("ollama_root") or "")
                active_model = str(ollama_status.get("active_model") or "").strip() or "unknown model"
                yield emit(f"Ollama reachable — using {active_model}")
            except Exception:
                import os as _os

                ollama_root = _os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate").replace("/api/generate", "")
                model = _os.getenv("OLLAMA_MODEL", "").strip() or "the first available served model"
                yield _sse_error(
                    f"Cannot reach Ollama at {ollama_root}. "
                    f"Start it with: ollama run {model}"
                )
                return

            # ── Step 1: Data Ingestion (live, feed-by-feed) ──────────────────
            mark_analysis_started(db, request_id)
            posts: List[Any] = []
            ingestion_trace: Dict[str, Any] = {
                "truth_social": {"status": "skipped", "count": 0, "items": [], "error": None},
                "rss": {"status": "ok", "feeds": [], "total_count": 0, "error": None},
                "total_items": 0,
                "request_max_posts": effective_request.max_posts,
            }

            feed_map = build_enabled_rss_feed_map(config)
            parser = RSSFeedParser(feeds=feed_map)
            num_feeds = max(1, len(parser.feeds))
            per_feed_cap = resolve_rss_articles_per_feed(config)
            max_total_posts = max(effective_request.max_posts, per_feed_cap * num_feeds)

            for feed_name in parser.feeds:
                label = feed_name.replace("_", " ").title()
                yield emit(f"Fetching {label}…")
                try:
                    articles = await asyncio.to_thread(
                        parser.parse_feeds, feed_names=[feed_name]
                    )
                    articles = parser.filter_by_keywords(articles, min_keywords=1)
                    articles = articles[:per_feed_cap]
                    ingestion_trace["rss"]["feeds"].append(
                        {
                            "feed_key": feed_name,
                            "feed_url": feed_map.get(feed_name, ""),
                            "status": "ok",
                            "count": len(articles),
                            "articles": [_post_trace_summary(article) for article in articles],
                        }
                    )
                    for a in articles:
                        desc = a.content if a.content.strip() != a.title.strip() else ""
                        yield _sse_article(label, a.title, desc, a.keywords[:6])
                    posts.extend(articles)
                    yield emit(f"{label}: {len(articles)} articles")
                except Exception as e:
                    ingestion_trace["rss"]["feeds"].append(
                        {
                            "feed_key": feed_name,
                            "feed_url": feed_map.get(feed_name, ""),
                            "status": "error",
                            "count": 0,
                            "articles": [],
                            "error": str(e),
                        }
                    )
                    yield emit(f"{label} error: {e}")

            # Trim total after collecting from all feeds
            posts = posts[:max_total_posts]
            ingestion_trace["rss"]["per_feed_cap"] = per_feed_cap
            ingestion_trace["rss"]["total_count"] = len(posts)
            ingestion_trace["total_items"] = len(posts)
            yield emit(f"Ingestion complete — {len(posts)} items")
            mark_stage_complete("ingestion")

            # Step 2: Price Data
            yield emit(f"Fetching real-time price data for {', '.join(effective_request.symbols)}...")
            yield emit(f"Fetching structured validation data for {', '.join(effective_request.symbols)}...")
            price_context, quotes_by_symbol, market_validation = await _get_market_snapshot(effective_request.symbols)
            prices_found = [k for k in price_context if "_price" in k]
            yield emit(f"Price data fetched: {', '.join(prices_found) or 'no data'}")
            validation_ready = [symbol for symbol, payload in market_validation.items() if payload.get("status") != "unavailable"]
            yield emit(f"Validation data fetched: {', '.join(validation_ready) or 'no structured data'}")
            price_context = _inject_technical_context(price_context, effective_request.symbols, db)
            tech_ready = [s for s in effective_request.symbols if f"technical_context_{s.lower()}" in price_context]
            if tech_ready:
                yield emit(f"Technical indicators loaded: {', '.join(tech_ready)}")
            web_context_by_symbol, web_items_by_symbol = await _get_symbol_web_research(
                effective_request.symbols,
                bool(getattr(config, "web_research_enabled", False)),
                resolve_web_research_items_per_symbol(config),
                resolve_web_research_recency_days(config),
                getattr(config, "symbol_company_aliases", {}) or {},
            )
            if any(web_context_by_symbol.values()):
                researched = [symbol for symbol, summary in web_context_by_symbol.items() if summary]
                yield emit(f"Light web research loaded: {', '.join(researched)}")
                for symbol in researched:
                    items = web_items_by_symbol.get(symbol) or []
                    yield emit(f"{symbol} · Web research: {len(items)} recent items")
                    for item in items:
                        source = f"{symbol} · Web Research"
                        title = str(item.get("title") or "Recent web item")
                        source_name = str(item.get("source") or "Unknown source")
                        published_at = str(item.get("published_at") or "").strip()
                        url = str(item.get("url") or "").strip()
                        summary = str(item.get("summary") or "").strip()
                        details = []
                        if source_name:
                            details.append(f"Source: {source_name}")
                        if published_at:
                            details.append(f"Published: {published_at}")
                        if url:
                            details.append(f"Link: {url}")
                        if summary:
                            details.append(f"Summary: {summary}")
                        yield _sse_article(source, title, "\n".join(details), [symbol.lower(), "web-research"])
                empty_symbols = [symbol for symbol in effective_request.symbols if not (web_items_by_symbol.get(symbol) or [])]
                recency_days = resolve_web_research_recency_days(config)
                for symbol in empty_symbols:
                    yield emit(f"{symbol} · Web research: no fresh items in last {recency_days} days")
            mark_stage_complete("prices")

            # Step 3: Sentiment Analysis
            extraction_model, reasoning_model = _resolve_pipeline_models(config, active_model)
            if extraction_model and reasoning_model and extraction_model == reasoning_model:
                yield emit(f"Two-pass analysis (Light mode) with {extraction_model}...")
            elif extraction_model and reasoning_model:
                yield emit(f"Stage 1 entity mapping with {extraction_model}...")
                yield emit(f"Stage 2 financial reasoning with {reasoning_model}...")
            else:
                yield emit(f"Running sentiment analysis with {active_model} on collected text...")
            sentiment_results, sentiment_trace = await _analyze_sentiment(
                posts,
                effective_request.symbols,
                price_context,
                prompt_overrides,
                active_model,
                extraction_model=extraction_model,
                reasoning_model=reasoning_model,
                web_context_by_symbol=web_context_by_symbol,
            )
            for sym, s in sentiment_results.items():
                bluster = s.get('bluster_score', 0)
                policy = s.get('policy_score', 0)
                yield emit(
                    f"  {sym}: bluster={bluster:+.2f}  policy={policy:.2f}  "
                    f"confidence={s.get('confidence', 0):.0%}"
                )
            mark_stage_complete("sentiment")

            # Step 4: Trading Signal
            yield emit("Generating trading signal...")
            _stream_risk = str(getattr(config, "risk_profile", "moderate") or "moderate")
            previous_state = _latest_previous_analysis_state(db)
            previous_response = previous_state.get("response") if previous_state else None
            use_closed_market_hysteresis = (
                _is_closed_market_session(quotes_by_symbol)
                and previous_response is not None
                and abs(int(previous_response.posts_scraped or 0) - len(posts)) <= 5
                and _max_sentiment_input_delta(sentiment_results, previous_response) <= 0.20
            )
            if use_closed_market_hysteresis:
                yield emit("Closed-market hysteresis active: preserving prior signal unless the inputs moved materially.")
            blue_team_signal = _generate_trading_signal(
                sentiment_results,
                quotes_by_symbol,
                risk_profile=_stream_risk,
                previous_signal=(previous_response.blue_team_signal or previous_response.trading_signal) if previous_response else None,
                stability_mode="closed_market_hysteresis" if use_closed_market_hysteresis else "normal",
            )
            if previous_response and not _material_change_gate(
                symbols=effective_request.symbols,
                posts_count=len(posts),
                sentiment_results=sentiment_results,
                price_context=price_context,
                quotes_by_symbol=quotes_by_symbol,
                previous_state=previous_state,
                candidate_signal=blue_team_signal,
            ):
                yield emit("Material-change gate active: keeping prior thesis because the news/price move is not large enough to justify a flip.")
                blue_team_signal = previous_response.blue_team_signal or previous_response.trading_signal or blue_team_signal
            quotes_by_symbol = _ensure_execution_quotes(blue_team_signal, quotes_by_symbol)
            if blue_team_signal.entry_symbol in quotes_by_symbol:
                blue_team_signal.entry_price = quotes_by_symbol[blue_team_signal.entry_symbol].get("current_price")
            yield emit(
                f"Blue team: {blue_team_signal.signal_type}  |  "
                f"Urgency: {blue_team_signal.urgency}  |  "
                f"Entry: {blue_team_signal.entry_symbol}  |  "
                f"Confidence: {blue_team_signal.confidence_score:.0%}"
            )
            yield emit("Running red-team risk review...")
            red_team_review, red_team_debug = await _run_red_team_review(
                model_name=reasoning_model or active_model,
                symbols=effective_request.symbols,
                posts=posts,
                sentiment_results=sentiment_results,
                trading_signal=blue_team_signal,
                price_context=price_context,
                quotes_by_symbol=quotes_by_symbol,
                market_validation=market_validation,
            )
            trading_signal = _build_consensus_trading_signal(
                blue_team_signal,
                red_team_review,
                quotes_by_symbol=quotes_by_symbol,
                risk_profile=_stream_risk,
            )
            if red_team_debug:
                red_team_debug.signal_changes = _build_red_team_signal_changes(blue_team_signal, trading_signal, red_team_review)
            quotes_by_symbol = _ensure_execution_quotes(trading_signal, quotes_by_symbol)
            if trading_signal.entry_symbol in quotes_by_symbol:
                trading_signal.entry_price = quotes_by_symbol[trading_signal.entry_symbol].get("current_price")
            if red_team_review and red_team_review.summary:
                yield emit(f"Red team: {red_team_review.summary}")
            yield emit(
                f"Consensus: {trading_signal.signal_type}  |  "
                f"Urgency: {trading_signal.urgency}  |  "
                f"Entry: {trading_signal.entry_symbol}  |  "
                f"Confidence: {trading_signal.confidence_score:.0%}"
            )
            mark_stage_complete("signal")

            # Step 5: Backtest
            backtest_results = None
            if effective_request.include_backtest:
                yield emit(f"Running rolling window backtest ({effective_request.lookback_days}-day lookback)...")
                backtest_results = await _run_backtest(
                    effective_request.symbols, sentiment_results, effective_request.lookback_days
                )
                yield emit(
                    f"Backtest complete — return: {backtest_results.total_return:.2f}%  "
                    f"Sharpe: {backtest_results.sharpe_ratio:.2f}  "
                    f"Max DD: {backtest_results.max_drawdown:.2f}%"
                )
            mark_stage_complete("backtest")

            processing_time_ms = (time.time() - start_time) * 1000
            yield emit(f"Analysis complete in {processing_time_ms / 1000:.2f}s")

            response = AnalysisResponse(
                request_id=request_id,
                timestamp=datetime.utcnow(),
                symbols_analyzed=effective_request.symbols,
                posts_scraped=len(posts),
                sentiment_scores={
                    symbol: SentimentScore(
                        market_bluster=sentiment.get('bluster_score', 0.0),
                        policy_change=sentiment.get('policy_score', 0.0),
                        confidence=sentiment.get('confidence', 0.5),
                        reasoning=sentiment.get('reasoning', '')
                    )
                    for symbol, sentiment in sentiment_results.items()
                },
                aggregated_sentiment=_aggregate_sentiment(sentiment_results),
                trading_signal=trading_signal,
                blue_team_signal=blue_team_signal,
                market_validation=market_validation,
                red_team_review=red_team_review,
                red_team_debug=red_team_debug,
                model_inputs=_build_model_input_debug(
                    posts,
                    price_context,
                    market_validation,
                    effective_request.symbols,
                    prompt_overrides,
                    web_context_by_symbol=web_context_by_symbol,
                    web_items_by_symbol=web_items_by_symbol,
                ),
                backtest_results=backtest_results,
                processing_time_ms=processing_time_ms,
                status="SUCCESS"
            )
            secret_trace = _build_secret_trace(
                request_id=request_id,
                active_model=active_model,
                extraction_model=extraction_model or "",
                reasoning_model=reasoning_model or "",
                risk_profile=_stream_risk,
                request_payload=effective_request,
                ingestion_trace=ingestion_trace,
                price_context=price_context,
                quotes_by_symbol=quotes_by_symbol,
                market_validation=market_validation,
                web_context_by_symbol=web_context_by_symbol,
                web_items_by_symbol=web_items_by_symbol,
                sentiment_results=sentiment_results,
                sentiment_trace=sentiment_trace,
                blue_team_signal=blue_team_signal,
                trading_signal=trading_signal,
                red_team_review=red_team_review.model_dump(mode="json") if red_team_review else None,
                red_team_debug=red_team_debug.model_dump(mode="json") if red_team_debug else None,
                backtest_results=backtest_results,
                pipeline_events=pipeline_events,
            )

            _save_analysis_and_trades(
                request_id, response, quotes_by_symbol, posts, prompt_overrides, active_model,
                extraction_model=extraction_model or "",
                reasoning_model=reasoning_model or "",
                risk_profile=_stream_risk,
                secret_trace=secret_trace,
                sentiment_results=sentiment_results,
            )
            mark_analysis_completed(db, request_id)
            record_analysis_result(
                status="success",
                request_id=request_id,
                duration_ms=processing_time_ms,
                active_model=active_model,
            )
            yield _sse_result(response.model_dump(mode="json"))

        except Exception as e:
            record_analysis_result(
                status="failed",
                request_id=request_id,
                active_model=active_model,
                error=str(e),
            )
            yield _sse_error(str(e))
        finally:
            db.close()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/analyze",
    response_model=AnalysisResponse,
    summary="Run full sentiment analysis pipeline",
    tags=["Analysis"]
)
async def analyze_market(
    request: AnalysisRequest,
    db: Session = Depends(get_db)
):
    try:
        ollama_status = get_ollama_status()
        ollama_root = str(ollama_status.get("ollama_root") or "")
        active_model = str(ollama_status.get("active_model") or "").strip() or "unknown model"
    except Exception:
        import os as _os

        ollama_root = _os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate").replace("/api/generate", "")
        model = _os.getenv("OLLAMA_MODEL", "").strip() or "the first available served model"
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Ollama is not running at {ollama_root}. Start it with: ollama run {model}"
        )

    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]

    try:
        config = get_or_create_app_config(db)
        effective_request = _apply_request_defaults(request, config)
        prompt_overrides = config.symbol_prompt_overrides or {}
        mark_analysis_started(db, request_id)

        posts, ingestion_trace = await _ingest_data(effective_request)
        price_context, quotes_by_symbol, market_validation = await _get_market_snapshot(effective_request.symbols)
        price_context = _inject_technical_context(price_context, effective_request.symbols, db)
        web_context_by_symbol, web_items_by_symbol = await _get_symbol_web_research(
            effective_request.symbols,
            bool(getattr(config, "web_research_enabled", False)),
            resolve_web_research_items_per_symbol(config),
            resolve_web_research_recency_days(config),
            getattr(config, "symbol_company_aliases", {}) or {},
        )
        extraction_model, reasoning_model = _resolve_pipeline_models(config, active_model)
        sentiment_results, sentiment_trace = await _analyze_sentiment(
            posts,
            effective_request.symbols,
            price_context,
            prompt_overrides,
            active_model,
            extraction_model=extraction_model,
            reasoning_model=reasoning_model,
            web_context_by_symbol=web_context_by_symbol,
        )
        _batch_risk = str(getattr(config, "risk_profile", "moderate") or "moderate")
        previous_state = _latest_previous_analysis_state(db)
        previous_response = previous_state.get("response") if previous_state else None
        use_closed_market_hysteresis = (
            _is_closed_market_session(quotes_by_symbol)
            and previous_response is not None
            and abs(int(previous_response.posts_scraped or 0) - len(posts)) <= 5
            and _max_sentiment_input_delta(sentiment_results, previous_response) <= 0.20
        )
        blue_team_signal = _generate_trading_signal(
            sentiment_results,
            quotes_by_symbol,
            risk_profile=_batch_risk,
            previous_signal=(previous_response.blue_team_signal or previous_response.trading_signal) if previous_response else None,
            stability_mode="closed_market_hysteresis" if use_closed_market_hysteresis else "normal",
        )
        if previous_response and not _material_change_gate(
            symbols=effective_request.symbols,
            posts_count=len(posts),
            sentiment_results=sentiment_results,
            price_context=price_context,
            quotes_by_symbol=quotes_by_symbol,
            previous_state=previous_state,
            candidate_signal=blue_team_signal,
        ):
            blue_team_signal = previous_response.blue_team_signal or previous_response.trading_signal or blue_team_signal
        quotes_by_symbol = _ensure_execution_quotes(blue_team_signal, quotes_by_symbol)
        if blue_team_signal.entry_symbol in quotes_by_symbol:
            blue_team_signal.entry_price = quotes_by_symbol[blue_team_signal.entry_symbol].get("current_price")
        red_team_review, red_team_debug = await _run_red_team_review(
            model_name=reasoning_model or active_model,
            symbols=effective_request.symbols,
            posts=posts,
            sentiment_results=sentiment_results,
            trading_signal=blue_team_signal,
            price_context=price_context,
            quotes_by_symbol=quotes_by_symbol,
            market_validation=market_validation,
        )
        trading_signal = _build_consensus_trading_signal(
            blue_team_signal,
            red_team_review,
            quotes_by_symbol=quotes_by_symbol,
            risk_profile=_batch_risk,
        )
        if red_team_debug:
            red_team_debug.signal_changes = _build_red_team_signal_changes(blue_team_signal, trading_signal, red_team_review)
        quotes_by_symbol = _ensure_execution_quotes(trading_signal, quotes_by_symbol)
        if trading_signal.entry_symbol in quotes_by_symbol:
            trading_signal.entry_price = quotes_by_symbol[trading_signal.entry_symbol].get("current_price")

        backtest_results = None
        if effective_request.include_backtest:
            backtest_results = await _run_backtest(
                effective_request.symbols, sentiment_results, effective_request.lookback_days
            )

        processing_time_ms = (time.time() - start_time) * 1000

        response = AnalysisResponse(
            request_id=request_id,
            timestamp=datetime.utcnow(),
            symbols_analyzed=effective_request.symbols,
            posts_scraped=len(posts),
            sentiment_scores={
                symbol: SentimentScore(
                    market_bluster=sentiment.get('bluster_score', 0.0),
                    policy_change=sentiment.get('policy_score', 0.0),
                    confidence=sentiment.get('confidence', 0.5),
                    reasoning=sentiment.get('reasoning', '')
                )
                for symbol, sentiment in sentiment_results.items()
            },
            aggregated_sentiment=_aggregate_sentiment(sentiment_results),
            trading_signal=trading_signal,
            blue_team_signal=blue_team_signal,
            market_validation=market_validation,
            red_team_review=red_team_review,
            red_team_debug=red_team_debug,
            model_inputs=_build_model_input_debug(
                posts,
                price_context,
                market_validation,
                effective_request.symbols,
                prompt_overrides,
                web_context_by_symbol=web_context_by_symbol,
                web_items_by_symbol=web_items_by_symbol,
            ),
            backtest_results=backtest_results,
            processing_time_ms=processing_time_ms,
            status="SUCCESS"
        )
        secret_trace = _build_secret_trace(
            request_id=request_id,
            active_model=active_model,
            extraction_model=extraction_model or "",
            reasoning_model=reasoning_model or "",
            risk_profile=_batch_risk,
            request_payload=effective_request,
            ingestion_trace=ingestion_trace,
            price_context=price_context,
            quotes_by_symbol=quotes_by_symbol,
            market_validation=market_validation,
            web_context_by_symbol=web_context_by_symbol,
            web_items_by_symbol=web_items_by_symbol,
            sentiment_results=sentiment_results,
            sentiment_trace=sentiment_trace,
            blue_team_signal=blue_team_signal,
            trading_signal=trading_signal,
            red_team_review=red_team_review.model_dump(mode="json") if red_team_review else None,
            red_team_debug=red_team_debug.model_dump(mode="json") if red_team_debug else None,
            backtest_results=backtest_results,
            pipeline_events=[
                f"Loaded {len(posts)} items from ingestion",
                f"Fetched {len(quotes_by_symbol)} quotes",
                f"Completed sentiment analysis for {len(sentiment_results)} symbols",
                f"Generated blue-team {blue_team_signal.signal_type} signal",
                f"Generated consensus {trading_signal.signal_type} signal",
            ],
        )

        if db:
            _save_analysis_result(
                db,
                request_id,
                response,
                quotes_by_symbol,
                posts=posts,
                model_name=active_model,
                prompt_overrides=prompt_overrides,
                extraction_model=extraction_model or "",
                reasoning_model=reasoning_model or "",
                risk_profile=_batch_risk,
                secret_trace=secret_trace,
            )
            mark_analysis_completed(db, request_id)

        record_analysis_result(
            status="success",
            request_id=request_id,
            duration_ms=processing_time_ms,
            active_model=active_model,
        )
        return response

    except Exception as e:
        record_analysis_result(
            status="failed",
            request_id=request_id if "request_id" in locals() else None,
            active_model=locals().get("active_model"),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "Analysis failed",
                "message": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
        )


async def _ingest_data(request: AnalysisRequest) -> Tuple[List[Any], Dict[str, Any]]:
    """Ingest posts from Truth Social and RSS feeds. Returns posts plus a structured trace."""
    posts: List[Any] = []
    truth_status = {"status": "ok", "count": 0, "error": None}
    rss_status = {"status": "ok", "count": 0, "error": None}
    trace: Dict[str, Any] = {
        "truth_social": {"status": "skipped", "count": 0, "items": [], "error": None},
        "rss": {"status": "ok", "feeds": [], "total_count": 0, "error": None},
    }

    scraper = TruthSocialScraper()
    try:
        truth_posts = await scraper.scrape_posts(
            query="market geopolitics policy oil crypto fed trade",
            limit=request.max_posts
        )
        posts.extend(truth_posts)
        truth_status["count"] = len(truth_posts)
        trace["truth_social"] = {
            "status": "ok",
            "count": len(truth_posts),
            "items": [_post_trace_summary(post) for post in truth_posts],
            "error": None,
        }
    except Exception as e:
        print(f"Truth Social scrape error: {e}")
        truth_status["status"] = "error"
        truth_status["error"] = str(e)
        trace["truth_social"] = {"status": "error", "count": 0, "items": [], "error": str(e)}

    db = SessionLocal()
    try:
        config = get_or_create_app_config(db)
        feed_map = build_enabled_rss_feed_map(config)
        parser = RSSFeedParser(feeds=feed_map)
        per_feed_cap = resolve_rss_articles_per_feed(config)
        max_total_posts = max(request.max_posts, per_feed_cap * max(1, len(parser.feeds)))
    finally:
        db.close()
    try:
        rss_articles: List[Any] = []
        feed_traces: List[Dict[str, Any]] = []
        for feed_name in parser.feeds:
            feed_url = feed_map.get(feed_name, "")
            try:
                articles = await asyncio.to_thread(parser.parse_feeds, feed_names=[feed_name])
                articles = parser.filter_by_keywords(articles, min_keywords=1)
                articles = articles[:per_feed_cap]
                rss_articles.extend(articles)
                feed_traces.append(
                    {
                        "feed_key": feed_name,
                        "feed_url": feed_url,
                        "status": "ok",
                        "count": len(articles),
                        "articles": [_post_trace_summary(article) for article in articles],
                    }
                )
            except Exception as e:
                feed_traces.append(
                    {
                        "feed_key": feed_name,
                        "feed_url": feed_url,
                        "status": "error",
                        "count": 0,
                        "articles": [],
                        "error": str(e),
                    }
                )
        posts.extend(rss_articles)
        rss_status["count"] = len(rss_articles)
        trace["rss"] = {
            "status": "ok",
            "feeds": feed_traces,
            "per_feed_cap": per_feed_cap,
            "total_count": len(rss_articles),
            "error": None,
        }
    except Exception as e:
        print(f"RSS feed parse error: {e}")
        rss_status["status"] = "error"
        rss_status["error"] = str(e)
        trace["rss"] = {"status": "error", "feeds": [], "total_count": 0, "error": str(e)}

    pull_status = "ok"
    if truth_status["status"] == "error" and rss_status["status"] == "error":
        pull_status = "error"
    elif truth_status["status"] == "error" or rss_status["status"] == "error":
        pull_status = "partial"

    record_data_pull(
        status=pull_status,
        source="analysis_ingestion",
        summary=f"Fetched {len(posts)} items from Truth Social and RSS",
        details={
            "truth_social": truth_status,
            "rss": rss_status,
            "total_items": len(posts),
        },
        error="; ".join(
            error for error in [truth_status["error"], rss_status["error"]] if error
        ) or None,
    )

    trace["total_items"] = len(posts)
    trace["request_max_posts"] = request.max_posts
    trace["truth_status"] = truth_status
    trace["rss_status"] = rss_status
    return posts, trace


def _apply_request_defaults(request: AnalysisRequest, config: Any) -> AnalysisRequest:
    symbols = request.symbols or config.tracked_symbols or ["USO", "BITO", "QQQ", "SPY"]
    return AnalysisRequest(
        symbols=symbols,
        max_posts=request.max_posts or config.max_posts,
        include_backtest=request.include_backtest if request.include_backtest is not None else config.include_backtest,
        lookback_days=request.lookback_days or config.lookback_days,
    )


async def _get_market_snapshot(symbols: List[str]) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """
    Fetch market snapshot for base symbols and ALL their execution variants.
    Ensures we have prices for SBIT, SQQQ, SPXS, SCO, etc.
    """
    from services.trading_instruments import INSTRUMENT_SPECS
    
    client = PriceClient()
    validation_client = MarketValidationClient()
    context = {}
    quotes_by_symbol: Dict[str, Dict[str, Any]] = {}

    # Expand symbols to include all execution variants
    symbols_to_fetch = set(symbols)
    for symbol in symbols:
        spec = INSTRUMENT_SPECS.get(symbol)
        if spec:
            # Add all bull and bear ETFs for this underlying
            symbols_to_fetch.update(spec.get("bull", {}).values())
            symbols_to_fetch.update(spec.get("bear", {}).values())

    # Fetch quotes for all symbols
    for symbol in symbols_to_fetch:
        quote = client.get_realtime_quote(symbol)
        if quote and quote.get('current_price'):
            context[f"{symbol.lower()}_price"] = quote['current_price']
            quotes_by_symbol[symbol] = quote

    # Ensure SPY and QQQ context for analysis
    for extra in ["SPY", "QQQ"]:
        key = f"{extra.lower()}_price"
        if key not in context:
            q = client.get_realtime_quote(extra)
            if q and q.get('current_price'):
                context[key] = q['current_price']

    market_validation = await asyncio.to_thread(validation_client.get_validation_bundle, symbols)
    validation_context = validation_client.build_prompt_context(market_validation)
    if validation_context:
        context["validation_context"] = validation_context
        context["market_validation"] = market_validation

    missing_quotes = [symbol for symbol in symbols if symbol not in quotes_by_symbol]
    validation_unavailable = [
        symbol for symbol, payload in market_validation.items() if payload.get("status") == "unavailable"
    ]
    validation_partial = [
        symbol for symbol, payload in market_validation.items() if payload.get("status") == "partial"
    ]
    snapshot_status = "ok"
    if missing_quotes or validation_unavailable:
        snapshot_status = "partial"
    if len(missing_quotes) == len(symbols) and len(validation_unavailable) == len(symbols):
        snapshot_status = "error"

    record_data_pull(
        status=snapshot_status,
        source="market_snapshot",
        summary=f"Fetched {len(quotes_by_symbol)} live quotes (including execution symbols) for {len(symbols)} base symbols",
        details={
            "quotes_ok": sorted(quotes_by_symbol.keys()),
            "quotes_missing": missing_quotes,
            "base_symbols": symbols,
            "execution_symbols": sorted(symbols_to_fetch - set(symbols)),
            "validation_partial": validation_partial,
            "validation_unavailable": validation_unavailable,
        },
        error=None if snapshot_status == "ok" else "Some price or validation feeds were unavailable",
    )

    return context, quotes_by_symbol, market_validation


def _inject_technical_context(price_context: Dict[str, Any], symbols: List[str], db: Any) -> Dict[str, Any]:
    """Compute technical indicators from price_history DB and add to price_context."""
    client = PriceClient()
    updated = dict(price_context)
    for symbol in symbols:
        try:
            indicators = client.compute_technical_indicators(symbol, db)
            if indicators:
                tech_str = PriceClient.format_technical_context(symbol, indicators)
                updated[f"technical_context_{symbol.lower()}"] = tech_str
                updated[f"technical_indicators_{symbol.lower()}"] = indicators
        except Exception:
            pass
    return updated


def _resolve_pipeline_models(config: Any, active_model: str) -> tuple:
    """
    Return (extraction_model, reasoning_model) based on depth mode.

    Light:    same model for Stage 1 and Stage 2 — no separate reasoning model
    Normal:   two-stage only when both models are explicitly configured
    Detailed: always two-stage — falls back to the same model for both stages if only one is set
    """
    depth_mode = str(getattr(config, "rss_article_detail_mode", "") or "").lower()
    extraction_cfg = str(getattr(config, "extraction_model", "") or "").strip()
    reasoning_cfg = str(getattr(config, "reasoning_model", "") or "").strip()

    if depth_mode == "light":
        single = extraction_cfg or active_model
        return single, single

    if depth_mode == "detailed":
        extraction = extraction_cfg or reasoning_cfg or active_model
        reasoning = reasoning_cfg or extraction_cfg or active_model
        return extraction, reasoning

    # Normal (default): two-stage only when both explicitly configured
    if extraction_cfg and reasoning_cfg:
        return extraction_cfg, reasoning_cfg
    return None, None


async def _analyze_sentiment(
    posts: List[Any],
    symbols: List[str],
    price_context: Dict[str, Any],
    prompt_overrides: Optional[Dict[str, str]] = None,
    model_name: Optional[str] = None,
    extraction_model: Optional[str] = None,
    reasoning_model: Optional[str] = None,
    web_context_by_symbol: Optional[Dict[str, str]] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    """
    Two-stage analysis pipeline when extraction_model and reasoning_model are set:

    Stage 1 (extraction_model): classify articles for relevance and extract proxy terms.
    Stage 2 (reasoning_model):  per-symbol specialist analysis on filtered articles only,
                                with proxy context injected into the prompt.

    Falls back to single-stage (model_name) when orchestration models are not configured.
    """
    from services.sentiment.prompts import format_stage2_proxy_appendix

    engine = SentimentEngine(model_name=model_name)
    engine.clear_cache()
    web_context_by_symbol = web_context_by_symbol or {}

    # ── Stage 1: entity extraction (optional) ────────────────────────────────
    stage1_result: Optional[Dict[str, Any]] = None
    keyword_generation_trace_by_symbol: Dict[str, Any] = {}
    if extraction_model and reasoning_model:
        print(f"Two-stage pipeline: extraction={extraction_model} | reasoning={reasoning_model}")
        stage1_result = await engine.extract_relevant_articles(posts, symbols, extraction_model)
        analysis_posts = stage1_result["filtered_posts"]
        proxy_terms_by_symbol = stage1_result["proxy_terms_by_symbol"]
        keyword_generation_trace_by_symbol = stage1_result.get("keyword_generation_trace_by_symbol", {}) or {}
    else:
        analysis_posts = posts
        proxy_terms_by_symbol = {s: [] for s in symbols}
        keyword_generation_trace_by_symbol = {}

    aggregated = _build_aggregated_news_context(analysis_posts)
    if not aggregated.strip():
        raise ValueError("No post content available for sentiment analysis")

    # ── Stage 2: per-symbol reasoning ────────────────────────────────────────
    effective_reasoning_model = reasoning_model or model_name
    analyses = await asyncio.gather(*[
        engine.analyze(
            text=_build_symbol_specific_news_context(analysis_posts, symbol, aggregated),
            text_source=f"aggregated_{symbol.lower()}",
            include_context=True,
            context_data=_build_symbol_specific_price_context(price_context, symbol),
            specialist_symbol=symbol,
            specialist_focus=_symbol_specialist_focus(symbol, prompt_overrides),
            model_override=effective_reasoning_model,
            proxy_context=format_stage2_proxy_appendix(symbol, proxy_terms_by_symbol.get(symbol, [])),
            web_research_context=web_context_by_symbol.get(symbol, ""),
        )
        for symbol in symbols
    ])
    results: Dict[str, Dict[str, Any]] = {}

    for symbol, sentiment in zip(symbols, analyses):
        directional_score = _coerce_score(
            getattr(sentiment, "directional_score", None),
            _derive_directional_score(
                signal_type=getattr(sentiment, "signal_type", None) or "",
                policy_score=sentiment.policy_score,
                bluster_score=sentiment.bluster_score,
                raw_reasoning=sentiment.reasoning,
            ),
            -1.0,
            1.0,
        )
        results[symbol] = {
            'bluster_score': _coerce_score(
                None,
                sentiment.bluster_score,
                -1.0,
                1.0,
            ),
            'policy_score': _coerce_score(
                None,
                sentiment.policy_score,
                0.0,
                1.0,
            ),
            'confidence': _coerce_score(
                None,
                sentiment.confidence,
                0.0,
                1.0,
            ),
            'directional_score': directional_score,
            'signal_type': getattr(sentiment, "signal_type", "HOLD"),
            'urgency': getattr(sentiment, "urgency", "LOW"),
            'reasoning': (sentiment.analyst_writeup or sentiment.reasoning or '').strip(),
            'is_bluster': sentiment.is_bluster,
            'is_policy_change': sentiment.is_policy_change,
            'impact_severity': sentiment.impact_severity
        }

    trace = {
        "used_two_stage": bool(extraction_model and reasoning_model),
        "pipeline_models": {
            "analysis_model": model_name or "",
            "extraction_model": extraction_model or "",
            "reasoning_model": effective_reasoning_model or "",
        },
        "aggregated_news_length": len(aggregated),
        "analysis_article_count": len(analysis_posts),
        "stage1": {
            **_build_stage1_trace(posts, analysis_posts, proxy_terms_by_symbol),
            "keyword_generation_trace_by_symbol": keyword_generation_trace_by_symbol,
        },
        "stage2_runs_by_symbol": {
            symbol: {
                "model": effective_reasoning_model or "",
                "prompt": getattr(sentiment, "prompt_used", "") or "",
                "raw_response": getattr(sentiment, "raw_model_response", "") or "",
                "parsed_payload": getattr(sentiment, "parsed_payload", {}) or {},
                "final_reasoning": results[symbol]["reasoning"],
                "signal_type": results[symbol]["signal_type"],
                "confidence": results[symbol]["confidence"],
            }
            for symbol, sentiment in zip(symbols, analyses)
        },
    }

    return results, trace


def _build_aggregated_news_context(posts: List[Any]) -> str:
    """Build the exact compiled news text passed into the model."""
    aggregated_sections: List[str] = []
    for post in posts:
        source = (
            getattr(post, 'source', None)
            or getattr(post, 'feed_name', None)
            or getattr(post, 'author', None)
            or "Unknown Source"
        )
        title = (getattr(post, 'title', '') or '').strip()
        content = (getattr(post, 'content', '') or '').strip()
        section_lines: List[str] = []
        if title:
            section_lines.append(f"Source: {source}")
            section_lines.append(f"Headline: {title}")
        if content and content != title:
            section_lines.append(f"Details: {content}")
        if section_lines:
            aggregated_sections.append("\n".join(section_lines))

    return "\n\n".join(aggregated_sections)[:12000]


def _ensure_execution_quotes(signal: TradingSignal, quotes_by_symbol: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Fallback: Fetch quotes for execution tickers that aren't already available.
    Ensures we have prices for all symbols needed for trade execution and P&L.
    """
    hydrated_quotes = dict(quotes_by_symbol)
    client = PriceClient()
    
    symbols_to_check = {signal.entry_symbol} if signal.entry_symbol else set()
    for recommendation in signal.recommendations or []:
        symbol = str(recommendation.get("symbol", "") or "").strip().upper()
        if symbol:
            symbols_to_check.add(symbol)

    missing_symbols = [s for s in symbols_to_check if s and s not in hydrated_quotes]
    
    if missing_symbols:
        print(f"[WARNING] Missing quotes for execution symbols: {missing_symbols}. Fetching now...")
        for symbol in missing_symbols:
            if not symbol:
                continue
            try:
                quote = client.get_realtime_quote(symbol)
                if quote and quote.get("current_price"):
                    hydrated_quotes[symbol] = quote
                    print(f"  ✓ Fetched {symbol}: ${quote.get('current_price'):.2f}")
                else:
                    print(f"  ✗ Failed to fetch {symbol}: no quote data")
            except Exception as e:
                print(f"  ✗ Error fetching {symbol}: {e}")

    return hydrated_quotes


def _serialize_snapshot_posts(posts: List[Any]) -> List[Dict[str, Any]]:
    serialized: List[Dict[str, Any]] = []
    for post in posts:
        serialized.append(
            {
                "source": getattr(post, "source", None),
                "feed_name": getattr(post, "feed_name", None),
                "author": getattr(post, "author", None),
                "title": getattr(post, "title", ""),
                "summary": getattr(post, "summary", ""),
                "content": getattr(post, "content", ""),
                "keywords": list(getattr(post, "keywords", None) or []),
            }
        )
    return serialized


def _restore_snapshot_posts(posts: List[Dict[str, Any]]) -> List[Any]:
    restored: List[Any] = []
    for post in posts:
        restored.append(
            SimpleNamespace(
                source=post.get("source"),
                feed_name=post.get("feed_name"),
                author=post.get("author"),
                title=post.get("title", ""),
                summary=post.get("summary", ""),
                content=post.get("content", ""),
                keywords=list(post.get("keywords") or []),
            )
        )
    return restored


def _restore_snapshot_quotes(quotes_by_symbol: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    restored: Dict[str, Dict[str, Any]] = {}
    for symbol, quote in (quotes_by_symbol or {}).items():
        normalized = dict(quote or {})
        timestamp = normalized.get("timestamp")
        if isinstance(timestamp, str):
            try:
                normalized["timestamp"] = datetime.fromisoformat(timestamp)
            except ValueError:
                pass
        restored[symbol] = normalized
    return restored


def _post_trace_summary(post: Any) -> Dict[str, Any]:
    return {
        "source": getattr(post, "source", None) or getattr(post, "feed_name", None) or getattr(post, "author", None) or "Unknown",
        "title": getattr(post, "title", "") or "",
        "summary": getattr(post, "summary", "") or "",
        "keywords": list(getattr(post, "keywords", None) or []),
    }


def _build_stage1_trace(
    posts: List[Any],
    filtered_posts: List[Any],
    proxy_terms_by_symbol: Dict[str, List[str]],
) -> Dict[str, Any]:
    filtered_ids = {id(post) for post in filtered_posts}
    article_rows: List[Dict[str, Any]] = []
    matched_count = 0

    for post in posts:
        blob = (
            f"{getattr(post, 'title', '') or ''} "
            f"{getattr(post, 'summary', '') or ''} "
            f"{getattr(post, 'content', '') or ''} "
            f"{' '.join(getattr(post, 'keywords', None) or [])}"
        ).lower()
        matched_terms_by_symbol: Dict[str, List[str]] = {}
        matched_symbols: List[str] = []
        for symbol, terms in (proxy_terms_by_symbol or {}).items():
            matched_terms = [term for term in terms if term and term.lower() in blob]
            if matched_terms:
                matched_symbols.append(symbol)
                matched_terms_by_symbol[symbol] = matched_terms[:8]
        if matched_symbols:
            matched_count += 1
        article_rows.append(
            {
                **_post_trace_summary(post),
                "selected_for_reasoning": id(post) in filtered_ids,
                "matched_symbols": matched_symbols,
                "matched_terms_by_symbol": matched_terms_by_symbol,
            }
        )

    return {
        "proxy_terms_by_symbol": proxy_terms_by_symbol,
        "matched_article_count": matched_count,
        "filtered_article_count": len(filtered_posts),
        "used_keyword_matches": bool(matched_count),
        "articles": article_rows,
    }


def _build_secret_trace(
    *,
    request_id: str,
    active_model: str,
    extraction_model: str,
    reasoning_model: str,
    risk_profile: str,
    request_payload: AnalysisRequest,
    ingestion_trace: Dict[str, Any],
    price_context: Dict[str, Any],
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    market_validation: Dict[str, Dict[str, Any]],
    web_context_by_symbol: Dict[str, str],
    web_items_by_symbol: Dict[str, List[Dict[str, Any]]],
    sentiment_results: Dict[str, Dict[str, Any]],
    sentiment_trace: Dict[str, Any],
    blue_team_signal: Any,
    trading_signal: Any,
    red_team_review: Optional[Dict[str, Any]],
    red_team_debug: Optional[Dict[str, Any]],
    backtest_results: Any,
    pipeline_events: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "request_id": request_id,
        "models": {
            "active_model": active_model,
            "extraction_model": extraction_model,
            "reasoning_model": reasoning_model,
            "risk_profile": risk_profile,
        },
        "request": {
            "symbols": list(request_payload.symbols),
            "max_posts": request_payload.max_posts,
            "include_backtest": request_payload.include_backtest,
            "lookback_days": request_payload.lookback_days,
        },
        "pipeline_events": list(pipeline_events or []),
        "ingestion": ingestion_trace,
        "market_snapshot": {
            "price_context_keys": sorted(price_context.keys()),
            "quotes_by_symbol": {
                symbol: {
                    "current_price": quote.get("current_price"),
                    "previous_close": quote.get("previous_close"),
                    "day_low": quote.get("day_low"),
                    "day_high": quote.get("day_high"),
                    "timestamp": quote.get("timestamp").isoformat() if getattr(quote.get("timestamp"), "isoformat", None) else quote.get("timestamp"),
                }
                for symbol, quote in (quotes_by_symbol or {}).items()
            },
            "market_validation": market_validation,
        },
        "web_research": {
            "web_context_by_symbol": web_context_by_symbol,
            "web_items_by_symbol": web_items_by_symbol,
        },
        "sentiment": {
            "stage_trace": sentiment_trace,
            "symbol_results": sentiment_results,
        },
        "blue_team_signal": blue_team_signal.model_dump(mode="json") if getattr(blue_team_signal, "model_dump", None) else blue_team_signal,
        "trading_signal": trading_signal.model_dump(mode="json") if getattr(trading_signal, "model_dump", None) else trading_signal,
        "red_team_review": red_team_review or {},
        "red_team_debug": red_team_debug or {},
        "backtest_results": backtest_results.model_dump(mode="json") if getattr(backtest_results, "model_dump", None) else backtest_results,
    }


def _build_dataset_snapshot(
    response: AnalysisResponse,
    posts: List[Any],
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    model_name: str,
    prompt_overrides: Optional[Dict[str, str]] = None,
    extraction_model: str = "",
    reasoning_model: str = "",
    risk_profile: str = "moderate",
    secret_trace: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    model_inputs = response.model_inputs.model_dump(mode="json") if response.model_inputs else {}
    visible_price_context = dict(model_inputs.get("price_context") or {})
    market_validation = response.market_validation or {}
    if model_inputs.get("validation_context"):
        visible_price_context["validation_context"] = model_inputs["validation_context"]
    if market_validation:
        visible_price_context["market_validation"] = market_validation

    snapshot_quotes: Dict[str, Dict[str, Any]] = {}
    for symbol, quote in (quotes_by_symbol or {}).items():
        snapshot_quotes[symbol] = {
            "symbol": symbol,
            "current_price": quote.get("current_price"),
            "previous_close": quote.get("previous_close"),
            "day_low": quote.get("day_low"),
            "day_high": quote.get("day_high"),
            "regular_market_volume": quote.get("regular_market_volume"),
            "timestamp": quote.get("timestamp").isoformat() if getattr(quote.get("timestamp"), "isoformat", None) else quote.get("timestamp"),
        }

    return {
        "version": 1,
        "saved_at": datetime.utcnow().isoformat(),
        "model_name": model_name,
        "extraction_model": extraction_model,
        "reasoning_model": reasoning_model,
        "risk_profile": risk_profile,
        "symbols": response.symbols_analyzed,
        "posts": _serialize_snapshot_posts(posts),
        "model_inputs": model_inputs,
        "price_context": visible_price_context,
        "quotes_by_symbol": snapshot_quotes,
        "market_validation": market_validation,
        "prompt_overrides": prompt_overrides or {},
        "include_backtest": response.backtest_results is not None,
        "lookback_days": response.backtest_results.lookback_days if response.backtest_results else 14,
        "secret_trace": secret_trace or {},
    }


def _build_symbol_specific_news_context(posts: List[Any], symbol: str, fallback: str) -> str:
    """Prefer symbol-relevant articles so specialists do not all see the same noise."""
    terms = expand_proxy_terms_for_matching(SYMBOL_RELEVANCE_TERMS.get(symbol.upper(), []))
    if not terms:
        return fallback

    relevant_posts: List[Any] = []
    for post in posts:
        text_blob = normalize_text_for_matching(" ".join(
            [
                str(getattr(post, "title", "") or ""),
                str(getattr(post, "summary", "") or ""),
                str(getattr(post, "content", "") or ""),
                " ".join(getattr(post, "keywords", None) or []),
            ]
        ))
        if any(term in text_blob for term in terms):
            relevant_posts.append(post)

    relevant_context = _build_aggregated_news_context(relevant_posts)
    return relevant_context or fallback


def _build_symbol_specific_price_context(price_context: Dict[str, Any], symbol: str) -> Dict[str, Any]:
    """Keep general price context but narrow validation text to the active symbol."""
    context = dict(price_context)
    context["active_symbol"] = symbol
    context["active_symbol_price"] = context.get(f"{symbol.lower()}_price", 0.0)
    market_validation = context.get("market_validation") or {}
    symbol_payload = market_validation.get(symbol, {})
    if symbol_payload:
        summary = str(symbol_payload.get("summary", "") or "").strip()
        status = str(symbol_payload.get("status", "unavailable")).upper()
        context["validation_context"] = f"{symbol} [{status}]: {summary}" if summary else ""
    # Promote per-symbol technical context key into a flat field
    tech_key = f"technical_context_{symbol.lower()}"
    if tech_key in price_context:
        context["technical_context"] = price_context[tech_key]
    return context


async def _get_symbol_web_research(
    symbols: List[str],
    enabled: bool,
    max_items_per_symbol: int,
    max_age_days: int,
    symbol_company_aliases: Optional[Dict[str, str]] = None,
) -> tuple[Dict[str, str], Dict[str, List[Dict[str, str]]]]:
    if not enabled:
        print("Light web research disabled.")
        return {}, {}

    print(
        f"Light web research enabled for: {', '.join(symbols)} "
        f"({max_items_per_symbol} items per symbol, last {max_age_days} days)"
    )
    symbol_company_aliases = symbol_company_aliases or {}

    results = await asyncio.gather(
        *[
            asyncio.to_thread(
                fetch_recent_symbol_web_context,
                symbol,
                company_alias=str(symbol_company_aliases.get(symbol, "") or "").strip(),
                max_items=max_items_per_symbol,
                max_age_days=max_age_days,
            )
            for symbol in symbols
        ],
        return_exceptions=True,
    )

    web_context_by_symbol: Dict[str, str] = {}
    web_items_by_symbol: Dict[str, List[Dict[str, str]]] = {}
    for symbol, result in zip(symbols, results):
        if isinstance(result, Exception):
            print(f"Light web research error for {symbol}: {result}")
            web_context_by_symbol[symbol] = ""
            web_items_by_symbol[symbol] = []
            continue
        web_context_by_symbol[symbol] = str(result.get("summary", "") or "").strip()
        web_items_by_symbol[symbol] = list(result.get("items") or [])
        print(
            f"Light web research for {symbol}: "
            f"{len(web_items_by_symbol[symbol])} fresh items"
        )

    return web_context_by_symbol, web_items_by_symbol


def _build_model_input_debug(
    posts: List[Any],
    price_context: Dict[str, Any],
    market_validation: Dict[str, Dict[str, Any]],
    symbols: Optional[List[str]] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
    web_context_by_symbol: Optional[Dict[str, str]] = None,
    web_items_by_symbol: Optional[Dict[str, List[Dict[str, str]]]] = None,
) -> ModelInputDebug:
    """Return a frontend-friendly view of the exact prompt inputs."""
    validation_context = str(price_context.get("validation_context", "") or "")
    visible_price_context = {
        key: value
        for key, value in price_context.items()
        if key.endswith("_price")
    }
    articles: List[ModelInputArticle] = []
    for post in posts:
        source = (
            getattr(post, 'source', None)
            or getattr(post, 'feed_name', None)
            or getattr(post, 'author', None)
            or "Unknown Source"
        )
        title = (getattr(post, 'title', '') or '').strip()
        description = (getattr(post, 'content', '') or '').strip()
        keywords = [
            str(keyword).strip()
            for keyword in (getattr(post, 'keywords', None) or [])
            if str(keyword).strip()
        ]
        if not title and not description:
            continue
        articles.append(
            ModelInputArticle(
                source=str(source),
                title=title,
                description="" if description == title else description,
                keywords=keywords[:8],
            )
        )

    return ModelInputDebug(
        news_context=_build_aggregated_news_context(posts),
        validation_context=validation_context,
        price_context=visible_price_context,
        articles=articles,
        per_symbol_prompts=_build_per_symbol_prompts(
            posts,
            price_context,
            symbols or [],
            prompt_overrides,
            web_context_by_symbol=web_context_by_symbol,
        ),
        web_context_by_symbol=web_context_by_symbol or {},
        web_items_by_symbol=web_items_by_symbol or {},
    )


def _build_per_symbol_prompts(
    posts: List[Any],
    price_context: Dict[str, Any],
    symbols: List[str],
    prompt_overrides: Optional[Dict[str, str]] = None,
    web_context_by_symbol: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Build the exact specialist prompt preview for each requested symbol."""
    aggregated = _build_aggregated_news_context(posts)
    if not aggregated.strip():
        return {}

    prompts: Dict[str, str] = {}
    web_context_by_symbol = web_context_by_symbol or {}
    for symbol in symbols:
        symbol_context = _build_symbol_specific_price_context(price_context, symbol)
        symbol_text = _build_symbol_specific_news_context(posts, symbol, aggregated)
        validation_ctx = str(symbol_context.get("validation_context", "") or "")
        technical_ctx  = str(symbol_context.get("technical_context", "") or "")
        combined_validation = "\n\n".join(filter(None, [validation_ctx, technical_ctx]))
        prompts[symbol] = format_symbol_specialist_context_prompt(
            symbol=symbol,
            specialist_focus=_symbol_specialist_focus(symbol, prompt_overrides),
            text=symbol_text,
            date=datetime.utcnow().strftime("%Y-%m-%d"),
            active_symbol=str(symbol_context.get("active_symbol", symbol)),
            active_symbol_price=float(symbol_context.get("active_symbol_price", 0.0) or 0.0),
            uso_price=float(symbol_context.get("uso_price", 0.0) or 0.0),
            bito_price=float(symbol_context.get("bito_price", 0.0) or 0.0),
            qqq_price=float(symbol_context.get("qqq_price", 0.0) or 0.0),
            spy_price=float(symbol_context.get("spy_price", 0.0) or 0.0),
            recent_sentiment=str(symbol_context.get("recent_sentiment", "") or ""),
            validation_context=combined_validation,
            web_research_context=web_context_by_symbol.get(symbol, ""),
        )
    return prompts


def _coerce_score(value: Any, default: float, lower: float, upper: float) -> float:
    """Safely coerce model-provided scores into bounded floats."""
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = float(default)
    return max(lower, min(upper, numeric))


def _get_symbol_specialist_focus_with_overrides(symbol: str, prompt_overrides: Optional[Dict[str, str]] = None) -> str:
    """Get specialist focus for a symbol, optionally with admin overrides."""
    base_focus = get_symbol_specialist_focus(symbol)
    override = ((prompt_overrides or {}).get(symbol) or "").strip()
    if override:
        return f"{base_focus}\n\nAdditional admin guidance for {symbol}:\n{override}"
    return base_focus


def _symbol_specialist_focus(symbol: str, prompt_overrides: Optional[Dict[str, str]] = None) -> str:
    """Describe the specialist lens to use for a given symbol.
    
    Deprecated: Use _get_symbol_specialist_focus_with_overrides instead.
    Kept for backwards compatibility.
    """
    return _get_symbol_specialist_focus_with_overrides(symbol, prompt_overrides)


def _derive_directional_score(
    signal_type: str,
    policy_score: float,
    bluster_score: float,
    raw_reasoning: str,
) -> float:
    """Map specialist output onto a signed per-symbol direction score."""
    normalized_signal = (signal_type or "").upper().strip()
    if normalized_signal == "LONG":
        return min(1.0, max(0.15, policy_score))
    if normalized_signal == "SHORT":
        return max(-1.0, min(-0.15, -max(abs(bluster_score), policy_score)))

    reasoning = (raw_reasoning or "").lower()
    positive_hints = ["bullish", "beneficiary", "re-rate higher", "rally", "positive for"]
    negative_hints = ["bearish", "headwind", "sell-off", "negative for", "pressure on"]
    if any(token in reasoning for token in positive_hints):
        return min(1.0, max(0.1, policy_score * 0.8))
    if any(token in reasoning for token in negative_hints):
        return max(-1.0, min(-0.1, -max(abs(bluster_score), policy_score * 0.8)))
    return 0.0


def _resolve_leverage(confidence: float, risk_profile: str, action: str = "") -> str:
    profile = str(risk_profile or "moderate").lower().strip()
    if profile == "conservative":
        # Inverse ETF for bearish (broker-friendly, no shorting), underlying for bullish — 1x position sizing throughout
        return "inverse" if str(action).upper() == "SELL" else "1x"
    if profile == "moderate":
        return "2x" if confidence > 0.75 else "1x"
    if profile == "crazy":
        return "3x"
    # aggressive: 3x if confidence > 0.75, else 1x
    return "3x" if confidence > 0.75 else "1x"


def _is_closed_market_session(quotes_by_symbol: Optional[Dict[str, Dict[str, Any]]]) -> bool:
    """Return True when all fetched quotes indicate the market is fully closed."""
    if not quotes_by_symbol:
        return False
    sessions = {
        str((quote or {}).get("session") or "").lower().strip()
        for quote in quotes_by_symbol.values()
        if isinstance(quote, dict)
    }
    sessions.discard("")
    return bool(sessions) and sessions.issubset({"closed"})


def _latest_previous_analysis_response(
    db: Optional[Session],
    max_age_hours: int = 8,
) -> Optional[AnalysisResponse]:
    """Load the most recent saved analysis if it is still recent enough to use for hysteresis."""
    if db is None:
        return None
    latest = (
        db.query(AnalysisResult)
        .order_by(AnalysisResult.timestamp.desc())
        .first()
    )
    if not latest:
        return None
    response = _load_saved_analysis_response(latest)
    latest_ts = latest.timestamp
    if latest_ts.tzinfo is None:
        latest_ts = latest_ts.replace(tzinfo=timezone.utc)
    else:
        latest_ts = latest_ts.astimezone(timezone.utc)
    age_hours = (datetime.now(timezone.utc) - latest_ts).total_seconds() / 3600.0
    if age_hours > max_age_hours:
        return None
    return response


def _latest_previous_analysis_state(
    db: Optional[Session],
    max_age_hours: int = 8,
) -> Optional[Dict[str, Any]]:
    """Return the most recent saved analysis plus its reconstructed response and snapshot metadata."""
    if db is None:
        return None
    latest = (
        db.query(AnalysisResult)
        .order_by(AnalysisResult.timestamp.desc())
        .first()
    )
    if not latest:
        return None
    latest_ts = latest.timestamp
    if latest_ts.tzinfo is None:
        latest_ts = latest_ts.replace(tzinfo=timezone.utc)
    else:
        latest_ts = latest_ts.astimezone(timezone.utc)
    age_hours = (datetime.now(timezone.utc) - latest_ts).total_seconds() / 3600.0
    if age_hours > max_age_hours:
        return None
    metadata = latest.run_metadata or {}
    snapshot = metadata.get("dataset_snapshot") or {}
    return {
        "analysis": latest,
        "response": _load_saved_analysis_response(latest),
        "snapshot": snapshot,
        "quotes_by_symbol": snapshot.get("quotes_by_symbol") or {},
    }


def _max_sentiment_input_delta(
    current_sentiment_results: Dict[str, Dict[str, Any]],
    previous_response: Optional[AnalysisResponse],
) -> float:
    """Compare current vs previous sentiment inputs to avoid freezing legitimate regime changes."""
    if not previous_response or not previous_response.sentiment_scores:
        return 999.0
    deltas: List[float] = []
    for symbol, current in current_sentiment_results.items():
        previous = previous_response.sentiment_scores.get(symbol)
        if not previous:
            continue
        deltas.append(abs(float(current.get("policy_score", 0.0)) - float(previous.policy_change)))
        deltas.append(abs(float(current.get("bluster_score", 0.0)) - float(previous.market_bluster)))
        deltas.append(abs(float(current.get("confidence", 0.0)) - float(previous.confidence)))
    return max(deltas) if deltas else 999.0


def _max_price_move_vs_previous_pct(
    symbols: List[str],
    current_quotes: Optional[Dict[str, Dict[str, Any]]],
    previous_quotes: Optional[Dict[str, Dict[str, Any]]],
) -> float:
    """Compare current prices to the previous run's prices and return the largest absolute move."""
    if not current_quotes or not previous_quotes:
        return 999.0
    moves: List[float] = []
    for symbol in symbols:
        current_quote = current_quotes.get(symbol) or {}
        previous_quote = previous_quotes.get(symbol) or {}
        current_price = float(current_quote.get("current_price") or 0.0)
        previous_price = float(previous_quote.get("current_price") or 0.0)
        if current_price > 0 and previous_price > 0:
            moves.append(abs(current_price - previous_price) / previous_price * 100.0)
    return max(moves) if moves else 999.0


def _max_atr_pct(symbols: List[str], price_context: Optional[Dict[str, Any]]) -> float:
    """Return the largest available ATR percent across active symbols for price-move gating."""
    if not price_context:
        return 0.0
    atr_values: List[float] = []
    for symbol in symbols:
        indicators = price_context.get(f"technical_indicators_{str(symbol).lower()}") or {}
        try:
            atr_pct = float(indicators.get("atr_14_pct") or 0.0)
        except (TypeError, ValueError):
            atr_pct = 0.0
        if atr_pct > 0:
            atr_values.append(atr_pct)
    return max(atr_values) if atr_values else 0.0


def _signals_differ_materially(
    previous_signal: Optional[TradingSignal],
    current_signal: Optional[TradingSignal],
) -> bool:
    """Check whether two signals differ in thesis or recommendation composition."""
    if previous_signal is None or current_signal is None:
        return True
    if str(previous_signal.signal_type or "HOLD").upper() != str(current_signal.signal_type or "HOLD").upper():
        return True
    prev_map = _recommendations_by_underlying(previous_signal)
    cur_map = _recommendations_by_underlying(current_signal)
    if set(prev_map.keys()) != set(cur_map.keys()):
        return True
    for symbol in prev_map:
        prev = prev_map.get(symbol) or {}
        cur = cur_map.get(symbol) or {}
        if (
            str(prev.get("action") or "").upper() != str(cur.get("action") or "").upper()
            or str(prev.get("symbol") or "").upper() != str(cur.get("symbol") or "").upper()
            or str(prev.get("leverage") or "") != str(cur.get("leverage") or "")
        ):
            return True
    return False


def _material_change_gate(
    *,
    symbols: List[str],
    posts_count: int,
    sentiment_results: Dict[str, Dict[str, Any]],
    price_context: Dict[str, Any],
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    previous_state: Optional[Dict[str, Any]],
    candidate_signal: Optional[TradingSignal],
) -> bool:
    """Return True when a thesis flip is justified by meaningful news or price movement."""
    if previous_state is None:
        return True
    previous_response = previous_state.get("response")
    previous_quotes = previous_state.get("quotes_by_symbol") or {}
    previous_signal = (previous_response.blue_team_signal or previous_response.trading_signal) if previous_response else None
    if not _signals_differ_materially(previous_signal, candidate_signal):
        return True

    posts_delta = abs(int(getattr(previous_response, "posts_scraped", 0) or 0) - int(posts_count or 0)) if previous_response else 999
    sentiment_delta = _max_sentiment_input_delta(sentiment_results, previous_response)
    price_move_pct = _max_price_move_vs_previous_pct(symbols, quotes_by_symbol, previous_quotes)
    atr_pct = _max_atr_pct(symbols, price_context)
    material_price_threshold = max(0.75, min(3.0, atr_pct * 0.5 if atr_pct > 0 else 1.0))

    return (
        posts_delta >= 6
        or sentiment_delta >= 0.24
        or price_move_pct >= material_price_threshold
    )


def _generate_trading_signal(
    sentiment_results: Dict[str, Dict],
    quotes_by_symbol: Optional[Dict[str, Dict[str, Any]]] = None,
    risk_profile: str = "aggressive",
    previous_signal: Optional[TradingSignal] = None,
    stability_mode: str = "normal",
) -> TradingSignal:
    if not sentiment_results:
        return TradingSignal(
            signal_type="HOLD", confidence_score=0.0,
            entry_symbol="USO", stop_loss_pct=2.0, take_profit_pct=3.0, urgency="LOW",
            conviction_level="LOW", holding_period_hours=2, trading_type="VOLATILE_EVENT",
            action_if_already_in_position="HOLD"
        )

    symbols = list(sentiment_results.keys())
    recommendations: List[Dict[str, str]] = []
    urgency_rank = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    overall_urgency = "LOW"
    strongest_symbol = symbols[0] if symbols else "USO"
    strongest_execution_symbol = strongest_symbol
    strongest_score = -1.0
    net_direction_score = 0.0
    total_weight = 0.0
    long_recommendations = 0
    short_recommendations = 0
    hold_recommendations = 0
    previous_recommendations = _recommendations_by_underlying(previous_signal)
    is_closed_hysteresis = stability_mode == "closed_market_hysteresis"
    entry_threshold = 0.42 if is_closed_hysteresis else 0.30
    keep_threshold = 0.22 if is_closed_hysteresis else 0.30

    for sym, result in sentiment_results.items():
        directional = result.get('directional_score', 0.0)
        confidence = result['confidence']
        specialist_signal = str(result.get('signal_type', 'HOLD')).upper()
        specialist_urgency = str(result.get('urgency', 'LOW')).upper()
        previous_action = str((previous_recommendations.get(sym) or {}).get("action", "")).upper().strip()

        if directional <= -entry_threshold or (previous_action == "SELL" and directional <= -keep_threshold):
            action = "SELL"
            urgency = specialist_urgency if specialist_signal == "SHORT" else ("HIGH" if abs(directional) > 0.7 else "MEDIUM")
            short_recommendations += 1
        elif directional >= entry_threshold or (previous_action == "BUY" and directional >= keep_threshold):
            action = "BUY"
            urgency = specialist_urgency if specialist_signal == "LONG" else ("HIGH" if directional > 0.7 else "MEDIUM")
            long_recommendations += 1
        else:
            action = ""
            urgency = specialist_urgency if specialist_signal == "HOLD" else "LOW"
            hold_recommendations += 1

        leverage = _resolve_leverage(confidence, risk_profile, action=action)
        recommendation = None
        if action:
            recommendation = build_execution_recommendation(sym, action, leverage)
            recommendations.append(recommendation)

        conviction = abs(directional) * confidence
        actual_leverage_label = recommendation["leverage"] if recommendation else leverage
        leverage_weight = float(actual_leverage_label.lower().replace("x", "")) if actual_leverage_label else 1.0
        directional_weight = max(abs(directional), 0.1) * leverage_weight
        net_direction_score += directional * directional_weight
        total_weight += directional_weight

        if conviction > strongest_score:
            strongest_score = conviction
            strongest_symbol = sym
            strongest_execution_symbol = recommendation["symbol"] if action else sym

        if urgency_rank[urgency] > urgency_rank[overall_urgency]:
            overall_urgency = urgency

    normalized_basket_score = (net_direction_score / total_weight) if total_weight > 0 else 0.0

    basket_entry_threshold = 0.28 if is_closed_hysteresis else 0.18
    basket_keep_threshold = 0.10 if is_closed_hysteresis else 0.18
    previous_signal_type = str(getattr(previous_signal, "signal_type", "HOLD") or "HOLD").upper().strip()

    if long_recommendations == len(symbols) and len(symbols) > 0:
        signal_type = "LONG"
    elif short_recommendations == len(symbols) and len(symbols) > 0:
        signal_type = "SHORT"
    elif hold_recommendations == len(symbols) and len(symbols) > 0:
        signal_type = "HOLD"
    elif previous_signal_type == "LONG" and normalized_basket_score >= basket_keep_threshold:
        signal_type = "LONG"
    elif previous_signal_type == "SHORT" and normalized_basket_score <= -basket_keep_threshold:
        signal_type = "SHORT"
    elif normalized_basket_score >= basket_entry_threshold:
        signal_type = "LONG"
    elif normalized_basket_score <= -basket_entry_threshold:
        signal_type = "SHORT"
    else:
        signal_type = "HOLD"

    avg_confidence = sum(result['confidence'] for result in sentiment_results.values()) / len(sentiment_results)
    basket_confidence = min(1.0, max(abs(normalized_basket_score), 0.0) * 1.35)
    confidence_score = avg_confidence if signal_type == "HOLD" else min(1.0, avg_confidence * 0.55 + basket_confidence * 0.45)

    if signal_type != "HOLD":
        matching_recommendations = [
            rec
            for rec in recommendations
            if rec.get("thesis") == signal_type
        ]
        if matching_recommendations:
            strongest_recommendation = max(
                matching_recommendations,
                key=lambda rec: abs(float(sentiment_results[rec["underlying_symbol"]].get("directional_score", 0.0)))
                * float(sentiment_results[rec["underlying_symbol"]].get("confidence", 0.0)),
            )
            strongest_symbol = strongest_recommendation["underlying_symbol"]
            strongest_execution_symbol = strongest_recommendation["symbol"]

    if abs(normalized_basket_score) < basket_entry_threshold:
        overall_urgency = "LOW"

    # ── Determine conviction level and trading type ──────────────────────────
    # Conviction levels: LOW (reactive), MEDIUM (data-driven), HIGH (structural)
    
    # Extract conviction_level from sentiment engine output if available
    conviction_level_from_engine = None
    trading_type_from_engine = None
    holding_period_from_engine = None
    
    for sym, result in sentiment_results.items():
        eng_conviction = str(result.get("conviction_level", "")).upper()
        if eng_conviction in ("LOW", "MEDIUM", "HIGH"):
            conviction_level_from_engine = eng_conviction
            break
        eng_trading_type = str(result.get("trading_type", "")).upper()
        if eng_trading_type in ("SCALP", "SWING", "POSITION", "VOLATILE_EVENT"):
            trading_type_from_engine = eng_trading_type
            break
        eng_holding = result.get("holding_period_hours")
        if isinstance(eng_holding, int) and 1 <= eng_holding <= 720:
            holding_period_from_engine = eng_holding
            break
    
    # Fallback to logic based on confidence and urgency if not provided
    if conviction_level_from_engine:
        conviction_level = conviction_level_from_engine
    else:
        if signal_type == "HOLD":
            conviction_level = "LOW"
        elif abs(normalized_basket_score) > 0.6 and confidence_score > 0.7:
            conviction_level = "HIGH"  # Strong structural signal
        elif overall_urgency == "HIGH" and confidence_score < 0.6:
            conviction_level = "LOW"  # Reactive bluster
        else:
            conviction_level = "MEDIUM"  # Data-driven swing
    
    if trading_type_from_engine:
        trading_type = trading_type_from_engine
    else:
        if conviction_level == "LOW":
            trading_type = "VOLATILE_EVENT"
        elif conviction_level == "MEDIUM":
            trading_type = "SWING"
        else:  # HIGH
            trading_type = "POSITION"
    
    if holding_period_from_engine:
        holding_period_hours = holding_period_from_engine
    else:
        # Default holding periods by trading type
        if trading_type == "SCALP":
            holding_period_hours = 2
        elif trading_type == "SWING":
            holding_period_hours = 12
        elif trading_type == "POSITION":
            holding_period_hours = 72
        else:  # VOLATILE_EVENT
            holding_period_hours = 2
    
    # Determine action if already in position
    action_if_already_in_position = "HOLD"  # Default: let existing position run
    
    return TradingSignal(
        signal_type=signal_type,
        confidence_score=min(confidence_score, 1.0),
        entry_symbol=strongest_execution_symbol,
        entry_price=(quotes_by_symbol or {}).get(strongest_execution_symbol, {}).get("current_price") if symbols else None,
        stop_loss_pct=2.0,
        take_profit_pct=3.0,
        urgency=overall_urgency,
        conviction_level=conviction_level,
        holding_period_hours=holding_period_hours,
        trading_type=trading_type,
        action_if_already_in_position=action_if_already_in_position,
        recommendations=recommendations,
    )


def _build_consensus_trading_signal(
    blue_team_signal: TradingSignal,
    red_team_review: Optional[RedTeamReview],
    quotes_by_symbol: Optional[Dict[str, Dict[str, Any]]] = None,
    risk_profile: str = "moderate",
) -> TradingSignal:
    """Combine the blue-team signal with the red-team review, using red-team adjustments as final consensus."""
    if not red_team_review or not red_team_review.symbol_reviews:
        return blue_team_signal

    recommendations: List[Dict[str, str]] = []
    urgency_rank = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    overall_urgency = "LOW"
    strongest_symbol = blue_team_signal.entry_symbol or "USO"
    strongest_execution_symbol = strongest_symbol
    strongest_confidence = -1.0
    signed_scores: List[float] = []
    stop_loss_candidates: List[float] = []

    blue_signal_type = str(blue_team_signal.signal_type or "HOLD").upper()
    source_bias = bool(red_team_review.source_bias_penalty_applied)
    blue_rec_map = _recommendations_by_underlying(blue_team_signal)

    for review in red_team_review.symbol_reviews:
        symbol = str(review.symbol or "").upper().strip()
        adjusted_signal = str(review.adjusted_signal or "HOLD").upper().strip()
        adjusted_urgency = str(review.adjusted_urgency or "LOW").upper().strip()
        blue_rec = blue_rec_map.get(symbol) or {}
        blue_symbol_signal = str(blue_rec.get("action") or ("HOLD" if not blue_rec else blue_signal_type)).upper().strip()
        if blue_symbol_signal in {"LONG", "SHORT"}:
            blue_symbol_signal = "BUY" if blue_symbol_signal == "LONG" else "SELL"
        if not SentimentEngine.red_team_override_is_material(
            adjusted_signal=adjusted_signal,
            blue_signal=blue_symbol_signal,
            evidence=list(review.evidence or []),
            key_risks=list(review.key_risks or []),
            source_bias_applied=source_bias,
        ):
            adjusted_signal = blue_symbol_signal or "HOLD"
        # Python computes confidence and stop-loss — LLM no longer outputs raw floats
        adjusted_confidence = SentimentEngine.compute_red_team_confidence(
            adjusted_signal=adjusted_signal,
            blue_signal=blue_symbol_signal or blue_signal_type,
            evidence=list(review.evidence or []),
            key_risks=list(review.key_risks or []),
            source_bias_applied=source_bias,
        )
        stop_loss = SentimentEngine.compute_red_team_stop_loss(adjusted_urgency)

        if adjusted_urgency in urgency_rank and urgency_rank[adjusted_urgency] > urgency_rank[overall_urgency]:
            overall_urgency = adjusted_urgency

        stop_loss_candidates.append(stop_loss)

        if adjusted_signal == "BUY":
            action = "BUY"
            signed_scores.append(max(0.1, adjusted_confidence))
        elif adjusted_signal == "SELL":
            action = "SELL"
            signed_scores.append(-max(0.1, adjusted_confidence))
        else:
            action = ""
            signed_scores.append(0.0)

        if not action or not symbol:
            continue

        leverage = _resolve_leverage(adjusted_confidence, risk_profile, action=action)
        recommendation = build_execution_recommendation(symbol, action, leverage)
        recommendations.append(recommendation)

        if adjusted_confidence > strongest_confidence:
            strongest_confidence = adjusted_confidence
            strongest_symbol = symbol
            strongest_execution_symbol = recommendation["symbol"]

    # Confidence is now Python-computed per review and collected in signed_scores magnitude
    computed_confidences = []
    for rv in red_team_review.symbol_reviews:
        rv_symbol = str(rv.symbol or "").upper().strip()
        rv_blue_signal = str((blue_rec_map.get(rv_symbol) or {}).get("action") or blue_signal_type).upper()
        rv_adjusted_signal = str(rv.adjusted_signal or "HOLD").upper()
        if not SentimentEngine.red_team_override_is_material(
            adjusted_signal=rv_adjusted_signal,
            blue_signal=rv_blue_signal,
            evidence=list(rv.evidence or []),
            key_risks=list(rv.key_risks or []),
            source_bias_applied=source_bias,
        ):
            rv_adjusted_signal = str((blue_rec_map.get(rv_symbol) or {}).get("action") or "HOLD").upper()
        computed_confidences.append(
            SentimentEngine.compute_red_team_confidence(
                adjusted_signal=rv_adjusted_signal,
                blue_signal=rv_blue_signal,
                evidence=list(rv.evidence or []),
                key_risks=list(rv.key_risks or []),
                source_bias_applied=source_bias,
            )
        )

    if recommendations:
        avg_signed = sum(signed_scores) / max(1, len(signed_scores))
        if avg_signed >= 0.18:
            signal_type = "LONG"
        elif avg_signed <= -0.18:
            signal_type = "SHORT"
        else:
            signal_type = "HOLD"
        confidence_score = sum(computed_confidences) / len(computed_confidences)
    else:
        signal_type = "HOLD"
        confidence_score = sum(computed_confidences) / max(1, len(computed_confidences))
        strongest_execution_symbol = blue_team_signal.entry_symbol or strongest_execution_symbol

    if confidence_score >= 0.75:
        conviction_level = "HIGH"
    elif confidence_score >= 0.45:
        conviction_level = "MEDIUM"
    else:
        conviction_level = "LOW"

    if signal_type == "HOLD":
        conviction_level = "LOW"

    if conviction_level == "HIGH":
        trading_type = "POSITION"
        holding_period_hours = max(24, blue_team_signal.holding_period_hours or 24)
    elif conviction_level == "MEDIUM":
        trading_type = "SWING"
        holding_period_hours = min(max(4, blue_team_signal.holding_period_hours or 12), 24)
    else:
        trading_type = "VOLATILE_EVENT"
        holding_period_hours = 2

    stop_loss_pct = sum(stop_loss_candidates) / len(stop_loss_candidates) if stop_loss_candidates else blue_team_signal.stop_loss_pct

    consensus_signal = TradingSignal(
        signal_type=signal_type,
        confidence_score=min(confidence_score, 1.0),
        entry_symbol=strongest_execution_symbol,
        entry_price=(quotes_by_symbol or {}).get(strongest_execution_symbol, {}).get("current_price"),
        stop_loss_pct=round(float(stop_loss_pct or blue_team_signal.stop_loss_pct or 2.0), 2),
        take_profit_pct=blue_team_signal.take_profit_pct,
        position_size_usd=blue_team_signal.position_size_usd,
        urgency=overall_urgency,
        conviction_level=conviction_level,
        holding_period_hours=holding_period_hours,
        trading_type=trading_type,
        action_if_already_in_position=blue_team_signal.action_if_already_in_position,
        recommendations=recommendations,
    )
    return consensus_signal


def _build_red_team_context(
    *,
    symbols: List[str],
    posts: List[Any],
    sentiment_results: Dict[str, Dict[str, Any]],
    trading_signal: TradingSignal,
    price_context: Dict[str, Any],
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    market_validation: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    latest_news = []
    for post in posts[:10]:
        latest_news.append(
            {
                "source": str(getattr(post, "source", "") or ""),
                "title": str(getattr(post, "title", "") or ""),
                "summary": str(getattr(post, "summary", "") or getattr(post, "content", "") or "")[:400],
                "keywords": list(getattr(post, "keywords", None) or [])[:8],
            }
        )

    source_counts: Dict[str, int] = {}
    for item in latest_news:
        source = item["source"] or "Unknown"
        source_counts[source] = source_counts.get(source, 0) + 1

    symbol_payloads = []
    rec_map = {
        (rec.get("underlying_symbol") or rec.get("symbol")): rec
        for rec in (trading_signal.recommendations or [])
    }
    for symbol in symbols:
        symbol_payloads.append(
            {
                "symbol": symbol,
                "recommendation": rec_map.get(symbol, {}),
                "sentiment": sentiment_results.get(symbol, {}),
                "quote": quotes_by_symbol.get(symbol, {}),
                "technical_indicators": price_context.get(f"technical_indicators_{symbol.lower()}", {}),
                "technical_context": price_context.get(f"technical_context_{symbol.lower()}", ""),
                "market_validation": market_validation.get(symbol, {}),
            }
        )

    return {
        "symbols": symbols,
        "portfolio_signal": trading_signal.model_dump(mode="json"),
        "latest_news": latest_news,
        "source_counts": source_counts,
        "symbol_context": symbol_payloads,
    }


async def _run_red_team_review(
    *,
    model_name: str,
    symbols: List[str],
    posts: List[Any],
    sentiment_results: Dict[str, Dict[str, Any]],
    trading_signal: TradingSignal,
    price_context: Dict[str, Any],
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    market_validation: Dict[str, Dict[str, Any]],
) -> Tuple[Optional[RedTeamReview], Optional[RedTeamDebug]]:
    if not symbols:
        return None, None

    context = _build_red_team_context(
        symbols=symbols,
        posts=posts,
        sentiment_results=sentiment_results,
        trading_signal=trading_signal,
        price_context=price_context,
        quotes_by_symbol=quotes_by_symbol,
        market_validation=market_validation,
    )
    prompt = format_red_team_review_prompt(json.dumps(context, ensure_ascii=True, default=str, indent=2))
    engine = SentimentEngine(model_name=model_name)
    raw = await engine._call_ollama(prompt, model_override=model_name, force_json=True, max_tokens=700)
    raw_text = engine._strip_thinking(raw.get("response", ""))
    text = raw_text.strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        raise ValueError("Red-team review did not return valid JSON")
    payload = engine._parse_json_with_repair(engine._sanitize_json(text[start:end]))
    review = RedTeamReview.model_validate(payload)
    debug = RedTeamDebug(
        context=context,
        prompt=prompt,
        raw_response=raw_text,
        parsed_payload=payload,
        signal_changes=[],
    )
    return review, debug


async def _run_backtest(
    symbols: List[str],
    sentiment_results: Dict[str, Dict],
    lookback_days: int = 14
) -> BacktestResults:
    optimizer = RollingWindowOptimizer(
        lookback_days=lookback_days,
        test_period_days=7,
        step_days=1,
        leverage=3.0
    )

    client = PriceClient()
    prices_data = {}

    for symbol in symbols:
        try:
            prices_df = client.get_historical_data([symbol], period="6mo")
            if symbol in prices_df and not prices_df[symbol].empty:
                prices_data[symbol] = prices_df[symbol]['Close']
        except Exception as e:
            print(f"Error fetching {symbol} data: {e}")

    if not prices_data:
        return BacktestResults(
            total_return=0.0,
            annualized_return=0.0,
            sharpe_ratio=0.0,
            max_drawdown=0.0,
            win_rate=0.0,
            total_trades=0,
            lookback_days=lookback_days,
            walk_forward_steps=0
        )

    symbol = list(prices_data.keys())[0]
    result = optimizer.optimize(
        prices=prices_data[symbol],
        signal_thresholds=[-0.5, -0.3, -0.1, 0.1, 0.3]
    )

    summary = result.get('summary', {})

    return BacktestResults(
        total_return=summary.get('avg_total_return', 0.0),
        annualized_return=summary.get('avg_sharpe_ratio', 0.0) * 10,
        sharpe_ratio=summary.get('avg_sharpe_ratio', 0.0),
        max_drawdown=summary.get('avg_max_drawdown', 0.0),
        win_rate=0.0,
        total_trades=0,
        lookback_days=lookback_days,
        walk_forward_steps=result.get('num_windows', 0)
    )


def _aggregate_sentiment(sentiment_results: Dict[str, Dict]) -> Optional[SentimentScore]:
    if not sentiment_results:
        return None

    avg_bluster = sum(r['bluster_score'] for r in sentiment_results.values()) / len(sentiment_results)
    avg_policy = sum(r['policy_score'] for r in sentiment_results.values()) / len(sentiment_results)
    avg_confidence = sum(r['confidence'] for r in sentiment_results.values()) / len(sentiment_results)
    representative_reasoning = next(
        (
            (result.get('reasoning') or '').strip()
            for result in sentiment_results.values()
            if (result.get('reasoning') or '').strip()
        ),
        "Aggregated across all analyzed sources"
    )

    return SentimentScore(
        market_bluster=avg_bluster,
        policy_change=avg_policy,
        confidence=avg_confidence,
        reasoning=representative_reasoning
    )


def _prune_saved_analyses(db: Session, keep_limit: int) -> None:
    """Keep only the most recent saved analyses and delete related trade history for older ones."""
    normalized_limit = max(1, min(100, int(keep_limit)))
    stale_analyses = (
        db.query(AnalysisResult)
        .order_by(AnalysisResult.timestamp.desc())
        .offset(normalized_limit)
        .all()
    )
    if not stale_analyses:
        return

    stale_analysis_ids = [analysis.id for analysis in stale_analyses]
    stale_trades = db.query(Trade).filter(Trade.analysis_id.in_(stale_analysis_ids)).all()
    stale_trade_ids = [trade.id for trade in stale_trades]

    if stale_trade_ids:
        db.query(TradeExecution).filter(TradeExecution.trade_id.in_(stale_trade_ids)).delete(synchronize_session=False)
        db.query(TradeSnapshot).filter(TradeSnapshot.trade_id.in_(stale_trade_ids)).delete(synchronize_session=False)
        db.query(Trade).filter(Trade.id.in_(stale_trade_ids)).delete(synchronize_session=False)

    db.query(TradingSignalModel).filter(TradingSignalModel.analysis_id.in_(stale_analysis_ids)).delete(synchronize_session=False)
    db.query(AnalysisResult).filter(AnalysisResult.id.in_(stale_analysis_ids)).delete(synchronize_session=False)


def _save_analysis_result(
    db: Session,
    request_id: str,
    response: AnalysisResponse,
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    posts: Optional[List[Any]] = None,
    model_name: str = "",
    prompt_overrides: Optional[Dict[str, str]] = None,
    dataset_snapshot: Optional[Dict[str, Any]] = None,
    extraction_model: str = "",
    reasoning_model: str = "",
    risk_profile: str = "moderate",
    secret_trace: Optional[Dict[str, Any]] = None,
    sentiment_results: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        frozen_snapshot = dataset_snapshot or _build_dataset_snapshot(
            response=response,
            posts=posts or [],
            quotes_by_symbol=quotes_by_symbol,
            model_name=model_name,
            prompt_overrides=prompt_overrides,
            extraction_model=extraction_model,
            reasoning_model=reasoning_model,
            risk_profile=risk_profile,
            secret_trace=secret_trace,
        )
        analysis = AnalysisResult(
            request_id=request_id,
            sentiment_data={
                "sentiment_scores": {
                    symbol: {
                        "market_bluster": score.market_bluster,
                        "policy_change": score.policy_change,
                        "confidence": score.confidence,
                        "reasoning": score.reasoning
                    }
                    for symbol, score in response.sentiment_scores.items()
                },
                "aggregated_sentiment": {
                    "market_bluster": response.aggregated_sentiment.market_bluster if response.aggregated_sentiment else 0,
                    "policy_change": response.aggregated_sentiment.policy_change if response.aggregated_sentiment else 0,
                    "confidence": response.aggregated_sentiment.confidence if response.aggregated_sentiment else 0
                },
                "market_validation": response.market_validation,
            },
            signal={
                "signal_type": response.trading_signal.signal_type if response.trading_signal else "HOLD",
                "confidence_score": response.trading_signal.confidence_score if response.trading_signal else 0,
                "urgency": response.trading_signal.urgency if response.trading_signal else "LOW",
                "entry_symbol": response.trading_signal.entry_symbol if response.trading_signal else "",
                "recommendations": response.trading_signal.recommendations if response.trading_signal else [],
            },
            backtest_results={
                "total_return": response.backtest_results.total_return if response.backtest_results else 0,
                "sharpe_ratio": response.backtest_results.sharpe_ratio if response.backtest_results else 0
            } if response.backtest_results else None,
            run_metadata={
                "symbols": response.symbols_analyzed,
                "posts_scraped": response.posts_scraped,
                "processing_time_ms": response.processing_time_ms,
                "model_name": model_name,
                "risk_profile": risk_profile,
                "blue_team_signal": response.blue_team_signal.model_dump(mode="json") if response.blue_team_signal else None,
                "red_team_review": response.red_team_review.model_dump(mode="json") if response.red_team_review else None,
                "red_team_debug": response.red_team_debug.model_dump(mode="json") if response.red_team_debug else None,
                "dataset_snapshot": frozen_snapshot,
                "secret_trace": secret_trace or frozen_snapshot.get("secret_trace") or {},
            }
        )
        db.add(analysis)
        db.flush()
        persist_recommendation_trades(
            db=db,
            analysis_id=analysis.id,
            request_id=request_id,
            response=response,
            quotes_by_symbol=quotes_by_symbol,
        )
        # Paper trading — auto-simulate $100 per signal during market hours
        try:
            from services.paper_trading import process_signals as _paper_process_signals
            recs_by_underlying = {}
            if response.trading_signal:
                for r in (response.trading_signal.recommendations or []):
                    sym = (r.get("underlying_symbol") or "").upper()
                    if sym:
                        recs_by_underlying[sym] = r
            recs_for_paper = []
            for sym, sym_result in (sentiment_results or {}).items():
                sym_upper = sym.upper()
                rec = recs_by_underlying.get(sym_upper, {})
                signal_type = str(sym_result.get("signal_type") or "HOLD").upper()
                recs_for_paper.append({
                    "underlying": sym_upper,
                    "execution_ticker": rec.get("symbol", sym_upper) if rec else sym_upper,
                    "signal_type": signal_type,
                    "leverage": rec.get("leverage", "1x") if rec else "1x",
                })
            if recs_for_paper:
                _paper_process_signals(
                    db=db,
                    recommendations=recs_for_paper,
                    quotes_by_symbol=quotes_by_symbol,
                    request_id=request_id,
                )
        except Exception as _pe:
            print(f"Paper trading hook error: {_pe}")
        config = get_or_create_app_config(db)
        retention_limit = int(getattr(config, "snapshot_retention_limit", DEFAULT_SNAPSHOT_RETENTION_LIMIT))
        _prune_saved_analyses(db, retention_limit)
        db.commit()
    except Exception as e:
        print(f"Error saving analysis result: {e}")
        db.rollback()


def _save_analysis_and_trades(
    request_id: str,
    response: AnalysisResponse,
    quotes_by_symbol: Dict[str, Dict[str, Any]],
    posts: Optional[List[Any]] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
    model_name: str = "",
    extraction_model: str = "",
    reasoning_model: str = "",
    risk_profile: str = "moderate",
    secret_trace: Optional[Dict[str, Any]] = None,
    sentiment_results: Optional[Dict[str, Any]] = None,
) -> None:
    db = SessionLocal()
    try:
        _save_analysis_result(
            db,
            request_id,
            response,
            quotes_by_symbol,
            posts=posts,
            model_name=model_name,
            prompt_overrides=prompt_overrides,
            extraction_model=extraction_model,
            reasoning_model=reasoning_model,
            risk_profile=risk_profile,
            secret_trace=secret_trace,
            sentiment_results=sentiment_results,
        )
    finally:
        db.close()


@router.get("/paper-trading/summary", tags=["Paper Trading"])
async def get_paper_trading_summary(db: Session = Depends(get_db)):
    from services.paper_trading import get_summary
    return get_summary(db)


@router.delete("/paper-trading/reset", tags=["Paper Trading"])
async def reset_paper_trading(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
):
    from database.models import PaperTrade
    deleted = db.query(PaperTrade).delete()
    db.commit()
    return {"deleted": deleted, "message": "Paper trading history cleared"}


@router.get("/analysis-debug/latest", tags=["System"])
async def get_latest_analysis_debug(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
):
    latest = (
        db.query(AnalysisResult)
        .order_by(AnalysisResult.timestamp.desc())
        .first()
    )
    if not latest:
        raise HTTPException(status_code=404, detail="No saved analysis runs found")

    metadata = latest.run_metadata or {}
    snapshot = metadata.get("dataset_snapshot") or {}
    secret_trace = metadata.get("secret_trace") or snapshot.get("secret_trace") or {}
    return {
        "request_id": latest.request_id,
        "timestamp": _utc_iso(latest.timestamp),
        "model_name": metadata.get("model_name") or "",
        "risk_profile": metadata.get("risk_profile") or "",
        "processing_time_ms": metadata.get("processing_time_ms") or 0,
        "signal": latest.signal or {},
        "sentiment_data": latest.sentiment_data or {},
        "dataset_snapshot": snapshot,
        "secret_trace": secret_trace,
    }


@router.get("/pnl", tags=["Analysis"])
async def get_pnl_summary(db: Session = Depends(get_db)):
    """Return persisted recommendation trades and resolved forward P&L snapshots."""
    tracker = PnLTracker()
    return tracker.get_summary(db)
