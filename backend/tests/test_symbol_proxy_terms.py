from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.append(str(Path(__file__).resolve().parents[1]))

from services.app_config import _normalize_symbol_proxy_terms
from services.sentiment.engine import SentimentEngine


def test_normalize_symbol_proxy_terms_keeps_allowed_symbols_and_normalizes_terms():
    normalized = _normalize_symbol_proxy_terms(
        {
            "nvda": [" Nvidia ", "AI", "ai", "", None],
            "SPY": ["index", "Index"],
            "BAD!": ["ignore-me"],
        },
        ["NVDA", "SPY"],
    )
    assert normalized["NVDA"] == ["nvidia", "ai"]
    assert normalized["SPY"] == ["index"]
    assert "BAD!" not in normalized


def test_extract_relevant_articles_uses_persisted_terms_without_llm_call():
    engine = SentimentEngine(model_name="dummy")

    async def _run():
        posts = [
            SimpleNamespace(title="Nvidia expands AI datacenter footprint", summary="", content="", keywords=[]),
            SimpleNamespace(title="Unrelated headline", summary="", content="", keywords=[]),
        ]

        async def should_not_call(*args, **kwargs):
            raise AssertionError("LLM should not be called when persisted terms are provided")

        engine._call_ollama = should_not_call  # type: ignore[assignment]
        result = await engine.extract_relevant_articles(
            posts=posts,
            symbols=["NVDA"],
            extraction_model="dummy",
            persisted_proxy_terms_by_symbol={"NVDA": ["nvidia", "datacenter"]},
        )
        assert result["proxy_terms_by_symbol"]["NVDA"] == ["nvidia", "datacenter"]
        assert len(result["filtered_posts"]) == 1
        assert "Nvidia expands AI datacenter footprint" in result["filtered_posts"][0].title

    asyncio.run(_run())


def test_builtin_symbol_still_uses_static_map_even_if_persisted_terms_passed():
    engine = SentimentEngine(model_name="dummy")

    async def _run():
        result = await engine.extract_relevant_articles(
            posts=[SimpleNamespace(title="Oil prices rise on OPEC move", summary="", content="", keywords=[])],
            symbols=["USO"],
            extraction_model="dummy",
            persisted_proxy_terms_by_symbol={"USO": ["should-not-win"]},
        )
        assert "should-not-win" not in result["proxy_terms_by_symbol"]["USO"]

    asyncio.run(_run())
