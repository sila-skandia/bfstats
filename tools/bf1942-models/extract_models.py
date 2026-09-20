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
        out_lines.append(_inline_includes(objects, resolved, inner, _seen | {key}))
    return "\n".join(out_lines)


def build_library(objects: ArchivePool) -> con_mod.ObjectLibrary:
    library = con_mod.ObjectLibrary()
    for name in objects.names():
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


def catalogue(objects: ArchivePool, library: con_mod.ObjectLibrary) -> list[tuple[str, str, str]]:
    """Every template a category folder declares as a spawnable object.

    Two ways in, because two different things make a template the object. Most
    of the game is one folder per object, so a template named after the folder
    holding its `.con` is that folder's thing. A few are not — see
    `CATALOGUE_KINDS` — and those are admitted on their declared kind instead.
    A template that satisfies both (`K98` is a `HandFireArms` *and* named after
    `HandWeapons/K98/`) appears once: the library is keyed by name.
    """
    out: list[tuple[str, str, str]] = []
    for template in library.objects.values():
        source = template.source.lower()
        category = next((v for k, v in CATEGORY_PREFIXES.items() if source.startswith(k)), None)
        if category is None:
            continue
        kind = template.kind.lower()
        # A soldier folder also holds his parachute and his 1P arms; only the
        # BFSoldier is a thing you can spawn.
        if category == "soldier" and kind != "bfsoldier":
            continue
        folder = spawn_folder(template.source)
        if (folder and template.name.lower() == folder.lower()) \
                or kind in CATALOGUE_KINDS.get(category, ()):
            out.append((template.name, category, template.source))
    return sorted(out, key=lambda r: (r[1], r[0].lower()))


def template_category(library: con_mod.ObjectLibrary, name: str) -> str:
    template = library.object(name)
    if template is None:
        return "object"
    source = template.source.lower()
    return next((v for k, v in CATEGORY_PREFIXES.items() if source.startswith(k)), "object")


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


def export_one(name: str, meshes: ArchivePool, textures: ArchivePool,
               objects: ArchivePool, library: con_mod.ObjectLibrary, *,
               configuration: str, lod: int, max_texture: int, out: Path,
               level_label: str | None = None,
               first_person: bool = False,
               requested: set[str] | None = None,
               ) -> dict | None:
    """Export a single vehicle variant, returning a manifest fragment or None.

    `requested`, when given, is filled with every texture name the export
    asked for, found or not (`texture_name_keys` form) - what
    `export_template` needs to tell which levels could reskin this model.
    """
    assembler = Assembler(meshes, textures, objects, library,
                          lod=lod, max_texture=max_texture,
                          configuration=configuration,
                          first_person=first_person,
                          # Nothing collides with a cockpit interior: it is
                          # scenery drawn around a camera that is already
                          # inside the vehicle's own hull.
                          include_collision=not first_person)
    suffix = variant_suffix(configuration, lod, level_label, first_person)
    file_stem = f"{name}{suffix}"
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

    if level_label is not None and not any(
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
    chain = [Path(p) for p in chain_paths]
    fallbacks = [Path(p) for p in fallback_paths]
    meshes, base_textures, objects, _game = build_pools(chain, fallbacks)
    library = build_library(objects)
    _worker_state["meshes"] = meshes
    _worker_state["base_textures"] = base_textures
    _worker_state["objects"] = objects
    _worker_state["library"] = library


def export_template(name: str, meshes: ArchivePool, base_textures: ArchivePool,
                    objects: ArchivePool, library: con_mod.ObjectLibrary, *,
                    configurations: list[str], lod: int, max_texture: int,
                    out: Path, level_sources: list[tuple[str, Path]],
                    cockpit: bool = False) -> tuple[list[dict], int]:
    """Every variant of one template: configurations x theatre skins, + cockpit."""
    variants: list[dict] = []
    failures = 0
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
    fallbacks = [game_dir / "Mods" / name for name in args.texture_fallback]
    meshes, base_textures, objects, game = build_pools(chain, fallbacks)
    library = build_library(objects)
    damage_tables = load_damage_tables(game)
    weapons = collect_weapons(objects)

    # -- level archives with vehicle textures --------------------------------
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
    roster, kit_count, level_count = roster_mod.build(library, discover_levels(chain))
    print(f"roster:     {kit_count} kits, {level_count} levels -> "
          f"{len(roster.factions)} templates with a faction", file=sys.stderr)
    if not base_textures.names() and not level_sources:
        print("WARNING: no texture source — models will export untextured.",
              file=sys.stderr)

    if args.list:
        for name, category, source in catalogue(objects, library):
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
    raise SystemExit(main())

