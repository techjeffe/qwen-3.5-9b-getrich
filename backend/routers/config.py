"""
Configuration API router.
"""

from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.engine import get_db
from security import require_admin_token
from services.app_config import (
    config_to_dict_with_stats,
    get_or_create_app_config,
    update_app_config,
)


router = APIRouter()


@router.get("/config", tags=["Config"])
async def get_config(
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    config = get_or_create_app_config(db)
    return config_to_dict_with_stats(db, config)


@router.put("/config", tags=["Config"])
async def put_config(
    payload: Dict[str, Any],
    _admin: None = Depends(require_admin_token),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    config = update_app_config(db, payload)
    return config_to_dict_with_stats(db, config)
