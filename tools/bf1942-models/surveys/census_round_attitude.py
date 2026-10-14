#!/usr/bin/env python3
"""Census: full-body rounds whose every Engine and Wing sits on the round's
centre of mass, and rounds whose motor is turned off the nose, on the EXPORTED
levels of every tree (the rows of each tree's maps.json; FHSW and FHSWEurope:
the rows with a `loading` block).

Nothing turns such a round (PHY-21), so it keeps its launch attitude, and its
motor pushes along the Engine's own row (PHY-20). Until 2026-10-15 the viewer
held every full body's nose on its flight path and pushed every motor along
it, and FHSW's Norden bombs flew 650 to 980 m past the A-26's bomb sight
(`viewer/rocket-motor.js` `partsOnCentre`, `projectile-flight.js` `motorAxis`).

    python3 surveys/census_round_attitude.py [--trees fhsweurope,fhsw] [--json -]

From tools/bf1942-models. Reads the level glbs' JSON chunks.
"""

from __future__ import annotations

import argparse
import collections
import json
import struct
import sys
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"
LOADING_ONLY = {"fhsw", "fhsweurope"}


def trees():
    out = [("bf1942", VIEWER / "maps")]
    for mod in json.loads((VIEWER / "models" / "mods.json").read_text()).get("mods", []):
        maps = VIEWER / "maps" / "mods" / mod["id"]
        if (maps / "maps.json").is_file():
            out.append((mod["id"], maps))
    return out


def exported(tree: str, root: Path) -> list[dict]:
    rows = json.loads((root / "maps.json").read_text())
    if isinstance(rows, dict):
        rows = rows.get("maps") or rows.get("levels") or []
    if tree in LOADING_ONLY:
        rows = [r for r in rows if r.get("loading")]
    return rows


def glb_json(path: Path) -> dict:
    with open(path, "rb") as fh:
        head = fh.read(20)
        return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))


def on_centre(parts: list[dict]) -> bool:
    pushers = [p for p in parts if p.get("kind") in ("Engine", "Wing")]
    return bool(pushers) and all(
        all(abs(float(c or 0)) < 1e-6 for c in (p.get("position") or [0, 0, 0])) for p in pushers)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--trees")
    ap.add_argument("--json")
    args = ap.parse_args()
    wanted = set(args.trees.split(",")) if args.trees else None
    report = {}
    for tree, root in trees():
        if wanted and tree not in wanted:
            continue
        rows = exported(tree, root)
        held, tilted = collections.Counter(), collections.Counter()
        held_levels, tilted_levels = set(), set()
        for row in rows:
            glb = root / (row.get("glb") or f"{row.get('name')}/scene.glb")
            if not glb.is_file():
                continue
            for nd in glb_json(glb)["nodes"]:
                proj = ((nd.get("extras") or {}).get("fireArms") or {}).get("projectile") or {}
                parts = proj.get("parts") or []
                name = proj.get("template")
                if proj.get("hasPointPhysics") is False and on_centre(parts):
                    held[name] += 1
                    held_levels.add(glb.parent.name)
                if any(p.get("kind") == "Engine" and float((p.get("rotation") or [0, 0, 0])[1] or 0)
                       for p in parts):
                    tilted[name] += 1
                    tilted_levels.add(glb.parent.name)
        report[tree] = {"held": dict(held), "heldLevels": len(held_levels),
                        "tiltedMotors": dict(tilted), "tiltedLevels": len(tilted_levels)}
        print(f"{tree:14} levels {len(rows):4}  held-attitude racks {sum(held.values()):4} "
              f"({len(held)} rounds) on {len(held_levels):3} levels;  tilted-motor racks "
              f"{sum(tilted.values()):4} on {len(tilted_levels):3} levels", file=sys.stderr)
    if args.json:
        text = json.dumps(report, indent=1)
        if args.json == "-":
            print(text)
        else:
            Path(args.json).write_text(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
