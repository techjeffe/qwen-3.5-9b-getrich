# Sentiment Trading Alpha

A geopolitical sentiment pipeline that reads the news, reasons about it with a local LLM, and generates trade recommendations for USO, IBIT, QQQ, and SPY — including leveraged execution tickers when confidence is high enough to warrant it. Runs automatically every 30 minutes.

> **This is experimental software. It is not financial advice. Do not trade real money with it.**

Licensed under the [Apache License, Version 2.0](LICENSE).

---

## Want more detail? 
A reference doc covering the API, schema migrations, position sizing math, validation sources, and other advanced topics is in REFERENCE.md.

## How It Works

### The pipeline

1. **Ingestion** — A background worker continuously polls RSS feeds, extracts full article text, and queues rows in a local SQLite database.
2. **Analysis** — Every 30 minutes the main batch job consumes queued articles, runs a two-stage LLM pipeline (entity extraction → financial reasoning), and overlays structured validation data from FRED and EIA.
3. **Signals** — Each symbol gets its own specialist prompt and produces a BUY, SELL, or HOLD recommendation with a conviction level (LOW / MEDIUM / HIGH). A red-team review challenges the initial thesis before the final signal is shown.
4. **Paper trading** — Every signal auto-simulates a volatility-normalized paper trade. Position size is based on 14-day ATR and conviction level, not a flat dollar amount.
5. **Live trading (optional)** — Alpaca brokerage integration mirrors paper trade opens and closes to real orders in real time, with configurable guardrails.

### Signal logic

| Bluster Score | Policy Score | Signal | Leverage |
|---|---|---|---|
| < -0.60 | < 0.40 | SELL | 3x if confidence > 75% |
| Any | ≥ 0.40 | BUY | 3x if confidence > 75% |
| Otherwise | Otherwise | HOLD | — |

Scores are computed in Python from LLM-extracted facts — the model never outputs raw floats. Unconfirmed policy news is discounted before threshold comparison.

### Execution tickers

The analysis reasons about underlying symbols, but recommendations convert to actual broker-tradable tickers when leverage applies:

| Underlying | Bullish | Bearish |
|---|---|---|
| QQQ (3x) | TQQQ | SQQQ |
| SPY (3x) | SPXL | SPXS |
| USO (2x) | UCO | SCO |
| IBIT (2x) | BITU | SBIT |

Bitcoin and oil are capped at 2x leverage.

### Architecture

- **Frontend**: Next.js / React dashboard with a live article feed, signal cards, price panel, health page, trading simulation page, and a snapshot comparison lab.
- **Backend**: FastAPI serving the analysis pipeline, config, paper trading, and optional Alpaca brokerage routes. All state lives in a local SQLite database.
- **LLM**: Ollama running locally. No cloud inference required. Tested models: `qwen3.5:9b`, `qwen3:8b`, `0xroyce/plutus:latest`.
- **Validation data**: EIA petroleum data for USO; FRED M2, TIPS yield, and credit spread data for IBIT, QQQ, and SPY.
- **Technical indicators**: When price history has been pulled, RSI(14), SMA50/200, MACD, Volume Profile, Bollinger Bands %B, ATR(14), and OBV trend are computed locally and injected into each specialist prompt.

---

## Security

This repo is designed for **local single-user use**.

- The backend binds to `127.0.0.1` by default. Do not expose port `8000` publicly without adding auth and rate limiting.
- Sensitive admin routes can be protected with `ADMIN_API_TOKEN` (see setup below).
- API keys for Telegram and Alpaca are stored in the OS keychain via `keyring` — never in the repo.
- Generated databases, caches, and build output are excluded from git.

---

## Setup

> If you don't have the experience (or the willingness to ask an LLM) to get through this setup, you should probably not be giving this thing money to trade stocks.

### Prerequisites

- **Python 3.12** — use exactly 3.12; the Playwright-backed ingestion path is not tested on 3.14+
- **Node.js 20.9+**
- **[Ollama](https://ollama.com)** with at least one compatible model pulled

---

### Windows (PowerShell)

#### 1. Start Ollama

```powershell
ollama pull qwen3.5:9b
ollama serve
```

Optional — override which model the backend uses:

```powershell
$env:OLLAMA_MODEL = "qwen3.5:9b"
$env:OLLAMA_URL   = "http://localhost:11434/api/generate"
```

If `OLLAMA_MODEL` is unset, the backend uses whichever model Ollama is currently serving.

#### 2. Start the backend

Create a virtualenv with Python 3.12, then:

```powershell
pip install -r requirements.txt
playwright install chromium
python run.py
```

`run.py` sets the correct Windows event loop policy before Uvicorn starts (required for Playwright) and defaults hot reload to off. Uvicorn's reload mode breaks Playwright on Windows — leave it off unless you know what you're doing.

Optional environment overrides:

```powershell
$env:ADMIN_API_TOKEN                 = "choose-a-long-random-string"
$env:INGESTION_STARTUP_GRACE_SECONDS = "20"
python run.py
```

If `ADMIN_API_TOKEN` is set, these routes require an `X-Admin-Token` header: `GET /api/v1/config`, `PUT /api/v1/config`, `POST /api/v1/trades/{trade_id}/execute`, and all `/api/v1/alpaca/*` routes.

Telegram and Alpaca credentials are saved from the Admin UI and stored in Windows Credential Manager via `keyring`.

#### 3. Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

If `ADMIN_API_TOKEN` is set on the backend, set it here too:

```powershell
$env:ADMIN_API_TOKEN = "choose-a-long-random-string"
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> Restart the dev server once after the first `npm install` so PostCSS picks up the Tailwind config. If you have stale `node_modules` or `.next` output from a previous install, clear those before debugging anything.

---

### macOS (zsh / bash)

#### 1. Start Ollama

```bash
ollama pull qwen3.5:9b
ollama serve
```

Optional — add to `~/.zshrc` to persist, or set inline:

```bash
export OLLAMA_MODEL="qwen3.5:9b"
export OLLAMA_URL="http://localhost:11434/api/generate"
```

#### 2. Start the backend

Create a virtualenv with Python 3.12, then:

```bash
python3.12 -m pip install -r requirements.txt
playwright install chromium
python3.12 run.py
```

Optional environment overrides:

```bash
export ADMIN_API_TOKEN="choose-a-long-random-string"
export INGESTION_STARTUP_GRACE_SECONDS="20"
python3.12 run.py
```

Same admin token behavior as Windows. Telegram and Alpaca credentials are stored in macOS Keychain Access.

#### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

If `ADMIN_API_TOKEN` is set on the backend:

```bash
export ADMIN_API_TOKEN="choose-a-long-random-string"
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Admin Controls

The Admin page is where you configure everything. Changes persist in the database and survive restarts.

- **Analysis Depth** — Light / Normal / Detailed controls article count per feed and pipeline behavior
- **Model Orchestration** — Stage 1 (extraction) and Stage 2 (reasoning) model selectors; optional Light Web Research toggle
- **Trading Logic** — session hours, base trade amount, entry threshold, stop loss, take profit, re-entry cooldown, trailing stop behavior, and portfolio cap
- **Symbols** — enable/disable default symbols (USO, IBIT, QQQ, SPY); add up to 3 custom symbols
- **RSS Sources** — enable/disable built-in feeds; add up to 3 custom feeds with display labels
- **Prompt Overrides** — per-symbol specialist prompt guidance
- **Scheduling & System** — auto-run cadence, snapshot retention limit, display timezone
- **Telegram** — bot token, private chat ID, authorized user ID stored in OS keychain; enable Remote Snapshots and Remote Control independently
- **Price History** — pull and view per-symbol OHLCV history; used for technical indicator computation
- **Live Trading (Alpaca)** — API key entry, paper/live mode, guardrails (position cap, total exposure cap, daily loss limit, consecutive-loss circuit breaker, PDT protection), and the enable/disable toggle with a "type LIVE to confirm" modal

---

## Live Trading Guardrails

> Live Alpaca execution is **alpha functionality**. It is untested in the real world. Do not use it with money you care about.

When Alpaca keys are configured and live trading is enabled, every paper trade open and close is mirrored to Alpaca in real time. Guardrails include:

- Per-symbol position cap in USD
- Total open exposure cap in USD
- Daily realized loss limit
- Consecutive-loss circuit breaker (auto-disables live trading when hit)
- PDT protection for sub-$25k accounts (can skip same-day closes)
- All order attempts written to an audit log regardless of outcome

---

## Upgrading

The backend runs schema migrations automatically on every startup. If you're pulling new code, just restart:

```powershell
# Windows
python run.py

# macOS
python3.12 run.py
```

No manual SQL required.

---

## Disclaimer

Educational and entertainment use only. Trading leveraged ETFs carries significant risk of loss. This software is not financial advice.
