"""
Utilities for discovering and reporting vLLM model availability.
vLLM exposes an OpenAI-compatible API; we use /health and /v1/models.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

import requests


def get_vllm_root_url() -> str:
    """Return the base vLLM URL (root only, no trailing slash)."""
    return os.getenv("VLLM_URL", "http://localhost:8000").rstrip("/")


def _extract_vllm_model_names(payload: Dict[str, Any]) -> List[str]:
    return [
        str(model.get("id", "")).strip()
        for model in (payload.get("data", []) or [])
        if str(model.get("id", "")).strip()
    ]


def get_vllm_status(timeout: int = 3) -> Dict[str, Any]:
    """Return reachability and model details from vLLM."""
    vllm_root = get_vllm_root_url()
    # Model name stored in OLLAMA_MODEL env var is backend-agnostic.
    configured_model = os.getenv("OLLAMA_MODEL", "").strip()

    try:
        health_response = requests.get(f"{vllm_root}/health", timeout=timeout)
        health_response.raise_for_status()
    except Exception as exc:
        return {
            "reachable": False,
            "ollama_root": vllm_root,
            "configured_model": configured_model,
            "active_model": "",
            "available_models": [],
            "running_models": [],
            "resolution": "none",
            "error": str(exc),
        }

    available_models: List[str] = []
    try:
        models_response = requests.get(f"{vllm_root}/v1/models", timeout=timeout)
        models_response.raise_for_status()
        available_models = _extract_vllm_model_names(models_response.json())
    except Exception:
        available_models = []

    # vLLM loads exactly one model at startup; treat it as both available and running.
    running_models = list(available_models)

    active_model = ""
    resolution = "none"
    if running_models:
        active_model = running_models[0]
        resolution = "running"
    elif configured_model:
        active_model = configured_model
        resolution = "configured_unavailable"

    return {
        "reachable": True,
        # Keep key as ollama_root so the frontend status component works unchanged.
        "ollama_root": vllm_root,
        "configured_model": configured_model,
        "active_model": active_model,
        "available_models": available_models,
        "running_models": running_models,
        "resolution": resolution,
    }
