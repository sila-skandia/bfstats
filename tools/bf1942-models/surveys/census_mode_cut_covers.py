#!/usr/bin/env python3
"""Census: terrain cuts left open in a game type because the statics seated in
them are placed by another game type's mode script only.

FH and FHSW mappers seat trenches and bunkers by lowering the heightmap under
them, often to 0 (Omaha Charlie Sector: a 42 m pit behind the east bunker), and
place the covering statics from `Conquest/AdditionalStaticObjects.con`. The
level's root `Coop.con` runs `SinglePlayer/AdditionalStaticObjects.con`
instead (TKT-3, `features/mode-script-statics`), which has none of them, so
the bake tags the trenches `extras.modes: ["Conquest"]`, `pruneToMode` drops
them in CoOp, and the cut is an open pit with stretched earth walls.

For every EXPORTED level (the rows of each tree's maps.json; for fhsw and
fhsweurope only the rows carrying a `loading` block) this reads the glb JSON
chunk and the level's `terrain/heightmap.png`, and:

  * takes every root node carrying `extras.modes` (a mode-script static) and
    its world AABB from the accessor bounds of its drawn meshes (collision and
    LOD-rung children left out);
  * marks a heightmap sample inside that AABB a CUT when the terrain there is
    at least `--gap` metres below the static's lowest vertex AND at least
    `--drop` metres below the highest sample within 8 m (a pit, not a valley
    under a bridge), with the static's lowest vertex no more than `--gap`
    above that highest sample (seated in the cut, not flying over it);
  * for each layer a game type of the level runs (`scene.json` `gameTypes`),
    calls a cut OPEN when no static drawn in that layer (untagged, or tagged
    with it) has an AABB over the sample.

A placement counts once per layer it leaves a cut open in; open samples are
counted once each per layer. AABB coverage is
generous (a rotated piece's box covers more than its triangles), so the open
counts are a floor.

    python3 surveys/census_mode_cut_covers.py [--trees fhsweurope,fhsw,bf1942]
        [--level omaha_charlie-sector-1944] [--json out.json] [-v]

From tools/bf1942-models. Reads glb JSON chunks and heightmaps only.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

VIEWER = Path(__file__).resolve().parent.parent / "viewer"
LOADING_ONLY = {"fhsw", "fhsweurope"}


def tree_dir(tree: str) -> Path:
    return VIEWER / "maps" if tree == "bf1942" else VIEWER / "maps" / "mods" / tree


def exported(tree: str) -> list[dict]:
    rows = json.loads((tree_dir(tree) / "maps.json").read_text())
    if isinstance(rows, dict):
        rows = rows.get("maps") or rows.get("levels") or []
    if tree in LOADING_ONLY:
        rows = [r for r in rows if r.get("loading")]
    return rows


def glb_json(path: Path) -> dict:
    with open(path, "rb") as fh:
        head = fh.read(20)
        return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))


def qmul(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz),
            vz + w * tz + (x * ty - y * tx))


def qq(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)


def node_box(doc: dict, index: int):
    """World AABB of a root node's drawn meshes, or None."""
    nodes, accessors, meshes = doc["nodes"], doc["accessors"], doc["meshes"]
    box = [math.inf, math.inf, math.inf, -math.inf, -math.inf, -math.inf]

    def walk(i, T, R, S):
        node = nodes[i]
        extras = node.get("extras") or {}
        if extras.get("collision") or extras.get("lod"):
            return
        t = node.get("translation", [0, 0, 0])
        r = node.get("rotation", [0, 0, 0, 1])
        s = node.get("scale", [1, 1, 1])
        p = qmul(R, [t[k] * S[k] for k in range(3)])
        T2 = (T[0] + p[0], T[1] + p[1], T[2] + p[2])
        R2 = qq(R, r)
        S2 = [S[k] * s[k] for k in range(3)]
        if node.get("mesh") is not None:
            for prim in meshes[node["mesh"]]["primitives"]:
                acc = accessors[prim["attributes"]["POSITION"]]
                lo, hi = acc.get("min"), acc.get("max")
                if not lo or not hi:
                    continue
                for cx in (lo[0], hi[0]):
                    for cy in (lo[1], hi[1]):
                        for cz in (lo[2], hi[2]):
                            v = qmul(R2, (cx * S2[0], cy * S2[1], cz * S2[2]))
                            w = (T2[0] + v[0], T2[1] + v[1], T2[2] + v[2])
                            for k in range(3):
                                box[k] = min(box[k], w[k])
                                box[k + 3] = max(box[k + 3], w[k])
        for child in node.get("children", []):
            walk(child, T2, R2, S2)

    walk(index, (0, 0, 0), (0, 0, 0, 1), [1, 1, 1])
    return None if box[0] == math.inf else box


def heightmap(level_dir: Path, report: dict):
    spec = report.get("heightmap")
    if not spec:
        return None
    image = Image.open(level_dir / spec["image"]).convert("RGB")
    dim, px = image.size[0], image.load()
    units, spacing = spec["heightUnits"], spec["spacing"]

    def h(ix, iz):
        r, g, _ = px[ix % dim, iz % dim]
        return ((r << 8) | g) / 65535 * units
    return h, spacing


def layers_run(report: dict) -> list[str]:
    types = report.get("gameTypes") or {}
    names = sorted({str(t.get("mode")) for t in types.values() if t.get("mode")})
    return names or sorted((report.get("modes") or {}).keys())


def survey_level(level_dir: Path, gap: float, drop: float):
    report = json.loads((level_dir / "scene.json").read_text())
    hm = heightmap(level_dir, report)
    if hm is None:
        return None
    h, sp = hm
    doc = glb_json(level_dir / "scene.glb")
    layers = layers_run(report)
    statics = []  # (name, modes|None, box)
    for i in doc["scenes"][0]["nodes"]:
        node = doc["nodes"][i]
        extras = node.get("extras") or {}
        if extras.get("kind"):
            continue
        box = node_box(doc, i)
        if box is None:
            continue
        modes = extras.get("modes")
        statics.append((node.get("name", "?"), [m.lower() for m in modes] if modes else None, box))
    tagged = [s for s in statics if s[1] is not None]
    if not tagged:
        return {"layers": layers, "tagged": 0, "open": {}}
    reach = max(1, round(8 / sp))
    open_by_layer = {}
    for layer in layers:
        lname = layer.lower()
        drawn = [s[2] for s in statics if s[1] is None or lname in s[1]]
        hits = []
        distinct = set()
        for name, modes, box in tagged:
            if lname in modes:
                continue
            cells = 0
            for iz in range(math.ceil(-box[5] / sp), math.floor(-box[2] / sp) + 1):
                for ix in range(math.ceil(box[0] / sp), math.floor(box[3] / sp) + 1):
                    hv = h(ix, iz)
                    if hv > box[1] - gap:
                        continue
                    ring = max(h(ix + a, iz + b) for a in range(-reach, reach + 1)
                               for b in range(-reach, reach + 1))
                    if ring - hv < drop or box[1] > ring + gap:
                        continue
                    x, z = ix * sp, -iz * sp
                    if any(b[0] <= x <= b[3] and b[2] <= z <= b[5] for b in drawn):
                        continue
                    cells += 1
                    distinct.add((ix, iz))
            if cells:
                hits.append({"template": name, "modes": modes, "openCells": cells,
                             "at": [round(box[0] + box[3]) / 2, round(box[1], 1),
                                    -round(box[2] + box[5]) / 2]})
        if hits:
            open_by_layer[layer] = {"cells": len(distinct), "placements": hits}
    return {"layers": layers, "tagged": len(tagged), "open": open_by_layer}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trees", default="fhsweurope,fhsw,bf1942")
    ap.add_argument("--level", help="only this level (directory name)")
    ap.add_argument("--gap", type=float, default=2.0)
    ap.add_argument("--drop", type=float, default=5.0)
    ap.add_argument("--json")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    out = {}
    for tree in args.trees.split(","):
        base = tree_dir(tree)
        totals = defaultdict(int)
        for row in exported(tree):
            level_dir = (base / row["report"]).parent
            if args.level and level_dir.name.lower() != args.level.lower():
                continue
            if not (level_dir / "scene.glb").is_file():
                continue
            totals["levels"] += 1
            result = survey_level(level_dir, args.gap, args.drop)
            if not result:
                continue
            if result["tagged"]:
                totals["levelsWithModeStatics"] += 1
            if result["open"]:
                totals["levelsAffected"] += 1
                out.setdefault(tree, {})[level_dir.name] = result
                for layer, entry in result["open"].items():
                    hits = entry["placements"]
                    totals["levelLayers"] += 1
                    totals["placements"] += len(hits)
                    totals["openCells"] += entry["cells"]
                    print(f"{tree}/{level_dir.name} [{layer}] {len(hits)} placements "
                          f"({', '.join(sorted({x['template'] for x in hits})[:6])}...), "
                          f"{entry['cells']} open cut samples "
                          f"({entry['cells'] * 16:.0f} m^2 at 4 m spacing)")
                    if args.verbose:
                        for x in hits:
                            print(f"    {x['template']} {x['at']} modes={x['modes']} "
                                  f"open={x['openCells']}")
        print(f"== {tree}: {dict(totals)}")
    if args.json:
        Path(args.json).write_text(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
