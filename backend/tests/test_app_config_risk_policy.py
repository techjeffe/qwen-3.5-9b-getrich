from __future__ import annotations

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from services.app_config import _normalize_risk_policy, DEFAULT_RISK_POLICY


def test_normalize_risk_policy_falls_back_to_defaults():
    assert _normalize_risk_policy(None) == DEFAULT_RISK_POLICY


def test_normalize_risk_policy_merges_crazy_ramp_fields():
    payload = {
        "crazy_ramp": {
            "threshold_source": "fallback",
            "fetch_timeout_ms": 1234,
        }
    }
    normalized = _normalize_risk_policy(payload)
    assert normalized["crazy_ramp"]["threshold_source"] == "fallback"
    assert normalized["crazy_ramp"]["fetch_timeout_ms"] == 1234
    assert "bucket_thresholds" in normalized["crazy_ramp"]
