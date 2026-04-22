"""
Analysis API Router
Implements the /analyze and /analyze/stream endpoints
"""

import uuid
import json
import time
import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional, AsyncGenerator
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    SentimentScore,
    TradingSignal,
    BacktestResults
)
from database.engine import get_db
from database.models import Post, AnalysisResult
from services.data_ingestion.scraper import TruthSocialScraper
from services.data_ingestion.parser import RSSFeedParser
from services.data_ingestion.yfinance_client import PriceClient
from services.sentiment.engine import SentimentEngine
from services.backtesting.optimization import RollingWindowOptimizer


router = APIRouter()


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

        try:
            # ── Preflight: verify Ollama is reachable ────────────────────────
            import requests as _req
            import os as _os
            ollama_base = _os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
            ollama_root = ollama_base.replace("/api/generate", "")
            try:
                _req.get(f"{ollama_root}/api/tags", timeout=3)
                yield _sse("Ollama reachable — model ready")
            except Exception:
                model = _os.getenv("OLLAMA_MODEL", "qwen3.5:9b")
                yield _sse_error(
                    f"Cannot reach Ollama at {ollama_root}. "
                    f"Start it with: ollama run {model}"
                )
                return

            # ── Step 1: Data Ingestion (live, feed-by-feed) ──────────────────
            posts: List[Any] = []

            parser = RSSFeedParser()
            num_feeds = len(parser.GEOPOLITICAL_FEEDS)
            # Each feed gets a fair share; collect from all sources regardless of running total
            per_feed_cap = max(5, request.max_posts // num_feeds)

            for feed_name in parser.GEOPOLITICAL_FEEDS:
                label = feed_name.replace("_", " ").title()
                yield _sse(f"Fetching {label}…")
                try:
                    articles = await asyncio.to_thread(
                        parser.parse_feeds, feed_names=[feed_name]
                    )
                    articles = articles[:per_feed_cap]
                    for a in articles:
                        desc = a.content if a.content.strip() != a.title.strip() else ""
                        yield _sse_article(label, a.title, desc, a.keywords[:6])
                    posts.extend(articles)
                    yield _sse(f"{label}: {len(articles)} articles")
                except Exception as e:
                    yield _sse(f"{label} error: {e}")

            # Trim total after collecting from all feeds
            posts = posts[:request.max_posts]
            yield _sse(f"Ingestion complete — {len(posts)} items")

            # Step 2: Price Data
            yield _sse(f"Fetching real-time price data for {', '.join(request.symbols)}...")
            price_context = await _get_price_context(request.symbols)
            prices_found = [k for k in price_context if "_price" in k]
            yield _sse(f"Price data fetched: {', '.join(prices_found) or 'no data'}")

            # Step 3: Sentiment Analysis
            yield _sse("Running Qwen 3.5 9b sentiment analysis on collected text...")
            sentiment_results = await _analyze_sentiment(posts, request.symbols, price_context)
            for sym, s in sentiment_results.items():
                bluster = s.get('bluster_score', 0)
                policy = s.get('policy_score', 0)
                yield _sse(
                    f"  {sym}: bluster={bluster:+.2f}  policy={policy:.2f}  "
                    f"confidence={s.get('confidence', 0):.0%}"
                )

            # Step 4: Trading Signal
            yield _sse("Generating trading signal...")
            trading_signal = _generate_trading_signal(sentiment_results)
            yield _sse(
                f"Signal: {trading_signal.signal_type}  |  "
                f"Urgency: {trading_signal.urgency}  |  "
                f"Entry: {trading_signal.entry_symbol}  |  "
                f"Confidence: {trading_signal.confidence_score:.0%}"
            )

            # Step 5: Backtest
            backtest_results = None
            if request.include_backtest:
                yield _sse(f"Running rolling window backtest ({request.lookback_days}-day lookback)...")
                backtest_results = await _run_backtest(
                    request.symbols, sentiment_results, request.lookback_days
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
                symbols_analyzed=request.symbols,
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
                backtest_results=backtest_results,
                processing_time_ms=processing_time_ms,
                status="SUCCESS"
            )

            yield _sse_result(response.model_dump(mode="json"))

        except Exception as e:
            yield _sse_error(str(e))

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
    import requests as _req, os as _os
    ollama_root = _os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate").replace("/api/generate", "")
    try:
        _req.get(f"{ollama_root}/api/tags", timeout=3)
    except Exception:
        model = _os.getenv("OLLAMA_MODEL", "qwen3.5:9b")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Ollama is not running at {ollama_root}. Start it with: ollama run {model}"
        )

    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]

    try:
        posts = await _ingest_data(request)
        price_context = await _get_price_context(request.symbols)
        sentiment_results = await _analyze_sentiment(posts, request.symbols, price_context)
        trading_signal = _generate_trading_signal(sentiment_results)

        backtest_results = None
        if request.include_backtest:
            backtest_results = await _run_backtest(
                request.symbols, sentiment_results, request.lookback_days
            )

        processing_time_ms = (time.time() - start_time) * 1000

        response = AnalysisResponse(
            request_id=request_id,
            timestamp=datetime.utcnow(),
            symbols_analyzed=request.symbols,
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
            backtest_results=backtest_results,
            processing_time_ms=processing_time_ms,
            status="SUCCESS"
        )

        if db:
            _save_analysis_result(db, request_id, response)

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
        posts.extend(rss_articles)
    except Exception as e:
        print(f"RSS feed parse error: {e}")

    return posts


async def _get_price_context(symbols: List[str]) -> Dict[str, Any]:
    client = PriceClient()
    context = {}

    for symbol in symbols:
        quote = client.get_realtime_quote(symbol)
        if quote and quote.get('current_price'):
            context[f"{symbol.lower()}_price"] = quote['current_price']

    for extra in ["SPY", "QQQ"]:
        key = f"{extra.lower()}_price"
        if key not in context:
            q = client.get_realtime_quote(extra)
            if q and q.get('current_price'):
                context[key] = q['current_price']

    return context


async def _analyze_sentiment(
    posts: List[Any],
    symbols: List[str],
    price_context: Dict[str, Any]
) -> Dict[str, Dict[str, Any]]:
    aggregated = ""
    for post in posts:
        title = (getattr(post, 'title', '') or '').strip()
        content = (getattr(post, 'content', '') or '').strip()
        # Include headline always; include body only when it adds information beyond the title
        if title:
            aggregated += title + "\n"
        if content and content != title:
            aggregated += content + "\n"

    if not aggregated.strip():
        raise ValueError("No post content available for sentiment analysis")

    aggregated = aggregated[:12000]

    engine = SentimentEngine()
    # Run the LLM once — all symbols share the same geopolitical context
    sentiment = await engine.analyze(
        text=aggregated,
        text_source="aggregated_all",
        include_context=True,
        context_data=price_context
    )
    shared = {
        'bluster_score': sentiment.bluster_score,
        'policy_score': sentiment.policy_score,
        'confidence': sentiment.confidence,
        'reasoning': sentiment.reasoning,
        'is_bluster': sentiment.is_bluster,
        'is_policy_change': sentiment.is_policy_change,
        'impact_severity': sentiment.impact_severity
    }
    return {symbol: shared for symbol in symbols}


def _generate_trading_signal(sentiment_results: Dict[str, Dict]) -> TradingSignal:
    if not sentiment_results:
        return TradingSignal(
            signal_type="HOLD", confidence_score=0.0,
            entry_symbol="USO", stop_loss_pct=2.0, take_profit_pct=3.0, urgency="LOW"
        )

    # All symbols share the same analysis — use the first result's scores
    r = next(iter(sentiment_results.values()))
    bluster = r['bluster_score']
    policy = r['policy_score']
    confidence = r['confidence']

    if bluster < -0.5 and policy < 0.3:
        signal_type = "SHORT"
        urgency = "HIGH" if abs(bluster) > 0.7 else "MEDIUM"
    elif policy > 0.7:
        signal_type = "LONG"
        urgency = "HIGH" if policy > 0.8 else "MEDIUM"
    else:
        signal_type = "HOLD"
        urgency = "LOW"

    # Build actionable recommendations per symbol
    leverage = "3x" if confidence > 0.75 else "1x"
    symbols = list(sentiment_results.keys())
    recommendations: List[Dict[str, str]] = []
    if signal_type == "LONG":
        for sym in symbols:
            recommendations.append({"action": "BUY", "symbol": sym, "leverage": leverage})
    elif signal_type == "SHORT":
        for sym in symbols:
            recommendations.append({"action": "SELL", "symbol": sym, "leverage": leverage})

    return TradingSignal(
        signal_type=signal_type,
        confidence_score=min(confidence * 0.8 + (1 - abs(bluster)) * 0.2, 1.0),
        entry_symbol=symbols[0] if symbols else "USO",
        stop_loss_pct=2.0,
        take_profit_pct=3.0,
        urgency=urgency,
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

    return SentimentScore(
        market_bluster=avg_bluster,
        policy_change=avg_policy,
        confidence=avg_confidence,
        reasoning="Aggregated across all analyzed sources"
    )


def _save_analysis_result(
    db: Session,
    request_id: str,
    response: AnalysisResponse
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
                }
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
        db.commit()
    except Exception as e:
        print(f"Error saving analysis result: {e}")
        db.rollback()
