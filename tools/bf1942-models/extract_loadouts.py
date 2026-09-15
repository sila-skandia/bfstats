#!/usr/bin/env python3
"""Export what each level hands each team, and what each kit puts in hand.

    python3 extract_loadouts.py --out ./viewer/maps/_shared/loadouts.json
    python3 extract_loadouts.py --mod EoD --out ./viewer/maps/mods/eod/_shared/loadouts.json
    python3 extract_loadouts.py --list

The map page's deploy screen has five kit rows; the game decides what a row
puts in the player's hands in two places, neither of them the level's own
scene:

* the level's `Init.con` — `game.setTeamSkin <team> <soldier>` and
  `game.setKit <team> <slot> <kit>`, replayed top to bottom (`kit.parse_level_kits`);
* the kit's `Objects.con` — the `HandFireArms` it `addTemplate`s at
  `itemIndex 3`, which is the slot the engine selects on spawn
  (`kit.primary_weapon`).

One small JSON per mod carries both halves, keyed the way the page looks them
up: levels by the lowercased archive stem (the directory `extract_map.py`
writes), kits by the name their `create` line spells. Everything in it is read
from the game files; nothing is a hand-maintained table of who carries what.

Standard library plus the system liblzo2, same as the rest of the pipeline.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod
from bf42 import kit as kit_mod

from extract_models import (DEFAULT_GAME_DIR, build_library, build_pools,
                            discover_levels, mod_chain)


def build_manifest(library: con_mod.ObjectLibrary, kits: dict[str, kit_mod.Kit],
                   loadouts: dict[str, dict[int, kit_mod.TeamLoadout]],
                   mod: str) -> dict:
    """The file the page loads, from collected kits and swept levels.

    Only kits some level binds are listed — a dead kit cannot be spawned with,
    and vanilla declares ten of them. A level naming a kit the library does
    not hold keeps the raw name so the gap is visible in the file rather than
    silently dropped; the page treats an unknown kit as no primary.
    """
    rows: dict[str, dict] = {}
    levels: dict[str, dict] = {}
    for level_name, teams in sorted(loadouts.items()):
        level_entry: dict[str, dict] = {}
        for team_id, team in sorted(teams.items()):
            slots: dict[str, str] = {}
            for slot, name in sorted(team.slots.items()):
                kit = kits.get(name.lower())
                if kit is None:
                    slots[str(slot)] = name
                    continue
                slots[str(slot)] = kit.template
                if kit.template not in rows:
                    items = [
                        (library.object(item).name if library.object(item) else item)
                        for item in kit.carried]
                    rows[kit.template] = {
                        "nation": kit.nation,
                        "class": kit.kit_class,
                        "team": kit.team,
                        "primary": kit.primary,
                        "items": items,
                    }
            level_entry[str(team_id)] = {"soldier": team.soldier, "slots": slots}
        levels[level_name.lower()] = level_entry
    return {
        "mod": mod,
        "primaryItemIndex": kit_mod.PRIMARY_ITEM_INDEX,
        "kits": dict(sorted(rows.items())),
        "levels": levels,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent / "viewer" / "maps"
                    / "_shared" / "loadouts.json")
    ap.add_argument("--list", action="store_true",
                    help="print the kit and level tables without writing anything")
    args = ap.parse_args()

    chain = mod_chain(args.game_dir.expanduser(), args.mod)
    if not chain:
        print(f"no mod chain for {args.mod}", file=sys.stderr)
        return 1
    _meshes, _textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)
    kits = kit_mod.collect(library)
    loadouts = kit_mod.level_loadouts(discover_levels(chain))
    manifest = build_manifest(library, kits, loadouts, args.mod)

    unarmed = [name for name, row in manifest["kits"].items() if not row["primary"]]
    unknown = sorted({name for level in manifest["levels"].values()
                      for team in level.values()
                      for name in team["slots"].values()
                      if name not in manifest["kits"]})
    print(f"{args.mod}: {len(loadouts)} levels, {len(manifest['kits'])} bound kits"
          + (f", {len(unarmed)} with no itemIndex-{kit_mod.PRIMARY_ITEM_INDEX} weapon:"
             f" {', '.join(unarmed)}" if unarmed else "")
          + (f", {len(unknown)} named but undeclared: {', '.join(unknown)}"
             if unknown else ""),
          file=sys.stderr)

    if args.list:
        for name, row in manifest["kits"].items():
            print(f"  {name:30s} {str(row['nation']):14s} {row['class']:10s} "
                  f"{str(row['primary'])}")
        for level, teams in manifest["levels"].items():
            print(f"  {level}")
            for team_id, team in teams.items():
                print(f"    team {team_id} {str(team['soldier']):22s} "
                      + "  ".join(f"{slot}:{kit}" for slot, kit in team["slots"].items()))
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, indent=1))
    print(f"-> {args.out} ({args.out.stat().st_size // 1024} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
