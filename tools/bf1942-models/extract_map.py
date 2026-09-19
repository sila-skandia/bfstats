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

Sound is deduplicated and compressed. Samples go to `<out>/_shared/sounds` as
MP3 (LAME -V2) rather than to a per-level `sounds/` directory as wav, and
`scene.json` references them relatively — `../_shared/sounds/x.mp3`. 239 EoD
levels shipped 8,828 wav files that were only 260 distinct payloads, 3.24 GB of
the same ambient beds and engine layers copied once per level. MP3 specifically
because it is the only candidate that survives a loop: measured through
Chromium's own `decodeAudioData`, it returns *exactly* the source sample count,
where Vorbis retains up to 12.3 ms of encoder padding inside every loop and AAC
does not decode at all. That property lives in LAME's Xing header, so nothing
downstream may rewrite or strip ID3/Xing tags. `--audio-format wav` opts out;
see `features/mesh-mod-assets/audio-compression.md` for the measurements.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR,
    build_library,
    build_pools,
    discover_level_textures,
    load_damage_tables,
    mod_chain,
)

from bf42 import gltf, stdmesh  # noqa: E402
from bf42 import baf as baf_mod  # noqa: E402
from bf42 import rs as rs_mod  # noqa: E402
from bf42 import ske as ske_mod  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
# The flag cloth is a skinned mesh, and the pose extractor already knows how to
# build one; these two are the whole of what that needs.
from extract_pose import _match_skn_vertices, read_skin  # noqa: E402
from bf42.level import (  # noqa: E402
    LevelFiles,
    LevelInfo,
    index_object_lightmaps,
    decode_heightmap,
    decode_material_map,
    discover_level_sounds,
    find_level_archives,
    load_gameplay_objects,
    load_level_files,
    load_tickets,
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
    # Conquest is what every stock level ships and what these paths assumed,
    # but a mod map may only carry Ctf or ObjectiveMode — asking for the mode
    # the level actually has is what gets those their vehicles and flags.
    info.gameplay = load_gameplay_objects(files)
    mode = info.gameplay.mode or "Conquest"
    if files.find(f"{mode}/ObjectSpawnTemplates.con"):
        info.spawn_templates = parse_spawn_templates(
            _read_text(files, f"{mode}/ObjectSpawnTemplates.con"))
    if files.find(f"{mode}/ObjectSpawns.con"):
        info.spawn_objects = parse_static_objects(
            _read_text(files, f"{mode}/ObjectSpawns.con"))
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
# Bounce, MG distance, Fire Loop. Aircraft MGs leave the middle slots silent,
# so "first sounding patch" lands on Fire Loop; stationary MG42 / Browning fill
# Release and MG-distance with one-shots *before* the loop, so that rule alone
# ships a distant report instead of the sustained fire the viewer gain-gates.
_SILENCE = "silence.wav"


def _non_silence(samples):
    return [s for s in samples
            if not s.file.replace("\\", "/").lower().endswith(_SILENCE)]


def _firing_patch(patches):
    """The patch a held trigger plays.

    Prefer a patch that carries a looping sample (the Fire Loop). Fall back to
    the first sounding patch for single-shot weapons whose Fire slot is the
    report. When the Fire Loop wins, keep only its looping layers — that patch
    also stacks shell-eject and distance one-shots the continuous gain-gate
    path cannot play.
    """
    first = None
    for patch in patches:
        samples = _non_silence(patch.samples)
        if not samples:
            continue
        if first is None:
            first = samples
        loops = [s for s in samples if s.loop]
        if loops:
            return loops
    return first or []


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


def ffmpeg_available() -> bool:
    try:
        return subprocess.run(["ffmpeg", "-version"],
                              capture_output=True).returncode == 0
    except (OSError, FileNotFoundError):
        return False


class TranscodeError(RuntimeError):
    """ffmpeg could not encode a sample.

    Raised rather than quietly writing the wav instead. A fallback would ship
    the format this pipeline exists to stop shipping, and it would do it
    invisibly — a run that lost its encoder would still report success while
    producing the 3.2 GB tree the shared directory was built to avoid. It also
    would not help: ffmpeg failing on a sample means a corrupt source (EoD's
    `objects.rfa` has LZO entries that overrun their window), so the wav
    written in its place is corrupt too.

    One level failing is already a handled outcome — `extract_maps_all.py`
    counts it, finishes the rest and lists it for a re-run.
    """


def transcode_to_mp3(data: bytes, dest: Path) -> None:
    """PCM wav bytes to MP3 -V2 at `dest`, atomically. Raises on failure.

    `-q:a 2` is LAME's -V2. Measured against this corpus (see
    features/mesh-mod-assets/audio-compression.md) it beat Opus on every file
    and, unlike Vorbis, comes back from Chromium's `decodeAudioData`
    sample-exact — the encoder delay is carried in LAME's Xing header and
    honoured, so a two-second engine layer loops without a tick. That property
    is the whole reason for MP3 here, and it lives entirely in that header:
    **nothing downstream may rewrite or strip ID3/Xing tags.**

    Written to a temp file and `os.replace`d because levels are extracted in
    parallel and several will resolve the same sample at once; a half-written
    file in the shared directory would be served to a browser as a truncated
    buffer.
    """
    tmp_wav = dest.with_suffix(dest.suffix + f".{os.getpid()}.wav")
    tmp_mp3 = dest.with_suffix(dest.suffix + f".{os.getpid()}.part")
    try:
        tmp_wav.write_bytes(data)
        result = subprocess.run(
            # `-f mp3` is not optional: ffmpeg picks the muxer from the output
            # extension, and the atomic temp name deliberately does not end in
            # `.mp3`, so without it every transcode fails with "unable to
            # choose an output format".
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(tmp_wav), "-codec:a", "libmp3lame", "-q:a", "2",
             "-f", "mp3", str(tmp_mp3)],
            capture_output=True)
        if result.returncode != 0 or not tmp_mp3.is_file():
            detail = result.stderr.decode("utf-8", "replace").strip().splitlines()
            raise TranscodeError(
                f"ffmpeg failed on {dest.name}: "
                f"{detail[-1] if detail else f'exit {result.returncode}'}")
        os.replace(tmp_mp3, dest)
    except OSError as exc:
        raise TranscodeError(f"ffmpeg could not run for {dest.name}: {exc}") from exc
    finally:
        tmp_wav.unlink(missing_ok=True)
        tmp_mp3.unlink(missing_ok=True)


def extract_sounds(info: LevelInfo, level_files: LevelFiles,
                   sounds: ArchivePool, out_dir: Path,
                   library=None, objects: ArchivePool | None = None,
                   vehicles: list[str] | None = None,
                   shared_dir: Path | None = None,
                   audio_format: str = "mp3",
                   final_dir: Path | None = None) -> dict:
    """Extract referenced sounds and produce the sounds report dict.

    Samples land in `shared_dir` rather than the level's own `sounds/`, and
    `scene.json` points at them relatively (`../_shared/sounds/x.mp3`). 239 EoD
    levels shipped 8,828 wav files that were only 260 distinct payloads —
    3.24 GB of the same ambient beds and engine layers re-copied per level.
    Sharing costs nothing at playback: the viewer builds
    `${MAPS_BASE}/${dir}/${relPath}` and a relative path resolves as a URL, so
    a sample now also arrives as one browser cache entry and one decode across
    every level that uses it.

    The directory is per-mod, not global, even though 67 of vanilla's payloads
    are byte-identical to EoD's. `viewer/maps/mods/<id>/` has to stay a
    self-contained subtree or publishing a mod stops being one recursive upload
    of one directory — which the mod layout leans on. Duplicating 67 files
    across two mods is the cheaper half of that trade.
    """
    sound_report: dict = {"ambient": None, "areas": [], "vehicles": []}
    if shared_dir is None:
        shared_dir = out_dir.parent / "_shared" / "sounds"
    # Paths in scene.json are relative to where the level will *live*, which is
    # not where it is being written when a batch run stages each level in its
    # own directory and moves it afterwards. Computing against `out_dir` there
    # yields the staging depth — `../../../_shared/...` for a path that needs
    # to be `../_shared/...`, pointing outside the published tree.
    rel_base = final_dir or out_dir
    seen: dict[str, str] = {}

    def write(resolved: tuple[str, bytes]) -> str:
        basename, data = resolved
        if basename in seen:
            return seen[basename]
        shared_dir.mkdir(parents=True, exist_ok=True)
        if audio_format == "mp3":
            target = shared_dir / (Path(basename).stem + ".mp3")
            # Another level may have transcoded it already: this directory is
            # shared across every level in the mod and across runs.
            if not target.is_file():
                transcode_to_mp3(data, target)
        else:
            target = shared_dir / basename
            if not target.is_file():
                tmp = shared_dir / f"{basename}.{os.getpid()}.part"
                tmp.write_bytes(data)
                os.replace(tmp, target)
        rel = os.path.relpath(target, rel_base).replace(os.sep, "/")
        seen[basename] = rel
        return rel

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

    if objects is not None and info.gameplay.control_points:
        flags = extract_flag_sound(info, objects, sounds, write)
        if flags is not None:
            sound_report["flags"] = flags

    return sound_report


# `AnimatedFlag` carries `loadSoundScript Sounds/flag.ssc`, whose one patch is
# a looping `flag.wav` with a distance-to-volume ramp. Same script for every
# flag on every level, so it is read from the object pool by its own path
# rather than hunted per template.
FLAG_SOUND_SCRIPT = "Objects/Items/Flag/Sounds/flag.ssc"


def extract_flag_sound(info: LevelInfo, objects: ArchivePool,
                       sounds: ArchivePool, write) -> dict | None:
    """The flap, and where each flag flies it.

    One sample and one set of emitter positions rather than a patch per flag:
    the engine instantiates the same script at every flag, and the viewer only
    needs to know where to stand them up. `randomStartPitch` is carried
    through because without it a row of flags beats in unison.
    """
    def read_script(path: str) -> str | None:
        hit = objects.find(path)
        return objects.read(hit).decode("latin-1") if hit else None

    text = read_script(FLAG_SOUND_SCRIPT)
    if text is None:
        return None
    patches = parse_ssc(text, level=VEHICLE_SOUND_LEVEL,
                        include=read_script, source=FLAG_SOUND_SCRIPT)
    samples = patches[0].samples if patches else []
    if not samples:
        return None
    sample = samples[0]
    resolved = resolve_sound(sample.file, None, sounds, rates=VEHICLE_RATES)
    if resolved is None:
        return None

    # Only the flags that actually fly a cloth make the noise; a bare pole on a
    # neutral point has nothing to flap, and a zone-only point has no pole.
    positions = []
    for inst in info.gameplay.control_points:
        tpl = info.gameplay.template_for(inst)
        if tpl is None or not tpl.visible:
            continue
        team = inst.team if inst.team is not None else tpl.team
        if not tpl.flag_mesh(team):
            continue
        positions.append(_to_gltf_vec((
            inst.position[0] + tpl.flag_offset[0],
            inst.position[1] + tpl.flag_offset[1],
            inst.position[2] + tpl.flag_offset[2])))
    if not positions:
        return None

    # `controlDestination Volume / controlSource Distance / envelope Ramp`
    # with params (near, far, at-near, at-far).
    ramp = next((e.params for e in sample.effects
                 if e.destination == "volume" and e.source == "distance"
                 and e.envelope == "ramp" and len(e.params) >= 2), None)
    entry = {
        "file": write(resolved),
        "loop": bool(sample.loop),
        "volume": sample.volume,
        "minDistance": sample.min_distance,
        "randomStartPitch": sample.random_start_pitch,
        "positions": positions,
    }
    if ramp:
        entry["nearDistance"], entry["farDistance"] = ramp[0], ramp[1]
    return entry


def extract_vehicle_sounds(library, objects: ArchivePool, sounds: ArchivePool,
                           vehicles: list[str], write) -> list[dict]:
    """Per-vehicle engine sound: the layered patch, and its wavs on disk.

    What ships is the parsed script rather than a baked recipe. Every layer
    keeps its own modulator list, so the viewer evaluates the same curves the
    engine does and a Zero or a Spitfire needs no new code — only its own
    `.ssc`. The one interpretation baked in here is the coordinate flip on
    `relativePosition`, which is the exporter's own Z mirror, so the viewer
    never has to know Refractor is left-handed.

    Templates with FireArms but no Engine (Stationary MG42 / Browning) still
    get an entry: empty `layers`, weapons filled. The viewer looks those up by
    template the same way it looks up a tank's guns.
    """
    def read_script(path: str) -> str | None:
        hit = objects.find(path)
        return objects.read(hit).decode("latin-1") if hit else None

    out: list[dict] = []
    for template in vehicles:
        found = find_engine_script(library, objects, template)
        entry: dict | None = None
        if found is not None:
            script_path, engine_name = found
            text = read_script(script_path)
            if text is not None:
                patches = parse_ssc(text, level=VEHICLE_SOUND_LEVEL,
                                    include=read_script, source=script_path)
                # An Engine is a single-patch object: triggered while it runs,
                # released when it stops. Anything past the first patch is not
                # engine sound.
                samples = patches[0].samples if patches else []
                layers = _sound_layers(samples, sounds, write)
                if layers:
                    entry = {
                        "template": template,
                        "engine": engine_name,
                        "script": script_path,
                        "level": VEHICLE_SOUND_LEVEL,
                        "layers": layers,
                    }
        # The guns ride along with the vehicle that carries them — or alone,
        # for a furniture mount that has no drivetrain voice of its own.
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
        if entry is None and weapons:
            entry = {
                "template": template,
                "engine": None,
                "script": None,
                "level": VEHICLE_SOUND_LEVEL,
                "layers": [],
            }
        if entry is None:
            continue
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


def projectile_materials(library) -> dict[str, dict]:
    """`projectileTemplate -> attacker material`, for the impact-effect lookup.

    The effect table is keyed `(attacker material, defender material)`, and a
    viewer holding a round in flight knows only the round's *template* name —
    `fireArms.projectile.template` in the node extras. `ObjectTemplate.material`
    on the Projectile is the attacker id (236 for an allied tank gun, 218 for a
    rifle), `material2` is the separate id its splash pass uses, and `radius`
    is that pass's extent. All three are already parsed by `con.py`, so this
    costs one walk of a library that is built anyway.
    """
    if library is None:
        return {}
    out: dict[str, dict] = {}
    for name, template in library.objects.items():
        if template.kind.lower() != "projectile" or template.material is None:
            continue
        out[name] = {"material": template.material}
    return out


def write_damage_tables(tables, shared_dir: Path, rel_base: Path,
                        projectiles: dict | None = None) -> dict | None:
    """`damage.json` in the shared directory, plus the path to reach it.

    The MaterialManager tables are mod-wide, so they are written once beside
    the deduplicated sounds and referenced from each level's `scene.json` by a
    relative path — the same arrangement, and for the same reason, as
    `../_shared/sounds/*.mp3`.
    """
    if tables is None:
        return None
    shared_dir.mkdir(parents=True, exist_ok=True)
    target = shared_dir / "damage.json"
    payload = tables.as_dict()
    payload["projectiles"] = projectiles or {}
    target.write_text(json.dumps(payload, separators=(",", ":")))
    return {
        "path": os.path.relpath(target, rel_base).replace(os.sep, "/"),
        "materials": len(payload["materials"]),
        "modifiers": sum(len(row) for row in payload["modifiers"].values()),
        "effects": sum(len(row) for row in payload["effects"].values()),
        "projectiles": len(payload["projectiles"]),
        "effectTemplates": sorted({
            name for row in payload["effects"].values() for name in row.values()}),
    }


def write_terrain_materials(files, info: LevelInfo, out_dir: Path,
                            damage_tables=None) -> dict | None:
    """`Materialmap.raw` as a lossless image, so a ground hit knows its surface.

    One byte per heightmap sample, written into the red channel of a PNG at the
    map's own resolution — 512x512 on nearly every vanilla level, which
    compresses to a couple of kilobytes because the ids come in large flat
    regions. Nothing is resampled and nothing is scaled: a nearest sample at
    `(x / spacing, z / spacing)` gives back the exact authored byte, and a
    filtered read would invent ids that are not in the table.

    Green and blue carry the same value so the file is legible as a greyscale
    map when a human opens it; the viewer only ever reads red.

    The labels ride along because the ids alone are unreadable — the viewer
    shows "Dry sand" in a hit readout, not "10".
    """
    entry = files.find("Materialmap.raw")
    if entry is None:
        return None
    try:
        materials = decode_material_map(files.read(entry), info.terrain.world_size)
    except ValueError:
        return None
    dest = out_dir / "terrain"
    dest.mkdir(parents=True, exist_ok=True)
    rgba = bytearray(materials.dim * materials.dim * 4)
    for i, value in enumerate(materials.ids):
        rgba[i * 4:i * 4 + 4] = bytes((value, value, value, 255))
    (dest / "materials.png").write_bytes(
        encode_png(materials.dim, materials.dim, bytes(rgba), drop_alpha=True))
    histogram = materials.histogram()
    labels: dict[str, str] = {}
    if damage_tables is not None:
        for ident in histogram:
            material = damage_tables.materials.get(ident)
            if material is not None and material.label:
                labels[str(ident)] = material.label
    return {
        "image": "terrain/materials.png",
        "dim": materials.dim,
        "spacing": materials.spacing,
        "histogram": {str(k): v for k, v in histogram.items()},
        "labels": labels,
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


# A `.baf` stores frame counts, never a rate, so the playback speed is a viewer
# choice. 30 fps puts `FlagBlow`'s 49 frames at 1.63 s a cycle, which reads as
# a steady breeze rather than a flutter or a flap.
FLAG_FPS = 30.0

# Every flag on every level shares one skeleton and one clip; parse them once.
_FLAG_RIG: dict[str, object] = {}


def _flag_skeleton(meshes):
    if "ske" not in _FLAG_RIG:
        raw = meshes.try_read("animations/flag.ske")
        try:
            _FLAG_RIG["ske"] = ske_mod.parse(raw) if raw else None
        except Exception:
            _FLAG_RIG["ske"] = None
    return _FLAG_RIG["ske"]


def _flag_clip(meshes):
    if "clip" not in _FLAG_RIG:
        raw = meshes.try_read("animations/Flag/FlagBlow.baf")
        try:
            _FLAG_RIG["clip"] = baf_mod.parse(raw) if raw else None
        except Exception:
            _FLAG_RIG["clip"] = None
    return _FLAG_RIG["clip"]


def _build_flag_cloth(builder, assembler, meshes, library, geometry_name: str,
                      offset, report, name: str) -> tuple[int, int] | None:
    """A control point's flag: skinned to the flag skeleton and flapping.

    The cloth is not a StandardMesh, which is what the level's `addTemplate`
    makes it look like. `Objects/Items/Flag/Geometries.con` declares every flag
    as `GeometryTemplate.create AnimatedMesh` with
    `setSkin animations/flag.skn`, and the `AnimatedFlag` bundle adds
    `createSkeleton animations/flag.ske` and `setAnimationState FlagBlow`.
    Drawn from its raw `.sm` the cloth sits in its authoring pose — a flat
    sheet centred on its own origin — so at the declared `0/8.2/0` it straddles
    the top of an 8.52 m pole and reads upside down. Posed through the skeleton
    it hangs off one side and below the attachment, which is what the engine
    draws.

    Returns `(anchor node, skinned mesh node)`. The anchor carries the flag
    offset and is the caller's to parent under the control point, so the joints
    inherit the placement. The mesh node must go to the scene root untouched:
    glTF ignores a skinned mesh node's own transform.

    The bind pose is recovered rather than solved. Every vertex carries exactly
    one influence at weight 1.0, so a bone's bind *rotation* is unconstrained —
    which is why `pose.refine_binds`, which needs three points per bone, finds
    nothing here. Any consistent choice works, and identity is the simplest:
    with `bind = (I, rest - offset)` the inverse bind takes a vertex to its
    bone-local offset, and glTF's `jointWorld * inverseBind * v` reduces to
    `posed_world * offset` — exactly what `pose.skinned_positions` computes.
    """
    geom = library.geometry(geometry_name)
    if geom is None or not geom.skin:
        return None
    entry = meshes.resolve_ext(f"standardMesh/{geom.mesh_file}", (".sm",))
    skn = read_skin(meshes, geom.skin)
    skeleton = _flag_skeleton(meshes)
    clip = _flag_clip(meshes)
    if not entry or skn is None or skeleton is None or clip is None:
        return None
    try:
        mesh = stdmesh.parse(meshes.read(entry), entry)
    except Exception:
        return None
    if not mesh.lods:
        return None

    identity = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    bind_by_bone: dict[str, tuple] = {}
    for vertex in skn.vertices:
        for inf in vertex.influences:
            key = ske_mod.canonical(skn.bones[inf.bone])
            if key in bind_by_bone:
                continue
            bind_by_bone[key] = (identity, tuple(
                vertex.rest[i] - inf.offset[i] for i in range(3)))

    joint_bones = [b.name for b in skeleton.bones]
    slot = {ske_mod.canonical(b): i for i, b in enumerate(joint_bones)}
    if not any(ske_mod.canonical(b) in bind_by_bone for b in joint_bones):
        return None

    # Frame 0 as the node hierarchy's own pose, so a viewer that ignores
    # animations still shows a correctly hung flag rather than the sheet.
    anchor = builder.add_node(gltf.Node(
        name=f"{name} flag", translation=tuple(offset),
        extras={"kind": "flagAnchor"}))
    locals_map = clip.local_pose(0)
    joint_nodes: dict[str, int] = {}
    children_of: dict[int, list[int]] = {}
    order: list[tuple[int, int]] = []
    for index, bone in enumerate(skeleton.bones):
        key = ske_mod.canonical(bone.name)
        rotation, translation = locals_map.get(
            key, (bone.rotation, bone.translation))
        node = builder.add_node(gltf.Node(
            name=f"{name} {bone.name}", translation=translation,
            rotation=gltf.quat_from_matrix(rotation), extras={"joint": True}))
        joint_nodes[key] = node
        order.append((index, node))
        if 0 <= bone.parent < index:
            children_of.setdefault(bone.parent, []).append(node)
    for bone_index, node_index in order:
        builder._nodes[node_index].children = children_of.get(bone_index, [])
    builder._nodes[anchor].children = [
        node for index, node in order if skeleton.bones[index].parent < 0]

    def vertex_slots(skn_index: int):
        joints, weights = [], []
        for inf in skn.vertices[skn_index].influences:
            key = ske_mod.canonical(skn.bones[inf.bone])
            if key not in slot:
                continue
            joints.append(slot[key])
            weights.append(inf.weight)
        if not joints:
            joints, weights = [0], [1.0]
        total = sum(weights) or 1.0
        weights = [w / total for w in weights]
        return ((joints + [0, 0, 0, 0])[:4], (weights + [0.0, 0.0, 0.0, 0.0])[:4])

    primitives = []
    triangles = 0
    for material in mesh.lods[0].materials:
        tris = material.triangles()
        if not tris:
            continue
        positions = material.positions()
        slots = [vertex_slots(i) for i in _match_skn_vertices(positions, skn)]
        triangles += len(tris)
        primitives.append(gltf.Primitive(
            positions=positions,
            normals=material.normals(),
            uvs=material.uvs(),
            indices=[i for tri in tris for i in tri],
            material=assembler.material_for(
                builder, geometry_name, material.name, report),
            joints=[s[0] for s in slots],
            weights=[s[1] for s in slots],
        ))
    if not primitives:
        return None

    skin_index = builder.add_skin(
        [joint_nodes[ske_mod.canonical(b)] for b in joint_bones],
        [bind_by_bone.get(ske_mod.canonical(b), (identity, (0.0, 0.0, 0.0)))
         for b in joint_bones],
        name=name)
    mesh_node = builder.add_node(gltf.Node(
        name=f"{name} cloth", mesh=builder.add_mesh(geom.mesh_file, primitives),
        skin=skin_index, extras={"kind": "flagCloth"}))

    # `FlagBlow`, the state the flag bundle declares, over this flag's own
    # joints so a mixer playing every clip animates every flag.
    times = tuple(f / FLAG_FPS for f in range(clip.frames))
    frames = [clip.local_pose(f) for f in range(clip.frames)]
    tracks = []
    for bone in skeleton.bones:
        key = ske_mod.canonical(bone.name)
        node = joint_nodes.get(key)
        if node is None:
            continue
        rest = (bone.rotation, bone.translation)
        tracks.append((node, times, [f.get(key, rest) for f in frames]))
    if tracks:
        builder.add_animation(f"FlagBlow {name}", tracks)
    report.parts += 1
    report.triangles += triangles
    return anchor, mesh_node


def detach_flag_cloth(library, info: LevelInfo) -> int:
    """Strip the `AnimatedFlag` child off every control point template.

    The cloth is a skinned mesh and `_build_flag_cloth` builds it separately;
    left in place the assembler would also emit it as a rigid child at its
    authoring pose, which is the flat sheet straddling the pole. The pole
    itself — the template's own `geometry` — is untouched, so a control point
    whose cloth cannot be built still gets its pole.

    Returns how many templates were stripped.
    """
    stripped = 0
    for inst in info.gameplay.control_points:
        tpl = info.gameplay.template_for(inst)
        if tpl is None or not tpl.flag_child:
            continue
        obj = library.objects.get(inst.template.lower())
        if obj is None or not obj.children:
            continue
        wanted = tpl.flag_child.lower()
        keep = [c for c in obj.children if c.template.lower() != wanted]
        if len(keep) != len(obj.children):
            obj.children = keep
            stripped += 1
    return stripped


def write_minimap(files, out_dir: Path, max_size: int = 512) -> dict | None:
    """The level's own map art — the same image the HUD minimap and the
    fullscreen map both draw, at different on-screen sizes.

    There is no separate full-map texture and no separate grid overlay: the
    grid letters and numbers are painted into this one image. Neither the size
    nor the extension can be assumed — 1193 of the installed levels ship
    512x512 `.dds`, but 42 ship 1024 or 2048 and 8 ship `.tga` — so the decoded
    dimensions are taken from the file and the extension is probed.
    """
    for stem in ("Textures/InGameMap", "Texture/InGameMap", "Textures/Minimap"):
        for ext in (".dds", ".tga"):
            path = files.find(stem + ext)
            if not path:
                continue
            try:
                raw = files.read(path)
                if ext == ".dds":
                    width, height, rgba = decode_dds(raw)
                else:
                    width, height, rgba = decode_tga(raw)
            except Exception:
                continue
            if max_size and max(width, height) > max_size:
                width, height, rgba = downscale(width, height, rgba, max_size)
            dest = out_dir / "minimap"
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "minimap.png").write_bytes(
                encode_png(width, height, rgba, drop_alpha=True))
            return {
                "image": "minimap/minimap.png",
                "pixels": [width, height],
                "source": path,
            }
    return None


def _world_to_image(info: LevelInfo) -> list[float]:
    """The affine mapping glTF world metres onto the level's map art, 0..1.

        u = m[0]*x + m[1]*z + m[2]
        v = m[3]*x + m[4]*z + m[5]

    The art frames the level's **active combat area**, not the world. Most
    levels declare none and the two coincide, which is why `x / worldSize`
    looked right for so long — but 142 of the 1018 installed levels declare a
    sub-world one and every marker lands wrong on them. Berlin's is
    `1536 1536 512 512` against a 2048 world: a 4x error per axis.

    Refractor's combat area is declared as origin plus size, not as two
    corners. `x` is east and needs no sign work. The `v` row carries two
    inversions that cancel to a positive scale, which is easy to get backwards:

        Refractor    v = 1 - (z_ref - minZ) / sizeZ      image V runs down
        glTF         z_gltf = -z_ref                     the exporter negates Z
        substituting v = 1 + z_gltf / sizeZ + minZ / sizeZ
    """
    world = info.terrain.world_size or 1.0
    if info.combat is not None and info.combat.size_x and info.combat.size_z:
        min_x, min_z = info.combat.min_x, info.combat.min_z
        size_x, size_z = info.combat.size_x, info.combat.size_z
    else:
        min_x = min_z = 0.0
        size_x = size_z = world
    return [1.0 / size_x, 0.0, -min_x / size_x,
            0.0, 1.0 / size_z, 1.0 + min_z / size_z]


def _control_point_report(info: LevelInfo, placed: set[str] | None) -> list[dict]:
    """`placed` is the set of templates that actually assembled into the glb,
    or None when objects were not built at all (`--terrain-only`).

    The distinction matters: a terrain-only run has placed nothing, and
    reporting every control point as invisible would tell the viewer these
    levels are all zone-only. Without an assembler the template's own reading
    is the best answer available.
    """
    out: list[dict] = []
    for inst in info.gameplay.control_points:
        tpl = info.gameplay.template_for(inst)
        entry = {
            "name": inst.template,
            "position": _to_gltf_vec(inst.position),
            "rotation": list(inst.rotation),
            # A placement may override the template's starting owner.
            "team": inst.team if inst.team is not None else (tpl.team if tpl else 0),
            "displayName": (tpl.display_name or inst.template) if tpl else inst.template,
            "radius": tpl.radius if tpl else 0.0,
            "areaValue": tpl.area_value if tpl else 0.0,
            "spawnGroupId": tpl.spawn_group_id if tpl else None,
            "objectSpawnerId": tpl.object_spawner_id if tpl else None,
            "unableToChangeTeam": tpl.unable_to_change_team if tpl else False,
            "flagMesh": tpl.flag_mesh() if tpl else None,
            "flagHeight": tpl.flag_offset[1] if tpl else 0.0,
            # False for a capture zone the level deliberately left invisible.
            "visible": bool(tpl and tpl.visible
                            and (placed is None or inst.template.lower() in placed)),
        }
        out.append(entry)
    return out


def _soldier_spawn_report(info: LevelInfo) -> list[dict]:
    gameplay = info.gameplay
    out: list[dict] = []
    for inst in gameplay.soldier_spawns:
        tpl = gameplay.soldier_spawn_templates.get(inst.template.lower())
        group = tpl.group if tpl else None
        out.append({
            "name": inst.template,
            "position": _to_gltf_vec(inst.position),
            "rotation": list(inst.rotation),
            "group": group,
            "spawnId": tpl.spawn_id if tpl else None,
            # A spawn point declares no team; it inherits from the flag whose
            # spawnGroupId matches its setGroup.
            "team": gameplay.team_of_group(group),
            # `setSpawnAsParaTroper` — this one puts you in the air under a
            # chute, so an on-foot mode has to skip it.
            "paratrooper": bool(tpl and tpl.paratrooper),
        })
    return out


def _object_spawn_report(info: LevelInfo) -> list[dict]:
    """Per-pad ObjectSpawner record: vehicle + respawn window + world pose.

    The viewer matches these to the baked spawner nodes by vehicle name and
    nearest position, then uses Min/MaxSpawnDelay (or SpawnDelay) after a wreck
    clears so the pad is walkable until the vehicle returns.
    """
    out: list[dict] = []
    for inst in info.spawn_objects:
        vehicle = spawn_vehicle(inst.template, inst.team, info.spawn_templates)
        if vehicle is None:
            continue
        spec = info.spawn_templates.get(inst.template.lower())
        window = spec.respawn_window() if spec else None
        entry: dict = {
            "spawner": inst.template,
            "vehicle": vehicle,
            "team": inst.team,
            "position": _to_gltf_vec(inst.position),
            "rotation": list(inst.rotation),
        }
        if window is not None:
            entry["minSpawnDelay"] = window[0]
            entry["maxSpawnDelay"] = window[1]
        if spec and spec.spawn_delay_at_start is not None:
            entry["spawnDelayAtStart"] = spec.spawn_delay_at_start
        out.append(entry)
    return out


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
    # `Object.geometry.scale` is a per-placement stretch, so it belongs to
    # the placed instance, not the shared template — stamped on the root
    # node after assembly so every child inherits it.
    if getattr(inst, "scale", None):
        builder.node(node).scale = inst.scale
    # Per-placement foliage tint — carried as node extras so a re-extract
    # does not need a material clone per tree; the viewer multiplies it in.
    if getattr(inst, "color", None):
        n = builder.node(node)
        extras = dict(n.extras or {})
        extras["color"] = list(inst.color)
        n.extras = extras
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
        "controlPoints": 0,
        "soldierSpawns": len(info.gameplay.soldier_spawns),
        "parts": 0,
        "triangles": 0,
        "texturesResolved": 0,
        "texturesMissing": [],
    }
    # None until the object pass runs, so a terrain-only extract is not
    # mistaken for a level whose flags all failed to assemble.
    placed_flags: set[str] | None = None
    if include_objects and assembler is not None:
        placed_flags = set()
        report = Report(root=info.name, configuration="complex", lod=0)
        seen_fail: set[str] = set()
        # `build_node` gathers `setContinousRotationSpeed` parts as it walks,
        # but only `Assembler.export` bakes them — and a level never calls it,
        # because the scene owns the builder. Bracket the object pass so the
        # level gets its clips too, or every windmill, watermill, radar bunker
        # and ship radar in it stands still.
        assembler.begin_animations()
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
            # Respawn timing lives on the ObjectSpawner, not the vehicle. Stamp
            # it onto the placed node so a map that never rewrote scene.json
            # still carries the window in the glb extras.
            spec = info.spawn_templates.get(inst.template.lower())
            window = spec.respawn_window() if spec else None
            if window is not None:
                placed = builder.node(node)
                extras_node = placed.extras if isinstance(placed.extras, dict) else {}
                extras_node = dict(extras_node)
                extras_node["spawner"] = {
                    "name": inst.template,
                    "minSpawnDelay": window[0],
                    "maxSpawnDelay": window[1],
                }
                placed.extras = extras_node
            spawner_nodes.append(node)
            object_report["spawners"] += 1
        if spawner_nodes:
            roots.append(builder.add_node(gltf.Node(
                name="spawners",
                children=spawner_nodes,
                extras={"kind": "spawners"},
            )))
        flag_nodes: list[int] = []
        flag_fail: set[str] = set()
        for inst in info.gameplay.control_points:
            tpl = info.gameplay.template_for(inst)
            if tpl is None or not tpl.visible:
                continue
            node = _place_template(
                assembler, builder, inst.template, inst, report, flag_fail)
            if node is None:
                # The fourth zone-only mechanism: a geometry that resolves but
                # carries no drawable primitive (Interstate 82's 53-byte
                # `nothing.sm`). Only the assembler can see that.
                continue
            flag_nodes.append(node)
            placed_flags.add(inst.template.lower())
            object_report["controlPoints"] += 1
            # The cloth, skinned and animated. Its joints hang under the
            # control point node so they inherit its placement; the mesh node
            # goes to the scene root because glTF ignores a skinned mesh
            # node's own transform.
            team = inst.team if inst.team is not None else tpl.team
            cloth_mesh = tpl.flag_mesh(team)
            if not cloth_mesh:
                continue          # neutral: pole only, no cloth to fly
            built = _build_flag_cloth(
                builder, assembler, assembler.meshes, assembler.library,
                cloth_mesh, tpl.flag_offset, report, inst.template)
            if built is None:
                object_report.setdefault("flagsUnskinned", []).append(cloth_mesh)
                continue
            anchor, mesh_node = built
            builder._nodes[node].children.append(anchor)
            roots.append(mesh_node)
            object_report["flagCloths"] = object_report.get("flagCloths", 0) + 1
        if flag_nodes:
            roots.append(builder.add_node(gltf.Node(
                name="controlPoints",
                children=flag_nodes,
                extras={"kind": "controlPoints"},
            )))
        # After every placement, so one clip covers every instance sharing a
        # period — the level's nine radar-bunker dishes turn on one timeline.
        object_report["rotatingParts"] = assembler.flush_animations(builder)
        object_report["parts"] = report.parts
        object_report["triangles"] = report.triangles
        object_report["texturesResolved"] = len(report.resolved_textures)
        object_report["texturesMissing"] = sorted(set(report.missing_textures))
        object_report["unresolvedTemplates"] = sorted(set(report.unresolved_templates))
        object_report["missingMeshes"] = sorted(set(report.missing_meshes))
        object_report["lightmaps"] = len(lightmaps or {})
        # The hull budget, so the viewer can size its index before it walks the
        # scene and a load bar can account for it. These are the *unique* hulls
        # in the glb buffer — one per geometry, shared by every placement of it
        # — which is why the number is two orders smaller than the world-space
        # triangle count the viewer ends up holding.
        if assembler.include_collision:
            object_report["collision"] = {
                "parts": report.collision_parts,
                "triangles": report.collision_triangles,
                "materials": sorted(set(report.collision_materials)),
                "fromOtherLod": sorted(set(report.collision_makeup)),
            }

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
    # A level with no live fogStart/fogEnd still fogs in-game: Setup defaults
    # are 1/2 m, then Game.setViewDistance (lnxded 0x080c6e20) retunes the
    # range using a 0.5f factor (0x86b05e8). Derive an undeclared range from
    # the view distance the same way. Do not honour fogLinearStart/End —
    # those strings are not in BF1942.exe.
    fog_end = info.fog_end if info.fog_end is not None else view_distance
    fog_start = info.fog_start if info.fog_start is not None else view_distance * 0.5

    # Load ticket configuration from GameTypes/*.con if present.
    tickets_data = load_tickets(files, info.gameplay.mode)
    tickets = None
    if tickets_data and (tickets_data.team1 is not None or tickets_data.team2 is not None):
        tickets = {"mode": tickets_data.mode}
        if tickets_data.team1 is not None:
            tickets["team1"] = tickets_data.team1
        if tickets_data.team2 is not None:
            tickets["team2"] = tickets_data.team2
        if tickets_data.loss_per_min_team1 is not None or tickets_data.loss_per_min_team2 is not None:
            tickets["lossPerMin"] = {}
            if tickets_data.loss_per_min_team1 is not None:
                tickets["lossPerMin"]["team1"] = tickets_data.loss_per_min_team1
            if tickets_data.loss_per_min_team2 is not None:
                tickets["lossPerMin"]["team2"] = tickets_data.loss_per_min_team2

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
        "gameplayMode": info.gameplay.mode or None,
        "controlPoints": _control_point_report(info, placed_flags),
        "soldierSpawns": _soldier_spawn_report(info),
        "objectSpawns": _object_spawn_report(info),
        "tickets": tickets,
        # `image` is filled in by `write_minimap` once the art is decoded; the
        # projection is known from the con files alone and stands on its own.
        "minimap": {"image": None, "worldToImage": _world_to_image(info)},
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
    ap.add_argument("--no-collision", action="store_true",
                    help="leave the collision hulls out of the glb. They are "
                         "never drawn and cost about one percent of the scene, "
                         "but a consumer that only wants pictures does not "
                         "need them, and this reproduces the older export.")
    ap.add_argument("--shared-sounds", type=Path, default=None,
                    help="directory every level's samples are deduplicated "
                         "into (default: <out>/_shared/sounds). scene.json "
                         "references it relatively, so it must stay inside the "
                         "tree that gets published.")
    ap.add_argument("--final-out", type=Path, default=None,
                    help="the maps root this level will live under once it is "
                         "published, when that differs from --out (default: "
                         "--out). Only affects the relative sound paths "
                         "written into scene.json — `extract_maps_all.py` "
                         "stages each level in its own directory and moves it "
                         "afterwards, so the write location is the wrong base "
                         "to measure those paths from.")
    ap.add_argument("--audio-format", choices=("mp3", "wav"), default="mp3",
                    help="mp3 (default) transcodes samples to LAME -V2, which "
                         "measured sample-exact through decodeAudioData so "
                         "engine layers still loop seamlessly; wav keeps the "
                         "raw PCM at roughly 8x the bytes")
    args = ap.parse_args()

    # Checked before any extraction rather than at the first sample: a level is
    # minutes of work, and a batch run is hours of it. Failing at the point the
    # encoder is missing — instead of after the terrain, objects and lightmaps
    # are already built — is the difference between a one-line fix and a
    # wasted run.
    if args.audio_format == "mp3" and not ffmpeg_available():
        sys.exit("ffmpeg is not on PATH, so samples cannot be transcoded.\n"
                 "Install it, or pass --audio-format wav to keep raw PCM "
                 "(roughly 8x the bytes).")

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
    meshes, textures, objects, game = build_pools(chain, fallbacks)
    # `Game.rfa` is the MaterialManager: what every material is worth, what a
    # round of material X does to a surface of material Y, and — the half the
    # model browser never needed — which authored EffectBundle the impact
    # plays. A level that never loads it can collide but cannot show the hit.
    try:
        damage_tables = load_damage_tables(game)
    except Exception as exc:                       # a mod with no Game.rfa
        print(f"damage:   tables unavailable ({exc})", file=sys.stderr)
        damage_tables = None
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
    # And its own meshes: a level's `StandardMesh/` folder is resolved by the
    # engine exactly like the global archive, and it is where every mesh the
    # vanilla extraction used to report missing actually lives.
    for path in paths:
        meshes.add_level_meshes(path, label=f"{info.name} meshes")
    if not args.terrain_only:
        library = build_library(objects)
        # A level's flags are ObjectTemplates like any other, but they live in
        # `<mode>/ControlPointTemplates.con` rather than under `Objects/`, so
        # `add_level_objects` does not see them and `build_library` never reads
        # them. Without this the pole and cloth resolve to nothing and every
        # control point comes out as a bare zone.
        if info.gameplay.mode:
            cpt = files.find(f"{info.gameplay.mode}/ControlPointTemplates.con")
            if cpt:
                library.add_con(cpt, files.read(cpt).decode("latin-1", "replace"))
                detach_flag_cloth(library, info)
        # Re-discover sounds with library available to harvest building ambience
        # (windmills, watermills, factories with loadSoundScript in their templates)
        info.sounds = discover_level_sounds(files, info.static_objects, library, objects)
        lightmaps = write_object_lightmaps(files, out_dir)
        # Collision hulls ride along. They are never drawn — `map.html` hides
        # anything carrying `extras.collision` on load — and they are what a
        # round in flight tests against. The budget is small because the hulls
        # are per *geometry*, not per placement: El Alamein's 898 statics
        # resolve to about 5k unique collision triangles, roughly 0.3 MB of
        # buffer against a 40 MB scene.
        assembler = Assembler(
            meshes, textures, objects, library,
            lod=0, max_texture=args.max_texture,
            include_collision=not args.no_collision,
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
    # Merged into the terrain block rather than sitting beside it: the material
    # ids are addressed on the heightmap's own grid, so they belong with the
    # thing they index.
    if (surfaces := write_terrain_materials(
            files, info, out_dir, damage_tables)) is not None:
        extras["terrain"]["materials"] = surfaces
    # Merge rather than replace: `build_scene` already put the projection in,
    # and a level that ships no art still needs it so markers can be drawn on
    # a blank grid.
    if (minimap := write_minimap(files, out_dir)) is not None:
        extras["minimap"].update(minimap)

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
    # Defaults to a sibling of the level directories so a standalone run and a
    # batch run put samples in the same place; `extract_maps_all.py` passes the
    # real destination explicitly, because its workers write to per-level
    # staging directories that are moved into the tree afterwards.
    shared_dir = args.shared_sounds or (args.out / "_shared" / "sounds")
    final_root = args.final_out or args.out
    # The damage tables are a property of the *mod*, not the level — the same
    # 158 materials, 5,165 modifiers and 4,099 impact effects answer for every
    # map in it. 157 KB once beside the sounds, referenced relatively, rather
    # than 157 KB in each of 23 level directories.
    extras["damage"] = write_damage_tables(
        damage_tables, shared_dir.parent, final_root / info.name.lower(),
        projectile_materials(library))
    extras["sounds"] = extract_sounds(info, files, sounds, out_dir,
                                      library=library, objects=objects,
                                      vehicles=spawned,
                                      shared_dir=shared_dir,
                                      audio_format=args.audio_format,
                                      final_dir=final_root / info.name.lower())

    (out_dir / "scene.glb").write_bytes(glb)
    (out_dir / "scene.json").write_text(json.dumps(extras, indent=2))
    maps_index = args.out / "maps.json"
    listing = []
    if maps_index.is_file():
        try:
            listing = json.loads(maps_index.read_text())
        except json.JSONDecodeError:
            listing = []
    # Keep prior `loading` (and any other keys) from extract_loading_assets —
    # rewriting the whole entry here used to drop every map back to the
    # Western beach fallback in progress.js.
    prior = next(
        (e for e in listing if e.get("name", "").lower() == info.name.lower()),
        None,
    )
    listing = [e for e in listing if e.get("name", "").lower() != info.name.lower()]
    entry = {
        "name": info.name,
        "mod": args.mod,
        "glb": f"{info.name.lower()}/scene.glb",
        "report": f"{info.name.lower()}/scene.json",
        "worldSize": info.terrain.world_size,
        "tiles": extras["terrain"]["tiles"],
        "objects": extras["objects"]["placed"],
    }
    if isinstance(prior, dict):
        for key, value in prior.items():
            if key not in entry:
                entry[key] = value
    listing.append(entry)
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
        try:
            width, height, rgba = decode_dds(files.read(path))
        except Exception as exc:
            # A cubemap is all six faces or none, and one unreadable face must
            # not cost the level. Secret Weapons ships `env_EaglesNest_06.dds`
            # with a scrambled header — it is the right length for the 128x128
            # DXT1 its five clean siblings are, so only the header is wrong, and
            # the engine loads Eagle's Nest regardless. Letting the exception out
            # took a 1024 m map down over one skybox face.
            print(f"  skybox face {face} ({path}): {exc}; extracting without a sky",
                  file=sys.stderr)
            return None
        rgba = _mirror_rgba(width, height, rgba, _FACE_MIRROR[face])
        (sky_dir / f"{face}.png").write_bytes(
            encode_png(width, height, rgba, drop_alpha=True))
        written.append(f"sky/{face}.png")
    return written


if __name__ == "__main__":
    raise SystemExit(main())
