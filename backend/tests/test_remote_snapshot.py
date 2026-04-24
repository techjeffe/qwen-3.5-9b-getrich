from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


sys.path.append(str(Path(__file__).resolve().parents[1]))

from database.models import AnalysisResult, AppConfig, Base
from services.remote_snapshot import (
    build_remote_snapshot_caption,
    build_remote_snapshot_payload,
    should_send_remote_snapshot,
)


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _seed_config(db_session, **overrides):
    payload = dict(
        id=1,
        auto_run_enabled=True,
        auto_run_interval_minutes=30,
        tracked_symbols=["USO", "BITO", "QQQ", "SPY"],
        custom_symbols=[],
        max_posts=50,
        include_backtest=True,
        lookback_days=14,
        symbol_prompt_overrides={},
        symbol_company_aliases={},
        display_timezone="America/Chicago",
        enabled_rss_feeds=[],
        custom_rss_feeds=[],
        custom_rss_feed_labels={},
        rss_article_detail_mode="normal",
        rss_article_limits={"light": 5, "normal": 15, "detailed": 25},
        data_ingestion_interval_seconds=900,
        snapshot_retention_limit=12,
        extraction_model="",
        reasoning_model="",
        risk_profile="moderate",
        web_research_enabled=False,
        remote_snapshot_enabled=True,
        remote_snapshot_mode="telegram",
        remote_snapshot_interval_minutes=360,
        remote_snapshot_send_on_position_change=True,
        remote_snapshot_include_closed_trades=False,
        remote_snapshot_max_recommendations=2,
    )
    payload.update(overrides)
    config = AppConfig(**payload)
    db_session.add(config)
    db_session.commit()
    return config


def _seed_analysis(db_session, request_id: str, timestamp: datetime, recommendations):
    row = AnalysisResult(
        request_id=request_id,
        timestamp=timestamp,
        sentiment_data={},
        signal={
            "signal_type": "LONG",
            "confidence_score": 0.72,
            "urgency": "MEDIUM",
            "entry_symbol": "TQQQ",
            "recommendations": recommendations,
        },
        run_metadata={
            "model_name": "qwen",
            "dataset_snapshot": {
                "extraction_model": "qwen-stage1",
                "reasoning_model": "qwen-stage2",
            },
        },
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_build_remote_snapshot_payload_limits_recommendations(monkeypatch, db_session):
    _seed_config(db_session, remote_snapshot_max_recommendations=2)
    _seed_analysis(
        db_session,
        "prev-1",
        datetime(2026, 4, 24, 8, 0, tzinfo=timezone.utc),
        [{"underlying_symbol": "QQQ", "action": "BUY", "symbol": "TQQQ", "leverage": "3x"}],
    )
    _seed_analysis(
        db_session,
        "cur-1",
        datetime(2026, 4, 24, 8, 30, tzinfo=timezone.utc),
        [
            {"underlying_symbol": "QQQ", "action": "BUY", "symbol": "TQQQ", "leverage": "3x", "thesis": "LONG"},
            {"underlying_symbol": "SPY", "action": "BUY", "symbol": "SPXL", "leverage": "3x", "thesis": "LONG"},
            {"underlying_symbol": "BITO", "action": "BUY", "symbol": "BITU", "leverage": "2x", "thesis": "LONG"},
        ],
    )

    monkeypatch.setattr(
        "services.remote_snapshot.get_paper_trading_summary",
        lambda db: {
            "market": {"label": "Market Open"},
            "summary": {"total_pnl": 12.43, "open_pnl": 2.1, "realized_pnl": 10.33, "win_rate": 55.0, "total_trades": 4, "open_positions": 2, "closed_trades": 2},
            "open_positions": [{"underlying": "QQQ", "execution_ticker": "TQQQ", "signal_type": "LONG", "unrealized_pnl": 2.1}],
            "closed_trades": [{"underlying": "SPY", "execution_ticker": "SPXL", "realized_pnl": 5.0}],
        },
    )

    payload = build_remote_snapshot_payload(db_session, request_id="cur-1")

    assert payload["request_id"] == "cur-1"
    assert len(payload["recommendations"]) == 2
    assert payload["recommendation_changes"] == [
        "BITO: No recommendation -> BUY BITU 2x",
        "SPY: No recommendation -> BUY SPXL 3x",
    ]
    caption = build_remote_snapshot_caption(payload)
    assert "Net P&L +$12.43" in caption


def test_build_remote_snapshot_payload_filters_closed_trades_since_last_send(monkeypatch, db_session):
    _seed_config(
        db_session,
        remote_snapshot_max_recommendations=2,
        remote_snapshot_include_closed_trades=True,
        last_remote_snapshot_sent_at=datetime(2026, 4, 24, 8, 15, tzinfo=timezone.utc),
    )
    _seed_analysis(
        db_session,
        "cur-closed",
        datetime(2026, 4, 24, 8, 30, tzinfo=timezone.utc),
        [{"underlying_symbol": "QQQ", "action": "BUY", "symbol": "TQQQ", "leverage": "3x", "thesis": "LONG"}],
    )

    monkeypatch.setattr(
        "services.remote_snapshot.get_paper_trading_summary",
        lambda db: {
            "market": {"label": "Market Open"},
            "summary": {"total_pnl": 5.5, "open_pnl": 1.25, "realized_pnl": 4.25, "win_rate": 50.0, "total_trades": 3, "open_positions": 1, "closed_trades": 2},
            "open_positions": [
                {"underlying": "QQQ", "execution_ticker": "TQQQ", "signal_type": "LONG", "unrealized_pnl": 1.25},
                {"underlying": "SPY", "execution_ticker": "SPXL", "signal_type": "LONG", "unrealized_pnl": 0.75},
            ],
            "closed_trades": [
                {"underlying": "QQQ", "execution_ticker": "TQQQ", "realized_pnl": 2.0, "closed_at": "2026-04-24T08:10:00+00:00"},
                {"underlying": "SPY", "execution_ticker": "SPXL", "realized_pnl": 2.25, "closed_at": "2026-04-24T08:20:00+00:00"},
            ],
        },
    )

    payload = build_remote_snapshot_payload(db_session, request_id="cur-closed")

    assert len(payload["positions"]) == 2
    assert len(payload["closed_trades"]) == 1
    assert payload["closed_trades"][0]["underlying"] == "SPY"
    assert payload["last_sent_label"]


def test_should_send_remote_snapshot_skips_duplicate_unchanged_run(db_session):
    config = _seed_config(
        db_session,
        last_remote_snapshot_sent_at=datetime.now(timezone.utc),
        last_remote_snapshot_request_id="prev-sent",
        remote_snapshot_interval_minutes=360,
        remote_snapshot_send_on_position_change=True,
    )
    payload = {
        "request_id": "cur-2",
        "pnl_summary": {"total_pnl": 12.0},
        "positions": [],
        "closed_trades": [],
    }
    gate = should_send_remote_snapshot(config, payload)

    assert gate["should_send"] is False
    assert gate["position_changed"] is False
    assert gate["interval_elapsed"] is False


def test_should_send_remote_snapshot_allows_position_change(db_session):
    last_sent_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    config = _seed_config(
        db_session,
        last_remote_snapshot_sent_at=last_sent_at,
        last_remote_snapshot_request_id="prev-sent",
        remote_snapshot_interval_minutes=360,
        remote_snapshot_send_on_position_change=True,
    )
    payload = {
        "request_id": "cur-3",
        "pnl_summary": {"total_pnl": 10.5},
        "positions": [
                {
                    "underlying": "QQQ",
                    "execution_ticker": "SQQQ",
                    "signal_type": "SHORT",
                    "entered_at": (last_sent_at + timedelta(minutes=2)).isoformat(),
                }
            ],
            "closed_trades": [],
    }
    gate = should_send_remote_snapshot(config, payload)

    assert gate["should_send"] is True
    assert gate["position_changed"] is True
    assert gate["interval_elapsed"] is False


def test_should_send_remote_snapshot_allows_interval_send_without_position_change(db_session):
    config = _seed_config(
        db_session,
        last_remote_snapshot_sent_at=datetime.now(timezone.utc) - timedelta(minutes=45),
        last_remote_snapshot_request_id="prev-sent",
        remote_snapshot_interval_minutes=30,
        remote_snapshot_send_on_position_change=False,
    )
    payload = {
        "request_id": "cur-4",
        "pnl_summary": {"total_pnl": 9.25},
        "positions": [],
        "closed_trades": [],
    }

    gate = should_send_remote_snapshot(config, payload)

    assert gate["should_send"] is True
    assert gate["position_changed"] is False
    assert gate["interval_elapsed"] is True
