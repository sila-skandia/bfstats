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


def crd(token: str) -> float | None:
    """The deterministic value of a CRD random-variable token.

    Scalar effect parameters are written as `CRD_<distribution>/<a>/<b>/<c>`
    (`timeToLive CRD_NONE/0.07/0/0`, `setTracerTemplate ... CRD_NONE/3/0/0`),
    where the first number is the mean / fixed value. Bare numbers also occur
    (`gravityModifier 0`), so both spellings are accepted.
    """
    parts = token.split("/")
    if parts and parts[0].upper().startswith("CRD"):
        parts = parts[1:]
    try:
        return float(parts[0])
    except (ValueError, IndexError):
        return None


def curve(token: str) -> list[list[float]] | None:
    """An over-time ramp: `0/0.12|100/9.4` -> [[0, 0.12], [100, 9.4]].

    Time runs 0..100 (percent of the particle's timeToLive). Points carry one
    value for `sizeOverTime` and four (RGBA, 0..255) for `colorRGBAOverTime`.
    """
    points: list[list[float]] = []
    for chunk in token.split("|"):
        try:
            points.append([float(p) for p in chunk.split("/") if p.strip()])
        except ValueError:
            return None
    return points or None


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


@dataclass
class LodSelector:
    """A `LodSelectorTemplate` block — the rule a LodObject picks alternatives by.

    Refractor names the rule rather than inlining it: the LodObject says
    `ObjectTemplate.lodSelector CorsairCockpitSelector` and a separate
    `LodSelectorTemplate.create <kind> <name>` block declares the thresholds.
    Two terms exist and a selector kind decides which of them it consults:

        LodSelectorTemplate.create DistCompareSelector CorsairCockpitSelector
        LodSelectorTemplate.addLodDistance 20        metres from the observer
        LodSelectorTemplate.addLodComparison 0.5     against a per-kind scalar

    What feeds the comparison scalar is engine-side and differs per selector
    kind — engine input for a propeller's `CompareSelector` (`addLodComparison
    0.07` swaps the static blade for the blurred disc), an in-cockpit flag for
    a cockpit's. We record the declared numbers and let the caller decide; the
    exporter uses only the *alternatives*, not the thresholds, and stamps the
    thresholds on the node so a viewer can reproduce the swap.
    """
    name: str
    kind: str
    distances: list[float] = field(default_factory=list)
    comparisons: list[float] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"selector": self.name, "selectorKind": self.kind,
                "distances": list(self.distances),
                "comparisons": list(self.comparisons)}


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


def split_geometry_qualifier(name: str) -> tuple[str | None, str]:
    """Split a `Type:Name` geometry reference into its parts.

    Refractor lets an ObjectTemplate qualify the geometry it names with the
    template type — the shell-casing emitter payloads write
    `ObjectTemplate.geometry StandardMesh:Shell792mmHI_m1`. The
    GeometryTemplate itself is always declared under the bare name, so the
    qualifier has to come off before any lookup.
    """
    kind, separator, bare = name.partition(":")
    return (kind, bare) if separator else (None, name)


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

    # `setTeamGeometry <team> <mesh>` — which mesh a ControlPoint's flag wears
    # for each side. Team colour in Refractor is a whole-mesh swap, never a
    # texture swap: all six vanilla flags bind the same `texture/flags_o` atlas
    # and differ only by the UV rect their `.sm` reads out of it. Without this
    # every flag falls back to `AnimatedFlag`'s own placeholder, which is the
    # Soviet flag — a Soviet flag on Midway.
    team_geometry: dict[int, str] = field(default_factory=dict)

    # Most vehicle movement in Refractor is not an animation file. A
    # RotationalBundle declares an axis, a range and a player input, and the engine
    # drives it every frame; `.baf` clips are for soldiers. See `rig` below.
    min_rotation: tuple[float, float, float] | None = None
    max_rotation: tuple[float, float, float] | None = None
    max_speed: tuple[float, float, float] | None = None
    # `setAcceleration y/p/r`. Its *sign* is the deflection direction, and on a
    # symmetric surface it is the only thing that carries it: a Corsair's two
    # ailerons declare identical ranges (`0/-30/0`..`0/30/0`), identical rates
    # (`0/120/0`) and the same `setInputToPitch c_PIRoll`, and differ only in
    # `setAcceleration` — `0/-120/0` left, `0/120/0` right. That lone sign is
    # what makes one go up while the other goes down. The elevators, which must
    # move together, both declare `0/-60/0`. Dropping this welds every aileron
    # pair into moving the same way.
    acceleration: tuple[float, float, float] | None = None
    inputs: dict[str, str] = field(default_factory=dict)   # yaw|pitch|roll -> input name
    # An EntryPoint's boarding reach in metres, and a SeatObject's display
    # flags. Both templates are meshless — their placement is the datum, so
    # without these the node says where but never how close or who is drawn.
    entry_radius: float | None = None
    seat_flags: list[str] = field(default_factory=list)
    automatic_reset: bool = False
    skeleton: str | None = None
    # Which bone of that skeleton the object's own origin sits on. Weapon
    # skeletons are rooted at `Bip01 R Hand` — where the thing attaches to a
    # soldier, not where its geometry is centred — so bound parts are measured
    # against this bone rather than the root.
    skeleton_main: str | None = None
    # `setBoneName <bone>` — a KitPart's attachment point on the *wearer's*
    # skeleton. This is the whole of Refractor's kit-appearance channel: a
    # soldier's own template declares a body, a head and two hands and nothing
    # else, so every helmet, pack and hat in the game reaches him as a KitPart
    # bolted to one of three bones of `animations/UsSoldier.ske` — `A` (a child
    # of `Bip01 Head`, so headgear rides the animated head), `backpack` and
    # `HipPack`. Distinct from `skeleton_part` above, which is a weapon sub-part
    # naming a bone of *its own* skeleton.
    bone_name: str | None = None
    # `setType` / `setKitTeam` on a Kit. `setType` is the engine's own role
    # vocabulary — Assault, AT, Engineer, Medic, Scout — and it is stable across
    # every mod in the install, which the folder name is not, so it is the
    # better source for a kit's class.
    kit_type: str | None = None
    kit_team: int | None = None
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

    # FireArms. Plane guns are meshless FireArms with one `addFireArmsPosition
    # <pos> <ypr>` per muzzle (the Spitfire's ±1.6° yaw is gun convergence);
    # tank guns are a FireArms *with* geometry (the barrel) whose flash is an
    # ordinary `addTemplate` child. `roundOfFire` is rounds per second.
    fire_arms_positions: list[tuple[tuple[float, float, float],
                                    tuple[float, float, float]]] = field(default_factory=list)
    projectile_template: str | None = None
    projectile_position: tuple[float, float, float] | None = None
    # The body the game draws in flight when it differs from the physics
    # projectile (`visibleDummyProjectileTemplate KatyushaRocketDummy`).
    visible_dummy_projectile_template: str | None = None
    visible_barrel_template: str | None = None
    tracer_template: str | None = None
    # Every Nth round carries the tracer (`setTracerTemplate X CRD_NONE/3/0/0`).
    tracer_interval: int | None = None
    input_fire: str | None = None
    recoil_size: float | None = None
    recoil_speed: float | None = None
    round_of_fire: float | None = None
    mag_size: int | None = None
    velocity: float | None = None
    tracer_scaler: float | None = None
    time_to_live: float | None = None
    # A projectile's looping in-flight effect (`startEffectTemplate
    # e_KatyushaFume` — the rocket's smoke trail).
    start_effect_template: str | None = None
    # `gravityModifier 0` on bullets, negative on rising smoke; scales the
    # engine's gravity on whatever this template spawns as.
    gravity_modifier: float | None = None
    # `setEngineType c_ETRocket` marks an Engine that accelerates its parent
    # after launch (the Katyusha rocket's motor), vs. propellers and wheels.
    engine_type: str | None = None

    # Effect chain: EffectBundle -> Emitter (`ObjectTemplate.template` names
    # the payload) -> Particle (mesh) or SpriteParticle (textured quad).
    emitter_template: str | None = None
    sprite_texture: str | None = None
    sprite_size: float | None = None
    size_over_time: list[list[float]] | None = None
    color_over_time: list[list[float]] | None = None
    dest_blend_mode: str | None = None
    show_in_first_person: bool = False
    show_in_third_person: bool = False
    # Emitter motion: where particles spawn along the direction of fire
    # (`relativePositionInDof`) and how fast they drift along it
    # (`positionalSpeedInDof`, negative = receding behind the muzzle).
    relative_position_in_dof: float | None = None
    positional_speed_in_dof: float | None = None

    # `ObjectTemplate.lodSelector <name>` — which `LodSelectorTemplate` block
    # decides between this LodObject's alternatives.
    lod_selector: str | None = None

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
            # Which way a positive input deflects this axis. See `acceleration`:
            # a mirrored pair declares one identical range and two opposite
            # accelerations, so without this both halves of an aileron pair
            # deflect the same way and the aircraft visibly cannot roll.
            accel = (self.acceleration or (0.0, 0.0, 0.0))[index]
            axes[axis] = {
                "input": name,
                "min": lo if not free else None,
                "max": hi if not free else None,
                "free": free,
                "driver": "rate" if span is not None and span > ACCUMULATOR_SPAN else "position",
                "maxSpeed": (self.max_speed or (0.0, 0.0, 0.0))[index],
                "direction": -1.0 if accel < 0 else 1.0,
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
        self.selectors: dict[str, LodSelector] = {}
        # geometry template name -> the object folder it was declared in, so the
        # per-object `Art/*.rs` override can be found later.
        self.geometry_dir: dict[str, str] = {}

    def add_con(self, path: str, text: str) -> None:
        text = strip_comments(text)
        folder = path.rsplit("/", 1)[0] if "/" in path else ""
        obj: ObjectTemplate | None = None
        geom: GeometryTemplate | None = None
        child: ChildRef | None = None
        selector: LodSelector | None = None

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
                elif cmd == "setteamgeometry":
                    # `setTeamGeometry <team> <mesh>`. Written after the
                    # `addTemplate AnimatedFlag` it retargets, but it belongs to
                    # the ControlPoint being defined, not to the child instance —
                    # so it reads onto `obj` the way `lodSelector` does.
                    parts = args.split()
                    if len(parts) >= 2:
                        try:
                            obj.team_geometry[int(parts[0])] = parts[1]
                        except ValueError:
                            pass
                elif cmd == "settype":
                    obj.kit_type = args.split()[0] if args else None
                elif cmd == "setkitteam":
                    try:
                        obj.kit_team = int(args.split()[0])
                    except (ValueError, IndexError):
                        pass
                elif cmd == "setbonename":
                    # Always the template's own attachment, never a child's, and
                    # written before any `addTemplate` in every kit file in the
                    # install. GCMOD quotes a bone with a space in it
                    # (`"Bip01 R UpperArm"`), so take the quoted run when there
                    # is one rather than the first whitespace token.
                    text = args.strip()
                    if text.startswith('"'):
                        end = text.find('"', 1)
                        obj.bone_name = text[1:end] if end > 0 else text[1:]
                    else:
                        obj.bone_name = text.split()[0] if text else None
                elif cmd == "lodselector":
                    # Names the rule, never a child instance, so it is read onto
                    # the template even though it is written after the
                    # `addTemplate` lines it arbitrates between.
                    obj.lod_selector = args.split()[0] if args else None
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
                elif cmd in ("setminrotation", "setmaxrotation", "setmaxspeed",
                             "setacceleration"):
                    try:
                        value = vec3(args.split()[0]) if args else (0.0, 0.0, 0.0)
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {"setminrotation": "min_rotation",
                                  "setmaxrotation": "max_rotation",
                                  "setmaxspeed": "max_speed",
                                  "setacceleration": "acceleration"}[cmd], value)
                elif cmd in ("setinputtoyaw", "setinputtopitch", "setinputtoroll"):
                    if args:
                        obj.inputs[cmd.removeprefix("setinputto")] = args.split()[0]
                elif cmd == "setentryradius":
                    # How close a soldier has to stand to board. Vanilla runs
                    # 1.1 m (a motorcycle) to 9 m (a battleship's deck).
                    try:
                        obj.entry_radius = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                elif cmd == "seatflags":
                    # Whether the occupant is drawn, and how much of him:
                    # c_SeatIsOutside, c_SeatShow{Half,Full}BodySoldier,
                    # c_SeatShowStandingSoldier. Accumulates — a template may
                    # declare several.
                    if flag := args.split()[0] if args.split() else None:
                        obj.seat_flags.append(flag)
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
                elif cmd == "addfirearmsposition":
                    tokens = args.split()
                    if not tokens:
                        continue
                    try:
                        pos = vec3_lenient(tokens[0])
                        ypr = vec3_lenient(tokens[1]) if len(tokens) > 1 else (0.0, 0.0, 0.0)
                    except ValueError:
                        continue
                    obj.fire_arms_positions.append((pos, ypr))
                elif cmd == "projectileposition":
                    try:
                        obj.projectile_position = vec3_lenient(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                elif cmd in ("projectiletemplate", "visiblebarreltemplate",
                             "visibledummyprojectiletemplate",
                             "starteffecttemplate", "setenginetype",
                             "setinputfire", "destblendmode", "texture"):
                    if args:
                        setattr(obj, {
                            "projectiletemplate": "projectile_template",
                            "visiblebarreltemplate": "visible_barrel_template",
                            "visibledummyprojectiletemplate":
                                "visible_dummy_projectile_template",
                            "starteffecttemplate": "start_effect_template",
                            "setenginetype": "engine_type",
                            "setinputfire": "input_fire",
                            "destblendmode": "dest_blend_mode",
                            "texture": "sprite_texture",
                        }[cmd], args.split()[0])
                elif cmd in ("gravitymodifier", "positionalspeedindof",
                             "relativepositionindof"):
                    # Written as CRD triples (`CRD_UNIFORM/-5/-10/0`) or bare
                    # numbers (`gravityModifier 0`); the first value is the
                    # mean / fixed one either way.
                    if args and (value := crd(args.split()[0])) is not None:
                        setattr(obj, {
                            "gravitymodifier": "gravity_modifier",
                            "positionalspeedindof": "positional_speed_in_dof",
                            "relativepositionindof": "relative_position_in_dof",
                        }[cmd], value)
                elif cmd == "settracertemplate":
                    tokens = args.split()
                    if tokens:
                        obj.tracer_template = tokens[0]
                    if len(tokens) > 1 and (interval := crd(tokens[1])) is not None:
                        obj.tracer_interval = int(interval) or None
                elif cmd in ("recoilsize", "recoilspeed", "roundoffire",
                             "velocity", "tracerscaler"):
                    try:
                        value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {
                        "recoilsize": "recoil_size",
                        "recoilspeed": "recoil_speed",
                        "roundoffire": "round_of_fire",
                        "velocity": "velocity",
                        "tracerscaler": "tracer_scaler",
                    }[cmd], value)
                elif cmd == "magsize":
                    try:
                        obj.mag_size = int(float(args.split()[0]))
                    except (ValueError, IndexError):
                        continue
                elif cmd == "timetolive":
                    # First declaration wins: `timeToLive` restated after an
                    # `addTemplate` is a per-instance override on that child
                    # (`CRD_NONE/-1/0/0`, live as long as the parent), not a
                    # redefinition of the template's own lifetime.
                    if obj.time_to_live is None and args:
                        obj.time_to_live = crd(args.split()[0])
                elif cmd == "template":
                    obj.emitter_template = args.split()[0] if args else None
                elif cmd == "size":
                    if args:
                        obj.sprite_size = crd(args.split()[0])
                elif cmd in ("sizeovertime", "colorrgbaovertime"):
                    if args.strip():
                        setattr(obj,
                                "size_over_time" if cmd == "sizeovertime"
                                else "color_over_time",
                                curve(args.split()[0]))
                elif cmd in ("showinfirstperson", "showinthirdperson"):
                    setattr(obj,
                            "show_in_first_person" if cmd == "showinfirstperson"
                            else "show_in_third_person",
                            args.strip().startswith("1"))
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

            elif ns == "lodselectortemplate":
                if cmd == "create":
                    parts = args.split()
                    if len(parts) < 2:
                        continue
                    selector = LodSelector(name=parts[1], kind=parts[0])
                    self.selectors.setdefault(parts[1].lower(), selector)
                elif selector is None:
                    continue
                elif cmd in ("addloddistance", "addlodcomparison"):
                    # Written one threshold per line, in alternative order, so
                    # they accumulate rather than overwrite: `DistCompareSelector2`
                    # blocks declare several.
                    try:
                        value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    (selector.distances if cmd == "addloddistance"
                     else selector.comparisons).append(value)

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
        kind, bare = split_geometry_qualifier(name)
        template = self.geometries.get(bare.lower())
        if template is None or kind is None:
            return template
        # A qualifier that disagrees with the declaration is not this template:
        # report it missing rather than paint the wrong mesh.
        return template if template.kind.lower() == kind.lower() else None

    def selector(self, name: str | None) -> LodSelector | None:
        return self.selectors.get(name.lower()) if name else None

    def art_dir(self, geometry_name: str) -> str | None:
        _, bare = split_geometry_qualifier(geometry_name)
        folder = self.geometry_dir.get(bare.lower())
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
