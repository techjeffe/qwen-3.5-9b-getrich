from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import uvicorn


ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass


def _env_flag(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, "")).strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    enable_reload = _env_flag("UVICORN_RELOAD", default=(sys.platform != "win32"))
    uvicorn.run(
        "main:app",
        app_dir=str(BACKEND_DIR),
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=enable_reload,
        reload_dirs=[str(BACKEND_DIR)],
        log_level="info",
    )
