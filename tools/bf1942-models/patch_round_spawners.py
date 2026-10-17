#!/usr/bin/env python3
"""Give a gun's round the ObjectSpawners it carries, in finished glbs.

    python3 patch_round_spawners.py --mod fhsw --mod fhsweurope --dry-run
    python3 patch_round_spawners.py --mod fhsw

A round's `addTemplate` ObjectSpawner children ride its projectile spec as
`projectile.spawners` since 2026-10-17 (`bf42/assemble.py`
`round_spawner_record`): every FH mobile gun's deploy round
(`*_TransformSpawnerProjectile`, which stands the static gun four seconds
after it lands), the artillery's and ships' `PenetrateExplosion*Spawner`, the
torpedoes' dummy PCOs, FHSW's `AdvancedPost_*` posts. Before that the glb said
nothing about them, and the viewer neither built the deploy seat's gun group
nor stood what the round places.

The spec is JSON in the glb's first chunk; nothing it draws or places moves.
So this rewrites that chunk only, on each node whose `fireArms.projectile`
names a round with spawner children (looked up by name in the mod's library,
the levels' own scripts included), leaves the BIN chunk alone and refreshes
the `.glb.gz`. Such a round's spec that has a `box` also gains `boxMin`, the
box's low corner (the round rests on its box, not on its origin, and its
spawner stands what it places from there). A spec that already carries the
record the exporter writes today is left as it is, so a second run changes
nothing; an older record (before an entry said `drawn` and `logic`) is
replaced.

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

from bf42 import glbopt  # noqa: E402
from bf42.assemble import box_min, geometry_header_bounds, round_spawners  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, add_level_objects, build_library, build_pools, discover_levels, mod_chain,
)
from patch_engine_limits import rewrite_in_place  # noqa: E402
from patch_flag_cloth import MODS  # noqa: E402
from patch_held_axes import candidate_glbs, json_chunk  # noqa: E402


def spawners_of(library, projectile_name: str, cache: dict) -> list[dict]:
    """The spawner records a round carries, as `assemble.py` writes them."""
    key = projectile_name.lower()
    if key not in cache:
        cache[key] = round_spawners(library, library.object(projectile_name))
    return cache[key]


def library_and_meshes(mod: str, game_dir: Path):
    """The mod's template library (its levels' own scripts included) and its
    mesh pool, as `patch_engine_limits.library_for` builds the first."""
    chain = mod_chain(game_dir, MODS[mod])
    meshes, _, objects, _ = build_pools(chain, [])
    add_level_objects(objects, discover_levels(chain[:1]), chain=chain)
    return build_library(objects), meshes


def round_box_min(library, meshes, projectile_name: str, cache: dict):
    key = ("box", projectile_name.lower())
    if key not in cache:
        projectile = library.object(projectile_name)
        bounds = (geometry_header_bounds(library, meshes, projectile.geometry)
                  if projectile is not None and projectile.geometry and meshes is not None else None)
        cache[key] = box_min(bounds) if bounds is not None else None
    return cache[key]


def patch_doc(doc: dict, library, cache: dict, meshes=None) -> int:
    """Add `spawners` to every round spec that lacks them, and to such a
    round's spec with a `box` the box's low corner (`boxMin`: where it rests);
    how many nodes changed. Mutates `doc`."""
    changed = 0
    for node in doc.get("nodes", []):
        fire = (node.get("extras") or {}).get("fireArms")
        projectile = fire.get("projectile") if isinstance(fire, dict) else None
        if not isinstance(projectile, dict):
            continue
        name = projectile.get("template")
        if not name:
            continue
        touched = False
        # Written when absent, and rewritten when the exporter's record has
        # grown since (an entry's `drawn` and `logic`, 2026-10-17).
        spawners = spawners_of(library, name, cache)
        if spawners and projectile.get("spawners") != spawners:
            projectile["spawners"] = spawners
            touched = True
        if projectile.get("spawners") and "box" in projectile and "boxMin" not in projectile:
            low = round_box_min(library, meshes, name, cache)
            if low is not None:
                projectile["boxMin"] = low
                touched = True
        changed += touched
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
        library, meshes = library_and_meshes(mod, args.game_dir.expanduser())
        cache: dict = {}
        files = nodes = 0
        for path in candidate_glbs(mod):
            doc = json_chunk(path)
            if doc is None or not patch_doc(doc, library, cache, meshes):
                continue
            data = path.read_bytes()
            full, blob = glbopt.read_glb(data)
            n = patch_doc(full, library, cache, meshes)
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
