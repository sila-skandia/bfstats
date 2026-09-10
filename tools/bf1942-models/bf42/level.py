"""Level archive contents that are not vehicles: terrain config, height, props.

A level `.rfa` is a complete scene description. `Init/Terrain.con` names the
heightmap, the world size in metres, the water plane and which Tx tiles paint
the ground. `StaticObjects.con` is the same `Object.create` language as a vehicle
template, but each record is an instance already placed in the world.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass, field
from pathlib import Path

from . import con as con_mod
from .rfa import RfaArchive, find_archives_dir

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


def find_level_archives(game_dir: Path, mod: str, level: str) -> list[Path]:
    """Base level archive plus patches, in overlay order (later wins)."""
    mods_dir = game_dir / "Mods"
    if not mods_dir.is_dir():
        return []
    by_lower = {d.name.lower(): d for d in mods_dir.iterdir() if d.is_dir()}
    mod_dir = by_lower.get(mod.lower())
    if mod_dir is None:
        return []
    archives = find_archives_dir(mod_dir)
    if archives is None:
        return []
    levels_dir = None
    for child in archives.iterdir():
        if child.is_dir() and child.name.lower() == mod_dir.name.lower():
            for sub in child.iterdir():
                if sub.is_dir() and sub.name.lower() == "levels":
                    levels_dir = sub
                    break
    if levels_dir is None:
        return []
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


def parse_init_con(text: str, info: LevelInfo) -> None:
    for ns, cmd, args in _commands(text):
        tokens = args.split()
        if ns == "renderer":
            if cmd == "fogcolorvec" and tokens:
                try:
                    info.fog_color = con_mod.vec3(tokens[0])
                except ValueError:
                    pass
            elif cmd == "foglinearstart" and tokens:
                info.fog_start = float(tokens[0])
            elif cmd == "foglinearend" and tokens:
                info.fog_end = float(tokens[0])
        elif ns == "sky" and cmd == "sunlightdirectionvec" and tokens:
            try:
                info.sun_direction = con_mod.vec3(tokens[0])
            except ValueError:
                pass
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
        elif ns == "water" and cmd == "color" and tokens:
            try:
                info.water_color = con_mod.vec3(tokens[0])
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
