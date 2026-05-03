"""
BacktestService — rolling-window backtesting bridge.

Encapsulates _run_backtest from the original router.  Delegates to
RollingWindowOptimizer (services.backtesting.optimization) but stays
lightweight — only price fetching + summary generation.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from services.backtesting.optimization import RollingWindowOptimizer
from services.data_ingestion.yfinance_client import PriceClient


class BacktestService:
    """Encapsulates rolling-window backtesting logic."""

    def __init__(self, logic_config: dict[str, Any]) -> None:
        self._L = logic_config

    async def run_backtest(
        self,
        symbols: List[str],
        sentiment_results: Dict[str, Dict],
        lookback_days: int = 14,
        risk_profile: str = "standard",
    ) -> Dict[str, Any]:
        """
        Run a rolling-window backtest for the current signal.
        Returns a dict matching BacktestResults schema fields.
        """
        optimizer = RollingWindowOptimizer(
            lookback_days=lookback_days,
            test_period_days=7,
            step_days=1,
            leverage=3.0
        )

        client = PriceClient()
        prices_data = {}

        for symbol in symbols:
            try:
                prices_df = client.get_historical_data([symbol], period="6mo")
                if symbol in prices_df and not prices_df[symbol].empty:
                    prices_data[symbol] = prices_df[symbol]['Close']
            except Exception as e:
                print(f"Error fetching {symbol} backtest data: {e}")

        if not prices_data:
            return {
                "total_return": 0.0,
                "annualized_return": 0.0,
                "sharpe_ratio": 0.0,
                "max_drawdown": 0.0,
                "win_rate": 0.0,
                "total_trades": 0,
                "lookback_days": lookback_days,
                "walk_forward_steps": 0
            }

        symbol = list(prices_data.keys())[0]
        result = optimizer.optimize(
            prices=prices_data[symbol],
            signal_thresholds=[-0.5, -0.3, -0.1, 0.1, 0.3]
        )

        summary = result.get('summary', {})
        regime_validation = result.get("regime_validation", {})
        sharpe_target = 1.0 if str(risk_profile or "").lower().strip() in {"moderate", "aggressive", "standard", "custom"} else 0.0
        sharpe_value = float(summary.get('avg_sharpe_ratio', 0.0) or 0.0)
        standard_acceptance = {
            "target_sharpe": sharpe_target,
            "passed_sharpe": sharpe_value >= sharpe_target if sharpe_target > 0 else True,
            "passed_regime_mix": bool(regime_validation.get("ok", False)),
        }
        standard_acceptance["passed"] = bool(
            standard_acceptance["passed_sharpe"] and standard_acceptance["passed_regime_mix"]
        ) if sharpe_target > 0 else bool(regime_validation.get("ok", False))

        return {
            "total_return": summary.get('avg_total_return', 0.0),
            "annualized_return": sharpe_value * 10,
            "sharpe_ratio": sharpe_value,
            "max_drawdown": summary.get('avg_max_drawdown', 0.0),
            "win_rate": 0.0,
            "total_trades": 0,
            "lookback_days": lookback_days,
            "walk_forward_steps": int(summary.get("num_windows", 0) or 0),
            "regime_validation": {
                **dict(regime_validation or {}),
                "standard_acceptance": standard_acceptance,
            },
        }
