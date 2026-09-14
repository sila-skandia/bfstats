#!/usr/bin/env python3
"""Extract a Battlefield 1942 level as a textured glTF scene you can fly.

    python3 extract_map.py Tobruk --out ./viewer/maps
    python3 extract_map.py Tobruk --terrain-only

Terrain tiles come from the level archive; patches without a shipped tile are
painted with the level's `terrainDefault.dds` the way the engine paints them.
Buildings, sandbags and vegetation are the same object templates the vehicle
extractor already assembles; TreeMesh plants are included. Object lightmaps
are written next to the glb and multiplied in the viewer.

The sky is the real thing: the `SkyBox` StandardMesh named in
`Init/SkyAndSun.con` with its six 512px faces from `texture.rfa`, rotated by
`Sky.setRotAngle`, plus the scrolling cloud layer's texture and parameters.
Water exports its two scrolling layers, normal map, and a depth map derived
from the heightmap so the viewer can reproduce the engine's shore-alpha and
deep-colour ramps. `textureManager.alternativePath` (Texture/Africa on the
desert maps) is honoured, which is what turns spawned vehicles desert-yellow.
Open `viewer/map.html` through the model-viewer launch config.
"""

from __future__ import annotations

import argparse
import json
import re
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

from bf42 import gltf, stdmesh  # noqa: E402
from bf42 import rs as rs_mod  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
from bf42.level import (  # noqa: E402
    LevelFiles,
    LevelInfo,
    index_object_lightmaps,
    decode_heightmap,
    discover_level_sounds,
    find_level_archives,
    load_level_files,
    parse_cubemap_rcm,
    parse_init_con,
    parse_sound_scripts,
    parse_spawn_templates,
    parse_ssc,
    parse_static_objects,
    parse_terrain_con,
    resolve_ssc_path,
    spawn_vehicle,
)
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402
from bf42.terrain import (  # noqa: E402
    DETAIL_REPEATS,
    default_patches,
    depth_map,
    patch_mesh,
    sky_primitives,
    tile_mesh,
    water_mesh,
)

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, downscale, encode_png  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from extract_hud_assets import decode_tga  # noqa: E402

# Only consulted when vanilla `texture.rfa` is genuinely absent (an interrupted
# DataField42 sync once removed it — see the README). With the real archive on
# disk these mods are never registered: a Forgotten Hope palm under a vanilla
# basename is itself a parity bug.
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


def load_level(game_dir: Path, mod: str, level: str,
               chain: list[Path] | None = None) -> tuple:
    paths = find_level_archives(game_dir, mod, level, chain=chain)
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
    info.sounds = discover_level_sounds(files, info.static_objects)
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


SOUND_ARCHIVES = ("sound", "sound_001")


# `@RTD` is the sample-rate directory the engine substitutes for the current
# sound-quality setting. Ambient beds are heard from hundreds of metres away and
# 22 kHz is indistinguishable there, but a cockpit engine layer is heard from
# four metres, so vehicle sound asks for the 44 kHz masters first.
AMBIENT_RATES = ("22khz", "44khz", "11khz")
VEHICLE_RATES = ("44khz", "22khz", "11khz")


def resolve_sound(ref: str, level_files: LevelFiles | None,
                  sounds: ArchivePool,
                  rates: tuple[str, ...] = AMBIENT_RATES) -> tuple[str, bytes] | None:
    clean = ref.replace("\\", "/").strip()
    if clean.lower().startswith("@root/"):
        clean = clean[6:]
    clean = clean.lstrip("/")
    basename = Path(clean).name

    # 1. Check level_files if available
    if level_files is not None:
        for candidate in [clean, f"Sound/{basename}", f"Sounds/{basename}",
                          *(f"Sound/{r}/{basename}" for r in rates)]:
            hit = level_files.find(candidate)
            if hit is not None:
                return basename, level_files.read(candidate)

    # 2. Check sounds pool
    if "@rtd" in clean.lower():
        for r in rates:
            sub = re.sub(r"@rtd", r, clean, flags=re.IGNORECASE)
            if sub in sounds:
                return basename, sounds.read(sub)
    else:
        if clean in sounds:
            return basename, sounds.read(clean)
        for r in rates:
            candidate = f"Sound/{r}/{basename}"
            if candidate in sounds:
                return basename, sounds.read(candidate)
    return None


# The sound-detail tier to extract for vehicles. HIGH is what the game plays on
# a desktop: the three-band RPM core, the start and stop one-shots, the mid- and
# far-distance timbre layers, the dive scream, and the two cockpit whine voices.
# Note the trap the research doc records — `#templateLevel HIGH/MEDIUM/LOW` is
# the Options -> Sound quality setting, NOT an RPM band. All three tiers carry
# the same three-band crossfade; the tier only decides how many layers ride on
# top of it (LOW 3 voices, MEDIUM 9, HIGH 11).
VEHICLE_SOUND_LEVEL = "high"


def find_engine_script(library, objects: ArchivePool,
                       template: str) -> tuple[str, str] | None:
    """The `.ssc` bound to a vehicle's Engine: `(archive path, engine name)`.

    Two hops, because `loadSoundScript` binds to a *template*, not to a vehicle:
    walk the vehicle's template tree for its `Engine` child, then read the
    `.con` that declared that child and take the script bound to it by name. A
    Corsair's `Physics.con` binds four different scripts to four different
    children (engine, two wing creaks, landing gear); matching on the engine's
    own name is what picks the right one.
    """
    root = library.objects.get(template.lower())
    if root is None:
        return None
    seen: set[str] = set()
    queue = [root]
    engine = None
    while queue:
        node = queue.pop(0)
        key = node.name.lower()
        if key in seen:
            continue
        seen.add(key)
        if node.kind.lower() == "engine":
            engine = node
            break
        for ref in node.children:
            child = library.objects.get(ref.template.lower())
            if child is not None:
                queue.append(child)
    if engine is None or not engine.source:
        return None
    con_hit = objects.find(engine.source)
    if con_hit is None:
        return None
    scripts = parse_sound_scripts(objects.read(con_hit).decode("latin-1"))
    entry = scripts.get(engine.name.lower())
    if entry is None:
        return None
    return resolve_ssc_path(engine.source, entry[1]), engine.name


def find_weapon_scripts(library, objects: ArchivePool,
                        template: str) -> list[tuple[str, str, str]]:
    """Every `.ssc` bound to a FireArms under a vehicle.

    The same two hops `find_engine_script` makes, with two differences. A
    vehicle has one Engine but several guns — a Corsair carries `CorsairGuns`
    and `CorsairBombDummy` — so the walk collects rather than stops at the
    first hit. And the script is bound to the FireArms template itself
    (`Weapons.con` puts `loadSoundScript Sounds/CorsairMG.ssc` directly on
    `CorsairGuns`), not to a child of it.

    Returns `(fire arms name, archive path, script path)` per gun that has one;
    a bomb rack has no sound script and simply does not appear.
    """
    root = library.objects.get(template.lower())
    if root is None:
        return []
    seen: set[str] = set()
    queue = [root]
    found: list[tuple[str, str, str]] = []
    while queue:
        node = queue.pop(0)
        key = node.name.lower()
        if key in seen:
            continue
        seen.add(key)
        if node.kind.lower() == "firearms" and node.source:
            con_hit = objects.find(node.source)
            if con_hit is not None:
                scripts = parse_sound_scripts(
                    objects.read(con_hit).decode("latin-1"))
                entry = scripts.get(node.name.lower())
                if entry is not None:
                    found.append((node.name, node.source,
                                  resolve_ssc_path(node.source, entry[1])))
        for ref in node.children:
            child = library.objects.get(ref.template.lower())
            if child is not None:
                queue.append(child)
    return found


# `silence.wav` is how a gun script says "this patch is not used". Every vanilla
# weapon script declares the full six-patch set — Fire, Reload, Release, Shell
# Bounce, MG distance, Fire Loop — and an MG fills only the last of them, so a
# patch is "real" exactly when something other than silence survives.
_SILENCE = "silence.wav"


def _firing_patch(patches):
    """The patch a held trigger plays: the first with a non-silence sample.

    For a machine gun that is the Fire Loop, five silent patches down. For a
    single-shot weapon whose Fire patch carries the report it is the first,
    which is the same rule reaching the other answer rather than a special
    case.
    """
    for patch in patches:
        samples = [s for s in patch.samples
                   if not s.file.replace("\\", "/").lower().endswith(_SILENCE)]
        if samples:
            return samples
    return []


def _modulator_report(effect) -> dict:
    # `Extern #map<Engine::Rpm>` is flattened to a plain source name: the viewer
    # only ever needs to know which control channel to feed the curve, and the
    # two vanilla maps (Engine, Effect) have no overlapping channel names.
    source = effect.extern.lower() if effect.source == "extern" else effect.source
    return {
        "dest": effect.destination,
        "source": source,
        "envelope": effect.envelope,
        "params": effect.params,
    }


def extract_sounds(info: LevelInfo, level_files: LevelFiles,
                   sounds: ArchivePool, out_dir: Path,
                   library=None, objects: ArchivePool | None = None,
                   vehicles: list[str] | None = None) -> dict:
    """Extract referenced sound wav files and produce the sounds report dict."""
    sounds_dir = out_dir / "sounds"
    sound_report: dict = {"ambient": None, "areas": [], "vehicles": []}
    written_files: set[str] = set()

    def write(resolved: tuple[str, bytes]) -> str:
        basename, data = resolved
        if basename not in written_files:
            sounds_dir.mkdir(parents=True, exist_ok=True)
            (sounds_dir / basename).write_bytes(data)
            written_files.add(basename)
        return f"sounds/{basename}"

    if info.sounds.ambient is not None:
        resolved = resolve_sound(info.sounds.ambient.file, level_files, sounds)
        if resolved is not None:
            sound_report["ambient"] = {
                "file": write(resolved),
                "volume": info.sounds.ambient.volume,
            }

    for area in info.sounds.areas:
        resolved = resolve_sound(area.file, level_files, sounds)
        if resolved is not None:
            sound_report["areas"].append({
                "name": area.name,
                "file": write(resolved),
                "volume": area.volume,
                "nearDistance": area.near_distance,
                "farDistance": area.far_distance,
                "points": area.points,
            })

    if library is not None and objects is not None and vehicles:
        sound_report["vehicles"] = extract_vehicle_sounds(
            library, objects, sounds, vehicles, write)

    return sound_report


def extract_vehicle_sounds(library, objects: ArchivePool, sounds: ArchivePool,
                           vehicles: list[str], write) -> list[dict]:
    """Per-vehicle engine sound: the layered patch, and its wavs on disk.

    What ships is the parsed script rather than a baked recipe. Every layer
    keeps its own modulator list, so the viewer evaluates the same curves the
    engine does and a Zero or a Spitfire needs no new code — only its own
    `.ssc`. The one interpretation baked in here is the coordinate flip on
    `relativePosition`, which is the exporter's own Z mirror, so the viewer
    never has to know Refractor is left-handed.
    """
    def read_script(path: str) -> str | None:
        hit = objects.find(path)
        return objects.read(hit).decode("latin-1") if hit else None

    out: list[dict] = []
    for template in vehicles:
        found = find_engine_script(library, objects, template)
        if found is None:
            continue
        script_path, engine_name = found
        text = read_script(script_path)
        if text is None:
            continue
        patches = parse_ssc(text, level=VEHICLE_SOUND_LEVEL,
                            include=read_script, source=script_path)
        # An Engine is a single-patch object: triggered while it runs, released
        # when it stops. Anything past the first patch is not engine sound.
        samples = patches[0].samples if patches else []
        layers = _sound_layers(samples, sounds, write)
        if not layers:
            continue
        entry = {
            "template": template,
            "engine": engine_name,
            "script": script_path,
            "level": VEHICLE_SOUND_LEVEL,
            "layers": layers,
        }
        # The guns ride along with the vehicle that carries them: one lookup in
        # the viewer, and a weapon patch can never outlive the engine it was
        # found next to.
        weapons: list[dict] = []
        for arms_name, _, arms_script in find_weapon_scripts(
                library, objects, template):
            arms_text = read_script(arms_script)
            if arms_text is None:
                continue
            arms_layers = _sound_layers(
                _firing_patch(parse_ssc(arms_text, level=VEHICLE_SOUND_LEVEL,
                                        include=read_script,
                                        source=arms_script)),
                sounds, write)
            if not arms_layers:
                continue
            weapons.append({
                "fireArms": arms_name,
                "script": arms_script,
                "layers": arms_layers,
            })
        if weapons:
            entry["weapons"] = weapons
        out.append(entry)
    return out


def _sound_layers(samples, sounds: ArchivePool, write) -> list[dict]:
    """One `.ssc` patch's samples as the viewer's layer dicts, wavs written.

    Shared by the engine and the guns because a layer is a layer: the viewer
    evaluates whatever modulators come with it, so nothing here needs to know
    which one it is looking at.
    """
    layers: list[dict] = []
    for sample in samples:
        resolved = resolve_sound(sample.file, None, sounds, VEHICLE_RATES)
        if resolved is None:
            continue
        layers.append({
            "file": write(resolved),
            "loop": sample.loop,
            "volume": sample.volume,
            "minDistance": sample.min_distance,
            "priority": sample.priority,
            "trigger": sample.trigger or None,
            "stop": sample.stop or None,
            "stereo": sample.stereo,
            "doppler": not sample.doppler_off,
            "randomStartPitch": (list(sample.random_start_pitch)
                                 if sample.random_start_pitch else None),
            "relativePosition": (_to_gltf_vec(sample.relative_position)
                                 if sample.relative_position else None),
            "modulators": [_modulator_report(e) for e in sample.effects],
        })
    return layers


def _load_level_dds(files, stem: str):
    stem = stem.replace("\\", "/")
    leaf = stem.rsplit("/", 1)[-1]
    for candidate in (stem, f"Textures/{leaf}", leaf):
        path = candidate if candidate.lower().endswith(".dds") else candidate + ".dds"
        if files.find(path):
            return decode_dds(files.read(path))
    return None


def _decode_pool_image(textures, stem: str):
    """Decode `texture/X` from the pool, probing `.dds` then `.tga`."""
    resolved = textures.resolve_ext(stem, (".dds", ".tga"))
    if resolved is None:
        return None
    raw = textures.read(resolved)
    if resolved.lower().endswith(".tga"):
        return decode_tga(raw)
    return decode_dds(raw)


def prepare_sky(info: LevelInfo, meshes, textures):
    """The engine's sky box as `(material, primitive, image)` triples.

    `Init/SkyAndSun.con` names the mesh; its `.rs` maps each one-quad material
    to a `texture/Sky_<level>_NN` face. Faces are kept at native size (512px)
    regardless of `--max-texture` — the sky is the single most visible texture
    in the scene and the terrain budget does not apply to six images.
    """
    if not info.sky.mesh:
        return None
    stem = f"standardmesh/{info.sky.mesh}"
    sm_name = meshes.find(f"{stem}.sm")
    if sm_name is None:
        return None
    mesh = stdmesh.parse(meshes.read(sm_name), name=sm_name)
    shaders = {}
    rs_name = meshes.find(f"{stem}.rs")
    if rs_name:
        shaders = rs_mod.parse(meshes.read(rs_name).decode("latin-1"))
    faces = []
    for material_name, primitive in sky_primitives(mesh, info.sky.rot_angle):
        image = None
        shader = rs_mod.lookup(shaders, material_name)
        if shader and shader.base_texture:
            try:
                image = _decode_pool_image(textures, shader.base_texture)
            except Exception:
                image = None
        faces.append((material_name, primitive, image))
    if not any(image for _, _, image in faces):
        return None
    return faces


def write_cloud_assets(info: LevelInfo, meshes, textures, out_dir: Path) -> dict | None:
    """The scrolling cloud layer's texture and parameters, or None.

    `Sky.addCloud` alone is not enough: the layer draws the cloud geometry
    template, and vanilla REMs that template out on every map (and ships no
    cloud mesh at all), so the engine never renders clouds there — the clouds
    visible in-game are painted into the Sky_*_m1 faces. Only levels with an
    active cloud GeometryTemplate (mods) get the layer, and the texture comes
    from that mesh's own .rs material rather than a guessed name.
    """
    if not (info.sky.has_cloud and info.sky.cloud_mesh):
        return None
    texture_stem = info.sky.cloud_texture
    rs_name = meshes.find(f"standardmesh/{info.sky.cloud_mesh}.rs")
    if rs_name:
        try:
            shaders = rs_mod.parse(meshes.read(rs_name).decode("latin-1"))
            for shader in shaders.values():
                if shader.base_texture:
                    texture_stem = shader.base_texture
                    break
        except Exception:
            pass
    try:
        image = _decode_pool_image(textures, texture_stem)
    except Exception:
        image = None
    if image is None:
        return None
    width, height, rgba = image
    dest = out_dir / "sky"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "cloud.png").write_bytes(encode_png(width, height, rgba, drop_alpha=False))
    return {
        "texture": "sky/cloud.png",
        "speed": list(info.sky.cloud_speed),
        "texScale": info.sky.cloud_tex_scale,
        "height": info.sky.cloud_height,
        "ofsHeight": info.sky.cloud_ofs_height,
        "dist": info.sky.cloud_dist,
    }


def write_water_assets(info: LevelInfo, heightmap, textures, out_dir: Path,
                       max_texture: int) -> dict | None:
    """The engine water's inputs: scroll layers, normal map, depth ramp.

    The depth map is the heightmap re-expressed as metres of water above each
    sample, normalised to its own maximum — the viewer multiplies back by
    `maxDepth`. It covers world 0..worldSize on both axes so the shader can
    sample it straight from world position.
    """
    w = info.water
    depth = depth_map(heightmap, info.terrain.water_level)
    if not w.declared and depth is None:
        return None
    dest = out_dir / "water"
    dest.mkdir(parents=True, exist_ok=True)
    written: dict[str, str] = {}
    for key, stem in (("layer1", w.tex_layer1), ("layer2", w.tex_layer2),
                      ("normal", w.normal_map)):
        if not stem:
            continue
        try:
            image = _decode_pool_image(textures, stem)
        except Exception:
            image = None
        if image is None:
            continue
        width, height, rgba = image
        (dest / f"{key}.png").write_bytes(encode_png(width, height, rgba, drop_alpha=True))
        written[key] = f"water/{key}.png"
    max_depth = 0.0
    if depth is not None:
        dim, rgba, max_depth = depth
        if max_texture and dim > max_texture:
            dim2, _, rgba = downscale(dim, dim, rgba, max_texture)
            dim = dim2
        (dest / "depth.png").write_bytes(encode_png(dim, dim, rgba, drop_alpha=True))
        written["depth"] = "water/depth.png"
    base = w.color or w.shallow_color or info.water_color
    return {
        "level": info.terrain.water_level,
        "color": list(base),
        "deepColor": list(w.deep_color or base),
        "shallowColor": list(w.shallow_color or base),
        "shallowAlpha": w.shallow_alpha,
        "alphaDepth": w.alpha_depth,
        "colorDepth": w.color_depth,
        "scrollDir1": list(w.scroll_dir1),
        "scrollDir2": list(w.scroll_dir2),
        "scrollDirNormal": list(w.scroll_dir_normal),
        "scroll1": w.scroll1,
        "scroll2": w.scroll2,
        "scrollNormal": w.scroll_normal,
        "tile1": w.tile1,
        "tile2": w.tile2,
        "tileNormal": w.tile_normal,
        "specular": w.specular,
        "specularColor": list(w.specular_color),
        "streakFactor": w.streak_factor,
        "lightDirection": _to_gltf_vec(w.light_direction),
        "maxDepth": max_depth,
        "worldSize": info.terrain.world_size,
        "textures": written,
    }


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
                 out_dir: Path | None = None,
                 lightmaps: dict[tuple[str, int, int, int], str] | None = None,
                 sky_faces: list | None = None,
                 ) -> tuple[bytes, dict]:
    builder = gltf.GlbBuilder(generator="bfstats bf1942 level extractor")
    roots: list[int] = []
    tiles = files.tiles()
    terrain_report = {"tiles": len(tiles), "triangles": 0, "missingTiles": [],
                      "detail": False, "defaultTiles": 0}

    detail = None
    if info.terrain.detail_tex:
        try:
            detail = _load_level_dds(files, info.terrain.detail_tex)
        except Exception:
            detail = None
    # The detail pass is a *stage*, not something to bake into the colour map.
    # Baking caps the grain at the tile map's own resolution: a 256 m patch at
    # 1024px is 4 texels/m, and --max-texture 512 halves that again, against the
    # 32 texels/m the engine gets by tiling a 512px detail map 16 times across
    # the same patch. That 16x is the entire "our sand is blurry" gap, and it is
    # a dropped shader stage rather than anything the browser cannot do -- an
    # extra texture stage measures 0.3-0.5 ms against a 16.7 ms budget. The
    # image ships alongside the tiles and `map.html` multiplies it in at its own
    # frequency.
    if detail is not None:
        terrain_report["detail"] = True
        if out_dir is not None:
            dwidth, dheight, drgba = detail
            detail_dir = out_dir / "terrain"
            detail_dir.mkdir(parents=True, exist_ok=True)
            (detail_dir / "detail.png").write_bytes(
                encode_png(dwidth, dheight, drgba, drop_alpha=True))
            # Repeats across one patch, so the viewer needs no world scale.
            terrain_report["detailTexture"] = "terrain/detail.png"
            terrain_report["detailRepeats"] = DETAIL_REPEATS

    for col, row, entry in tiles:
        primitive = tile_mesh(heightmap, info.terrain, col, row)
        if primitive is None:
            terrain_report["missingTiles"].append(f"Tx{col:02d}x{row:02d}")
            continue
        material = None
        try:
            width, height, rgba = decode_dds(files.read(entry))
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

    # Patches with no shipped tile are sea floor and out-of-area ground the
    # engine paints with the level's default texture, not holes.
    default_image = None
    try:
        default_image = _load_level_dds(files, "terrainDefault")
    except Exception:
        default_image = None
    if default_image is not None:
        width, height, rgba = default_image
        tex = builder.add_image_png(
            encode_png(width, height, rgba, drop_alpha=False), name="terrainDefault")
        default_material = builder.add_material(
            name="terrainDefault", texture=tex, double_sided=False)
        for col, row in default_patches(info.terrain, [(c, r) for c, r, _ in tiles]):
            primitive = patch_mesh(heightmap, col, row)
            if primitive is None:
                continue
            primitive.material = default_material
            terrain_report["triangles"] += len(primitive.indices) // 3
            terrain_report["defaultTiles"] += 1
            mesh = builder.add_mesh(f"Fill{col:02d}x{row:02d}", [primitive])
            roots.append(builder.add_node(gltf.Node(
                name=f"Fill{col:02d}x{row:02d}", mesh=mesh,
                extras={"kind": "terrain"})))

    if sky_faces:
        prims = []
        half = 0.0
        for material_name, primitive, image in sky_faces:
            material = None
            if image is not None:
                width, height, rgba = image
                tex = builder.add_image_png(
                    encode_png(width, height, rgba, drop_alpha=True),
                    name=material_name)
                material = builder.add_material(
                    name=material_name, texture=tex, double_sided=True)
            primitive.material = material
            prims.append(primitive)
            half = max(half, *(abs(c) for p in primitive.positions for c in p))
        mesh = builder.add_mesh("sky", prims)
        roots.append(builder.add_node(gltf.Node(
            name="sky", mesh=mesh,
            extras={"kind": "sky", "halfExtent": half,
                    "heightOffset": info.sky.height_offset})))

    # The engine's water covers the world grid, not just textured patches —
    # Wake's lagoon and outer sea are mostly over default-tile sea floor.
    water = water_mesh(
        info.terrain, [(c, r) for c, r, _ in tiles],
        bounds=(0.0, 0.0, info.terrain.world_size, info.terrain.world_size))
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

    lighting = {}
    if info.lighting.ambient_color:
        lighting["ambient"] = list(info.lighting.ambient_color)
    if info.lighting.diffuse_color:
        lighting["diffuse"] = list(info.lighting.diffuse_color)
    if info.lighting.global_ambient:
        lighting["globalAmbient"] = list(info.lighting.global_ambient)
    if info.lighting.shadow_color is not None:
        lighting["shadowColor"] = info.lighting.shadow_color

    # The engine's draw distance is `Game.setViewDistance` (declared by every
    # vanilla level; the video slider scales it). `renderer.setViewdistance`
    # is a raw renderer poke only Tobruk carries — and the game overrides it
    # there (Game VD 300 vs the stray 700; the in-game haze wall sits at 300).
    view_distance = info.game_view_distance or info.view_distance or 700.0
    # A level with no declared fogLinearStart/End still fogs in-game: the
    # engine hazes to the view distance (all levels set vertexFogEnable 1 and
    # DICE paints fogColorVec into the sky's below-horizon band to meet it).
    # Derive an undeclared range from the view distance; the 0.5 start
    # fraction is DICE's own habit in the five levels that do declare one
    # (Tobruk 0.50, Kasserine 0.50, Stalingrad 0.56, Gazala 0.59, Kharkov 0.60).
    fog_end = info.fog_end if info.fog_end is not None else view_distance
    fog_start = info.fog_start if info.fog_start is not None else view_distance * 0.5
    extras = {
        "level": info.name,
        "worldSize": info.terrain.world_size,
        "waterLevel": info.terrain.water_level,
        "fogColor": list(info.fog_color),
        "fogStart": fog_start,
        "fogEnd": fog_end,
        "sunDirection": _to_gltf_vec(info.sun_direction),
        "camera": _to_gltf_vec(info.camera) if info.camera else None,
        "combatArea": None if info.combat is None else {
            "min": _to_gltf_vec((info.combat.min_x, 0.0, info.combat.min_z)),
            "max": _to_gltf_vec((info.combat.max_x, 0.0, info.combat.max_z)),
        },
        "terrain": terrain_report,
        "objects": object_report,
        "skybox": None,
        "sky": None,
        "water": None,
        "lighting": lighting or None,
        "drawDistance": view_distance,
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
    chain = mod_chain(game_dir, args.mod)
    files, info, heightmap, paths = load_level(game_dir, args.mod, args.level, chain)
    print(f"level:    {info.name}  ({', '.join(p.name for p in paths)})", file=sys.stderr)
    print(f"world:    {info.terrain.world_size:g} m, yScale {info.terrain.y_scale}, "
          f"heightmap {heightmap.dim}x{heightmap.dim}", file=sys.stderr)
    print(f"tiles:    {len(files.tiles())}", file=sys.stderr)
    print(f"objects:  {len(info.static_objects)} placed, "
          f"{len(info.spawn_objects)} spawners", file=sys.stderr)

    assembler = None
    library = None
    lightmaps: dict[tuple[str, int, int, int], str] = {}
    out_dir = args.out / info.name.lower()
    out_dir.mkdir(parents=True, exist_ok=True)

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
    if info.texture_alternative_path:
        textures.set_alternative_paths([info.texture_alternative_path])
    # A level can declare ObjectTemplates of its own, and they have to be in the
    # pool before the library is built or the level's own objects resolve to
    # nothing. See `add_level_objects`.
    for path in paths:
        objects.add_level_objects(path, label=f"{info.name} objects")
    if not args.terrain_only:
        library = build_library(objects)
        lightmaps = write_object_lightmaps(files, out_dir)
        assembler = Assembler(
            meshes, textures, objects, library,
            lod=0, max_texture=args.max_texture, include_collision=False,
            lightmaps=lightmaps)

    sky_faces = prepare_sky(info, meshes, textures)
    glb, extras = build_scene(
        files, info, heightmap, assembler,
        max_texture=args.max_texture, include_objects=not args.terrain_only,
        lightmaps=lightmaps, sky_faces=sky_faces, out_dir=out_dir,
    )
    if sky_faces:
        extras["sky"] = {
            "mesh": info.sky.mesh,
            "rotAngle": info.sky.rot_angle,
            "heightOffset": info.sky.height_offset,
            "clouds": write_cloud_assets(info, meshes, textures, out_dir),
        }
    # The ENVMAP_G_.rcm faces are the engine's water/glass reflection source
    # (`ShaderManager.setTextureParam envmap`), exported always. Without a sky
    # box they double as the background, which is at least the right palette.
    extras["envmap"] = write_skybox(files, out_dir)
    if not sky_faces:
        extras["skybox"] = extras["envmap"]
    extras["water"] = write_water_assets(
        info, heightmap, textures, out_dir, args.max_texture)

    sounds = ArchivePool()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is not None:
            sounds.add_dir(archives, SOUND_ARCHIVES)
    # Engine sound is per spawned vehicle, deduped by template: a level with
    # eight Corsair spawners still ships one set of wavs and one script.
    spawned: list[str] = []
    for inst in info.spawn_objects:
        vehicle = spawn_vehicle(inst.template, inst.team, info.spawn_templates)
        if vehicle and vehicle not in spawned:
            spawned.append(vehicle)
    extras["sounds"] = extract_sounds(info, files, sounds, out_dir,
                                      library=library, objects=objects,
                                      vehicles=spawned)

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
    sky = extras.get("sky")
    water = extras.get("water")
    snd = extras.get("sounds") or {}
    amb = snd.get("ambient")
    areas = snd.get("areas") or []
    print(f"  terrain {extras['terrain']['triangles']} tris, "
          f"{len(files.tiles())} tiles"
          f" + {extras['terrain'].get('defaultTiles', 0)} default"
          f"{' + detail' if extras['terrain'].get('detail') else ''}; "
          f"objects {obj['placed']} placed ({obj.get('spawners', 0)} spawners), "
          f"{obj.get('lightmaps', 0)} lightmaps, "
          f"{len(obj['skipped'])} skipped, "
          f"{len(obj.get('texturesMissing') or [])} tex missing; "
          f"{len(glb) // 1024} KB -> {out_dir / 'scene.glb'}", file=sys.stderr)
    print(f"  sky:    {sky['mesh'] if sky else 'env cubemap fallback'}"
          f"{' + clouds' if sky and sky.get('clouds') else ''}; "
          f"water:  "
          f"{'layers ' + '/'.join(sorted(water['textures'])) if water else 'flat colour'}",
          file=sys.stderr)
    engines = snd.get("vehicles") or []
    print(f"  sounds: ambient {amb['file'] if amb else 'none'}, "
          f"{len(areas)} area/emitter sound(s), "
          f"{len(engines)} vehicle engine(s) "
          f"({sum(len(v['layers']) for v in engines)} layers), "
          f"{sum(len(v.get('weapons') or []) for v in engines)} weapon(s) "
          f"({sum(len(w['layers']) for v in engines for w in v.get('weapons') or [])}"
          " layers)", file=sys.stderr)
    return 0


# Mirroring the world in Z does not just swap the two Z faces of a cube map --
# it mirrors the *contents* of all six, each along whichever of its own axes
# tracks world Z. Swap alone leaves every face internally back-to-front against
# its neighbours, so the four side faces no longer agree along the edges they
# share and the cube reads as six separate pictures. It is invisible while the
# cube is only ever drawn as a distant background, which is why it survived
# until the sky moved onto its own SkyBox mesh and the cube was left reflecting
# off the water, where a discontinuity is a hard line across the bay.
#
# With `dir = (1, -v, -u)` for +X and `(u, 1, v)` for +Y (the glTF/GL
# convention), substituting `M = diag(1, 1, -1)` gives: the X faces and the two
# swapped Z faces mirror in u, and the Y faces mirror in v.
_FACE_MIRROR = {"px": "u", "nx": "u", "py": "v", "ny": "v", "pz": "u", "nz": "u"}


def _mirror_rgba(width: int, height: int, rgba: bytes, axis: str) -> bytes:
    out = bytearray(len(rgba))
    for y in range(height):
        src_row = (height - 1 - y) if axis == "v" else y
        base_dst = y * width * 4
        base_src = src_row * width * 4
        for x in range(width):
            src_x = (width - 1 - x) if axis == "u" else x
            out[base_dst + x * 4: base_dst + x * 4 + 4] = \
                rgba[base_src + src_x * 4: base_src + src_x * 4 + 4]
    return bytes(out)


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
        rgba = _mirror_rgba(width, height, rgba, _FACE_MIRROR[face])
        (sky_dir / f"{face}.png").write_bytes(
            encode_png(width, height, rgba, drop_alpha=True))
        written.append(f"sky/{face}.png")
    return written


if __name__ == "__main__":
    raise SystemExit(main())
