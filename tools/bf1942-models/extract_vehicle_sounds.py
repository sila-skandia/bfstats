#!/usr/bin/env python3
"""Every vehicle's engine and gun sound in a mod, as one shared table.

    python3 extract_vehicle_sounds.py --mod bf1942   # viewer/maps/_shared/vehicle-sounds.json
    python3 extract_vehicle_sounds.py --mod XPack1   # viewer/maps/mods/xpack1/_shared/...
    python3 extract_vehicle_sounds.py --mod XPack2 --out /path/to/viewer/maps

A level's `scene.json` carries `sounds.vehicles`: one entry per template the
level's own spawners place (`extract_map.spawned_vehicle_templates`). A round
replay shows whatever the server spawned, which is not that list. The
MoonGamers Midway recording adds PT boats and their rafts, Kubelwagens,
stationary MG42s and a B17, all with models in `viewer/models`, none with a
sound entry in `maps/midway/scene.json`, so every one of them was silent.

`<tree>/_shared/vehicle-sounds.json` answers for the whole mod:

    {"mod": "bf1942", "vehicles": [<entry>, ...]}

Each entry is exactly a `scene.json` `sounds.vehicles` entry, because it is
made by the same `extract_map.extract_vehicle_sounds`: the engine patch from
the Engine's `.ssc`, the guns from each FireArms' (or its projectile's), the
samples written into the tree's `_shared/sounds` by the same `sample_writer`,
and every `file` relative to a LEVEL directory (`../_shared/sounds/x.mp3`), so
the page fetches it with the `getBuffer(levelDir, relPath)` it already uses.
`template` is the name the game declares (`Sherman`, where a spawner may write
`sherman`); the viewer matches case-insensitively.

Which templates: the model catalogue's vehicle categories
(`extract_models.catalogue`, the list `extract_all.py` exports: land, air,
sea and the stationary weapons), every template any level's ObjectSpawner
names (the game's own word that a round fields it, wherever it is filed), and
the hulls those carry on spawners of their own (a destroyer's landing craft).
The whole chain, not only the mod's own templates: a Road to Rome replay fields
Shermans. A template with neither an Engine script nor a gun script is silent
in the game too and gets no entry.

Two things a level's entry can have that this one cannot. A level's own object
(a template it declares in its own archive: Battle of Britain's Ju88A, Coral
Sea's carriers, vanilla Liberation of Caen's Pak40) exists only while that
level is loaded, and that level's `scene.json` already answers for it, so the
table leaves level objects out: loading every level's would let one level's
copy of a name stand in for another's. And a sample only a level archive ships
(`resolve_sound` looks there first) is out of reach without the level. No
global template of the three vanilla packs needs one: on 2026-09-27 every
level entry of a global hull (358 vanilla, 462 XPack1, 486 XPack2) equalled
this table's, and `tests/test_extract_vehicle_sounds.py` holds Midway's to it.
The only level entries with no counterpart are level objects and XPack2's
pickup kits (`NOT_HULLS`).

`extract_maps_all.py` writes this table after its levels, and
`patch_scene.py --layer sounds` refreshes a tree's copy once per run, so a
change to the vehicle sound extraction reaches it the way it reaches the
levels.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import extract_map as em  # noqa: E402
from bf42 import con as con_mod  # noqa: E402
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, build_library, build_pools, catalogue, discover_levels,
    mod_chain, spawned_templates,
)
from scene_layers import tree_for  # noqa: E402

MAPS = HERE / "viewer" / "maps"
TABLE_NAME = "vehicle-sounds.json"

# The catalogue categories a round can field as a vehicle or a mounted gun.
# Soldiers and hand weapons have their own sound paths (`extract_soldier_sounds`,
# `extract_weapon_sounds`), and a HandFireArms is not a FireArms to
# `find_weapon_scripts` anyway.
VEHICLE_CATEGORIES = frozenset({"land", "air", "sea", "emplacement"})

# Kinds that are never a hull, whatever puts them in the world. An
# ObjectSpawner can lay a pickup kit on the ground (XPack2's
# `GermanElite_JetPack` and `GermanElite_Scout`, whose knife is a FireArms
# with a script); what a kit, a soldier or a hand weapon sounds like is the
# soldier's and his weapons' business, not a vehicle's.
NOT_HULLS = frozenset({"kit", "bfsoldier", "handfirearms"})

# Every level of a tree sits one directory below it, so a sample path measured
# from any one of them holds for all: `../_shared/sounds/x.mp3`. `relpath`
# never touches the filesystem, so the stand-in does not need to exist.
LEVEL_STAND_IN = "level"


@dataclass
class ModSources:
    """What the table is read from: the chain's object and sound archives."""

    mod: str
    chain: list[Path]
    objects: ArchivePool
    sounds: ArchivePool
    library: con_mod.ObjectLibrary


def load_sources(game_dir: Path, mod: str) -> ModSources:
    """The mod chain's archives as a level bake reads them, minus the level.

    `objects` is `build_pools`' and `sounds` is the chain's `Sound*.rfa`,
    exactly as `scene_layers.LevelContext` / `layer_sounds` assemble them.
    """
    chain = mod_chain(game_dir, mod)
    _meshes, _textures, objects, _game = build_pools(chain, [])
    sounds = ArchivePool()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is not None:
            sounds.add_dir(archives, em.SOUND_ARCHIVES)
    return ModSources(mod=mod, chain=chain, objects=objects, sounds=sounds,
                      library=build_library(objects))


def vehicle_templates(objects: ArchivePool, library: con_mod.ObjectLibrary,
                      spawned: set[str]) -> list[str]:
    """Every template of the mod a round can field, by its declared name.

    Three ways in, deduplicated case-insensitively and sorted:

    1. the model catalogue's vehicle categories (`VEHICLE_CATEGORIES`): a
       template named after its folder, the way `extract_all.py` picks what to
       export, so every hull with a model in `viewer/models` is asked;
    2. every template a level's ObjectSpawner names (`spawned`, from
       `extract_models.spawned_templates`) that the library holds, whatever
       folder declares it;
    3. the hulls those carry on ObjectSpawner children of their own (Wake's
       Hatsuzuki holds its Daihatsus), walked the way
       `extract_map.spawned_vehicle_templates` walks a level's.

    A name the library does not hold is a level's own object (see the module
    docstring) and is skipped, and so is a kit, a soldier or a hand weapon
    (`NOT_HULLS`).
    """
    names: dict[str, str] = {}

    def add(name: str | None) -> None:
        template = library.object(name) if name else None
        if template is not None and template.kind.lower() not in NOT_HULLS:
            names.setdefault(template.name.lower(), template.name)

    for name, category, _source in catalogue(objects, library, spawned=spawned):
        if category in VEHICLE_CATEGORIES:
            add(name)
    for name in sorted(spawned):
        add(name)

    visited: set[str] = set()

    def walk(name: str | None) -> None:
        if not name or name.lower() in visited:
            return
        visited.add(name.lower())
        template = library.object(name)
        if template is None:
            return
        if template.is_spawner:
            for held in template.spawner_vehicles.values():
                add(held)
                walk(held)
            return
        for ref in template.children:
            walk(con_mod.instance_template_name(ref, library.object))

    for name in list(names.values()):
        walk(name)
    return sorted(names.values(), key=str.lower)


def build_table(sources: ModSources, write,
                templates: list[str] | None = None) -> tuple[dict, list[str]]:
    """`({"mod", "vehicles"}, the templates asked)`, samples through `write`.

    `write` is a `sample_writer` (or anything with its signature: `(basename,
    bytes) -> path relative to a level directory`). No level archive is
    passed: see the module docstring.
    """
    if templates is None:
        templates = vehicle_templates(
            sources.objects, sources.library,
            spawned_templates(discover_levels(sources.chain)))
    vehicles = em.extract_vehicle_sounds(
        sources.library, sources.objects, sources.sounds, templates, write)
    return {"mod": sources.mod, "vehicles": vehicles}, templates


def level_relative_writer(tree: Path, shared_sounds: Path | None = None,
                          audio_format: str = "mp3",
                          sounds: ArchivePool | None = None):
    """`extract_map.sample_writer` into the tree's shared samples, with paths
    measured from a level directory of that tree. `sounds` is the chain's
    sound pool, which names two different wavs of one name apart
    (`extract_map.SampleNames`) exactly as a level bake does."""
    return em.sample_writer(shared_sounds or (tree / "_shared" / "sounds"),
                            tree / LEVEL_STAND_IN, audio_format, sounds)


# The soldier's own resupply sound. `BFSoldier::triggerRefillAmmoSound` (lnxded
# 0x0827ebc0) plays it when a depot hands him ammunition, and `page-audio.js`
# `playRefillSound` plays it at a replayed soldier from the tree's shared
# samples, `_shared/sounds/Ammorefill.mp3`. Vanilla's and Road to Rome's trees
# have it only because their depots' give sound is the same wav; Desert Combat
# places no depot that loads it, so the file was never written there and every
# replayed refill asked for a 404.
REFILL_SCRIPT = "Objects/Soldiers/Common/Sounds/SoldierRefillAmmo.ssc"


def write_refill_sample(sources: ModSources, write) -> list[str]:
    """The HIGH patch of `SoldierRefillAmmo.ssc`, written through `write`."""
    def read_script(path: str) -> str | None:
        hit = sources.objects.find(path)
        return sources.objects.read(hit).decode("latin-1") if hit else None

    text = read_script(REFILL_SCRIPT)
    if text is None:
        return []
    patches = em.parse_ssc(text, level=em.VEHICLE_SOUND_LEVEL,
                           include=read_script, source=REFILL_SCRIPT)
    written = []
    for sample in em._non_silence(patches[0].samples if patches else []):
        resolved = em.resolve_sound(sample.file, None, sources.sounds,
                                    em.VEHICLE_RATES)
        if resolved is not None:
            written.append(write(resolved))
    return written


def dump(table: dict) -> str:
    return json.dumps(table, indent=1) + "\n"


def write_table(game_dir: Path, mod: str, tree: Path, *,
                shared_sounds: Path | None = None, audio_format: str = "mp3",
                dry_run: bool = False) -> dict:
    """Build the mod's table and write it to `<tree>/_shared/vehicle-sounds.json`.

    The samples are written either way (they are the table's side files, as
    they are the `sounds` layer's); the JSON is left alone on a dry run, and
    is not rewritten when its text did not change, so its mtime and the
    publisher's hash record stay put.
    """
    shared_sounds = shared_sounds or (tree / "_shared" / "sounds")
    before = {p.name for p in shared_sounds.iterdir()} if shared_sounds.is_dir() else set()
    sources = load_sources(game_dir, mod)
    write = level_relative_writer(tree, shared_sounds, audio_format, sources.sounds)
    table, asked = build_table(sources, write)
    write_refill_sample(sources, write)
    path = tree / "_shared" / TABLE_NAME
    text = dump(table)
    changed = text != (path.read_text() if path.is_file() else None)
    if changed and not dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(text)
        tmp.replace(path)
    heard = {v["template"].lower() for v in table["vehicles"]}
    added = sorted(p for p in shared_sounds.iterdir() if p.name not in before) \
        if shared_sounds.is_dir() else []
    return {
        "path": path,
        "table": table,
        "changed": changed,
        "written": changed and not dry_run,
        "asked": asked,
        "silent": [name for name in asked if name.lower() not in heard],
        "new_samples": added,
    }


def summary_line(result: dict) -> str:
    vehicles = result["table"]["vehicles"]
    engines = sum(1 for v in vehicles if v.get("engine"))
    guns = sum(len(v.get("weapons") or []) for v in vehicles)
    parts = sum(len(v.get("parts") or []) for v in vehicles)
    files = {layer["file"] for v in vehicles
             for layer in [*v["layers"], *(l for w in v.get("weapons") or []
                                           for l in w["layers"]),
                           *(l for p in v.get("parts") or []
                             for patch in p["patches"] for l in patch)]}
    state = ("written" if result["written"]
             else "would change" if result["changed"] else "unchanged")
    added = result["new_samples"]
    return (f"{result['table']['mod']}: {len(vehicles)} of {len(result['asked'])} "
            f"templates sound ({engines} engines, {guns} guns, {parts} parts, {len(files)} samples, "
            f"{len(added)} new / {sum(p.stat().st_size for p in added)} B) -> "
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
    ap.add_argument("--shared-sounds", type=Path, default=None,
                    help="where the samples land (default <tree>/_shared/sounds, "
                         "the directory the level bakes fill)")
    ap.add_argument("--audio-format", choices=("mp3", "wav"), default="mp3")
    ap.add_argument("--dry-run", action="store_true",
                    help="say whether the table would change and leave it alone "
                         "(new samples are still written)")
    args = ap.parse_args(argv)

    game_dir = args.game_dir.expanduser()
    tree = args.tree or tree_for(args.out, args.mod)
    if not tree.is_dir():
        # A fresh worktree has no maps tree (`link_viewer_assets.sh` links the
        # shared one); writing here would start a stray one.
        sys.exit(f"no maps tree at {tree}; pass --out or --tree")
    if args.audio_format == "mp3" and not em.ffmpeg_available():
        sys.exit("ffmpeg is not on PATH, so samples cannot be transcoded")
    started = time.time()
    result = write_table(game_dir, args.mod, tree, shared_sounds=args.shared_sounds,
                         audio_format=args.audio_format, dry_run=args.dry_run)
    print(f"{summary_line(result)} in {time.time() - started:.1f} s")
    if result["silent"]:
        print(f"  no engine or gun script: {', '.join(result['silent'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
