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


def get_ollama_status(timeout: int = 3) -> Dict[str, Any]:
    """Return reachability and active-model details from Ollama."""
    ollama_root = get_ollama_root_url()
    configured_model = os.getenv("OLLAMA_MODEL", "").strip()

    response = requests.get(f"{ollama_root}/api/tags", timeout=timeout)
    response.raise_for_status()
    payload = response.json()

    models_payload = payload.get("models", []) or []
    available_models: List[str] = [
        str(model.get("name", "")).strip()
        for model in models_payload
        if str(model.get("name", "")).strip()
    ]

    active_model = ""
    resolution = "none"
    if configured_model and configured_model in available_models:
        active_model = configured_model
        resolution = "configured"
    elif available_models:
        active_model = available_models[0]
        resolution = "served"
    elif configured_model:
        active_model = configured_model
        resolution = "configured_unavailable"

    return {
        "reachable": True,
        "ollama_root": ollama_root,
        "configured_model": configured_model,
        "active_model": active_model,
        "available_models": available_models,
        "resolution": resolution,
    }
