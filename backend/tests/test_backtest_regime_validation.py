from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))
pytest.importorskip("pandas")
pytest.importorskip("numpy")

from services.backtesting.optimization import RollingWindowOptimizer


def test_regime_validation_exposes_required_keys():
    import pandas as pd
    import numpy as np
    idx = pd.date_range("2025-01-01", periods=200, freq="D")
    # Build synthetic series with mixed regimes.
    up = np.linspace(100, 130, 70)
    down = np.linspace(130, 90, 70)
    chop = 100 + np.sin(np.linspace(0, 15, 60)) * 2
    prices = pd.Series(np.concatenate([up, down, chop]), index=idx[:200])

    opt = RollingWindowOptimizer()
    payload = opt.evaluate_regime_mix(prices)

    assert "ok" in payload
    assert "counts" in payload
    assert {"trending_up", "trending_down_high_vol", "range_chop"}.issubset(set(payload["counts"].keys()))
