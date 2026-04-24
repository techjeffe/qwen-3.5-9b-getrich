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
                ("allow_extended_hours_trading", "BOOLEAN", "1"),
                ("remote_snapshot_enabled", "BOOLEAN", "0"),
                ("remote_snapshot_mode", "VARCHAR(20)", "'telegram'"),
                ("remote_snapshot_min_pnl_change_usd", "REAL", "5.0"),
                ("remote_snapshot_heartbeat_minutes", "INTEGER", "360"),
                ("remote_snapshot_interval_minutes", "INTEGER", "360"),
                ("remote_snapshot_send_on_position_change", "BOOLEAN", "1"),
                ("remote_snapshot_include_closed_trades", "BOOLEAN", "0"),
                ("remote_snapshot_max_recommendations", "INTEGER", "4"),
                ("last_remote_snapshot_sent_at", "DATETIME", "NULL"),
                ("last_remote_snapshot_request_id", "VARCHAR(36)", "NULL"),
                ("last_remote_snapshot_net_pnl", "REAL", "NULL"),
                ("last_remote_snapshot_recommendation_fingerprint", "VARCHAR(255)", "NULL"),
                ("analysis_lock_request_id", "VARCHAR(36)", "NULL"),
                ("analysis_lock_acquired_at", "DATETIME", "NULL"),
                ("analysis_lock_expires_at", "DATETIME", "NULL"),
            ]:
                if column_name not in existing_cols:
                    print(f"Adding {column_name} to app_config...")
                    nullable = default_value == "NULL"
                    null_sql = "" if nullable else " NOT NULL"
                    default_sql = "" if nullable else f" DEFAULT {default_value}"
                    conn.exec_driver_sql(f"ALTER TABLE app_config ADD COLUMN {column_name} {column_type}{null_sql}{default_sql}")
                    conn.commit()

            # ── app_config: nullable trading-logic override columns ─────────
            for column_name, column_type in [
                ("paper_trade_amount", "REAL"),
                ("entry_threshold", "REAL"),
                ("stop_loss_pct", "REAL"),
                ("take_profit_pct", "REAL"),
                ("materiality_min_posts_delta", "INTEGER"),
                ("materiality_min_sentiment_delta", "REAL"),
            ]:
                if column_name not in existing_cols:
                    print(f"Adding {column_name} to app_config...")
                    conn.exec_driver_sql(f"ALTER TABLE app_config ADD COLUMN {column_name} {column_type}")
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
                ("ix_app_config_analysis_lock_expires_at", "app_config", "analysis_lock_expires_at"),
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
            else:
                # ── paper_trades: add conviction/window columns if missing ──
                existing_pt_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(paper_trades)")).fetchall()]
                for column_name, column_type in [
                    ("conviction_level",    "VARCHAR(10)"),
                    ("trading_type",        "VARCHAR(20)"),
                    ("holding_period_hours","INTEGER"),
                    ("holding_window_until","DATETIME"),
                    ("close_reason",        "VARCHAR(40)"),
                    ("trailing_stop_price", "REAL"),
                    ("best_price_seen",     "REAL"),
                ]:
                    if column_name not in existing_pt_cols:
                        print(f"Adding {column_name} to paper_trades...")
                        conn.exec_driver_sql(f"ALTER TABLE paper_trades ADD COLUMN {column_name} {column_type}")
                        conn.commit()

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

            if "scraped_articles" not in tables:
                print("Creating scraped_articles table...")
                conn.execute(text("""
                    CREATE TABLE scraped_articles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        source VARCHAR(100) NOT NULL,
                        url TEXT NOT NULL UNIQUE,
                        title TEXT NOT NULL DEFAULT '',
                        summary TEXT NOT NULL DEFAULT '',
                        full_content TEXT NOT NULL DEFAULT '',
                        published_at DATETIME,
                        discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        processed BOOLEAN NOT NULL DEFAULT 0,
                        fast_lane_triggered BOOLEAN NOT NULL DEFAULT 0
                    )
                """))
                conn.execute(text("CREATE INDEX ix_scraped_articles_processed ON scraped_articles (processed)"))
                conn.execute(text("CREATE INDEX ix_scraped_articles_published_at ON scraped_articles (published_at)"))
                conn.execute(text("CREATE INDEX ix_scraped_articles_discovered_at ON scraped_articles (discovered_at)"))
                conn.commit()
                print("scraped_articles table created.")
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
                ("allow_extended_hours_trading", "BOOLEAN", "TRUE"),
                ("remote_snapshot_enabled", "BOOLEAN", "FALSE"),
                ("remote_snapshot_mode", "VARCHAR(20)", "'telegram'"),
                ("remote_snapshot_min_pnl_change_usd", "FLOAT", "5.0"),
                ("remote_snapshot_heartbeat_minutes", "INTEGER", "360"),
                ("remote_snapshot_interval_minutes", "INTEGER", "360"),
                ("remote_snapshot_send_on_position_change", "BOOLEAN", "TRUE"),
                ("remote_snapshot_include_closed_trades", "BOOLEAN", "FALSE"),
                ("remote_snapshot_max_recommendations", "INTEGER", "4"),
                ("last_remote_snapshot_sent_at", "TIMESTAMPTZ", "NULL"),
                ("last_remote_snapshot_request_id", "VARCHAR(36)", "NULL"),
                ("last_remote_snapshot_net_pnl", "FLOAT", "NULL"),
                ("last_remote_snapshot_recommendation_fingerprint", "VARCHAR(255)", "NULL"),
                ("analysis_lock_request_id", "VARCHAR(36)", "NULL"),
                ("analysis_lock_acquired_at", "TIMESTAMPTZ", "NULL"),
                ("analysis_lock_expires_at", "TIMESTAMPTZ", "NULL"),
            ]:
                result = conn.execute(
                    text("SELECT column_name FROM information_schema.columns WHERE table_name='app_config' AND column_name=:col"),
                    {"col": column_name},
                ).fetchone()
                if not result:
                    print(f"Adding {column_name} to app_config...")
                    nullable = default_value == "NULL"
                    null_sql = "" if nullable else " NOT NULL"
                    default_sql = "" if nullable else f" DEFAULT {default_value}"
                    conn.exec_driver_sql(f"ALTER TABLE app_config ADD COLUMN {column_name} {column_type}{null_sql}{default_sql}")
                    conn.commit()

            # ── app_config: nullable trading-logic override columns ─────────
            for column_name, column_type in [
                ("paper_trade_amount", "FLOAT"),
                ("entry_threshold", "FLOAT"),
                ("stop_loss_pct", "FLOAT"),
                ("take_profit_pct", "FLOAT"),
                ("materiality_min_posts_delta", "INTEGER"),
                ("materiality_min_sentiment_delta", "FLOAT"),
            ]:
                result = conn.execute(
                    text("SELECT column_name FROM information_schema.columns WHERE table_name='app_config' AND column_name=:col"),
                    {"col": column_name},
                ).fetchone()
                if not result:
                    print(f"Adding {column_name} to app_config...")
                    conn.execute(text(f"ALTER TABLE app_config ADD COLUMN {column_name} {column_type}"))
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
                ("ix_app_config_analysis_lock_expires_at", "app_config", "analysis_lock_expires_at"),
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
            result = conn.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_name='scraped_articles'")
            ).fetchone()
            if not result:
                print("Creating scraped_articles table...")
                conn.execute(text("""
                    CREATE TABLE scraped_articles (
                        id SERIAL PRIMARY KEY,
                        source VARCHAR(100) NOT NULL,
                        url TEXT NOT NULL UNIQUE,
                        title TEXT NOT NULL DEFAULT '',
                        summary TEXT NOT NULL DEFAULT '',
                        full_content TEXT NOT NULL DEFAULT '',
                        published_at TIMESTAMPTZ,
                        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        processed BOOLEAN NOT NULL DEFAULT FALSE,
                        fast_lane_triggered BOOLEAN NOT NULL DEFAULT FALSE
                    )
                """))
                conn.execute(text("CREATE INDEX ix_scraped_articles_processed ON scraped_articles (processed)"))
                conn.execute(text("CREATE INDEX ix_scraped_articles_published_at ON scraped_articles (published_at)"))
                conn.execute(text("CREATE INDEX ix_scraped_articles_discovered_at ON scraped_articles (discovered_at)"))
                conn.commit()
                print("scraped_articles table created.")

            # ── paper_trades: add conviction/window columns if missing ───────
            for column_name, column_type in [
                ("conviction_level",    "VARCHAR(10)"),
                ("trading_type",        "VARCHAR(20)"),
                ("holding_period_hours","INTEGER"),
                ("holding_window_until","TIMESTAMPTZ"),
                ("close_reason",        "VARCHAR(40)"),
                ("trailing_stop_price", "FLOAT"),
                ("best_price_seen",     "FLOAT"),
            ]:
                result = conn.execute(
                    text("SELECT column_name FROM information_schema.columns WHERE table_name='paper_trades' AND column_name=:col"),
                    {"col": column_name},
                ).fetchone()
                if not result:
                    print(f"Adding {column_name} to paper_trades...")
                    conn.execute(text(f"ALTER TABLE paper_trades ADD COLUMN {column_name} {column_type}"))
                    conn.commit()

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
