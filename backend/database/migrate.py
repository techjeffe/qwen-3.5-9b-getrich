"""
Database migration script to add missing columns to app_config table.
Run this script to update your database schema.
"""

import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./trading_system.db"
)

def migrate():
    """Add missing columns to app_config table if they don't exist."""
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
    )
    
    with engine.connect() as conn:
        # Check if data_ingestion_interval_seconds column exists
        if "sqlite" in DATABASE_URL:
            # SQLite: check pragma table_info
            result = conn.execute(
                text("PRAGMA table_info(app_config)")
            ).fetchall()
            columns = [row[1] for row in result]
            
            if "data_ingestion_interval_seconds" not in columns:
                print("Adding data_ingestion_interval_seconds column to app_config...")
                conn.execute(
                    text(
                        "ALTER TABLE app_config ADD COLUMN data_ingestion_interval_seconds INTEGER NOT NULL DEFAULT 900"
                    )
                )
                conn.commit()
                print("✓ Column added successfully!")
            else:
                print("✓ Column data_ingestion_interval_seconds already exists.")
        else:
            # PostgreSQL/MySQL: check information_schema
            result = conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name='app_config' AND column_name='data_ingestion_interval_seconds'"
                )
            ).fetchone()
            
            if not result:
                print("Adding data_ingestion_interval_seconds column to app_config...")
                conn.execute(
                    text(
                        "ALTER TABLE app_config ADD COLUMN data_ingestion_interval_seconds INTEGER NOT NULL DEFAULT 900"
                    )
                )
                conn.commit()
                print("✓ Column added successfully!")
            else:
                print("✓ Column data_ingestion_interval_seconds already exists.")

if __name__ == "__main__":
    try:
        migrate()
        print("\n✓ Migration completed successfully!")
    except Exception as e:
        print(f"\n✗ Migration failed: {e}")
        raise
