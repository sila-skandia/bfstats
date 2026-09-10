#!/usr/bin/env python3
"""Extract Battlefield 1942 vehicles as textured glTF, straight from the .rfa archives.

    python3 extract_models.py --list
    python3 extract_models.py Sherman Willy --out ./out

Each vehicle comes out as a single `.glb` — the whole template tree, every sub-part
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

MESH_ARCHIVES = ("standardmesh", "treemesh")
TEXTURE_ARCHIVES = ("texture",)
OBJECT_ARCHIVES = ("objects",)

# Where `objects.rfa` files a template tells you what the thing is.
CATEGORY_PREFIXES = {
    "objects/vehicles/land/": "land",
    "objects/vehicles/air/": "air",
    "objects/vehicles/sea/": "sea",
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


def catalogue(objects: ArchivePool, library: con_mod.ObjectLibrary) -> list[tuple[str, str, str]]:
    """Every template declared in a folder that identifies it as a real vehicle."""
    out: list[tuple[str, str, str]] = []
    for template in library.objects.values():
        source = template.source.lower()
        category = next((v for k, v in CATEGORY_PREFIXES.items() if source.startswith(k)), None)
        if category is None:
            continue
        # The vehicle a player spawns is the one named after its own folder.
        folder = template.source.split("/")[3] if template.source.count("/") >= 3 else ""
        if folder and template.name.lower() == folder.lower():
            out.append((template.name, category, template.source))
    return sorted(out, key=lambda r: (r[1], r[0].lower()))


def export_one(name: str, meshes: ArchivePool, textures: ArchivePool,
               objects: ArchivePool, library: con_mod.ObjectLibrary, *,
               lod: int, max_texture: int, out: Path,
               suffix: str = "", level_label: str | None = None,
               ) -> dict | None:
    """Export a single vehicle variant, returning a manifest fragment or None."""
    assembler = Assembler(meshes, textures, objects, library,
                          lod=lod, max_texture=max_texture)
    try:
        glb, report = assembler.export(name)
    except ValueError as exc:
        print(f"  {name}{suffix}: {exc}", file=sys.stderr)
        return None

    file_stem = f"{name}{suffix}"
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
    ap.add_argument("--lod", type=int, default=0, help="LOD index to export (0 = highest detail)")
    ap.add_argument("--max-texture", type=int, default=1024, help="downscale textures above this, 0 to keep")
    ap.add_argument("--texture-fallback", action="append", default=[],
                    help="mod folder to borrow textures from when the chain lacks them "
                         "(repeatable; only fills gaps)")
    ap.add_argument("--level", action="append", default=[],
                    help="level archive to use as a texture source (repeatable); "
                         "each produces a separate .glb variant with that level's theatre skins")
    ap.add_argument("--level-all", action="store_true",
                    help="auto-discover and include all level archives that carry vehicle textures")
    ap.add_argument("--list", action="store_true", help="list extractable vehicle templates and exit")
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

    args.out.mkdir(parents=True, exist_ok=True)
    failures = 0
    manifest: list[dict] = []

    for name in args.templates:
        variants: list[dict] = []

        # --- base variant (mod-chain textures only, no level archive) -------
        base = export_one(name, meshes, base_textures, objects, library,
                          lod=args.lod, max_texture=args.max_texture, out=args.out)
        if base is None:
            failures += 1
            continue
        variants.append(base)

        # --- one variant per level that carries textures --------------------
        for level_name, level_path in level_sources:
            level_textures = ArchivePool()
            # Level textures take priority — add them first.
            try:
                added = level_textures.add_level(level_path, label=level_name)
            except Exception as exc:
                print(f"  {name}.{level_name}: cannot read level archive ({exc})",
                      file=sys.stderr)
                continue
            if not added:
                continue
            # Then fall back to the base mod-chain textures.
            for label, archive in base_textures.archives:
                level_textures._archives.append((label, archive))
                for entry_name in archive.entries:
                    key = entry_name.lower()
                    if key not in level_textures._index:
                        level_textures._index[key] = (label, archive, entry_name)

            variant = export_one(
                name, meshes, level_textures, objects, library,
                lod=args.lod, max_texture=args.max_texture, out=args.out,
                suffix=f".{level_name}", level_label=level_name,
            )
            if variant:
                variants.append(variant)

        # Pick the best variant as the default (fewest missing textures).
        best = min(variants, key=lambda v: len(v["texturesMissing"]))
        manifest.append({
            "name": name,
            "mod": args.mod,
            "glb": best["glb"],
            "report": best["report"],
            "parts": 0,       # filled from report by viewer
            "triangles": 0,
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

