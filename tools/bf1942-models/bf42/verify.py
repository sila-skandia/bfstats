"""Did the extraction come out right? Objective checks over an exported `.glb`.

"Looks fine in the viewer" is not a regression test. Every failure mode this
pipeline has actually had is measurable from the artefact itself, so this module
turns each one into a check a script can run:

* **Parts collapsed onto the origin.** The bug `bindToSkeletonPart` used to
  cause — parse it wrong and every sub-part lands on the weapon origin. The
  check has to be precise about what "collapsed" means, because vanilla itself
  stacks parts on purpose: the Type99's mag and bolt bones rest *exactly* on
  `Type99Base` (they only separate during the reload clip), the No4's `Load`
  and `Block` bones share a rest point, and every soldier's body and head stack
  at the origin because both are authored in bind space. What no healthy model
  does is pile three or more parts on the origin *without a bind to explain
  them* — a part that carries a `boundBone` extra was put there by a skeleton
  and is vouched for by the silhouette check instead.
* **Area outside the shadow silhouette.** A hand weapon usually ships a
  `Shad_*`/`Shade_*` mesh — the whole weapon as one part in the same space — so
  sub-part placement is measurable rather than a matter of opinion. The metric
  is the side (Z-Y) projection because the shadow meshes are nearly flat in X
  (a Colt's is 3 cm wide); rasterise both, dilate the silhouette one pixel for
  raster tolerance, and report the fraction of bound-part area that falls
  outside, aggregated over parts weighted by area. Correctly placed vanilla
  weapons measure 0-6%; reading the `.ske` unmirrored throws 15-60%.
* **The wrong size.** Real-world lengths are an external check on the whole
  coordinate chain — `.sm` units through `.ske` bind poses to glTF metres. A K98
  is 1.11 m; put its bolt behind the butt plate and the box grows past any
  modelling licence. Tolerance is generous (default 18%) because the models
  themselves take licence — the vanilla Colt draws 11% long against a real
  M1911 — while the failure modes overshoot by far more.
* **Degenerate geometry.** NaN positions and zero-area triangles, counted in
  world space.
* **A part that is simply gone.** The exporter counts the object's own parts
  and triangles into its report; `inventory_check` reads both back out of the
  file. Nothing else here can see a dropped node -- a lost placement makes a
  pile, a lost mesh makes a report line, but a Sherman that reaches disk
  without its turret looks like a smaller Sherman.
* **A skinned mesh with nothing to pose it.** A `.skn` is authored in bind
  space, so the skeleton is what puts it anywhere. `unposed_skins` asks whether
  one is in scope, which is the difference between a correct soldier (four
  meshes stacked at the origin, a skeleton overhead) and a broken one (four
  meshes stacked at the origin, and that is all there is).

## What a node in the scene *is*

The exporter no longer writes only the object's own parts. A modern `.glb`
also carries muzzle-flash and shell-eject emitters, the tracer streak, the
projectile body a rack drops, and the collision hulls — all real nodes with
real triangles, all placed at the emitter's own origin because that is where
the engine spawns them from.

Every check below therefore asks the *extras the exporter stamps* what a node
is, never its name. `templateKind`, `effect`, `effectEmitter`, `effectBundle`,
`tracerMesh`, `projectileMesh`, `collision`, `skin`: that vocabulary is the
exporter's own, so a renamed emitter or a mod's odd spelling cannot smuggle a
helper node into a check meant for the object's body. Before this was so, the
2026-09-19 rebuild called 42 of 96 vanilla models and 96 of 285 EoD models
BROKEN and every one was a false alarm: emitters counted as "unbound parts
piled on the origin", a Bar1918 measured 2.02 m across its own muzzle flash
against 1.19 m real, and every soldier was four unbound parts and a missing
mesh. A verifier that always says broken hides the day it is right.

Everything here is pure: `.glb` bytes in, findings out. The CLI wiring that
knows about `models.json`, reports and archives lives in `verify_models.py`.
"""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path

Vector3 = tuple[float, float, float]
Matrix3 = tuple[tuple[float, float, float], ...]
Triangle = tuple[Vector3, Vector3, Vector3]

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

_IDENTITY: Matrix3 = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

# Correct vanilla weapons aggregate 0-6% outside their own shadow silhouette;
# the historical mirror bug threw 15-60%. The gap is wide enough that the
# thresholds are not delicate.
SILHOUETTE_WARN = 0.07
SILHOUETTE_FAIL = 0.10
SILHOUETTE_RESOLUTION = 512

# Four weapons measure high on a *correct* extraction because the mismatch is
# authored into the game data, verified by bounding boxes against the shadow.
# Recorded the same way the damage tables record their missing `run` targets:
# as facts, each with a ceiling a regression would still have to break.
SILHOUETTE_AUTHORED: dict[str, tuple[float, str]] = {
    # measured 58.8%: Type5Simple's file is literally Shad_K98_m1 — vanilla
    # ships the K98's shadow for the Type 5, and the Type 5's Garand-style box
    # magazine hangs below the K98's flush-stocked silhouette.
    "Type5": (0.70, "vanilla reuses the K98's shadow mesh (Shad_K98_m1)"),
    # measured 22.6%: the only bound part is the 6 cm plunger handle at the top
    # of the box, and the crude shadow leaves it almost no area to land in.
    "Detonator": (0.30, "single tiny bound part against a crude shadow"),
    # measured 15.4%: the shadow draws the pan magazine slightly lower and
    # thinner than the DPMag bone rests it.
    "DP": (0.22, "shadow draws the pan magazine lower than the bone rests it"),
    # measured 9.0%: the shadow is tighter than the weapon itself — the unbound
    # body measures 11.3% outside it — and the small trigger parts sit in that
    # gap.
    "Panzershreck": (0.15, "shadow is tighter than the weapon body itself"),
}

# Two mesh materials no vanilla `.rs` defines a shader for — 2 triangles on the
# Thompson body, a 29-triangle sight detail on the StG 44. Authored gaps in the
# game data, not lookup failures.
MATERIALS_WITHOUT_SHADER_AUTHORED: dict[str, frozenset[str]] = {
    "Thompson": frozenset({"thompson_m1_material0"}),
    "Sg44": frozenset({"sg44_material1"}),
}

# Texture references that resolve nowhere in a *complete* vanilla install —
# the `.rs` names variants the archives never shipped. These are the only
# absent references that reach an extracted model; the full 56-name census is
# in features/bf1942-3d-models/extraction-rollout.md.
VANILLA_UNRESOLVED_TEXTURES: frozenset[str] = frozenset({
    "texture/",             # an empty ref in BlackMedal_Hull_L1.rs and Yamato turrets
    "texture/sherw2_f",     # Sherman road-wheel variant (Sherman, M10, Priest)
    "texture/b17win_l",     # B17 window pane
})

# Mesh files the base game references and never shipped. Unlike the tables
# above, these are statements about *files*, not about models, so they hold
# for any mod chain that inherits `Mods/bf1942` -- which is every installed
# mod -- and are applied whether or not `vanilla_facts` is on.
#
# `bodycollision_m1` is the whole of the list. Every `BFSoldier` reaches it
# through `Objects/Soldiers/Common/Geometries.con`:
#
#     GeometryTemplate.create SkeletonCollisionMesh BodyCollision
#     GeometryTemplate.file bodycollision_m1
#
# and no archive in a complete install holds an entry with that name (checked
# across every `.rfa` under `Mods/bf1942/Archives`). It is the soldier hitbox,
# not render geometry, so its absence costs an extracted soldier nothing --
# but it was reported as "mesh files unresolved" on all eight vanilla soldiers
# and 19 EoD ones, every one of them a broken verdict.
BASE_GAME_ABSENT_MESHES: dict[str, str] = {
    "bodycollision_m1":
        "SkeletonCollisionMesh BodyCollision, referenced by every BFSoldier "
        "and shipped in no archive of a complete install; a hitbox, not "
        "render geometry",
}

LENGTH_TOLERANCE = 0.18

# A "shadow mesh" is a low-poly stand-in for the whole weapon, which is what
# makes it a fair frame to measure sub-part placement against. Some simple
# LODs are not that: vanilla's JohnsonLMG points its Simple alternative at
# `Johnson_Base_m1` (1,183 triangles against the model's 1,520) and Secret
# Weapons' Gewehr43_zf4 at `gewehr43_main_m1` (1,285 of 1,555). Comparing a
# weapon against *itself* at full detail measures the trigger-guard hole, not
# a misplacement -- the G43's trigger, bolt and clip all read 85-90% outside
# on a perfectly good model.
#
# Every genuine shadow mesh in the four installed catalogues measures at most
# 18% of its model's triangles (the medkit's wrench at 0.18 is the fattest,
# the K98's at 0.05 typical); the two impostors above are at 0.78 and 0.83.
# The gate sits between them and is not delicate.
SHADOW_TRIANGLE_RATIO = 0.35

# The silhouette check compares against a coarse artist asset that vanilla
# itself sometimes borrows from another weapon, so one weapon reading high is
# evidence, not proof -- and every historical false alarm here was exactly
# that. The regression it exists to catch (reading the `.ske` unmirrored) does
# not hit one weapon, it hits every weapon in the catalogue at once, so that
# is what is fatal: a catalogue whose *median* weapon reads above this is
# mirrored, and the ones above `SILHOUETTE_FAIL` in it are called broken.
# Vanilla's median is 0.030 over 19 weapons and EoD's 0.032 over 28.
SILHOUETTE_CATALOGUE_FAIL = 0.12
SILHOUETTE_CATALOGUE_MIN = 8

# Real-world lengths in metres, longest axis of the thing as the game models it.
# An entry is only worth having when the real figure is unambiguous (which
# variant, stock folded or not, gun forward or aft) — a wrong expectation is
# worse than none. Sources: standard reference figures for each weapon/vehicle.
KNOWN_LENGTHS_M: dict[str, float] = {
    # Hand weapons. The game's models take some licence (the Colt draws ~11%
    # long); the tolerance absorbs that while still catching a doubled length.
    "Colt": 0.216,          # M1911, 8.5 in overall
    "WalterP38": 0.216,     # Walther P38
    "K98": 1.11,            # Karabiner 98k
    "No4": 1.129,           # Lee-Enfield No. 4
    "M1Garand": 1.10,
    "Type5": 1.10,          # Type 5 rifle, Japanese Garand copy
    "Type99": 1.118,        # Arisaka Type 99 short rifle (the sniper model)
    "Thompson": 0.85,       # M1928A1 with compensator
    "Mp18": 0.815,
    "Mp40": 0.833,          # stock extended
    "Sg44": 0.94,           # StG 44
    "Bar1918": 1.194,
    "JohnsonLMG": 1.066,    # M1941 Johnson LMG
    "DP": 1.27,             # Degtyaryov DP-27
    "Bazooka": 1.37,        # M1A1 launcher tube
    "Panzershreck": 1.64,   # RPzB 54
    # Emplacements — the gun itself. A `Stationary_*` template is the gun on
    # its tripod, so the row is only worth having where the gun is still the
    # longest side: the M2HB is 1.654 m against a mount that adds 10 cm
    # (measured 1.756, 6.2% over), while the MG42 is only 1.22 m and its
    # Lafette 42 mount is the longest side of the assembly (measured 1.715).
    # `Stationary_mg42` therefore has no row — this table's own rule is that
    # a wrong expectation is worse than none, and it was the verifier's own
    # first true positive after the 2026-09-20 repair.
    "Browning": 1.654,      # M2HB
    "Browning_Air": 1.654,
    "Browning_unlimited": 1.654,
    "Stationary_Browning": 1.654,
    "MG42": 1.22,
    "MG42_Air": 1.22,
    "MG42_unlimited": 1.22,
    # Land vehicles, gun forward where the game models it that way. Variants
    # the game leaves ambiguous (PanzerIV barrel length, T34 vs T34-85) are
    # deliberately absent.
    "Sherman": 5.84,        # M4 hull length
    "Tiger": 8.45,          # gun forward
    "Chi-ha": 5.5,          # Type 97
    "M10": 6.83,
    "Hanomag": 5.80,        # SdKfz 251
    "Priest": 6.02,         # M7 Priest
    "Sexton": 6.12,
    "Wespe": 4.81,
    "Willy": 3.36,          # Willys MB
    "Kubelwagen": 3.74,
    # Aircraft. The measured "length" is the longest ground axis, which for
    # every one of these is the wingspan.
    "B17": 31.62,
    "Spitfire": 11.23,
    "BF109": 9.92,
    "Mustang": 11.28,
    "Yak9": 9.74,
    "Ilyushin": 14.6,       # Il-2
    "Stuka": 13.8,          # Ju 87 B
    "Zero": 12.0,           # A6M2
    "SBD": 12.66,
    "SBD-T": 12.66,
    "AichiVal": 14.37,      # Aichi D3A
    "Aichival-T": 14.37,
    # Ships.
    "Fletcher": 114.7,
    "Gato": 95.0,
    "Sub7C": 67.1,          # Type VIIC
    "Hatsuzuki": 134.2,     # Akizuki class
    "Yamato": 263.0,
    "PrinceOW": 227.1,      # King George V class
}


# A figure per manifest *category*, for the case where the name is one of
# dozens that all model the same real thing. A soldier is the only one: the
# four catalogues hold 32 soldier templates (eight nations in vanilla, two per
# expansion pack, nineteen in EoD) and the one external fact about every one of
# them is that a standing man is about as tall as a standing man. Measured over
# their own geometry they run 1.869 m to 2.011 m -- the models take licence and
# the tall ones wear a helmet -- so 1.85 m with the standard tolerance spans
# the catalogues with room to spare while a soldier exported at a tenth or
# three times scale is nowhere near it. That was the *only* external check a
# skinned soldier had missing: it is the one model in the set whose every
# mesh is excused from the placement check, so without a size nothing objective
# was said about it at all.
CATEGORY_LENGTHS_M: dict[str, float] = {
    "soldier": 1.85,
}


class VerifyError(ValueError):
    pass


# -- glb reading ------------------------------------------------------------ #

def read_glb(path: Path) -> tuple[dict, bytes]:
    """The JSON document and the binary chunk of a `.glb`."""
    data = path.read_bytes()
    if len(data) < 12:
        raise VerifyError(f"truncated glb: {path.name}")
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise VerifyError(f"not a glb: {path.name}")
    doc: dict | None = None
    blob = b""
    offset = 12
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if chunk_type == CHUNK_JSON:
            doc = json.loads(data[offset:offset + chunk_length].decode("utf-8"))
        elif chunk_type == CHUNK_BIN:
            blob = data[offset:offset + chunk_length]
        offset += chunk_length + (-chunk_length % 4)
    if doc is None:
        raise VerifyError(f"no JSON chunk: {path.name}")
    return doc, blob


def _accessor_vec3(doc: dict, blob: bytes, index: int) -> list[Vector3]:
    acc = doc["accessors"][index]
    if acc.get("componentType") != 5126 or acc.get("type") != "VEC3":
        raise VerifyError(f"accessor {index} is not float VEC3")
    view = doc["bufferViews"][acc["bufferView"]]
    offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 12)
    return [
        struct.unpack_from("<3f", blob, offset + i * stride)
        for i in range(acc["count"])
    ]


def _accessor_indices(doc: dict, blob: bytes, index: int) -> list[int]:
    acc = doc["accessors"][index]
    fmt = {5121: "<B", 5123: "<H", 5125: "<I"}.get(acc.get("componentType"))
    if fmt is None or acc.get("type") != "SCALAR":
        raise VerifyError(f"accessor {index} is not a scalar index type")
    size = struct.calcsize(fmt)
    view = doc["bufferViews"][acc["bufferView"]]
    offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return [
        struct.unpack_from(fmt, blob, offset + i * size)[0]
        for i in range(acc["count"])
    ]


def _quat_to_matrix(q: tuple[float, float, float, float]) -> Matrix3:
    x, y, z, w = q
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)),
        (2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)),
        (2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)),
    )


def _compose(parent: tuple[Matrix3, Vector3], node: dict) -> tuple[Matrix3, Vector3]:
    pr, pt = parent
    t = node.get("translation", (0.0, 0.0, 0.0))
    r = _quat_to_matrix(node.get("rotation", (0.0, 0.0, 0.0, 1.0)))
    s = node.get("scale", (1.0, 1.0, 1.0))
    scaled = tuple(tuple(r[i][j] * s[j] for j in range(3)) for i in range(3))
    rotation = tuple(
        tuple(sum(pr[i][k] * scaled[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )
    translation = tuple(
        sum(pr[i][k] * t[k] for k in range(3)) + pt[i] for i in range(3)
    )
    return rotation, translation


def _apply(transform: tuple[Matrix3, Vector3], point: Vector3) -> Vector3:
    r, t = transform
    return tuple(sum(r[i][k] * point[k] for k in range(3)) + t[i] for i in range(3))


# The `templateKind` values the exporter stamps on a node that is an effect
# emitter rather than a part of the object. `assemble.py` writes the kind
# verbatim from the `.con`, so this is the game's own vocabulary.
EFFECT_TEMPLATE_KINDS: frozenset[str] = frozenset({
    "particle", "spriteparticle", "effectbundle", "lightsource", "sound",
})

# Extras that only ever appear on a node the exporter baked as a *preview* of
# something the object fires, not as a part of the object: the tracer streak
# and the projectile body. Both sit at the muzzle's own origin.
PREVIEW_EXTRAS: tuple[str, ...] = ("tracerMesh", "projectileMesh")

# Extras that mean the node is an effect emitter.
EFFECT_EXTRAS: tuple[str, ...] = ("effect", "effectEmitter", "effectBundle")


@dataclass
class Part:
    """One mesh-bearing node of the exported scene, in world space.

    The `is_*` properties below are the whole of this module's idea of what a
    node is, and every one of them reads an extra the exporter wrote. Names
    are never consulted -- except for `is_collision`, which keeps a name
    fallback for `.glb` files written before the `collision` extra existed.
    """
    name: str
    extras: dict = field(default_factory=dict)
    world_translation: Vector3 = (0.0, 0.0, 0.0)
    triangles: list[Triangle] = field(default_factory=list)
    node_index: int = -1
    ancestor_indices: frozenset[int] = field(default_factory=frozenset)
    #: Whether this node or any ancestor carries an `extras.skeleton`, i.e.
    #: whether there is a skeleton in scope that could pose a skinned mesh.
    #: `scene_parts` fills it in; a hand-built `Part` defaults to False.
    skeleton_in_scope: bool = False

    @property
    def bound_bone(self) -> str | None:
        return self.extras.get("boundBone")

    @property
    def template_kind(self) -> str:
        return str(self.extras.get("templateKind") or "").lower()

    @property
    def is_collision(self) -> bool:
        return (bool(self.extras.get("collision"))
                or bool(self.extras.get("collisionHull"))
                or "collision" in self.name.lower())

    @property
    def is_effect(self) -> bool:
        """A muzzle flash, shell eject, dust plane or smoke puff.

        Its mesh is a billboard or a flare cone metres long, spawned at the
        emitter's origin -- so it is neither a placement nor a size the object
        has. `em_MuzzHeavy` on the Browning reaches 2.56 m from a 1.65 m gun.
        """
        return (self.template_kind in EFFECT_TEMPLATE_KINDS
                or any(k in self.extras for k in EFFECT_EXTRAS))

    @property
    def is_preview(self) -> bool:
        """The tracer streak or the projectile body, baked hidden so the
        viewer can draw a round in flight. A tracer is a 1 m line through the
        muzzle; a bomb is the bomb, not part of the aeroplane."""
        return any(k in self.extras for k in PREVIEW_EXTRAS)

    @property
    def is_skinned(self) -> bool:
        """Skinned to a skeleton (`extras.skin`, and `extras.skeleton` on the
        node that owns one). A skinned mesh is authored in bind space and put
        in place by the skeleton at runtime, so resting on the origin is what
        it is supposed to do -- which is why every soldier's body, head and
        two hands sit there."""
        return "skin" in self.extras or "skeleton" in self.extras

    @property
    def is_posed(self) -> bool:
        """Skinned *and* with a skeleton in scope to pose it.

        Resting on the origin is only excusable for the first reason when the
        second holds. A soldier exported without its `.ske` -- the skins
        written, the skeleton lost -- is four meshes stacked in bind space that
        nothing will ever move, which is a broken soldier and not a correct
        one; reading `is_skinned` alone excused it unconditionally.
        """
        return self.is_skinned and self.skeleton_in_scope

    @property
    def is_helper(self) -> bool:
        """Not part of the object's own body: collision, effect or preview."""
        return self.is_collision or self.is_effect or self.is_preview

    @property
    def is_body(self) -> bool:
        """Geometry the object is actually made of -- what a size or a
        placement should be measured over."""
        return not self.is_helper

    @property
    def centroid(self) -> Vector3:
        """The average of this part's world-space vertices.

        Where the part's *geometry* actually is, as against where its node
        says it is. The two differ whenever a `.con` gives a sub-part no
        `setPosition` because the mesh is already modelled in the hull's
        space -- EoD's LCT-Mk6 stern ramp hangs at the node origin with its
        geometry 17 m aft.
        """
        points = [p for tri in self.triangles for p in tri]
        if not points:
            return (0.0, 0.0, 0.0)
        n = len(points)
        return tuple(sum(p[i] for p in points) / n for i in range(3))


def body_parts(parts: list[Part]) -> list[Part]:
    """The object's own geometry, helpers dropped."""
    return [p for p in parts if p.is_body and p.triangles]


def scene_parts(doc: dict, blob: bytes) -> list[Part]:
    """Every mesh-bearing node, world-transformed, in scene order.

    Each `Part` also carries `node_index` and `ancestor_indices` -- every
    node index on the path from the scene root down to (not including) this
    one, mesh-bearing or not. `origin_pile` uses it to tell a rig's own pivot
    chain (a gun's node nested under the turret ring it rotates with, both
    correctly resting on the same point) from sub-parts that lost a placement
    independently of each other: an ancestor that is itself a candidate
    already accounts for the shared point, so a descendant landing there too
    is not a second, independent instance of the failure.
    """
    nodes = doc.get("nodes", [])
    meshes = doc.get("meshes", [])
    parts: list[Part] = []

    def visit(index: int, parent: tuple[Matrix3, Vector3],
             ancestors: tuple[int, ...], skeleton: bool = False,
             depth: int = 0) -> None:
        if depth > 64 or index >= len(nodes):
            return
        node = nodes[index]
        world = _compose(parent, node)
        extras = node.get("extras") or {}
        skeleton = skeleton or bool(extras.get("skeleton"))
        mesh_index = node.get("mesh")
        if mesh_index is not None:
            part = Part(
                name=node.get("name", f"node{index}"),
                extras=extras,
                world_translation=world[1],
                node_index=index,
                ancestor_indices=frozenset(ancestors),
                skeleton_in_scope=skeleton,
            )
            for prim in meshes[mesh_index].get("primitives", []):
                attrs = prim.get("attributes", {})
                if "POSITION" not in attrs or "indices" not in prim:
                    continue
                positions = _accessor_vec3(doc, blob, attrs["POSITION"])
                indices = _accessor_indices(doc, blob, prim["indices"])
                world_positions = [_apply(world, p) for p in positions]
                for i in range(0, len(indices) - 2, 3):
                    part.triangles.append((
                        world_positions[indices[i]],
                        world_positions[indices[i + 1]],
                        world_positions[indices[i + 2]],
                    ))
            parts.append(part)
        for child in node.get("children", []):
            visit(child, world, ancestors + (index,), skeleton, depth + 1)

    scene = doc.get("scenes", [{}])[doc.get("scene", 0)]
    for root in scene.get("nodes", []):
        visit(root, (_IDENTITY, (0.0, 0.0, 0.0)), ())
    return parts


# -- geometry health -------------------------------------------------------- #

def _triangle_area(tri: Triangle) -> float:
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
    ab = (bx - ax, by - ay, bz - az)
    ac = (cx - ax, cy - ay, cz - az)
    cross = (
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    )
    return 0.5 * math.sqrt(sum(v * v for v in cross))


@dataclass
class GeometryStats:
    triangles: int = 0
    zero_area: int = 0
    non_finite_vertices: int = 0

    @property
    def zero_area_fraction(self) -> float:
        return self.zero_area / self.triangles if self.triangles else 0.0


def geometry_stats(parts: list[Part], *, zero_area_eps: float = 1e-10) -> GeometryStats:
    stats = GeometryStats()
    for part in parts:
        if part.is_collision:
            continue
        for tri in part.triangles:
            stats.triangles += 1
            flat = [v for point in tri for v in point]
            if not all(math.isfinite(v) for v in flat):
                stats.non_finite_vertices += 1
                continue
            if _triangle_area(tri) < zero_area_eps:
                stats.zero_area += 1
    return stats


# A part is only "collapsed" when its own geometry sits at the anchor too,
# within this fraction of the model's longest side. Node translation alone is
# not enough: a `.con` gives a sub-part no `setPosition` whenever the mesh is
# already modelled in the parent's space, which is how most mod vehicles are
# built. EoD's LCT-Mk6 has five such parts, and their geometry is 1.6 m,
# 8.7 m, 7.5 m, 17.3 m and 13.8 m from the origin of a 35 m landing craft.
# Nothing is collapsed there; the parts are exactly where the artist put them.
#
# The failure mode this check exists for looks different in exactly this way:
# a sub-part whose placement was lost is authored around its *own* local
# origin, so collapsing it puts its geometry on the anchor as well. A rifle's
# trigger is 2 cm of mesh centred on its bone; land it at the root and its
# centroid is a centimetre from the origin of a 1.1 m weapon, well inside the
# 5.5 cm this allows.
ORIGIN_CENTROID_FRACTION = 0.05
# ...with a floor, because the fraction is of the model's own size and a model
# that collapsed *entirely* has no size left to take a fraction of. Three
# centimetres is under the smallest sub-part any check here cares about.
ORIGIN_CENTROID_FLOOR = 0.03


def _cluster_by_translation(parts: list[Part],
                            epsilon: float) -> list[list[Part]]:
    """Group `parts` by shared `world_translation`, wherever that point is.

    Not just the scene origin: a `.con`'s missing `setPosition` or an
    unapplied bind buries a sub-part at whatever point its immediate parent's
    world transform composes to, and that parent is routinely offset from the
    scene root -- a vehicle hull's running-gear mount, a turret's own pivot.
    Two nodes sharing a parent and both carrying no local offset land on
    exactly the same floating-point value (the same composition applied to
    the same input), so a tight epsilon still clusters them correctly; it is
    the anchor that needs to move, not the tolerance.
    """
    clusters: list[list[Part]] = []
    for part in parts:
        for cluster in clusters:
            anchor = cluster[0].world_translation
            if all(abs(a - b) < epsilon
                   for a, b in zip(part.world_translation, anchor)):
                cluster.append(part)
                break
        else:
            clusters.append([part])
    return clusters


def origin_pile(parts: list[Part], *, epsilon: float = 1e-4,
                allowance: int = 2, explained: frozenset[str] = frozenset(),
                model_size: float | None = None) -> list[str]:
    """Unexplained body parts collapsed onto a single shared point.

    One part at a shared point is the hull or weapon body; a soldier
    legitimately stacks two. More than `allowance` *unexplained* parts
    collapsed onto the *same* point is the child-placement failure mode:
    `setPosition` read as a property of the parent, or a bind that was never
    applied, leaves every sub-part buried at whatever their parent's world
    position happens to be -- the scene root for a weapon or a soldier, but
    just as often a hull, a turret ring or a track assembly sitting well away
    from (0, 0, 0). Anchoring the check on the scene origin alone missed
    exactly that: a Sherman with only its body parts' transforms zeroed piles
    27 of them (all fourteen road wheels, `ShermanTower`, the hull hatch, the
    pintle Browning) onto the hull's own running-gear mount at y = -0.8, and a
    fixed-origin reading is blind to it. So the anchor is *comparative* --
    wherever `_cluster_by_translation` finds parts sharing a point -- rather
    than a hardcoded (0, 0, 0).

    Collapsed still means both halves: the node sits at the cluster's shared
    point *and* the part's own geometry does, within `ORIGIN_CENTROID_FRACTION`
    of `model_size` (the model's longest side, `body_length`). Passing no
    `model_size` keeps the old node-translation-only reading. This half is
    what tells a real pile from instancing that legitimately shares a mount:
    EoD's `BTR60CockpitExternal` is the same mesh placed at five points on the
    hull, each authored with its geometry offset from its own node (the same
    "modelled in the parent's space" pattern as the LCT-Mk6), so none of the
    five reads as collapsed even where their nodes coincide.

    Five kinds of node are explained and do not count:

    * **bound** — a `boundBone` extra means a skeleton put it there. The
      Type99's mag and bolt bones genuinely rest on its base bone.
    * **skinned, with a skeleton in scope** — an `extras.skin` mesh is
      authored in bind space and moved by the skeleton at runtime. Every
      soldier is four such meshes and all four rest on the origin, which is
      correct and was 19 of the vanilla rebuild's 42 "broken" verdicts. The
      excuse is `is_posed`, not `is_skinned`: it holds only while the node or
      an ancestor carries an `extras.skeleton` to do the posing. Strip the
      soldier's skeleton and those same four meshes are a real pile, which
      `unposed_skins` names as well.
    * **helpers** — collision hulls, emitters, tracers and projectile
      previews. They are spawned from the object's own origin by definition,
      so counting them is counting the exporter's furniture. `AichiVal` was
      called broken for a cockpit mesh, a bomb and a tracer.
    * **`explained`** — names the caller already reports for a better reason,
      so the same fact is not stated twice. `verify_models.py` passes the
      parts the assembler recorded as binds it could not apply: EoD's M40
      inherits the No4's `Block` and `Mag` sub-parts but not their bones, and
      that is one finding, not two.
    * **a lone rider on a cluster ancestor** — a multi-axis mount is built as
      nested pivots (a yaw bundle, a pitch bundle inside it, the gun inside
      that), each correctly carrying no local offset of its own because the
      rotation happens in place, so every level legitimately composes to the
      same world point as the mount itself. EoD's `EoD_PACV_Ballmount` (the
      yaw ring) and the `Mk19Ball` nested inside it are one pivot chain
      wearing two names, not two independent placement failures, so the
      single descendant folds into its ancestor. This is *not* the same
      shape as a genuine pile: EoD's Fletcher carries a Flak 38 mount whose
      handles, pedal and targeter (four independent siblings, not a chain)
      all nest under `RL_body`, and when their placements are lost all four
      -- being four, not one -- still count, `RL_body` included, because an
      ancestor with more than one rider is the branch a pile piles onto, not
      a pivot wearing a second name. Only an ancestor with *exactly one*
      cluster-mate riding it is treated as a pivot and folds its rider away.
    """
    radius = (max(model_size * ORIGIN_CENTROID_FRACTION, ORIGIN_CENTROID_FLOOR)
              if model_size else None)

    def geometry_at(part: Part, anchor: Vector3) -> bool:
        if radius is None:
            return True
        c = part.centroid
        return math.sqrt(sum((c[i] - anchor[i]) ** 2 for i in range(3))) <= radius

    candidates = [
        part for part in parts
        if part.is_body
        and not part.is_posed
        and part.bound_bone is None
        and part.name not in explained
    ]

    piled: list[str] = []
    for cluster in _cluster_by_translation(candidates, epsilon):
        anchor = cluster[0].world_translation
        # A rig's own pivot chain rests on its own point by construction, and
        # an ancestor already in this cluster accounts for its *one* rider --
        # but an ancestor with two or more cluster-mates riding it is not a
        # chain, it is the branch point several independent placements were
        # lost onto, which is the pile itself. So only a lone rider folds
        # into its ancestor; nothing folds away where the ancestor branches.
        indices_here = {part.node_index for part in cluster}
        rider_counts: dict[int, int] = {}
        for part in cluster:
            for ancestor in part.ancestor_indices & indices_here:
                rider_counts[ancestor] = rider_counts.get(ancestor, 0) + 1
        outermost = [
            part for part in cluster
            if not any(rider_counts.get(ancestor) == 1
                      for ancestor in part.ancestor_indices & indices_here)
        ]
        collapsed = [part for part in outermost if geometry_at(part, anchor)]
        if len(collapsed) > allowance:
            piled.extend(part.name for part in collapsed)
    return piled


def unposed_skins(parts: list[Part]) -> list[str]:
    """Skinned meshes with no skeleton in scope to put them anywhere.

    The one thing a skinned model cannot survive. A `.skn` holds vertices in
    bind space and a per-vertex bone index; without the `.ske` those indices
    address nothing, so the mesh draws exactly where it was authored -- which
    for all eight vanilla soldiers is four meshes stacked at the origin, the
    body inside the head. It is also the failure the old check could not see,
    because it excused any node carrying a `skin` extra whether or not
    anything could pose it.

    Every skinned part in all four installed catalogues (425 models, 32 of
    them soldiers) has a skeleton in scope, so this returning anything at all
    is a regression.
    """
    return [part.name for part in parts
            if part.is_skinned and not part.skeleton_in_scope]


@dataclass
class Inventory:
    """What the scene holds against what the exporter's report claims."""
    scene_parts: int
    scene_triangles: int
    report_parts: int
    report_triangles: int

    @property
    def agrees(self) -> bool:
        return (self.scene_parts == self.report_parts
                and self.scene_triangles == self.report_triangles)


def inventory_check(parts: list[Part], report: dict | None) -> Inventory | None:
    """Did every part the exporter counted reach the file?

    The one failure mode nothing else here can see: a part that is simply
    *gone*. A lost placement makes a pile, a lost mesh file makes a report
    line, a wrong scale makes a length -- but a node dropped between the
    assembler's own count and the bytes on disk leaves no trace in any other
    check, and a Sherman missing its turret is as broken as a Sherman with its
    turret on the origin.

    The exporter writes `parts` and `triangles` into the report over exactly
    the object's own geometry (helpers excluded), so the two counts are
    comparable term for term, and they agree exactly on all 425 models of the
    four installed catalogues. No tolerance is therefore warranted: a
    disagreement is a fact about the file, not a reading.
    """
    if not report or "parts" not in report or "triangles" not in report:
        return None
    body = body_parts(parts)
    return Inventory(
        scene_parts=len(body),
        scene_triangles=sum(len(p.triangles) for p in body),
        report_parts=int(report["parts"]),
        report_triangles=int(report["triangles"]),
    )


def body_length(parts: list[Part]) -> float | None:
    """The longest side of the AABB over the object's own geometry.

    `measure.bounds` reads the whole file, which since the exporter began
    baking effects and previews is the wrong box: the Browning measures
    3.56 m across a muzzle flash that reaches 2.56 m from a 1.65 m gun, and
    the Bar1918 2.02 m against 1.19 m real. Measuring the model over its own
    geometry is the figure a real-world length can be compared against, and it
    was 23 of the vanilla rebuild's 42 "broken" verdicts.
    """
    points = [v for part in body_parts(parts) for tri in part.triangles for v in tri]
    if not points:
        return None
    spans = [max(p[i] for p in points) - min(p[i] for p in points) for i in range(3)]
    return max(spans)


# Markers `assemble.py` writes into `boundParts` when a bind could not be
# applied. "no such bone" means the placement is simply unknown; "no skeleton
# in scope" is the recorded GrenadeAllies case — the `.ske` itself is corrupt
# and the report says so under `skeletonsNotRead`.
_BIND_NO_BONE = "(no such bone)"
_BIND_NO_SKELETON = "(no skeleton in scope)"
# A bind onto a *skinned* part is applied by the skin's own bind pose, so the
# assembler records the bind and stamps no `boundBone`: there is no offset to
# stamp. Every soldier in the four catalogues is exactly this (the head bound
# to `Bip01_Spine3`), which is why `unstamped_binds` has to know the marker.
_BIND_SKINNED = "(skinned, bind pose is identity)"


def unplaced_bound_parts(report: dict) -> tuple[list[str], list[str]]:
    """Bound parts the assembler could not place: (missing bones, missing skeletons)."""
    no_bone: list[str] = []
    no_skeleton: list[str] = []
    for line in report.get("boundParts") or []:
        if _BIND_NO_BONE in line:
            no_bone.append(line)
        elif _BIND_NO_SKELETON in line:
            no_skeleton.append(line)
    return no_bone, no_skeleton


def unplaced_part_names(report: dict | None) -> frozenset[str]:
    """The part names in those lines -- `"No4Block -> Block (no such bone)"`
    gives `No4Block` -- so the origin-pile check can leave them to the finding
    that already names them."""
    if not report:
        return frozenset()
    names = set()
    for line in report.get("boundParts") or []:
        if _BIND_NO_BONE in line or _BIND_NO_SKELETON in line:
            names.add(line.split("->", 1)[0].strip())
    return frozenset(names)


def unstamped_binds(parts: list[Part], report: dict | None) -> list[str]:
    """Parts the report says it placed from a bone that carry no `boundBone`.

    The placement check cannot see a lost bind on its own, and this is why it
    needs help. Collapse a rifle's three bound sub-parts onto its origin and
    only two of them read as collapsed -- the third's mesh is authored 11.5 cm
    from its bone, which is 9.7% of a 1.19 m weapon against the 5% radius that
    keeps the LCT-Mk6 quiet -- so the pile stays at the allowance and nothing
    fires. Meanwhile the silhouette check measures *bound* parts, so losing
    the binds leaves it nothing to measure at all. Both checks go quiet
    together, which is the worst shape a verifier can have.

    The bind is nevertheless still recorded, in the assembler's own report, so
    the two can be held against each other: a part the report placed from a
    bone and the file does not mark is a placement that went missing between
    the two. Measured across the four catalogues, the only applied bind lines
    whose part carries no `boundBone` are the 32 soldiers' skinned heads
    (marked as such in the line) and four EoD parts that never reached the
    scene at all because their geometry is undefined -- both excluded here.
    """
    if not report:
        return []
    present = {part.name: part for part in parts}
    lost = []
    for line in report.get("boundParts") or []:
        if any(marker in line for marker in
               (_BIND_NO_BONE, _BIND_NO_SKELETON, _BIND_SKINNED)):
            continue
        name = line.split("->", 1)[0].strip()
        part = present.get(name)
        if part is not None and part.bound_bone is None:
            lost.append(name)
    return lost


def bound_parts_placed(report: dict | None) -> int:
    """How many binds the assembler *did* apply.

    The difference between "the game's own data names a bone its skeleton
    lacks" and "our skeleton reader lost the bones": if other parts bound to
    the same skeleton, the reader read it, and the gap is the data's.
    """
    if not report:
        return 0
    return sum(1 for line in report.get("boundParts") or []
               if _BIND_NO_BONE not in line and _BIND_NO_SKELETON not in line)


# -- silhouette ------------------------------------------------------------- #

def _rasterize(triangles: list[Triangle], axes: tuple[int, int],
               lo: tuple[float, float], hi: tuple[float, float],
               resolution: int) -> bytearray:
    """Filled projection of `triangles` onto the plane given by `axes`."""
    ai, aj = axes
    span_x = hi[0] - lo[0]
    span_y = hi[1] - lo[1]
    sx = (resolution - 1) / span_x if span_x > 0 else 0.0
    sy = (resolution - 1) / span_y if span_y > 0 else 0.0
    mask = bytearray(resolution * resolution)
    for tri in triangles:
        pts = [((p[ai] - lo[0]) * sx, (p[aj] - lo[1]) * sy) for p in tri]
        min_x = max(0, math.floor(min(p[0] for p in pts)))
        max_x = min(resolution - 1, math.ceil(max(p[0] for p in pts)))
        min_y = max(0, math.floor(min(p[1] for p in pts)))
        max_y = min(resolution - 1, math.ceil(max(p[1] for p in pts)))
        (x0, y0), (x1, y1), (x2, y2) = pts
        d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(d) < 1e-12:
            # Degenerate in this projection: stamp its bounding pixels so an
            # edge-on part still counts as present.
            for py in range(min_y, max_y + 1):
                row = py * resolution
                for px in range(min_x, max_x + 1):
                    mask[row + px] = 1
            continue
        for py in range(min_y, max_y + 1):
            row = py * resolution
            for px in range(min_x, max_x + 1):
                w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d
                w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d
                if w0 >= -1e-9 and w1 >= -1e-9 and (1 - w0 - w1) >= -1e-9:
                    mask[row + px] = 1
    return mask


def _dilate(mask: bytearray, resolution: int) -> bytearray:
    out = bytearray(mask)
    for y in range(resolution):
        row = y * resolution
        for x in range(resolution):
            if mask[row + x]:
                continue
            for dy in (-1, 0, 1):
                ny = y + dy
                if not 0 <= ny < resolution:
                    continue
                nrow = ny * resolution
                for dx in (-1, 0, 1):
                    nx = x + dx
                    if 0 <= nx < resolution and mask[nrow + nx]:
                        out[row + x] = 1
                        break
                else:
                    continue
                break
    return out


@dataclass
class SilhouetteResult:
    aggregate: float
    per_part: dict[str, float]


def silhouette_outside(bound_parts: dict[str, list[Triangle]],
                       shadow: list[Triangle], *,
                       resolution: int = SILHOUETTE_RESOLUTION,
                       ) -> SilhouetteResult | None:
    """Fraction of bound-part area outside the shadow-mesh silhouette.

    Side (Z-Y) projection: the shadow meshes are authored as near-flat cutouts
    a few centimetres wide, so the side view is the one they actually describe.
    The aggregate weights each part by its own projected area, which is why a
    coarse shadow that omits the trigger-guard hole does not fail a correctly
    placed trigger — the part is tiny against the mag and bolt the check is
    really watching.
    """
    if not shadow or not bound_parts:
        return None
    axes = (2, 1)
    points = [p for tri in shadow for p in tri]
    points += [p for tris in bound_parts.values() for tri in tris for p in tri]
    lo = (min(p[axes[0]] for p in points), min(p[axes[1]] for p in points))
    hi = (max(p[axes[0]] for p in points), max(p[axes[1]] for p in points))
    silhouette = _dilate(_rasterize(shadow, axes, lo, hi, resolution), resolution)

    per_part: dict[str, float] = {}
    total = outside_total = 0
    for name, triangles in bound_parts.items():
        part_mask = _rasterize(triangles, axes, lo, hi, resolution)
        area = 0
        outside = 0
        for i, filled in enumerate(part_mask):
            if filled:
                area += 1
                if not silhouette[i]:
                    outside += 1
        per_part[name] = outside / area if area else 0.0
        total += area
        outside_total += outside
    return SilhouetteResult(
        aggregate=outside_total / total if total else 0.0,
        per_part=per_part,
    )


# -- dimensions ------------------------------------------------------------- #

@dataclass
class DimensionCheck:
    expected: float
    measured: float

    @property
    def deviation(self) -> float:
        return abs(self.measured - self.expected) / self.expected

    def ok(self, tolerance: float = LENGTH_TOLERANCE) -> bool:
        return self.deviation <= tolerance


def dimension_check(name: str, measured_length: float | None,
                    known: dict[str, float] | None = None,
                    category: str | None = None,
                    ) -> DimensionCheck | None:
    """Compare the measured longest side against the real thing, when known.

    `category` is the manifest's own classification, which is how a soldier
    gets a figure without a row per nation: the table above needs one entry
    per template name, and there are 32 soldier templates across the four
    catalogues whose only external fact is that a man is about as tall as a
    man. A name row still wins where one exists.
    """
    table = KNOWN_LENGTHS_M if known is None else known
    expected = table.get(name)
    if expected is None and category:
        expected = CATEGORY_LENGTHS_M.get(category.lower())
    if expected is None or measured_length is None:
        return None
    return DimensionCheck(expected=expected, measured=measured_length)


# -- triage ------------------------------------------------------------------ #

@dataclass
class Finding:
    severity: str   # "broken" | "degraded" | "info"
    message: str


@dataclass
class Triage:
    name: str
    findings: list[Finding] = field(default_factory=list)

    @property
    def status(self) -> str:
        severities = {f.severity for f in self.findings}
        if "broken" in severities:
            return "broken"
        if "degraded" in severities:
            return "degraded"
        return "clean"

    def broken(self, message: str) -> None:
        self.findings.append(Finding("broken", message))

    def degraded(self, message: str) -> None:
        self.findings.append(Finding("degraded", message))

    def info(self, message: str) -> None:
        self.findings.append(Finding("info", message))


def triage_report(name: str, report: dict | None, *,
                  parts: list[Part] | None = None,
                  stats: GeometryStats | None = None,
                  silhouette: SilhouetteResult | None = None,
                  dimensions: DimensionCheck | None = None,
                  length_tolerance: float = LENGTH_TOLERANCE,
                  vanilla_facts: bool = True,
                  silhouette_fatal: bool = False,
                  missing_asset_roles: dict[str, str] | None = None,
                  missing_asset_absent: frozenset[str] = frozenset(),
                  archives_read: bool = False,
                  inventory: Inventory | None = None) -> Triage:
    """Fold every check into one clean / degraded / broken verdict.

    `vanilla_facts` applies the recorded authored exceptions above — the
    borrowed Type5 shadow, the two shaderless materials, the never-shipped
    textures. A mod extraction should pass False: its template names can
    collide with vanilla's without sharing its data.
    `BASE_GAME_ABSENT_MESHES` is not one of those and applies either way; it
    is a statement about a file the base game never shipped, and every mod
    chain inherits it.

    `silhouette_fatal` is the catalogue's verdict, not this model's: the
    caller sets it when the median weapon in the catalogue reads high, which
    is the shape the mirror regression has. On its own, one weapon measuring
    outside its shadow is a degradation.

    `missing_asset_roles` maps a missing geometry template or mesh file to
    what in the game data referenced it (`"projectile"`, `"effect"`, `"part"`,
    `"collision"`), resolved from the archives by the caller. An asset only a
    projectile or an effect wanted cost the model nothing it draws.

    `missing_asset_absent` holds the lowercased names the caller has *proved*
    the mod chain cannot resolve either: no `.con` in the chain defines that
    geometry template, or no archive in it holds that mesh file. This is the
    difference between "the extraction lost something" and "the mod's data
    points at nothing", and it is the whole severity question. The engine
    builds its geometry-template registry from the same scripts we parse and
    probes the same archives, so a reference the chain cannot resolve draws
    nothing in the game either and the extraction reproducing that is
    *correct*. `archives_read` says whether the caller could ask at all;
    without the archives an unresolved asset cannot be told apart from a
    dangling one, and saying "broken" on a coin toss is what this module
    exists to stop.
    """
    triage = Triage(name)
    roles = missing_asset_roles or {}

    if parts is not None:
        visible = [p for p in parts if not p.is_collision and p.triangles]
        if not visible:
            triage.broken("no visible geometry in the exported scene")
        unposed = unposed_skins(parts)
        if unposed:
            triage.broken(
                f"{len(unposed)} skinned mesh(es) with no skeleton in scope to "
                f"pose them, so they draw in bind space where they were "
                f"authored: " + ", ".join(sorted(unposed)))
        pile = origin_pile(parts, explained=unplaced_part_names(report),
                           model_size=body_length(parts))
        if pile:
            message = (f"{len(pile)} unexplained parts piled on the origin: "
                       + ", ".join(sorted(pile)))
            # A pile the report already explains (the skeleton itself was
            # unreadable, as GrenadeAllies' corrupt .ske) is a recorded
            # degradation; an unexplained pile is a placement regression.
            if report and (report.get("skeletonsNotRead") or []):
                triage.degraded(message)
            else:
                triage.broken(message)

    if inventory is not None and not inventory.agrees:
        triage.broken(
            f"the scene holds {inventory.scene_parts} parts and "
            f"{inventory.scene_triangles} triangles; the exporter's own report "
            f"counted {inventory.report_parts} and "
            f"{inventory.report_triangles}")

    if stats is not None:
        if stats.non_finite_vertices:
            triage.broken(f"{stats.non_finite_vertices} non-finite triangles")
        if stats.triangles and stats.zero_area_fraction > 0.02:
            triage.degraded(
                f"{stats.zero_area}/{stats.triangles} zero-area triangles")

    if silhouette is not None:
        pct = silhouette.aggregate * 100
        authored = SILHOUETTE_AUTHORED.get(name) if vanilla_facts else None
        if authored is not None:
            ceiling, reason = authored
            if silhouette.aggregate > ceiling:
                triage.broken(
                    f"{pct:.1f}% of bound-part area outside the shadow silhouette, "
                    f"past even the recorded authored ceiling of {ceiling * 100:.0f}%")
            else:
                triage.info(
                    f"silhouette {pct:.1f}% outside (authored: {reason})")
        elif silhouette.aggregate > SILHOUETTE_FAIL:
            line = (f"{pct:.1f}% of bound-part area outside the shadow "
                    f"silhouette")
            if silhouette_fatal:
                triage.broken(line + " — and so does the median weapon in this "
                                     "catalogue, which is the shape a mirrored "
                                     ".ske read has")
            else:
                triage.degraded(
                    line + " — one weapon against a coarse or borrowed shadow "
                           "mesh, so this is a reading to look at, not a "
                           "placement failure on its own")
        elif silhouette.aggregate > SILHOUETTE_WARN:
            triage.degraded(f"{pct:.1f}% of bound-part area outside the shadow silhouette")
        else:
            triage.info(f"silhouette {pct:.1f}% outside")

    if dimensions is not None:
        line = (f"length {dimensions.measured:.3f} m vs {dimensions.expected:.3f} m real "
                f"({dimensions.deviation * 100:.1f}% off)")
        if dimensions.ok(length_tolerance):
            triage.info(line)
        else:
            triage.broken(line)

    if report:
        if parts is not None and (lost := unstamped_binds(parts, report)):
            triage.broken(
                f"{len(lost)} part(s) the report placed from a bone carry no "
                f"bind in the file, so the placement was lost after it was "
                f"resolved: " + ", ".join(sorted(lost)))
        no_bone, no_skeleton = unplaced_bound_parts(report)
        placed = bound_parts_placed(report)
        for line in no_bone:
            if placed:
                # Other parts bound to the same skeleton, so the skeleton was
                # read and the gap is the game's own: EoD's M40 inherits the
                # No4's `Block` and `Mag` sub-parts without their bones, and
                # the engine would leave them where we do.
                triage.degraded(
                    f"bound part names a bone its own skeleton lacks, and "
                    f"{placed} other bind(s) on the same skeleton did apply, "
                    f"so this is the game's data: {line}")
            else:
                triage.broken(
                    f"bound part names a bone the skeleton lacks, and no bind "
                    f"on this model applied at all: {line}")
        for line in no_skeleton:
            triage.degraded(f"bound part left unplaced: {line}")

        def classify_missing(kind: str, names: list[str]) -> None:
            """Split a list of unresolved assets by what wanted them, and by
            whether the mod chain could have resolved them at all."""
            recorded, cosmetic, dangling, real = [], [], [], []
            for asset in names:
                leaf = asset.split(" (", 1)[0].strip().lower()
                if leaf in BASE_GAME_ABSENT_MESHES:
                    recorded.append(asset)
                elif leaf in missing_asset_absent:
                    dangling.append(asset)
                elif roles.get(leaf) in ("projectile", "effect", "collision"):
                    cosmetic.append(asset)
                else:
                    real.append(asset)
            if real:
                # Either the archives hold it and the assembler lost it, or
                # nobody asked the archives. The first is a regression; the
                # second is an unknown, and an unknown is not a verdict.
                line = f"{kind} unresolved: {', '.join(real)}"
                if archives_read:
                    triage.broken(
                        line + " — and the mod chain does define it, so the "
                               "assembler lost something that is there")
                else:
                    triage.degraded(
                        line + " — the archives were not read, so this could "
                               "not be told apart from a reference the mod's "
                               "own data leaves dangling")
            if dangling:
                drawn = sorted({roles.get(a.split(" (", 1)[0].strip().lower())
                                or "part" for a in dangling})
                triage.degraded(
                    f"{kind} unresolved and defined nowhere in the mod chain, "
                    f"so the engine draws nothing there either and the "
                    f"extraction matches the game (wanted by: "
                    f"{'/'.join(drawn)}): {', '.join(dangling)}")
            if cosmetic:
                triage.degraded(
                    f"{kind} unresolved, wanted only by a "
                    + "/".join(sorted({roles[a.split(' (', 1)[0].strip().lower()]
                                       for a in cosmetic}))
                    + f", so the model itself is whole: {', '.join(cosmetic)}")
            for asset in recorded:
                leaf = asset.split(" (", 1)[0].strip().lower()
                triage.info(f"{asset}: {BASE_GAME_ABSENT_MESHES[leaf]}")

        classify_missing("mesh files", report.get("missingMeshFiles") or [])
        classify_missing("geometry templates",
                         report.get("missingGeometryTemplates") or [])
        missing_textures = report.get("texturesNotFound") or []
        if missing_textures:
            authored_textures = VANILLA_UNRESOLVED_TEXTURES if vanilla_facts else frozenset()
            unexplained = [
                t for t in missing_textures
                if t.strip().lower() not in authored_textures
            ]
            if unexplained:
                triage.degraded(f"textures unresolved: {', '.join(unexplained)}")
            explained = [t for t in missing_textures if t not in unexplained]
            if explained:
                triage.info(
                    "textures absent from every vanilla install: "
                    + ", ".join(explained))
        no_shader = report.get("materialsWithoutShader") or []
        if no_shader:
            authored_materials = (
                MATERIALS_WITHOUT_SHADER_AUTHORED.get(name, frozenset())
                if vanilla_facts else frozenset())
            unexplained = [
                m for m in no_shader if m.lower() not in authored_materials
            ]
            if unexplained:
                triage.degraded(
                    f"materials without a shader: {', '.join(unexplained)}")
            explained = [m for m in no_shader if m not in unexplained]
            if explained:
                triage.info(
                    "materials no vanilla .rs defines: " + ", ".join(explained))
        bad_skeletons = report.get("skeletonsNotRead") or []
        if bad_skeletons:
            triage.degraded(f"skeletons unreadable: {', '.join(bad_skeletons)}")
        unresolved = report.get("unresolvedTemplates") or []
        if unresolved:
            triage.degraded(f"templates unresolved: {', '.join(unresolved)}")

    return triage
