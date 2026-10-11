#!/usr/bin/env python3
"""Give an input-less Engine its span floor and servo law, in finished glbs.

    python3 patch_engine_limits.py --mod xpack2
    python3 patch_engine_limits.py --mod bf1942 --mod xpack1 --mod xpack2 --dry-run

`con.py` `physics()` writes `minRotation` and `automaticReset` on an Engine
that binds no input (ledger PHY-30): such an Engine has no `rig`, and the
floor of its roll span is what says whether `calculateAndClipAngle` pins `T1`
(the Flettner's rotors: `0/0/150` over `0/0/150`) or leaves it open (the
Stuka circles' dummy engine). Every glb extracted before that carries neither.
A re-extract of the one Flettner costs seconds, but the level it is baked into
(`raid_on_agheila/scene.glb`, 25 MB) is a full bake of a level, which other
work in the tree has layered patches onto. This rewrites only the JSON chunk,
for the nodes that need it, to the bytes a fresh extract gives them (the
template is looked up by name in the mod's library and `physics()` answers),
leaves the BIN chunk alone and refreshes the `.glb.gz`. A second run changes
nothing.
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

KEYS = ("minRotation", "automaticReset")
SUFFIX = re.compile(r"_\d+$")


def library_for(mod: str, game_dir: Path):
    chain = mod_chain(game_dir, MODS[mod])
    _, _, objects, _ = build_pools(chain, [])
    add_level_objects(objects, discover_levels(chain[:1]), chain=chain)
    return build_library(objects)


def patch_bytes(data: bytes, library) -> tuple[bytes | None, int]:
    """The glb with its input-less Engines' two words added, and how many
    nodes changed; `(None, 0)` when there is nothing to do."""
    # The extras are JSON text: a glb with no Engine node has nothing to do.
    if b'"Engine"' not in data:
        return None, 0
    doc, blob = glbopt.read_glb(data)
    changed = 0
    for node in doc.get("nodes", []):
        extras = node.get("extras") or {}
        physics = extras.get("physics")
        if (extras.get("templateKind") != "Engine" or "rig" in extras
                or not isinstance(physics, dict)
                or any(key in physics for key in KEYS)):
            continue
        name = node.get("name") or ""
        template = library.object(name) or library.object(SUFFIX.sub("", name))
        if template is None or template.kind.lower() != "engine":
            continue
        fresh = template.physics() or {}
        words = {key: fresh[key] for key in KEYS if key in fresh}
        if not words:
            continue
        physics.update(words)
        changed += 1
    if not changed:
        return None, 0
    return glbopt.write_glb(doc, blob), changed


def rewrite_in_place(path: Path, data: bytes) -> None:
    with open(path, "r+b") as handle:
        handle.write(data)
        handle.truncate()
    glbgz.ensure(path, data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, xpack1, xpack2, ...)")
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
                      f"{path.relative_to(HERE / 'viewer')}: {n} engine(s)")
                if not args.dry_run:
                    rewrite_in_place(path, patched)
        print(f"{mod}: {files} glb(s), {nodes} engine node(s) "
              f"{'would change' if args.dry_run else 'changed'}")
    print(f"{time.time() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
