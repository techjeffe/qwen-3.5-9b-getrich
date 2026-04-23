"""
Persistent recommendation tracking and forward-horizon P&L snapshots.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
from sqlalchemy.orm import Session

from database.models import Trade, TradeClose, TradeExecution, TradeSnapshot
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
PAPER_TRADE_NOTIONAL_USD = 100.0


def utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime) -> datetime:
    """Normalize datetimes to timezone-aware UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def calculate_return_pct(action: str, entry_price: float, exit_price: float) -> float:
    """Compute directional return for long and short recommendations."""
    if entry_price <= 0 or exit_price <= 0:
        return 0.0

    raw_move = (exit_price - entry_price) / entry_price
    if action.upper() == "SELL":
        raw_move *= -1

    return raw_move * 100


def calculate_pnl_usd(action: str, entry_price: float, exit_price: float, notional_usd: float = PAPER_TRADE_NOTIONAL_USD) -> float:
    """Convert a directional percentage move into normalized dollar P&L for a fixed notional."""
    return notional_usd * (calculate_return_pct(action, entry_price, exit_price) / 100.0)


def should_create_new_trade(
    db: Session,
    symbol: str,
    new_action: str,
    new_conviction_level: str,
) -> bool:
    """
    Determine if a new trade should be created given existing active positions.
    
    Rules:
    - If no active trades for this symbol: create new trade
    - If same action as active trade: skip (don't duplicate)
    - If opposite action:
      - Create only if conviction is HIGH (override existing position)
      - Skip if conviction is LOW or MEDIUM (respect holding window)
    
    Returns True if trade should be created, False otherwise.
    """
    now = utc_now()
    
    # Find active trades still within their holding window
    active_trades = db.query(Trade).filter(
        Trade.symbol == symbol,
        Trade.holding_window_until > now,
        ~db.query(TradeClose).filter(TradeClose.trade_id == Trade.id).exists(),  # not yet closed
    ).all()
    
    if not active_trades:
        return True  # No active trade, create new one
    
    active_trade = active_trades[0]
    new_normalized = str(new_action).upper().strip()
    existing_normalized = str(active_trade.action).upper().strip()
    
    # Same direction: don't duplicate
    if new_normalized == existing_normalized:
        return False
    
    # Opposite direction: only if high conviction
    return new_conviction_level == "HIGH"


def persist_recommendation_trades(
    db: Session,
    analysis_id: int,
    request_id: str,
    response: Any,
    quotes_by_symbol: Dict[str, Dict[str, Any]],
) -> int:
    """
    Persist one trade row for each actionable recommendation.
    Applies conviction-based trade reconciliation to avoid churn.
    
    CRITICAL: Uses the EXECUTION symbol (e.g., SBIT) for price lookups and P&L.
    Stores both execution symbol and underlying symbol for clarity.
    
    Returns the number of created trades.
    """
    signal = response.trading_signal
    if not signal or not signal.recommendations:
        return 0

    created = 0
    recommended_at = ensure_utc(response.timestamp)
    
    # Get conviction level and holding period from signal
    conviction_level = getattr(signal, "conviction_level", "MEDIUM")
    holding_period_hours = getattr(signal, "holding_period_hours", 4)
    trading_type = getattr(signal, "trading_type", "SWING")
    holding_window_until = recommended_at + timedelta(hours=holding_period_hours)

    for rec in signal.recommendations:
        execution_symbol = rec.get("symbol")  # e.g., SBIT, SPXS, UCO
        underlying_symbol = rec.get("underlying_symbol")  # e.g., BITO, QQQ, USO
        
        # CRITICAL: Look up price using EXECUTION symbol, not underlying
        quote = quotes_by_symbol.get(execution_symbol or "")
        entry_price = quote.get("current_price") if quote else None
        
        if not execution_symbol or entry_price is None or entry_price <= 0:
            if execution_symbol:
                print(f"[WARNING] Skipping trade: No valid price for {execution_symbol} "
                      f"(underlying: {underlying_symbol}). Available symbols: {list(quotes_by_symbol.keys())}")
            continue
        
        # Apply reconciliation: check if we should create this trade
        if not should_create_new_trade(db, execution_symbol, rec.get("action", "BUY"), conviction_level):
            continue  # Skip this trade to avoid churn

        entry_ts = ensure_utc(quote.get("timestamp") or recommended_at)
        db.add(
            Trade(
                analysis_id=analysis_id,
                request_id=request_id,
                symbol=execution_symbol,
                underlying_symbol=underlying_symbol,
                action=rec.get("action", "BUY"),
                leverage=rec.get("leverage", "1x"),
                signal_type=signal.signal_type,
                confidence_score=signal.confidence_score,
                recommended_at=recommended_at,
                entry_price=entry_price,
                entry_price_timestamp=entry_ts,
                stop_loss_pct=signal.stop_loss_pct,
                take_profit_pct=signal.take_profit_pct,
                conviction_level=conviction_level,
                holding_period_hours=holding_period_hours,
                trading_type=trading_type,
                holding_window_until=holding_window_until,
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
        closes = db.query(TradeClose).all()

        snapshots_by_trade: Dict[int, Dict[str, TradeSnapshot]] = {}
        for snapshot in snapshots:
            snapshots_by_trade.setdefault(snapshot.trade_id, {})[snapshot.horizon_label] = snapshot
        execution_by_trade = {execution.trade_id: execution for execution in executions}
        close_by_trade = {close.trade_id: close for close in closes}

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
                    "paper_pnl_usd": round(
                        calculate_pnl_usd(trade.action, trade.entry_price, snapshot.observed_price),
                        4,
                    ),
                }
                summary = horizon_summary[label]
                summary["resolved_trades"] += 1
                if snapshot.raw_return_pct > 0:
                    summary["winning_trades"] += 1
                summary["avg_raw_return_pct"] += snapshot.raw_return_pct
                summary["avg_leveraged_return_pct"] += snapshot.leveraged_return_pct

            actual_execution = execution_by_trade.get(trade.id)
            trade_close = close_by_trade.get(trade.id)
            actual_execution_payload = None
            comparison_payload = None
            close_payload = None
            latest_snapshot = self._latest_snapshot(trade_snapshots)

            if trade_close:
                closed_return_pct = calculate_return_pct(
                    action=trade.action,
                    entry_price=trade.entry_price,
                    exit_price=trade_close.closed_price,
                )
                exec_closed_return_pct = None
                if actual_execution:
                    exec_closed_return_pct = round(calculate_return_pct(
                        action=actual_execution.executed_action,
                        entry_price=actual_execution.executed_price,
                        exit_price=trade_close.closed_price,
                    ), 4)
                close_payload = {
                    "id": trade_close.id,
                    "closed_price": round(trade_close.closed_price, 4),
                    "closed_at": ensure_utc(trade_close.closed_at).isoformat(),
                    "notes": trade_close.notes or "",
                    "closed_return_pct": round(closed_return_pct, 4),
                    "paper_pnl_usd": round(
                        calculate_pnl_usd(trade.action, trade.entry_price, trade_close.closed_price),
                        4,
                    ),
                    "exec_closed_return_pct": exec_closed_return_pct,
                    "exec_paper_pnl_usd": round(
                        calculate_pnl_usd(
                            actual_execution.executed_action,
                            actual_execution.executed_price,
                            trade_close.closed_price,
                        ),
                        4,
                    ) if actual_execution else None,
                }
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
                        "recommended_paper_pnl_usd": round(
                            calculate_pnl_usd(trade.action, trade.entry_price, latest_snapshot.observed_price),
                            4,
                        ),
                        "actual_paper_pnl_usd": round(
                            calculate_pnl_usd(
                                actual_execution.executed_action,
                                actual_execution.executed_price,
                                latest_snapshot.observed_price,
                            ),
                            4,
                        ),
                        "following_was_better_usd": round(
                            calculate_pnl_usd(
                                actual_execution.executed_action,
                                actual_execution.executed_price,
                                latest_snapshot.observed_price,
                            ) - calculate_pnl_usd(trade.action, trade.entry_price, latest_snapshot.observed_price),
                            4,
                        ),
                        "snapshot_price": round(latest_snapshot.observed_price, 4),
                        "snapshot_observed_at": ensure_utc(latest_snapshot.observed_at).isoformat(),
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
                    "underlying_symbol": trade.underlying_symbol,
                    "recommended_at": ensure_utc(trade.recommended_at).isoformat(),
                    "entry_price": round(trade.entry_price, 4),
                    "entry_price_timestamp": ensure_utc(trade.entry_price_timestamp).isoformat(),
                    "paper_notional_usd": PAPER_TRADE_NOTIONAL_USD,
                    "paper_shares": round(PAPER_TRADE_NOTIONAL_USD / trade.entry_price, 8) if trade.entry_price > 0 else 0.0,
                    "snapshots": snapshot_items,
                    "actual_execution": actual_execution_payload,
                    "comparison": comparison_payload,
                    "trade_close": close_payload,
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
            "paper_trade_notional_usd": PAPER_TRADE_NOTIONAL_USD,
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
            # `trade.symbol` is the actual execution ticker, so its move already includes
            # any embedded leverage/inverse behavior from the instrument itself.
            leveraged_return_pct = raw_return_pct

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
