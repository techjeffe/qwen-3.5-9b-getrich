"""
Background ingestion worker for the article producer/consumer pipeline.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests
import trafilatura
from sqlalchemy.orm import Session

from database.engine import SessionLocal
from database.models import ScrapedArticle
from services.app_config import build_enabled_rss_feed_labels, build_enabled_rss_feed_map, get_or_create_app_config
from services.data_ingestion.parser import NewsArticle, RSSFeedParser
from services.sentiment.prompts import expand_proxy_terms_for_matching, normalize_text_for_matching

try:
    from playwright.sync_api import sync_playwright as _sync_playwright
    _playwright_available = True
except Exception:  # pragma: no cover - optional runtime dependency
    _playwright_available = False

logger = logging.getLogger(__name__)


MAJOR_POLICY_SHIFT_TERMS = [
    "federal reserve",
    "fed",
    "rate cut",
    "rate hike",
    "fomc",
    "cpi",
    "inflation",
    "jobs report",
    "payrolls",
    "tariff",
    "trade war",
    "sanctions",
    "opec",
    "production cut",
    "export controls",
    "emergency order",
    "market halt",
    "trading halt",
]

FAST_LANE_TERMS = [
    "cpi",
    "federal reserve",
    "fed rate",
    "rate cut",
    "rate hike",
    "fomc",
    "emergency",
    "halt",
    "market halt",
    "trading halt",
    "opec",
    "sanctions",
    "tariff",
    "surprise decision",
    "intervention",
]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _load_symbol_relevance_terms() -> Dict[str, List[str]]:
    from routers.analysis import SYMBOL_RELEVANCE_TERMS

    return {str(symbol).upper(): list(terms or []) for symbol, terms in SYMBOL_RELEVANCE_TERMS.items()}


def _iter_stage0_terms(symbols: Iterable[str]) -> List[str]:
    relevance_terms = _load_symbol_relevance_terms()
    selected_terms: List[str] = []
    for symbol in symbols:
        selected_terms.extend(relevance_terms.get(str(symbol).upper(), []))
    selected_terms.extend(MAJOR_POLICY_SHIFT_TERMS)
    return expand_proxy_terms_for_matching(selected_terms)


def _matches_stage0_filter(article: NewsArticle, tracked_symbols: Iterable[str]) -> bool:
    text = normalize_text_for_matching(" ".join([article.title or "", article.summary or ""]))
    if not text:
        return False
    return any(term in text for term in _iter_stage0_terms(tracked_symbols))


def check_fast_lane(article_summary: str) -> bool:
    text = normalize_text_for_matching(article_summary or "")
    return any(term in text for term in FAST_LANE_TERMS)


def _resolve_fast_lane_symbols(text: str, tracked_symbols: List[str]) -> List[str]:
    normalized = normalize_text_for_matching(text)
    relevance_terms = _load_symbol_relevance_terms()
    matched: List[str] = []
    for symbol in tracked_symbols:
        terms = expand_proxy_terms_for_matching(relevance_terms.get(symbol.upper(), []))
        if any(term in normalized for term in terms):
            matched.append(symbol.upper())
    return matched or [str(symbol).upper() for symbol in tracked_symbols]


def _clean_extracted_text(text: str, fallback: str) -> str:
    cleaned = " ".join(str(text or "").split()).strip()
    if cleaned:
        return cleaned[:20000]
    return " ".join(str(fallback or "").split()).strip()[:20000]


def _fetch_with_requests(url: str, timeout: int = 15) -> str:
    response = requests.get(
        url,
        timeout=timeout,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
    )
    response.raise_for_status()
    return response.text


async def _fetch_with_playwright(url: str, timeout_ms: int = 30000) -> str:
    """Fetch rendered HTML from a URL using Playwright headless Chromium.

    Improvements over the original:
    - Uses networkidle wait instead of a fixed timeout for dynamic content
    - Scrolls the page to trigger lazy-loaded content
    - Attempts to dismiss cookie consent modals
    - Rotates User-Agent strings for basic anti-detection
    - Uses stealth-like settings to reduce bot detection
    """
    if not _playwright_available:
        return ""

    # Rotate User-Agent strings for basic anti-detection
    _user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ]

    def _run_sync() -> str:
        try:
            with _sync_playwright() as pw:
                browser = pw.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--disable-extensions",
                        "--disable-background-networking",
                        "--disable-default-apps",
                        "--disable-sync",
                        "--disable-translate",
                        "--no-first-run",
                        "--deterministic-mode",
                        "--font-render-hinting=none",
                    ],
                )
                try:
                    import random
                    ua = random.choice(_user_agents)
                    # Set random viewport jitter to reduce fingerprinting.
                    view_w = random.randint(1280, 1920)
                    view_h = random.randint(720, 1080)
                    context = browser.new_context(
                        user_agent=ua,
                        viewport={"width": view_w, "height": view_h},
                        locale="en-US",
                        timezone_id="America/New_York",
                        screen={"width": 1920, "height": 1080},
                        has_touch=False,
                    )
                    try:
                        page = context.new_page()
                        try:
                            # Navigate and wait for network to settle (dynamic content)
                            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)

                            # Wait for network idle to let async content load
                            try:
                                page.wait_for_load_state("networkidle", timeout=5000)
                            except Exception:
                                # Some sites never fully go idle; continue anyway
                                pass

                            # Scroll down to trigger lazy-loaded content
                            _scroll_page(page)

                            # Attempt to dismiss cookie consent modals
                            _dismiss_cookie_consent(page)

                            # Additional wait after scroll for lazy content
                            page.wait_for_timeout(800)

                            # Final scroll to bottom
                            _scroll_page(page)
                            page.wait_for_timeout(400)

                            return page.content()
                        finally:
                            page.close()
                    finally:
                        context.close()
                finally:
                    browser.close()
        except Exception as exc:
            logger.warning("Playwright fetch failed for %s: %s", url, exc)
            return ""

    return await asyncio.to_thread(_run_sync)


def _scroll_page(page, steps: int = 5, delay_ms: int = 200) -> None:
    """Scroll the page progressively to trigger lazy-loaded content."""
    try:
        page.evaluate(f"""() => {{
            const totalHeight = 0;
            const distances = [];
            for (let i = 0; i < {steps}; ++i) {{
                const newScrollHeight = document.body.scrollHeight * (i + 1) / {steps};
                distances.push(newScrollHeight - totalHeight);
                window.scrollBy(0, distances[i]);
            }}
        }}""")
    except Exception:
        # Fallback: scroll to bottom in one go
        try:
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        except Exception:
            pass


def _dismiss_cookie_consent(page) -> None:
    """Attempt to dismiss common cookie consent banners and popups."""
    selectors = [
        # Common cookie consent selectors
        'button[aria-label*="accept"]',
        'button[aria-label*="Accept"]',
        'button[class*="accept-cookie"]',
        'button[class*="consent-accept"]',
        'button[id*="accept-cookie"]',
        'button[id*="consent-accept"]',
        '.cookie-banner button',
        '.cookie-consent button',
        '[class*="cookie-accept"]',
        '[id*="cookie-accept"]',
        '.onetrust-accept-all-btn',
        '#onetrust-accept-btn',
        'button[data-testid="cookie-accept"]',
        'button[class*="accept-all"]',
        'button[title*="Accept"], button[title*="accept"]',
        'button:has-text("Accept"), button:has-text("Accept All")',
        'a:has-text("Accept"), a:has-text("Accept All")',
        # Common close/dismiss selectors for popups
        'button[aria-label*="close"]',
        'button[class*="popup-close"]',
        '.modal .close',
        '[class*="dialog-close"]',
        'button:has-text("Close"), button:has-text("✕"), button:has-text("×")',
    ]
    for selector in selectors:
        try:
            button = page.query_selector(selector)
            if button and button.is_visible():
                button.click()
                page.wait_for_timeout(200)
                break
        except Exception:
            continue
    # Fallback: try common dismiss patterns
    try:
        # Try using JavaScript to dismiss known banners
        page.evaluate("""() => {
            // Remove common cookie banners
            const banners = document.querySelectorAll('.cookie-banner, .cookie-consent, .gdpr-banner, .consent-banner');
            banners.forEach(b => { b.style.display = 'none'; b.remove(); });
            // Remove all popups modals
            const modals = document.querySelectorAll('.modal, .overlay, .popup, [class*="modal-backdrop"]');
            modals.forEach(m => { m.style.display = 'none'; m.remove(); });
        }""")
    except Exception:
        pass


async def fetch_article_text(url: str, fallback_text: str = "") -> str:
    html = ""
    try:
        html = await asyncio.to_thread(_fetch_with_requests, url)
    except Exception:
        html = ""

    extracted = ""
    if html:
        extracted = trafilatura.extract(
            html,
            favor_recall=True,
            include_comments=False,
            include_tables=False,
            url=url,
        ) or ""

    if len(extracted.strip()) >= 400:
        return _clean_extracted_text(extracted, fallback_text)

    try:
        rendered_html = await _fetch_with_playwright(url)
    except Exception:
        rendered_html = ""

    if rendered_html:
        rendered_extracted = trafilatura.extract(
            rendered_html,
            favor_recall=True,
            include_comments=False,
            include_tables=False,
            url=url,
        ) or ""
        if rendered_extracted.strip():
            return _clean_extracted_text(rendered_extracted, fallback_text)

    return _clean_extracted_text(extracted, fallback_text)


def _upsert_scraped_article(
    db: Session,
    article: NewsArticle,
    full_content: str,
    fast_lane_triggered: bool,
) -> Tuple[ScrapedArticle, bool]:
    existing = db.query(ScrapedArticle).filter(ScrapedArticle.url == article.link).first()
    if existing:
        if full_content and (not existing.full_content or len(full_content) > len(existing.full_content)):
            existing.full_content = full_content
        if article.summary and not existing.summary:
            existing.summary = article.summary
        if article.title and not existing.title:
            existing.title = article.title
        if article.source and not existing.source:
            existing.source = article.source
        if article.published_date and existing.published_at is None:
            existing.published_at = _coerce_utc(article.published_date)
        existing.fast_lane_triggered = bool(existing.fast_lane_triggered or fast_lane_triggered)
        db.add(existing)
        db.flush()
        return existing, False

    row = ScrapedArticle(
        source=str(article.source or "unknown"),
        url=str(article.link or "").strip(),
        title=str(article.title or "").strip(),
        summary=str(article.summary or "").strip(),
        full_content=_clean_extracted_text(full_content, article.summary or article.content or article.title or ""),
        published_at=_coerce_utc(article.published_date),
        discovered_at=_utc_now(),
        processed=False,
        fast_lane_triggered=bool(fast_lane_triggered),
    )
    db.add(row)
    db.flush()
    return row, True


async def trigger_fast_lane(article_ids: List[int], symbols: List[str]) -> None:
    if not article_ids:
        return

    from routers.analysis import run_analysis_for_pending_articles

    db = SessionLocal()
    try:
        try:
            await run_analysis_for_pending_articles(
                db=db,
                symbols=symbols,
                article_ids=article_ids,
                trigger_source="fast_lane",
            )
        except Exception:
            logger.exception(
                "Fast-lane analysis failed for article_ids=%s symbols=%s",
                article_ids,
                symbols,
            )
    finally:
        db.close()


async def run_ingestion_cycle(db: Optional[Session] = None) -> Dict[str, Any]:
    owns_db = db is None
    session = db or SessionLocal()
    try:
        config = get_or_create_app_config(session)
        tracked_symbols = [str(symbol).upper().strip() for symbol in (config.tracked_symbols or []) if str(symbol).strip()]
        parser = RSSFeedParser(
            feeds=build_enabled_rss_feed_map(config),
            feed_labels=build_enabled_rss_feed_labels(config),
        )
        articles = await asyncio.to_thread(parser.parse_feeds)

        kept_articles = [article for article in articles if article.link and _matches_stage0_filter(article, tracked_symbols)]
        kept_articles.sort(
            key=lambda item: _coerce_utc(getattr(item, "published_date", None)) or _utc_now(),
            reverse=True,
        )

        stored_count = 0
        duplicate_count = 0
        fast_lane_article_ids: List[int] = []
        fast_lane_symbols: List[str] = []

        for article in kept_articles:
            fallback_text = " ".join(
                part for part in [article.summary or "", article.content or "", article.title or ""] if part
            )
            try:
                full_content = await fetch_article_text(article.link, fallback_text=fallback_text)
            except Exception as exc:
                full_content = _clean_extracted_text(f"{fallback_text} Extraction error: {exc}", fallback_text)

            summary_blob = " ".join([article.title or "", article.summary or "", full_content or ""])
            fast_lane_hit = check_fast_lane(summary_blob)
            row, is_new = _upsert_scraped_article(session, article, full_content, fast_lane_hit)
            session.commit()
            if is_new:
                stored_count += 1
            else:
                duplicate_count += 1

            if fast_lane_hit:
                fast_lane_article_ids.append(int(row.id))
                fast_lane_symbols.extend(_resolve_fast_lane_symbols(summary_blob, tracked_symbols))

        if fast_lane_article_ids:
            deduped_symbols = sorted({symbol.upper() for symbol in fast_lane_symbols if symbol})
            asyncio.create_task(trigger_fast_lane(sorted(set(fast_lane_article_ids)), deduped_symbols))

        return {
            "total_feed_articles": len(articles),
            "stage0_matches": len(kept_articles),
            "stored_count": stored_count,
            "duplicate_count": duplicate_count,
            "fast_lane_article_ids": sorted(set(fast_lane_article_ids)),
            "fast_lane_symbol_count": len(sorted({symbol.upper() for symbol in fast_lane_symbols if symbol})),
        }
    except Exception:
        session.rollback()
        raise
    finally:
        if owns_db:
            session.close()


def build_analysis_posts(rows: List[ScrapedArticle]) -> List[Any]:
    parser_keywords = RSSFeedParser.KEYWORDS
    posts: List[Any] = []
    for row in rows:
        blob = normalize_text_for_matching(" ".join([row.title or "", row.summary or "", row.full_content or ""]))
        keywords = [keyword for keyword in parser_keywords if keyword in blob][:8]
        posts.append(
            SimpleNamespace(
                id=row.id,
                source=row.source,
                feed_name=row.source,
                author=None,
                title=row.title or "",
                summary=row.summary or "",
                content=row.full_content or row.summary or row.title or "",
                keywords=keywords,
                published_date=_coerce_utc(row.published_at),
                discovered_at=_coerce_utc(row.discovered_at),
                url=row.url,
                fast_lane_triggered=bool(row.fast_lane_triggered),
            )
        )
    return posts
