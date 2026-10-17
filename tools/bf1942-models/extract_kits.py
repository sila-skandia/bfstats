#!/usr/bin/env python3
"""Export what a soldier wears, and the manifest the kit browser reads.

    python3 extract_kits.py --out ./viewer/models
    python3 extract_kits.py --mod EoD --out ./viewer/models/mods/eod
    python3 extract_kits.py --mod FHSW --no-pickups --out ./viewer/models/mods/fhsw   # worn parts only
    python3 extract_kits.py --list

Every extracted soldier in this pipeline is bare-headed, correctly: a `BFSoldier`
declares a body, a head and two hands and nothing else. The helmet belongs to the
kit, which is a separate template tree, and this is the tool that walks it.

Two kinds of file come out, both small:

* `<Part>.kit.glb` — one per distinct worn geometry. A helmet, a pack, a hat.
  Its root node carries the bone it belongs on, so the viewer can graft it onto
  a posed soldier's skeleton the same way `extract_pose.py` welds a weapon onto
  `Bip01 R Hand`. About a hundred of these covers vanilla, EoD and both XPacks.
* `<Geometry>__pickup.kit.glb` — the kit as it lies on the ground, which is
  also the best thumbnail a kit card could have. One per distinct pickup
  geometry; the kits that drop the same bag share it (`pickup_holders`).

Plus `kits.json`, the manifest: one row per kit that a level actually binds,
naming its nation, class, worn parts, the weapon it spawns with, its weapons
and maps. A kit a level's ObjectSpawners lay on a pad counts as bound there
(`pads`, `pickupSoldiers`; Desert Combat's M82 and Stinger kits, which no
spawn-screen slot hands out). Kits a level declares in its own archive count like any other, and
a level that runs its own copy of a kit the mod also declares hands out that
copy: the row lists it under `levelVariants`, with what it changes
(`level_variants`; ledger LOAD-1, LOAD-2, LOAD-5).

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
from bf42 import roster as roster_mod
from bf42.assemble import Assembler
from bf42.rfa import ArchivePool

import extract_map as em
from extract_loadouts import read_chain_levels
from extract_models import (DEFAULT_GAME_DIR, OBJECT_ARCHIVES, _worker_state,
                            add_level_textures, available_bytes, build_pools,
                            LEVEL_SOURCE, discover_levels, forked_workers,
                            level_underlay, memory_capped_jobs, mod_chain,
                            resident_bytes, with_level_archives)
from bf42.rfa import find_archives_dir

# The rotation that seats a part on its bone is NOT computed here. It is the
# bone's inverse bind, and the only place every coordinate conversion in this
# pipeline has already been applied — the `.ske` Z-mirror, the glTF mirror, and
# the `pitch -= 90` that stands a soldier up on +Y — is the exported pose glb
# itself. Deriving it from `UsSoldier.ske` here was tried and lands 77-95 degrees
# out. `viewer/kits.html` reads it off the loaded skeleton instead; see
# "The graft, and the trap it walked into" in features/bf1942-3d-models/kits.md.

# A kit part is a hat. It does not need the vehicle-sized texture budget, and
# capping it keeps the whole worn set in the low megabytes.
MAX_TEXTURE = 512


def theatre_label(theatre: str | None) -> str | None:
    return {"desert": "North Africa",
            "winter": "Winter",
            "summer": "Summer"}.get((theatre or "").lower())


# Allied/Axis is a WWII frame. `roster.side_of` answers "Axis if listed, else
# Allied", which is right for the games it was written for and wrong the moment
# a Vietnam mod is loaded — it would file the Viet Cong as an Allied power.
# A kit knows its own side without the metaphor: `setKitTeam` is the number the
# level's `game.setKit` binds it to. So name the side only for nations the WWII
# table actually knows, and let everything else stand on its team.
WWII_NATIONS = roster_mod.AXIS_NATIONS | {
    "US", "US Marines", "British", "Canadian", "Soviet", "French", "Polish",
    "Australian", "Dutch",
    # Secret Weapons' two elite formations are a side each, not a country.
    "British Commandos",
}


# `German Elite` is Axis but is not a nation `side_of` knows, and its name does
# not start with "German" by accident — keep the mapping explicit rather than
# doing prefix matching on a display string.
EXTRA_AXIS = {"German Elite"}


def side_label(nation: str | None) -> str | None:
    if nation in EXTRA_AXIS:
        return "Axis"
    return roster_mod.side_of(nation) if nation in WWII_NATIONS else None


def export_part(name: str, make_assembler, out: Path,
                stem: str | None = None) -> dict | None:
    """One worn part or pickup mesh as its own `.glb`.

    Takes a factory, not an Assembler: an Assembler caches resolved textures as
    *image indices*, and those indices belong to the `GlbBuilder` of the export
    that created them. Share one across files and every part after the first
    silently points at an image in someone else's glb — which reads as "0
    textures resolved" in the report while the mesh still comes out fine.
    `extract_models.export_one` builds one per variant for the same reason.

    The bone the part belongs on is not stamped into the file. It lives in
    `kits.json`, which the viewer has to read anyway to know which mesh to load
    for which kit, and duplicating it would give two places for it to disagree.
    """
    return write_part(name, build_part(name, make_assembler), out, stem)


def build_part(name: str, make_assembler) -> tuple | str:
    """`export_part` up to the disk: `(glb, report)`, or why it failed. What
    a worker hands back when only the caller knows whether the part is kept.
    `make_assembler(name)` builds for that part: a part a level declares
    draws a mesh only its level ships (`part_pools`)."""
    try:
        return make_assembler(name).export(name)
    except Exception as exc:
        return str(exc)


def write_part(name: str, built: tuple | str, out: Path,
               stem: str | None = None) -> dict | None:
    """A `build_part` to its files; the manifest's record, None for a failure."""
    if isinstance(built, str):
        print(f"  {name}: {built}", file=sys.stderr)
        return None
    glb, report = built
    stem = f"{stem or name}.kit"
    (out / f"{stem}.glb").write_bytes(glb)
    (out / f"{stem}.report.json").write_text(json.dumps(report.as_dict(), indent=2))
    missing = sorted(set(report.missing_textures))
    print(f"  {name}: {report.triangles} tris, {len(report.resolved_textures)} textures"
          + (f", {len(missing)} unresolved" if missing else "")
          + f"  -> {stem}.glb ({len(glb) // 1024} KB)", file=sys.stderr)
    return {
        "glb": f"{stem}.glb",
        "report": f"{stem}.report.json",
        "triangles": report.triangles,
        "texturesResolved": len(report.resolved_textures),
        "texturesMissing": missing,
    }


def part_pools(chain: list[Path], library: con_mod.ObjectLibrary, template: str,
               meshes: ArchivePool, textures: ArchivePool) -> tuple[ArchivePool, ArchivePool]:
    """The mesh and texture pools a worn part is built from: the chain's,
    with every copy of the level that declares the part, or the geometry it
    draws, behind them (`extract_models.home_levels`, the models step's rule).

    203 Hill's Russians wear `Rus_RJcap_m2`, a `KitPart` only the level's
    `objects/Ruskit/` declares, drawing `Rus_nichirocap2.sm` from the level's
    own `StandardMesh/`. Its textures were mounted (`add_level_textures`) and
    its meshes were not, so the cap failed to build and every Russian spawned
    bareheaded (2026-10-15), as did the Japanese side in `JapNichirocap`."""
    resolved = library.object(template)
    geometry = (library.geometries.get((resolved.geometry or "").lower())
                if resolved is not None and resolved.geometry else None)
    for source in (resolved.source if resolved else "",
                   geometry.source if geometry is not None else ""):
        match = LEVEL_SOURCE.match(source or "")
        if match is None:
            continue
        stem = match.group(0).rstrip("/").rsplit("/", 1)[-1]
        home = [(layer.stem, layer) for layer in level_underlay(chain, stem)]
        return with_level_archives(meshes, home), with_level_archives(textures, home)
    return meshes, textures


def _geometry_file(library: con_mod.ObjectLibrary, template: str) -> tuple:
    """What a worn part draws: its geometry and the mesh file that names."""
    resolved = library.object(template)
    return _drawn(library, (resolved.geometry or "") if resolved else "")


def _drawn(library: con_mod.ObjectLibrary, geometry: str | None) -> tuple:
    """What a geometry draws in `library`: its name, the mesh file its
    declaration names and the folder it was declared in, lower case. Two
    libraries that agree on all three draw the same mesh."""
    geometry = geometry or ""
    found = library.geometries.get(geometry.lower()) if geometry else None
    return (geometry.lower(), (found.file or "").lower() if found else "",
            library.geometry_dir.get(geometry.lower(), "").lower())


def pickup_holder_name(geometry: str) -> str:
    """The synthetic template a pickup geometry is exported through, and the
    stem of its glb (`<Geometry>__pickup.kit.glb`)."""
    return f"{geometry}__pickup"


def pickup_template(library: con_mod.ObjectLibrary, geometry: str,
                    fallback_source: str = "") -> con_mod.ObjectTemplate:
    """The single-geometry template that asks the assembler for one pickup
    mesh, placed where the geometry is declared, so `part_pools` mounts the
    level that ships the mesh."""
    found = library.geometries.get(geometry.lower())
    source = found.source if found is not None and found.source else fallback_source
    return con_mod.ObjectTemplate(name=pickup_holder_name(geometry), kind="SimpleObject",
                                  geometry=geometry, source=source)


def pickup_holders(kits: list[kit_mod.Kit], library: con_mod.ObjectLibrary,
                   extra: list[str] = ()
                   ) -> tuple[dict[str, con_mod.ObjectTemplate], dict[str, str]]:
    """The pickup meshes to export for `kits`, one per distinct geometry: the
    synthetic single-geometry templates (`<Geometry>__pickup`) and, per kit
    (lower case), the holder whose glb it lies on the ground as.

    A kit's pickup is its own `geometry` (KITDROP-2), and most kits share one:
    FHSW's 1,185 bound kits draw 189 bags, FH's 117 draw 50. A library holds
    one declaration of a geometry name (`ObjectLibrary.geometries`), so the
    name is the key, as it is for the worn parts: a recolour ships as
    its own `.sm` under its own name.

    `extra` are geometries no kit's own row drops but a level's copy of one
    does, drawing what the mod's declaration draws (`level_own_kits`)."""
    holders: dict[str, con_mod.ObjectTemplate] = {}
    pickup_of: dict[str, str] = {}
    for kit in sorted(kits, key=lambda k: k.template.lower()):
        if not kit.pickup:
            continue
        key = pickup_holder_name(kit.pickup).lower()
        if key not in holders:
            holders[key] = pickup_template(library, kit.pickup, kit.source)
        pickup_of[kit.template.lower()] = holders[key].name
    for geometry in sorted(extra, key=str.lower):
        holders.setdefault(pickup_holder_name(geometry).lower(),
                           pickup_template(library, geometry))
    return {h.name: h for h in holders.values()}, pickup_of


def item_rows(kit: kit_mod.Kit) -> list[dict]:
    """A kit's carried items as `kits.json` lists them, in declaration order.

    A rolled item (`setRandomGeometries`) is a bundle the engine never
    instantiates (KIT-1): `variants` lists what a spawn can hand out in its
    place, one per roll 1..N, null where undeclared. A level's own copy of a
    kit is listed the same way from its own load, so a bundle only the copy
    carries reads as the level declares it (FHSW's Kiew copy of
    `4German_OfficerMp40` adds `RandomP08P38`; written by name alone, the
    first-person rigs were asked for the bundle).
    """
    rolled = {item.template.lower(): item for item in kit.random}
    return [{"template": name,
             **({"variants": list(rolled[name.lower()].variants)}
                if name.lower() in rolled else {})}
            for name in kit.carried]


def _kit_content(kit: kit_mod.Kit, library: con_mod.ObjectLibrary, read) -> dict:
    """The fields of a kit a level's own declaration can change, comparable."""
    template = library.object(kit.template)
    return {
        "nation": kit.nation,
        "class": kit.kit_class,
        "team": kit.team,
        "primary": kit.primary,
        "items": list(kit.carried),
        # The bag and what it draws in this library: a level that re-declares
        # the geometry over another mesh drops another bag (LOAD-1, LOAD-2).
        "pickup": (kit.pickup, _drawn(library, kit.pickup)) if kit.pickup else None,
        "worn": [(part.template, part.slot, part.bone, part.position, part.rotation,
                  tuple(part.alternatives), part.via_holder,
                  _geometry_file(library, part.template))
                 for part in kit.worn],
        "overrideAirMovementInhibitations": bool(
            template is not None
            and kit_mod.overrides_air_movement(library, template, read)),
    }


def level_own_kits(load, keys: list[str], base_content: dict[str, dict],
                   own_part=None, own_pickup=None) -> tuple[list[tuple], dict]:
    """The kits among `keys` (lower case) that one level's load hands out as
    its own copy, different from the mod's: `(key, Kit, content, geometry)`
    each, `geometry` being what every worn part and alternative of the copy
    draws in that load (`_geometry_file`), keyed by template.

    With them, the parts those copies wear that are the level's own, built
    through its library: `{template: build_part(...)}` from `own_part
    (template, drawn, library)`, which answers None for a part that draws
    what the mod's draws. They are built here, wanted or not (a level whose
    copy agrees with an earlier level's shares that one's), because here is
    where the library is. A copy that drops another bag than the mod's kit
    has its pickup built the same way, under `<Geometry>__pickup`, from
    `own_pickup(geometry, drawn, library, source)`, None for a bag that draws
    what the mod's declaration of that geometry draws.

    Everything a caller needs of the level's library, so the load (the mod
    chain's `objects/` read again behind the level's scripts) is released
    before this returns: holding every level's library alive at once ran the
    process out of memory (FHSW: ~200 levels, 1,397 of its kits declared in
    level archives).
    """
    library = load.library
    own_kits = kit_mod.collect(library)
    found = []
    parts: dict[str, tuple | str] = {}
    for key in keys:
        own = own_kits.get(key)
        if own is None:
            continue
        content = _kit_content(own, library, load.read)
        if content == base_content[key]:
            continue
        geometry = {template: _geometry_file(library, template)
                    for part in own.worn
                    for template in [part.template, *part.alternatives]}
        found.append((key, own, content, geometry))
        for template, drawn in geometry.items():
            if own_part is None or not drawn[0] or template in parts:
                continue
            built = own_part(template, drawn, library)
            if built is not None:
                parts[template] = built
        bag = content["pickup"]
        if own_pickup is not None and bag and bag != base_content[key]["pickup"]:
            holder = pickup_holder_name(own.pickup)
            if holder not in parts:
                built = own_pickup(own.pickup, bag[1], library, own.source)
                if built is not None:
                    parts[holder] = built
    load.release()
    return found, parts


def bound_keys(level: str, chosen: list[kit_mod.Kit], loadouts, pads=None) -> list[str]:
    """The kits of `chosen` (lower case, in its order) `level` binds to a
    slot or lays on a pad."""
    bound = {name.lower() for team in loadouts.get(level, {}).values()
             for name in team.slots.values()}
    bound |= set((pads or {}).get(level, {}))
    return [kit.template.lower() for kit in chosen if kit.template.lower() in bound]


def group_variants(found) -> dict[str, list[dict]]:
    """`level_variants`' answer from `(level, level_own_kits(...))` pairs in
    level order: per kit, the levels grouped where their copies agree, each
    group keeping the first level's kit and geometry."""
    out: dict[str, list[dict]] = {}
    for level, kits in found:
        for key, own, content, geometry in kits:
            for entry in out.setdefault(key, []):
                if entry["content"] == content:
                    entry["levels"].append(level)
                    break
            else:
                out[key].append({"levels": [level], "kit": own,
                                 "content": content, "geometry": geometry})
    return out


def _init_kit_worker(state: dict) -> None:
    """A forked worker's start: the parent's state by name, and a file handle
    of its own on every archive it inherited (`ArchivePool.reopen`)."""
    _worker_state.clear()
    _worker_state.update(state)
    for pool in state.get("pools", ()):
        pool.reopen()


def _level_own_kits_task(task: tuple[str, list[str]]) -> tuple[list[tuple], dict]:
    level, keys = task
    return level_own_kits(_worker_state["level_loads"][level], keys,
                          _worker_state["base_content"], _worker_state["own_part"],
                          _worker_state["own_pickup"])


def level_variants(chosen: list[kit_mod.Kit], census, loadouts,
                   level_loads, pads=None, *, jobs: int = 1,
                   per_worker: int = 0, pools=(), own_part=None, own_pickup=None
                   ) -> tuple[dict[str, list[dict]], dict[str, dict]]:
    """Per kit (lower case), the levels that hand out their own kit of that
    name, with what differs, grouped where levels agree.

    A level's declaration of a template beats the mod's (LOAD-1, LOAD-2), so
    a level that runs its own copy of a kit hands out that copy: DC Final's
    First Light gives `US_AT3` a Landmine; Lost Village nopara wears its own
    parts and a `nochute` on all twelve of its kits. Only the levels that bind
    the kit, or lay it on a pad (`pads`, `kit.level_pads`), are asked (EoD's
    `browsable` folds a `_CHUTE` twin's levels into its base, and those levels
    bind the twin). Each entry is `{"levels", "kit": Kit, "content",
    "geometry"}` (`level_own_kits`, `group_variants`). Second, per level, the
    parts of its own that `own_part` built while the level was loaded, and
    the bags of its own `own_pickup` built.

    This is where the script's time goes: a level's own kit is only known to
    that level's load (FHSW under `--maps` of 10 levels: 80 loads at 9.5 s,
    776 s of an 818 s run, and 20 GB while every level with a variant kept
    its library for the part exports). A level that binds none of `chosen`
    is not loaded at all. With `jobs` above one the rest are loaded in forked
    workers, one level's load each (`per_worker` bytes;
    `extract_models.memory_capped_jobs`), and grouped in level order, which
    is the answer a serial run gives.
    """
    base_content = {kit.template.lower(): _kit_content(kit, census.library, census.read)
                    for kit in chosen}
    tasks = [(level, keys) for level in sorted(level_loads)
             if (keys := bound_keys(level, chosen, loadouts, pads))]
    jobs = memory_capped_jobs(jobs, len(tasks), per_worker, available_bytes())
    if jobs > 1:
        print(f"  {len(tasks)} levels' own kits in {jobs} workers", file=sys.stderr)
        state = {"level_loads": level_loads, "base_content": base_content,
                 "pools": pools, "own_part": own_part, "own_pickup": own_pickup}
        with forked_workers(jobs, _init_kit_worker, (state,)) as executor:
            answers = list(executor.map(_level_own_kits_task, tasks))
    else:
        answers = [level_own_kits(level_loads[level], keys, base_content,
                                  own_part, own_pickup)
                   for level, keys in tasks]
    levels = [level for level, _keys in tasks]
    return (group_variants(zip(levels, (found for found, _parts in answers))),
            {level: parts for level, (_found, parts) in zip(levels, answers) if parts})


def _export_part_task(name: str) -> dict | None:
    state = _worker_state
    return export_part(name, state["make_assembler"], state["out"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, default=Path("./viewer/models"))
    ap.add_argument("--list", action="store_true",
                    help="report the kits and worn parts without exporting anything")
    ap.add_argument("--all", action="store_true",
                    help="include kits no level binds (declared-but-dead content)")
    ap.add_argument("--own", action="store_true",
                    help="only kits this mod declares itself, not the ones it "
                         "inherits (Road to Rome: 13 rather than 48)")
    ap.add_argument("--maps", type=Path, default=None,
                    help="bind kits only on the levels this maps.json holds. A mod "
                         "inherits its parents' levels, and they bind their own "
                         "kits: DesertCombat inherits vanilla's Aberdeen and Midway, "
                         "and without this their British and Japanese kits read as DC's")
    ap.add_argument("--no-pickups", action="store_true",
                    help="export the worn parts only, not each kit as it lies "
                         "on the ground: for a tree that only dresses soldiers "
                         "(the service record's poses-only trees). The map "
                         "page draws a dropped kit as its pickup mesh")
    ap.add_argument("-j", "--jobs", type=int, default=1,
                    help="worker processes, for the levels' own kits and for the "
                         "part exports. They are forks of this process and share "
                         "its census; a worker reading a level's own kits holds "
                         "that level's load, and fewer are started when that "
                         "many loads would not fit in memory")
    args = ap.parse_args()

    chain = mod_chain(args.game_dir, args.mod)
    if not chain:
        print(f"no mod chain for {args.mod}", file=sys.stderr)
        return 1
    meshes, textures, objects, game = build_pools(chain, [])
    # Kits a level declares in its own archive are bound by name like any
    # other, and FHSW declares 1,397 of its kits that way: the scripts each
    # level's `Init.con` runs, behind the chain's (`read_chain_levels`,
    # LOAD-5). Its levels also hold the only copy of some parts' textures.
    levels = discover_levels(chain)
    # A kit a level's ObjectSpawners lay on a pad is in play there like a
    # bound one, and needs its pickup mesh just as much (`kit.level_pads`).
    pads = kit_mod.level_pads(levels, chain)
    census, loadouts, level_loads = read_chain_levels(chain, objects=objects, pads=pads)
    add_level_textures(textures, levels)
    library = census.library
    # What a level's own load weighs, at most: the census holds the same
    # `objects/` and every level's scripts behind it.
    one_load = resident_bytes()

    kits = kit_mod.collect(library)
    swept = levels
    if args.maps:
        baked = {entry["name"].lower() for entry in json.loads(args.maps.read_text())}
        swept = [(name, path) for name, path in levels if name.lower() in baked]
    read = kit_mod.sweep_levels(kits, swept, library, pads=pads)
    chosen = (sorted(kits.values(), key=lambda k: k.template)
              if args.all else kit_mod.browsable(kits))

    # An expansion inherits vanilla's kits and its levels bind them, so its
    # roster is mostly British and German riflemen it did not write. `--own`
    # keeps only what the pack declares, tested the same way `extract_all --own`
    # tests a model: is the declaring `.con` readable in an archive pool built
    # from this mod alone? `ArchivePool.source_of` cannot answer that — it
    # returns the archive's filename, and every mod calls its own `Objects.rfa`.
    if args.own:
        archives = find_archives_dir(chain[0])
        if archives is not None:
            own_pool = ArchivePool()
            own_pool.add_dir(archives, OBJECT_ARCHIVES)
            # A kit one of this mod's own levels declares is this mod's too.
            for name, path in levels:
                if path.is_relative_to(chain[0]):
                    em.add_level_run_objects(own_pool, chain[:1], name)
            before = len(chosen)
            chosen = [k for k in chosen if own_pool.try_read(k.source) is not None]
            print(f"  --own: {len(chosen)} of {before} kits are this mod's",
                  file=sys.stderr)

    print(f"{args.mod}: {len(kits)} kits declared, {read} levels swept, "
          f"{sum(1 for k in kits.values() if k.live)} bound "
          f"({sum(1 for k in kits.values() if k.pads and not k.slots)} on pads only), "
          f"{len(chosen)} browsable", file=sys.stderr)
    def level_assembler(own_library):
        """Builds a part through a level's library, its level's archives
        behind the chain's (`part_pools`)."""
        def make(name: str) -> Assembler:
            part_meshes, part_textures = part_pools(chain, own_library, name,
                                                    meshes, textures)
            return Assembler(part_meshes, part_textures, objects, own_library, lod=0,
                             max_texture=MAX_TEXTURE, configuration="complex",
                             include_collision=False)
        return make

    def own_part(template: str, drawn: tuple, own_library) -> tuple | str | None:
        """A level's own worn part, built through that level's library; None
        for one that draws what the mod's part of that name draws, which
        shares the mod's glb."""
        if drawn == _geometry_file(library, template):
            return None
        return build_part(template, level_assembler(own_library))

    def own_pickup(geometry: str, drawn: tuple, own_library,
                   source: str) -> tuple | str | None:
        """A level's own bag, built through that level's library; None for
        one that draws what the mod's declaration of that geometry draws,
        which shares the mod's glb."""
        if drawn == _drawn(library, geometry):
            return None
        holder = pickup_template(own_library, geometry, source)
        own_library.objects[holder.name.lower()] = holder
        return build_part(holder.name, level_assembler(own_library))

    variants, level_parts = level_variants(
        chosen, census, loadouts, level_loads, pads,
        jobs=args.jobs, per_worker=one_load, pools=(meshes, textures, objects),
        own_part=None if args.list else own_part,
        own_pickup=None if args.list or args.no_pickups else own_pickup)
    for key, entries in sorted(variants.items()):
        for entry in entries:
            print(f"  {entry['kit'].template}: its own on "
                  f"{', '.join(entry['levels'])}", file=sys.stderr)

    # One file per distinct geometry, not per kit: seven German kits naming the
    # same helmet is one helmet. Keyed on the geometry rather than the template
    # because a recolour always ships as its own `.sm` (Refractor has no
    # per-instance texture override), so the geometry name is a sufficient key.
    wanted: dict[str, tuple[str, str, str]] = {}
    for kit in chosen:
        for part in kit.worn:
            for template in [part.template, *part.alternatives]:
                resolved = library.object(template)
                geometry = (resolved.geometry if resolved else None) or part.geometry
                if geometry:
                    wanted.setdefault(template, (template, part.bone, part.slot))
    # Export each kit's *own* geometry, not the kit template — that tree holds
    # the weapons and every worn part, so exporting it gives a 3,300-triangle
    # pile of rifles rather than the 209-triangle satchel the game drops on the
    # ground. A synthetic single-geometry template is the narrowest way to ask
    # the assembler for one mesh, and one serves every kit drawing that bag.
    # A level's copy of a kit that drops another bag: one the mod declares
    # the same way shares the mod's holder (exported even when no kit's own
    # row drops it); one the level declares over another mesh was built
    # while the level was loaded, and is written as `<Geometry>__pickup@<Level>`.
    shared_bags: set[str] = set()
    variant_bags: dict[tuple[str, str], tuple[str, str]] = {}
    if not args.no_pickups:
        for entries in variants.values():
            for entry in entries:
                bag = entry["content"]["pickup"]
                if not bag:
                    continue
                geometry, level = entry["kit"].pickup, entry["levels"][0]
                if bag[1] == _drawn(library, geometry):
                    shared_bags.add(geometry)
                else:
                    variant_bags[(pickup_holder_name(geometry).lower(), level.lower())] = (
                        pickup_holder_name(geometry), level)
    holders, pickup_of = (({}, {}) if args.no_pickups
                          else pickup_holders(chosen, library, sorted(shared_bags)))
    for holder, template in holders.items():
        if library.object(holder) is None:
            library.objects[holder.lower()] = template
        wanted.setdefault(holder, (holder, "", "pickup"))

    # A level's own kit wears parts through the level's library. A part that
    # draws what the mod's part of that name draws shares the mod's glb; one
    # that does not gets a glb of its own, named for the level.
    variant_parts: dict[tuple[str, str], tuple] = {}
    for key, entries in variants.items():
        for entry in entries:
            level = entry["levels"][0]
            for part in entry["kit"].worn:
                for template in [part.template, *part.alternatives]:
                    own = entry["geometry"][template]
                    if not own[0]:
                        continue
                    if own == _geometry_file(library, template):
                        wanted.setdefault(template, (template, part.bone, part.slot))
                    else:
                        variant_parts[(template.lower(), level.lower())] = (
                            template, level)

    if args.list:
        for kit in chosen:
            worn = ", ".join(f"{p.slot}:{p.geometry or p.template}" for p in kit.worn)
            print(f"  {kit.template:34s} {str(kit.nation):14s} {kit.kit_class:12s} "
                  f"{len(kit.levels):3d} maps  {worn}")
        print(f"\n{len(wanted)} distinct meshes to export", file=sys.stderr)
        return 0

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    def make_assembler(name: str) -> Assembler:
        part_meshes, part_textures = part_pools(chain, library, name, meshes, textures)
        return Assembler(part_meshes, part_textures, objects, library,
                         lod=0, max_texture=MAX_TEXTURE,
                         configuration="complex", include_collision=False)

    # One task per mesh. Workers write the files; the records come back in
    # task order, so the manifest is the one a serial run writes.
    part_tasks = sorted(wanted.items())
    if args.jobs > 1 and len(part_tasks) > 1:
        state = {"pools": (meshes, textures, objects),
                 "make_assembler": make_assembler, "out": out}
        with forked_workers(min(args.jobs, len(part_tasks)),
                            _init_kit_worker, (state,)) as executor:
            part_records = list(executor.map(
                _export_part_task, [name for _t, (name, _b, _s) in part_tasks],
                chunksize=max(1, len(part_tasks) // (args.jobs * 8))))
    else:
        part_records = [export_part(name, make_assembler, out)
                        for _template, (name, _bone, _slot) in part_tasks]

    exported: dict[str, dict] = {}
    for (template, _part), record in zip(part_tasks, part_records):
        if record is not None:
            exported[template.lower()] = record
    # A level's own parts were built while it was loaded (`level_own_kits`);
    # the ones a variant's first level wears are the ones written.
    for (key, level_key), (template, level) in sorted(variant_parts.items()):
        record = write_part(template, level_parts[level][template], out,
                            stem=f"{template}@{level}")
        if record is not None:
            exported[f"{key}@{level_key}"] = record
    for (key, level_key), (holder, level) in sorted(variant_bags.items()):
        built = level_parts.get(level, {}).get(holder)
        record = write_part(holder, built, out, stem=f"{holder}@{level}") if built else None
        if record is not None:
            exported[f"{key}@{level_key}"] = record

    def bag_glb(geometry: str | None, level: str | None = None) -> str | None:
        """The glb a kit drops `geometry` as: the level's own, else the
        mod's, else none."""
        if not geometry:
            return None
        key = pickup_holder_name(geometry).lower()
        record = exported.get(f"{key}@{level.lower()}") if level else None
        record = record or exported.get(key)
        return record["glb"] if record else None

    def worn_rows(worn: list[kit_mod.WornPart], level: str | None = None) -> list[dict]:
        """`worn` as the manifest lists it, each part with its glb. A level's
        own part that draws something else than the mod's is `<Part>@<Level>`."""
        def record_of(template: str) -> dict | None:
            if level is not None:
                own = exported.get(f"{template.lower()}@{level.lower()}")
                if own is not None:
                    return own
            return exported.get(template.lower())
        listed = []
        for part in worn:
            record = record_of(part.template)
            listed.append({
                "template": part.template,
                "geometry": part.geometry,
                "slot": part.slot,
                "bone": part.bone,
                "position": list(part.position),
                "rotation": list(part.rotation),
                "viaHolder": part.via_holder,
                "alternatives": [
                    {"template": alt, **({"glb": record_of(alt)["glb"]}
                                         if record_of(alt) else {})}
                    for alt in part.alternatives],
                **({"glb": record["glb"], "triangles": record["triangles"],
                    "texturesMissing": record["texturesMissing"]}
                   if record else {"glb": None}),
            })
        return listed

    rows = []
    for kit in chosen:
        worn = worn_rows(kit.worn)
        pickup = exported.get(pickup_of.get(kit.template.lower(), "").lower())
        rows.append({
            "template": kit.template,
            "nation": kit.nation,
            "class": kit.kit_class,
            "side": side_label(kit.nation),
            "theatre": theatre_label(kit.theatre),
            "unit": kit.unit,
            "team": kit.team,
            "soldiers": sorted(kit.soldiers),
            "levels": sorted(kit.levels),
            "slots": sorted(kit.slots),
            # The levels whose ObjectSpawners lay this kit on a pad, and every
            # soldier who can take it there: their sleeves hold its weapons
            # (`extract_viewmodel.kit_pairs`). Absent for a kit no pad places.
            **({"pads": sorted(kit.pads),
                "pickupSoldiers": sorted(kit.pickup_soldiers)} if kit.pads else {}),
            # The weapon in hand on spawn, spelled as its own template: what
            # a page dressing the soldier should pose him holding.
            "primary": kit.primary,
            "pickup": {"geometry": kit.pickup,
                       "glb": pickup["glb"] if pickup else None},
            "worn": worn,
            # Declaration order is the in-game slot order, so this list is not
            # sorted: a mod that puts the satchel first is showing you what it
            # does. Behaviour-only flags (`nochute`) are already filtered out.
            # A rolled item carries its `variants` (`item_rows`).
            "items": item_rows(kit),
            "source": kit.source,
        })
        # The levels that hand out a kit of their own under this name, and
        # only what their copy changes: its items, its worn parts, its
        # pickup, whether it wears a `nochute` (`level_variants`). `levels`
        # above still lists them, because they bind the name.
        entries = variants.get(kit.template.lower(), [])
        if entries:
            base = _kit_content(kit, library, census.read)
            listed = []
            for entry in entries:
                own, content = entry["kit"], entry["content"]
                variant = {"levels": sorted(entry["levels"]), "source": own.source}
                for field in ("nation", "class", "team", "primary"):
                    if content[field] != base[field]:
                        variant[field] = content[field]
                if content["items"] != base["items"]:
                    # Rolled as the kit's own are: `variants` are the copy's,
                    # spelled and counted as the level's load declares them.
                    variant["items"] = item_rows(own)
                if content["worn"] != base["worn"]:
                    variant["worn"] = worn_rows(own.worn, entry["levels"][0])
                if content["pickup"] != base["pickup"]:
                    variant["pickup"] = {"geometry": own.pickup,
                                         "glb": bag_glb(own.pickup, entry["levels"][0])}
                if (content["overrideAirMovementInhibitations"]
                        != base["overrideAirMovementInhibitations"]):
                    variant["overrideAirMovementInhibitations"] = (
                        content["overrideAirMovementInhibitations"])
                listed.append(variant)
            rows[-1]["levelVariants"] = listed

    manifest = {
        "mod": args.mod,
        "classes": sorted({row["class"] for row in rows}),
        "nations": sorted({row["nation"] for row in rows if row["nation"]}),
        "kits": rows,
    }
    (out / "kits.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n{len(rows)} kits, {len(exported)} meshes -> {out / 'kits.json'}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    # Every glb this wrote moves its textures into the shared store
    # (optimise_mesh.py, features/mesh-asset-size); `--no-optimise` opts out.
    from optimise_mesh import run_then_optimise
    raise SystemExit(run_then_optimise(main, Path("./viewer/models")))
