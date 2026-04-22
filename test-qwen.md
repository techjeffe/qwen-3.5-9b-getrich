# Test & Requirements Log

All user asks, requirements, and acceptance criteria captured from the development session.

---

## 1 — Backend must start without import errors

**Ask:** Fix all import errors preventing `uvicorn main:app` from loading.

**Criteria:**
- `uvicorn main:app --host 0.0.0.0 --port 8000 --reload` runs from `backend/` with no `ImportError` or `AttributeError`
- All routes registered: `GET /health`, `GET /metrics`, `POST /api/v1/analyze`, `POST /api/v1/analyze/stream`

**Root causes fixed:**
- Relative imports (`from ..schemas`) replaced with absolute imports — uvicorn adds `backend/` to `sys.path`, making `..` invalid
- `Base = type("Base", ...)` replaced with `declarative_base()` — was not a real SQLAlchemy base
- `get_db_engine` in `__all__` replaced with `engine` — symbol didn't exist
- `db: Session = None` → `db: Session = Depends(get_db)` — FastAPI dependency injection was broken
- `from routers import analysis_router` → `from routers import router as analysis_router` — wrong export name
- Duplicate root `/analyze` endpoint (just `pass`) removed — caused Pydantic validation failure on every call
- `self.MIN_TRADES` → `self.DEFAULT_MIN_TRADES` — undefined attribute
- Duplicate `RollingWindowOptimizer` class in `vectorbt_engine.py` removed
- `services/__init__.py` created — package was not importable

---

## 2 — Frontend must connect to the correct API endpoint

**Ask:** Fix "API error: Not Found" on button press.

**Criteria:**
- Clicking "Analyze Market" reaches the backend without a 404
- Backend endpoint is `POST /api/v1/analyze` (prefix set in `main.py`)

**Root cause fixed:**
- Next.js proxy was calling `${API_URL}/analyze` — missing `/api/v1/` prefix

---

## 3 — Frontend must render with Tailwind styles

**Ask:** App shows unstyled HTML / missing layout.

**Criteria:**
- `src/app/layout.tsx` exists with a proper root layout
- `src/app/globals.css` imports `@tailwind base/components/utilities`
- Dark theme renders correctly

**Root causes fixed:**
- `layout.tsx` was absent; Next.js auto-generated a placeholder with wrong title and no CSS import
- `globals.css` was missing entirely

---

## 4 — PowerShell environment variable syntax

**Ask:** `export NEXT_PUBLIC_API_URL=...` fails in PowerShell.

**Criteria:**
- README and any instructions use PowerShell syntax

**Fix:** `$env:NEXT_PUBLIC_API_URL = "http://localhost:8000"`

---

## 5 — Analysis must return real non-zero scores

**Ask:** All sentiment scores show 0 or 0% — the analysis is not doing anything.

**Criteria:**
- After a successful run with Ollama running, bluster and policy scores are non-zero
- USO and BITO both get scored (not just BITO)

**Root causes fixed:**
- `_ingest_data` returned `int` (count) but `_analyze_sentiment` tried `for post in posts` on it → `TypeError` → 500
- All posts were assigned only to `"BITO"` — USO always skipped; fixed to distribute content to all symbols
- `SentimentEngine.MODEL_NAME` was `"llama3"` but the installed model is `qwen3.5:9b`; now reads `OLLAMA_MODEL` env var

---

## 6 — Do not return fake/zero data when Ollama is not running — tell the user

**Ask:** "If the LLM isn't running — TELL ME. Don't make up fake data."

**Criteria:**
- If Ollama is unreachable, the app shows a clear error immediately — not zeros, not silent failure
- The error message includes the exact command to start Ollama
- The SSE stream emits the error and stops; the non-streaming endpoint returns HTTP 503

**Implementation:**
- Preflight `GET /api/tags` check added to both `/analyze` and `/analyze/stream` before any pipeline step
- `SentimentEngine.analyze()` no longer catches and swallows exceptions — errors propagate
- Frontend shows Ollama-specific error banner with `ollama run qwen3.5:9b` inline

---

## 7 — Show live RSS feed data as it streams in

**Ask:** Show the RSS feed incoming stream live in the log box.

**Criteria:**
- Each RSS feed source shows as a header in the log
- Article titles and matched keywords appear one by one as each feed finishes fetching
- Truth Social posts show author and content preview
- Ingestion does not block the SSE stream (must use `asyncio.to_thread` for sync HTTP calls)

**Implementation:**
- Stream generator iterates feeds individually instead of calling `_ingest_data` as a black box
- `asyncio.to_thread(parser.parse_feeds, feed_names=[feed_name])` used for each feed
- Format: `━━ Reuters Middle East ━━` header → article lines → `→ N articles` count

---

## 8 — Dashboard must be pretty, usable, and show real values

**Ask:** Make the final results page pretty, usable, valuable. All scores showing 0 tell me this is not doing anything.

**Criteria:**
- Signal type (LONG/SHORT/HOLD) displayed prominently as the hero element
- Confidence shown as an animated progress bar, not just a number
- Entry symbol, stop-loss %, take-profit % visible at a glance
- Sentiment scores shown as bar charts, not just numbers — with axis labels and color coding
- Backtest results use a recharts bar chart for walk-forward windows
- Ollama-not-running shows as a distinct orange banner with the fix command
- Page is usable before the first analysis (not just empty)

**Components built/rewritten:**
- `SignalCard.tsx` — new hero element
- `SentimentTicker.tsx` — rewritten with animated horizontal bar charts + reasoning text
- `RollingWindowChart.tsx` — rewritten with recharts `BarChart` + metric cards
- `RiskGauge.tsx` — removed (replaced by `SignalCard`)
- `page.tsx` — full layout rewrite: sticky header, error banners, responsive grid

---

## 9 — CHANGES.md must be kept up to date

**Ask:** Update CHANGES.md after every set of changes.

**Criteria:**
- Every session's changes documented with file, what changed, and why
- Changelog is in reverse-chronological order (newest first within sections)

---

## 10 — README.md must stay accurate

**Ask:** Update README.md to reflect current state.

**Criteria:**
- Project structure tree matches actual files
- Setup instructions use PowerShell syntax (Windows project)
- Model name matches actual installed model (Qwen 3.5 9b)
- API endpoints are correct (`/api/v1/analyze`, `/api/v1/analyze/stream`)
- Ollama env var overrides documented

---

## Open / Known Limitations

- **Backtest per-window returns** are synthesized from summary stats for the chart visualization — the API only returns aggregate metrics, not individual window returns. To fix: surface `results` array from `RollingWindowOptimizer.optimize()` in the `AnalysisResponse` schema.
- **Truth Social** is now ingested via `https://trumpstruth.org/feed` (RSS aggregator), replacing the Playwright scraper stub. No login required.
- **VectorBT integration** in `vectorbt_engine.py` uses the VectorBT API incorrectly (`vbt.Positions.from_dataframe` is not valid). The active optimizer in `optimization.py` is a pure-Python implementation that does not depend on VectorBT.
- **Sentiment analysis calls Ollama once per symbol** with the same aggregated text. If symbols have different relevance, a per-symbol prompt would give better differentiation.
