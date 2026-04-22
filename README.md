# 3x Leveraged Sentiment-Driven Trading System

A sentiment-driven trading system that analyzes geopolitical and social media data to generate trading signals for 3x leveraged ETFs (USO, BITO).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Single Button│  │Sentiment Ticker│ │ Rolling Window Chart │  │
│  │   Dashboard  │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP/REST
┌─────────────────────────────────────────────────────────────────┐
│                      Backend API (FastAPI)                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              /api/v1/analyze (Main Endpoint)             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕ Async Pipeline
┌─────────────────────────────────────────────────────────────────┐
│                    Data Ingestion Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Playwright   │  │ BeautifulSoup│  │ yfinance Client      │  │
│  │ Scraper      │  │ RSS Parser   │  │ (SPY/USO/BITO)       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕ Sentiment Analysis
┌─────────────────────────────────────────────────────────────────┐
│                    Sentiment Engine (Ollama)                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Llama-3-70b: Market Bluster vs Policy Change Detection  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕ Signal Generation
┌─────────────────────────────────────────────────────────────────┐
│                    Backtesting Engine (VectorBT)                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Rolling Window Optimization (14-day lookback)            │  │
│  │ Walk-forward analysis with performance metrics           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕ Storage
┌─────────────────────────────────────────────────────────────────┐
│                    Database (SQLite)                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Analysis Results, Sentiment Data, Trading Signals        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **Real-time Sentiment Analysis**: Uses Ollama Llama-3-70b to detect market bluster vs genuine policy changes
- **Multi-Source Data Ingestion**: Scrapes Truth Social and RSS feeds for geopolitical news
- **Rolling Window Backtesting**: VectorBT-powered walk-forward optimization with 14-day lookback
- **Single-Button Execution**: Simplified dashboard for rapid trade triggering
- **Risk Management**: Built-in stop-loss (2%) and take-profit (3%) calculations
- **Performance Tracking**: Sharpe ratio, max drawdown, win rate metrics

## Project Structure

```
qwen-booking-app/
├── backend/
│   ├── __init__.py
│   ├── main.py                    # FastAPI application entry point
│   ├── routers/
│   │   ├── __init__.py
│   │   └── analysis.py            # /analyze endpoint implementation
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── analysis.py            # Pydantic models for requests/responses
│   │   ├── sentiment.py           # Sentiment score models
│   │   └── trading.py             # Trading signal models
│   ├── database/
│   │   ├── __init__.py
│   │   ├── engine.py              # SQLAlchemy session management
│   │   └── models.py              # Database models (AnalysisResult)
│   └── services/
│       ├── data_ingestion/
│       │   ├── __init__.py
│       │   ├── scraper.py         # Playwright Truth Social scraper
│       │   ├── parser.py          # BeautifulSoup RSS feed parser
│       │   └── yfinance_client.py # yfinance price data client
│       ├── sentiment/
│       │   ├── __init__.py
│       │   ├── engine.py          # Ollama Llama-3-70b sentiment analysis
│       │   └── prompts.py         # Geopolitical risk detection prompts
│       └── backtesting/
│           ├── __init__.py
│           ├── vectorbt_engine.py # VectorBT integration
│           └── optimization.py    # Rolling window optimization
├── frontend/
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx           # Main dashboard page
│   │   │   └── api/
│   │   │       └── analyze/
│   │   │           └── route.ts    # API proxy to backend
│   │   └── components/
│   │       └── Dashboard/
│   │           ├── SingleButton.tsx      # Main action button
│   │           ├── SentimentTicker.tsx   # Real-time sentiment display
│   │           ├── RiskGauge.tsx         # Risk assessment visualization
│   │           └── RollingWindowChart.tsx # Backtest results chart
├── requirements.txt               # Python dependencies
└── README.md                      # This file
```

## Setup Instructions

### Prerequisites

- Python 3.10+
- Node.js 18+
- Ollama with Llama-3-70b model installed
- Playwright browsers (for scraping)

### Backend Setup

1. **Install Python dependencies:**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Install Playwright browsers:**
   ```bash
   playwright install
   ```

3. **Start Ollama and pull Llama-3-70b:**
   ```bash
   ollama pull llama3
   ```

4. **Run the backend server:**
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

### Frontend Setup

1. **Install Node dependencies:**
   ```bash
   cd frontend
   npm install
   ```

2. **Set environment variable (optional):**
   ```bash
   export NEXT_PUBLIC_API_URL=http://localhost:8000
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

### Database Setup

The system uses SQLite with automatic schema initialization on startup. No additional setup required.

## API Documentation

### POST /api/v1/analyze

Trigger the complete analysis pipeline.

**Request Body:**
```json
{
  "symbols": ["USO", "BITO"],
  "max_posts": 50,
  "include_backtest": true,
  "lookback_days": 14
}
```

**Response:**
```json
{
  "request_id": "abc123",
  "timestamp": "2024-01-15T10:30:00Z",
  "symbols_analyzed": ["USO", "BITO"],
  "posts_scraped": 47,
  "sentiment_scores": {
    "USO": {
      "market_bluster": -0.65,
      "policy_change": 0.25,
      "confidence": 0.82,
      "reasoning": "Strong bearish sentiment from Truth Social posts"
    }
  },
  "aggregated_sentiment": {
    "market_bluster": -0.65,
    "policy_change": 0.25,
    "confidence": 0.82
  },
  "trading_signal": {
    "signal_type": "SHORT",
    "confidence_score": 0.78,
    "entry_symbol": "USO",
    "stop_loss_pct": 2.0,
    "take_profit_pct": 3.0,
    "urgency": "HIGH"
  },
  "backtest_results": {
    "total_return": 15.5,
    "sharpe_ratio": 1.8,
    "max_drawdown": -8.2,
    "win_rate": 62.5,
    "lookback_days": 14,
    "walk_forward_steps": 98
  },
  "processing_time_ms": 3240,
  "status": "SUCCESS"
}
```

## Trading Signal Logic

The system generates trading signals based on sentiment analysis:

| Bluster Score | Policy Score | Signal | Urgency |
|---------------|--------------|--------|---------|
| < -0.5        | < 0.3        | SHORT  | HIGH if abs(bluster) > 0.7 |
| > 0.7         | Any          | LONG   | HIGH if policy > 0.8 |
| Otherwise     | Any          | HOLD   | LOW     |

## Risk Management

- **Leverage**: 3x (configurable in backtesting)
- **Stop Loss**: 2% per trade
- **Take Profit**: 3% per trade
- **Position Sizing**: Manual calculation based on account equity

## Performance Metrics

The rolling window backtest calculates:

- **Total Return**: Cumulative return across all trades
- **Annualized Return**: Yearly-compounded return rate
- **Sharpe Ratio**: Risk-adjusted returns (risk-free rate = 2%)
- **Max Drawdown**: Largest peak-to-trough decline
- **Win Rate**: Percentage of profitable trades

## Disclaimer

⚠️ **WARNING**: This system is for educational purposes only. Trading leveraged ETFs involves significant risk and may not be suitable for all investors. Past performance does not guarantee future results. Always conduct your own research and consult with a financial advisor before making trading decisions.

## License

MIT License - See LICENSE file for details.
