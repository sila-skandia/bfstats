#!/usr/bin/env python3
"""Census: driven sea hulls whose own col0 underside lies well above their
collision box's bottom face, on the EXPORTED levels of every tree (the rows of
each tree's maps.json; FHSW and FHSWEurope: the rows with a `loading` block).

Until 2026-10-15 `viewer/ship.js` grounded a ship on a grid over her
collision box's bottom face, flat at the box's lowest point. The engine's
`checkVsTerrain` drops the hull's col0 VERTICES on the bed instead
(`ship.js` header), and a hull is not a box: FHSWEurope Biak's PT boats are
1.35 m deep near the bow and 0.72 m at the stern against a box 1.51 m deep
from end to end, so docked over a shelf they sat aground and could not be
driven. The ship now samples her col0 underside (`undersideSamples`).

For each hull type: the box's keel, col0's lowest vertex, and the mean
"overdraft" (box keel to col0 underside, over the grid columns col0 covers).
A placement counts as affected when that mean is over --threshold metres:
the box put her that much deeper than her hull, on average, wherever she
met a shoal.

    python3 surveys/census_ship_undersides.py [--trees fhsweurope,fhsw] [--threshold 0.3] [--json -]

From tools/bf1942-models. Reads the level glbs' JSON chunks and each tree's
`_shared/collision-meshes.json`. The hull's col0 is the largest collision
mesh under the hull outside a nested PlayerControlObject, which is the root
part `ship-spec.js` `rootCollisionPart` picks on every hull checked by hand.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import struct
import sys
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"
LOADING_ONLY = {"fhsw", "fhsweurope"}
STEP, CAP = 4, 33   # `ship.js` HULL_SAMPLE_STEP, HULL_SAMPLE_CAP


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


def hull_col0(doc: dict, index: int, meshes: dict):
    """(vertices in the hull frame, faces, box keel) of the hull's col0."""
    nodes = doc["nodes"]
    best = None

    def walk(i, T, R, top):
        nonlocal best
        node = nodes[i]
        ex = node.get("extras") or {}
        if not top and ex.get("templateKind") == "PlayerControlObject":
            return
        t = node.get("translation", [0, 0, 0])
        r = node.get("rotation", [0, 0, 0, 1])
        T2, R2 = (T, R) if top else (
            tuple(T[k] + qmul(R, t)[k] for k in range(3)), qq(R, r))
        if ex.get("collision") and ex.get("sourceGeometry"):
            entry = meshes.get(str(ex["sourceGeometry"]).lower())
            if entry and entry.get("layers"):
                (lo, hi) = entry["bbox"]
                size = (hi[0] - lo[0]) * (hi[2] - lo[2])
                if best is None or size > best[0]:
                    best = (size, entry, T2, R2)
        for child in node.get("children", []):
            walk(child, T2, R2, False)

    walk(index, (0, 0, 0), (0, 0, 0, 1), True)
    if best is None:
        return None
    _, entry, T, R = best
    layer = entry["layers"][0]
    v = layer["v"]
    verts = []
    for i in range(0, len(v), 3):
        p = qmul(R, v[i:i + 3])
        verts.append((p[0] + T[0], p[1] + T[1], p[2] + T[2]))
    lo, hi = entry["bbox"]
    corners = [qmul(R, (x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    xs = [c[0] + T[0] for c in corners]
    ys = [c[1] + T[1] for c in corners]
    zs = [c[2] + T[2] for c in corners]
    box = (min(xs), max(xs), min(ys), min(zs), max(zs))
    return verts, layer["f"], box


def overdraft(verts, faces, box) -> tuple[float, int]:
    """Mean of (col0 underside - box keel) over the grid columns col0 covers."""
    x0, x1, keel, z0, z1 = box
    dx, dz = x1 - x0, z1 - z0
    nx = min(CAP, max(3, math.ceil(dx / STEP) + 1))
    nz = min(CAP, max(5, math.ceil(dz / STEP) + 1))
    tris = [(verts[faces[i]], verts[faces[i + 1]], verts[faces[i + 2]])
            for i in range(0, len(faces) - 2, 3)]
    total, n = 0.0, 0
    for iz in range(nz):
        z = z0 + dz * iz / (nz - 1)
        for ix in range(nx):
            x = x0 + dx * ix / (nx - 1)
            low = math.inf
            for (ax, ay, az), (bx, by, bz), (qx, qy, qz) in tris:
                d = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz)
                if abs(d) < 1e-9:
                    continue
                a = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / d
                b = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / d
                c = 1 - a - b
                if a < -1e-6 or b < -1e-6 or c < -1e-6:
                    continue
                low = min(low, a * ay + b * by + c * qy)
            if math.isfinite(low):
                total += low - keel
                n += 1
    return (total / n if n else 0.0), n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--trees")
    ap.add_argument("--threshold", type=float, default=0.3)
    ap.add_argument("--json")
    args = ap.parse_args()
    wanted = set(args.trees.split(",")) if args.trees else None
    report = {}
    for tree, root in trees():
        if wanted and tree not in wanted:
            continue
        side = root / "_shared" / "collision-meshes.json"
        meshes = json.loads(side.read_text()).get("meshes", {}) if side.is_file() else {}
        meshes = {k.lower(): v for k, v in meshes.items()}
        types: dict[str, dict] = {}
        placements = collections.Counter()
        levels = collections.defaultdict(set)
        rows = exported(tree, root)
        for row in rows:
            glb = root / (row.get("glb") or f"{row.get('name')}/scene.glb")
            if not glb.is_file():
                continue
            doc = glb_json(glb)
            for i, nd in enumerate(doc["nodes"]):
                ex = nd.get("extras") or {}
                phys = ex.get("physics") or {}
                if ex.get("templateKind") != "PlayerControlObject" or phys.get("vehicleCategory") != "VCSea":
                    continue
                if not (phys.get("mass") or 0) > 0:
                    continue
                name = str(ex.get("control") or nd.get("name")).rstrip("_0123456789")
                if name not in types:
                    col = hull_col0(doc, i, meshes)
                    if col is None:
                        types[name] = {"col0": False}
                    else:
                        verts, faces, box = col
                        mean, cols = overdraft(verts, faces, box)
                        types[name] = {"col0": True, "boxKeel": round(box[2], 3),
                                       "col0Min": round(min(v[1] for v in verts), 3),
                                       "overdraft": round(mean, 3), "columns": cols}
                placements[name] += 1
                levels[name].add(row.get("name") or glb.parent.name)
        hit = {n: t for n, t in types.items() if t.get("col0") and t["overdraft"] > args.threshold}
        report[tree] = {
            "levels": len(rows),
            "hullTypes": len(types),
            "withoutCol0": sorted(n for n, t in types.items() if not t.get("col0")),
            "placements": sum(placements.values()),
            "affectedTypes": {n: {**t, "placements": placements[n], "levels": len(levels[n])}
                              for n, t in sorted(hit.items())},
            "affectedPlacements": sum(placements[n] for n in hit),
            "affectedLevels": len(set().union(*(levels[n] for n in hit))) if hit else 0,
        }
        r = report[tree]
        print(f"{tree:14} levels {r['levels']:4}  hull types {r['hullTypes']:3}  placements "
              f"{r['placements']:5}  overdraft > {args.threshold} m: {len(hit):3} types, "
              f"{r['affectedPlacements']:4} placements on {r['affectedLevels']:3} levels",
              file=sys.stderr)
    if args.json:
        text = json.dumps(report, indent=1)
        if args.json == "-":
            print(text)
        else:
            Path(args.json).write_text(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
