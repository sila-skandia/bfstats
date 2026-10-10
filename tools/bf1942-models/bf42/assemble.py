"""Turn a Refractor object template into a textured glTF scene.

Three lookups have to line up for a part to come out looking like the game:

    ObjectTemplate.geometry Foo   ->  GeometryTemplate Foo  ->  StandardMesh/Foo_M1.sm
    Foo_M1.sm material "Foo_M1_Material0"  ->  a shader block in a .rs
    that shader's `texture "texture/bar"`  ->  texture/bar.dds | .tga

Any of the three can miss independently, so every miss is recorded on the report
rather than swallowed — an untextured model and a model whose textures were never
in the install look identical on screen but need completely different fixes.
"""

from __future__ import annotations

import sys
import struct
from dataclasses import dataclass, field, replace
from pathlib import Path

from . import con as con_mod
from . import baf, flagcloth, gltf, rs, ske, skin, stdmesh, treemesh
from .level import object_lightmap_key
from .meshtga import mesh_tga_pixels
from .rfa import ArchivePool

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, downscale, encode_png  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from extract_hud_assets import decode_tga  # noqa: E402

TEXTURE_EXTS = (".dds", ".tga")

# Texels with alpha below this are treated as alpha-tested cutout background
# whose RGB is safe to overwrite when bleeding (see `_bleed_alpha`). Kept low
# on purpose: alpha also carries specular/reflectivity on opaque `_I` skins
# (measured minima 68-119 on vanilla aircraft), which must never be bled over.
BLEED_CUTOUT_ALPHA = 16

# The engine's alpha test is on for every StandardMesh draw, and a material
# that names no `alphaTestRef` runs it at its defaults: ALPHAFUNC GREATER
# against a reference of 0 (the render-state reset at 0x006000f3-0x006001e0
# writes ALPHATESTENABLE 1, ALPHAREF 0, ALPHAFUNC 5; `applyRenderState`
# 0x005bf690 only ever rewrites ALPHAREF, from the shader's own +0x3c). A texel
# of alpha 0 is therefore dropped from an *opaque* material too, with no
# `transparent true;` to ask for it. Spelled as glTF's MASK, it is the smallest
# cutoff an 8-bit alpha of 1 still clears. Without it a sprite that only
# carries its cut-away background in the alpha channel, such as FH's N1K1
# reflector sight (`1p_n1k1_m1.rs` never says `transparent`), drew the DXT
# block colours under that background as a solid red square.
ENGINE_ALPHA_FLOOR = 0.5 / 255.0


def geometry_is_first_person(geometry_name: str | None) -> bool:
    """Cockpit / 1P view meshes are named `1P_...` (or `1PPT_...`, `1PBritBody`).

    The name is the only reliable tell a mesh carries. The *template* names
    are not: vanilla's cockpit alternatives are called `...CockpitInternal` on
    11 aircraft but `bf109CockpitBlurred` on the bf109, `KatyushaInterior` on
    the Katyusha and `...HighRSteering` on every steering wheel. The geometry
    name is uniform across all 72 of them. It is not what the engine goes by:
    a cockpit is the alternative its selector shows in the Inside view
    (`inside_view_alternative`), and mods do not name those `1P`.

    Why 1P geometry is skipped by default (both the mesh load in `build_node`
    and the alternative steering in `_select_lod_children`), rather than merely
    ranking below the 3P mesh:

    * **It is an alternative, never an extra part.** A cockpit interior and the
      hull that hides it are two alternatives of one LodObject, and a soldier's
      1P body and hands are `addTemplate` siblings of the 3P body. Draw both
      and you get an interior stacked inside a fuselage, or a pair of arms
      floating through a soldier's chest.
    * **The alternative order does not encode which is which.** Cockpit
      `DistCompareSelector`s list the exterior first, but every `DistanceSelector`
      pairing (the B17's gun models, and the Willy / Lynx / Katyusha /
      KettenKrad / BlackMedal / Ho-Ha / Elco / Type38 steering wheels and
      throttle levers) lists the 1P mesh *first*, because there it is the
      near-LOD. `select_lod_alternative` falls back to `children[0]`, so
      without this predicate a browse Willy would ship the first-person
      steering wheel.
    * **It is authored for a camera that is inside it.** These meshes have no
      outside: `1P_Corsair` is a cockpit tub with no fuselage, single-sided and
      normalled inward. It is correct only from the eye point it was drawn for.

    So the skip is right for a browse model and for a level bake, and a cockpit
    view needs the opposite export rather than a lifted guard — which is what
    `Assembler(first_person=True)` is.
    """
    if not geometry_name:
        return False
    base = geometry_name.replace("\\", "/").rsplit("/", 1)[-1]
    return base.lower().startswith("1p")


# The farthest a `DistanceSelector`'s first rung may reach and still be a part
# only a seated player ever sees. See `near_rung_is_first_person`.
NEAR_RUNG_FIRST_PERSON_M = 2.0


def near_rung_is_first_person(library: con_mod.ObjectLibrary,
                              template: con_mod.ObjectTemplate) -> bool:
    """Whether this LodObject's alternative 0 is its first-person half by place.

    A `DistanceSelector` shows alternative 0 while the camera is within its
    first `addLodDistance` of the LodObject, and the next one past it.
    `DistLodSelector::init` (lnxded 0x08215aa0) squares the declared
    distances; `getLodLevelRelative` (0x08215b30) takes the camera's squared
    distance to the object less its bounding radius squared, scales it by
    `LodObject::m_distanceLodFactor` and the render view's FOV factor, and
    `lower_bound`s it into them. Nothing else picks the rung.

    Desert Combat builds gunner sights that way: `AC-130_Howitzer_Cockpit`
    puts `AC-130_Sight_Internal` (a 50-triangle reticle pane) in front of a
    meshless `AC-130_Sight_External` at 1 m, and hangs it on the AC-130's
    howitzer, the Stryker's gun and DC Final's AH-64 nose. The game draws the
    pane for the gunner whose eye is at it, and nothing to anyone else. The
    geometry name carries no `1P` tell, so the ordinary export took the near
    rung as it does a building's interior (70 m and up, where near is right)
    and the viewer drew a green pane in front of every parked AH-64.

    No third-person view comes that close: a chase camera sits at least 1.2
    bounding radii off the hull (CVM-2). Every vanilla, XPack1 and XPack2
    selector this short already names a `1P_` mesh (the B17's guns at 1 m, the
    SCUD-B's wheel at 2 m), and every other one there is 10 m or longer.

    Only a LodObject none of whose alternatives is named first person
    qualifies. Where one is, the name keeps deciding, as it always has:
    `ranks_by_distance` found eight steering and cockpit selectors authored
    far-rung first (EoD's Katyusha puts a meshless `KatyushaLowSteering`
    ahead of its `1P_` wheel at 2 m), and the name picks the wheel whatever
    the order says.
    """
    if not template.is_lod_selector or len(template.children) < 2:
        return False
    selector = library.selector(template.lod_selector)
    if (selector is None or not selector.ranks_by_distance
            or not selector.distances
            or selector.distances[0] > NEAR_RUNG_FIRST_PERSON_M):
        return False
    return not any(
        geometry_is_first_person(child.geometry)
        for ref in template.children
        if (child := library.object(ref.template)) is not None)


def _alternatives_draw_alike(library: con_mod.ObjectLibrary,
                             a: con_mod.ChildRef, b: con_mod.ChildRef) -> bool:
    """Whether two alternatives of one LodObject put the same thing on screen:
    one template twice (DC's Humvee, Ural and CIWS name their exterior on both
    sides), two childless templates placed alike that draw one geometry (the
    UH-60's fuselage), or two that draw nothing wherever they sit (the
    M-109's two empty halves)."""
    if a.template.lower() == b.template.lower():
        return a.position == b.position and a.rotation == b.rotation
    first, second = library.object(a.template), library.object(b.template)
    if first is None or second is None or first.children or second.children:
        return False
    if all(not t.geometry or t.invisible for t in (first, second)):
        return True
    return ((first.geometry or "").lower() == (second.geometry or "").lower()
            and first.invisible == second.invisible
            and a.position == b.position and a.rotation == b.rotation)


def inside_view_alternative(library: con_mod.ObjectLibrary,
                            template: con_mod.ObjectTemplate,
                            ) -> con_mod.ChildRef | None:
    """The alternative a LodObject shows only in the Inside view, or None.

    The Inside view flips a cockpit by its selector's class and nothing else:
    `lodObjectOn` (lnxded 0x081adbb0) sets the compare value of a
    `DistCompareSelector` to 1, the other views set it to 0 (ledger LOD-2),
    and `LodObject::getChild` draws whatever alternative that names, whatever
    its geometry is called (LOD-1). Desert Combat calls its interiors
    `F16_1P`, `AH64_1p`, `Mig29_Cockpit`, `M2A3_Interior`, and vanilla its
    Kubelwagen's `Kubelwagen_1P_M1`; none starts `1P`, so a name test left
    every one of them drawing the exterior around the camera.

    `lodObjectOn` flips only the first such LodObject its search meets below
    the seat's PlayerControlObject (`internalFindFirstChildOfCID` 0x080b71a0:
    declaration order, a nested PlayerControlObject ends the walk, and a
    LodObject of another kind is searched through the alternative it shows).
    Simulated over every seat of vanilla, XPack1, XPack2, DC, DC Final and
    EoD, that is the only one in the seat's scope wherever this rule decides,
    so every one is taken here.

    Where an alternative is named first person the name keeps deciding, as it
    always has: on 36 of vanilla's 38 such selectors the name and the
    selector pick the same alternative, and the M3A1 and the Priest name
    both. A swap
    between two alternatives that draw alike changes nothing on screen and is
    not one (`_alternatives_draw_alike`).
    """
    if not template.is_lod_selector or len(template.children) < 2:
        return None
    selector = library.selector(template.lod_selector)
    if selector is None or not selector.flips_in_inside_view:
        return None
    inside = selector.compared_alternative(1.0)
    outside = selector.compared_alternative(0.0)
    children = template.children
    if inside == outside or max(inside, outside) >= len(children):
        return None
    if any(geometry_is_first_person(child.geometry)
           for ref in children
           if (child := library.object(ref.template)) is not None):
        return None
    if _alternatives_draw_alike(library, children[inside], children[outside]):
        return None
    return children[inside]


def alternative_is_first_person(library: con_mod.ObjectLibrary,
                                lod_template: con_mod.ObjectTemplate,
                                ref: con_mod.ChildRef) -> bool:
    """Whether one alternative of a LodObject is its first-person half.

    Either its geometry is named first person (`geometry_is_first_person`),
    or it is the near rung of a selector too short for any third-person camera
    (`near_rung_is_first_person`), or the Inside view is what selects it
    (`inside_view_alternative`).
    """
    child = library.object(ref.template)
    if geometry_is_first_person(child.geometry if child else None):
        return True
    if ref is inside_view_alternative(library, lod_template):
        return True
    return (bool(lod_template.children) and ref is lod_template.children[0]
            and near_rung_is_first_person(library, lod_template))


def reaches_first_person(library: con_mod.ObjectLibrary, template_name: str, *,
                         depth: int = 0,
                         stack: frozenset[str] = frozenset()) -> bool:
    """Whether anything below this template carries first-person geometry.

    Every LodObject alternative counts, not the one a configuration would
    select: the whole point of a cockpit export is to take the branch the
    ordinary walk refuses.
    """
    if depth > 24:
        return False
    template = library.object(template_name)
    if template is None or template.invisible:
        return False
    if geometry_is_first_person(template.geometry):
        return True
    if near_rung_is_first_person(library, template):
        return True
    if inside_view_alternative(library, template) is not None:
        return True
    key = template.name.lower()
    if key in stack:
        return False
    stack = stack | {key}
    return any(
        (name := con_mod.instance_template_name(ref, library.object))
        and reaches_first_person(library, name, depth=depth + 1, stack=stack)
        for ref in template.children
    )


_DRIVETRAIN_INPUTS = frozenset({"c_PIYaw", "c_PIThrottle"})

# Declared engine speeds span 1 deg/s (DC's AH64 tail, plainly a data typo) to
# 30000 deg/s (EoD's Huey main rotor). Both are real in the sense that the
# engine integrates them, and both are useless on a screen: one never visibly
# moves, the other aliases into noise — in game the blurred-disc LOD has taken
# over long before that (`CompareSelector` swaps `..PropellerStatic` for
# `..PropellerBlurred` at engine input ~0.07). The declared numbers were never
# meant to be watched at full throttle either: nearly every propeller aircraft
# across the installed mods declares 400–1250 deg/s (vanilla planes all say
# 500–600), barely 1.5 rev/s — idle windmilling, not a running engine. The
# baked clip therefore scales every Engine axis up ×3 (props land at 4–6
# rev/s, which reads as a propeller) and clamps into a band a 60 Hz viewer can
# show: the cap is 36 deg per 60 Hz frame, under the 45 deg/frame where a
# four-blade rotor (90-degree symmetry) starts strobing backward. Ambient
# `setContinousRotationSpeed` parts (radar dishes, windmills) never pass
# through here and keep their real speed.
SPIN_DISPLAY_SCALE = 3.0
SPIN_MIN_DEG_PER_SEC = 120.0
SPIN_MAX_DEG_PER_SEC = 2160.0

# Gap 11: the swap distance of every LOD slot a geometry's `.con` does not
# name with `GeometryTemplate.setLodDistance`. The `.sm` carries no distances
# (standardmesh-vertex-format.md), so an undeclared slot keeps what the
# template constructor wrote: `StandardMeshTemplate` ctor 0x005b5b40 fills the
# ten-slot table at +0xd8 (the one `StandardMesh_selectLod` 0x005adfd0 reads)
# with 0, 150, 300, ... 1350. `setLodDistance` overwrites single slots, so a
# partial declaration keeps the defaults around it.
DEFAULT_LOD_DISTANCES = tuple(150.0 * i for i in range(10))

# The client does not keep every level a `.sm` ships. `readLods` 0x005b54e0
# stops building LODs after the first one whose LAST material has fewer than
# this many vertices (`readMaterials` 0x005b42d0 leaves the descriptor's vertex
# count in DAT_009ab664; template vt+0xac is a constant false for StandardMesh,
# so nothing exempts it), resizes the LOD vector to what it kept, and — when
# that cut the chain and kept more than LOD 0 — moves the chain's final
# distance onto the last kept level (0x005b55b6..0x005b55c6).
RETAIL_LOD_MIN_VERTICES = 100


def retail_lod_chain(lods) -> int:
    """How many of a `.sm`'s levels the client keeps, counted from LOD 0."""
    last_vertices = 9999999          # DAT_009ab664's reset value
    for index, lod in enumerate(lods):
        if lod.materials:
            last_vertices = lod.materials[-1].vertex_count
        if last_vertices < RETAIL_LOD_MIN_VERTICES:
            return index + 1
    return len(lods)


def geometry_scale(template: con_mod.GeometryTemplate | None
                   ) -> tuple[float, float, float] | None:
    """A geometry's `GeometryTemplate.scale`, or None when it draws at 1/1/1.

    StandardMesh only. A TreeMesh or AnimatedMesh template takes the word too
    (`TreeMeshTemplate::setScale`, lnxded 0x083be010), and other mods write it
    on one (FH's and bf1918's hedgerow TreeMeshes, FHSW's Panzer track
    AnimatedMeshes, SM-13), but what those setters do is unread, so those
    paths still draw the file's size.
    """
    if template is None or template.kind.lower() != "standardmesh":
        return None
    scale = template.scale
    if scale is None or all(component == 1.0 for component in scale):
        return None
    return scale


def scale_standard_mesh(mesh: stdmesh.StandardMesh,
                        scale: tuple[float, float, float] | None,
                        ) -> stdmesh.StandardMesh:
    """`mesh` with its geometry's `GeometryTemplate.scale` baked into the vertices.

    The scale belongs to the geometry, not to the object that draws it: the
    mesh instance keeps it (`BStandardMesh::setScale`, lnxded 0x083b4640) and
    draws through `diag(scale) * world` with the translation put back
    (`BStandardMesh::scale`, 0x083b47d0), so it scales the mesh in its own axes
    and never the object's child parts. A ray or a body probing the mesh is
    scaled the same way: `BStandardMesh::getDistanceToGeometry` (0x083b4fd0)
    hands the scale to `SimpleCollisionMesh::getDistanceToGeometry`
    (0x083c9f70), which divides the query into the file's frame and multiplies
    the hit back out (SM-13). So both the drawn levels and the collision
    layers carry it; normals take the inverse scale, renormalised. The
    instance's bounding box does not, so a ladder's climb measure reads the
    file (`_ladder_spec_for`).
    """
    if scale is None:
        return mesh
    sx, sy, sz = scale

    def material(m: stdmesh.Material) -> stdmesh.Material:
        step = m.engine_stride // 4
        values = list(m.vertices)
        if len(values) < step * m.vertex_count:
            values += [0.0] * (step * m.vertex_count - len(values))
        position, normal = m.component("position"), m.component("normal")
        for i in range(m.vertex_count):
            if position is not None:
                p = i * step + position.offset // 4
                values[p] *= sx
                values[p + 1] *= sy
                values[p + 2] *= sz
            if normal is not None and 0.0 not in scale:
                n = i * step + normal.offset // 4
                nx, ny, nz = values[n] / sx, values[n + 1] / sy, values[n + 2] / sz
                length = (nx * nx + ny * ny + nz * nz) ** 0.5
                if length > 0.0:
                    values[n:n + 3] = nx / length, ny / length, nz / length
        return replace(m, vertices=values)

    return replace(
        mesh,
        bounds_min=(mesh.bounds_min[0] * sx, mesh.bounds_min[1] * sy,
                    mesh.bounds_min[2] * sz),
        bounds_max=(mesh.bounds_max[0] * sx, mesh.bounds_max[1] * sy,
                    mesh.bounds_max[2] * sz),
        collision_layers=[
            replace(layer, vertices=[(x * sx, y * sy, z * sz)
                                     for x, y, z in layer.vertices])
            for layer in mesh.collision_layers],
        lods=[replace(lod, materials=[material(m) for m in lod.materials])
              for lod in mesh.lods],
    )


def engine_spin_axes(template: con_mod.ObjectTemplate) -> dict[str, float]:
    """Axes an Engine visibly spins, as display deg/s — or an empty dict.

    Two declaration styles occur in shipped data:

    * a rate span (`-3000..5000`, every vanilla aircraft): `rig()` already
      classifies the axis as an accumulator;
    * no usable span at all (EoD helicopter tail rotors declare `100/100`,
      vanilla aircraft simply declare no limits), where being bound to
      `c_PIThrottle` is the tell.

    That second case used to be spelled `spec["free"]`, which worked only
    while `rig()` called a zero-WIDTH range free. GUN-2 corrected that gate to
    "both bounds are zero" (a `100/100` axis is pinned at 100 by the engine,
    not spun), so the degenerate-span tell is now asked for in its own terms:
    an axis whose two bounds are equal, whether that is because they are both
    zero or because the author wrote the same number twice.

    Tank Engines bind roll to throttle too, but over a +/-1 degree body-lean
    span — neither rate nor free, so they never land here (spinning the hull
    lean spins the whole running gear, which is the bug this predicate exists
    to avoid).
    """
    if template.kind.lower() != "engine":
        return {}
    rig = template.rig()
    if not rig:
        return {}
    axes: dict[str, float] = {}
    for axis, spec in rig["axes"].items():
        degenerate = spec["free"] or spec["min"] == spec["max"]
        if spec["driver"] == "rate" or (degenerate and spec["input"] == "c_PIThrottle"):
            declared = abs(spec.get("maxSpeed") or 0.0) or 360.0
            axes[axis] = min(max(declared * SPIN_DISPLAY_SCALE, SPIN_MIN_DEG_PER_SEC),
                             SPIN_MAX_DEG_PER_SEC)
    return axes


def browse_rig(template: con_mod.ObjectTemplate, *,
               has_visible_springs: bool) -> dict | None:
    """The rig to put on a browse model, or None.

    Hidden land wheels leave boat helm/throttle RotationalBundles bound to
    steer and throttle with nothing the viewer can usefully pose — unless the
    vehicle still has visible Springs (Willy). Aircraft Engines keep throttle
    even without springs; that is the propeller, not a lever.

    The same exemption covers every physics class, for the same reason and one
    more: a `Wing` bound to `c_PIYaw` is a rudder, and on a ship it is the
    entire steering model (`Fletcher_rudder`: `setWingLift 0`,
    `setFlapLift 2`, +/-25 degrees at 15 deg/s). Filtering that out leaves a
    destroyer's `extras.physics` saying how hard the rudder pushes and never
    how far it turns. In vanilla this reaches only parts that had no node at
    all before — the twelve already-exported Wings the filter can touch are
    all aircraft rudders, and every vanilla aircraft has visible wheel
    Springs, so the branch never fires on them.
    """
    rig = template.rig()
    if not rig:
        return None
    if has_visible_springs or template.kind.lower() in con_mod.PHYSICS_TEMPLATE_KINDS:
        return rig
    axes = {
        axis: spec for axis, spec in rig["axes"].items()
        if spec["input"] not in _DRIVETRAIN_INPUTS
    }
    if not axes:
        return None
    return {**rig, "axes": axes}


@dataclass
class Report:
    root: str
    configuration: str
    lod: int
    first_person: bool = False
    parts: int = 0
    triangles: int = 0
    missing_geometry_templates: list[str] = field(default_factory=list)
    missing_meshes: list[str] = field(default_factory=list)
    missing_shaders: list[str] = field(default_factory=list)
    missing_textures: list[str] = field(default_factory=list)
    resolved_textures: dict[str, str] = field(default_factory=dict)
    unresolved_templates: list[str] = field(default_factory=list)
    skipped_lod_alternatives: list[str] = field(default_factory=list)
    # Children dropped because they are bound to a skeleton their parent
    # cannot pose — the soldier's parachute. See `is_foreign_skeleton_part`.
    skipped_foreign_skeletons: list[str] = field(default_factory=list)
    selected_lod_alternatives: list[str] = field(default_factory=list)
    # Cockpit exports only: which LodObject node each 1P alternative grafts
    # onto, and what it hides there.
    cockpit_swaps: list[str] = field(default_factory=list)
    # Third-person exports only: which LodObject kept both propeller meshes
    # instead of picking one, and the throttle threshold a viewer swaps at.
    propeller_blurs: list[str] = field(default_factory=list)
    # Per unique `.sm`: selected/available level counts, and (Gap 11) the
    # levels actually emitted as sibling meshes plus their triangle counts.
    mesh_lods: dict[str, dict] = field(default_factory=dict)
    part_tree: list[str] = field(default_factory=list)
    rigged_parts: list[str] = field(default_factory=list)
    animated_parts: list[str] = field(default_factory=list)
    cameras: list[str] = field(default_factory=list)
    seats: list[str] = field(default_factory=list)
    # One line per node carrying an `extras.skeletonIK` block: which bone, and
    # which child node's live pose the offsets are measured from.
    skeleton_ik: list[str] = field(default_factory=list)
    # One line per SupplyDepot / PlayerControlObject-with-a-hud-block node,
    # the same glance-able convention as `seats`/`physics_parts` above.
    supply_depots: list[str] = field(default_factory=list)
    vehicle_hud: list[str] = field(default_factory=list)
    # One line per child ObjectSpawner resolved to its held vehicle
    # (`Enterprise_corsairSpawner -> corsair`), in declaration order.
    held_spawners: list[str] = field(default_factory=list)
    # One line per node carrying an `extras.isLadder` block (Gap 16): the
    # template, its up-axis length and across-rungs width.
    ladders: list[str] = field(default_factory=list)
    # One line per part carrying an `extras.physics` block, so a glance at the
    # report says whether a vehicle came out simulatable or came out scenery.
    physics_parts: list[str] = field(default_factory=list)
    skinned_parts: list[str] = field(default_factory=list)
    bound_parts: list[str] = field(default_factory=list)
    unreadable_skeletons: list[str] = field(default_factory=list)
    collision_parts: int = 0
    collision_triangles: int = 0
    collision_materials: list[int] = field(default_factory=list)
    collision_makeup: list[str] = field(default_factory=list)
    armor: dict = field(default_factory=dict)
    fire_arms: list[str] = field(default_factory=list)
    # HandFireArms only: magazine, optic, deviation and recoil, straight off
    # the root template. See `ObjectTemplate.weapon_stats`.
    weapon: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "root": self.root,
            "configuration": self.configuration,
            "lod": self.lod,
            "firstPerson": self.first_person,
            "parts": self.parts,
            "triangles": self.triangles,
            "missingGeometryTemplates": sorted(set(self.missing_geometry_templates)),
            "missingMeshFiles": sorted(set(self.missing_meshes)),
            "materialsWithoutShader": sorted(set(self.missing_shaders)),
            "texturesNotFound": sorted(set(self.missing_textures)),
            "texturesResolved": dict(sorted(self.resolved_textures.items())),
            "unresolvedTemplates": sorted(set(self.unresolved_templates)),
            "lodAlternativesSkipped": sorted(set(self.skipped_lod_alternatives)),
            "lodAlternativesSelected": self.selected_lod_alternatives,
            "cockpitSwaps": self.cockpit_swaps,
            "propellerBlurs": self.propeller_blurs,
            "meshLods": dict(sorted(self.mesh_lods.items())),
            "partTree": self.part_tree,
            "riggedParts": self.rigged_parts,
            "animatedParts": self.animated_parts,
            "cameras": self.cameras,
            "seats": self.seats,
            "skeletonIk": self.skeleton_ik,
            "supplyDepots": self.supply_depots,
            "vehicleHud": self.vehicle_hud,
            "heldSpawners": self.held_spawners,
            "ladders": self.ladders,
            "physicsParts": self.physics_parts,
            "skinnedParts": self.skinned_parts,
            "boundParts": self.bound_parts,
            "skeletonsNotRead": sorted(set(self.unreadable_skeletons)),
            "collisionParts": self.collision_parts,
            "collisionTriangles": self.collision_triangles,
            "collisionMaterials": sorted(set(self.collision_materials)),
            "collisionFromOtherLod": sorted(set(self.collision_makeup)),
            "armor": self.armor,
            "fireArms": self.fire_arms,
            "weapon": self.weapon or None,
        }


def is_foreign_skeleton_part(child: con_mod.ObjectTemplate,
                             parent: con_mod.ObjectTemplate) -> bool:
    """Is this child bound to a skeleton its parent cannot pose?

    The case this exists for is the soldier's parachute. `CommonSoldierData.inc`
    gives every soldier an `addTemplate Parachute`, the parachute is skinned, and
    it declares `animations/Parachute.ske` — so anything that walks a soldier's
    skinned children picks it up as a body part and bakes 13.5 m of canopy
    standing on the soldier's head, rigging fanning past the weapon.

    It only appears in bakes made after CON-1's `include`-dropping fix let that
    `.inc` reach the extractor at all (the same fix that first delivered the
    soldier's own `HitPoints 30`).

    Three values occur among a soldier's skinned children and only the third is
    foreign: the body and hands declare no skeleton, the head declares the face
    skeleton (`UsFace.ske`) and is a real part, and the parachute declares its
    own. So neither "has a skeleton" nor "differs from the parent" will do —
    the first drops the head, the second drops it too, because the face
    genuinely differs. Both were tried; the first exported a faceless soldier.

    Swept across all 15 installed mods: the only skinned soldier child matching
    this predicate is `Parachute`, in every one of them. A mod that adds a
    genuinely posable part with its own skeleton would need the same handling the
    face gets rather than being dropped here.

    A parachute feature wants this geometry back, on its own skeleton and hidden
    until the soldier is falling, rather than posed as a limb.
    """
    if not child.skeleton:
        return False
    if "face" in child.skeleton.lower():
        return False
    if parent.skeleton and child.skeleton.lower() == parent.skeleton.lower():
        return False
    return True


def _armor_effect_offset(offset: tuple[float, float, float]) -> list[float]:
    """An `addArmorEffect` attach offset, converted to the space the glb is in.

    Refractor is left-handed and glTF is not, so `gltf.py` negates Z on every
    position, normal and **node translation** it writes. `extras` are passed
    through verbatim, which means an authored vector shipped as data has to make
    the same trip itself or it lands mirrored down the vehicle's long axis — a
    Sherman authors its engine smoke at Z -1.8, and without this the smoke pours
    out of the bonnet instead of the engine deck. Same reason
    `animatedTextureSpeed` negates its U above.
    """
    x, y, z = offset
    return [x, y, -z]


# Gap 16 (`features/ladder-climbing/README.md`): how a ladder's geometry is
# read into the spec a viewer climbs by. The `.con` carries no ladder words
# beyond the collision group, so the shape comes from the mesh itself:
#
#   * the UP axis is the longest extent of the bounding box — a ladder is by
#     construction the one long thin thing on its own template — expressed in
#     glTF space (the exporter's Z mirror applies to directions as to points);
#   * LENGTH is the extent along that axis, BOTTOM and TOP are the box's centre
#     line ends (the axis coordinate at its min and max, the two perpendicular
#     coordinates at the centre, so the climbed line is the middle of the
#     rungs, not a box corner);
#   * WIDTH is the larger of the two perpendicular extents — across the rungs;
#   * FACE is the unit vector along the *smaller* perpendicular extent — the
#     ladder plane's own normal, the direction a climbing soldier stands off
#     in. Its sign is arbitrary until someone grabs the ladder, when the
#     viewer orients it toward the side the soldier approached from.
#
# A degenerate box (a missing or single-point mesh) yields None, which is
# cached like any other reading rather than re-derived per placement.
def ladder_spec_from_positions(
        positions: list[tuple[float, float, float]]) -> dict | None:
    """`extras.isLadder` for one mesh's vertex cloud, or None."""
    if not positions:
        return None
    lo = [min(p[i] for p in positions) for i in range(3)]
    hi = [max(p[i] for p in positions) for i in range(3)]
    extents = [hi[i] - lo[i] for i in range(3)]
    axis = max(range(3), key=lambda i: extents[i])
    length = extents[axis]
    if length <= 0.0:
        return None
    others = [i for i in range(3) if i != axis]
    width = max(extents[i] for i in others)
    face = min(others, key=lambda i: extents[i])
    centre = [(lo[i] + hi[i]) * 0.5 for i in range(3)]
    bottom = list(centre)
    bottom[axis] = lo[axis]
    top = list(centre)
    top[axis] = hi[axis]
    # The viewer climbs in glTF space, and the exporter mirrors Refractor's Z
    # on every vertex — the box's bottom and top go through the same mirror.
    bottom[2], top[2] = -bottom[2], -top[2]

    def unit_axis(index: int) -> list[float]:
        vector = [0.0, 0.0, 0.0]
        vector[index] = 1.0
        return [vector[0], vector[1], -vector[2]]

    def rounded(point: list[float]) -> list[float]:
        return [round(value, 4) for value in point]

    return {
        "axis": unit_axis(axis),
        "length": round(length, 4),
        "bottom": rounded(bottom),
        "top": rounded(top),
        "width": round(width, 4),
        "face": unit_axis(face),
    }


# --- which hulls the engine tests (ledger COL-16..COL-18) ----------------------
#
# `hasCollisionPhysics` becomes object flag 0x200 in the object's constructor
# and nowhere else, and it defaults off (COL-16). The broadphase keeps a ROOT
# only when it carries 0x200, so a root that never says 1 is passed through by
# everything that moves, rounds included, and nothing under it collides. A part
# joins its root's test only when it carries 0x200 itself (COL-17). The root is
# tested with its own mesh or, lacking one, the LOD-0 mesh it borrows (COL-18):
# that is how a house collides, a geometry-less `Bundle` saying 1 over a
# LodObject whose detailed alternative declares nothing.

# Not passed: the node is an engine root, and its scope is worked out there.
_UNSCOPED = object()


@dataclass(frozen=True)
class CollisionScope:
    """One engine root's collision rule. `lent` is the lower-case name of the
    template whose geometry a geometry-less root borrows (COL-18)."""
    collides: bool
    lent: str | None = None


# A LodObject alternative the engine never tests: nothing under it collides.
_NEVER_TESTED = CollisionScope(collides=False)


def _child_template(library: con_mod.ObjectLibrary, ref: con_mod.ChildRef):
    """The object an `addTemplate` makes, hidden or not: the engine creates
    every child, whatever the exporter later chooses to draw."""
    found = library.object(ref.template)
    if found is None and ref.random_geometries:
        found = library.object(f"{ref.template}1")
    return found


def lent_lod_template(library: con_mod.ObjectLibrary,
                      root: con_mod.ObjectTemplate):
    """The template whose geometry a root with none borrows, or None.

    `findLodGeometry` (lnxded 0x0818d860): when the first child is a LodObject,
    its highest LOD, which is its first alternative (`LodObject::getChild`
    0x08216ce0 under `m_forceHighestLod`). Failing that, the first LodObject
    with a `DistCompareSelector` found depth-first under the root, first child
    before next sibling, where a PlayerControlObject ends the search along its
    sibling chain (`internalFindChildOfLodSelectorCID` 0x0818db50). Either way
    only an alternative that names a geometry lends one.
    """
    def first_alternative(lod):
        alternative = (_child_template(library, lod.children[0])
                       if lod.children else None)
        return alternative if alternative is not None and alternative.geometry else None

    first = _child_template(library, root.children[0]) if root.children else None
    if first is not None and first.is_lod_selector:
        lent = first_alternative(first)
        if lent is not None:
            return lent

    def children_of(node):
        # A LodObject's child, to this walk, is the alternative it holds; the
        # first stands for it, as in the chain build.
        refs = node.children[:1] if node.is_lod_selector else node.children
        return [_child_template(library, ref) for ref in refs]

    def search(nodes, depth: int):
        for node in nodes:
            if node is None or depth > 32:
                continue
            if node.kind.lower() == "playercontrolobject":
                return None
            selector = library.selector(node.lod_selector) if node.is_lod_selector else None
            if selector is not None and selector.flips_in_inside_view:
                return node
            found = search(children_of(node), depth + 1)
            if found is not None:
                return found
        return None

    lod = search(children_of(root), 0)
    return first_alternative(lod) if lod is not None else None


def keeps_old_collision_rule(template: con_mod.ObjectTemplate) -> bool:
    """A vehicle or gun, or a projectile: the subtree keeps every hull.

    A PlayerControlObject's collision has not been moved over to the engine's
    rule yet (features/dc-engine-reads §3). A projectile's template constructor
    sets `hasCollisionPhysics` itself (`ProjectileTemplate()` ORs 0x0f into
    +0x70, lnxded 0x0831faa9), and `con.py` cannot tell that default from an
    unset word on another class.
    """
    return template.kind.lower() in ("playercontrolobject", "projectile")


def collision_scope_for(library: con_mod.ObjectLibrary,
                        root: con_mod.ObjectTemplate) -> CollisionScope | None:
    """The collision rule for everything under the engine root `root`, or
    None where the old rule stands (`keeps_old_collision_rule`)."""
    if keeps_old_collision_rule(root):
        return None
    lent = None
    if root.has_collision_physics and not root.geometry:
        borrowed = lent_lod_template(library, root)
        lent = borrowed.name.lower() if borrowed is not None else None
    return CollisionScope(collides=root.has_collision_physics, lent=lent)


class Assembler:
    def __init__(self, meshes: ArchivePool, textures: ArchivePool,
                 objects: ArchivePool, library: con_mod.ObjectLibrary, *,
                 lod: int = 0, max_texture: int = 1024,
                 configuration: str = "complex",
                 include_collision: bool = True,
                 include_effects: bool = True,
                 first_person: bool = False,
                 lod_chains: bool = False,
                 lightmaps: dict[tuple[str, int, int, int], str] | None = None):
        if configuration not in con_mod.MODEL_CONFIGURATIONS:
            raise ValueError(f"unknown model configuration: {configuration}")
        self.meshes = meshes
        self.textures = textures
        self.objects = objects
        self.library = library
        self.lod = lod
        self.max_texture = max_texture
        self.configuration = configuration
        self.include_collision = include_collision
        # Muzzle flashes, shell ejects, tracer streaks and projectile bodies
        # are baked hidden mesh nodes a viewer plays on demand (gunfire.js,
        # flight.js) — off by default would be wrong for any export those
        # simulations load. A pose export is never one of them: poses.html has
        # no fire simulation to hide the nodes for, so it opts out and gets a
        # clean weapon instead. Non-mesh firing stats (magazine size, damage,
        # tracer interval, ...) still ride the extras either way.
        self.include_effects = include_effects
        # A cockpit export: take the first-person branch at every LodObject that
        # has one, keep only the geometry authored for a camera inside the
        # vehicle, and prune everything else away. The result is meant to be
        # grafted onto an ordinary export of the same template, not viewed on
        # its own — see `geometry_is_first_person` for why the two cannot share
        # one file.
        self.first_person = first_person
        # Gap 11: ship each StandardMesh's kept LOD levels as `<mesh>_lod<N>`
        # rung nodes under the part (`extras.lod`). Only a level bake asks for
        # them, because only the level loader swaps them by distance
        # (`liftLods` in viewer/level-statics.js). Every other consumer of an
        # export (the model browser and its thumbnails, cockpit grafts, wrecks,
        # soldiers, replays, kits, poses, viewmodels) draws every mesh node it
        # is given, so a rung there is a second copy of the part drawn on top
        # of LOD 0.
        self.lod_chains = lod_chains
        self.lightmaps = lightmaps or {}
        # Multiply a material's texture by its `.rs` `materialDiffuse`. Off for
        # the model and map exports, whose lighting is calibrated on white
        # (ledger DL-3); on for the effect library, where the decals' 0.388 grey
        # is the difference between a bullet hole and a pale smudge.
        self.apply_material_diffuse = False
        # Carry an additive shader's `alphaTestRef` into the material extras
        # (`extras.alphaTest`). Off by default so the model and level bakes are
        # untouched; `extract_effects.py` turns it on, because a muzzle flash's
        # size is its texture's alpha > 0.7 core (`MuzzHeavy_m1.rs`), not its
        # soft halo (features/muzzle-effects-parity).
        self.additive_alpha_test = False
        # The engine's one round-robin counter for `setRandomGeometries`
        # children (`world::randomCounter`, ledger KIT-2: starts at 1, `inc`,
        # back to 1 past N, never reset, shared by every rolled child). None
        # builds variant 1 throughout, as every model export does; a level bake
        # (`extract_map.level_assembler`) sets it to 1, so each placed Lada or
        # Pickup rolls its own paint in placement order.
        self.random_counter: int | None = None
        self._visible_springs = True
        self._shader_cache: dict[str, dict[str, rs.Shader]] = {}
        self._texture_cache: dict[str, int | None] = {}
        # Per texture path: does it carry a texel of alpha 0 that the engine's
        # default alpha test (`ENGINE_ALPHA_FLOOR`) would drop.
        self._texture_cutout: dict[str, bool] = {}
        self._material_cache: dict[tuple, int] = {}
        self._geom_mesh: dict[str, tuple[int | None, int]] = {}
        # Gap 16: per geometry, the ladder spec (`extras.isLadder`) derived
        # from the mesh bounds — axis, length, bottom/top, face. Shared by
        # every placement of the geometry; `None` caches a non-ladder reading.
        self._geom_ladder: dict[str, dict | None] = {}
        # Gap 11: per geometry, the LOD rungs emitted below LOD 0 as
        # `[(level, mesh index), ...]` plus the distance table used. Shared by
        # every placement of the geometry; read by `_lod_children_for`.
        self._geom_lod_chain: dict[str, tuple[list[tuple[int, int]], list[float]]] = {}
        self._geom_collisions: dict[str, list[tuple[int, int, str]]] = {}
        # Face counts per geometry, for ranking a LodObject's alternatives
        # against each other before any of them is built.
        self._geom_collision_faces: dict[str, int] = {}
        # A geometry's `.sm` header box, for a full body's drag (`_geometry_box`).
        self._geom_boxes: dict[str, list[float] | None] = {}
        self._collision_material_cache: dict[int, int] = {}
        self._first_person_reach: dict[str, bool] = {}
        self._skin_cache: dict[str, skin.Skin | None] = {}
        self._skeleton_cache: dict[str, ske.Skeleton | None] = {}
        self._flag_clip_cache: dict[str, object] = {}
        self._sprite_mesh_cache: dict[str, int | None] = {}
        # Spin keyframe specs gathered during the tree walk; `export` bakes
        # them into glTF animation clips against its own builder. A caller
        # that drives `build_node` with an external builder (the level
        # exporter) brackets its own pass with `begin_animations` /
        # `flush_animations`.
        self._spin_tracks: list[dict] = []

    # -- shaders ------------------------------------------------------------ #

    def _shaders_for(self, mesh_file: str, geometry_name: str) -> dict[str, rs.Shader]:
        """Per-object `Art/*.rs` first, then the mesh's own `StandardMesh/*.rs`."""
        key = f"{geometry_name}|{mesh_file}"
        if key in self._shader_cache:
            return self._shader_cache[key]

        merged: dict[str, rs.Shader] = {}
        default = self.meshes.resolve_ext(f"standardMesh/{mesh_file}", (".rs",))
        if default:
            merged.update(rs.parse(self.meshes.read(default).decode("latin-1")))

        art_dir = self.library.art_dir(geometry_name)
        if art_dir:
            override = self.objects.resolve_ext(f"{art_dir}/{mesh_file}", (".rs",))
            if override:
                merged.update(rs.parse(self.objects.read(override).decode("latin-1")))

        self._shader_cache[key] = merged
        return merged

    # -- textures ----------------------------------------------------------- #

    @staticmethod
    def _bleed_alpha(width: int, height: int, rgba: bytes, passes: int = 0) -> bytes:
        """Dilate opaque colour into transparent texels.

        Alpha-tested foliage stores nothing useful in the RGB of its cut-away
        texels, and several vanilla leaf maps leave that RGB pure black
        (`KE_leaf_T` transparent mean 0/0/0 against an opaque leaf of 58/49/30;
        `KE_leaf2_T` is bled properly and looks right, which is why only some
        vegetation went dark). Nothing samples a texel's alpha in isolation:
        bilinear filtering mixes neighbours at every leaf edge and each mip
        level averages four texels of the level above, so that black is pulled
        into the visible colour and grows with distance until a shrub is a
        black blob. Bleeding costs nothing at run time and is invisible where
        the RGB was already sensible.

        The whole image has to be filled, not a border around the leaves. Three
        quarters of a leaf map is cut away, so the small mips - the ones a
        distant shrub actually samples - average mostly transparent texels, and
        a dilation stopped after a few rings leaves that interior black. A
        breadth-first flood outward from the opaque texels fills every texel in
        one linear pass instead, which is also what makes it cheap enough to run
        over every texture in a level.

        Only texels that are genuinely cut away (alpha below
        ``BLEED_CUTOUT_ALPHA``) may be overwritten. Alpha is NOT a cutout mask
        on every texture: opaque `_I` vehicle skins store specular/reflectivity
        there (the F4U fuselage spans alpha 119-254), and the first version of
        this pass seeded only from alpha>=250 and flood-filled everything else,
        which erased whole aircraft liveries into flat bled colour. Foliage
        backgrounds sit at alpha~0, so the low threshold still catches them.
        """
        alpha = range(3, len(rgba), 4)
        if not any(rgba[i] < BLEED_CUTOUT_ALPHA for i in alpha):
            return rgba
        out = bytearray(rgba)
        queue = [i for i, a in enumerate(range(3, len(out), 4))
                 if out[a] >= BLEED_CUTOUT_ALPHA]
        if not queue:
            return bytes(out)
        seen = bytearray(width * height)
        for index in queue:
            seen[index] = 1
        head = 0
        while head < len(queue):
            index = queue[head]
            head += 1
            x, y = index % width, index // width
            src = index * 4
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < width and 0 <= ny < height):
                    continue
                j = ny * width + nx
                if seen[j]:
                    continue
                seen[j] = 1
                dst = j * 4
                out[dst] = out[src]
                out[dst + 1] = out[src + 1]
                out[dst + 2] = out[src + 2]
                queue.append(j)
        return bytes(out)

    def _texture_index(self, builder: gltf.GlbBuilder, path: str, report: Report) -> int | None:
        if path in self._texture_cache:
            return self._texture_cache[path]

        found = self.textures.resolve_ext(path, TEXTURE_EXTS)
        if not found:
            report.missing_textures.append(path)
            self._texture_cache[path] = None
            return None

        raw = self.textures.read(found)
        try:
            if found.lower().endswith(".dds"):
                width, height, rgba = decode_dds(raw)
            else:
                width, height, rgba = decode_tga(raw)
                rgba = mesh_tga_pixels(raw, width, height, rgba)
        except Exception as exc:  # a texture we cannot decode is still a miss
            report.missing_textures.append(f"{path} ({exc})")
            self._texture_cache[path] = None
            return None

        if self.max_texture and max(width, height) > self.max_texture:
            width, height, rgba = downscale(width, height, rgba, self.max_texture)

        # Read off the texels actually shipped, before the bleed (which only
        # rewrites RGB, so the answer would not change).
        self._texture_cutout[path] = 0 in rgba[3::4]

        # After any downscale, so the bleed covers the texels actually shipped.
        rgba = self._bleed_alpha(width, height, rgba)

        index = builder.add_image_png(
            encode_png(width, height, rgba, drop_alpha=False), name=found)
        report.resolved_textures[path] = f"{self.textures.source_of(found)}:{found}"
        self._texture_cache[path] = index
        return index

    def _material_index(self, builder: gltf.GlbBuilder, shader: rs.Shader | None,
                        material_name: str, report: Report,
                        unlit: bool = False,
                        emissive_floor: float = 0.0) -> int | None:
        if shader is None:
            report.missing_shaders.append(material_name)
            return None

        texture_path = shader.base_texture
        # A caller can force unlit (foliage sprites, whose normals make N.L
        # meaningless); a shader can also declare it for itself with
        # `lighting false`, which is how `TLight_m1` — the tracer streak — says
        # it is a light source rather than a lit surface.
        unlit = unlit or not shader.lighting
        diffuse = (shader.diffuse if self.apply_material_diffuse and shader.diffuse
                   else None)
        key = (texture_path, shader.twosided, shader.transparent,
               shader.alpha_test, unlit, emissive_floor, shader.additive,
               shader.texture_fade, shader.envmap, diffuse,
               self.additive_alpha_test)
        if key in self._material_cache:
            return self._material_cache[key]

        texture = self._texture_index(builder, texture_path, report) if texture_path else None
        # No `alphaTestRef` and no blend: the engine still tests alpha > 0.
        cutoff = None if shader.additive else shader.alpha_test
        if (cutoff is None and not shader.additive and not shader.transparent
                and texture is not None and self._texture_cutout.get(texture_path)):
            cutoff = ENGINE_ALPHA_FLOOR
        index = builder.add_material(
            name=shader.name,
            texture=texture,
            base_color=(*diffuse, 1.0) if diffuse else (1.0, 1.0, 1.0, 1.0),
            double_sided=shader.twosided,
            # An additive shader's alphaTestRef is a fixed-function cutoff the
            # engine applies *on top of* the blend; keeping MASK would kill the
            # flash's soft falloff, so additive wins.
            alpha_cutoff=cutoff,
            blend=shader.transparent and shader.alpha_test is None,
            unlit=unlit,
            emissive_floor=emissive_floor,
            additive=shader.additive,
            texture_fade=shader.texture_fade,
            envmap=shader.envmap,
            additive_alpha_test=(shader.alpha_test if self.additive_alpha_test
                                 and shader.additive else None),
        )
        self._material_cache[key] = index
        return index

    def material_for(self, builder: gltf.GlbBuilder, geometry_name: str,
                     material_name: str, report: Report) -> int | None:
        """Material index for one StandardMesh material, via the same
        Art-override-then-StandardMesh `.rs` chain the tree walk uses. Public
        because the posed-soldier exporter builds skinned primitives itself
        but must paint them identically."""
        geom = self.library.geometry(geometry_name)
        mesh_file = geom.mesh_file if geom else geometry_name
        shaders = self._shaders_for(mesh_file, geometry_name)
        shader = rs.lookup(shaders, material_name)
        return self._material_index(builder, shader, material_name, report)

    def _collision_material_index(self, builder: gltf.GlbBuilder,
                                  material_id: int) -> int:
        if material_id in self._collision_material_cache:
            return self._collision_material_cache[material_id]

        palette = (
            (0.76, 0.25, 0.18, 0.52),
            (0.88, 0.48, 0.16, 0.52),
            (0.88, 0.72, 0.20, 0.52),
            (0.48, 0.68, 0.25, 0.52),
            (0.18, 0.65, 0.67, 0.52),
            (0.43, 0.43, 0.78, 0.52),
        )
        index = builder.add_material(
            name=f"defense material {material_id}",
            double_sided=True,
            blend=True,
            base_color=palette[material_id % len(palette)],
        )
        self._collision_material_cache[material_id] = index
        return index

    # -- geometry ----------------------------------------------------------- #

    def _collision_mesh_indices(
            self, builder: gltf.GlbBuilder, mesh_file: str,
            mesh: stdmesh.StandardMesh, report: Report,
    ) -> list[tuple[int, int, str]]:
        selected: tuple[
            int,
            stdmesh.CollisionLayer,
            dict[int, list[stdmesh.CollisionFace]],
        ] | None = None
        for layer_index, layer in reversed(list(enumerate(mesh.collision_layers))):
            by_material: dict[int, list[stdmesh.CollisionFace]] = {}
            for face in layer.faces:
                a, b, c = (layer.vertices[i] for i in face.vertices)
                ab = tuple(b[i] - a[i] for i in range(3))
                ac = tuple(c[i] - a[i] for i in range(3))
                cross = (
                    ab[1] * ac[2] - ab[2] * ac[1],
                    ab[2] * ac[0] - ab[0] * ac[2],
                    ab[0] * ac[1] - ab[1] * ac[0],
                )
                if sum(value * value for value in cross) <= stdmesh.DEGENERATE_CROSS_SQ:
                    continue
                by_material.setdefault(face.material_id, []).append(face)
            if by_material:
                selected = (layer_index, layer, by_material)
                break

        if selected is None:
            return []

        layer_index, layer, by_material = selected
        primitives: list[gltf.Primitive] = []
        for material_id, faces in sorted(by_material.items()):
            flags = sorted({face.flags for face in faces})
            primitives.append(gltf.Primitive(
                positions=layer.vertices,
                indices=[
                    vertex
                    for face in faces
                    for vertex in face.vertices
                ],
                material=self._collision_material_index(builder, material_id),
                extras={
                    "collision": True,
                    "defenseMaterial": material_id,
                    "collisionFlags": flags,
                },
            ))
            report.collision_materials.append(material_id)

        report.collision_parts += 1
        report.collision_triangles += sum(
            len(faces) for faces in by_material.values())
        return [(
            builder.add_mesh(
                f"{mesh_file} collision {layer_index}",
                primitives,
            ),
            layer_index,
            "detailed",
        )]

    def _treemesh_collision_indices(
            self, builder: gltf.GlbBuilder, mesh_file: str,
            collision: treemesh.TreeCollision, report: Report,
    ) -> list[tuple[int, int, str]]:
        """One glTF collision mesh from a TreeMesh SimpleCollisionMesh (TM-2).

        Same `extras.collision` / `defenseMaterial` shape as StandardMesh
        statics so `viewer/collision.js` indexes palms without a special path.
        """
        layer = stdmesh.CollisionLayer(
            unknown=(0, 5),
            vertices=list(collision.vertices),
            vertex_unknown=[0.0] * len(collision.vertices),
            faces=collision.collision_faces(),
        )
        mesh = stdmesh.StandardMesh(
            name=mesh_file,
            version=5,
            bounds_min=(0.0, 0.0, 0.0),
            bounds_max=(0.0, 0.0, 0.0),
            collision_layers=[layer],
            lods=[],
        )
        return self._collision_mesh_indices(builder, mesh_file, mesh, report)

    def _parse_treemesh_collision(
            self, mesh_file: str,
    ) -> treemesh.TreeCollision | None:
        entry = self.meshes.resolve_ext(f"treeMesh/{mesh_file}", (".tm",))
        if not entry:
            return None
        try:
            tree = treemesh.parse(self.meshes.read(entry), entry)
        except (stdmesh.MeshError, ValueError, struct.error):
            return None
        return tree.collision

    def _collision_for_geometry(self, builder: gltf.GlbBuilder,
                                geometry_name: str, report: Report,
                                ) -> list[tuple[int, int, str]]:
        """The collision hulls of a geometry, drawn or not.

        `_mesh_index` resolves collision as a side effect of building the
        render mesh, which is fine while the two always travel together. They
        do not: a building's LodObject draws its `Exterior` alternative and
        that mesh ships **no** collision at all — `afr_house1_ste_m2` has zero
        layers where `afr_house1_ste_m1` has 224 verts / 359 faces over five
        materials. The engine keeps both alternatives loaded and hangs the
        physics body off the Bundle root (`setHasCollisionPhysics 1`), so the
        hull is the object's, not the near-LOD's: a geometry-less root borrows
        its first alternative's mesh (COL-18, `lent_lod_template`).

        This is the entry point for the alternative nobody draws: it parses the
        `.sm` for its collision block only and never touches materials,
        textures or LOD triangles, so pulling a house's interior hull in does
        not also pull its interior *walls* into the glb.

        TreeMesh: the SCM lives in the `.tm` (TM-2). Callers that attach the
        result still apply the TM-5 gate (`setHasCollisionPhysics 1`); this
        method only resolves the hull when an SCM is present.
        """
        cache_key = geometry_name.lower()
        if cache_key in self._geom_collisions:
            return self._geom_collisions[cache_key]
        if not self.include_collision:
            self._geom_collisions[cache_key] = []
            return []

        template = self.library.geometry(geometry_name)
        if template is None:
            self._geom_collisions[cache_key] = []
            return []

        if template.kind.lower() == "treemesh":
            collision = self._parse_treemesh_collision(template.mesh_file)
            if collision is None or not collision.faces:
                self._geom_collisions[cache_key] = []
                return []
            result = self._treemesh_collision_indices(
                builder, template.mesh_file, collision, report)
            self._geom_collisions[cache_key] = result
            return result

        entry = self.meshes.resolve_ext(
            f"standardMesh/{template.mesh_file}", (".sm",))
        if not entry:
            self._geom_collisions[cache_key] = []
            return []
        try:
            mesh = scale_standard_mesh(stdmesh.parse(self.meshes.read(entry), entry),
                                       geometry_scale(template))
        except stdmesh.MeshError:
            self._geom_collisions[cache_key] = []
            return []
        result = self._collision_mesh_indices(
            builder, template.mesh_file, mesh, report)
        self._geom_collisions[cache_key] = result
        return result

    def _collision_triangles(self, template_name: str, depth: int = 0,
                             stack: frozenset[str] = frozenset()) -> int:
        """Collision faces reachable below a template, counting every alternative.

        Used to rank a LodObject's alternatives against each other. Cheap
        enough to run per alternative because `_collision_layer_counts` caches
        per geometry and a building's tree is a dozen nodes deep at most.
        """
        template = self.library.object(template_name)
        if template is None or depth > 16:
            return 0
        key = template.name.lower()
        if key in stack:
            return 0
        stack = stack | {key}
        total = self._collision_layer_faces(template.geometry) if template.geometry else 0
        for ref in template.children:
            child_name = con_mod.instance_template_name(ref, self.library.object)
            if child_name is not None:
                total += self._collision_triangles(child_name, depth + 1, stack)
        return total

    def _collision_layer_faces(self, geometry_name: str) -> int:
        """Faces in a geometry's richest collision layer, or 0. Cached by name."""
        cache_key = geometry_name.lower()
        if cache_key in self._geom_collision_faces:
            return self._geom_collision_faces[cache_key]
        count = 0
        template = self.library.geometry(geometry_name)
        if template is not None:
            if template.kind.lower() == "treemesh":
                collision = self._parse_treemesh_collision(template.mesh_file)
                count = collision.triangle_count if collision else 0
            else:
                entry = self.meshes.resolve_ext(
                    f"standardMesh/{template.mesh_file}", (".sm",))
                if entry:
                    try:
                        mesh = stdmesh.parse(self.meshes.read(entry), entry)
                        count = max(
                            (len(layer.faces) for layer in mesh.collision_layers),
                            default=0)
                    except stdmesh.MeshError:
                        count = 0
        self._geom_collision_faces[cache_key] = count
        return count

    def _object_emits_geometry_collision(
            self, template: con_mod.ObjectTemplate,
            scope: CollisionScope | None = None, *, root: bool = False) -> bool:
        """Whether this object template's geometry hull should be attached.

        Under an engine root's `scope` (COL-16..COL-18): nothing when the root
        does not say `hasCollisionPhysics 1`; the root's own mesh, and the
        LOD-0 mesh a geometry-less root borrows, whatever their template says;
        any other part only when it says 1 itself. A TreeMesh's SCM half
        (TM-5) is resolved when the mesh is built.

        Without a scope -- a vehicle, a gun, a projectile, anything inside
        one (`keeps_old_collision_rule`) -- the rule this exporter always had:
        every StandardMesh hull, and a tree's only when it says 1.
        """
        if not template.geometry:
            return False
        if scope is None:
            geom = self.library.geometry(template.geometry)
            if geom is not None and geom.kind.lower() == "treemesh":
                return template.has_collision_physics
            return True
        if not scope.collides:
            return False
        if root or template.name.lower() == scope.lent:
            return True
        return template.has_collision_physics

    def _collision_extras(self, template: con_mod.ObjectTemplate, layer: int,
                          role: str) -> dict:
        """`extras` of a collision node. A scaled geometry's hull is drawn
        scaled and says by how much: a body's own vertex probes read the file
        unscaled in the engine (SM-13)."""
        extras = {
            "collision": True,
            "collisionLayer": layer,
            "collisionRole": role,
            "sourceTemplate": template.name,
            "sourceGeometry": template.geometry,
        }
        if scale := geometry_scale(self.library.geometry(template.geometry)):
            extras["geometryScale"] = list(scale)
        return extras

    def _collision_only_node(self, builder: gltf.GlbBuilder, template_name: str,
                             report: Report, *, position, rotation,
                             depth: int = 0,
                             stack: frozenset[str] = frozenset(),
                             scope: CollisionScope | None = None) -> int | None:
        """A transform-faithful skeleton of a subtree carrying only its hulls.

        The undrawn LOD alternative is walked for its collision and nothing
        else: no render meshes, no materials, no FireArms, no cameras. Child
        placements are kept because they are what puts a barrack's beds and a
        hangar's crates where the player will shoot them. `scope` is the
        engine root's collision rule (`collision_scope_for`); this walk never
        starts at a root.
        """
        template = self.library.object(template_name)
        if template is None or depth > 16 or template.invisible:
            return None
        key = template.name.lower()
        if key in stack:
            return None
        stack = stack | {key}
        if keeps_old_collision_rule(template):
            scope = None

        children: list[int] = []
        if (template.geometry
                and self._object_emits_geometry_collision(template, scope)):
            for mesh_index, layer, role in (
                    self._collision_for_geometry(
                        builder, template.geometry, report)):
                children.append(builder.add_node(gltf.Node(
                    name=f"{template.name} collision {layer}",
                    mesh=mesh_index,
                    extras=self._collision_extras(template, layer, role),
                )))
        child_refs = template.children
        if template.is_lod_selector and child_refs:
            # Under a root's scope, the alternative the engine tests (COL-17).
            child_refs = ([child_refs[0]] if scope is not None
                          else [self._collision_alternative(child_refs, template)])
        for ref in child_refs:
            child_name = con_mod.instance_template_name(ref, self.library.object)
            if child_name is None:
                continue
            child = self._collision_only_node(
                builder, child_name, report,
                position=ref.position, rotation=ref.rotation,
                depth=depth + 1, stack=stack, scope=scope)
            if child is not None:
                children.append(child)
        if not children:
            return None
        return builder.add_node(gltf.Node(
            name=f"{template.name} hull",
            translation=position,
            rotation=gltf.quat_from_ypr(*rotation),
            children=children,
            extras={"collisionHull": True, "sourceTemplate": template.name},
        ))

    def _collision_alternative(self, children_refs: list[con_mod.ChildRef],
                               template: con_mod.ObjectTemplate | None = None,
                               ) -> con_mod.ChildRef:
        """The LodObject alternative that carries the object's collision hull.

        The object's WRECK is not one of them. `hasDestroyedLod 1` marks the
        last alternative as the destroyed state (`con.destroyed_alternative`),
        and grafting its hull onto the intact object fills the standing
        building with the rubble of the fallen one — Battle of Britain's
        factory, where it trapped anyone who walked in. Excluded here rather
        than at the call sites so the hull-only walk gets it too.
        """
        selector = (self.library.selector(template.lod_selector)
                    if template is not None and template.lod_selector else None)
        wreck = con_mod.destroyed_alternative(children_refs, selector)
        pool = [ref for ref in children_refs if ref is not wreck] or children_refs
        return max(
            pool,
            key=lambda ref: self._collision_triangles(
                con_mod.instance_template_name(ref, self.library.object) or ""))

    def _lod_distances_for(self, geometry_name: str,
                           template: con_mod.GeometryTemplate) -> list[float]:
        """The distance table a viewer swaps this geometry's chain by.

        The engine's own table: the constructor defaults
        (`DEFAULT_LOD_DISTANCES`) with every slot the `.con` names through
        `GeometryTemplate.setLodDistance` written over them (1,133 vanilla
        geometries declare some).
        """
        table = list(DEFAULT_LOD_DISTANCES)
        for index, metres in enumerate(template.lod_distances if template else []):
            if metres is not None and index < len(table):
                table[index] = metres
        return table

    def _lod_children_for(self, builder: gltf.GlbBuilder, geometry_name: str,
                          mesh_file: str) -> list[int]:
        """Child nodes carrying the emitted LOD rungs for one geometry.

        Emits at most one node per placement call but reuses per-geometry
        caches where glTF allows it: the rung MESH indices are shared (the
        geometry cache guarantees one buffer each), while the NODES are fresh
        per call because glTF forbids one node under many parents and a
        placement's LOD rungs are per-geometry identity, carrying no placement
        transform of their own — the viewer lifts them onto a `THREE.LOD`
        under the placement node, so they inherit its pose from there. Extras
        name the level and its swap distance
        (`extras.lod = {level, distance}`), keyed on the geometry so the
        viewer can group them.
        """
        cache_key = geometry_name.lower()
        chain = self._geom_lod_chain.get(cache_key)
        if not chain:
            return []
        rungs, distances = chain
        children: list[int] = []
        for level, mesh_index in rungs:
            children.append(builder.add_node(gltf.Node(
                name=f"{mesh_file}_lod{level}",
                mesh=mesh_index,
                extras={
                    "lod": {
                        "geometry": geometry_name,
                        "level": level,
                        "distance": (distances[level] if level < len(distances)
                                     else distances[-1]),
                    },
                },
            )))
        return children

    def _ladder_spec_for(self, geometry_name: str) -> dict | None:
        """`extras.isLadder` for one geometry's mesh, or None.

        Re-reads the `.sm` on first ask (the draw pass kept only the built
        meshes, not their vertex clouds) and caches the reading per geometry,
        `None` included, so a bundle of fifty guard towers parses
        `Ladder_10m.sm` once. A missing mesh file or a degenerate bounding box
        is a None like any other: a ladder the geometry cannot measure is
        emitted without the block rather than with a guessed one.
        """
        cache_key = geometry_name.lower()
        if cache_key in self._geom_ladder:
            return self._geom_ladder[cache_key]
        self._geom_ladder[cache_key] = None
        template = self.library.geometry(geometry_name)
        if template is None or template.kind.lower() == "treemesh":
            return None
        entry = self.meshes.resolve_ext(
            f"standardMesh/{template.mesh_file}", (".sm",))
        if not entry:
            return None
        try:
            # Unscaled on purpose: the climb reads the ladder's bounding box
            # (LADDER-3), and a mesh instance's box is the file's whatever its
            # `GeometryTemplate.scale` (SM-13). DC's Pantsyr ladder is drawn at
            # 0.65 and climbed at its full length.
            mesh = stdmesh.parse(self.meshes.read(entry), entry)
        except stdmesh.MeshError:
            return None
        if not mesh.lods:
            return None
        # The drawn rung: the same index `_mesh_index` selects, so the spec
        # describes the mesh the level actually ships.
        lod = mesh.lods[min(self.lod, len(mesh.lods) - 1)]
        positions = [p for material in lod.materials
                     for p in material.positions()]
        spec = ladder_spec_from_positions(positions)
        self._geom_ladder[cache_key] = spec
        return spec

    def _mesh_index(self, builder: gltf.GlbBuilder, geometry_name: str,
                    report: Report) -> tuple[int | None, int]:
        cache_key = geometry_name.lower()
        if cache_key in self._geom_mesh:
            return self._geom_mesh[cache_key]

        template = self.library.geometry(geometry_name)
        if template is None:
            report.missing_geometry_templates.append(geometry_name)
            self._geom_mesh[cache_key] = (None, 0)
            return None, 0

        if template.kind.lower() == "treemesh":
            mesh_index, triangles, collision = self._treemesh_index(
                builder, template.mesh_file, report)
            result = (mesh_index, triangles)
            self._geom_mesh[cache_key] = result
            # TM-5 / T1: SCM hull lands in the same extras.collision cache as
            # StandardMesh so callers that only asked for a draw mesh still
            # leave the collider available to `_collision_for_geometry`.
            if self.include_collision and cache_key not in self._geom_collisions:
                if collision is not None and collision.faces:
                    self._geom_collisions[cache_key] = (
                        self._treemesh_collision_indices(
                            builder, template.mesh_file, collision, report))
                else:
                    self._geom_collisions[cache_key] = []
            elif not self.include_collision:
                self._geom_collisions[cache_key] = []
            return result

        mesh_file = template.mesh_file
        entry = self.meshes.resolve_ext(f"standardMesh/{mesh_file}", (".sm",))
        if not entry:
            report.missing_meshes.append(mesh_file)
            self._geom_mesh[cache_key] = (None, 0)
            return None, 0

        try:
            # Drawn levels and collision alike (SM-13).
            mesh = scale_standard_mesh(stdmesh.parse(self.meshes.read(entry), entry),
                                       geometry_scale(template))
            if flagcloth.is_flag_skin(template.skin):
                mesh = self._pose_flag_cloth(mesh, template, report)
        except stdmesh.MeshError as exc:
            report.missing_meshes.append(f"{mesh_file} ({exc})")
            self._geom_mesh[cache_key] = (None, 0)
            return None, 0

        if not mesh.lods:
            report.missing_meshes.append(f"{mesh_file} (no lods)")
            self._geom_mesh[cache_key] = (None, 0)
            self._geom_collisions[cache_key] = []
            return None, 0

        selected_lod = min(self.lod, len(mesh.lods) - 1)
        lod = mesh.lods[selected_lod]
        report.mesh_lods[mesh_file] = {
            "selected": selected_lod,
            "available": len(mesh.lods),
            "collisionLayers": len(mesh.collision_layers),
            "collisionTriangles": sum(
                layer.triangle_count for layer in mesh.collision_layers),
        }
        # The mesh is already in hand, so resolve collision from it rather than
        # re-parsing through `_collision_for_geometry` — but land it in the same
        # cache, so an undrawn alternative that names the same geometry reuses
        # this result instead of emitting a second copy of the hull.
        if self.include_collision and cache_key not in self._geom_collisions:
            self._geom_collisions[cache_key] = self._collision_mesh_indices(
                builder, mesh_file, mesh, report)
        elif not self.include_collision:
            self._geom_collisions[cache_key] = []
        shaders = self._shaders_for(mesh_file, geometry_name)

        # The chain, per unique geometry: every level below the selected one
        # becomes a sibling glTF mesh (`Chain_m1_lod1`, ...) so a placement can
        # swap detail by distance. LOD 0 keeps the original mesh index under
        # its plain name — everything that names a mesh today (vehicle part
        # nodes, extras, tests) keeps reading it. A level whose material set
        # collapses to the previous one's (some mods ship identical top rungs)
        # would draw the same thing twice, so it is dropped and the emitted
        # level list is what lands on the node.
        # Emit every DISTINCT level. The signature is the per-material
        # (name, triangle count, vertex count) tuple: material names alone
        # cannot discriminate — DICE reuses one material across every level
        # of a prop (the crank ships 53/48/43/31/20/2 triangles under
        # `Material2` six times) and reorders the list between levels on
        # multi-material meshes — while counts do, and geometry that did not
        # change must not be shipped twice.
        # Only the levels the client keeps (`retail_lod_chain`): the small
        # stone bridge's LOD 0 ends on a 68-vertex material, so the game draws
        # LOD 0 at every distance — and its decimated LOD 4, one deck end
        # collapsed onto the abutment's foot, was a hole at 100 m here.
        kept = retail_lod_chain(mesh.lods)
        distances = self._lod_distances_for(geometry_name, template)
        if 1 < kept < len(mesh.lods):
            distances[kept - 1] = distances[len(mesh.lods) - 1]
        report.mesh_lods[mesh_file]["retailKept"] = kept
        emitted: list[tuple[int, int]] = []      # (lod level, mesh index)
        emitted_tris: list[int] = []
        emitted_signatures: list[tuple] = []
        # Anything but a level bake ships LOD 0 alone (`lod_chains`), and so
        # does a mesh skinned through its geometry's `.skn` (a soldier's body
        # and hands): a rung is a plain mesh, so it would stand in the bind
        # pose while the skinned LOD 0 animates.
        chain = self.lod_chains and not template.skin
        rung_levels = range(selected_lod + 1, kept) if chain else ()
        for level in rung_levels:
            level_lod = mesh.lods[level]
            level_prims: list[gltf.Primitive] = []
            level_tris = 0
            for material in level_lod.materials:
                tris = material.triangles()
                if not tris:
                    continue
                level_tris += len(tris)
                shader = rs.lookup(shaders, material.name)
                level_prims.append(gltf.Primitive(
                    positions=material.positions(),
                    normals=material.normals(),
                    uvs=material.uvs(),
                    uvs2=material.uvs2(),
                    indices=[i for tri in tris for i in tri],
                    material=self._material_index(builder, shader, material.name, report),
                ))
            if not level_prims or level_tris == 0:
                continue
            signature = tuple(
                (m.name, len(m.triangles()), m.vertex_count)
                for m in level_lod.materials)
            if emitted and signature == emitted_signatures[-1]:
                continue
            emitted.append((level, builder.add_mesh(
                f"{mesh_file}_lod{level}", level_prims)))
            emitted_tris.append(level_tris)
            emitted_signatures.append(signature)
        if emitted:
            report.mesh_lods[mesh_file]["emittedLevels"] = [
                level for level, _ in emitted]
            report.mesh_lods[mesh_file]["lodTriangles"] = emitted_tris
            self._geom_lod_chain[cache_key] = (emitted, distances)

        primitives: list[gltf.Primitive] = []
        triangles = 0
        for material in lod.materials:
            tris = material.triangles()
            if not tris:
                continue
            triangles += len(tris)
            shader = rs.lookup(shaders, material.name)
            primitives.append(gltf.Primitive(
                positions=material.positions(),
                normals=material.normals(),
                uvs=material.uvs(),
                uvs2=material.uvs2(),
                indices=[i for tri in tris for i in tri],
                material=self._material_index(builder, shader, material.name, report),
            ))

        if not primitives:
            self._geom_mesh[cache_key] = (None, 0)
            return None, 0
        result = builder.add_mesh(mesh_file, primitives), triangles
        self._geom_mesh[cache_key] = result
        return result

    def _treemesh_index(self, builder: gltf.GlbBuilder, mesh_file: str,
                         report: Report,
                         ) -> tuple[int | None, int, treemesh.TreeCollision | None]:
        entry = self.meshes.resolve_ext(f"treeMesh/{mesh_file}", (".tm",))
        if not entry:
            report.missing_meshes.append(mesh_file)
            return None, 0, None
        try:
            tree = treemesh.parse(self.meshes.read(entry), entry)
        except (stdmesh.MeshError, ValueError, struct.error) as exc:
            report.missing_meshes.append(f"{mesh_file} ({exc})")
            return None, 0, None

        primitives: list[gltf.Primitive] = []
        triangles = 0
        for part in tree.parts:
            if len(part.indices) < 3:
                continue
            triangles += len(part.indices) // 3
            shader = rs.Shader(
                name=part.name,
                kind="shader",
                textures=[part.texture] if part.texture else [],
                twosided=True,
                transparent=True,
                alpha_test=0.4,
            )
            # Only the camera-facing leaf sprites go out unlit. A branch card
            # is placed at a real angle -- a palm is `branch` plus `trunk` and
            # has no sprite at all -- so it takes the sun properly and lighting
            # it is what gives the fronds their depth; flatten those too and the
            # palms come out a uniform bright green. The bushes that rendered
            # black are `sprite` plus `trunk`, so the split falls exactly on the
            # label `treemesh.py` already writes.
            foliage = part.name.startswith("sprite")
            # Branch cards stay lit but get a translucency floor: a thin frond
            # facing away from the sun reads as leaf-green with light through
            # it, not black. 0.45 was judged against an in-game Tobruk palm.
            floor = 0.45 if part.name.startswith("branch") else 0.0
            primitives.append(gltf.Primitive(
                positions=part.positions,
                normals=part.normals,
                uvs=part.uvs,
                indices=part.indices,
                material=self._material_index(
                    builder, shader, part.name, report, unlit=foliage,
                    emissive_floor=floor),
            ))
        if not primitives:
            return None, 0, tree.collision
        return builder.add_mesh(mesh_file, primitives), triangles, tree.collision

    # -- effects (muzzle flashes) ------------------------------------------- #

    def _sprite_quad_mesh(self, builder: gltf.GlbBuilder, texture_name: str,
                          report: Report, *, additive: bool = True) -> int | None:
        """A unit quad carrying one SpriteParticle texture.

        The engine billboards these toward the camera; the viewer does the
        same at run time, so the quad's authored plane (XY, facing +Z) only
        has to be *a* plane. Additive is the flash and spark case (`destBlendMode
        BMOne`); the impact library also bakes source-over quads for smoke and
        dust, which the muzzle-flash path never needed.
        """
        # Keyed by bare texture name for the additive case the flash path
        # has always used (and tests pre-seed), with a suffix for source-over.
        key = texture_name.lower() + ("" if additive else "#alpha")
        if key in self._sprite_mesh_cache:
            return self._sprite_mesh_cache[key]
        texture = self._texture_index(builder, f"texture/{texture_name}", report)
        if texture is None:
            self._sprite_mesh_cache[key] = None
            return None
        material = builder.add_material(
            name=f"fx {texture_name}" + ("" if additive else " alpha"),
            texture=texture,
            double_sided=True,
            blend=True,
            additive=additive,
            # Full-bright: a muzzle flash is light, and shading it against the
            # viewer's sun would dim exactly the thing being demonstrated.
            unlit=True,
        )
        index = builder.add_mesh(f"fx {texture_name}", [gltf.Primitive(
            positions=[(-0.5, -0.5, 0.0), (0.5, -0.5, 0.0),
                       (0.5, 0.5, 0.0), (-0.5, 0.5, 0.0)],
            uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)],
            indices=[0, 1, 2, 0, 2, 3],
            material=material,
        )])
        self._sprite_mesh_cache[key] = index
        return index

    def _effect_emitter_nodes(self, builder: gltf.GlbBuilder,
                              bundle: con_mod.ObjectTemplate,
                              report: Report, *, depth: int = 0) -> list[int]:
        """The bakeable emitters of an EffectBundle, as tagged hidden nodes.

        Each Emitter child names its payload with `ObjectTemplate.template`:
        a Particle (an ordinary `.sm` mesh — `MuzzHeavy_m1`) or a
        SpriteParticle (a textured quad). As of this change, all sprite blend
        modes are baked (BMOne additive flashes, BMInvSourceAlpha smoke/dust),
        and nested EffectBundle children are recursed with their transforms.
        Sound-only emitters (no texture, no geometry) are excluded, as are
        emitters with no payload at all.

        Emitters restricted to one view carry it in `effect.view`. The engine
        draws a *different* muzzle flash to the man in the seat: `e_MuzzHeavy`,
        which every vanilla aircraft gun names as its `visibleBarrelTemplate`,
        bundles `em_MuzzHeavy` (a 1.76 m `MuzzHeavy_m1` mesh ramping
        `sizeOverTime 0.12 -> 9.4`) and `em_MuzzHeavy_glow`, both
        `showInThirdPerson 1`, alongside `em_1P_MuzzHeavy`, a 0.4 m sprite
        marked `showInFirstPerson 1`. Declaring one flag restricts the emitter
        to that view; declaring neither means both, which is 341 of vanilla's
        364 emitters. Only six are first-person only and every one is a muzzle
        flash or a shell eject — the exact pair a cockpit needs, and the reason
        a flythrough flown from the pilot's seat used to wear the third-person
        fireball at arm's length.
        """
        from . import effects as effects_mod
        nodes: list[int] = []
        
        # Guard against infinite recursion
        if depth > 6:
            return nodes
        
        for ref in bundle.children:
            child = self.library.object(ref.template)
            if child is None:
                continue
            
            child_kind = child.kind.lower()
            
            # Recurse into nested EffectBundles, preserving their placement
            if child_kind == "effectbundle":
                nested = self._effect_emitter_nodes(builder, child, report, depth=depth + 1)
                if nested:
                    # Wrap the nested bundle's emitters in a container node
                    # that carries the child bundle's placement
                    nested_node = builder.add_node(gltf.Node(
                        name=ref.template,
                        translation=ref.position,
                        rotation=gltf.quat_from_ypr(*ref.rotation),
                        children=nested,
                        extras={"templateKind": child_kind,
                                "effect": {"kind": "bundle"}},
                    ))
                    nodes.append(nested_node)
                continue
            
            # Process Emitter children
            if child_kind != "emitter" or child.emitter_template is None:
                continue
            
            emitter = child
            payload = self.library.object(emitter.emitter_template)
            if payload is None:
                continue
            
            kind = payload.kind.lower()
            mesh_index: int | None = None
            effect: dict = {}
            
            if kind == "spriteparticle":
                # Accept any sprite that has a texture, not just BMOne
                if not payload.sprite_texture:
                    continue
                # Determine blend mode for material setup
                dest_blend = (payload.dest_blend_mode or "").lower()
                is_additive = dest_blend == "bmone"
                mesh_index = self._sprite_quad_mesh(
                    builder, payload.sprite_texture, report, additive=is_additive)
                effect["kind"] = "sprite"
                effect["billboard"] = True
                if payload.sprite_size is not None:
                    effect["size"] = payload.sprite_size
            elif kind == "particle" and payload.geometry:
                # The mesh's own .rs declares the additive blend; the material
                # path picks it up, so no filter is needed here.
                mesh_index, _ = self._mesh_index(builder, payload.geometry, report)
                effect["kind"] = "mesh"
                # EMT-8 (V-R2's EMT-6): mesh particles carry `ObjectTemplate.size` the
                # same field sprites do (`sprite_size` here). `fx_1p_MuzzGun`
                # is size 0.2 — omitting it left gunfire.js at the default
                # scale of 1 (~5× retail frame coverage).
                if payload.sprite_size is not None:
                    effect["size"] = payload.sprite_size
            elif kind in ("simpleobject", "bundle") and payload.geometry:
                # Debris: cascade bundles throw real SimpleObjects as mesh particles
                mesh_index, _ = self._mesh_index(builder, payload.geometry, report)
                effect["kind"] = "mesh"
                if payload.sprite_size is not None:
                    effect["size"] = payload.sprite_size
            
            if mesh_index is None:
                continue
            
            effect["timeToLive"] = (payload.time_to_live
                                    or emitter.time_to_live or 0.1)
            if emitter.show_in_first_person != emitter.show_in_third_person:
                effect["view"] = ("first" if emitter.show_in_first_person
                                  else "third")
            if payload.size_over_time:
                effect["sizeOverTime"] = payload.size_over_time
            if payload.color_over_time:
                effect["colorOverTime"] = payload.color_over_time
            # Emitter motion along the direction of fire. The Sherman's
            # additive muzzle smoke (`Em_MuzzPanz_WSmoke`) grows to 3.6 m but
            # recedes at -5 m/s in game; parked at the muzzle it reads as a
            # fireball five times the real flash.
            if emitter.relative_position_in_dof:
                effect["offsetInDof"] = emitter.relative_position_in_dof
            if emitter.positional_speed_in_dof:
                effect["speedInDof"] = emitter.positional_speed_in_dof
            # R2 / V-R2: shell-eject emitters declare `delay` (2.0 s on 1P
            # Em_Shell792D1P). Without it, gunfire strobes the casing at the
            # same instant as the flash and it reads as a lingering muzzle.
            if (raw := (emitter.effect_props or {}).get("delay")):
                delay = con_mod.crd(raw.split()[0])
                if delay is not None and delay > 0:
                    effect["delay"] = delay
            nodes.append(builder.add_node(gltf.Node(
                name=ref.template,
                translation=ref.position,
                rotation=gltf.quat_from_ypr(*ref.rotation),
                mesh=mesh_index,
                extras={"templateKind": payload.kind, "effect": effect},
            )))
        return nodes

    def bake_effect_library(self, builder: gltf.GlbBuilder, names,
                            report: Report) -> tuple[list[int], dict]:
        """Every named EffectBundle as a hidden template subtree, all specs on.

        One root node per bundle, named for it; under it the bundle's emitters
        as nodes (mesh: the sprite quad or the Particle's own `.sm`) carrying
        the full `effects.emitter_spec` in `extras.effectEmitter`, and nested
        bundles as intermediate nodes keeping their authored placement. The
        viewer clones a subtree per impact, puts the engine's frame on the
        root, and the hierarchy places every emitter. Nothing here is drawn in
        place: these are spawn templates, like the muzzle flashes.

        Returns the root node indices and an index `{bundle: {emitters, ...}}`
        for the manifest.
        """
        from . import effects as effects_mod
        roots: list[int] = []
        index: dict = {}
        missing: list[str] = []

        def spawned_object(name: str) -> int | None:
            # A spawn effect's payload is a whole object (EMT-10), baked the
            # way a model or level export bakes it: no `materialDiffuse` and
            # no additive alpha cut, which only effect particles take.
            # It is solid, as a placed object is: its collision hulls are baked
            # with it whatever the bake's own setting. A geometry an effect
            # particle cached as hull-less while hulls were off is looked at
            # again.
            saved = (self.apply_material_diffuse, self.additive_alpha_test,
                     self.include_collision)
            self.apply_material_diffuse = self.additive_alpha_test = False
            if not self.include_collision:
                self.include_collision = True
                self._geom_collisions = {k: v for k, v in self._geom_collisions.items() if v}
            try:
                # Depth 0: the object is a root of the world, as a placed one
                # is, so whatever a bake stamps on a placed root (PHY-17's
                # `hasMobilePhysics false`) it stamps on this one too.
                return self.build_node(builder, name, report, depth=0)
            finally:
                (self.apply_material_diffuse, self.additive_alpha_test,
                 self.include_collision) = saved

        def build(node: effects_mod.BundleNode, depth: int) -> int | None:
            children: list[int] = []
            for ref, emitter, payload, spec in node.emitters:
                particle = spec["particle"]
                mesh_index: int | None
                if particle["kind"] == "object":
                    root = spawned_object(payload.name)
                    if root is None:
                        missing.append(f"{node.template.name}/{emitter.name}")
                        continue
                    children.append(builder.add_node(gltf.Node(
                        name=ref.template,
                        translation=ref.position,
                        rotation=gltf.quat_from_ypr(*ref.rotation),
                        children=[root],
                        extras={"templateKind": emitter.kind, "effectEmitter": spec},
                    )))
                    continue
                if particle["kind"] == "sprite":
                    mesh_index = self._sprite_quad_mesh(
                        builder, particle["texture"], report,
                        additive=particle["blend"] == "add")
                else:
                    mesh_index, _ = self._mesh_index(builder, particle["geometry"], report)
                if mesh_index is None:
                    missing.append(f"{node.template.name}/{emitter.name}")
                    continue
                children.append(builder.add_node(gltf.Node(
                    name=ref.template,
                    translation=ref.position,
                    rotation=gltf.quat_from_ypr(*ref.rotation),
                    mesh=mesh_index,
                    extras={"templateKind": payload.kind, "effectEmitter": spec},
                )))
            for nested in node.bundles:
                child = build(nested, depth + 1)
                if child is not None:
                    children.append(child)
            if not children:
                return None
            props = node.template.effect_props
            extras: dict = {"templateKind": node.template.kind,
                            "effectBundle": {"name": node.template.name}}
            if (raw := props.get("timetolive")) and (ttl := con_mod.crd4(raw.split()[0])):
                extras["effectBundle"]["timeToLive"] = ttl
            if node.template.work_on_materials:
                extras["effectBundle"]["workOnMaterials"] = list(
                    node.template.work_on_materials)
            if (raw := props.get("mindistanceunderwatersurface", "").strip()):
                try:
                    extras["effectBundle"]["minDistanceUnderwaterSurface"] = float(
                        raw.split()[0])
                except ValueError:
                    pass
            if (raw := props.get("maxdistanceunderwatersurface", "").strip()):
                try:
                    extras["effectBundle"]["maxDistanceUnderwaterSurface"] = float(
                        raw.split()[0])
                except ValueError:
                    pass
            if (raw := props.get("loddistance", "").strip()):
                try:
                    extras["effectBundle"]["lodDistance"] = float(raw.split()[0])
                except ValueError:
                    pass
            if (raw := props.get("setstartoneffects", "").strip()):
                if (flag := con_mod.truthy(raw)) is not None:
                    extras["effectBundle"]["startOnEffects"] = flag
            return builder.add_node(gltf.Node(
                name=node.template.name,
                translation=node.position,
                rotation=gltf.quat_from_ypr(*node.rotation),
                children=children,
                extras=extras,
            ))

        # Case breaks the tie, or the bake is not reproducible: the damage
        # table names both `e_collision_ship` and `e_Collision_ship`, a sort
        # on lower-case alone leaves their order to the set's iteration, and
        # Python re-seeds string hashing per process. Two fresh runs of
        # `extract_effects.py --mod bf1942` gave two different `effects.glb`
        # before this, which makes any byte comparison of the bake meaningless.
        for name in sorted(set(names), key=lambda n: (n.lower(), n)):
            tree = effects_mod.bundle_tree(self.library, name)
            if tree is None:
                missing.append(name)
                continue
            root = build(tree, 0)
            if root is None:
                missing.append(name)
                continue
            roots.append(root)
            index[tree.template.name] = {"emitters": tree.count()}
        report.part_tree.extend(f"effect {name}" for name in index)
        return roots, {"bundles": index, "missing": missing}

    def _effect_bundle_node(self, builder: gltf.GlbBuilder,
                            template: con_mod.ObjectTemplate, report: Report, *,
                            position, rotation, depth: int) -> int | None:
        emitters = self._effect_emitter_nodes(builder, template, report)
        if not emitters:
            return None
        report.part_tree.append(f"{'  ' * depth}{template.name} ({template.kind})")
        return builder.add_node(gltf.Node(
            name=template.name,
            translation=position,
            rotation=gltf.quat_from_ypr(*rotation),
            children=emitters,
            extras={"templateKind": template.kind,
                    "effect": {"kind": "bundle"}},
        ))

    def _geometry_box(self, geometry_name: str) -> list[float] | None:
        """A StandardMesh geometry's box, as its extents `[DX, DY, DZ]`, or None.

        This is the box a full physics body drags by (PHY-4, PHY-22, COL-14):
        `PhysicsNode::updatePhysics` (lnxded `0x082543d0`) takes min and max
        from the geometry's `getBoundingBox` (`0x083b4e40`, the mesh's `+0x28`),
        which the `BStandardMesh` constructor (`0x083b4410`) copies from its
        template's `+0x40`, which `loadHeader` (`0x083a6200`) reads straight out
        of the `.sm` header. It is not the drawn LOD's extent, and not the
        `visibleDummyProjectileTemplate`'s: Desert Combat's AT-2 draws 1.44 m
        across against a 0.25 m header, its AIM-9 0.45 m tall against 0.64 m.
        """
        key = geometry_name.lower()
        if key in self._geom_boxes:
            return self._geom_boxes[key]
        box = None
        template = self.library.geometry(geometry_name)
        if template is not None and template.kind.lower() == "standardmesh":
            entry = self.meshes.resolve_ext(
                f"standardMesh/{template.mesh_file}", (".sm",))
            if entry:
                try:
                    mesh = stdmesh.parse(self.meshes.read(entry), entry)
                except stdmesh.MeshError:
                    mesh = None
                if mesh is not None:
                    extents = [round(float(hi - lo), 4) for lo, hi
                               in zip(mesh.bounds_min, mesh.bounds_max)]
                    if all(extent > 0 for extent in extents):
                        box = extents
        self._geom_boxes[key] = box
        return box

    def _projectile_has_rocket_engine(self, template: con_mod.ObjectTemplate,
                                      depth: int = 0) -> bool:
        """Whether a projectile carries a `setEngineType c_ETRocket` Engine.

        The Katyusha's rocket declares its motor as an ordinary
        `addTemplate KatyushaRocket_Engine` child; a shell has no engine and
        just falls.
        """
        if depth > 4:
            return False
        for ref in template.children:
            child = self.library.object(ref.template)
            if child is None:
                continue
            if (child.kind.lower() == "engine"
                    and (child.engine_type or "").lower() == "c_etrocket"):
                return True
            if self._projectile_has_rocket_engine(child, depth + 1):
                return True
        return False

    def _projectile_trail_spec(
            self, projectile: con_mod.ObjectTemplate,
    ) -> tuple[dict | None, con_mod.ObjectTemplate | None]:
        """The smoke sprite a projectile drags behind it, or (None, None).

        Two declaration styles ship: `startEffectTemplate e_KatyushaFume` on
        the Katyusha rocket, and a plain `addTemplate e_PanzShootTrail`
        EffectBundle child on tank shells. Either way the bundle's emitters
        name SpriteParticle payloads; the longest-lived one is the trail the
        eye follows (the KatyushaFume smoke lives 1.5 s against the fire
        tongue's 0.2 s).
        """
        bundles: list[con_mod.ObjectTemplate | None] = []
        if projectile.start_effect_template:
            bundles.append(self.library.object(projectile.start_effect_template))
        for ref in projectile.children:
            child = self.library.object(ref.template)
            if child is not None and child.kind.lower() == "effectbundle":
                bundles.append(child)
        best: tuple[float, dict, con_mod.ObjectTemplate] | None = None
        for bundle in bundles:
            if bundle is None:
                continue
            for ref in bundle.children:
                emitter = self.library.object(ref.template)
                if emitter is None or emitter.emitter_template is None:
                    continue
                payload = self.library.object(emitter.emitter_template)
                if (payload is None or payload.kind.lower() != "spriteparticle"
                        or not payload.sprite_texture):
                    continue
                ttl = payload.time_to_live or emitter.time_to_live or 0.5
                if best is not None and ttl <= best[0]:
                    continue
                spec: dict = {"texture": payload.sprite_texture,
                              "timeToLive": ttl}
                if payload.sprite_size is not None:
                    spec["size"] = payload.sprite_size
                if payload.size_over_time:
                    spec["sizeOverTime"] = payload.size_over_time
                if payload.color_over_time:
                    spec["colorOverTime"] = payload.color_over_time
                best = (ttl, spec, payload)
        return (best[1], best[2]) if best else (None, None)

    # Which of a projectile's `addTemplate` children change how it flies. An
    # `EffectBundle` child is the wake and already rides out as `trailBundle`;
    # a `Wing`, a `FloatingBundle` or an `Engine` is physics, and until now none
    # of it reached the viewer at all.
    _PROJECTILE_PART_KINDS = ("wing", "floatingbundle", "engine")

    def _projectile_parts(self,
                          projectile: con_mod.ObjectTemplate) -> list[dict]:
        """The physics children of a Projectile, placed and with their words.

        `AircraftTorpedo` is the reason this exists: two `Torpedo_Floater`
        (`FloatingBundle`) 3 m above the hull centre and 2 m either side of it,
        a `Torpedo_Engine` (`c_ETTorpedo`) and two `Torpedo_Wing` at the tail.
        Those five are the whole of why a torpedo runs level in water instead
        of sinking, and `_projectile_spec` never walked the children to find
        them (gap G-4). The three bombs bring two `Bomb_wing` fins each by the
        same route, which is what keeps a released bomb nose-down.

        Positions are Refractor's, Z-negated into glTF exactly as `build_node`
        does for every other child; rotations are the `.con`'s own yaw/pitch/
        roll triple, unconverted, because a consumer reading `setMinRotation`
        and `setMaxRotation` out of the same block needs the same convention.
        The physics words come from `ObjectTemplate.physics()`, which already
        serialises all three classes.
        """
        parts: list[dict] = []
        for ref in projectile.children:
            name = con_mod.instance_template_name(ref, self.library.object)
            child = self.library.object(name) if name else None
            if child is None:
                continue
            kind = child.kind.lower()
            if kind not in self._PROJECTILE_PART_KINDS:
                continue
            part = {
                "template": child.name,
                "kind": child.kind,
                "position": [ref.position[0], ref.position[1],
                             -ref.position[2]],
                "rotation": list(ref.rotation),
            }
            part.update(child.physics() or {})
            parts.append(part)
        return parts

    def _projectile_spec(self, builder: gltf.GlbBuilder,
                         template: con_mod.ObjectTemplate,
                         report: Report) -> tuple[dict | None, list[int]]:
        """The typed projectile dict for a FireArms, plus baked hidden nodes.

        `kind` decides what a viewer flies out of the muzzle: `bullet` (no
        geometry — invisible in game bar the tracer rounds), `shell` (a drawn
        body that falls), `rocket` (a drawn body with a `c_ETRocket` motor
        that accelerates). Drawn bodies prefer `visibleDummyProjectileTemplate`
        — the mesh the game itself shows in flight — and are baked once as a
        hidden tagged node so mesh/materials/textures ride the ordinary GLB
        path, same as the flash emitters.
        """
        name = template.projectile_template
        if not name:
            return None, []
        spec: dict = {"template": name, "kind": "bullet", "trail": None}
        nodes: list[int] = []
        projectile = self.library.object(name)
        if projectile is None:
            return spec, nodes
        drawn = (self.library.object(template.visible_dummy_projectile_template)
                 if template.visible_dummy_projectile_template else None)
        # `invisible 1` is the engine's "never draw the body" — every
        # hand-weapon bullet declares it while still naming `bullet_m1`
        # geometry, so geometry alone must not promote it to a drawn shell.
        # A `visibleDummyProjectileTemplate` still wins: that mesh exists
        # precisely to be shown in flight.
        body = (drawn if drawn is not None and drawn.geometry
                else projectile if not projectile.invisible else None)
        if projectile.time_to_live is not None:
            spec["timeToLive"] = projectile.time_to_live
        if projectile.gravity_modifier is not None:
            spec["gravity"] = projectile.gravity_modifier
        # What the round is worth on arrival. `material` keys the
        # MaterialManager's effect and damage tables; the falloff triple is
        # `Projectile::getDamage`'s; the rest is the splash pass.
        #
        # The engine has TWO explosions and `damageType` alone does not say
        # which a round gets (HP-9d):
        #
        #   impact explosion      damageType == 1 AND hasCollisionEffect
        #   end-of-life explosion damageType in {1, 4}, flag NOT tested
        #
        # so `hasCollisionEffect` travels with the block. Without it the viewer
        # cannot tell a tank shell (bursts on contact) from a grenade (bursts
        # when its fuse ends), and `effects-core.js` would be back to inferring
        # the difference from `material2`, which carries none of it.
        #
        # `dieAfterColl` rides along for the same reason, and it is NOT a
        # restatement of the flag. Whether a round SURVIVES contact is a third
        # question, answered by `Projectile::handleCollision` (0x0831ee80):
        # `dieAfterColl` (0x0831ef4b) OR `hasCollisionEffect` (0x0831ef54)
        # recycles it through `resetProjectile` (0x0831e720), which despawns it
        # without ever calling `startEndEffect`. A `damageType 4` round with
        # the flag set — vanilla's three flak shells — therefore dies on
        # contact having exploded neither way, which is exactly what a timed
        # airburst should do; treating it as a fuse round that rests where it
        # lands and bursts there would invent a blast the game never has.
        #
        # `radius` arrives already truncated toward zero — `con.py` does it at
        # parse because the console property is an `int` (HP-9). The engine's
        # own `ProjectileTemplate` constructor default is 10.0 (`0x41200000` at
        # lnxded 0x0831f9b3), and six vanilla tank rounds ride it: Sherman,
        # Tiger, PanzerIV, T34, T34-85 and Chi-ha declare no `radius` at all.
        # The default is applied for `damageType 4` as well as 1, because the
        # constructor does not consult `damageType` — vanilla's four
        # `damageType 4` templates all author a radius, so this is correctness
        # for mods rather than a change to any shipped round.
        if projectile.material is not None:
            spec["material"] = projectile.material
        # The body words. A bomb is `mass 250` / `drag 0.08` and a torpedo
        # `mass 800` / `drag 0.04`, and without them a viewer cannot run the
        # engine's own drag law (`accel -= scale*v * pi r^2 * drag / mass`,
        # PHY-7) on a round at all — it was integrating gravity alone.
        # `setHasPointPhysics 0` says which physics path the round takes, which
        # is what decides whether its `Wing` and `FloatingBundle` children mean
        # anything (BOMB-10).
        for key, value in (("mass", projectile.mass),
                           ("drag", projectile.drag),
                           ("hasPointPhysics", projectile.has_point_physics),
                           ("stopAtEndEffect", projectile.stop_at_end_effect)):
            if value is not None:
                spec[key] = value
        # The box a full body drags by is its own geometry's `.sm` header box,
        # whatever is drawn in its place (`_geometry_box`).
        if projectile.has_point_physics is False and projectile.geometry:
            if box := self._geometry_box(projectile.geometry):
                spec["box"] = box
        radius = projectile.explosion_radius
        if (radius is None
                and projectile.damage_type in (1, 4)
                and projectile.material2 is not None
                and projectile.material2 >= 0):
            radius = 10.0
        damage = {
            key: value for key, value in {
                "minDamage": projectile.min_damage,
                "distToStartLoseDamage": projectile.dist_to_start_lose_damage,
                "distToMinDamage": projectile.dist_to_min_damage,
                "radius": radius,
                "material2": projectile.material2,
                "damageType": projectile.damage_type,
                "hasCollisionEffect": projectile.has_collision_effect,
                "dieAfterColl": projectile.die_after_coll,
                # What `timeToLive` running out does (PROX-7): burst when set,
                # vanish when not. Constructor default 0.
                "hasOnTimeEffect": projectile.has_on_time_effect,
                "yModOnExplosion": projectile.y_mod_on_explosion,
                # The third "what happens on contact" word, and the one the
                # aircraft torpedo is built on: `Projectile::handleCollision`'s
                # only `return 0` is a water contact without it (BOMB-11), so a
                # round declaring `0` passes THROUGH the surface. It lives
                # beside `dieAfterColl` because it answers the same question.
                "detonateOnWaterCollision":
                    projectile.detonate_on_water_collision,
            }.items() if value is not None
        }
        if damage:
            spec["damage"] = damage
        # The bundles the round plays for itself, by name; the effect library
        # (`extract_effects.py`) bakes them and the viewer plays them when it
        # has it, falling back to the single trail sprite below when not.
        from . import effects as effects_mod
        if trail_bundle := effects_mod.projectile_trail_bundle(self.library, projectile):
            spec["trailBundle"] = trail_bundle
        if parts := self._projectile_parts(projectile):
            spec["parts"] = parts
        if projectile.end_effect_template:
            spec["endEffect"] = projectile.end_effect_template
        if body is not None and body.geometry:
            spec["kind"] = ("rocket"
                            if self._projectile_has_rocket_engine(projectile)
                            else "shell")
            if self.include_effects:
                mesh_index, _ = self._mesh_index(builder, body.geometry, report)
                if mesh_index is not None:
                    extras = {"templateKind": body.kind,
                              "projectileMesh": {"template": body.name,
                                                 "geometry": body.geometry}}
                    # Drawn scaled, measured unscaled (SM-13): the viewer
                    # takes the round's drag radius off this mesh, and the
                    # engine's `getBoundingRadius` is the file's.
                    if scale := geometry_scale(self.library.geometry(body.geometry)):
                        extras["geometryScale"] = list(scale)
                    nodes.append(builder.add_node(gltf.Node(
                        name=f"{template.name} projectile",
                        mesh=mesh_index,
                        extras=extras,
                    )))
        trail, payload = self._projectile_trail_spec(projectile)
        if trail is not None:
            spec["trail"] = trail
            if self.include_effects:
                quad = self._sprite_quad_mesh(builder, trail["texture"], report)
                if quad is not None:
                    nodes.append(builder.add_node(gltf.Node(
                        name=f"{template.name} trail",
                        mesh=quad,
                        extras={"templateKind": payload.kind,
                                "projectileTrail": trail},
                    )))
        return spec, nodes

    def _fire_arms(self, builder: gltf.GlbBuilder,
                   template: con_mod.ObjectTemplate, report: Report,
                   control: str, depth: int) -> tuple[list[int], dict]:
        """Muzzle nodes and the firing stats for one FireArms template.

        Plane guns declare one `addFireArmsPosition <pos> <ypr>` per barrel
        (the ypr is gun convergence); a tank gun declares none and fires from
        `projectilePosition` along the barrel the FireArms itself carries. The
        flash named by `visibleBarrelTemplate` is baked under every muzzle;
        `addTemplate`-attached flashes (the Sherman's `e_MuzzPanz`) arrive
        through the ordinary child walk instead.
        """
        muzzles = template.fire_arms_positions or [
            (template.projectile_position or (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))]
        nodes: list[int] = []
        for index, (position, rotation) in enumerate(muzzles):
            children: list[int] = []
            if template.visible_barrel_template:
                flash = self.build_node(
                    builder, template.visible_barrel_template, report,
                    depth=depth + 1, control=control)
                if flash is not None:
                    children.append(flash)
            nodes.append(builder.add_node(gltf.Node(
                name=f"{template.name} muzzle {index + 1}",
                translation=position,
                rotation=gltf.quat_from_ypr(*rotation),
                children=children,
                extras={"templateKind": "Muzzle",
                        "muzzle": {"index": index},
                        "control": control or "vehicle"},
            )))

        tracer = None
        if template.tracer_template:
            projectile = self.library.object(template.tracer_template)
            tracer = {
                "template": template.tracer_template,
                "interval": template.tracer_interval or 1,
            }
            if projectile is not None:
                if projectile.time_to_live is not None:
                    tracer["timeToLive"] = projectile.time_to_live
                if projectile.tracer_scaler is not None:
                    tracer["scaler"] = projectile.tracer_scaler
                # The tracer is a round of its own in flight, so it falls by
                # its own `gravityModifier`, 1.0 when it declares none (IMP-7).
                # Written resolved, so a viewer can tell "falls at 1.0" from a
                # glb baked before the tracer carried it. Vanilla's
                # `Tracer_Projectile` declares 0.0; Desert Combat's `20mm_`,
                # `50cal_Tracer_Projectile` and `Minigun_Tracer` declare 1.
                tracer["gravity"] = (projectile.gravity_modifier
                                     if projectile.gravity_modifier is not None
                                     else 1.0)
                # The tracer is the only part of a bullet the game ever draws,
                # so unlike the projectile body it is never optional: bake its
                # mesh the same way, as a hidden tagged node, and the streak
                # arrives with its own `.rs` — `TLight_m1` is additive
                # (`blendDest one`) and unlit (`lighting false`), which is what
                # makes it read as light instead of a grey tube.
                if projectile.geometry and self.include_effects:
                    mesh_index, _ = self._mesh_index(
                        builder, projectile.geometry, report)
                    if mesh_index is not None:
                        tracer["geometry"] = projectile.geometry
                        extras = {"templateKind": projectile.kind,
                                  "tracerMesh": {
                                      "template": projectile.name,
                                      "geometry": projectile.geometry}}
                        # Drawn scaled, like the round's body above (SM-13).
                        if scale := geometry_scale(
                                self.library.geometry(projectile.geometry)):
                            extras["geometryScale"] = list(scale)
                        nodes.append(builder.add_node(gltf.Node(
                            name=f"{template.name} tracer",
                            mesh=mesh_index,
                            extras=extras,
                        )))
        projectile_spec, projectile_nodes = self._projectile_spec(
            builder, template, report)
        nodes += projectile_nodes
        throw = {key: value for key, value in {
            "fireDelay": template.fire_delay,
            "hideDuringFireTime": template.hide_during_fire_time,
            "rotationalSpeed": (list(template.rotational_speed)
                                if template.rotational_speed else None),
        }.items() if value is not None}
        # A seat gun's cone, in the hand weapon's block shape (deviation.js
        # `DeviationModel`): plain FireArms only, whose total is `minDev +
        # fire` -- no stance multiplier (`getDevMod` is 1.0 off a soldier) and
        # no speed, turn or misc channel (handweapon-view-and-deviation §2). The
        # vehicle HUD feed hands the cross that total (XHIT-15). A HandFireArms
        # already carries its whole block in the document's `weapon` extras.
        deviation = ({key: value for key, value in {
            "min": template.min_dev,
            "fire": list(template.fire_dev) if template.fire_dev else None,
        }.items() if value is not None}
            if template.kind.lower() == "firearms" else {})
        extras = {key: value for key, value in {
            "projectile": projectile_spec,
            "roundOfFire": template.round_of_fire,
            "magSize": template.mag_size,
            # Magazine and reload, straight off the template -- present on a
            # vehicle FireArms exactly like a HandFireArms (Defgun's cannon:
            # 499/999/5s; a coax Browning: 400/1/0.1s, autoReload 1).
            "numOfMag": template.num_of_mag,
            "magType": template.mag_type,
            "reloadTime": template.reload_time,
            "autoReload": template.auto_reload,
            # Sustained-fire heat (`ABHeatBarOnly` mounts: Browning, MG42).
            "heatAddWhenFire": template.heat_add_when_fire,
            "coolDownPerSec": template.cool_down_per_sec,
            "timeDelayOnOverheat": template.time_delay_on_overheat,
            "velocity": template.velocity,
            # One barrel per pull instead of a salvo, and one round charged
            # instead of one per barrel (BOMB-1/BOMB-3). Seven vanilla
            # templates; the B17's bomb rack is the one that matters, and
            # without this word its stick of eight is a salvo of two.
            "asynchronyFire": template.asynchrony_fire,
            # A salvo that costs one round and never fires short (BOMB-13):
            # the shotguns' pellets, FHSW's canister and shrapnel shells.
            # Always written, `false` when the template says nothing, so the
            # page can tell this export from one made before the word was
            # read (which carries no key, and keeps one round a pull).
            "blastAmmoCount": bool(template.blast_ammo_count),
            # `projectilePosition` is where the round leaves when a template
            # declares no `addFireArmsPosition`, and the muzzle list below
            # already falls back to it. When BOTH are declared the barrels win
            # for placement — but the offset does not stop existing: a Stuka's
            # rack is `projectilePosition 0/-0.4/-0.2` with barrels at ±3.3, so
            # dropping it put the bombs 0.4 m too high and 0.2 m too far aft.
            # Carried beside the barrels rather than folded into them so the
            # muzzle nodes still read as the `.con`'s own numbers.
            "projectilePosition": (
                [template.projectile_position[0],
                 template.projectile_position[1],
                 -template.projectile_position[2]]
                if template.projectile_position and template.fire_arms_positions
                and any(template.projectile_position) else None),
            # The throw, for the four hand weapons that let go of what they
            # hold: how long the weapon's own mesh is hidden from the shot
            # (`hideDuringFireTime`, the hand-off), the wind-up from the trigger
            # to the round (`fireDelay`), and the round's authored tumble
            # (`rotationalSpeed`, `8/0/0` on both grenades and nothing else).
            # Absent on every other weapon, so nothing else grows a key.
            "throw": throw or None,
            # Where the round leaves from (XHIT-12): set, `FireArms::Fire`
            # (lnxded 0x0828a1c1) launches from the firing player's camera,
            # clear, from this FireArms. Written false as well as true, so a
            # glb carries the answer for every gun and `viewer/camera-dof.js`'s
            # name table only speaks for glbs baked before the word was
            # exported. A mod's own guns need it: DC sets it on 18 vehicle
            # FireArms no vanilla name covers (its NSVT, coax, TOWs, miniguns).
            "fireInCameraDof": bool(template.fire_in_camera_dof),
            "input": template.input_fire or "c_PIFire",
            "control": control or "vehicle",
            "muzzles": len(muzzles),
            "tracer": tracer,
            "recoil": ({"size": template.recoil_size,
                        "speed": template.recoil_speed}
                       if template.recoil_size else None),
            "deviation": deviation or None,
        }.items() if value is not None}
        report.fire_arms.append(
            f"[{control or 'vehicle'}] {template.name}: {len(muzzles)} muzzle(s)"
            + (f", {template.round_of_fire:g} rps" if template.round_of_fire else "")
            + (f", {template.velocity:g} m/s" if template.velocity else "")
            + (f", tracer every {tracer['interval']}"
               + (f" [{tracer['geometry']}]" if tracer.get("geometry") else "")
               if tracer else "")
            + (f", projectile {projectile_spec['kind']}"
               if projectile_spec else "")
            + (f", flash {template.visible_barrel_template}"
               if template.visible_barrel_template else "")
            + (f", heat +{template.heat_add_when_fire:g}/shot"
               if template.heat_add_when_fire else ""))
        return nodes, extras

    def _read_skin(self, path: str) -> skin.Skin | None:
        key = path.lower()
        if key in self._skin_cache:
            return self._skin_cache[key]
        entry = self.meshes.resolve_ext(path.rsplit(".", 1)[0], (".skn",))
        if not entry:
            # GeometryTemplate.setSkin stores `animations/Foo.skn` already.
            entry = self.meshes.find(path)
        parsed: skin.Skin | None = None
        if entry:
            try:
                parsed = skin.parse(self.meshes.read(entry), entry)
            except (skin.SkinError, KeyError, struct.error):
                parsed = None
        self._skin_cache[key] = parsed
        return parsed

    def _pose_flag_cloth(self, mesh: stdmesh.StandardMesh,
                         template: con_mod.GeometryTemplate,
                         report: Report) -> stdmesh.StandardMesh:
        """A flag cloth at the engine's pose, `flagcloth.py`'s reading.

        Left raw, the sheet straddles its mast with the image upside down.
        """
        skn = self._read_skin(template.skin)
        skeleton = self._read_skeleton(flagcloth.FLAG_SKELETON, report)
        if skn is None or skeleton is None:
            return mesh
        if "flag" not in self._flag_clip_cache:
            raw = self.meshes.try_read(flagcloth.FLAG_CLIP)
            try:
                self._flag_clip_cache["flag"] = baf.parse(raw) if raw else None
            except Exception:
                self._flag_clip_cache["flag"] = None
        worlds = flagcloth.rest_worlds(skeleton, self._flag_clip_cache["flag"])
        report.skinned_parts.append(
            f"{template.name} cloth posed at FlagBlow frame 0")
        return flagcloth.pose_mesh(mesh, skn, worlds)

    def _geometry_skin(self, geometry_name: str | None) -> skin.Skin | None:
        if not geometry_name:
            return None
        geom = self.library.geometry(geometry_name)
        if geom is None or not geom.skin:
            return None
        return self._read_skin(geom.skin)

    def _soldier_body_skin(self, soldier: con_mod.ObjectTemplate) -> skin.Skin | None:
        """The 3P body skin — the bind the hands and head have to be mapped into."""
        for ref in soldier.children:
            name = con_mod.instance_template_name(ref, self.library.object)
            if name is None:
                continue
            child = self.library.object(name)
            if child is None or not child.geometry:
                continue
            low = child.name.lower()
            if "hand" in low or "head" in low:
                continue
            if geometry_is_first_person(child.geometry):
                continue
            parsed = self._geometry_skin(child.geometry)
            if parsed is not None:
                return parsed
        return None

    def _part_alignment(
            self, template: con_mod.ObjectTemplate, body: skin.Skin | None,
    ) -> tuple[tuple[tuple[float, float, float], ...], tuple[float, float, float], str] | None:
        """Rigid transform plugging a skinned soldier part into the body's bind.

        A soldier's hands and `ComplexHead` are separate skins authored in
        their own bind poses, which are not the pose the 3P body was authored
        in — every head skin assumes `Bip01 Spine3` at the exporter's default
        standing pose while the body binds it a few cm forward and lower, so
        an unaligned head floats high and behind the neck stump. The shared
        recoverable bone (Spine3 for heads, the forearm for hands) gives the
        exact rigid correction; the body itself resolves to the same cached
        skin object and is left alone.
        """
        if body is None or not template.geometry:
            return None
        part = self._geometry_skin(template.geometry)
        if part is None or part is body:
            return None
        aligned = skin.alignment(part, body)
        return aligned

    def _read_skeleton(self, path: str, report: Report) -> ske.Skeleton | None:
        key = path.lower()
        if key not in self._skeleton_cache:
            entry = self.meshes.find(path) or self.meshes.resolve_ext(
                path.rsplit(".", 1)[0], (".ske",))
            parsed: ske.Skeleton | None = None
            if entry:
                try:
                    parsed = ske.parse(self.meshes.read(entry), entry)
                except (ske.SkeletonError, KeyError, struct.error):
                    parsed = None
            self._skeleton_cache[key] = parsed
        found = self._skeleton_cache[key]
        if found is None:
            report.unreadable_skeletons.append(path)
        return found

    def _skeleton_scope(self, template: con_mod.ObjectTemplate,
                        inherited: tuple[ske.Skeleton | None, int | None, str | None],
                        report: Report,
                        ) -> tuple[ske.Skeleton | None, int | None, str | None]:
        """The skeleton, main bone and declared main name in force for the children.

        `createSkeleton` and `useSkeletonPartAsMain` are declared on the root
        `HandFireArms`, but the parts that bind to bones hang off the
        `AnimatedBundle` two levels down, which re-declares only the skeleton.
        Both therefore inherit.
        """
        skeleton, main_index, main_name = inherited
        if template.skeleton_main:
            main_name = template.skeleton_main
        if template.skeleton:
            skeleton = self._read_skeleton(template.skeleton, report)
            main_index = (skeleton.main_index(main_name, template.geometry)
                          if skeleton is not None else None)
        return skeleton, main_index, main_name

    def _declares_skin(self, template_name: str) -> bool:
        child = self.library.object(template_name)
        geom = self.library.geometry(child.geometry) if child and child.geometry else None
        return bool(geom and geom.skin)

    def _bind_pose(self, ref: con_mod.ChildRef, child_name: str,
                   skeleton: ske.Skeleton | None, main_index: int | None,
                   report: Report,
                   ) -> tuple[ske.Matrix3, ske.Vector3, str] | None:
        """Where `bindToSkeletonPart` puts this child, or None to leave it alone.

        A rigid `StandardMesh` sub-part carries no placement of its own, so the
        bone's rest pose *is* its placement — a bazooka rocket is modelled along
        its own +Y at the origin and only the `rocket` bone swings it into the
        tube. A mesh with its own `.skn` is the opposite case: its vertices are
        already stored in the skeleton's bind world space, so at bind pose the
        bone contributes nothing and re-applying it would throw the part a whole
        bone chain off. That is every soldier's `ComplexHead`, bound to
        `Bip01_Spine3` while its verts already sit on the neck.
        """
        if not ref.skeleton_part:
            return None
        if self._declares_skin(child_name):
            report.bound_parts.append(
                f"{child_name} -> {ref.skeleton_part} (skinned, bind pose is identity)")
            return None
        if skeleton is None:
            report.bound_parts.append(
                f"{child_name} -> {ref.skeleton_part} (no skeleton in scope)")
            return None
        index = skeleton.index(ref.skeleton_part)
        if index is None:
            report.bound_parts.append(
                f"{child_name} -> {ref.skeleton_part} (no such bone)")
            return None
        rotation, translation = skeleton.relative(index, main_index)
        main = skeleton.bones[main_index].name if main_index is not None else "root"
        report.bound_parts.append(
            f"{child_name} -> {skeleton.bones[index].name} (relative to {main})")
        return rotation, translation, skeleton.bones[index].name

    def _alternative_is_first_person(self, template: con_mod.ObjectTemplate,
                                     ref: con_mod.ChildRef) -> bool:
        return alternative_is_first_person(self.library, template, ref)

    def _reaches_first_person(self, template_name: str) -> bool:
        key = template_name.lower()
        if key not in self._first_person_reach:
            self._first_person_reach[key] = reaches_first_person(
                self.library, template_name)
        return self._first_person_reach[key]

    def _lod_alternative(self, template: con_mod.ObjectTemplate,
                         children_refs: list[con_mod.ChildRef],
                         ) -> con_mod.ChildRef:
        """This LodObject's alternative, judged by its own declared selector.

        The selector is what separates a building's LOD ladder from a
        cockpit's state swap; without it a building resolves to its far shell.
        See `con.select_lod_alternative`.
        """
        return con_mod.select_lod_alternative(
            children_refs, self.configuration,
            self.library.selector(template.lod_selector))

    def _select_lod_children(self, children_refs: list[con_mod.ChildRef],
                             report: Report, template: con_mod.ObjectTemplate,
                             ) -> list[con_mod.ChildRef]:
        # The propeller's blade/blur pair is not a pick-one alternative like
        # every other LodObject here — the engine keeps both meshes and swaps
        # which is visible as the throttle opens, so a third-person export
        # keeps both too. See `con.is_propeller_blur_pair` and `_propeller_blur`.
        # The selector goes with it: the bf109's cockpit wears the same
        # `Static`/`Blurred` names and is not a propeller.
        if not self.first_person and con_mod.is_propeller_blur_pair(
                children_refs, self.library.selector(template.lod_selector)):
            report.selected_lod_alternatives.append(
                f"{template.name} -> "
                + " + ".join(child.template for child in children_refs))
            return list(children_refs)
        selected = self._lod_alternative(template, children_refs)
        if self.first_person:
            # The cockpit export wants exactly the alternative every other
            # export refuses. The index alone cannot find it: the exterior
            # sits first under a cockpit `DistCompareSelector` and second under
            # a steering wheel's `DistanceSelector`. See
            # `alternative_is_first_person`.
            first_person = next(
                (child for child in children_refs
                 if self._alternative_is_first_person(template, child)),
                None)
            if first_person is not None:
                selected = first_person
        elif self._alternative_is_first_person(template, selected):
            third_person = next(
                (child for child in children_refs
                 if child is not selected
                 and not self._alternative_is_first_person(template, child)),
                None)
            if third_person is not None:
                selected = third_person
        report.selected_lod_alternatives.append(
            f"{template.name} -> {selected.template}")
        report.skipped_lod_alternatives += [
            child.template for child in children_refs if child is not selected
        ]
        return [selected]

    def _lod_swap(self, template: con_mod.ObjectTemplate,
                  children_refs: list[con_mod.ChildRef],
                  selected: con_mod.ChildRef) -> dict | None:
        """How a viewer turns this LodObject's 3P alternative into the 1P one.

        A cockpit glb is grafted onto an ordinary export of the same vehicle, so
        it has to say *where*: this rides the LodObject node, whose name is the
        same in both files, and names the siblings the graft displaces.

        The declared thresholds come along because they are the engine's own
        rule and a viewer should not have to hardcode one. Read across all 33
        vanilla cockpit `DistCompareSelector`s they are strikingly uniform:
        every single one declares `addLodComparison 0.5` against a 0/1 scalar
        with the exterior as alternative 0 and the interior as alternative 1,
        while `addLodDistance` ranges from 0.5 m (M10) through 20 m (Corsair)
        to 200 m (the battleship gun) and the Chi-ha's declares none at all.
        A term that varies with the size of the object and can be omitted is
        not the term that decides which alternative you see — the comparison
        is. The distance reads as a precondition on the occupancy test, and it
        can never veto for an observer sitting at the eye point.
        """
        if not self._alternative_is_first_person(template, selected):
            return None

        # The graft matches by node name, so name the nodes this export
        # writes: an alternative declared `setRandomGeometries` is built as
        # `<name>1` (`con.instance_template_name`). DC's Lada and Pickup named
        # a bare `LadaCockpitExternal` here and hid nothing. A level bake
        # rolls the variant per placement (`_rolled_template_name`), so the
        # swap names every declared variant; the graft hides whichever one
        # the hull it lands on carries.
        def node_name(ref: con_mod.ChildRef) -> str:
            return con_mod.instance_template_name(ref, self.library.object) or ref.template

        def node_names(ref: con_mod.ChildRef) -> list[str]:
            count = ref.random_geometries or 0
            if count > 1 and self.library.object(ref.template) is None:
                variants = [f"{ref.template}{k}" for k in range(1, count + 1)
                            if self.library.object(f"{ref.template}{k}") is not None]
                if variants:
                    return variants
            return [node_name(ref)]

        swap = {
            "selected": node_name(selected),
            "replaces": [name for child in children_refs if child is not selected
                         for name in node_names(child)],
        }
        if selector := self.library.selector(template.lod_selector):
            swap.update(selector.as_dict())
        return swap

    def _propeller_blur(self, template: con_mod.ObjectTemplate,
                        selected_refs: list[con_mod.ChildRef]) -> dict:
        """How a viewer swaps the blade mesh for the blurred disc as throttle opens.

        Stamped on the LodObject wrapper rather than on either mesh: both
        children keep the wrapper's name-lookup convention already used for
        `spinsChildren`/`cameraView`/etc, so the viewer finds them by name
        instead of guessing which of two sibling nodes is which. The
        comparison rides along for the same reason `_lod_swap` carries one —
        it is the engine's own number (`addLodComparison 0.07` on every
        vanilla propeller), not a constant a viewer should have to hardcode.
        """
        static, blurred = con_mod.propeller_blur_halves(
            selected_refs, self.library.selector(template.lod_selector))
        blur = {"static": static.template, "blurred": blurred.template}
        if selector := self.library.selector(template.lod_selector):
            blur.update(selector.as_dict())
        return blur

    def _lightmap_rel(self, template: con_mod.ObjectTemplate,
                      world_origin: tuple[float, float, float]) -> str | None:
        if not self.lightmaps or not template.geometry:
            return None
        geom = self.library.geometry(template.geometry)
        mesh_file = geom.mesh_file if geom else template.geometry
        if not mesh_file:
            return None
        return self.lightmaps.get(object_lightmap_key(mesh_file, world_origin))

    def _rolled_template_name(self, ref: con_mod.ChildRef) -> str | None:
        """The template a child builds, rolled when a level bake rolls.

        `BundleTemplate::addBundleChilds` (`0x081a8300`, ledger KIT-1, KIT-2):
        a child with `setRandomGeometries N` bumps the one counter and creates
        `<name><counter>`; a variant the data never declared adds nothing
        (KIT-3). Without a counter, or for a child whose bare name exists (the
        exporter's standing reading of LOAD-6), this is
        `con.instance_template_name`.
        """
        name = con_mod.instance_template_name(ref, self.library.object)
        count = ref.random_geometries or 0
        if (name is None or self.random_counter is None or count < 1
                or self.library.object(ref.template) is not None):
            return name
        self.random_counter += 1
        if self.random_counter > count:
            self.random_counter = 1
        rolled = f"{ref.template}{self.random_counter}"
        return rolled if self.library.object(rolled) is not None else None

    def _carries_engine(self, template_name: str, *,
                        depth: int = 0,
                        stack: frozenset[str] = frozenset()) -> bool:
        """Whether an Engine sits anywhere under the template, every LOD
        alternative and nested seat included: an Engine pushes on the root
        object's physics node wherever in the tree it is (PHY-17)."""
        if depth > 24:
            return False
        template = self.library.object(template_name)
        if template is None:
            return False
        if template.kind.lower() == "engine":
            return True
        key = template.name.lower()
        if key in stack:
            return False
        stack = stack | {key}
        return any(
            self._carries_engine(name, depth=depth + 1, stack=stack)
            for ref in template.children
            if (name := con_mod.instance_template_name(ref, self.library.object)))

    def _has_visible_spring(self, template_name: str, *,
                            depth: int = 0,
                            stack: frozenset[str] = frozenset()) -> bool:
        if depth > 24:
            return False
        template = self.library.object(template_name)
        if template is None or template.invisible:
            return False
        key = template.name.lower()
        if key in stack:
            return False
        if (template.kind.lower() == "spring"
                and template.geometry
                and not geometry_is_first_person(template.geometry)):
            return True
        stack = stack | {key}
        children = template.children
        if template.is_lod_selector and children:
            selected = self._lod_alternative(template, children)
            if self._alternative_is_first_person(template, selected):
                third_person = next(
                    (child for child in children
                     if child is not selected
                     and not self._alternative_is_first_person(template, child)),
                    None)
                if third_person is not None:
                    selected = third_person
            children = [selected]
        for ref in children:
            name = con_mod.instance_template_name(ref, self.library.object)
            if name and self._has_visible_spring(name, depth=depth + 1, stack=stack):
                return True
        return False

    def _spin_reaches_visible_mesh(self, template_name: str, *,
                                   depth: int = 0,
                                   lod_alternative: bool = False,
                                   stack: frozenset[str] = frozenset()) -> bool:
        """Whether an Engine child carries any mesh the spin would actually turn.

        The spin stops at `hasMobilePhysics 1` boundaries — those are physics
        bodies of their own — but the flag can sit one level below the child
        the Engine places: the Ilyushin's gear-hatch Bundle is a mesh-less
        plain wrapper whose only visible content is two mobile-physics hatch
        covers. Spinning the wrapper spins exactly the geometry the engine
        never spins, so a child with nothing visible outside such boundaries
        gets no track. A LodObject's alternatives are exempt from the cut:
        they are one visual part, not attachments — EoD stamps
        `hasMobilePhysics 1` on the CH-47's propeller meshes themselves, and
        the physics body those flags describe is the helicopter, not the
        rotor.
        """
        if depth > 24:
            return False
        template = self.library.object(template_name)
        if template is None or template.invisible:
            return False
        if depth > 0 and template.has_mobile_physics and not lod_alternative:
            return False
        key = template.name.lower()
        if key in stack:
            return False
        if template.geometry and not geometry_is_first_person(template.geometry):
            return True
        stack = stack | {key}
        children = template.children
        if template.is_lod_selector and children:
            children = [self._lod_alternative(template, children)]
        return any(
            (name := con_mod.instance_template_name(ref, self.library.object))
            and self._spin_reaches_visible_mesh(
                name, depth=depth + 1,
                lod_alternative=template.is_lod_selector, stack=stack)
            for ref in children
        )

    # -- tree --------------------------------------------------------------- #

    def build_node(self, builder: gltf.GlbBuilder, template_name: str, report: Report,
                   *, position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0),
                   depth: int = 0, stack: frozenset[str] = frozenset(),
                   control: str = "",
                   body_skin: skin.Skin | None = None,
                   world_origin: tuple[float, float, float] | None = None,
                   bind: tuple[ske.Matrix3, ske.Vector3, str] | None = None,
                   skeleton_scope: tuple[ske.Skeleton | None, int | None, str | None]
                   = (None, None, None),
                   first_person_branch: bool = False,
                   collision_scope: CollisionScope | None | object = _UNSCOPED,
                   ) -> int | None:
        if depth > 24:
            return None
        if world_origin is None:
            world_origin = position
        template = self.library.object(template_name)
        if template is None:
            report.unresolved_templates.append(template_name)
            return None
        key = template.name.lower()
        if key in stack:
            return None  # a template that contains itself; the engine LODs out of it
        stack = stack | {key}
        # A placement, a model export or a spawner's held object is an engine
        # root, and its `hasCollisionPhysics` rules everything under it
        # (COL-17). A gun or vehicle inside it keeps the old rule.
        collision_root = collision_scope is _UNSCOPED
        if collision_root:
            collision_scope = collision_scope_for(self.library, template)
        elif keeps_old_collision_rule(template):
            collision_scope = None

        # Physics-only parts (Elco's Willy wheels, some KettenKrad springs).
        # The engine still steers them; it just does not draw the mesh.
        #
        # A `Spring` among them is a wheel the drive stands on, and it is kept:
        # a node with its transform, its `physics` and its geometry's name and
        # collision probes, and nothing drawn. `createInvisible` only stops the
        # object being drawn; its PhysicsSpring and ResponsePhysics are built as
        # any other's, and `checkVsTerrain` probes the same col0 vertices. The
        # KettenKrad stands on two of them behind its tracks (`KettenKradBack
        # SpringL/R`), the R75 and HD_XA42 on the sidecar's front wheel, the
        # LVT4 drives through its `S_Wheel_L3/R3`, and dropping them left the
        # KettenKrad on one wheel, lying on its back, and the two bikes on
        # three, tipped onto their sides and sliding off at 30 m/s.
        undrawn = template.invisible and template.kind.lower() == "spring"
        if template.invisible and not undrawn:
            return None

        # EffectBundles never reach the ordinary walk usefully: their Emitter
        # children link to their payloads with `ObjectTemplate.template`, not
        # `addTemplate`, so every child looks meshless and the whole flash
        # vanishes. Bake the additive payloads instead.
        if template.kind.lower() == "effectbundle":
            if not self.include_effects:
                return None
            return self._effect_bundle_node(
                builder, template, report,
                position=position, rotation=rotation, depth=depth)

        # Player inputs are scoped to a seat, not to the vehicle. `c_PIMouseLookY`
        # on a tank's gun and on the commander's MG are two different players'
        # mice — the MG sits inside its own PlayerControlObject. Treating the name
        # as global welds the two together, which is not how either tank behaves.
        control = template.control_scope(control)

        if template.kind.lower() == "bfsoldier":
            body_skin = self._soldier_body_skin(template)

        skeleton_scope = self._skeleton_scope(template, skeleton_scope, report)

        # A cockpit export is the exact complement of an ordinary one: the only
        # geometry it may carry is first person, and the only geometry every
        # other export may carry is not. Neither ever draws both, because the
        # two are alternatives of the same surface. First person is the mesh's
        # name, or a place: the near rung a short `DistanceSelector` chose.
        node_first_person = (geometry_is_first_person(template.geometry)
                             or first_person_branch)
        mesh_index, triangles = (None, 0)
        collision_meshes: list[tuple[int, int, str]] = []
        if template.geometry and node_first_person == self.first_person and undrawn:
            # The undrawn wheel above: its probes, never its mesh.
            if self._object_emits_geometry_collision(
                    template, collision_scope, root=collision_root):
                collision_meshes = self._collision_for_geometry(
                    builder, template.geometry, report)
        elif template.geometry and node_first_person == self.first_person:
            mesh_index, triangles = self._mesh_index(builder, template.geometry, report)
            # TM-5: TreeMesh hulls only when HCP∧SCM — same gate as
            # `_collision_only_node`. StandardMesh still attaches freely.
            if self._object_emits_geometry_collision(
                    template, collision_scope, root=collision_root):
                # Through the hull lookup rather than the cache alone, and
                # only while hulls are on. The effects bake turns them on for
                # a spawned object and off again: a mesh a particle built
                # while they were off is cached with no hull, and
                # `_mesh_index` hands it back from its own cache without
                # looking again, so a spawned object sharing it came out
                # hollow; and a particle built after one took its hulls,
                # which a mesh particle's clone would draw.
                collision_meshes = (self._collision_for_geometry(
                    builder, template.geometry, report)
                    if self.include_collision else [])

        children_refs = template.children
        lod_swap: dict | None = None
        propeller_blur: dict | None = None
        # An alternative this export does not draw, whose hull it still owes
        # the world. See `_collision_for_geometry`.
        collision_makeup: con_mod.ChildRef | None = None
        # A LodObject one of whose alternatives is a first-person mesh is a
        # cockpit pair, and this export is where the cockpit graft lands: the
        # wrapper node is the host the `.cockpit.glb` attaches to, matched by
        # name (`graftCockpit` in flight.js). Some vanilla pairs offer this
        # export nothing to draw — the M3A1 and the Priest name both of their
        # cockpit alternatives after the same `1P_*` mesh, and the naval guns'
        # `...Dummy` side is meshless — so the wrapper survives as an empty
        # group rather than vanishing with its children and leaving the graft
        # nowhere to land.
        cockpit_host = (
            not self.first_person
            and template.is_lod_selector
            and any(self._alternative_is_first_person(template, ref)
                    for ref in children_refs)
        )
        if template.is_lod_selector and children_refs:
            selected_refs = self._select_lod_children(
                children_refs, report, template)
            if self.first_person:
                lod_swap = self._lod_swap(template, children_refs, selected_refs[0])
            elif len(selected_refs) == 2 and con_mod.is_propeller_blur_pair(
                    selected_refs, self.library.selector(template.lod_selector)):
                propeller_blur = self._propeller_blur(template, selected_refs)
            if self.include_collision and not self.first_person:
                if collision_scope is not None:
                    # The engine tests a LodObject at its highest LOD, the
                    # first alternative, whichever one is drawn (COL-17), so
                    # that one's hulls are the object's and no other's are.
                    if not any(ref is children_refs[0] for ref in selected_refs):
                        collision_makeup = children_refs[0]
                else:
                    donor = self._collision_alternative(children_refs, template)
                    drawn = self._collision_triangles(
                        con_mod.instance_template_name(
                            selected_refs[0], self.library.object) or "")
                    if (donor is not selected_refs[0]
                            and self._collision_triangles(
                                con_mod.instance_template_name(
                                    donor, self.library.object) or "") > drawn):
                        collision_makeup = donor
            children_refs = selected_refs

        # The near rung of a short `DistanceSelector` is first person by where
        # it is drawn, and a cockpit selector's inside alternative by the view
        # that selects it, not by what either is called, so everything under
        # them is the cockpit export's, whatever its meshes are named.
        child_first_person_branch = first_person_branch or (
            template.is_lod_selector and bool(children_refs)
            and ((children_refs[0] is template.children[0]
                  and near_rung_is_first_person(self.library, template))
                 or children_refs[0] is inside_view_alternative(
                     self.library, template)))

        child_indices: list[int] = []
        built_children: list[tuple[con_mod.ChildRef, str, int]] = []
        for ref in children_refs:
            child_name = self._rolled_template_name(ref)
            if child_name is None:
                continue
            # A child ObjectSpawner is not a part — it is the engine's parked
            # vehicle, held at the spawner's placed offset until it is
            # entered. Resolve the hull on the spawner itself (its own team
            # picks, team 2 then team 1 — the same rule a level spawn
            # follows) and assemble it as a static child, stamped with the
            # spawner's record. A spawner that names no vehicle is genuinely
            # empty in-game too — the node is dropped, not guessed.
            spawner = self.library.object(child_name)
            held_record: dict | None = None
            held_name: str | None = None
            if spawner is not None and spawner.is_spawner:
                held_name = spawner.spawn_vehicle_name()
                if held_name is None:
                    report.unresolved_templates.append(child_name)
                    continue
                if self.library.object(held_name) is None:
                    report.unresolved_templates.append(held_name)
                    continue
                held_record = spawner.spawner_record(spawner_name=spawner.name)
                child_name = held_name
            # Prune to the cockpit. Without this the walk would still descend
            # the whole vehicle and emit a second, mesh-less copy of its
            # drivetrain, guns and camera — nodes that already exist in the
            # export this one gets grafted onto, under the same names.
            if (self.first_person and not child_first_person_branch
                    and not self._reaches_first_person(child_name)):
                continue
            # The soldier's parachute, and anything else bound to a skeleton this
            # parent cannot pose — see `is_foreign_skeleton_part`. Scoped to
            # soldiers because that is where the sweep behind that predicate was
            # done; a vehicle's animated parts are a different question nobody
            # has asked yet.
            if template.kind.lower() == "bfsoldier":
                child_template = self.library.object(child_name)
                if (child_template is not None
                        and is_foreign_skeleton_part(child_template, template)):
                    report.skipped_foreign_skeletons.append(
                        f"{child_name}: skeleton {child_template.skeleton} is not "
                        f"{template.name}'s to pose")
                    continue
            child = self.build_node(
                builder, child_name, report,
                position=ref.position, rotation=ref.rotation,
                depth=depth + 1, stack=stack, control=control,
                body_skin=body_skin,
                world_origin=world_origin,
                bind=self._bind_pose(
                    ref, child_name, skeleton_scope[0], skeleton_scope[1], report),
                skeleton_scope=skeleton_scope,
                first_person_branch=child_first_person_branch,
                # What a spawner holds is a root of its own in the engine; an
                # alternative the engine does not test carries no hull.
                collision_scope=(_UNSCOPED if held_record is not None
                                 else _NEVER_TESTED
                                 if (collision_scope is not None
                                     and template.is_lod_selector
                                     and ref is not template.children[0])
                                 else collision_scope),
            )
            if child is not None:
                if held_record is not None:
                    # Stamp the held vehicle with where it came from. The
                    # record rides `extras.heldSpawner` on the vehicle node
                    # itself (not on a wrapper): the spawner is meshless and
                    # behaviour-only, and the engine's held object IS the
                    # vehicle parked at the spawner's offset. The spawner's
                    # own setPosition/setRotation are already the node's
                    # transform — they were passed through as this child's
                    # placement above.
                    node = builder.node(child)
                    node.extras = {**(node.extras or {}),
                                   "heldSpawner": held_record}
                    report.held_spawners.append(
                        f"{held_record['spawner']} -> {held_name}"
                        f" at {'/'.join(f'{v:g}' for v in ref.position)}")
                child_indices.append(child)
                built_children.append((ref, child_name, child))

        # An Engine's rotation axis does not pose the Engine. `EngineTemplate`
        # derives from `RotationalBundleTemplate` (`EngineTemplate::
        # EngineTemplate`, 0x0823efc0 lnx, calls the RotationalBundleTemplate
        # ctor), which is the only reason a `.con` may write `setInputToRoll
        # c_PIThrottle` / `setMaxSpeed 500` on one at all — but the object the
        # template creates is a `PhysicsEngine`, and *that* derives from
        # `PhysicsNode` (`PhysicsEngine::PhysicsEngine`, 0x0824c6f0 lnx), not
        # from `RotationalBundle`. `RotationalBundle::handleUpdate`
        # (0x081d78e0 lnx) is the code that turns those three numbers into a
        # transform — `calculateAndClipAngle` per axis, `setRotation`,
        # `Bundle::getBundleTransformation`, then the node's setter — and a
        # PhysicsEngine does not inherit it. So the engine never applies the
        # declared rotation to its own node, and therefore never to the
        # nineteen nodes hanging under a Corsair's.
        #
        # What it does instead is the tail of `PhysicsEngine::updatePhysics`
        # (0x0057bfb0): two interface queries down to one specific object,
        # then a rotation speed (`throttle * 400` while |throttle| < 0.08,
        # else `throttle * 20`) and the LOD comparison value pushed into it.
        # That object is the propeller. The spin is a hand-off to one named
        # visual part, not a parent transform — Refractor's physics tree and
        # its visual tree are not the same tree.
        #
        # We reproduce the hand-off: the plain visual children (the propeller
        # LodObject), never the sub-parts that are physics bodies of their own
        # (`hasMobilePhysics 1`). An Engine with a mesh of its own (carrier
        # screws) simply is the propeller, and spins itself instead.
        spin_axes = engine_spin_axes(template)
        engine_self_spins = bool(spin_axes) and mesh_index is not None
        spun_children: list[str] | None = None
        if spin_axes and not engine_self_spins:
            spun_children = []
            for ref, child_name, node_index in built_children:
                child_template = self.library.object(child_name)
                if child_template is None or child_template.has_mobile_physics:
                    continue
                if not self._spin_reaches_visible_mesh(child_name):
                    continue
                # Stamp the decision on the node as well as baking it into a
                # clip. A level bake carries no clips at all, so a viewer that
                # drives the rig itself — the flythrough's pilot mode — has no
                # other way to know the rule, and the obvious guess (rotate the
                # Engine node, since that is where the rig is declared) drags
                # every physics body with it: a Corsair's landing gear ends up
                # orbiting its own propeller.
                spun = builder.node(node_index)
                spun.extras = {**(spun.extras or {}), "spinsWithEngine": True}
                spun_children.append(child_name)
                for axis, speed in spin_axes.items():
                    # `frame="parent"`: the spin happens about the Engine's
                    # axis, which the child sees as a pre-multiplied rotation
                    # (its own authored rotation — the Huey tail rotor's
                    # -90 yaw — stays innermost).
                    self._spin_tracks.append({
                        "node": node_index,
                        "axes": {axis: speed},
                        "position": ref.position,
                        "rotation": ref.rotation,
                        "frame": "parent",
                        # An Engine's spin is bound to c_PIThrottle: it turns
                        # because someone is aboard with the throttle open.
                        "gate": "throttle",
                    })
                    report.animated_parts.append(
                        f"{child_name} {axis} {speed:g} deg/s (from {template.name})")

        if self.include_collision:
            for collision_mesh, layer, role in collision_meshes:
                child_indices.append(builder.add_node(gltf.Node(
                    name=f"{template.name} collision {layer}",
                    mesh=collision_mesh,
                    extras=self._collision_extras(template, layer, role),
                )))
            if collision_makeup is not None:
                donor_name = con_mod.instance_template_name(
                    collision_makeup, self.library.object)
                hull = self._collision_only_node(
                    builder, donor_name or "", report,
                    position=collision_makeup.position,
                    rotation=collision_makeup.rotation,
                    depth=depth + 1, stack=stack, scope=collision_scope)
                if hull is not None:
                    child_indices.append(hull)
                    report.collision_makeup.append(
                        f"{template.name}: hull from {donor_name} "
                        f"(drawn alternative carries less)")

        # A FireArms that launches something gets muzzle nodes (and, for plane
        # guns, its `visibleBarrelTemplate` flash baked under each one).
        # HandFireArms is the same contract held in a hand: the K98 declares
        # `projectileTemplate` and `roundOfFire` exactly like a wing gun, so
        # it earns the same muzzle node and firing extras.
        fire_extras: dict | None = None
        if (template.kind.lower() in ("firearms", "handfirearms")
                and template.projectile_template):
            muzzle_nodes, fire_extras = self._fire_arms(
                builder, template, report, control, depth)
            child_indices += muzzle_nodes

        # A Camera has no geometry and usually no children, but its placement
        # IS the seat's viewpoint — worth a (mesh-less) node so a viewer can
        # snap its own camera to the pilot's or gunner's eyes, and parked
        # inside the turret it was authored in so it traverses with it.
        # Meshless FireArms survive the same way: their muzzles are the seat's
        # guns (a Spitfire's wing guns are nodes on empty air).
        # An EntryPoint and a SeatObject are meshless for the same reason a
        # Camera is: their placement *is* the datum. The entry point is where
        # a soldier walks in from (with `setEntryRadius` as its reach) and the
        # seat is where the occupant sits. Dropping them cost the viewer 69
        # entry points and 66 seats across vanilla, which is every answer to
        # "where do you get in, and where do you end up".
        # A meshless physics part is a third kind of node whose placement is
        # the datum. The Ilyushin proves it on purpose: its visible ailerons
        # are RotationalBundles with geometry and no aerodynamics, and its
        # *physics* ailerons are Wings with no geometry at all, driven by the
        # same input at the same rates. Drop those and the aircraft has no
        # roll authority in data. A destroyer is worse — the eight
        # `Fletcher_Floater` instances an export carries are the whole reason
        # the hull sits level, and every one of them is a bare buoyancy
        # point.
        #
        # Keyed on there being physics to carry, not on the class: an Engine
        # whose every wheel was `createInvisible` still has nothing to say,
        # and a node for it would be a node for nothing.
        kind = template.kind.lower()
        is_camera = kind == "camera"
        is_placement = kind in ("entrypoint", "seatobject")
        # A SupplyDepot is meshless for the same reason: its placement is the
        # datum a soldier or vehicle has to stand inside `supply_radius` of.
        # Kept as its own flag rather than folded into `is_placement` because
        # the two build unrelated extras blocks (`seat` vs `supply`) below.
        is_supply_depot = kind == "supplydepot"
        is_vehicle_root = kind == "playercontrolobject"
        is_physics_body = kind in con_mod.PHYSICS_TEMPLATE_KINDS
        physics = template.physics()
        stamp_only = False
        if (depth == 0 and not template.has_mobile_physics
                and kind not in con_mod._EFFECT_KINDS
                and (template.mobile_physics_declared or is_vehicle_root)):
            # PHY-17: a root whose `hasMobilePhysics` bit is clear gets a
            # `StaticPhysicsNode`; it never integrates, every push on it
            # (its own Engines, Wings and floats, gravity, a contact) is a
            # bare `ret`, and it stays where it was placed whoever is aboard.
            # Stamped only on the placed root (a nested part's own bit moves
            # nothing: every push lands on the root's node), and only where
            # the `.con` says so or the root is a PlayerControlObject whose
            # bit is clear: DC's `Nimitz_Static*` carriers, its objective
            # buildings (No Fly Zone's towers and hangars, Medina Ridge's
            # `flagkill`), vanilla Battle of Britain's factories and radar
            # towers, and the stationary guns, whose bit is clear because
            # they never write the word (viewer-ships 25.3). Those last were
            # left unstamped until 2026-10-10 and the page parked them as
            # bodies: FH's Nebelwerfer, whose wheels are no Springs, was
            # thrown 9 to 13 m into the air at load (Gold Beach).
            # A root the stamp alone would keep (no mass, no Engine, never
            # wrote the word) is no reason to keep a node: a cockpit export
            # still prunes a held branch with nothing first-person under it.
            stamp_only = not physics and not (
                template.mobile_physics_declared
                or self._carries_engine(template.name))
            physics = {**(physics or {}), "hasMobilePhysics": False}
        # A node carrying `addSkeletonIK` is a placement datum too: it is where
        # a seated occupant's hand goes. `Vehicles/Common`'s four `Attach_*`
        # bundles are meshless and childless and are nothing *but* that, so
        # without this they would be dropped and their IK with them.
        #
        # A cockpit swap whose interior draws nothing is still a swap. DC's
        # M1A1, T72 and Shilka name a gunner interior (`1p_M1A1_Gunner_m1`)
        # whose `GeometryTemplate.file` is commented out, and the SCUD-B one
        # whose `.sm` ships nowhere; EoD's Chi-ha names a GeometryTemplate
        # nobody creates. The engine draws the selected alternative anyway,
        # and nothing in its place: the Inside view sets the cockpit
        # selector's compare value to 1 (`Camera::setViewMode` 0x081ac7c0 ->
        # `lodObjectOn` 0x081adbb0), which picks alternative 1 without
        # consulting the children (`DistCompareLodSelector::
        # getLodLevelRelative` 0x08213e10); `LodObject::getChild` 0x08216ce0
        # returns that child as is; and the child exists with no geometry,
        # because `SimpleObject`'s constructor ignores a `world::setGeometry`
        # (0x0818d3c0) that came back empty when the template was never
        # created or its `.sm` would not open (`load` 0x083a6050). So first
        # person hides the exterior half and shows nothing, and the wrapper
        # is kept here with its `lodAlternative` stamp so the viewer's graft
        # hides the same thing. Dropped, the cockpit glb came out one bare
        # root node and the turret face stayed drawn around the camera.
        if (mesh_index is None and not child_indices
                and not (is_camera or is_placement or is_supply_depot
                         or (physics and not stamp_only)
                         or template.skeleton_ik_bones or cockpit_host
                         or lod_swap is not None)):
            return None

        if mesh_index is not None:
            report.parts += 1
            report.triangles += triangles
            report.part_tree.append(f"{'  ' * depth}{template.name} [{template.geometry}] {triangles} tris")
        else:
            report.part_tree.append(f"{'  ' * depth}{template.name} ({template.kind})")

        extras: dict = {"templateKind": template.kind, "geometry": template.geometry,
                        "control": control or "vehicle"}
        if fire_extras is not None:
            extras["fireArms"] = fire_extras
        if lod_swap is not None:
            extras["lodAlternative"] = lod_swap
            report.cockpit_swaps.append(
                f"{template.name}: {lod_swap['selected']} replaces "
                + ", ".join(lod_swap["replaces"]))
        if propeller_blur is not None:
            extras["propellerBlur"] = propeller_blur
            report.propeller_blurs.append(
                f"{template.name}: {propeller_blur['static']} / "
                f"{propeller_blur['blurred']} at {propeller_blur.get('comparisons')}")
        if template.is_lod_selector and (selector := self.library.selector(template.lod_selector)):
            # The selector's class (`LodSelectorTemplate.create <kind>`). The
            # engine's search for the geometry a vehicle root's inertia and box
            # drag read (`findLodGeometry` 0x0818d860, COL-14) takes the first
            # LodObject depth first whose selector is a `DistCompareSelector`
            # (CID 0x94b1), and only the class tells a cockpit LOD from the
            # `DistanceSelector` of a DC AH-6's control stick that the walk
            # meets first (`viewer/ship-spec.js` `inertiaGeometryNode`).
            extras["selectorKind"] = selector.kind
        if template.skeleton_ik_bones:
            # On the node that declares it, not gathered onto the vehicle root.
            # The Willys writes both hands on `WillySteeringDummy`, the
            # AnimatedBundle whose wheel turns, and a viewer pins a hand by
            # reading a live world pose off this subtree — which it cannot do
            # once the entries have been lifted onto the vehicle root
            # (`AnimatedBundle::updateIk`, lnxded `0x08265880`).
            #
            # *Which* pose is `targetChild`: `updateIk` walks `getChild()` and
            # then `targetChild` siblings (`0x82659f4`-`0x8265a1f`) and reads
            # `getAbsoluteTransformation()` off what it lands on, or off the
            # declaring node itself when the index is negative (`0x82659f2`).
            # `con.py` records the engine's own `getNoTemplates() - 1`; here it
            # is re-expressed as an index into the children this export
            # actually built, since a LOD alternative the export drops would
            # otherwise shift it. `targetNode` names the same child, for a
            # reader that would rather match by name than count.
            ik_entries = []
            for ik in template.skeleton_ik_bones:
                declared = ik.get("targetChild", -1)
                ref = (template.children[declared]
                       if 0 <= declared < len(template.children) else None)
                built = next(
                    ((index, child_name)
                     for index, (child_ref, child_name, _node)
                     in enumerate(built_children) if child_ref is ref),
                    None)
                entry = {"bone": ik["bone"], "position": list(ik["position"]),
                         "rotation": list(ik["rotation"]),
                         "targetChild": built[0] if built else -1}
                if built:
                    entry["targetNode"] = built[1]
                    report.skeleton_ik.append(
                        f"{template.name}: {ik['bone']} -> {built[1]} "
                        f"(child {built[0]})")
                elif ref is not None:
                    # Declared against a child this configuration does not
                    # build. Falling back to the declaring node is the same
                    # thing the engine does for an index it cannot resolve,
                    # and is the only frame still available here.
                    report.skeleton_ik.append(
                        f"{template.name}: {ik['bone']} -> child {declared} "
                        f"({ref.template}) not built; pinned to the declaring node")
                else:
                    report.skeleton_ik.append(
                        f"{template.name}: {ik['bone']} -> the declaring node")
                ik_entries.append(entry)
            extras["skeletonIK"] = ik_entries
        if is_camera:
            extras["cameraView"] = {"control": control or "vehicle"}
            if template.camera_view_modes:
                extras["cameraView"]["cvm"] = dict(template.camera_view_modes)
            # Every camera says it, false included: the template's constructor
            # seeds the byte 0, so a missing field only means an older asset.
            extras["cameraView"]["toggleMouseLook"] = bool(template.toggle_mouse_look)
            # The look itself: each bound axis's input, limits, gain and signed
            # acceleration, the camera template's own `rig()`. The node never
            # carries `rig` (no mesh, no children), yet the held look's sense on
            # screen is this pitch `direction` times the profile's invert box
            # (MLK-13, GUN-2), and the shipped pilots' cameras differ in it.
            if (look := template.rig()) is not None:
                extras["cameraView"]["look"] = look
            if template.outside_hud_offset is not None:
                # The nose cam's stand-off from this Camera, Z-mirrored into
                # glTF like every other position the exporter writes, so the
                # viewer adds it to the node's world pose as it is.
                ox, oy, oz = template.outside_hud_offset
                extras["cameraView"]["outsideHudOffset"] = [ox, oy, -oz]
            report.cameras.append(f"[{control or 'vehicle'}] {template.name}")
        if is_placement:
            seat = {"control": control or "vehicle"}
            if template.entry_radius is not None:
                seat["entryRadius"] = template.entry_radius
            if template.seat_flags:
                seat["flags"] = list(template.seat_flags)
            if template.seat_animation_upper_body or template.seat_animation_lower_body:
                seat["poseAnimation"] = {k: v for k, v in {
                    "upperBody": template.seat_animation_upper_body,
                    "lowerBody": template.seat_animation_lower_body,
                }.items() if v is not None}
            extras["seat"] = seat
            report.seats.append(
                f"[{seat['control']}] {template.name} ({kind})"
                + (f" r={template.entry_radius:g}m" if template.entry_radius else "")
                + (" " + ",".join(template.seat_flags) if template.seat_flags else "")
                + (f" pose={template.seat_animation_upper_body}/{template.seat_animation_lower_body}"
                   if template.seat_animation_upper_body or template.seat_animation_lower_body else ""))
        if is_supply_depot:
            # Raw `.con` values, on the node whose placement is the datum --
            # see the comment above `is_supply_depot`. `soundScript` reuses
            # the generic field every template carries; every other key here
            # is unique to a SupplyDepot.
            supply = {key: value for key, value in {
                "radius": template.supply_radius,
                "team": template.supply_team,
                "health": (list(template.supply_set_health)
                           if template.supply_set_health else None),
                "ammoTypes": ([list(t) for t in template.supply_ammo_types]
                              or None),
                "vehicleTypes": ([list(t) for t in template.supply_vehicle_types]
                                 or None),
                "workOnSoldiers": template.supply_work_on_soldiers,
                "workOnVehicles": template.supply_work_on_vehicles,
                "soundScript": template.sound_script,
            }.items() if value is not None}
            extras["supply"] = supply
            report.supply_depots.append(
                f"{template.name}: radius="
                + (f"{template.supply_radius:g}m" if template.supply_radius else "?")
                + f" team={template.supply_team}"
                + (f" ammoTypes={len(template.supply_ammo_types)}"
                   if template.supply_ammo_types else "")
                + (f" vehicleTypes={len(template.supply_vehicle_types)}"
                   if template.supply_vehicle_types else "")
                + (" soldiers" if template.supply_work_on_soldiers else "")
                + (" vehicles" if template.supply_work_on_vehicles else ""))
        if is_vehicle_root:
            # Declared on the vehicle's own root, not on its FireArms
            # children -- see the field comments in `con.ObjectTemplate`
            # ("Vehicle HUD"). A tank's hull gunner is a second, nested
            # PlayerControlObject with its own HUD block (Sherman's
            # `shermanBrowning_PCO1`), so this has to run for every node of
            # this kind in the tree, not just the root.
            hud = {key: value for key, value in {
                "hitpoints": template.hitpoints,
                "maxHitpoints": template.max_hitpoints,
                "vehicleIcon": template.vehicle_icon,
                "numberOfWeaponIcons": template.vehicle_weapon_icons,
                "primaryAmmoIcon": template.vehicle_primary_ammo_icon,
                "primaryAmmoBar": template.vehicle_primary_ammo_bar,
                "secondaryAmmoIcon": template.vehicle_secondary_ammo_icon,
                "secondaryAmmoBar": template.vehicle_secondary_ammo_bar,
                # VHUD-9: half of the turret dial's trigger (the other half is
                # the seat camera being in view mode 3). Only the turreted
                # tanks declare it, so a casemate hull -- Wespe, StuG -- now
                # correctly shows no dial where it used to get one.
                "hasTurretIcon": template.has_turret_icon,
                # VHUD-11: this PCO's own seat-occupancy dot, in the 128x128
                # vehicle-icon texture's space. Carried for the root AND every
                # seat, because each declares its own.
                "vehicleIconPos": (list(template.vehicle_icon_pos)
                                   if template.vehicle_icon_pos else None),
                # `setCrossHairType`, which is a PlayerControlObject word and
                # not a FireArms one: a Sherman declares CHTCrossHair on the
                # tank and again on its hull-gun PCO, a Priest gunner declares
                # CHTIcon, and every passenger seat declares CHTNone. Vanilla
                # spreads the three across 86 PCOs, so there is nothing to
                # infer from the vehicle's shape — without the word the viewer
                # could not tell a tank that draws the cross from a bomber that
                # draws `hk.tga` from a seat that draws neither, and drew
                # nothing for any of them.
                "crossHairType": template.cross_hair_type,
            }.items() if value is not None}
            if hud:
                extras["hud"] = hud
                report.vehicle_hud.append(
                    f"{template.name}: " + ", ".join(f"{k}={v}" for k, v in hud.items()))
            # The Armor block, beside the HUD block and on the same node, so a
            # placed vehicle in a level scene carries what it takes to run one:
            # the tiers a burning tank shows, the threshold it burns from, and
            # the per-second loss once it does. `hud` already carries the two
            # hitpoint words the seated HUD prints; these are the ones the
            # simulation needs and nothing read before.
            armor = {key: value for key, value in {
                "hitpoints": template.hitpoints,
                "maxHitpoints": template.max_hitpoints,
                "criticalDamage": template.critical_damage,
                "hpLostWhileCriticalDamage": template.hp_lost_while_critical_damage,
                "hpLostWhileDamageFromWater": template.hp_lost_while_damage_from_water,
                "hpLostWhileUpSideDown": template.hp_lost_while_upside_down,
                "damageFromWater": template.damage_from_water,
                "splashMaterial": template.material,
            }.items() if value is not None}
            if armor or template.has_armor:
                # How long the object stays once destroyed, and how it goes
                # (HP-19). An absent word is the template default, 10 s with a
                # fade from 8 s. Only beside an Armor's own words: a block
                # with nothing else in it would make a placed PCO look armoured.
                armor.update({key: value for key, value in {
                    "timeToLiveAfterDeath": template.time_to_live_after_death,
                    "fadeAtTimeToLiveAfterDeath": template.fade_at_time_to_live_after_death,
                    "timeToStartFadeAfterDeath": template.time_to_start_fade_after_death,
                    "resetWhenRemoved": template.reset_when_removed,
                    "stayAsDestroyed": template.stay_as_destroyed,
                }.items() if value is not None})
            if template.armor_effects:
                armor["effects"] = [
                    {"hp": threshold, "effect": name,
                     "offset": _armor_effect_offset(offset)}
                    for threshold, name, offset in template.armor_effects]
            if template.has_armor:
                armor["hasArmor"] = True
            if armor:
                extras["armor"] = armor
        if physics:
            # Raw `.con` values in `.con` units, on the part that declared
            # them. Nothing is summed onto the body: a Sherman's drive
            # acceleration lives on `ShermanEngine` and its suspension on
            # twelve separate `ShermanWheel*` nodes, only four of which carry
            # any load. That is where the engine applies them, and an
            # aggregate would lose which wheel is which.
            extras["physics"] = physics
            report.physics_parts.append(
                f"[{control or 'vehicle'}] {template.name} ({template.kind}): "
                + ", ".join(f"{key} {value}" for key, value in physics.items()))
        yaw, pitch, roll = rotation
        if template.kind.lower() == "bfsoldier":
            # Bind-pose soldier meshes stand along Refractor +Z (3ds Max Biped).
            # After the Z mirror they lie along glTF -Z; pitching the root onto
            # +Y is what a browse camera expects, matching vehicles.
            pitch -= 90.0
        node_rotation = gltf.quat_from_ypr(yaw, pitch, roll)
        if bind is not None:
            r_bind, t_bind, bone = bind
            px, py, pz = position
            tx, ty, tz = t_bind
            position = (px + tx, py + ty, pz + tz)
            node_rotation = gltf.quat_mul(node_rotation, gltf.quat_from_matrix(r_bind))
            extras["boundBone"] = bone
        if aligned := self._part_alignment(template, body_skin):
            r_rel, t_rel, bone = aligned
            px, py, pz = position
            tx, ty, tz = t_rel
            position = (px + tx, py + ty, pz + tz)
            node_rotation = gltf.quat_mul(node_rotation, gltf.quat_from_matrix(r_rel))
            extras["alignedBone"] = bone
        # A RotationalBundle with no mesh of its own still drives children, but
        # once every visible child is gone (hidden land wheels, skipped 1P
        # cockpit meshes) the leftover slider would pose empty air. A physics
        # part is the exception the rule was not written for: a meshless Wing's
        # deflection is a force, not a pose, so its range and servo rates are
        # the surface's specification rather than a slider with nothing on it.
        # Deliberately keyed on the class and not on `physics` being non-empty,
        # which would hand a rig to the eight vanilla Cameras that happen to
        # declare a non-zero `setPivotPosition` and to none of the other 46.
        if (rig := browse_rig(template, has_visible_springs=self._visible_springs)
                ) and (mesh_index is not None or child_indices or is_physics_body):
            rig["control"] = control or "vehicle"
            extras["rig"] = rig
            # The rig's rate axis is the one thing on a node that does NOT pose
            # that node, so say so on the node that carries it rather than
            # leaving it to be inferred from flags on the children. `rig` alone
            # reads as "rotate me", and a consumer that believes it swings a
            # Corsair's gear, wheels and bay hatches around the prop shaft.
            #
            # The list is exhaustive and it is emitted even when empty, which
            # is the whole point: an empty `spinsChildren` says "this Engine's
            # axis reaches no drawn geometry" — true of the Willy and the
            # KettenKrad, whose every wheel is its own mobile-physics body —
            # and that is a different statement from the field being absent,
            # which only means the asset predates it. Inferring the first from
            # the second is what put a jeep's wheels on the prop shaft.
            #
            # An Engine that carries a mesh is left without the field, because
            # there the naive reading is the right one: it *is* the propeller
            # (a carrier's screws) and rotating its node is what the engine
            # does. So the rule a consumer needs is total — a meshless Engine
            # with a rate axis always carries `spinsChildren`.
            if spun_children is not None:
                extras["spinsChildren"] = spun_children
            report.rigged_parts.append(
                f"[{rig['control']}] {template.name}: " + ", ".join(
                    f"{axis} " + ("free" if a["free"] else f"{a['min']:g}..{a['max']:g}")
                    + f" from {a['input']}"
                    + (" (rate)" if a["driver"] == "rate" else "")
                    for axis, a in rig["axes"].items()))
        if template.skeleton:
            extras["skeleton"] = template.skeleton
            report.skinned_parts.append(f"{template.name} -> {template.skeleton}")
        if template.geometry:
            geom = self.library.geometry(template.geometry)
            if geom and geom.skin:
                extras["skin"] = geom.skin
                report.skinned_parts.append(f"{template.name} skin {geom.skin}")
            if scale := geometry_scale(geom):
                # Already in the mesh's vertices; said here because the
                # engine's own bounding box and a body's vertex probes read
                # the file unscaled (SM-13), which a consumer may want back.
                extras["geometryScale"] = list(scale)
        if template.animated_texture_speed:
            u, v = template.animated_texture_speed
            # The exporter mirrors Z to get from left-handed Refractor to glTF, and
            # a track belt runs along the vehicle's Z. Mirroring moves the vertex
            # that carried U=0 from the front of the hull to the back without
            # touching its UV, so U now increases the other way down the belt and
            # the declared scroll direction has to be negated to still read as
            # "forward". Every animated texture in vanilla is a track, declared as
            # `<u>/0`, so only U needs it.
            extras["animatedTextureSpeed"] = [-u, v]
        if rel := self._lightmap_rel(template, world_origin):
            extras["lightmap"] = rel

        # Gap 16: a template in the engine's `c_CGLadders` group carries the
        # spec a viewer climbs by, on the node the ladder is PLACED at —
        # top-level for the direct placements, a bundle child for the
        # guard-tower/bunker/dock-repair ones. The spec is in that node's own
        # frame, so a viewer resolves it to world space through the node's
        # world matrix and the bundle's transform composes itself; it rides
        # the part node, so the Gap 11 LOD splice (which takes the rungs, not
        # the part) leaves it where the climb needs it.
        if template.is_ladder and mesh_index is not None and template.geometry:
            spec = self._ladder_spec_for(template.geometry)
            if spec is not None:
                extras["isLadder"] = spec
                report.ladders.append(
                    f"{template.name} [{template.geometry}] "
                    f"length={spec['length']:g} width={spec['width']:g}")

        # Gap 11: a StandardMesh part whose geometry emitted LOD rungs carries
        # them as child nodes (extras.lod), for the viewer to swap by
        # distance. Skinned parts are excluded: their rungs would have to
        # follow the skeleton, and a swap that detaches them mid-pose would
        # need joints the lower rungs do not carry. (A geometry skinned by its
        # own `.skn` never emits a chain; `_mesh_index` checks that.)
        if (self.lod_chains and mesh_index is not None and not template.skeleton
                and template.geometry
                and node_first_person == self.first_person):
            geom_template = self.library.geometry(template.geometry)
            child_indices.extend(self._lod_children_for(
                builder, template.geometry,
                geom_template.mesh_file if geom_template else template.geometry))

        node_index = builder.add_node(gltf.Node(
            name=template.name,
            translation=position,
            rotation=node_rotation,
            mesh=mesh_index,
            children=child_indices,
            extras=extras,
        ))

        # Spin specs need the node's *authored* placement (the keyframes
        # restate it), so they only apply where nothing else has rewritten it:
        # bind poses and soldier-part alignment never occur on vehicle
        # drivetrains or ambient rotators.
        placement_untouched = bind is None and not aligned \
            and template.kind.lower() != "bfsoldier"
        if engine_self_spins and placement_untouched:
            for axis, speed in spin_axes.items():
                self._spin_tracks.append({
                    "node": node_index,
                    "axes": {axis: speed},
                    "position": position,
                    "rotation": rotation,
                    "frame": "local",
                    "gate": "throttle",   # an Engine that is its own propeller
                })
                report.animated_parts.append(
                    f"{template.name} {axis} {speed:g} deg/s (own mesh)")
        if (template.continuous_rotation
                and any(abs(s) >= 0.01 for s in template.continuous_rotation)
                and placement_untouched):
            yaw_s, pitch_s, roll_s = template.continuous_rotation
            axes = {axis: speed for axis, speed in
                    (("yaw", yaw_s), ("pitch", pitch_s), ("roll", roll_s))
                    if abs(speed) >= 0.01}
            self._spin_tracks.append({
                "node": node_index,
                "axes": axes,
                "position": position,
                "rotation": rotation,
                "frame": "local",
                # `setContinousRotationSpeed` on a RotationalBundle. The
                # engine's `handleUpdate` runs this off deltaTime alone and
                # never touches a player, an input or an occupancy value, so
                # a windmill nobody can enter turns — and so does a parked
                # ship's radar. Nine templates in vanilla, and not one of
                # them also carries an input binding.
                "gate": "always",
            })
            report.animated_parts.append(
                f"{template.name} continuous "
                + "/".join(f"{axis} {speed:g}" for axis, speed in axes.items())
                + " deg/s")

        return node_index

    def begin_animations(self) -> None:
        """Start gathering spin specs for a caller that owns the builder.

        `export` does this for itself. A level exporter drives `build_node`
        many times against one shared builder, so it brackets the whole pass
        with this and `flush_animations` instead.
        """
        self._spin_tracks = []

    def flush_animations(self, builder: gltf.GlbBuilder) -> int:
        """Bake everything gathered since `begin_animations`. Returns the
        number of rotating parts baked, for the caller's report."""
        baked = len(self._spin_tracks)
        self._flush_spin_animations(builder)
        return baked

    def _flush_spin_animations(self, builder: gltf.GlbBuilder) -> None:
        """Bake the gathered spin specs as looping glTF rotation clips.

        Tracks are grouped by period and each group becomes its own clip, so
        every clip loops seamlessly at exactly one revolution of its parts —
        no least-common-multiple juggling when a B17 mixes 500 and 600 deg/s
        engines. Keyframes sit every quarter turn of the fastest axis, which
        is as coarse as slerp allows without ever taking the short way round.

        Grouping is by *gate* as well as period, because the two kinds of
        rotation want opposite treatment in a viewer. `spin*` is throttle-gated
        — a propeller, still until someone opens the throttle. `ambient*` runs
        off the clock whatever else is happening: windmills, watermills, and
        the radar dish on a ship nobody has boarded. Separate index sequences
        keep `spin` meaning exactly what it always meant, so shipped model
        assets and the browser's engine toggle are unaffected.
        """
        groups: dict[tuple[str, float], list] = {}
        for track in self._spin_tracks:
            fastest = max(abs(speed) for speed in track["axes"].values())
            period = 360.0 / fastest
            steps = max(4, round(period * fastest / 90.0))
            base = gltf.ypr_matrix(*track["rotation"])
            times, transforms = [], []
            for i in range(steps + 1):
                t = period * i / steps
                spin = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
                for axis in ("yaw", "pitch", "roll"):
                    if axis in track["axes"]:
                        spin = gltf.mat_mul(
                            spin, gltf.AXIS_MATRIX[axis](track["axes"][axis] * t))
                full = (gltf.mat_mul(spin, base) if track["frame"] == "parent"
                        else gltf.mat_mul(base, spin))
                times.append(t)
                transforms.append((full, track["position"]))
            groups.setdefault((track.get("gate", "throttle"), round(period, 6)),
                              []).append(
                (track["node"], tuple(times), transforms))
        counters: dict[str, int] = {}
        for key in sorted(groups):
            stem = "ambient" if key[0] == "always" else "spin"
            index = counters.get(stem, 0)
            counters[stem] = index + 1
            builder.add_animation(
                stem if index == 0 else f"{stem}.{index}", groups[key])

    def export(self, root_template: str) -> tuple[bytes, Report]:
        builder = gltf.GlbBuilder()
        self._spin_tracks = []
        report = Report(
            root=root_template,
            configuration=self.configuration,
            lod=self.lod,
            first_person=self.first_person,
        )
        if template := self.library.object(root_template):
            report.armor = {
                key: value
                for key, value in {
                    "hasArmor": template.has_armor,
                    "hitpoints": template.hitpoints,
                    "maxHitpoints": template.max_hitpoints,
                    "splashMaterial": template.material,
                    "criticalDamage": template.critical_damage,
                "hpLostWhileCriticalDamage": (
                    template.hp_lost_while_critical_damage),
                "hpLostWhileDamageFromWater": (
                    template.hp_lost_while_damage_from_water),
                "hpLostWhileUpSideDown": (
                    template.hp_lost_while_upside_down),
                "damageFromWater": template.damage_from_water,
            }.items()
                if value is not None
            }
            if template.armor_effects:
                report.armor["effects"] = [
                    {"hp": threshold, "effect": name,
                     "offset": _armor_effect_offset(offset)}
                    for threshold, name, offset in template.armor_effects]
            if template.kind.lower() == "handfirearms":
                report.weapon = template.weapon_stats() or {}
        self._visible_springs = self._has_visible_spring(root_template)
        root = self.build_node(builder, root_template, report)
        if root is None:
            raise ValueError(f"nothing renderable resolved for template {root_template!r}")
        self._flush_spin_animations(builder)
        return builder.build([root], extras=report.as_dict()), report
