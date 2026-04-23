"""
SQLAlchemy ORM models for the trading system database.
"""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float, JSON, Boolean, ForeignKey,
    Index, UniqueConstraint
)
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func
from .engine import engine

Base = declarative_base()


class Post(Base):
    """
    Model representing a scraped post from social media or news feeds.
    Stores raw content before sentiment analysis.
    """
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text, nullable=False)
    source = Column(String(50), nullable=False)  # e.g., "truth_social", "reuters_rss"
    author = Column(String(200), nullable=True)
    timestamp = Column(DateTime(timezone=True), default=func.now())
    sentiment_analysis = Column(JSON, nullable=True)
    is_analyzed = Column(Boolean, default=False)

    __table_args__ = (
        Index("ix_posts_source_timestamp", "source", "timestamp"),
        Index("ix_posts_is_analyzed", "is_analyzed"),
    )


class AnalysisResult(Base):
    """
    Model storing complete analysis results from the sentiment engine.
    Links multiple posts to a single analysis run.
    """
    __tablename__ = "analysis_results"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(String(36), unique=True, index=True, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=func.now())
    
    # Sentiment data stored as JSON for flexibility
    sentiment_data = Column(JSON, nullable=False)
    
    # Trading signal generated from analysis
    signal = Column(JSON, nullable=False)
    
    # Backtest results if run
    backtest_results = Column(JSON, nullable=True)

    # Metadata about the analysis run (named run_metadata to avoid shadowing SQLAlchemy's Base.metadata)
    run_metadata = Column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_analysis_timestamp", "timestamp"),
    )


class TradingSignal(Base):
    """
    Model for individual trading signals with execution tracking.
    Stores signal generation and subsequent trade execution details.
    """
    __tablename__ = "trading_signals"

    id = Column(Integer, primary_key=True, index=True)
    analysis_id = Column(Integer, ForeignKey("analysis_results.id"), nullable=False)
    
    symbol = Column(String(10), nullable=False)  # e.g., "USO", "BITO"
    signal_type = Column(String(20), nullable=False)  # "LONG", "SHORT", "HOLD"
    confidence_score = Column(Float, nullable=True)
    
    entry_price = Column(Float, nullable=True)
    stop_loss = Column(Float, nullable=True)
    take_profit = Column(Float, nullable=True)
    position_size = Column(Float, nullable=True)  # In dollars or shares
    
    status = Column(String(20), default="PENDING")  # PENDING, EXECUTED, CANCELLED, STOPPED
    execution_timestamp = Column(DateTime(timezone=True), nullable=True)
    
    notes = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_signals_analysis_id", "analysis_id"),
        Index("ix_signals_status", "status"),
    )


class Trade(Base):
    """
    Immutable recommendation-time trade entry used for forward P&L tracking.
    One row is created per actionable recommendation.
    Tracks conviction level and expected holding period to reduce churn.
    
    CRITICAL: `symbol` is the EXECUTION symbol (e.g., SBIT, SPXS, UCO) that was actually bought/sold.
    `underlying_symbol` is the base symbol (e.g., BITO, QQQ, USO) for reference.
    P&L is calculated using the execution symbol's prices.
    """
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    analysis_id = Column(Integer, ForeignKey("analysis_results.id"), nullable=False)
    request_id = Column(String(36), nullable=False)

    symbol = Column(String(10), nullable=False)  # EXECUTION symbol (SBIT, SPXS, UCO, etc.)
    underlying_symbol = Column(String(10), nullable=True)  # BASE symbol (BITO, QQQ, USO, etc.) for reference
    action = Column(String(10), nullable=False)  # BUY or SELL
    leverage = Column(String(10), nullable=False, default="1x")
    signal_type = Column(String(20), nullable=False)
    confidence_score = Column(Float, nullable=True)

    recommended_at = Column(DateTime(timezone=True), nullable=False, default=func.now())
    entry_price = Column(Float, nullable=False)  # Price for the EXECUTION symbol
    entry_price_timestamp = Column(DateTime(timezone=True), nullable=False)

    stop_loss_pct = Column(Float, nullable=True)
    take_profit_pct = Column(Float, nullable=True)
    
    # Conviction and holding period fields
    conviction_level = Column(String(20), nullable=True, default="MEDIUM")  # LOW, MEDIUM, HIGH
    holding_period_hours = Column(Integer, nullable=True, default=4)
    trading_type = Column(String(20), nullable=True, default="SWING")  # SCALP, SWING, POSITION, VOLATILE_EVENT
    holding_window_until = Column(DateTime(timezone=True), nullable=True)  # calculated: recommended_at + holding_period_hours

    __table_args__ = (
        Index("ix_trades_analysis_id", "analysis_id"),
        Index("ix_trades_symbol_recommended_at", "symbol", "recommended_at"),
        Index("ix_trades_underlying_symbol", "underlying_symbol"),
        Index("ix_trades_request_id", "request_id"),
        Index("ix_trades_holding_window_until", "holding_window_until"),
        Index("ix_trades_conviction_level", "conviction_level"),
    )


class TradeSnapshot(Base):
    """
    Immutable forward-price observation for a single trade horizon.
    Written once when a valid first-at-or-after-target price is found.
    """
    __tablename__ = "trade_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    trade_id = Column(Integer, ForeignKey("trades.id"), nullable=False)

    horizon_label = Column(String(10), nullable=False)  # 1h, 4h, 1d, 3d, 1w
    horizon_minutes = Column(Integer, nullable=False)
    target_timestamp = Column(DateTime(timezone=True), nullable=False)

    observed_price = Column(Float, nullable=False)
    observed_at = Column(DateTime(timezone=True), nullable=False)
    source_interval = Column(String(10), nullable=False, default="15m")

    raw_return_pct = Column(Float, nullable=False)
    leveraged_return_pct = Column(Float, nullable=False)

    __table_args__ = (
        UniqueConstraint("trade_id", "horizon_label", name="uq_trade_snapshots_trade_horizon"),
        Index("ix_trade_snapshots_trade_id", "trade_id"),
        Index("ix_trade_snapshots_horizon_label", "horizon_label"),
        Index("ix_trade_snapshots_target_timestamp", "target_timestamp"),
    )


class TradeExecution(Base):
    """
    User-recorded execution for a recommendation trade.
    Stores the actual side and fill price the user took.
    """
    __tablename__ = "trade_executions"

    id = Column(Integer, primary_key=True, index=True)
    trade_id = Column(Integer, ForeignKey("trades.id"), nullable=False)

    executed_action = Column(String(10), nullable=False)  # BUY or SELL
    executed_price = Column(Float, nullable=False)
    executed_at = Column(DateTime(timezone=True), nullable=False, default=func.now())
    notes = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("trade_id", name="uq_trade_executions_trade_id"),
        Index("ix_trade_executions_trade_id", "trade_id"),
        Index("ix_trade_executions_executed_at", "executed_at"),
    )


class TradeClose(Base):
    """
    User-recorded closing trade for a recommendation.
    When present, this price is used as the definitive realized P&L.
    """
    __tablename__ = "trade_closes"

    id = Column(Integer, primary_key=True, index=True)
    trade_id = Column(Integer, ForeignKey("trades.id"), nullable=False)

    closed_price = Column(Float, nullable=False)
    closed_at = Column(DateTime(timezone=True), nullable=False, default=func.now())
    notes = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("trade_id", name="uq_trade_closes_trade_id"),
        Index("ix_trade_closes_trade_id", "trade_id"),
    )


class PriceHistory(Base):
    """
    Daily OHLCV price history for tracked symbols.
    Persisted independently of analysis data — never cleared by reset-data.
    Used to compute technical indicators (RSI, MACD, SMA, etc.) without repeated yfinance calls.
    """
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(10), nullable=False)
    date = Column(String(10), nullable=False)  # YYYY-MM-DD
    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    adj_close = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)
    source = Column(String(20), nullable=False, default="yfinance")
    fetched_at = Column(DateTime(timezone=True), nullable=False, default=func.now())

    __table_args__ = (
        UniqueConstraint("symbol", "date", name="uq_price_history_symbol_date"),
        Index("ix_price_history_symbol_date", "symbol", "date"),
    )


class PaperTrade(Base):
    """
    Auto-executed paper trade simulating $100 per signal during market hours.
    One open position per underlying symbol at a time.
    Closed and replaced when the recommendation changes ticker, leverage, or direction.
    Closed without replacement on a HOLD signal.
    """
    __tablename__ = "paper_trades"

    id = Column(Integer, primary_key=True, index=True)
    underlying = Column(String(10), nullable=False)          # USO, QQQ, BITO, SPY, NVDA …
    execution_ticker = Column(String(10), nullable=False)    # UCO, TQQQ, SPXL, BITU …
    signal_type = Column(String(10), nullable=False)         # LONG or SHORT
    leverage = Column(String(10), nullable=False, default="1x")
    market_session = Column(String(20), nullable=True)       # open, pre-market, after-hours

    amount = Column(Float, nullable=False, default=100.0)    # dollars invested
    shares = Column(Float, nullable=False)                   # amount / entry_price
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float, nullable=True)                # None = still open

    entered_at = Column(DateTime(timezone=True), nullable=False)
    exited_at = Column(DateTime(timezone=True), nullable=True)   # None = still open

    realized_pnl = Column(Float, nullable=True)              # None = still open
    realized_pnl_pct = Column(Float, nullable=True)

    analysis_request_id = Column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_paper_trades_underlying", "underlying"),
        Index("ix_paper_trades_entered_at", "entered_at"),
        Index("ix_paper_trades_exited_at", "exited_at"),
    )


class AppConfig(Base):
    """
    Singleton application configuration and run-timing metadata.
    Stores autorun cadence, tracked symbols, prompt overrides, and last run timestamps.
    """
    __tablename__ = "app_config"

    id = Column(Integer, primary_key=True, default=1)

    auto_run_enabled = Column(Boolean, nullable=False, default=True)
    auto_run_interval_minutes = Column(Integer, nullable=False, default=30)
    tracked_symbols = Column(JSON, nullable=False, default=["USO", "BITO", "QQQ", "SPY"])
    custom_symbols = Column(JSON, nullable=False, default=[])
    max_posts = Column(Integer, nullable=False, default=50)
    include_backtest = Column(Boolean, nullable=False, default=True)
    lookback_days = Column(Integer, nullable=False, default=14)
    symbol_prompt_overrides = Column(JSON, nullable=False, default={})
    symbol_company_aliases = Column(JSON, nullable=False, default={})
    display_timezone = Column(String(64), nullable=False, default="")
    enabled_rss_feeds = Column(JSON, nullable=False, default=[])
    custom_rss_feeds = Column(JSON, nullable=False, default=[])
    custom_rss_feed_labels = Column(JSON, nullable=False, default={})
    rss_article_detail_mode = Column(String(20), nullable=False, default="normal")
    rss_article_limits = Column(JSON, nullable=False, default={"light": 5, "normal": 15, "detailed": 25})
    data_ingestion_interval_seconds = Column(Integer, nullable=False, default=900)
    snapshot_retention_limit = Column(Integer, nullable=False, default=12)
    extraction_model = Column(String(128), nullable=False, default="")
    reasoning_model = Column(String(128), nullable=False, default="")
    risk_profile = Column(String(20), nullable=False, default="moderate")
    web_research_enabled = Column(Boolean, nullable=False, default=False)

    last_analysis_started_at = Column(DateTime(timezone=True), nullable=True)
    last_analysis_completed_at = Column(DateTime(timezone=True), nullable=True)
    last_analysis_request_id = Column(String(36), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_app_config_last_analysis_started_at", "last_analysis_started_at"),
    )


# Create all tables
def init_db():
    """Initialize database by creating all tables."""
    Base.metadata.create_all(bind=engine)
    try:
        from .migrate import migrate
        migrate()
    except Exception as exc:
        print(f"Database migration warning: {exc}")


# Drop all tables (for testing/reinitialization)
def drop_db():
    """Drop all tables from the database."""
    Base.metadata.drop_all(bind=engine)
