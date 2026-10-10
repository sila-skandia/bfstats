#!/usr/bin/env python3
"""Every hull in a mod that carries a sonar or radar scope, as one shared table.

    python3 extract_vehicle_sonar.py --mod bf1942     # viewer/maps/_shared/vehicle-sonar.json
    python3 extract_vehicle_sonar.py --mod DC_Final   # viewer/maps/mods/dc_final/_shared/...

The scope is the minimap's (SONAR-4..SONAR-6, `features/vehicle-radar`): a seat
whose PlayerControlObject writes `sonarPos 1` gets a sweep on its map, fed by
the first SonarObject under its hull. Vanilla has two, the destroyers'
`DestroyerSonar` and the submarines' `SubmarineSonar`. Desert Combat hangs
`DestroyerSonar` on its jets and SonarObjects of its own, with
`enableRadarMode 1`, on its anti-air hulls.

`<tree>/_shared/vehicle-sonar.json`:

    {"mod": "DC_Final", "rotationSpeed": 0.1, "vehicles": [
      {"template": "F-15C", "sonar": "DestroyerSonar", "radius": 400.0,
       "radarMode": false, "scanForEnemySonars": false, "seats": ["F-15C"]}]}

`rotationSpeed` is the mod's `Game.setSonarRotationSpeed`, radians the sweep
turns per map update (SONAR-5): 0.025 in vanilla's `Init/Menu.con`, 0.1 in
Desert Combat's, 0.05 in FHSW's `Init.con` after it has run the menu's.

`template` is the hull's declared name and `seats` the PlayerControlObjects
under it (the hull itself included) that write `sonarPos 1`; the viewer matches
both case-insensitively. A hull with a sonar seat and no SonarObject (DC's
AC-130) or a SonarObject and no sonar seat draws nothing in the game and gets
no entry.

A table and not a glb field, the way `vehicle-sounds.json` is: these are con
words no mesh depends on, a level's `scene.glb` holds a baked copy of every
hull it places, and one small JSON per tree reaches every level without a
re-bake. The templates asked are `extract_vehicle_sounds.vehicle_templates`'
(every hull a round can field), and a level's own objects are left out for the
reason given there.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import con as con_mod  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, build_pools, discover_levels, spawned_templates,
)
from extract_vehicle_sounds import load_sources, vehicle_templates  # noqa: E402
from scene_layers import tree_for  # noqa: E402

MAPS = HERE / "viewer" / "maps"
TABLE_NAME = "vehicle-sonar.json"

# `SonarObjectTemplate::SonarObjectTemplate` (lnxded 0x08322300) writes 50.0
# into +0x150 before any script runs (SONAR-2).
DEFAULT_DETECTION_RADIUS = 50.0


# `Game.setSonarRotationSpeed 0.025` in vanilla's `Init/Menu.con`; a mod whose
# chain never writes the word gets vanilla's.
DEFAULT_ROTATION_SPEED = 0.025
GAME_INIT = "bf1942/game/Init.con"
_RUN = re.compile(r"^\s*run\s+(\S+)", re.I)
_SPEED = re.compile(r"^\s*game\.setSonarRotationSpeed\s+(\S+)", re.I)


def rotation_speed(read) -> float:
    """The last `Game.setSonarRotationSpeed` the game's `Init.con` reaches,
    walked in the order the console runs it, `run` lines followed.

    `read(path)` answers a game-archive file's text or None, nearest mod
    first. A `run X` is `X.con` beside the file that says it.
    """
    speed = DEFAULT_ROTATION_SPEED
    seen: set[str] = set()

    def walk(path: str) -> None:
        nonlocal speed
        if path.lower() in seen:
            return
        seen.add(path.lower())
        text = read(path)
        if text is None:
            return
        folder = path.rsplit("/", 1)[0]
        for line in text.splitlines():
            if hit := _SPEED.match(line):
                try:
                    speed = float(hit.group(1))
                except ValueError:
                    pass
            elif hit := _RUN.match(line):
                target = hit.group(1).strip('"')
                if not target.lower().endswith(".con"):
                    target += ".con"
                walk(f"{folder}/{target}")

    walk(GAME_INIT)
    return speed


def sonar_entry(library: con_mod.ObjectLibrary, name: str) -> dict | None:
    """The hull's scope, or None when the game would draw none.

    `findSonarObject` (lnxded 0x08321a30) walks the hull's children depth
    first and returns the first SonarObject, so this does: a spawner's hulls
    are their own vehicles and are not walked into.
    """
    root = library.object(name)
    if root is None:
        return None
    sonar: con_mod.ObjectTemplate | None = None
    seats: dict[str, str] = {}
    visited: set[str] = set()

    def walk(template: con_mod.ObjectTemplate) -> None:
        nonlocal sonar
        if template.name.lower() in visited:
            return
        visited.add(template.name.lower())
        kind = template.kind.lower()
        if kind == "sonarobject":
            if sonar is None:
                sonar = template
            return
        if kind == "playercontrolobject" and template.sonar_pos:
            seats.setdefault(template.name.lower(), template.name)
        if template.is_spawner:
            return
        for ref in template.children:
            child = library.object(con_mod.instance_template_name(ref, library.object) or "")
            if child is not None:
                walk(child)

    walk(root)
    if sonar is None or not seats:
        return None
    return {
        "template": root.name,
        "sonar": sonar.name,
        "radius": (sonar.detection_radius if sonar.detection_radius is not None
                   else DEFAULT_DETECTION_RADIUS),
        "radarMode": bool(sonar.enable_radar_mode),
        "scanForEnemySonars": bool(sonar.scan_for_enemy_sonars),
        "seats": sorted(seats.values(), key=str.lower),
    }


def build_table(mod: str, library: con_mod.ObjectLibrary,
                templates: list[str],
                speed: float = DEFAULT_ROTATION_SPEED) -> dict:
    vehicles = [entry for name in templates
                if (entry := sonar_entry(library, name)) is not None]
    return {"mod": mod, "rotationSpeed": speed, "vehicles": vehicles}


def dump(table: dict) -> str:
    return json.dumps(table, indent=1) + "\n"


def write_table(game_dir: Path, mod: str, tree: Path, *,
                dry_run: bool = False) -> dict:
    """Build the mod's table and write `<tree>/_shared/vehicle-sonar.json`.

    Not rewritten when its text did not change, so its mtime and the
    publisher's hash record stay put.
    """
    sources = load_sources(game_dir, mod)
    templates = vehicle_templates(
        sources.objects, sources.library,
        spawned_templates(discover_levels(sources.chain)))
    _meshes, _textures, _objects, game = build_pools(sources.chain, [])

    def read(path: str) -> str | None:
        hit = game.find(path)
        return game.read(hit).decode("latin-1") if hit else None

    table = build_table(sources.mod, sources.library, templates,
                        rotation_speed(read))
    path = tree / "_shared" / TABLE_NAME
    text = dump(table)
    changed = text != (path.read_text() if path.is_file() else None)
    if changed and not dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(text)
        tmp.replace(path)
    return {"path": path, "table": table, "changed": changed,
            "written": changed and not dry_run, "asked": templates}


def summary_line(result: dict) -> str:
    vehicles = result["table"]["vehicles"]
    radar = sum(1 for v in vehicles if v["radarMode"])
    state = ("written" if result["written"]
             else "would change" if result["changed"] else "unchanged")
    return (f"{result['table']['mod']}: {len(vehicles)} of {len(result['asked'])} "
            f"templates carry a scope ({radar} in radar mode), sweep "
            f"{result['table']['rotationSpeed']:g} -> "
            f"{result['path']} ({state})")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--out", type=Path, default=MAPS,
                    help="the maps root (default viewer/maps); a mod's tree is "
                         "<out>/mods/<mod>. See --tree.")
    ap.add_argument("--tree", type=Path, default=None,
                    help="the directory holding the level folders and _shared/, "
                         "when it is not <out> (vanilla) or <out>/mods/<mod>")
    ap.add_argument("--dry-run", action="store_true",
                    help="say whether the table would change and leave it alone")
    args = ap.parse_args(argv)

    tree = args.tree or tree_for(args.out, args.mod)
    if not tree.is_dir():
        sys.exit(f"no maps tree at {tree}; pass --out or --tree")
    started = time.time()
    result = write_table(args.game_dir.expanduser(), args.mod, tree,
                         dry_run=args.dry_run)
    print(f"{summary_line(result)} in {time.time() - started:.1f} s")
    for entry in result["table"]["vehicles"]:
        print(f"  {entry['template']}: {entry['sonar']} {entry['radius']:g} m"
              f"{' radar' if entry['radarMode'] else ''}, seats {', '.join(entry['seats'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
