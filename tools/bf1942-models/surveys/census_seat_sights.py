#!/usr/bin/env python3
"""Census: gunner seats whose sight is a distance-selected mesh, and which of
them the viewer fails to draw, over the EXPORTED levels of each tree (the rows
of its maps.json; for FHSW and FHSWEurope the rows carrying a `loading` block),
never the install's archives.

The mechanism. FHSW's aircraft gunners (the B-40's belly turret, `AirSight_N-9`)
see their sight as a mesh, not a HUD picture: a Bundle under the gun hangs a
LodObject whose `DistanceSelector` (`1p_AirReflexSight_Flex1_Selector`) puts a
blended reticle pane (`1p_AirSight_*_m1`, texture `texture/<sight>.dds`) in
front of the eye when the camera is within the selector's first distance, and
a meshless `..._External` past it (ledger LOD-1, LOD-3). The mod hangs the same
sight twice per seat, once at the seat Camera and once at the Camera plus its
`OutsideHudOffset`, so both inside views carry it.

A seat's sight is any `lodAlternative` swap of the tree's `<T>.cockpit.glb` that
is distance-selected and whose selected alternative or its geometry is named
like a sight (`sight`, `reticl`, `reticul`). A gunner seat is one whose control
is not the root's. For each such seat the census asks, per inside view, whether
retail draws a sight (LOD-3: some copy of it within its first distance of that
view's eye, the selector's radius and FOV terms left out) and whether the
viewer does:

    cockpit  the seat Camera's eye (`extras.physics.pivotPosition` folded in)
    nose     that eye plus `extras.cameraView.outsideHudOffset`, where declared

The viewer's answer is `vehicle-base.js` as written: `graftCockpitInto` hangs
each swap on the FIRST node of the vehicle whose name key matches
(`nodeNameKey`), so copies that share a template name all land on one host,
and `CockpitSwap.apply` tests that host against the eye. In an aircraft's
nose view the page shows no interior at all (`VehicleCamera.firstPerson`,
`noseInterior` false for a `VCAir` root; `seat-view.js` `NoseHull`).

    misplaced  a sight copy grafted onto a node that is not its own
    cockpit    seats where retail draws a sight in the cockpit view, the viewer none
    nose       the same for the nose (OutsideHudOffset) view

`--unexported` adds a count, labelled as such, of the install's other levels
(their `ObjectSpawnTemplates.con` read straight out of the level archives) that
place an affected vehicle; the verdict is the same per-template one.

    python3 surveys/census_seat_sights.py [--trees fhsweurope,fhsw,bf1942,xpack1,xpack2]
                                          [--unexported] [--vehicles] [--json out.json]

From tools/bf1942-models. Reads scene.json and glb JSON chunks only.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import re
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent / "viewer"
sys.path.insert(0, str(HERE.parent))

INSTALL = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
DEFAULT_TREES = ("fhsweurope", "fhsw", "bf1942", "xpack1", "xpack2")
SIGHT_RE = re.compile(r"sight|reticl|reticul", re.I)
SPAWN_RE = re.compile(r"setObjectTemplate\s+\d+\s+(\S+)", re.I)
# Two copies count as one place within a millimetre.
SAME_PLACE_M = 1e-3


def name_key(name: str | None) -> str:
    """`vehicle-base.js` `nodeNameKey`."""
    return re.sub(r"_\d+$", "", str(name or "").lower())


def glb_json(path: Path) -> dict:
    with open(path, "rb") as fh:
        head = fh.read(20)
        return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))


# --- tiny rigid-transform algebra (glTF TRS, column vectors) ----------------

def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def quat_rot(q, v):
    x, y, z, w = q
    tx, ty, tz = 2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + y * tz - z * ty,
            v[1] + w * ty + z * tx - x * tz,
            v[2] + w * tz + x * ty - y * tx)


class Tree:
    """One glb's node graph: parents, DFS order and root-frame poses."""

    def __init__(self, doc: dict):
        self.doc = doc
        self.nodes = doc["nodes"]
        self.parent = {c: i for i, n in enumerate(self.nodes) for c in n.get("children", [])}
        roots = doc.get("scenes", [{}])[doc.get("scene", 0)].get("nodes") or [
            i for i in range(len(self.nodes)) if i not in self.parent]
        self.root = roots[0]
        self.order = []
        stack = [self.root]
        while stack:
            i = stack.pop()
            self.order.append(i)
            stack.extend(reversed(self.nodes[i].get("children", [])))
        self._pose = {}

    def extras(self, i) -> dict:
        return self.nodes[i].get("extras") or {}

    def local(self, i):
        n = self.nodes[i]
        t = list(n.get("translation", (0.0, 0.0, 0.0)))
        q = tuple(n.get("rotation", (0.0, 0.0, 0.0, 1.0)))
        pivot = (self.extras(i).get("physics") or {}).get("pivotPosition")
        if self.extras(i).get("templateKind") == "Camera" and pivot and any(pivot):
            # camera-pivot.js `applyCameraPivot`: the pivot, z mirrored, turned
            # by the Camera's own rotation, joins its translation.
            off = quat_rot(q, (pivot[0], pivot[1], -pivot[2]))
            t = [t[k] + off[k] for k in range(3)]
        return tuple(t), q

    def pose(self, i):
        """(position, rotation) in the root's frame; the root's own TRS is
        left out, so two exports of one template compare directly."""
        if i in self._pose:
            return self._pose[i]
        if i == self.root or i not in self.parent:
            out = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
        else:
            pp, pq = self.pose(self.parent[i])
            t, q = self.local(i)
            r = quat_rot(pq, t)
            out = ((pp[0] + r[0], pp[1] + r[1], pp[2] + r[2]), quat_mul(pq, q))
        self._pose[i] = out
        return out

    def subtree_names(self, i):
        stack = [i]
        while stack:
            j = stack.pop()
            yield self.nodes[j].get("name") or ""
            geometry = self.extras(j).get("geometry")
            if geometry:
                yield geometry
            stack.extend(self.nodes[j].get("children", []))


def dist(a, b) -> float:
    return math.dist(a, b)


def seat_eyes(tree: Tree) -> dict[str, dict[str, tuple]]:
    """control -> {'cockpit': eye, 'nose': eye?}; the first Camera per control
    in traversal order, as `seat-survey.js` takes it."""
    out = {}
    for i in tree.order:
        ex = tree.extras(i)
        if ex.get("templateKind") != "Camera" or ex.get("control") in out:
            continue
        pos, rot = tree.pose(i)
        eyes = {"cockpit": pos}
        offset = (ex.get("cameraView") or {}).get("outsideHudOffset")
        if offset and len(offset) == 3:
            o = quat_rot(rot, offset)
            eyes["nose"] = (pos[0] + o[0], pos[1] + o[1], pos[2] + o[2])
        out[ex.get("control")] = eyes
    return out


def vehicle_verdict(model: Path, cockpit: Path) -> dict | None:
    """The sight swaps of one vehicle and what each view draws, or None when it
    has no distance-selected sight on any seat."""
    cdoc = Tree(glb_json(cockpit))
    vdoc = Tree(glb_json(model)) if model.is_file() else cdoc
    root_control = vdoc.extras(vdoc.root).get("control")
    category = (vdoc.extras(vdoc.root).get("physics") or {}).get("vehicleCategory")
    # graftCockpitInto's lookup: first node per name key, vehicle traversal order.
    first = {}
    for i in vdoc.order:
        first.setdefault(name_key(vdoc.nodes[i].get("name")), i)
    sights = []
    for i in cdoc.order:
        spec = cdoc.extras(i).get("lodAlternative")
        if not spec or str(spec.get("selectorKind", "")).lower() != "distanceselector":
            continue
        if not any(SIGHT_RE.search(n) for n in cdoc.subtree_names(i)):
            continue
        near = (spec.get("distances") or [None])[0]
        if not near or near <= 0:
            continue
        control = cdoc.extras(i).get("control")
        own = cdoc.pose(i)[0]
        host = first.get(name_key(cdoc.nodes[i].get("name")))
        if host is None:
            continue
        host_pos = vdoc.pose(host)[0]
        sights.append({
            "control": control, "name": cdoc.nodes[i].get("name"), "selected": spec.get("selected"),
            "near": near, "own": own, "host": host_pos,
            "hostControl": vdoc.extras(host).get("control"),
            "misplaced": dist(own, host_pos) > SAME_PLACE_M or vdoc.extras(host).get("control") != control,
        })
    if not sights:
        return None
    eyes = seat_eyes(vdoc)
    seats = {}
    for control in sorted({s["control"] for s in sights}):
        mine = [s for s in sights if s["control"] == control]
        row = {"gunner": control != root_control, "sights": sorted({s["selected"] for s in mine}),
               "copies": len(mine), "misplaced": sum(s["misplaced"] for s in mine)}
        for view, eye in eyes.get(control, {}).items():
            retail = any(dist(s["own"], eye) <= s["near"] for s in mine)
            if view == "nose" and category == "VCAir":
                viewer = False
            else:
                viewer = any(dist(s["host"], eye) <= s["near"] for s in mine)
            row[view] = {"retail": retail, "viewer": viewer}
        seats[control] = row
    return {"category": category, "root": root_control, "seats": seats}


def tree_dirs(tree: str) -> tuple[Path, Path, list[Path]]:
    """(maps dir, install mod dir guess, model dirs in the viewer's fetch order)."""
    if tree == "bf1942":
        return VIEWER / "maps", INSTALL / "bf1942", [VIEWER / "models"]
    return (VIEWER / "maps" / "mods" / tree, INSTALL / tree,
            [VIEWER / "models" / "mods" / tree, VIEWER / "models"])


def exported_rows(maps: Path, tree: str) -> list[dict]:
    rows = json.loads((maps / "maps.json").read_text())
    if tree in ("fhsw", "fhsweurope"):
        rows = [r for r in rows if r.get("loading")]
    return rows


class Verdicts:
    """Per-template verdicts for one tree, case-insensitive like the archives."""

    def __init__(self, model_dirs: list[Path]):
        self.files = []
        for d in model_dirs:
            index = {}
            if d.is_dir():
                for p in d.iterdir():
                    index.setdefault(p.name.lower(), p)
            self.files.append((d, index))
        self.cache = {}

    def get(self, template: str) -> dict | None | str:
        key = template.lower()
        if key not in self.cache:
            self.cache[key] = "no-model"
            for models, index in self.files:
                cockpit = index.get(f"{key}.cockpit.glb")
                model = index.get(f"{key}.glb")
                if cockpit is None and model is None:
                    continue
                self.cache[key] = (vehicle_verdict(model or Path("-"), cockpit)
                                   if cockpit is not None else None)
                break
        return self.cache[key]


def level_templates(scene: dict) -> set[str]:
    out = set()
    for spawn in scene.get("objectSpawns", []):
        out.update(t for t in (spawn.get("templates") or {}).values() if t)
        if spawn.get("vehicle"):
            out.add(spawn["vehicle"])
    return out


def install_level_templates(rfa: Path) -> set[str]:
    from bf42.rfa import RfaArchive
    archive = RfaArchive(rfa)
    out = set()
    for name in archive.entries:
        if name.lower().endswith("objectspawntemplates.con"):
            out.update(SPAWN_RE.findall(archive.read(name).decode("latin-1")))
    return out


def summarise(verdicts: Verdicts, levels: dict[str, set[str]]) -> dict:
    vehicles, broken, by_level = {}, collections.Counter(), {}
    unmodelled = set()
    for level, templates in levels.items():
        hit = []
        for t in sorted(templates):
            v = verdicts.get(t)
            if v == "no-model":
                unmodelled.add(t.lower())
            if not isinstance(v, dict):
                continue
            gunners = {c: s for c, s in v["seats"].items() if s["gunner"]}
            if not gunners:
                continue
            # Levels spell one template in several cases (`Beaufort`,
            # `beaufort`); the archives and the verdict do not care.
            t = next((k for k in vehicles if k.lower() == t.lower()), t)
            vehicles[t] = v
            hit.append(t)
        if hit:
            by_level[level] = hit
    seats = collections.Counter()
    for t, v in vehicles.items():
        flags = set()
        for s in v["seats"].values():
            if not s["gunner"]:
                continue
            seats["gunner seats"] += 1
            if s["misplaced"]:
                seats["misplaced"] += 1
                flags.add("misplaced")
            for view in ("cockpit", "nose"):
                cell = s.get(view)
                if cell and cell["retail"] and not cell["viewer"]:
                    seats[f"{view} missing"] += 1
                    flags.add(view)
        for f in flags:
            broken[f] += 1
        if flags:
            broken["any"] += 1
    return {"levels": by_level, "vehicles": vehicles, "brokenVehicles": dict(broken), "seats": dict(seats),
            "unmodelled": sorted(unmodelled)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trees", default=",".join(DEFAULT_TREES))
    ap.add_argument("--unexported", action="store_true",
                    help="also count the install's levels no maps.json row exports")
    ap.add_argument("--vehicles", action="store_true", help="list the affected vehicles per tree")
    ap.add_argument("--json")
    args = ap.parse_args()
    report = {}
    for tree in args.trees.split(","):
        maps, install, model_dirs = tree_dirs(tree)
        if not (maps / "maps.json").is_file():
            print(f"{tree}: no maps.json, skipped")
            continue
        rows = exported_rows(maps, tree)
        verdicts = Verdicts(model_dirs)
        levels = {}
        for row in rows:
            scene = maps / row["report"]
            if scene.is_file():
                levels[row["report"].split("/")[0]] = level_templates(json.loads(scene.read_text()))
        out = summarise(verdicts, levels)
        b, s = out["brokenVehicles"], out["seats"]
        print(f"{tree} (exported, {len(rows)} levels): {len(out['vehicles'])} vehicles with a "
              f"distance-selected sight on a gunner seat, placed on {len(out['levels'])} levels; "
              f"{s.get('gunner seats', 0)} such seats. Viewer misses: misplaced copies on "
              f"{s.get('misplaced', 0)} seats ({b.get('misplaced', 0)} vehicles), cockpit view "
              f"{s.get('cockpit missing', 0)} seats ({b.get('cockpit', 0)} vehicles), nose view "
              f"{s.get('nose missing', 0)} seats ({b.get('nose', 0)} vehicles); "
              f"{b.get('any', 0)} vehicles affected")
        if args.vehicles:
            for t, v in sorted(out["vehicles"].items()):
                cells = []
                for c, seat in v["seats"].items():
                    if not seat["gunner"]:
                        continue
                    miss = [view for view in ("cockpit", "nose")
                            if seat.get(view, {}).get("retail") and not seat.get(view, {}).get("viewer")]
                    cells.append(f"{c}[{'/'.join(seat['sights'])}]"
                                 + (f" misses {'+'.join(miss)}" if miss else " ok")
                                 + (f", {seat['misplaced']}/{seat['copies']} copies misplaced"
                                    if seat["misplaced"] else ""))
                print(f"    {t} ({v['category']}): " + "; ".join(cells))
        entry = {"exported": {"levels": out["levels"], "brokenVehicles": b, "seats": s,
                              "vehicles": sorted(out["vehicles"])}}
        if args.unexported:
            levels_dir = install / "Archives" / "bf1942" / "levels"
            if not levels_dir.is_dir() and rows:
                levels_dir = INSTALL / rows[0].get("mod", tree) / "Archives" / "bf1942" / "levels"
            done = {k.lower() for k in levels}
            other = {}
            for rfa in sorted(levels_dir.glob("*.rfa")) if levels_dir.is_dir() else []:
                if rfa.stem.lower() in done:
                    continue
                try:
                    other[rfa.stem] = install_level_templates(rfa)
                except Exception as error:  # a damaged archive is counted out, not fatal
                    print(f"    {rfa.name}: unreadable ({error})", file=sys.stderr)
            u = summarise(verdicts, other)
            print(f"{tree} (UNEXPORTED, install levels with no maps.json row: {len(other)}): "
                  f"{len(u['levels'])} place a vehicle with a gunner-seat sight; "
                  f"{len(u['vehicles'])} such vehicles, {u['brokenVehicles'].get('any', 0)} affected; "
                  f"{len(u['unmodelled'])} placed templates have no model in the tree and no verdict "
                  f"(kit pick-ups mostly, and vehicles no exported level places)")
            entry["unexported"] = {"levels": len(other), "placing": len(u["levels"]),
                                   "vehicles": len(u["vehicles"]),
                                   "affected": u["brokenVehicles"].get("any", 0)}
        report[tree] = entry
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1, default=list))
    return 0


if __name__ == "__main__":
    sys.exit(main())
