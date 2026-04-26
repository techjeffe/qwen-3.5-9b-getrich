"""Routers package initialization"""

from fastapi import APIRouter

from .alpaca import router as alpaca_router
from .analysis import router as analysis_router
from .config import router as config_router


router = APIRouter()
router.include_router(analysis_router)
router.include_router(config_router)
router.include_router(alpaca_router)

__all__ = ["router"]
