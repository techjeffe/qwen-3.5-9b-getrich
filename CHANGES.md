# Changelog

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
