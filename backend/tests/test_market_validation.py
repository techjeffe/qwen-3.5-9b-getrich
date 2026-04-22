from __future__ import annotations

import sys
from pathlib import Path

import pytest


sys.path.append(str(Path(__file__).resolve().parents[1]))

from services.data_ingestion.market_validation import MarketValidationClient


class DummyResponse:
    def __init__(self, text: str, status_code: int = 200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        raise NotImplementedError


def test_fred_csv_fallback_parses_latest_values(monkeypatch):
    client = MarketValidationClient()
    csv_text = "\n".join(
        [
            "DATE,VALUE",
            "2026-01-01,1.80",
            "2026-02-01,.",
            "2026-03-01,1.95",
        ]
    )

    def fake_get(url, params=None, timeout=None):
        assert "fredgraph.csv" in url
        assert params == {"id": "DFII10"}
        return DummyResponse(csv_text)

    monkeypatch.setattr(client.session, "get", fake_get)

    current, previous, as_of = client._fetch_fred_series_via_csv("DFII10")

    assert current == pytest.approx(1.95)
    assert previous == pytest.approx(1.80)
    assert as_of == "2026-03-01"


def test_eia_and_fred_bundle_builds_symbol_summaries(monkeypatch):
    client = MarketValidationClient()

    fred_rows = {
        "M2SL": "DATE,VALUE\n2026-01-01,22469.1\n2026-02-01,22667.3\n",
        "M2REAL": "DATE,VALUE\n2026-01-01,6880.0\n2026-02-01,6922.2\n",
        "DFII10": "DATE,VALUE\n2026-04-11,1.95\n2026-04-14,1.92\n",
        "BAMLH0A0HYM2": "DATE,VALUE\n2026-04-13,3.19\n2026-04-14,3.06\n",
        "BAMLC0A0CM": "DATE,VALUE\n2026-04-13,1.15\n2026-04-14,1.10\n",
    }

    eia_pages = {
        "pet_pnp_wiup_dcu_nus_w": """
        <table>
          <tr><th>History</th><th>04/03/26</th><th>04/10/26</th><th>View</th></tr>
          <tr><td>Percent Operable Utilization</td><td>92.0</td><td>89.6</td><td>1990-2026</td></tr>
        </table>
        """,
        "pet_stoc_wstk_dcu_nus_w": """
        <table>
          <tr><th>History</th><th>04/03/26</th><th>04/10/26</th><th>View</th></tr>
          <tr><td>Commercial Crude Oil (Excl. Lease Stock)</td><td>464,717</td><td>463,804</td><td>1982-2026</td></tr>
        </table>
        """,
        "pet_stoc_wstk_a_epm0f_sae_mbbl_w": """
        <table>
          <tr><th>History</th><th>04/03/26</th><th>04/10/26</th><th>View</th></tr>
          <tr><td>U.S.</td><td>14,688</td><td>13,525</td><td>1994-2026</td></tr>
        </table>
        """,
        "pet_stoc_wstk_a_epd0_sae_mbbl_w": """
        <table>
          <tr><th>History</th><th>04/03/26</th><th>04/10/26</th><th>View</th></tr>
          <tr><td>U.S.</td><td>114,681</td><td>111,559</td><td>1982-2026</td></tr>
        </table>
        """,
    }

    def fake_get(url, params=None, timeout=None):
        if "fredgraph.csv" in url:
            return DummyResponse(fred_rows[params["id"]])
        for marker, html in eia_pages.items():
            if marker in url:
                return DummyResponse(html)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(client.session, "get", fake_get)

    bundle = client.get_validation_bundle(["USO", "BITO", "QQQ", "SPY"])

    assert bundle["USO"]["status"] == "ok"
    assert "refinery utilization 89.60%" in bundle["USO"]["summary"]
    assert "commercial crude stocks 463,804 kbbl" in bundle["USO"]["summary"]

    assert bundle["BITO"]["status"] == "ok"
    assert "US M2 22,667.3" in bundle["BITO"]["summary"]
    assert "real M2 6,922.2" in bundle["BITO"]["summary"]

    assert bundle["QQQ"]["status"] == "ok"
    assert "10Y TIPS real yield 1.92%" in bundle["QQQ"]["summary"]

    assert bundle["SPY"]["status"] == "ok"
    assert "HY OAS 3.06%" in bundle["SPY"]["summary"]
    assert "IG OAS 1.10%" in bundle["SPY"]["summary"]

    prompt_context = client.build_prompt_context(bundle)
    assert "USO [OK]" in prompt_context
    assert "QQQ [OK]" in prompt_context


def test_validation_bundle_degrades_gracefully_when_sources_fail(monkeypatch):
    client = MarketValidationClient()

    def failing_get(url, params=None, timeout=None):
        raise RuntimeError("network unavailable")

    monkeypatch.setattr(client.session, "get", failing_get)

    bundle = client.get_validation_bundle(["BITO", "QQQ", "SPY"])

    assert bundle["BITO"]["status"] == "unavailable"
    assert bundle["QQQ"]["status"] == "unavailable"
    assert bundle["SPY"]["status"] == "unavailable"
    assert "No validation data available" in bundle["BITO"]["summary"]
