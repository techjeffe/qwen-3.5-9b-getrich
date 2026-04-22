"""
Pydantic schemas for analysis requests and responses
"""

from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field, field_validator


class SentimentScore(BaseModel):
    """
    Sentiment score from the LLM sentiment engine.
    Contains bluster and policy change analysis.
    """
    market_bluster: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Bluster score: -1 (strong bluster) to +1 (no bluster)"
    )
    policy_change: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Policy change score: 0 (no policy) to +1 (significant policy)"
    )
    confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Overall analysis confidence"
    )
    reasoning: str = Field(default="", description="LLM reasoning for the scores")

    model_config = {
        "json_schema_extra": {
            "example": {
                "market_bluster": -0.75,
                "policy_change": 0.85,
                "confidence": 0.92,
                "reasoning": "Strong policy language detected with regulatory action keywords"
            }
        }
    }


class TradingSignal(BaseModel):
    """
    Trading signal generated from sentiment analysis.
    Includes entry/exit parameters for 3x leveraged ETFs.
    """
    signal_type: Literal["LONG", "SHORT", "HOLD"] = Field(
        default="HOLD",
        description="Trading direction"
    )
    confidence_score: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Signal confidence (0-1)"
    )
    
    # Entry parameters
    entry_symbol: str = Field(default="USO", description="Primary ETF symbol")
    entry_price: Optional[float] = Field(
        default=None,
        description="Suggested entry price"
    )
    
    # Risk management
    stop_loss_pct: float = Field(
        default=2.0,
        ge=1.0,
        le=10.0,
        description="Stop loss percentage"
    )
    take_profit_pct: float = Field(
        default=3.0,
        ge=1.0,
        le=20.0,
        description="Take profit percentage"
    )
    
    # Position sizing (3x leverage)
    position_size_usd: Optional[float] = Field(
        default=None,
        description="Suggested position size in USD"
    )
    
    # Timing
    urgency: Literal["LOW", "MEDIUM", "HIGH"] = Field(
        default="MEDIUM",
        description="Trade urgency level"
    )

    # Specific actionable recommendations
    recommendations: List[Dict[str, str]] = Field(
        default_factory=list,
        description='List of {action, symbol, leverage} e.g. {"action":"BUY","symbol":"QQQ","leverage":"3x"}'
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "signal_type": "LONG",
                "confidence_score": 0.87,
                "entry_symbol": "USO",
                "entry_price": 24.50,
                "stop_loss_pct": 2.0,
                "take_profit_pct": 3.0,
                "position_size_usd": 1000.0,
                "urgency": "HIGH"
            }
        }
    }


class BacktestResults(BaseModel):
    """
    Results from VectorBT rolling window backtest.
    Contains performance metrics and walk-forward optimization data.
    """
    total_return: float = Field(
        default=0.0,
        description="Total return percentage over backtest period"
    )
    annualized_return: float = Field(
        default=0.0,
        description="Annualized return percentage"
    )
    sharpe_ratio: float = Field(
        default=0.0,
        description="Sharpe ratio of the strategy"
    )
    max_drawdown: float = Field(
        default=0.0,
        description="Maximum drawdown percentage"
    )
    win_rate: float = Field(
        default=0.0,
        description="Percentage of winning trades"
    )
    total_trades: int = Field(
        default=0,
        ge=0,
        description="Total number of trades executed"
    )
    
    # Walk-forward optimization details
    lookback_days: int = Field(
        default=14,
        description="Rolling window size in days"
    )
    walk_forward_steps: int = Field(
        default=0,
        ge=0,
        description="Number of walk-forward iterations"
    )
    
    # Trade breakdown
    winning_trades: int = Field(default=0, ge=0)
    losing_trades: int = Field(default=0, ge=0)
    avg_win_pct: float = Field(default=0.0)
    avg_loss_pct: float = Field(default=0.0)
    profit_factor: float = Field(default=0.0)

    model_config = {
        "json_schema_extra": {
            "example": {
                "total_return": 15.7,
                "annualized_return": 42.3,
                "sharpe_ratio": 1.85,
                "max_drawdown": -8.2,
                "win_rate": 0.62,
                "total_trades": 45,
                "lookback_days": 14,
                "walk_forward_steps": 30,
                "winning_trades": 28,
                "losing_trades": 17,
                "avg_win_pct": 3.2,
                "avg_loss_pct": -1.9,
                "profit_factor": 1.68
            }
        }
    }


class AnalysisRequest(BaseModel):
    """
    Request schema for triggering a full analysis pipeline.
    """
    symbols: List[str] = Field(
        default=["USO", "BITO"],
        min_length=1,
        max_length=5,
        description="ETF symbols to analyze (e.g., USO, BITO)"
    )
    max_posts: int = Field(
        default=50,
        ge=1,
        le=200,
        description="Maximum number of posts to scrape and analyze"
    )
    include_backtest: bool = Field(
        default=True,
        description="Whether to run rolling window backtest"
    )
    lookback_days: int = Field(
        default=14,
        ge=7,
        le=30,
        description="Rolling window size for backtesting"
    )

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, v: List[str]) -> List[str]:
        """Validate that symbols are valid ETF tickers."""
        valid_symbols = {"SPY", "USO", "BITO", "QQQ", "SQQQ", "UNG"}
        for symbol in v:
            if symbol not in valid_symbols:
                raise ValueError(f"Invalid symbol: {symbol}. Valid options: {valid_symbols}")
        return v


class ModelInputArticle(BaseModel):
    """Article/source item included in the compiled model input."""

    source: str = Field(default="")
    title: str = Field(default="")
    description: str = Field(default="")
    keywords: List[str] = Field(default_factory=list)


class ModelInputDebug(BaseModel):
    """Debug payload showing the context fed into the model."""

    news_context: str = Field(
        default="",
        description="Compiled headline/detail text passed into the sentiment model"
    )
    validation_context: str = Field(
        default="",
        description="Structured validation summary passed into the sentiment model"
    )
    price_context: Dict[str, Any] = Field(
        default_factory=dict,
        description="Market price context supplied alongside the prompt"
    )
    articles: List[ModelInputArticle] = Field(
        default_factory=list,
        description="RSS/news articles included in the compiled model input"
    )
    per_symbol_prompts: Dict[str, str] = Field(
        default_factory=dict,
        description="Exact compiled prompt text sent to each symbol specialist"
    )


class AnalysisResponse(BaseModel):
    """
    Response schema for analysis endpoint.
    Contains complete analysis results including sentiment, signals, and backtest data.
    """
    request_id: str = Field(
        default="",
        description="Unique identifier for this analysis request"
    )
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        description="Timestamp of the analysis"
    )
    
    # Input parameters
    symbols_analyzed: List[str] = Field(default=[])
    posts_scraped: int = Field(default=0)
    
    # Sentiment scores per symbol
    sentiment_scores: Dict[str, SentimentScore] = Field(
        default_factory=dict,
        description="Sentiment analysis for each symbol"
    )
    
    # Aggregated sentiment
    aggregated_sentiment: Optional[SentimentScore] = Field(
        default=None,
        description="Combined sentiment across all sources"
    )
    
    # Trading signal
    trading_signal: Optional[TradingSignal] = Field(
        default=None,
        description="Generated trading signal"
    )

    # Structured market validation inputs
    market_validation: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description="Per-symbol structured validation data from pullable macro/market sources"
    )

    model_inputs: Optional[ModelInputDebug] = Field(
        default=None,
        description="Debug view of the compiled inputs supplied to the sentiment model"
    )
    
    # Backtest results (optional)
    backtest_results: Optional[BacktestResults] = Field(
        default=None,
        description="Rolling window backtest results"
    )
    
    # Processing metadata
    processing_time_ms: float = Field(default=0.0)
    status: Literal["SUCCESS", "PARTIAL", "FAILED"] = Field(
        default="SUCCESS",
        description="Overall analysis status"
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "request_id": "abc-123-def",
                "timestamp": "2024-01-15T10:30:00Z",
                "symbols_analyzed": ["USO", "BITO"],
                "posts_scraped": 47,
                "sentiment_scores": {
                    "USO": {"market_bluster": -0.65, "policy_change": 0.82},
                    "BITO": {"market_bluster": -0.58, "policy_change": 0.79}
                },
                "aggregated_sentiment": {...},
                "trading_signal": {"signal_type": "LONG"},
                "market_validation": {
                    "QQQ": {"status": "ok", "summary": "10Y TIPS real yield 1.92% (down)"}
                },
                "model_inputs": {
                    "validation_context": "QQQ [OK]: 10Y TIPS real yield 1.92% (down)",
                    "articles": [
                        {"source": "BBC World", "title": "Example headline", "description": "Example details", "keywords": ["rates", "fed"]}
                    ]
                },
                "backtest_results": {"total_return": 12.5},
                "processing_time_ms": 3420.5,
                "status": "SUCCESS"
            }
        }
    }
