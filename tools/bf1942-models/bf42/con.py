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
_EFFECT_KINDS = frozenset({"effectbundle", "emitter", "particle", "spriteparticle",
                           "spriteparticlenew"})
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

# The template kinds that *are* a physics body — the ones whose declared
# motion is a force rather than a pose. A Camera's `setPivotPosition` is
# physics-adjacent data on a part the solver never touches, which is why it is
# not in here; a PlayerControlObject is the body those forces are applied to
# rather than one of the things applying them, and it always has children, so
# it never needs the exemptions this set grants.
PHYSICS_TEMPLATE_KINDS = frozenset({
    "engine", "spring", "wing", "floatingbundle", "landinggear",
})

# `ObjectTemplate.Grip` on a Spring. Not an enum — a bitfield, read out of
# `PhysicsGripFlags::operator<<` at 0x0054bb10 in the retail client and
# recorded under subsystem `physics` in
# `features/bf1942-engine-reference/symbols.json`. `c_PGFEngineDummyGrip` is
# 0x24 = EngineGrip | DummyGrip, which is why the "dummy" wheels a Sherman
# rides on read as engine-driven *and* cosmetic rather than as a fifth
# traction class; a consumer that string-compares the name instead of testing
# the bit gets that wrong. Vanilla uses four of the eight, the installed mods
# seven (no `c_PGFStaticFriction` anywhere).
PHYSICS_GRIP_FLAGS = {
    "c_pgfnogrip": 0x00,
    "c_pgfcontactgrip": 0x01,
    "c_pgfrollgrip": 0x02,
    "c_pgfenginegrip": 0x04,
    "c_pgfrollgripwhenoccupied": 0x08,
    "c_pgfdummygrip": 0x20,
    "c_pgfenginedummygrip": 0x24,
    "c_pgfstaticfriction": 0x80,
}


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


def crd_range(token: str) -> tuple[float, float] | None:
    """Both ends of a CRD random range — `CRD_UNIFORM/-0.1/-0.3/0` -> (-0.1, -0.3).

    `crd` above keeps the first value, which is the right answer for the fixed
    quantities it was written for. Recoil is not fixed: the two numbers are the
    ends a uniform draw lands between, and a weapon whose kick is always 1.2
    reads very differently from one whose kick is anywhere in 0.4..0.6. The
    order is as authored and is not normalised — a left-right range written
    `-0.1/-0.3` kicks left every time, and sorting it would hide that.
    """
    parts = token.split("/")
    if parts and parts[0].upper().startswith("CRD"):
        parts = parts[1:]
    try:
        return (float(parts[0]), float(parts[1]))
    except (ValueError, IndexError):
        return None


_CRD_CODES = {"none": "n", "uniform": "u", "exponential": "e", "normal": "g"}


def crd4(token: str) -> list | None:
    """The whole CRD random variable — `CRD_UNIFORM/1/180/1` -> `["u", 1.0, 180.0, 1]`.

    The engine samples these (`Random::getContinuousRandom`, lnxded 0x081e28b0;
    the emitter's inline copy 0x081e2f10) as: NONE -> a; UNIFORM -> a + r(b - a)
    with r in (0, 1]; EXPONENTIAL -> -a ln r; NORMAL -> a + b N(0,1). The fourth
    field is a mirror flag: when set, the sample's sign is flipped with
    probability one half, which is how `positionalSpeedInRight CRD_UNIFORM/0/3/1`
    spreads a burst both ways. A bare number is a NONE. Codes: n/u/e/g.
    """
    parts = token.split("/")
    dist = "n"
    if parts and parts[0].upper().startswith("CRD"):
        dist = _CRD_CODES.get(parts[0][4:].lower(), "n")
        parts = parts[1:]
    try:
        a = float(parts[0]) if parts and parts[0].strip() else 0.0
        b = float(parts[1]) if len(parts) > 1 and parts[1].strip() else 0.0
        mirror = int(float(parts[2])) if len(parts) > 2 and parts[2].strip() else 0
    except ValueError:
        return None
    return [dist, a, b, 1 if mirror else 0]


def floats(text: str) -> tuple[float, ...] | None:
    """A whitespace-separated float list — `setSpeedDev 1.5 0.4 0.4 0.1`.

    The deviation commands are the only place in the format that spells a
    vector with spaces instead of slashes, and their lengths differ by command
    (three for `setFireDev`, four for `setSpeedDev`), so the count is kept as
    authored rather than padded to a fixed width.
    """
    try:
        values = tuple(float(token) for token in text.split())
    except ValueError:
        return None
    return values or None


def truthy(text: str) -> bool | None:
    """A boolean the data writes three ways: `1`, `0`, and `c_True`.

    Vanilla's Bar1918 writes `setHasRecoilForce 1.2`, which the engine reads as
    true like any other non-zero, so this compares against zero rather than
    against the literal `1`.
    """
    token = text.split()[0] if text.split() else ""
    if not token:
        return None
    if token.lower().startswith("c_"):
        return token.lower() == "c_true"
    try:
        return float(token) != 0.0
    except ValueError:
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

    @property
    def ranks_by_distance(self) -> bool:
        """Whether this selector orders its alternatives near-to-far.

        A plain `DistanceSelector` is a LOD ladder: alternative 0 is what the
        engine draws until the observer passes `addLodDistance[0]`, then
        alternative 1, and so on. The comparison-driven kinds
        (`DistCompareSelector`, `DistCompareSelector2`, `CompareSelector`) are
        not ladders — they swap on a state flag such as "the camera is in the
        cockpit" — so for those the order says nothing and only the
        conventional child *name* identifies the alternative.

        Measured across the 14 installed mods: of 1339 `DistanceSelector`
        LodObjects, 1063 name alternative 0 with a near token
        (Interior/Internal/High/Cockpit) and its last with a far one
        (Exterior/External/Low/Dummy), 268 are unnamed, and 8 run the other
        way. All 8 are vehicle cockpit or steering parts, where the
        first-person geometry guard picks the alternative regardless of order.
        """
        return self.kind.lower() == "distanceselector"

    def as_dict(self) -> dict:
        return {"selector": self.name, "selectorKind": self.kind,
                "distances": list(self.distances),
                "comparisons": list(self.comparisons)}


def lod_alternative_role(template_name: str) -> str | None:
    """The semantic role encoded in a LodObject child's conventional name.

    Note that "interior" is a *role*, not a place: under a building's
    `DistanceSelector` it is the near rung of a LOD ladder, and the one that
    models the inside. See `select_lod_alternative`.
    """
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


def is_propeller_blur_pair(children: list["ChildRef"]) -> bool:
    """Whether a LodObject's two alternatives are the engine's blade/blur swap.

    Every vanilla propeller aircraft (and the mods that keep the convention)
    names them literally `<X>PropellerStatic` / `<X>PropellerBlurred` under a
    `CompareSelector` bound to engine input (`addLodComparison 0.07` — see
    `LodSelector`). Unlike every other LodObject in this file, the two halves
    are not alternatives to pick between at export time: the engine swaps
    which one is visible every frame as the propeller spins up, so a viewer
    needs both meshes to reproduce it and toggles visibility itself at the
    declared threshold. `select_lod_alternative` would otherwise fall back to
    child order — neither name matches an `interior`/`wreck`/`simple`/`complex`
    role — and silently keep only whichever was declared first.
    """
    if len(children) != 2:
        return False
    names = [child.template.lower() for child in children]
    return (any(name.endswith("static") for name in names)
            and any(name.endswith("blurred") for name in names))


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


def select_lod_alternative(children: list[ChildRef], configuration: str,
                           selector: LodSelector | None = None) -> ChildRef:
    """Choose one LodObject alternative without ever stacking its siblings.

    Two different questions wear the same `Interior`/`Exterior` vocabulary, and
    telling them apart needs the selector, not the name:

    * Under a **`DistanceSelector`** the alternatives are a LOD ladder and
      alternative 0 is the near one. A building declares
      `addLodDistance 70` over `SupplydeInterior` then `SupplydeExterior`:
      inside 70 m the engine draws `SupplydeInterior`, which is the mesh that
      models the inside of the building, and past 70 m it drops to
      `SupplydeExterior`, a hollow outer shell. Matching the name role
      "complex" here picks the *far* rung, so a level bake ships buildings
      with no interior — you walk through the doorway the collision hull
      allows and then see straight out through the back faces of the shell.
      Measured on vanilla: `citymesh2_m1` carries 1312 triangles of which 372
      sit more than 1.5 m inside the footprint; `citymesh2_m2` carries 635 and
      exactly **zero** inside it.
    * Under the comparison-driven kinds the alternatives are states, not
      rungs — a cockpit interior versus the hull that hides it — and there the
      name role is the only thing that identifies them.

    The near rung of a vehicle's `DistanceSelector` is a first-person part (a
    steering wheel, the B17's gun sights). Those are not filtered here: the
    caller's first-person geometry guard already refuses `1P_...` meshes, and
    it has to run anyway for the cockpit selectors.
    """
    if not children:
        raise ValueError("cannot select from an empty LodObject")
    if configuration not in MODEL_CONFIGURATIONS:
        raise ValueError(f"unknown model configuration: {configuration}")

    if selector is not None and selector.ranks_by_distance:
        return children[0]

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
    # `itemIndex` on a HandFireArms: the inventory slot the weapon occupies in
    # the soldier's hands — the number key that selects it. A kit's primary is
    # the one at 3; `kit.PRIMARY_ITEM_INDEX` has the census behind that.
    item_index: int | None = None
    invisible: bool = False
    animated_texture_speed: tuple[float, float] | None = None
    # Parts flagged `hasMobilePhysics 1` are separate physics bodies: an
    # Engine's accumulated spin never reaches them visually (a Corsair's
    # landing gear hangs off its Engine yet does not turn with the propeller).
    has_mobile_physics: bool = False
    # `setHasCollisionPhysics 1` — template +0x70 bit1 → instance flag 0x200
    # (TM-5 / V-R1). TreeMesh hulls are exported only when this is set **and**
    # the `.tm` carries a SimpleCollisionMesh; HCP=0+SCM bushes stay
    # fly-through.
    has_collision_physics: bool = False
    # `setContinousRotationSpeed y/p/r` — ambient deg/s the engine applies
    # unconditionally (windmill wings, radar dishes, the CH-47's parked rotor).
    continuous_rotation: tuple[float, float, float] | None = None
    has_armor: bool = False
    hitpoints: float | None = None
    max_hitpoints: float | None = None
    material: int | None = None
    critical_damage: float | None = None
    hp_lost_while_critical_damage: float | None = None
    # `addArmorEffect <hp> <effectTemplate> <x/y/z>` — the smoke, fire and
    # death tiers, in declaration order. 430 uses in vanilla, 2,271 templates
    # across the 14 installed mods. The first word is a plain HP threshold and
    # the effect is active while `hitPoints <= threshold`; a vehicle's fire
    # tier is authored at exactly its own `critical_damage` on 10 of 10 sampled
    # vanilla land and air vehicles, but that is a convention, not a rule the
    # engine enforces — boats carry no fire tier at all and run a sink sequence
    # instead. `0` and `-1` are the death and water-death tiers.
    #
    # The engine folds these into an `std::map<int, DamageEffects*>` on the
    # Armor and looks up the nearest threshold at or below `ceil(hitPoints)`
    # every simulation tick for as long as the object is alive (ledger ARM-1,
    # `subsystems/hitpoints-and-damage.md` §8). The vector is an object-space
    # attach offset.
    armor_effects: list[tuple[float, str, tuple[float, float, float]]] = field(
        default_factory=list)

    # -- SupplyDepot --------------------------------------------------------- #
    # Radius a soldier or vehicle has to be within to be worked on, which team
    # it services, and the ammo/vehicle types it restocks. Kept exactly as
    # authored -- `setHealth`/`addAmmoType`/`addVehicleType`'s argument
    # meanings beyond declaration order are not established by anything in
    # `features/bf1942-engine-reference/` yet (lnxded names
    # `SupplyDepotTemplate::setHealth(int, float, float)` /
    # `addAmmoType(int, int, float, float)` / `addVehicleType(std::string,
    # int, float, float)`, but the disassembly gives argument *types*, not
    # names). `radius` is a bare `ObjectTemplate.radius <n>` -- the same
    # spelling a Projectile's splash radius uses -- so it is routed by kind
    # rather than folded into that bucket below; every other SupplyDepot word
    # here is unique to it.
    supply_radius: float | None = None
    supply_team: int | None = None
    supply_set_health: tuple[float, float, float] | None = None
    supply_ammo_types: list[tuple[float, float, float, float]] = field(default_factory=list)
    supply_vehicle_types: list[tuple[str, float, float, float]] = field(default_factory=list)
    supply_work_on_soldiers: bool | None = None
    supply_work_on_vehicles: bool | None = None

    # -- Vehicle HUD ----------------------------------------------------------#
    # Declared on the vehicle's own `PlayerControlObject` root -- 13678 of
    # 13699 `setVehicleIcon` uses across the 14 installed mods' `Objects.rfa`
    # land on that kind, surveyed per enclosing template, not on a FireArms
    # child -- so these ride the same node as `hitpoints`/`max_hitpoints`
    # above, not `_fire_arms`'s extras. `setVehicleIcon` is the "vehicle icon
    # word" the briefing could not name; nothing in vanilla's own con scan
    # turned up a spelling for it. Primary/secondary ammo *bar* is an enum
    # name off a small HUD-side vocabulary (`ABAmmoBar`, `ABHeatBarOnly`,
    # `ABAmmoBarHeatBar`, `ABAmmoBarReloadBar`, ...), not a texture path;
    # kept as authored like `grip`/`vehicle_type` above.
    vehicle_icon: str | None = None
    # `setNumberOfWeaponIcons` (79 uses in vanilla): how many weapon panels the
    # seated HUD shows -- the Sherman's root declares 2 (cannon then coax), its
    # hull gunner 1, every stationary gun 1. `menu/InGame` keys which copy of
    # the ammo panel it paints on `Ammo/NumberOfWeaponIcons` being 1 or 2
    # (ledger VHUD, verify-r2.md R2-13), so a seat without it paints neither.
    vehicle_weapon_icons: int | None = None
    vehicle_primary_ammo_icon: str | None = None
    vehicle_primary_ammo_bar: str | None = None
    vehicle_secondary_ammo_icon: str | None = None
    vehicle_secondary_ammo_bar: str | None = None

    # -- Kit HUD --------------------------------------------------------------#
    # `setHealthBarIcon`/`setHealthBarFullIcon` are the segmented bar a
    # soldier wearing this kit draws bottom-left; `setKitIcon <n> <path>` is
    # the small class glyph at its foot (`<n>` kept as authored -- every
    # vanilla and mod use is one call per kit, and nothing in the data
    # establishes what the index selects between). `addWeaponIcon` is
    # repeatable, one icon per carried item in declaration order -- the row
    # the spawn screen paints under the kit portrait. Distinct from a hand
    # weapon's own `setAmmoIcon` below (`hud_ammo_icon`): scanning every
    # installed mod's `Objects.rfa` for a command carrying a `Weapon/Icon_*`
    # picture turned up only this one word, and it lives on the Kit, never on
    # a HandFireArms -- see the module's HUD-word survey.
    kit_health_bar_icon: str | None = None
    kit_health_bar_full_icon: str | None = None
    kit_icon: tuple[int, str] | None = None
    kit_weapon_icons: list[str] = field(default_factory=list)

    # -- Soldier constants ----------------------------------------------------#
    # `CommonSoldierData.inc`, reached through the bare `include <path>`
    # directive every nation's `Objects.con` uses -- see
    # `extract_models._inline_includes`, which splices it into the text
    # before this parser ever sees it. Identical across all five vanilla
    # soldiers (10.0 / 0.25 / 0.15 / 2.0 / 0.15); kept per-template rather
    # than hoisted to a constant since a mod's BFSoldier could vary it.
    heal_distance: float | None = None
    heal_factor: float | None = None
    self_heal_factor: float | None = None
    repair_distance: float | None = None
    repair_factor: float | None = None

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
    # Damage falloff and detonation, all on the Projectile template. The
    # falloff is `Projectile::getDamage` (client 0x00542e80, lnxded
    # 0x0831f3c0): full damage out to `distToStartLoseDamage`, a straight line
    # down to `minDamage` (a fraction) at `distToMinDamage`, flat after that.
    # `radius` is the splash radius of `damageType 1` projectiles and
    # `material2` the material their splash attacks with.
    min_damage: float | None = None
    dist_to_start_lose_damage: float | None = None
    dist_to_min_damage: float | None = None
    explosion_radius: float | None = None
    material2: int | None = None
    end_effect_template: str | None = None
    # `setEngineType c_ETRocket` marks an Engine that accelerates its parent
    # after launch (the Katyusha rocket's motor), vs. propellers and wheels.
    engine_type: str | None = None

    # -- Physics ----------------------------------------------------------- #
    # Refractor 1 has no `PhysicsType` directive and no `c_PT*` constants —
    # those are Refractor 2. Here the physics class *is* the template type on
    # `ObjectTemplate.create`, so every field below is read only where its
    # class declares it and the class is already on the node as `templateKind`:
    #
    #   Engine           drivetrain / propeller / screw
    #   Spring           one sprung wheel
    #   Wing             one aerodynamic surface — also every ship's rudder
    #   FloatingBundle   one buoyancy point on a hull
    #   LandingGear      a retracting leg, driven by altitude and throttle
    #   PlayerControlObject   the body the other four push around
    #
    # Values are kept exactly as authored. The engine's own constants are not
    # folded in here even where they are known: gravity is -14.73 m/s², not
    # -9.81 (`BasicPhysicsSystem::BasicPhysicsSystem`, 0x00578f00), and a
    # spring's force law normalises by it —
    # `accel = -(strength * displacement * |g|/9.82 + damping * d/dt)`
    # (`PhysicsSpring::updatePhysics`, 0x0057f0d0) — so a wheel pushes about
    # 1.5x as hard as `setStrength` reads. Pre-multiplying that in would make
    # the exported number disagree with the `.con` file it came from; the
    # runtime applies the law. Both from `features/bf1942-engine-reference/`.
    #
    # Forces throughout are accelerations in m/s², not newtons: `setTorque 4`
    # is 4 m/s² regardless of the 25-tonne hull it drives.

    # Engine. `setTorque` is peak drive acceleration and `setDifferential` the
    # final-drive ratio; `setGearUp`/`setGearDown` are gearbox shift points as
    # a fraction of max revs and have nothing to do with landing gear, which
    # carries its own `setGearUpHeight` family below.
    torque: float | None = None
    differential: float | None = None
    number_of_gears: int | None = None
    gear_up: float | None = None
    gear_down: float | None = None
    gear_change_time: float | None = None
    # Forward speed in m/s at which propeller thrust reaches zero — rafts 15,
    # fighters 70, PT boats 150, the Katyusha's rocket 1000 (a rocket never
    # loses thrust with speed).
    no_propeller_effect_at_speed: float | None = None

    # Spring. `Grip` is a *bitfield*, not an enum
    # (`PhysicsGripFlags::operator<<`, 0x0054bb10), which is why
    # `c_PGFEngineDummyGrip` is 0x24 = Engine|Dummy rather than a fifth
    # traction class: a consumer has to bit-test it, so the numeric value
    # rides out alongside the name.
    grip: str | None = None
    strength: float | None = None
    damping: float | None = None

    # Wing. `setWingLift` is passive lift per angle of attack and
    # `setFlapLift` control lift per hinge deflection; a ship's rudder zeroes
    # the first and keeps the second. `setPositionOffset` moves the force
    # application point, `applyPoint = attachPosition + positionOffset`, in the
    # parent body frame. `setRegulateToLift` is the closed-loop target of the
    # paired amidships regulator surfaces — 4.91 m/s² in all 27 vanilla uses.
    wing_lift: float | None = None
    flap_lift: float | None = None
    pitch_offset: float | None = None
    position_offset: tuple[float, float, float] | None = None
    regulate_to_lift: float | None = None
    wing_to_regulator_ratio: float | None = None
    remember_excess_input: bool | None = None

    # FloatingBundle. One buoyancy point, placed by its `addTemplate` offset —
    # a Fletcher hangs eight of them along its hull, two at each end and two
    # a side amidships, which is what makes it sit level. Asymmetric min/max
    # lift is where a real buoyancy curve lives, and on the two submarines the
    # 0.8275/1.6275 spread *is* the dive.
    hull_height: float | None = None
    float_max_lift: float | None = None
    float_min_lift: float | None = None
    sinking_speed_mod: float | None = None
    drag_modifier: float | None = None

    # LandingGear retraction thresholds. `con.py` already synthesises the gear
    # *axes* from the rotation bounds (`_landing_gear_axes`); these are the
    # altitudes and throttle positions that decide when to drive them, which
    # animation does not need and automation cannot work without.
    gear_up_height: float | None = None
    gear_down_height: float | None = None
    gear_up_engine_input: float | None = None
    gear_down_engine_input: float | None = None

    # The body. `drag` is a velocity damping term, `inertiaModifier` a per-axis
    # (yaw/pitch/roll) multiplier on the engine-computed inertia tensor, and
    # `speedMod`/`angleMod` scale collision damage rather than motion.
    mass: float | None = None
    drag: float | None = None
    inertia_modifier: tuple[float, float, float] | None = None
    speed_mod: float | None = None
    angle_mod: float | None = None
    # `setVehicleCategory VCLand|VCSea|VCAir` and `setVehicleType VTSherman`-
    # style role. Both are as authored, including the nine `Sea` and one `Land`
    # that drop the `VC` prefix — normalising them would hide a data bug that a
    # consumer keyed on the exact string will hit.
    vehicle_category: str | None = None
    vehicle_type: str | None = None
    # Egress. `exitTimer` is negative on four vanilla templates and is kept
    # signed; `setSoldierExitLocation <pos> <ypr>` is where the occupant is put
    # down, in the vehicle's own frame.
    exit_timer: float | None = None
    has_restricted_exit: bool | None = None
    exit_speed_mod: float | None = None
    soldier_exit_location: tuple[tuple[float, float, float],
                                 tuple[float, float, float]] | None = None
    damage_from_water: bool | None = None
    hp_lost_while_damage_from_water: float | None = None
    hp_lost_while_upside_down: float | None = None
    # `submarineData <7 floats>`. The seven parameters are undocumented and
    # nothing in the shipped data or the survey fixes what any one of them
    # means, so they are passed through in order and unnamed. Only two
    # templates in vanilla declare it (Gato, Sub7C) and they differ in exactly
    # one position — the fifth, 19.5 against 12.5.
    submarine_data: tuple[float, ...] | None = None
    submarine_hud_depth_modifier: float | None = None
    submarine_hud_dir_modifier: float | None = None

    # `setPivotPosition y/p/r` — the rotation centre, declared on Cameras,
    # RotationalBundles and a handful of Wings and Engines. 22 of the 30
    # vanilla uses are `0/0/0`, i.e. inert.
    pivot_position: tuple[float, float, float] | None = None

    # -- HandFireArms handling -------------------------------------------- #
    # What separates one rifle from another once the mesh is on screen. A
    # vehicle gun is described by `roundOfFire` and `velocity` and little else;
    # an infantry weapon carries a magazine, a reload, an optic and two whole
    # families of accuracy modelling, and none of it was read until now — which
    # is why the armoury could say "mag 5" about both a K98 and a K98Sniper and
    # nothing about the scope that is the only difference between them.
    #
    # Spellings are the data's own, and they are not tidy: `reloadtime` is
    # lower-case in every vanilla file, `fireOnce` is written `1` on 16 weapons
    # and `c_True` on two, and `setHasRecoilForce` is `1.2` on the Bar1918 —
    # a typo the engine reads as true. All three are handled where they parse.
    num_of_mag: int | None = None
    # 0 = rounds, 1 = a heat bar (the medic pack's 1800), 2 = no meter at all
    # (binoculars). Without it `magSize 1800` reads as 1800 bullets.
    mag_type: int | None = None
    reload_time: float | None = None
    auto_reload: bool | None = None
    # One shot per trigger pull — a bolt rifle, every pistol, the bazooka.
    fire_once: bool | None = None
    # Optics. `zoomFov` is the *weapon's* zoomed field of view as a fraction of
    # the unzoomed one, so smaller is more magnification: 0.4 for an iron-sight
    # No4 against 0.1 for the sniper. `useScope` swaps the view for the
    # full-screen `setScopeIcon` overlay, which is why the two snipers and the
    # binoculars are the only things in the game that draw one.
    zoom_fov: float | None = None
    soldier_zoom_fov: float | None = None
    use_scope: bool | None = None
    sniper_sight: bool | None = None
    scope_icon: str | None = None
    # Seconds of magnification lost after a shot — the sniper's 3 s of being
    # kicked out of the scope by his own bolt.
    unzoom_between_fire_time: float | None = None
    # Deviation: the cone the round can leave in, in degrees. `min_dev` is the
    # floor a standing, still, unfired shooter gets; the rest are multipliers
    # and per-state additions the engine sums. Kept as authored tuples rather
    # than reduced to a number, because their lengths differ (3 for fire/mod,
    # 4 for turn/speed) and the engine's exact combining rule is not modelled
    # here — publishing them is honest, inventing an "accuracy score" is not.
    min_dev: float | None = None
    min_deviation: float | None = None
    max_deviation: float | None = None
    fire_dev: tuple[float, ...] | None = None
    dev_mod: tuple[float, ...] | None = None
    turn_dev: tuple[float, ...] | None = None
    speed_dev: tuple[float, ...] | None = None
    misc_dev: tuple[float, ...] | None = None
    # Recoil, as a uniform random range: `CRD_UNIFORM/1.2/1.2/0` is the No4's
    # fixed 1.2, `CRD_UNIFORM/-0.1/-0.3/0` a left-right kick that is always
    # leftward. Both ends are kept — the spread between them is the weapon's
    # unpredictability, and collapsing it to the mean deletes exactly that.
    recoil_force_up: tuple[float, float] | None = None
    recoil_force_left_right: tuple[float, float] | None = None
    has_recoil_force: bool | None = None
    go_back_on_recoil: bool | None = None
    # `CHTIcon` / `CHTCrossHair` / `CHTNone` — a scoped weapon draws no
    # crosshair because the scope overlay is the sight.
    cross_hair_type: str | None = None
    hud_ammo_type: str | None = None
    # `fireInCameraDof 1` — the round leaves along the camera axis, not the
    # muzzle. 25 of 28 vanilla hand weapons declare it, so a first-person
    # shot is a camera ray and `projectilePosition 0/0/0` is only where the
    # flash draws. See first-person-soldier.md §2.7.
    fire_in_camera_dof: bool | None = None
    # The authored first-person placement, per weapon: where the weapon sits
    # against the soldier's eye at the hip and zoomed (Refractor metres,
    # x/y/z). The viewer guessed these before they were parsed — with them,
    # taste leaves the viewmodel. `altFireOnce 1` makes the right-mouse zoom
    # a press-toggle rather than a held state.
    soldier_camera_position: tuple[float, float, float] | None = None
    soldier_zoom_position: tuple[float, float, float] | None = None
    alt_fire_once: bool | None = None
    # Soldier-side first-person constants (`CommonSoldierData.inc`): where the
    # 1P arms rig sits relative to the camera (`center1pHands`, constant
    # -0.12/-1.56/0.1 in vanilla — FH nudges the x only) and the first-person
    # field of view (`set1pFov 0.47`, identical across all 18 installed mods).
    center_1p_hands: tuple[float, float, float] | None = None
    fov_1p: float | None = None
    # `loadSoundScript Sounds/<Name>.ssc` — the weapon's own sound script,
    # relative to the folder holding the `.con` that declared it. 27 of the
    # 28 vanilla hand weapons carry one (the binoculars are mute), and it is
    # the reference the sound extraction resolves; the script itself stays in
    # `Objects.rfa` and is never read here.
    sound_script: str | None = None

    # -- Hand-weapon HUD ------------------------------------------------------#
    # The ammo bar a HandFireArms paints bottom-right, distinct from
    # `hud_ammo_type` above (`setHudAmmoType`): `setAmmoBar`/`setAmmoBarFill`
    # are texture paths (`Ingame/Magbar_<type>_{empty,full}_32x64.tga`), not
    # the vehicle side's enum names. Position and text-position are two
    # separate directives per axis in the data, so they stay separate fields
    # rather than a synthesised vector. `setAmmoIcon` is the icon beside the
    # bar (`Ammo/Icon_*`) -- the kit's own `addWeaponIcon` spawn-screen row
    # above (`kit_weapon_icons`) is a different word entirely.
    hud_ammo_bar: str | None = None
    hud_ammo_bar_fill: str | None = None
    hud_ammo_bar_size: float | None = None
    hud_ammo_bar_pos_x: float | None = None
    hud_ammo_bar_pos_y: float | None = None
    hud_ammo_bar_text_pos_x: float | None = None
    hud_ammo_bar_text_pos_y: float | None = None
    hud_ammo_icon: str | None = None
    # Sustained-fire heat: `heatAddWhenFire` per round fired,
    # `coolDownPerSec` the drain rate once firing stops, `timeDelayOnOverheat`
    # the lockout once it maxes out (vanilla's `Coaxial_Browning` and `Mg42`
    # declare all three together; a survey for only "heat"/"reload"/"mag"/
    # "ammo" substrings misses `coolDownPerSec` entirely, which is how this
    # one very nearly stayed unparsed). Declared on both `FireArms`
    # (Browning, MG42 -- vanilla's `ABHeatBarOnly` gun mounts) and
    # `HandFireArms` (the M249 LMG in mods that carry one).
    heat_add_when_fire: float | None = None
    cool_down_per_sec: float | None = None
    time_delay_on_overheat: float | None = None

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
    # Every property an EffectBundle, Emitter or particle template declares,
    # raw, keyed by lower-case command. The effect vocabulary is forty-odd
    # CRD-valued properties and the viewer's effect player wants all of them;
    # typing each one here would triple this class for one consumer. Read by
    # `bf42.effects`, which owns the vocabulary and the CRD semantics.
    effect_props: dict[str, str] = field(default_factory=dict)

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

    def physics(self) -> dict | None:
        """The motion parameters this template declares, or None.

        Flat, because the physics class is the template kind and a kind
        declares one vocabulary: an Engine never carries `setWingLift` and a
        Wing never carries `setTorque`. The kind is already on the node as
        `templateKind`, so it is not repeated here.

        Every key is omitted when the data does not declare it — an empty
        result is None rather than a dict of nulls, so "this part has no
        physics" and "this part has physics that happen to be zero" stay
        distinguishable. `setStrength 0` on a Sherman's dummy road wheels is
        the second kind and matters: it is how a cosmetic wheel is told apart
        from one of the four that carry the tank.

        Units are the `.con` file's own and nothing is rescaled — see the
        field block above for the gravity normalisation that is deliberately
        *not* applied here.

        The same goes for handedness. Vectors (`positionOffset`,
        `soldierExitLocation`, `pivotPosition`) stay in Refractor's
        left-handed frame — x right, y up, **z forward** — while the glTF node
        tree they ride on has had its Z negated by the exporter. That is the
        convention `rig` already uses for its yaw/pitch angles, and the
        viewer's existing `SIGN = {yaw: -1, pitch: -1, roll: 1}` is the same
        fix applied at the same boundary. A consumer that mixes an
        `extras.physics` vector with a node translation without negating Z
        will mount the Fletcher's rudder on its bow.
        """
        def prune(values: dict) -> dict:
            return {k: v for k, v in values.items() if v is not None}

        kind = self.kind.lower()
        if kind == "engine":
            return prune({
                "engineType": self.engine_type,
                "torque": self.torque,
                "differential": self.differential,
                "numberOfGears": self.number_of_gears,
                "gearUp": self.gear_up,
                "gearDown": self.gear_down,
                "gearChangeTime": self.gear_change_time,
                "noPropellerEffectAtSpeed": self.no_propeller_effect_at_speed,
                "pivotPosition": self._pivot(),
            }) or None
        if kind == "spring":
            return prune({
                "grip": self.grip,
                # Omitted rather than guessed when the name is not one of the
                # eight the engine knows: a wrong bitmask reads as a real
                # traction class downstream, an absent one reads as unknown.
                "gripFlags": (PHYSICS_GRIP_FLAGS.get(self.grip.lower())
                              if self.grip else None),
                "strength": self.strength,
                "damping": self.damping,
            }) or None
        if kind == "wing":
            return prune({
                "wingLift": self.wing_lift,
                "flapLift": self.flap_lift,
                "pitchOffset": self.pitch_offset,
                "positionOffset": (list(self.position_offset)
                                   if self.position_offset else None),
                "regulateToLift": self.regulate_to_lift,
                "wingToRegulatorRatio": self.wing_to_regulator_ratio,
                "rememberExcessInput": self.remember_excess_input,
                "pivotPosition": self._pivot(),
            }) or None
        if kind == "floatingbundle":
            return prune({
                "hullHeight": self.hull_height,
                "floatMaxLift": self.float_max_lift,
                "floatMinLift": self.float_min_lift,
                "sinkingSpeedMod": self.sinking_speed_mod,
                "dragModifier": self.drag_modifier,
            }) or None
        if kind == "landinggear":
            return prune({
                "gearUpHeight": self.gear_up_height,
                "gearDownHeight": self.gear_down_height,
                "gearUpEngineInput": self.gear_up_engine_input,
                "gearDownEngineInput": self.gear_down_engine_input,
            }) or None

        body = prune({
            "mass": self.mass,
            "drag": self.drag,
            "inertiaModifier": (list(self.inertia_modifier)
                                if self.inertia_modifier else None),
            "speedMod": self.speed_mod,
            "angleMod": self.angle_mod,
            "vehicleCategory": self.vehicle_category,
            "vehicleType": self.vehicle_type,
            "exitTimer": self.exit_timer,
            "hasRestrictedExit": self.has_restricted_exit,
            "exitSpeedMod": self.exit_speed_mod,
            "soldierExitLocation": (
                {"position": list(self.soldier_exit_location[0]),
                 "rotation": list(self.soldier_exit_location[1])}
                if self.soldier_exit_location else None),
            "damageFromWater": self.damage_from_water,
            "hpLostWhileDamageFromWater": self.hp_lost_while_damage_from_water,
            "hpLostWhileUpSideDown": self.hp_lost_while_upside_down,
            # Seven unnamed floats. See the field comment: the meanings are
            # not established, so they ship in declaration order under the
            # directive's own name and nothing more is claimed about them.
            "submarineData": (list(self.submarine_data)
                              if self.submarine_data else None),
            "submarineHudDepthModifier": self.submarine_hud_depth_modifier,
            "submarineHudDirModifier": self.submarine_hud_dir_modifier,
            "pivotPosition": self._pivot(),
        })
        return body or None

    def _pivot(self) -> list[float] | None:
        """`setPivotPosition`, dropped when it is the inert `0/0/0`."""
        if not self.pivot_position or not any(self.pivot_position):
            return None
        return list(self.pivot_position)

    def weapon_stats(self) -> dict | None:
        """How this weapon handles — magazine, optic, deviation, recoil.

        Grouped the way the `.con` groups it (vanilla brackets the deviation
        and recoil commands with `Rem *** Deviation Begin ***`), and every key
        is omitted when the data does not declare it, so an empty `zoom` block
        means "no optic" rather than "zoom of zero". A knife returns almost
        nothing and that is the honest answer for a knife.

        Nothing in the assembler branches on any of this: it is catalogue data
        that rides out in the report so the armoury can show a K98 and a
        K98Sniper side by side and name the difference.
        """
        def prune(values: dict) -> dict:
            return {k: v for k, v in values.items() if v is not None}

        magazine = prune({
            "size": self.mag_size,
            "magazines": self.num_of_mag,
            "type": self.mag_type,
            "reloadTime": self.reload_time,
            "autoReload": self.auto_reload,
        })
        zoom = prune({
            "fov": self.zoom_fov,
            "soldierFov": self.soldier_zoom_fov,
            "scope": self.use_scope,
            "sniperSight": self.sniper_sight,
            "icon": self.scope_icon,
            "unZoomBetweenFire": self.unzoom_between_fire_time,
            "toggle": self.alt_fire_once,
        })
        view = prune({
            "cameraPosition": (list(self.soldier_camera_position)
                               if self.soldier_camera_position else None),
            "zoomPosition": (list(self.soldier_zoom_position)
                             if self.soldier_zoom_position else None),
        })
        deviation = prune({
            "min": self.min_dev,
            "minDeviation": self.min_deviation,
            "maxDeviation": self.max_deviation,
            "fire": list(self.fire_dev) if self.fire_dev else None,
            "mod": list(self.dev_mod) if self.dev_mod else None,
            "turn": list(self.turn_dev) if self.turn_dev else None,
            "speed": list(self.speed_dev) if self.speed_dev else None,
            "misc": list(self.misc_dev) if self.misc_dev else None,
        })
        recoil = prune({
            "up": list(self.recoil_force_up) if self.recoil_force_up else None,
            "leftRight": (list(self.recoil_force_left_right)
                          if self.recoil_force_left_right else None),
            "hasForce": self.has_recoil_force,
            "goBack": self.go_back_on_recoil,
        })
        # The bottom-right ammo bar/icon a soldier holding this weapon draws.
        # `hudAmmo` below (`setHudAmmoType`) already had a top-level home
        # before this HUD round; the bar texture, its size/position and the
        # icon beside it are new and grouped the way `zoom`/`magazine` are.
        hud = prune({
            "ammoBar": self.hud_ammo_bar,
            "ammoBarFill": self.hud_ammo_bar_fill,
            "ammoBarSize": self.hud_ammo_bar_size,
            "posX": self.hud_ammo_bar_pos_x,
            "posY": self.hud_ammo_bar_pos_y,
            "textPosX": self.hud_ammo_bar_text_pos_x,
            "textPosY": self.hud_ammo_bar_text_pos_y,
            "icon": self.hud_ammo_icon,
        })
        stats = prune({
            "roundOfFire": self.round_of_fire,
            "fireOnce": self.fire_once,
            "velocity": self.velocity,
            "projectile": self.projectile_template,
            "fireInCameraDof": self.fire_in_camera_dof,
            "crossHair": self.cross_hair_type,
            "hudAmmo": self.hud_ammo_type,
            "soundScript": self.sound_script,
            "magazine": magazine or None,
            "zoom": zoom or None,
            "view": view or None,
            "deviation": deviation or None,
            "recoil": recoil or None,
            "hud": hud or None,
        })
        return stats or None


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
                if (cmd != "create" and obj is not None and child is None
                        and obj.kind.lower() in _EFFECT_KINDS):
                    # Raw, last wins, template scope only: a `timeToLive`
                    # after an `addTemplate` belongs to that child instance.
                    obj.effect_props[cmd] = args.strip()
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
                elif cmd == "itemindex":
                    try:
                        obj.item_index = int(args.split()[0])
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
                elif cmd in ("createinvisible", "invisible"):
                    # `createInvisible` hides a placed object; `invisible 1` on
                    # a Projectile is the engine's own "never draw the body"
                    # (every hand-weapon bullet declares it — only the tracer
                    # is ever visible).
                    obj.invisible = args.strip().startswith("1")
                elif cmd == "hasmobilephysics":
                    obj.has_mobile_physics = args.strip().startswith("1")
                elif cmd == "sethascollisionphysics":
                    # TM-5: bit1 of template +0x70; palms are 1, Afri_bush1 is 0
                    # even when the `.tm` still embeds an SCM.
                    obj.has_collision_physics = args.strip().startswith("1")
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
                elif cmd == "addarmoreffect":
                    # `<hp> <effectTemplate> <x/y/z>`. Vanilla ships runs of
                    # two spaces between the fields (`-1 WaterWaterExplosion
                    # 0/0/0`), so split on whitespace rather than a single gap,
                    # and accept a `,`-separated vector the way the animated
                    # texture branch above does.
                    parts = args.split()
                    if len(parts) < 2:
                        continue
                    try:
                        threshold = float(parts[0])
                    except ValueError:
                        continue
                    offset = (0.0, 0.0, 0.0)
                    if len(parts) >= 3:
                        try:
                            x, y, z = (
                                float(v) for v in
                                parts[2].replace(",", "/").split("/")[:3])
                            offset = (x, y, z)
                        except (ValueError, IndexError):
                            offset = (0.0, 0.0, 0.0)
                    obj.armor_effects.append((threshold, parts[1], offset))
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
                # -- SupplyDepot. `radius` is spelled exactly like a
                # Projectile's splash radius (both a bare
                # `ObjectTemplate.radius <n>`), so it has to be routed by
                # kind ahead of the generic bucket below, which would
                # otherwise claim it for every kind including this one.
                elif cmd == "radius" and obj.kind.lower() == "supplydepot":
                    try:
                        obj.supply_radius = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                elif cmd == "team":
                    try:
                        obj.supply_team = int(float(args.split()[0]))
                    except (ValueError, IndexError):
                        continue
                elif cmd == "sethealth":
                    if (values := floats(args)) is not None and len(values) >= 3:
                        obj.supply_set_health = (values[0], values[1], values[2])
                elif cmd == "addammotype":
                    if (values := floats(args)) is not None and len(values) >= 4:
                        obj.supply_ammo_types.append(
                            (values[0], values[1], values[2], values[3]))
                elif cmd == "addvehicletype":
                    tokens = args.split()
                    if len(tokens) >= 4:
                        try:
                            rest = tuple(float(t) for t in tokens[1:4])
                        except ValueError:
                            continue
                        obj.supply_vehicle_types.append((tokens[0], *rest))
                elif cmd in ("workonsoldiers", "workonvehicles"):
                    if (value := truthy(args)) is not None:
                        setattr(obj, {
                            "workonsoldiers": "supply_work_on_soldiers",
                            "workonvehicles": "supply_work_on_vehicles",
                        }[cmd], value)
                # -- Vehicle HUD, on the PlayerControlObject root.
                elif cmd == "setnumberofweaponicons":
                    try:
                        obj.vehicle_weapon_icons = int(float(args.split()[0]))
                    except (ValueError, IndexError):
                        pass
                elif cmd in ("setvehicleicon", "setprimaryammoicon", "setprimaryammobar",
                             "setsecondaryammoicon", "setsecondaryammobar"):
                    if token := args.strip().strip('"'):
                        setattr(obj, {
                            "setvehicleicon": "vehicle_icon",
                            "setprimaryammoicon": "vehicle_primary_ammo_icon",
                            "setprimaryammobar": "vehicle_primary_ammo_bar",
                            "setsecondaryammoicon": "vehicle_secondary_ammo_icon",
                            "setsecondaryammobar": "vehicle_secondary_ammo_bar",
                        }[cmd], token.split()[0])
                # -- Kit HUD.
                elif cmd in ("sethealthbaricon", "sethealthbarfullicon"):
                    if token := args.strip().strip('"'):
                        setattr(obj,
                                "kit_health_bar_icon" if cmd == "sethealthbaricon"
                                else "kit_health_bar_full_icon", token)
                elif cmd == "setkiticon":
                    tokens = args.split(None, 1)
                    if len(tokens) == 2:
                        try:
                            index = int(float(tokens[0]))
                        except ValueError:
                            continue
                        if icon := tokens[1].strip().strip('"'):
                            obj.kit_icon = (index, icon)
                elif cmd == "addweaponicon":
                    if token := args.strip().strip('"'):
                        obj.kit_weapon_icons.append(token)
                # -- Soldier constants, off `CommonSoldierData.inc`.
                elif cmd in ("healdistance", "healfactor", "selfhealfactor",
                             "repairdistance", "repairfactor"):
                    try:
                        value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {
                        "healdistance": "heal_distance",
                        "healfactor": "heal_factor",
                        "selfhealfactor": "self_heal_factor",
                        "repairdistance": "repair_distance",
                        "repairfactor": "repair_factor",
                    }[cmd], value)
                # -- Physics. See the `physics()` field block: which of these
                # a template may legally declare is decided by its kind, so
                # they are read unconditionally and sorted out there.
                elif cmd in (
                    "settorque", "setdifferential", "setgearup", "setgeardown",
                    "setgearchangetime", "setnopropellereffectatspeed",
                    "setstrength", "setdamping",
                    "setwinglift", "setflaplift", "setpitchoffset",
                    "setregulatetolift", "setwingtoregulatorratio",
                    "sethullheight", "setfloatmaxlift", "setfloatminlift",
                    "setsinkingspeedmod", "setdragmodifier",
                    "setgearupheight", "setgeardownheight",
                    "setgearupengineinput", "setgeardownengineinput",
                    "mass", "drag", "speedmod", "anglemod",
                    "exittimer", "exitspeedmod",
                    "hplostwhiledamagefromwater", "hplostwhileupsidedown",
                    "setsubmarinehuddepthmodifier", "setsubmarinehuddirmodifier",
                ):
                    try:
                        value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {
                        "settorque": "torque",
                        "setdifferential": "differential",
                        "setgearup": "gear_up",
                        "setgeardown": "gear_down",
                        "setgearchangetime": "gear_change_time",
                        "setnopropellereffectatspeed": "no_propeller_effect_at_speed",
                        "setstrength": "strength",
                        "setdamping": "damping",
                        "setwinglift": "wing_lift",
                        "setflaplift": "flap_lift",
                        "setpitchoffset": "pitch_offset",
                        "setregulatetolift": "regulate_to_lift",
                        "setwingtoregulatorratio": "wing_to_regulator_ratio",
                        "sethullheight": "hull_height",
                        "setfloatmaxlift": "float_max_lift",
                        "setfloatminlift": "float_min_lift",
                        "setsinkingspeedmod": "sinking_speed_mod",
                        "setdragmodifier": "drag_modifier",
                        "setgearupheight": "gear_up_height",
                        "setgeardownheight": "gear_down_height",
                        "setgearupengineinput": "gear_up_engine_input",
                        "setgeardownengineinput": "gear_down_engine_input",
                        "mass": "mass",
                        "drag": "drag",
                        "speedmod": "speed_mod",
                        "anglemod": "angle_mod",
                        "exittimer": "exit_timer",
                        "exitspeedmod": "exit_speed_mod",
                        "hplostwhiledamagefromwater": "hp_lost_while_damage_from_water",
                        "hplostwhileupsidedown": "hp_lost_while_upside_down",
                        "setsubmarinehuddepthmodifier": "submarine_hud_depth_modifier",
                        "setsubmarinehuddirmodifier": "submarine_hud_dir_modifier",
                    }[cmd], value)
                elif cmd == "setnumberofgears":
                    try:
                        obj.number_of_gears = int(float(args.split()[0]))
                    except (ValueError, IndexError):
                        continue
                elif cmd in ("setpositionoffset", "inertiamodifier",
                             "setpivotposition", "soldiercameraposition",
                             "soldierzoomposition", "center1phands"):
                    try:
                        value = vec3_lenient(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {
                        "setpositionoffset": "position_offset",
                        "inertiamodifier": "inertia_modifier",
                        "setpivotposition": "pivot_position",
                        "soldiercameraposition": "soldier_camera_position",
                        "soldierzoomposition": "soldier_zoom_position",
                        "center1phands": "center_1p_hands",
                    }[cmd], value)
                elif cmd in ("rememberexcessinput", "hasrestrictedexit",
                             "damagefromwater"):
                    if (value := truthy(args)) is not None:
                        setattr(obj, {
                            "rememberexcessinput": "remember_excess_input",
                            "hasrestrictedexit": "has_restricted_exit",
                            "damagefromwater": "damage_from_water",
                        }[cmd], value)
                elif cmd in ("grip", "setvehiclecategory", "setvehicletype"):
                    # `Grip` is the one physics directive with no `set` prefix,
                    # and the two vehicle classifiers are bare enum names. All
                    # three are stored as authored — nine vanilla templates
                    # write `Sea` where every other one writes `VCSea`.
                    if token := args.strip():
                        setattr(obj, {
                            "grip": "grip",
                            "setvehiclecategory": "vehicle_category",
                            "setvehicletype": "vehicle_type",
                        }[cmd], token.split()[0])
                elif cmd == "submarinedata":
                    # Seven whitespace-separated floats whose meanings are not
                    # established. Kept as authored, in order, unnamed.
                    if (values := floats(args)) is not None:
                        obj.submarine_data = values
                elif cmd == "setsoldierexitlocation":
                    # `<position> <yaw/pitch/roll>`. All 751 uses across the
                    # installed mods write both; the missing-rotation fallback
                    # is the same defence `addFireArmsPosition` takes, not an
                    # observed spelling.
                    tokens = args.split()
                    if not tokens:
                        continue
                    try:
                        pos = vec3_lenient(tokens[0])
                        ypr = vec3_lenient(tokens[1]) if len(tokens) > 1 else (0.0, 0.0, 0.0)
                    except ValueError:
                        continue
                    obj.soldier_exit_location = (pos, ypr)
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
                elif cmd in ("mindamage", "disttostartlosedamage", "disttomindamage",
                             "radius", "material2"):
                    try:
                        value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    if cmd == "material2":
                        obj.material2 = int(value)
                    else:
                        setattr(obj, {
                            "mindamage": "min_damage",
                            "disttostartlosedamage": "dist_to_start_lose_damage",
                            "disttomindamage": "dist_to_min_damage",
                            "radius": "explosion_radius",
                        }[cmd], value)
                elif cmd == "endeffecttemplate":
                    obj.end_effect_template = args.split()[0] if args else None
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
                elif cmd in ("magsize", "numofmag", "magtype"):
                    try:
                        value = int(float(args.split()[0]))
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {"magsize": "mag_size",
                                  "numofmag": "num_of_mag",
                                  "magtype": "mag_type"}[cmd], value)
                # -- HandFireArms handling. Last write wins, deliberately: the
                # two snipers restate their whole HUD block three times over
                # and the engine keeps the last one, so a plain assignment is
                # the correct rule rather than a bug waiting to be found.
                elif cmd in ("reloadtime", "zoomfov", "soldierzoomfov",
                             "unzoombetweenfiretime", "setmindev",
                             "mindeviation", "maxdeviation", "set1pfov",
                             "heataddwhenfire", "cooldownpersec",
                             "timedelayonoverheat"):
                    try:
                        value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {
                        "reloadtime": "reload_time",
                        "zoomfov": "zoom_fov",
                        "soldierzoomfov": "soldier_zoom_fov",
                        "unzoombetweenfiretime": "unzoom_between_fire_time",
                        "setmindev": "min_dev",
                        "mindeviation": "min_deviation",
                        "maxdeviation": "max_deviation",
                        "set1pfov": "fov_1p",
                        "heataddwhenfire": "heat_add_when_fire",
                        "cooldownpersec": "cool_down_per_sec",
                        "timedelayonoverheat": "time_delay_on_overheat",
                    }[cmd], value)
                elif cmd in ("fireonce", "autoreload", "usescope",
                             "setsnipersight", "sethasrecoilforce",
                             "setgobackonrecoil", "fireincameradof",
                             "altfireonce"):
                    if (value := truthy(args)) is not None:
                        setattr(obj, {
                            "fireonce": "fire_once",
                            "autoreload": "auto_reload",
                            "usescope": "use_scope",
                            "setsnipersight": "sniper_sight",
                            "sethasrecoilforce": "has_recoil_force",
                            "setgobackonrecoil": "go_back_on_recoil",
                            "fireincameradof": "fire_in_camera_dof",
                            "altfireonce": "alt_fire_once",
                        }[cmd], value)
                elif cmd in ("setfiredev", "setdevmod", "setturndev",
                             "setspeeddev", "setmiscdev"):
                    if (values := floats(args)) is not None:
                        setattr(obj, {
                            "setfiredev": "fire_dev",
                            "setdevmod": "dev_mod",
                            "setturndev": "turn_dev",
                            "setspeeddev": "speed_dev",
                            "setmiscdev": "misc_dev",
                        }[cmd], values)
                elif cmd in ("setrecoilforceup", "setrecoilforceleftright"):
                    if args and (span := crd_range(args.split()[0])) is not None:
                        setattr(obj,
                                "recoil_force_up" if cmd == "setrecoilforceup"
                                else "recoil_force_left_right", span)
                elif cmd == "loadsoundscript":
                    if token := args.strip().strip('"'):
                        obj.sound_script = token.replace("\\", "/")
                elif cmd in ("setscopeicon", "setcrosshairtype", "sethudammotype"):
                    # `setScopeIcon "sniper.tga"` is quoted; the other two are
                    # bare enum names.
                    if token := args.strip().strip('"'):
                        setattr(obj, {
                            "setscopeicon": "scope_icon",
                            "setcrosshairtype": "cross_hair_type",
                            "sethudammotype": "hud_ammo_type",
                        }[cmd], token.split()[0])
                elif cmd in ("setammobar", "setammobarfill", "setammoicon"):
                    # Texture paths, quoted like `setScopeIcon` above.
                    if token := args.strip().strip('"'):
                        setattr(obj, {
                            "setammobar": "hud_ammo_bar",
                            "setammobarfill": "hud_ammo_bar_fill",
                            "setammoicon": "hud_ammo_icon",
                        }[cmd], token.split()[0])
                elif cmd in ("setammobarsize", "setammobarposx", "setammobarposy",
                             "setammobartextposx", "setammobartextposy",
                             # `setAmom...` is not a mod's typo: 13 of vanilla's
                             # 16 hand weapons that declare a bar position at
                             # all ship it spelled this way (K98, No4, Thompson,
                             # Mp40, Sg44, ...) and only 3 (M1Garand, Type5,
                             # JohnsonLMG) use `setAmmo...`. The size/fill/bar
                             # words are never affected, only these four.
                             "setamombarposx", "setamombarposy",
                             "setamombartextposx", "setamombartextposy"):
                    try:
                        value = float(args.split()[0])
                    except (ValueError, IndexError):
                        continue
                    setattr(obj, {
                        "setammobarsize": "hud_ammo_bar_size",
                        "setammobarposx": "hud_ammo_bar_pos_x",
                        "setammobarposy": "hud_ammo_bar_pos_y",
                        "setammobartextposx": "hud_ammo_bar_text_pos_x",
                        "setammobartextposy": "hud_ammo_bar_text_pos_y",
                        "setamombarposx": "hud_ammo_bar_pos_x",
                        "setamombarposy": "hud_ammo_bar_pos_y",
                        "setamombartextposx": "hud_ammo_bar_text_pos_x",
                        "setamombartextposy": "hud_ammo_bar_text_pos_y",
                    }[cmd], value)
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
