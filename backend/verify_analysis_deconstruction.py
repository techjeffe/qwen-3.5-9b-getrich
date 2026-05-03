"""
Verify that analysis deconstruction is complete and enforceable.

Run from repo root:
  python3 backend/verify_analysis_deconstruction.py

Run from backend dir:
  python3 verify_analysis_deconstruction.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def _repo_and_backend_roots() -> tuple[Path, Path]:
    this_file = Path(__file__).resolve()
    if this_file.parent.name == "backend":
        backend_root = this_file.parent
        repo_root = backend_root.parent
        return repo_root, backend_root
    if this_file.parent.name == "scripts" and this_file.parent.parent.name == "backend":
        backend_root = this_file.parent.parent
        repo_root = backend_root.parent
        return repo_root, backend_root
    raise RuntimeError(f"Unexpected verify script path: {this_file}")


def _print_result(ok: bool, message: str) -> None:
    prefix = "PASS" if ok else "FAIL"
    print(f"[{prefix}] {message}")


def _existing_paths(paths: list[Path]) -> list[Path]:
    return [path for path in paths if path.exists()]


def _find_function_line(text: str, fn_name: str) -> int | None:
    pattern = re.compile(
        rf"^\s*(async\s+def|def)\s+{re.escape(fn_name)}\s*\(",
        re.MULTILINE,
    )
    match = pattern.search(text)
    if not match:
        return None
    return text[: match.start()].count("\n") + 1


def main() -> int:
    repo_root, backend_root = _repo_and_backend_roots()
    failures = 0

    required_backend_files = [
        backend_root / "config" / "market_constants.py",
        backend_root / "services" / "analysis" / "__init__.py",
        backend_root / "services" / "analysis" / "cache_service.py",
        backend_root / "services" / "analysis" / "materiality_service.py",
        backend_root / "services" / "analysis" / "hysteresis_service.py",
        backend_root / "services" / "analysis" / "sentiment_service.py",
        backend_root / "services" / "analysis" / "signal_service.py",
        backend_root / "services" / "analysis" / "market_data_service.py",
        backend_root / "services" / "analysis" / "backtest_service.py",
        backend_root / "services" / "analysis" / "persistence_service.py",
        backend_root / "services" / "analysis" / "stream_service.py",
        backend_root / "services" / "analysis" / "pipeline_service.py",
    ]
    missing_backend_files = [p for p in required_backend_files if not p.exists()]
    _print_result(not missing_backend_files, "All deconstructed modules exist under backend/")
    if missing_backend_files:
        failures += 1
        for path in missing_backend_files:
            print(f"  - missing: {path}")

    misplaced_paths = [
        repo_root / "config" / "market_constants.py",
        repo_root / "services" / "analysis",
    ]
    found_misplaced = _existing_paths(misplaced_paths)
    _print_result(not found_misplaced, "No misplaced deconstruction files at repo root")
    if found_misplaced:
        failures += 1
        for path in found_misplaced:
            print(f"  - remove or relocate: {path}")

    router_path = backend_root / "routers" / "analysis.py"
    if not router_path.exists():
        _print_result(False, f"Router file missing: {router_path}")
        return 1

    router_text = router_path.read_text(encoding="utf-8")
    line_count = router_text.count("\n") + 1
    max_lines = 1500
    _print_result(line_count <= max_lines, f"Router size check: {line_count} <= {max_lines} lines")
    if line_count > max_lines:
        failures += 1

    legacy_functions = [
        "_run_analysis_pipeline",
        "_ingest_data",
        "_get_market_snapshot",
        "_analyze_sentiment",
        "_run_red_team_review",
        "_run_backtest",
        "_save_analysis_result",
        "_save_analysis_and_trades",
        "_rolling_article_baseline",
    ]
    found_legacy = []
    for fn_name in legacy_functions:
        line = _find_function_line(router_text, fn_name)
        if line is not None:
            found_legacy.append((fn_name, line))
    _print_result(not found_legacy, "Router no longer defines legacy pipeline helper functions")
    if found_legacy:
        failures += 1
        for fn_name, line in found_legacy:
            print(f"  - {fn_name} still defined at backend/routers/analysis.py:{line}")

    local_constants_present = re.search(
        r"^\s*SYMBOL_RELEVANCE_TERMS\s*[:=]",
        router_text,
        re.MULTILINE,
    )
    _print_result(not local_constants_present, "SYMBOL_RELEVANCE_TERMS is not duplicated in router")
    if local_constants_present:
        failures += 1

    module_cache_globals = [
        r"^\s*_price_cache\s*:",
        r"^\s*_price_cache_ts\s*:",
        r"^\s*_PRICE_CACHE_TTL\s*=",
    ]
    found_cache_globals = []
    for pattern in module_cache_globals:
        match = re.search(pattern, router_text, re.MULTILINE)
        if match:
            line = router_text[: match.start()].count("\n") + 1
            found_cache_globals.append((pattern, line))
    _print_result(not found_cache_globals, "Module-level price cache globals were removed from router")
    if found_cache_globals:
        failures += 1
        for pattern, line in found_cache_globals:
            print(f"  - matched `{pattern}` at backend/routers/analysis.py:{line}")

    print("")
    if failures:
        print("Deconstruction verification FAILED.")
        print("Next action: finish router cutover to services/analysis and remove legacy helpers.")
        return 1

    print("Deconstruction verification PASSED.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
