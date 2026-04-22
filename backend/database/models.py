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
    """
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    analysis_id = Column(Integer, ForeignKey("analysis_results.id"), nullable=False)
    request_id = Column(String(36), nullable=False)

    symbol = Column(String(10), nullable=False)
    action = Column(String(10), nullable=False)  # BUY or SELL
    leverage = Column(String(10), nullable=False, default="1x")
    signal_type = Column(String(20), nullable=False)
    confidence_score = Column(Float, nullable=True)

    recommended_at = Column(DateTime(timezone=True), nullable=False, default=func.now())
    entry_price = Column(Float, nullable=False)
    entry_price_timestamp = Column(DateTime(timezone=True), nullable=False)

    stop_loss_pct = Column(Float, nullable=True)
    take_profit_pct = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_trades_analysis_id", "analysis_id"),
        Index("ix_trades_symbol_recommended_at", "symbol", "recommended_at"),
        Index("ix_trades_request_id", "request_id"),
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
    max_posts = Column(Integer, nullable=False, default=50)
    include_backtest = Column(Boolean, nullable=False, default=True)
    lookback_days = Column(Integer, nullable=False, default=14)
    symbol_prompt_overrides = Column(JSON, nullable=False, default={})
    data_ingestion_interval_seconds = Column(Integer, nullable=False, default=900)

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


# Drop all tables (for testing/reinitialization)
def drop_db():
    """Drop all tables from the database."""
    Base.metadata.drop_all(bind=engine)
