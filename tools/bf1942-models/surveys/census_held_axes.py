#!/usr/bin/env python3
"""Census: rig parts that hold the angle their key left them at, over the
vehicles the EXPORTED levels of every tree place (the rows of each tree's
maps.json, never the install's archives).

A RotationalBundle that is not `setAutomaticReset` runs the engine's velocity
servo (ledger GUN-2): held input turns it, a released key leaves it. Until
2026-10-15 the viewer centred every such part on release, as a stick surface
does, so FH's ammo selectors (the SU-122's `SU122GunSelector`, rolled through
180 degrees on `c_PIPitch` to bring its HE gun to the barrel) snapped back to
the first round. `viewer/vehicle-base.js` `holdsAngle` names the parts; this
counts them.

    python3 surveys/census_held_axes.py [--trees fhsweurope,fhsw] [--json out.json] [-v]

From tools/bf1942-models. Reads scene.json and the vehicles' glb JSON chunks.
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import struct
import sys
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"
HOLDING_INPUTS = {"c_PIPitch", "c_PIRoll", "c_PIYaw", "c_PIThrottle"}
SELECTOR_RE = re.compile(r"select|ammo", re.I)


def trees() -> list[tuple[str, Path, Path]]:
    out = [("bf1942", VIEWER / "maps", VIEWER / "models")]
    for mod in json.loads((VIEWER / "models" / "mods.json").read_text()).get("mods", []):
        maps = VIEWER / "maps" / "mods" / mod["id"]
        if (maps / "maps.json").is_file():
            out.append((mod["id"], maps, VIEWER / "models" / "mods" / mod["id"]))
    return out


def glb_json(path: Path) -> dict | None:
    try:
        with open(path, "rb") as fh:
            head = fh.read(20)
            return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))
    except (OSError, ValueError, struct.error):
        return None


_GLB_INDEX: dict[Path, dict[str, Path]] = {}


def glb_index(models: Path) -> dict[str, Path]:
    """Lower-cased template name -> its model glb, from the tree's
    `models.json`. A level script spells a template as it likes (al_marj
    places `flak18/36`), and a `/` is stored as `_` (`Flak18_36.glb`,
    `extract_models.model_file_stem`); looking the name up as given found
    neither, and the census never saw the Flak 18/36 (item 12)."""
    if models not in _GLB_INDEX:
        index: dict[str, Path] = {}
        try:
            rows = json.loads((models / "models.json").read_text())
        except (OSError, ValueError):
            rows = []
        for row in rows if isinstance(rows, list) else []:
            if row.get("name") and row.get("glb") and not row.get("level"):
                index.setdefault(row["name"].lower(), models / row["glb"])
        _GLB_INDEX[models] = index
    return _GLB_INDEX[models]


def model_glb(template: str, models: Path) -> Path | None:
    """The tree's own glb for `template`, else vanilla's."""
    stem = template.replace("/", "_").replace("\\", "_")
    for root in (models, VIEWER / "models"):
        hit = glb_index(root).get(template.lower())
        for path in (hit, root / f"{stem}.glb"):
            if path is not None and path.is_file():
                return path
    return None


def held_parts(doc: dict) -> list[tuple[str, str]]:
    out = []
    for node in doc.get("nodes", []):
        ex = node.get("extras") or {}
        rig = ex.get("rig")
        if not rig or rig.get("automaticReset") or str(ex.get("templateKind", "")).lower() != "rotationalbundle":
            continue
        for spec in (rig.get("axes") or {}).values():
            if spec.get("input") in HOLDING_INPUTS and not spec.get("free") and spec.get("driver") != "rate":
                out.append((node.get("name", ""), spec["input"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trees")
    ap.add_argument("--json")
    ap.add_argument("-v", action="store_true", help="list the vehicles")
    args = ap.parse_args()
    wanted = set(args.trees.split(",")) if args.trees else None
    report = {}
    for tree, maps, models in trees():
        if wanted and tree not in wanted:
            continue
        placed: dict[str, set] = collections.defaultdict(set)
        for row in json.loads((maps / "maps.json").read_text()):
            scene = maps / row["report"]
            if not scene.is_file():
                continue
            extras = json.loads(scene.read_text())
            for spawn in extras.get("objectSpawns", []):
                for template in (spawn.get("templates") or {}).values():
                    placed[template].add(row["report"].split("/")[0])
        vehicles, parts, selectors, levels = {}, 0, 0, set()
        for template, at in sorted(placed.items()):
            glb = model_glb(template, models)
            doc = glb_json(glb) if glb else None
            held = held_parts(doc) if doc else []
            if not held:
                continue
            vehicles[template] = {"parts": held, "levels": sorted(at)}
            parts += len(held)
            selectors += sum(1 for name, _ in held if SELECTOR_RE.search(name))
            levels |= at
        report[tree] = vehicles
        print(f"{tree}: {len(vehicles)} placed vehicles hold a key axis ({parts} parts, {selectors} named "
              f"as ammo selectors or needles) on {len(levels)} levels")
        if args.v:
            for template, row in vehicles.items():
                print(f"  {template}: {', '.join(f'{n} ({i})' for n, i in row['parts'])}")
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
