"""
Utilities for discovering and reporting Ollama model availability.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

import requests


def get_ollama_root_url() -> str:
    """Return the base Ollama URL without the generate path."""
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate").strip()
    return ollama_url.replace("/api/generate", "")


def _extract_model_names(payload: Dict[str, Any]) -> List[str]:
    return [
        str(model.get("name", "")).strip()
        for model in (payload.get("models", []) or [])
        if str(model.get("name", "")).strip()
    ]


def get_ollama_status(timeout: int = 3) -> Dict[str, Any]:
    """Return reachability and active-model details from Ollama."""
    ollama_root = get_ollama_root_url()
    configured_model = os.getenv("OLLAMA_MODEL", "").strip()

    tags_response = requests.get(f"{ollama_root}/api/tags", timeout=timeout)
    tags_response.raise_for_status()
    tags_payload = tags_response.json()
    available_models = _extract_model_names(tags_payload)

    running_models: List[str] = []
    try:
        ps_response = requests.get(f"{ollama_root}/api/ps", timeout=timeout)
        ps_response.raise_for_status()
        ps_payload = ps_response.json()
        running_models = _extract_model_names(ps_payload)
    except Exception:
        running_models = []

    active_model = ""
    resolution = "none"
    if running_models:
        active_model = running_models[0]
        resolution = "running"
    elif configured_model and configured_model in available_models:
        active_model = configured_model
        resolution = "configured"
    elif available_models:
        active_model = available_models[0]
        resolution = "installed"
    elif configured_model:
        active_model = configured_model
        resolution = "configured_unavailable"

    return {
        "reachable": True,
        "ollama_root": ollama_root,
        "configured_model": configured_model,
        "active_model": active_model,
        "available_models": available_models,
        "running_models": running_models,
        "resolution": resolution,
    }
