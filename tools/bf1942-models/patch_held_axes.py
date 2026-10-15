#!/usr/bin/env python3
"""Give a spring-less vehicle back its held key axes, in finished glbs.

    python3 patch_held_axes.py --mod fhsweurope --mod fhsw --dry-run
    python3 patch_held_axes.py --mod fhsweurope

`bf42/assemble.py` `browse_rig` strips the `c_PIYaw` and `c_PIThrottle` axes of
a vehicle whose Springs are all hidden. Until 2026-10-15 it stripped a held key
axis with them (`holds_key_axis`: a RotationalBundle that is not
`setAutomaticReset`, ledger GUN-2), so a gun with no wheels lost its round
selector: FHSWEurope al_marj-1942's Flak 18/36 rolls its APHE and AA guns on
`c_PIThrottle` (W/S), and the glb said nothing about it. The census is
`surveys/census_springless_held_axes.py`.

A rig is JSON in the glb's first chunk; nothing it draws or places moves. So
this rewrites that chunk only, on the nodes a fresh extract would rig, to what
`browse_rig` gives them now (the template is looked up by name in the mod's
library), leaves the BIN chunk alone and refreshes the `.glb.gz`. A node that
already carries the axis is left as it is, so a second run changes nothing.

Scope: the tree's model glbs, and the level glbs of the EXPORTED levels only
(the rows of `maps.json`; FHSW and FHSWEurope: the rows with a `loading`
block), never a level the install ships and nobody exported.
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import glbgz, glbopt  # noqa: E402
from bf42.assemble import browse_rig  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from patch_engine_limits import library_for, rewrite_in_place  # noqa: E402
from patch_flag_cloth import MODS, glbs_under, tree_roots  # noqa: E402

SUFFIX = re.compile(r"_\d+$")
AXIS_ORDER = ("yaw", "pitch", "roll")
LOADING_ONLY = {"fhsw", "fhsweurope"}


def json_chunk(path: Path) -> dict | None:
    """The glb's JSON chunk, read without the BIN behind it."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(20)
            if len(head) < 20 or head[:4] != b"glTF":
                return None
            return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))
    except (OSError, ValueError, struct.error):
        return None


def is_rotational(extras: dict) -> bool:
    """Whether a node's extras name a RotationalBundle, in any spelling."""
    return str(extras.get("templateKind") or "").lower() == "rotationalbundle"


def patch_doc(doc: dict, library) -> int:
    """Add the held key axes a fresh extract gives each node; how many nodes
    changed. Mutates `doc`."""
    changed = 0
    for node in doc.get("nodes", []):
        extras = node.get("extras")
        # The kind as the .con spells it: FHSWEurope's horses say
        # `rotationalbundle`, and the engine reads it case-blind.
        if not isinstance(extras, dict) or not is_rotational(extras):
            continue
        # `build_node` rigs a node only when it draws or carries something.
        if "mesh" not in node and not node.get("children"):
            continue
        name = node.get("name") or ""
        template = library.object(name) or library.object(SUFFIX.sub("", name))
        if template is None or template.kind.lower() != "rotationalbundle":
            continue
        fresh = browse_rig(template, has_visible_springs=False)
        if not fresh:
            continue
        rig = extras.get("rig")
        have = (rig or {}).get("axes") or {}
        missing = {axis: spec for axis, spec in fresh["axes"].items() if axis not in have}
        if not missing:
            continue
        merged = {**have, **missing}
        axes = {axis: merged[axis] for axis in AXIS_ORDER if axis in merged}
        control = (rig or {}).get("control") or extras.get("control") or "vehicle"
        extras["rig"] = {"axes": axes, "automaticReset": fresh["automaticReset"], "control": control}
        changed += 1
    return changed


def patch_bytes(data: bytes, library) -> tuple[bytes | None, int]:
    doc, blob = glbopt.read_glb(data)
    changed = patch_doc(doc, library)
    if not changed:
        return None, 0
    return glbopt.write_glb(doc, blob), changed


def exported_level_dirs(mod: str, maps: Path) -> set[Path] | None:
    rows_path = maps / "maps.json"
    if not rows_path.is_file():
        return None
    rows = json.loads(rows_path.read_text())
    if isinstance(rows, dict):
        rows = rows.get("maps") or rows.get("levels") or []
    if mod in LOADING_ONLY:
        rows = [r for r in rows if r.get("loading")]
    return {(maps / (r.get("glb") or f"{r['name']}/scene.glb")).parent for r in rows}


def candidate_glbs(mod: str):
    models, maps = tree_roots(mod)
    yield from glbs_under(models, mod)
    levels = exported_level_dirs(mod, maps)
    if not levels:
        return
    for path in glbs_under(maps, mod):
        if any(parent in levels for parent in path.parents):
            yield path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, xpack1, fhsw, fhsweurope, ...)")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.mod:
        parser.error("name a tree with --mod")
    started = time.time()
    for mod in args.mod:
        if mod not in MODS:
            parser.error(f"unknown tree {mod!r}; have {', '.join(MODS)}")
        library = library_for(mod, args.game_dir.expanduser())
        files = nodes = 0
        for path in candidate_glbs(mod):
            # The extras are JSON text: most glbs have no RotationalBundle.
            doc = json_chunk(path)
            if doc is None or not any(is_rotational(n.get("extras") or {})
                                      for n in doc.get("nodes", [])):
                continue
            if not patch_doc(doc, library):
                continue
            data = path.read_bytes()
            patched, n = patch_bytes(data, library)
            if patched is None:
                continue
            files += 1
            nodes += n
            print(f"  {'would patch' if args.dry_run else 'patched'} "
                  f"{path.relative_to(HERE / 'viewer')}: {n} node(s)")
            if not args.dry_run:
                rewrite_in_place(path, patched)
        print(f"{mod}: {files} glb(s), {nodes} node(s) {'would change' if args.dry_run else 'changed'}")
    print(f"{time.time() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
