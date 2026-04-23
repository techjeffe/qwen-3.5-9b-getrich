# Sentiment Trading Alpha

Geopolitical sentiment pipeline that ingests live RSS headlines, overlays structured FRED and EIA validation data, runs symbol-specific local LLM specialist analysis, and generates broker-friendly BUY/SELL trade recommendations for USO, BITO, QQQ, and SPY using actual tradable execution tickers when leverage is applied. Auto-runs every 30 minutes.

This app is untested in the real world, not financial advice, and for amusement purposes only. 

Frontend baseline:

- Next.js 16.2.4
- React 19.2

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## Local-Only Security Model

This repo is intended for local single-user use by default.

- The backend binds to `127.0.0.1` by default
- Do not expose port `8000` publicly without adding stronger auth and rate limiting
- Generated build output, caches, and local databases are excluded from git
- Sensitive local-admin routes can be protected with an optional shared secret via `ADMIN_API_TOKEN`

## Architecture

Frontend:
- Next.js dashboard with live feed, signal cards, charts, and Advanced Mode
- SSE stream for analysis progress and article events
- Dedicated `/health` page for runtime, model, and data-pull visibility
- Dedicated `/trading` page for paper trading simulation with equity curve and position tables

Backend:
- FastAPI analysis pipeline and config endpoints
- RSS ingestion, yfinance price pulls, FRED/EIA validation bundle
- Local Ollama-served symbol-specialist runs, signal generation, and rolling-window backtest
- Frozen analysis snapshot persistence for model-to-model replay in Advanced Mode
- Persistent admin configuration stored in the local database so saved symbols, feeds, prompt overrides, and timezone survive rebuilds/restarts
- Paper trading hook wired into every analysis save — simulates $100 per signal, manages position lifecycle, stores results in a dedicated `paper_trades` table independent of all other analysis tables

Model flow:
- RSS items are filtered for relevance before analysis
- Each symbol gets its own specialist prompt and its own narrowed validation context
- `USO` uses `EIA` validation
- `BITO`, `QQQ`, and `SPY` use `FRED` validation
- The dashboard polls Ollama and shows the active served model instead of assuming a fixed model name
- Saved analysis snapshots can be replayed against a different served model without re-downloading the articles, price context, or validation context
- A configurable two-stage pipeline separates entity extraction (Stage 1) from financial reasoning (Stage 2), optionally using different models for each stage
- Stage 1 uses keyword matching to filter articles: built-in symbols (USO/BITO/QQQ/SPY) use a static proxy term map; custom symbols (e.g. NVDA, NOW) call the LLM once to generate 15-20 proxy keywords, cache them for the session, then use pure keyword matching — no per-article LLM calls
- Stage 2 receives only the relevant articles plus the Stage 1 proxy-term context, injected before the specialist prompt, so it attributes proxy-term matches to the correct ticker even when the ticker is not named in the headlines
- Pipeline depth is set per-run: Light uses one model for both stages, Normal uses two-stage only when both models are explicitly configured, Detailed always runs the full two-stage pipeline
- When price history has been pulled, 7 technical indicators (RSI, SMA50/200, MACD, Volume Profile, Bollinger Bands %B, ATR, OBV trend) are computed from stored OHLCV data and injected into each specialist prompt alongside the validation context
- After the initial per-symbol signal is generated, a second red-team review challenges the thesis against recent news, technicals, source concentration, and cross-asset portfolio risk
- The primary displayed trade recommendation is now the final consensus signal after the blue-team proposal and red-team challenge are reconciled; the original signal is retained for audit/debug views

## Features

- Broker-ready trade recommendations such as `BUY TQQQ`, `BUY SQQQ`, `BUY SPXL`, `BUY SPXS`, `BUY UCO`, `BUY SCO`, `BUY BITU`, and `BUY SBIT`
- Consensus trade recommendations now reflect both the initial model thesis and a red-team challenge pass before the final signal is shown
- Recommendation tooltips so users can see that inverse/leveraged tickers are proxies for bullish or bearish views on the underlying
- Live article feed with expandable cards and model reasoning
- Market price panel for active tracked underlyings plus their execution tickers, so symbols like `SQQQ`, `SPXS`, `SBIT`, and `SCO` show up when relevant
- Structured validation layer from official pullable sources
- Optional light web research layer that pulls a small number of recent trusted news items per active symbol and injects them into the specialist prompt
- Runtime model status so the UI reflects whichever model Ollama is currently serving; shows `Stage 1 → Stage 2` when multi-model is active
- Health page with running model, recent runtime, request stats, and latest data-pull status
- History tab — pull-to-pull signal diff showing how recommendations change across runs, expandable per-symbol details, available without needing a current run
- **Trading tab** (link in nav) — dedicated `/trading` page showing the paper trading simulation with equity curve, open positions (live P&L), and full closed trade history
- Compare tab — replay any frozen snapshot with Stage 1 and Stage 2 model selectors; "Rerun original" button re-runs with the exact models the snapshot was originally run with
- Comparison results now show clearer baseline vs comparison labeling plus per-symbol reasoning summaries to explain disagreements
- Compare can also load two saved historical runs directly and show why a symbol changed, including recommendation flips, score deltas, confidence moves, and leverage-threshold changes
- P&L tracking with live prices, forward-horizon snapshots (1h / 4h / 1d / 3d / 1w), and realized close price recording
- **Paper trading simulation** — every analysis run auto-simulates a $100 paper trade per signal during extended market hours (4am–8pm ET); position lifecycle mirrors what a real trader following every signal would do (HOLD = do nothing, same direction/leverage = hold, any change = close and reopen); results visible on the `/trading` page with equity curve, open positions with live P&L, and closed trade history
- Timezone selector in Admin — all timestamps across the app follow the configured zone, defaulting to the OS timezone, including saved snapshots and history rows
- Admin can remove accidental execution records without deleting the underlying trade recommendation
- Two-stage LLM pipeline with configurable depth (Light / Normal / Detailed) and optional different models per stage
- **Technical indicators** injected into each specialist prompt when price history is available: RSI(14), SMA50/200 with Golden/Death Cross, MACD(12,26,9), Volume Profile, Bollinger Bands %B, ATR(14), OBV trend — computed from locally stored OHLCV data, no external data feed required
- **Red-team consensus review** stress-tests each signal for regime shifts, sentiment-vs-technical divergence, source-bias concentration, and portfolio correlation risk, then can adjust the final recommendation, confidence, urgency, and stop-loss guidance
- **Price history pull** in Admin — pulls up to 14 months of OHLCV data from yfinance, stored in a dedicated table that survives data resets; delta pull only fetches missing rows; 3-second delay between symbols with stop-and-resume on rate limit errors
- **Custom symbol keyword generation** — Stage 1 calls the LLM once per custom symbol to generate proxy keywords (e.g. "what words appear in NVDA news?"), caches them for the session, then uses pure keyword matching; built-in symbols use a static map and require no LLM call
- **Realistic run ETA** — the in-progress analysis bar now starts at `0%` and, once enough run history exists, paces progress and ETA using recent observed runtimes instead of fixed stage jumps
- Advanced Mode for inspecting:
  - RSS articles fed to the model
  - recent web research items fed to the model
  - compiled news context
  - FRED/EIA validation context
  - technical indicator context per symbol
  - exact final per-symbol prompts
  - frozen snapshot reruns against a different Ollama-served model or model pair
- Auto-run every 30 minutes
- 7 RSS sources with fair per-feed distribution
- Keyword relevance filtering before specialist analysis
- Rolling window backtest over 6 months of data

## Admin Controls

The Admin page is organized around the things users change most often first.

1. **Analysis Depth** — Light / Normal / Detailed selector controls both article count per feed and pipeline behavior
2. **Model Orchestration** — immediately below the depth selector; dropdowns change based on selected depth:
   - Light: single "Analysis Model" (same model for Stage 1 and Stage 2)
   - Normal: optional Stage 1 and Stage 2 selectors; single-stage if only one is set
   - Detailed: both models required; amber warning shown until both are selected
3. **Symbols** — enable/disable default symbols, add up to 3 custom symbols
4. **RSS Sources** — enable/disable feeds, add up to 3 custom feeds
5. **Prompt Overrides** — per-symbol specialist prompt guidance
6. **Price History** — pull and status panel: per-symbol row count, date range, ready/needs-pull indicator, and a pull trigger button; the `price_history` table is independent of the analysis database and is never cleared by reset-data
7. **Scheduling & System** — auto-run cadence, snapshot retention, display timezone

Advanced additions:

- **Light Web Research** checkbox in Model Orchestration
- Web research runs across the full active tracked symbol set, not just custom symbols
- Web research depth follows the selected analysis depth:
  - Light: `3` items per symbol
  - Normal: `4` items per symbol
  - Detailed: `6` items per symbol

Important behavior:

- If a symbol is unchecked, it will not be evaluated by the model
- If an RSS feed is unchecked, it will not be included in ingestion
- Custom symbols price and analyze correctly; Stage 1 calls the LLM once to generate proxy keywords for any symbol not in the built-in map and caches the result for the session
- Only built-in symbols (`USO`, `BITO`, `QQQ`, `SPY`) have the richer FRED/EIA validation bundles
- Technical indicators are injected when price history is available; if the `price_history` table is empty the analysis prompt is unchanged and analysis completes normally
- When Light Web Research is enabled, the model receives a compact recent-news block per active symbol from a small trusted-source allowlist rather than scraping a huge feed universe

## Validation Sources

- `USO` - `EIA` weekly petroleum pages for refinery utilization, commercial crude stocks, gasoline stocks, and distillate stocks
- `BITO` - `FRED` `M2SL` and `M2REAL`
- `QQQ` - `FRED` `DFII10` for 10-year TIPS real yield
- `SPY` - `FRED` `BAMLH0A0HYM2` and `BAMLC0A0CM` for credit spreads

These validation signals are injected into the symbol specialist prompt as per-symbol context, not one shared generic block.

## Technical Indicators (Price History)

When price history has been pulled for a symbol, 7 computed indicators are appended to each specialist prompt alongside the validation context:

| Indicator | Parameters | Notes |
|---|---|---|
| RSI | 14-period | Momentum oscillator |
| SMA | 50-day and 200-day | Golden Cross / Death Cross flagged automatically |
| MACD | 12/26/9 | Histogram included |
| Volume Profile | 20-day average | Reports above / at / below average |
| Bollinger Bands %B | 14-period | Price position within bands |
| ATR | 14-period | Volatility measure |
| OBV Trend | Last 5 sessions | Rising / Falling / Flat |

All indicators are computed locally from the `price_history` table using numpy — no additional dependencies or data feed subscriptions required. If fewer than 14 days of data are stored the affected indicator is omitted rather than producing an error.

## Feed Sources

- Most geopolitical and market headlines come from standard RSS feeds
- Truth Social coverage currently comes from the third-party RSS feed `https://trumpstruth.org/feed`
- Direct Playwright scraping of Truth Social is not the active production path right now

## Signal Logic

| Bluster Score | Policy Score | Signal | Leverage |
|---------------|--------------|--------|----------|
| < -0.5        | < 0.3        | SELL   | 3x if confidence > 75% |
| Any           | > 0.7        | BUY    | 3x if confidence > 75% |
| Otherwise     | Otherwise    | HOLD   | - |

## Execution Mapping

The analysis still reasons about the underlying symbols `USO`, `BITO`, `QQQ`, and `SPY`, but the recommendation layer now converts leverage into actual broker-tradable execution tickers.

- `QQQ` bullish `3x` -> `BUY TQQQ`
- `QQQ` bearish `3x` -> `BUY SQQQ`
- `SPY` bullish `3x` -> `BUY SPXL`
- `SPY` bearish `3x` -> `BUY SPXS`
- `USO` bullish `2x` -> `BUY UCO`
- `USO` bearish `2x` -> `BUY SCO`
- `BITO` bullish `2x` -> `BUY BITU`
- `BITO` bearish `2x` -> `BUY SBIT`

Notes:

- Bitcoin is capped at `2x`
- Oil is capped at `2x`
- The UI now shows tooltip help so users can see that a ticker like `SPXS` represents a bearish `SPY` proxy

## Project Structure

```text
qwen-3.5-9b-getrich/
|- backend/
|  |- main.py
|  |- test_stage1.py          # Stage 1 smoke test (built-in + custom symbols)
|  |- routers/
|  |  |- analysis.py
|  |  `- config.py            # includes /admin/price-history/status and /pull
|  |- schemas/
|  |  `- analysis.py
|  |- database/
|  |  |- engine.py
|  |  |- models.py            # includes PriceHistory table
|  |  `- migrate.py
|  `- services/
|     |- data_ingestion/
|     |  |- parser.py
|     |  |- scraper.py
|     |  |- market_validation.py
|     |  `- yfinance_client.py   # includes pull_and_store_history + compute_technical_indicators
|     |- sentiment/
|     |  |- engine.py            # includes _generate_symbol_keywords + _keyword_cache
|     |  `- prompts.py           # includes SYMBOL_KEYWORD_GENERATION_PROMPT
|     |- runtime_health.py
|     |- trading_instruments.py
|     |- paper_trading.py        # $100/signal simulation, position lifecycle, get_summary
|     `- backtesting/
|        `- optimization.py
|- frontend/
|  |- src/app/page.tsx
|  |- src/app/admin/page.tsx     # includes Price History section
|  |- src/app/health/
|  |- src/app/trading/           # paper trading page
|  |- src/lib/
|  `- src/app/api/
|     |- paper-trading/route.ts              (new)
|     |- admin/price-history/pull/route.ts   (new)
|     `- admin/price-history/status/route.ts (new)
|- CHANGES.md
|- RELEASENOTES.md
`- README.md
```

## Testing Your Extraction Model (Stage 1)

Before committing to a model for Stage 1 entity extraction, run the smoke test:

```powershell
cd backend
python test_stage1.py
```

Or with a specific model:

```powershell
python test_stage1.py llama3.2:latest
```

The test covers both built-in symbols (USO/BITO/QQQ/SPY, which use a static keyword map and require no LLM call) and custom symbols (NVDA/NOW, which call the LLM once to generate proxy keywords). It prints:

- Which keyword source was used per symbol: `(static)` or `(LLM-generated)`
- The generated keywords for each custom symbol
- How many articles each path caught
- Separate pass/fail for built-in catch rate, custom symbol coverage, and noise filtering

**What to look for:**

| Output | Meaning |
|---|---|
| `Stage 1 keyword filter: 10/13 articles matched` | Working correctly |
| `✓ PASS: Custom symbols (NVDA/NOW) caught at least 1 article` | LLM keyword generation is working |
| `✓ PASS: LLM generated keywords for custom symbols (>1 term each)` | Keywords were successfully generated and cached |
| `✓ PASS: Noise headlines correctly filtered out` | Sports / celebrity articles removed |
| `Stage 1: keyword generation failed for NVDA (...)` | LLM call failed — check Ollama is running and the model is loaded |

**If Stage 1 fails:**

The pipeline degrades gracefully — it falls back to sending all articles to Stage 2 instead of only the relevant ones. Analysis still completes and produces signals, but Stage 2 receives more noise. If keyword generation fails for a custom symbol, the ticker name itself is used as the fallback keyword.

**Model guidance:**

- Stage 1 now calls the LLM only to answer "what keywords appear in [SYMBOL] news?" — a short factual question. Even llama3.2 (3B) handles this reliably.
- The article classification step (reading all headlines) has been removed — Stage 1 is now fast regardless of article count.
- Keyword generation results are cached for the server session. Restarting the server will re-generate keywords for custom symbols on the next run.
- The test only takes a few seconds since it skips RSS ingestion, price fetching, and validation entirely.

## Schema Migration / Upgrading

The backend runs `migrate.py` automatically on every startup. No manual SQL is required.

If you deployed a previous build and are pulling new code, just restart the backend:

```powershell
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The migration script will detect any missing columns and add them with safe defaults. Current migrations cover:

| Column / Table | Table | Default | Added |
|---|---|---|---|
| `price_history` | table | — | OHLCV price history (never cleared by reset-data) |
| `extraction_model` | `app_config` | `''` | Two-stage pipeline |
| `reasoning_model` | `app_config` | `''` | Two-stage pipeline |
| `risk_profile` | `app_config` | `'aggressive'` | Risk profile selector |
| `rss_article_detail_mode` | `app_config` | `'normal'` | Depth mode selector |
| `rss_article_limits` | `app_config` | `{"light":5,"normal":15,"detailed":25}` | Per-depth article caps |
| `snapshot_retention_limit` | `app_config` | `12` | Snapshot pruning |
| `display_timezone` | `app_config` | `''` | Timezone display |
| `custom_symbols` | `app_config` | `[]` | Custom symbol support |
| `underlying_symbol` | `trades` | `NULL` | Execution ticker mapping |
| `conviction_level` | `trades` | `'MEDIUM'` | Signal conviction |
| `holding_period_hours` | `trades` | `4` | Holding horizon |
| `trading_type` | `trades` | `'SWING'` | Trade duration type |
| `trade_closes` | table | — | Realized P&L recording |
| `paper_trades` | table | — | Auto-simulated $100 paper trades (independent of analysis tables) |

To run the migration manually (e.g. to confirm it applied):

```powershell
cd backend
python -m database.migrate
```

## Setup

Note these instructions are intentionally vague - if you don't have the experience (or know how to ask a LLM) to set this up - you should probably not be giving it money to trade stocks. 

### Prerequisites

- Python 3.10+
- Node.js 20.9+
- [Ollama](https://ollama.com) with any compatible local model you want to serve (Qwen 3.5 9b is one tested option)

### 1. Start Ollama

```powershell
ollama pull qwen3.5:9b
ollama serve
```

Optional overrides:
PC:
```powershell
$env:OLLAMA_MODEL = "qwen3.5:9b"
$env:OLLAMA_URL = "http://localhost:11434/api/generate"
```
Mac: Add to ~/.zshrc
```
export OLLAMA_MODEL="qwen3.5:9b"
export OLLAMA_URL="http://localhost:11434/api/generate"
```

If `OLLAMA_MODEL` is unset, the backend will use the selected/requested Ollama model where applicable, and the dashboard runtime panel will prefer the currently running model from Ollama `/api/ps` before falling back to configured or installed models.

### 2. Start the backend (ideally in a venv)

```powershell
cd backend
pip install -r ../requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Optional local admin protection:

```powershell
$env:ADMIN_API_TOKEN = "choose-a-long-random-string"
```

If `ADMIN_API_TOKEN` is set, these routes require the `X-Admin-Token` header:

- `GET /api/v1/config`
- `PUT /api/v1/config`
- `POST /api/v1/trades/{trade_id}/execute`

Admin also controls:

- saved snapshot retention limit for Advanced Mode replay
- display timezone (persisted in the database and mirrored into the browser)
- removing accidental execution records from tracked trades
- tracked symbols, custom test symbols, RSS feed enablement, custom RSS feeds, RSS article depth presets, and prompt overrides

### 3. Start the frontend

```powershell
cd frontend
npm install
- optional Light Web Research prompt grounding
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Notes:

- Restart the dev server once after the first `npm install` so PostCSS picks up Tailwind config
- The frontend targets Next.js 16 and React 19
- If you have stale `node_modules` or `.next` output from older versions, clear them before debugging upgrade issues

If you enabled the admin token above, set it for the frontend server too before `npm run dev`:

```powershell
$env:ADMIN_API_TOKEN = "choose-a-long-random-string"
npm run dev
```

## API Reference

### `POST /api/v1/analyze/stream`

SSE pipeline. Events: `log`, `article`, `result`, `error`.

Example request:

```json
{ "symbols": ["USO", "BITO", "QQQ", "SPY"], "max_posts": 50, "include_backtest": true, "lookback_days": 14 }
```

`result` payloads now include:

- `market_validation` - per-symbol FRED/EIA structured metrics
- `model_inputs.news_context` - compiled text sent into the model
- `model_inputs.validation_context` - validation summary injected into the prompt
- `model_inputs.per_symbol_prompts` - exact final prompt preview for each analyst
- `model_inputs.web_context_by_symbol` - saved per-symbol recent web research summary
- `model_inputs.web_items_by_symbol` - saved structured web research items shown in Advanced Mode

### `GET /api/v1/analysis-snapshots`

Returns recent saved frozen analysis snapshots for Advanced Mode replay.

### `POST /api/v1/analysis-snapshots/{request_id}/rerun`

Replays a frozen saved dataset snapshot. Supports single-model and two-stage pipelines.

Single model:
```json
{ "model_name": "qwen3.5:14b" }
```

Two-stage (Stage 1 extraction + Stage 2 reasoning):
```json
{ "extraction_model": "llama3.2:3b", "reasoning_model": "qwen3:9b" }
```

The rerun result is saved as a new snapshot that also stores the model configuration used, so it can itself be used as a regression baseline.

### `GET /api/v1/ollama/status`

Returns whether Ollama is reachable plus the active served model the backend will use for analysis.

### `GET /api/v1/prices`

```json
{
  "USO":  { "price": 128.25, "change": 7.80, "change_pct": 6.47, "day_low": 121.03, "day_high": 128.88 },
  "BITO": { "price": 10.29, "change": -0.12, "change_pct": -1.15, "day_low": 10.11, "day_high": 10.47 },
  "QQQ":  { "price": 501.12, "change": 2.31, "change_pct": 0.46, "day_low": 497.20, "day_high": 502.05 },
  "SPY":  { "price": 612.40, "change": 1.44, "change_pct": 0.24, "day_low": 609.98, "day_high": 613.11 }
}
```

### `GET /health` and `GET /metrics`

`/health` now returns:

- running model reachability and active model name
- uptime and basic request latency stats
- latest data-pull success or error state
- recent analysis timing and auto-run metadata

`/metrics` remains a lightweight internal summary payload.

## Advanced Mode Snapshot Replay

When Advanced Mode is enabled on the dashboard, the comparison lab can:

- pick the current run or a recent frozen saved snapshot
- see the saved snapshot date, model, and article count directly in the picker
- choose Stage 1 and Stage 2 models independently for the comparison run (or leave Stage 2 blank for single-model)
- use **Rerun original** to replay with the exact model(s) the snapshot was first run with — useful as a regression check after prompt or pipeline changes
- rerun that exact saved dataset without downloading new articles or validation data
- compare signal direction and runtime between model configurations

Comparison results include:

- baseline model label showing `extraction → reasoning` for two-stage snapshots
- per-symbol recommendation diffs where missing-on-one-side still counts as `Different`
- saved reasoning summaries for both the baseline and comparison run on each symbol
- live feed entries for symbol-scoped web research pulls when Light Web Research is enabled


When Light Web Research is enabled, the live feed also shows symbol-scoped web research pulls as expandable feed cards, similar to RSS article events.
The Admin page lets you choose how many frozen snapshots to keep. Older snapshots and their related trade history are pruned automatically after each new save once the configured limit is exceeded.

## Disclaimer

Educational use only. Trading leveraged ETFs carries significant risk. Not financial advice.
