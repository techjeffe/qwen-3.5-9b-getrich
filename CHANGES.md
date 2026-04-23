# Changelog

## 2026-04-22 - Paper trading simulation and /trading page

> **DB upgrade note:** Restart the backend — `migrate.py` will create the `paper_trades` table automatically.

### `backend/services/paper_trading.py` (new)
- Added `market_status()` — returns current session (`open`, `pre-market`, `after-hours`, `closed`) using extended trading hours 4:00am–8:00pm ET Mon–Fri via `zoneinfo`
- Added `process_signals(db, recommendations, quotes_by_symbol, request_id)` — main entry point that auto-simulates $100 paper trades per signal during market hours; HOLD signals leave existing open positions unchanged (no close, no new open); same ticker + leverage + direction leaves the position unchanged; any change in ticker, leverage, or direction closes the old position and opens a new one
- Added `_close_position(pos, exit_price, now, db)` — computes realized P&L and percent return, stamps exit fields
- Added `get_summary(db)` — fetches live unrealized P&L for open positions from yfinance, returns full summary including market status, stats (win rate, avg win/loss, realized/open P&L, total deployed), open positions with current prices, closed trades list, and equity curve (cumulative realized P&L per closed trade)

### `backend/database/models.py`
- Added `PaperTrade` model with fields: `underlying`, `execution_ticker`, `signal_type`, `leverage`, `market_session`, `amount`, `shares`, `entry_price`, `exit_price`, `entered_at`, `exited_at`, `realized_pnl`, `realized_pnl_pct`, `analysis_request_id`

### `backend/database/migrate.py`
- Added `CREATE TABLE paper_trades` with indexes on `underlying`, `entered_at`, and `exited_at` for both SQLite and Postgres

### `backend/routers/analysis.py`
- Added `sentiment_results` parameter to `_save_analysis_result` and `_save_analysis_and_trades`; passed from both the streaming and rerun call sites
- Added paper trading hook inside `_save_analysis_result` after `persist_recommendation_trades` — maps each symbol's `signal_type` from `sentiment_results` to an execution recommendation, then calls `process_signals`; wrapped in `try/except` so a paper trading failure never blocks the analysis save
- Added `GET /paper-trading/summary` — returns full paper trading data payload
- Added `DELETE /paper-trading/reset` — clears all paper trade history (admin-protected)

### `frontend/src/app/api/paper-trading/route.ts` (new)
- Added Next.js proxy route: `GET` proxies to `/api/v1/paper-trading/summary`, `DELETE` proxies to `/api/v1/paper-trading/reset`

### `frontend/src/app/trading/page.tsx` (new)
- Added `/trading` page with sticky header showing market session badge (Open / Pre-Market / After-Hours / Closed), Refresh, and Reset controls
- Summary stats: Net P&L, Realized P&L, Open P&L, Win Rate, Avg Win, Avg Loss, Total Deployed, Total Trades
- Equity curve chart using recharts `LineChart` — cumulative realized P&L across closed trades, color-coded green/red
- Open positions table with direction badge (LONG/SHORT), leverage, entry price, live current price, unrealized P&L badge, entry time, and session badge
- Closed trades table with entry→exit prices, realized P&L badge, close time, and session badge
- Empty states for both tables

### `frontend/src/app/page.tsx`
- Added `Fragment` import from React
- Added "Trading" nav link (emerald-colored) in the primary nav between History and Compare tabs; navigates to `/trading` as a standalone page

---

## 2026-04-22 - Consensus signal review, saved-run compare, and realistic ETA pacing

### `backend/routers/analysis.py`
- Added a post-signal red-team review pass that challenges the initial per-symbol recommendation using recent news, technical indicators, source concentration, and portfolio correlation risk
- Added consensus signal construction so the primary `trading_signal` reflects the reconciled blue-team/red-team answer while preserving the original blue-team output for auditability
- Added historical snapshot detail loading so saved runs can be reopened and compared without requiring a fresh live analysis

### `backend/schemas/analysis.py`
- Added structured red-team review models and persisted consensus/blue-team signal fields in the analysis response schema

### `backend/services/sentiment/prompts.py`
- Added a dedicated red-team review prompt that asks for thesis, antithesis, adjusted signal, confidence calibration, and ATR-based stop-loss guidance

### `frontend/src/app/page.tsx`
- Added compare support for loading any two saved runs and surfacing why a recommendation changed, including signal flips, score deltas, confidence shifts, and leverage changes
- Reworked the in-progress estimator so the bar starts at `0%`, uses recent runtime history when enough samples exist, and reaches `100%` on completion instead of stalling near the start or finish
- Added red-team review and consensus context to the main analysis experience so users can see the challenged final answer rather than only the initial thesis

### `frontend/src/app/api/analyze/snapshots/[requestId]/route.ts`
- Added frontend proxy support for fetching full saved-run details used by the compare workflow

### `README.md`, `RELEASENOTES.md`
- Updated release documentation to cover consensus signaling, saved-run comparison, and runtime ETA improvements

## 2026-04-22 - Technical indicators, price history pull, and Stage 1 keyword-generation redesign

> **DB upgrade note:** Restart the backend — `migrate.py` will create the `price_history` table automatically. This table is fully independent of all analysis tables and is never touched by reset-data operations.

### `backend/database/models.py`
- Added `PriceHistory` model with `UniqueConstraint("symbol", "date")` — stores OHLCV rows per symbol; positioned before `AppConfig` in the model file so it is never part of the reset-data FK deletion chain

### `backend/database/migrate.py`
- Added `CREATE TABLE IF NOT EXISTS price_history` blocks for both SQLite and Postgres

### `backend/services/data_ingestion/yfinance_client.py`
- Added `pull_and_store_history(symbols, db, delay_seconds=3.0, full_period="14mo")` — pulls OHLCV history sequentially, 3-second delay between symbols to avoid rate-limiting; stops and saves on any exception so partial pulls can be resumed later
- Added `_upsert_price_rows(db, symbol, df)` — delta pull: bulk-checks existing dates then inserts only new rows
- Added `compute_technical_indicators(symbol, db)` — computes 7 technical indicators from the last 250 stored rows using numpy only (no new dependencies):
  - RSI(14)
  - SMA50 / SMA200 with Golden Cross / Death Cross detection
  - MACD(12,26,9) and signal line
  - Volume Profile (above / at / below 20-day average volume)
  - Bollinger Bands %B (14-period)
  - ATR(14)
  - OBV trend (rising / falling / flat over last 5 sessions)
- Added `_ema(values, period)` numpy EMA helper
- Added `format_technical_context(symbol, indicators)` `@staticmethod` — formats a prompt-ready block for injection before the specialist prompt

### `backend/routers/config.py`
- Added `GET /admin/price-history/status` — per-symbol row count, date range, and `ready` flag (≥200 rows)
- Added `POST /admin/price-history/pull` — triggers a background history pull via `asyncio.to_thread`; returns immediately while the pull runs

### `backend/routers/analysis.py`
- Added `_inject_technical_context(price_context, symbols, db)` — computes indicators from DB for all active symbols, stores as `technical_context_{symbol}` keys in the shared price context; silent on error so analysis always runs even when no price history has been pulled yet
- Modified `_build_symbol_specific_price_context` — promotes `technical_context_{symbol}` into the flat `technical_context` field sent to each specialist
- Modified `_build_per_symbol_prompts` — combines validation context and technical context with `"\n\n".join(filter(None, ...))` before the specialist prompt sees the articles
- Wired `_inject_technical_context` into both the stream and batch analysis paths

### `frontend/src/app/api/admin/price-history/pull/route.ts` (new)
- Frontend proxy for `POST /api/v1/admin/price-history/pull`

### `frontend/src/app/api/admin/price-history/status/route.ts` (new)
- Frontend proxy for `GET /api/v1/admin/price-history/status`

### `frontend/src/app/admin/page.tsx`
- Added Price History section before the Danger Zone: per-symbol status cards (green = ≥200 rows ready / amber = needs pull), a "Pull Price History" button, and an in-progress status message
- Fixed temporal dead zone bug: `fetchPriceHistoryStatus` useCallback now declared before the useEffect that lists it as a dependency

### `backend/services/sentiment/engine.py`
- Added module-level `_keyword_cache: Dict[str, List[str]] = {}` — persists LLM-generated symbol keywords for the server session so the LLM is only called once per custom symbol
- Added `_generate_symbol_keywords(symbol, model)` async method — returns static `TICKER_PROXY_MAP` terms instantly for built-in symbols (USO/BITO/QQQ/SPY); for custom symbols calls the LLM once with a focused prompt, parses `{"terms": [...]}`, caches the result; falls back to the ticker name on failure
- Rewrote `extract_relevant_articles` — now pure keyword matching with zero per-article LLM calls; all symbol keywords are gathered in parallel via `asyncio.gather`, then a single pass over all posts finds matches; falls back to all posts when nothing matches
- Added `force_json: bool` and `max_tokens: Optional[int]` parameters to `_call_ollama` and `_call_ollama_sync`
- `MAX_TOKENS` raised from 3072 to 8192

### `backend/services/sentiment/prompts.py`
- Added `SYMBOL_KEYWORD_GENERATION_PROMPT` — short focused prompt asking the LLM to list 15-20 proxy keywords for a given ticker; concise enough that llama3.2 (3B) handles it reliably since it is a factual lookup, not article classification
- Added `format_keyword_generation_prompt(symbol)` helper

### `backend/test_stage1.py`
- Extended smoke test to cover both built-in symbols (USO/BITO/QQQ/SPY via static map) and custom symbols (NVDA/NOW via LLM keyword generation)
- Added NVDA- and NOW-specific test headlines to verify LLM-generated keyword coverage
- Separate pass/fail checks for built-in catch rate, custom symbol coverage, and noise filtering
- Labels each symbol's keyword source as `(static)` or `(LLM-generated)` in the output

### `README.md`, `RELEASENOTES.md`
- Updated to reflect technical indicators, price history admin UI, and Stage 1 keyword-generation approach

---

## 2026-04-22 - Web research grounding, compare clarity, persistent config fixes, and history/runtime polish

> **DB upgrade note:** Restart the backend — `migrate.py` will add `web_research_enabled BOOLEAN DEFAULT false` to `app_config` automatically for existing databases.

### `backend/database/models.py`
- Added `web_research_enabled` to `AppConfig`

### `backend/database/migrate.py`
- Migration now adds `web_research_enabled` to `app_config` for both SQLite and Postgres

### `backend/services/app_config.py`
- Added config persistence and serialization for `web_research_enabled`
- Added `DEFAULT_WEB_RESEARCH_ITEMS`
- Added `resolve_web_research_items_per_symbol(config)` so web research depth follows `Light / Normal / Detailed`

### `backend/services/web_research.py`
- Added lightweight trusted-source web research fetcher for symbol-specific prompt grounding
- Uses Google News RSS search with a small trusted-source allowlist instead of unrestricted model browsing
- Added 30-minute caching to keep the feature fast
- Web research item count is now configurable per call so `Detailed` mode can fetch more items per symbol than `Light`

### `backend/services/sentiment/prompts.py`
- Added a dedicated `Recent Web Research Context` block to specialist prompts
- Keeps structured validation separate from lightweight recent web context

### `backend/services/sentiment/engine.py`
- Threaded `web_research_context` into the analysis path
- Expanded the sentiment cache key so runs do not accidentally reuse stale results when the web context changes

### `backend/schemas/analysis.py`
- Extended `ModelInputDebug` with:
  - `web_context_by_symbol`
  - `web_items_by_symbol`

### `backend/routers/analysis.py`
- Added `_get_symbol_web_research()` helper
- Stream and batch analysis paths now fetch optional web research for the full active tracked symbol set
- Snapshot reruns reuse the saved web research context instead of hitting the web again, keeping replay comparisons fair
- SSE stream now emits symbol-scoped web research entries into the live feed as expandable cards
- Added backend console logging for web research enablement, per-symbol item counts, and failures
- Snapshot API timestamps now emit explicit UTC ISO values for cleaner timezone conversion in the UI

### `frontend/src/app/admin/page.tsx`
- Added `Light Web Research` checkbox in the Model Orchestration section
- Web research toggle is saved as part of the normal admin config flow

### `frontend/src/app/page.tsx`
- Added web research data types to the frontend analysis model
- Advanced Mode debug panel now shows the recent web research items and summaries that were fed to the model
- Comparison results now include clearer baseline/comparison labeling above the table
- Comparison rows now treat `trade vs no trade` as `Different`
- Comparison rows now show short per-symbol baseline-vs-comparison reasoning summaries
- Snapshot/history timestamps now render correctly in the configured timezone even when old API timestamps were timezone-less
- Fixed a `Set` spread typing/build issue by switching to `Array.from(new Set(...))`

### `README.md`
- Updated architecture, features, admin controls, Advanced Mode, and API notes to include web research grounding, compare clarity, and saved web context

### `RELEASENOTES.md`
- Updated release summary to include the web research feature, comparison improvements, and additional persistence/runtime fixes

---

## 2026-04-22 - Risk profile selector and leverage control

> **DB upgrade note:** Restart the backend — `migrate.py` will add `risk_profile VARCHAR(20) DEFAULT 'moderate'` to `app_config` automatically. Existing deployments default to Moderate behavior (2x at >75% confidence).

### `backend/database/models.py`
- Added `risk_profile` column to `AppConfig` (`aggressive` default)

### `backend/database/migrate.py`
- Migration adds `risk_profile VARCHAR(20)` with `'aggressive'` default for both SQLite and Postgres

### `backend/services/app_config.py`
- Added `DEFAULT_RISK_PROFILE`, `VALID_RISK_PROFILES`, and `_normalize_risk_profile()` helper
- `update_app_config` now accepts and persists `risk_profile`
- `config_to_dict` now includes `risk_profile` in the serialized config payload

### `backend/routers/analysis.py`
- Added `_resolve_leverage(confidence, risk_profile, action)` — maps the four profiles to leverage strings:
  - `conservative` → `"inverse"` for bearish (routes to inverse ETF at 1x position sizing), `"1x"` for bullish
  - `moderate` → `"2x"` if confidence > 0.75 else `"1x"` (new default)
  - `aggressive` → `"3x"` if confidence > 0.75 else `"1x"` (previous default behavior)
  - `crazy` → always `"3x"`
- `_generate_trading_signal` now accepts `risk_profile` param; passes direction `action` to `_resolve_leverage`
- All three call sites (stream, batch, rerun) pass the configured `risk_profile` through; fallback is `"moderate"`

### `backend/services/trading_instruments.py`
- `build_execution_recommendation` handles the new `"inverse"` leverage label: bearish conservative signals route to the symbol's inverse ETF (SQQQ, SPXS, SCO, SBIT) with `"1x"` position sizing and `BUY` action — no shorting, no leverage amplification

### `frontend/src/app/admin/page.tsx`
- Added `risk_profile` to `AppConfig` type and `EMPTY_CONFIG`
- Added `riskOptions` array (Conservative / Moderate / Aggressive / Crazy) with color coding
- Risk Profile selector rendered as a 4-button grid below the Analysis Depth selector in the first section card

### `frontend/src/app/page.tsx`
- Added `risk_profile?` to `AppConfig` type and `DEFAULT_APP_CONFIG`
- Engine Config card "Leverage" row replaced with "Risk" row showing profile name and max leverage in parentheses (e.g. `Aggressive (3x)`), color-coded per profile

---

## 2026-04-22 - Multi-model orchestration, depth mode, custom symbol inference, and comparison improvements

> **DB upgrade note for yesterday's deployers:** The backend migration runs automatically on startup (`migrate.py` is called from `main.py`). If you deployed before this entry, just restart the backend — it will add the new columns without any manual SQL. New columns: `extraction_model VARCHAR(128)`, `reasoning_model VARCHAR(128)`, `rss_article_detail_mode VARCHAR(20)`, and `rss_article_limits JSON` in `app_config`. No data is lost; all new columns default safely.

### `backend/database/models.py`
- Added `extraction_model` and `reasoning_model` columns to `AppConfig` for two-stage model orchestration
- Added `rss_article_detail_mode` and `rss_article_limits` columns to `AppConfig`

### `backend/database/migrate.py`
- Migration now handles all four new `app_config` columns for both SQLite and Postgres

### `backend/services/app_config.py`
- Added config defaults, normalization, and serialization for `extraction_model`, `reasoning_model`, `rss_article_detail_mode`, and `rss_article_limits`

### `backend/routers/config.py`
- `GET /config` now appends `available_models` from a live Ollama status check so the Admin UI can populate model dropdowns without a separate request

### `backend/routers/analysis.py`
- Added `_resolve_pipeline_models(config, active_model)` helper that maps the depth mode to concrete extraction and reasoning model selections:
  - Light — same model for both Stage 1 and Stage 2
  - Normal — two-stage only when both models are explicitly set
  - Detailed — always two-stage, falls back to same model for both sides if only one is configured
- Both `analyze_market` and `analyze_market_stream` now use `_resolve_pipeline_models` instead of reading config fields directly
- `_build_dataset_snapshot` now stores `extraction_model` and `reasoning_model` in every saved snapshot so reruns can reproduce the original pipeline exactly
- `list_analysis_snapshots` returns `extraction_model` and `reasoning_model` per item
- `rerun_analysis_snapshot` accepts `extraction_model` and `reasoning_model` in the payload — single-model (`model_name`) and two-stage both work; new snapshots from reruns also store the model config
- Module-level TTL price cache (`_PRICE_CACHE_TTL = 300`) added to avoid rate-limiting yfinance on every request
- Leveraged and inverse execution tickers are fetched alongside their underlyings so `TradeCard` can show live prices for open positions

### `backend/services/sentiment/engine.py`
- Added `extract_relevant_articles(posts, symbols, extraction_model)` — Stage 1 entity mapping that filters articles by relevance and extracts proxy terms per ticker; falls back to full article set on any parse failure
- Added `_is_large_model(model_name)` — regex-based detection of models ≥ 7B so `keep_alive: "10m"` is automatically set to prevent large models from unloading between batch calls
- `analyze()` accepts `model_override` and `proxy_context` for per-symbol Stage 2 specialization
- `_call_ollama_sync` uses `model_override` when set and applies `keep_alive` for large models

### `backend/services/sentiment/prompts.py`
- Added `TICKER_PROXY_MAP` with predefined proxy terms for `USO`, `BITO`, `QQQ`, and `SPY`
- Added `STAGE1_EXTRACTION_PROMPT` — instructs the extraction model to classify headlines by ticker relevance and extract proxy terms; custom symbols marked `INFER` direct the model to use its own knowledge to discover the company, sector, and related news terms
- Added `STAGE2_PROXY_CONTEXT` — injected before Stage 2 specialist prompts to attribute proxy-term matches back to the ticker even when the ticker is not named directly
- Added `build_proxy_map_text`, `format_stage1_extraction_prompt`, and `format_stage2_proxy_appendix` helpers
- Custom symbols not in `TICKER_PROXY_MAP` get an `INFER` directive that asks the model to reason about the company name, industry, key products, and typical news drivers

### `backend/main.py`
- Added `uvicorn.access` log filter to suppress `/api/v1/prices` polling noise

### `frontend/src/app/admin/page.tsx`
- Added analysis depth selector (Light / Normal / Detailed) as the first section — controls both article count and pipeline mode
- Added Model Orchestration section immediately below the depth selector:
  - Light — single "Analysis Model" dropdown (same model for both stages)
  - Normal — optional Stage 1 and Stage 2 selectors; warning shown if only one is set
  - Detailed — required Stage 1 and Stage 2 selectors with amber "required" badge when empty
- Removed duplicate Light / Normal / Detailed article-count inputs from the RSS section
- Model Orchestration section moved to sit directly below the depth selector
- `available_models` array normalized on load and save to prevent TypeError when the field is absent from the API response
- Added unsaved-changes modal that intercepts both browser close and in-app navigation

### `frontend/src/app/page.tsx`
- `AppConfig` type gains `extraction_model`, `reasoning_model`, and `rss_article_detail_mode`
- Engine Config card shows two rows (Stage 1 / Stage 2) when both models are configured, single row otherwise; Runtime blurb shows `model1 → model2` for two-stage
- `ModelComparePanel` now has Stage 1 and Stage 2 model selectors instead of a single dropdown
- Added "Rerun original" button in comparison panel — reads the model(s) stored in the selected snapshot and reruns without any additional configuration
- Baseline model label in comparison results shows `extraction → reasoning` when the snapshot was a two-stage run
- `AnalysisSnapshotItem` type gains `extraction_model` and `reasoning_model`
- `handleRerunSnapshot` accepts optional `extractionModel` and `reasoningModel` arguments
- Price panel polling interval aligned with server-side 5-minute cache TTL; `pricePanelSymbols` wrapped in `useMemo` to prevent infinite re-render loop

### `frontend/src/app/api/analyze/rerun/route.ts`
- Forwards `extraction_model` and `reasoning_model` to the backend when present in the request body

## 2026-04-22 - Timezone display, history expand, trade management, and History/Compare independence

### `frontend/src/lib/timezone.ts`
- Added shared timezone utility with `formatTs`, `formatTime`, and `useTimezone` hook
- Reads preferred timezone from `localStorage` on load, defaulting to the browser/OS detected timezone
- `COMMON_TIMEZONES` list covers US, Europe, Asia, and Pacific zones

### `frontend/src/app/admin/page.tsx`
- Added timezone selector in the Scheduling section — stored in browser localStorage, no backend change needed
- All timestamps (last started, last completed, trade recommended_at) now respect the selected timezone
- Flipped Manage Executions logic to show trades that have an execution record (instead of unexecuted trades)
- Remove button now calls `DELETE /api/trades/{id}/execution` to strip an accidental execution, leaving the trade itself intact

### `frontend/src/app/page.tsx`
- All timestamps across the app (history snapshots, comparison picker, trade close records, P&L snapshot times) now respect the timezone set in Admin
- History tab rows are now collapsed by default — click any row to expand and see the per-symbol recommendations; overall signal, timestamp, and model are always visible
- History and Compare tabs no longer require a completed current run to display — both show on initial page load using saved snapshot data
- `ModelComparePanel` handles `result = null` gracefully with a pre-selected first saved snapshot
- Added empty states for both History and Compare when no snapshots exist yet

### `backend/routers/analysis.py`
- Added `DELETE /api/v1/trades/{trade_id}/execution` endpoint — removes just the execution record, leaving the trade in place

### `frontend/src/app/api/trades/[tradeId]/execution/route.ts`
- Added frontend proxy for deleting an execution record

## 2026-04-22 - Trade close, P&L improvements, and pull history

### `backend/database/models.py`
- Added `TradeClose` model to record user-entered realized P&L close prices

### `backend/database/migrate.py`
- Extended migration to create the `trade_closes` table for existing databases

### `backend/routers/analysis.py`
- Added `POST /trades/{trade_id}/close` to upsert a realized close price
- Added `DELETE /trades/{trade_id}` to remove unexecuted trade recommendations

### `backend/services/pnl_tracker.py`
- Added `trade_close` field in the P&L summary including `closed_return_pct` and `exec_closed_return_pct`

### `frontend/src/app/page.tsx`
- Added pull-to-pull History tab and Model Comparison tab in sticky header navigation
- History and Compare tabs promoted out of Advanced Mode into always-visible header tabs
- Added `TradeCard` with live vs snapshot P&L, close position form, and closed state display
- Added `PullHistoryCard` showing signal changes across pulls with amber diff highlighting

### `frontend/src/app/api/trades/[tradeId]/close/route.ts`
- Added frontend proxy for recording a trade close price

### `frontend/src/app/api/trades/[tradeId]/route.ts`
- Added frontend proxy for deleting an unexecuted trade

## 2026-04-22 - Health page, broker-ready execution tickers, and Advanced Mode snapshot reruns

### `backend/main.py`
- Expanded `GET /health` into a richer user-facing runtime status payload with model reachability, recent runtime stats, and latest data-pull status
- Added request timing middleware so health reporting can show basic latency and uptime details
- Recorded background scheduler pull results for the health page instead of returning only a static healthy flag

### `backend/routers/analysis.py`
- Switched recommendations from synthetic `SELL base 3x` style output to broker-friendly execution tickers like `BUY SQQQ`, `BUY SPXS`, `BUY SCO`, and `BUY SBIT`
- Capped bitcoin execution recommendations at `2x` and mapped them to `BITU` and `SBIT`
- Added snapshot persistence for frozen article, price, validation, and prompt inputs so a saved run can be replayed without re-downloading data
- Added `GET /api/v1/analysis-snapshots` and `POST /api/v1/analysis-snapshots/{request_id}/rerun` for Advanced Mode comparison workflows
- Hydrated execution-ticker quotes so entry prices and stored trades use the real tradable instrument
- Pruned older saved analyses and related trade rows after each save so snapshot retention is enforced
- Limited recent snapshot listing to the configured retention count

### `backend/database/models.py`
- Added `snapshot_retention_limit` to `AppConfig`
- Updated database init to run the lightweight schema migration helper

### `backend/database/migrate.py`
- Extended the lightweight migration helper to add the snapshot retention config column for existing local databases

### `backend/services/app_config.py`
- Added persisted `snapshot_retention_limit` config handling and exposed it through the frontend config payload

### `backend/services/trading_instruments.py`
- Added an execution-instrument map from analysis underlyings to broker-facing tradable tickers
- Encoded leverage caps per symbol family so unsupported 3x instruments do not get recommended

### `backend/services/runtime_health.py`
- Added lightweight in-memory runtime health tracking for request counts, request latency, data pulls, and last analysis status

### `backend/services/pnl_tracker.py`
- Changed P&L tracking to use the actual execution instrument return instead of multiplying the underlying return by a synthetic leverage label

### `backend/services/data_ingestion/yfinance_client.py`
- Added support for leveraged and inverse execution tickers used by the recommendation engine

### `backend/schemas/analysis.py`
- Updated signal docs and examples to describe tradable execution symbols instead of abstract leverage labels on the underlying

### `frontend/src/app/page.tsx`
- Added broker-facing recommendation explanations and ticker glossary tooltips so users can understand that `BUY SPXS` is a bearish `SPY` proxy
- Updated Advanced Mode with a frozen-snapshot comparison lab that can rerun a recent saved dataset against a different served model
- Kept the comparison tooling hidden unless Advanced Mode is enabled
- Updated the Advanced Mode snapshot picker to show readable date and time for each saved dataset choice

### `frontend/src/app/admin/page.tsx`
- Added a saved snapshot retention setting so Admin can control how many frozen analysis snapshots are kept for replay

### `frontend/src/app/health/page.tsx`
- Added a dedicated health page showing running model, average runtime, data-pull status, uptime, and recent system events

### `frontend/src/app/api/health/route.ts`
- Added a frontend proxy for the richer backend health payload

### `frontend/src/app/api/analyze/snapshots/route.ts`
- Added a frontend proxy for listing recent frozen analysis snapshots

### `frontend/src/app/api/analyze/rerun/route.ts`
- Added a frontend proxy for replaying a frozen snapshot with a different model

### `README.md`
- Documented the health page, broker-ready execution mapping, ticker explanation tooltips, Advanced Mode snapshot rerun workflow, and Admin snapshot retention setting

## 2026-04-22 - Runtime model visibility and Truth Social feed clarification

### `backend/routers/analysis.py`
- Finished the Ollama active-model plumbing so both stream and non-stream analysis paths resolve and use the same served model
- Added a stable `GET /api/v1/ollama/status` system route for frontend polling

### `backend/services/data_ingestion/scraper.py`
- Clarified that direct Playwright scraping is still a placeholder
- Documented that live Truth Social coverage currently comes from the third-party `trumpstruth.org` RSS feed path in the parser

### `frontend/src/app/api/ollama/status/route.ts`
- Added a frontend proxy route for Ollama runtime status polling

### `frontend/src/app/page.tsx`
- Replaced hardcoded `Qwen 3.5 9b` UI labels with the actual active served Ollama model
- Added a runtime status block in Engine Config so users can see whether Ollama is reachable and which model is in use
- Updated idle and error copy to reflect dynamic local model selection instead of one fixed model name

### `README.md`
- Updated setup and architecture notes to describe the dynamic Ollama model behavior
- Clarified that Truth Social posts currently enter the system through a third-party RSS feed, not direct browser scraping
- Documented the Ollama status endpoint

## 2026-04-21 - Validation routing, Advanced Mode, and symbol-specific specialist prompts

### `backend/routers/analysis.py`
- Added symbol relevance routing so RSS/news context is narrowed per analyst instead of feeding the same aggregated blob to `USO`, `BITO`, `QQQ`, and `SPY`
- Added keyword filtering to RSS ingestion in both stream and batch paths so generic world-news noise is less likely to dominate the run
- Narrowed `validation_context` per symbol so each specialist sees only its own FRED or EIA block
- Added explicit active-symbol prompt context including `active_symbol` and `active_symbol_price`
- Added `model_inputs` debug payload with compiled news context, validation context, visible price context, article list, and exact per-symbol final prompts

### `backend/services/sentiment/prompts.py`
- Extended context-aware prompts to include `active_symbol`, `active_symbol_price`, and `qqq_price`
- Made prompt context clearer so the active analyst symbol and its price are explicitly visible in the compiled prompt

### `backend/services/sentiment/engine.py`
- Updated prompt assembly to pass through `active_symbol`, `active_symbol_price`, and `qqq_price`
- Kept the specialist route aligned with the narrowed symbol-specific validation context

### `backend/schemas/analysis.py`
- Added structured debug schema for `model_inputs`
- Added `per_symbol_prompts` so the frontend can inspect the exact final prompt used for each specialist

### `frontend/src/app/page.tsx`
- Added `Advanced Mode` toggle to the main dashboard
- Added debug panels for RSS/news articles, compiled news context, FRED/EIA validation blocks, and exact final per-symbol prompts
- Fixed duplicate React key warnings in article keyword chips by trimming, deduping, and scoping keyword keys

### `README.md`
- Updated architecture, validation source, and feature documentation to match the new symbol-specific specialist pipeline and Advanced Mode tooling

---

## 2026-04-21 - Feed distribution fix, full title in sentiment, article display

### `backend/routers/analysis.py`
- Fixed per-feed starvation by giving each RSS feed a fair cap before trimming to `max_posts`
- Fixed missing headlines in sentiment by including both `post.title` and `post.content` in compiled model input

### `backend/services/data_ingestion/parser.py`
- Raised per-article content cap from 2000 to 5000 characters before router aggregation

### `frontend/src/app/page.tsx`
- Updated article cards to show fuller text in compact and expanded states

---

## 2026-04-21 - Frontend rebuild, price data, auto-run, and SSE article cards

### Backend
- Added live `GET /api/v1/prices`
- Added structured SSE `article` events
- Added QQQ and SPY to default analysis coverage
- Added recommendation payloads with `action`, `symbol`, and `leverage`

### Frontend
- Rebuilt the dashboard layout
- Added live market price polling
- Added auto-run countdown and trigger flow
- Added expandable article cards and richer signal presentation

---

## 2026-04-21 - Validation data layer and local-first security

### Validation layer
- Added `market_validation.py` to pull structured validation metrics from `FRED` and `EIA`
- Wired validation data into the analysis pipeline and prompt context

### Local-first security
- Added optional `ADMIN_API_TOKEN` protection for local admin routes
- Defaulted backend binding to `127.0.0.1`
- Removed generated artifacts, caches, and local DBs from git tracking
- Upgraded frontend baseline to Next.js 16.2.4 and React 19.2
