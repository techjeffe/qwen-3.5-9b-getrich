"""
SQLAlchemy ORM models for the trading system database
"""

import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float, JSON, Boolean, ForeignKey,
    Index, event
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .engine import engine

# Base class for all models
Base = type("Base", (object,), {"metadata": None})


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
    sentiment_analysis: Optional[Dict[str, Any]] = Column(JSON, nullable=True)
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
    backtest_results: Optional[Dict[str, Any]] = Column(JSON, nullable=True)
    
    # Metadata about the analysis run
    metadata = Column(JSON, nullable=True)

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


# Create all tables
def init_db():
    """Initialize database by creating all tables."""
    Base.metadata.create_all(bind=engine)


# Drop all tables (for testing/reinitialization)
def drop_db():
    """Drop all tables from the database."""
    Base.metadata.drop_all(bind=engine)
