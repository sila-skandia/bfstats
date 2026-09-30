"""Capture the Flag's flag bases, read the way a host builds them.

A CTF level's root `Ctf.con` places one `FlagBase` per side in its host branch
(`object.create UKbase` + `Object.absolutePosition`), which `script_objects`
already collects into the `Ctf` game type's `objects`. What a placement MEANS
is its template:

    ObjectTemplate.create FlagBase UKbase        (Objects/Items/Flag/Objects.con)
    ObjectTemplate.team 2
    ObjectTemplate.flagTemplate BrittishFlag
    ObjectTemplate.radius 5
    ObjectTemplate.setFlagLocation 0/7.6/0 0/0/0

    ObjectTemplate.create Flag BrittishFlag
    ObjectTemplate.team 2
    ObjectTemplate.radius 5
    ObjectTemplate.TimeToReSpawn 30
    ObjectTemplate.addTemplate AnimatedUkFlag    -> geometry flaguk_m1

The engine keeps one template namespace and the FIRST `create` of a name owns
it (`ObjectTemplateManager::createTemplate` 0x081d5a30), in the order a level
load runs its scripts: the level's `Init.con` (where most levels declare
`BlueFlag` / `RedFlag`), then every `.con` under `objects/`, then the game
type's script (`Game::load` 0x0805b785, 0x0805bc39, 0x0805bd75). A few levels
declare their own `Flag`s in `Ctf.con` itself (Desert Combat's Bocage Day 2
`AxisFlag`); those lose to any earlier name and are only read if nothing else
declares it.

`FlagBase::handleUpdate` (0x08292b30) raises the flag its template names at
the base's position plus `setFlagLocation`, and hands it the BASE's team
(vt+0x108 with `+0x150`), so the flag template's own `team` is not what the
round plays. `flag_bases` reports both anyway.
"""

from __future__ import annotations

import re

_OBJECT_TEMPLATE = re.compile(r"^\s*objecttemplate\.(\w+)\s*(.*?)\s*$", re.I)

#: The template kinds this reads; everything else is skipped cheaply.
_KINDS = frozenset({"flagbase", "flag", "animatedbundle"})


class TemplateBlocks:
    """`ObjectTemplate` blocks of the three kinds a flag base involves, first
    declaration wins, `active` reopens."""

    def __init__(self) -> None:
        # name (lower) -> {"name", "kind", "props": {cmd: args}, "children": [...]}
        self.blocks: dict[str, dict] = {}

    def add_text(self, text: str) -> None:
        if "objecttemplate" not in text.lower():
            return
        current: dict | None = None
        for line in text.splitlines():
            match = _OBJECT_TEMPLATE.match(line)
            if not match:
                continue
            cmd = match.group(1).lower()
            args = match.group(2).strip()
            if cmd == "create":
                tokens = args.split()
                current = None
                if len(tokens) < 2:
                    continue
                kind, name = tokens[0].lower(), tokens[1]
                key = name.lower()
                if key in self.blocks:
                    continue                    # declared already: makes nothing
                block = self.blocks[key] = {"name": name, "kind": kind,
                                            "props": {}, "children": []}
                current = block if kind in _KINDS else None
            elif cmd in ("active", "activesafe"):
                tokens = args.split()
                block = self.blocks.get(tokens[-1].lower()) if tokens else None
                current = block if block is not None and block["kind"] in _KINDS else None
            elif current is not None:
                if cmd == "addtemplate":
                    if args:
                        current["children"].append(args.split()[0])
                else:
                    current["props"].setdefault(cmd, args)

    def get(self, name: str | None, kind: str | None = None) -> dict | None:
        if not name:
            return None
        block = self.blocks.get(name.lower())
        if block is None:
            return None
        if kind and block["kind"] != kind:
            return None
        return block


def _num(text: str | None) -> float | None:
    if text is None:
        return None
    try:
        return float(str(text).split()[0])
    except (ValueError, IndexError):
        return None


def _vec3(text: str | None) -> list[float] | None:
    if not text:
        return None
    try:
        parts = [float(v) for v in str(text).split()[0].split("/")[:3]]
    except ValueError:
        return None
    return parts if len(parts) == 3 else None


def _team(text: str | None) -> int | None:
    value = _num(text)
    return int(value) if value is not None else None


def _word(text: str | None) -> str | None:
    words = str(text or "").split()
    return words[0] if words else None


def flag_geometry(blocks: TemplateBlocks, flag: dict | None) -> str | None:
    """The flag's cloth mesh: its first child bundle's `geometry`
    (`AnimatedUkFlag` -> `flaguk_m1`), or its own."""
    if flag is None:
        return None
    for child in flag["children"]:
        bundle = blocks.get(child)
        geometry = _word(bundle["props"].get("geometry")) if bundle else None
        if geometry:
            return geometry
    return _word(flag["props"].get("geometry"))


def flag_bases(placements, blocks: TemplateBlocks, to_gltf) -> list[dict]:
    """Every `FlagBase` among a game type's script placements, with its flag.

    `placements` are `StaticInstance`s (`GameType.objects`); `to_gltf` turns a
    con position into the viewer's frame. A placement whose template is not a
    `FlagBase` (a `FlagPole`, scenery) is skipped.
    """
    out: list[dict] = []
    for inst in placements or []:
        base = blocks.get(inst.template, "flagbase")
        if base is None:
            continue
        props = base["props"]
        location = _vec3(props.get("setflaglocation"))
        flag_name = _word(props.get("flagtemplate"))
        flag = blocks.get(flag_name, "flag")
        flag_props = flag["props"] if flag else {}
        team = inst.team if getattr(inst, "team", None) is not None else _team(props.get("team"))
        out.append({
            "name": inst.template,
            "template": base["name"],
            "position": to_gltf(inst.position),
            "rotation": list(inst.rotation),
            "team": team,
            "radius": _num(props.get("radius")),
            "flagLocation": location,
            "geometry": _word(props.get("geometry")),
            "flag": {
                "template": flag["name"] if flag else flag_name,
                "team": _team(flag_props.get("team")),
                "radius": _num(flag_props.get("radius")),
                "timeToRespawn": _num(flag_props.get("timetorespawn")),
                "geometry": flag_geometry(blocks, flag),
            },
        })
    return out
