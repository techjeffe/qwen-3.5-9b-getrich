"""
Database connection setup using SQLAlchemy with SQLite.
"""

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT_DB_PATH = REPO_ROOT / "trading_system.db"
LEGACY_BACKEND_DB_PATH = REPO_ROOT / "backend" / "trading_system.db"
DEFAULT_DATABASE_URL = f"sqlite:///{ROOT_DB_PATH.as_posix()}"

# Database URL from environment or default to the repo-root SQLite file
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)

# Create engine with SQLite-specific settings for file-based DB
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

# Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False
)


def get_db() -> Generator[Session, None, None]:
    """
    Dependency for FastAPI that provides database session.
    Yields a new database session for each request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Configure SQLite pragmas for better performance."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=10000")
    cursor.close()
