from __future__ import annotations

import sys
from pathlib import Path


sys.path.append(str(Path(__file__).resolve().parents[1]))

from services.app_config import _coerce_bool


def test_coerce_bool_parses_common_string_forms():
    assert _coerce_bool("true", False) is True
    assert _coerce_bool("1", False) is True
    assert _coerce_bool("yes", False) is True
    assert _coerce_bool("false", True) is False
    assert _coerce_bool("0", True) is False
    assert _coerce_bool("off", True) is False


def test_coerce_bool_falls_back_for_unknown_string_values():
    assert _coerce_bool("maybe", True) is True
    assert _coerce_bool("maybe", False) is False
