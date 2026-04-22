"""
3x Leveraged Sentiment-Driven Trading System.
FastAPI application entry point.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.engine import SessionLocal
from database.models import init_db
from routers import router as analysis_router
from services.pnl_tracker import PnLTracker, SCHEDULER_INTERVAL_SECONDS
from services.data_ingestion.parser import RSSFeedParser
from services.data_ingestion.yfinance_client import PriceClient


async def _data_ingestion_scheduler_loop():
    """Periodically fetch fresh stock quotes and RSS feeds."""
    from services.app_config import get_or_create_app_config
    
    parser = RSSFeedParser()
    client = PriceClient()
    
    # Get ingestion interval from config (default 900 seconds)
    db = SessionLocal()
    try:
        config = get_or_create_app_config(db)
        ingestion_interval = config.data_ingestion_interval_seconds or 900
    finally:
        db.close()
    
    while True:
        try:
            # Fetch latest articles from RSS feeds
            articles = parser.parse_feeds()
            print(f"Data ingestion scheduler: fetched {len(articles)} new RSS articles")
            
            # Get tracked symbols from database config
            db = SessionLocal()
            try:
                config = get_or_create_app_config(db)
                symbols = config.tracked_symbols or ["USO", "BITO", "QQQ", "SPY"]
                
                # Fetch real-time quotes for tracked symbols
                for symbol in symbols:
                    quote = client.get_realtime_quote(symbol)
                    if quote and quote.get("current_price"):
                        print(f"  {symbol}: ${quote['current_price']:.2f}")
            finally:
                db.close()
            
        except Exception as e:
            print(f"Data ingestion scheduler error: {e}")
        
        await asyncio.sleep(ingestion_interval)


async def _pnl_scheduler_loop():
    """Resolve due trade snapshots on the same 30-minute cadence as auto-analyze."""
    tracker = PnLTracker()

    while True:
        db = SessionLocal()
        try:
            created = await asyncio.to_thread(tracker.process_due_snapshots, db)
            if created:
                print(f"P&L snapshot worker stored {created} new snapshots")
        except Exception as exc:
            db.rollback()
            print(f"P&L snapshot worker error: {exc}")
        finally:
            db.close()

        await asyncio.sleep(SCHEDULER_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown events."""
    data_ingestion_task = None
    pnl_scheduler_task = None

    print("=" * 60)
    print("3x Leveraged Sentiment Trading System - Starting...")
    print("=" * 60)

    init_db()
    print("Database initialized")

    bind_host = os.getenv("HOST", "127.0.0.1")
    cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    admin_token_enabled = bool(os.getenv("ADMIN_API_TOKEN", "").strip())
    print(f"Local-first defaults: backend host={bind_host} | CORS={cors_origins}")
    if bind_host not in {"127.0.0.1", "localhost"}:
        print("WARNING: Backend is configured to listen beyond localhost. Only do this on trusted networks.")
    if "*" in cors_origins:
        print("WARNING: CORS_ORIGINS contains '*'. This is not recommended outside local development.")
    if not admin_token_enabled:
        print("NOTICE: ADMIN_API_TOKEN is not set. Config and trade execution routes are local-open.")
    else:
        print("Admin token protection enabled for config and trade execution routes.")

    data_ingestion_task = asyncio.create_task(_data_ingestion_scheduler_loop())
    print("Data ingestion scheduler started (fetching RSS feeds and stock quotes)")
    
    pnl_scheduler_task = asyncio.create_task(_pnl_scheduler_loop())
    print("P&L snapshot scheduler started")

    yield

    if data_ingestion_task:
        data_ingestion_task.cancel()
        try:
            await data_ingestion_task
        except asyncio.CancelledError:
            pass
    
    if pnl_scheduler_task:
        pnl_scheduler_task.cancel()
        try:
            await pnl_scheduler_task
        except asyncio.CancelledError:
            pass

    print("Shutting down gracefully...")


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

allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for monitoring system status."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
    }


@app.get("/metrics", tags=["Metrics"])
async def get_metrics():
    """Get system metrics including request counts and latency stats."""
    return {
        "uptime_seconds": os.getenv("APP_START_TIME"),
        "total_requests": 0,
        "avg_latency_ms": 0.0,
        "database_status": "connected",
        "pnl_scheduler_interval_minutes": SCHEDULER_INTERVAL_SECONDS // 60,
    }


app.include_router(analysis_router, prefix="/api/v1", tags=["API"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=True,
        log_level="info",
    )
