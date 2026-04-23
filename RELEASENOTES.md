# Release Notes — April 22, 2026

## Paper Trading Simulation

Every analysis run now automatically simulates a $100 paper trade per signal during extended market hours (4:00am–8:00pm ET, Monday–Friday). The simulation mirrors what a real trader following every signal would actually do:

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
- Closed trades history with entry→exit prices, realized P&L, and market session each trade was opened in
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

```
python test_stage1.py llama3.2:latest
```

Output now shows:
- Which keyword source was used per symbol: `(static)` or `(LLM-generated)`
- The generated keywords for NVDA and NOW
- Separate PASS/FAIL for built-in symbol catch rate vs custom symbol coverage vs noise filtering

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
