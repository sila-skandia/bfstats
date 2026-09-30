#!/usr/bin/env python3
"""Export what a soldier wears, and the manifest the kit browser reads.

    python3 extract_kits.py --out ./viewer/models
    python3 extract_kits.py --mod EoD --out ./viewer/models/mods/eod
    python3 extract_kits.py --mod FHSW --no-pickups --out ./viewer/models/mods/fhsw
    python3 extract_kits.py --list

Every extracted soldier in this pipeline is bare-headed, correctly: a `BFSoldier`
declares a body, a head and two hands and nothing else. The helmet belongs to the
kit, which is a separate template tree, and this is the tool that walks it.

Two kinds of file come out, both small:

* `<Part>.kit.glb` — one per distinct worn geometry. A helmet, a pack, a hat.
  Its root node carries the bone it belongs on, so the viewer can graft it onto
  a posed soldier's skeleton the same way `extract_pose.py` welds a weapon onto
  `Bip01 R Hand`. About a hundred of these covers vanilla, EoD and both XPacks.
* `<Pickup>.kit.glb` — the kit as it lies on the ground, which is also the best
  thumbnail a kit card could have.

Plus `kits.json`, the manifest: one row per kit that a level actually binds,
naming its nation, class, worn parts, the weapon it spawns with, its weapons
and maps. Kits a level declares in its own archive count like any other, and
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
from extract_models import (DEFAULT_GAME_DIR, OBJECT_ARCHIVES, add_level_textures,
                            build_pools, discover_levels, mod_chain)
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
    try:
        glb, report = make_assembler().export(name)
    except Exception as exc:
        print(f"  {name}: {exc}", file=sys.stderr)
        return None

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


def _geometry_file(library: con_mod.ObjectLibrary, template: str) -> tuple:
    """What a worn part draws: its geometry and the mesh file that names."""
    resolved = library.object(template)
    geometry = (resolved.geometry or "") if resolved else ""
    found = library.geometries.get(geometry.lower()) if geometry else None
    return (geometry.lower(), (found.file or "").lower() if found else "",
            library.geometry_dir.get(geometry.lower(), "").lower())


def _kit_content(kit: kit_mod.Kit, library: con_mod.ObjectLibrary, read) -> dict:
    """The fields of a kit a level's own declaration can change, comparable."""
    template = library.object(kit.template)
    return {
        "nation": kit.nation,
        "class": kit.kit_class,
        "team": kit.team,
        "primary": kit.primary,
        "items": list(kit.carried),
        "pickup": kit.pickup,
        "worn": [(part.template, part.slot, part.bone, part.position, part.rotation,
                  tuple(part.alternatives), part.via_holder,
                  _geometry_file(library, part.template))
                 for part in kit.worn],
        "overrideAirMovementInhibitations": bool(
            template is not None
            and kit_mod.overrides_air_movement(library, template, read)),
    }


def level_variants(chosen: list[kit_mod.Kit], census, loadouts,
                   level_loads) -> dict[str, list[dict]]:
    """Per kit (lower case), the levels that hand out their own kit of that
    name, with what differs, grouped where levels agree.

    A level's declaration of a template beats the mod's (LOAD-1, LOAD-2), so
    a level that runs its own copy of a kit hands out that copy: DC Final's
    First Light gives `US_AT3` a Landmine; Lost Village nopara wears its own
    parts and a `nochute` on all twelve of its kits. Only the levels that bind
    the kit are asked (EoD's `browsable` folds a `_CHUTE` twin's levels into
    its base, and those levels bind the twin). Each entry is
    `{"levels", "kit": Kit, "library", "content"}`.
    """
    base_content = {kit.template.lower(): _kit_content(kit, census.library, census.read)
                    for kit in chosen}
    out: dict[str, list[dict]] = {}
    # One level's load materialized at a time, released unless it keeps a
    # variant (`entry["library"]`, which the assembler's worn-part pass reads
    # back): holding every level's library alive at once ran the process out
    # of memory (FHSW: ~200 levels, 1,397 of its kits declared in level
    # archives).
    for level, load in sorted(level_loads.items()):
        bound = {name.lower() for team in loadouts.get(level, {}).values()
                 for name in team.slots.values()}
        library = load.library
        own_kits = kit_mod.collect(library)
        kept = False
        for kit in chosen:
            key = kit.template.lower()
            if key not in bound or key not in base_content:
                continue
            own = own_kits.get(key)
            if own is None:
                continue
            content = _kit_content(own, library, load.read)
            if content == base_content[key]:
                continue
            kept = True
            for entry in out.setdefault(key, []):
                if entry["content"] == content:
                    entry["levels"].append(level)
                    break
            else:
                out[key].append({"levels": [level], "kit": own,
                                 "library": library, "content": content})
        if not kept:
            load.release()
    return out


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
                         "on the ground. FHSW binds thousands of kits; a page "
                         "that only dresses soldiers needs none of them")
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
    census, loadouts, level_loads = read_chain_levels(chain, objects=objects)
    add_level_textures(textures, levels)
    library = census.library

    kits = kit_mod.collect(library)
    swept = levels
    if args.maps:
        baked = {entry["name"].lower() for entry in json.loads(args.maps.read_text())}
        swept = [(name, path) for name, path in levels if name.lower() in baked]
    read = kit_mod.sweep_levels(kits, swept, library)
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
          f"{sum(1 for k in kits.values() if k.live)} bound, "
          f"{len(chosen)} browsable", file=sys.stderr)
    variants = level_variants(chosen, census, loadouts, level_loads)
    for key, entries in sorted(variants.items()):
        for entry in entries:
            print(f"  {entry['kit'].template}: its own on "
                  f"{', '.join(entry['levels'])}", file=sys.stderr)

    # One file per distinct geometry, not per kit: seven German kits naming the
    # same helmet is one helmet. Keyed on the geometry rather than the template
    # because a recolour always ships as its own `.sm` (Refractor has no
    # per-instance texture override), so the geometry name is a sufficient key.
    wanted: dict[str, tuple[str, str, str]] = {}
    pickup_of: dict[str, str] = {}
    for kit in chosen:
        for part in kit.worn:
            for template in [part.template, *part.alternatives]:
                resolved = library.object(template)
                geometry = (resolved.geometry if resolved else None) or part.geometry
                if geometry:
                    wanted.setdefault(template, (template, part.bone, part.slot))
        if kit.pickup and not args.no_pickups:
            # Export the kit's *own* geometry, not the kit template — that tree
            # holds the weapons and every worn part, so exporting it gives a
            # 3,300-triangle pile of rifles rather than the 209-triangle satchel
            # the game drops on the ground. A synthetic single-geometry template
            # is the narrowest way to ask the assembler for one mesh.
            holder = f"{kit.template}__pickup"
            if library.object(holder) is None:
                library.objects[holder.lower()] = con_mod.ObjectTemplate(
                    name=holder, kind="SimpleObject", geometry=kit.pickup,
                    source=kit.source)
            wanted.setdefault(holder, (holder, "", "pickup"))
            pickup_of[kit.template.lower()] = holder

    # A level's own kit wears parts through the level's library. A part that
    # draws what the mod's part of that name draws shares the mod's glb; one
    # that does not gets a glb of its own, named for the level.
    variant_parts: dict[tuple[str, str], tuple] = {}
    for key, entries in variants.items():
        for entry in entries:
            level = entry["levels"][0]
            for part in entry["kit"].worn:
                for template in [part.template, *part.alternatives]:
                    own = _geometry_file(entry["library"], template)
                    if not own[0]:
                        continue
                    if own == _geometry_file(library, template):
                        wanted.setdefault(template, (template, part.bone, part.slot))
                    else:
                        variant_parts[(template.lower(), level.lower())] = (
                            template, level, entry["library"])

    if args.list:
        for kit in chosen:
            worn = ", ".join(f"{p.slot}:{p.geometry or p.template}" for p in kit.worn)
            print(f"  {kit.template:34s} {str(kit.nation):14s} {kit.kit_class:12s} "
                  f"{len(kit.levels):3d} maps  {worn}")
        print(f"\n{len(wanted)} distinct meshes to export", file=sys.stderr)
        return 0

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    def make_assembler() -> Assembler:
        return Assembler(meshes, textures, objects, library,
                         lod=0, max_texture=MAX_TEXTURE,
                         configuration="complex", include_collision=False)

    exported: dict[str, dict] = {}
    for template, (name, bone, slot) in sorted(wanted.items()):
        record = export_part(name, make_assembler, out)
        if record is not None:
            exported[template.lower()] = record
    for (key, level_key), (template, level, own_library) in sorted(variant_parts.items()):
        def make_level_assembler(own_library=own_library) -> Assembler:
            return Assembler(meshes, textures, objects, own_library,
                             lod=0, max_texture=MAX_TEXTURE,
                             configuration="complex", include_collision=False)
        record = export_part(template, make_level_assembler, out,
                             stem=f"{template}@{level}")
        if record is not None:
            exported[f"{key}@{level_key}"] = record

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
        rolled = {item.template.lower(): item for item in kit.random}
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
            # The weapon in hand on spawn, spelled as its own template: what
            # a page dressing the soldier should pose him holding.
            "primary": kit.primary,
            "pickup": {"geometry": kit.pickup,
                       "glb": pickup["glb"] if pickup else None},
            "worn": worn,
            # Declaration order is the in-game slot order, so this list is not
            # sorted: a mod that puts the satchel first is showing you what it
            # does. Behaviour-only flags (`nochute`) are already filtered out.
            #
            # A rolled item (`setRandomGeometries`) is a bundle the engine
            # never instantiates: `variants` lists what a spawn can hand out
            # in its place, one per roll 1..N (null where undeclared).
            "items": [{"template": name,
                       **({"variants": rolled[name.lower()].variants}
                          if name.lower() in rolled else {})}
                      for name in kit.carried],
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
                    variant["items"] = [{"template": name} for name in own.carried]
                if content["worn"] != base["worn"]:
                    variant["worn"] = worn_rows(own.worn, entry["levels"][0])
                if content["pickup"] != base["pickup"]:
                    variant["pickup"] = {"geometry": own.pickup, "glb": None}
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
