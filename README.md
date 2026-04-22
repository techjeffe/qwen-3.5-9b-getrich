# Sentiment Trading Alpha

Geopolitical sentiment pipeline that ingests live RSS headlines, runs them through Qwen 3.5 9b, and generates specific BUY/SELL trade recommendations for USO, BITO, QQQ, and SPY with configurable leverage. Auto-runs every 30 minutes.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                      │
│  Sidebar: Engine Config · Market Prices · Signal Logic      │
│  Main: BUY/SELL Recommendations · Article Feed · Charts     │
└─────────────────────────────────────────────────────────────┘
                           ↕ SSE + REST
┌─────────────────────────────────────────────────────────────┐
│                   Backend (FastAPI)                         │
│  POST /api/v1/analyze/stream   — SSE pipeline               │
│  POST /api/v1/analyze          — batch                      │
│  GET  /api/v1/prices           — live quotes                │
│  GET  /health  GET /metrics                                  │
└─────────────────────────────────────────────────────────────┘
                           ↕ Async pipeline
┌─────────────────────────────────────────────────────────────┐
│                  Data Ingestion                             │
│  RSS Parser (7 feeds incl. Trump Truth Social)              │
│  yfinance fast_info — USO · BITO · QQQ · SPY               │
└─────────────────────────────────────────────────────────────┘
                           ↕ One LLM call
┌─────────────────────────────────────────────────────────────┐
│         Ollama — Qwen 3.5 9b  (think: false)               │
│  Bluster score (−1→+1) · Policy score (0→1)                │
│  Trading signal + per-symbol recommendations               │
└─────────────────────────────────────────────────────────────┘
                           ↕ Signal + backtest
┌─────────────────────────────────────────────────────────────┐
│             Rolling Window Optimizer + SQLite               │
└─────────────────────────────────────────────────────────────┘
```

## Features

- **Specific trade recommendations** — `BUY QQQ 3x`, `SELL USO 1x`, etc., with confidence-based leverage
- **Live article feed** — expandable cards show full text + model reasoning per article
- **Market price panel** — live USO, BITO, QQQ, SPY quotes with % change; refreshes every 60 s
- **Auto-run every 30 minutes** — countdown timer in the sidebar; triggers automatically
- **7 RSS sources** — Trump Truth Social, BBC World, Al Jazeera, NYT World, MarketWatch, NPR, Guardian — each gets a fair article cap so no single source starves the others
- **Full article text in sentiment** — both headline and body fed to the LLM; Trump Truth full post text included
- **One LLM call per run** — result shared across all 4 symbols (fast, ~5 s on 9b model)
- **Rolling window backtest** — 14-day lookback, 6 months of price history

## Signal Logic

| Bluster Score | Policy Score | Signal | Leverage |
|---------------|--------------|--------|----------|
| < −0.5        | < 0.3        | SELL   | 3× if confidence > 75% |
| Any           | > 0.7        | BUY    | 3× if confidence > 75% |
| Otherwise     | Otherwise    | HOLD   | — |

## Project Structure

```
qwen-3.5-9b-getrich/
├── backend/
│   ├── main.py                          # FastAPI app
│   ├── routers/
│   │   └── analysis.py                  # /analyze/stream · /analyze · /prices
│   ├── schemas/
│   │   └── analysis.py                  # Pydantic models (TradingSignal.recommendations)
│   ├── database/
│   │   ├── engine.py                    # SQLAlchemy session
│   │   └── models.py                    # Post, AnalysisResult
│   └── services/
│       ├── data_ingestion/
│       │   ├── parser.py                # feedparser RSS (7 feeds)
│       │   ├── scraper.py               # Truth Social stub (replaced by RSS feed)
│       │   └── yfinance_client.py       # fast_info quotes + historical data
│       ├── sentiment/
│       │   ├── engine.py                # Ollama call (think:false, 2048 tokens)
│       │   └── prompts.py               # Bluster + policy prompts
│       └── backtesting/
│           └── optimization.py          # Rolling window optimizer
├── frontend/
│   ├── postcss.config.js                # Required for Tailwind CSS
│   ├── tailwind.config.js
│   └── src/
│       ├── app/
│       │   ├── page.tsx                 # Main dashboard (sidebar + article feed + results)
│       │   ├── layout.tsx
│       │   ├── globals.css
│       │   └── api/
│       │       ├── analyze/stream/route.ts   # SSE proxy
│       │       └── prices/route.ts           # Price proxy
│       └── components/Dashboard/
│           ├── SentimentTicker.tsx      # Animated bluster/policy bar charts
│           └── RollingWindowChart.tsx   # Backtest recharts bar chart
├── CHANGES.md
├── test-qwen.md                         # Requirements log
└── README.md
```

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.com) with Qwen 3.5 9b

### 1 — Start Ollama

```powershell
ollama pull qwen3.5:9b
ollama serve
```

> Override model: `$env:OLLAMA_MODEL = "qwen3.5:9b"`  
> Override URL: `$env:OLLAMA_URL = "http://localhost:11434/api/generate"`

### 2 — Backend

```powershell
cd backend
pip install -r ../requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3 — Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** After the first `npm install`, you must restart the dev server once so PostCSS picks up `postcss.config.js` and compiles Tailwind.

## API Reference

### `POST /api/v1/analyze/stream`

SSE pipeline. Events: `log`, `article`, `result`, `error`.

```json
{ "symbols": ["USO", "BITO", "QQQ", "SPY"], "max_posts": 50, "include_backtest": true, "lookback_days": 14 }
```

### `GET /api/v1/prices`

```json
{
  "USO":  { "price": 128.25, "change": 7.80, "change_pct": 6.47, "day_low": 121.03, "day_high": 128.88 },
  "BITO": { "price": 10.29,  "change": -0.12, "change_pct": -1.15, ... },
  "QQQ":  { ... },
  "SPY":  { ... }
}
```

### `GET /health` · `GET /metrics`

## Disclaimer

Educational use only. Trading leveraged ETFs carries significant risk. Not financial advice.
