"""
Analysis API Router
Implements the /analyze endpoint with full pipeline orchestration
"""

import uuid
import time
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import Session

from ..schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    SentimentScore,
    TradingSignal,
    BacktestResults
)
from ..database.engine import get_db
from ..database.models import Post, AnalysisResult
from ..services.data_ingestion.scraper import TruthSocialScraper
from ..services.data_ingestion.parser import RSSFeedParser
from ..services.data_ingestion.yfinance_client import PriceClient
from ..services.sentiment.engine import SentimentEngine
from ..services.backtesting.optimization import RollingWindowOptimizer


router = APIRouter()


@router.post(
    "/analyze",
    response_model=AnalysisResponse,
    summary="Run full sentiment analysis pipeline",
    description="""
Trigger the complete analysis pipeline:
1. Scrape social media and news feeds
2. Analyze sentiment using Llama-3-70b
3. Generate trading signals
4. Run rolling window backtest (optional)
    """,
    tags=["Analysis"]
)
async def analyze_market(
    request: AnalysisRequest,
    db: Session = None
):
    """
    Execute the full analysis pipeline and return trading signal.
    
    This endpoint orchestrates:
    - Data ingestion from Truth Social and RSS feeds
    - Sentiment analysis via Ollama Llama-3-70b
    - Trading signal generation based on bluster vs policy detection
    - Optional VectorBT rolling window backtesting
    
    Returns a complete analysis response with sentiment scores,
    trading signals, and backtest results.
    """
    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    
    try:
        # Step 1: Data Ingestion
        posts_scraped = await _ingest_data(request)
        
        # Step 2: Get Price Data for Context
        price_context = await _get_price_context(request.symbols)
        
        # Step 3: Sentiment Analysis
        sentiment_results = await _analyze_sentiment(
            posts_scraped, 
            request.symbols,
            price_context
        )
        
        # Step 4: Generate Trading Signal
        trading_signal = _generate_trading_signal(sentiment_results)
        
        # Step 5: Run Backtest (if requested)
        backtest_results = None
        if request.include_backtest:
            backtest_results = await _run_backtest(
                request.symbols,
                sentiment_results,
                request.lookback_days
            )
        
        # Calculate processing time
        processing_time_ms = (time.time() - start_time) * 1000
        
        # Build response
        response = AnalysisResponse(
            request_id=request_id,
            timestamp=datetime.utcnow(),
            symbols_analyzed=request.symbols,
            posts_scraped=posts_scraped,
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
        
        # Save to database if session provided
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


async def _ingest_data(request: AnalysisRequest) -> int:
    """
    Ingest data from Truth Social and RSS feeds.
    
    Args:
        request: Analysis request with parameters
        
    Returns:
        Number of posts scraped
    """
    total_posts = 0
    
    # Scrape Truth Social
    scraper = TruthSocialScraper()
    try:
        truth_posts = await scraper.scrape_posts(
            query="iran war market policy",
            limit=request.max_posts
        )
        total_posts += len(truth_posts)
    except Exception as e:
        print(f"Truth Social scrape error: {e}")
    
    # Parse RSS feeds
    parser = RSSFeedParser()
    try:
        rss_articles = parser.get_latest_articles(
            limit=request.max_posts - total_posts
        )
        total_posts += len(rss_articles)
    except Exception as e:
        print(f"RSS feed parse error: {e}")
    
    return total_posts


async def _get_price_context(symbols: List[str]) -> Dict[str, Any]:
    """
    Get current price data for context-aware analysis.
    
    Args:
        symbols: ETF symbols to get prices for
        
    Returns:
        Dictionary with price context data
    """
    client = PriceClient()
    context = {}
    
    for symbol in symbols:
        quote = client.get_realtime_quote(symbol)
        if quote and quote.get('current_price'):
            context[f"{symbol}_price"] = quote['current_price']
    
    # Add SPY price if not already present
    if 'spy_price' not in context:
        spy_quote = client.get_realtime_quote("SPY")
        if spy_quote and spy_quote.get('current_price'):
            context['spy_price'] = spy_quote['current_price']
    
    return context


async def _analyze_sentiment(
    posts: List[Any],
    symbols: List[str],
    price_context: Dict[str, Any]
) -> Dict[str, Dict[str, Any]]:
    """
    Analyze sentiment of scraped content using Llama-3-70b.
    
    Args:
        posts: List of scraped posts/articles
        symbols: ETF symbols to analyze for
        price_context: Current market prices
        
    Returns:
        Dictionary mapping symbols to sentiment results
    """
    engine = SentimentEngine()
    results = {}
    
    # Aggregate text by symbol
    texts_by_symbol = {}
    for post in posts:
        content = getattr(post, 'content', '') or ''
        if not content:
            continue
        
        # Assign to primary symbol (USO/BITO) based on content relevance
        symbol = "BITO"  # Default to BITO for S&P inverse
        texts_by_symbol[symbol] = texts_by_symbol.get(symbol, "") + content + "\n"
    
    # Analyze each symbol's aggregated text
    for symbol in symbols:
        if symbol not in texts_by_symbol:
            continue
        
        text = texts_by_symbol[symbol]
        
        # Use context-aware analysis with price data
        sentiment = await engine.analyze(
            text=text,
            text_source=f"aggregated_{symbol}",
            include_context=True,
            context_data=price_context
        )
        
        results[symbol] = {
            'bluster_score': sentiment.bluster_score,
            'policy_score': sentiment.policy_score,
            'confidence': sentiment.confidence,
            'reasoning': sentiment.reasoning,
            'is_bluster': sentiment.is_bluster,
            'is_policy_change': sentiment.is_policy_change,
            'impact_severity': sentiment.impact_severity
        }
    
    return results


def _generate_trading_signal(sentiment_results: Dict[str, Dict]) -> TradingSignal:
    """
    Generate trading signal from sentiment analysis results.
    
    Args:
        sentiment_results: Sentiment scores for each symbol
        
    Returns:
        TradingSignal with recommended action
    """
    # Aggregate signals across symbols
    total_bluster = sum(r['bluster_score'] for r in sentiment_results.values()) / len(sentiment_results) if sentiment_results else 0
    total_policy = sum(r['policy_score'] for r in sentiment_results.values()) / len(sentiment_results) if sentiment_results else 0
    
    # Determine signal type based on scores
    if total_bluster < -0.5 and total_policy < 0.3:
        signal_type = "SHORT"
        urgency = "HIGH" if abs(total_bluster) > 0.7 else "MEDIUM"
    elif total_policy > 0.7:
        signal_type = "LONG"
        urgency = "HIGH" if total_policy > 0.8 else "MEDIUM"
    else:
        signal_type = "HOLD"
        urgency = "LOW"
    
    # Calculate confidence
    avg_confidence = sum(r['confidence'] for r in sentiment_results.values()) / len(sentiment_results) if sentiment_results else 0.5
    
    return TradingSignal(
        signal_type=signal_type,
        confidence_score=min(avg_confidence * 0.8 + (1 - abs(total_bluster)) * 0.2, 1.0),
        entry_symbol="BITO" if signal_type == "LONG" else "USO",
        stop_loss_pct=2.0,
        take_profit_pct=3.0,
        position_size_usd=None,  # Would be calculated with account equity
        urgency=urgency
    )


async def _run_backtest(
    symbols: List[str],
    sentiment_results: Dict[str, Dict],
    lookback_days: int = 14
) -> BacktestResults:
    """
    Run rolling window backtest on historical data.
    
    Args:
        symbols: ETF symbols to backtest
        sentiment_results: Sentiment analysis results
        lookback_days: Rolling window size
        
    Returns:
        BacktestResults with performance metrics
    """
    # Initialize optimizer
    optimizer = RollingWindowOptimizer(
        lookback_days=lookback_days,
        test_period_days=7,
        step_days=1,
        leverage=3.0
    )
    
    # Get historical price data
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
    
    # Run optimization on first available symbol
    symbol = list(prices_data.keys())[0]
    result = optimizer.optimize(
        prices=symbol,
        signal_thresholds=[-0.5, -0.3, -0.1, 0.1, 0.3]
    )
    
    # Convert to Pydantic model
    summary = result.get('summary', {})
    
    return BacktestResults(
        total_return=summary.get('avg_total_return', 0.0),
        annualized_return=summary.get('avg_sharpe_ratio', 0.0) * 10,  # Approximate conversion
        sharpe_ratio=summary.get('avg_sharpe_ratio', 0.0),
        max_drawdown=summary.get('avg_max_drawdown', 0.0),
        win_rate=0.6,  # Would be calculated from actual trades
        total_trades=0,  # Would be counted from optimization results
        lookback_days=lookback_days,
        walk_forward_steps=result.get('num_windows', 0)
    )


def _aggregate_sentiment(sentiment_results: Dict[str, Dict]) -> Optional[SentimentScore]:
    """
    Aggregate sentiment scores across all symbols.
    
    Args:
        sentiment_results: Sentiment results per symbol
        
    Returns:
        Aggregated SentimentScore or None if no results
    """
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
    """
    Save analysis result to database.
    
    Args:
        db: Database session
        request_id: Unique request identifier
        response: Analysis response to save
    """
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
            metadata={
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
