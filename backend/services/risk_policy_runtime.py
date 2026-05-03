from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

_INTRADAY_CACHE: Dict[str, Dict[str, Any]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _bucket_for_symbol(symbol: str, price_context: Optional[Dict[str, Any]]) -> str:
    indicators = (price_context or {}).get(f"technical_indicators_{str(symbol).lower()}") or {}
    vol_ratio = float(indicators.get("vol_ratio_20") or 0.0)
    atr_pct = float(indicators.get("atr_14_pct") or 0.0)
    if vol_ratio >= 1.2 and atr_pct <= 2.0:
        return "high_liquidity"
    if vol_ratio >= 0.8 and atr_pct <= 3.5:
        return "mid_liquidity"
    return "low_liquidity"


async def _fetch_intraday(symbol: str, stale_ms: int) -> Dict[str, Any]:
    key = str(symbol).upper().strip()
    cached = _INTRADAY_CACHE.get(key) or {}
    now = _now_ms()
    if cached and (now - int(cached.get("fetched_at_ms", 0) or 0) <= max(5000, stale_ms // 2)):
        return {**cached, "cache_hit": True}

    from services.data_ingestion.yfinance_client import PriceClient
    client = PriceClient()
    started = time.perf_counter()
    df = await asyncio.to_thread(client.get_intraday_data, key, "1m", "1d")
    latency_ms = int((time.perf_counter() - started) * 1000)
    if df is None or df.empty:
        return {
            "symbol": key,
            "ok": False,
            "error": "empty_intraday",
            "fetch_latency_ms": latency_ms,
            "cache_hit": False,
        }

    last_ts = df.index[-1]
    if hasattr(last_ts, "to_pydatetime"):
        last_dt = last_ts.to_pydatetime()
    else:
        last_dt = last_ts
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    stale_age_ms = max(0, int((datetime.now(timezone.utc) - last_dt.astimezone(timezone.utc)).total_seconds() * 1000))

    payload = {
        "symbol": key,
        "ok": True,
        "rows": int(len(df)),
        "fetch_latency_ms": latency_ms,
        "stale_age_ms": stale_age_ms,
        "cache_hit": False,
        "fetched_at_ms": now,
    }
    _INTRADAY_CACHE[key] = payload
    return payload


async def build_crazy_ramp_context(
    *,
    symbols: List[str],
    risk_profile: str,
    risk_policy: Dict[str, Any],
    price_context: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    profile = str(risk_profile or "").lower().strip()
    if profile != "crazy":
        return {"enabled": False, "symbols": {}, "reason": "risk_profile_not_crazy"}

    crazy = dict((risk_policy or {}).get("crazy_ramp") or {})
    threshold_source = str(crazy.get("threshold_source") or "calibrated_bucket")
    bucket_thresholds = dict(crazy.get("bucket_thresholds") or {})
    fallback = dict(crazy.get("fallback") or {})
    fetch_timeout_ms = int(crazy.get("fetch_timeout_ms") or 2500)
    eval_timeout_ms = int(crazy.get("eval_timeout_ms") or 15000)
    stale_ms = int(crazy.get("stale_ms") or 120000)

    async def _eval_symbol(sym: str) -> Tuple[str, Dict[str, Any]]:
        bucket = _bucket_for_symbol(sym, price_context)
        thresholds = bucket_thresholds.get(bucket)
        source = "calibrated_bucket"
        if not isinstance(thresholds, dict):
            thresholds = dict(fallback)
            source = "fallback"
        # go-live guard
        promotion_allowed = source == "calibrated_bucket"
        fetch_timeout_hit = False
        fetch: Dict[str, Any]
        started = time.perf_counter()
        try:
            fetch = await asyncio.wait_for(_fetch_intraday(sym, stale_ms), timeout=max(0.5, fetch_timeout_ms / 1000.0))
        except asyncio.TimeoutError:
            fetch_timeout_hit = True
            fetch = {"symbol": sym, "ok": False, "error": "fetch_timeout", "fetch_latency_ms": fetch_timeout_ms}
        total_eval_ms = int((time.perf_counter() - started) * 1000)
        if total_eval_ms > eval_timeout_ms:
            fetch_timeout_hit = True
            fetch = {"symbol": sym, "ok": False, "error": "eval_timeout", "fetch_latency_ms": total_eval_ms}

        if fetch.get("ok") and int(fetch.get("stale_age_ms", 10**9)) > stale_ms:
            fetch["ok"] = False
            fetch["error"] = "stale_intraday"

        return str(sym).upper().strip(), {
            "ramp_threshold_bucket": bucket,
            "threshold_source": source if threshold_source == "calibrated_bucket" else "fallback",
            "thresholds": thresholds,
            "promotion_allowed": bool(promotion_allowed and fetch.get("ok")),
            "fetch_latency_ms": int(fetch.get("fetch_latency_ms", 0) or 0),
            "fetch_timeout_hit": bool(fetch_timeout_hit),
            "stale_age_ms": int(fetch.get("stale_age_ms", 0) or 0),
            "intraday_ok": bool(fetch.get("ok")),
            "intraday_error": str(fetch.get("error", "") or ""),
            "cache_hit": bool(fetch.get("cache_hit")),
        }

    results = await asyncio.gather(*[_eval_symbol(sym) for sym in symbols])
    return {
        "enabled": True,
        "symbols": {sym: data for sym, data in results},
        "policy": {
            "threshold_source": threshold_source,
            "fetch_timeout_ms": fetch_timeout_ms,
            "eval_timeout_ms": eval_timeout_ms,
            "stale_ms": stale_ms,
        },
    }
