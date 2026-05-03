# Sentiment Trading Alpha

Geopolitical sentiment pipeline that uses a DB-backed producer/consumer ingestion queue: a background worker polls RSS feeds, stores cleaned article text for later analysis, and the main batch analysis consumes pending queued articles, overlays structured FRED and EIA validation data, runs symbol-specific local LLM specialist analysis, and generates broker-friendly BUY/SELL trade recommendations for USO, IBIT, QQQ, and SPY using actual tradable execution tickers when leverage is applied. Auto-runs every 30 minutes.

Live brokerage execution via Alpaca is now supported alongside the paper simulation. Let me be very clear - this is Alpha--- functionality. Do not trade with real money using this. When Alpaca keys are configured and live trading is enabled from Admin, every paper trade open/close is mirrored to Alpaca in real time with configurable guardrails (per-symbol caps against existing live exposure, PDT protection for sub-$25k accounts, daily loss limits, consecutive-loss circuit breaker, extended-hours handling). All order attempts are written to an audit log regardless of outcome.

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

## Setup

Note these instructions are intentionally vague — if you don't have the experience (or know how to ask an LLM) to set this up, you should probably not be giving it money to trade stocks.

### Prerequisites (both platforms)

- Python 3.12 — use exactly 3.12; the Playwright-backed ingestion path is not tested on 3.14+
- Node.js 20.9+
- [Ollama](https://ollama.com) with at least one compatible model installed (Qwen 3.5:9b, 0xroyce/plutus:latest, qwen3:8b have all been tested and seem to work)

---

### Windows Setup (PowerShell)

#### 1. Start Ollama

```powershell
ollama pull qwen3.5:9b
ollama serve
```

Optional model overrides (set before starting the backend):

```powershell
$env:OLLAMA_MODEL = "qwen3.5:9b"
$env:OLLAMA_URL   = "http://localhost:11434/api/generate"
```

If `OLLAMA_MODEL` is unset, the backend uses whichever model Ollama is currently serving.

#### 2. Start the backend

Create a venv with Python 3.12, then:

```powershell
pip install -r requirements.txt
playwright install chromium
# If you need to install the secure OS keychain dependency by itself:
# pip install keyring
python run.py
```

`run.py` sets the Windows event loop policy before Uvicorn starts, which is required for Playwright browser subprocesses. It also defaults `UVICORN_RELOAD` to off — Uvicorn's reload mode switches back to `_WindowsSelectorEventLoop` and breaks Playwright.

Optional overrides:

```powershell
$env:UVICORN_RELOAD                 = "true"   # enable hot reload (breaks Playwright)
$env:INGESTION_STARTUP_GRACE_SECONDS = "20"    # delay before ingestion worker starts
$env:ADMIN_API_TOKEN                = "choose-a-long-random-string"  # gate admin routes
python run.py
```

If `ADMIN_API_TOKEN` is set, these routes require an `X-Admin-Token` header:
`GET /api/v1/config`, `PUT /api/v1/config`, `POST /api/v1/trades/{trade_id}/execute`, and all `/api/v1/alpaca/*` routes.

Secure secrets (Telegram + Alpaca):

- `keyring` is included in `requirements.txt` and is used to store Telegram and Alpaca API keys in the OS keychain
- On Windows, secrets saved from the Admin UI go to Credential Manager
- On macOS, secrets go to Keychain Access
- If you prefer to install it directly: `pip install keyring`

#### 3. Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Alternative dev modes:

```powershell
npm run dev:turbo    # Turbopack dev server
npm run dev:webpack  # fallback if Turbopack behaves oddly on your machine
```

Notes:

- Frontend API proxy routes now normalize backend loopback traffic to `127.0.0.1:8000` instead of `localhost` to avoid environment-specific loopback/proxy issues
- `frontend/next.config.js` pins `turbopack.root` to the frontend directory so Turbopack resolves the workspace consistently
- If `npm run dev:turbo` still misbehaves on your setup, `npm run dev:webpack` is the supported fallback

If `ADMIN_API_TOKEN` is set on the backend, set it here too before `npm run dev`:

```powershell
$env:ADMIN_API_TOKEN = "choose-a-long-random-string"
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> Restart the dev server once after the first `npm install` so PostCSS picks up Tailwind config. If you have stale `node_modules` or `.next` output from older versions, clear them before debugging.

---

### macOS Setup (zsh / bash)

#### 1. Start Ollama

```bash
ollama pull qwen3.5:9b
ollama serve
```

Optional model overrides — add to `~/.zshrc` to persist, or set inline:

```bash
export OLLAMA_MODEL="qwen3.5:9b"
export OLLAMA_URL="http://localhost:11434/api/generate"
```

If `OLLAMA_MODEL` is unset, the backend uses whichever model Ollama is currently serving.

#### 2. Start the backend

Create a venv with Python 3.12, then:

```bash
python3.12 -m pip install -r requirements.txt
playwright install chromium
# If you need to install the secure OS keychain dependency by itself:
# python3.12 -m pip install keyring
python3.12 run.py
```

`run.py` works on macOS without the Windows event loop workaround and defaults `UVICORN_RELOAD` to on.

Optional overrides:

```bash
export UVICORN_RELOAD="false"              # disable hot reload
export INGESTION_STARTUP_GRACE_SECONDS="20"  # delay before ingestion worker starts
export ADMIN_API_TOKEN="choose-a-long-random-string"  # gate admin routes
python3.12 run.py
```

If `ADMIN_API_TOKEN` is set, these routes require an `X-Admin-Token` header:
`GET /api/v1/config`, `PUT /api/v1/config`, `POST /api/v1/trades/{trade_id}/execute`, and all `/api/v1/alpaca/*` routes.

Secure secrets (Telegram + Alpaca):

- `keyring` is included in `requirements.txt` and is used to store Telegram and Alpaca API keys in the OS keychain
- On macOS, secrets saved from the Admin UI go to Keychain Access
- If you prefer to install it directly: `python3.12 -m pip install keyring`

#### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Alternative dev modes:

```bash
npm run dev:turbo    # Turbopack dev server
npm run dev:webpack  # fallback if Turbopack behaves oddly on your machine
```

Notes:

- Frontend API proxy routes now normalize backend loopback traffic to `127.0.0.1:8000` instead of `localhost` to avoid environment-specific loopback/proxy issues
- `frontend/next.config.js` pins `turbopack.root` to the frontend directory so Turbopack resolves the workspace consistently
- If `npm run dev:turbo` still misbehaves on your setup, `npm run dev:webpack` is the supported fallback

If `ADMIN_API_TOKEN` is set on the backend, set it here too before `npm run dev`:

```bash
export ADMIN_API_TOKEN="choose-a-long-random-string"
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> Restart the dev server once after the first `npm install` so PostCSS picks up Tailwind config. If you have stale `node_modules` or `.next` output from older versions, clear them before debugging.

---

### Admin controls (both platforms)

The following are configurable from the Admin page and persist in the database:

- saved snapshot retention limit
- display timezone (mirrored to the browser)
- tracked symbols, custom symbols, RSS feed enablement, custom feeds, article depth presets, prompt overrides
- custom RSS feed labels are used in pull/analysis status text and live article cards
- removing accidental execution records without deleting the underlying trade recommendation

Remote snapshot delivery can also be configured from Admin:

- enable/disable remote snapshot delivery and tune resend thresholds
- save Telegram `bot token` and `chat id` securely from the UI without storing them in the repo
- secrets are stored in the OS keychain through `keyring` and only masked status is shown back in the UI

Alpaca live trading can be configured from Admin (Live Trading section):

- enter Alpaca API key + secret key and choose paper or live mode; stored in the OS keychain
- test the connection before enabling real orders
- configure guardrails: max position size, max total exposure, daily loss limit, consecutive-loss circuit breaker, order type (market/limit), limit slippage %, allow short selling
- live opens now honor the current same-symbol exposure before submitting a new order, so repeated confirmations do not stack past the configured per-position cap
- sub-$25k live accounts are protected from pattern day trading churn: the broker path can skip fresh opens and same-day closes when Alpaca reports PDT risk
- enable live trading with a "type LIVE to confirm" modal; one-click disable at any time
- the circuit breaker auto-disables live trading if a limit is breached between runs

## Domain Cookies (Paywalled Sites)

Some RSS sources (e.g. New York Times) are in the feed but are paywalled — Trafilatura extracts only the short RSS blurb instead of the full article. If you have a personal subscription you can inject your login cookies so the scraper fetches the full text.

**This is for personal use against your own subscription only.**

### Step 1 — Export cookies from your browser

Install a cookie export extension such as [Cookie-Editor](https://cookie-editor.com/) (Chrome/Firefox/Safari). Navigate to the site while logged in, open the extension, and export as **JSON**. Save the file.

### Step 2 — Drop the file in the backend directory

```bash
# macOS / Linux
cp ~/Downloads/cookies.json backend/domain_cookies.json

# Windows (PowerShell)
Copy-Item "$env:USERPROFILE\Downloads\cookies.json" backend\domain_cookies.json
```

The file is read fresh on every ingestion cycle — no restart needed. The filename is in `.gitignore` so it will never be committed.

### Supported formats

**Array format** (Cookie-Editor / EditThisCookie export — paste as-is):
```json
[
  { "domain": ".nytimes.com", "name": "NYT-S", "value": "…", "path": "/", "secure": true },
  { "domain": ".nytimes.com", "name": "nyt-a",  "value": "…", "path": "/" }
]
```

**Dict format** (manual / multi-site):
```json
{
  "nytimes.com": [
    { "name": "NYT-S", "value": "…" },
    { "name": "nyt-a",  "value": "…" }
  ],
  "wsj.com": [
    { "name": "wsjregion", "value": "…" }
  ]
}
```

Cookies are matched by hostname suffix, so `.nytimes.com` and `nytimes.com` both match `www.nytimes.com`. They are injected into both the initial `requests` fetch and the Playwright fallback render.

### Checking it works

After the next ingestion cycle, query the database:

```bash
sqlite3 trading_system.db \
  "SELECT url, length(full_content) FROM scraped_articles WHERE url LIKE '%nytimes%' ORDER BY id DESC LIMIT 5;"
```

A `length(full_content)` above ~1000 means the full article was extracted. If it stays at a few hundred, the session may have expired — re-export and replace the file.

### Session expiry

NYT sessions typically last 30 days. When articles start showing short lengths again, re-export cookies from your browser and replace `backend/domain_cookies.json`.

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

The test covers both built-in symbols (USO/IBIT/QQQ/SPY, which use a static keyword map and require no LLM call) and custom symbols (NVDA/NOW, which call the LLM once to generate proxy keywords). It prints:

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
python run.py
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
| `scraped_articles` | table | — | DB-backed article queue for producer/consumer ingestion |
| `analysis_lock_request_id` | `app_config` | `''` | Active analysis lease owner |
| `analysis_lock_acquired_at` | `app_config` | `NULL` | Analysis lease start time |
| `analysis_lock_expires_at` | `app_config` | `NULL` | Analysis lease expiry time |
| `remote_snapshot_enabled` | `app_config` | `false` | Enable outbound remote PNG delivery |
| `remote_snapshot_mode` | `app_config` | `'telegram'` | Delivery backend |
| `remote_snapshot_min_pnl_change_usd` | `app_config` | `5.0` | Re-send threshold |
| `remote_snapshot_heartbeat_minutes` | `app_config` | `360` | Re-send heartbeat |
| `remote_snapshot_include_closed_trades` | `app_config` | `false` | Include recent closed positions in image |
| `remote_snapshot_max_recommendations` | `app_config` | `4` | Max recommendations rendered in image |
| `last_remote_snapshot_sent_at` | `app_config` | `NULL` | Last successful outbound snapshot time |
| `last_remote_snapshot_request_id` | `app_config` | `NULL` | Request id tied to last outbound snapshot |
| `trailing_stop_price` | `paper_trades` | `NULL` | Trailing stop level set when HOLD fires on open position |
| `best_price_seen` | `paper_trades` | `NULL` | High/low-water mark used to update trailing stop each run |
| `trail_on_window_expiry` | `app_config` | `true` | Transition to trailing stop instead of flat close when holding window expires |
| `reentry_cooldown_minutes` | `app_config` | `NULL` | Block same-direction re-entry within N minutes of a close (falls back to `logic_config.json` default of 120) |
| `min_same_day_exit_edge_pct` | `app_config` | `NULL` | Minimum profit edge required before closing a same-day winner (falls back to `logic_config.json` default of 0.5%) |
| `alpaca_live_trading_enabled` | `app_config` | `false` | Master kill switch for Alpaca real-money order routing |
| `alpaca_allow_short_selling` | `app_config` | `false` | Allow direct short sells for symbols with no inverse ETF mapping |
| `alpaca_max_position_usd` | `app_config` | `NULL` | Per-trade notional cap in USD (unlimited when NULL) |
| `alpaca_max_total_exposure_usd` | `app_config` | `NULL` | Sum-of-open-positions circuit breaker in USD |
| `alpaca_order_type` | `app_config` | `'market'` | `market` or `limit` |
| `alpaca_limit_slippage_pct` | `app_config` | `0.002` | Slippage added to limit price (0.002 = 0.2%) |
| `alpaca_daily_loss_limit_usd` | `app_config` | `NULL` | Daily realized loss circuit breaker |
| `alpaca_max_consecutive_losses` | `app_config` | `3` | Consecutive losing trades before live trading is auto-disabled |
| `alpaca_orders` | table | — | Full audit log of every Alpaca order attempt (success and error) |

To run the migration manually (e.g. to confirm it applied):

```powershell
cd backend
python -m database.migrate
```

## Architecture

Frontend:
- Next.js dashboard with live feed, signal cards, charts, and Advanced Mode
- SSE stream for analysis progress and article events
- Dedicated `/health` page for runtime, model, and data-pull visibility
- Dedicated `/trading` page for paper trading simulation with equity curve and position tables

Backend:
- FastAPI analysis pipeline and config endpoints
- DB-backed RSS/article ingestion queue, yfinance price pulls, FRED/EIA validation bundle
- Local Ollama-served symbol-specialist runs, signal generation, and paper-trade persistence
- Frozen analysis snapshot persistence for model-to-model replay in Advanced Mode
- Persistent admin configuration stored in the local database so saved symbols, feeds, prompt overrides, and timezone survive rebuilds/restarts
- Paper trading hook wired into every analysis save — simulates a volatility-normalized position size per signal, manages position lifecycle, stores results in a dedicated `paper_trades` table independent of all other analysis tables
- Alpaca brokerage integration — every paper trade open/close is optionally mirrored to Alpaca in real time; extended-hours orders use qty+limit automatically; same-symbol live exposure is checked before new opens; PDT-risk opens/closes can be skipped on sub-$25k accounts; a circuit breaker auto-disables live trading when exposure/loss limits are hit; all order outcomes written to `alpaca_orders` for audit
- Analysis lease/lock coordination in `app_config` so scheduled runs and urgent off-cycle runs do not process the same queued articles in parallel

Model flow:
- A background ingestion worker polls RSS feeds, runs a Stage 0 relevance filter, extracts full article text, and stores pending rows in `scraped_articles`
- The main batch `/analyze` path no longer scrapes the web inline â€” it consumes queued `processed = false` articles from the database
- High-impact macro headlines can trigger a Fast Lane off-cycle analysis run for the affected symbols
- Each symbol gets its own specialist prompt and its own narrowed validation context
- `USO` uses `EIA` validation
- `IBIT`, `QQQ`, and `SPY` use `FRED` validation
- The dashboard polls Ollama and shows the active served model instead of assuming a fixed model name
- Saved analysis snapshots can be replayed against a different served model without re-downloading the articles, price context, or validation context
- A configurable two-stage pipeline separates entity extraction (Stage 1) from financial reasoning (Stage 2), optionally using different models for each stage
- Stage 1 uses keyword matching to filter articles: built-in symbols (USO/IBIT/QQQ/SPY) use a static proxy term map; custom symbols (e.g. NVDA, NOW) call the LLM once to generate 15-20 proxy keywords, cache them for the session, then use pure keyword matching — no per-article LLM calls
- Stage 2 receives only the relevant articles plus the Stage 1 proxy-term context and an exposure quality hint (DIRECT / INDIRECT / BROAD) derived from the keyword match ratio, so specialists calibrate confidence when articles matched weakly
- The specialist JSON schema appears before the news text in each prompt so the model frames its reading with the full output contract first; cross-symbol prices and basket-level signal rules are excluded from the specialist path
- Pipeline depth is set per-run: Light uses one model for both stages, Normal uses two-stage only when both models are explicitly configured, Detailed always runs the full two-stage pipeline
- When price history has been pulled, 7 technical indicators (RSI, SMA50/200, MACD, Volume Profile, Bollinger Bands %B, ATR, OBV trend) are computed from stored OHLCV data and injected into each specialist prompt alongside the validation context
- After the initial per-symbol signal is generated, a second red-team review challenges the thesis against recent news, technicals, source concentration, and cross-asset portfolio risk
- The primary displayed trade recommendation is now the final consensus signal after the blue-team proposal and red-team challenge are reconciled; the original signal is retained for audit/debug views
- On first startup, the ingestion scheduler waits briefly and also defers while an analysis lease is active, reducing SQLite write contention during initial boot

## Features

- Broker-ready trade recommendations 
- Consensus trade recommendations now reflect both the initial model thesis and a red-team challenge pass before the final signal is shown
- Recommendation tooltips so users can see that inverse/leveraged tickers are proxies for bullish or bearish views on the underlying
- Live article feed with expandable cards and model reasoning
- Market price panel for active tracked underlyings plus their execution tickers, so symbols like `SQQQ`, `SPXS`, `SBIT`, and `SCO` show up when relevant
- Structured validation layer from official pullable sources
- Optional light web research layer that pulls a small number of recent trusted news items per active symbol and injects them into the specialist prompt
- Runtime model status so the UI reflects whichever model Ollama is currently serving; shows `Stage 1 → Stage 2` when multi-model is active
- Health page with running model, recent runtime, request stats, and latest data-pull status
- History tab — pull-to-pull signal diff showing how recommendations change across runs, expandable per-symbol details, available without needing a current run; history labels show both extraction and reasoning model names when the two-stage pipeline is used
- **Trading tab** (link in nav) — dedicated `/trading` page showing the paper trading simulation with equity curve, open positions (live P&L), and full closed trade history
- Compare tab — replay any frozen snapshot with Stage 1 and Stage 2 model selectors; "Rerun original" button re-runs with the exact models the snapshot was originally run with
- Comparison results now show clearer baseline vs comparison labeling plus per-symbol reasoning summaries to explain disagreements
- Compare can also load two saved historical runs directly and show why a symbol changed, including recommendation flips, score deltas, confidence moves, and leverage-threshold changes
- P&L tracking with live prices, forward-horizon snapshots (1h / 4h / 1d / 3d / 1w), and realized close price recording
- **Paper trading simulation** — every analysis run auto-simulates a volatility-normalized paper trade per signal during extended market hours (4am–8pm ET); position size scales with ATR and conviction rather than a flat notional; position lifecycle mirrors what a real trader following every signal would do; results visible on the `/trading` page with equity curve, open positions with live P&L, and closed trade history
- **Volatility-normalized position sizing** — each trade is sized by ATR rather than a flat notional: calmer assets (SPY) get a bigger slice, volatile ones (BITO) get a smaller one; conviction level scales the result (HIGH=1.5×, MEDIUM=1.0×, LOW=0.5×); the floor is 0.25× and ceiling is 5× the configured base; flows through to Alpaca notional automatically; see the **Position Sizing** section below for a full example table; configurable in `logic_config.json` under `vol_sizing`
- **Sentiment half-life decay** — directional scores are exponentially decayed based on hours since the previous analysis ran (`decay = max(floor, 0.5^(age/half_life))`); per-symbol half-lives: SPY/QQQ=2h, USO=4h, BITO/IBIT=6h; prevents stale news from sustaining hysteresis entries after the market has priced it in; configurable in `logic_config.json` under `signal_decay`
- **ATR-scaled leverage caps** — leverage assigned to a new paper trade is capped by the symbol's 14-day ATR %; high volatility forces 1x regardless of confidence score; thresholds configurable in `logic_config.json`
- **Trailing stop on HOLD** — a HOLD signal on an open position sets a tightened trailing stop instead of force-closing; stop tracks `best_price_seen` and closes only if price crosses; thesis re-confirmation clears the trailing stop
- **Trail on window expiry** — when a conviction holding window expires, the position transitions to trailing stop mode instead of closing flat; configurable per-run via Admin (`trail_on_window_expiry`)
- **Re-entry cooldown** — same-direction re-entry in the same symbol is blocked for a configurable window (default 120 minutes) after a close, preventing same-direction churn on choppy signals; configurable in Admin (`reentry_cooldown_minutes`)
- **Minimum same-day exit edge** — same-day winners below a configurable profit threshold (default 0.5%) are held instead of being closed on a flip, ticker/leverage change, or no-recommendation churn; configurable in Admin (`min_same_day_exit_edge_pct`)
- **Alpaca live trading** — paper trade lifecycle events (open, close, window-expired close) are optionally forwarded to Alpaca as real orders; paper and live execution run in parallel so the paper record is always preserved; close orders are guarded against sending if no successful open is on record (prevents stray orders when an open was skipped or rejected)
- **Alpaca order log** — the `/trading` page shows a live order log beneath the paper tables, with side badges, fill price, mode (PAPER/LIVE), and status; the header badge and title change to reflect when live trading is active
- **Alpaca guardrails** — configurable per-position cap, total exposure cap, daily loss limit, consecutive-loss circuit breaker, order type (market/limit), and limit slippage %; new opens respect existing live same-symbol exposure, PDT-risk orders can be skipped on sub-$25k accounts, and any breach auto-disables live trading and records the reason
- **Trading page PDT banner** — the live trading view now surfaces equity, `daytrade_count`, PDT flag status, and day-trading buying power with a clear/warn/blocked state badge
- **Conviction window reset** — when a re-run confirms the same direction, the holding window resets to a full window; same/upgraded trade type resets fully; downgraded type shrinks proportionally; capped by `max_holding_minutes` per type
- **Corrected SHORT bias** — three compounding factors that systematically over-produced SHORT signals have been addressed: `unconfirmed_bluster_penalty` lowered, `unconfirmed_policy_multiplier` raised, and SHORT score changed to a weighted blend (40% bluster / 60% policy) so pure rhetoric no longer produces full-magnitude SHORT signals
- **Dynamic materiality gate** — thesis-flip guard uses a rolling per-symbol article baseline (last 20 runs, mean ± 1 stddev) instead of a fixed count; falls back to fixed threshold until 5 runs of history exist
- **Price history auto-pull** — adding a custom symbol in Admin triggers a background price history pull automatically; history is retained even after the symbol is removed
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
- 7 built-in RSS sources by default: Trump Truth Social, BBC World, Marketwatch, NPR World, Calculated Risk, Reuters Business, and New York Times Business
- Up to 3 custom RSS sources with saved display labels shown in pull/analysis status and live article cards
- Keyword relevance filtering before specialist analysis

## Admin Controls

The Admin page is organized around the things users change most often first.

1. **Analysis Depth** — Light / Normal / Detailed selector controls both article count per feed and pipeline behavior
2. **Model Orchestration** — immediately below the depth selector; dropdowns change based on selected depth:
   - Light: single "Analysis Model" (same model for Stage 1 and Stage 2)
   - Normal: optional Stage 1 and Stage 2 selectors; single-stage if only one is set
   - Detailed: both models required; amber warning shown until both are selected
3. **Trading Logic** — session hours toggle (allow pre-market / after-hours paper trading), and threshold overrides for paper trade amount, entry threshold, stop loss, take profit, the materiality gate, and minimum same-day exit edge; trail-on-expiry toggle and re-entry cooldown minutes; leave fields blank to use `logic_config.json` defaults; volatility-normalized sizing and signal decay are configured directly in `logic_config.json` under `vol_sizing` and `signal_decay`
4. **Symbols** — enable/disable default symbols, add up to 3 custom symbols
5. **RSS Sources** — enable/disable the built-in feeds, add up to 3 custom feeds, and set a display label for each custom feed
6. **Prompt Overrides** — per-symbol specialist prompt guidance
7. **Scheduling & System** — auto-run cadence, snapshot retention, display timezone
8. **Remote Snapshot Delivery** — enable outbound PNG delivery after qualifying runs; configure Telegram bot token and chat ID securely (stored in the OS keychain, never in the repo); tune resend interval, P&L threshold, and heartbeat; **Send Snapshot Now** button bypasses all gates and immediately queues the most recent run for delivery
9. **Price History** — pull and status panel: per-symbol row count, date range, ready/needs-pull indicator, and a pull trigger button; the `price_history` table is independent of the analysis database and is never cleared by reset-data
10. **Live Trading — Alpaca** — API key entry (stored in OS keychain), paper/live mode selector, Test Connection button with account equity display, guardrail fields, PDT-aware live execution protections, and an Enable/Disable Live toggle with a "type LIVE to confirm" modal

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
- Stage 1 calls the LLM once to generate proxy keywords for any symbol not in the built-in map and caches the result for the session
- Only built-in symbols (`USO`, `IBIT`, `QQQ`, `SPY`) have the richer FRED/EIA validation bundles
- Technical indicators are injected when price history is available; if the `price_history` table is empty the analysis prompt is unchanged and analysis completes normally
- When Light Web Research is enabled, the model receives a compact recent-news block per active symbol from a small trusted-source allowlist rather than scraping a huge feed universe

## Validation Sources

- `USO` - `EIA` weekly petroleum pages for refinery utilization, commercial crude stocks, gasoline stocks, and distillate stocks
- `IBIT` - `FRED` `M2SL` and `M2REAL`
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

## Position Sizing

The `paper_trade_amount` setting (default $100) is a **base amount, not a fixed trade size**. Each trade is sized by volatility: calmer assets get a bigger slice, wilder assets get a smaller one. With a $100 base the floor is **$25** and the ceiling is **$500** per trade.

**Formula:** `trade size = (1% × base_amount) / ATR_14d_pct`, then scaled by conviction level.

Typical sizes at $100 base using recent ATR values:

| Symbol | Typical ATR | LOW conviction | MEDIUM conviction | HIGH conviction |
|--------|------------|---------------|-------------------|-----------------|
| SPY    | ~0.8%      | $62.50        | $125.00           | $187.50         |
| QQQ    | ~1.2%      | $41.67        | $83.33            | $125.00         |
| USO    | ~2.0%      | $25.00        | $50.00            | $75.00          |
| BITO/IBIT | ~3.5%  | $25.00        | $28.57            | $42.86          |

**What this means for a $1,000 account:**

- A single HIGH-conviction SPY trade uses ~$187 — about 19% of the account
- All four symbols firing at HIGH conviction simultaneously would deploy ~$430 total — well within a $1,000 account
- All four at MEDIUM conviction would deploy ~$287 total
- The floor ($25) and ceiling ($500) are hard clamps, so one trade can never be less than $25 or more than $500 regardless of ATR

**If price history has not been pulled** for a symbol its ATR is unknown and the trade falls back to the conviction-scaled base: LOW=$50, MEDIUM=$100, HIGH=$150.

**Portfolio Cap** — set a **Portfolio Cap ($)** in Admin › Trading Logic to hard-limit total open exposure across all symbols at once. If you connect a $5,000 account but only want to risk $1,000, set the cap to 1000. When the cap is reached, new trades are skipped; when an existing position closes, the freed exposure can be reused. If a single computed trade size would exceed the remaining room, it is scaled down to fit rather than skipped entirely. Leave the field blank for no cap.

**If using Alpaca live trading**, set `alpaca_max_total_exposure_usd` in Admin to a comfortable fraction of your account (e.g. $400 for a $1,000 account) as a hard backstop — the circuit breaker will skip new opens once that limit is reached.

## Signal Logic

| Bluster Score | Policy Score | Signal | Leverage |
|---------------|--------------|--------|----------|
| < -0.60       | < 0.40       | SELL   | 3x if confidence > 75% |
| Any           | ≥ 0.40       | BUY    | 3x if confidence > 75% |
| Otherwise     | Otherwise    | HOLD   | - |

Bluster and policy scores are computed entirely in Python from LLM-extracted facts (phrase counts, event type, confirmed status, exposure type). The LLM does not output raw floats. SHORT requires both a bluster threshold breach AND insufficient policy backing. Unconfirmed policy news uses a 0.65× multiplier before comparing to the threshold.

## Execution Mapping

The analysis still reasons about the underlying symbols `USO`, `IBIT`, `QQQ`, and `SPY`, but the recommendation layer now converts leverage into actual broker-tradable execution tickers. Legacy `BITO` inputs are normalized to `IBIT` for future runs so old history remains readable while new Bitcoin trades use the new default.

- `QQQ` bullish `3x` -> `BUY TQQQ`
- `QQQ` bearish `3x` -> `BUY SQQQ`
- `SPY` bullish `3x` -> `BUY SPXL`
- `SPY` bearish `3x` -> `BUY SPXS`
- `USO` bullish `2x` -> `BUY UCO`
- `USO` bearish `2x` -> `BUY SCO`
- `IBIT` bullish `2x` -> `BUY BITU`
- `IBIT` bearish `2x` -> `BUY SBIT`

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
|  |  |- config.py            # includes /admin/price-history/status and /pull
|  |  `- alpaca.py            # Alpaca status, secrets, test-connection, orders, settings
|  |- schemas/
|  |  `- analysis.py
|  |- database/
|  |  |- engine.py
|  |  |- models.py            # includes PriceHistory, AlpacaOrder tables
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
|     |- alpaca_broker.py        # AlpacaBroker, maybe_execute_alpaca_order, circuit breakers
|     |- secret_store.py         # OS keychain helpers for Telegram and Alpaca secrets
|     |- runtime_health.py
|     |- trading_instruments.py
|     `- paper_trading.py        # Trading simulation, position lifecycle, get_summary
|- frontend/
|  |- src/app/page.tsx
|  |- src/app/admin/page.tsx     # includes Price History and Live Trading sections
|  |- src/app/health/
|  |- src/app/trading/           # paper trading + Alpaca order log page
|  |- src/lib/
|  `- src/app/api/
|     |- paper-trading/route.ts
|     |- admin/price-history/pull/route.ts
|     |- admin/price-history/status/route.ts
|     `- alpaca/                 # proxy routes for all /api/v1/alpaca/* endpoints
|        |- status/route.ts
|        |- secrets/route.ts
|        |- test-connection/route.ts
|        |- account/route.ts
|        |- positions/route.ts
|        |- orders/route.ts
|        `- settings/route.ts
|- RELEASENOTES.md
`- README.md
```

## API Reference

### `POST /api/v1/analyze/stream`

SSE pipeline. Events: `log`, `article`, `result`, `error`.

Example request:

```json
{ "symbols": ["USO", "IBIT", "QQQ", "SPY"], "max_posts": 50, "lookback_days": 14 }
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
