"""
Application configuration helpers.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from database.models import AppConfig, AnalysisResult


DEFAULT_TRACKED_SYMBOLS = ["USO", "BITO", "QQQ", "SPY"]
SUPPORTED_SYMBOLS = {"SPY", "USO", "BITO", "QQQ", "SQQQ", "UNG"}
DEFAULT_ESTIMATED_ANALYSIS_SECONDS = 82


def _normalize_symbols(symbols: Any) -> List[str]:
    if not isinstance(symbols, list):
        return DEFAULT_TRACKED_SYMBOLS.copy()
    normalized: List[str] = []
    for symbol in symbols:
        value = str(symbol or "").upper().strip()
        if value and value in SUPPORTED_SYMBOLS and value not in normalized:
            normalized.append(value)
    return normalized or DEFAULT_TRACKED_SYMBOLS.copy()


def _normalize_prompt_overrides(data: Any) -> Dict[str, str]:
    if not isinstance(data, dict):
        return {}
    normalized: Dict[str, str] = {}
    for symbol, prompt in data.items():
        sym = str(symbol or "").upper().strip()
        if sym in SUPPORTED_SYMBOLS:
            normalized[sym] = str(prompt or "").strip()
    return normalized


def get_or_create_app_config(db: Session) -> AppConfig:
    config = db.query(AppConfig).filter(AppConfig.id == 1).first()
    if config:
        if not config.tracked_symbols:
            config.tracked_symbols = DEFAULT_TRACKED_SYMBOLS.copy()
        if config.symbol_prompt_overrides is None:
            config.symbol_prompt_overrides = {}
        return config

    config = AppConfig(
        id=1,
        auto_run_enabled=True,
        auto_run_interval_minutes=30,
        tracked_symbols=DEFAULT_TRACKED_SYMBOLS.copy(),
        max_posts=50,
        include_backtest=True,
        lookback_days=14,
        symbol_prompt_overrides={},
        data_ingestion_interval_seconds=900,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def update_app_config(db: Session, payload: Dict[str, Any]) -> AppConfig:
    config = get_or_create_app_config(db)

    if "auto_run_enabled" in payload:
        config.auto_run_enabled = bool(payload.get("auto_run_enabled"))
    if "auto_run_interval_minutes" in payload:
        try:
            value = int(payload.get("auto_run_interval_minutes"))
        except (TypeError, ValueError):
            value = config.auto_run_interval_minutes
        config.auto_run_interval_minutes = max(5, min(360, value))
    if "tracked_symbols" in payload:
        config.tracked_symbols = _normalize_symbols(payload.get("tracked_symbols"))
    if "max_posts" in payload:
        try:
            value = int(payload.get("max_posts"))
        except (TypeError, ValueError):
            value = config.max_posts
        config.max_posts = max(1, min(200, value))
    if "include_backtest" in payload:
        config.include_backtest = bool(payload.get("include_backtest"))
    if "lookback_days" in payload:
        try:
            value = int(payload.get("lookback_days"))
        except (TypeError, ValueError):
            value = config.lookback_days
        config.lookback_days = max(7, min(30, value))
    if "symbol_prompt_overrides" in payload:
        config.symbol_prompt_overrides = _normalize_prompt_overrides(payload.get("symbol_prompt_overrides"))
    if "data_ingestion_interval_seconds" in payload:
        try:
            value = int(payload.get("data_ingestion_interval_seconds"))
        except (TypeError, ValueError):
            value = config.data_ingestion_interval_seconds
        config.data_ingestion_interval_seconds = max(60, min(3600, value))

    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def mark_analysis_started(db: Session, request_id: str) -> AppConfig:
    config = get_or_create_app_config(db)
    config.last_analysis_started_at = datetime.utcnow()
    config.last_analysis_request_id = request_id
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def mark_analysis_completed(db: Session, request_id: str) -> AppConfig:
    config = get_or_create_app_config(db)
    config.last_analysis_completed_at = datetime.utcnow()
    config.last_analysis_request_id = request_id
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def config_to_dict(config: AppConfig) -> Dict[str, Any]:
    seconds_until_next = 0
    can_auto_run_now = True

    if config.auto_run_enabled and config.last_analysis_started_at:
        next_run_at = config.last_analysis_started_at + timedelta(minutes=config.auto_run_interval_minutes)
        remaining = int((next_run_at - datetime.utcnow()).total_seconds())
        seconds_until_next = max(0, remaining)
        can_auto_run_now = seconds_until_next == 0
    elif not config.auto_run_enabled:
        can_auto_run_now = False

    return {
        "auto_run_enabled": config.auto_run_enabled,
        "auto_run_interval_minutes": config.auto_run_interval_minutes,
        "tracked_symbols": _normalize_symbols(config.tracked_symbols),
        "max_posts": config.max_posts,
        "include_backtest": config.include_backtest,
        "lookback_days": config.lookback_days,
        "symbol_prompt_overrides": _normalize_prompt_overrides(config.symbol_prompt_overrides),
        "data_ingestion_interval_seconds": config.data_ingestion_interval_seconds,
        "last_analysis_started_at": config.last_analysis_started_at.isoformat() if config.last_analysis_started_at else None,
        "last_analysis_completed_at": config.last_analysis_completed_at.isoformat() if config.last_analysis_completed_at else None,
        "last_analysis_request_id": config.last_analysis_request_id,
        "seconds_until_next_auto_run": seconds_until_next,
        "can_auto_run_now": can_auto_run_now,
        "supported_symbols": sorted(SUPPORTED_SYMBOLS),
        "estimated_analysis_seconds": DEFAULT_ESTIMATED_ANALYSIS_SECONDS,
    }


def config_to_dict_with_stats(db: Session, config: AppConfig) -> Dict[str, Any]:
    payload = config_to_dict(config)
    durations_ms: List[float] = []

    recent_results = (
        db.query(AnalysisResult)
        .order_by(AnalysisResult.timestamp.desc())
        .limit(10)
        .all()
    )

    for result in recent_results:
        run_metadata = result.run_metadata or {}
        try:
            value = float(run_metadata.get("processing_time_ms", 0.0))
        except (TypeError, ValueError):
            value = 0.0
        if value > 0:
            durations_ms.append(value)

    if durations_ms:
        avg_seconds = round(sum(durations_ms) / len(durations_ms) / 1000)
        payload["estimated_analysis_seconds"] = max(20, min(300, avg_seconds))
        payload["recent_analysis_seconds"] = [round(value / 1000) for value in durations_ms]
    else:
        payload["recent_analysis_seconds"] = []

    return payload
