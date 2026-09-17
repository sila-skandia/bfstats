"""Python bridge executing Node.js native test suites (node:test) with TAP reporter."""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class JsTestResult:
    test_id: str
    name: str
    status: str  # "PASS", "FAIL", "SKIP"
    duration_ms: float
    message: str = ""


def parse_tap_output(tap_text: str) -> list[JsTestResult]:
    """Parses TAP version 13 output emitted by node --test --test-reporter=tap."""
    results: list[JsTestResult] = []
    lines = tap_text.splitlines()

    # Pattern for "ok 1 - T1-FEAT06-01: Name # SKIP message"
    # or "not ok 2 - T1-FEAT06-02: Name"
    test_re = re.compile(r"^(ok|not ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s*(SKIP|TODO)\s*(.*))?$")
    duration_re = re.compile(r"^\s+duration_ms:\s+([0-9.]+)")

    current_result: JsTestResult | None = None

    for line in lines:
        m = test_re.match(line)
        if m:
            outcome, full_title, directive, message = m.groups()
            parts = full_title.split(":", 1)
            if len(parts) == 2:
                test_id = parts[0].strip()
                name = parts[1].strip()
            else:
                test_id = full_title.strip()
                name = full_title.strip()

            if directive == "SKIP":
                status = "SKIP"
                msg = message or ""
            elif outcome == "ok":
                status = "PASS"
                msg = ""
            else:
                status = "FAIL"
                msg = message or "Test failed"

            current_result = JsTestResult(
                test_id=test_id,
                name=name,
                status=status,
                duration_ms=1.0,
                message=msg,
            )
            results.append(current_result)
            continue

        if current_result is not None:
            dur_m = duration_re.match(line)
            if dur_m:
                try:
                    current_result.duration_ms = float(dur_m.group(1))
                except ValueError:
                    pass

    return results


def run_js_test_file(test_file: Path, cwd: Path | None = None) -> list[JsTestResult]:
    """Executes a JavaScript/MJS test file using Node.js native test runner."""
    test_path = Path(test_file).resolve()
    if not test_path.is_file():
        raise FileNotFoundError(f"JS test file not found: {test_path}")

    project_root = cwd or Path(__file__).resolve().parents[3]
    cmd = [
        "node",
        "--test",
        "--test-reporter=tap",
        str(test_path),
    ]

    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=project_root,
    )

    results = parse_tap_output(proc.stdout)
    if not results and proc.returncode != 0:
        # File level compilation / import failure
        results.append(JsTestResult(
            test_id=test_path.stem.upper(),
            name=f"Execution of {test_path.name}",
            status="FAIL",
            duration_ms=0.0,
            message=proc.stderr.strip() or proc.stdout.strip(),
        ))
    return results
