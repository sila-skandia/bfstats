"""A level's AI scripts: `AI.con`, `AIpathFinding.con` and the `AI/` folder.

The strategic AI (`ai.createSAI`) reads four plain console scripts per level
(`features/bf1942-ai-research-2026-09-21/README.md` §3.6):

* `AI/StrategicAreas.con` — `aiStrategicArea.create <name> <x1>/<z1> <x2>/<z2>
  <radius> [<category>]` boxes with neighbours, object-type flags (`Base`,
  `ControlPoint`, `Front`, `Flank`, `Centre`, `Safe`, `Close`, `AirField`,
  `ChokePoint`, ...), per-vehicle-type order positions, a side, and
  `setTakeable <side> <0|1>`; and the landing zones a landing craft is sent
  to (`AILandingZone.createLandingZone <name> <x1>/<z1> <x2>/<z2>
  <LZXMin|LZZMin|LZXMax|LZZMax>`), attached to an area with
  `attachLandingZone` for the unit types `addLandingZoneUnit` names, and
  `addExpelledUnit`, which keeps a unit type out of an area;
* `AI/conditions.con` — `aiStrategy.createConstantCondition <name>
  <Crisp|Fuzzy> <Equal|EqualSmaller|EqualGreater|...> <Friendly|Enemy>
  <object flag> <value>`, with a strength (`Required`, `AdvisoryNegative`, ...)
  and an abort flag;
* `AI/prerequisites.con` — named bundles of weighted conditions;
* `AI/Strategies.con` — `aiStrategy.createStrategy <name>` with `Aggression`,
  `NumberOfAttacks`, `NumberOfDefences`, `TimeLimit`, a prerequisite and
  `setStrategicObjectsModifier <flag> <factor> [Owned|Hostile|Neutral]`.

`AI.con` adds the side lists (`ai.addSAIStrategy <side> <name>`) and the
bot-manager settings. Everything here is emitted into the scene's `extras.ai`
so the viewer's bots can run the same strategic contest the server does.

Positions are converted to the exporter's glTF frame (`z` negated, as
`bf42/gltf.py` does for every placement), so the viewer reads them as it reads
a control point.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Any

_SPLIT = re.compile(r"\s+")


def _lines(text: str):
    """Console lines with `rem` comments, `beginrem .. endrem` blocks, blanks
    and `if/endIf` scaffolding dropped (the `_003` patch archives wrap every
    script in `if v_arg1 == host`; Guadalcanal's `AIpathFinding.con` parks a
    second `ai.addSearchMap Car4` in a `beginrem` block)."""
    in_block = False
    for raw in text.splitlines():
        line = raw.strip()
        low = line.lower()
        if in_block:
            if low.startswith("endrem"):
                in_block = False
            continue
        if low.startswith("beginrem"):
            in_block = True
            continue
        if not line or low.startswith("rem"):
            continue
        if low.startswith(("if ", "endif", "else", "endif")):
            continue
        yield _SPLIT.split(line)


def _pos(token: str) -> list[float] | None:
    """`x/z` in the engine's frame -> `[x, -z]` in the exporter's."""
    parts = token.split("/")
    if len(parts) < 2:
        return None
    try:
        x, z = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    return [x, -z]


def _num(token: str, default: float | None = None) -> float | None:
    try:
        return float(token)
    except (TypeError, ValueError):
        return default


@dataclass
class StrategicArea:
    name: str
    min: list[float]
    max: list[float]
    radius: float
    neighbours: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    orderPositions: dict[str, list[float]] = field(default_factory=dict)
    allowedVehicleGroups: list[str] = field(default_factory=list)
    side: int | None = None
    vehicleSearchRadius: float | None = None
    takeable: dict[str, bool] = field(default_factory=dict)
    # The fifth word of `aiStrategicArea.create` (`land`, `sea`), when given.
    category: str | None = None
    # `AIStrategicArea.attachLandingZone <zone>` (the area's zone list at
    # +0x144, `attachLandingZone` 0x0863fc90), in the order attached.
    landingZones: list[str] = field(default_factory=list)
    # `addLandingZoneUnit <type>` (the +0x150 bit mask, `addToLandingZoneUsers`
    # 0x08640290 through `AIConsole::addLandingZoneUnit` 0x08471370): the unit
    # types `orderNormalBot` 0x08640bd0 sends to this area's beach.
    landingZoneUnits: list[str] = field(default_factory=list)
    # `addExpelledUnit <type>` (the +0xf4 bit mask, `AIConsole::
    # addExpelledUnit` 0x08471330, read by `isExpelledUnit` 0x08644da0).
    expelledUnits: list[str] = field(default_factory=list)


# `operator>>(istream&, LandingZoneDirection&)` 0x08488e80: `LZXMin` / `XMin` /
# `0` is 0, then ZMin 1, XMax 2, ZMax 3; anything else is `LZUndefined` (4).
LZ_DIRECTIONS = {
    "lzxmin": 0, "xmin": 0, "0": 0,
    "lzzmin": 1, "zmin": 1, "1": 1,
    "lzxmax": 2, "xmax": 2, "2": 2,
    "lzzmax": 3, "zmax": 3, "3": 3,
}
# The beach's edge in the exporter's frame. The engine's z is the exporter's
# -z, so the engine's ZMin edge is the exporter's zMax edge and vice versa.
_LZ_EDGE = {0: "xMin", 1: "zMax", 2: "xMax", 3: "zMin"}


@dataclass
class LandingZone:
    """`AILandingZone` (ctor 0x0863ac80): a corner box, its corners sorted per
    axis, and the side its beach is on. `min` / `max` are in the exporter's
    frame; `direction` is the con's word and `beach` the edge it names in the
    exporter's frame (null for `LZUndefined`)."""
    name: str
    min: list[float]
    max: list[float]
    direction: str
    beach: str | None


@dataclass
class Condition:
    name: str
    kind: str                # Constant | ... (the console word's suffix)
    fuzzy: str               # Crisp | Fuzzy
    op: str                  # Equal | EqualSmaller | EqualGreater | Smaller | Greater
    subject: str             # Friendly | Enemy
    object: str              # a strategic object flag, or StartTime
    value: float
    strength: list[str] = field(default_factory=list)
    abort: bool = False


@dataclass
class Prerequisite:
    name: str
    conditions: list[dict[str, Any]] = field(default_factory=list)   # {name, weight}


@dataclass
class Strategy:
    name: str
    aggression: float | None = None
    attacks: int | None = None
    defences: int | None = None
    timeLimit: float | None = None
    prerequisite: str | None = None
    modifiers: list[dict[str, Any]] = field(default_factory=list)    # {flag, factor, owner}


@dataclass
class LevelAi:
    settings: dict[str, Any] = field(default_factory=dict)
    vehicleGroups: dict[str, list[str]] = field(default_factory=dict)
    strategicAreas: list[StrategicArea] = field(default_factory=list)
    conditions: list[Condition] = field(default_factory=list)
    prerequisites: list[Prerequisite] = field(default_factory=list)
    strategies: list[Strategy] = field(default_factory=list)
    sideStrategies: dict[str, list[str]] = field(default_factory=dict)
    searchMaps: list[dict[str, Any]] = field(default_factory=list)
    # Object template (lower-case) -> `aiTemplatePlugIn.coverValue`, for the
    # templates this level places. Filled by `add_cover_values`.
    coverValues: dict[str, float] = field(default_factory=dict)
    # `AILandingZoneManager::createLandingZone` 0x084741e0, in creation order.
    landingZones: list[LandingZone] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        out = asdict(self)
        return out


def parse_ai_con(text: str, ai: LevelAi) -> None:
    """`AI.con`: the settings the bot manager and the SAI read."""
    s = ai.settings
    for t in _lines(text):
        word = t[0].lower()
        args = t[1:]
        if word == "aisettings.setworldmapsize" and len(args) >= 2:
            s["worldMapSize"] = [_num(args[0]), _num(args[1])]
        elif word in ("aisettings.setviewdistance", "aisettings.viewdistance") and args:
            s["viewDistance"] = _num(args[0])
        elif word == "aisettings.setinformationgriddimension" and args:
            s["informationGridDimension"] = int(_num(args[0]) or 0)
        elif word == "aibotmanager.setlodlevelticks":
            s["lodLevelTicks"] = [_num(a) for a in args]
        elif word == "aibotmanager.setlodlevelpriority":
            s["lodLevelPriority"] = [_num(a) for a in args]
        elif word == "aibotmanager.setplanneddecisionmakingthreshold":
            s["plannedDecisionMakingThreshold"] = [_num(a) for a in args]
        elif word == "aibotmanager.setunplanneddecisionmakingthreshold":
            s["unplannedDecisionMakingThreshold"] = [_num(a) for a in args]
        elif word == "aibotmanager.setdecisionmakinginterleave":
            s["decisionMakingInterleave"] = [_num(a) for a in args]
        elif word == "aibotmanager.setsensingquotient":
            s["sensingQuotient"] = [_num(a) for a in args]
        elif word == "aibotmanager.setsystemquotient":
            s["systemQuotient"] = [_num(a) for a in args]
        elif word == "ai.saimapxdimension" and args:
            s["saiMapX"] = int(_num(args[0]) or 0)
        elif word == "ai.saimapydimension" and args:
            s["saiMapY"] = int(_num(args[0]) or 0)
        elif word == "ai.saienable" and args:
            s["saiEnable"] = bool(int(_num(args[0]) or 0))
        elif word == "ai.addsaistrategy" and len(args) >= 2:
            ai.sideStrategies.setdefault(args[0], []).append(args[1])
        elif word == "ai.setpotentialobstaclemaxspeed" and args:
            s["potentialObstacleMaxSpeed"] = _num(args[0])
        elif word == "ai.setpotentialobstaclemaxage" and args:
            s["potentialObstacleMaxAge"] = _num(args[0])


#: `ai.addSearchMap`'s pyramid levels when the line gives none: the console
#: handler (`ConsoleClass344::executeObjectMethod` 0x084e4880) passes
#: `minLevel 0, maxLevel 2` for eight arguments (`push $0x2; push $0x0` at
#: 0x084e4a02 / 0x084e4a09) and `maxLevel 2` for nine (0x084e499f).
SEARCH_MAP_DEFAULT_LEVELS = (0, 2)


def parse_pathfinding_con(text: str, ai: LevelAi) -> None:
    """`AIpathFinding.con`: the search maps (name / waterHeight(bool) /
    waterDepth / maxSlope / brush / lowClip / hiClip / considerAITypes /
    minLevel / maxLevel). The two levels bound the map's pyramid
    (`LocalMap::LocalMap` 0x085fb590 stores them at +0x24 / +0x28 and builds
    one `CellMap` a level between them, named `<name>Level<L>Map`), so they
    also name the files `ai.loadMaps` reads: `Tank0 ... 0 2` is
    `Tank0Level0Map.raw` .. `Tank0Level2Map.raw`; `Boat2 ... 2 5` starts at
    `Boat2Level2Map.raw`, a 4 m pixel."""
    lo_default, hi_default = SEARCH_MAP_DEFAULT_LEVELS
    for t in _lines(text):
        word = t[0].lower()
        args = t[1:]
        if word == "ai.addsearchmap" and len(args) >= 8:
            lo = int(_num(args[8], lo_default)) if len(args) >= 9 else lo_default
            hi = int(_num(args[9], hi_default)) if len(args) >= 10 else hi_default
            ai.searchMaps.append({
                "name": args[0],
                "waterMap": bool(int(_num(args[1]) or 0)),
                "waterDepth": _num(args[2]),
                "maxSlope": _num(args[3]),
                "brush": _num(args[4]),
                "lowClip": _num(args[5]),
                "hiClip": _num(args[6]),
                "considerAITypes": bool(int(_num(args[7]) or 0)),
                "minLevel": lo,
                "maxLevel": hi,
            })
        elif word == "ai.setsmoothing" and len(args) >= 2:
            ai.settings.setdefault("smoothing", {})[args[0]] = int(_num(args[1]) or 0)
        elif word == "ai.numastarresources" and args:
            ai.settings["aStarResources"] = int(_num(args[0]) or 0)


def parse_strategic_areas(text: str, ai: LevelAi) -> None:
    areas: dict[str, StrategicArea] = {}
    active: StrategicArea | None = None
    group: str | None = None
    for t in _lines(text):
        word = t[0].lower()
        args = t[1:]
        if word == "aistrategicarea.create" and len(args) >= 4:
            lo = _pos(args[1])
            hi = _pos(args[2])
            if lo is None or hi is None:
                continue
            # The engine's z is the exporter's -z, so the box's z bounds swap.
            area = StrategicArea(
                name=args[0],
                min=[min(lo[0], hi[0]), min(lo[1], hi[1])],
                max=[max(lo[0], hi[0]), max(lo[1], hi[1])],
                radius=_num(args[3], 0.0) or 0.0,
                category=args[4] if len(args) >= 5 else None,
            )
            areas[args[0].lower()] = area
            ai.strategicAreas.append(area)
            active = area
        elif word == "aistrategicarea.setactive" and args:
            active = areas.get(args[0].lower())
        elif word == "ailandingzone.createlandingzone" and len(args) >= 3:
            lo = _pos(args[1])
            hi = _pos(args[2])
            if lo is None or hi is None:
                continue
            direction = args[3] if len(args) >= 4 else "LZUndefined"
            ai.landingZones.append(LandingZone(
                name=args[0],
                min=[min(lo[0], hi[0]), min(lo[1], hi[1])],
                max=[max(lo[0], hi[0]), max(lo[1], hi[1])],
                direction=direction,
                beach=_LZ_EDGE.get(LZ_DIRECTIONS.get(direction.lower(), 4)),
            ))
        elif word in ("aisettings.createvehiclegroup", "aistrategicarea.createvehiclegroup") and args:
            # `aiSettings.createVehicleGroup <name>`: a group's index is its
            # creation order (`AISettings::getVehicleGroup(string)` 0x084848d0
            # looks the name up; `getVehicleGroupName(int)` 0x08484900).
            group = args[0]
            ai.vehicleGroups.setdefault(group, [])
        elif word == "aisettings.addvehicletovehiclegroup" and len(args) >= 2:
            # `aiSettings.addVehicleToVehicleGroup <type> <group>`
            # (`AISettings::addVehicleToVehicleGroup` 0x08484860): the unit
            # type (`Game/AIbehaviours.con` `ai.setVehicle <type> <name>`, 7
            # LandingCraft) belongs to the group; `getVehicleGroup(int)`
            # 0x084848b0 reads it back, and the SAI's routes and resource
            # collection test it against an area's `addAllowedVehicleGroup`
            # mask (`AIStrategicObject::allowsSomeVehicleGroups` 0x08644d50).
            ai.vehicleGroups.setdefault(args[1], []).append(args[0])
        elif word == "aistrategicarea.addvehicletype" and args and group:
            ai.vehicleGroups[group].append(args[0])
        elif active is None:
            continue
        elif word == "aistrategicarea.addneighbour" and args:
            active.neighbours.append(args[0])
        elif word == "aistrategicarea.addobjecttypeflag" and args:
            active.flags.append(args[0])
        elif word == "aistrategicarea.setorderposition" and len(args) >= 2:
            p = _pos(args[1])
            if p is not None:
                active.orderPositions[args[0]] = p
        elif word == "aistrategicarea.addallowedvehiclegroup" and args:
            active.allowedVehicleGroups.append(args[0])
        elif word == "aistrategicarea.setside" and args:
            active.side = int(_num(args[0]) or 0)
        elif word == "aistrategicarea.vehiclesearchradius" and args:
            active.vehicleSearchRadius = _num(args[0])
        elif word == "aistrategicarea.settakeable" and len(args) >= 2:
            active.takeable[args[0]] = bool(int(_num(args[1]) or 0))
        elif word == "aistrategicarea.attachlandingzone" and args:
            active.landingZones.append(args[0])
        elif word == "aistrategicarea.addlandingzoneunit" and args:
            active.landingZoneUnits.append(args[0])
        elif word == "aistrategicarea.addexpelledunit" and args:
            active.expelledUnits.append(args[0])


def parse_conditions(text: str, ai: LevelAi) -> None:
    current: Condition | None = None
    for t in _lines(text):
        word = t[0].lower()
        args = t[1:]
        if word.startswith("aistrategy.create") and word.endswith("condition") and len(args) >= 6:
            kind = t[0][len("aiStrategy.create"):-len("Condition")]
            current = Condition(
                name=args[0], kind=kind or "Constant", fuzzy=args[1], op=args[2],
                subject=args[3], object=args[4], value=_num(args[5], 0.0) or 0.0)
            ai.conditions.append(current)
        elif current is None:
            continue
        elif word == "aistrategy.setconditionstrength":
            current.strength = [a for a in args if a != "|"]
        elif word == "aistrategy.setisabortcondition" and args:
            current.abort = bool(int(_num(args[0]) or 0))


def parse_prerequisites(text: str, ai: LevelAi) -> None:
    current: Prerequisite | None = None
    for t in _lines(text):
        word = t[0].lower()
        args = t[1:]
        if word == "aistrategy.createprerequisite" and args:
            current = Prerequisite(name=args[0])
            ai.prerequisites.append(current)
        elif current is not None and word == "aistrategy.addcondition" and len(args) >= 2:
            current.conditions.append({"name": args[0], "weight": _num(args[1], 1.0)})


def parse_strategies(text: str, ai: LevelAi) -> None:
    current: Strategy | None = None
    for t in _lines(text):
        word = t[0].lower()
        args = t[1:]
        if word == "aistrategy.createstrategy" and args:
            current = Strategy(name=args[0])
            ai.strategies.append(current)
        elif current is None:
            continue
        elif word == "aistrategy.aggression" and args:
            current.aggression = _num(args[0])
        elif word == "aistrategy.numberofattacks" and args:
            current.attacks = int(_num(args[0]) or 0)
        elif word == "aistrategy.numberofdefences" and args:
            current.defences = int(_num(args[0]) or 0)
        elif word == "aistrategy.timelimit" and args:
            current.timeLimit = _num(args[0])
        elif word == "aistrategy.setprerequisite" and args:
            current.prerequisite = args[0]
        elif word == "aistrategy.setstrategicobjectsmodifier" and len(args) >= 2:
            current.modifiers.append({
                "flag": args[0],
                "factor": _num(args[1], 1.0),
                "owner": args[2] if len(args) >= 3 else None,
            })


def load_level_ai(files) -> LevelAi | None:
    """The level's AI block, or None when it ships no `AI.con`.

    `files` is `bf42.level.LevelFiles` (or anything with `find(rel)` and
    `read(name)`)."""
    def text(rel: str) -> str:
        hit = files.find(rel)
        if not hit:
            return ""
        return files.read(hit).decode("latin-1", "replace")

    ai_con = text("AI.con")
    if not ai_con.strip():
        return None
    ai = LevelAi()
    parse_ai_con(ai_con, ai)
    parse_pathfinding_con(text("AIpathFinding.con"), ai)
    parse_strategic_areas(text("AI/StrategicAreas.con") or text("AI/StrategicAreas"), ai)
    parse_conditions(text("AI/conditions.con"), ai)
    parse_prerequisites(text("AI/prerequisites.con"), ai)
    parse_strategies(text("AI/Strategies.con"), ai)
    return ai


def add_cover_values(ai: LevelAi, library, templates) -> None:
    """Record the cover value of every placed template the library knows.

    `library` is `bf42.con.ObjectLibrary`: its `ai_cover` map is keyed by the
    object FOLDER (`Objects/Buildings/sandbag_i/Ai/Objects.con` -> `sandbag_i`),
    which is not always the template's name (`sandbagi_m1`), so each placed
    template is resolved through the con file it was declared in.
    `templates` is an iterable of placed template names."""
    cover = getattr(library, "ai_cover", None) or {}
    if not cover:
        return
    for name in templates:
        key = str(name).lower()
        if key in ai.coverValues:
            continue
        value = cover.get(key)
        if value is None:
            template = library.object(name) if hasattr(library, "object") else None
            source = getattr(template, "source", "") or ""
            parts = source.replace("\\", "/").split("/")
            if parts and "." in parts[-1]:
                parts = parts[:-1]
            if parts and parts[-1].lower() == "ai":
                parts = parts[:-1]
            if parts:
                value = cover.get(parts[-1].lower())
        if value is not None:
            ai.coverValues[key] = value



@dataclass
class SearchMapRaw:
    """One level of a baked search map, `Pathfinding/<name>Level<L>Map.raw`.

    The level archives ship them and the server loads them rather than
    painting its own (`ai.loadMaps` in `AIpathFinding.con`; `LocalMap::
    loadRawFile` 0x085fefb0 hands each level to `CellMap::loadRawFile`
    0x085f86a0). The file: five int32 checked against the `CellMap`
    (`log2` blocks across and down, `level + 6`, `level`, the bits-per-pixel
    exponent), the special-cell count and ids (0 all free, 0xffffffff all
    blocked), then one int32 per block, row-major: `>= 0` an index into the
    special cells, `< 0` followed inline by the block's own `4 << (p4 - 5 +
    2 * (p5 - p3))` bytes (the stream read at `*(IStream + 0xc)`).

    A pixel is `CellMap::getPixel` 0x085f9a00: block `(x >> p5, z >> p5)`,
    pixel `(x, z) >> p3` inside it, bit `col & 31` of word `row * (bw / 32) +
    (col >> 5)`, LSB first; 1 is blocked. `x` is world x and `z` the
    engine's z (the glTF frame's `-z`).
    """

    blocks_x: int
    blocks_z: int
    level: int
    bits: int
    block_pixels: int
    blocks: list[bytes]

    @property
    def width(self) -> int:
        return self.blocks_x * self.block_pixels

    @property
    def height(self) -> int:
        return self.blocks_z * self.block_pixels

    def blocked(self, px: int, pz: int) -> bool:
        """Whether pixel `(px, pz)` of this level is blocked (outside is)."""
        bw = self.block_pixels
        if not (0 <= px < self.width and 0 <= pz < self.height):
            return True
        block = self.blocks[(pz // bw) * self.blocks_x + px // bw]
        col, row = px % bw, pz % bw
        word = row * max(1, bw // 32) + (col >> 5)
        value = int.from_bytes(block[word * 4:word * 4 + 4], "little")
        return bool((value >> (col & 31)) & 1)

    def blocked_at(self, x: float, z_engine: float) -> bool:
        """The pixel under world `(x, z)` (engine z, metres)."""
        size = 1 << self.level
        return self.blocked(int(x // size), int(z_engine // size))


def read_search_map_raw(data: bytes) -> SearchMapRaw:
    """Decode one baked search-map level (see `SearchMapRaw`). Only the
    one-bit maps (`p4 == 0`, the `Level<L>Map` files) are decoded; the
    `*Info.raw` / `*LandMap.raw` files carry other layouts."""
    import struct

    if len(data) < 24:
        raise ValueError("search map too short")
    wb, hb, p5, p3, p4 = struct.unpack_from("<5i", data, 0)
    if p4 != 0:
        raise ValueError(f"not a one-bit map (bits exponent {p4})")
    off = 20
    (count,) = struct.unpack_from("<i", data, off)
    off += 4
    specials = list(struct.unpack_from(f"<{count}I", data, off))
    off += 4 * count
    block_bytes = 4 << max(1, p4 - 5 + 2 * (p5 - p3))
    block_pixels = 1 << (p5 - p3)
    fills = [value.to_bytes(4, "little") * (block_bytes // 4) for value in specials]
    blocks: list[bytes] = []
    for _ in range((1 << wb) * (1 << hb)):
        (rec,) = struct.unpack_from("<i", data, off)
        off += 4
        if rec < 0:
            blocks.append(bytes(data[off:off + block_bytes]))
            off += block_bytes
        else:
            blocks.append(fills[rec])
    if off != len(data):
        raise ValueError(f"search map has {len(data) - off} trailing bytes")
    return SearchMapRaw(1 << wb, 1 << hb, p3, p4, block_pixels, blocks)


def search_map_header(data: bytes) -> tuple[int, int, int, int, int]:
    """The five header int32 of a baked search-map level: `log2` blocks
    across, `log2` blocks down, the block's size exponent (`level + 6`), the
    level, the bits-per-pixel exponent (`CellMap::loadRawFile` 0x085f8930
    compares them with the `CellMap`'s +0x18, +0x20, +0x10, +0x2c, +0x24)."""
    import struct

    if len(data) < 20:
        raise ValueError("search map too short")
    return struct.unpack_from("<5i", data, 0)


def level_search_maps(files, ai: LevelAi | None) -> list[dict[str, Any]]:
    """What `ai.loadMaps` loads for this level, map by map.

    `AIPathfinding::loadSearchMaps` 0x0847c5c0 walks the declared maps in
    order and calls `LocalMap::loadRawFile` 0x085fefb0 on each, which loads
    every level `minLevel .. maxLevel` from `Pathfinding/<name>Level<L>Map.raw`
    (`CellMap::loadRawFile` 0x085f8930: false on a missing file or a header
    that does not match the `CellMap`). Both loops stop loading at the first
    failure, so every map after a failed one keeps what its constructor gave
    it: every block the special cell 0, ALL FREE (`CellMap::CellMap`
    0x085f7af0). `AIConsole::loadMaps` 0x0846e2d0 drops the result; the
    server carries on with those maps.

    One row per declared map: `name`, the search-map parameters, `loaded`,
    and when loaded `level` (the minimum, the level the viewer searches at)
    and `data` (that level's bytes); `reason` says why a map did not load.
    """
    rows: list[dict[str, Any]] = []
    if ai is None:
        return rows
    chain_ok = True
    for sm in ai.searchMaps:
        row = {k: sm.get(k) for k in ("name", "waterMap", "waterDepth", "maxSlope", "brush",
                                        "lowClip", "hiClip", "considerAITypes", "minLevel", "maxLevel")}
        row["loaded"] = False
        rows.append(row)
        if not chain_ok:
            row["reason"] = "an earlier map failed to load"
            continue
        lo, hi = int(sm.get("minLevel", 0)), int(sm.get("maxLevel", 2))
        first: bytes | None = None
        blocks_bits = None
        for level in range(lo, hi + 1):
            rel = f"Pathfinding/{sm['name']}Level{level}Map.raw"
            hit = files.find(rel)
            if not hit:
                row["reason"] = f"no {rel}"
                break
            data = files.read(hit)
            try:
                wb, hb, p5, p3, p4 = search_map_header(data)
                if (p3, p5, p4) != (level, level + 6, 0) or wb != hb:
                    raise ValueError(f"header {(wb, hb, p5, p3, p4)}")
                if blocks_bits is not None and wb != blocks_bits - (level - lo):
                    raise ValueError(f"{wb} block bits after {blocks_bits} at level {lo}")
                if level == lo:
                    read_search_map_raw(data)
                    first, blocks_bits = data, wb
            except ValueError as exc:
                row["reason"] = f"{rel}: {exc}"
                break
        else:
            row.update(loaded=True, level=lo, data=first)
        if not row["loaded"]:
            chain_ok = False
    return rows


def write_level_search_maps(files, ai: LevelAi | None, out_dir) -> dict[str, Any] | None:
    """Write the level's loaded search maps under `<out_dir>/pathfinding/`:
    each loaded map's minimum level as the archive has it
    (`<name>Level<L>Map.raw`) and `index.json`, one row per declared map
    (its parameters, `loaded`, and `level` / `file` / `bytes` or `reason`).
    Returns the index, or None (writing nothing and removing a stale folder)
    for a level that declares no search maps."""
    import json
    import shutil
    from pathlib import Path

    dest = Path(out_dir) / "pathfinding"
    rows = level_search_maps(files, ai)
    if not rows:
        if dest.is_dir():
            shutil.rmtree(dest)
        return None
    dest.mkdir(parents=True, exist_ok=True)
    keep = {"index.json"}
    for row in rows:
        data = row.pop("data", None)
        if not row["loaded"] or data is None:
            continue
        name = f"{row['name']}Level{row['level']}Map.raw"
        row["file"] = name
        row["bytes"] = len(data)
        if name in keep:
            continue
        keep.add(name)
        target = dest / name
        if not target.is_file() or target.read_bytes() != data:
            tmp = dest / (name + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(target)
    for stale in dest.iterdir():
        if stale.name not in keep:
            stale.unlink()
    index = {"worldMapSize": ai.settings.get("worldMapSize") if ai else None, "maps": rows}
    text = json.dumps(index, indent=1)
    target = dest / "index.json"
    if not target.is_file() or target.read_text() != text:
        tmp = dest / "index.json.tmp"
        tmp.write_text(text)
        tmp.replace(target)
    return index
