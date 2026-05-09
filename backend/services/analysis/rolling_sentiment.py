"""
RollingSentiment — time-decayed rolling average of sentiment scores.

Blends the current run's per-symbol sentiment scores with recent historical
runs using exponential decay. This prevents a single run of noisy or sparse
articles from flipping the trading signal.

Usage:
    from services.analysis.rolling_sentiment import blend_with_history

    blended = blend_with_history(db, current_scores, symbols,
                                  half_life_hours=0.33, max_age_hours=2)
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from database.models import AnalysisResult


def load_recent_scores(
    db: Session,
    symbols: List[str],
    max_age_hours: float = 2.0,
) -> List[Dict[str, Any]]:
    """
    Load per-symbol sentiment scores from recent analysis runs.

    Returns a list of dicts, each with:
        - timestamp: datetime
        - scores: dict[symbol] -> {market_bluster, policy_change, confidence}
    """
    cutoff = datetime.now(timezone.utc)
    recent = (
        db.query(AnalysisResult)
        .filter(AnalysisResult.timestamp >= cutoff)
        .order_by(AnalysisResult.timestamp.desc())
        .all()
    )
    # Filter by age in Python since the DB timestamp may be naive
    now = datetime.now(timezone.utc)
    results: List[Dict[str, Any]] = []
    for r in recent:
        ts = r.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age_hours = (now - ts).total_seconds() / 3600.0
        if age_hours > max_age_hours:
            continue
        sent_data = r.sentiment_data or {}
        scores = sent_data.get("sentiment_scores") or {}
        # Only include runs that have scores for at least one of our symbols
        if any(sym in scores for sym in symbols):
            results.append({
                "timestamp": ts,
                "scores": scores,
            })
    return results


def _decay_weight(age_hours: float, half_life_hours: float) -> float:
    """Exponential decay weight: 0.5^(age/half_life)."""
    if age_hours <= 0:
        return 1.0
    return 0.5 ** (age_hours / half_life_hours)


def blend_with_history(
    current_scores: Dict[str, Dict[str, Any]],
    historical_runs: List[Dict[str, Any]],
    half_life_hours: float = 0.33,
) -> Dict[str, Dict[str, Any]]:
    """
    Blend current sentiment scores with historical runs using exponential decay.

    Args:
        current_scores: Current run's per-symbol sentiment results.
            Each value is a dict with keys: market_bluster, policy_change, confidence,
            directional_score, signal_type, urgency, reasoning, etc.
        historical_runs: List from load_recent_scores().
        half_life_hours: Decay half-life in hours (default 0.33 = 20 min).

    Returns:
        Blended scores dict with the same structure as current_scores.
        The 'reasoning' field is taken from the current run (not blended).
    """
    if not historical_runs:
        return current_scores

    now = datetime.now(timezone.utc)
    blended: Dict[str, Dict[str, Any]] = {}

    all_symbols = set(current_scores.keys())
    for run in historical_runs:
        all_symbols.update(run["scores"].keys())

    for sym in all_symbols:
        current = current_scores.get(sym) or {}
        total_weight = 0.0
        w_bluster = 0.0
        w_policy = 0.0
        w_confidence = 0.0
        w_directional = 0.0

        # Current run always included with full weight
        cur_bluster = current.get("market_bluster", 0.0) or 0.0
        cur_policy = current.get("policy_change", 0.0) or 0.0
        cur_confidence = current.get("confidence", 0.0) or 0.0
        cur_directional = current.get("directional_score", 0.0) or 0.0

        # If the current run has this symbol, give it weight=1.0
        if sym in current_scores:
            total_weight += 1.0
            w_bluster += cur_bluster * 1.0
            w_policy += cur_policy * 1.0
            w_confidence += cur_confidence * 1.0
            w_directional += cur_directional * 1.0

        # Blend in historical runs with decay weights
        for run in historical_runs:
            hist = run["scores"].get(sym)
            if not hist:
                continue
            ts = run["timestamp"]
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            age_hours = (now - ts).total_seconds() / 3600.0
            weight = _decay_weight(age_hours, half_life_hours)
            if weight < 0.01:
                continue

            total_weight += weight
            w_bluster += (hist.get("market_bluster", 0.0) or 0.0) * weight
            w_policy += (hist.get("policy_change", 0.0) or 0.0) * weight
            w_confidence += (hist.get("confidence", 0.0) or 0.0) * weight
            # Historical directional_score may not be stored; compute from bluster+policy if missing
            hist_directional = hist.get("directional_score")
            if hist_directional is not None:
                w_directional += (hist_directional or 0.0) * weight

        if total_weight <= 0:
            blended[sym] = dict(current) if current else {
                "market_bluster": 0.0, "policy_change": 0.0, "confidence": 0.0,
                "directional_score": 0.0, "signal_type": "HOLD", "urgency": "LOW",
                "reasoning": "",
            }
            continue

        # Build blended result, preserving non-numeric fields from current run
        result = {
            "market_bluster": round(w_bluster / total_weight, 4),
            "policy_change": round(w_policy / total_weight, 4),
            "confidence": round(w_confidence / total_weight, 4),
            "directional_score": round(w_directional / total_weight, 4),
            # Preserve these from the current run (not blended)
            "signal_type": current.get("signal_type", "HOLD"),
            "urgency": current.get("urgency", "LOW"),
            "reasoning": current.get("reasoning", ""),
            "conviction_level": current.get("conviction_level", "MEDIUM"),
            "trading_type": current.get("trading_type", "SWING"),
            "holding_period_hours": current.get("holding_period_hours"),
        }
        blended[sym] = result

    return blended