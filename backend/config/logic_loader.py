"""
Singleton loader for trading logic configuration.

Reads logic_config.json once at startup. The DB-editable fields (paper_trade_amount,
entry_threshold, stop_loss_pct, take_profit_pct, materiality_min_posts_delta,
materiality_min_sentiment_delta) are overridden at call-time by app_config.py when
a user has changed them via the admin UI.

Usage:
    from config.logic_loader import LOGIC
    threshold = LOGIC["entry_thresholds"]["normal"]
"""

import json
from pathlib import Path
from typing import Any, Dict

_config: Dict[str, Any] = {}


def _load() -> Dict[str, Any]:
    path = Path(__file__).parent / "logic_config.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def get_logic_config() -> Dict[str, Any]:
    global _config
    if not _config:
        _config = _load()
    return _config


LOGIC: Dict[str, Any] = get_logic_config()
