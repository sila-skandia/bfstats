#!/usr/bin/env python3
"""Census: held key axes the exporter dropped from vehicles with no visible
Springs, over the vehicles the EXPORTED levels of every tree place (the rows of
each tree's maps.json; FHSW and FHSWEurope: the rows with a `loading` block).

`bf42/assemble.py` `browse_rig` strips `c_PIYaw` and `c_PIThrottle` axes from a
vehicle whose Springs are all hidden, because on such a vehicle those inputs
are the drivetrain echoing the driver (a boat's helm, a throttle lever, both
`setAutomaticReset 1` in the shipped data). Until 2026-10-15 it stripped a held
key axis as well (`holds_key_axis`: a RotationalBundle that is not
`setAutomaticReset`, GUN-2), and a gun with no wheels lost its round selector:
FHSWEurope al_marj-1942's Flak 18/36 rolls its APHE and AA guns on
`c_PIThrottle` (W/S) and the viewer never saw the selector. This reads the
chain's `.con` (the glbs no longer carry what was dropped) and counts:

* the vehicles and parts the old filter dropped and the new one keeps;
* the model glbs that lost them (`viewer/models/mods/<id>/<stem>*.glb`; the fix
  for a finished tree is `patch_held_axes.py`);
* the exported levels that place such a vehicle without baking it, which is
  where the page clones the model glb (al_marj's Axis Flak). A level bake never
  lost the axes: `Assembler.export` is what sets the spring test, and a level
  bake places its vehicles without it.

    python3 surveys/census_springless_held_axes.py [--trees fhsweurope,fhsw] [--json out.json] [-v]

From tools/bf1942-models. Reads the install (the chain's objects archives),
scene.json and the level glbs' JSON chunks.
"""

from __future__ import annotations

import argparse
import collections
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from bf42 import con as con_mod  # noqa: E402
from bf42.assemble import _DRIVETRAIN_INPUTS, Assembler, holds_key_axis  # noqa: E402

VIEWER = HERE / "viewer"
LOADING_ONLY = {"fhsw", "fhsweurope"}


def trees() -> list[tuple[str, Path, Path]]:
    out = [("bf1942", VIEWER / "maps", VIEWER / "models")]
    for mod in json.loads((VIEWER / "models" / "mods.json").read_text()).get("mods", []):
        maps = VIEWER / "maps" / "mods" / mod["id"]
        if (maps / "maps.json").is_file():
            out.append((mod["id"], maps, VIEWER / "models" / "mods" / mod["id"]))
    return out


def exported(tree: str, root: Path) -> list[dict]:
    rows = json.loads((root / "maps.json").read_text())
    if isinstance(rows, dict):
        rows = rows.get("maps") or rows.get("levels") or []
    if tree in LOADING_ONLY:
        rows = [r for r in rows if r.get("loading")]
    return rows


def glb_json(path: Path) -> dict | None:
    try:
        with open(path, "rb") as fh:
            head = fh.read(20)
            return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))
    except (OSError, ValueError, struct.error):
        return None


def dropped_axes(library: con_mod.ObjectLibrary, root: str) -> list[tuple[str, str, str]]:
    """(part, axis, input) of every held drivetrain-input axis under `root`."""
    out, seen = [], set()

    def walk(name: str, depth: int) -> None:
        template = library.object(name)
        if template is None or depth > 24 or template.name.lower() in seen:
            return
        seen.add(template.name.lower())
        rig = template.rig()
        if rig and template.kind.lower() not in con_mod.PHYSICS_TEMPLATE_KINDS and (
                template.geometry or template.children):
            for axis, spec in rig["axes"].items():
                if spec["input"] in _DRIVETRAIN_INPUTS and holds_key_axis(template, spec):
                    out.append((template.name, axis, spec["input"]))
        for ref in template.children:
            if child := con_mod.instance_template_name(ref, library.object):
                walk(child, depth + 1)

    walk(root, 0)
    return out


def chain_assembler(install: str) -> Assembler:
    import extract_models as em  # noqa: PLC0415 - heavy, only when a tree is read
    chain = em.mod_chain(em.DEFAULT_GAME_DIR, install)
    meshes, textures, objects, _game = em.build_pools(chain, [])
    return Assembler(meshes, textures, objects, em.build_library(objects))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trees")
    ap.add_argument("--json")
    ap.add_argument("-v", action="store_true", help="list the vehicles")
    args = ap.parse_args()
    wanted = set(args.trees.split(",")) if args.trees else None
    import mod_pipeline  # noqa: PLC0415
    import extract_models as em  # noqa: PLC0415
    report = {}
    for tree, maps, models in trees():
        if wanted and tree not in wanted:
            continue
        install = "bf1942" if tree == "bf1942" else (
            mod_pipeline.MODS[tree].install if tree in mod_pipeline.MODS else None)
        if install is None:
            print(f"{tree}: no install folder known, skipped")
            continue
        placed: dict[str, set] = collections.defaultdict(set)
        baked: dict[str, set] = collections.defaultdict(set)
        for row in exported(tree, maps):
            level = row.get("name") or row["report"].split("/")[0]
            scene = maps / row["report"] if row.get("report") else maps / level / "scene.json"
            if not scene.is_file():
                continue
            for spawn in json.loads(scene.read_text()).get("objectSpawns", []):
                for template in (spawn.get("templates") or {}).values():
                    placed[template.lower()].add(level)
            doc = glb_json(scene.with_name("scene.glb")) or {}
            for node in doc.get("nodes", []):
                if control := (node.get("extras") or {}).get("control"):
                    baked[control.lower()].add(level)
        if not placed:
            continue
        asm = chain_assembler(install)
        vehicles, parts, levels, cloned, glbs = {}, 0, set(), set(), []
        for template, at in sorted(placed.items()):
            obj = asm.library.object(template)
            if obj is None or asm._has_visible_spring(obj.name):
                continue
            held = dropped_axes(asm.library, obj.name)
            if not held:
                continue
            stem = em.model_file_stem(obj.name)
            files = sorted(p.name for p in models.glob(f"{stem}*.glb")
                           if p.name.split(".")[0] == stem)
            clones = sorted(at - baked.get(obj.name.lower(), set()))
            vehicles[obj.name] = {"parts": [f"{p} {a} ({i})" for p, a, i in held],
                                  "levels": sorted(at), "glbs": files, "clonedOn": clones}
            parts += len(held)
            levels |= at
            cloned |= set(clones)
            glbs += files
        report[tree] = {"vehicles": vehicles, "clonedOn": sorted(cloned), "glbs": sorted(glbs)}
        print(f"{tree}: {len(vehicles)} placed spring-less vehicles lost a held key axis "
              f"({parts} parts) on {len(levels)} levels; {len(glbs)} model glbs; "
              f"{len(cloned)} levels place one from its model glb")
        if args.v:
            for name, row in vehicles.items():
                print(f"  {name}: {', '.join(row['parts'])}  [{len(row['levels'])} levels, "
                      f"cloned on {len(row['clonedOn'])}]")
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
