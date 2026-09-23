"""A level's AI scripts: `AI.con`, `AIpathFinding.con` and the `AI/` folder.

The strategic AI (`ai.createSAI`) reads four plain console scripts per level
(`features/bf1942-ai-research-2026-09-21/README.md` §3.6):

* `AI/StrategicAreas.con` — `aiStrategicArea.create <name> <x1>/<z1> <x2>/<z2>
  <radius>` boxes with neighbours, object-type flags (`Base`, `ControlPoint`,
  `Front`, `Flank`, `Centre`, `Safe`, `Close`, `AirField`, `ChokePoint`, ...),
  per-vehicle-type order positions, a side, and `setTakeable <side> <0|1>`;
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
    """Console lines with `rem` comments, blanks and `if/endIf` scaffolding
    dropped (the `_003` patch archives wrap every script in `if v_arg1 ==
    host`)."""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.lower().startswith("rem"):
            continue
        low = line.lower()
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


def parse_pathfinding_con(text: str, ai: LevelAi) -> None:
    """`AIpathFinding.con`: the search maps (name / waterHeight(bool) /
    waterDepth / maxSlope / brush / lowClip / hiClip / considerAITypes)."""
    for t in _lines(text):
        word = t[0].lower()
        args = t[1:]
        if word == "ai.addsearchmap" and len(args) >= 8:
            ai.searchMaps.append({
                "name": args[0],
                "waterMap": bool(int(_num(args[1]) or 0)),
                "waterDepth": _num(args[2]),
                "maxSlope": _num(args[3]),
                "brush": _num(args[4]),
                "lowClip": _num(args[5]),
                "hiClip": _num(args[6]),
                "considerAITypes": bool(int(_num(args[7]) or 0)),
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
            )
            areas[args[0].lower()] = area
            ai.strategicAreas.append(area)
            active = area
        elif word == "aistrategicarea.setactive" and args:
            active = areas.get(args[0].lower())
        elif word == "aistrategicarea.createvehiclegroup" and args:
            group = args[0]
            ai.vehicleGroups.setdefault(group, [])
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
