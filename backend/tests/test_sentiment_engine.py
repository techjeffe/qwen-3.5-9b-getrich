from __future__ import annotations

import sys
from pathlib import Path


sys.path.append(str(Path(__file__).resolve().parents[1]))

from services.sentiment.engine import SentimentEngine


def test_compute_symbol_scores_keeps_nonzero_bluster_when_mixed_rhetoric_and_substance():
    result = SentimentEngine.compute_symbol_scores(
        {
            "event_type": "regulatory",
            "confirmed": True,
            "bluster_phrases": ["could possibly", "may consider"],
            "substance_phrases": ["signed executive order", "enacted sanctions"],
            "source_count": 3,
            "symbol_relevance": {
                "QQQ": {
                    "relevant": True,
                    "direction": "bearish",
                }
            },
        },
        "QQQ",
    )

    assert result["bluster_score"] < 0.0
    assert result["bluster_score"] == -0.15
    assert result["policy_score"] > 0.0


def test_compute_symbol_scores_caps_broad_exposure_below_direct_asset_levels():
    result = SentimentEngine.compute_symbol_scores(
        {
            "event_type": "regulatory",
            "confirmed": True,
            "bluster_phrases": [],
            "substance_phrases": ["signed executive order", "enacted sanctions"],
            "source_count": 4,
            "exposure_type": "BROAD",
            "transmission_path": "Broad risk sentiment pressure on diversified equities.",
            "symbol_relevance": {
                "SPY": {
                    "relevant": True,
                    "direction": "bearish",
                    "mechanism": "Broad market sentiment weakens equities.",
                }
            },
        },
        "SPY",
    )

    assert result["exposure_type"] == "BROAD"
    assert result["transmission_path"] == "Broad risk sentiment pressure on diversified equities."
    assert result["policy_score"] == 0.4
    assert result["confidence"] <= 0.62
