#!/usr/bin/env python3
"""Each level's aircraft by team, for the dogfight school's arenas
(features/dogfight-doctrine, "The BF1918 arena").

The school pairs a battle's fighters by the model catalogue's `sides`
(`bf42/roster.py`), which reads a template's nation and calls it Axis or
Allied the WWII way. That fails for a mod whose teams change from level to
level: BF1918 calls the SPAD VII and the Nieuport 11 "Axis" (Italy is an
Axis nation in WWII) and gives the Camel no side at all. What a level
really fields is in its object spawners: each names the template it
spawns for each team (`objectSpawns[].templates`, `{"1": ..., "2": ...}`,
the exporter's reading of `ObjectSpawner.setObjectTemplate <team> <name>`).

This writes `<maps tree>/dogfight-arenas.json`:

    {"version": 1, "levels": {"<level>": {"1": [templates], "2": [templates]}}}

with every aircraft template (the catalogue's `category: air`, in its own
spelling) each team spawns on each level, levels with aircraft on both
teams only. Reads the tree's `scene.json` files and its `models.json`;
seconds for a tree.

    python3 extract_dogfight_arenas.py viewer/maps/mods/bf1918 [--models viewer/models/mods/bf1918]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def aircraft_names(models_json: Path) -> dict[str, str]:
    """The catalogue's aircraft, lowercased name to its own spelling."""
    rows = json.loads(models_json.read_text())
    rows = rows if isinstance(rows, list) else rows.get("models", rows)
    return {r["name"].lower(): r["name"] for r in rows if isinstance(r, dict) and r.get("category") == "air" and r.get("name")}


def level_teams(scene: dict, air: dict[str, str]) -> dict[str, list[str]]:
    """The aircraft each team spawns on a level, by team id, sorted."""
    teams: dict[str, set[str]] = {}
    for spawn in scene.get("objectSpawns") or []:
        for team, template in (spawn.get("templates") or {}).items():
            name = air.get(str(template or "").lower())
            if name and str(team) in ("1", "2"):
                teams.setdefault(str(team), set()).add(name)
    return {team: sorted(names) for team, names in sorted(teams.items())}


def build(maps_tree: Path, models_tree: Path) -> dict:
    air = aircraft_names(models_tree / "models.json")
    levels: dict[str, dict[str, list[str]]] = {}
    for scene_path in sorted(maps_tree.glob("*/scene.json")):
        teams = level_teams(json.loads(scene_path.read_text()), air)
        if teams.get("1") and teams.get("2"):
            levels[scene_path.parent.name] = teams
    return {"version": 1, "levels": levels}


def models_tree_for(maps_tree: Path) -> Path:
    """`viewer/maps[/mods/<mod>]` -> `viewer/models[/mods/<mod>]`."""
    parts = list(maps_tree.resolve().parts)
    i = len(parts) - 1 - parts[::-1].index("maps")
    return Path(*parts[:i], "models", *parts[i + 1:])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("maps_tree", type=Path)
    ap.add_argument("--models", type=Path, default=None, help="the tree's models directory (default: its sibling)")
    args = ap.parse_args()
    out = build(args.maps_tree, args.models or models_tree_for(args.maps_tree))
    target = args.maps_tree / "dogfight-arenas.json"
    target.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"{target}: {len(out['levels'])} levels with aircraft on both teams")


if __name__ == "__main__":
    main()
