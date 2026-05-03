from __future__ import annotations

from typing import Any, Dict, List

from services.sentiment.engine import SentimentEngine, _keyword_trace_cache
from services.sentiment.prompts import TICKER_PROXY_MAP


def _normalize_terms(terms: List[str]) -> List[str]:
    normalized: List[str] = []
    for term in terms:
        value = str(term or "").strip().lower()
        if value and value not in normalized:
            normalized.append(value)
        if len(normalized) >= 50:
            break
    return normalized


async def generate_proxy_terms_for_symbol(
    *,
    symbol: str,
    model_name: str,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """
    Generate proxy terms for one symbol using existing Stage 1 logic.
    Returns normalized terms and trace metadata for UI notices/debug.
    """
    sym = str(symbol or "").upper().strip()
    if not sym:
        return {"symbol": "", "terms": [], "trace": {"mode": "invalid", "error": "empty symbol"}}

    engine = SentimentEngine(model_name=model_name)

    if force_refresh:
        # Bypass in-memory cache to force a fresh LLM generation/fallback pass.
        try:
            from services.sentiment import engine as engine_module
            engine_module._keyword_cache.pop(sym, None)
            engine_module._keyword_trace_cache.pop(sym, None)
        except Exception:
            pass

    terms = await engine._generate_symbol_keywords(sym, model_name)
    normalized_terms = _normalize_terms(list(terms or []))
    trace = dict(_keyword_trace_cache.get(sym) or {})

    # Built-ins are static and should not be persisted in config.
    if sym in TICKER_PROXY_MAP:
        return {"symbol": sym, "terms": [], "trace": trace}

    return {"symbol": sym, "terms": normalized_terms, "trace": trace}
