"""
yfinance Price Data Client
Fetches historical and real-time market data for ETFs/stocks
"""

import yfinance as yf
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
import pandas as pd
import numpy as np


@dataclass
class PriceData:
    """Data class for price information."""
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    timestamp: datetime


class PriceClient:
    """
    Client for fetching market data using yfinance.
    
    Features:
    - Historical OHLCV data
    - Real-time quotes
    - Multiple timeframes
    - Data caching
    """
    
    # Supported symbols for the trading system
    SUPPORTED_SYMBOLS = {"SPY", "USO", "BITO", "QQQ", "SQQQ", "UNG"}
    
    def __init__(self, cache_duration: int = 300):
        """
        Initialize price client.
        
        Args:
            cache_duration: Cache duration in seconds (default 5 min)
        """
        self.cache = {}
        self.cache_duration = cache_duration
        
    def get_historical_data(
        self,
        symbols: List[str],
        period: str = "1d",
        interval: str = "1d"
    ) -> Dict[str, pd.DataFrame]:
        """
        Fetch historical OHLCV data for multiple symbols.
        
        Args:
            symbols: List of ticker symbols
            period: Time period (1mo, 3mo, 6mo, 1y, 2y, 5y, max)
            interval: Data interval (1d, 1wk, 1mo, 1y)
            
        Returns:
            Dictionary mapping symbol to DataFrame with OHLCV data
        """
        results = {}
        
        for symbol in symbols:
            if symbol not in self.SUPPORTED_SYMBOLS:
                print(f"Warning: {symbol} not in supported symbols")
                continue
                
            try:
                # Fetch data with yfinance
                ticker = yf.Ticker(symbol)
                df = ticker.history(period=period, interval=interval)
                
                if not df.empty:
                    results[symbol] = df
                    
            except Exception as e:
                print(f"Error fetching {symbol}: {e}")
        
        return results
    
    def get_realtime_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch real-time quote using fast_info (low-latency, no full info call)."""
        try:
            fi = yf.Ticker(symbol).fast_info
            return {
                "symbol": symbol,
                "current_price": fi.last_price,
                "previous_close": fi.previous_close,
                "day_low": fi.day_low,
                "day_high": fi.day_high,
                "regular_market_volume": fi.shares,
                "timestamp": datetime.utcnow()
            }
        except Exception as e:
            print(f"Error fetching quote for {symbol}: {e}")
            return None
    
    def get_intraday_data(
        self,
        symbol: str,
        interval: str = "15m",
        period: str = "1d"
    ) -> Optional[pd.DataFrame]:
        """
        Fetch intraday data for a symbol.
        
        Args:
            symbol: Ticker symbol
            interval: Time interval (1m, 5m, 15m, 30m, 60m)
            period: Trading period (1d, 5d, 1mo)
            
        Returns:
            DataFrame with intraday OHLCV data or None on error
        """
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period, interval=interval)
            
            if not df.empty:
                return df
                
        except Exception as e:
            print(f"Error fetching intraday data for {symbol}: {e}")
        
        return None
    
    def get_price_range(
        self,
        symbol: str,
        days: int = 14
    ) -> Tuple[float, float]:
        """
        Get price range (high/low) over specified period.
        
        Args:
            symbol: Ticker symbol
            days: Number of days to look back
            
        Returns:
            Tuple of (highest_price, lowest_price)
        """
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=f"{days}d")
            
            if df.empty:
                return (0.0, 0.0)
            
            high = df["High"].max()
            low = df["Low"].min()
            
            return (high, low)
            
        except Exception as e:
            print(f"Error getting price range for {symbol}: {e}")
            return (0.0, 0.0)
    
    def calculate_volatility(
        self,
        symbol: str,
        days: int = 14
    ) -> float:
        """
        Calculate annualized volatility from price data.
        
        Args:
            symbol: Ticker symbol
            days: Number of days for calculation
            
        Returns:
            Annualized volatility as percentage
        """
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=f"{days}d")
            
            if df.empty or "Close" not in df.columns:
                return 0.0
            
            # Calculate daily returns
            returns = df["Close"].pct_change().dropna()
            
            if len(returns) < 2:
                return 0.0
            
            # Annualized volatility (daily std * sqrt(252))
            daily_vol = returns.std()
            annualized_vol = daily_vol * np.sqrt(252) * 100
            
            return annualized_vol
            
        except Exception as e:
            print(f"Error calculating volatility for {symbol}: {e}")
            return 0.0
    
    def get_ohlcv_data(
        self,
        symbol: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Optional[pd.DataFrame]:
        """
        Get OHLCV DataFrame for a symbol with custom date range.
        
        Args:
            symbol: Ticker symbol
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            
        Returns:
            DataFrame with OHLCV columns or None on error
        """
        try:
            ticker = yf.Ticker(symbol)
            
            if start_date and end_date:
                df = ticker.history(start=start_date, end=end_date)
            else:
                df = ticker.history(period="1d")
            
            if not df.empty:
                return df
                
        except Exception as e:
            print(f"Error getting OHLCV for {symbol}: {e}")
        
        return None
    
    def get_multiple_symbols_data(
        self,
        symbols: List[str],
        period: str = "1d",
        interval: str = "1d"
    ) -> pd.DataFrame:
        """
        Get aligned OHLCV data for multiple symbols.
        
        Args:
            symbols: List of ticker symbols
            period: Time period
            interval: Data interval
            
        Returns:
            DataFrame with columns: Date, Open_*, High_*, Low_*, Close_*, Volume_*
        """
        results = {}
        
        for symbol in symbols:
            if symbol not in self.SUPPORTED_SYMBOLS:
                continue
                
            try:
                ticker = yf.Ticker(symbol)
                df = ticker.history(period=period, interval=interval)
                
                if not df.empty:
                    # Rename columns to include symbol prefix
                    df.columns = [f"{symbol}_{col}" for col in df.columns]
                    results[symbol] = df
                    
            except Exception as e:
                print(f"Error fetching {symbol}: {e}")
        
        if not results:
            return pd.DataFrame()
        
        # Concatenate all DataFrames
        combined = pd.concat(results.values(), axis=1)
        
        # Sort by date and reset index
        combined = combined.sort_index()
        
        return combined
