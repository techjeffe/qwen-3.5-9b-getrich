"""
Pydantic schemas for trading signals and position management
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class PositionSizing(BaseModel):
    """
    Position sizing calculations for 3x leveraged ETFs.
    Includes volatility-adjusted sizing.
    """
    account_equity: float = Field(
        default=10000.0,
        ge=1000.0,
        description="Total account equity in USD"
    )
    risk_per_trade_pct: float = Field(
        default=2.0,
        ge=0.5,
        le=5.0,
        description="Risk per trade as percentage of account"
    )
    
    # Calculated values
    dollar_risk: float = Field(default=0.0)
    position_size_usd: float = Field(default=0.0)
    shares_to_buy: float = Field(default=0.0)
    
    # Volatility adjustment
    current_volatility: float = Field(
        default=1.0,
        ge=0.5,
        le=3.0,
        description="Current ATR-based volatility factor"
    )
    adjusted_position_size: float = Field(default=0.0)

    model_config = {
        "json_schema_extra": {
            "example": {
                "account_equity": 10000.0,
                "risk_per_trade_pct": 2.0,
                "dollar_risk": 200.0,
                "position_size_usd": 600.0,
                "shares_to_buy": 24.5,
                "current_volatility": 1.2,
                "adjusted_position_size": 720.0
            }
        }
    }


class RiskParameters(BaseModel):
    """
    Risk management parameters for the trading system.
    Configurable limits and thresholds.
    """
    # Position limits
    max_position_pct: float = Field(
        default=50.0,
        ge=10.0,
        le=100.0,
        description="Maximum position size as % of account equity"
    )
    
    # Stop loss settings
    default_stop_loss_pct: float = Field(
        default=2.0,
        ge=1.0,
        le=5.0,
        description="Default stop loss percentage"
    )
    max_stop_loss_pct: float = Field(
        default=5.0,
        ge=1.0,
        le=10.0,
        description="Maximum allowed stop loss percentage"
    )
    
    # Take profit settings
    default_take_profit_pct: float = Field(
        default=3.0,
        ge=1.0,
        le=20.0,
        description="Default take profit percentage"
    )
    
    # Daily limits
    max_daily_loss_pct: float = Field(
        default=6.0,
        ge=2.0,
        le=15.0,
        description="Maximum daily loss before circuit breaker"
    )
    max_daily_trades: int = Field(
        default=3,
        ge=1,
        le=10,
        description="Maximum trades per day"
    )
    
    # Consecutive loss limits
    max_consecutive_losses: int = Field(
        default=3,
        ge=1,
        le=5,
        description="Max consecutive losses before pause"
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "max_position_pct": 50.0,
                "default_stop_loss_pct": 2.0,
                "max_stop_loss_pct": 5.0,
                "default_take_profit_pct": 3.0,
                "max_daily_loss_pct": 6.0,
                "max_daily_trades": 3,
                "max_consecutive_losses": 3
            }
        }
    }


class TradeExecution(BaseModel):
    """
    Trade execution record with timestamp and status.
    """
    trade_id: str = Field(default="")
    symbol: str = Field(default="")
    side: str = Field(default="", pattern=r"^(BUY|SELL)$")
    
    entry_price: float = Field(default=0.0)
    exit_price: Optional[float] = Field(default=None)
    
    shares: float = Field(default=0.0)
    commission: float = Field(default=0.0)
    
    pnl_unrealized: float = Field(default=0.0)
    pnl_realized: float = Field(default=0.0)
    
    status: str = Field(
        default="PENDING",
        pattern=r"^(PENDING|EXECUTED|CANCELLED|STOPPED)$"
    )
    execution_time: Optional[datetime] = Field(default=None)
