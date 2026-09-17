"""Unified Standalone E2E Test Suite Runner for Refractor Engine Map Loading Screen.

Discovers and executes 244 test cases across all four testing tiers:
- Tier 1: Feature Coverage (110 tests)
- Tier 2: Boundary & Corner Cases (110 tests)
- Tier 3: Cross-Feature Combinations (18 tests)
- Tier 4: Real-World Application Scenarios (6 tests)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unittest
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Ensure REPO_ROOT is in sys.path
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.e2e.harnesses.test_web_runtime import run_js_test_file, JsTestResult


class TestStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    SKIP = "SKIP"
    ERROR = "ERROR"


@dataclass
class TestCaseResult:
    test_id: str
    tier: int
    feature: str
    name: str
    status: TestStatus
    duration_ms: float
    message: str = ""
    traceback: str = ""


@dataclass
class TierSummary:
    tier: int
    total: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: int = 0
    duration_ms: float = 0.0

    @property
    def is_success(self) -> bool:
        return self.failed == 0 and self.errors == 0


class AnsiColor:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    GREEN = "\033[32m"
    RED = "\033[31m"
    YELLOW = "\033[33m"
    CYAN = "\033[36m"
    GRAY = "\033[90m"


FEATURE_NAMES = {
    "FEAT01": "CLI-CHROME",
    "FEAT02": "CLI-BG-VANILLA",
    "FEAT03": "CLI-BG-MODS",
    "FEAT04": "CLI-AUDIO-BIK",
    "FEAT05": "CLI-MANIFEST-GEN",
    "FEAT06": "AUDIO-PLAYBACK",
    "FEAT07": "AUDIO-FALLBACK",
    "FEAT08": "AUDIO-AUTOPLAY-TRAP",
    "FEAT09": "AUDIO-GESTURE-UNLOCK",
    "FEAT10": "AUDIO-UNMUTE-UI",
    "FEAT11": "AUDIO-FADEOUT",
    "FEAT12": "AUDIO-LOOP-SEAMLESS",
    "FEAT13": "UI-BEVELED-BOX",
    "FEAT14": "UI-TITLE-TYPO",
    "FEAT15": "UI-VIRTUAL-COORDS",
    "FEAT16": "UI-BAR-GEOMETRY",
    "FEAT17": "UI-MOD-THEMES",
    "FEAT18": "ANIM-MONOTONIC-PROGRESS",
    "FEAT19": "ANIM-WEIGHTED-STAGES",
    "FEAT20": "TRANS-SKIP-BRIEFING",
    "FEAT21": "TRANS-GPU-WARMUP",
    "FEAT22": "TRANS-DIRECT-TO-SPAWN",
}


def feature_from_id(test_id: str) -> str:
    m = re.search(r"(FEAT\d+|COMB|SCEN)", test_id)
    if m:
        key = m.group(1)
        if key == "COMB":
            return "PAIRWISE"
        if key == "SCEN":
            return "SCENARIOS"
        return FEATURE_NAMES.get(key, key)
    return "UNKNOWN"


class E2ETestRunner:
    """Unified runner executing Tier 1-4 tests."""

    def __init__(
        self,
        tier: str = "all",
        filter_pattern: Optional[str] = None,
        verbose: bool = False,
        fast: bool = False,
        json_path: Optional[str] = None,
        tap: bool = False,
        real_wine: bool = False,
    ) -> None:
        self.tier_filter = tier.lower()
        self.filter_pattern = re.compile(filter_pattern, re.IGNORECASE) if filter_pattern else None
        self.verbose = verbose
        self.fast = fast
        self.json_path = json_path
        self.tap = tap
        self.real_wine = real_wine
        self.results: List[TestCaseResult] = []

    def should_run_tier(self, tier_num: int) -> bool:
        if self.tier_filter == "all":
            return True
        return self.tier_filter == str(tier_num)

    def should_run_test(self, test_id: str, name: str) -> bool:
        if not self.filter_pattern:
            return True
        return bool(self.filter_pattern.search(test_id) or self.filter_pattern.search(name))

    def record_result(self, result: TestCaseResult) -> None:
        self.results.append(result)
        if not self.tap:
            status_color = {
                TestStatus.PASS: AnsiColor.GREEN,
                TestStatus.FAIL: AnsiColor.RED,
                TestStatus.SKIP: AnsiColor.YELLOW,
                TestStatus.ERROR: AnsiColor.RED,
            }[result.status]

            status_str = f"{status_color}{result.status.value:<5}{AnsiColor.RESET}"
            duration_str = f"{AnsiColor.GRAY}({result.duration_ms:.1f}ms){AnsiColor.RESET}"
            if self.verbose or result.status in (TestStatus.FAIL, TestStatus.ERROR):
                print(f"  {status_str}  {result.test_id}: {result.name} {duration_str}")
                if result.message:
                    # Truncate long tracebacks to first informative line
                    clean_msg = result.message.strip().splitlines()[-1]
                    print(f"         {AnsiColor.RED}{clean_msg}{AnsiColor.RESET}")

    def run(self) -> int:
        """Run all matching tests and return exit code."""
        start_time = time.perf_counter()

        if not self.tap:
            print("=" * 70)
            print(f"{AnsiColor.BOLD}REFRACTOR E2E TEST SUITE RUNNER v1.0{AnsiColor.RESET}")
            print("Target: Authentic BF1942 & Mod Map Loading Screen")
            print("=" * 70)

        # Execute Tiers
        for tier_num in (1, 2, 3, 4):
            if not self.should_run_tier(tier_num):
                continue
            self._run_tier(tier_num)

        total_duration = (time.perf_counter() - start_time) * 1000.0

        if self.tap:
            self._render_tap()
        else:
            self._render_summary(total_duration)

        if self.json_path:
            self._export_json(self.json_path, total_duration)

        # Exit code: 0 if all pass, 1 if any failure/error
        has_failure = any(r.status in (TestStatus.FAIL, TestStatus.ERROR) for r in self.results)
        return 1 if has_failure else 0

    def _run_tier(self, tier: int) -> None:
        tier_names = {
            1: "FEATURE COVERAGE",
            2: "BOUNDARY & CORNER CASES",
            3: "CROSS-FEATURE PAIRWISE COMBINATIONS",
            4: "REAL-WORLD APPLICATION SCENARIOS",
        }
        tier_start = time.perf_counter()
        if not self.tap:
            print(f"\n{AnsiColor.CYAN}[TIER {tier}: {tier_names.get(tier, 'TESTS')}]{AnsiColor.RESET}")

        initial_count = len(self.results)

        if tier == 1:
            self._run_python_module("tests.e2e.tier1.test_tier1_cli", tier=1)
            self._run_js_files([
                REPO_ROOT / "tests/e2e/tier1/test_tier1_audio.mjs",
                REPO_ROOT / "tests/e2e/tier1/test_tier1_ui.mjs",
                REPO_ROOT / "tests/e2e/tier1/test_tier1_animation.mjs",
                REPO_ROOT / "tests/e2e/tier1/test_tier1_transitions.mjs",
            ], tier=1)
        elif tier == 2:
            self._run_python_module("tests.e2e.tier2.test_tier2_cli", tier=2)
            self._run_js_files([
                REPO_ROOT / "tests/e2e/tier2/test_tier2_audio.mjs",
                REPO_ROOT / "tests/e2e/tier2/test_tier2_ui.mjs",
                REPO_ROOT / "tests/e2e/tier2/test_tier2_animation.mjs",
                REPO_ROOT / "tests/e2e/tier2/test_tier2_transitions.mjs",
            ], tier=2)
        elif tier == 3:
            self._run_python_module("tests.e2e.tier3.test_tier3_pairwise", tier=3)
        elif tier == 4:
            self._run_python_module("tests.e2e.tier4.test_tier4_scenarios", tier=4)

        tier_duration = (time.perf_counter() - tier_start)

        tier_results = self.results[initial_count:]
        t_total = len(tier_results)
        t_passed = sum(1 for r in tier_results if r.status == TestStatus.PASS)
        t_failed = sum(1 for r in tier_results if r.status in (TestStatus.FAIL, TestStatus.ERROR))
        t_skipped = sum(1 for r in tier_results if r.status == TestStatus.SKIP)

        if not self.tap and t_total > 0:
            print(
                f"  Tier {tier} Result: {t_passed}/{t_total} passed "
                f"({t_failed} failed, {t_skipped} skipped) in {tier_duration:.2f}s"
            )

    def _run_python_module(self, module_name: str, tier: int) -> None:
        try:
            loader = unittest.TestLoader()
            suite = loader.loadTestsFromName(module_name)
        except Exception as exc:
            self.record_result(TestCaseResult(
                test_id=f"T{tier}-LOAD-ERR",
                tier=tier,
                feature="RUNNER",
                name=f"Failed to load test module {module_name}",
                status=TestStatus.ERROR,
                duration_ms=0.0,
                message=str(exc),
            ))
            return

        def iter_suite(s: Any):
            for item in s:
                if isinstance(item, unittest.TestSuite):
                    yield from iter_suite(item)
                else:
                    yield item

        for test in iter_suite(suite):
            doc = getattr(test, "_testMethodDoc", None) or ""
            doc_first_line = doc.strip().splitlines()[0] if doc.strip() else ""

            # Try matching ID from docstring
            m_doc = re.match(r"^(T\d+-[A-Z0-9]+-\d+):\s*(.*)", doc_first_line)
            if m_doc:
                test_id = m_doc.group(1).strip()
                test_name = m_doc.group(2).strip()
            else:
                method_name = test._testMethodName
                m_name = re.match(r"^test_(t\d+)_([a-zA-Z0-9]+_\d+)_(.*)", method_name)
                if m_name:
                    test_id = f"{m_name.group(1).upper()}-{m_name.group(2).upper().replace('_', '-')}"
                    test_name = m_name.group(3).replace('_', ' ')
                else:
                    test_id = method_name
                    test_name = method_name

            if not self.should_run_test(test_id, test_name):
                continue

            test_single = unittest.TestSuite([test])
            result = unittest.TestResult()
            t0 = time.perf_counter()
            test_single.run(result)
            duration_ms = (time.perf_counter() - t0) * 1000.0

            if result.wasSuccessful():
                status = TestStatus.PASS
                msg = ""
                tb = ""
            elif result.failures:
                status = TestStatus.FAIL
                tb = result.failures[0][1]
                msg = tb.strip().splitlines()[-1]
            elif result.errors:
                status = TestStatus.ERROR
                tb = result.errors[0][1]
                msg = tb.strip().splitlines()[-1]
            elif result.skipped:
                status = TestStatus.SKIP
                msg = result.skipped[0][1]
                tb = ""
            else:
                status = TestStatus.PASS
                msg = ""
                tb = ""

            self.record_result(TestCaseResult(
                test_id=test_id,
                tier=tier,
                feature=feature_from_id(test_id),
                name=test_name,
                status=status,
                duration_ms=duration_ms,
                message=msg,
                traceback=tb,
            ))

    def _run_js_files(self, files: List[Path], tier: int) -> None:
        for js_file in files:
            try:
                js_results = run_js_test_file(js_file, cwd=REPO_ROOT)
                for r in js_results:
                    if not self.should_run_test(r.test_id, r.name):
                        continue
                    status_enum = TestStatus[r.status]
                    self.record_result(TestCaseResult(
                        test_id=r.test_id,
                        tier=tier,
                        feature=feature_from_id(r.test_id),
                        name=r.name,
                        status=status_enum,
                        duration_ms=r.duration_ms,
                        message=r.message,
                    ))
            except Exception as exc:
                self.record_result(TestCaseResult(
                    test_id=f"T{tier}-JS-ERR",
                    tier=tier,
                    feature="RUNNER",
                    name=f"Failed to execute JS test file {js_file.name}",
                    status=TestStatus.ERROR,
                    duration_ms=0.0,
                    message=str(exc),
                ))

    def _render_summary(self, total_duration: float) -> None:
        summaries: Dict[int, TierSummary] = {}
        for r in self.results:
            s = summaries.setdefault(r.tier, TierSummary(tier=r.tier))
            s.total += 1
            s.duration_ms += r.duration_ms
            if r.status == TestStatus.PASS:
                s.passed += 1
            elif r.status == TestStatus.FAIL:
                s.failed += 1
            elif r.status == TestStatus.SKIP:
                s.skipped += 1
            elif r.status == TestStatus.ERROR:
                s.errors += 1

        print("\n" + "=" * 70)
        print(f"{AnsiColor.BOLD}E2E TEST SUITE EXECUTION SUMMARY{AnsiColor.RESET}")
        print("=" * 70)
        print(f"{'Tier':<14} {'Total':>8} {'Passed':>8} {'Failed':>8} {'Skipped':>8} {'Duration':>10}")
        print("-" * 70)

        total_tests = len(self.results)
        total_passed = sum(1 for r in self.results if r.status == TestStatus.PASS)
        total_failed = sum(1 for r in self.results if r.status in (TestStatus.FAIL, TestStatus.ERROR))
        total_skipped = sum(1 for r in self.results if r.status == TestStatus.SKIP)

        for t in sorted(summaries.keys()):
            s = summaries[t]
            dur_str = f"{s.duration_ms / 1000.0:.2f}s"
            print(f"Tier {s.tier:<9} {s.total:>8} {s.passed:>8} {s.failed:>8} {s.skipped:>8} {dur_str:>10}")

        print("-" * 70)
        dur_tot_str = f"{total_duration / 1000.0:.2f}s"
        print(f"{'TOTAL':<14} {total_tests:>8} {total_passed:>8} {total_failed:>8} {total_skipped:>8} {dur_tot_str:>10}")
        print("=" * 70)

        if total_failed == 0 and total_tests > 0:
            print(f"{AnsiColor.GREEN}{AnsiColor.BOLD}STATUS: ALL {total_tests} TESTS PASSED (Exit Code: 0){AnsiColor.RESET}")
        elif total_tests == 0:
            print(f"{AnsiColor.YELLOW}STATUS: NO TESTS EXECUTED (Exit Code: 0){AnsiColor.RESET}")
        else:
            print(f"{AnsiColor.RED}{AnsiColor.BOLD}STATUS: {total_failed} TESTS FAILED (Exit Code: 1){AnsiColor.RESET}")

    def _render_tap(self) -> None:
        print(f"1..{len(self.results)}")
        for i, r in enumerate(self.results, 1):
            if r.status == TestStatus.PASS:
                print(f"ok {i} - {r.test_id}: {r.name}")
            elif r.status == TestStatus.SKIP:
                print(f"ok {i} - {r.test_id}: {r.name} # SKIP {r.message}")
            else:
                print(f"not ok {i} - {r.test_id}: {r.name} # {r.message}")

    def _export_json(self, path: str, duration: float) -> None:
        data = {
            "total": len(self.results),
            "passed": sum(1 for r in self.results if r.status == TestStatus.PASS),
            "failed": sum(1 for r in self.results if r.status in (TestStatus.FAIL, TestStatus.ERROR)),
            "skipped": sum(1 for r in self.results if r.status == TestStatus.SKIP),
            "duration_ms": duration,
            "results": [
                {
                    "test_id": r.test_id,
                    "tier": r.tier,
                    "feature": r.feature,
                    "name": r.name,
                    "status": r.status.value,
                    "duration_ms": r.duration_ms,
                    "message": r.message,
                }
                for r in self.results
            ],
        }
        out_path = Path(path).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unified Standalone E2E Test Suite Runner for Authentic BF1942 Loading Screen",
        prog="python3 -m tests.e2e.runner",
    )
    parser.add_argument(
        "--tier",
        choices=["1", "2", "3", "4", "all"],
        default="all",
        help="Filter execution to specific test tier (default: all)",
    )
    parser.add_argument(
        "--filter",
        dest="filter_pattern",
        type=str,
        default=None,
        help="Regex or substring filter for test ID or description",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Display verbose test execution output and timings",
    )
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Skip slower integration tests or simulated network latencies",
    )
    parser.add_argument(
        "--real-wine",
        action="store_true",
        help="Execute tests requiring real local Wine BF1942 installation",
    )
    parser.add_argument(
        "--json",
        dest="json_path",
        type=str,
        default=None,
        help="Write test results in JSON format to specified path",
    )
    parser.add_argument(
        "--tap",
        action="store_true",
        help="Emit test results in Test Anything Protocol (TAP) format",
    )

    try:
        args = parser.parse_args()
    except SystemExit as e:
        sys.exit(2 if e.code != 0 else 0)

    try:
        runner = E2ETestRunner(
            tier=args.tier,
            filter_pattern=args.filter_pattern,
            verbose=args.verbose,
            fast=args.fast,
            json_path=args.json_path,
            tap=args.tap,
            real_wine=args.real_wine,
        )
        exit_code = runner.run()
        sys.exit(exit_code)
    except Exception as exc:
        print(f"{AnsiColor.RED}Runner execution error: {exc}{AnsiColor.RESET}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(2)


if __name__ == "__main__":
    main()
