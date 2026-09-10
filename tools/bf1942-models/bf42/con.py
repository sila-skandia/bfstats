"""Refractor `.con` object scripting — enough of it to rebuild a vehicle.

A `.sm` is one *part*: a hull, one road wheel, a turret. What makes those parts a
Sherman is `Objects/Vehicles/Land/Sherman/Objects.con`, a flat script of stateful
commands that the engine replays to build a template tree:

    ObjectTemplate.create Bundle ShermanComplex     -- start defining ShermanComplex
    ObjectTemplate.geometry Sherman_Hull_M1         -- ...its own mesh
    ObjectTemplate.addTemplate ShermanTower         -- ...a child instance
    ObjectTemplate.setPosition 0/-0.8/0             -- placing THAT CHILD, not the parent

The last line is the trap. `setPosition` and `setRotation` after an `addTemplate`
belong to the child instance just added; before any `addTemplate`, they belong to
the template itself. Miss that and every sub-part collapses onto the origin — which
looks exactly like "the turret is missing".

Templates are referenced across files (a tank's coaxial gun is a HandWeapon defined
somewhere under `Objects/HandWeapons/`), so the whole archive is parsed into one
namespace before anything is resolved.

`GeometryTemplate.create <kind> <name>` / `GeometryTemplate.file <meshfile>` in
`Geometries.con` is the second indirection: the name in `ObjectTemplate.geometry`
is a *geometry template*, and only that template knows which `.sm` file to load.
They usually match, but not always — Sherman's `Sherman_MGun_Mount_M1` loads
`Tank_MGun_Mount_M1.sm`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_REM_BLOCK = re.compile(r"^\s*beginrem\b.*?^\s*endrem\b", re.IGNORECASE | re.MULTILINE | re.DOTALL)
# Deliberately matched one line at a time. A multiline pattern here is a trap: the
# whitespace run after the command name will happily cross a newline and swallow the
# following line as this command's arguments, which silently drops every declaration
# that follows an argument-less command such as `renderer.endGlobalCluster`.
_COMMAND = re.compile(r"^(\w+)\.(\w+)(?:[ \t]+(.*?))?[ \t]*$")


def strip_comments(text: str) -> str:
    text = _REM_BLOCK.sub("", text)
    return "\n".join(
        line for line in text.splitlines()
        if not line.lstrip().lower().startswith("rem")
    )


# `setInputTo*` takes either the symbolic constant or its raw enum id, and vanilla
# mixes the two. The numeric forms that actually occur are 4 and 5, always on the
# axis their symbolic twins use (`yaw 4` alongside 113 uses of `yaw c_PIMouseLookX`,
# `pitch 5` alongside 111 of `pitch c_PIMouseLookY`), which fixes the enum ordering.
# Whether a bound axis is a pose to hold or a rate to accumulate is decided by the
# declared span, not by the template kind. Across the 68 engine axes in vanilla the
# two populations do not overlap and there is nothing between them:
#
#   span 2250..15000   c_PIThrottle drivetrains, propellers, screws — accumulators
#                      (Willy roll +/-5000, every aircraft +/-3000..5000)
#   span 2             tracked and half-track hulls — a +/-1 degree body lean under
#                      steer and throttle (Sherman, Tiger, T34, PanzerIV, Hanomag...)
#
# Treating every Engine as a rate spins that 1 degree lean forever, and since a
# tank's tracks and road wheels are children of its Engine, the whole running gear
# orbits the hull.
ACCUMULATOR_SPAN = 360.0

PLAYER_INPUTS = {
    "0": "c_PINone",
    "1": "c_PIYaw",
    "2": "c_PIPitch",
    "3": "c_PIRoll",
    "4": "c_PIMouseLookX",
    "5": "c_PIMouseLookY",
}


def vec3(token: str) -> tuple[float, float, float]:
    parts = token.replace(",", "/").split("/")
    if len(parts) != 3:
        raise ValueError(f"not a vector: {token!r}")
    return tuple(float(p) for p in parts)


@dataclass
class ChildRef:
    """One `addTemplate` — a named template placed at an offset in its parent."""
    template: str
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)   # yaw / pitch / roll, degrees


@dataclass
class ObjectTemplate:
    name: str
    kind: str
    geometry: str | None = None
    children: list[ChildRef] = field(default_factory=list)
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    source: str = ""

    # Most vehicle movement in Refractor is not an animation file. A
    # RotationalBundle declares an axis, a range and a player input, and the engine
    # drives it every frame; `.baf` clips are for soldiers. See `rig` below.
    min_rotation: tuple[float, float, float] | None = None
    max_rotation: tuple[float, float, float] | None = None
    max_speed: tuple[float, float, float] | None = None
    inputs: dict[str, str] = field(default_factory=dict)   # yaw|pitch|roll -> input name
    automatic_reset: bool = False
    skeleton: str | None = None
    animated_texture_speed: tuple[float, float] | None = None

    @property
    def is_lod_selector(self) -> bool:
        return self.kind.lower() == "lodobject"

    def rig(self) -> dict | None:
        """The declared, input-driven motion of this part, if it has any.

        Ranges are Yaw/Pitch/Roll triples in the same order as `setRotation`. Three
        things make this less obvious than it looks:

        * **Absent limits mean unlimited, not zero.** A tank turret traverses a full
          circle and simply declares no `setMinRotation`, so an axis must be treated
          as free when its input is bound but no range was given. Requiring
          `min != max` silently deletes every turret's traverse.
        * `setInputTo*` accepts the numeric id as readily as the symbolic name, and
          vanilla uses both — PanzerIV's MG mount says `setInputToPitch 5` where the
          Sherman's says `c_PIMouseLookY`.
        * `c_PINone` is a binding to nothing and must not produce an axis.
        """
        if not self.inputs:
            return None
        axes = {}
        for index, axis in enumerate(("yaw", "pitch", "roll")):
            raw = self.inputs.get(axis)
            if raw is None:
                continue
            name = PLAYER_INPUTS.get(raw, raw)
            if name.lower() in ("c_pinone", "none"):
                continue
            lo = self.min_rotation[index] if self.min_rotation else None
            hi = self.max_rotation[index] if self.max_rotation else None
            free = lo is None or hi is None or lo == hi
            span = None if free else abs(hi - lo)
            axes[axis] = {
                "input": name,
                "min": lo if not free else None,
                "max": hi if not free else None,
                "free": free,
                "driver": "rate" if span is not None and span > ACCUMULATOR_SPAN else "position",
                "maxSpeed": (self.max_speed or (0.0, 0.0, 0.0))[index],
            }
        if not axes:
            return None
        return {"axes": axes, "automaticReset": self.automatic_reset}


@dataclass
class GeometryTemplate:
    name: str
    kind: str            # StandardMesh / AnimatedMesh / TreeMesh / ...
    file: str | None = None
    source: str = ""

    @property
    def mesh_file(self) -> str:
        return self.file or self.name


class ObjectLibrary:
    """Every template in an archive set, addressed case-insensitively."""

    def __init__(self) -> None:
        self.objects: dict[str, ObjectTemplate] = {}
        self.geometries: dict[str, GeometryTemplate] = {}
        # geometry template name -> the object folder it was declared in, so the
        # per-object `Art/*.rs` override can be found later.
        self.geometry_dir: dict[str, str] = {}

    def add_con(self, path: str, text: str) -> None:
        text = strip_comments(text)
        folder = path.rsplit("/", 1)[0] if "/" in path else ""
        obj: ObjectTemplate | None = None
        geom: GeometryTemplate | None = None
        child: ChildRef | None = None

        for line in text.splitlines():
            match = _COMMAND.match(line.strip())
            if not match:
                continue
            ns, cmd, args = match.group(1).lower(), match.group(2).lower(), match.group(3) or ""

            if ns == "objecttemplate":
                if cmd == "create":
                    parts = args.split()
                    if len(parts) < 2:
                        continue
                    obj = ObjectTemplate(name=parts[1], kind=parts[0], source=path)
                    self.objects.setdefault(parts[1].lower(), obj)
                    geom, child = None, None
                elif obj is None:
                    continue
                elif cmd == "geometry":
                    obj.geometry = args.split()[0] if args else None
                elif cmd == "addtemplate":
                    if args:
                        child = ChildRef(template=args.split()[0])
                        obj.children.append(child)
                elif cmd in ("setposition", "setrotation"):
                    try:
                        value = vec3(args.split()[0]) if args else (0.0, 0.0, 0.0)
                    except ValueError:
                        continue
                    # The active target is the last child added, else the template.
                    target = child or obj
                    if cmd == "setposition":
                        target.position = value
                    else:
                        target.rotation = value
                # The rig always belongs to the template being defined, never to a
                # child instance — it is behaviour, not placement.
                elif cmd in ("setminrotation", "setmaxrotation", "setmaxspeed"):
                    try:
                        value = vec3(args.split()[0]) if args else (0.0, 0.0, 0.0)
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {"setminrotation": "min_rotation",
                                  "setmaxrotation": "max_rotation",
                                  "setmaxspeed": "max_speed"}[cmd], value)
                elif cmd in ("setinputtoyaw", "setinputtopitch", "setinputtoroll"):
                    if args:
                        obj.inputs[cmd.removeprefix("setinputto")] = args.split()[0]
                elif cmd == "setautomaticreset":
                    obj.automatic_reset = args.strip().startswith("1")
                elif cmd == "createskeleton":
                    obj.skeleton = args.split()[0] if args else None
                elif cmd == "setanimatedtexturespeed":
                    try:
                        u, v = args.split()[0].replace(",", "/").split("/")[:2]
                        obj.animated_texture_speed = (float(u), float(v))
                    except (ValueError, IndexError):
                        continue

            elif ns == "geometrytemplate":
                if cmd == "create":
                    parts = args.split()
                    if len(parts) < 2:
                        continue
                    geom = GeometryTemplate(name=parts[1], kind=parts[0], source=path)
                    self.geometries.setdefault(parts[1].lower(), geom)
                    self.geometry_dir.setdefault(parts[1].lower(), folder)
                elif geom is not None and cmd == "file":
                    geom.file = args.split()[0] if args else None

    def object(self, name: str) -> ObjectTemplate | None:
        return self.objects.get(name.lower())

    def geometry(self, name: str) -> GeometryTemplate | None:
        return self.geometries.get(name.lower())

    def art_dir(self, geometry_name: str) -> str | None:
        folder = self.geometry_dir.get(geometry_name.lower())
        return f"{folder}/Art" if folder else None
