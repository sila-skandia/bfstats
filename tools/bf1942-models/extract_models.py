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
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod
from bf42.assemble import Assembler
from bf42.rfa import ArchivePool, find_archives_dir

DEFAULT_GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"

MESH_ARCHIVES = ("standardmesh", "treemesh", "animations")
TEXTURE_ARCHIVES = ("texture",)
OBJECT_ARCHIVES = ("objects",)

# Where `objects.rfa` files a template tells you what the thing is.
CATEGORY_PREFIXES = {
    "objects/vehicles/land/": "land",
    "objects/vehicles/air/": "air",
    "objects/vehicles/sea/": "sea",
    "objects/soldiers/": "soldier",
    "objects/stationary_weapons/": "emplacement",
    "objects/handweapons/": "handweapon",
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


def build_pools(chain: list[Path], extra_texture_mods: list[Path]) -> tuple[ArchivePool, ArchivePool, ArchivePool]:
    meshes, textures, objects = ArchivePool(), ArchivePool(), ArchivePool()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        meshes.add_dir(archives, MESH_ARCHIVES)
        textures.add_dir(archives, TEXTURE_ARCHIVES)
        objects.add_dir(archives, OBJECT_ARCHIVES)
    # Appended last so they only ever fill gaps the real chain left.
    for mod_dir in extra_texture_mods:
        archives = find_archives_dir(mod_dir)
        if archives is not None:
            textures.add_dir(archives, TEXTURE_ARCHIVES)
    return meshes, textures, objects


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
        levels_dir = archives / mod_dir.name / "levels"
        if not levels_dir.is_dir():
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
                and parts[3].lower() in ("alttextures", "texture")
                and not any(p.lower() in ("menu", "objectlightmaps") for p in parts)
                for e in rfa.entries
            )
            if has_tex:
                results.append((stem, child))
    return results


def build_library(objects: ArchivePool) -> con_mod.ObjectLibrary:
    library = con_mod.ObjectLibrary()
    for name in objects.names():
        if name.lower().endswith(".con"):
            library.add_con(name, objects.read(name).decode("latin-1"))
    return library


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
    """Every template declared in a folder that identifies it as a spawnable object."""
    out: list[tuple[str, str, str]] = []
    for template in library.objects.values():
        source = template.source.lower()
        category = next((v for k, v in CATEGORY_PREFIXES.items() if source.startswith(k)), None)
        if category is None:
            continue
        if category == "soldier" and template.kind.lower() != "bfsoldier":
            continue
        folder = spawn_folder(template.source)
        if folder and template.name.lower() == folder.lower():
            out.append((template.name, category, template.source))
    return sorted(out, key=lambda r: (r[1], r[0].lower()))


def template_category(library: con_mod.ObjectLibrary, name: str) -> str:
    template = library.object(name)
    if template is None:
        return "object"
    source = template.source.lower()
    return next((v for k, v in CATEGORY_PREFIXES.items() if source.startswith(k)), "object")


def variant_suffix(configuration: str, lod: int, level_label: str | None) -> str:
    tokens: list[str] = []
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
               ) -> dict | None:
    """Export a single vehicle variant, returning a manifest fragment or None."""
    assembler = Assembler(meshes, textures, objects, library,
                          lod=lod, max_texture=max_texture,
                          configuration=configuration)
    suffix = variant_suffix(configuration, lod, level_label)
    file_stem = f"{name}{suffix}"
    try:
        glb, report = assembler.export(name)
    except ValueError as exc:
        print(f"  {name}{suffix}: {exc}", file=sys.stderr)
        return None

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
        "parts": report.parts,
        "triangles": report.triangles,
        "texturesResolved": len(report.resolved_textures),
        "texturesMissing": sorted(set(report.missing_textures)),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("templates", nargs="*", help="object template names, e.g. Sherman Willy")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "out")
    ap.add_argument("--lod", type=int, default=0,
                    help="mesh LOD index to export (default: 0)")
    ap.add_argument("--configuration", dest="configurations", action="append",
                    choices=con_mod.MODEL_CONFIGURATIONS,
                    help="vehicle alternative to export; repeatable (default: complex)")
    ap.add_argument("--configuration-all", action="store_true",
                    help="export both Complex and Wreck alternatives when available")
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
    meshes, base_textures, objects = build_pools(chain, fallbacks)
    library = build_library(objects)

    # -- level archives with vehicle textures --------------------------------
    if args.level_all:
        level_sources = discover_level_textures(chain)
    else:
        levels_dir = None
        for mod_dir in chain:
            archives = find_archives_dir(mod_dir)
            if archives and (archives / mod_dir.name / "levels").is_dir():
                levels_dir = archives / mod_dir.name / "levels"
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
    if level_sources:
        print(f"levels:     {', '.join(n for n, _ in level_sources)}", file=sys.stderr)
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
    failures = 0
    manifest: list[dict] = []

    for name in args.templates:
        variants: list[dict] = []
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

        for configuration in configurations:
            base = export_one(
                name, meshes, base_textures, objects, library,
                configuration=configuration, lod=args.lod,
                max_texture=args.max_texture, out=args.out,
            )
            if base is None:
                failures += 1
                continue
            variants.append(base)

            for level_name, level_path in level_sources:
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
                    configuration=configuration, lod=args.lod,
                    max_texture=args.max_texture, out=args.out,
                    level_label=level_name,
                )
                if variant:
                    variants.append(variant)

        if not variants:
            failures += 1
            continue

        default_variants = [
            variant for variant in variants
            if variant["configuration"] == "complex"
        ] or variants
        best = min(default_variants, key=lambda v: len(v["texturesMissing"]))
        manifest.append({
            "name": name,
            "mod": args.mod,
            "category": template_category(library, name),
            "glb": best["glb"],
            "report": best["report"],
            "configuration": best["configuration"],
            "lod": best["lod"],
            "level": best["level"],
            "parts": best["parts"],
            "triangles": best["triangles"],
            "texturesResolved": best["texturesResolved"],
            "texturesMissing": best["texturesMissing"],
            "textureFallbacks": args.texture_fallback,
            "variants": variants,
        })

    # The viewer reads this to populate its model list.
    (args.out / "models.json").write_text(json.dumps(manifest, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

