#!/usr/bin/env python3
"""Extract a Battlefield 1942 level as a textured glTF scene you can fly.

    python3 extract_map.py Tobruk --out ./viewer/maps
    python3 extract_map.py Tobruk --terrain-only

Terrain tiles come from the level archive (so they texture even when vanilla
`texture.rfa` is missing). Buildings, sandbags and vegetation are the same
object templates the vehicle extractor already assembles; TreeMesh plants
are included. Sibling level archives and other installed mods fill object
textures the missing vanilla `texture.rfa` would have supplied. Object
lightmaps are written next to the glb and multiplied in the viewer.
Open `viewer/map.html` through the model-viewer launch config.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR,
    build_library,
    build_pools,
    discover_level_textures,
    mod_chain,
)

from bf42 import gltf  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
from bf42.level import (  # noqa: E402
    LevelInfo,
    index_object_lightmaps,
    decode_heightmap,
    find_level_archives,
    load_level_files,
    parse_cubemap_rcm,
    parse_init_con,
    parse_spawn_templates,
    parse_static_objects,
    parse_terrain_con,
    spawn_vehicle,
)
from bf42.rfa import find_archives_dir  # noqa: E402
from bf42.terrain import apply_detail, tile_mesh, water_mesh  # noqa: E402

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, downscale, encode_png  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from extract_hud_assets import decode_tga  # noqa: E402

# Vanilla `texture.rfa` is missing on this install; these mods still carry
# afrhouse / palm / stone maps under the same basenames.
TEXTURE_GAP_MODS = ("WarFront", "FH", "bf1918", "bg42", "FinnWars")


def _mod_dirs(game_dir: Path, names: list[str]) -> list[Path]:
    mods = game_dir / "Mods"
    if not mods.is_dir():
        return []
    by_lower = {d.name.lower(): d for d in mods.iterdir() if d.is_dir()}
    out: list[Path] = []
    seen: set[str] = set()
    for name in names:
        hit = by_lower.get(name.lower())
        if hit is None or hit.name.lower() in seen:
            continue
        seen.add(hit.name.lower())
        out.append(hit)
    return out


def _vanilla_texture_rfa_present(chain: list[Path]) -> bool:
    for mod_dir in chain:
        if mod_dir.name.lower() != "bf1942":
            continue
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        for child in archives.iterdir():
            if child.is_file() and child.name.lower() == "texture.rfa":
                return True
    return False


def write_object_lightmaps(files, out_dir: Path) -> dict[tuple[str, int, int, int], str]:
    indexed = index_object_lightmaps(files)
    if not indexed:
        return {}
    dest = out_dir / "lightmaps"
    dest.mkdir(parents=True, exist_ok=True)
    mapping: dict[tuple[str, int, int, int], str] = {}
    for key, src in indexed.items():
        stem, x, y, z = key
        png_name = f"{stem}_{x}-{y}-{z}.png"
        try:
            raw = files.read(src)
            if src.lower().endswith(".dds"):
                width, height, rgba = decode_dds(raw)
            else:
                width, height, rgba = decode_tga(raw)
            (dest / png_name).write_bytes(
                encode_png(width, height, rgba, drop_alpha=True))
            mapping[key] = f"lightmaps/{png_name}"
        except Exception:
            continue
    return mapping


def _read_text(files, relative: str) -> str:
    return files.read(relative).decode("latin-1")


def load_level(game_dir: Path, mod: str, level: str) -> tuple:
    paths = find_level_archives(game_dir, mod, level)
    if not paths:
        sys.exit(f"no level archive for {mod}/{level}")
    files = load_level_files(paths, level)
    terrain_text = _read_text(files, "Init/Terrain.con")
    info = LevelInfo(name=level, terrain=parse_terrain_con(terrain_text))
    if files.find("Init.con"):
        parse_init_con(_read_text(files, "Init.con"), info)
    if files.find("Init/SkyAndSun.con"):
        parse_init_con(_read_text(files, "Init/SkyAndSun.con"), info)
    if files.find("StaticObjects.con"):
        info.static_objects = parse_static_objects(_read_text(files, "StaticObjects.con"))
    if files.find("Conquest/ObjectSpawnTemplates.con"):
        info.spawn_templates = parse_spawn_templates(
            _read_text(files, "Conquest/ObjectSpawnTemplates.con"))
    if files.find("Conquest/ObjectSpawns.con"):
        info.spawn_objects = parse_static_objects(
            _read_text(files, "Conquest/ObjectSpawns.con"))
    heightmap = decode_heightmap(
        files.read("Heightmap.raw"), info.terrain.world_size, info.terrain.y_scale,
    )
    return files, info, heightmap, paths


def _to_gltf_vec(vec: tuple[float, float, float]) -> list[float]:
    x, y, z = vec
    return [x, y, -z]


def _load_level_dds(files, stem: str):
    stem = stem.replace("\\", "/")
    leaf = stem.rsplit("/", 1)[-1]
    for candidate in (stem, f"Textures/{leaf}", leaf):
        path = candidate if candidate.lower().endswith(".dds") else candidate + ".dds"
        if files.find(path):
            return decode_dds(files.read(path))
    return None


def _place_template(assembler: Assembler, builder, name: str, inst, report,
                     seen_fail: set[str]) -> int | None:
    key = name.lower()
    if key in seen_fail:
        return None
    node = assembler.build_node(
        builder, name, report,
        position=inst.position, rotation=inst.rotation,
        world_origin=inst.position,
    )
    if node is None:
        seen_fail.add(key)
        return None
    return node


def build_scene(files, info: LevelInfo, heightmap, assembler: Assembler | None,
                 *, max_texture: int, include_objects: bool,
                 lightmaps: dict[tuple[str, int, int, int], str] | None = None,
                 ) -> tuple[bytes, dict]:
    builder = gltf.GlbBuilder(generator="bfstats bf1942 level extractor")
    roots: list[int] = []
    tiles = files.tiles()
    terrain_report = {"tiles": len(tiles), "triangles": 0, "missingTiles": [], "detail": False}

    detail = None
    if info.terrain.detail_tex:
        try:
            detail = _load_level_dds(files, info.terrain.detail_tex)
        except Exception:
            detail = None
    if detail is not None:
        terrain_report["detail"] = True

    for col, row, entry in tiles:
        primitive = tile_mesh(heightmap, info.terrain, col, row)
        if primitive is None:
            terrain_report["missingTiles"].append(f"Tx{col:02d}x{row:02d}")
            continue
        material = None
        try:
            width, height, rgba = decode_dds(files.read(entry))
            if detail is not None:
                rgba = apply_detail(rgba, width, height, detail[2], detail[0], detail[1])
            if max_texture and max(width, height) > max_texture:
                width, height, rgba = downscale(width, height, rgba, max_texture)
            tex = builder.add_image_png(
                encode_png(width, height, rgba, drop_alpha=False),
                name=f"Tx{col:02d}x{row:02d}",
            )
            material = builder.add_material(
                name=f"Tx{col:02d}x{row:02d}", texture=tex, double_sided=False)
        except Exception as exc:
            terrain_report["missingTiles"].append(f"Tx{col:02d}x{row:02d} ({exc})")
        primitive.material = material
        terrain_report["triangles"] += len(primitive.indices) // 3
        mesh = builder.add_mesh(f"Tx{col:02d}x{row:02d}", [primitive])
        roots.append(builder.add_node(gltf.Node(
            name=f"Tx{col:02d}x{row:02d}", mesh=mesh, extras={"kind": "terrain"})))

    water = water_mesh(info.terrain, [(c, r) for c, r, _ in tiles])
    if water is not None:
        r, g, b = info.water_color
        water.material = builder.add_material(
            name="water",
            base_color=(r, g, b, 0.65),
            blend=True,
            double_sided=True,
        )
        mesh = builder.add_mesh("water", [water])
        roots.append(builder.add_node(gltf.Node(
            name="water", mesh=mesh, extras={"kind": "water"})))

    object_report = {
        "placed": 0,
        "skipped": [],
        "spawners": 0,
        "parts": 0,
        "triangles": 0,
        "texturesResolved": 0,
        "texturesMissing": [],
    }
    if include_objects and assembler is not None:
        report = Report(root=info.name, configuration="complex", lod=0)
        seen_fail: set[str] = set()
        for inst in info.static_objects:
            node = _place_template(
                assembler, builder, inst.template, inst, report, seen_fail)
            if node is None:
                if inst.template not in object_report["skipped"]:
                    object_report["skipped"].append(inst.template)
                continue
            roots.append(node)
            object_report["placed"] += 1
        spawn_fail: set[str] = set()
        spawner_nodes: list[int] = []
        for inst in info.spawn_objects:
            vehicle = spawn_vehicle(inst.template, inst.team, info.spawn_templates)
            if vehicle is None:
                object_report["skipped"].append(inst.template)
                continue
            node = _place_template(
                assembler, builder, vehicle, inst, report, spawn_fail)
            if node is None:
                if vehicle not in object_report["skipped"]:
                    object_report["skipped"].append(vehicle)
                continue
            spawner_nodes.append(node)
            object_report["spawners"] += 1
        if spawner_nodes:
            roots.append(builder.add_node(gltf.Node(
                name="spawners",
                children=spawner_nodes,
                extras={"kind": "spawners"},
            )))
        object_report["parts"] = report.parts
        object_report["triangles"] = report.triangles
        object_report["texturesResolved"] = len(report.resolved_textures)
        object_report["texturesMissing"] = sorted(set(report.missing_textures))
        object_report["unresolvedTemplates"] = sorted(set(report.unresolved_templates))
        object_report["missingMeshes"] = sorted(set(report.missing_meshes))
        object_report["lightmaps"] = len(lightmaps or {})

    extras = {
        "level": info.name,
        "worldSize": info.terrain.world_size,
        "waterLevel": info.terrain.water_level,
        "fogColor": list(info.fog_color),
        "fogStart": info.fog_start,
        "fogEnd": info.fog_end,
        "sunDirection": _to_gltf_vec(info.sun_direction),
        "camera": _to_gltf_vec(info.camera) if info.camera else None,
        "combatArea": None if info.combat is None else {
            "min": _to_gltf_vec((info.combat.min_x, 0.0, info.combat.min_z)),
            "max": _to_gltf_vec((info.combat.max_x, 0.0, info.combat.max_z)),
        },
        "terrain": terrain_report,
        "objects": object_report,
        "skybox": None,
        "drawDistance": 700,
    }
    if not roots:
        raise ValueError("nothing renderable in this level")
    return builder.build(roots, extras=extras), extras


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("level", help="level folder name, e.g. Tobruk")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent / "viewer" / "maps")
    ap.add_argument("--max-texture", type=int, default=512)
    ap.add_argument("--terrain-only", action="store_true",
                    help="skip StaticObjects (faster, for judging the ground)")
    ap.add_argument("--texture-fallback", action="append", default=[],
                    help="mod folder to borrow object textures from (repeatable)")
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    files, info, heightmap, paths = load_level(game_dir, args.mod, args.level)
    print(f"level:    {info.name}  ({', '.join(p.name for p in paths)})", file=sys.stderr)
    print(f"world:    {info.terrain.world_size:g} m, yScale {info.terrain.y_scale}, "
          f"heightmap {heightmap.dim}x{heightmap.dim}", file=sys.stderr)
    print(f"tiles:    {len(files.tiles())}", file=sys.stderr)
    print(f"objects:  {len(info.static_objects)} placed, "
          f"{len(info.spawn_objects)} spawners", file=sys.stderr)

    assembler = None
    lightmaps: dict[tuple[str, int, int, int], str] = {}
    out_dir = args.out / info.name.lower()
    out_dir.mkdir(parents=True, exist_ok=True)
    if not args.terrain_only:
        chain = mod_chain(game_dir, args.mod)
        extra_names = list(args.texture_fallback)
        if not _vanilla_texture_rfa_present(chain):
            extra_names += list(TEXTURE_GAP_MODS)
        fallbacks = _mod_dirs(game_dir, extra_names)
        meshes, textures, objects, _game = build_pools(chain, fallbacks)
        textures.absorb_images(meshes)
        for level_name, level_path in discover_level_textures(chain):
            textures.add_level(level_path, label=level_name)
        for path in paths:
            textures.add_level(path, label=info.name)
        library = build_library(objects)
        lightmaps = write_object_lightmaps(files, out_dir)
        assembler = Assembler(
            meshes, textures, objects, library,
            lod=0, max_texture=args.max_texture, include_collision=False,
            lightmaps=lightmaps)

    glb, extras = build_scene(
        files, info, heightmap, assembler,
        max_texture=args.max_texture, include_objects=not args.terrain_only,
        lightmaps=lightmaps,
    )
    extras["skybox"] = write_skybox(files, out_dir)
    (out_dir / "scene.glb").write_bytes(glb)
    (out_dir / "scene.json").write_text(json.dumps(extras, indent=2))
    maps_index = args.out / "maps.json"
    listing = []
    if maps_index.is_file():
        try:
            listing = json.loads(maps_index.read_text())
        except json.JSONDecodeError:
            listing = []
    listing = [e for e in listing if e.get("name", "").lower() != info.name.lower()]
    listing.append({
        "name": info.name,
        "mod": args.mod,
        "glb": f"{info.name.lower()}/scene.glb",
        "report": f"{info.name.lower()}/scene.json",
        "worldSize": info.terrain.world_size,
        "tiles": extras["terrain"]["tiles"],
        "objects": extras["objects"]["placed"],
    })
    listing.sort(key=lambda e: e["name"].lower())
    maps_index.write_text(json.dumps(listing, indent=2))

    obj = extras["objects"]
    print(f"  terrain {extras['terrain']['triangles']} tris, "
          f"{len(files.tiles())} tiles"
          f"{' + detail' if extras['terrain'].get('detail') else ''}; "
          f"objects {obj['placed']} placed ({obj.get('spawners', 0)} spawners), "
          f"{obj.get('lightmaps', 0)} lightmaps, "
          f"{len(obj['skipped'])} skipped, "
          f"{len(obj.get('texturesMissing') or [])} tex missing; "
          f"{len(glb) // 1024} KB -> {out_dir / 'scene.glb'}", file=sys.stderr)
    return 0


def write_skybox(files, out_dir: Path) -> list[str] | None:
    seen: set[str] = set()
    mapping = None
    for name in files.names():
        key = name.lower()
        if not key.endswith(".rcm") or key in seen:
            continue
        seen.add(key)
        mapping = parse_cubemap_rcm(files.read(name).decode("latin-1"))
        if len(mapping) == 6:
            break
        mapping = None
    if not mapping:
        return None
    sky_dir = out_dir / "sky"
    sky_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for face in ("px", "nx", "py", "ny", "pz", "nz"):
        path = mapping.get(face)
        if not path or not files.find(path):
            return None
        width, height, rgba = decode_dds(files.read(path))
        (sky_dir / f"{face}.png").write_bytes(
            encode_png(width, height, rgba, drop_alpha=True))
        written.append(f"sky/{face}.png")
    return written


if __name__ == "__main__":
    raise SystemExit(main())
