#!/usr/bin/env python3
"""Every seat in a mod that can look through a scout's marker, as one shared table.

    python3 extract_vehicle_spotting.py --mod bf1942     # viewer/maps/_shared/vehicle-spotting.json
    python3 extract_vehicle_spotting.py --mod DC_Final   # viewer/maps/mods/dc_final/_shared/...

Artillery spotting (SPOT-1..SPOT-13, `features/artillery-spotting`): a weapon
with `magType 2` places a marker, and a gunner whose PlayerControlObject
writes `artPos 1` can look through a teammate's. `magType` rides the glbs
already (the FireArms extras). `artPos` and the words beside it do not, and
this table carries them.

`<tree>/_shared/vehicle-spotting.json`:

    {"mod": "bf1942", "cameraBlink": [0.75, 1.5],
     "strings": {"SCOUT": "Scout", ...},
     "sprites": {"icon_scout_1": "spotting/icon_scout_1.png", ...},
     "markerWeapons": [{"template": "Binoculars", "input": "c_PIFire",
                        "projectile": "BinocularsProjectile", "timeToLive": 120.0}],
     "seats": [
      {"seat": "Priest_Gunner_PCO1", "externTrace": true,
       "weaponInputs": ["c_PIFire"],
       "dirBar": {"xScale": 25.0, "yScaleMin": -90.0, ...}}]}

`seats` is every PlayerControlObject template with `artPos 1`, by its declared
name; the viewer matches the seat it sits in case-insensitively. `externTrace`
says a Camera below the seat (and not below a seat of its own) writes
`CVMExternTrace 1`: without one the game shows the scout line and refuses the
view (SPOT-7). `weaponInputs` are the inputs the seat's own FireArms fire on,
recorded so a seat whose weapon also listens on `c_PIAltFire`, the view's
toggle (SPOT-8), can be told apart. `dirBar` is the seat's `DirBar*` words
(SPOT-13).

`markerWeapons` lists every FireArms with `magType 2` for the survey; the
viewer reads the word off the weapon's own glb node.

`cameraBlink` is the mod's `Game.setCameraBlink` (the blink of the minimap
wedge being looked through), `strings` the three lexicon lines the mechanic
prints, and `sprites` the four pictures the gunner's HUD draws, written beside the
table under `spotting/` (the HUD pack carries one of them, and only in some
mods).

A table and not a glb field, the way `vehicle-sonar.json` is: these are con
words no mesh depends on, a level's `scene.glb` holds a baked copy of every
hull it places, and one small JSON per tree reaches every level without a
re-bake.
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
from bf42.modmenu import MenuSources  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, build_pools, mod_chain  # noqa: E402
from extract_spawn_layout import load_chain_lexicon  # noqa: E402
from extract_vehicle_sounds import load_sources  # noqa: E402
from scene_layers import tree_for  # noqa: E402

MAPS = HERE / "viewer" / "maps"
TABLE_NAME = "vehicle-spotting.json"
SPRITE_DIR = "spotting"

# `Game.setCameraBlink 0.75 1.5` in vanilla's `Init/Menu.con`.
DEFAULT_CAMERA_BLINK = (0.75, 1.5)
GAME_INIT = "bf1942/game/Init.con"
_RUN = re.compile(r"^\s*run\s+(\S+)", re.I)
_BLINK = re.compile(r"^\s*game\.setCameraBlink\s+(\S+)\s+(\S+)", re.I)

# The lexicon lines the mechanic prints (SPOT-5, SPOT-9).
STRING_KEYS = ("PLAYER_CALLED_FOR_ARTILLERY", "CALLED_FOR_ARTILLERY", "SCOUT")

# The gunner's pictures (SPOT-13), by the name the viewer asks for and the
# path under `menu/texture/`.
SPRITES = {
    "icon_scout_1": "icon_scout_1",
    "icon_scout_2": "icon_scout_2",
    "camview": "minimap/artillery_minimap_camview_128x128",
    # In vanilla's HUD pack too, as a hand weapon's scope; a mod whose
    # Binoculars name another picture (Desert Combat) packs none.
    "binocular": "binocular",
}

# `DirBarXScale` -> `xScale`, and so on: the word with its prefix dropped.
_DIR_BAR_KEYS = {
    "dirbarxscale": "xScale",
    "dirbaryscalemin": "yScaleMin",
    "dirbaryscalemax": "yScaleMax",
    "dirbaryscalebelow": "yScaleBelow",
    "dirbaryscaleabove": "yScaleAbove",
    "dirbarrotate": "rotate",
}


def camera_blink(read) -> tuple[float, float]:
    """The last `Game.setCameraBlink` the game's `Init.con` reaches, walked in
    the order the console runs it (`extract_vehicle_sonar.rotation_speed`)."""
    blink = DEFAULT_CAMERA_BLINK
    seen: set[str] = set()

    def walk(path: str) -> None:
        nonlocal blink
        if path.lower() in seen:
            return
        seen.add(path.lower())
        text = read(path)
        if text is None:
            return
        folder = path.rsplit("/", 1)[0]
        for line in text.splitlines():
            if hit := _BLINK.match(line):
                try:
                    blink = (float(hit.group(1)), float(hit.group(2)))
                except ValueError:
                    pass
            elif hit := _RUN.match(line):
                target = hit.group(1).strip('"')
                if not target.lower().endswith(".con"):
                    target += ".con"
                walk(f"{folder}/{target}")

    walk(GAME_INIT)
    return blink


def seat_entry(library: con_mod.ObjectLibrary,
               seat: con_mod.ObjectTemplate) -> dict:
    """One `artPos` seat: its ExternTrace camera, its weapons' inputs and its
    `DirBar*` words. The walk stops at a seat below this one (its cameras and
    weapons are its own) and at a spawner."""
    extern = False
    inputs: dict[str, None] = {}
    visited: set[str] = set()

    def walk(template: con_mod.ObjectTemplate, top: bool) -> None:
        nonlocal extern
        if template.name.lower() in visited:
            return
        visited.add(template.name.lower())
        kind = template.kind.lower()
        if not top and kind == "playercontrolobject":
            return
        if kind == "camera" and (template.camera_view_modes or {}).get("CVMEXTERNTRACE"):
            extern = True
        if kind == "firearms":
            inputs.setdefault(template.input_fire or "c_PIFire")
        if template.is_spawner:
            return
        for ref in template.children:
            child = library.object(con_mod.instance_template_name(ref, library.object) or "")
            if child is not None:
                walk(child, False)

    walk(seat, True)
    entry: dict = {"seat": seat.name, "externTrace": extern,
                   "weaponInputs": list(inputs)}
    bars = {_DIR_BAR_KEYS.get(word, word): value
            for word, value in (seat.dir_bar or {}).items()}
    if bars:
        entry["dirBar"] = bars
    return entry


def marker_weapons(library: con_mod.ObjectLibrary) -> list[dict]:
    """Every FireArms the mod declares with `magType 2` (SPOT-1)."""
    out = []
    for template in library.objects.values():
        if template.mag_type != 2:
            continue
        projectile = library.object(template.projectile_template or "")
        out.append({
            "template": template.name,
            "input": template.input_fire or "c_PIFire",
            "projectile": template.projectile_template,
            "timeToLive": projectile.time_to_live if projectile else None,
        })
    return sorted(out, key=lambda e: e["template"].lower())


def build_table(mod: str, library: con_mod.ObjectLibrary, *,
                blink: tuple[float, float] = DEFAULT_CAMERA_BLINK,
                strings: dict[str, str] | None = None,
                sprites: dict[str, str] | None = None) -> dict:
    seats = [seat_entry(library, template)
             for template in library.objects.values()
             if template.kind.lower() == "playercontrolobject" and template.art_pos]
    seats.sort(key=lambda e: e["seat"].lower())
    return {
        "mod": mod,
        "cameraBlink": list(blink),
        "strings": strings or {},
        "sprites": sprites or {},
        "markerWeapons": marker_weapons(library),
        "seats": seats,
    }


def dump(table: dict) -> str:
    return json.dumps(table, indent=1) + "\n"


def write_sprites(menu, out_dir: Path, *, dry_run: bool = False) -> dict[str, str]:
    """The HUD pictures as PNG under `<_shared>/spotting/`, read along
    the mod's menu chain. A picture the chain does not hold is left out."""
    # The texture decoders are the HUD pack's, which finds them outside this
    # folder; asked for here so the table's rules import without them.
    from extract_hud_pack import decode_dds, decode_tga, encode_png

    index = {entry.lower(): entry for entry in menu.entries}
    written: dict[str, str] = {}
    for name, stem in SPRITES.items():
        entry = next((index[key] for key in (f"menu/texture/{stem}.dds",
                                             f"menu/texture/{stem}.tga")
                      if key in index), None)
        if entry is None:
            continue
        data = menu.read(entry)
        try:
            width, height, rgba = (decode_tga(data) if entry.lower().endswith(".tga")
                                   else decode_dds(data))
        except Exception as exc:  # noqa: BLE001 - one bad picture is not the table's
            print(f"{entry}: not decoded ({exc})", file=sys.stderr)
            continue
        png = encode_png(width, height, rgba, drop_alpha=False)
        dest = out_dir / f"{name}.png"
        if not dry_run and (not dest.is_file() or dest.read_bytes() != png):
            out_dir.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(png)
        written[name] = f"{SPRITE_DIR}/{name}.png"
    return written


def write_table(game_dir: Path, mod: str, tree: Path, *,
                dry_run: bool = False) -> dict:
    """Build the mod's table and write `<tree>/_shared/vehicle-spotting.json`
    with its pictures. The table is not rewritten when its text did not
    change, so its mtime and the publisher's hash record stay put."""
    sources = load_sources(game_dir, mod)
    _meshes, _textures, _objects, game = build_pools(sources.chain, [])

    def read(path: str) -> str | None:
        hit = game.find(path)
        return game.read(hit).decode("latin-1") if hit else None

    menu_sources = MenuSources(mod_chain(game_dir, mod))
    lexicon = load_chain_lexicon(menu_sources.lexicon_paths)
    shared = tree / "_shared"
    with menu_sources.open_menu() as menu:
        sprites = write_sprites(menu, shared / SPRITE_DIR, dry_run=dry_run)
    table = build_table(
        sources.mod, sources.library, blink=camera_blink(read),
        strings={key: lexicon[key] for key in STRING_KEYS if key in lexicon},
        sprites=sprites)
    path = shared / TABLE_NAME
    text = dump(table)
    changed = text != (path.read_text() if path.is_file() else None)
    if changed and not dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(text)
        tmp.replace(path)
    return {"path": path, "table": table, "changed": changed,
            "written": changed and not dry_run}


def summary_line(result: dict) -> str:
    table = result["table"]
    blind = sum(1 for seat in table["seats"] if not seat["externTrace"])
    state = ("written" if result["written"]
             else "would change" if result["changed"] else "unchanged")
    return (f"{table['mod']}: {len(table['seats'])} artPos seats "
            f"({blind} with no ExternTrace camera), "
            f"{len(table['markerWeapons'])} marker weapons -> "
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
    ap.add_argument("--list", action="store_true", help="print every seat and weapon")
    args = ap.parse_args(argv)

    tree = args.tree or tree_for(args.out, args.mod)
    if not tree.is_dir():
        sys.exit(f"no maps tree at {tree}; pass --out or --tree")
    started = time.time()
    result = write_table(args.game_dir.expanduser(), args.mod, tree,
                         dry_run=args.dry_run)
    print(f"{summary_line(result)} in {time.time() - started:.1f} s")
    if args.list:
        for weapon in result["table"]["markerWeapons"]:
            print(f"  weapon {weapon['template']}: {weapon['input']}, "
                  f"{weapon['projectile']} {weapon['timeToLive']} s")
        for seat in result["table"]["seats"]:
            print(f"  seat {seat['seat']}: externTrace {seat['externTrace']}, "
                  f"weapons on {', '.join(seat['weaponInputs']) or '-'}"
                  f"{', dirBar ' + json.dumps(seat['dirBar']) if 'dirBar' in seat else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
