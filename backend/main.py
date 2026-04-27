"""
3x Leveraged Sentiment-Driven Trading System.
FastAPI application entry point.
"""

import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware

from database.engine import SessionLocal
from database.models import AnalysisResult
from database.models import init_db
from routers import router as analysis_router
from services.app_config import config_to_dict_with_stats, get_or_create_app_config
from services.pnl_tracker import PnLTracker, SCHEDULER_INTERVAL_SECONDS
from services.data_ingestion.worker import run_ingestion_cycle
from services.data_ingestion.yfinance_client import PriceClient
from services.ollama import get_ollama_status
from services.runtime_health import get_runtime_snapshot, record_data_pull, record_request

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass


class _SuppressPricesAccessLog(logging.Filter):
    """Drop uvicorn access log lines for the prices endpoint (cache-hit polling noise)."""
    def filter(self, record: logging.LogRecord) -> bool:
        return "/api/v1/prices" not in record.getMessage()

logging.getLogger("uvicorn.access").addFilter(_SuppressPricesAccessLog())


async def _data_ingestion_scheduler_loop():
    """Periodically ingest RSS articles into the DB queue and refresh quotes."""
    from services.app_config import get_or_create_app_config

    client = PriceClient()
    try:
        startup_grace_seconds = max(0, int(os.getenv("INGESTION_STARTUP_GRACE_SECONDS", "20")))
    except ValueError:
        startup_grace_seconds = 20

    if startup_grace_seconds > 0:
        print(f"Data ingestion scheduler startup grace: waiting {startup_grace_seconds}s before first cycle")
        await asyncio.sleep(startup_grace_seconds)
    
    while True:
        ingestion_interval = 900
        try:
            db = SessionLocal()
            try:
                config = get_or_create_app_config(db)
                ingestion_interval = int(config.data_ingestion_interval_seconds or 900)
                now = datetime.utcnow()
                lock_request_id = str(getattr(config, "analysis_lock_request_id", "") or "").strip()
                lock_expires_at = getattr(config, "analysis_lock_expires_at", None)
                if lock_request_id and lock_expires_at and lock_expires_at > now:
                    wait_seconds = max(5, min(30, int((lock_expires_at - now).total_seconds())))
                    print(
                        "Data ingestion scheduler deferred: "
                        f"analysis lock owned by {lock_request_id} until {lock_expires_at.isoformat()}"
                    )
                    await asyncio.sleep(wait_seconds)
                    continue
            finally:
                db.close()

            ingestion_stats = await run_ingestion_cycle()
            print(
                "Data ingestion scheduler: "
                f"stage0={ingestion_stats.get('stage0_matches', 0)} "
                f"stored={ingestion_stats.get('stored_count', 0)} "
                f"fast_lane={len(ingestion_stats.get('fast_lane_article_ids', []))}"
            )

            # Get tracked symbols from database config
            db = SessionLocal()
            quotes_ok = []
            quotes_failed = []
            try:
                config = get_or_create_app_config(db)
                symbols = config.tracked_symbols or ["USO", "BITO", "QQQ", "SPY"]

                # Fetch real-time quotes for tracked symbols
                for symbol in symbols:
                    quote = client.get_realtime_quote(symbol)
                    if quote and quote.get("current_price"):
                        print(f"  {symbol}: ${quote['current_price']:.2f}")
                        quotes_ok.append(symbol)
                    else:
                        quotes_failed.append(symbol)
            finally:
                db.close()

            status = "ok" if not quotes_failed else "partial"
            summary = (
                f"Ingested {ingestion_stats.get('stored_count', 0)} queued articles and "
                f"fetched {len(quotes_ok)}/{len(quotes_ok) + len(quotes_failed)} quotes"
            )
            record_data_pull(
                status=status,
                source="scheduler",
                summary=summary,
                details={
                    "ingestion": ingestion_stats,
                    "quotes_ok": quotes_ok,
                    "quotes_failed": quotes_failed,
                },
                error=None if not quotes_failed else f"Missing quotes for: {', '.join(quotes_failed)}",
            )
        except Exception as e:
            print(f"Data ingestion scheduler error: {e}")
            record_data_pull(
                status="error",
                source="scheduler",
                summary="Background data ingestion failed",
                details={},
                error=str(e),
            )

        await asyncio.sleep(ingestion_interval)


async def _alpaca_poll_scheduler_loop():
    """Poll Alpaca every 5 minutes for fill-status updates on pending orders."""
    while True:
        await asyncio.sleep(300)
        try:
            from services.alpaca_broker import is_alpaca_configured, poll_unfilled_orders
            if is_alpaca_configured():
                db = SessionLocal()
                try:
                    updated = await asyncio.to_thread(poll_unfilled_orders, db)
                    if updated:
                        print(f"[alpaca] poll: updated {updated} order(s)")
                except Exception as exc:
                    print(f"[alpaca] poll error: {exc}")
                finally:
                    db.close()
        except Exception as exc:
            print(f"[alpaca] poll scheduler error: {exc}")


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
    pnl_scheduler_task  = None
    alpaca_poll_task    = None

    print("=" * 60)
    print("3x Leveraged Sentiment Trading System - Starting...")
    print("=" * 60)

    init_db()
    print("Database initialized")

    try:
        from services.alpaca_broker import is_alpaca_configured, reconcile_on_startup
        if is_alpaca_configured():
            db = SessionLocal()
            try:
                reconcile_on_startup(db)
            finally:
                db.close()
    except Exception as exc:
        print(f"[alpaca] startup reconciliation skipped: {exc}")

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

    alpaca_poll_task = asyncio.create_task(_alpaca_poll_scheduler_loop())
    print("Alpaca order poll scheduler started (5 min interval)")

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

    if alpaca_poll_task:
        alpaca_poll_task.cancel()
        try:
            await alpaca_poll_task
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


@app.middleware("http")
async def track_request_metrics(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    record_request((time.perf_counter() - started) * 1000)
    return response


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for monitoring system status."""
    runtime = get_runtime_snapshot()
    db_status = "connected"
    config_payload = {}
    recent_run_count = 0
    avg_analysis_runtime_ms = None
    last_completed_at = None

    try:
        db = SessionLocal()
        try:
            config = get_or_create_app_config(db)
            config_payload = config_to_dict_with_stats(db, config)
            recent_run_count = db.query(AnalysisResult).count()
        finally:
            db.close()
    except Exception as exc:
        db_status = f"error: {exc}"

    recent_analysis_seconds = config_payload.get("recent_analysis_seconds") or []
    if recent_analysis_seconds:
        avg_analysis_runtime_ms = round(sum(recent_analysis_seconds) / len(recent_analysis_seconds) * 1000, 2)

    last_data_pull = (runtime.get("recent_data_pulls") or [None])[0]
    last_analysis = runtime.get("last_analysis") or {}
    if not last_analysis.get("completed_at"):
        last_analysis["completed_at"] = config_payload.get("last_analysis_completed_at")
    if not last_analysis.get("request_id"):
        last_analysis["request_id"] = config_payload.get("last_analysis_request_id")
    if not last_analysis.get("active_model"):
        try:
            ollama_status = get_ollama_status()
        except Exception as exc:
            ollama_status = {
                "reachable": False,
                "ollama_root": os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate").replace("/api/generate", ""),
                "configured_model": os.getenv("OLLAMA_MODEL", "").strip(),
                "active_model": "",
                "available_models": [],
                "resolution": "unreachable",
                "error": str(exc),
            }
    else:
        try:
            ollama_status = get_ollama_status()
        except Exception as exc:
            ollama_status = {
                "reachable": False,
                "ollama_root": os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate").replace("/api/generate", ""),
                "configured_model": os.getenv("OLLAMA_MODEL", "").strip(),
                "active_model": last_analysis.get("active_model") or "",
                "available_models": [],
                "resolution": "unreachable",
                "error": str(exc),
            }

    if not avg_analysis_runtime_ms and last_analysis.get("duration_ms"):
        avg_analysis_runtime_ms = round(float(last_analysis["duration_ms"]), 2)

    overall_status = "healthy"
    if db_status != "connected" or not ollama_status.get("reachable", False):
        overall_status = "degraded"
    if last_data_pull and last_data_pull.get("status") == "error":
        overall_status = "degraded"
    if last_analysis.get("status") == "failed":
        overall_status = "degraded"

    last_completed_at = config_payload.get("last_analysis_completed_at")

    return {
        "status": overall_status,
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
        "database_status": db_status,
        "runtime": {
            "started_at": runtime.get("started_at"),
            "uptime_seconds": runtime.get("uptime_seconds"),
            "request_count": runtime.get("request_count"),
            "avg_request_latency_ms": runtime.get("avg_request_latency_ms"),
        },
        "model": ollama_status,
        "analysis": {
            "avg_runtime_ms": avg_analysis_runtime_ms,
            "recent_analysis_seconds": recent_analysis_seconds,
            "last_request_id": last_analysis.get("request_id"),
            "last_completed_at": last_analysis.get("completed_at") or last_completed_at,
            "last_status": last_analysis.get("status"),
            "last_error": last_analysis.get("error"),
            "recent_run_count": recent_run_count,
            "tracked_symbols": config_payload.get("tracked_symbols") or ["USO", "BITO", "QQQ", "SPY"],
            "auto_run_enabled": config_payload.get("auto_run_enabled"),
            "seconds_until_next_auto_run": config_payload.get("seconds_until_next_auto_run"),
        },
        "data_pulls": {
            "latest": last_data_pull,
            "recent": runtime.get("recent_data_pulls"),
        },
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
