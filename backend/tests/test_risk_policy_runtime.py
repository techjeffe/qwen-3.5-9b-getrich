from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from services.risk_policy_runtime import build_crazy_ramp_context
from services.app_config import DEFAULT_RISK_POLICY


def test_crazy_ramp_uses_bucket_thresholds_and_emits_metadata(monkeypatch):
    import services.risk_policy_runtime as runtime

    async def _ok_fetch(symbol: str, stale_ms: int):
        return {"symbol": symbol, "ok": True, "fetch_latency_ms": 5, "stale_age_ms": 0, "cache_hit": True}

    monkeypatch.setattr(runtime, "_fetch_intraday", _ok_fetch)

    async def _run():
        price_context = {
            "technical_indicators_qqq": {"vol_ratio_20": 1.5, "atr_14_pct": 1.2},
        }
        ctx = await build_crazy_ramp_context(
            symbols=["QQQ"],
            risk_profile="crazy",
            risk_policy=DEFAULT_RISK_POLICY,
            price_context=price_context,
        )
        assert ctx["enabled"] is True
        sym = ctx["symbols"]["QQQ"]
        assert sym["ramp_threshold_bucket"] in {"high_liquidity", "mid_liquidity", "low_liquidity"}
        assert "threshold_source" in sym
        assert "fetch_timeout_hit" in sym

    asyncio.run(_run())


def test_crazy_ramp_timeout_path_disables_promotion(monkeypatch):
    import services.risk_policy_runtime as runtime

    async def _slow_fetch(symbol: str, stale_ms: int):
        await asyncio.sleep(0.05)
        return {"symbol": symbol, "ok": True, "fetch_latency_ms": 50, "stale_age_ms": 0}

    monkeypatch.setattr(runtime, "_fetch_intraday", _slow_fetch)

    async def _run():
        policy = {
            "crazy_ramp": {
                **DEFAULT_RISK_POLICY["crazy_ramp"],
                "fetch_timeout_ms": 1,
                "eval_timeout_ms": 2,
                "stale_ms": 120000,
            }
        }
        ctx = await build_crazy_ramp_context(
            symbols=["SPY"],
            risk_profile="crazy",
            risk_policy=policy,
            price_context={},
        )
        sym = ctx["symbols"]["SPY"]
        assert sym["fetch_timeout_hit"] is True
        assert sym["promotion_allowed"] is False

    asyncio.run(_run())
