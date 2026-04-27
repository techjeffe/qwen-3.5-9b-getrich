from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


sys.path.append(str(Path(__file__).resolve().parents[1]))

from database.models import AlpacaOrder, AppConfig, Base, PaperTrade
from services.alpaca_broker import maybe_execute_alpaca_order


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
        allow_extended_hours_trading=True,
        alpaca_execution_mode="live",
        alpaca_live_trading_enabled=True,
        alpaca_allow_short_selling=False,
        alpaca_max_position_usd=None,
        alpaca_max_total_exposure_usd=None,
        alpaca_order_type="market",
        alpaca_limit_slippage_pct=0.002,
        alpaca_daily_loss_limit_usd=None,
        alpaca_max_consecutive_losses=3,
    )
    payload.update(overrides)
    config = AppConfig(**payload)
    db_session.add(config)
    db_session.commit()
    return config


class DummyBroker:
    def __init__(self, mode: str = "live") -> None:
        self.mode = mode
        self.orders = []

    def place_order(self, **kwargs):
        self.orders.append(kwargs)
        return {
            "id": f"alpaca-{len(self.orders)}",
            "client_order_id": kwargs.get("client_order_id"),
            "type": kwargs.get("order_type"),
            "time_in_force": kwargs.get("time_in_force"),
            "status": "accepted",
            "qty": kwargs.get("qty"),
        }

    def get_position(self, symbol: str):
        return {"qty": "2"}


@pytest.mark.parametrize("event,side", [("open", "buy"), ("close", "sell")])
def test_extended_hours_orders_use_limit_and_qty(db_session, monkeypatch, event, side):
    config = _seed_config(db_session, allow_extended_hours_trading=True, alpaca_order_type="market")
    paper_trade = PaperTrade(
        underlying="SPY",
        execution_ticker="SPY",
        signal_type="LONG",
        leverage="1x",
        market_session="pre-market",
        amount=1000.0,
        shares=2.0,
        entry_price=500.0,
        entered_at=datetime.utcnow(),
        analysis_request_id="req-1",
    )
    db_session.add(paper_trade)
    db_session.commit()

    if event == "close":
        db_session.add(
            AlpacaOrder(
                paper_trade_id=paper_trade.id,
                alpaca_order_id="existing-open",
                client_order_id="existing-client-open",
                symbol="SPY",
                side="buy",
                notional=1000.0,
                qty=2.0,
                order_type="limit",
                time_in_force="day",
                extended_hours=True,
                status="accepted",
                trading_mode="live",
            )
        )
        db_session.commit()

    broker = DummyBroker(mode="live")
    monkeypatch.setattr("services.alpaca_broker.get_broker_from_keychain", lambda mode=None: broker)
    monkeypatch.setattr("services.alpaca_broker._is_extended_hours_now", lambda cfg=None: True)
    monkeypatch.setattr("services.alpaca_broker._check_circuit_breakers", lambda db, cfg: None)

    maybe_execute_alpaca_order(db_session, paper_trade, event, config)

    assert len(broker.orders) == 1
    order = broker.orders[0]
    assert order["side"] == side
    assert order["extended_hours"] is True
    assert order["order_type"] == "limit"
    assert order["time_in_force"] == "day"
    assert order["qty"] == 2.0
    assert order["notional"] is None
    assert order["limit_price"] == pytest.approx(501.0 if event == "open" else 499.0)


def test_regular_hours_respects_configured_order_type(db_session, monkeypatch):
    config = _seed_config(db_session, allow_extended_hours_trading=True, alpaca_order_type="market")
    paper_trade = PaperTrade(
        underlying="QQQ",
        execution_ticker="QQQ",
        signal_type="LONG",
        leverage="1x",
        market_session="open",
        amount=500.0,
        shares=1.5,
        entry_price=333.33,
        entered_at=datetime.utcnow(),
        analysis_request_id="req-2",
    )
    db_session.add(paper_trade)
    db_session.commit()

    broker = DummyBroker(mode="live")
    monkeypatch.setattr("services.alpaca_broker.get_broker_from_keychain", lambda mode=None: broker)
    monkeypatch.setattr("services.alpaca_broker._is_extended_hours_now", lambda cfg=None: False)
    monkeypatch.setattr("services.alpaca_broker._check_circuit_breakers", lambda db, cfg: None)

    maybe_execute_alpaca_order(db_session, paper_trade, "open", config)

    assert len(broker.orders) == 1
    order = broker.orders[0]
    assert order["extended_hours"] is False
    assert order["order_type"] == "market"
    assert order["notional"] == 500.0
    assert order["qty"] is None
    assert order["limit_price"] is None
