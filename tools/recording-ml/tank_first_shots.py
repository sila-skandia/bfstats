#!/usr/bin/env python3
"""Tank guns: how often an aimed shell hits, by range and by whether the shooter stood still.

    <venv>/bin/python tools/recording-ml/tank_first_shots.py [--data ~/.cache/bfstats-recml]

Reads `tank_shots`, `tank_fights` and `recordings` (build_tables.py) and writes
`<data>/out/tank_first_shots.md` and `.json`. One recording a round (the
lead). A shot is aimed when the detector flew it within 5 m of an enemy hull
(features/battle-schools); a hit is the detector's credited hit matched back
to its shell (flatten_tank_fights.py). In a player recording a hit is a drop
in the target's hit points, so a shell that lands beside another in one
sample is not counted. Every interval is a 95% cluster bootstrap over rounds.
"""

from __future__ import annotations

import argparse
import json

from common import connect, data_dir, fmt, rows, share_ci

RANGES = [(0, 50, "under 50 m"), (50, 100, "50 to 100 m"), (100, 200, "100 to 200 m"), (200, 1e9, "200 m and over")]
STILL = 0.5  # m/s: a hull slower than this as it fired stood still
CROSSING = 2.0  # m/s across the line of fire: the target is crossing


def table(shots: list[dict]) -> dict:
    def cell(test) -> dict:
        picked = [s for s in shots if test(s)]
        return share_ci([s["hit"] for s in picked], [s["round"] for s in picked])

    out = {"all": cell(lambda s: True), "still": cell(lambda s: s["shooter_speed"] < STILL), "moving": cell(lambda s: s["shooter_speed"] >= STILL),
           "target_crossing": cell(lambda s: s["crossing_speed"] >= CROSSING), "target_not_crossing": cell(lambda s: s["crossing_speed"] < CROSSING),
           "by_range": []}
    for lo, hi, label in RANGES:
        inside = lambda s, lo=lo, hi=hi: lo <= s["range"] < hi  # noqa: E731
        out["by_range"].append({"range": label, "all": cell(inside),
                                "still": cell(lambda s: inside(s) and s["shooter_speed"] < STILL),
                                "moving": cell(lambda s: inside(s) and s["shooter_speed"] >= STILL)})
    return out


def lines(title: str, t: dict) -> list[str]:
    out = [f"## {title}", "", "| Range | All | Shooter still | Shooter moving |", "|---|---|---|---|"]
    for r in t["by_range"]:
        out.append(f"| {r['range']} | {fmt(r['all'])} | {fmt(r['still'])} | {fmt(r['moving'])} |")
    out += [f"| any | {fmt(t['all'])} | {fmt(t['still'])} | {fmt(t['moving'])} |", "",
            f"Target crossing at {CROSSING:g} m/s or more: {fmt(t['target_crossing'])}. Slower across: {fmt(t['target_not_crossing'])}.", ""]
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data")
    args = parser.parse_args()
    data = data_dir(args.data)
    db = connect(data)
    shots = rows(db, """
        SELECT s.*, r.round FROM tank_shots s JOIN recordings r USING (slug)
        WHERE r.lead AND s.aimed AND s.range IS NOT NULL""")
    first = [s for s in shots if s["aimed_number"] == 1]
    result = {"still_below": STILL, "crossing_from": CROSSING, "first_aimed": table(first), "every_aimed": table(shots)}
    out = data / "out"
    out.mkdir(parents=True, exist_ok=True)
    (out / "tank_first_shots.json").write_text(json.dumps(result, indent=1))
    text = ["# Tank guns: hit rate of aimed shells", "", "Count hit of count fired, share (95% interval over rounds).", "",
            *lines("Each side's first aimed shell of a fight", result["first_aimed"]),
            *lines("Every aimed shell", result["every_aimed"])]
    (out / "tank_first_shots.md").write_text("\n".join(text))
    print("\n".join(text))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
