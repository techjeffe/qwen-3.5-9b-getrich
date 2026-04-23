"""
Pydantic schemas for analysis requests and responses
"""

from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field, field_validator

from services.app_config import MAX_TRACKED_SYMBOLS, is_valid_symbol


class SentimentScore(BaseModel):
    """
    Sentiment score from the LLM sentiment engine.
    Contains bluster and policy change analysis.
    """
    market_bluster: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Hype-vs-substance score: -1 = headline bluster/hype, +1 = substantive news"
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
    Includes broker-friendly entry/exit parameters for the tradable instrument.
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
    entry_symbol: str = Field(default="USO", description="Primary tradable ticker to execute")
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
    
    # Position sizing / leverage metadata
    position_size_usd: Optional[float] = Field(
        default=None,
        description="Suggested position size in USD"
    )
    
    # Timing
    urgency: Literal["LOW", "MEDIUM", "HIGH"] = Field(
        default="MEDIUM",
        description="Trade urgency level"
    )
    
    # Conviction and holding strategy
    conviction_level: Literal["LOW", "MEDIUM", "HIGH"] = Field(
        default="MEDIUM",
        description="Conviction strength independent of analysis confidence (LOW=reactive/bluster, MEDIUM=data-driven swing, HIGH=structural multi-day thesis)"
    )
    
    holding_period_hours: int = Field(
        default=4,
        ge=1,
        le=720,
        description="Expected holding period in hours, assuming no major news or stop/profit triggers"
    )
    
    trading_type: Literal["SCALP", "SWING", "POSITION", "VOLATILE_EVENT"] = Field(
        default="SWING",
        description="Trade classification to guide re-analysis strategy (SCALP: 1-2h, SWING: 4-24h, POSITION: 24-168h, VOLATILE_EVENT: 1-4h)"
    )
    
    action_if_already_in_position: Literal["HOLD", "EXIT", "ADD", "TAKE_PROFIT"] = Field(
        default="HOLD",
        description="Recommended action if already holding the same symbol with conflicting signal"
    )

    # Specific actionable recommendations
    recommendations: List[Dict[str, str]] = Field(
        default_factory=list,
        description='List of broker-ready recommendations like {"action":"BUY","symbol":"TQQQ","leverage":"3x","underlying_symbol":"QQQ"}'
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "signal_type": "LONG",
                "confidence_score": 0.87,
                "entry_symbol": "TQQQ",
                "entry_price": 24.50,
                "stop_loss_pct": 2.0,
                "take_profit_pct": 3.0,
                "position_size_usd": 1000.0,
                "urgency": "HIGH",
                "conviction_level": "HIGH",
                "holding_period_hours": 24,
                "trading_type": "SWING",
                "action_if_already_in_position": "HOLD",
                "recommendations": [{"action": "BUY", "symbol": "TQQQ", "leverage": "3x", "underlying_symbol": "QQQ"}],
            }
        }
    }


class RedTeamSymbolReview(BaseModel):
    symbol: str = Field(default="")
    current_recommendation: str = Field(default="")
    thesis: str = Field(default="")
    antithesis: str = Field(default="")
    evidence: List[str] = Field(default_factory=list)
    key_risks: List[str] = Field(default_factory=list)
    adjusted_signal: Literal["BUY", "SELL", "HOLD"] = Field(default="HOLD")
    adjusted_confidence: float = Field(default=0.0, ge=0.0, le=1.0)  # populated by Python, not LLM
    adjusted_urgency: Literal["LOW", "MEDIUM", "HIGH"] = Field(default="LOW")
    stop_loss_pct: float = Field(default=2.0, ge=0.1, le=25.0)  # populated by Python, not LLM
    atr_basis: str = Field(default="")
    rationale: str = Field(default="")


class RedTeamReview(BaseModel):
    summary: str = Field(default="")
    portfolio_risks: List[str] = Field(default_factory=list)
    source_bias_penalty_applied: bool = Field(default=False)
    source_bias_notes: str = Field(default="")
    symbol_reviews: List[RedTeamSymbolReview] = Field(default_factory=list)


class RedTeamSignalChange(BaseModel):
    symbol: str = Field(default="")
    blue_team_recommendation: str = Field(default="")
    consensus_recommendation: str = Field(default="")
    changed: bool = Field(default=False)
    change_type: str = Field(default="unchanged")
    rationale: str = Field(default="")
    evidence: List[str] = Field(default_factory=list)


class RedTeamDebug(BaseModel):
    context: Dict[str, Any] = Field(default_factory=dict)
    prompt: str = Field(default="")
    raw_response: str = Field(default="")
    parsed_payload: Dict[str, Any] = Field(default_factory=dict)
    signal_changes: List[RedTeamSignalChange] = Field(default_factory=list)


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
        default=["USO", "BITO", "QQQ", "SPY"],
        min_length=1,
        max_length=MAX_TRACKED_SYMBOLS,
        description="Ticker symbols to analyze (e.g., USO, BITO, QQQ, SPY)"
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
        """Validate that symbols are syntactically valid and unique."""
        normalized: List[str] = []
        for symbol in v:
            value = str(symbol or "").upper().strip()
            if not is_valid_symbol(value):
                raise ValueError(f"Invalid symbol: {symbol}")
            if value not in normalized:
                normalized.append(value)
        if not normalized:
            raise ValueError("At least one symbol is required")
        return normalized[:MAX_TRACKED_SYMBOLS]


class ModelInputArticle(BaseModel):
    """Article/source item included in the compiled model input."""

    source: str = Field(default="")
    title: str = Field(default="")
    description: str = Field(default="")
    content: str = Field(default="")
    keywords: List[str] = Field(default_factory=list)


class ModelInputWebItem(BaseModel):
    """Recent web research item included in the compiled model input."""

    source: str = Field(default="")
    title: str = Field(default="")
    url: str = Field(default="")
    published_at: str = Field(default="")
    summary: str = Field(default="")
    query: str = Field(default="")
    relevance_score: float = Field(default=0.0)
    age_days: float = Field(default=0.0)
    matched_keywords: List[str] = Field(default_factory=list)


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
    web_context_by_symbol: Dict[str, str] = Field(
        default_factory=dict,
        description="Lightweight recent web research summary injected per symbol"
    )
    web_items_by_symbol: Dict[str, List[ModelInputWebItem]] = Field(
        default_factory=dict,
        description="Structured recent web research items shown in Advanced Mode"
    )


class IngestionTraceDebug(BaseModel):
    """Visible ingestion trace returned to the UI for Advanced Mode debugging."""

    source: str = Field(default="")
    trigger_source: str = Field(default="")
    request_max_posts: Optional[int] = Field(default=None)
    selected_article_ids: List[int] = Field(default_factory=list)
    selected_fast_lane_article_ids: List[int] = Field(default_factory=list)
    total_items: int = Field(default=0)
    queue: Dict[str, Any] = Field(default_factory=dict)
    truth_social: Dict[str, Any] = Field(default_factory=dict)
    rss: Dict[str, Any] = Field(default_factory=dict)


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

    blue_team_signal: Optional[TradingSignal] = Field(
        default=None,
        description="Original pre-red-team signal before adversarial adjustment"
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

    ingestion_trace: Optional[IngestionTraceDebug] = Field(
        default=None,
        description="Visible ingestion trace showing which queued articles were selected for this run"
    )

    red_team_review: Optional[RedTeamReview] = Field(
        default=None,
        description="Adversarial post-trade review that stress-tests the final recommendation set"
    )

    red_team_debug: Optional[RedTeamDebug] = Field(
        default=None,
        description="Detailed red-team prompt, raw response, parsed payload, and blue-vs-consensus diffs"
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
