"""What a game mode's script creates beyond its seven layer files, per mod.

Run from the repository root. Backs `features/mode-script-statics/`: the
dedicated server runs the level's root `<mode>.con` (ledger TKT-3), and a
script can `Object.create` objects of its own, directly or through any file it
runs. The exporter reads those through `bf42.level.script_objects` (the host's
walk: `v_arg1 = host`, `if` arms decided, `run` relative to the including
file) and places the scenery among them per layer
(`extract_map.union_mode_statics`). This counts, per mod, what that walk
finds, by the kind of template created, and which levels gain statics.

    python3 features/bf1942-engine-reference/surveys/mode_script_statics.py
    python3 .../mode_script_statics.py --mods bf1942 XPack1 XPack2 --detail

Every level the mod's chain can load is read the way the extractor reads it
(`extract_map.load_level`, the mod's object library with the level's own
`Objects/` templates added), inherited levels included, so a pack's count
covers the vanilla levels in its tree as well.
"""
from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
import extract_map as em  # noqa: E402
from bf42.level import is_gameplay_kind  # noqa: E402
from extract_models import (build_library, build_pools, discover_levels,  # noqa: E402
                            mod_chain)

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mods", nargs="*", help="mod folder names (default: every installed mod)")
    ap.add_argument("--detail", action="store_true", help="print every static placed")
    args = ap.parse_args()
    mods_dir = GAME / "Mods"
    by_lower = {d.name.lower(): d.name for d in mods_dir.iterdir() if d.is_dir()}
    wanted = [by_lower[m.lower()] for m in args.mods] if args.mods else sorted(by_lower.values())
    for mod in wanted:
        started = time.time()
        chain = mod_chain(GAME, mod)
        levels = [name for name, _archive in discover_levels(chain)]
        kinds: Counter = Counter()
        files: Counter = Counter()
        gaining: list[tuple[str, list]] = []
        unreadable = 0
        for level in levels:
            try:
                _files, info, _hm, paths = em.load_level(GAME, mod, level, chain)
            except (Exception, SystemExit):  # a stub or damaged archive
                unreadable += 1
                continue
            _m, _t, objects, _g = build_pools(chain, [])
            for path in paths:
                objects.add_level_objects(path, label=level)
            library = build_library(objects)
            for gt in info.game_types.values():
                for inst in gt.objects:
                    kind = gt.declared.get(inst.template.lower())
                    if kind is None:
                        template = library.object(inst.template)
                        kind = template.kind.lower() if template is not None else "(unresolved)"
                    kinds[kind, is_gameplay_kind(kind)] += 1
            rows = em.union_mode_statics(info, library)
            if rows:
                gaining.append((level, rows))
                for inst, _modes in rows:
                    files[inst.source] += 1
        placed = sum(len(rows) for _level, rows in gaining)
        print(f"{mod}: {len(levels)} levels ({unreadable} unreadable), "
              f"{len(gaining)} gain {placed} statics, {time.time() - started:.0f} s")
        print("    created by the mode scripts, by kind (gameplay kinds are not placed):")
        for (kind, gameplay), count in kinds.most_common():
            print(f"      {kind:28s} {count:9d}{'  gameplay' if gameplay else ''}")
        if files:
            print("    placed, by the file that creates them:")
            for name, count in files.most_common(12):
                print(f"      {name:40s} {count:9d}")
        for level, rows in gaining:
            tags = Counter(tuple(modes) if modes else ("every layer",) for _i, modes in rows)
            print(f"    {level}: {len(rows)}  " + "; ".join(
                f"{n} in {'/'.join(t)}" for t, n in tags.most_common()))
            if args.detail:
                for inst, modes in rows:
                    print(f"        {inst.template} {inst.position} from {inst.source} "
                          f"-> {modes or 'every layer'}")


if __name__ == "__main__":
    main()
