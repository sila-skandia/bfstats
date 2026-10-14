#!/usr/bin/env python3
"""Census: aircraft that ride the sea on FloatingBundles (seaplanes), placed on
the EXPORTED levels of every tree (the rows of each tree's maps.json).

Until 2026-10-15 the viewer floated ships only: a seaplane parked on the water
was billed `hpLostWhileDamageFromWater` for its pontoon's contact, and flown,
it sank (FHSWEurope Biak's Catfish). `viewer/aircraft.js` `bodyForces` floats
it now, and `world-damage.js` `inWaterOwners` wets a hull by its root part.

    python3 surveys/census_seaplanes.py [--trees fhsweurope,fhsw]

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


def trees():
    out = [("bf1942", VIEWER / "maps")]
    for mod in json.loads((VIEWER / "models" / "mods.json").read_text()).get("mods", []):
        maps = VIEWER / "maps" / "mods" / mod["id"]
        if (maps / "maps.json").is_file():
            out.append((mod["id"], maps))
    return out


def glb_json(path: Path) -> dict:
    with open(path, "rb") as fh:
        head = fh.read(20)
        return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))


def seaplanes(doc: dict) -> list[str]:
    nodes = doc["nodes"]
    out = []
    for nd in nodes:
        ex = nd.get("extras") or {}
        if ex.get("templateKind") != "PlayerControlObject":
            continue
        if (ex.get("physics") or {}).get("vehicleCategory") != "VCAir":
            continue
        stack = list(nd.get("children", []))
        while stack:
            child = nodes[stack.pop()]
            if (child.get("extras") or {}).get("templateKind") == "FloatingBundle":
                out.append(ex.get("control") or nd.get("name"))
                break
            stack.extend(child.get("children", []))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trees")
    args = ap.parse_args()
    wanted = set(args.trees.split(",")) if args.trees else None
    for tree, maps in trees():
        if wanted and tree not in wanted:
            continue
        rows = json.loads((maps / "maps.json").read_text())
        count, levels, templates = 0, set(), collections.Counter()
        for row in rows:
            glb = maps / row["glb"]
            if not glb.is_file():
                continue
            found = seaplanes(glb_json(glb))
            if found:
                levels.add(row["glb"].split("/")[0])
                count += len(found)
                templates.update(found)
        print(f"{tree}: {count} seaplanes placed on {len(levels)} of {len(rows)} levels"
              + (f" ({', '.join(f'{t} {n}' for t, n in templates.most_common(6))})" if templates else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
