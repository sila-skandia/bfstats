"""Level archive contents that are not vehicles: terrain config, height, props.

A level `.rfa` is a complete scene description. `Init/Terrain.con` names the
heightmap, the world size in metres, the water plane and which Tx tiles paint
the ground. `StaticObjects.con` is the same `Object.create` language as a vehicle
template, but each record is an instance already placed in the world.
"""

from __future__ import annotations

import math
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path

from . import con as con_mod
from .rfa import RfaArchive, find_archives_dir, find_levels_dir

PATCH_METERS = 256.0
# Heightmap samples are 8.8 fixed-point: 65535 corresponds to 256 * yScale metres.
HEIGHT_UNITS = 256.0


def _norm_path(name: str) -> str:
    return name.replace("\\", "/").lower()


@dataclass
class TerrainInfo:
    world_size: float = 1024.0
    y_scale: float = 0.6
    material_size: int | None = None
    water_level: float = 0.0
    sea_floor_level: float = 0.0
    tex_base: str = ""
    tex_offset_x: int = 0
    tex_offset_y: int = 0
    detail_tex: str = ""


@dataclass
class StaticInstance:
    template: str
    position: tuple[float, float, float]
    rotation: tuple[float, float, float]
    team: int | None = None


@dataclass
class SpawnTemplate:
    name: str
    vehicles: dict[int, str] = field(default_factory=dict)
    owner_team: int | None = None


@dataclass
class SkyInfo:
    """The sky the engine actually draws: a StandardMesh box, not the env map.

    `Init/SkyAndSun.con` creates a `SkyBox` geometry template, points it at a
    `Sky_<level>_m1.sm` (six one-quad materials, one 512px texture per face) and
    calls `Sky.initSky`. `ENVMAP_G_.rcm` is something else entirely — it is the
    `ShaderManager.setTextureParam envmap` reflection source, six 128px faces.
    """

    mesh: str = ""                    # GeometryTemplate.file preceding Sky.initSky
    rot_angle: float = 0.0            # Sky.setRotAngle, degrees about +Y
    height_offset: float = 0.0        # sky.changeOfsSkyHeight, metres
    has_cloud: bool = False           # Sky.addCloud
    cloud_texture: str = "texture/cloud1"
    cloud_speed: tuple[float, float] = (0.0, 0.0)   # Cloud.setSpeed u v (two tokens)
    cloud_tex_scale: float = 8.0      # Cloud.setTexScale
    cloud_height: float = 3500.0      # Cloud.setHeight, sky-mesh units
    cloud_ofs_height: float = 0.0     # Sky.changeOfsCloudHeight
    cloud_dist: float = 0.0           # Sky.changeOfsCloudDist


@dataclass
class WaterInfo:
    """Every `water.*` console setting a level declares.

    The engine's water is not a colour: `WaterShader.rs` at the level root is an
    empty `"PatchTerrain/Water"` subshader, so the whole effect is driven by
    these settings — two scrolling colour layers, a scrolling normal map, a
    depth-based colour and alpha ramp, and a specular streak off the sun.
    """

    tex_layer1: str = ""
    tex_layer2: str = ""
    normal_map: str = ""
    scroll_dir1: tuple[float, float] = (1.0, 0.0)
    scroll_dir2: tuple[float, float] = (0.0, 1.0)
    scroll_dir_normal: tuple[float, float] = (1.0, 1.0)
    scroll1: float = 0.0
    scroll2: float = 0.0
    scroll_normal: float = 0.0
    tile1: float = 0.5
    tile2: float = 0.5
    tile_normal: float = 1.0
    specular: bool = False
    specular_color: tuple[float, float, float] = (1.0, 1.0, 1.0)
    streak_factor: float = 0.0
    light_direction: tuple[float, float, float] = (-0.3, 0.5, -0.65)
    color: tuple[float, float, float] | None = None
    deep_color: tuple[float, float, float] | None = None
    shallow_color: tuple[float, float, float] | None = None
    shallow_alpha: float = 1.0        # water.waterShallowAlpha
    alpha_depth: float = 0.0          # water.waterAlphaDepth, metres to full alpha
    color_depth: float = 10.0         # water.waterColordepth, metres to deep colour

    @property
    def declared(self) -> bool:
        return bool(self.tex_layer1 or self.color or self.shallow_color)


@dataclass
class LightingInfo:
    """`renderer.*` light colours a level sets in `Init.con`."""

    ambient_color: tuple[float, float, float] | None = None
    diffuse_color: tuple[float, float, float] | None = None
    global_ambient: tuple[float, float, float] | None = None
    specular_color: tuple[float, float, float] | None = None
    shadow_color: float | None = None


@dataclass
class CombatArea:
    min_x: float
    min_z: float
    size_x: float
    size_z: float

    @property
    def max_x(self) -> float:
        return self.min_x + self.size_x

    @property
    def max_z(self) -> float:
        return self.min_z + self.size_z


@dataclass
class SoundPatch:
    level: str
    file: str
    loop: bool = False
    volume: float = 1.0
    min_distance: float = 1.0
    near_distance: float | None = None
    far_distance: float | None = None
    ramp_start_val: float | None = None
    ramp_delta_val: float | None = None


@dataclass
class AmbientSoundInfo:
    file: str
    volume: float = 1.0


@dataclass
class AreaSoundTemplate:
    name: str
    kind: str  # "areaobject" or "simpleobject"
    ssc_file: str = ""
    trigger_radius: float = 40.0
    line_points: list[tuple[float, float]] = field(default_factory=list)


@dataclass
class PlacedAreaSound:
    name: str
    file: str
    volume: float = 1.0
    near_distance: float = 40.0
    far_distance: float = 80.0
    points: list[list[float]] = field(default_factory=list)


@dataclass
class LevelSounds:
    ambient: AmbientSoundInfo | None = None
    areas: list[PlacedAreaSound] = field(default_factory=list)


@dataclass
class LevelInfo:
    name: str
    terrain: TerrainInfo
    combat: CombatArea | None = None
    fog_color: tuple[float, float, float] = (0.7, 0.7, 0.7)
    fog_start: float = 200.0
    fog_end: float = 700.0
    sun_direction: tuple[float, float, float] = (-0.4, 0.7, -0.4)
    water_color: tuple[float, float, float] = (0.4, 0.5, 0.55)
    camera: tuple[float, float, float] | None = None
    static_objects: list[StaticInstance] = field(default_factory=list)
    spawn_templates: dict[str, SpawnTemplate] = field(default_factory=dict)
    spawn_objects: list[StaticInstance] = field(default_factory=list)
    sky: SkyInfo = field(default_factory=SkyInfo)
    water: WaterInfo = field(default_factory=WaterInfo)
    lighting: LightingInfo = field(default_factory=LightingInfo)
    view_distance: float | None = None      # renderer.setViewdistance
    texture_alternative_path: str = ""      # textureManager.alternativePath
    sounds: LevelSounds = field(default_factory=LevelSounds)


@dataclass
class Heightmap:
    dim: int
    spacing: float
    y_scale: float
    samples: list[int]

    def height_at(self, ix: int, iz: int) -> float:
        ix = max(0, min(self.dim - 1, ix))
        iz = max(0, min(self.dim - 1, iz))
        raw = self.samples[iz * self.dim + ix]
        return raw / 65535.0 * (HEIGHT_UNITS * self.y_scale)

    def world_to_index(self, x: float, z: float) -> tuple[int, int]:
        return (
            int(round(x / self.spacing)),
            int(round(z / self.spacing)),
        )


class LevelFiles:
    """Merged view of a level's base archive plus numbered patches.

    Later archives win, which is how `Tobruk_003.rfa` overlays `Tobruk.rfa`.
    Lookups are case-insensitive and accept paths relative to the level folder.
    """

    def __init__(self, archives: list[RfaArchive], level_name: str):
        self.archives = archives
        self.level_name = level_name
        self._index: dict[str, tuple[RfaArchive, str]] = {}
        prefix_tail = f"/levels/{level_name.lower()}/"
        for archive in archives:
            for name in archive.entries:
                key = _norm_path(name)
                self._index[key] = (archive, name)
                cut = key.find(prefix_tail)
                if cut >= 0:
                    rel = key[cut + len(prefix_tail):]
                    self._index[rel] = (archive, name)

    def read(self, relative: str) -> bytes:
        hit = self._index.get(_norm_path(relative))
        if hit is None:
            raise KeyError(relative)
        archive, real = hit
        return archive.read(real)

    def find(self, relative: str) -> str | None:
        hit = self._index.get(_norm_path(relative))
        return hit[1] if hit else None

    def names(self) -> list[str]:
        return [real for _, real in self._index.values()]

    def tiles(self) -> list[tuple[int, int, str]]:
        """`(col, row, archive_path)` for every `Textures/TxCCxRR` tile."""
        found: list[tuple[int, int, str]] = []
        for key, (_archive, real) in self._index.items():
            parts = key.replace("\\", "/").split("/")
            if "textures" not in parts:
                continue
            stem = parts[-1]
            if not stem.startswith("tx") or not stem.endswith(".dds") or "x" not in stem[2:]:
                continue
            body = stem[2:].removesuffix(".dds")
            col_s, _, row_s = body.partition("x")
            if not col_s.isdigit() or not row_s.isdigit():
                continue
            found.append((int(col_s), int(row_s), real))
        # The relative-path aliases duplicate each tile; unique on (col, row).
        by_cell: dict[tuple[int, int], str] = {}
        for col, row, real in found:
            by_cell[(col, row)] = real
        return [(c, r, p) for (c, r), p in sorted(by_cell.items())]


def _level_archives_in(levels_dir: Path, level: str) -> list[Path]:
    """`<level>.rfa` plus its numbered patches, base before patch."""
    wanted = level.lower()
    found: list[Path] = []
    for child in sorted(levels_dir.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_file() or child.suffix.lower() != ".rfa":
            continue
        stem = child.stem
        if stem.lower() == wanted:
            found.append(child)
            continue
        if "_" not in stem:
            continue
        base, _, suffix = stem.rpartition("_")
        if base.lower() == wanted and suffix.isdigit():
            found.append(child)
    return found


def find_level_archives(game_dir: Path, mod: str, level: str, *,
                        chain: list[Path] | None = None) -> list[Path]:
    """Base level archive plus patches, in overlay order (later wins).

    Levels always live in `Archives/bf1942/levels/`, never in a folder named
    after the mod: both `Game.rfa` and every level archive hold paths that start
    `bf1942/`, and Refractor mounts an archive at its own path prefix. See
    `rfa.find_game_dir`.

    `chain` is the mod's inheritance chain nearest-first (what `mod_chain`
    returns). The parents are searched too and their archives placed *first*, so
    a mod map that only ships `Init.con` and `ObjectSpawnTemplates.con` still
    resolves `Terrain.con` and the heightmap out of the parent's copy of the
    same level — the underlay the engine gets for free from `addModPath`.
    """
    mods_dir = game_dir / "Mods"
    if not mods_dir.is_dir():
        return []
    by_lower = {d.name.lower(): d for d in mods_dir.iterdir() if d.is_dir()}
    if chain is None:
        mod_dir = by_lower.get(mod.lower())
        if mod_dir is None:
            return []
        chain = [mod_dir]

    found: list[Path] = []
    # Farthest ancestor first: LevelFiles lets later archives win, and the
    # nearest mod is the one whose files must win.
    for mod_dir in reversed(chain):
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        levels_dir = find_levels_dir(archives)
        if levels_dir is None:
            continue
        found.extend(_level_archives_in(levels_dir, level))
    return found


def load_level_files(paths: list[Path], level: str) -> LevelFiles:
    return LevelFiles([RfaArchive(path) for path in paths], level)


def parse_terrain_con(text: str) -> TerrainInfo:
    info = TerrainInfo()
    for ns, cmd, args in _commands(text):
        if ns != "geometrytemplate" or not args:
            continue
        token = args.split()[0]
        if cmd == "worldsize":
            info.world_size = float(token)
        elif cmd == "yscale":
            info.y_scale = float(token)
        elif cmd == "materialsize":
            info.material_size = int(float(token))
        elif cmd == "waterlevel":
            info.water_level = float(token)
        elif cmd == "seafloorlevel":
            info.sea_floor_level = float(token)
        elif cmd == "texbasename":
            info.tex_base = token.replace("\\", "/")
        elif cmd == "texoffsetx":
            info.tex_offset_x = int(float(token))
        elif cmd == "texoffsety":
            info.tex_offset_y = int(float(token))
        elif cmd == "detailtexname":
            info.detail_tex = token.replace("\\", "/")
    return info


def parse_static_objects(text: str) -> list[StaticInstance]:
    instances: list[StaticInstance] = []
    current: StaticInstance | None = None
    for ns, cmd, args in _commands(text):
        if ns != "object":
            continue
        if cmd == "create":
            name = args.split()[0] if args else ""
            current = StaticInstance(name, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
            instances.append(current)
        elif current is None:
            continue
        elif cmd == "absoluteposition":
            try:
                current.position = con_mod.vec3(args.split()[0])
            except ValueError:
                continue
        elif cmd == "rotation":
            try:
                current.rotation = con_mod.vec3(args.split()[0])
            except ValueError:
                continue
        elif cmd == "setteam":
            try:
                current.team = int(float(args.split()[0]))
            except (ValueError, IndexError):
                continue
    return instances


def parse_spawn_templates(text: str) -> dict[str, SpawnTemplate]:
    """`ObjectSpawner` name -> the vehicle each team gets from it."""
    out: dict[str, SpawnTemplate] = {}
    current: SpawnTemplate | None = None
    for ns, cmd, args in _commands(text):
        if ns != "objecttemplate":
            continue
        tokens = args.split()
        if cmd == "create":
            current = None
            if len(tokens) >= 2 and tokens[0].lower() == "objectspawner":
                current = SpawnTemplate(name=tokens[1])
                out[tokens[1].lower()] = current
        elif current is None:
            continue
        elif cmd == "setobjecttemplate" and len(tokens) >= 2:
            try:
                team = int(tokens[0])
            except ValueError:
                continue
            name = tokens[1]
            if team in (1, 2) and name.lower() not in ("none", "paratrooperspawnobject"):
                current.vehicles[team] = name
        elif cmd == "teamonvehicle" and tokens:
            try:
                team = int(tokens[0])
            except ValueError:
                continue
            if team in (1, 2):
                current.owner_team = team
    return out


def spawn_vehicle(spawner: str, team: int | None,
                  templates: dict[str, SpawnTemplate]) -> str | None:
    spec = templates.get(spawner.lower())
    if spec is None:
        return None
    if spec.owner_team is not None:
        team = spec.owner_team
    if team is not None and team in spec.vehicles:
        return spec.vehicles[team]
    return spec.vehicles.get(2) or spec.vehicles.get(1)


# Refractor +Z is glTF -Z after the exporter mirrors the world.
_RCM_TO_GLTF = {
    "positivex": "px",
    "negativex": "nx",
    "positivey": "py",
    "negativey": "ny",
    "positivez": "nz",
    "negativez": "pz",
}


def parse_cubemap_rcm(text: str) -> dict[str, str]:
    """glTF-axis cubemap faces (`px`/`nx`/...) from an `ENVMAP_*.rcm`."""
    faces: dict[str, str] = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        face = _RCM_TO_GLTF.get(key.strip().lower())
        if face is None:
            continue
        path = value.strip().strip('"').replace("\\", "/")
        if path:
            faces[face] = path
    return faces


def _color3(token: str) -> tuple[float, float, float]:
    """`0.63/0.59/0.33` as a vec3; a bare `0.5` is grey (Wake's deepColor)."""
    try:
        return con_mod.vec3(token)
    except ValueError:
        v = float(token)
        return (v, v, v)


def _vec2(tokens: list[str]) -> tuple[float, float]:
    """`1/0` in one token, or `-0.03 0.015` in two (Cloud.setSpeed)."""
    if len(tokens) >= 2:
        return (float(tokens[0]), float(tokens[1]))
    a, _, b = tokens[0].partition("/")
    return (float(a), float(b or 0.0))


def parse_init_con(text: str, info: LevelInfo) -> None:
    # `GeometryTemplate.file` is stateful: the file loaded right before
    # `Sky.initSky` is the sky box mesh. Comment lines are already stripped, so
    # the REM'd cloud geometry in vanilla SkyAndSun.con does not shadow it.
    pending_geometry_file: str | None = None
    for ns, cmd, args in _commands(text):
        tokens = args.split()
        if ns == "geometrytemplate" and cmd == "file" and tokens:
            pending_geometry_file = tokens[0].replace("\\", "/").rsplit("/", 1)[-1]
        elif ns == "renderer":
            if cmd == "fogcolorvec" and tokens:
                try:
                    info.fog_color = con_mod.vec3(tokens[0])
                except ValueError:
                    pass
            elif cmd == "foglinearstart" and tokens:
                info.fog_start = float(tokens[0])
            elif cmd == "foglinearend" and tokens:
                info.fog_end = float(tokens[0])
            elif cmd == "setviewdistance" and tokens:
                info.view_distance = float(tokens[0])
            elif cmd == "ambientcolor" and tokens:
                info.lighting.ambient_color = _color3(tokens[0])
            elif cmd == "diffusecolor" and tokens:
                info.lighting.diffuse_color = _color3(tokens[0])
            elif cmd == "globalambientcolor" and tokens:
                info.lighting.global_ambient = _color3(tokens[0])
            elif cmd == "specularcolor" and tokens:
                info.lighting.specular_color = _color3(tokens[0])
        elif ns == "shadow" and cmd == "shadowcolor" and tokens:
            try:
                info.lighting.shadow_color = float(tokens[0])
            except ValueError:
                pass
        elif ns == "texturemanager" and cmd == "alternativepath" and tokens:
            info.texture_alternative_path = tokens[0].replace("\\", "/").strip("/")
        elif ns == "sky":
            if cmd == "sunlightdirectionvec" and tokens:
                try:
                    info.sun_direction = con_mod.vec3(tokens[0])
                except ValueError:
                    pass
            elif cmd == "initsky":
                if pending_geometry_file:
                    info.sky.mesh = pending_geometry_file
            elif cmd == "setrotangle" and tokens:
                info.sky.rot_angle = float(tokens[0])
            elif cmd == "changeofsskyheight" and tokens:
                info.sky.height_offset = float(tokens[0])
            elif cmd == "addcloud":
                info.sky.has_cloud = True
            elif cmd == "changeofscloudheight" and tokens:
                info.sky.cloud_ofs_height = float(tokens[0])
            elif cmd == "changeofsclouddist" and tokens:
                info.sky.cloud_dist = float(tokens[0])
        elif ns == "cloud":
            if cmd == "setspeed" and tokens:
                try:
                    info.sky.cloud_speed = _vec2(tokens)
                except ValueError:
                    pass
            elif cmd == "settexscale" and tokens:
                info.sky.cloud_tex_scale = float(tokens[0])
            elif cmd == "setheight" and tokens:
                info.sky.cloud_height = float(tokens[0])
        elif ns == "game":
            if cmd == "setactivecombatarea" and len(tokens) >= 4:
                info.combat = CombatArea(
                    float(tokens[0]), float(tokens[1]),
                    float(tokens[2]), float(tokens[3]),
                )
            elif cmd == "setbeforespawncameraposition" and len(tokens) >= 2:
                try:
                    info.camera = con_mod.vec3(tokens[1])
                except (ValueError, IndexError):
                    pass
        elif ns == "water":
            _parse_water(info, cmd, tokens)


def _parse_water(info: LevelInfo, cmd: str, tokens: list[str]) -> None:
    if not tokens:
        if cmd == "specularenable":
            info.water.specular = True
        return
    w = info.water
    try:
        if cmd == "color":
            w.color = _color3(tokens[0])
            info.water_color = w.color        # kept for older scene.json readers
        elif cmd == "deepcolor":
            w.deep_color = _color3(tokens[0])
        elif cmd == "shallowcolor":
            w.shallow_color = _color3(tokens[0])
        elif cmd == "texlayer1":
            w.tex_layer1 = tokens[0].replace("\\", "/")
        elif cmd == "texlayer2":
            w.tex_layer2 = tokens[0].replace("\\", "/")
        elif cmd == "normalmap":
            w.normal_map = tokens[0].replace("\\", "/")
        elif cmd == "scrolldirection1":
            w.scroll_dir1 = _vec2(tokens)
        elif cmd == "scrolldirection2":
            w.scroll_dir2 = _vec2(tokens)
        elif cmd == "scrolldirectionnormalmap":
            w.scroll_dir_normal = _vec2(tokens)
        elif cmd == "scrolllayer1":
            w.scroll1 = float(tokens[0])
        elif cmd == "scrolllayer2":
            w.scroll2 = float(tokens[0])
        elif cmd == "scrollnormalmap":
            w.scroll_normal = float(tokens[0])
        elif cmd == "tilelayer1":
            w.tile1 = float(tokens[0])
        elif cmd == "tilelayer2":
            w.tile2 = float(tokens[0])
        elif cmd == "tilenormalmap":
            w.tile_normal = float(tokens[0])
        elif cmd == "specularenable":
            w.specular = tokens[0].strip() not in ("0", "false")
        elif cmd == "specularcolor":
            w.specular_color = _color3(tokens[0])
        elif cmd == "specularstreakfactor":
            w.streak_factor = float(tokens[0])
        elif cmd == "lightdirection":
            w.light_direction = con_mod.vec3(tokens[0])
        elif cmd == "watershallowalpha":
            w.shallow_alpha = float(tokens[0])
        elif cmd == "wateralphadepth":
            w.alpha_depth = float(tokens[0])
        elif cmd == "watercolordepth":
            w.color_depth = float(tokens[0])
    except ValueError:
        pass


def decode_heightmap(data: bytes, world_size: float, y_scale: float) -> Heightmap:
    if len(data) < 2 or len(data) % 2:
        raise ValueError(f"heightmap length {len(data)} is not a uint16 grid")
    samples_n = len(data) // 2
    dim = int(math.isqrt(samples_n))
    if dim * dim != samples_n:
        raise ValueError(f"heightmap is not square ({samples_n} samples)")
    samples = list(struct.unpack(f"<{samples_n}H", data))
    spacing = world_size / dim
    return Heightmap(dim=dim, spacing=spacing, y_scale=y_scale, samples=samples)


_LIGHTMAP_NAME = re.compile(
    r"(?P<stem>[^/\\]+)_(?P<x>-?\d+)-(?P<y>-?\d+)-(?P<z>-?\d+)\.(?:tga|dds)$",
    re.IGNORECASE,
)


def parse_object_lightmap_name(path: str) -> tuple[str, int, int, int] | None:
    """`barack_m1_1703-67-547.tga` -> mesh stem plus truncated world position."""
    leaf = path.replace("\\", "/").rsplit("/", 1)[-1]
    match = _LIGHTMAP_NAME.search(leaf)
    if match is None:
        return None
    return (
        match.group("stem").lower(),
        int(match.group("x")),
        int(match.group("y")),
        int(match.group("z")),
    )


def object_lightmap_key(mesh_file: str, position: tuple[float, float, float],
                        ) -> tuple[str, int, int, int]:
    stem = mesh_file.replace("\\", "/").rsplit("/", 1)[-1]
    if stem.lower().endswith(".sm"):
        stem = stem[:-3]
    x, y, z = position
    return stem.lower(), int(x), int(y), int(z)


def index_object_lightmaps(files: "LevelFiles") -> dict[tuple[str, int, int, int], str]:
    """Archive path for each baked object lightmap, keyed by mesh and position."""
    out: dict[tuple[str, int, int, int], str] = {}
    for name in files.names():
        if "objectlightmap" not in name.lower():
            continue
        parsed = parse_object_lightmap_name(name)
        if parsed is not None:
            out[parsed] = name
    return out


def tile_world_origin(tex_offset_x: int, tex_offset_y: int,
                      col: int, row: int,
                      patch: float = PATCH_METERS) -> tuple[float, float]:
    """World-space southwest corner of `Tx{col}x{row}`.

    `texOffset` is the world patch index of Tx00x00 when the files are numbered
    from zero (Wake, Midway, Tobruk). When the offset is 0 the filename *is*
    the world patch (Berlin's Tx06x06). A negative offset means "unused patches
    on that axis" — Tobruk's `texOffsetY -10` with only rows 0-5 shipped — so
    it does not shift the origin.
    """
    origin_x = max(tex_offset_x, 0) * patch
    origin_z = max(tex_offset_y, 0) * patch
    return origin_x + col * patch, origin_z + row * patch


def _commands(text: str) -> list[tuple[str, str, str]]:
    text = con_mod.strip_comments(text)
    out: list[tuple[str, str, str]] = []
    for line in text.splitlines():
        match = con_mod._COMMAND.match(line.strip())
        if match:
            ns, cmd, args = match.group(1).lower(), match.group(2).lower(), match.group(3) or ""
            out.append((ns, cmd, args))
    return out


def parse_ssc(text: str) -> list[SoundPatch]:
    """Parse a Refractor .ssc sound script into patches with distance ramps."""
    patches: list[SoundPatch] = []
    current: SoundPatch | None = None
    current_level = "high"
    in_effect = False
    ctrl_src = ""
    ctrl_dest = ""
    envelope = ""
    params: list[float] = []

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("rem") or line.startswith("//") or line.startswith("***"):
            continue
        line_lower = line.lower()
        if line_lower.startswith("#templatelevel"):
            parts = line.split()
            if len(parts) > 1:
                current_level = parts[1].lower()
        elif line_lower.startswith("newpatch"):
            current = SoundPatch(level=current_level, file="", loop=False, volume=1.0, min_distance=1.0)
            patches.append(current)
            in_effect = False
        elif line_lower.startswith("begineffect"):
            in_effect = True
            ctrl_src = ""
            ctrl_dest = ""
            envelope = ""
            params = []
        elif line_lower.startswith("endeffect"):
            if in_effect and current is not None:
                if ctrl_src == "distance" and ctrl_dest == "volume" and envelope == "ramp":
                    if len(params) >= 2:
                        current.near_distance = params[0]
                        current.far_distance = params[1]
                    if len(params) >= 4:
                        current.ramp_start_val = params[2]
                        current.ramp_delta_val = params[3]
            in_effect = False
        elif in_effect:
            parts = line.split()
            cmd = parts[0].lower()
            if cmd == "controlsource" and len(parts) > 1:
                ctrl_src = parts[1].lower()
            elif cmd == "controldestination" and len(parts) > 1:
                ctrl_dest = parts[1].lower()
            elif cmd == "envelope" and len(parts) > 1:
                envelope = parts[1].lower()
            elif cmd == "param" and len(parts) > 1:
                try:
                    params.append(float(parts[1]))
                except ValueError:
                    pass
        elif current is not None:
            parts = line.split()
            cmd = parts[0].lower()
            if cmd == "load" and len(parts) > 1:
                current.file = parts[1].replace("\\", "/")
            elif cmd == "loop":
                current.loop = True
            elif cmd.startswith("volume"):
                val_str = parts[1] if len(parts) > 1 else cmd.removeprefix("volume")
                try:
                    current.volume = float(val_str)
                except ValueError:
                    pass
            elif cmd == "mindistance" and len(parts) > 1:
                try:
                    current.min_distance = float(parts[1])
                except ValueError:
                    pass
    return patches


def parse_area_con(text: str) -> AreaSoundTemplate | None:
    """Parse an AreaObject or SimpleObject sound template from a Sounds/*.con file."""
    tmpl: AreaSoundTemplate | None = None
    for ns, cmd, args in _commands(text):
        if ns != "objecttemplate":
            continue
        tokens = args.split()
        if cmd == "create" and len(tokens) >= 2:
            kind = tokens[0].lower()
            name = tokens[1]
            tmpl = AreaSoundTemplate(name=name, kind=kind)
        elif tmpl is None:
            continue
        elif cmd == "loadsoundscript" and tokens:
            tmpl.ssc_file = tokens[0].replace("\\", "/")
        elif cmd == "triggerradius" and tokens:
            try:
                tmpl.trigger_radius = float(tokens[0])
            except ValueError:
                pass
        elif cmd == "addlinepoint" and tokens:
            coords = tokens[0].split("/")
            if len(coords) >= 2:
                try:
                    tmpl.line_points.append((float(coords[0]), float(coords[1])))
                except ValueError:
                    pass
    return tmpl


def discover_level_sounds(files: LevelFiles, static_objects: list[StaticInstance]) -> LevelSounds:
    """Extract ambient environment sound and placed area/coastline sounds."""
    sounds = LevelSounds()

    # 1. Global Ambient Sound from Sounds/Environment.con -> Environment.ssc
    env_ssc_name: str | None = None
    if files.find("Sounds/Environment.con"):
        env_con_txt = files.read("Sounds/Environment.con").decode("latin-1")
        for line in env_con_txt.splitlines():
            line = line.strip()
            if line.lower().startswith("environmentsound.load") and len(line.split()) > 1:
                env_ssc_name = line.split()[-1].replace("\\", "/").strip()
                break
    if not env_ssc_name:
        env_ssc_name = "Environment.ssc"

    for candidate in [f"Sounds/{env_ssc_name}", env_ssc_name]:
        if files.find(candidate):
            ssc_txt = files.read(candidate).decode("latin-1")
            patches = parse_ssc(ssc_txt)
            for p in patches:
                if p.file and not p.file.lower().endswith("silence.wav"):
                    sounds.ambient = AmbientSoundInfo(file=p.file, volume=p.volume)
                    break
            if sounds.ambient is not None:
                break

    # 2. Area and point sound objects from Sounds/*.con
    templates: dict[str, AreaSoundTemplate] = {}
    for name in files.names():
        name_lower = name.lower().replace("\\", "/")
        if "sounds/" in name_lower and name_lower.endswith(".con") and not name_lower.endswith("environment.con"):
            txt = files.read(name).decode("latin-1")
            tmpl = parse_area_con(txt)
            if tmpl is not None:
                templates[tmpl.name.lower()] = tmpl

    # 3. Match templates with placements in static_objects
    for inst in static_objects:
        key = inst.template.lower()
        if key not in templates:
            continue
        tmpl = templates[key]
        if not tmpl.ssc_file:
            continue

        ssc_candidate = tmpl.ssc_file
        ssc_hit = files.find(f"Sounds/{ssc_candidate}") or files.find(ssc_candidate)
        if not ssc_hit:
            continue
        ssc_txt = files.read(ssc_hit).decode("latin-1")
        patches = parse_ssc(ssc_txt)
        patch = None
        for p in patches:
            if p.file and not p.file.lower().endswith("silence.wav"):
                patch = p
                break
        if patch is None:
            continue

        near_dist = patch.near_distance if patch.near_distance is not None else tmpl.trigger_radius
        far_dist = patch.far_distance if patch.far_distance is not None else max(near_dist * 2.0, tmpl.trigger_radius * 2.0)
        ox, oy, oz = inst.position

        yaw_deg = inst.rotation[0]
        yaw_rad = math.radians(yaw_deg)
        cos_y = math.cos(yaw_rad)
        sin_y = math.sin(yaw_rad)

        gltf_points: list[list[float]] = []
        if tmpl.line_points:
            for dx, dz in tmpl.line_points:
                if abs(yaw_deg) > 1e-4:
                    rx = dx * cos_y - dz * sin_y
                    rz = dx * sin_y + dz * cos_y
                else:
                    rx, rz = dx, dz
                wx = ox + rx
                wy = oy
                wz = oz + rz
                # glTF coordinate conversion: negate Z
                gltf_points.append([round(wx, 3), round(wy, 3), round(-wz, 3)])
        else:
            # Point emitter (like Siren)
            gltf_points.append([round(ox, 3), round(oy, 3), round(-oz, 3)])

        vol = patch.volume if patch.volume > 0 else (
            patch.ramp_start_val if patch.ramp_start_val is not None and patch.ramp_start_val > 0 else 0.6
        )
        sounds.areas.append(PlacedAreaSound(
            name=tmpl.name,
            file=patch.file,
            volume=vol,
            near_distance=near_dist,
            far_distance=far_dist,
            points=gltf_points,
        ))

    return sounds

