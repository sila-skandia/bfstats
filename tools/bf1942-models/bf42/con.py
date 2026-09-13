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

# A LandingGear is not player-bound: the engine drives it from altitude
# (`setGearDownHeight`) and throttle (`setGearUpEngineInput` /
# `setGearDownEngineInput`). The synthetic name below is not an engine
# constant — it exists so retraction rides the same rig schema as the
# input-driven axes, as a 0 (deployed) .. 1 (retracted) position.
GEAR_INPUT = "c_PILandingGear"

MODEL_CONFIGURATIONS = ("complex", "wreck")


def vec3(token: str) -> tuple[float, float, float]:
    parts = token.replace(",", "/").split("/")
    if len(parts) != 3:
        raise ValueError(f"not a vector: {token!r}")
    return tuple(float(p) for p in parts)


def vec3_lenient(token: str) -> tuple[float, float, float]:
    """A vector whose author trailed off — `15/0/` means 15/0/0.

    `setContinousRotationSpeed` triples in shipped data drop trailing
    components (vanilla's `RadarBun_tower_M1` says `15/0/`), which the engine
    reads as zero rather than as an error.
    """
    parts = (token.replace(",", "/").split("/") + ["0", "0", "0"])[:3]
    return tuple(float(p) if p.strip() else 0.0 for p in parts)


@dataclass
class ChildRef:
    """One `addTemplate` — a named template placed at an offset in its parent."""
    template: str
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)   # yaw / pitch / roll, degrees
    first_person_part: int | None = None
    random_geometries: int | None = None
    lod_value: float | None = None
    # `bindToSkeletonPart <bone>` instead of a `setPosition`. Hand weapons place
    # every sub-part this way: the trigger, magazine and loaded round carry no
    # offset at all because the `.ske` bone they name already holds it.
    skeleton_part: str | None = None


def lod_alternative_role(template_name: str) -> str | None:
    """The semantic role encoded in a LodObject child's conventional name."""
    name = template_name.lower()
    # Buildings use Interior/Exterior; vehicles use Internal/External/Complex.
    # "interior" is checked before "complex" so a name cannot match both.
    if "interior" in name or "internal" in name:
        return "interior"
    if "wreck" in name:
        return "wreck"
    if "simple" in name:
        return "simple"
    if "complex" in name or "external" in name or "exterior" in name:
        return "complex"
    return None


def select_lod_alternative(children: list[ChildRef], configuration: str) -> ChildRef:
    """Choose one LodObject alternative without ever stacking its siblings."""
    if not children:
        raise ValueError("cannot select from an empty LodObject")
    if configuration not in MODEL_CONFIGURATIONS:
        raise ValueError(f"unknown model configuration: {configuration}")

    return next(
        (child for child in children if lod_alternative_role(child.template) == configuration),
        children[0],
    )


def instance_template_name(ref: ChildRef, lookup) -> str | None:
    """The template to instantiate for a child, or None if this instance is hidden.

    Soldiers declare first-person arms and a distant simple head as siblings of
    the third-person body. Those are alternatives, not extra parts — stacking
    them is the same class of bug as drawing Complex and Wreck together.
    `setRandomGeometries N` means the engine picks among `<name>1`..`<name>N`;
    the named template itself is often absent.
    """
    if ref.first_person_part not in (None, 0):
        return None
    if ref.lod_value is not None and ref.lod_value < 0:
        return None
    if lookup(ref.template) is not None:
        return ref.template
    if ref.random_geometries:
        return f"{ref.template}1"
    return ref.template


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
    # Which bone of that skeleton the object's own origin sits on. Weapon
    # skeletons are rooted at `Bip01 R Hand` — where the thing attaches to a
    # soldier, not where its geometry is centred — so bound parts are measured
    # against this bone rather than the root.
    skeleton_main: str | None = None
    invisible: bool = False
    animated_texture_speed: tuple[float, float] | None = None
    # Parts flagged `hasMobilePhysics 1` are separate physics bodies: an
    # Engine's accumulated spin never reaches them visually (a Corsair's
    # landing gear hangs off its Engine yet does not turn with the propeller).
    has_mobile_physics: bool = False
    # `setContinousRotationSpeed y/p/r` — ambient deg/s the engine applies
    # unconditionally (windmill wings, radar dishes, the CH-47's parked rotor).
    continuous_rotation: tuple[float, float, float] | None = None
    has_armor: bool = False
    hitpoints: float | None = None
    max_hitpoints: float | None = None
    material: int | None = None
    critical_damage: float | None = None
    hp_lost_while_critical_damage: float | None = None

    @property
    def is_lod_selector(self) -> bool:
        return self.kind.lower() == "lodobject"

    def control_scope(self, inherited: str) -> str:
        if self.kind.lower() == "playercontrolobject":
            return self.name
        return inherited

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
        * A LandingGear axis has no input at all; its retraction is synthesized
          under `GEAR_INPUT` (see `_landing_gear_axes`). Input-bound axes win
          over the synthesis on the same axis — DC Final's `AC-130_Gear_Front`
          steers its yaw from `c_PIYaw` like a nose wheel.
        """
        gear = self._landing_gear_axes() if self.kind.lower() == "landinggear" else {}
        if not self.inputs and not gear:
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
        for axis, spec in gear.items():
            axes.setdefault(axis, spec)
        if not axes:
            return None
        return {"axes": axes, "automaticReset": self.automatic_reset}

    def _landing_gear_axes(self) -> dict:
        """Retraction of a LandingGear, as `GEAR_INPUT`-driven position axes.

        Per moving axis a gear declares one bound per pose, and the bound
        farther from zero is the retracted one; the nearer bound — almost
        always the undeclared 0 the mesh was authored in, parked on its
        wheels — is deployed. The Spitfire's mirrored legs fix the sign
        convention (left `setMinRotation -20/0/-79`, right
        `setMaxRotation 20/0/79`: both fold up into the wings), and mods
        confirm the magnitude reading where both bounds appear (FH's
        Thunderbolt leg spans roll 1..84 — deployed rests at 1). Neither
        `setMaxSpeed` nor `setAcceleration` adds information: across all
        3,173 moving gear axes in the installed mods that carry both, the
        sign of their product always points at the farther bound (the
        Corsair's right leg pairs acceleration 75 with maxSpeed -30), and no
        axis declares equal-magnitude opposite bounds. `min`/`max` here are
        the deployed/retracted angles, not an ordered range — deployed may
        be the numerically larger one.
        """
        axes = {}
        mn = self.min_rotation or (0.0, 0.0, 0.0)
        mx = self.max_rotation or (0.0, 0.0, 0.0)
        for index, axis in enumerate(("yaw", "pitch", "roll")):
            lo, hi = mn[index], mx[index]
            if lo == hi:
                continue
            deployed, retracted = (hi, lo) if abs(lo) >= abs(hi) else (lo, hi)
            axes[axis] = {
                "input": GEAR_INPUT,
                "min": deployed,
                "max": retracted,
                "free": False,
                "driver": "position",
                "maxSpeed": (self.max_speed or (0.0, 0.0, 0.0))[index],
            }
        return axes


@dataclass
class GeometryTemplate:
    name: str
    kind: str            # StandardMesh / AnimatedMesh / TreeMesh / ...
    file: str | None = None
    skin: str | None = None
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
                elif cmd == "useskeletonpartasmain":
                    obj.skeleton_main = args.split()[0] if args else None
                elif cmd == "createinvisible":
                    obj.invisible = args.strip().startswith("1")
                elif cmd == "hasmobilephysics":
                    obj.has_mobile_physics = args.strip().startswith("1")
                elif cmd == "setcontinousrotationspeed":
                    try:
                        obj.continuous_rotation = vec3_lenient(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                elif cmd == "setanimatedtexturespeed":
                    try:
                        u, v = args.split()[0].replace(",", "/").split("/")[:2]
                        obj.animated_texture_speed = (float(u), float(v))
                    except (ValueError, IndexError):
                        continue
                elif cmd == "hasarmor":
                    obj.has_armor = args.strip().startswith("1")
                elif cmd == "material":
                    try:
                        obj.material = int(float(args.split()[0]))
                    except (ValueError, IndexError):
                        continue
                elif cmd in (
                    "hitpoints",
                    "maxhitpoints",
                    "criticaldamage",
                    "hplostwhilecriticaldamage",
                ):
                    try:
                        value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {
                        "hitpoints": "hitpoints",
                        "maxhitpoints": "max_hitpoints",
                        "criticaldamage": "critical_damage",
                        "hplostwhilecriticaldamage": "hp_lost_while_critical_damage",
                    }[cmd], value)
                elif child is None:
                    continue
                elif cmd == "setisfirstpersonpart":
                    try:
                        child.first_person_part = int(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                elif cmd == "setrandomgeometries":
                    try:
                        child.random_geometries = int(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                elif cmd == "setlodvalue":
                    try:
                        child.lod_value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                elif cmd == "bindtoskeletonpart":
                    # Soldiers write a trailing bone index (`Bip01_Spine3 3`);
                    # only the name is load-bearing.
                    child.skeleton_part = args.split()[0] if args else None

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
                elif geom is not None and cmd == "setskin":
                    geom.skin = args.split()[0] if args else None

    def object(self, name: str) -> ObjectTemplate | None:
        return self.objects.get(name.lower())

    def geometry(self, name: str) -> GeometryTemplate | None:
        return self.geometries.get(name.lower())

    def art_dir(self, geometry_name: str) -> str | None:
        folder = self.geometry_dir.get(geometry_name.lower())
        return f"{folder}/Art" if folder else None

    def available_configurations(self, root_name: str) -> list[str]:
        """Configurations represented by LodObject alternatives below a root."""
        if self.object(root_name) is None:
            return []

        available = {"complex"}
        visited: set[str] = set()

        def visit(template_name: str, depth: int = 0) -> None:
            if depth > 24:
                return
            template = self.object(template_name)
            if template is None:
                return
            key = template.name.lower()
            if key in visited:
                return
            visited.add(key)
            if template.is_lod_selector:
                for child in template.children:
                    role = lod_alternative_role(child.template)
                    if role is not None:
                        available.add(role)
            for child in template.children:
                visit(child.template, depth + 1)

        visit(root_name)
        return [name for name in MODEL_CONFIGURATIONS if name in available]
