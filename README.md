# Sentiment Trading Alpha

Geopolitical sentiment pipeline that ingests live RSS headlines, overlays structured FRED and EIA validation data, runs symbol-specific Qwen 3.5 9b specialist analysis, and generates BUY/SELL trade recommendations for USO, BITO, QQQ, and SPY with configurable leverage. Auto-runs every 30 minutes.

Frontend baseline:

- Next.js 16.2.4
- React 19.2

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

Backend:
- FastAPI analysis pipeline and config endpoints
- RSS ingestion, yfinance price pulls, FRED/EIA validation bundle
- Qwen symbol-specialist runs, signal generation, and rolling-window backtest

Model flow:
- RSS items are filtered for relevance before analysis
- Each symbol gets its own specialist prompt and its own narrowed validation context
- `USO` uses `EIA` validation
- `BITO`, `QQQ`, and `SPY` use `FRED` validation

## Features

- Specific trade recommendations such as `BUY QQQ 3x` or `SELL USO 1x`
- Live article feed with expandable cards and model reasoning
- Market price panel for USO, BITO, QQQ, and SPY
- Structured validation layer from official pullable sources
- Advanced Mode for inspecting:
- RSS articles fed to the model
- compiled news context
- FRED/EIA validation context
- exact final per-symbol prompts
- Auto-run every 30 minutes
- 7 RSS sources with fair per-feed distribution
- Keyword relevance filtering before specialist analysis
- Rolling window backtest over 6 months of data

## Validation Sources

- `USO` - `EIA` weekly petroleum pages for refinery utilization, commercial crude stocks, gasoline stocks, and distillate stocks
- `BITO` - `FRED` `M2SL` and `M2REAL`
- `QQQ` - `FRED` `DFII10` for 10-year TIPS real yield
- `SPY` - `FRED` `BAMLH0A0HYM2` and `BAMLC0A0CM` for credit spreads

These validation signals are injected into the symbol specialist prompt as per-symbol context, not one shared generic block.

## Signal Logic

| Bluster Score | Policy Score | Signal | Leverage |
|---------------|--------------|--------|----------|
| < -0.5        | < 0.3        | SELL   | 3x if confidence > 75% |
| Any           | > 0.7        | BUY    | 3x if confidence > 75% |
| Otherwise     | Otherwise    | HOLD   | - |

## Project Structure

```text
qwen-3.5-9b-getrich/
|- backend/
|  |- main.py
|  |- routers/
|  |  `- analysis.py
|  |- schemas/
|  |  `- analysis.py
|  |- database/
|  |  |- engine.py
|  |  `- models.py
|  `- services/
|     |- data_ingestion/
|     |  |- parser.py
|     |  |- scraper.py
|     |  |- market_validation.py
|     |  `- yfinance_client.py
|     |- sentiment/
|     |  |- engine.py
|     |  `- prompts.py
|     `- backtesting/
|        `- optimization.py
|- frontend/
|  |- src/app/page.tsx
|  |- src/app/admin/page.tsx
|  `- src/components/Dashboard/
|- CHANGES.md
`- README.md
```

## Setup

### Prerequisites

- Python 3.10+
- Node.js 20.9+
- [Ollama](https://ollama.com) with Qwen 3.5 9b

### 1. Start Ollama

```powershell
ollama pull qwen3.5:9b
ollama serve
```

Optional overrides:

```powershell
$env:OLLAMA_MODEL = "qwen3.5:9b"
$env:OLLAMA_URL = "http://localhost:11434/api/generate"
```

### 2. Start the backend

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

### 3. Start the frontend

```powershell
cd frontend
npm install
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

## Disclaimer

Educational use only. Trading leveraged ETFs carries significant risk. Not financial advice.
