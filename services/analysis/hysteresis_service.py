"""
HysteresisService — closed-market signal preservation logic.

Preserves the exact hysteresis comparison logic from the original router.
Accesses the database session to fetch the "latest previous" state for
comparing current run vs. previous entry.

State Management Note:
  - Depends on SQLAlchemy Session for previous-state lookup.
  - The `_latest_previous_analysis_response` method returns a dict
    (not a Pydantic model) to avoid circular imports — SQLAlchemy models
    are only used at the persistence layer.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from database.models import AnalysisResult


class HysteresisService:
    """Encapsulates closed-market hysteresis and hysteresis-config logic."""

    def __init__(self, logic_config: dict[str, Any]) -> None:
        """
        Args:
            logic_config: The full LOGIC config dict (config.logic_loader.LOGIC).
        """
        self._hyst = logic_config.get("entry_thresholds", {})

    # ── Public API ───────────────────────────────────────────────────

    def is_closed_market_session(self, quotes_by_symbol: Optional[Dict[str, Dict[str, Any]]]) -> bool:
        """Return True when all fetched quotes indicate the market is fully closed."""
        if not quotes_by_symbol:
            return False
        sessions = {
            str((quote or {}).get("session") or "").lower().strip()
            for quote in quotes_by_symbol.values()
            if isinstance(quote, dict)
        }
        sessions.discard("")
        return bool(sessions) and sessions.issubset({"closed"})

    def check_hysteresis(
        self,
        db: Session,
        quotes_by_symbol: Dict[str, Dict[str, Any]],
        sentiment_results: Dict[str, Dict[str, Any]],
        previous_response: Optional[Dict[str, Any]],
        posts_count: int,
    ) -> bool:
        """
        Return True when closed-market hysteresis should be active.

        Hysteresis preserves the prior signal unless the inputs moved
        materially (post count delta + sentiment delta).
        """
        if not self.is_closed_market_session(quotes_by_symbol):
            return False
        if previous_response is None:
            return False

        max_post_delta = int(self._hyst.get("hysteresis_max_post_delta", 5))
        max_sentiment_delta = float(self._hyst.get("hysteresis_max_sentiment_delta", 0.20))

        post_delta_ok = abs(int(previous_response.get("posts_scraped", 0) or 0) - posts_count) <= max_post_delta
        sentiment_delta_ok = self._max_sentiment_input_delta(sentiment_results, previous_response) <= max_sentiment_delta

        return post_delta_ok and sentiment_delta_ok

    def latest_previous_analysis_state(self, db: Optional[Session], max_age_hours: int = 8) -> Optional[Dict[str, Any]]:
        """
        Return the most recent saved analysis plus its reconstructed response and snapshot metadata.

        Returns None if no analysis exists or if the analysis is older than max_age_hours.
        """
        if db is None:
            return None

        latest = (
            db.query(AnalysisResult)
            .order_by(AnalysisResult.timestamp.desc())
            .first()
        )
        if not latest:
            return None

        latest_ts = latest.timestamp
        if latest_ts.tzinfo is None:
            latest_ts = latest_ts.replace(tzinfo=timezone.utc)
        else:
            latest_ts = latest_ts.astimezone(timezone.utc)
        age_hours = (datetime.now(timezone.utc) - latest_ts).total_seconds() / 3600.0
        if age_hours > max_age_hours:
            return None

        metadata = latest.run_metadata or {}
        snapshot = metadata.get("dataset_snapshot") or {}
        return {
            "analysis": latest,
            "response": self._load_saved_analysis_response(latest),
            "snapshot": snapshot,
            "quotes_by_symbol": snapshot.get("quotes_by_symbol") or {},
        }

    def latest_previous_analysis_response(self, db: Optional[Session], max_age_hours: int = 8) -> Optional[Dict[str, Any]]:
        """Load the most recent saved analysis if it is still recent enough to use for hysteresis."""
        state = self.latest_previous_analysis_state(db, max_age_hours)
        return state.get("response") if state else None

    # ── Helpers (private) ───────────────────────────────────────────────

    def _max_sentiment_input_delta(
        self,
        current_sentiment_results: Dict[str, Dict[str, Any]],
        previous_response: Optional[Dict[str, Any]],
    ) -> float:
        """Compare current vs previous sentiment inputs to avoid freezing legitimate regime changes."""
        if not previous_response or not previous_response.get("sentiment_scores"):
            return 999.0
        deltas: List[float] = []
        for symbol, current in current_sentiment_results.items():
            previous = previous_response["sentiment_scores"].get(symbol)
            if not previous:
                continue
            deltas.append(abs(float(current.get("policy_score", 0.0)) - float(previous.get("policy_change", 0.0))))
            deltas.append(abs(float(current.get("bluster_score", 0.0)) - float(previous.get("market_bluster", 0.0))))
            deltas.append(abs(float(current.get("confidence", 0.0)) - float(previous.get("confidence", 0.0))))
        return max(deltas) if deltas else 999.0

    def _load_saved_analysis_response(self, analysis: AnalysisResult) -> Optional[Dict[str, Any]]:
        """Reconstruct a full analysis response dict from a persisted AnalysisResult row."""
        metadata = analysis.run_metadata or {}
        snapshot = metadata.get("dataset_snapshot") or {}
        sentiment_data = analysis.sentiment_data or {}
        signal_data = analysis.signal or {}
        backtest_data = analysis.backtest_results or {}

        sentiment_scores_payload = sentiment_data.get("sentiment_scores") or {}
        aggregated_payload = sentiment_data.get("aggregated_sentiment") or {}
        market_validation = sentiment_data.get("market_validation") or snapshot.get("market_validation") or {}

        sentiment_scores = {}
        for symbol, payload in sentiment_scores_payload.items():
            sentiment_scores[symbol] = {
                "market_bluster": float((payload or {}).get("market_bluster", 0.0) or 0.0),
                "policy_change": float((payload or {}).get("policy_change", 0.0) or 0.0),
                "confidence": float((payload or {}).get("confidence", 0.0) or 0.0),
                "reasoning": str((payload or {}).get("reasoning", "") or ""),
            }

        aggregated_sentiment = None
        if aggregated_payload:
            aggregated_sentiment = {
                "market_bluster": float(aggregated_payload.get("market_bluster", 0.0) or 0.0),
                "policy_change": float(aggregated_payload.get("policy_change", 0.0) or 0.0),
                "confidence": float(aggregated_payload.get("confidence", 0.0) or 0.0),
                "reasoning": str(aggregated_payload.get("reasoning", "") or ""),
            }

        trading_signal = {
            "signal_type": str(signal_data.get("signal_type", "HOLD") or "HOLD"),
            "confidence_score": float(signal_data.get("confidence_score", 0.0) or 0.0),
            "urgency": str(signal_data.get("urgency", "LOW") or "LOW"),
            "entry_symbol": str(signal_data.get("entry_symbol", "") or ""),
            "recommendations": list(signal_data.get("recommendations") or []),
            "conviction_level": str(signal_data.get("conviction_level", "LOW") or "LOW"),
            "holding_period_hours": int(signal_data.get("holding_period_hours", 2) or 2),
            "trading_type": str(signal_data.get("trading_type", "VOLATILE_EVENT") or "VOLATILE_EVENT"),
            "action_if_already_in_position": str(signal_data.get("action_if_already_in_position", "HOLD") or "HOLD"),
            "entry_price": signal_data.get("entry_price"),
            "stop_loss_pct": float(signal_data.get("stop_loss_pct", 2.0) or 2.0),
            "take_profit_pct": float(signal_data.get("take_profit_pct", 3.0) or 3.0),
            "position_size_usd": float(signal_data.get("position_size_usd", 1000.0) or 1000.0),
        }

        blue_signal_data = metadata.get("blue_team_signal") or {}
        blue_team_signal = None
        if blue_signal_data:
            blue_team_signal = {
                "signal_type": str(blue_signal_data.get("signal_type", "HOLD") or "HOLD"),
                "confidence_score": float(blue_signal_data.get("confidence_score", 0.0) or 0.0),
                "urgency": str(blue_signal_data.get("urgency", "LOW") or "LOW"),
                "entry_symbol": str(blue_signal_data.get("entry_symbol", "") or ""),
                "recommendations": list(blue_signal_data.get("recommendations") or []),
                "conviction_level": str(blue_signal_data.get("conviction_level", "LOW") or "LOW"),
                "holding_period_hours": int(blue_signal_data.get("holding_period_hours", 2) or 2),
                "trading_type": str(blue_signal_data.get("trading_type", "VOLATILE_EVENT") or "VOLATILE_EVENT"),
                "action_if_already_in_position": str(blue_signal_data.get("action_if_already_in_position", "HOLD") or "HOLD"),
                "entry_price": blue_signal_data.get("entry_price"),
                "stop_loss_pct": float(blue_signal_data.get("stop_loss_pct", 2.0) or 2.0),
                "take_profit_pct": float(blue_signal_data.get("take_profit_pct", 3.0) or 3.0),
                "position_size_usd": float(blue_signal_data.get("position_size_usd", 1000.0) or 1000.0),
            }

        backtest_results = None
        if backtest_data:
            backtest_results = {
                "total_return": float(backtest_data.get("total_return", 0.0) or 0.0),
                "win_rate": float(backtest_data.get("win_rate", 0.0) or 0.0),
                "max_drawdown": float(backtest_data.get("max_drawdown", 0.0) or 0.0),
                "sharpe_ratio": float(backtest_data.get("sharpe_ratio", 0.0) or 0.0),
                "total_trades": int(backtest_data.get("total_trades", 0) or 0),
                "lookback_days": int(backtest_data.get("lookback_days", snapshot.get("lookback_days", 14)) or 14),
            }

        red_team_payload = metadata.get("red_team_review") or {}

        return {
            "request_id": analysis.request_id,
            "timestamp": analysis.timestamp,
            "symbols_analyzed": list(metadata.get("symbols") or snapshot.get("symbols") or []),
            "posts_scraped": int(metadata.get("posts_scraped", 0) or 0),
            "sentiment_scores": sentiment_scores,
            "aggregated_sentiment": aggregated_sentiment,
            "trading_signal": trading_signal,
            "blue_team_signal": blue_team_signal,
            "market_validation": market_validation,
            "red_team_review": red_team_payload if red_team_payload else None,
            "stage_metrics": {
                key: value
                for key, value in (metadata.get("stage_metrics") or {}).items()
            },
            "backtest_results": backtest_results,
            "processing_time_ms": float(metadata.get("processing_time_ms", 0.0) or 0.0),
            "status": "SUCCESS",
        }