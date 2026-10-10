#!/usr/bin/env python3
"""Extract Battlefield 1942 vehicles and soldiers as textured glTF, straight from the .rfa archives.

    python3 extract_models.py --list
    python3 extract_models.py Sherman Stuka Elco80 BritishSoldier --out ./out

Each template comes out as a single `.glb` — the whole template tree, every sub-part
positioned the way `Objects.con` places it, materials bound through the `.rs` shaders
to the textures in `texture.rfa`. Alongside it goes a `.report.json` naming every
lookup that did not resolve, which is the only way to tell "this model has no texture"
apart from "this install has no texture archive".

Standard library plus the system liblzo2, same as the rest of the asset pipeline.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod
from bf42 import damage as damage_mod
from bf42 import level as level_mod
from bf42 import measure as measure_mod
from bf42 import roster as roster_mod
from bf42.assemble import Assembler, reaches_first_person
from bf42.rfa import (ArchivePool, find_archives_dir, find_game_dir, find_levels_dir,
                      level_texture_names, texture_name_keys)

DEFAULT_GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"

MESH_ARCHIVES = ("standardmesh", "treemesh", "animations")  # animations: GeometryTemplate.setSkin
TEXTURE_ARCHIVES = ("texture",)
OBJECT_ARCHIVES = ("objects",)
# `Game.rfa` lives under `Archives/bf1942/`, next to `levels/`, because that is the
# path prefix of its contents. The executable's archive list names it `Bf1942/game.rfa`.
GAME_ARCHIVES = ("game",)

# Where `objects.rfa` files a template tells you what the thing is.
CATEGORY_PREFIXES = {
    "objects/vehicles/land/": "land",
    "objects/vehicles/air/": "air",
    "objects/vehicles/sea/": "sea",
    "objects/soldiers/": "soldier",
    "objects/stationary_weapons/": "emplacement",
    "objects/handweapons/": "handweapon",
}

# `setVehicleCategory`, as a catalogue category. Nine `Sea` and one `Land`
# across the installed mods drop the `VC` prefix (`con.py`), so it is optional.
VEHICLE_CATEGORIES = {"land": "land", "air": "air", "sea": "sea"}

# A level archive's own tree: `bf1942/levels/<Map>/`, what a template the
# level declares for itself has in front of its `Objects/...` path.
LEVEL_SOURCE = re.compile(r"^bf1942/levels/[^/]+/", re.IGNORECASE)

# Kinds a level's ObjectSpawner may field that are not models: a spawned kit
# is a pickup, and `extract_kits.py` owns kits.
NOT_CATALOGUED_KINDS = frozenset({"kit"})

# Template kinds that are a spawnable object wherever they are declared.
#
# The folder rule below — a template named after the directory holding its
# `.con` — covers the game's usual one-folder-per-object layout, and it is the
# only rule that can separate a driveable vehicle from the twenty-odd
# `PlayerControlObject` turrets and sub-vehicles its own folder also declares.
# Hand weapons break it: `Objects/HandWeapons/K98/Objects.con` declares *two*
# `HandFireArms`, `K98` and `K98Sniper`, and `No4/Objects.con` does the same.
# The sniper is a full weapon with its own render bundle and its own scope
# mesh — and the primary weapon of all eight Scout kits, the only scoped optic
# in the game — but it is not named after any folder, so a folder-only walk
# never sees it. For these kinds the declaration is the authority: what the
# template *is* decides, not where the author happened to file it.
CATALOGUE_KINDS = {
    "handweapon": frozenset({"handfirearms"}),
    "soldier": frozenset({"bfsoldier"}),
}


def mod_chain(game_dir: Path, mod: str) -> list[Path]:
    """A mod and the mods it inherits from, nearest first.

    `init.con` declares the chain with `game.addModPath Mods/<name>/`, in priority
    order, so it is read rather than guessed.
    """
    mods_dir = game_dir / "Mods"
    by_lower = {d.name.lower(): d for d in mods_dir.iterdir() if d.is_dir()} if mods_dir.is_dir() else {}
    start = by_lower.get(mod.lower())
    if start is None:
        sys.exit(f"no such mod: {mod} (have: {', '.join(sorted(by_lower))})")

    chain: list[Path] = []
    seen: set[str] = set()

    def walk(directory: Path) -> None:
        key = directory.name.lower()
        if key in seen:
            return
        seen.add(key)
        chain.append(directory)
        init = directory / "init.con"
        if not init.is_file():
            return
        for line in init.read_text(errors="replace").splitlines():
            parts = line.strip().split()
            if len(parts) >= 2 and parts[0].lower() == "game.addmodpath":
                name = parts[1].strip("/\\").split("/")[-1].split("\\")[-1]
                nxt = by_lower.get(name.lower())
                if nxt is not None:
                    walk(nxt)

    walk(start)
    if "bf1942" not in seen and "bf1942" in by_lower:
        chain.append(by_lower["bf1942"])
    return chain


def build_pools(chain: list[Path], extra_texture_mods: list[Path],
                ) -> tuple[ArchivePool, ArchivePool, ArchivePool, ArchivePool]:
    meshes, textures, objects, game = ArchivePool(), ArchivePool(), ArchivePool(), ArchivePool()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        meshes.add_dir(archives, MESH_ARCHIVES)
        textures.add_dir(archives, TEXTURE_ARCHIVES)
        objects.add_dir(archives, OBJECT_ARCHIVES)
        game_dir = find_game_dir(archives)
        if game_dir is not None:
            game.add_dir(game_dir, GAME_ARCHIVES)
    # Appended last so they only ever fill gaps the real chain left.
    for mod_dir in extra_texture_mods:
        archives = find_archives_dir(mod_dir)
        if archives is not None:
            textures.add_dir(archives, TEXTURE_ARCHIVES)
    return meshes, textures, objects, game


def load_damage_tables(game: ArchivePool) -> damage_mod.DamageTables:
    """Replay the MaterialManager scripts the way the engine does at startup."""
    def resolve(name: str) -> bytes | None:
        return game.read(name) if name in game else None
    return damage_mod.load_tables(resolve)


def collect_weapons(objects: ArchivePool) -> list[damage_mod.Weapon]:
    scripts = {}
    for name in objects.names():
        if not name.lower().endswith(".con"):
            continue
        # try_read, not read: a damaged entry in a mod archive is one missing
        # script, not a reason to abandon the mod. See ArchivePool.try_read.
        if (blob := objects.try_read(name)) is not None:
            scripts[name] = blob.decode("latin-1")
    return damage_mod.collect_weapons(scripts)


def discover_level_textures(chain: list[Path]) -> list[tuple[str, Path]]:
    """Level archives that carry vehicle textures (AltTextures/ or Texture/).

    Returns ``(level_name, path)`` for each, sorted by name.  Only level
    archives with at least one texture entry are included.
    """
    from bf42.rfa import RfaArchive

    results: list[tuple[str, Path]] = []
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        levels_dir = find_levels_dir(archives)
        if levels_dir is None:
            continue
        for child in sorted(levels_dir.iterdir()):
            if not child.is_file() or child.suffix.lower() != ".rfa":
                continue
            # Skip patch archives (foo_001.rfa) — they overlay the base
            stem = child.stem
            if "_" in stem and stem.rsplit("_", 1)[-1].isdigit():
                continue
            try:
                rfa = RfaArchive(child)
            except Exception:
                continue
            has_tex = any(
                len(parts := e.split("/")) >= 5
                and parts[3].lower() in ("alttextures", "texture", "textures", "custom textures")
                and not any(p.lower() in ("menu", "objectlightmaps") for p in parts)
                for e in rfa.entries
            )
            if has_tex:
                results.append((stem, child))
    return results


def discover_levels(chain: list[Path]) -> list[tuple[str, Path]]:
    """Every level archive in the chain, textures or not.

    `discover_level_textures` only wants maps that can reskin a vehicle. The
    roster wants all of them, because a map with no custom textures still says
    which army spawns what.
    """
    results: list[tuple[str, Path]] = []
    seen: set[str] = set()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        levels_dir = find_levels_dir(archives)
        if levels_dir is None:
            continue
        for child in sorted(levels_dir.iterdir()):
            if not child.is_file() or child.suffix.lower() != ".rfa":
                continue
            stem = child.stem
            if "_" in stem and stem.rsplit("_", 1)[-1].isdigit():
                continue
            if stem.lower() in seen:
                continue
            seen.add(stem.lower())
            results.append((stem, child))
    return results


def add_level_objects(objects: ArchivePool, levels: list[tuple[str, Path]],
                      chain: list[Path] | None = None) -> int:
    """Every level's own `Objects/` templates, behind the chain's `Objects.rfa`.

    A level can declare templates in its own archive, and the engine resolves
    them by name like any other (`ArchivePool.add_level_objects`). A level bake
    loads its own; a kit census needs every level's, because that is where a
    quarter of the install's kits are declared -- FHSW 1,397, bf1918 116, FH
    100, DC_Final 49 -- and a level binds them by name. Each level's patches
    are added before its base, as the engine overlays them. Global templates
    keep priority, and where two levels declare one name the first level in
    `discover_levels` order wins. Returns the entries registered.

    With `chain`, each level is read through every copy of it down the chain
    (`level_underlay`): DC Final's Liberation of Caen spawns vanilla's
    `CDNRaft`, which only vanilla's copy of the level declares.
    """
    added = 0
    for name, path in levels:
        layers = (level_underlay(chain, path.stem) if chain is not None
                  else [*roster_mod.level_patches(path), path])
        for layer in layers:
            try:
                added += objects.add_level_objects(layer, label=f"{name} objects")
            except Exception as exc:
                # One unreadable archive costs its own templates, as it does
                # every other level reader here.
                print(f"  {layer.name}: objects unreadable ({exc})", file=sys.stderr)
    return added


def add_level_textures(textures: ArchivePool, levels: list[tuple[str, Path]]) -> int:
    """Every level's own textures, behind the chain's `Texture.rfa`.

    A level archive's `Texture/` and `AltTextures/` folders answer
    `texture/<name>` for anything the global archives lack
    (`ArchivePool.add_level`), and a mod can ship a kit part's or a weapon's
    only copy there: FHSW's Japanese caps and hip packs (`ryakubou`,
    `USequip_J`) are in a handful of level archives and nowhere else, so a kit
    or pose exported outside a level bake came out white. Each level's patches
    are added before its base. Global textures keep priority, and where levels
    disagree the first level in `discover_levels` order wins. Returns the
    entries registered.
    """
    added = 0
    for name, path in levels:
        for layer in [*roster_mod.level_patches(path), path]:
            try:
                added += textures.add_level(layer, label=f"{name} textures")
            except Exception as exc:
                print(f"  {layer.name}: textures unreadable ({exc})", file=sys.stderr)
    return added


def level_underlay(chain: list[Path], stem: str) -> list[Path]:
    """Every archive of one level down the mod chain, in the order it is read.

    The engine reads `bf1942/levels/<Level>/...` along `game.addModPath`,
    nearest mod first, and a mod's copy of a level may ship only part of it
    (the skill's section 3). Each copy's numbered patches come ahead of it.
    """
    out: list[Path] = []
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        levels_dir = find_levels_dir(archives) if archives is not None else None
        if levels_dir is None:
            continue
        for child in sorted(levels_dir.iterdir()):
            if (child.is_file() and child.suffix.lower() == ".rfa"
                    and child.stem.lower() == stem.lower()):
                out += [*roster_mod.level_patches(child), child]
    return out


def home_levels(chain: list[Path], library: con_mod.ObjectLibrary,
                name: str) -> list[tuple[str, Path]]:
    """The level archives a template declared inside a level is built from.

    `Ju88A` exists only in Battle of Britain's archive, and there is a copy
    of that archive in every mod down the chain: DC Final's carries the Ju88A
    scripts, vanilla's the `StandardMesh/` they name, and the engine reads the
    level through all of them nearest first (the underlay). So every archive
    of that level along the chain, each with its patches ahead of it. Empty
    for a template the global archives declare.
    """
    template = library.object(name)
    match = LEVEL_SOURCE.match(template.source) if template is not None else None
    if match is None:
        return []
    stem = match.group(0).rstrip("/").rsplit("/", 1)[-1]
    return [(layer.stem, layer) for layer in level_underlay(chain, stem)]


def with_level_archives(pool: ArchivePool,
                        archives: list[tuple[str, Path]]) -> ArchivePool:
    """`pool`, then `archives` behind it: they only ever fill its gaps.

    Registered whole, as `--level-all` registers a level (`ArchivePool.add`),
    and in a pool of its own, so the one template that needs its level's
    meshes and textures gets them and no other template in the run does.
    """
    if not archives:
        return pool
    local = ArchivePool()
    local.extend_from(pool)
    for label, path in archives:
        try:
            local.add(path, label=label)
        except Exception as exc:
            print(f"  {path.name}: level archive unreadable ({exc})", file=sys.stderr)
    return local


RE_FOLDER = re.compile(r"^\s*rem\s+folder\s*=\s*(.+)$", re.IGNORECASE)
RE_SAUCE = re.compile(r"^\s*rem\s+sauce\s*=\s*(.+)$", re.IGNORECASE)

# Refractor's `.con` grammar has exactly one directive outside the
# `Namespace.command` shape `con.py`'s `_COMMAND` parses: a bare
# `include <path>`, relative to the including file's own folder, that runs
# the target file in the same interpreter session. See `_inline_includes`.
_INCLUDE = re.compile(r"^[ \t]*include[ \t]+(.+?)[ \t]*$",
                      re.IGNORECASE | re.MULTILINE)
_MAX_INCLUDE_DEPTH = 8


def _inline_includes(objects: ArchivePool, path: str, text: str,
                     _seen: frozenset[str] = frozenset()) -> str:
    """Splice every bare `include <relpath>` directive's target in place.

    Every nation's soldier pulls its hit points and its heal/repair/sound
    constants this way (`include ../Common/CommonSoldierData.inc`,
    `include ../Common/Sounds/SoldierSound.inc`) -- 2147 uses across the 14
    installed mods' `Objects.rfa`, 2144 of them naming a `.inc`. `.inc` and
    `.tweak` files carry no `ObjectTemplate.create` of their own (confirmed:
    neither `CommonSoldierData.inc` nor `SoldierSound.inc` nests a further
    `include`), which is exactly why `build_library` below is right to skip
    them as top-level entries -- but their bare `ObjectTemplate.HitPoints 30`
    directives have to land on whichever template the includer had open, and
    without this they are never read by anything: `USSoldier.hitpoints` was
    `None` before this function existed. Comments are stripped before the
    scan (`con.strip_comments` already runs on the merged result inside
    `add_con`, so this only has to guard against a `rem`/`beginrem` line that
    happens to start with the word "include" being mistaken for a directive).

    A spliced file's `loadSoundScript` paths are relative to that file, not to
    the includer, so they are rebased on the way in (`_rebase_sound_scripts`,
    ledger CON-14).
    """
    # Cheap rejection first: the overwhelming majority of files never
    # mention "include" at all, and stripping comments is a full regex pass
    # this loop otherwise pays for every one of them a second time (`add_con`
    # already strips comments on whatever text it is finally handed).
    if "include" not in text.lower() or len(_seen) >= _MAX_INCLUDE_DEPTH:
        return text
    text = con_mod.strip_comments(text)
    if not _INCLUDE.search(text):
        return text
    folder = path.rsplit("/", 1)[0] if "/" in path else ""
    out_lines = []
    for line in text.splitlines():
        match = _INCLUDE.match(line)
        if not match:
            out_lines.append(line)
            continue
        target = match.group(1).strip().strip('"').replace("\\", "/")
        resolved = (posixpath.normpath(f"{folder}/{target}")
                    if folder else target)
        key = resolved.lower()
        if key in _seen:
            continue  # a cycle; skip rather than recurse forever
        included = objects.try_read(resolved)
        if included is None:
            continue  # unresolved include -- fails soft, same as a missing texture
        inner = included.decode("latin-1", "replace")
        inner = _inline_includes(objects, resolved, inner, _seen | {key})
        inner_folder = resolved.rsplit("/", 1)[0] if "/" in resolved else ""
        out_lines.append(_rebase_sound_scripts(inner, inner_folder, folder))
    return "\n".join(out_lines)


# `ObjectTemplate.loadSoundScript <path>`, the one directive whose argument is
# a path relative to the file the line is in (ledger CON-14). Texture and icon
# arguments (`setAmmoBar "Ingame/..."`, `createSkeleton animations/...`) are
# rooted at their archive, not at a folder, and are left alone.
_LOAD_SOUND_SCRIPT = re.compile(
    r"^([ \t]*objecttemplate\.loadsoundscript[ \t]+)(\S.*?)[ \t]*$",
    re.IGNORECASE | re.MULTILINE)


def _rebase_sound_scripts(text: str, from_folder: str, to_folder: str) -> str:
    """`text`'s `loadSoundScript` paths, moved from `from_folder` to `to_folder`.

    The engine joins that argument to the console's working path (client
    `0x0054d8c3`), and `include` sets the working path to the included file's
    own folder while its lines run (lnxded `OldConsole::include`
    `0x083ed110`, the assign at `0x083edc57`). So a line an `.inc` supplies
    names a script beside the `.inc`. Splicing loses which file a line came
    from, and `ObjectLibrary` resolves every path against the including
    file (`template.source`), so the path is rewritten here to name the same
    script from the includer's folder: FHSW's `K98.inc` says
    `Sounds/k98.ssc`, which from `Handweapons/!_PACK_COMMON/Compressed.con`
    is `../K98/Sounds/k98.ssc`. Nested includes are rebased once per level
    on the way out, innermost first.
    """
    if not text or from_folder.lower() == to_folder.lower():
        return text
    step = posixpath.relpath(from_folder or ".", to_folder or ".")

    def rebase(match: re.Match) -> str:
        path = match.group(2).strip().strip('"').replace("\\", "/")
        if not path:
            return match.group(0)
        return match.group(1) + posixpath.normpath(posixpath.join(step, path))

    return _LOAD_SOUND_SCRIPT.sub(rebase, text)


# `strcasecmp` folds A-Z only (the C locale); `str.lower` would fold more.
_ASCII_FOLD = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def load_order(names: list[str], ai_level: bool = True) -> list[str]:
    """An objects pool's script names in the order the engine runs them.

    `Game::loadAllConFiles` (lnxded 0x0805a830) lists `objects/` through the
    FileManager, keys every name holding `.con` into a `std::map` ordered by
    `NoCaseStringCompare` (`insert_unique` at 0x0805b284), and runs the map
    front to back (0x0805ab6d). One path shipped by two mods is one key,
    opened from the nearest mod (RFA-1); the order is the paths', not the
    mods'. With the first `create` of a name winning (LOAD-1), FH's
    `Items/BritKit/Medic/` declares `medic_helm_brit` before FHSW's
    `Items/BritKit/MedicNo4/` redeclares it (LOAD-5). A level's own scripts
    (`bf1942/levels/...`) are not under `objects/`; they keep the order they
    came in, after the rest.

    `/ai/` and `\\ai\\` paths are keyed only on an AI level (LOAD-8): the
    flag is `game->getIsAiLevel()` (vt+0xb0, read at 0x0805b31e) and, when it
    is set, the name skips both tests (0x0805b1b3) and sorts with the rest.
    Every weapon's `weaponTemplate` and every `coverValue` is in such a
    script. The viewer's game has bots, which is an AI level
    (`game.isAiLevel 1`, `Bf1942/Game/AIDefault.con`; parity-lab README), so
    that is the default. `ai_level=False` is a multiplayer load without bots.
    The `/ai/` scripts of vanilla, XPack1/2, DC and DC Final declare no
    ObjectTemplate or GeometryTemplate, so models read the same either way.
    """
    level = [n for n in names if n.lower().startswith("bf1942/levels/")]
    rest = [n for n in names
            if not n.lower().startswith("bf1942/levels/")
            and (ai_level or "/ai/" not in n.replace("\\", "/").lower())]
    return sorted(rest, key=lambda n: n.replace("\\", "/").translate(_ASCII_FOLD)) + level


def build_library(objects: ArchivePool) -> con_mod.ObjectLibrary:
    """Every template the pool's scripts declare, the first declaration of a
    name winning (LOAD-1), read in the engine's order (`load_order`; a
    `extract_map.LevelFirst` pool is already in it)."""
    library = con_mod.ObjectLibrary()
    names = objects.names()
    if not getattr(objects, "in_load_order", False):
        names = load_order(names)
    for name in names:
        if not name.lower().endswith(".con"):
            continue
        if (blob := objects.try_read(name)) is None:
            continue
        text = _inline_includes(objects, name, blob.decode("latin-1"))
        if "compressed.con" in name.lower() and "rem folder =" in text.lower():
            parts = name.replace("\\", "/").split("/")
            pack_idx = next((i for i, p in enumerate(parts) if p.lower().startswith("!_pack")), None)
            base_prefix = "/".join(parts[:pack_idx]) if pack_idx is not None else "/".join(parts[:-1])
            cur_folder = ""
            cur_sauce = "Objects.con"
            chunk_lines: list[str] = []
            for line in text.splitlines():
                m_f = RE_FOLDER.match(line)
                m_s = RE_SAUCE.match(line)
                if m_f:
                    if chunk_lines and cur_folder:
                        sub_source = f"{base_prefix}/{cur_folder}/{cur_sauce}"
                        library.add_con(sub_source, "\n".join(chunk_lines))
                        chunk_lines = []
                    cur_folder = m_f.group(1).strip()
                elif m_s:
                    cur_sauce = m_s.group(1).strip()
                else:
                    chunk_lines.append(line)
            if chunk_lines and cur_folder:
                sub_source = f"{base_prefix}/{cur_folder}/{cur_sauce}"
                library.add_con(sub_source, "\n".join(chunk_lines))
        else:
            library.add_con(name, text)
    return library


def own_templates(chain: list[Path], library: con_mod.ObjectLibrary) -> set[str]:
    """Template names the *first* mod in the chain declares for itself.

    A mod inherits its parents wholesale — Road to Rome's catalogue is 113
    templates, and 94 of them are vanilla's, because a Road to Rome map fields
    Shermans like any other. Extracting those again writes a second copy of
    every vanilla mesh into the mod's subtree.

    `ArchivePool.source_of` cannot tell them apart: it returns the archive's
    *filename*, and both vanilla and the expansion call theirs `Objects.rfa`.
    So ask a narrower pool instead — one built from the mod's own archives and
    nothing else. If the `.con` that declared a template is readable there, the
    mod declared it; if it is not, the template arrived by inheritance.

    An *override* counts as the mod's own, which is what you want: when DC Final
    redefines `Medic_helm_us` it ships its own `.con` at the same path, and that
    path resolves in its own pool.
    """
    own = ArchivePool()
    archives = find_archives_dir(chain[0])
    if archives is None:
        return {name.lower() for name in library.objects}
    own.add_dir(archives, OBJECT_ARCHIVES)
    # A template one of the mod's own levels declares is the mod's too.
    add_level_objects(own, discover_levels(chain[:1]))
    declared: set[str] = set()
    for template in library.objects.values():
        if own.try_read(template.source) is not None:
            declared.add(template.name.lower())
    return declared


def spawn_folder(source: str) -> str:
    """Directory that contains this `.con` — the spawnable object's name.

    Vehicles nest one level deeper than soldiers (`Vehicles/Land/Sherman` vs
    `Soldiers/BritishSoldier`), so a fixed path index picks `Objects.con` for
    the latter. The parent of the script file is the folder in both layouts.
    """
    parts = source.replace("\\", "/").rstrip("/").split("/")
    if len(parts) >= 2 and parts[-1].lower().endswith(".con"):
        return parts[-2]
    return parts[-1] if parts else ""


def folder_key(name: str) -> str:
    """A name as the folder rule compares it: case and separators dropped.

    The Axis AA gun is `flak38`, declared in `Objects/Vehicles/Land/Flak_38/`.
    An exact comparison left it out of every models tree, although ten vanilla
    levels place it on their Axis AA pads (the level bakes draw it) and the
    game hands it to the Axis on every AA spawner, so a round replay had no
    model to draw it with. Dropping the separators admits it and nothing else
    in vanilla, XPack1 or XPack2.
    """
    return re.sub(r"[^a-z0-9]", "", name.lower())


def spawner_templates(text: str) -> set[str]:
    """Every template one `ObjectSpawnTemplates.con` has an ObjectSpawner put
    in the world, for either team, lower case."""
    return {vehicle.lower()
            for spec in level_mod.parse_spawn_templates(text).values()
            for vehicle in spec.vehicles.values()}


def spawned_templates(levels: list[tuple[str, Path]],
                      chain: list[Path] | None = None) -> set[str]:
    """Every template a level's ObjectSpawners put in the world, lower case.

    Every game mode's `ObjectSpawnTemplates.con` of every level in `levels`
    (`discover_levels`), each read through its numbered patches. This is the
    game's own word that a template is a thing a round fields, wherever its
    `.con` was filed: `Sea/fletcher/Objects.con` declares `Fletcher2` beside
    `Fletcher` (Midway, Guadalcanal and the Philippines field both, Omaha
    Beach only the second), and `Sea/Hatsuzuki/` its Japanese twin
    `Hatsuzuki2`, so the folder rule in `catalogue` never listed either.
    Level-declared templates (Coral Sea's carriers) come back too; the object
    library decides whether they are extractable. One unreadable level costs
    only its own spawners.

    With `chain`, each level is read through every copy of it down the chain
    (`level_underlay`), as the engine reads it. DC Final's Battle of Britain
    ships its own `Objects/Ju88A/` but no Conquest spawners, so the vanilla
    level's are the ones its round runs, and read from the nearest copy alone
    the Ju88A was spawned by nothing.
    """
    names: set[str] = set()
    for name, path in levels:
        try:
            if chain is not None:
                pool = ArchivePool()
                for layer in level_underlay(chain, path.stem):
                    try:
                        pool.add(layer)
                    except Exception as exc:
                        print(f"  {layer.name}: unreadable ({exc})", file=sys.stderr)
            else:
                pool = roster_mod.level_pool(path)
            if pool is None:
                continue
            for entry in pool.names():
                if not entry.lower().endswith("objectspawntemplates.con"):
                    continue
                blob = pool.try_read(entry)
                if blob is not None:
                    names |= spawner_templates(blob.decode("latin-1", "replace"))
        except Exception as exc:
            print(f"  {name}: spawners unreadable ({exc})", file=sys.stderr)
    return names


def carried_templates(library: con_mod.ObjectLibrary) -> set[str]:
    """Every template an `ObjectSpawner` declared in `Objects.rfa` fields,
    lower case: what a vehicle launches from its own deck.

    A level's `ObjectSpawnTemplates.con` (`spawned_templates`) is not the
    only spawner in the game. A ship template carries `ObjectSpawner`
    children of its own (`Enterprise_corsairSpawner`, `ShokakuZeroSpawner`,
    the landing craft's), declared beside the hull in `Objects.con` with the
    same `setObjectTemplate <team> <name>` lines, and the engine spawns
    those as objects of their own (`ObjectSpawner::spawnObject` 0x083140a0).
    Desert Combat's `Nimitz_AV8Spawner` names `AV-8A`, a Harrier no level's
    spawner ever names and `Vehicles/Air/AV8/` does not name either, so no
    tree carried `AV-8A.glb`: the deck Harrier on DC Wake was baked into the
    carrier, flown with no cockpit (`AV-8A.cockpit.glb` 404) and wrecked
    with its intact mesh (2026-10-09, features/desert-combat-parity).

    Only a `PlayerControlObject` counts: a spawner also fields kits (DC's
    `US_AA`, pickups the kit pipeline owns) and a level's trigger props
    (Medina Ridge's `flagkillsimple`, a SimpleObject). Reachability is not
    checked: a spawner nobody places names a vehicle that is still a
    vehicle, and the cost is one more model in a tree.
    """
    names: set[str] = set()
    for template in library.objects.values():
        if template.kind.lower() != "objectspawner":
            continue
        for name in template.spawner_vehicles.values():
            carried = library.object(name)
            if carried is not None and carried.kind.lower() == "playercontrolobject":
                names.add(name.lower())
    return names


def catalogue(objects: ArchivePool, library: con_mod.ObjectLibrary, *,
              spawned: set[str] | frozenset[str] = frozenset(),
              own_levels: set[str] | frozenset[str] | None = None,
              ) -> list[tuple[str, str, str]]:
    """Every template a category folder declares as a spawnable object.

    Three ways in, because different things make a template the object. Most
    of the game is one folder per object, so a template named after the folder
    holding its `.con` (`folder_key`) is that folder's thing. A few are not —
    see `CATALOGUE_KINDS` — and those are admitted on their declared kind
    instead. And a template a level's ObjectSpawner names (`spawned`, from
    `spawned_templates`) is spawnable on the game's own word, whichever folder
    declares it: `Fletcher2` sits in `Sea/fletcher/` beside `Fletcher`, and
    without it a round replay had no model for Midway's second destroyer. A
    template that satisfies more than one (`K98` is a `HandFireArms` *and*
    named after `HandWeapons/K98/`) appears once: the library is keyed by name.

    "Whichever folder" includes a level's own archive and the folders that are
    not a category. A level declares templates for itself and the engine
    resolves them by name like any other (`add_level_objects`, which the
    caller runs so `library` has them): Al Nas's mobile spawn trucks
    `nx_m-923`/`nx_m-923c` and its `camel2`, Battle of Britain's `Ju88A`,
    Weapon Bunkers' `mil_wpbunker*_des`, No Fly Zone Day 2's radar domes and
    hangars. Only the category prefix was ever asked, so none had a model or
    a wreck, and a dead one kept its intact mesh. Those are categorised by
    `template_category`; a spawned kit is a pickup and stays out.

    A level template exists only while its level is loaded, and a mod's map
    tree bakes the levels the mod ships itself. `own_levels`, when given,
    is those (lower case), and a level template declared elsewhere stays
    out: Desert Combat's chain reaches vanilla's Battle of Britain, and its
    tree has no use for a Ju88A.
    """
    spawned = {name.lower() for name in spawned}
    out: list[tuple[str, str, str]] = []
    for template in library.objects.values():
        source = template.source.lower()
        category = next((v for k, v in CATEGORY_PREFIXES.items() if source.startswith(k)), None)
        kind = template.kind.lower()
        if category is None:
            level = LEVEL_SOURCE.match(source)
            if (template.name.lower() in spawned
                    and kind not in NOT_CATALOGUED_KINDS
                    and (level is None or own_levels is None
                         or level.group(0).rstrip("/").rsplit("/", 1)[-1] in own_levels)):
                out.append((template.name,
                            template_category(library, template.name),
                            template.source))
            continue
        # A soldier folder also holds his parachute and his 1P arms; only the
        # BFSoldier is a thing you can spawn.
        if category == "soldier" and kind != "bfsoldier":
            continue
        folder = spawn_folder(template.source)
        if (folder and folder_key(template.name) == folder_key(folder)) \
                or kind in CATALOGUE_KINDS.get(category, ()) \
                or template.name.lower() in spawned:
            out.append((template.name, category, template.source))
    return sorted(out, key=lambda r: (r[1], r[0].lower()))


def template_category(library: con_mod.ObjectLibrary, name: str) -> str:
    """The browse category: where the template is filed, else what it says it is.

    A level's own copy of the stock layout (`bf1942/levels/<Map>/Objects/
    Vehicles/Air/...`) files it the same way; anything else a level declares
    goes by its own `setVehicleCategory` (`Ju88A` air, Al Nas's trucks land),
    and a destructible objective with none is an `object`.
    """
    template = library.object(name)
    if template is None:
        return "object"
    source = template.source.lower()
    for candidate in (source, LEVEL_SOURCE.sub("", source)):
        category = next((v for k, v in CATEGORY_PREFIXES.items()
                         if candidate.startswith(k)), None)
        if category is not None:
            return category
    # Desert Combat files its radar domes and bunkers `VCLand` too: only a
    # thing a soldier can get into is a vehicle.
    declared = (template.vehicle_category or "").lower().removeprefix("vc")
    if declared in VEHICLE_CATEGORIES and _can_be_entered(library, name):
        return VEHICLE_CATEGORIES[declared]
    return "object"


def _can_be_entered(library: con_mod.ObjectLibrary, name: str, *,
                    depth: int = 0, seen: frozenset[str] = frozenset()) -> bool:
    """Whether an `EntryPoint` sits anywhere in this template's tree."""
    template = library.object(name)
    if template is None or depth > 24 or template.name.lower() in seen:
        return False
    if template.kind.lower() == "entrypoint":
        return True
    seen = seen | {template.name.lower()}
    return any(_can_be_entered(library, ref.template, depth=depth + 1, seen=seen)
               for ref in template.children)


def model_file_stem(name: str) -> str:
    """The file a template's model is stored under: its name with `/` spelled
    `_`. A slash is legal in a Refractor template name (FHSW's `SdKfz251/1`,
    `Flak18/36`) but would make a directory of the path; the viewer maps a
    name the same way (`viewer/model-file.js`)."""
    return name.replace("/", "_").replace("\\", "_")


def variant_suffix(configuration: str, lod: int, level_label: str | None,
                   first_person: bool = False) -> str:
    tokens: list[str] = []
    if first_person:
        tokens.append("cockpit")
    if configuration != "complex":
        tokens.append(configuration)
    if lod:
        tokens.append(f"lod{lod}")
    if level_label:
        tokens.append(level_label)
    return f".{'.'.join(tokens)}" if tokens else ""


# The mod folder this process exports from (`main`, and each worker's
# initializer). Only `bf42/cockpit_overrides.py` reads it.
INSTALL_MOD: str | None = None


def export_one(name: str, meshes: ArchivePool, textures: ArchivePool,
               objects: ArchivePool, library: con_mod.ObjectLibrary, *,
               configuration: str, lod: int, max_texture: int, out: Path,
               level_label: str | None = None,
               first_person: bool = False,
               requested: set[str] | None = None,
               require_level_texture: bool = True,
               ) -> dict | None:
    """Export a single vehicle variant, returning a manifest fragment or None.

    `requested`, when given, is filled with every texture name the export
    asked for, found or not (`texture_name_keys` form) - what
    `export_template` needs to tell which levels could reskin this model.

    `require_level_texture` is the reskin rule: a `level_label` variant is
    kept only if a texture came from that level. A level's re-declaration of
    a template (`extract_level_variants.py`) is the level's model whatever
    its textures are, so it turns the rule off.
    """
    assembler = Assembler(meshes, textures, objects, library,
                          lod=lod, max_texture=max_texture,
                          configuration=configuration,
                          first_person=first_person,
                          install_mod=INSTALL_MOD,
                          # Nothing collides with a cockpit interior: it is
                          # scenery drawn around a camera that is already
                          # inside the vehicle's own hull.
                          include_collision=not first_person)
    suffix = variant_suffix(configuration, lod, level_label, first_person)
    file_stem = f"{model_file_stem(name)}{suffix}"
    try:
        glb, report = assembler.export(name)
    except Exception as exc:
        print(f"  {name}{suffix}: {exc}", file=sys.stderr)
        return None

    if requested is not None:
        for path in report.resolved_textures:
            requested |= texture_name_keys(path)
        for path in report.missing_textures:
            # A miss that failed to decode is recorded as "<path> (<why>)".
            requested |= texture_name_keys(path.split(" (", 1)[0])

    if require_level_texture and level_label is not None and not any(
        source.split(":", 1)[0].casefold() == level_label.casefold()
        for source in report.resolved_textures.values()
    ):
        print(f"  {file_stem}: no matching vehicle textures; skipping",
              file=sys.stderr)
        return None

    target = out / f"{file_stem}.glb"
    target.write_bytes(glb)
    report_name = f"{file_stem}.report.json"
    (out / report_name).write_text(json.dumps(report.as_dict(), indent=2))

    missing = len(set(report.missing_textures))
    print(f"  {file_stem}: {report.parts} parts, {report.triangles} tris, "
          f"{len(report.resolved_textures)} textures"
          + (f", {missing} unresolved" if missing else "")
          + f"  -> {target.name} ({len(glb) // 1024} KB)", file=sys.stderr)

    return {
        "glb": target.name,
        "report": report_name,
        "level": level_label,
        "configuration": configuration,
        "lod": lod,
        "firstPerson": first_person,
        "parts": report.parts,
        "triangles": report.triangles,
        "texturesResolved": len(report.resolved_textures),
        "texturesMissing": sorted(set(report.missing_textures)),
    }


_worker_state: dict = {}

# One index read per level archive per worker process, however many models ask.
_level_name_cache: dict[Path, frozenset[str]] = {}


def _level_names(level_path: Path) -> frozenset[str]:
    names = _level_name_cache.get(level_path)
    if names is None:
        names = _level_name_cache[level_path] = level_texture_names(level_path)
    return names


def _init_export_worker(chain_paths: list[str], fallback_paths: list[str]) -> None:
    global INSTALL_MOD
    chain = [Path(p) for p in chain_paths]
    INSTALL_MOD = chain[0].name if chain else None
    fallbacks = [Path(p) for p in fallback_paths]
    meshes, base_textures, objects, _game = build_pools(chain, fallbacks)
    add_level_objects(objects, discover_levels(chain), chain)
    library = build_library(objects)
    _worker_state["chain"] = chain
    _worker_state["meshes"] = meshes
    _worker_state["base_textures"] = base_textures
    _worker_state["objects"] = objects
    _worker_state["library"] = library


def export_template(name: str, meshes: ArchivePool, base_textures: ArchivePool,
                    objects: ArchivePool, library: con_mod.ObjectLibrary, *,
                    configurations: list[str], lod: int, max_texture: int,
                    out: Path, level_sources: list[tuple[str, Path]],
                    cockpit: bool = False,
                    home: list[tuple[str, Path]] | None = None,
                    ) -> tuple[list[dict], int]:
    """Every variant of one template: configurations x theatre skins, + cockpit.

    `home` is the level a level-declared template lives in (`home_levels`):
    its meshes and textures are there and nowhere else.
    """
    variants: list[dict] = []
    failures = 0
    meshes = with_level_archives(meshes, home or [])
    base_textures = with_level_archives(base_textures, home or [])
    for configuration in configurations:
        requested: set[str] = set()
        base = export_one(
            name, meshes, base_textures, objects, library,
            configuration=configuration, lod=lod,
            max_texture=max_texture, out=out, requested=requested,
        )
        if base is None:
            failures += 1
            continue
        variants.append(base)

        for level_name, level_path in level_sources:
            # A level reskins this model only if it ships a texture the model
            # asks for, and that is answerable from the archive's index alone.
            # Exporting first and checking afterwards - which is what this did
            # - assembles the whole model, decodes every texture and builds the
            # glb, then throws it away: Eve of Destruction is 285 models x 239
            # levels, 68,115 exports to keep about 200, and hours of CPU. The
            # check below is `add_level`'s own filter, and errs toward a match;
            # `export_one` still has the last word on a level that passes it.
            try:
                if not requested & _level_names(level_path):
                    continue
            except Exception as exc:
                print(f"  {name}.{level_name}: cannot read level archive ({exc})",
                      file=sys.stderr)
                continue
            level_textures = ArchivePool()
            try:
                added = level_textures.add_level(level_path, label=level_name)
            except Exception as exc:
                print(f"  {name}.{level_name}: cannot read level archive ({exc})",
                      file=sys.stderr)
                continue
            if not added:
                continue
            level_textures.extend_from(base_textures)

            variant = export_one(
                name, meshes, level_textures, objects, library,
                configuration=configuration, lod=lod,
                max_texture=max_texture, out=out,
                level_label=level_name,
            )
            if variant:
                variants.append(variant)

    # The cockpit hangs off the default configuration only. A wreck has no
    # interior to sit in, and a theatre skin never reaches the interior
    # textures — `1P_Corsair` samples `Corsair_Interior_I`, which no level
    # archive overrides.
    if cockpit and reaches_first_person(library, name):
        interior = export_one(
            name, meshes, base_textures, objects, library,
            configuration="complex", lod=lod,
            max_texture=max_texture, out=out, first_person=True,
        )
        if interior:
            variants.append(interior)

    if not variants:
        failures += 1
    return variants, failures


def _export_template_task(task_args: tuple) -> tuple[str, list[dict], int]:
    (name, configurations, lod, max_texture, out_path_str,
     level_sources_tuples, cockpit) = task_args
    try:
        variants, failures = export_template(
            name,
            _worker_state["meshes"], _worker_state["base_textures"],
            _worker_state["objects"], _worker_state["library"],
            configurations=configurations, lod=lod, max_texture=max_texture,
            out=Path(out_path_str),
            level_sources=[(n, Path(p)) for n, p in level_sources_tuples],
            cockpit=cockpit,
            home=home_levels(_worker_state["chain"], _worker_state["library"], name),
        )
        return name, variants, failures
    except Exception as exc:
        print(f"  {name}: worker error ({exc})", file=sys.stderr)
        return name, [], 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("templates", nargs="*", help="object template names, e.g. Sherman Willy")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "out")
    ap.add_argument("-j", "--jobs", type=int, default=1,
                    help="number of parallel workers (default: 1)")
    ap.add_argument("--lod", type=int, default=0,
                    help="mesh LOD index to export (default: 0)")
    ap.add_argument("--configuration", dest="configurations", action="append",
                    choices=con_mod.MODEL_CONFIGURATIONS,
                    help="vehicle alternative to export; repeatable (default: complex)")
    ap.add_argument("--configuration-all", action="store_true",
                    help="export both Complex and Wreck alternatives when available")
    ap.add_argument("--cockpit", action="store_true",
                    help="also export `<Name>.cockpit.glb` — the first-person interior "
                         "geometry the ordinary export deliberately leaves out. It is a "
                         "graft, not a model: a viewer attaches it to the matching nodes "
                         "of the ordinary export when the camera goes inside")
    ap.add_argument("--max-texture", type=int, default=1024, help="downscale textures above this, 0 to keep")
    ap.add_argument("--texture-fallback", action="append", default=[],
                    help="mod folder to borrow textures from when the chain lacks them "
                         "(repeatable; only fills gaps)")
    ap.add_argument("--level", action="append", default=[],
                    help="level archive to use as a texture source (repeatable); "
                         "each produces a separate .glb variant with that level's theatre skins")
    ap.add_argument("--level-all", action="store_true",
                    help="auto-discover and include all level archives that carry vehicle textures")
    ap.add_argument("--list", action="store_true", help="list extractable templates and exit")
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    if not game_dir.is_dir():
        sys.exit(f"game dir not found: {game_dir}")

    chain = mod_chain(game_dir, args.mod)
    global INSTALL_MOD
    INSTALL_MOD = chain[0].name if chain else args.mod
    fallbacks = [game_dir / "Mods" / name for name in args.texture_fallback]
    meshes, base_textures, objects, game = build_pools(chain, fallbacks)

    # -- level archives ------------------------------------------------------
    # A level can define its own objects (`bf1942/Levels/<L>/Objects/<Name>/`)
    # and carry their meshes and textures, and those templates exist nowhere
    # else. Battle of Britain's Ju88A is one: the mod's object archives have no
    # such template, so without the level archive the library cannot see it,
    # `available_configurations` answers for nothing, and no model of it — live
    # or wreck — can be exported. Added after the mod chain and the fallbacks,
    # so a level only fills gaps they left.
    if args.level_all:
        level_sources = discover_level_textures(chain)
    else:
        levels_dir = None
        for mod_dir in chain:
            archives = find_archives_dir(mod_dir)
            if archives and (found := find_levels_dir(archives)) is not None:
                levels_dir = found
                break
        level_sources = []
        if levels_dir:
            for name in args.level:
                path = levels_dir / f"{name}.rfa"
                if path.is_file():
                    level_sources.append((name, path))
                else:
                    print(f"WARNING: level archive not found: {path}", file=sys.stderr)

    for name, path in level_sources:
        objects.add(path, label=name)
        meshes.add(path, label=name)
        base_textures.add(path, label=name)

    # Every level's own templates, behind the global ones, whether or not the
    # level reskins anything: Al Nas's trucks are declared nowhere else.
    levels = discover_levels(chain)
    add_level_objects(objects, levels, chain)
    library = build_library(objects)
    damage_tables = load_damage_tables(game)
    weapons = collect_weapons(objects)

    print(f"mod chain:  {' -> '.join(d.name for d in chain)}", file=sys.stderr)
    print(f"archives:   {len(meshes.names())} mesh, {len(base_textures.names())} texture, "
          f"{len(objects.names())} object entries", file=sys.stderr)
    print(f"templates:  {len(library.objects)} objects, {len(library.geometries)} geometries",
          file=sys.stderr)
    if damage_tables.scripts:
        print(f"damage:     {len(damage_tables.materials)} materials, "
              f"{len(damage_tables.modifiers)} att/def modifiers from "
              f"{len(damage_tables.scripts)} scripts, {len(weapons)} weapons"
              + (f", {len(damage_tables.missing_scripts)} run targets absent"
                 if damage_tables.missing_scripts else ""),
              file=sys.stderr)
    else:
        print("WARNING: no Game.rfa in the mod chain — armour damage will not be calculable.",
              file=sys.stderr)
    if level_sources:
        print(f"levels:     {', '.join(n for n, _ in level_sources)}", file=sys.stderr)

    # Browse facets: who fielded the thing, and on which maps.
    roster, kit_count, level_count = roster_mod.build(library, levels)
    print(f"roster:     {kit_count} kits, {level_count} levels -> "
          f"{len(roster.factions)} templates with a faction", file=sys.stderr)
    if not base_textures.names() and not level_sources:
        print("WARNING: no texture source — models will export untextured.",
              file=sys.stderr)

    if args.list:
        own_levels = {stem.lower() for stem, _ in discover_levels(chain[:1])}
        for name, category, source in catalogue(objects, library,
                                                spawned=(spawned_templates(levels, chain)
                                                         | carried_templates(library)),
                                                own_levels=own_levels):
            print(f"{category:12s} {name:28s} {source}")
        return 0

    if not args.templates:
        ap.error("give at least one template name, or --list")

    if args.lod < 0:
        ap.error("--lod must be zero or greater")

    args.out.mkdir(parents=True, exist_ok=True)
    tasks = []
    for name in args.templates:
        available_configurations = library.available_configurations(name)
        requested_configurations = (
            available_configurations
            if args.configuration_all
            else list(dict.fromkeys(args.configurations or ["complex"]))
        )
        configurations = [
            configuration for configuration in requested_configurations
            if configuration in available_configurations
        ]
        unavailable = [
            configuration for configuration in requested_configurations
            if configuration not in available_configurations
        ]
        for configuration in unavailable:
            print(f"  {name}: no {configuration} configuration; skipping",
                  file=sys.stderr)
        if configurations:
            tasks.append((name, configurations, args.lod, args.max_texture, str(args.out),
                          [(n, str(p)) for n, p in level_sources], args.cockpit))

    # Two templates spelled into one file would overwrite each other silently.
    stems: dict[str, str] = {}
    for name, *_ in tasks:
        other = stems.setdefault(model_file_stem(name), name)
        if other != name:
            raise SystemExit(f"{other!r} and {name!r} would both be written as "
                             f"{model_file_stem(name)}.glb")

    template_variants: dict[str, list[dict]] = {}
    failures = 0
    if args.jobs > 1 and len(tasks) > 1:
        chain_strs = [str(p) for p in chain]
        fallback_strs = [str(p) for p in fallbacks]
        with ProcessPoolExecutor(
            max_workers=min(args.jobs, len(tasks)),
            initializer=_init_export_worker,
            initargs=(chain_strs, fallback_strs),
        ) as executor:
            for name, variants, f_count in executor.map(_export_template_task, tasks):
                template_variants[name] = variants
                failures += f_count
    else:
        for name, configurations, lod, max_texture, _out, _levels, want_cockpit in tasks:
            variants, f_count = export_template(
                name, meshes, base_textures, objects, library,
                configurations=configurations, lod=lod, max_texture=max_texture,
                out=args.out, level_sources=level_sources, cockpit=want_cockpit,
                home=home_levels(chain, library, name),
            )
            template_variants[name] = variants
            failures += f_count

    manifest: list[dict] = []
    for name in args.templates:
        variants = template_variants.get(name, [])
        if not variants:
            continue

        # A cockpit is never a candidate for the browse model: it shares the
        # `complex` configuration with the real thing but is a bare interior
        # tub, so letting it into this pick would turn a fighter's thumbnail
        # into a dashboard. It rides alongside under its own key instead.
        showable = [v for v in variants if not v.get("firstPerson")] or variants
        default_variants = [
            variant for variant in showable
            if variant["configuration"] == "complex"
        ] or showable
        best = min(default_variants, key=lambda v: len(v["texturesMissing"]))
        cockpit = next((v["glb"] for v in variants if v.get("firstPerson")), None)
        report = json.loads((args.out / best["report"]).read_text())
        manifest.append({
            "name": name,
            "mod": args.mod,
            "category": template_category(library, name),
            "glb": best["glb"],
            "report": best["report"],
            "cockpit": cockpit,
            "configuration": best["configuration"],
            "lod": best["lod"],
            "level": best["level"],
            "parts": best["parts"],
            "triangles": best["triangles"],
            "texturesResolved": best["texturesResolved"],
            "texturesMissing": best["texturesMissing"],
            "textureFallbacks": args.texture_fallback,
            "weapons": sorted(own_weapons(library, name, weapons)),
            # Facets and lineup metrics the browse view sorts on before it has
            # loaded a single byte of geometry.
            **roster.entry(name),
            "dimensions": measure_mod.bounds(args.out / best["glb"]),
            "hitpoints": (report.get("armor") or {}).get("hitpoints"),
            "rigged": len(report.get("riggedParts") or []),
            "animatedParts": len(report.get("animatedParts") or []),
            "cameras": len(report.get("cameras") or []),
            "variants": variants,
        })

    # The viewer reads this to populate its model list.
    (args.out / "models.json").write_text(json.dumps(manifest, indent=2))
    # ...and this to turn a clicked collision face into hit points.
    (args.out / "damage.json").write_text(json.dumps({
        "mod": args.mod,
        **damage_tables.as_dict(),
        "weapons": [weapon.as_dict() for weapon in weapons],
    }, indent=2))
    return 1 if failures else 0


def own_weapons(library: con_mod.ObjectLibrary, root: str,
                weapons: list[damage_mod.Weapon]) -> set[str]:
    """Launcher templates that sit somewhere in this object's template tree."""
    by_name = {weapon.name.lower() for weapon in weapons}
    found: set[str] = set()
    visited: set[str] = set()

    def visit(name: str, depth: int = 0) -> None:
        key = name.lower()
        if key in visited or depth > 24:
            return
        visited.add(key)
        if key in by_name:
            found.add(next(w.name for w in weapons if w.name.lower() == key))
        template = library.object(name)
        if template is None:
            return
        for child in template.children:
            visit(child.template, depth + 1)

    visit(root)
    return found


if __name__ == "__main__":
    # Every glb this wrote moves its textures into the shared store
    # (optimise_mesh.py, features/mesh-asset-size); `--no-optimise` opts out.
    from optimise_mesh import run_then_optimise
    raise SystemExit(run_then_optimise(main, Path(__file__).resolve().parent / "out"))
