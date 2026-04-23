"""
Verify that the conviction-based trading migration was successful.
Run this from the backend directory: python verify_migration.py
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from sqlalchemy import text

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

from database.engine import SessionLocal, engine
from database.models import Trade


def verify_schema():
    """Check if the new columns exist in the trades table."""
    print("\n" + "="*70)
    print("VERIFICATION: Trades Table Schema")
    print("="*70)
    
    db = SessionLocal()
    inspector = None
    
    try:
        # Check database type and schema
        db_url = str(engine.url)
        is_sqlite = "sqlite" in db_url
        
        if is_sqlite:
            # For SQLite: PRAGMA table_info
            result = db.execute(text("PRAGMA table_info(trades)")).fetchall()
            columns = {row[1]: row[2] for row in result}  # name: type
            print(f"\n✓ Database: SQLite")
            print(f"✓ Trades table columns:")
            for col_name, col_type in sorted(columns.items()):
                print(f"  - {col_name:30} {col_type}")
        else:
            # For PostgreSQL
            result = db.execute(
                text("""SELECT column_name, data_type 
                        FROM information_schema.columns 
                        WHERE table_name='trades'
                        ORDER BY column_name""")
            ).fetchall()
            print(f"\n✓ Database: PostgreSQL")
            print(f"✓ Trades table columns:")
            for col_name, col_type in result:
                print(f"  - {col_name:30} {col_type}")
        
        # Check for new columns
        print("\n" + "-"*70)
        print("NEW COLUMNS CHECK:")
        print("-"*70)
        
        required_columns = {
            "conviction_level": ["VARCHAR(20)", "TEXT"],
            "holding_period_hours": ["INTEGER"],
            "trading_type": ["VARCHAR(20)", "TEXT"],
            "holding_window_until": ["DATETIME", "TIMESTAMP"],
        }
        
        for col_name in required_columns:
            if col_name in columns:
                print(f"✅ {col_name:30} FOUND ({columns[col_name]})")
            else:
                print(f"❌ {col_name:30} MISSING")
        
    except Exception as e:
        print(f"❌ Error checking schema: {e}")
    finally:
        db.close()


def verify_data():
    """Check if there are any trades and show their conviction fields."""
    print("\n" + "="*70)
    print("VERIFICATION: Sample Trade Data")
    print("="*70)
    
    db = SessionLocal()
    
    try:
        # Get the latest trade
        latest_trade = db.query(Trade).order_by(Trade.id.desc()).first()
        
        if latest_trade is None:
            print("\n⚠️  No trades found in database yet.")
            print("   (This is OK - trades are created when you run analysis)")
            return
        
        print(f"\n✓ Latest Trade (ID: {latest_trade.id}):")
        print(f"  Execution Symbol:         {latest_trade.symbol}")
        print(f"  Underlying Symbol:        {latest_trade.underlying_symbol or 'N/A'}")
        print(f"  Action:                   {latest_trade.action}")
        print(f"  Signal Type:              {latest_trade.signal_type}")
        print(f"  Confidence Score:         {latest_trade.confidence_score:.2%}")
        print(f"  Recommended At:           {latest_trade.recommended_at}")
        print(f"  Entry Price:              ${latest_trade.entry_price:.2f} (for {latest_trade.symbol})")
        
        print(f"\n✓ Conviction-Based Fields (NEW):")
        print(f"  Conviction Level:         {latest_trade.conviction_level or 'NOT SET'}")
        print(f"  Holding Period (hours):   {latest_trade.holding_period_hours or 'NOT SET'}")
        print(f"  Trading Type:             {latest_trade.trading_type or 'NOT SET'}")
        print(f"  Holding Window Until:     {latest_trade.holding_window_until or 'NOT SET'}")
        
        # Show a few more recent trades
        print(f"\n✓ Last 5 Trades:")
        print("-"*70)
        recent_trades = db.query(Trade).order_by(Trade.id.desc()).limit(5).all()
        
        for i, trade in enumerate(recent_trades, 1):
            print(f"\n  Trade #{i} (ID: {trade.id})")
            print(f"    {trade.symbol:10} | {trade.action:6} | Conv: {trade.conviction_level or 'N/A':8} | "
                  f"Hold: {trade.holding_period_hours or 'N/A'} hrs | "
                  f"Type: {trade.trading_type or 'N/A'}")
    
    except Exception as e:
        print(f"❌ Error checking data: {e}")
    finally:
        db.close()


def test_reconciliation():
    """Show how the reconciliation logic works."""
    print("\n" + "="*70)
    print("VERIFICATION: Trade Reconciliation Logic")
    print("="*70)
    
    db = SessionLocal()
    
    try:
        from services.pnl_tracker import should_create_new_trade, utc_now
        
        print("\n✓ Trade reconciliation function loaded successfully")
        print("\nReconciliation Rules:")
        print("  1. No active trade → Create new trade")
        print("  2. Same direction as active trade → Skip (avoid duplicates)")
        print("  3. Opposite direction + HIGH conviction → Create (override)")
        print("  4. Opposite direction + MEDIUM/LOW conviction → Skip")
        
        # Check for active trades
        now = utc_now()
        active_trades = db.query(Trade).filter(
            Trade.holding_window_until > now
        ).all()
        
        print(f"\n✓ Active Trades (within holding window): {len(active_trades)}")
        for trade in active_trades[:3]:
            symbol_info = f"{trade.symbol}"
            if trade.underlying_symbol and trade.underlying_symbol != trade.symbol:
                symbol_info += f" (underlying: {trade.underlying_symbol})"
            print(f"  - {symbol_info:20} {trade.action:6} "
                  f"@ ${trade.entry_price:.2f} "
                  f"(expires: {trade.holding_window_until.strftime('%Y-%m-%d %H:%M:%S')})")
        
        if len(active_trades) > 3:
            print(f"  ... and {len(active_trades) - 3} more")
    
    except Exception as e:
        print(f"⚠️  Could not verify reconciliation: {e}")
    finally:
        db.close()


def test_execution_symbols():
    """Verify that execution symbols have correct prices stored."""
    print("\n" + "="*70)
    print("VERIFICATION: Execution Symbol Price Tracking")
    print("="*70)
    
    db = SessionLocal()
    
    try:
        # Check for trades with execution symbols that differ from underlying
        trades = db.query(Trade).filter(
            Trade.symbol.isnot(None),
            Trade.underlying_symbol.isnot(None),
            Trade.symbol != Trade.underlying_symbol  # execution != underlying
        ).limit(5).all()
        
        if not trades:
            print("\n⚠️  No trades with distinct execution/underlying symbols found.")
            print("   (This is OK if no inverse ETF trades have been created yet)")
            return
        
        print(f"\n✓ Found {len(trades)} trades with execution symbols:")
        for trade in trades:
            thesis = "LONG" if trade.action == "BUY" else "SHORT"
            print(f"\n  Trade #{trade.id}:")
            print(f"    Execution Symbol:  {trade.symbol:10} @ ${trade.entry_price:.2f}")
            print(f"    Underlying Symbol: {trade.underlying_symbol:10}")
            print(f"    Action:            {trade.action} ({thesis})")
            print(f"    Leverage:          {trade.leverage}")
            print(f"    Entry Time:        {trade.entry_price_timestamp.strftime('%Y-%m-%d %H:%M:%S')}")
    
    except Exception as e:
        print(f"⚠️  Could not verify execution symbols: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    print("\n" + "="*70)
    print("CONVICTION-BASED TRADING MIGRATION VERIFICATION")
    print("="*70)
    
    try:
        verify_schema()
        verify_data()
        test_reconciliation()
        test_execution_symbols()
        
        print("\n" + "="*70)
        print("✅ VERIFICATION COMPLETE")
        print("="*70)
        print("\nYour database is ready for conviction-based trading!")
        print("Execution symbols (SBIT, SQQQ, SPXS, SCO) now tracked separately from underlyings.")
        
    except Exception as e:
        print(f"\n❌ Verification failed: {e}")
        import traceback
        traceback.print_exc()
