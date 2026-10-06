#!/usr/bin/env python3
"""Extract every vehicle's AI plug-in data into `viewer/maps/_shared/vehicle-ai.json`.

`Objects/Vehicles/<class>/<Vehicle>/AI/Objects.con` carries the `aiTemplatePlugIn`
blocks the bot code reads (bot-behaviours.md §8): the `Mobile` plug-in's
`maxSpeed`, `turnRadius` and `vehicleNumber` (which `ai.addSearchMap` the unit
drives on), the `Physical` plug-in's `setStrType`, the `Unit` plug-in's
`setStrategicStrength`, the `Cover` plug-in's `coverValue`; `AI/Weapons.con` the
`weaponTemplate` blocks of its guns (ranges, `setStrength` per class). The
vehicle's own `Objects.con` maps each `FireArms` child to its `aiTemplate`, which
is how a gun node in the viewer finds its AI weapon.

Records are keyed by folder, and a root object the folder records miss gets
one of its own under its template's name (`object_record`): the engine links
an object to its AI by the object's own `ObjectTemplate.aiTemplate` (AI-137),
so DC's `A10_B` (`aiTemplate A10`, no AI folder of its own), DC Final's five
hulls in `H-6`, vanilla's `Ho-Ha` (`aiTemplate Hanomag`) and the static
`Fletcher2` are each their own template's unit.

The mod's whole chain is read, nearest mod first (`game.addModPath`), so a
mod keeps the units it inherits, and each level's own archive adds the units
it declares for itself (DC's Urban Siege `Nimitz`). One file per maps tree:

    python3 extract_vehicle_ai.py --mod bf1942
    python3 extract_vehicle_ai.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared/vehicle-ai.json
    python3 extract_vehicle_ai.py --mod DC_Final --out viewer/maps/mods/dc_final/_shared/vehicle-ai.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import roster as roster_mod  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402
from extract_models import build_pools, discover_levels, mod_chain  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"


def _num(s: str) -> float | None:
    try:
        return float(s)
    except ValueError:
        return None


def parse_objects_con(text: str) -> dict:
    """The aiTemplatePlugIn blocks of one vehicle folder."""
    plugins: dict[str, dict] = {}
    templates: dict[str, dict] = {}
    cur: dict | None = None
    cur_t: dict | None = None
    for raw in text.splitlines():
        line = raw.split("rem")[0].strip() if raw.strip().lower().startswith("rem") else raw.strip()
        if not line or line.lower().startswith("rem"):
            continue
        parts = line.split()
        cmd = parts[0].lower()
        args = parts[1:]
        if cmd == "aitemplateplugin.create" and len(args) >= 2:
            cur = {"kind": args[0], "name": args[1]}
            plugins[args[1].lower()] = cur
        elif cmd.startswith("aitemplateplugin.") and cur is not None:
            key = cmd.split(".", 1)[1]
            if key == "setstrategicstrength" and len(args) >= 2:
                cur.setdefault("strategicStrength", {})[args[0]] = _num(args[1])
            elif key == "setstrtype" and args:
                cur["strType"] = args[0]
            elif args:
                val = _num(args[0])
                cur[key] = val if val is not None else args[0]
        elif cmd == "aitemplate.create" and args:
            cur_t = {"name": args[0], "plugIns": [], "types": []}
            templates[args[0].lower()] = cur_t
        elif cmd == "aitemplate.addplugin" and cur_t is not None and args:
            cur_t["plugIns"].append(args[0])
        elif cmd == "aitemplate.addtype" and cur_t is not None and args:
            cur_t["types"].append(args[0])
        elif cmd in ("aitemplate.basictemp", "aitemplate.degeneration", "aitemplate.secondary") and cur_t is not None and args:
            cur_t[cmd.split(".", 1)[1]] = _num(args[0])
    return {"plugIns": plugins, "templates": templates}


def is_anti_aircraft(template: dict | None, plugins: dict[str, dict]) -> bool:
    """Whether an aiTemplate's Armament plug-in declares `setIsAntiAircraft`.

    The word is the unit's, not a weapon's: ConsoleClass550 (lnxded
    0x08504dd0) writes it to `AITemplateArmament+0x5`, and
    `IPIArmamentReal::isAntiAircraft` (0x085e9b00) reads it back through the
    unit's plug-in 4. The fire scoring's anti-aircraft rules key on it, and no
    `weaponTemplate` carries it, so a viewer reading it off the AI weapons
    found none: every AA gun scored as a non-AA one.
    """
    for name in (template or {}).get("plugIns", []):
        p = plugins.get(name.lower())
        if p and p.get("kind") == "Armament" and p.get("setisantiaircraft"):
            return True
    return False


def basic_temp(template: dict | None) -> float | None:
    """`aiTemplate.basicTemp`: the unit's own term in a bot's urge to take it.

    ConsoleClass489 (lnxded 0x084ffe60) writes it to `AITemplate+0x14`;
    `AIObjectReal::createInformation` (0x085d8ca0) hands it to the
    `InformationReal` ctor (0x085e8730), which stores it at `Information+0x14`,
    and `calculateVehicleUrgency` (0x08583b10) adds that float to the unit's
    urgency (`fadds 0x14(%esi)` at 0x08583c34). No strategic strength enters
    the Change score.
    """
    if not template:
        return None
    return template.get("basictemp")


def _deg_vector(value) -> list[float] | None:
    """`setCameraRelativeMin/MaxRotationDeg`'s `x/y/z` argument."""
    if not isinstance(value, str):
        return None
    try:
        parts = [float(v) for v in value.split("/")]
    except ValueError:
        return None
    return (parts + [0.0, 0.0, 0.0])[:3]


def control_info(template: dict | None, plugins: dict[str, dict]) -> dict | None:
    """The numbers `mouseControlLookAtDirection` (lnxded 0x08627b90) reads off
    a unit's ControlInfo plug-in to turn an aim direction into mouse counts.

    It shapes the camera-frame angle to the target, puts it through
    `SCurve::calculate` (0x08658420) and scales it by `pitchScale` (template
    +0x28) for the vertical count and `rollScale` (+0x2c) for the horizontal,
    signed by `pitchSensitivity` (+0x08) and `rollSensitivity` (+0x0c); the
    counts go to `lookVerticalControl` (+0x60) and `lookHorizontalControl`
    (+0x64). The offsets are the console setters' (ConsoleClass566, 567, 574,
    575, 588, 589: 0x08507670, 0x08507a60, 0x085095f0, 0x085099e0, 0x0850cd10,
    0x0850d100). The camera limits are `setCameraRelativeMin/MaxRotationDeg`
    (`AITemplateControlInfo` 0x085de770 / 0x085de870), degrees as authored.
    """
    for name in (template or {}).get("plugIns", []):
        p = plugins.get(name.lower())
        if not p or p.get("kind") != "ControlInfo":
            continue
        out = {
            "pitchSensitivity": p.get("pitchsensitivity"),
            "rollSensitivity": p.get("rollsensitivity"),
            "pitchScale": p.get("pitchscale"),
            "rollScale": p.get("rollscale"),
            "lookVerticalControl": p.get("lookverticalcontrol"),
            "lookHorizontalControl": p.get("lookhorizontalcontrol"),
            "cameraMinDeg": _deg_vector(p.get("setcamerarelativeminrotationdeg")),
            "cameraMaxDeg": _deg_vector(p.get("setcamerarelativemaxrotationdeg")),
        }
        return {k: v for k, v in out.items() if v is not None}
    return None


def parse_weapons_con(text: str) -> dict[str, dict]:
    weapons: dict[str, dict] = {}
    cur: dict | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.lower().startswith("rem"):
            continue
        parts = line.split()
        cmd = parts[0].lower()
        args = parts[1:]
        if cmd == "weapontemplate.create" and args:
            cur = {"name": args[0], "strength": {}, "burst": 0, "minRange": 0.0, "maxRange": 0.0, "indirect": 0}
            weapons[args[0].lower()] = cur
        elif cur is None or not cmd.startswith("weapontemplate."):
            continue
        else:
            key = cmd.split(".", 1)[1]
            if key == "setstrength" and len(args) >= 2:
                cur["strength"]["Infantry" if args[0] == "Infantery" else args[0]] = _num(args[1])
            elif key in ("minrange", "maxrange", "burst", "indirect", "deviation", "deviationcorrectiontime"):
                cur[{"minrange": "minRange", "maxrange": "maxRange", "deviationcorrectiontime": "deviationCorrectionTime"}.get(key, key)] = _num(args[0]) if args else None
            elif key in ("weaponfire", "weaponactivate") and args:
                cur[{"weaponfire": "weaponFire", "weaponactivate": "weaponActivate"}[key]] = args[0]
            elif key == "healing" and args:
                cur["healing"] = _num(args[0]) not in (None, 0.0)
            elif key == "exitvelocity" and args and _num(args[0]) is not None:
                # `weaponTemplate.exitVelocity` (ConsoleClass630 0x085135f0
                # writes WeaponTemplate +0x28): the speed `Weapon::
                # getExitVelocity` 0x085ecb50 hands the Aimer. Left at 0,
                # `WeaponTemplate::init` 0x085efd40 fills it from the FireArms'
                # projectile velocity; a negative one (DC's CBU and Snakeye,
                # -5) is kept.
                cur["exitVelocity"] = _num(args[0])
            elif key == "useaimeronly" and args:
                # `weaponTemplate.useAimerOnly` (ConsoleClass622 0x085115d0,
                # WeaponTemplate +0x5): `BAPCConPrecision::evaluate` 0x0854b570
                # holds at once when the barrel lies along the Aimer's
                # solution (0x0854b684..0x0854b68b).
                cur["useAimerOnly"] = _num(args[0]) not in (None, 0.0)
    return weapons


FIRE_ARMS_RE = re.compile(r"^\s*ObjectTemplate\.create\s+FireArms\s+(\S+)", re.I)
AI_TEMPLATE_RE = re.compile(r"^\s*ObjectTemplate\.aiTemplate\s+(\S+)", re.I)
PCO_RE = re.compile(r"^\s*ObjectTemplate\.create\s+PlayerControlObject\s+(\S+)", re.I)


def parse_vehicle_objects(text: str) -> tuple[dict[str, str], dict[str, str]]:
    """FireArms object -> aiTemplate, and PlayerControlObject -> aiTemplate."""
    fire_arms: dict[str, str] = {}
    pcos: dict[str, str] = {}
    current: tuple[str, str] | None = None
    for raw in text.splitlines():
        m = FIRE_ARMS_RE.match(raw)
        if m:
            current = ("fire", m.group(1))
            continue
        m = PCO_RE.match(raw)
        if m:
            current = ("pco", m.group(1))
            continue
        if raw.strip().lower().startswith("objecttemplate.create"):
            current = None
            continue
        m = AI_TEMPLATE_RE.match(raw)
        if m and current:
            (fire_arms if current[0] == "fire" else pcos)[current[1]] = m.group(1)
    return fire_arms, pcos


ADD_TEMPLATE_RE = re.compile(r"^\s*ObjectTemplate\.addTemplate\s+(\S+)", re.I)
CREATE_RE = re.compile(r"^\s*ObjectTemplate\.create\s+(\S+)\s+(\S+)", re.I)


def parse_template_graph(text: str, graph: dict[str, list[str]], kinds: dict[str, str],
                         ai_of: dict[str, str]) -> None:
    """`addTemplate` children per template, each template's kind, and its
    `aiTemplate`, across one con file (case-insensitive keys)."""
    current: str | None = None
    for raw in text.splitlines():
        m = CREATE_RE.match(raw)
        if m:
            current = m.group(2).lower()
            kinds[current] = m.group(1)
            graph.setdefault(current, [])
            continue
        if current is None:
            continue
        m = ADD_TEMPLATE_RE.match(raw)
        if m:
            graph.setdefault(current, []).append(m.group(1).lower())
            continue
        m = AI_TEMPLATE_RE.match(raw)
        if m:
            ai_of[current] = m.group(1)


def fire_arms_under(pco: str, graph: dict[str, list[str]], kinds: dict[str, str]) -> list[str]:
    """The FireArms reachable from a PlayerControlObject without crossing
    into a nested PlayerControlObject (that one's own seat)."""
    out: list[str] = []
    seen: set[str] = set()
    stack = list(graph.get(pco, []))
    while stack:
        t = stack.pop()
        if t in seen:
            continue
        seen.add(t)
        kind = kinds.get(t, "")
        if kind == "PlayerControlObject":
            continue
        if kind == "FireArms":
            out.append(t)
        stack.extend(graph.get(t, []))
    return out


def scan_objects(names: list[str], read, source_of=None) -> tuple[
        dict[str, dict], dict[str, list[str]], dict[str, str], dict[str, str]]:
    """Every weapon template the files declare, and every object's aiTemplate
    and addTemplate children: the shared guns (a Browning under
    Objects/Weapons) are reached from a vehicle's seat through them. `names`
    are paths from `Objects/` on, grouped by archive nearest mod first (the
    order `ArchivePool.names` gives); `read` returns a file's text or None.

    `source_of` names each path's archive. A template or weapon template an
    archive nearer the mod has already declared keeps that declaration: a
    parent's copy of the name neither replaces it nor adds children to it
    (DC Final redeclares 93 of the names DC and vanilla declare). Within one
    archive, later files still read over earlier ones as before.
    """
    all_weapons: dict[str, dict] = {}
    graph: dict[str, list[str]] = {}
    kinds: dict[str, str] = {}
    ai_of: dict[str, str] = {}
    nearer_weapons: set[str] = set()
    nearer_templates: set[str] = set()
    source = object()
    for n in names:
        src = source_of(n) if source_of else None
        if src != source:
            nearer_weapons |= set(all_weapons)
            nearer_templates |= set(kinds)
            source = src
        low = n.lower()
        if not low.endswith(".con"):
            continue
        if low.endswith("/ai/weapons.con") or low.endswith("/ai/weapon.con"):
            if (text := read(n)) is not None:
                for key, weapon in parse_weapons_con(text).items():
                    if key not in nearer_weapons:
                        all_weapons[key] = weapon
        elif low.startswith("objects/") and "/ai/" not in low:
            if (text := read(n)) is None:
                continue
            if not nearer_templates:
                parse_template_graph(text, graph, kinds, ai_of)
                continue
            g: dict[str, list[str]] = {}
            k: dict[str, str] = {}
            a: dict[str, str] = {}
            parse_template_graph(text, g, k, a)
            for name, kind in k.items():
                if name in nearer_templates:
                    continue
                kinds[name] = kind
                graph.setdefault(name, []).extend(g.get(name, []))
                if name in a:
                    ai_of[name] = a[name]
    return all_weapons, graph, kinds, ai_of


def vehicle_folders(names: list[str]) -> dict[str, tuple[str, dict[str, str]]]:
    """`Objects.rfa`'s vehicle folders: lower-cased folder -> (folder as
    spelled, {file under it, lower-cased: entry name}).

    A vehicle is `Objects/Vehicles/<class>/<name>`; a stationary gun
    (`Stationary_Browning`, `Stationary_MG42`) is
    `Objects/Stationary_Weapons/<name>`, a PlayerControlObject with an AI
    template of its own like any vehicle. Grouped case-insensitively, the way
    the engine opens files (RFA-1): a mod down the chain can spell a folder
    its parent also ships differently.
    """
    by_folder: dict[str, tuple[str, dict[str, str]]] = {}
    for n in names:
        low = n.lower()
        if low.startswith("objects/vehicles/"):
            depth = 4
        elif low.startswith("objects/stationary_weapons/"):
            depth = 3
        else:
            continue
        parts = n.split("/")
        if len(parts) < depth + 1:
            continue
        folder = "/".join(parts[:depth])
        entry = by_folder.setdefault(folder.lower(), (folder, {}))
        entry[1][low[len(folder) + 1:]] = n
    return by_folder


def level_vehicle_folders(names: list[str]) -> dict[str, tuple[str, dict[str, str]]]:
    """A level archive's own unit folders, the same shape as `vehicle_folders`.

    A level files what it declares for itself as `Objects/<name>/` (DC's
    Urban Siege `objects/Nimitz`, Caen's `Objects/Pak40`), so a unit folder
    here is any folder holding `AI/Objects.con`, at whatever depth.
    """
    folders: set[str] = set()
    for n in names:
        low = n.lower()
        if low.endswith("/ai/objects.con"):
            folders.add(n[: -len("/ai/objects.con")])
    by_folder: dict[str, tuple[str, dict[str, str]]] = {}
    for folder in sorted(folders):
        by_folder.setdefault(folder.lower(), (folder, {}))
    for n in names:
        low = n.lower()
        for key, (folder, files) in by_folder.items():
            if low.startswith(key + "/"):
                files[low[len(key) + 1:]] = n
    return by_folder


def vehicle_record(folder: str, files: dict[str, str], read, all_weapons: dict[str, dict],
                   graph: dict[str, list[str]], kinds: dict[str, str],
                   ai_of: dict[str, str]) -> dict | None:
    """One unit's record from its folder, or None when it ships no AI."""
    ai_objects = files.get("ai/objects.con")
    text = read(ai_objects) if ai_objects else None
    if text is None:
        return None
    vehicle_name = folder.split("/")[-1]
    parsed = parse_objects_con(text)
    weapons_text = read(files["ai/weapons.con"]) if files.get("ai/weapons.con") else None
    weapons = parse_weapons_con(weapons_text) if weapons_text else {}
    fire_arms, pcos = ({}, {})
    objects_text = read(files["objects.con"]) if files.get("objects.con") else None
    if objects_text:
        fire_arms, pcos = parse_vehicle_objects(objects_text)
    # The root PCO's template, and its Mobile / Physical / Unit / Cover plug-ins.
    root_ai = pcos.get(vehicle_name) or next(iter(pcos.values()), None)
    root = parsed["templates"].get((root_ai or "").lower()) or next(iter(parsed["templates"].values()), None)
    low = folder.lower()
    info: dict = {
        "class": (folder.split("/")[2] if low.startswith("objects/vehicles/")
                  else "Stationary" if low.startswith("objects/stationary_weapons/") else None),
        "aiTemplate": root["name"] if root else None,
        "basicTemp": basic_temp(root), "types": list((root or {}).get("types", [])),
        "maxSpeed": None, "turnRadius": None, "vehicleNumber": None, "strType": None,
        "strategicStrength": None, "coverValue": None, "isTurnable": None,
        "fireArms": {k: v for k, v in fire_arms.items()},
        "seats": {k: v for k, v in pcos.items()},
        "aiWeapons": {w["name"]: {kk: vv for kk, vv in w.items() if kk != "name"} for w in weapons.values()},
    }
    # Every seat (PlayerControlObject) of the vehicle: its aiTemplate's
    # Unit plug-in strengths and the AI weapons of the guns it reaches.
    def weapon_of(fa: str) -> dict | None:
        w_ai = ai_of.get(fa) or fire_arms.get(fa)
        return all_weapons.get((w_ai or "").lower()) or weapons.get((w_ai or "").lower())

    info["seatsAi"] = {
        pco: seat_record(ai_name, parsed["templates"].get(ai_name.lower()), parsed["plugIns"],
                         fire_arms_under(pco.lower(), graph, kinds), weapon_of)
        for pco, ai_name in pcos.items()}
    apply_root(info, root, parsed["plugIns"])
    return info


def seat_record(ai_name: str, t: dict | None, plugins: dict[str, dict], fire_arms: list[str],
                weapon_of) -> dict:
    """One seat's AI numbers: its aiTemplate's Unit plug-in strengths, the
    words the Change and Fire scoring read, and the AI weapons of the guns it
    reaches (`fire_arms`, each looked up by `weapon_of`)."""
    seat: dict = {"aiTemplate": ai_name, "secondary": bool(t and t.get("secondary")),
                  "strategicStrength": None, "aiWeapons": {},
                  "basicTemp": basic_temp(t), "types": list((t or {}).get("types", []))}
    for pname in (t["plugIns"] if t else []):
        p = plugins.get(pname.lower())
        if p and p.get("kind") == "Unit":
            seat["strategicStrength"] = p.get("strategicStrength")
            # `aiTemplatePlugIn.equipmentType`: the unit's row of
            # `AIbehaviours.con`'s `setVehicle` list (0 Tank, 4 Fixed,
            # 13 FixedLargeBore, ...), which picks its behaviours: a
            # Tank's and a Fixed gun's Fire is `BBFireInfantery`.
            if p.get("equipmenttype") is not None:
                seat["equipmentType"] = int(p["equipmenttype"])
            # `setUseNoPathfindingToGetToObject` (ConsoleClass557
            # 0x08506040 writes `AITemplateUnit+0x15`): BBChange
            # 0x0855e0c0 then takes the unit when a valid point lies
            # on the line 12 m behind it, not on its own cell.
            if p.get("setusenopathfindingtogettoobject"):
                seat["useNoPathfinding"] = True
    if is_anti_aircraft(t, plugins):
        seat["isAntiAircraft"] = True
    ctrl = control_info(t, plugins)
    if ctrl:
        seat["controlInfo"] = ctrl
    for fa in fire_arms:
        w = weapon_of(fa)
        if w:
            seat["aiWeapons"][w["name"]] = {kk: vv for kk, vv in w.items() if kk != "name"}
    return seat


def apply_root(info: dict, root: dict | None, plugins: dict[str, dict]) -> None:
    """The hull's own words, from its root aiTemplate's plug-ins: the Mobile
    plug-in's speed, turn radius and search type, the Physical plug-in's
    strength type, the Unit plug-in's, the Cover plug-in's value."""
    if is_anti_aircraft(root, plugins):
        info["isAntiAircraft"] = True
    root_ctrl = control_info(root, plugins)
    if root_ctrl:
        info["controlInfo"] = root_ctrl
    for pname in (root["plugIns"] if root else []):
        p = plugins.get(pname.lower())
        if not p:
            continue
        kind = p.get("kind")
        if kind == "Mobile":
            info["maxSpeed"] = p.get("maxspeed")
            info["turnRadius"] = p.get("turnradius")
            info["vehicleNumber"] = p.get("vehiclenumber")
            info["isTurnable"] = p.get("isturnable")
        elif kind == "Physical":
            info["strType"] = p.get("strType")
        elif kind == "Unit":
            info["strategicStrength"] = p.get("strategicStrength")
            if p.get("equipmenttype") is not None:
                info["equipmentType"] = int(p["equipmenttype"])
            if p.get("setusenopathfindingtogettoobject"):
                info["useNoPathfinding"] = True
        elif kind == "Cover":
            info["coverValue"] = p.get("covervalue")


def ai_template_table(names: list[str], read) -> dict[str, tuple[dict, dict[str, dict]]]:
    """Every `aiTemplate.create` along the chain, lower-cased: the template
    and the plug-ins of the file that declares it. `names` come nearest
    archive first (`ArchivePool.names`), and the nearest declaration of a
    name is kept, as `scan_objects` keeps the nearest object template."""
    table: dict[str, tuple[dict, dict[str, dict]]] = {}
    for n in names:
        if not n.lower().endswith("/ai/objects.con"):
            continue
        text = read(n)
        if text is None:
            continue
        parsed = parse_objects_con(text)
        for key, t in parsed["templates"].items():
            table.setdefault(key, (t, parsed["plugIns"]))
    return table


def template_sites(names: list[str], read) -> dict[str, tuple[str, str]]:
    """Every object template's name as its `create` line spells it and the
    file that declares it, lower-cased, nearest archive first."""
    sites: dict[str, tuple[str, str]] = {}
    for n in names:
        low = n.lower()
        if not low.endswith(".con") or not low.startswith("objects/") or "/ai/" in low:
            continue
        text = read(n)
        if text is None:
            continue
        for raw in text.splitlines():
            m = CREATE_RE.match(raw)
            if m:
                sites.setdefault(m.group(2).lower(), (m.group(2), n))
    return sites


def object_tree(root: str, graph: dict[str, list[str]], kinds: dict[str, str]) -> tuple[list[str], list[str]]:
    """The PlayerControlObjects (the root first) and the FireArms one object
    builds, in `addTemplate` order: every seat it carries, however deep."""
    pcos: list[str] = []
    guns: list[str] = []
    seen: set[str] = set()

    def walk(t: str) -> None:
        if t in seen:
            return
        seen.add(t)
        kind = kinds.get(t, "")
        if kind == "PlayerControlObject":
            pcos.append(t)
        elif kind == "FireArms":
            guns.append(t)
        for child in graph.get(t, []):
            walk(child)

    walk(root)
    return pcos, guns


def object_record(root: str, sites: dict[str, tuple[str, str]], graph: dict[str, list[str]],
                  kinds: dict[str, str], ai_of: dict[str, str],
                  ai_table: dict[str, tuple[dict, dict[str, dict]]],
                  all_weapons: dict[str, dict]) -> dict | None:
    """One root object's record from its own `ObjectTemplate.aiTemplate`,
    wherever that template is declared, or None when the object has no AI.

    The engine gives an object its AI in `SimpleObject::SimpleObject`
    (lnxded 0x081da0d0): an empty `aiTemplate` name (the string at template
    +0x40, length tested at 0x081da21f) makes none, and a name
    `AITemplateManager::getTemplate` 0x0848a470 does not know (the null test
    at 0x081da2bc) is tried only as a weapon template. So DC's `A10_B` and
    `A10_C` (`aiTemplate A10`) are the A-10's unit, vanilla's `Ho-Ha` is the
    Hanomag's, and DC 0.7's `AH-6`, whose line is `rem`med, and its `Mirage`,
    whose `Mirage` no `aiTemplate.create` declares, are not units at all.
    The fields are `vehicle_record`'s; the hull's `aiWeapons` are the ones
    its root seat reaches.
    """
    ai_name = ai_of.get(root)
    entry = ai_table.get((ai_name or "").lower())
    if entry is None:
        return None
    root_t, root_plugins = entry
    pcos, guns = object_tree(root, graph, kinds)
    spell = {name: spelled for name, (spelled, _path) in sites.items()}
    folder = sites.get(root, ("", ""))[1].rsplit("/", 1)[0]
    low = folder.lower()

    def weapon_of(fa: str) -> dict | None:
        return all_weapons.get((ai_of.get(fa) or "").lower())

    seats_ai: dict[str, dict] = {}
    for pco in pcos:
        if pco not in ai_of:
            continue
        t, plugins = ai_table.get(ai_of[pco].lower(), (None, {}))
        seats_ai[spell.get(pco, pco)] = seat_record(ai_of[pco], t, plugins,
                                                    fire_arms_under(pco, graph, kinds), weapon_of)
    name = spell.get(root, root)
    info: dict = {
        "class": (folder.split("/")[2] if low.startswith("objects/vehicles/")
                  else "Stationary" if low.startswith("objects/stationary_weapons/") else None),
        "aiTemplate": root_t["name"],
        "basicTemp": basic_temp(root_t), "types": list(root_t.get("types", [])),
        "maxSpeed": None, "turnRadius": None, "vehicleNumber": None, "strType": None,
        "strategicStrength": None, "coverValue": None, "isTurnable": None,
        "fireArms": {spell.get(fa, fa): ai_of[fa] for fa in guns if fa in ai_of},
        "seats": {spell.get(p, p): ai_of[p] for p in pcos if p in ai_of},
        "aiWeapons": dict(seats_ai[name]["aiWeapons"]),
        "seatsAi": seats_ai,
    }
    apply_root(info, root_t, root_plugins)
    return info


def unanswered_roots(vehicles: dict[str, dict], graph: dict[str, list[str]], kinds: dict[str, str],
                     ai_of: dict[str, str], ai_table: dict) -> list[str]:
    """The root objects whose own AI template the folder records miss.

    A root is a PlayerControlObject no template adds (a placed hull, not a
    seat). The page finds a node's record by the node's template name, a
    record's key first and then any record's seat (`bot-units.js aiOf`, the
    records in the file's order); a root it would find no record for, or a
    record whose hull template is not the root's own, is answered here: DC's
    `A10_B`, whose folder ships no `AI/Objects.con`, and DC Final's `OH-6`,
    one of five hulls in the `H-6` folder whose record is the `AH-6`'s.
    A root that a record already lists as a seat and whose own template is
    a seat's (`aiTemplate.secondary`, the objects `getFirstSecondaryObject`
    walks) keeps that record: it is a passenger template no hull adds any
    more (DC's `UH-60_Passenger`), its seat numbers are already there, and
    a hull's words mean nothing for it.
    """
    index: dict[str, str] = {key.lower(): key for key in vehicles}
    for key in sorted(vehicles):
        for pco in vehicles[key]["seats"]:
            index.setdefault(pco.lower(), key)
    children = {c for kids in graph.values() for c in kids}
    out: list[str] = []
    for t in sorted(kinds):
        if kinds[t] != "PlayerControlObject" or t in children:
            continue
        ai = (ai_of.get(t) or "").lower()
        if not ai or ai not in ai_table:
            continue
        key = index.get(t)
        if key is not None and (vehicles[key].get("aiTemplate") or "").lower() == ai:
            continue
        if key is not None and key.lower() != t and ai_table[ai][0].get("secondary"):
            continue
        if key is not None and key.lower() == t:
            # A folder record keyed by this very name answers for another
            # template; a second record cannot take the key.
            print(f"warning: {t}: record {key} carries {vehicles[key].get('aiTemplate')}, "
                  f"the object {ai_of[t]}", file=sys.stderr)
            continue
        out.append(t)
    return out


ENTRY_POINT_RE = re.compile(r"^\s*ObjectTemplate\.create\s+EntryPoint\s", re.I | re.M)


def _level_objects(path: Path) -> tuple[list[str], dict[str, str], ArchivePool] | None:
    """A level's own `Objects/` tree: its paths from `Objects/` on, each
    path's entry in the level's archives (patches over the base, as
    `roster.level_pool` layers them), and that pool."""
    pool = roster_mod.level_pool(path)
    if pool is None:
        return None
    real: dict[str, str] = {}
    for name in pool.names():
        parts = name.replace("\\", "/").split("/")
        lowered = [p.lower() for p in parts]
        # `bf1942/levels/<Level>/Objects/...`, not a deeper folder called objects.
        if len(parts) < 5 or lowered[1] != "levels" or lowered[3] != "objects":
            continue
        real.setdefault("/".join(parts[3:]), name)
    return sorted(real), real, pool


def extract(mod: str, game_dir: Path = GAME.parent, levels: bool = True) -> dict:
    """Every unit's AI record along `mod`'s chain, one table for its tree.

    The chain is read the way the engine mounts it (`mod_chain`,
    `build_pools`): the nearest mod's copy of a file wins and archive names
    match in any case, so Desert Combat's `OBJECTS.rfa` opens and DC Final
    keeps the 54 units it inherits beside its own. `levels` adds the units a
    level declares in its own archive and a soldier can board (Caen's
    `Pak40`, DC Final's Al Nas trucks), after the global ones: a name the
    chain already has keeps the chain's record, and of two levels the first
    in `discover_levels` order wins, the way `ArchivePool.add_level_objects`
    resolves a level's templates. A level's copy of a chain unit that brings
    seats of its own (DC's Urban Siege `Nimitz`) is kept as
    `<Unit>@<Level>`. Each such record carries the `level` that declares it.
    """
    chain = mod_chain(game_dir, mod)
    _meshes, _textures, objects, _game = build_pools(chain, [])

    def read(name: str) -> str | None:
        blob = objects.try_read(name)
        return blob.decode("latin-1") if blob is not None else None

    names = objects.names()
    all_weapons, graph, kinds, ai_of = scan_objects(names, read, objects.source_of)
    vehicles: dict[str, dict] = {}
    for folder, files in sorted(vehicle_folders(names).values()):
        info = vehicle_record(folder, files, read, all_weapons, graph, kinds, ai_of)
        if info is not None:
            vehicles[folder.split("/")[-1]] = info
    # The engine links an object to its AI by the object's own `aiTemplate`,
    # never by the folder (`object_record`): each root object the folder
    # records miss gets a record of its own, keyed by its template's name.
    ai_table = ai_template_table(names, read)
    sites = template_sites(names, read)
    for root in unanswered_roots(vehicles, graph, kinds, ai_of, ai_table):
        info = object_record(root, sites, graph, kinds, ai_of, ai_table, all_weapons)
        if info is not None:
            vehicles[sites.get(root, (root, ""))[0]] = info
    if not levels:
        return {"mod": mod, "vehicles": vehicles}

    taken = {name.lower() for name in vehicles}
    seats = {pco.lower() for info in vehicles.values() for pco in info["seats"]}
    for level_name, path in discover_levels(chain):
        found = _level_objects(path)
        if found is None:
            continue
        local_names, real, pool = found

        def read_local(name: str, real=real, pool=pool) -> str | None:
            entry = real.get(name)
            blob = pool.try_read(entry) if entry else None
            return blob.decode("latin-1") if blob is not None else None

        # The level's own templates fill what the chain lacks; the chain's
        # keep priority (`ArchivePool.add_level_objects`).
        l_weapons, l_graph, l_kinds, l_ai_of = scan_objects(local_names, read_local)
        for folder, files in level_vehicle_folders(local_names).values():
            name = folder.split("/")[-1]
            # Only what a soldier can board: a level's buildings carry AI
            # templates and even a PlayerControlObject for their hit points
            # (Battle of Britain's factory and radar tower), but no door.
            objects_text = read_local(files["objects.con"]) if files.get("objects.con") else None
            if not objects_text or not ENTRY_POINT_RE.search(objects_text):
                continue
            info = vehicle_record(folder, files, read_local,
                                  {**l_weapons, **all_weapons}, {**l_graph, **graph},
                                  {**l_kinds, **kinds}, {**l_ai_of, **ai_of})
            if info is None or not info["seats"]:
                continue
            fresh = [pco for pco in info["seats"] if pco.lower() not in seats]
            key = name
            if name.lower() in taken:
                # A level that redeclares a unit the chain has, with seats of
                # its own: DC's Urban Siege places `Nimitz_Static_Heli_UrbS`,
                # a PlayerControlObject only its own `objects/Nimitz` declares.
                # The page finds a record by any of its seats' names, so the
                # level's copy goes in beside the chain's under its own key;
                # the names both declare stay with the chain's record.
                if not fresh:
                    continue
                key = f"{name}@{level_name}"
            if key.lower() in taken:
                continue
            info["level"] = level_name
            vehicles[key] = info
            taken.add(key.lower())
            seats.update(pco.lower() for pco in fresh)
    return {"mod": mod, "vehicles": vehicles}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent / "viewer" / "maps" / "_shared" / "vehicle-ai.json")
    a = ap.parse_args()
    data = extract(a.mod)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    print(f"{a.mod}: {len(data['vehicles'])} vehicles -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
