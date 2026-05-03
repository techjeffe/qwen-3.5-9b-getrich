"""
PriceCacheService — singleton cache for realtime market quotes.

Replaces the module-level _price_cache / _price_cache_ts globals from the
former analysis.py router.  Uses monotonic time for TTL resolution so cache
windows survive clock adjustments.

State Management Note:
  - Singleton pattern ensures one cache instance per FastAPI app lifecycle.
  - If horizontal scaling is needed later, swap to Redis with key prefix
    `price:{symbol}` and the same TTL resolution logic.
  - TTL values preserved exactly: 30s (fresh market), 90s (stale market),
    300s (closed market / default).
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional


# ── Singleton ────────────────────────────────────────────────────────────────

_price_cache_service: "PriceCacheService | None" = None


def get_price_cache_service() -> "PriceCacheService":
    """Return the global PriceCacheService singleton (creates if needed)."""
    global _price_cache_service
    if _price_cache_service is None:
        _price_cache_service = PriceCacheService()
    return _price_cache_service


# ── Service ──────────────────────────────────────────────────────────────────

class PriceCacheService:
    """In-memory price quote cache with per-entry TTL resolution."""

    def __init__(
        self,
        default_ttl: int = 300,
        fresh_ttl: int = 30,
        stale_market_ttl: int = 90,
    ) -> None:
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._timestamps: Dict[str, float] = {}
        self._default_ttl = default_ttl
        self._fresh_ttl = fresh_ttl
        self._stale_market_ttl = stale_market_ttl

    # ── Public API ───────────────────────────────────────────────────────

    def get(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Return cached entry if not expired, None otherwise."""
        if symbol not in self._cache:
            return None

        now = time.monotonic()
        cached_ts = self._timestamps.get(symbol, 0.0)
        entry = self._cache[symbol]
        cache_ttl = int(entry.get("cache_ttl_seconds", self._default_ttl))

        if (now - cached_ts) >= cache_ttl:
            # Lazy eviction
            self._cache.pop(symbol, None)
            self._timestamps.pop(symbol, None)
            return None

        return entry

    def set(self, symbol: str, entry: Dict[str, Any]) -> None:
        """Cache an entry with its resolved TTL."""
        self._cache[symbol] = entry
        self._timestamps[symbol] = time.monotonic()

    def clear(self, symbol: Optional[str] = None) -> None:
        """Clear cache entries.  If symbol is None, clear all."""
        if symbol is None:
            self._cache.clear()
            self._timestamps.clear()
        else:
            self._cache.pop(symbol, None)
            self._timestamps.pop(symbol, None)

    # ── TTL Resolution ───────────────────────────────────────────────────

    def resolve_ttl(self, quote: Optional[Dict[str, Any]]) -> int:
        """Port of the original _resolve_price_cache_ttl logic.

        Uses shorter cache windows when the market is active or in
        extended-hours to keep price data fresh.
        """
        if not quote:
            return self._default_ttl

        session = str(quote.get("session") or "closed").lower()
        is_stale = bool(quote.get("is_stale"))

        if session in {"regular", "premarket", "postmarket"} and not is_stale:
            return self._fresh_ttl
        if session in {"regular", "premarket", "postmarket"}:
            return self._stale_market_ttl
        return self._default_ttl