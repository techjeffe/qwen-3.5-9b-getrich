from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace


sys.path.append(str(Path(__file__).resolve().parents[1]))

from routers.analysis import (
    _build_symbol_specific_news_context,
    _generate_trading_signal,
    _material_change_gate,
)
from schemas.analysis import TradingSignal
from services.trading_instruments import build_execution_recommendation


def test_crazy_profile_applies_atr_caps_per_symbol_not_per_basket():
    sentiment_results = {
        "QQQ": {
            "directional_score": 0.9,
            "confidence": 0.86,
            "signal_type": "LONG",
            "urgency": "HIGH",
        },
        "BITO": {
            "directional_score": 0.8,
            "confidence": 0.83,
            "signal_type": "LONG",
            "urgency": "HIGH",
        },
    }
    price_context = {
        "technical_indicators_qqq": {"atr_14_pct": 1.2},
        "technical_indicators_bito": {"atr_14_pct": 3.6},
    }

    signal = _generate_trading_signal(
        sentiment_results=sentiment_results,
        risk_profile="crazy",
        price_context=price_context,
    )

    recs = {rec["underlying_symbol"]: rec for rec in signal.recommendations}

    assert recs["QQQ"]["symbol"] == "TQQQ"
    assert recs["QQQ"]["leverage"] == "3x"
    assert recs["BITO"]["symbol"] == "BITO"
    assert recs["BITO"]["leverage"] == "1x"


def test_materiality_gate_allows_leverage_tier_change_without_thesis_flip():
    previous_signal = TradingSignal(
        signal_type="SHORT",
        confidence_score=0.6,
        entry_symbol="QQQ",
        recommendations=[
            {"action": "SELL", "symbol": "QQQ", "leverage": "1x", "underlying_symbol": "QQQ", "thesis": "SHORT"},
            {"action": "SELL", "symbol": "SPY", "leverage": "1x", "underlying_symbol": "SPY", "thesis": "SHORT"},
        ],
    )
    candidate_signal = TradingSignal(
        signal_type="SHORT",
        confidence_score=0.6,
        entry_symbol="SPXS",
        recommendations=[
            {"action": "BUY", "symbol": "QQQ", "leverage": "2x", "underlying_symbol": "QQQ", "thesis": "SHORT"},
            {"action": "BUY", "symbol": "SPXS", "leverage": "3x", "underlying_symbol": "SPY", "thesis": "SHORT"},
        ],
    )
    previous_state = {
        "response": SimpleNamespace(
            posts_scraped=98,
            blue_team_signal=previous_signal,
            trading_signal=previous_signal,
            sentiment_scores={
                "QQQ": SimpleNamespace(policy_change=0.0, market_bluster=0.0, confidence=0.51),
                "SPY": SimpleNamespace(policy_change=0.0, market_bluster=0.0, confidence=0.51),
            },
        ),
        "quotes_by_symbol": {
            "QQQ": {"current_price": 100.0},
            "SPY": {"current_price": 100.0},
        },
    }

    allowed = _material_change_gate(
        symbols=["QQQ", "SPY"],
        posts_count=98,
        sentiment_results={
            "QQQ": {"directional_score": -0.74, "confidence": 0.51},
            "SPY": {"directional_score": -0.58, "confidence": 0.51},
        },
        price_context={
            "technical_indicators_qqq": {"atr_14_pct": 1.58},
            "technical_indicators_spy": {"atr_14_pct": 1.14},
        },
        quotes_by_symbol={
            "QQQ": {"current_price": 100.2},
            "SPY": {"current_price": 100.1},
        },
        previous_state=previous_state,
        candidate_signal=candidate_signal,
        per_symbol_counts={"QQQ": 10, "SPY": 8},
        db=None,
    )

    assert allowed is True


def test_two_x_short_uses_real_inverse_etfs_for_qqq_and_spy():
    qqq = build_execution_recommendation("QQQ", "SELL", "2x")
    spy = build_execution_recommendation("SPY", "SELL", "2x")

    assert qqq["action"] == "BUY"
    assert qqq["symbol"] == "QID"
    assert qqq["leverage"] == "2x"

    assert spy["action"] == "BUY"
    assert spy["symbol"] == "SDS"
    assert spy["leverage"] == "2x"


def test_spy_leverage_progression_stays_on_same_underlying_thesis():
    short_1x = build_execution_recommendation("SPY", "SELL", "1x")
    short_2x = build_execution_recommendation("SPY", "SELL", "2x")
    short_3x = build_execution_recommendation("SPY", "SELL", "3x")
    long_3x = build_execution_recommendation("SPY", "BUY", "3x")

    assert short_1x["underlying_symbol"] == "SPY"
    assert short_1x["thesis"] == "SHORT"
    assert short_1x["symbol"] == "SPY"

    assert short_2x["underlying_symbol"] == "SPY"
    assert short_2x["thesis"] == "SHORT"
    assert short_2x["symbol"] == "SDS"

    assert short_3x["underlying_symbol"] == "SPY"
    assert short_3x["thesis"] == "SHORT"
    assert short_3x["symbol"] == "SPXS"

    assert long_3x["underlying_symbol"] == "SPY"
    assert long_3x["thesis"] == "LONG"
    assert long_3x["symbol"] == "SPXL"


def test_symbol_specific_news_context_warns_when_no_proxy_terms_match():
    posts = [
        SimpleNamespace(
            title="US sanctions on Iranian oil exports tighten supply",
            summary="",
            content="Oil traders expect tighter crude supply after sanctions.",
            keywords=[],
        )
    ]

    context = _build_symbol_specific_news_context(
        posts=posts,
        symbol="UNH",
        fallback="fallback",
        proxy_terms=["health insurance", "medicare advantage", "medical loss ratio"],
    )

    assert "No article in this batch matched UNH proxy terms" in context
    assert "Do NOT assume DIRECT exposure for UNH" in context
