"""
yfinance Price Data Client
Fetches historical and real-time market data for ETFs/stocks
"""

import time
import yfinance as yf
from datetime import datetime, timedelta, date as date_cls
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from zoneinfo import ZoneInfo
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
    SUPPORTED_SYMBOLS = {
        "SPY", "SPXL", "SPXS",
        "USO", "UCO", "SCO",
        "BITO", "BITU", "SBIT",
        "QQQ", "TQQQ", "SQQQ",
        "UNG",
    }
    MARKET_TZ = ZoneInfo("America/New_York")
    
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
            try:
                # Fetch data with yfinance
                ticker = yf.Ticker(symbol)
                df = ticker.history(period=period, interval=interval)
                
                if not df.empty:
                    results[symbol] = df
                    
            except Exception as e:
                print(f"Error fetching {symbol}: {e}")
        
        return results
    
    @classmethod
    def _classify_market_session(cls, ts: Optional[datetime]) -> str:
        """Classify a quote timestamp into regular / premarket / postmarket / closed."""
        if ts is None:
            return "closed"
        localized = ts.astimezone(cls.MARKET_TZ)
        if localized.weekday() >= 5:
            return "closed"
        minutes = localized.hour * 60 + localized.minute
        if 4 * 60 <= minutes < 9 * 60 + 30:
            return "premarket"
        if 9 * 60 + 30 <= minutes < 16 * 60:
            return "regular"
        if 16 * 60 <= minutes < 20 * 60:
            return "postmarket"
        return "closed"

    @classmethod
    def _is_quote_stale(cls, ts: Optional[datetime], session: str) -> bool:
        if ts is None:
            return True
        age_seconds = (datetime.now(tz=ZoneInfo("UTC")) - ts.astimezone(ZoneInfo("UTC"))).total_seconds()
        max_age = 15 * 60 if session in {"premarket", "postmarket", "regular"} else 60 * 60
        return age_seconds > max_age

    def _get_extended_hours_quote(self, ticker: yf.Ticker) -> Dict[str, Any]:
        """Fetch the latest available 1-minute bar including pre/post-market sessions."""
        try:
            df = ticker.history(period="2d", interval="1m", prepost=True, auto_adjust=False)
            if df is None or df.empty or "Close" not in df.columns:
                return {}
            closes = df["Close"].dropna()
            if closes.empty:
                return {}
            last_idx = closes.index[-1]
            last_close = float(closes.iloc[-1])
            if hasattr(last_idx, "to_pydatetime"):
                last_dt = last_idx.to_pydatetime()
            else:
                last_dt = last_idx
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=self.MARKET_TZ)
            return {
                "price": last_close,
                "timestamp": last_dt.astimezone(ZoneInfo("UTC")),
                "session": self._classify_market_session(last_dt.astimezone(ZoneInfo("UTC"))),
                "source": "yfinance_history_prepost_1m",
            }
        except Exception as e:
            print(f"Error fetching extended-hours quote: {e}")
            return {}

    def get_realtime_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch a session-aware quote, preferring extended-hours 1m bars when available."""
        try:
            ticker = yf.Ticker(symbol)
            fi = ticker.fast_info
            last_price = fi.last_price
            prev_close = fi.previous_close
            extended_quote = self._get_extended_hours_quote(ticker)

            if extended_quote.get("price") is not None:
                current_price = extended_quote["price"]
                quote_ts = extended_quote.get("timestamp") or datetime.utcnow()
                session = str(extended_quote.get("session") or "closed")
                source = str(extended_quote.get("source") or "yfinance_history_prepost_1m")
            else:
                current_price = last_price
                if current_price is None or (isinstance(current_price, float) and (current_price != current_price)):
                    current_price = prev_close
                quote_ts = datetime.utcnow()
                if quote_ts.tzinfo is None:
                    quote_ts = quote_ts.replace(tzinfo=ZoneInfo("UTC"))
                session = self._classify_market_session(quote_ts)
                source = "yfinance_fast_info"

            if current_price is None or (isinstance(current_price, float) and (current_price != current_price)):
                current_price = prev_close

            stale = self._is_quote_stale(quote_ts, session)
            return {
                "symbol": symbol,
                "current_price": current_price,
                "previous_close": prev_close,
                "day_low": fi.day_low,
                "day_high": fi.day_high,
                "timestamp": quote_ts,
                "session": session,
                "source": source,
                "is_stale": stale,
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

    def get_ohlcv_data_range(
        self,
        symbol: str,
        start: datetime,
        end: datetime,
        interval: str = "15m"
    ) -> Optional[pd.DataFrame]:
        """
        Get OHLCV data for a symbol over an explicit datetime range.

        Args:
            symbol: Ticker symbol
            start: Range start datetime
            end: Range end datetime
            interval: yfinance interval (e.g. 15m, 30m, 60m, 1d)

        Returns:
            DataFrame with OHLCV data or None on error
        """
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(start=start, end=end, interval=interval)

            if not df.empty:
                return df.sort_index()

        except Exception as e:
            print(f"Error getting OHLCV range for {symbol}: {e}")

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

    # ── Price history persistence ────────────────────────────────────────────

    def pull_and_store_history(
        self,
        symbols: List[str],
        db: Any,
        delay_seconds: float = 3.0,
        full_period: str = "14mo",
    ) -> Dict[str, Any]:
        """Pull OHLCV history for each symbol and upsert into price_history table.

        Pulls only missing dates (delta) for each symbol. Stops the entire batch
        the moment a rate-limit signal is detected, preserving what was saved.
        """
        from database.models import PriceHistory

        results: Dict[str, Any] = {}

        for symbol in symbols:
            try:
                latest_row = (
                    db.query(PriceHistory)
                    .filter(PriceHistory.symbol == symbol)
                    .order_by(PriceHistory.date.desc())
                    .first()
                )

                ticker = yf.Ticker(symbol)

                if latest_row:
                    last_date = datetime.strptime(latest_row.date, "%Y-%m-%d").date()
                    today = datetime.utcnow().date()
                    if (today - last_date).days <= 1:
                        results[symbol] = {"status": "fresh", "rows": 0, "latest": latest_row.date}
                        continue
                    start_str = (last_date + timedelta(days=1)).strftime("%Y-%m-%d")
                    df = ticker.history(start=start_str)
                else:
                    df = ticker.history(period=full_period)

                if df is None or df.empty:
                    results[symbol] = {"status": "empty", "rows": 0, "latest": None}
                else:
                    rows_added = self._upsert_price_rows(db, symbol, df)
                    latest_date = pd.Timestamp(df.index[-1]).strftime("%Y-%m-%d")
                    results[symbol] = {"status": "ok", "rows": rows_added, "latest": latest_date}

                time.sleep(delay_seconds)

            except Exception as exc:
                err = str(exc).lower()
                rate_limited = any(kw in err for kw in ["429", "rate limit", "too many", "throttle"])
                results[symbol] = {
                    "status": "rate_limited" if rate_limited else "error",
                    "error": str(exc),
                    "rows": 0,
                    "latest": None,
                }
                if rate_limited:
                    break

        return results

    def _upsert_price_rows(self, db: Any, symbol: str, df: pd.DataFrame) -> int:
        """Insert new OHLCV rows for a symbol, skipping dates already stored."""
        from database.models import PriceHistory

        date_strings = [pd.Timestamp(dt).strftime("%Y-%m-%d") for dt in df.index]

        existing_dates = {
            r.date
            for r in db.query(PriceHistory.date)
            .filter(PriceHistory.symbol == symbol, PriceHistory.date.in_(date_strings))
            .all()
        }

        new_rows = []
        for dt, row in df.iterrows():
            date_str = pd.Timestamp(dt).strftime("%Y-%m-%d")
            if date_str in existing_dates:
                continue
            close = float(row.get("Close") or 0)
            if close == 0:
                continue
            new_rows.append(PriceHistory(
                symbol=symbol,
                date=date_str,
                open=float(row.get("Open") or 0),
                high=float(row.get("High") or 0),
                low=float(row.get("Low") or 0),
                close=close,
                adj_close=close,
                volume=float(row.get("Volume") or 0),
                source="yfinance",
            ))

        if new_rows:
            db.add_all(new_rows)
            db.commit()

        return len(new_rows)

    # ── Technical indicator computation ──────────────────────────────────────

    def compute_technical_indicators(self, symbol: str, db: Any) -> Optional[Dict[str, Any]]:
        """Compute RSI, SMA, MACD, Bollinger, ATR, OBV from stored price_history rows."""
        from database.models import PriceHistory

        rows = (
            db.query(PriceHistory)
            .filter(PriceHistory.symbol == symbol, PriceHistory.close > 0)
            .order_by(PriceHistory.date.desc())
            .limit(250)
            .all()
        )

        if len(rows) < 30:
            return None

        rows = list(reversed(rows))
        closes = np.array([r.close for r in rows], dtype=float)
        highs  = np.array([r.high  for r in rows], dtype=float)
        lows   = np.array([r.low   for r in rows], dtype=float)
        volumes = np.array([r.volume for r in rows], dtype=float)

        result: Dict[str, Any] = {
            "current_price": round(float(closes[-1]), 2),
            "latest_date": rows[-1].date,
        }

        # RSI(14)
        if len(closes) >= 15:
            deltas = np.diff(closes)
            gains = np.where(deltas > 0, deltas, 0.0)
            losses = np.where(deltas < 0, -deltas, 0.0)
            avg_gain = np.mean(gains[-14:])
            avg_loss = np.mean(losses[-14:])
            rs = avg_gain / avg_loss if avg_loss > 0 else 100.0
            result["rsi_14"] = round(100 - 100 / (1 + rs), 1)

        # SMA 50 / 200 + cross signal
        if len(closes) >= 50:
            result["sma_50"] = round(float(np.mean(closes[-50:])), 2)
        if len(closes) >= 200:
            result["sma_200"] = round(float(np.mean(closes[-200:])), 2)
        if "sma_50" in result and "sma_200" in result:
            result["cross_signal"] = "golden" if result["sma_50"] > result["sma_200"] else "death"
            if len(closes) >= 210:
                old_50  = float(np.mean(closes[-210:-160]))
                old_200 = float(np.mean(closes[-210:]))
                was_golden = old_50 > old_200
                result["cross_recent"] = was_golden != (result["cross_signal"] == "golden")
            else:
                result["cross_recent"] = False

        # MACD(12, 26, 9)
        if len(closes) >= 35:
            ema12 = self._ema(closes, 12)
            ema26 = self._ema(closes, 26)
            macd_line = ema12 - ema26
            if len(macd_line) >= 9:
                signal_line = self._ema(macd_line, 9)
                result["macd"]        = round(float(macd_line[-1]), 4)
                result["macd_signal"] = round(float(signal_line[-1]), 4)
                result["macd_hist"]   = round(float(macd_line[-1] - signal_line[-1]), 4)

        # Volume ratio vs 20-day average
        if len(volumes) >= 21:
            avg_vol_20 = float(np.mean(volumes[-21:-1]))
            today_vol  = float(volumes[-1])
            result["vol_ratio_20"] = round(today_vol / avg_vol_20, 2) if avg_vol_20 > 0 else None

        # Bollinger Bands %B (20-period)
        if len(closes) >= 20:
            sma20 = float(np.mean(closes[-20:]))
            std20 = float(np.std(closes[-20:]))
            upper = sma20 + 2 * std20
            lower = sma20 - 2 * std20
            price = float(closes[-1])
            result["bb_upper"]  = round(upper, 2)
            result["bb_lower"]  = round(lower, 2)
            result["bb_sma20"]  = round(sma20, 2)
            if upper != lower:
                result["bb_pct_b"] = round((price - lower) / (upper - lower), 3)

        # ATR(14)
        if len(closes) >= 15:
            tr_list = []
            for i in range(1, 15):
                h  = float(highs[-i])
                lo = float(lows[-i])
                pc = float(closes[-i - 1])
                tr_list.append(max(h - lo, abs(h - pc), abs(lo - pc)))
            atr = float(np.mean(tr_list))
            result["atr_14"] = round(atr, 4)
            if closes[-1] > 0:
                result["atr_14_pct"] = round(atr / float(closes[-1]) * 100, 2)

        # OBV trend over last 20 sessions
        if len(closes) >= 21 and len(volumes) >= 21:
            obv = [0.0]
            for i in range(1, 21):
                if closes[-21 + i] > closes[-22 + i]:
                    obv.append(obv[-1] + volumes[-21 + i])
                elif closes[-21 + i] < closes[-22 + i]:
                    obv.append(obv[-1] - volumes[-21 + i])
                else:
                    obv.append(obv[-1])
            first_half  = float(np.mean(obv[:10]))
            second_half = float(np.mean(obv[10:]))
            result["obv_trend"] = "rising" if second_half > first_half else "falling"

        return result

    def _ema(self, values: np.ndarray, period: int) -> np.ndarray:
        alpha = 2.0 / (period + 1)
        ema = np.empty(len(values))
        ema[0] = values[0]
        for i in range(1, len(values)):
            ema[i] = alpha * values[i] + (1 - alpha) * ema[i - 1]
        return ema

    @staticmethod
    def format_technical_context(symbol: str, indicators: Dict[str, Any]) -> str:
        """Format computed indicators as a concise prompt-ready block for the LLM."""
        if not indicators:
            return ""

        date_str = indicators.get("latest_date", "unknown")
        price    = indicators.get("current_price")
        lines = [f"=== TECHNICAL ANALYSIS: {symbol} (as of {date_str}) ==="]
        if price:
            lines.append(f"Current price: ${price}")

        # RSI
        rsi = indicators.get("rsi_14")
        if rsi is not None:
            if rsi > 70:
                rsi_label = "OVERBOUGHT — reversal risk"
            elif rsi < 30:
                rsi_label = "OVERSOLD — potential bounce or continued flush"
            elif rsi > 55:
                rsi_label = "neutral-bullish"
            elif rsi < 45:
                rsi_label = "neutral-bearish"
            else:
                rsi_label = "neutral"
            lines.append(f"RSI(14): {rsi} → {rsi_label}")

        # Moving averages + cross
        sma50  = indicators.get("sma_50")
        sma200 = indicators.get("sma_200")
        cross  = indicators.get("cross_signal")
        if sma50 and sma200:
            cross_label  = "GOLDEN CROSS" if cross == "golden" else "DEATH CROSS"
            recent_flag  = " (RECENT — fresh signal)" if indicators.get("cross_recent") else ""
            lines.append(f"SMA50: ${sma50} | SMA200: ${sma200} → {cross_label}{recent_flag}")
        elif sma50:
            lines.append(f"SMA50: ${sma50} (SMA200 needs more history)")

        # MACD
        macd      = indicators.get("macd")
        macd_sig  = indicators.get("macd_signal")
        macd_hist = indicators.get("macd_hist")
        if macd is not None and macd_sig is not None and macd_hist is not None:
            if macd_hist > 0:
                mom = "bullish momentum" if macd > 0 else "bearish-to-bullish cross forming"
            else:
                mom = "bearish momentum" if macd < 0 else "bullish-to-bearish cross forming"
            lines.append(f"MACD: {macd:+.4f} | Signal: {macd_sig:+.4f} | Hist: {macd_hist:+.4f} → {mom}")

        # Volume
        vol = indicators.get("vol_ratio_20")
        if vol is not None:
            if vol > 1.5:
                vol_label = f"ELEVATED ({vol:.1f}× 20d avg) — move is volume-confirmed"
            elif vol < 0.7:
                vol_label = f"low ({vol:.1f}× 20d avg) — move lacks volume conviction"
            else:
                vol_label = f"normal ({vol:.1f}× 20d avg)"
            lines.append(f"Volume: {vol_label}")

        # Bollinger %B
        bb = indicators.get("bb_pct_b")
        if bb is not None:
            if bb > 1.0:
                bb_label = f"{bb:.2f} → ABOVE upper band (overbought extension)"
            elif bb < 0.0:
                bb_label = f"{bb:.2f} → BELOW lower band (oversold extension)"
            elif bb > 0.8:
                bb_label = f"{bb:.2f} → near upper band (stretched bullish)"
            elif bb < 0.2:
                bb_label = f"{bb:.2f} → near lower band (stretched bearish)"
            else:
                bb_label = f"{bb:.2f} → mid-band (no extreme)"
            lines.append(f"Bollinger %B: {bb_label}")

        # ATR
        atr_pct = indicators.get("atr_14_pct")
        if atr_pct is not None:
            lines.append(
                f"ATR(14): {atr_pct:.1f}% of price — "
                f"moves within this range are normal daily noise"
            )

        # OBV
        obv = indicators.get("obv_trend")
        if obv:
            obv_label = "institutional ACCUMULATION" if obv == "rising" else "institutional DISTRIBUTION"
            lines.append(f"OBV (20d): {obv.upper()} → {obv_label} signal")

        return "\n".join(lines)
