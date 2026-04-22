# Changelog

## 2026-04-21 — Feed distribution fix, full title in sentiment, article display

### `backend/routers/analysis.py`
- **Fixed per-feed starvation bug**: Trump Truth returns 100 articles; with the old `remaining` counter it consumed all 50 slots and other feeds never ran. Now each feed gets a fair cap (`max_posts // num_feeds`, minimum 5) and all 7 feeds always execute. Total is trimmed to `max_posts` after all feeds complete.
- **Fixed missing headlines in sentiment**: `_analyze_sentiment` only aggregated `post.content` (body text); `post.title` (the headline, and for Trump Truth the entire post) was never sent to the LLM. Now both title and content are included; content is skipped when it duplicates the title.

### `backend/services/data_ingestion/parser.py`
- **Raised per-article content cap** from 2000 → 5000 chars. The 12 000-char aggregation ceiling in the router is the real limit; the old 2000-char cap was prematurely truncating article bodies before aggregation.

### `frontend/src/app/page.tsx`
- **Full Trump Truth post text displayed**: backend no longer truncates titles to 120 chars before the SSE event. Compact card shows 2 lines (CSS `line-clamp-2`); expanded card shows the complete post with `whitespace-pre-wrap`.

---

## 2026-04-21 — Session 2: Full UI rebuild, JSON fix, price data, auto-run, expandable articles

### `backend/services/sentiment/engine.py`
- **Fixed Qwen3 `<think>` block stripping**: Ollama routes all Qwen3 thinking output to a separate `thinking` field and leaves `response` empty. Previous approach (`/no_think` prefix + regex strip) did nothing. Fixed by adding `"think": false` to the Ollama payload — thinking is suppressed at the API level so `response` contains clean JSON.
- **Raised `MAX_TOKENS`** from 512 → 2048 so the full JSON response is never truncated.
- **`_strip_thinking()`** now called in `_parse_response` as a secondary safeguard.

### `backend/services/sentiment/prompts.py`
- **Fixed `format_context_aware_prompt` crash**: used `.format()` which raised `KeyError` when article text contained `{` or `}`. Replaced with a `.replace()` chain; `{{...}}` double-brace escapes then collapsed at the end.

### `backend/services/data_ingestion/parser.py`
- **Added `trump_truth`** RSS feed (`https://trumpstruth.org/feed`) as the first source — aggregates Trump's Truth Social posts without requiring Playwright or authentication.
- Total feeds: 7 (Trump Truth, BBC World, Al Jazeera, NYT World, MarketWatch, NPR, Guardian).

### `backend/services/data_ingestion/yfinance_client.py`
- **Fixed `get_realtime_quote`**: replaced `ticker.info` (slow, unreliable, broken `dayLow`/`dayHigh` dict access) with `ticker.fast_info` which returns live price data in milliseconds.
- **Added QQQ** to `SUPPORTED_SYMBOLS`.

### `backend/routers/analysis.py`
- **New `GET /api/v1/prices` endpoint**: returns live quotes (price, change, change_pct, day_low, day_high) for USO, BITO, QQQ, SPY.
- **New `_sse_article` SSE event type**: streams structured `{type:"article", source, title, description, keywords}` per article instead of plain log text — enables article cards in the frontend.
- **Optimized `_analyze_sentiment` to one LLM call**: previously called Ollama once per symbol (N×LLM). All symbols share the same geopolitical news, so the engine is called once and the result is applied to every symbol.
- **Added QQQ and SPY** to the default analysis symbols.
- **`_generate_trading_signal` now produces specific recommendations**: `[{action:"BUY"|"SELL", symbol:"QQQ"|"USO"|…, leverage:"3x"|"1x"}]` — leverage is `3x` when confidence > 75%, otherwise `1x`.
- **Article text limit raised** from 3500 → 12000 chars (Qwen 3.5 9b has 20k context).
- **Truth Social section removed** from the streaming log (returns 0 posts; now handled via RSS).
- **Price context** extended to include `qqq_price` alongside `uso_price`, `bito_price`, `spy_price`.

### `backend/schemas/analysis.py`
- **`TradingSignal.recommendations`** field added: `List[Dict[str, str]]` with `action`, `symbol`, `leverage` per recommendation.
- **`validate_symbols`** updated to allow `QQQ`.

### `frontend/postcss.config.js` *(new file)*
- PostCSS config was missing — without it Next.js never ran Tailwind through PostCSS so all utility classes were unstyled. Added `tailwindcss` + `autoprefixer` plugins. **Requires dev server restart to take effect.**

### `frontend/src/app/api/prices/route.ts` *(new file)*
- Next.js API proxy for `GET /api/v1/prices`.

### `frontend/src/app/page.tsx` *(full rewrite)*
- **3-column layout**: left sidebar always visible (Engine Config, Market Prices, Signal Logic, Run Stats) + 2/3-width main area.
- **Specific BUY/SELL recommendations** displayed as badge pills at the top of the signal card, e.g. `BUY QQQ 3x`.
- **Expandable article cards**: each article in the live feed is clickable — collapsed shows truncated title, expanded shows full title, description, keywords, and the model's signal/reasoning after analysis completes.
- **Market Prices panel**: live USO, BITO, QQQ, SPY prices with color-coded % change. Polls `/api/prices` every 60 seconds.
- **Auto-run every 30 minutes**: countdown timer shown in sidebar. Automatically triggers analysis when it reaches zero; resets after each run (manual or auto).
- **4-symbol analysis**: request body updated to `["USO", "BITO", "QQQ", "SPY"]`.
- **Gradient header** matching design mockup; dark slate background throughout.

---

## 2026-04-21 — Bug fixes across backend

### `backend/routers/analysis.py`
- Fixed relative imports (`from ..schemas`) replaced with absolute imports
- Added `Depends` to fastapi import
- Fixed broken FastAPI dependency injection — `db: Session = None` → `db: Session = Depends(get_db)`
- Renamed `metadata` kwarg in `_save_analysis_result` to `run_metadata`

### `backend/database/models.py`
- Fixed `Base` class declaration — `declarative_base()` instead of plain `type()`
- Renamed `AnalysisResult.metadata` column to `run_metadata`
- Removed invalid type annotations from Column assignments

### `backend/database/__init__.py`
- Fixed `__all__` — replaced non-existent `"get_db_engine"` with `"engine"`

### `backend/services/backtesting/vectorbt_engine.py`
- Fixed undefined attribute `self.MIN_TRADES` → `self.DEFAULT_MIN_TRADES`
- Removed duplicate `RollingWindowOptimizer` class

### `backend/main.py`
- Fixed router import name (`router as analysis_router`)
- Removed duplicate broken `/analyze` root endpoint

### `backend/services/__init__.py` *(new file)*
- Added missing package init

## 2026-04-21 — Frontend fixes

### `frontend/src/app/api/analyze/route.ts`
- Fixed API proxy URL — was `/analyze`, should be `/api/v1/analyze`

### `frontend/src/app/layout.tsx` *(new file)*
- Root layout with Tailwind globals import

### `frontend/src/app/globals.css` *(new file)*
- Tailwind `@tailwind base/components/utilities`

## 2026-04-21 — Internal Server Error fix + real-time analysis log

### `backend/routers/analysis.py`
- Per-feed live SSE streaming with `asyncio.to_thread`
- Fixed `_ingest_data` returning `int` instead of `List`
- Added `/analyze/stream` SSE endpoint

### `frontend/src/app/api/analyze/stream/route.ts` *(new file)*
- Next.js SSE proxy

### `frontend/src/components/Dashboard/AnalysisLog.tsx` *(new file)*
- Terminal-style scrollable log panel

## 2026-04-21 — Fix zero scores, add Ollama guard, full UI rebuild

### `backend/services/sentiment/engine.py`
- Fixed model name (`"llama3"` → `"qwen3.5:9b"`)
- Removed silent zero-return exception handler
- Added `OLLAMA_URL` env var

### `backend/routers/analysis.py`
- Added Ollama preflight check
- Fixed symbol assignment (was only assigning to BITO)

### `frontend/src/components/Dashboard/SignalCard.tsx` *(new file)*
### `frontend/src/components/Dashboard/SentimentTicker.tsx` *(rewritten)*
### `frontend/src/components/Dashboard/RollingWindowChart.tsx` *(rewritten)*
### `frontend/src/app/page.tsx` *(rewritten)*
