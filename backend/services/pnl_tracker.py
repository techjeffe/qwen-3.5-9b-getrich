"""
Persistent recommendation tracking and forward-horizon P&L snapshots.
"""

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
from sqlalchemy.orm import Session

from database.models import Trade, TradeExecution, TradeSnapshot
from services.data_ingestion.yfinance_client import PriceClient


HORIZON_DELTAS = {
    "1h": timedelta(hours=1),
    "4h": timedelta(hours=4),
    "1d": timedelta(days=1),
    "3d": timedelta(days=3),
    "1w": timedelta(weeks=1),
}

PRICE_INTERVAL = "15m"
SCHEDULER_INTERVAL_SECONDS = 30 * 60


def utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime) -> datetime:
    """Normalize datetimes to timezone-aware UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_leverage_multiplier(leverage: str) -> float:
    """Convert `1x` / `3x` style leverage strings to a numeric multiplier."""
    if not leverage:
        return 1.0
    normalized = leverage.strip().lower().replace("x", "")
    try:
        value = float(normalized)
        return value if value > 0 else 1.0
    except ValueError:
        return 1.0


def calculate_return_pct(action: str, entry_price: float, exit_price: float) -> float:
    """Compute directional return for long and short recommendations."""
    if entry_price <= 0 or exit_price <= 0:
        return 0.0

    raw_move = (exit_price - entry_price) / entry_price
    if action.upper() == "SELL":
        raw_move *= -1

    return raw_move * 100


def persist_recommendation_trades(
    db: Session,
    analysis_id: int,
    request_id: str,
    response: Any,
    quotes_by_symbol: Dict[str, Dict[str, Any]],
) -> int:
    """
    Persist one trade row for each actionable recommendation.
    Returns the number of created trades.
    """
    signal = response.trading_signal
    if not signal or not signal.recommendations:
        return 0

    created = 0
    recommended_at = ensure_utc(response.timestamp)

    for rec in signal.recommendations:
        symbol = rec.get("symbol")
        quote = quotes_by_symbol.get(symbol or "")
        entry_price = quote.get("current_price") if quote else None
        if not symbol or entry_price is None or entry_price <= 0:
            continue

        entry_ts = ensure_utc(quote.get("timestamp") or recommended_at)
        db.add(
            Trade(
                analysis_id=analysis_id,
                request_id=request_id,
                symbol=symbol,
                action=rec.get("action", "BUY"),
                leverage=rec.get("leverage", "1x"),
                signal_type=signal.signal_type,
                confidence_score=signal.confidence_score,
                recommended_at=recommended_at,
                entry_price=entry_price,
                entry_price_timestamp=entry_ts,
                stop_loss_pct=signal.stop_loss_pct,
                take_profit_pct=signal.take_profit_pct,
            )
        )
        created += 1

    return created


class PnLTracker:
    """Service for resolving immutable forward-horizon trade snapshots."""

    def __init__(self, price_client: Optional[PriceClient] = None):
        self.price_client = price_client or PriceClient()

    def process_due_snapshots(self, db: Session, now: Optional[datetime] = None) -> int:
        """
        Resolve all due-but-missing horizons and persist immutable valid snapshots.
        Returns the number of newly created snapshots.
        """
        now_utc = ensure_utc(now or utc_now())
        created = 0

        trades = db.query(Trade).all()
        for trade in trades:
            created += self._process_trade(db, trade, now_utc)

        if created:
            db.commit()

        return created

    def get_summary(self, db: Session, limit: int = 50) -> Dict[str, Any]:
        """Build a compact P&L summary payload for API consumers."""
        trades = db.query(Trade).order_by(Trade.recommended_at.desc()).limit(limit).all()
        snapshots = db.query(TradeSnapshot).all()
        executions = db.query(TradeExecution).all()

        snapshots_by_trade: Dict[int, Dict[str, TradeSnapshot]] = {}
        for snapshot in snapshots:
            snapshots_by_trade.setdefault(snapshot.trade_id, {})[snapshot.horizon_label] = snapshot
        execution_by_trade = {execution.trade_id: execution for execution in executions}

        horizon_summary: Dict[str, Dict[str, Any]] = {
            label: {
                "resolved_trades": 0,
                "winning_trades": 0,
                "avg_raw_return_pct": 0.0,
                "avg_leveraged_return_pct": 0.0,
            }
            for label in HORIZON_DELTAS
        }
        execution_summary = {
            "executed_trades": 0,
            "matched_recommendation": 0,
            "avg_latest_recommended_return_pct": 0.0,
            "avg_latest_actual_return_pct": 0.0,
        }

        trade_items: List[Dict[str, Any]] = []
        for trade in trades:
            trade_snapshots = snapshots_by_trade.get(trade.id, {})
            snapshot_items: Dict[str, Any] = {}

            for label, snapshot in trade_snapshots.items():
                snapshot_items[label] = {
                    "target_timestamp": snapshot.target_timestamp.isoformat(),
                    "observed_at": snapshot.observed_at.isoformat(),
                    "observed_price": round(snapshot.observed_price, 4),
                    "raw_return_pct": round(snapshot.raw_return_pct, 4),
                    "leveraged_return_pct": round(snapshot.leveraged_return_pct, 4),
                }
                summary = horizon_summary[label]
                summary["resolved_trades"] += 1
                if snapshot.raw_return_pct > 0:
                    summary["winning_trades"] += 1
                summary["avg_raw_return_pct"] += snapshot.raw_return_pct
                summary["avg_leveraged_return_pct"] += snapshot.leveraged_return_pct

            actual_execution = execution_by_trade.get(trade.id)
            actual_execution_payload = None
            comparison_payload = None
            latest_snapshot = self._latest_snapshot(trade_snapshots)
            if actual_execution:
                execution_summary["executed_trades"] += 1
                if actual_execution.executed_action.upper() == trade.action.upper():
                    execution_summary["matched_recommendation"] += 1
                actual_execution_payload = {
                    "id": actual_execution.id,
                    "executed_action": actual_execution.executed_action,
                    "executed_price": round(actual_execution.executed_price, 4),
                    "executed_at": ensure_utc(actual_execution.executed_at).isoformat(),
                    "notes": actual_execution.notes or "",
                }
                if latest_snapshot:
                    actual_return_pct = calculate_return_pct(
                        action=actual_execution.executed_action,
                        entry_price=actual_execution.executed_price,
                        exit_price=latest_snapshot.observed_price,
                    )
                    recommended_return_pct = latest_snapshot.raw_return_pct
                    execution_summary["avg_latest_recommended_return_pct"] += recommended_return_pct
                    execution_summary["avg_latest_actual_return_pct"] += actual_return_pct
                    comparison_payload = {
                        "latest_horizon": latest_snapshot.horizon_label,
                        "recommended_return_pct": round(recommended_return_pct, 4),
                        "actual_return_pct": round(actual_return_pct, 4),
                        "following_was_better_pct": round(actual_return_pct - recommended_return_pct, 4),
                    }

            trade_items.append(
                {
                    "id": trade.id,
                    "request_id": trade.request_id,
                    "symbol": trade.symbol,
                    "action": trade.action,
                    "leverage": trade.leverage,
                    "signal_type": trade.signal_type,
                    "confidence_score": trade.confidence_score,
                    "recommended_at": ensure_utc(trade.recommended_at).isoformat(),
                    "entry_price": round(trade.entry_price, 4),
                    "entry_price_timestamp": ensure_utc(trade.entry_price_timestamp).isoformat(),
                    "snapshots": snapshot_items,
                    "actual_execution": actual_execution_payload,
                    "comparison": comparison_payload,
                }
            )

        for label, summary in horizon_summary.items():
            resolved = summary["resolved_trades"]
            if resolved:
                summary["avg_raw_return_pct"] = round(summary["avg_raw_return_pct"] / resolved, 4)
                summary["avg_leveraged_return_pct"] = round(summary["avg_leveraged_return_pct"] / resolved, 4)
                summary["win_rate"] = round(summary["winning_trades"] / resolved * 100, 2)
            else:
                summary["win_rate"] = 0.0

        total_trades = db.query(Trade).count()
        total_snapshots = db.query(TradeSnapshot).count()
        if execution_summary["executed_trades"]:
            execution_summary["avg_latest_recommended_return_pct"] = round(
                execution_summary["avg_latest_recommended_return_pct"] / execution_summary["executed_trades"], 4
            )
            execution_summary["avg_latest_actual_return_pct"] = round(
                execution_summary["avg_latest_actual_return_pct"] / execution_summary["executed_trades"], 4
            )
            execution_summary["match_rate"] = round(
                execution_summary["matched_recommendation"] / execution_summary["executed_trades"] * 100, 2
            )
        else:
            execution_summary["match_rate"] = 0.0

        return {
            "scheduler_interval_minutes": SCHEDULER_INTERVAL_SECONDS // 60,
            "horizons": list(HORIZON_DELTAS.keys()),
            "total_trades": total_trades,
            "total_snapshots": total_snapshots,
            "horizon_summary": horizon_summary,
            "execution_summary": execution_summary,
            "trades": trade_items,
        }

    def record_execution(
        self,
        db: Session,
        trade_id: int,
        executed_action: str,
        executed_price: float,
        notes: str = "",
        executed_at: Optional[datetime] = None,
    ) -> TradeExecution:
        """Create or update a user's execution for a recommendation trade."""
        execution = db.query(TradeExecution).filter(TradeExecution.trade_id == trade_id).first()
        timestamp = ensure_utc(executed_at or utc_now())
        if execution:
            execution.executed_action = executed_action
            execution.executed_price = executed_price
            execution.executed_at = timestamp
            execution.notes = notes or None
        else:
            execution = TradeExecution(
                trade_id=trade_id,
                executed_action=executed_action,
                executed_price=executed_price,
                executed_at=timestamp,
                notes=notes or None,
            )
            db.add(execution)

        db.commit()
        db.refresh(execution)
        return execution

    def _process_trade(self, db: Session, trade: Trade, now_utc: datetime) -> int:
        created = 0
        existing = {
            snapshot.horizon_label
            for snapshot in db.query(TradeSnapshot).filter(TradeSnapshot.trade_id == trade.id).all()
        }

        trade_recommended_at = ensure_utc(trade.recommended_at)

        for label, delta in HORIZON_DELTAS.items():
            if label in existing:
                continue

            target_timestamp = trade_recommended_at + delta
            if target_timestamp > now_utc:
                continue

            resolved = self._resolve_price_at_or_after(
                symbol=trade.symbol,
                target_timestamp=target_timestamp,
                now_utc=now_utc,
            )
            if not resolved:
                continue

            raw_return_pct = calculate_return_pct(
                action=trade.action,
                entry_price=trade.entry_price,
                exit_price=resolved["price"],
            )
            leveraged_return_pct = raw_return_pct * parse_leverage_multiplier(trade.leverage)

            db.add(
                TradeSnapshot(
                    trade_id=trade.id,
                    horizon_label=label,
                    horizon_minutes=int(delta.total_seconds() // 60),
                    target_timestamp=target_timestamp,
                    observed_price=resolved["price"],
                    observed_at=resolved["observed_at"],
                    source_interval=resolved["source_interval"],
                    raw_return_pct=raw_return_pct,
                    leveraged_return_pct=leveraged_return_pct,
                )
            )
            created += 1

        return created

    @staticmethod
    def _latest_snapshot(trade_snapshots: Dict[str, TradeSnapshot]) -> Optional[TradeSnapshot]:
        """Return the furthest resolved horizon snapshot for a trade."""
        if not trade_snapshots:
            return None
        ordered = sorted(trade_snapshots.values(), key=lambda snapshot: snapshot.horizon_minutes)
        return ordered[-1]

    def _resolve_price_at_or_after(
        self,
        symbol: str,
        target_timestamp: datetime,
        now_utc: datetime,
    ) -> Optional[Dict[str, Any]]:
        """
        Find the first valid close price at or after the target timestamp.
        If the market has not produced a bar yet, return None and let the next run try again.
        """
        if target_timestamp > now_utc:
            return None

        window_start = target_timestamp - timedelta(hours=2)
        window_end = now_utc + timedelta(minutes=30)

        df = self.price_client.get_ohlcv_data_range(
            symbol=symbol,
            start=window_start,
            end=window_end,
            interval=PRICE_INTERVAL,
        )
        if df is None or df.empty or "Close" not in df.columns:
            return None

        normalized = self._normalize_dataframe_index(df)
        candidates = normalized.loc[normalized.index >= target_timestamp]
        if candidates.empty:
            return None

        close_series = candidates["Close"].dropna()
        if close_series.empty:
            return None

        observed_at = ensure_utc(close_series.index[0].to_pydatetime())
        observed_price = float(close_series.iloc[0])
        if observed_price <= 0:
            return None

        return {
            "price": observed_price,
            "observed_at": observed_at,
            "source_interval": PRICE_INTERVAL,
        }

    @staticmethod
    def _normalize_dataframe_index(df: pd.DataFrame) -> pd.DataFrame:
        """Return a copy whose index is timezone-aware UTC datetimes."""
        normalized = df.copy()
        if normalized.index.tz is None:
            normalized.index = normalized.index.tz_localize(timezone.utc)
        else:
            normalized.index = normalized.index.tz_convert(timezone.utc)
        return normalized.sort_index()
