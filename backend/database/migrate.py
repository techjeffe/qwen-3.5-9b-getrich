"""
Database migration script to add missing columns to app_config table.
Run this script to update your database schema.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

from database.engine import DEFAULT_DATABASE_URL

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def migrate():
    """Apply all pending schema migrations."""
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
    )

    with engine.connect() as conn:
        if "sqlite" in DATABASE_URL:
            # ── app_config columns ──────────────────────────────────────────
            existing_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(app_config)")).fetchall()]
            for column_name, column_type, default_value in [
                ("data_ingestion_interval_seconds", "INTEGER", "900"),
                ("snapshot_retention_limit", "INTEGER", "12"),
                ("custom_symbols", "JSON", "'[]'"),
                ("display_timezone", "VARCHAR(64)", "''"),
                ("symbol_company_aliases", "JSON", "'{}'"),
                ("enabled_rss_feeds", "JSON", "'[]'"),
                ("custom_rss_feeds", "JSON", "'[]'"),
                ("custom_rss_feed_labels", "JSON", "'{}'"),
                ("rss_article_detail_mode", "VARCHAR(20)", "'normal'"),
                ("rss_article_limits", "JSON", "'{\"light\":5,\"normal\":15,\"detailed\":25}'"),
                ("extraction_model", "VARCHAR(128)", "''"),
                ("reasoning_model", "VARCHAR(128)", "''"),
                ("risk_profile", "VARCHAR(20)", "'moderate'"),
                ("web_research_enabled", "BOOLEAN", "0"),
            ]:
                if column_name not in existing_cols:
                    print(f"Adding {column_name} to app_config...")
                    conn.exec_driver_sql(f"ALTER TABLE app_config ADD COLUMN {column_name} {column_type} NOT NULL DEFAULT {default_value}")
                    conn.commit()

            # ── trades table: conviction and holding period columns ──────────
            existing_trades_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(trades)")).fetchall()]
            for column_name, column_type, default_value in [
                ("underlying_symbol", "VARCHAR(10)", "NULL"),
                ("conviction_level", "VARCHAR(20)", "'MEDIUM'"),
                ("holding_period_hours", "INTEGER", "4"),
                ("trading_type", "VARCHAR(20)", "'SWING'"),
                ("holding_window_until", "DATETIME", "NULL"),
            ]:
                if column_name not in existing_trades_cols:
                    print(f"Adding {column_name} to trades...")
                    conn.execute(text(f"ALTER TABLE trades ADD COLUMN {column_name} {column_type} DEFAULT {default_value}"))
                    conn.commit()
            
            # ── trades table: add indexes ──────────────────────────────────
            existing_indexes = [row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='index'")).fetchall()]
            for index_name, table_name, column_name in [
                ("ix_trades_underlying_symbol", "trades", "underlying_symbol"),
                ("ix_trades_holding_window_until", "trades", "holding_window_until"),
                ("ix_trades_conviction_level", "trades", "conviction_level"),
            ]:
                if index_name not in existing_indexes:
                    print(f"Creating index {index_name}...")
                    conn.execute(text(f"CREATE INDEX {index_name} ON {table_name} ({column_name})"))
                    conn.commit()

            # ── price_history table ─────────────────────────────────────────
            tables = [row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()]
            if "price_history" not in tables:
                print("Creating price_history table...")
                conn.execute(text("""
                    CREATE TABLE price_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        symbol VARCHAR(10) NOT NULL,
                        date VARCHAR(10) NOT NULL,
                        open REAL,
                        high REAL,
                        low REAL,
                        close REAL,
                        adj_close REAL,
                        volume REAL,
                        source VARCHAR(20) NOT NULL DEFAULT 'yfinance',
                        fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(symbol, date)
                    )
                """))
                conn.execute(text("CREATE INDEX ix_price_history_symbol_date ON price_history (symbol, date)"))
                conn.commit()
                print("price_history table created.")

            # ── paper_trades table ─────────────────────────────────────────
            if "paper_trades" not in tables:
                print("Creating paper_trades table...")
                conn.execute(text("""
                    CREATE TABLE paper_trades (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        underlying VARCHAR(10) NOT NULL,
                        execution_ticker VARCHAR(10) NOT NULL,
                        signal_type VARCHAR(10) NOT NULL,
                        leverage VARCHAR(10) NOT NULL DEFAULT '1x',
                        market_session VARCHAR(20),
                        amount REAL NOT NULL DEFAULT 100.0,
                        shares REAL NOT NULL,
                        entry_price REAL NOT NULL,
                        exit_price REAL,
                        entered_at DATETIME NOT NULL,
                        exited_at DATETIME,
                        realized_pnl REAL,
                        realized_pnl_pct REAL,
                        analysis_request_id VARCHAR(64)
                    )
                """))
                conn.execute(text("CREATE INDEX ix_paper_trades_underlying ON paper_trades (underlying)"))
                conn.execute(text("CREATE INDEX ix_paper_trades_entered_at ON paper_trades (entered_at)"))
                conn.execute(text("CREATE INDEX ix_paper_trades_exited_at ON paper_trades (exited_at)"))
                conn.commit()
                print("paper_trades table created.")

            # ── trade_closes table ──────────────────────────────────────────
            if "trade_closes" not in tables:
                print("Creating trade_closes table...")
                conn.execute(text("""
                    CREATE TABLE trade_closes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        trade_id INTEGER NOT NULL UNIQUE REFERENCES trades(id),
                        closed_price REAL NOT NULL,
                        closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        notes TEXT
                    )
                """))
                conn.execute(text("CREATE INDEX ix_trade_closes_trade_id ON trade_closes (trade_id)"))
                conn.commit()
                print("trade_closes table created.")
        else:
            # ── app_config columns ──────────────────────────────────────────
            for column_name, column_type, default_value in [
                ("data_ingestion_interval_seconds", "INTEGER", "900"),
                ("snapshot_retention_limit", "INTEGER", "12"),
                ("custom_symbols", "JSON", "'[]'"),
                ("display_timezone", "VARCHAR(64)", "''"),
                ("symbol_company_aliases", "JSON", "'{}'"),
                ("enabled_rss_feeds", "JSON", "'[]'"),
                ("custom_rss_feeds", "JSON", "'[]'"),
                ("custom_rss_feed_labels", "JSON", "'{}'"),
                ("rss_article_detail_mode", "VARCHAR(20)", "'normal'"),
                ("rss_article_limits", "JSON", "'{\"light\":5,\"normal\":15,\"detailed\":25}'"),
                ("extraction_model", "VARCHAR(128)", "''"),
                ("reasoning_model", "VARCHAR(128)", "''"),
                ("risk_profile", "VARCHAR(20)", "'moderate'"),
                ("web_research_enabled", "BOOLEAN", "FALSE"),
            ]:
                result = conn.execute(
                    text("SELECT column_name FROM information_schema.columns WHERE table_name='app_config' AND column_name=:col"),
                    {"col": column_name},
                ).fetchone()
                if not result:
                    print(f"Adding {column_name} to app_config...")
                    conn.exec_driver_sql(f"ALTER TABLE app_config ADD COLUMN {column_name} {column_type} NOT NULL DEFAULT {default_value}")
                    conn.commit()

            # ── trades table: conviction and holding period columns ──────────
            for column_name, column_type, default_value in [
                ("underlying_symbol", "VARCHAR(10)", "NULL"),
                ("conviction_level", "VARCHAR(20)", "'MEDIUM'"),
                ("holding_period_hours", "INTEGER", "4"),
                ("trading_type", "VARCHAR(20)", "'SWING'"),
                ("holding_window_until", "TIMESTAMP", "NULL"),
            ]:
                result = conn.execute(
                    text("SELECT column_name FROM information_schema.columns WHERE table_name='trades' AND column_name=:col"),
                    {"col": column_name},
                ).fetchone()
                if not result:
                    print(f"Adding {column_name} to trades...")
                    conn.execute(text(f"ALTER TABLE trades ADD COLUMN {column_name} {column_type} DEFAULT {default_value}"))
                    conn.commit()
            
            # ── trades table: add indexes ──────────────────────────────────
            for index_name, table_name, column_name in [
                ("ix_trades_underlying_symbol", "trades", "underlying_symbol"),
                ("ix_trades_holding_window_until", "trades", "holding_window_until"),
                ("ix_trades_conviction_level", "trades", "conviction_level"),
            ]:
                result = conn.execute(
                    text("SELECT indexname FROM pg_indexes WHERE indexname=:idx"),
                    {"idx": index_name},
                ).fetchone()
                if not result:
                    print(f"Creating index {index_name}...")
                    conn.execute(text(f"CREATE INDEX {index_name} ON {table_name} ({column_name})"))
                    conn.commit()

            # ── price_history table ─────────────────────────────────────────
            result = conn.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_name='price_history'")
            ).fetchone()
            if not result:
                print("Creating price_history table...")
                conn.execute(text("""
                    CREATE TABLE price_history (
                        id SERIAL PRIMARY KEY,
                        symbol VARCHAR(10) NOT NULL,
                        date VARCHAR(10) NOT NULL,
                        open FLOAT,
                        high FLOAT,
                        low FLOAT,
                        close FLOAT,
                        adj_close FLOAT,
                        volume FLOAT,
                        source VARCHAR(20) NOT NULL DEFAULT 'yfinance',
                        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE(symbol, date)
                    )
                """))
                conn.execute(text("CREATE INDEX ix_price_history_symbol_date ON price_history (symbol, date)"))
                conn.commit()
                print("price_history table created.")

            # ── trade_closes table ──────────────────────────────────────────
            result = conn.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_name='trade_closes'")
            ).fetchone()
            if not result:
                print("Creating trade_closes table...")
                conn.execute(text("""
                    CREATE TABLE trade_closes (
                        id SERIAL PRIMARY KEY,
                        trade_id INTEGER NOT NULL UNIQUE REFERENCES trades(id),
                        closed_price FLOAT NOT NULL,
                        closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        notes TEXT
                    )
                """))
                conn.execute(text("CREATE INDEX ix_trade_closes_trade_id ON trade_closes (trade_id)"))
                conn.commit()
                print("trade_closes table created.")


if __name__ == "__main__":
    try:
        migrate()
        print("\nMigration completed successfully!")
    except Exception as e:
        print(f"\nMigration failed: {e}")
        raise
