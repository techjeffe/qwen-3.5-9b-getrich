# Trading Logic Reference

This document explains how the system decides when to enter and exit trades, how sentiment is scored, and how each key threshold can be changed.

---

## How a Trade Gets Opened

Every analysis run processes recent news articles through a two-layer AI review (blue team + red team). The output for each symbol is a **directional score** between −1.0 and +1.0.

```
directional score > entry threshold  →  LONG signal
directional score < −entry threshold →  SHORT signal
otherwise                             →  HOLD
```

**Default entry threshold: 0.30** (configurable in Admin → Trading Logic)

During closed market hours, the threshold rises to **0.42** to reduce unnecessary churn on stale news. If the symbol already has an open position, the "keep" threshold is used instead (0.22 closed / 0.30 normal) — a lower bar to avoid flip-flopping once a trade is open.

---

## How a Trade Gets Closed

A position is closed when any of these happen:

1. **HOLD signal fires** — the model's directional thesis is gone; the position is closed immediately at market price.
2. **Direction flips** — e.g., LONG → SHORT. The old position closes, then a new one opens in the new direction.
3. **Different execution ticker or leverage** — same result: close old, open new.
4. **Symbol removed from tracked list** — position is closed at the next available price.

> **Note:** Stop loss and take profit percentages are stored on each signal and passed to execution, but the paper trading simulation currently closes on signal changes rather than price-based stops. The stop/take-profit values are used for informational display and red-team override logic.

---

## Materiality Gate (Thesis Flip Prevention)

Before the model is allowed to flip from LONG → SHORT or vice versa, the system checks whether the change is "material" — i.e., something real changed. A flip is blocked unless **at least one** of these is true:

| Condition | Default threshold | Admin-editable |
|---|---|---|
| New articles vs last run | ≥ 6 new articles | Yes |
| Sentiment score shift | ≥ 0.24 change | Yes |
| Price move vs last run | ≥ ATR × 0.5, bounded 0.75%–3.0% | No (JSON only) |

This prevents the model from whipsawing in and out of trades on noise between runs.

---

## How Sentiment Is Scored

The LLM never outputs raw numbers. Instead it outputs structured facts (event type, whether confirmed, bluster vs substance phrases, symbol relevance), and Python converts those to calibrated scores.

### Bluster Score (−1.0 to +1.0)
Measures how much of the content is rhetorical noise vs substantive policy content.

```
raw = (substance_phrases - bluster_phrases) / total_phrases
if unconfirmed: raw -= 0.35
bluster_score = clamp(raw, -1.0, 1.0)
```

A score below **−0.20** flags the content as bluster. A score below **−0.35** combined with a low policy score triggers a SHORT signal.

### Policy Score (0.0 to 1.0)
Measures the market-moving weight of the event type.

| Event Type | Base Score |
|---|---|
| Monetary Policy (Fed, central banks) | 0.82 |
| Regulatory | 0.74 |
| Fiscal (spending, taxes) | 0.68 |
| Geopolitical | 0.58 |
| Macro Data (CPI, jobs) | 0.52 |
| Earnings | 0.44 |
| Sector News | 0.36 |
| Noise | 0.08 |
| Unknown | 0.30 |

Modifiers:
- **Unconfirmed event:** base × 0.48
- **Irrelevant to the tracked symbol:** score × 0.18
- Signal requires policy score ≥ **0.40** to trigger LONG or SHORT

### Confidence Score (0.28 to 0.91)
Reflects how much trust to put in the signal.

```
base = 0.40 + (source_count / 10) × 0.38
if irrelevant: base -= 0.18
if unconfirmed: base -= 0.08
confidence = clamp(base, 0.28, 0.91)
```

---

## Red Team Override

After the blue team generates a signal, a red team review challenges it. The red team must meet a higher bar to *overturn* the blue team than to *confirm* it.

**Red team confidence:**
```
base = 0.58
if agrees with blue team: +0.08
if disagrees:            −0.22
per evidence item:       +0.024 (capped at +0.12)
per risk item:           −0.028 (capped at −0.14)
if source bias flagged:  −0.10
```

**Override is allowed only when:**
- Red agrees with blue → always allowed
- Red recommends HOLD → confidence ≥ 0.58 AND (≥2 evidence OR ≥2 risks)
- Red recommends opposite direction → confidence ≥ 0.64 AND evidence ≥ 3 AND evidence > risks AND no source bias

**Red team stop loss by urgency:**

| Urgency | Stop Loss |
|---|---|
| HIGH | 3.5% |
| MEDIUM | 2.5% |
| LOW | 1.8% |

---

## Leverage Selection

Based on the configured risk profile:

| Profile | Bullish leverage | Bearish leverage |
|---|---|---|
| Conservative | 1x | Inverse ETF (no shorting) |
| Moderate | 2x if confidence > 0.75, else 1x | Same |
| Aggressive | 3x if confidence > 0.75, else 1x | Same |
| Crazy | 3x always | Same |

---

## Conviction & Trade Type

Each signal is assigned a conviction level and trade type based on its directional score and confidence. A **holding window** is opened when a position is entered — the position is protected from premature closure until the window expires.

| Signal score | Confidence | Conviction | Trade Type | Default window |
|---|---|---|---|---|
| > 0.6 | > 0.7 | HIGH | POSITION | 72 hrs (4320 min) |
| Most cases | Any | MEDIUM | SWING | 12 hrs (720 min) |
| HOLD signal, or high urgency + low confidence | — | LOW | VOLATILE_EVENT | 2 hrs (120 min) |

### Window behavior (configurable in `logic_config.json → conviction`)

| Setting | Default | Description |
|---|---|---|
| `hold_signal_respects_window` | `true` | HOLD signal is blocked from closing while window is active |
| `flip_overrides_window` | `true` | Direction flip always closes and reopens, ignoring the window |
| `close_on_window_expiry` | `true` | Position auto-closes when window expires |
| `close_expired_during_closed_hours` | `true` | Expired positions close even when market is closed |

All timing values are in **minutes** (`holding_minutes`) so SCALP and SWING trades can be tuned at minute granularity.

---

## Paper Trading

The paper trading simulation auto-executes a fixed dollar amount per signal during extended market hours (Mon–Fri, 4:00 AM – 8:00 PM ET).

- **Default trade size: $100** (configurable in Admin → Trading Logic)
- Each unique symbol gets one open position at a time
- P&L is tracked using directional math: shorts profit from price declines
- Equity curve and win/loss stats are shown on the Trading page

---

## Customizing These Parameters

### Admin UI (easiest)
Go to **Admin → Trading Logic** to change:
- Paper trade amount
- Entry threshold
- Stop loss %
- Take profit %
- Materiality gate — min new articles
- Materiality gate — min sentiment delta

Leave a field blank to revert to the system default.

### JSON Config (power users)
Edit `backend/config/logic_config.json` and restart the backend. All scoring weights, red-team thresholds, holding period defaults, and ATR bounds live here. The JSON ships with defaults that match the original hardcoded values.

Admin UI values take precedence over JSON values for the 6 fields listed above.
