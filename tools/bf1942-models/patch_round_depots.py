#!/usr/bin/env python3
"""Give a gun's round the SupplyDepots it carries, in finished glbs.

    python3 patch_round_depots.py --mod fhsw --mod fhsweurope --dry-run
    python3 patch_round_depots.py --mod fhsw

A round's `addTemplate` SupplyDepot children (a truck's thrown ammo box, an
ammo pack, FHSW's fire extinguisher `Extinguisher_repairpoint`, a mobile gun's
`DummyKiller` depot) ride its projectile spec as `projectile.depots` since
2026-10-16 (`bf42/assemble.py`, FHX-21). Before that the glb said nothing
about them, and the viewer neither built the extinguisher's gun group nor
stood its repair point.

The spec is JSON in the glb's first chunk; nothing it draws or places moves.
So this rewrites that chunk only, on each node whose `fireArms.projectile`
names a round with depot children (looked up by name in the mod's library,
the levels' own scripts included), leaves the BIN chunk alone and refreshes
the `.glb.gz`. A spec that already carries `depots` is left as it is, so a
second run changes nothing.

Scope: the tree's model glbs, and the level glbs of the EXPORTED levels only
(`patch_held_axes.candidate_glbs`), never a level nobody exported.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import con as con_mod, glbopt  # noqa: E402
from bf42.assemble import supply_extras  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from patch_engine_limits import library_for, rewrite_in_place  # noqa: E402
from patch_flag_cloth import MODS  # noqa: E402
from patch_held_axes import candidate_glbs, json_chunk  # noqa: E402


def round_depots(library, projectile_name: str, cache: dict) -> list[dict]:
    """The depot dicts a round carries, as `assemble.py` writes them."""
    key = projectile_name.lower()
    if key not in cache:
        depots = []
        projectile = library.object(projectile_name)
        for ref in (projectile.children if projectile is not None else []):
            name = con_mod.instance_template_name(ref, library.object)
            child = library.object(name) if name else None
            if child is not None and child.kind.lower() == "supplydepot":
                depots.append({"template": child.name, **supply_extras(child)})
        cache[key] = depots
    return cache[key]


def patch_doc(doc: dict, library, cache: dict) -> int:
    """Add `depots` to every round spec that lacks them; how many nodes
    changed. Mutates `doc`."""
    changed = 0
    for node in doc.get("nodes", []):
        fire = (node.get("extras") or {}).get("fireArms")
        projectile = fire.get("projectile") if isinstance(fire, dict) else None
        if not isinstance(projectile, dict) or "depots" in projectile:
            continue
        name = projectile.get("template")
        depots = round_depots(library, name, cache) if name else []
        if depots:
            projectile["depots"] = depots
            changed += 1
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, fh, fhsw, fhsweurope, ...)")
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
        cache: dict = {}
        files = nodes = 0
        for path in candidate_glbs(mod):
            doc = json_chunk(path)
            if doc is None or not patch_doc(doc, library, cache):
                continue
            data = path.read_bytes()
            full, blob = glbopt.read_glb(data)
            n = patch_doc(full, library, cache)
            if not n:
                continue
            files += 1
            nodes += n
            print(f"  {'would patch' if args.dry_run else 'patched'} "
                  f"{path.relative_to(HERE / 'viewer')}: {n} node(s)")
            if not args.dry_run:
                rewrite_in_place(path, glbopt.write_glb(full, blob))
        print(f"{mod}: {files} glb(s), {nodes} node(s) {'would change' if args.dry_run else 'changed'}")
    print(f"{time.time() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
