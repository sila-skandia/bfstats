#!/usr/bin/env python3
"""The page's capture-ring estimate against a real server's captures.

Reads one or more `lab/capture_probe.mjs` logs (merged by the server's tick:
each probe logs its own soldier's server position and every control point's
ghost body) and runs `viewer/capture-rings.js` over them through
`tests/capture_ring_harness.mjs`. For each change of a point's team the
server sent, prints when the first probe stood in the radius (by the
server's position), how long after that the server's word came, and how
far ahead of the word the estimate expected it (`lead`, s; positive is
early).

    python3 lab/capture_check.py kA.ndjson [kB.ndjson] --level gazala
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "capture_ring_harness.mjs"


def merge(paths: list[str]) -> list[dict]:
    """Every probe's rows, each probe's own soldier on its own team."""
    rows: list[dict] = []
    for i, path in enumerate(paths):
        team = None
        for line in Path(path).read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("kind") == "joined":
                team = r.get("team")
            if r.get("kind") == "cs":
                r["probe"] = i
                r["team"] = team
            if r.get("kind") == "cp" and i > 0:
                continue  # one probe's control point words are enough
            rows.append(r)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("logs", nargs="+")
    ap.add_argument("--level", default="gazala")
    ap.add_argument("--mode", default="Conquest")
    ap.add_argument("--scene", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    scene = args.scene or str(ROOT / "viewer" / "maps" / args.level / "scene.json")
    with tempfile.NamedTemporaryFile("w", suffix=".ndjson", delete=False) as fh:
        for r in merge(args.logs):
            fh.write(json.dumps(r) + "\n")
        merged = fh.name
    out = subprocess.run(["node", str(HARNESS), merged, scene, args.mode], capture_output=True, text=True, check=True)
    res = json.loads(out.stdout)["capture"]
    if args.json:
        print(json.dumps(res, indent=1))
        return
    print(f"ticks {res['first']}..{res['last']}; first inside: {res['inside']}")
    print(f"{'point':28} {'tick':>6} {'from':>4} {'to':>3} {'since inside s':>14} {'estimate lead s':>15}")
    for c in res["changes"]:
        since = "" if c["sinceInside"] is None else f"{c['sinceInside']:.2f}"
        lead = "" if c["lead"] is None else f"{c['lead']:+.2f}"
        print(f"{c['name']:28} {c['tick']:>6} {c['from']:>4} {c['to']:>3} {since:>14} {lead:>15}")


if __name__ == "__main__":
    main()
