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

    python3 extract_vehicle_ai.py --mod bf1942
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.rfa import RfaArchive  # noqa: E402

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


def extract(mod: str) -> dict:
    archive = GAME / mod / "Archives" / "Objects.rfa"
    if not archive.exists():
        archive = GAME / mod / "Archives" / "objects.rfa"
    rfa = RfaArchive(str(archive))
    names = list(rfa.entries.keys())
    # Every weapon template the archive declares, and every object's
    # aiTemplate and addTemplate children: the shared guns (a Browning under
    # Objects/Weapons) are reached from a vehicle's seat through them.
    all_weapons: dict[str, dict] = {}
    graph: dict[str, list[str]] = {}
    kinds: dict[str, str] = {}
    ai_of: dict[str, str] = {}
    for n in names:
        low = n.lower()
        if not low.endswith(".con"):
            continue
        if low.endswith("/ai/weapons.con") or low.endswith("/ai/weapon.con"):
            all_weapons.update(parse_weapons_con(rfa.read(n).decode("latin-1")))
        elif low.startswith("objects/") and "/ai/" not in low:
            parse_template_graph(rfa.read(n).decode("latin-1"), graph, kinds, ai_of)
    by_folder: dict[str, dict[str, str]] = {}
    for n in names:
        low = n.lower()
        # A vehicle is `Objects/Vehicles/<class>/<name>`; a stationary gun
        # (`Stationary_Browning`, `Stationary_MG42`) is
        # `Objects/Stationary_Weapons/<name>`, a PlayerControlObject with an
        # AI template of its own like any vehicle.
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
        by_folder.setdefault(folder, {})[low[len(folder) + 1:]] = n
    vehicles: dict[str, dict] = {}
    for folder, files in sorted(by_folder.items()):
        ai_objects = files.get("ai/objects.con")
        if not ai_objects:
            continue
        vehicle_name = folder.split("/")[-1]
        parsed = parse_objects_con(rfa.read(ai_objects).decode("latin-1"))
        weapons = parse_weapons_con(rfa.read(files["ai/weapons.con"]).decode("latin-1")) if files.get("ai/weapons.con") else {}
        fire_arms, pcos = ({}, {})
        if files.get("objects.con"):
            fire_arms, pcos = parse_vehicle_objects(rfa.read(files["objects.con"]).decode("latin-1"))
        # The root PCO's template, and its Mobile / Physical / Unit / Cover plug-ins.
        root_ai = pcos.get(vehicle_name) or next(iter(pcos.values()), None)
        root = parsed["templates"].get((root_ai or "").lower()) or next(iter(parsed["templates"].values()), None)
        info: dict = {
            "class": folder.split("/")[2] if folder.lower().startswith("objects/vehicles/") else "Stationary",
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
        seats_ai: dict[str, dict] = {}
        for pco, ai_name in pcos.items():
            t = parsed["templates"].get(ai_name.lower())
            seat: dict = {"aiTemplate": ai_name, "secondary": bool(t and t.get("secondary")),
                          "strategicStrength": None, "aiWeapons": {},
                          "basicTemp": basic_temp(t), "types": list((t or {}).get("types", []))}
            for pname in (t["plugIns"] if t else []):
                p = parsed["plugIns"].get(pname.lower())
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
            if is_anti_aircraft(t, parsed["plugIns"]):
                seat["isAntiAircraft"] = True
            ctrl = control_info(t, parsed["plugIns"])
            if ctrl:
                seat["controlInfo"] = ctrl
            for fa in fire_arms_under(pco.lower(), graph, kinds):
                w_ai = ai_of.get(fa) or fire_arms.get(fa)
                w = all_weapons.get((w_ai or "").lower()) or weapons.get((w_ai or "").lower())
                if w:
                    seat["aiWeapons"][w["name"]] = {kk: vv for kk, vv in w.items() if kk != "name"}
            seats_ai[pco] = seat
        info["seatsAi"] = seats_ai
        if is_anti_aircraft(root, parsed["plugIns"]):
            info["isAntiAircraft"] = True
        root_ctrl = control_info(root, parsed["plugIns"])
        if root_ctrl:
            info["controlInfo"] = root_ctrl
        for pname in (root["plugIns"] if root else []):
            p = parsed["plugIns"].get(pname.lower())
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
        vehicles[vehicle_name] = info
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
