"""
Structured market validation data sources for symbol-specific analysis.

This module fetches pullable, repeatable confirmation data from official
sources where possible:
- FRED for macro and credit series
- EIA public weekly tables for petroleum statistics

The goal is not to perfectly model every market driver, but to provide a
reliable "reality check" layer that can be fed into the LLM alongside
headline text and ETF prices.
"""

from __future__ import annotations

import csv
import io
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup


class MarketValidationClient:
    """Fetch structured validation metrics with simple in-memory caching."""

    _cache: Dict[str, Tuple[datetime, Dict[str, Dict[str, Any]]]] = {}
    _cache_ttl_seconds = 900

    FRED_API_URL = "https://api.stlouisfed.org/fred/series/observations"
    FRED_GRAPH_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"

    # Official EIA public pages that do not require an API key.
    EIA_USO_URLS = {
        "refinery_utilization": (
            "https://www.eia.gov/dnav/pet/pet_pnp_wiup_dcu_nus_w.htm",
            "Percent Operable Utilization",
            "percent",
        ),
        "commercial_crude_stocks": (
            "https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm",
            "Commercial Crude Oil (Excl. Lease Stock)",
            "thousand_barrels",
        ),
        "gasoline_stocks": (
            "https://www.eia.gov/dnav/pet/pet_stoc_wstk_a_epm0f_sae_mbbl_w.htm",
            "U.S.",
            "thousand_barrels",
        ),
        "distillate_stocks": (
            "https://www.eia.gov/dnav/pet/pet_stoc_wstk_a_epd0_sae_mbbl_w.htm",
            "U.S.",
            "thousand_barrels",
        ),
    }

    def __init__(self, timeout: int = 10):
        self.timeout = timeout
        self.session = requests.Session()
        # Avoid inheriting broken proxy settings from the runtime environment.
        self.session.trust_env = False
        self.fred_api_key = os.getenv("FRED_API_KEY", "").strip()

    def get_validation_bundle(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """Return structured validation data for the requested symbols."""
        normalized_symbols = tuple(sorted({str(symbol or "").upper().strip() for symbol in symbols if symbol}))
        cache_key = ",".join(normalized_symbols)
        cached = self._cache.get(cache_key)
        if cached and (datetime.now(timezone.utc) - cached[0]).total_seconds() < self._cache_ttl_seconds:
            return cached[1]

        bundle: Dict[str, Dict[str, Any]] = {}
        for symbol in normalized_symbols:
            if symbol == "USO":
                bundle[symbol] = self._build_uso_validation()
            elif symbol in {"BITO", "IBIT"}:
                bundle[symbol] = self._build_bito_validation(symbol)
            elif symbol == "QQQ":
                bundle[symbol] = self._build_qqq_validation()
            elif symbol == "SPY":
                bundle[symbol] = self._build_spy_validation()

        self._cache[cache_key] = (datetime.now(timezone.utc), bundle)
        return bundle

    @staticmethod
    def build_prompt_context(bundle: Dict[str, Dict[str, Any]]) -> str:
        """Condense the structured bundle into prompt-friendly plain text."""
        lines: List[str] = []
        for symbol, payload in bundle.items():
            summary = str(payload.get("summary", "")).strip()
            status = str(payload.get("status", "unavailable")).upper()
            if summary:
                lines.append(f"{symbol} [{status}]: {summary}")
        return "\n".join(lines)

    def _build_uso_validation(self) -> Dict[str, Any]:
        metrics: List[Dict[str, Any]] = []

        for metric_key, (url, row_label, unit) in self.EIA_USO_URLS.items():
            try:
                current, previous, as_of = self._fetch_eia_row(url, row_label)
                metrics.append(
                    self._build_metric(
                        name=metric_key,
                        label=self._humanize_metric_name(metric_key),
                        source="EIA",
                        source_url=url,
                        unit=unit,
                        current=current,
                        previous=previous,
                        as_of=as_of,
                    )
                )
            except Exception as exc:
                metrics.append(
                    {
                        "name": metric_key,
                        "label": self._humanize_metric_name(metric_key),
                        "source": "EIA",
                        "source_url": url,
                        "status": "unavailable",
                        "error": str(exc),
                    }
                )

        return self._finalize_symbol_payload("USO", metrics)

    def _build_bito_validation(self, symbol: str = "IBIT") -> Dict[str, Any]:
        metrics = [
            self._safe_fred_metric("m2_money_stock", "M2SL", "US M2", "billions_usd"),
            self._safe_fred_metric("real_m2_money_stock", "M2REAL", "Real M2", "billions_1982_84_usd"),
        ]
        return self._finalize_symbol_payload(symbol, metrics)

    def _build_qqq_validation(self) -> Dict[str, Any]:
        metrics = [
            self._safe_fred_metric(
                "ten_year_real_yield",
                "DFII10",
                "10Y TIPS Real Yield",
                "percent",
            )
        ]
        return self._finalize_symbol_payload("QQQ", metrics)

    def _build_spy_validation(self) -> Dict[str, Any]:
        metrics = [
            self._safe_fred_metric(
                "high_yield_oas",
                "BAMLH0A0HYM2",
                "High Yield OAS",
                "percent",
            ),
            self._safe_fred_metric(
                "investment_grade_oas",
                "BAMLC0A0CM",
                "Investment Grade OAS",
                "percent",
            ),
        ]
        return self._finalize_symbol_payload("SPY", metrics)

    def _fetch_fred_metric(
        self,
        name: str,
        series_id: str,
        label: str,
        unit: str,
    ) -> Dict[str, Any]:
        current, previous, as_of = self._fetch_fred_series(series_id)
        return self._build_metric(
            name=name,
            label=label,
            source="FRED",
            source_url=f"https://fred.stlouisfed.org/series/{series_id}",
            unit=unit,
            current=current,
            previous=previous,
            as_of=as_of,
        )

    def _safe_fred_metric(
        self,
        name: str,
        series_id: str,
        label: str,
        unit: str,
    ) -> Dict[str, Any]:
        try:
            return self._fetch_fred_metric(name, series_id, label, unit)
        except Exception as exc:
            return {
                "name": name,
                "label": label,
                "source": "FRED",
                "source_url": f"https://fred.stlouisfed.org/series/{series_id}",
                "unit": unit,
                "status": "unavailable",
                "error": str(exc),
            }

    def _fetch_fred_series(self, series_id: str) -> Tuple[float, Optional[float], str]:
        """Fetch latest and previous observations from FRED."""
        if self.fred_api_key:
            try:
                return self._fetch_fred_series_via_api(series_id)
            except Exception:
                # Fall back to public CSV download if API key path fails.
                pass
        return self._fetch_fred_series_via_csv(series_id)

    def _fetch_fred_series_via_api(self, series_id: str) -> Tuple[float, Optional[float], str]:
        response = self.session.get(
            self.FRED_API_URL,
            params={
                "series_id": series_id,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 10,
                "api_key": self.fred_api_key,
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()
        observations = payload.get("observations", [])
        usable = [
            obs for obs in observations
            if obs.get("value") not in {None, ".", ""}
        ]
        if not usable:
            raise ValueError(f"No usable FRED observations returned for {series_id}")
        current = float(usable[0]["value"])
        previous = float(usable[1]["value"]) if len(usable) > 1 else None
        as_of = str(usable[0].get("date") or "")
        return current, previous, as_of

    def _fetch_fred_series_via_csv(self, series_id: str) -> Tuple[float, Optional[float], str]:
        response = self.session.get(
            self.FRED_GRAPH_CSV_URL,
            params={"id": series_id},
            timeout=self.timeout,
        )
        response.raise_for_status()
        reader = csv.DictReader(io.StringIO(response.text))
        rows = list(reader)
        if not rows:
            raise ValueError(f"No CSV rows returned for FRED series {series_id}")

        usable: List[Tuple[str, float]] = []
        for row in rows:
            date_value = str(row.get("DATE") or row.get("observation_date") or "").strip()
            series_value = None
            for key, value in row.items():
                if key not in {"DATE", "observation_date"}:
                    series_value = str(value or "").strip()
                    break
            if not date_value or series_value in {"", ".", None}:
                continue
            usable.append((date_value, float(series_value)))

        if not usable:
            raise ValueError(f"No usable CSV observations returned for FRED series {series_id}")

        current_date, current = usable[-1]
        previous = usable[-2][1] if len(usable) > 1 else None
        return current, previous, current_date

    def _fetch_eia_row(self, url: str, row_label: str) -> Tuple[float, Optional[float], str]:
        """Scrape the latest and previous values for a labeled EIA weekly row."""
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        date_headers = self._extract_eia_date_headers(soup)
        normalized_target = self._normalize_label(row_label)

        for row in soup.find_all("tr"):
            cells = [self._clean_cell_text(cell.get_text(" ", strip=True)) for cell in row.find_all(["th", "td"])]
            if not cells:
                continue
            if self._normalize_label(cells[0]) != normalized_target:
                continue

            parsed_values = [self._parse_number(cell) for cell in cells[1:] if self._parse_number(cell) is not None]
            if not parsed_values:
                raise ValueError(f"Could not parse numeric values for row {row_label}")

            current = parsed_values[-1]
            previous = parsed_values[-2] if len(parsed_values) > 1 else None
            as_of = date_headers[-1] if date_headers else ""
            return current, previous, as_of

        raise ValueError(f"Could not find EIA row '{row_label}' at {url}")

    @staticmethod
    def _extract_eia_date_headers(soup: BeautifulSoup) -> List[str]:
        date_headers: List[str] = []
        date_pattern = re.compile(r"^\d{2}/\d{2}/\d{2}$")
        for row in soup.find_all("tr"):
            cells = [cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])]
            matches = [cell for cell in cells if date_pattern.match(cell)]
            if len(matches) >= 2:
                date_headers = matches
        return date_headers

    @staticmethod
    def _clean_cell_text(value: str) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip()

    @staticmethod
    def _normalize_label(value: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9]+", " ", str(value or "")).strip().lower()
        return re.sub(r"\s+", " ", cleaned)

    @staticmethod
    def _parse_number(value: str) -> Optional[float]:
        text = str(value or "").strip()
        if not text or text in {"-", "--", "NA", "W", "."}:
            return None
        if re.match(r"^\d{4}-\d{4}$", text):
            return None
        text = text.replace(",", "")
        try:
            return float(text)
        except ValueError:
            return None

    def _build_metric(
        self,
        name: str,
        label: str,
        source: str,
        source_url: str,
        unit: str,
        current: float,
        previous: Optional[float],
        as_of: str,
    ) -> Dict[str, Any]:
        delta = current - previous if previous is not None else None
        direction = "flat"
        if delta is not None:
            if delta > 0:
                direction = "up"
            elif delta < 0:
                direction = "down"
        return {
            "name": name,
            "label": label,
            "source": source,
            "source_url": source_url,
            "unit": unit,
            "current": current,
            "previous": previous,
            "delta": delta,
            "direction": direction,
            "as_of": as_of,
            "status": "ok",
        }

    def _finalize_symbol_payload(self, symbol: str, metrics: List[Dict[str, Any]]) -> Dict[str, Any]:
        usable = [metric for metric in metrics if metric.get("status") == "ok"]
        if usable and len(usable) == len(metrics):
            status = "ok"
        elif usable:
            status = "partial"
        else:
            status = "unavailable"

        summary = self._build_summary(symbol, usable)
        sources = sorted({str(metric.get("source_url", "")) for metric in usable if metric.get("source_url")})

        return {
            "status": status,
            "summary": summary,
            "metrics": metrics,
            "sources": sources,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    def _build_summary(self, symbol: str, metrics: List[Dict[str, Any]]) -> str:
        if not metrics:
            return "No validation data available from configured sources."

        metric_map = {metric["name"]: metric for metric in metrics}
        if symbol == "USO":
            return self._build_uso_summary(metric_map)
        if symbol in {"BITO", "IBIT"}:
            return self._build_bito_summary(metric_map)
        if symbol == "QQQ":
            return self._build_qqq_summary(metric_map)
        if symbol == "SPY":
            return self._build_spy_summary(metric_map)
        return "; ".join(self._format_metric(metric) for metric in metrics[:3])

    def _build_uso_summary(self, metric_map: Dict[str, Dict[str, Any]]) -> str:
        parts: List[str] = []
        util = metric_map.get("refinery_utilization")
        crude = metric_map.get("commercial_crude_stocks")
        gas = metric_map.get("gasoline_stocks")
        dist = metric_map.get("distillate_stocks")
        if util:
            parts.append(f"refinery utilization {self._format_metric_value(util)} ({util['direction']})")
        if crude:
            parts.append(f"commercial crude stocks {self._format_metric_value(crude)} ({crude['direction']})")
        if gas:
            parts.append(f"gasoline stocks {self._format_metric_value(gas)} ({gas['direction']})")
        if dist:
            parts.append(f"distillate stocks {self._format_metric_value(dist)} ({dist['direction']})")
        return "; ".join(parts)

    def _build_bito_summary(self, metric_map: Dict[str, Dict[str, Any]]) -> str:
        parts: List[str] = []
        m2 = metric_map.get("m2_money_stock")
        real_m2 = metric_map.get("real_m2_money_stock")
        if m2:
            parts.append(f"US M2 {self._format_metric_value(m2)} ({m2['direction']})")
        if real_m2:
            parts.append(f"real M2 {self._format_metric_value(real_m2)} ({real_m2['direction']})")
        return "; ".join(parts)

    def _build_qqq_summary(self, metric_map: Dict[str, Dict[str, Any]]) -> str:
        tips = metric_map.get("ten_year_real_yield")
        if not tips:
            return "10Y real-yield validation unavailable."
        return f"10Y TIPS real yield {self._format_metric_value(tips)} ({tips['direction']})"

    def _build_spy_summary(self, metric_map: Dict[str, Dict[str, Any]]) -> str:
        hy = metric_map.get("high_yield_oas")
        ig = metric_map.get("investment_grade_oas")
        parts: List[str] = []
        if hy:
            parts.append(f"HY OAS {self._format_metric_value(hy)} ({hy['direction']})")
        if ig:
            parts.append(f"IG OAS {self._format_metric_value(ig)} ({ig['direction']})")
        return "; ".join(parts)

    @staticmethod
    def _format_metric(metric: Dict[str, Any]) -> str:
        return f"{metric.get('label')}: {MarketValidationClient._format_metric_value(metric)}"

    @staticmethod
    def _format_metric_value(metric: Dict[str, Any]) -> str:
        current = metric.get("current")
        unit = str(metric.get("unit", ""))
        if current is None:
            return "n/a"
        if unit == "percent":
            return f"{current:.2f}%"
        if unit.startswith("billions"):
            return f"{current:,.1f}"
        if unit == "thousand_barrels":
            return f"{current:,.0f} kbbl"
        return f"{current:,.2f}"

    @staticmethod
    def _humanize_metric_name(name: str) -> str:
        return str(name or "").replace("_", " ").strip().title()
