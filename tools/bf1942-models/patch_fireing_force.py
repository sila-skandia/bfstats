#!/usr/bin/env python3
"""Give a gun its `fireingForce` hull shove, in finished glbs.

    python3 patch_fireing_force.py --mod bf1942 --mod xpack1 --mod xpack2
    python3 patch_fireing_force.py --mod fhsw --dry-run
    python3 patch_fireing_force.py --census          # who declares the word

`con.py` reads `ObjectTemplate.fireingForce` (sic) and `assemble.py` writes it
into a gun node's `extras.fireArms`, where `viewer/gun-recoil.js` turns it into
the shove `FireArms::Fire` gives the hull (ledger FA-1). Every glb extracted
before the word was read carries no such key, and a tank gun is baked into two
places: the vehicle's own model glb and every level `scene.glb` that places it.
A full bake of both trees to add one float is minutes a tree for vanilla and
hours for the big mods, and it would re-send geometry nothing touched.

This rewrites only the JSON chunk, for the gun nodes that need it, to the bytes
a fresh extract gives them (the template is looked up by name in the mod's own
chain), leaves the BIN chunk alone and refreshes the `.glb.gz`. A second run
changes nothing. A key that is already right is left alone; one that disagrees
with the template is corrected, and one the template no longer earns is removed,
so the run is the same whichever way a tree drifted.

`--census` reads no glb: it lists, per installed mod, the FireArms templates
that declare the word and what they declare, which is the set this patch can
reach.
"""
from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import glbgz, glbopt  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, add_level_objects, build_library, build_pools, discover_levels, mod_chain,
)
from patch_flag_cloth import MODS, glbs_under, tree_roots  # noqa: E402

KEY = "fireingForce"
SUFFIX = re.compile(r"_\d+$")


def library_for(mod: str, game_dir: Path):
    chain = mod_chain(game_dir, MODS[mod])
    _, _, objects, _ = build_pools(chain, [])
    add_level_objects(objects, discover_levels(chain[:1]), chain=chain)
    return build_library(objects)


def force_of(library, name: str) -> float | None:
    """What a fresh extract would write for the gun node called `name`.

    The engine gates on `> 0` (`0x0828a293`), so a template that declares 0 and
    one that declares nothing are the same gun and both answer None.
    """
    template = library.object(name) or library.object(SUFFIX.sub("", name))
    if template is None:
        return None
    force = getattr(template, "fireing_force", None)
    return force if (force or 0) > 0 else None


def patch_doc(doc: dict, library) -> int:
    """Bring every gun node's `fireingForce` to the template's, in place, and
    say how many nodes changed.

    A key that is already right is left alone; one that disagrees is corrected;
    one the template no longer earns is removed. So the pass is idempotent and
    converges whichever way a tree drifted.
    """
    changed = 0
    for node in doc.get("nodes", []):
        stats = (node.get("extras") or {}).get("fireArms")
        if not isinstance(stats, dict):
            continue
        force = force_of(library, node.get("name") or "")
        if force is None:
            if KEY in stats:
                del stats[KEY]
                changed += 1
            continue
        if stats.get(KEY) == force:
            continue
        stats[KEY] = force
        changed += 1
    return changed


def patch_bytes(data: bytes, library) -> tuple[bytes | None, int]:
    """The glb with its guns' `fireingForce` brought to the template's, and how
    many nodes changed; `(None, 0)` when there is nothing to do."""
    # The extras are JSON text: a glb with no gun has nothing to do.
    if b'"fireArms"' not in data:
        return None, 0
    doc, blob = glbopt.read_glb(data)
    changed = patch_doc(doc, library)
    if not changed:
        return None, 0
    return glbopt.write_glb(doc, blob), changed


def rewrite_in_place(path: Path, data: bytes) -> None:
    with open(path, "r+b") as handle:
        handle.write(data)
        handle.truncate()
    glbgz.ensure(path, data)


def census(game_dir: Path) -> int:
    for mod in MODS:
        chain = mod_chain(game_dir, MODS[mod])
        if not chain or not chain[0].is_dir():
            continue
        try:
            library = library_for(mod, game_dir)
        except (OSError, ValueError) as exc:
            print(f"{mod}: {exc}")
            continue
        rows = []
        for template in library.objects.values():
            force = getattr(template, "fireing_force", None)
            if (force or 0) > 0:
                rows.append((template.name, force))
        rows.sort(key=lambda row: (-row[1], row[0]))
        print(f"{mod}: {len(rows)} gun(s) declare {KEY}")
        for name, force in rows[:40]:
            print(f"    {force:>8g}  {name}")
        if len(rows) > 40:
            print(f"    ... and {len(rows) - 40} more")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, xpack1, xpack2, ...)")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--census", action="store_true",
                        help="list the guns that declare the word, and stop")
    args = parser.parse_args()
    game_dir = args.game_dir.expanduser()
    if args.census:
        return census(game_dir)
    if not args.mod:
        parser.error("name a tree with --mod, or pass --census")
    started = time.time()
    for mod in args.mod:
        if mod not in MODS:
            parser.error(f"unknown tree {mod!r}; have {', '.join(MODS)}")
        library = library_for(mod, game_dir)
        files = nodes = 0
        for root in tree_roots(mod):
            for path in glbs_under(root, mod):
                try:
                    data = path.read_bytes()
                except OSError:
                    continue
                try:
                    patched, n = patch_bytes(data, library)
                except (ValueError, KeyError) as exc:
                    print(f"  {path}: {exc}")
                    continue
                if patched is None:
                    continue
                files += 1
                nodes += n
                print(f"  {'would patch' if args.dry_run else 'patched'} "
                      f"{path.relative_to(HERE / 'viewer')}: {n} gun(s)")
                if not args.dry_run:
                    rewrite_in_place(path, patched)
        print(f"{mod}: {files} glb(s), {nodes} gun node(s) "
              f"{'would change' if args.dry_run else 'changed'}")
    print(f"{time.time() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
