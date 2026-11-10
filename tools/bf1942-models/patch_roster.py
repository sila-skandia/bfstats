#!/usr/bin/env python3
"""Bring a finished tree's `models.json` roster to what `bf42/roster.py` reads today.

    python3 patch_roster.py --mod desertcombat
    python3 patch_roster.py --mod bf1918 --dry-run      # a fresh tree: no row moves
    python3 patch_roster.py --mod desertcombat --file /tmp/live/models.json

`--file` patches a catalogue somewhere else: the published one, fetched,
when the local tree is not the one the site serves (the live rows carry the
store's `sha` and a `thumb`; a local tree extracted since may not).

Each catalogue row carries who fields the template: `sides`, and
`levelSides`, the same level by level (`Roster.entry`). They are read from
the mod's kits and its levels' scripts, not from any model, so a change to
the roster (SIDE-4: a side is the team the level data puts a template on,
not its nation's WWII alliance) is in no tree extracted before it. The
`models` step that would write it re-exports every glb of the mod, which a
level bake then has to follow. This rewrites only those two fields of each
row, from the roster a fresh extract builds (the mod's own chain and every
level archive in it), and leaves every glb, report and the rest of the row
alone. A second run changes nothing.

The row's other roster fields (`factions`, `levels`, `theatres`,
`kitClasses`) are left as extracted: SIDE-4 did not move them, and they
follow whichever level archives the install held that day (the community
maps come and go from vanilla's `levels/`).

What reads them: the tank school's and the dogfight school's arenas
(`viewer/tank-arena.js` `sidesOn`), the Range, and the model browser's
facets. Desert Combat's catalogue of 2026-11-09 called every vehicle
"Allied" (its nations are not WWII's), so neither school could pair a
battle there (features/dogfight-doctrine-1991, "The arenas").
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import roster as roster_mod  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, add_level_objects, build_library, build_pools, discover_levels, mod_chain,
)
from patch_flag_cloth import MODS, VIEWER  # noqa: E402

FIELDS = ("sides", "levelSides")


def roster_for(mod: str, game_dir: Path) -> roster_mod.Roster:
    """The roster a fresh `extract_models.py --mod <mod>` builds."""
    chain = mod_chain(game_dir, MODS[mod])
    _, _, objects, _ = build_pools(chain, [])
    levels = discover_levels(chain)
    add_level_objects(objects, levels, chain)
    roster, _, _ = roster_mod.build(build_library(objects), levels)
    return roster


def patch_rows(rows: list[dict], roster: roster_mod.Roster) -> list[tuple[str, str]]:
    """Set every row's `sides` and `levelSides` in place; `(name, field)` for each that moved."""
    moved = []
    for row in rows:
        if not isinstance(row, dict) or not row.get("name"):
            continue
        for field, value in roster.entry(row["name"]).items():
            if field in FIELDS and row.get(field) != value:
                row[field] = value
                moved.append((row["name"], field))
    return moved


def models_json(mod: str) -> Path:
    return (VIEWER / "models" if mod == "bf1942" else VIEWER / "models" / "mods" / mod) / "models.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--mod", action="append", required=True, choices=sorted(MODS))
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--dry-run", action="store_true", help="say what would move, write nothing")
    ap.add_argument("--file", type=Path, default=None,
                    help="the catalogue to patch instead of the local tree's (one --mod)")
    args = ap.parse_args()
    if args.file is not None and len(args.mod) != 1:
        ap.error("--file takes exactly one --mod")
    for mod in args.mod:
        path = args.file or models_json(mod)
        rows = json.loads(path.read_text())
        moved = patch_rows(rows, roster_for(mod, args.game_dir))
        by_field: dict[str, int] = {}
        for _, field in moved:
            by_field[field] = by_field.get(field, 0) + 1
        said = ", ".join(f"{n} {f}" for f, n in sorted(by_field.items())) or "nothing"
        print(f"{mod}: {len({name for name, _ in moved})} of {len(rows)} rows move ({said})"
              + (" [dry run]" if args.dry_run else ""))
        if moved and not args.dry_run:
            path.write_text(json.dumps(rows, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
