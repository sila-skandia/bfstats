#!/usr/bin/env python3
"""Census: spawn points that seat their player in a vehicle (`setEnterOnSpawn 1`,
ledger SPAWN-25..SPAWN-27), over the EXPORTED levels of every tree (the rows of
each tree's maps.json, never the install's archives).

A spawn into a seat climbs in before the kit's weapon rig has loaded; until
2026-10-15 the rig was published visible over any seat with no drive (a
gunner's), so the player saw his rifle over the turret's view (FHSWEurope
Saipan's B-29). The behaviour audit's `spawn.seat` check spawns on each such
flag (`audit_behaviour.mjs` `seatSpawnPhase`).

    python3 surveys/census_seat_spawns.py [--trees fhsweurope,fhsw] [--json out.json]

From tools/bf1942-models. Reads scene.json only.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"


def trees() -> list[tuple[str, Path]]:
    out = [("bf1942", VIEWER / "maps")]
    for mod in json.loads((VIEWER / "models" / "mods.json").read_text()).get("mods", []):
        maps = VIEWER / "maps" / "mods" / mod["id"]
        if (maps / "maps.json").is_file():
            out.append((mod["id"], maps))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trees")
    ap.add_argument("--json")
    args = ap.parse_args()
    wanted = set(args.trees.split(",")) if args.trees else None
    report = {}
    for tree, maps in trees():
        if wanted and tree not in wanted:
            continue
        rows = json.loads((maps / "maps.json").read_text())
        levels, points, human, ai = {}, 0, 0, 0
        vehicles = collections.Counter()
        for row in rows:
            scene = maps / row["report"]
            if not scene.is_file():
                continue
            extras = json.loads(scene.read_text())
            seats = [s for s in extras.get("vehicleSoldierSpawns", [])
                     if s.get("enterOnSpawn") or s.get("aiEnterOnSpawn")]
            if not seats:
                continue
            level = row["report"].split("/")[0]
            levels[level] = sorted({s.get("vehicle") for s in seats if s.get("enterOnSpawn")})
            points += len(seats)
            human += sum(1 for s in seats if s.get("enterOnSpawn"))
            ai += sum(1 for s in seats if s.get("aiEnterOnSpawn") and not s.get("enterOnSpawn"))
            vehicles.update(s.get("vehicle") for s in seats if s.get("enterOnSpawn"))
        report[tree] = {"levels": levels, "vehicles": dict(vehicles)}
        print(f"{tree}: {len(rows)} levels; {sum(1 for v in levels.values() if v)} seat a human on spawn "
              f"({human} points, {len(vehicles)} vehicle types); {ai} more points seat a bot only")
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
