#!/usr/bin/env python3
"""Add (or refresh) the `ai` block of an already-extracted level's scene.json.

    python3 patch_ai_extras.py --mod bf1942 el_alamein wake ...
    python3 patch_ai_extras.py --mod bf1942 --all

A full `extract_map.py` run writes the same block; this only re-reads the
level's AI scripts (`bf42/ai_level.py`) so the extracted tree need not be
rebuilt to give the viewer's bots their strategic areas and strategies.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42.ai_level import load_level_ai, add_cover_values  # noqa: E402
from bf42.level import (  # noqa: E402
    find_level_archives, load_level_files, parse_static_objects,
)
from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from extract_loadouts import build_pools, build_library, mod_chain  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("levels", nargs="*")
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--out", type=Path, default=HERE / "viewer" / "maps")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    root = args.out if args.mod == "bf1942" else args.out / "mods" / args.mod
    levels = args.levels
    if args.all:
        levels = [p.name for p in sorted(root.iterdir())
                  if (p / "scene.json").exists()]
    # The object library, for each placed template's `coverValue`.
    chain = mod_chain(args.game_dir.expanduser(), args.mod)
    library = None
    if chain:
        _m, _t, objects, _g = build_pools(chain, [])
        library = build_library(objects)
    rc = 0
    for level in levels:
        scene = root / level.lower() / "scene.json"
        if not scene.exists():
            print(f"{level}: no scene.json at {scene}", file=sys.stderr)
            rc = 1
            continue
        try:
            paths = find_level_archives(args.game_dir.expanduser(), args.mod, level)
        except Exception as exc:  # noqa: BLE001
            print(f"{level}: {exc}", file=sys.stderr)
            rc = 1
            continue
        files = load_level_files(paths, level)
        ai = load_level_ai(files)
        extras = json.loads(scene.read_text())
        if ai is None:
            extras.pop("ai", None)
            print(f"{level}: no AI.con")
        else:
            if library is not None:
                templates = set()
                for name in files.names():
                    if name.lower().endswith("staticobjects.con"):
                        text = files.read(name).decode("latin-1", "replace")
                        templates.update(inst.template for inst in parse_static_objects(text))
                add_cover_values(ai, library, templates)
            extras["ai"] = ai.to_json()
            print(f"{level}: {len(ai.strategicAreas)} areas, {len(ai.strategies)} strategies, "
                  f"{len(ai.conditions)} conditions, {len(ai.coverValues)} cover templates, "
                  f"sides {sorted(ai.sideStrategies)}")
        scene.write_text(json.dumps(extras, indent=2))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
