#!/usr/bin/env python3
"""Fill the content-addressed glb store from finished model trees.

    store_glbs.py viewer/models                      # the vanilla tree alone
    store_glbs.py viewer/models/mods/gcmod
    store_glbs.py viewer/models --mods               # vanilla and every mod tree
    store_glbs.py viewer/models/mods/fhsw --verify   # byte-compare existing blobs

Phase 5 of `features/mesh-asset-size` (`bf42/glbstore.py`): every model, rig
and pose glb a tree's manifests name is hashed and stored once as
`<mesh root>/glbs/<sha256>.glb` (with its deterministic `.glb.gz`), and the
manifest records `name -> sha` for the viewer to fetch the blob through. The
per-tree glbs are not touched, so an untreated page, the stats site's
path-serving API routes and the hard-link mirrors keep working; removing the
superseded copies from the volume is a later, separate GC.

Idempotent and deterministic, like `optimise_mesh.py`: a second run writes
nothing. Run it after a bake the way the optimiser runs, over the tree the
bake wrote; a re-exported glb's old sha was dropped with its manifest row, so
until this runs again that name simply loads from its per-tree path.

A tree given by path is one model tree: the directory holding `models.json`,
`viewmodels/` or `poses/` (`viewer/models`, or `viewer/models/mods/<m>`).
`--mods` adds every `mods/<m>` under a given root. The mesh root (where
`glbs/` hangs, beside `models/` and `textures/`) is derived from the tree's
own path unless `--mesh-root` says otherwise, so a scratch copy of a tree
builds a scratch store.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from bf42 import glbstore

VIEWER = Path(__file__).resolve().parent / "viewer"


def mesh_root_of(tree: Path) -> Path | None:
    """The directory above the `models/` a tree lives in, or None."""
    for parent in [tree.resolve(), *tree.resolve().parents]:
        if parent.name == "models":
            return parent.parent
    return None


def expand(paths: list[Path], mods: bool) -> list[Path]:
    trees: list[Path] = []
    for path in paths:
        trees.append(path)
        if mods and (path / "mods").is_dir():
            trees += sorted(p for p in (path / "mods").iterdir() if p.is_dir())
    return trees


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", type=Path,
                        help="model tree roots (viewer/models, viewer/models/mods/<m>)")
    parser.add_argument("--mods", action="store_true",
                        help="also every mods/<m> tree under the given roots")
    parser.add_argument("--mesh-root", type=Path, default=None,
                        help="the directory to hang glbs/ off (default: derived "
                             "from each tree's own path, the directory above its models/)")
    parser.add_argument("--verify", action="store_true",
                        help="byte-compare blobs that are already in the store")
    args = parser.parse_args()

    failures = 0
    total = glbstore.Result()
    for tree in expand([p.resolve() for p in args.paths], args.mods):
        if not tree.is_dir():
            print(f"{tree}: not a directory", file=sys.stderr)
            failures += 1
            continue
        mesh_root = (args.mesh_root or mesh_root_of(tree) or tree.parent).resolve()
        try:
            result = glbstore.store_tree(tree, mesh_root, verify=args.verify)
        except (ValueError, OSError) as exc:
            print(f"FAILED {tree}: {exc}", file=sys.stderr)
            failures += 1
            continue
        total.add(result)
        print(f"{tree}: {result.files} glbs ({result.bytes / 1e6:,.1f} MB) -> "
              f"{result.distinct} blobs ({result.distinct_bytes / 1e6:,.1f} MB), "
              f"{result.blobs_written} new, {result.gz_written} .gz written, "
              f"{result.recorded} names recorded, "
              f"{len(result.manifests)} manifests rewritten", file=sys.stderr)
    if total.files:
        print(f"total: {total.files} glbs ({total.bytes / 1e6:,.1f} MB) -> "
              f"{total.distinct} distinct in this run ({total.distinct_bytes / 1e6:,.1f} MB); "
              f"{total.blobs_written} blobs and {total.gz_written} .gz written",
              file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
