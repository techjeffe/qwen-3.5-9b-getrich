# Release Notes — April 24, 2026

## Mac/Turbopack and Config Hardening

This update also folded in the Mac-side PR fixes and merged them with the local sentiment/trading work.

- **Frontend backend URL normalization** — all Next API proxy routes now resolve backend traffic through a shared helper that normalizes loopback URLs to `127.0.0.1:8000` instead of raw `localhost` fallbacks
- **Turbopack root pinned** — `frontend/next.config.js` now sets `turbopack.root` to the frontend directory so workspace detection is stable across machines, especially on macOS
- **Explicit dev scripts** — `frontend/package.json` now exposes both `dev:turbo` and `dev:webpack` so Webpack remains an easy fallback when Turbopack exposes local environment issues
- **Legacy config import made defensive** — `backend/services/app_config.py` now tolerates missing legacy columns during import and clamps/coerces persisted values before normalizing them into the live config row
- **Boolean parsing fixed** — persisted string booleans like `"false"` and `"0"` are now parsed correctly instead of becoming truthy through Python's default `bool("false")` behavior
- **Static Stage 1 trace clarified** — built-in symbols such as `SPY`, `QQQ`, `BITO`, and `USO` now show an explicit “static proxy map” explanation in the secret/debug view instead of the misleading “No Stage 1 prompt recorded” message

## Specialist Prompt Architecture Rewrite

The per-symbol specialist prompts were redesigned from the ground up to improve signal quality and reduce token cost.

- **Schema before news text** — the JSON schema and all field definitions now appear before the news text in every specialist prompt, so the model frames its reading with the full output contract first rather than discovering it after already processing the articles
- **Lean single-symbol header** — replaced the large basket-analysis context prompt with a focused 15-line header containing only the active symbol's price, specialist focus, and proxy-term context
- **Cross-symbol anchor removed** — all four symbol prices and basket-level signal rules were removed from the specialist path; each specialist now reasons about exactly one symbol with no cross-symbol contamination
- **proxy_context inline injection** — Stage 1 proxy-term context is now injected at the correct position within the header instead of prepended before system instructions
- **Exposure quality hint** — Stage 1 now computes a per-symbol exposure quality rating (DIRECT / INDIRECT / BROAD) from the keyword match ratio and injects it into the Stage 2 proxy context so specialists calibrate confidence on weakly-matched articles
- **~250 tokens saved per specialist call** — across four symbols, approximately 1,000 tokens removed per run with no reduction in extraction fidelity

## Signal Scoring Calibration

Several compounding biases were driving systematic SHORT signals on routine unconfirmed news. All three root causes are now corrected.

- **`unconfirmed_bluster_penalty`** lowered from 0.35 → 0.15: routine RSS articles (which are always technically "unconfirmed") no longer receive a structural negative penalty that pushed balanced articles toward the SHORT bluster path
- **`unconfirmed_policy_multiplier`** raised from 0.48 → 0.65: geopolitical unconfirmed news now scores 0.38 (near the LONG threshold); monetary policy unconfirmed now scores 0.53 (above the threshold) so partial-confirmation Fed commentary can produce HOLD/LONG instead of auto-SHORT
- **`bluster_short_threshold`** tightened from -0.35 → -0.60: requires substantially stronger bluster signal before an auto-SHORT triggers without policy backing
- **SHORT directional score** changed from `max(abs(bluster), policy)` to a weighted blend (40% bluster magnitude, 60% policy score): prevents pure rhetoric with zero policy evidence from producing a full-magnitude SHORT
- **`trade_policy` event type** added with base score 0.72: tariffs, trade war escalation, and import/export restrictions now have a dedicated bucket instead of splitting between `geopolitical` (0.58, too low) and `fiscal` (semantically wrong)

## Prompt Quality Improvements

- **Bluster phrase examples corrected** — examples now use genuinely rhetorical language ("promises to obliterate", "will change everything", "vows to completely destroy"); official hedge language from policy-makers ("warns that", "signals", "suggests") is explicitly excluded from bluster classification
- **Substance phrase examples expanded** — added "announced policy", "released data showing", "officially imposed"; clarified that press conference statements of official policy commitment count as substance
- **Neutral direction calibration** — `direction` field definition now instructs specialists to default to "neutral" unless the causal chain from headline to symbol price is explicit and direct; reduces spurious bearish classifications on loosely-related news
- **Red team balance** — red team is now explicitly instructed to challenge SHORT signals as vigorously as LONG signals, arguing why a bearish thesis may be priced in, the timeline uncertain, or the symbol hedged
- **Red team evidence thresholds visible** — minimum evidence counts required to override the blue team signal are now stated in the prompt so the model does not waste reasoning on overrides Python will silently discard (≥2 items for HOLD override; ≥3 for direction flip)
- **`event_type` disambiguation** — specialist schema now includes explicit classification guidance distinguishing `trade_policy` (tariffs, sanctions tied to trade) from `geopolitical` (military action, territorial conflict) and `monetary_policy` (central bank decisions)

## Prompt Schema Simplification

Fields that Python can compute more reliably than the LLM are now computed in Python.

- **`holding_period_hours` removed** from LLM schema; Python derives from `trading_type` via lookup table (SCALP→2h, VOLATILE_EVENT→3h, SWING→12h, POSITION→72h)
- **`transmission_path` removed** — duplicate of `mechanism` inside `symbol_relevance`; Python now reads `mechanism` directly
- **`urgency` and `conviction` removed** from schema; Python derives both from `trading_type` and `exposure_type` (e.g. POSITION+DIRECT → HIGH conviction; BROAD exposure caps at MEDIUM regardless of trade type)
- **`source_count` injected as Python fact** — actual article count is now stated in the prompt header; LLM copies the number instead of guessing (previously almost always defaulted to 2)
- **Redundant rule blocks removed** — symbol differentiation rules (150 tokens, fully covered by `exposure_type` definition) and phrase extraction rules (60 tokens, covered by field definitions) replaced with two concise bullets
- **Dead code removed** — `SYMBOL_SPECIALIST_APPENDIX` deleted; `STAGE1_EXTRACTION_PROMPT` marked as legacy (main pipeline uses keyword matching, not LLM classification)
- **`COMBINED_ANALYSIS_PROMPT` hardcoding fixed** — removed hardcoded USO/BITO/QQQ/SPY `symbol_impacts` block; fallback path no longer emits fake symbol analysis for custom-symbol runs

## Paper Trading Logic

- **Trail on window expiry** (`trail_on_window_expiry`, default true) — when a conviction holding window expires, the position now transitions to trailing stop mode instead of closing flat; lets profitable positions run while still protecting gains
- **Re-entry cooldown** (`reentry_cooldown_minutes`, default 120) — blocks same-direction re-entry in the same symbol within the configured window after a close; prevents same-direction churn on choppy signals
- **Entry threshold raised** (0.30 → 0.42) — higher minimum directional score required before a new paper trade opens; filters out the lowest-conviction noise signals

## Admin UI

- **Trading Logic section repositioned** — now sits between Model Orchestration and Symbols so trading behavior controls are grouped with the pipeline config they affect
- **Extended-hours toggle moved into Trading Logic** — the "Allow pre-market and after-hours paper trading" checkbox now lives alongside the other simulation controls with session liquidity guidance
- **Trail on window expiry toggle** added — checkbox with explanation of trailing stop mechanics and when to disable
- **Re-entry cooldown field** added — configurable minutes with fallback to `logic_config.json` default

---

# Release Notes — April 23, 2026

## Remote Snapshot Delivery and Secure Telegram Secrets

This release added outbound remote run snapshots plus cross-platform secure Telegram secret storage.

- Added **remote snapshot delivery** that renders a compact PNG after qualifying runs with latest recommendations, current P&L, timestamp, model label, and request ID
- Added **material-change gating** so snapshots only send when recommendations changed, net P&L moved enough, or the heartbeat window elapsed
- Added **Telegram photo delivery** as the primary remote destination, with signed-link and email plumbing available behind the same snapshot pipeline
- Added Admin controls for remote snapshot settings: enable/disable, delivery mode, max recommendations, P&L resend threshold, heartbeat, and whether to include recent closed trades
- Added a **Send Snapshot Now** button in Admin that immediately queues delivery of the most recent completed analysis run, bypassing the normal interval/change-detection gates — useful for testing credentials or manually pushing an update
- Added a Telegram setup modal in Admin with step-by-step instructions for bot creation and chat ID discovery
- Added secure **UI-managed Telegram secrets** using the OS keychain through `keyring`
  - Windows stores them in Credential Manager
  - macOS stores them in Keychain Access
- Raw bot token and chat ID are never stored in repo config, never returned to the UI after save, and only masked status is shown back in Admin
- Added a new backend admin secret-management API and a frontend proxy route so secrets stay backend-only

## Paper Trading Logic Overhaul

Several correctness issues and three structural improvements to the paper trading simulation.

**Bug fixes:**

- Fixed a silent `NameError` that prevented any paper trade from ever opening after a data reset — `config` was referenced inside a `try` block before it was defined, so the exception was swallowed and no trades were created
- Conviction window expiry now closes positions regardless of market hours — the `close_expired_positions` call was previously gated behind the market-closed check, so overnight expirations were silently skipped until the next open-market run

**New trading logic:**

- **ATR-scaled leverage caps** — leverage is now capped by the 14-day ATR % before the position is opened. When ATR % exceeds `high_vol_atr_pct` (3.0 %) leverage is capped at 1x; above `medium_vol_atr_pct` (1.5 %) it is capped at 2x. Thresholds are configurable in `logic_config.json`.
- **Dynamic per-symbol materiality gate** — the gate that blocks thesis flips on trivial re-runs now uses a rolling article baseline (mean ± 1 stddev over the last 20 runs per symbol) instead of a fixed post-count threshold. The dynamic threshold activates once 5 runs of history exist and falls back to the fixed threshold until then.
- **Trailing stop on HOLD** — instead of force-closing a position when a HOLD signal fires, the system now sets a trailing stop at `best_price_seen × (1 ± stop_loss_pct × tighten_factor)`. The stop tightens every run while the position is in HOLD mode and closes the position only if price crosses the stop level. Thesis re-confirmation clears the trailing stop.
- **Conviction window reset on re-confirmation** — when a re-run confirms the same direction, the holding window resets to a full window (or max window if a cap applies). Same or upgraded trade type resets fully; downgraded type shrinks proportionally. SCALP / SWING / POSITION / VOLATILE_EVENT are all handled by a `trading_type` rank rather than conviction level.

**Price history:**

- Price history is now automatically pulled in the background when a new custom symbol is added via Admin. History is retained even if the symbol is later removed, so re-adding it skips a fresh pull.

**History display:**

- Analysis history labels now show both `extraction_model` and `reasoning_model` when they differ (e.g. `qwen3:8b / qwen3:14b`). Previously only a single model name was shown even in two-stage pipeline runs.

---

## Producer/Consumer Ingestion Refactor

Today's backend update moved article ingestion out of the hot `/analyze` request path and into a DB-backed producer/consumer flow so analysis runs no longer block on live RSS fetches or full-page scraping.

- Added a new `scraped_articles` queue table to persist discovered RSS items, cleaned full article text, timestamps, and `processed` / `fast_lane_triggered` state
- Added a background ingestion worker that polls RSS feeds, runs a lightweight Stage 0 relevance pass, extracts cleaned article text, and saves unique URLs for later analysis
- Refactored the batch `/analyze` path to consume pending `processed = false` articles from the database instead of scraping the web inline
- Added a Fast Lane path for urgent macro headlines so high-impact summaries can trigger an off-cycle analysis run instead of waiting for the normal 15-minute batch
- Added analysis lease fields in `app_config` so scheduled runs and urgent runs do not process the same queued articles in parallel

## Startup and SQLite Stability

This release also hardened first boot and overlapping background work, which had started to show up as SQLite lock errors during startup.

- Added a startup grace window before the ingestion scheduler begins heavy work
- The ingestion worker now defers while an analysis lease is active, reducing writer contention during app boot and urgent reruns
- SQLite write windows were shortened and the engine was configured with a busy timeout to make lock recovery more forgiving under local single-user load

---

# Release Notes — April 22, 2026

## Paper Trading Simulation

Every analysis run now automatically simulates a $100 paper trade per signal during extended market hours (4:00am-8:00pm ET, Monday-Friday). The simulation mirrors what a real trader following every signal would actually do:

- **HOLD signal** — leave any open position running, don't open if flat. No action taken.
- **Same direction, same leverage, same execution ticker** — position is unchanged. No action taken.
- **Any change** (ticker flip, leverage increase/decrease, direction reversal) — close the existing position at the current price, open a new $100 position in the new direction.

Extended hours are used because that is when pre-market and after-hours paper or real trades can happen.

**Position tracking is per underlying symbol** — one open position per symbol (USO, BITO, QQQ, SPY, or any custom symbol) at a time. Entry price and shares are stored when a position is opened. Exit price and realized P&L are computed when it closes.

**New `/trading` page** — accessible from the nav (between History and Compare) shows the full paper trading picture:

- Market session badge showing current status (Open / Pre-Market / After-Hours / Closed)
- 8 summary stat cards: Net P&L, Realized P&L, Open P&L, Win Rate, Avg Win, Avg Loss, Total Deployed, Total Trades
- Equity curve — cumulative realized P&L across all closed trades, color-coded green above zero / red below
- Open positions table with live unrealized P&L fetched from yfinance at page load
- Closed trades history with entry->exit prices, realized P&L, and market session each trade was opened in
- Reset button (admin) to clear all paper trading history

**New `paper_trades` database table** — completely independent of all analysis tables; never touched by reset-data operations. Stores one row per opened position with entry/exit prices, timestamps, session, shares, and P&L.

**DB upgrade note:** Restart the backend — `migrate.py` creates the `paper_trades` table automatically.

---

## Summary

This release added technical indicator context for the LLM, a persistent price history database, and a complete redesign of the Stage 1 article filter — replacing per-article LLM classification with fast keyword matching that now works correctly for custom symbols like NVDA and NOW. It also adds a red-team consensus layer that can challenge and adjust the primary trade signal, a saved-run comparison workflow that explains why a ticker changed between two historical runs, and a more realistic ETA/progress bar based on observed runtime history. The release also focused on making the app easier to operate day to day: persistent admin settings, clearer model comparison, better history visibility, more flexible symbol/feed configuration, and runtime/status fixes.

## Technical Indicators and Price History

Seven quantitative indicators are now computed from locally stored OHLCV data and injected directly into each symbol's specialist prompt so the LLM reasons about trend context, not just news sentiment.

**Indicators:**
- RSI(14) — momentum
- SMA50 / SMA200 — trend with Golden Cross / Death Cross detection
- MACD(12,26,9) — trend direction and histogram
- Volume Profile — above / at / below 20-day average volume
- Bollinger Bands %B — price position within bands
- ATR(14) — volatility
- OBV trend — accumulation / distribution over the last 5 sessions

**Price history storage:**
- OHLCV data is stored in a dedicated `price_history` table that is completely independent of the analysis database — reset-data operations never touch it
- Delta pull: only rows newer than the latest stored date are fetched, so re-running the pull is safe
- 3-second delay between symbols to stay within yfinance rate limits; if a rate-limit exception is hit the pull stops and saves what it has so the next pull can resume
- The Admin page has a new Price History section: per-symbol row count, date range, a green (ready) / amber (needs pull) indicator, and a pull button
- Technical indicators are only injected when price history has been pulled — if the table is empty the analysis prompt is unchanged and analysis runs normally

**Implementation note:** All 7 indicators are computed in Python using numpy only — no new dependencies.

## Stage 1 Article Filter — Keyword Generation Redesign

The previous Stage 1 approach (LLM classifying every article) had several failure modes: small models ignored JSON instructions, token limits caused truncated responses returning 0 relevant articles, and custom symbols like NVDA and NOW were invisible to the keyword filter because they had no entries in the built-in map.

The new approach is faster and works for any symbol:

- **Built-in symbols** (USO, BITO, QQQ, SPY): the static `TICKER_PROXY_MAP` is used directly — no LLM call, instant
- **Custom symbols** (e.g. NVDA, NOW, TSLA): the LLM is called **once** with a short focused prompt asking for 15-20 proxy keywords for that ticker; the response is cached for the server session so the LLM is only called once per symbol per restart
- **Article matching**: pure substring keyword matching — milliseconds regardless of article count, no per-article LLM calls at all
- If keyword generation fails, the ticker name itself is used as the fallback keyword
- If nothing matches, all articles are passed to Stage 2 (same safe fallback as before)

Even llama3.2 (3B) handles keyword generation reliably since "what words appear in NVDA news?" is a factual question, not a multi-article classification task.

## Stage 1 Smoke Test — Custom Symbol Coverage

`test_stage1.py` now tests both built-in and custom symbol paths:

```text
python test_stage1.py llama3.2:latest
```

Output now shows:
- Which keyword source was used per symbol: `(static)` or `(LLM-generated)`
- The generated keywords for NVDA and NOW
- Separate PASS/FAIL for built-in symbol catch rate vs custom symbol coverage vs noise filtering

## Risk Profile and Leverage Control

A new Risk Profile selector in Admin controls the maximum leverage the simulation will take. Four profiles:

- **Conservative** — inverse ETF at 1x for bearish signals, 1x for bullish (no leveraged long)
- **Moderate** — 2x when confidence > 75%, otherwise 1x
- **Aggressive** — 3x when confidence > 75%, otherwise 1x
- **Crazy** — always 3x

The conservative profile routes bearish signals to true inverse ETFs (SQQQ, SPXS, SCO, SBIT) with BUY action instead of synthetic SELL positions. Stored in the database alongside other admin config.

## Broker-Ready Execution Tickers

Recommendations now name the actual tradable instrument rather than an abstract lever on the underlying. The execution mapping:

| Signal | Action |
|---|---|
| QQQ bullish 3x | BUY TQQQ |
| QQQ bearish | BUY SQQQ |
| SPY bullish 3x | BUY SPXL |
| SPY bearish | BUY SPXS |
| USO bullish 2x | BUY UCO |
| USO bearish 2x | BUY SCO |
| BITO bullish 2x | BUY BITU |
| BITO bearish 2x | BUY SBIT |

Bitcoin and oil are capped at 2x. The Market Prices panel shows execution tickers alongside their underlyings when a position is active.

## Health Page

A dedicated `/health` page was added showing: active Ollama model and reachability, average analysis runtime, latest data-pull status (success or error), uptime, and recent system events. Available without running a fresh analysis.

## Multi-Model Orchestration and Depth Mode

The analysis pipeline now supports independently configuring Stage 1 (extraction) and Stage 2 (reasoning) models. Three depth modes control pipeline behavior:

- **Light** — single model for both stages; lowest article count per feed
- **Normal** — two-stage when both models are set, otherwise single-stage
- **Detailed** — always two-stage; required models highlighted in Admin with an amber badge until set

Model selectors in Admin adapt their layout to the selected depth. Snapshots store the model configuration used so reruns reproduce the original pipeline exactly. The runtime config card shows a `Stage 1 → Stage 2` label when multi-model is active.

## Highlights

- The primary displayed recommendation is now a consensus signal after a blue-team proposal is challenged by a structured red-team review
- Red-team review can adjust the final action, confidence, urgency, and ATR-based stop-loss guidance when the original thesis looks fragile
- Compare can now load any two saved runs directly and explain why a symbol changed between them
- The in-progress ETA bar now starts at `0%` and uses recent run durations to pace both percent complete and ETA more honestly
- Admin settings now persist in the database instead of disappearing after rebuilds or restarts
- Custom symbols and custom RSS feeds are saved and restored correctly
- Default symbols and RSS feeds can be individually enabled or disabled
- Users can add up to `3` custom symbols and up to `3` custom RSS feeds
- RSS article depth can be controlled with `Light`, `Normal`, and `Detailed` presets
- Added optional `Light Web Research` prompt grounding in Admin
- Web research runs across the full active tracked symbol set, including built-ins like `USO`, `BITO`, `QQQ`, and `SPY`
- Web research depth now follows the selected analysis depth:
  - `Light`: `3` items per symbol
  - `Normal`: `4` items per symbol
  - `Detailed`: `6` items per symbol
- Live feed now shows symbol-scoped web research pulls as expandable cards, similar to RSS article events
- Market Prices now includes execution tickers for active underlyings, including symbols like `SQQQ`, `SPXS`, `SBIT`, and `SCO`
- Recommendation History now shows per-ticker recommendation details more reliably
- Snapshot comparison now shows:
  - explicit baseline vs comparison model labeling
  - missing-on-one-side recommendations as `Different`
  - side-by-side reasoning summaries for why each model made its choice
- Ollama runtime status now prefers the actually running model from `/api/ps`
- Snapshot timestamps now render correctly in the configured local timezone
- All timestamps across the app respect the configured display timezone (stored in the database and synced to the browser)
- History and Compare tabs are always visible — no longer require a completed current run to display

## Persistence Improvements

The following admin-controlled items are now intended to persist through the database-backed app config:

- tracked/default symbol selection
- custom symbols
- enabled RSS feed selection
- custom RSS feeds
- RSS article depth settings
- prompt overrides
- snapshot retention
- display timezone
- light web research enablement

The backend database path was also stabilized so saved config is no longer lost depending on which directory the backend was started from.

## Comparison Lab Improvements

Replay-based model comparison is now more usable for actual evaluation work.

- The comparison UI makes it clearer which model is the baseline and which is the comparison run
- Symbol-level rows treat `trade vs no trade` as a real difference
- Each symbol can show a short baseline-vs-comparison reasoning summary to explain disagreements
- Comparison headers were cleaned up so model names sit above the table instead of inside the column headers
- Saved-run compare can now load two historical analyses directly and explain per-symbol changes in recommendation, score movement, confidence, and leverage

## History and Snapshot Improvements

- Saved analysis snapshots now persist recommendation details in the saved signal payload
- Older runs can fall back to persisted `Trade` rows when reconstructing history
- Empty history states use clearer wording when ticker-level recommendations were not saved
- Saved snapshot detail loading now supports reopening a full historical run for side-by-side comparison and change-driver analysis

## Signal Review Improvements

- After the initial signal is generated, a dedicated red-team review checks for regime shifts in recent news, sentiment-vs-technical divergence, source-bias concentration, and portfolio de-coupling risk
- The user-facing primary signal is now the final consensus output instead of the initial unchallenged model answer
- ATR-aware stop guidance from the review layer is carried alongside the adjusted signal where available

## Runtime UX Improvements

- The analysis progress bar now starts at `0%` when a run begins
- Once at least a couple of previous runs exist, ETA pacing uses recent observed runtimes instead of fixed stage percentages
- Progress reaches `100%` when the run finishes instead of lingering at an artificial near-complete value

## Operational Notes

- Custom symbols currently price and analyze correctly, but only built-in symbols have the richer symbol-specific FRED/EIA validation bundles
- The model comparison dropdown sends the selected model name directly to Ollama; the model does not need to be manually preloaded first, but it must be installed locally
- Light Web Research uses a narrow trusted-source news pull rather than general model browsing, and the saved web context is reused during snapshot reruns so comparisons stay fair

## Verification

- Frontend production build: `npm run build`
- Backend modified files compiled successfully

---

# Release Notes — April 21, 2026

## Initial Release

First working end-to-end build of the sentiment trading pipeline.

## Local-Only Security Model

- Backend binds to `127.0.0.1` by default — not publicly exposed
- Optional `ADMIN_API_TOKEN` environment variable gates sensitive admin routes with a shared-secret header
- Generated build artifacts, caches, and local databases excluded from git tracking

## Core Analysis Pipeline

- FastAPI backend with SSE streaming for live progress and article events
- RSS ingestion across 7 sources with per-feed fair distribution so no single feed dominates the article pool
- Keyword relevance filtering before LLM analysis — generic noise less likely to dominate the run
- Symbol-specific specialist prompts: each tracked symbol gets its own narrowed news context and validation block rather than a shared aggregated blob
- FRED validation for BITO (M2SL / M2REAL), QQQ (DFII10), and SPY (HY and IG credit spreads); EIA validation for USO (crude stocks, refinery utilization)
- QQQ and SPY added to default coverage alongside USO and BITO

## Frontend Baseline

- Next.js 16.2.4 / React 19 dashboard
- Live market price polling panel
- Auto-run countdown and manual trigger
- Expandable article cards in the live feed with source, title, and content preview
- Signal presentation with action, symbol, leverage, and confidence

## Advanced Mode

- Toggle reveals debug panels for: RSS articles fed to the model, compiled news context, FRED/EIA validation blocks, technical indicator context per symbol, and exact final per-symbol prompts
- Frozen snapshot comparison lab available in Advanced Mode — replay a saved dataset against a different Ollama-served model without re-downloading articles or validation data
