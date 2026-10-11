#!/usr/bin/env python3
"""Put re-baked `scene.glb` files (and their `.gz`) into a published maps tree,
and nothing else of the bake.

    python3 extract_maps_all.py --mod XPack2 -j 6 --out ~/.cache/x/mesh/maps/mods/xpack2
    python3 swap_scene_glbs.py --scratch ~/.cache/x/mesh/maps/mods/xpack2 --tree xpack2
    python3 swap_scene_glbs.py ... --apply [--levels essen tobruk] [--backup DIR]

A bake rewrites a level's whole directory and its `scene.json`, which other
sessions patch layer by layer (`patch_scene.py`: sounds, spawns, game ...), so
a bake is never promoted wholesale into a shared tree. The glb is the one file
of a bake only a bake can produce; this moves it, through the tree's own inode
(hard-link mirrors see it), after checking that every texture it names is in
the shared store (or copying it from the scratch store). The old file goes to
`--backup` first. A `scene.json` that has to follow the glb (a placement that
moved) is `patch_scene.py --layer spawns`, run on the tree afterwards.

The scratch maps root must sit under a mesh root with `maps/` and `textures/`
(`<mesh root>/maps/mods/<id>`), the way `extract_maps_all.py` leaves it.
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"


def glb_uris(path: Path) -> list[str]:
    raw = path.read_bytes()
    length = struct.unpack("<I", raw[12:16])[0]
    return [i["uri"] for i in json.loads(raw[20:20 + length]).get("images", []) if "uri" in i]


def swap(scratch: Path, tree: Path, store: Path, scratch_store: Path, *,
         levels: list[str] | None = None, apply: bool = False,
         backup: Path | None = None) -> dict:
    want = {name.lower() for name in levels} if levels else None
    swapped: list[str] = []
    missing_textures: list[str] = []
    for level in sorted(p.name for p in scratch.iterdir() if p.is_dir()):
        new, live = scratch / level / "scene.glb", tree / level / "scene.glb"
        if want is not None and level.lower() not in want:
            continue
        if not new.is_file() or not live.is_file():
            continue
        if new.read_bytes() == live.read_bytes():
            continue
        needed = sorted({u.split("textures/", 1)[1] for u in glb_uris(new)})
        to_add = [t for t in needed if not (store / t).is_file()]
        lost = [t for t in to_add if not (scratch_store / t).is_file()]
        if lost:
            missing_textures += [f"{level}: {t}" for t in lost]
            continue            # a glb that names a texture nobody has is not installed
        swapped.append(level)
        if not apply:
            continue
        for t in to_add:
            (store / t).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(scratch_store / t, store / t)
        for suffix in ("", ".gz"):
            src, dst = scratch / level / f"scene.glb{suffix}", live.with_name(f"scene.glb{suffix}")
            if backup is not None:
                kept = backup / level / dst.name
                kept.parent.mkdir(parents=True, exist_ok=True)
                if not kept.exists() and dst.exists():
                    shutil.copyfile(dst, kept)
            data = src.read_bytes()
            with open(dst, "r+b") as fh:
                fh.write(data)
                fh.truncate()
    return {"swapped": swapped, "texturesNowhere": missing_textures}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scratch", type=Path, required=True,
                    help="<mesh root>/maps/mods/<id> (or <mesh root>/maps for vanilla)")
    ap.add_argument("--tree", required=True, help="tree id (xpack2) or bf1942")
    ap.add_argument("--levels", nargs="*")
    ap.add_argument("--backup", type=Path)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    scratch = args.scratch.expanduser().resolve()
    vanilla = args.tree in ("bf1942", "vanilla")
    tree = VIEWER / "maps" if vanilla else VIEWER / "maps" / "mods" / args.tree
    root = scratch.parent if vanilla else scratch.parents[2]
    result = swap(scratch, tree, VIEWER / "textures", root / "textures",
                  levels=args.levels, apply=args.apply,
                  backup=args.backup.expanduser() if args.backup else None)
    print(json.dumps(result, indent=1))
    return 1 if result["texturesNowhere"] else 0


if __name__ == "__main__":
    sys.exit(main())
