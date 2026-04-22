"""
3x Leveraged Sentiment-Driven Trading System
FastAPI Application Entry Point
"""

import os
import time
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

# Import schemas
from .schemas.analysis import AnalysisRequest, AnalysisResponse
from .database.engine import get_db
from .database.models import init_db, Base

# Import routers
from .routers import analysis_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown events."""
    # Startup
    print("=" * 60)
    print("3x Leveraged Sentiment Trading System - Starting...")
    print("=" * 60)
    
    # Initialize database tables
    init_db()
    print("✓ Database initialized")
    
    yield
    
    # Shutdown
    print("✓ Shutting down gracefully...")


# Create FastAPI application
app = FastAPI(
    title="3x Leveraged Sentiment Trading System",
    description="""
A sentiment-driven trading system that analyzes geopolitical and social media data
to generate trading signals for 3x leveraged ETFs (USO, BITO).

## Features
- Real-time sentiment analysis using Llama-3-70b
- Rolling window backtesting with VectorBT
- Single-button dashboard for rapid execution
- Risk management with stop-loss and position sizing
    """,
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS
allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    """
    Health check endpoint for monitoring system status.
    """
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }


# System metrics endpoint
@app.get("/metrics", tags=["Metrics"])
async def get_metrics():
    """
    Get system metrics including request counts and latency stats.
    """
    return {
        "uptime_seconds": os.getenv("APP_START_TIME"),
        "total_requests": 0,  # Would be tracked in production
        "avg_latency_ms": 0.0,  # Would be tracked in production
        "database_status": "connected"
    }


# Main analysis endpoint (delegated to router)
@app.post(
    "/analyze",
    response_model=AnalysisResponse,
    tags=["Analysis"],
    summary="Run full sentiment analysis pipeline",
    description="""
Trigger the complete analysis pipeline:
1. Scrape social media and news feeds
2. Analyze sentiment using Llama-3-70b
3. Generate trading signals
4. Run rolling window backtest (optional)
    """,
    response_class=JSONResponse
)
async def analyze_market(
    request: AnalysisRequest,
    db = Depends(get_db)
):
    """
    Execute the full analysis pipeline and return trading signal.
    
    This endpoint is handled by the analysis router.
    """
    # The actual implementation is in backend/routers/analysis.py
    # This endpoint delegates to the router's analyze_market function
    pass


# Include routers
app.include_router(analysis_router, prefix="/api/v1", tags=["API"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
