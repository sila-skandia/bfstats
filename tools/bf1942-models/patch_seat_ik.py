#!/usr/bin/env python3
"""Drop `skeletonIK` from the nodes of finished glbs that the engine keeps none for.

    python3 patch_seat_ik.py --mod eod --mod fhsw
    python3 patch_seat_ik.py --mod eod --dry-run

`addSkeletonIK` is `AnimatedBundleTemplate`'s word, so a line written on a
SeatObject or a RotationalBundle pins nothing in the game (ledger IK-5,
`assemble.SKELETON_IK_KINDS`). Trees extracted before the exporter knew that
carry the lines in `extras.skeletonIK` of the model glbs and of every level
`scene.glb` that places one. Nothing else of those files moves, so this
rewrites the JSON chunk in place, leaves the BIN chunk alone and refreshes the
`.glb.gz`, where a re-bake of EoD's levels is an hour and a half. A second run
changes nothing.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import glbopt  # noqa: E402
from bf42.assemble import SKELETON_IK_KINDS  # noqa: E402
from patch_flag_cloth import MODS, VIEWER  # noqa: E402
from patch_weapon_stats import rewrite_in_place  # noqa: E402


def tree_glbs(mod: str):
    """The tree's model glbs and its levels' scene glbs."""
    sub = Path() if mod == "bf1942" else Path("mods") / mod
    models = VIEWER / "models" / sub
    if models.is_dir():
        yield from sorted(models.glob("*.glb"))
    maps = VIEWER / "maps" / sub
    if maps.is_dir():
        yield from sorted(p for p in maps.glob("*/*.glb")
                          if p.parent.name != "mods")


def patch_bytes(data: bytes) -> tuple[bytes, list[str]] | None:
    """The glb without its dead IK lines and the nodes that had them, or None."""
    if b'"skeletonIK"' not in data:
        return None
    doc, blob = glbopt.read_glb(data)
    dropped = []
    for node in doc.get("nodes", []):
        extras = node.get("extras")
        if not isinstance(extras, dict) or "skeletonIK" not in extras:
            continue
        if str(extras.get("templateKind", "")).lower() in SKELETON_IK_KINDS:
            continue
        del extras["skeletonIK"]
        dropped.append(node.get("name", "?"))
    return (glbopt.write_glb(doc, blob), dropped) if dropped else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, xpack1, eod, ...)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.mod:
        parser.error("name a tree with --mod")
    started = time.time()
    for mod in args.mod:
        if mod not in MODS:
            parser.error(f"unknown tree {mod!r}; have {', '.join(MODS)}")
        changed = 0
        verb = "would patch" if args.dry_run else "patched"
        for path in tree_glbs(mod):
            try:
                patched = patch_bytes(path.read_bytes())
            except (OSError, ValueError, KeyError) as exc:
                print(f"  {path}: {exc}")
                continue
            if patched is None:
                continue
            changed += 1
            names = sorted(set(patched[1]))
            print(f"  {verb} {path.relative_to(VIEWER)}: {', '.join(names)}")
            if not args.dry_run:
                rewrite_in_place(path, patched[0])
        print(f"{mod}: {changed} glb(s) {'would change' if args.dry_run else 'changed'}")
    print(f"{time.time() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
