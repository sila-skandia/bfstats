"""The MaterialManager damage tables, and the weapons that feed them.

Refractor decides what a hit does with three lookups that live in three places:

    Objects.rfa   Projectile ShermanProjectile        material 236   material2 206
    Game.rfa      materialManagerdefine.con           material 236 -> materialDamage 10
    Game.rfa      damage_system/Sherman.con           attGroup 236 x defGroup 50 -> damageMod 10

and the struck collision face supplies the defending material (50 for the Sherman's
rear). The documented result, from the Damage System tutorial in the Mod Development
Toolkit, is

    direct  = materialDamage(att) * damageMod(att, def) * cos(angle) * distanceMod
    splash  = materialDamage(att2) * damageMod(att2, splashMaterial) * (1 - d / radius)

Only pistols and submachine guns declare a distance term; for everything else it is 1.

`Game.rfa` is not in `Archives/` beside `objects.rfa`. The executable's hard-coded
archive list names it `Bf1942/game.rfa`, and Refractor mounts an archive at the
directory its internal paths begin with, so the file sits at
`Mods/<mod>/Archives/bf1942/Game.rfa` — the same `bf1942/` sub-folder as `levels/`.
The engine then runs `Bf1942/Game/MaterialManagerSettings.con` directly (that path is
also in the binary; no `.con` references it), which `Run`s the define file and every
`damage_system/*` and `Collision_Armor/*` script. A `run` whose target is absent is
skipped: vanilla's settings file names ten expansion weapons that only XPack1 and
XPack2 ship, and the base game plays fine without them.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Callable

from .con import _COMMAND

SETTINGS_SCRIPT = "bf1942/game/materialManagerSettings.con"

Resolver = Callable[[str], bytes | None]
"""Return a script's bytes for a case-insensitive archive path, or None if absent."""


@dataclass
class Material:
    id: int
    att_group: int
    def_group: int
    damage: float = 0.0
    label: str | None = None

    def as_dict(self) -> dict:
        out: dict = {"attGroup": self.att_group, "defGroup": self.def_group, "damage": self.damage}
        if self.label:
            out["label"] = self.label
        return out


@dataclass
class Weapon:
    """A projectile and, when one declares it, the firearm that launches it."""
    name: str
    projectile: str
    owner: str
    category: str
    source: str
    material: int | None = None
    material2: int | None = None
    radius: float | None = None
    damage_type: int | None = None
    min_damage: float | None = None
    dist_to_start_lose_damage: float | None = None
    dist_to_min_damage: float | None = None
    velocity: float | None = None
    mag_size: int | None = None
    reload_time: float | None = None
    round_of_fire: float | None = None

    def distance_mod(self, distance: float) -> float:
        """The documented linear fall-off, 1.0 for weapons that declare none."""
        if (self.min_damage is None or self.dist_to_start_lose_damage is None
                or self.dist_to_min_damage is None):
            return 1.0
        if distance <= self.dist_to_start_lose_damage:
            return 1.0
        if distance >= self.dist_to_min_damage or self.dist_to_min_damage <= self.dist_to_start_lose_damage:
            return self.min_damage
        span = self.dist_to_min_damage - self.dist_to_start_lose_damage
        return self.min_damage + (1.0 - self.min_damage) * (self.dist_to_min_damage - distance) / span

    def as_dict(self) -> dict:
        out = {
            "name": self.name,
            "projectile": self.projectile,
            "owner": self.owner,
            "category": self.category,
            "source": self.source,
        }
        for key, value in {
            "material": self.material,
            "material2": self.material2,
            "radius": self.radius,
            "damageType": self.damage_type,
            "minDamage": self.min_damage,
            "distToStartLoseDamage": self.dist_to_start_lose_damage,
            "distToMinDamage": self.dist_to_min_damage,
            "velocity": self.velocity,
            "magSize": self.mag_size,
            "reloadTime": self.reload_time,
            "roundOfFire": self.round_of_fire,
        }.items():
            if value is not None:
                out[key] = value
        return out


@dataclass
class DamageTables:
    materials: dict[int, Material] = field(default_factory=dict)
    modifiers: dict[tuple[int, int], float] = field(default_factory=dict)
    effects: dict[tuple[int, int], str] = field(default_factory=dict)
    scripts: list[str] = field(default_factory=list)
    missing_scripts: list[str] = field(default_factory=list)

    def att_group(self, material: int) -> int:
        """A material's attack group; undefined materials map onto themselves.

        Every vanilla definition sets `materialAttGroup` and `materialDefGroup`
        equal to the material id, so the identity is also what the tables mean
        when a collision mesh uses an id the define file never mentions.
        """
        defined = self.materials.get(material)
        return defined.att_group if defined else material

    def def_group(self, material: int) -> int:
        defined = self.materials.get(material)
        return defined.def_group if defined else material

    def base_damage(self, att_material: int) -> float | None:
        defined = self.materials.get(att_material)
        return defined.damage if defined else None

    def modifier(self, att_material: int, def_material: int) -> float | None:
        """`damageMod` for a projectile material against a struck material.

        None means the pair has no entry, which the engine treats as no effect.
        """
        return self.modifiers.get((self.att_group(att_material), self.def_group(def_material)))

    def direct_damage(self, att_material: int, def_material: int, *,
                      angle_degrees: float = 0.0, distance_mod: float = 1.0) -> float | None:
        base = self.base_damage(att_material)
        mod = self.modifier(att_material, def_material)
        if base is None or mod is None:
            return None
        return base * mod * math.cos(math.radians(abs(angle_degrees))) * distance_mod

    def splash_damage(self, att_material2: int, splash_material: int, *,
                      distance: float = 0.0, radius: float | None = None) -> float | None:
        base = self.base_damage(att_material2)
        mod = self.modifier(att_material2, splash_material)
        if base is None or mod is None:
            return None
        if radius is None or radius <= 0:
            radius_mod = 1.0 if distance <= 0 else 0.0
        else:
            radius_mod = max(0.0, 1.0 - distance / radius)
        return base * mod * radius_mod

    def as_dict(self) -> dict:
        grouped: dict[str, dict[str, float]] = {}
        for (att, deff), mod in sorted(self.modifiers.items()):
            grouped.setdefault(str(att), {})[str(deff)] = mod
        return {
            "source": SETTINGS_SCRIPT,
            "scripts": list(self.scripts),
            "missingScripts": list(self.missing_scripts),
            "materials": {str(k): v.as_dict() for k, v in sorted(self.materials.items())},
            "modifiers": grouped,
        }


def _number(args: str) -> float | None:
    try:
        return float(args.split()[0])
    except (ValueError, IndexError):
        return None


def _resolve_run(current_script: str, target: str) -> str:
    """The archive path a `run` names, relative to the running script's folder.

    `.con` is implied when the target carries no extension, and `../` is honoured
    because the AI scripts use it.
    """
    target = target.strip().strip('"').replace("\\", "/")
    if "." not in target.rsplit("/", 1)[-1]:
        target += ".con"
    base = current_script.replace("\\", "/").rsplit("/", 1)[0] if "/" in current_script else ""
    parts = (f"{base}/{target}" if base and not target.startswith("/") else target).split("/")
    out: list[str] = []
    for part in parts:
        if part in ("", "."):
            continue
        if part == "..":
            if out:
                out.pop()
            continue
        out.append(part)
    return "/".join(out)


_DECORATIVE = re.compile(r"^[\s*#=_-]*$")
_RUN = re.compile(r"^(?:run|include)\s+(\S.*?)\s*$", re.IGNORECASE)


def _heading(line: str) -> str | None:
    """The text of a `rem` line, or None when it is only asterisks."""
    body = line.strip()
    if not body[:3].lower() == "rem":
        return None
    body = body[3:].strip().strip("*").strip()
    if not body or _DECORATIVE.match(body):
        return None
    return body


def load_tables(resolve: Resolver, entry: str = SETTINGS_SCRIPT,
                max_depth: int = 8) -> DamageTables:
    """Replay `MaterialManagerSettings.con` and everything it `run`s.

    `resolve` is asked for each script by case-insensitive archive path and returns
    None for a script that is not there — which is recorded, not fatal, because
    that is what the engine does with vanilla's ten expansion-only `run` lines.
    """
    tables = DamageTables()
    seen: set[str] = set()

    def run(script: str, depth: int) -> None:
        key = script.lower()
        if key in seen or depth > max_depth:
            return
        seen.add(key)
        raw = resolve(script)
        if raw is None:
            tables.missing_scripts.append(script)
            return
        tables.scripts.append(script)
        _parse_script(tables, raw.decode("latin-1"), script, lambda target: run(target, depth + 1))

    run(entry, 0)
    return tables


def _parse_script(tables: DamageTables, text: str, script: str,
                  run: Callable[[str], None]) -> None:
    material: Material | None = None
    att_group: int | None = None
    def_group: int | None = None
    heading: str | None = None

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped[:3].lower() == "rem":
            heading = _heading(stripped) or heading
            continue
        if run_match := _RUN.match(stripped):
            run(_resolve_run(script, run_match.group(1)))
            continue
        match = _COMMAND.match(stripped)
        if not match or match.group(1).lower() != "materialmanager":
            continue
        cmd, args = match.group(2).lower(), match.group(3) or ""

        if cmd == "material":
            value = _number(args)
            if value is None:
                continue
            ident = int(value)
            material = tables.materials.setdefault(ident, Material(ident, ident, ident))
            if heading and not material.label:
                material.label = heading
            heading = None
        elif cmd == "materialattgroup" and material is not None:
            value = _number(args)
            if value is not None:
                material.att_group = int(value)
        elif cmd == "materialdefgroup" and material is not None:
            value = _number(args)
            if value is not None:
                material.def_group = int(value)
        elif cmd == "materialdamage" and material is not None:
            value = _number(args)
            if value is not None:
                material.damage = value
        elif cmd == "attgroup":
            value = _number(args)
            att_group = int(value) if value is not None else None
        elif cmd == "defgroup":
            value = _number(args)
            def_group = int(value) if value is not None else None
        elif cmd == "damagemod" and att_group is not None and def_group is not None:
            value = _number(args)
            if value is not None:
                tables.modifiers[(att_group, def_group)] = value
        elif cmd == "seteffecttemplate" and att_group is not None and def_group is not None:
            if args.strip():
                tables.effects[(att_group, def_group)] = args.split()[0]


# Where a template's `.con` lives says what fires it. Mirrors the extractor's
# catalogue, so a weapon's `category` lines up with the vehicle list.
_CATEGORY_PREFIXES = {
    "objects/vehicles/land/": "land",
    "objects/vehicles/air/": "air",
    "objects/vehicles/sea/": "sea",
    "objects/stationary_weapons/": "emplacement",
    "objects/handweapons/": "handweapon",
    "objects/items/": "kit",
}


def _owner(path: str) -> str:
    parts = path.replace("\\", "/").split("/")
    return parts[-2] if len(parts) >= 2 else ""


def _category(path: str) -> str:
    lowered = path.lower()
    return next((v for k, v in _CATEGORY_PREFIXES.items() if lowered.startswith(k)), "object")


_PROJECTILE_FIELDS = {
    "material": ("material", int),
    "material2": ("material2", int),
    "radius": ("radius", float),
    "damagetype": ("damage_type", int),
    "mindamage": ("min_damage", float),
    "disttostartlosedamage": ("dist_to_start_lose_damage", float),
    "disttomindamage": ("dist_to_min_damage", float),
}

_LAUNCHER_FIELDS = {
    "velocity": ("velocity", float),
    "magsize": ("mag_size", int),
    "reloadtime": ("reload_time", float),
    "roundoffire": ("round_of_fire", float),
    "mindamage": ("min_damage", float),
    "disttostartlosedamage": ("dist_to_start_lose_damage", float),
    "disttomindamage": ("dist_to_min_damage", float),
}


def collect_weapons(scripts: dict[str, str]) -> list[Weapon]:
    """Every `Projectile` template, joined to the templates that fire it.

    `scripts` maps archive path to `.con` text. A launcher is any template with
    `ObjectTemplate.projectileTemplate` — FireArms, HandFireArms, grenades, bomb
    racks — and it, not the projectile, carries the name a player would recognise
    (`ShermanGunBarrel` fires `ShermanProjectile`; the rifle bullets all share
    `Objects/HandWeapons/Common/Weapons.con`). A projectile nothing launches is
    still listed under its own name.
    """
    projectiles: dict[str, dict] = {}
    launchers: list[dict] = []

    for path, text in scripts.items():
        current: dict | None = None
        for line in text.splitlines():
            match = _COMMAND.match(line.strip())
            if not match or match.group(1).lower() != "objecttemplate":
                continue
            cmd, args = match.group(2).lower(), (match.group(3) or "").strip()
            if cmd == "create":
                parts = args.split()
                if len(parts) < 2:
                    current = None
                    continue
                kind, name = parts[0], parts[1]
                current = {"kind": kind, "name": name, "source": path}
                if kind.lower() == "projectile":
                    projectiles.setdefault(name.lower(), current)
                continue
            if current is None:
                continue
            if cmd == "projectiletemplate" and args:
                current["projectile"] = args.split()[0]
                launchers.append(current)
            elif current["kind"].lower() == "projectile" and cmd in _PROJECTILE_FIELDS:
                attr, cast = _PROJECTILE_FIELDS[cmd]
                value = _number(args)
                if value is not None:
                    current[attr] = cast(value)
            elif cmd in _LAUNCHER_FIELDS:
                attr, cast = _LAUNCHER_FIELDS[cmd]
                value = _number(args)
                if value is not None:
                    current[attr] = cast(value)

    weapons: list[Weapon] = []
    launched: set[str] = set()
    for launcher in launchers:
        projectile = projectiles.get(launcher["projectile"].lower())
        if projectile is None:
            continue
        launched.add(launcher["projectile"].lower())
        weapon = Weapon(
            name=launcher["name"],
            projectile=projectile["name"],
            owner=_owner(launcher["source"]),
            category=_category(launcher["source"]),
            source=launcher["source"],
        )
        for attr, _ in _PROJECTILE_FIELDS.values():
            if attr in projectile:
                setattr(weapon, attr, projectile[attr])
        for attr, _ in _LAUNCHER_FIELDS.values():
            if getattr(weapon, attr) is None and attr in launcher:
                setattr(weapon, attr, launcher[attr])
        weapons.append(weapon)

    for key, projectile in projectiles.items():
        if key in launched:
            continue
        weapon = Weapon(
            name=projectile["name"],
            projectile=projectile["name"],
            owner=_owner(projectile["source"]),
            category=_category(projectile["source"]),
            source=projectile["source"],
        )
        for attr, _ in _PROJECTILE_FIELDS.values():
            if attr in projectile:
                setattr(weapon, attr, projectile[attr])
        weapons.append(weapon)

    weapons.sort(key=lambda w: (w.category, w.owner.lower(), w.name.lower()))
    return weapons
