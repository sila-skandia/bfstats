#!/usr/bin/env python3
"""Export what a soldier wears, and the manifest the kit browser reads.

    python3 extract_kits.py --out ./viewer/models
    python3 extract_kits.py --mod EoD --out ./viewer/models/mods/eod
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
naming its nation, class, worn parts, weapons and maps.

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

from extract_models import (DEFAULT_GAME_DIR, build_library, build_pools,
                            discover_levels, mod_chain)

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
}


def side_label(nation: str | None) -> str | None:
    return roster_mod.side_of(nation) if nation in WWII_NATIONS else None


def export_part(name: str, make_assembler, out: Path) -> dict | None:
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

    stem = f"{name}.kit"
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
    args = ap.parse_args()

    chain = mod_chain(args.game_dir, args.mod)
    if not chain:
        print(f"no mod chain for {args.mod}", file=sys.stderr)
        return 1
    meshes, textures, objects, game = build_pools(chain, [])
    library = build_library(objects)

    kits = kit_mod.collect(library)
    levels = discover_levels(chain)
    read = kit_mod.sweep_levels(kits, levels)
    chosen = (sorted(kits.values(), key=lambda k: k.template)
              if args.all else kit_mod.browsable(kits))

    print(f"{args.mod}: {len(kits)} kits declared, {read} levels swept, "
          f"{sum(1 for k in kits.values() if k.live)} bound, "
          f"{len(chosen)} browsable", file=sys.stderr)

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
        if kit.pickup:
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

    rows = []
    for kit in chosen:
        worn = []
        for part in kit.worn:
            record = exported.get(part.template.lower())
            worn.append({
                "template": part.template,
                "geometry": part.geometry,
                "slot": part.slot,
                "bone": part.bone,
                "position": list(part.position),
                "rotation": list(part.rotation),
                "viaHolder": part.via_holder,
                "alternatives": [
                    {"template": alt, **({"glb": exported[alt.lower()]["glb"]}
                                         if alt.lower() in exported else {})}
                    for alt in part.alternatives],
                **({"glb": record["glb"], "triangles": record["triangles"],
                    "texturesMissing": record["texturesMissing"]}
                   if record else {"glb": None}),
            })
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
            "pickup": {"geometry": kit.pickup,
                       "glb": pickup["glb"] if pickup else None},
            "worn": worn,
            # Declaration order is the in-game slot order, so this list is not
            # sorted: a mod that puts the satchel first is showing you what it
            # does. Behaviour-only flags (`nochute`) are already filtered out.
            "items": [{"template": name} for name in kit.carried],
            "source": kit.source,
        })

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
    raise SystemExit(main())
