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

GAME = Path.home() / ".wine/drive_c/EAGames/Battlefield 1942/Mods"


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


def extract(mod: str) -> dict:
    archive = GAME / mod / "Archives" / "Objects.rfa"
    if not archive.exists():
        archive = GAME / mod / "Archives" / "objects.rfa"
    rfa = RfaArchive(str(archive))
    names = list(rfa.entries.keys())
    by_folder: dict[str, dict[str, str]] = {}
    for n in names:
        low = n.lower()
        if not low.startswith("objects/vehicles/"):
            continue
        parts = n.split("/")
        if len(parts) < 4:
            continue
        folder = "/".join(parts[:4])
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
            "class": folder.split("/")[2],
            "aiTemplate": root["name"] if root else None,
            "maxSpeed": None, "turnRadius": None, "vehicleNumber": None, "strType": None,
            "strategicStrength": None, "coverValue": None, "isTurnable": None,
            "fireArms": {k: v for k, v in fire_arms.items()},
            "seats": {k: v for k, v in pcos.items()},
            "aiWeapons": {w["name"]: {kk: vv for kk, vv in w.items() if kk != "name"} for w in weapons.values()},
        }
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
