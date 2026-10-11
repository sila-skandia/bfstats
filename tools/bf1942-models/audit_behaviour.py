#!/usr/bin/env python3
"""Python entry for the behavioural audit (`audit_behaviour.mjs`).

    python3 audit_behaviour.py --mod fh --levels all --quick --json out.json
    python3 audit_behaviour.py --mod fhsw --levels Gold_Beach-1944 --only kits

Runs the node harness under the shared Chromium lock (one headless browser at
a time; the owner plays on the same machine), on a port of its own, and
returns its exit status: 0 clean, 1 an unaccepted blocker or major finding,
2 the run could not be staged.  Everything after `--` is passed through.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEVERITIES = ("blocker", "major", "minor", "info")
FINDING_KEYS = ("check", "level", "template_or_kit", "severity", "cause_key",
                "evidence", "retail_faithful")


def command(args: argparse.Namespace, passthrough: list[str]) -> list[str]:
    cmd = ["flock", "/tmp/claude-1000/chromium.lock", "node", str(HERE / "audit_behaviour.mjs"),
           "--mod", args.mod, "--levels", args.levels, "--port", str(args.port)]
    if args.quick:
        cmd.append("--quick")
    if args.json:
        cmd += ["--json", args.json]
    if args.only:
        cmd += ["--only", args.only]
    if args.url:
        cmd += ["--url", args.url]
    return cmd + passthrough


def summarise(report: dict) -> dict:
    """Findings grouped by (severity, cause_key), unaccepted ones counted apart."""
    out: dict[str, dict[str, int]] = {}
    for f in report.get("findings", []):
        row = out.setdefault(f["severity"], {})
        key = f["cause_key"] + ("" if not f.get("accepted") else " [accepted]")
        row[key] = row.get(key, 0) + 1
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--mod", required=True)
    ap.add_argument("--levels", default="all")
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--json")
    ap.add_argument("--only")
    ap.add_argument("--url")
    ap.add_argument("--port", type=int, default=5310)
    args, passthrough = ap.parse_known_args()
    proc = subprocess.run(command(args, passthrough))
    if args.json and Path(args.json).exists():
        report = json.loads(Path(args.json).read_text())
        print(json.dumps(summarise(report), indent=1))
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
