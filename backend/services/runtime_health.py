"""
In-memory runtime health tracking for user-facing diagnostics.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime
from threading import Lock
from typing import Any, Deque, Dict, Optional


_lock = Lock()
_started_at = datetime.utcnow()
_request_count = 0
_request_latency_total_ms = 0.0
_recent_data_pulls: Deque[Dict[str, Any]] = deque(maxlen=6)
_last_analysis: Dict[str, Any] = {
    "status": "idle",
    "request_id": None,
    "duration_ms": None,
    "active_model": None,
    "completed_at": None,
    "error": None,
}


def _serialize_timestamp(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def record_request(duration_ms: float) -> None:
    global _request_count, _request_latency_total_ms
    with _lock:
        _request_count += 1
        _request_latency_total_ms += max(0.0, float(duration_ms))


def record_data_pull(
    *,
    status: str,
    source: str,
    summary: str,
    details: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> None:
    event = {
        "status": status,
        "source": source,
        "summary": summary,
        "details": details or {},
        "error": error,
        "checked_at": datetime.utcnow(),
    }
    with _lock:
        _recent_data_pulls.appendleft(event)


def record_analysis_result(
    *,
    status: str,
    request_id: Optional[str] = None,
    duration_ms: Optional[float] = None,
    active_model: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    with _lock:
        _last_analysis.update(
            {
                "status": status,
                "request_id": request_id,
                "duration_ms": float(duration_ms) if duration_ms is not None else None,
                "active_model": active_model,
                "completed_at": datetime.utcnow(),
                "error": error,
            }
        )


def get_runtime_snapshot() -> Dict[str, Any]:
    with _lock:
        avg_latency_ms = (_request_latency_total_ms / _request_count) if _request_count else 0.0
        recent_data_pulls = [
            {
                **item,
                "checked_at": _serialize_timestamp(item.get("checked_at")),
            }
            for item in list(_recent_data_pulls)
        ]
        last_analysis = {
            **_last_analysis,
            "completed_at": _serialize_timestamp(_last_analysis.get("completed_at")),
        }

    uptime_seconds = max(0, int((datetime.utcnow() - _started_at).total_seconds()))
    return {
        "started_at": _serialize_timestamp(_started_at),
        "uptime_seconds": uptime_seconds,
        "request_count": _request_count,
        "avg_request_latency_ms": round(avg_latency_ms, 2),
        "recent_data_pulls": recent_data_pulls,
        "last_analysis": last_analysis,
    }
