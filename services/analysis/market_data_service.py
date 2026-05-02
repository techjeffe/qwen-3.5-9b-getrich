"""
MarketDataService — market snapshot and data ingestion.

Encapsulates _get_market_snapshot, _inject_technical_context, and
_ingest_data from the original router.  Handles price expansion for
execution variants (SBIT, SQQQ, SPXS, SCO, etc.).
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from config.logic_loader import LOGIC
from schemas.analysis import IngestionTraceDebug
from services.data_ingestion.market_validation import MarketValidationClient
from services.data_ingestion.parser import RSSFeedParser
from services.data_ingestion.yfinance_client import PriceClient
from services.runtime_health import record_data_pull


class MarketDataService:
    """Encapsulates market data fetching and data ingestion logic."""

    def __init__(
        self,
        price_cache: Any,
        logic_config: dict[str, Any],
    ) -> None:
        self._price_cache = price_cache
        self._L = logic_config

    # ── Public API ───────────────────────────────────────────────────

    async def get_market_snapshot(
        self,
        symbols: List[str],
    ) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        """
        Fetch market snapshot for base symbols AND ALL their execution variants.
        Ensures we have prices for SBIT, SQQQ, SPXS, SCO, etc.
        """
        from services.trading_instruments import INSTRUMENT_SPECS

        client = PriceClient()
        validation_client = MarketValidationClient()
        context = {}
        quotes_by_symbol: Dict[str, Dict[str, Any]] = {}

        # Expand symbols to include all execution variants
        symbols_to_fetch = set(symbols)
        for symbol in symbols:
            spec = INSTRUMENT_SPECS.get(symbol)
            if spec:
                symbols_to_fetch.update(spec.get("bull", {}).values())
                symbols_to_fetch.update(spec.get("bear", {}).values())

        # Fetch quotes for all symbols
        for symbol in symbols_to_fetch:
            quote = client.get_realtime_quote(symbol)
            if quote and quote.get('current_price'):
                context[f"{symbol.lower()}_price"] = quote['current_price']
                quotes_by_symbol[symbol] = quote

        # Ensure SPY and QQQ context for analysis
        for extra in ["SPY", "QQQ"]:
            key = f"{extra.lower()}_price"
            if key not in context:
                q = client.get_realtime_quote(extra)
                if q and q.get('current_price'):
                    context[key] = q['current_price']

        market_validation = await asyncio.to_thread(validation_client.get_validation_bundle, symbols)
        validation_context = validation_client.build_prompt_context(market_validation)
        if validation_context:
            context["validation_context"] = validation_context
            context["market_validation"] = market_validation

        missing_quotes = [symbol for symbol in symbols if symbol not in quotes_by_symbol]
        validation_unavailable = [
            symbol for symbol, payload in market_validation.items() if payload.get("status") == "unavailable"
        ]
        validation_partial = [
            symbol for symbol, payload in market_validation.items() if payload.get("status") == "partial"
        ]
        snapshot_status = "ok"
        if missing_quotes or validation_unavailable:
            snapshot_status = "partial"
        if len(missing_quotes) == len(symbols) and len(validation_unavailable) == len(symbols):
            snapshot_status = "error"

        record_data_pull(
            status=snapshot_status,
            source="market_snapshot",
            summary=f"Fetched {len(quotes_by_symbol)} live quotes (including execution symbols) for {len(symbols)} base symbols",
            details={
                "quotes_ok": sorted(quotes_by_symbol.keys()),
                "quotes_missing": missing_quotes,
                "base_symbols": symbols,
                "execution_symbols": sorted(symbols_to_fetch - set(symbols)),
                "validation_partial": validation_partial,
                "validation_unavailable": validation_unavailable,
            },
            error=None if snapshot_status == "ok" else "Some price or validation feeds were unavailable",
        )

        return context, quotes_by_symbol, market_validation

    def inject_technical_context(
        self,
        price_context: Dict[str, Any],
        symbols: List[str],
        db: Session,
    ) -> Dict[str, Any]:
        """Compute technical indicators from price_history DB and add to price_context."""
        client = PriceClient()
        updated = dict(price_context)
        for symbol in symbols:
            try:
                indicators = client.compute_technical_indicators(symbol, db)
                if indicators:
                    tech_str = PriceClient.format_technical_context(symbol, indicators)
                    updated[f"technical_context_{symbol.lower()}"] = tech_str
                    updated[f"technical_indicators_{symbol.lower()}"] = indicators
            except Exception:
                pass
        return updated

    async def ingest_data(
        self,
        db: Session,
        request: Any,
        config: Any,
        article_ids: Optional[List[int]] = None,
        trigger_source: str = "api",
    ) -> Tuple[List[Any], Dict[str, Any]]:
        """Load pending scraped articles from the DB-backed ingestion queue."""
        from database.models import ScrapedArticle

        query = db.query(ScrapedArticle).filter(ScrapedArticle.processed.is_(False))
        if article_ids:
            normalized_ids = sorted({int(article_id) for article_id in article_ids})
            query = query.filter(ScrapedArticle.id.in_(normalized_ids))

        rows = (
            query.order_by(
                ScrapedArticle.discovered_at.asc(),
                ScrapedArticle.id.asc(),
            )
            .limit(int(request.max_posts or getattr(config, "max_posts", 50) or 50))
            .all()
        )

        posts = self._build_analysis_posts(rows)
        usable_posts = [post for post in posts if self._post_has_analysis_text(post)]
        skipped_empty_ids = [
            int(getattr(post, "id", 0) or 0)
            for post in posts
            if not self._post_has_analysis_text(post) and getattr(post, "id", None) is not None
        ]
        selected_ids = [int(row.id) for row in rows]
        fast_lane_ids = [int(row.id) for row in rows if bool(row.fast_lane_triggered)]
        trace: Dict[str, Any] = {
            "source": "db_queue",
            "trigger_source": trigger_source,
            "request_max_posts": request.max_posts,
            "selected_article_ids": selected_ids,
            "usable_article_ids": [int(getattr(post, "id", 0) or 0) for post in usable_posts if getattr(post, "id", None) is not None],
            "skipped_empty_article_ids": skipped_empty_ids,
            "selected_fast_lane_article_ids": fast_lane_ids,
            "total_items": len(usable_posts),
            "queue": {
                "status": "ok",
                "pending_count": int(
                    db.query(ScrapedArticle).filter(ScrapedArticle.processed.is_(False)).count()
                ),
                "selected_count": len(rows),
                "usable_count": len(usable_posts),
                "skipped_empty_count": len(skipped_empty_ids),
                "selected_articles": [self._post_trace_summary(post) for post in usable_posts],
                "skipped_empty_articles": [
                    self._post_trace_summary(post)
                    for post in posts
                    if int(getattr(post, "id", 0) or 0) in skipped_empty_ids
                ],
                "skipped_empty_article_ids": skipped_empty_ids,
                "selected_urls": [str(row.url or "") for row in rows],
                "fast_lane_count": len(fast_lane_ids),
            },
            "truth_social": {"status": "skipped", "count": 0, "items": [], "error": None},
            "rss": {"status": "replaced_by_db_queue", "feeds": [], "total_count": len(usable_posts), "error": None},
        }

        record_data_pull(
            status="ok",
            source="analysis_ingestion_queue",
            summary=(
                f"Loaded {len(usable_posts)} usable pending articles from the DB queue"
                + (f"; skipped {len(skipped_empty_ids)} empty items" if skipped_empty_ids else "")
            ),
            details={
                "trigger_source": trigger_source,
                "selected_article_ids": selected_ids,
                "usable_article_ids": trace["usable_article_ids"],
                "skipped_empty_article_ids": skipped_empty_ids,
                "fast_lane_article_ids": fast_lane_ids,
                "pending_count": trace["queue"]["pending_count"],
            },
            error=None,
        )

        return usable_posts, trace

    # ── Helpers (private) ───────────────────────────────────────────────

    def _post_has_analysis_text(self, post: Any) -> bool:
        return any(
            str(value or "").strip()
            for value in [
                getattr(post, "title", ""),
                getattr(post, "summary", ""),
                getattr(post, "content", ""),
                " ".join(getattr(post, "keywords", None) or []),
            ]
        )

    def _post_trace_summary(self, post: Any) -> Dict[str, Any]:
        return {
            "source": getattr(post, "source", None) or getattr(post, "feed_name", None) or getattr(post, "author", None) or "Unknown",
            "title": getattr(post, "title", "") or "",
            "summary": getattr(post, "summary", "") or "",
            "content": getattr(post, "content", "") or "",
            "keywords": list(getattr(post, "keywords", None) or []),
        }

    def _build_analysis_posts(self, rows: List[Any]) -> List[Any]:
        """Build analysis posts from scraped article rows. Delegates to the existing worker."""
        from services.data_ingestion.worker import build_analysis_posts
        return build_analysis_posts(rows)