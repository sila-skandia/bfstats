#!/usr/bin/env python3
"""A level's re-declaration of a template the mod's own archives declare, as a
model of its own: `Willy.Raid_on_Agheila.glb`.

    python3 extract_level_variants.py --mod XPack2 --level Raid_on_Agheila \\
        --out /tmp/scratch [--cockpit] [--list] [Willy ...]

`extract_models.py` builds its library from the mod chain and lets a level add
only the templates the chain lacks ("global templates keep priority"). That is
right for a catalogue and wrong for a level: a level load runs the level's own
scripts first and a `create` of a name already declared makes nothing
(`extract_map.LevelFirst`, LOAD-1), so a template a level re-declares is the
level's, whole. Raid on Agheila's `Willy` is the SAS jeep: another seat table,
a mounted M1919A4 on `M1919A4_Horz_Rot`/`M1919A4_Vert_Rot`, `Icon_BritJeep`,
`TTSasWilly`. The level bake places it (`scene.glb`), but a replay draws its
hulls from `models/`, and the catalogue had only vanilla's.

For each template the level declares from its own archive that the chain also
declares (or the ones named), this exports the same variants `extract_models.py`
does, from the library a level bake is built with, under the level's label
(`<Name>.<Level>.glb`, `<Name>.wreck.<Level>.glb`, `<Name>.cockpit.<Level>.glb`),
and writes `level-variants.json`, a models.json fragment (`variants` rows with
`level` set) for `merge_level_variants` to put in the tree's catalogue. Nothing
else is written; the tree's `models.json` and `damage.json` are not touched.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import extract_models as em
from bf42.rfa import find_archives_dir
import scene_layers as sl


def redeclared(ctx: "sl.LevelContext", chain: list[Path], *, vehicles_only: bool = False) -> list[str]:
    """Templates this level declares from its own archive that the mod chain's
    own archives declare as well, roots only, in name order. `vehicles_only`
    keeps what the browse catalogue files as land, air, sea or emplacement
    (a depot's `Ammobox` is the level's own too, and is no model)."""
    level_prefix = f"bf1942/levels/{ctx.info.name.lower()}/"
    meshes, textures, objects, game = em.build_pools(chain, [])[:4]
    chain_library = em.build_library(objects)
    out = []
    for template in ctx.library.objects.values():
        if not template.source.lower().replace("\\", "/").startswith(level_prefix):
            continue
        if chain_library.object(template.name) is None:
            continue
        if not ctx.library.available_configurations(template.name):
            continue
        out.append(template.name)
    # Roots only: Willy, not its seat, its springs and its lod wrappers.
    children = set()
    for name in out:
        stack = [name.lower()]
        seen = set()
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            template = ctx.library.object(current)
            for child in (template.children if template else []):
                children.add(child.template.lower())
                stack.append(child.template.lower())
    roots = [name for name in out if name.lower() not in children]
    if vehicles_only:
        roots = [name for name in roots
                 if em.template_category(ctx.library, name) in ("land", "air", "sea", "emplacement")]
    return sorted(set(roots), key=str.lower)


def export_variants(ctx: "sl.LevelContext", names: list[str], out: Path, *,
                    cockpit: bool, max_texture: int = 1024) -> dict[str, list[dict]]:
    chain = ctx.chain
    meshes, textures, objects, _game = ctx.pools
    # The level's own meshes and textures behind the chain's, as a bake has them.
    for path in ctx.paths:
        for pool in (meshes, textures):
            try:
                if pool is textures:
                    pool.add_level(path, label=ctx.info.name)
                else:
                    pool.add(path, label=ctx.info.name)
            except Exception as exc:
                print(f"  {path.name}: {exc}", file=sys.stderr)
    library = ctx.library
    em.INSTALL_MOD = chain[0].name if chain else None
    result: dict[str, list[dict]] = {}
    for name in names:
        variants: list[dict] = []
        for configuration in ("complex", "wreck"):
            if configuration not in library.available_configurations(name):
                continue
            variant = em.export_one(
                name, meshes, textures, objects, library,
                configuration=configuration, lod=0, max_texture=max_texture,
                out=out, level_label=ctx.info.name, require_level_texture=False)
            if variant:
                variants.append(variant)
        if cockpit and em.reaches_first_person(library, name):
            interior = em.export_one(
                name, meshes, textures, objects, library,
                configuration="complex", lod=0, max_texture=max_texture,
                out=out, level_label=ctx.info.name, first_person=True,
                require_level_texture=False)
            if interior:
                variants.append(interior)
        if variants:
            result[name] = variants
    return result


def install(fragment: dict, scratch: Path, tree: Path, vanilla: Path | None) -> list[str]:
    """Copy the variants' files into `tree` and merge their rows into its
    `models.json`, in place (an existing file is rewritten through its own
    inode, as the trees' hard-link mirrors want). Returns the files written,
    relative to `tree`. An entry the tree has gets the variants added; one it
    lacks (a vanilla template the mod's level re-declares) is made from
    vanilla's entry with the level variant's own numbers."""
    written: list[str] = []
    catalogue_path = tree / "models.json"
    catalogue = json.loads(catalogue_path.read_text()) if catalogue_path.exists() else []
    vanilla_entries = {}
    if vanilla is not None and (vanilla / "models.json").exists():
        for entry in json.loads((vanilla / "models.json").read_text()):
            vanilla_entries[str(entry.get("name")).lower()] = entry
    for name, rows in fragment["templates"].items():
        for row in rows:
            for key in ("glb", "report"):
                src = scratch / row[key]
                dst = tree / row[key]
                with open(dst, "wb") as handle:
                    handle.write(src.read_bytes())
                written.append(row[key])
        entry = next((e for e in catalogue if str(e.get("name")).lower() == name.lower()), None)
        main_row = next((r for r in rows if r["configuration"] == "complex" and not r["firstPerson"]), None)
        if entry is None:
            base = dict(vanilla_entries.get(name.lower()) or {"name": name, "category": "land"})
            base.pop("thumb", None)
            base.update({"name": name, "mod": fragment["mod"], "levels": [fragment["level"]]})
            if main_row:
                report = json.loads((scratch / main_row["report"]).read_text())
                base.update({
                    "glb": main_row["glb"], "report": main_row["report"], "cockpit": None,
                    "configuration": "complex", "lod": 0, "level": fragment["level"],
                    "parts": main_row["parts"], "triangles": main_row["triangles"],
                    "texturesResolved": main_row["texturesResolved"],
                    "texturesMissing": main_row["texturesMissing"],
                    "hitpoints": (report.get("armor") or {}).get("hitpoints"),
                    "rigged": len(report.get("riggedParts") or []),
                    "animatedParts": len(report.get("animatedParts") or []),
                    "cameras": len(report.get("cameras") or []),
                })
            base["variants"] = []
            catalogue.append(base)
            entry = base
        have = {v.get("glb"): i for i, v in enumerate(entry.get("variants") or [])}
        entry.setdefault("variants", [])
        for row in rows:
            if row["firstPerson"]:
                continue
            if row["glb"] in have:
                entry["variants"][have[row["glb"]]] = row
            else:
                entry["variants"].append(row)
    with open(catalogue_path, "w") as handle:
        handle.write(json.dumps(catalogue, indent=2))
    written.append("models.json")
    return written


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("templates", nargs="*", help="template names (default: every re-declared one)")
    ap.add_argument("--game-dir", type=Path, default=em.DEFAULT_GAME_DIR)
    ap.add_argument("--mod", required=True)
    ap.add_argument("--level", help="the level whose re-declarations to export")
    ap.add_argument("--all-levels", action="store_true",
                    help="every level of the mod's own archives, vehicles only (the pipeline's step)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--cockpit", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--max-texture", type=int, default=1024)
    ap.add_argument("--install", type=Path, metavar="TREE",
                    help="copy the files into this model tree (models/mods/<id>) and merge "
                         "its models.json; run optimise_mesh.py over them afterwards")
    ap.add_argument("--vanilla", type=Path, default=Path(__file__).resolve().parent / "viewer" / "models",
                    help="vanilla's tree, whose entry a new row is made from")
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    if args.all_levels == bool(args.level):
        ap.error("give --level or --all-levels")
    if args.all_levels:
        return run_all_levels(game_dir, args)
    return run_level(game_dir, args.level, args)


def run_level(game_dir: Path, level: str, args: argparse.Namespace, *, vehicles_only: bool = False) -> int:
    ctx = sl.LevelContext(game_dir, args.mod, level, out=args.out)
    chain = ctx.chain
    found = redeclared(ctx, chain, vehicles_only=vehicles_only)
    names = args.templates or found
    if args.list:
        for name in found:
            print(name)
        return 0
    if not names:
        return 0
    args.out.mkdir(parents=True, exist_ok=True)
    variants = export_variants(ctx, names, args.out, cockpit=args.cockpit,
                               max_texture=args.max_texture)
    fragment = {
        "mod": args.mod, "level": ctx.info.name,
        "templates": {name: rows for name, rows in variants.items()},
    }
    (args.out / "level-variants.json").write_text(json.dumps(fragment, indent=2))
    print(f"{ctx.info.name}: {len(variants)} templates -> {args.out}", file=sys.stderr)
    if args.install and variants:
        for rel in install(fragment, args.out, args.install, args.vanilla):
            print(f"  installed {rel}", file=sys.stderr)
    return 0


def run_all_levels(game_dir: Path, args: argparse.Namespace) -> int:
    """Every level of the mod's own archives: the pipeline's step. A level
    with no vehicle re-declaration costs one library build and nothing else."""
    chain = em.mod_chain(game_dir, args.mod)
    code = 0
    for name, _path in em.discover_levels(chain[:1]):
        try:
            code |= run_level(game_dir, name, args, vehicles_only=True)
        except Exception as exc:  # one unreadable level costs its own variants
            print(f"  {name}: {exc}", file=sys.stderr)
            code = 1
    return code


if __name__ == "__main__":
    from optimise_mesh import run_then_optimise
    raise SystemExit(run_then_optimise(main, Path(__file__).resolve().parent / "out"))
