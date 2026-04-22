"""
Lightweight local-first security helpers.
"""

from __future__ import annotations

import os
import secrets
from typing import Optional

from fastapi import Header, HTTPException, status


def require_admin_token(x_admin_token: Optional[str] = Header(default=None)) -> None:
    """
    Optionally require a shared admin token for sensitive routes.

    If ADMIN_API_TOKEN is unset, the app behaves as a local single-user tool and
    does not require a token. If it is set, callers must provide the same value
    via the X-Admin-Token header.
    """
    expected = os.getenv("ADMIN_API_TOKEN", "").strip()
    if not expected:
        return

    provided = (x_admin_token or "").strip()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid admin token",
        )
