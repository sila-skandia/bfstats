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
from dataclasses import dataclass, field
from pathlib import Path

from . import con as con_mod
from . import gltf, rs, ske, skin, stdmesh, treemesh
from .level import object_lightmap_key
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


def geometry_is_first_person(geometry_name: str | None) -> bool:
    """Cockpit / 1P view meshes are named `1P_...` (or `1PPT_...`, `1PBritBody`).

    The name is the only reliable tell. The *template* names are not: vanilla's
    cockpit alternatives are called `...CockpitInternal` on 11 aircraft but
    `bf109CockpitBlurred` on the bf109, `KatyushaInterior` on the Katyusha and
    `...HighRSteering` on every steering wheel. The geometry name is uniform
    across all 72 of them.

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
    mesh_lods: dict[str, dict[str, int]] = field(default_factory=dict)
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


class Assembler:
    def __init__(self, meshes: ArchivePool, textures: ArchivePool,
                 objects: ArchivePool, library: con_mod.ObjectLibrary, *,
                 lod: int = 0, max_texture: int = 1024,
                 configuration: str = "complex",
                 include_collision: bool = True,
                 include_effects: bool = True,
                 first_person: bool = False,
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
        self.lightmaps = lightmaps or {}
        # Multiply a material's texture by its `.rs` `materialDiffuse`. Off for
        # the model and map exports, whose lighting is calibrated on white
        # (ledger DL-3); on for the effect library, where the decals' 0.388 grey
        # is the difference between a bullet hole and a pale smudge.
        self.apply_material_diffuse = False
        self._visible_springs = True
        self._shader_cache: dict[str, dict[str, rs.Shader]] = {}
        self._texture_cache: dict[str, int | None] = {}
        self._material_cache: dict[tuple, int] = {}
        self._geom_mesh: dict[str, tuple[int | None, int]] = {}
        self._geom_collisions: dict[str, list[tuple[int, int, str]]] = {}
        # Face counts per geometry, for ranking a LodObject's alternatives
        # against each other before any of them is built.
        self._geom_collision_faces: dict[str, int] = {}
        self._collision_material_cache: dict[int, int] = {}
        self._first_person_reach: dict[str, bool] = {}
        self._skin_cache: dict[str, skin.Skin | None] = {}
        self._skeleton_cache: dict[str, ske.Skeleton | None] = {}
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
        except Exception as exc:  # a texture we cannot decode is still a miss
            report.missing_textures.append(f"{path} ({exc})")
            self._texture_cache[path] = None
            return None

        if self.max_texture and max(width, height) > self.max_texture:
            width, height, rgba = downscale(width, height, rgba, self.max_texture)

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
               shader.texture_fade, shader.envmap, diffuse)
        if key in self._material_cache:
            return self._material_cache[key]

        texture = self._texture_index(builder, texture_path, report) if texture_path else None
        index = builder.add_material(
            name=shader.name,
            texture=texture,
            base_color=(*diffuse, 1.0) if diffuse else (1.0, 1.0, 1.0, 1.0),
            double_sided=shader.twosided,
            # An additive shader's alphaTestRef is a fixed-function cutoff the
            # engine applies *on top of* the blend; keeping MASK would kill the
            # flash's soft falloff, so additive wins.
            alpha_cutoff=None if shader.additive else shader.alpha_test,
            blend=shader.transparent and shader.alpha_test is None,
            unlit=unlit,
            emissive_floor=emissive_floor,
            additive=shader.additive,
            texture_fade=shader.texture_fade,
            envmap=shader.envmap,
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
                if sum(value * value for value in cross) <= 1e-12:
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
        hull is the object's, not the near-LOD's.

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
            mesh = stdmesh.parse(self.meshes.read(entry), entry)
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
            self, template: con_mod.ObjectTemplate) -> bool:
        """Whether this object template's geometry hull should be attached.

        StandardMesh buildings hang the hull off the Bundle regardless of a
        per-object HCP bit in practice. TreeMesh is different (TM-5): emit
        only when `setHasCollisionPhysics 1` **and** the `.tm` has an SCM —
        the SCM half is resolved when the mesh is built; this gate is HCP.
        """
        if not template.geometry:
            return False
        geom = self.library.geometry(template.geometry)
        if geom is not None and geom.kind.lower() == "treemesh":
            return template.has_collision_physics
        return True

    def _collision_only_node(self, builder: gltf.GlbBuilder, template_name: str,
                             report: Report, *, position, rotation,
                             depth: int = 0,
                             stack: frozenset[str] = frozenset()) -> int | None:
        """A transform-faithful skeleton of a subtree carrying only its hulls.

        The undrawn LOD alternative is walked for its collision and nothing
        else: no render meshes, no materials, no FireArms, no cameras. Child
        placements are kept because they are what puts a barrack's beds and a
        hangar's crates where the player will shoot them.
        """
        template = self.library.object(template_name)
        if template is None or depth > 16 or template.invisible:
            return None
        key = template.name.lower()
        if key in stack:
            return None
        stack = stack | {key}

        children: list[int] = []
        if (template.geometry
                and self._object_emits_geometry_collision(template)):
            for mesh_index, layer, role in (
                    self._collision_for_geometry(
                        builder, template.geometry, report)):
                children.append(builder.add_node(gltf.Node(
                    name=f"{template.name} collision {layer}",
                    mesh=mesh_index,
                    extras={
                        "collision": True,
                        "collisionLayer": layer,
                        "collisionRole": role,
                        "sourceTemplate": template.name,
                        "sourceGeometry": template.geometry,
                    },
                )))
        child_refs = template.children
        if template.is_lod_selector and child_refs:
            child_refs = [self._collision_alternative(child_refs)]
        for ref in child_refs:
            child_name = con_mod.instance_template_name(ref, self.library.object)
            if child_name is None:
                continue
            child = self._collision_only_node(
                builder, child_name, report,
                position=ref.position, rotation=ref.rotation,
                depth=depth + 1, stack=stack)
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
                               ) -> con_mod.ChildRef:
        """The LodObject alternative that carries the object's collision hull."""
        return max(
            children_refs,
            key=lambda ref: self._collision_triangles(
                con_mod.instance_template_name(ref, self.library.object) or ""))

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
            mesh = stdmesh.parse(self.meshes.read(entry), entry)
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
                # EMT-6 / V-R2: mesh particles carry `ObjectTemplate.size` the
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

        def build(node: effects_mod.BundleNode, depth: int) -> int | None:
            children: list[int] = []
            for ref, emitter, payload, spec in node.emitters:
                particle = spec["particle"]
                mesh_index: int | None
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

        for name in sorted(set(names), key=str.lower):
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
        # `Projectile::getDamage`'s; `radius`/`material2`/`damageType` are the
        # splash pass (`damageType 1`). Engine default radius is 10 when the
        # `.con` omits it (ProjectileTemplate constructor).
        if projectile.material is not None:
            spec["material"] = projectile.material
        radius = projectile.explosion_radius
        if (radius is None
                and projectile.damage_type == 1
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
        if projectile.end_effect_template:
            spec["endEffect"] = projectile.end_effect_template
        if body is not None and body.geometry:
            spec["kind"] = ("rocket"
                            if self._projectile_has_rocket_engine(projectile)
                            else "shell")
            if self.include_effects:
                mesh_index, _ = self._mesh_index(builder, body.geometry, report)
                if mesh_index is not None:
                    nodes.append(builder.add_node(gltf.Node(
                        name=f"{template.name} projectile",
                        mesh=mesh_index,
                        extras={"templateKind": body.kind,
                                "projectileMesh": {"template": body.name,
                                                   "geometry": body.geometry}},
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
                        nodes.append(builder.add_node(gltf.Node(
                            name=f"{template.name} tracer",
                            mesh=mesh_index,
                            extras={"templateKind": projectile.kind,
                                    "tracerMesh": {
                                        "template": projectile.name,
                                        "geometry": projectile.geometry}},
                        )))
        projectile_spec, projectile_nodes = self._projectile_spec(
            builder, template, report)
        nodes += projectile_nodes
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
            "input": template.input_fire or "c_PIFire",
            "control": control or "vehicle",
            "muzzles": len(muzzles),
            "tracer": tracer,
            "recoil": ({"size": template.recoil_size,
                        "speed": template.recoil_speed}
                       if template.recoil_size else None),
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

    def _geometry_is_first_person(self, template_name: str) -> bool:
        child = self.library.object(template_name)
        return geometry_is_first_person(child.geometry if child else None)

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
        if not self.first_person and con_mod.is_propeller_blur_pair(children_refs):
            report.selected_lod_alternatives.append(
                f"{template.name} -> "
                + " + ".join(child.template for child in children_refs))
            return list(children_refs)
        selected = self._lod_alternative(template, children_refs)
        if self.first_person:
            # The cockpit export wants exactly the alternative every other
            # export refuses. Only the geometry name can find it: the exterior
            # sits first under a cockpit `DistCompareSelector` and second under
            # a steering wheel's `DistanceSelector`.
            first_person = next(
                (child for child in children_refs
                 if self._geometry_is_first_person(child.template)),
                None)
            if first_person is not None:
                selected = first_person
        elif self._geometry_is_first_person(selected.template):
            third_person = next(
                (child for child in children_refs
                 if child is not selected
                 and not self._geometry_is_first_person(child.template)),
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
        if not self._geometry_is_first_person(selected.template):
            return None
        swap = {
            "selected": selected.template,
            "replaces": [child.template for child in children_refs
                         if child is not selected],
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
        static = next(child for child in selected_refs
                     if child.template.lower().endswith("static"))
        blurred = next(child for child in selected_refs
                       if child.template.lower().endswith("blurred"))
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
            if self._geometry_is_first_person(selected.template):
                third_person = next(
                    (child for child in children
                     if child is not selected
                     and not self._geometry_is_first_person(child.template)),
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

        # Physics-only parts (Elco's Willy wheels, some KettenKrad springs).
        # The engine still steers them; it just does not draw the mesh.
        if template.invisible:
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
        # two are alternatives of the same surface.
        mesh_index, triangles = (None, 0)
        collision_meshes: list[tuple[int, int, str]] = []
        if (template.geometry
                and geometry_is_first_person(template.geometry) == self.first_person):
            mesh_index, triangles = self._mesh_index(builder, template.geometry, report)
            # TM-5: TreeMesh hulls only when HCP∧SCM — same gate as
            # `_collision_only_node`. StandardMesh still attaches freely.
            if self._object_emits_geometry_collision(template):
                collision_meshes = self._geom_collisions.get(
                    template.geometry.lower(), [])

        children_refs = template.children
        lod_swap: dict | None = None
        propeller_blur: dict | None = None
        # An alternative this export does not draw, whose hull it still owes
        # the world. See `_collision_for_geometry`.
        collision_makeup: con_mod.ChildRef | None = None
        if template.is_lod_selector and children_refs:
            selected_refs = self._select_lod_children(
                children_refs, report, template)
            if self.first_person:
                lod_swap = self._lod_swap(template, children_refs, selected_refs[0])
            elif len(selected_refs) == 2 and con_mod.is_propeller_blur_pair(selected_refs):
                propeller_blur = self._propeller_blur(template, selected_refs)
            if self.include_collision and not self.first_person:
                donor = self._collision_alternative(children_refs)
                drawn = self._collision_triangles(
                    con_mod.instance_template_name(
                        selected_refs[0], self.library.object) or "")
                if (donor is not selected_refs[0]
                        and self._collision_triangles(
                            con_mod.instance_template_name(
                                donor, self.library.object) or "") > drawn):
                    collision_makeup = donor
            children_refs = selected_refs

        child_indices: list[int] = []
        built_children: list[tuple[con_mod.ChildRef, str, int]] = []
        for ref in children_refs:
            child_name = con_mod.instance_template_name(ref, self.library.object)
            if child_name is None:
                continue
            # Prune to the cockpit. Without this the walk would still descend
            # the whole vehicle and emit a second, mesh-less copy of its
            # drivetrain, guns and camera — nodes that already exist in the
            # export this one gets grafted onto, under the same names.
            if self.first_person and not self._reaches_first_person(child_name):
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
            )
            if child is not None:
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
                    extras={
                        "collision": True,
                        "collisionLayer": layer,
                        "collisionRole": role,
                        "sourceTemplate": template.name,
                        "sourceGeometry": template.geometry,
                    },
                )))
            if collision_makeup is not None:
                donor_name = con_mod.instance_template_name(
                    collision_makeup, self.library.object)
                hull = self._collision_only_node(
                    builder, donor_name or "", report,
                    position=collision_makeup.position,
                    rotation=collision_makeup.rotation,
                    depth=depth + 1, stack=stack)
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
        # A node carrying `addSkeletonIK` is a placement datum too: it is where
        # a seated occupant's hand goes. `Vehicles/Common`'s four `Attach_*`
        # bundles are meshless and childless and are nothing *but* that, so
        # without this they would be dropped and their IK with them.
        if (mesh_index is None and not child_indices
                and not (is_camera or is_placement or is_supply_depot or physics
                         or template.skeleton_ik_bones)):
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
