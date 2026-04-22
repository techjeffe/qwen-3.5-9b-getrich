"""
Analysis API Router
Implements the /analyze and /analyze/stream endpoints
"""

import uuid
import json
import time
import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional, AsyncGenerator, Tuple
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    SentimentScore,
    TradingSignal,
    BacktestResults,
    ModelInputDebug,
    ModelInputArticle,
)
from database.engine import get_db, SessionLocal
from database.models import Post, AnalysisResult, Trade
from security import require_admin_token
from services.data_ingestion.scraper import TruthSocialScraper
from services.data_ingestion.parser import RSSFeedParser
from services.data_ingestion.yfinance_client import PriceClient
from services.data_ingestion.market_validation import MarketValidationClient
from services.ollama import get_ollama_status
from services.sentiment.engine import SentimentEngine
from services.sentiment.prompts import get_symbol_specialist_focus, format_symbol_specialist_context_prompt
from services.backtesting.optimization import RollingWindowOptimizer
from services.app_config import (
    get_or_create_app_config,
    mark_analysis_started,
    mark_analysis_completed,
)
from services.pnl_tracker import PnLTracker, persist_recommendation_trades


router = APIRouter()

SYMBOL_RELEVANCE_TERMS: Dict[str, List[str]] = {
    "USO": [
        "oil", "crude", "gasoline", "distillate", "refinery", "opec", "energy",
        "barrel", "petroleum", "diesel", "iran", "middle east", "russia",
    ],
    "BITO": [
        "bitcoin", "btc", "crypto", "cryptocurrency", "etf", "sec", "cftc",
        "stablecoin", "blockchain", "mining", "m2", "liquidity",
    ],
    "QQQ": [
        "tech", "technology", "ai", "artificial intelligence", "semiconductor",
        "chip", "software", "nasdaq", "megacap", "cloud", "apple", "microsoft",
        "nvidia", "google", "meta", "amazon",
    ],
    "SPY": [
        "economy", "economic", "fed", "federal reserve", "rates", "inflation",
        "unemployment", "labor", "earnings", "credit", "spread", "stocks",
        "market", "recession", "growth",
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


@router.get("/prices", tags=["Market Data"])
async def get_market_prices():
    """Return live quotes for the four tracked symbols."""
    client = PriceClient()
    result = {}
    for symbol in ["USO", "BITO", "QQQ", "SPY"]:
        quote = client.get_realtime_quote(symbol)
        if quote and quote.get("current_price"):
            price = quote["current_price"]
            prev = quote.get("previous_close") or price
            change_pct = round((price - prev) / prev * 100, 2) if prev else 0.0
            result[symbol] = {
                "price": round(price, 2),
                "change": round(price - prev, 2),
                "change_pct": change_pct,
                "day_low": round(quote.get("day_low") or price, 2),
                "day_high": round(quote.get("day_high") or price, 2),
            }
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

        try:
            config = get_or_create_app_config(db)
            effective_request = _apply_request_defaults(request, config)
            prompt_overrides = config.symbol_prompt_overrides or {}
            # ── Preflight: verify Ollama is reachable ────────────────────────
            try:
                ollama_status = get_ollama_status()
                ollama_root = str(ollama_status.get("ollama_root") or "")
                active_model = str(ollama_status.get("active_model") or "").strip() or "unknown model"
                yield _sse(f"Ollama reachable — using {active_model}")
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

            parser = RSSFeedParser()
            num_feeds = len(parser.GEOPOLITICAL_FEEDS)
            # Each feed gets a fair share; collect from all sources regardless of running total
            per_feed_cap = max(5, effective_request.max_posts // num_feeds)

            for feed_name in parser.GEOPOLITICAL_FEEDS:
                label = feed_name.replace("_", " ").title()
                yield _sse(f"Fetching {label}…")
                try:
                    articles = await asyncio.to_thread(
                        parser.parse_feeds, feed_names=[feed_name]
                    )
                    articles = parser.filter_by_keywords(articles, min_keywords=1)
                    articles = articles[:per_feed_cap]
                    for a in articles:
                        desc = a.content if a.content.strip() != a.title.strip() else ""
                        yield _sse_article(label, a.title, desc, a.keywords[:6])
                    posts.extend(articles)
                    yield _sse(f"{label}: {len(articles)} articles")
                except Exception as e:
                    yield _sse(f"{label} error: {e}")

            # Trim total after collecting from all feeds
            posts = posts[:effective_request.max_posts]
            yield _sse(f"Ingestion complete — {len(posts)} items")

            # Step 2: Price Data
            yield _sse(f"Fetching real-time price data for {', '.join(effective_request.symbols)}...")
            yield _sse(f"Fetching structured validation data for {', '.join(effective_request.symbols)}...")
            price_context, quotes_by_symbol, market_validation = await _get_market_snapshot(effective_request.symbols)
            prices_found = [k for k in price_context if "_price" in k]
            yield _sse(f"Price data fetched: {', '.join(prices_found) or 'no data'}")
            validation_ready = [symbol for symbol, payload in market_validation.items() if payload.get("status") != "unavailable"]
            yield _sse(f"Validation data fetched: {', '.join(validation_ready) or 'no structured data'}")

            # Step 3: Sentiment Analysis
            yield _sse(f"Running sentiment analysis with {active_model} on collected text...")
            sentiment_results = await _analyze_sentiment(posts, effective_request.symbols, price_context, prompt_overrides, active_model)
            for sym, s in sentiment_results.items():
                bluster = s.get('bluster_score', 0)
                policy = s.get('policy_score', 0)
                yield _sse(
                    f"  {sym}: bluster={bluster:+.2f}  policy={policy:.2f}  "
                    f"confidence={s.get('confidence', 0):.0%}"
                )

            # Step 4: Trading Signal
            yield _sse("Generating trading signal...")
            trading_signal = _generate_trading_signal(sentiment_results, quotes_by_symbol)
            yield _sse(
                f"Signal: {trading_signal.signal_type}  |  "
                f"Urgency: {trading_signal.urgency}  |  "
                f"Entry: {trading_signal.entry_symbol}  |  "
                f"Confidence: {trading_signal.confidence_score:.0%}"
            )

            # Step 5: Backtest
            backtest_results = None
            if effective_request.include_backtest:
                yield _sse(f"Running rolling window backtest ({effective_request.lookback_days}-day lookback)...")
                backtest_results = await _run_backtest(
                    effective_request.symbols, sentiment_results, effective_request.lookback_days
                )
                yield _sse(
                    f"Backtest complete — return: {backtest_results.total_return:.2f}%  "
                    f"Sharpe: {backtest_results.sharpe_ratio:.2f}  "
                    f"Max DD: {backtest_results.max_drawdown:.2f}%"
                )

            processing_time_ms = (time.time() - start_time) * 1000
            yield _sse(f"Analysis complete in {processing_time_ms / 1000:.2f}s")

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
                market_validation=market_validation,
                model_inputs=_build_model_input_debug(
                    posts,
                    price_context,
                    market_validation,
                    effective_request.symbols,
                    prompt_overrides,
                ),
                backtest_results=backtest_results,
                processing_time_ms=processing_time_ms,
                status="SUCCESS"
            )

            _save_analysis_and_trades(request_id, response, quotes_by_symbol)
            mark_analysis_completed(db, request_id)
            yield _sse_result(response.model_dump(mode="json"))

        except Exception as e:
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

        posts = await _ingest_data(effective_request)
        price_context, quotes_by_symbol, market_validation = await _get_market_snapshot(effective_request.symbols)
        sentiment_results = await _analyze_sentiment(
            posts,
            effective_request.symbols,
            price_context,
            prompt_overrides,
            active_model,
        )
        trading_signal = _generate_trading_signal(sentiment_results, quotes_by_symbol)

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
            market_validation=market_validation,
            model_inputs=_build_model_input_debug(
                posts,
                price_context,
                market_validation,
                effective_request.symbols,
                prompt_overrides,
            ),
            backtest_results=backtest_results,
            processing_time_ms=processing_time_ms,
            status="SUCCESS"
        )

        if db:
            _save_analysis_result(db, request_id, response, quotes_by_symbol)
            mark_analysis_completed(db, request_id)

        return response

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "Analysis failed",
                "message": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
        )


async def _ingest_data(request: AnalysisRequest) -> List[Any]:
    """Ingest posts from Truth Social and RSS feeds. Returns the list of posts."""
    posts: List[Any] = []

    scraper = TruthSocialScraper()
    try:
        truth_posts = await scraper.scrape_posts(
            query="iran war market policy",
            limit=request.max_posts
        )
        posts.extend(truth_posts)
    except Exception as e:
        print(f"Truth Social scrape error: {e}")

    parser = RSSFeedParser()
    try:
        rss_articles = parser.get_latest_articles(
            limit=max(0, request.max_posts - len(posts))
        )
        rss_articles = parser.filter_by_keywords(rss_articles, min_keywords=1)
        posts.extend(rss_articles)
    except Exception as e:
        print(f"RSS feed parse error: {e}")

    return posts


def _apply_request_defaults(request: AnalysisRequest, config: Any) -> AnalysisRequest:
    symbols = request.symbols or config.tracked_symbols or ["USO", "BITO", "QQQ", "SPY"]
    return AnalysisRequest(
        symbols=symbols,
        max_posts=request.max_posts or config.max_posts,
        include_backtest=request.include_backtest if request.include_backtest is not None else config.include_backtest,
        lookback_days=request.lookback_days or config.lookback_days,
    )


async def _get_market_snapshot(symbols: List[str]) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    client = PriceClient()
    validation_client = MarketValidationClient()
    context = {}
    quotes_by_symbol: Dict[str, Dict[str, Any]] = {}

    for symbol in symbols:
        quote = client.get_realtime_quote(symbol)
        if quote and quote.get('current_price'):
            context[f"{symbol.lower()}_price"] = quote['current_price']
            quotes_by_symbol[symbol] = quote

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

    return context, quotes_by_symbol, market_validation


async def _analyze_sentiment(
    posts: List[Any],
    symbols: List[str],
    price_context: Dict[str, Any],
    prompt_overrides: Optional[Dict[str, str]] = None,
    model_name: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    aggregated = _build_aggregated_news_context(posts)
    if not aggregated.strip():
        raise ValueError("No post content available for sentiment analysis")

    engine = SentimentEngine(model_name=model_name)
    engine.clear_cache()  # Ensure fresh analysis for each run
    analyses = await asyncio.gather(*[
        engine.analyze(
            text=_build_symbol_specific_news_context(posts, symbol, aggregated),
            text_source=f"aggregated_{symbol.lower()}",
            include_context=True,
            context_data=_build_symbol_specific_price_context(price_context, symbol),
            specialist_symbol=symbol,
            specialist_focus=_symbol_specialist_focus(symbol, prompt_overrides),
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

    return results


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


def _build_symbol_specific_news_context(posts: List[Any], symbol: str, fallback: str) -> str:
    """Prefer symbol-relevant articles so specialists do not all see the same noise."""
    terms = [term.lower() for term in SYMBOL_RELEVANCE_TERMS.get(symbol.upper(), [])]
    if not terms:
        return fallback

    relevant_posts: List[Any] = []
    for post in posts:
        text_blob = " ".join(
            [
                str(getattr(post, "title", "") or ""),
                str(getattr(post, "summary", "") or ""),
                str(getattr(post, "content", "") or ""),
                " ".join(getattr(post, "keywords", None) or []),
            ]
        ).lower()
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
    return context


def _build_model_input_debug(
    posts: List[Any],
    price_context: Dict[str, Any],
    market_validation: Dict[str, Dict[str, Any]],
    symbols: Optional[List[str]] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
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
        per_symbol_prompts=_build_per_symbol_prompts(posts, price_context, symbols or [], prompt_overrides),
    )


def _build_per_symbol_prompts(
    posts: List[Any],
    price_context: Dict[str, Any],
    symbols: List[str],
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Build the exact specialist prompt preview for each requested symbol."""
    aggregated = _build_aggregated_news_context(posts)
    if not aggregated.strip():
        return {}

    prompts: Dict[str, str] = {}
    for symbol in symbols:
        symbol_context = _build_symbol_specific_price_context(price_context, symbol)
        symbol_text = _build_symbol_specific_news_context(posts, symbol, aggregated)
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
            validation_context=str(symbol_context.get("validation_context", "") or ""),
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


def _generate_trading_signal(
    sentiment_results: Dict[str, Dict],
    quotes_by_symbol: Optional[Dict[str, Dict[str, Any]]] = None
) -> TradingSignal:
    if not sentiment_results:
        return TradingSignal(
            signal_type="HOLD", confidence_score=0.0,
            entry_symbol="USO", stop_loss_pct=2.0, take_profit_pct=3.0, urgency="LOW"
        )

    symbols = list(sentiment_results.keys())
    recommendations: List[Dict[str, str]] = []
    urgency_rank = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    overall_urgency = "LOW"
    strongest_symbol = symbols[0] if symbols else "USO"
    strongest_score = -1.0
    net_direction_score = 0.0
    total_weight = 0.0
    long_recommendations = 0
    short_recommendations = 0
    hold_recommendations = 0

    for sym, result in sentiment_results.items():
        directional = result.get('directional_score', 0.0)
        confidence = result['confidence']
        specialist_signal = str(result.get('signal_type', 'HOLD')).upper()
        specialist_urgency = str(result.get('urgency', 'LOW')).upper()

        if directional <= -0.3:
            action = "SELL"
            urgency = specialist_urgency if specialist_signal == "SHORT" else ("HIGH" if abs(directional) > 0.7 else "MEDIUM")
            short_recommendations += 1
        elif directional >= 0.3:
            action = "BUY"
            urgency = specialist_urgency if specialist_signal == "LONG" else ("HIGH" if directional > 0.7 else "MEDIUM")
            long_recommendations += 1
        else:
            action = ""
            urgency = specialist_urgency if specialist_signal == "HOLD" else "LOW"
            hold_recommendations += 1

        leverage = "3x" if confidence > 0.75 else "1x"
        if action:
            recommendations.append({"action": action, "symbol": sym, "leverage": leverage})

        conviction = abs(directional) * confidence
        leverage_weight = 3.0 if leverage == "3x" else 1.0
        directional_weight = max(abs(directional), 0.1) * leverage_weight
        net_direction_score += directional * directional_weight
        total_weight += directional_weight

        if conviction > strongest_score:
            strongest_score = conviction
            strongest_symbol = sym

        if urgency_rank[urgency] > urgency_rank[overall_urgency]:
            overall_urgency = urgency

    normalized_basket_score = (net_direction_score / total_weight) if total_weight > 0 else 0.0

    if long_recommendations == len(symbols) and len(symbols) > 0:
        signal_type = "LONG"
    elif short_recommendations == len(symbols) and len(symbols) > 0:
        signal_type = "SHORT"
    elif hold_recommendations == len(symbols) and len(symbols) > 0:
        signal_type = "HOLD"
    elif normalized_basket_score >= 0.18:
        signal_type = "LONG"
    elif normalized_basket_score <= -0.18:
        signal_type = "SHORT"
    else:
        signal_type = "HOLD"

    avg_confidence = sum(result['confidence'] for result in sentiment_results.values()) / len(sentiment_results)
    basket_confidence = min(1.0, max(abs(normalized_basket_score), 0.0) * 1.35)
    confidence_score = avg_confidence if signal_type == "HOLD" else min(1.0, avg_confidence * 0.55 + basket_confidence * 0.45)

    if signal_type != "HOLD":
        matching_recommendations = [
            rec["symbol"]
            for rec in recommendations
            if (signal_type == "LONG" and rec["action"] == "BUY")
            or (signal_type == "SHORT" and rec["action"] == "SELL")
        ]
        if matching_recommendations:
            strongest_symbol = max(
                matching_recommendations,
                key=lambda symbol: abs(float(sentiment_results[symbol].get("directional_score", 0.0))) * float(sentiment_results[symbol].get("confidence", 0.0)),
            )

    if abs(normalized_basket_score) < 0.18:
        overall_urgency = "LOW"

    return TradingSignal(
        signal_type=signal_type,
        confidence_score=min(confidence_score, 1.0),
        entry_symbol=strongest_symbol,
        entry_price=(quotes_by_symbol or {}).get(strongest_symbol, {}).get("current_price") if symbols else None,
        stop_loss_pct=2.0,
        take_profit_pct=3.0,
        urgency=overall_urgency,
        recommendations=recommendations,
    )


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
        if symbol not in client.SUPPORTED_SYMBOLS:
            continue
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


def _save_analysis_result(
    db: Session,
    request_id: str,
    response: AnalysisResponse,
    quotes_by_symbol: Dict[str, Dict[str, Any]],
) -> None:
    try:
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
                "urgency": response.trading_signal.urgency if response.trading_signal else "LOW"
            },
            backtest_results={
                "total_return": response.backtest_results.total_return if response.backtest_results else 0,
                "sharpe_ratio": response.backtest_results.sharpe_ratio if response.backtest_results else 0
            } if response.backtest_results else None,
            run_metadata={
                "symbols": response.symbols_analyzed,
                "posts_scraped": response.posts_scraped,
                "processing_time_ms": response.processing_time_ms
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
        db.commit()
    except Exception as e:
        print(f"Error saving analysis result: {e}")
        db.rollback()


def _save_analysis_and_trades(
    request_id: str,
    response: AnalysisResponse,
    quotes_by_symbol: Dict[str, Dict[str, Any]],
) -> None:
    db = SessionLocal()
    try:
        _save_analysis_result(db, request_id, response, quotes_by_symbol)
    finally:
        db.close()


@router.get("/pnl", tags=["Analysis"])
async def get_pnl_summary(db: Session = Depends(get_db)):
    """Return persisted recommendation trades and resolved forward P&L snapshots."""
    tracker = PnLTracker()
    return tracker.get_summary(db)
