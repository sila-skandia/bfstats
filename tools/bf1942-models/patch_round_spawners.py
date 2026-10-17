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
the `.glb.gz`. A spec that already carries `spawners` is left as it is, so a
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

from bf42 import glbopt  # noqa: E402
from bf42.assemble import round_spawners  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from patch_engine_limits import library_for, rewrite_in_place  # noqa: E402
from patch_flag_cloth import MODS  # noqa: E402
from patch_held_axes import candidate_glbs, json_chunk  # noqa: E402


def spawners_of(library, projectile_name: str, cache: dict) -> list[dict]:
    """The spawner records a round carries, as `assemble.py` writes them."""
    key = projectile_name.lower()
    if key not in cache:
        cache[key] = round_spawners(library, library.object(projectile_name))
    return cache[key]


def patch_doc(doc: dict, library, cache: dict) -> int:
    """Add `spawners` to every round spec that lacks them; how many nodes
    changed. Mutates `doc`."""
    changed = 0
    for node in doc.get("nodes", []):
        fire = (node.get("extras") or {}).get("fireArms")
        projectile = fire.get("projectile") if isinstance(fire, dict) else None
        if not isinstance(projectile, dict) or "spawners" in projectile:
            continue
        name = projectile.get("template")
        spawners = spawners_of(library, name, cache) if name else []
        if spawners:
            projectile["spawners"] = spawners
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
