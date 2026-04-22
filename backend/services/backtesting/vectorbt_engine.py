"""
VectorBT Backtesting Engine
Implements rolling window backtesting with walk-forward optimization
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import vectorbt as vbt


@dataclass
class BacktestResult:
    """Results from a VectorBT backtest."""
    symbol: str
    total_return: float
    annualized_return: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    avg_win_pct: float
    avg_loss_pct: float
    profit_factor: float
    lookback_days: int
    walk_forward_steps: int
    entry_prices: List[float] = field(default_factory=list)
    exit_prices: List[float] = field(default_factory=list)
    trade_dates: List[datetime] = field(default_factory=list)


class VectorBTBacktester:
    """
    Backtesting engine using VectorBT for vectorized backtesting.
    
    Features:
    - Rolling window optimization (14-day lookback)
    - Walk-forward analysis
    - 3x leverage support
    - Stop-loss and take-profit management
    """
    
    # Default parameters
    DEFAULT_LEVERAGE = 3.0
    DEFAULT_STOP_LOSS_PCT = 2.0
    DEFAULT_TAKE_PROFIT_PCT = 3.0
    DEFAULT_LOOKBACK_DAYS = 14
    DEFAULT_MIN_TRADES = 5
    
    def __init__(
        self,
        leverage: float = DEFAULT_LEVERAGE,
        stop_loss_pct: float = DEFAULT_STOP_LOSS_PCT,
        take_profit_pct: float = DEFAULT_TAKE_PROFIT_PCT,
        lookback_days: int = DEFAULT_LOOKBACK_DAYS
    ):
        """
        Initialize backtester.
        
        Args:
            leverage: Position leverage (default 3x)
            stop_loss_pct: Stop loss percentage
            take_profit_pct: Take profit percentage
            lookback_days: Rolling window size for optimization
        """
        self.leverage = leverage
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.lookback_days = lookback_days
        
    def backtest(
        self,
        prices: pd.Series,
        signals: pd.Series,
        entry_prices: Optional[pd.Series] = None,
        exit_prices: Optional[pd.Series] = None
    ) -> BacktestResult:
        """
        Run backtest on price data with signals.
        
        Args:
            prices: OHLCV Close prices (pd.Series)
            signals: Binary signal series (1=long, 0=hold, -1=short)
            entry_prices: Optional entry prices for each trade
            exit_prices: Optional exit prices for each trade
            
        Returns:
            BacktestResult with performance metrics
        """
        if len(prices) < self.lookback_days + 1:
            raise ValueError(f"Insufficient data: need at least {self.lookback_days + 1} days")
        
        # Generate entry/exit signals from price changes
        if entry_prices is None or exit_prices is None:
            entry_prices, exit_prices = self._generate_signals(prices, signals)
        
        # Calculate returns with leverage
        leveraged_returns = (entry_prices / exit_prices - 1) * self.leverage
        
        # Create DataFrame for VectorBT
        df = pd.DataFrame({
            'open': prices[:-1],
            'high': prices[:-1] * 1.01,  # Approximate high
            'low': prices[:-1] * 0.99,   # Approximate low
            'close': entry_prices,
            'volume': np.random.randint(1000000, 10000000, len(entry_prices))
        })
        
        # Run VectorBT backtest
        bt = vbt.Positions.from_dataframe(
            df,
            entry=entry_prices.index,
            exit=exit_prices.index,
            leverage=self.leverage
        )
        
        # Calculate metrics
        returns = bt.returns()
        total_return = (returns.iloc[-1] * 100) if len(returns) > 0 else 0.0
        
        # Annualized return
        days = len(returns)
        annualized_return = ((1 + total_return/100) ** (252/days) - 1) * 100 if days > 0 else 0.0
        
        # Sharpe ratio (assuming 2% risk-free rate)
        risk_free_rate = 2.0
        excess_returns = returns - risk_free_rate/252
        std_returns = returns.std()
        sharpe_ratio = (excess_returns.mean() / std_returns * np.sqrt(252)) if std_returns > 0 else 0.0
        
        # Max drawdown
        cumulative = (1 + returns/100).cumprod()
        running_max = cumulative.expanding().max()
        drawdown = (cumulative - running_max) / running_max * 100
        max_drawdown = drawdown.min() if len(drawdown) > 0 else 0.0
        
        # Trade statistics
        trade_returns = bt.returns()
        winning_trades = (trade_returns > 0).sum()
        losing_trades = (trade_returns < 0).sum()
        total_trades = len(trade_returns)
        
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0.0
        
        # Average win/loss
        wins = trade_returns[trade_returns > 0]
        losses = trade_returns[trade_returns < 0]
        
        avg_win_pct = wins.mean() * 100 if len(wins) > 0 else 0.0
        avg_loss_pct = losses.mean() * 100 if len(losses) > 0 else 0.0
        
        # Profit factor
        gross_profit = abs(wins.sum()) if len(wins) > 0 else 0.0
        gross_loss = abs(losses.sum()) if len(losses) > 0 else 0.0
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        
        # Extract trade data
        entry_prices_list = entry_prices.values.tolist()
        exit_prices_list = exit_prices.values.tolist()
        trade_dates = [pd.Timestamp(idx) for idx in bt.trades.index]
        
        return BacktestResult(
            symbol="",  # Would be set by caller
            total_return=total_return,
            annualized_return=annualized_return,
            sharpe_ratio=sharpe_ratio,
            max_drawdown=max_drawdown,
            win_rate=win_rate,
            total_trades=total_trades,
            winning_trades=int(winning_trades),
            losing_trades=int(losing_trades),
            avg_win_pct=avg_win_pct,
            avg_loss_pct=avg_loss_pct,
            profit_factor=profit_factor,
            lookback_days=self.lookback_days,
            walk_forward_steps=0,  # Would be set by optimizer
            entry_prices=entry_prices_list[:20],  # Limit for display
            exit_prices=exit_prices_list[:20],
            trade_dates=trade_dates[:20]
        )
    
    def _generate_signals(
        self,
        prices: pd.Series,
        signals: pd.Series
    ) -> Tuple[pd.Series, pd.Series]:
        """
        Generate entry/exit prices from price data and signals.
        
        Args:
            prices: Close prices
            signals: Binary signal series
            
        Returns:
            Tuple of (entry_prices, exit_prices) DataFrames
        """
        # Simple strategy: enter on signal=1, exit next day
        entry_mask = signals == 1
        exit_mask = signals.shift(1) == 1
        
        entry_prices = prices.copy()
        exit_prices = prices.shift(-1).copy()
        
        return entry_prices, exit_prices
    
    def optimize_parameters(
        self,
        prices: pd.Series,
        signal_thresholds: List[float]
    ) -> Dict[str, Any]:
        """
        Optimize strategy parameters using walk-forward analysis.
        
        Args:
            prices: OHLCV Close prices
            signal_thresholds: Threshold values to test
            
        Returns:
            Dictionary with optimized parameters and performance metrics
        """
        best_params = {
            'threshold': signal_thresholds[0],
            'total_return': -float('inf'),
            'sharpe_ratio': -float('inf')
        }
        
        results = []
        
        for threshold in signal_thresholds:
            # Generate signals based on threshold
            signals = self._generate_signals_from_threshold(prices, threshold)
            
            if len(signals) < self.MIN_TRADES:
                continue
            
            # Run backtest
            result = self.backtest(prices, signals)
            
            results.append({
                'threshold': threshold,
                'total_return': result.total_return,
                'sharpe_ratio': result.sharpe_ratio,
                'max_drawdown': result.max_drawdown,
                'win_rate': result.win_rate
            })
            
            # Track best parameters
            if result.sharpe_ratio > best_params['sharpe_ratio']:
                best_params = {
                    'threshold': threshold,
                    'total_return': result.total_return,
                    'sharpe_ratio': result.sharpe_ratio,
                    'max_drawdown': result.max_drawdown,
                    'win_rate': result.win_rate
                }
        
        return {
            'best_parameters': best_params,
            'all_results': results
        }


class RollingWindowOptimizer:
    """
    Walk-forward optimizer for rolling window backtesting.
    
    Implements the walk-forward analysis technique where:
    1. Train on a lookback window
    2. Test on forward period
    3. Shift window forward and repeat
    """
    
    def __init__(
        self,
        lookback_days: int = 14,
        test_period_days: int = 7,
        step_days: int = 1
    ):
        """
        Initialize rolling window optimizer.
        
        Args:
            lookback_days: Size of training window
            test_period_days: Size of forward testing period
            step_days: Number of days to shift window each iteration
        """
        self.lookback_days = lookback_days
        self.test_period_days = test_period_days
        self.step_days = step_days
        
    def optimize(
        self,
        prices: pd.Series,
        signal_thresholds: List[float] = None
    ) -> Dict[str, Any]:
        """
        Run walk-forward optimization.
        
        Args:
            prices: OHLCV Close prices
            signal_thresholds: Threshold values to test (default: [-0.5, -0.3, -0.1, 0.1, 0.3])
            
        Returns:
            Dictionary with optimization results
        """
        if signal_thresholds is None:
            signal_thresholds = [-0.5, -0.3, -0.1, 0.1, 0.3]
        
        # Initialize backtester
        backtester = VectorBTBacktester(
            leverage=3.0,
            stop_loss_pct=2.0,
            take_profit_pct=3.0,
            lookback_days=self.lookback_days
        )
        
        results = []
        all_entry_prices = []
        all_exit_prices = []
        all_trade_dates = []
        
        # Walk-forward loop
        for i in range(0, len(prices) - self.lookback_days - self.test_period_days, self.step_days):
            # Define window boundaries
            train_end = i + self.lookback_days
            test_start = train_end
            test_end = min(train_end + self.test_period_days, len(prices))
            
            # Extract training data
            train_prices = prices.iloc[:train_end]
            
            # Generate signals for training period
            train_signals = self._generate_training_signals(
                train_prices, signal_thresholds
            )
            
            # Optimize parameters on training data
            opt_result = backtester.optimize_parameters(train_prices, signal_thresholds)
            best_threshold = opt_result['best_parameters']['threshold']
            
            # Generate signals for test period using optimized threshold
            test_signals = self._generate_test_signals(
                prices.iloc[test_start:test_end], best_threshold
            )
            
            if len(test_signals) < 1:
                continue
            
            # Get entry/exit prices for test period
            entry_prices, exit_prices = backtester._generate_signals(
                prices.iloc[test_start:test_end], test_signals
            )
            
            # Run backtest on test period
            result = backtester.backtest(
                prices.iloc[test_start:test_end],
                test_signals,
                entry_prices,
                exit_prices
            )
            
            results.append({
                'window_start': i,
                'window_end': train_end,
                'test_start': test_start,
                'test_end': test_end,
                'threshold': best_threshold,
                **result.__dict__
            })
            
            # Collect all trades for combined analysis
            all_entry_prices.extend(result.entry_prices)
            all_exit_prices.extend(result.exit_prices)
            all_trade_dates.extend(result.trade_dates)
        
        return {
            'results': results,
            'all_entry_prices': all_entry_prices,
            'all_exit_prices': all_exit_prices,
            'all_trade_dates': all_trade_dates,
            'num_windows': len(results),
            'avg_total_return': np.mean([r['total_return'] for r in results]) if results else 0.0,
            'avg_sharpe_ratio': np.mean([r['sharpe_ratio'] for r in results]) if results else 0.0,
            'avg_max_drawdown': np.mean([r['max_drawdown'] for r in results]) if results else 0.0
        }
    
    def _generate_training_signals(
        self,
        prices: pd.Series,
        thresholds: List[float]
    ) -> pd.Series:
        """Generate training signals using threshold-based logic."""
        # Simple signal generation based on price momentum
        returns = prices.pct_change()
        
        # Generate signals based on return thresholds
        signals = np.zeros(len(prices))
        for threshold in thresholds:
            mask = returns > threshold
            signals = np.maximum(signals, (mask.astype(int)))
        
        return pd.Series(signals, index=prices.index)
    
    def _generate_test_signals(
        self,
        prices: pd.Series,
        threshold: float
    ) -> pd.Series:
        """Generate test signals using optimized threshold."""
        returns = prices.pct_change()
        signals = (returns > threshold).astype(int)
        return pd.Series(signals, index=prices.index)
