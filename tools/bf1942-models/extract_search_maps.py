#!/usr/bin/env python3
"""Write every extracted level's baked search maps beside its scene.

Each level archive ships the search maps its `AIpathFinding.con` declares,
baked (`Pathfinding/<name>Level<L>Map.raw`), and the retail server loads
them with `ai.loadMaps` instead of painting its own. This writes, for each
level directory in a maps tree, `pathfinding/index.json` and each loaded
map's minimum level (`bf42.ai_level.write_level_search_maps`), which is what
the viewer's bots and the headless runner search (`viewer/nav-baked.js`).
`extract_map.py` writes the same folder on a full level extraction; this is
the pass that fills a tree without re-baking every scene.

    python3 extract_search_maps.py --mod bf1942 --out viewer/maps
    python3 extract_search_maps.py --mod XPack1 --out viewer/maps/mods/xpack1
    python3 extract_search_maps.py --mod EoD --out viewer/maps/mods/eod --levels bocage wake

Without `--levels`, every directory of the tree that holds a `scene.json`
and is a level of the mod's chain is written.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42.ai_level import load_level_ai, write_level_search_maps  # noqa: E402
from bf42.level import find_level_archives, load_level_files  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, discover_levels, mod_chain  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, required=True, help="the mod's maps tree")
    ap.add_argument("--levels", nargs="*", default=None)
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    chain = mod_chain(game_dir, args.mod)
    by_lower = {name.lower(): name for name, _ in discover_levels(chain)}
    if args.levels is not None:
        wanted = [lvl.lower() for lvl in args.levels]
    else:
        wanted = sorted(d.name for d in args.out.iterdir()
                        if d.is_dir() and not d.is_symlink() and (d / "scene.json").is_file())
    written = baked = painted = 0
    for lower in wanted:
        name = by_lower.get(lower)
        if name is None:
            print(f"{lower}: not a level of {args.mod}", file=sys.stderr)
            continue
        files = load_level_files(find_level_archives(game_dir, args.mod, name, chain=chain), name)
        index = write_level_search_maps(files, load_level_ai(files), args.out / lower)
        if index is None:
            print(f"{lower}: no search maps")
            continue
        written += 1
        parts = []
        for row in index["maps"]:
            if row["loaded"]:
                baked += 1
                parts.append(f"{row['name']}@L{row['level']} {row['bytes']}")
            else:
                painted += 1
                parts.append(f"{row['name']} not loaded ({row['reason']})")
        print(f"{lower}: " + ", ".join(parts))
    print(json.dumps({"levels": written, "loaded": baked, "notLoaded": painted}), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
