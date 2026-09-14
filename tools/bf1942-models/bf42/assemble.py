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
    * no usable span at all (EoD helicopter tail rotors declare `100/100`),
      where being bound to `c_PIThrottle` is the tell.

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
        if spec["driver"] == "rate" or (spec["free"] and spec["input"] == "c_PIThrottle"):
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
    """
    rig = template.rig()
    if not rig:
        return None
    if has_visible_springs or template.kind.lower() == "engine":
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
    selected_lod_alternatives: list[str] = field(default_factory=list)
    # Cockpit exports only: which LodObject node each 1P alternative grafts
    # onto, and what it hides there.
    cockpit_swaps: list[str] = field(default_factory=list)
    mesh_lods: dict[str, dict[str, int]] = field(default_factory=dict)
    part_tree: list[str] = field(default_factory=list)
    rigged_parts: list[str] = field(default_factory=list)
    animated_parts: list[str] = field(default_factory=list)
    cameras: list[str] = field(default_factory=list)
    skinned_parts: list[str] = field(default_factory=list)
    bound_parts: list[str] = field(default_factory=list)
    unreadable_skeletons: list[str] = field(default_factory=list)
    collision_parts: int = 0
    collision_triangles: int = 0
    collision_materials: list[int] = field(default_factory=list)
    armor: dict = field(default_factory=dict)
    fire_arms: list[str] = field(default_factory=list)

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
            "meshLods": dict(sorted(self.mesh_lods.items())),
            "partTree": self.part_tree,
            "riggedParts": self.rigged_parts,
            "animatedParts": self.animated_parts,
            "cameras": self.cameras,
            "skinnedParts": self.skinned_parts,
            "boundParts": self.bound_parts,
            "skeletonsNotRead": sorted(set(self.unreadable_skeletons)),
            "collisionParts": self.collision_parts,
            "collisionTriangles": self.collision_triangles,
            "collisionMaterials": sorted(set(self.collision_materials)),
            "armor": self.armor,
            "fireArms": self.fire_arms,
        }


class Assembler:
    def __init__(self, meshes: ArchivePool, textures: ArchivePool,
                 objects: ArchivePool, library: con_mod.ObjectLibrary, *,
                 lod: int = 0, max_texture: int = 1024,
                 configuration: str = "complex",
                 include_collision: bool = True,
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
        # A cockpit export: take the first-person branch at every LodObject that
        # has one, keep only the geometry authored for a camera inside the
        # vehicle, and prune everything else away. The result is meant to be
        # grafted onto an ordinary export of the same template, not viewed on
        # its own — see `geometry_is_first_person` for why the two cannot share
        # one file.
        self.first_person = first_person
        self.lightmaps = lightmaps or {}
        self._visible_springs = True
        self._shader_cache: dict[str, dict[str, rs.Shader]] = {}
        self._texture_cache: dict[str, int | None] = {}
        self._material_cache: dict[tuple, int] = {}
        self._geom_mesh: dict[str, tuple[int | None, int]] = {}
        self._geom_collisions: dict[str, list[tuple[int, int, str]]] = {}
        self._collision_material_cache: dict[int, int] = {}
        self._first_person_reach: dict[str, bool] = {}
        self._skin_cache: dict[str, skin.Skin | None] = {}
        self._skeleton_cache: dict[str, ske.Skeleton | None] = {}
        self._sprite_mesh_cache: dict[str, int | None] = {}
        # Spin keyframe specs gathered during the tree walk; `export` bakes
        # them into glTF animation clips against its own builder. Callers that
        # drive `build_node` with an external builder (the level exporter)
        # simply never flush them.
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
        key = (texture_path, shader.twosided, shader.transparent,
               shader.alpha_test, unlit, emissive_floor, shader.additive)
        if key in self._material_cache:
            return self._material_cache[key]

        texture = self._texture_index(builder, texture_path, report) if texture_path else None
        index = builder.add_material(
            name=shader.name,
            texture=texture,
            double_sided=shader.twosided,
            # An additive shader's alphaTestRef is a fixed-function cutoff the
            # engine applies *on top of* the blend; keeping MASK would kill the
            # flash's soft falloff, so additive wins.
            alpha_cutoff=None if shader.additive else shader.alpha_test,
            blend=shader.transparent and shader.alpha_test is None,
            unlit=unlit,
            emissive_floor=emissive_floor,
            additive=shader.additive,
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
            result = self._treemesh_index(builder, template.mesh_file, report)
            self._geom_mesh[cache_key] = result
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
        if self.include_collision:
            self._geom_collisions[cache_key] = self._collision_mesh_indices(
                builder, mesh_file, mesh, report)
        else:
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
                         report: Report) -> tuple[int | None, int]:
        entry = self.meshes.resolve_ext(f"treeMesh/{mesh_file}", (".tm",))
        if not entry:
            report.missing_meshes.append(mesh_file)
            return None, 0
        try:
            tree = treemesh.parse(self.meshes.read(entry), entry)
        except (stdmesh.MeshError, ValueError, struct.error) as exc:
            report.missing_meshes.append(f"{mesh_file} ({exc})")
            return None, 0

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
            return None, 0
        return builder.add_mesh(mesh_file, primitives), triangles

    # -- effects (muzzle flashes) ------------------------------------------- #

    def _sprite_quad_mesh(self, builder: gltf.GlbBuilder, texture_name: str,
                          report: Report) -> int | None:
        """A unit quad carrying one SpriteParticle texture, additively blended.

        The engine billboards these toward the camera; the viewer does the
        same at run time, so the quad's authored plane (XY, facing +Z) only
        has to be *a* plane.
        """
        key = texture_name.lower()
        if key in self._sprite_mesh_cache:
            return self._sprite_mesh_cache[key]
        texture = self._texture_index(builder, f"texture/{texture_name}", report)
        if texture is None:
            self._sprite_mesh_cache[key] = None
            return None
        material = builder.add_material(
            name=f"fx {texture_name}",
            texture=texture,
            double_sided=True,
            blend=True,
            additive=True,
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
                              report: Report) -> list[int]:
        """The bakeable emitters of an EffectBundle, as tagged hidden nodes.

        Each Emitter child names its payload with `ObjectTemplate.template`:
        a Particle (an ordinary `.sm` mesh — `MuzzHeavy_m1`) or a
        SpriteParticle (a textured quad). Only additive payloads
        (`destBlendMode BMOne`, or an `.rs` declaring `blendDest one`) are
        baked: those are the flash's light. Alpha-blended payloads are smoke
        and dust, which a strobed still image cannot sell.

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
        nodes: list[int] = []
        for ref in bundle.children:
            emitter = self.library.object(ref.template)
            if emitter is None or emitter.emitter_template is None:
                continue
            payload = self.library.object(emitter.emitter_template)
            if payload is None:
                continue
            kind = payload.kind.lower()
            mesh_index: int | None = None
            effect: dict = {}
            if kind == "spriteparticle":
                if (payload.dest_blend_mode or "").lower() != "bmone":
                    continue
                if not payload.sprite_texture:
                    continue
                mesh_index = self._sprite_quad_mesh(
                    builder, payload.sprite_texture, report)
                effect["kind"] = "sprite"
                effect["billboard"] = True
                if payload.sprite_size is not None:
                    effect["size"] = payload.sprite_size
            elif kind == "particle" and payload.geometry:
                # The mesh's own .rs declares the additive blend; the material
                # path picks it up, so no filter is needed here.
                mesh_index, _ = self._mesh_index(builder, payload.geometry, report)
                effect["kind"] = "mesh"
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
            nodes.append(builder.add_node(gltf.Node(
                name=ref.template,
                translation=ref.position,
                rotation=gltf.quat_from_ypr(*ref.rotation),
                mesh=mesh_index,
                extras={"templateKind": payload.kind, "effect": effect},
            )))
        return nodes

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
        body = drawn if drawn is not None and drawn.geometry else projectile
        if projectile.time_to_live is not None:
            spec["timeToLive"] = projectile.time_to_live
        if projectile.gravity_modifier is not None:
            spec["gravity"] = projectile.gravity_modifier
        if body.geometry:
            spec["kind"] = ("rocket"
                            if self._projectile_has_rocket_engine(projectile)
                            else "shell")
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
                if projectile.geometry:
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
               if template.visible_barrel_template else ""))
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

    def _select_lod_children(self, children_refs: list[con_mod.ChildRef],
                             report: Report, template_name: str,
                             ) -> list[con_mod.ChildRef]:
        selected = con_mod.select_lod_alternative(children_refs, self.configuration)
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
            f"{template_name} -> {selected.template}")
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
            selected = con_mod.select_lod_alternative(children, self.configuration)
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
            children = [con_mod.select_lod_alternative(children, self.configuration)]
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
            collision_meshes = self._geom_collisions.get(
                template.geometry.lower(), [])

        children_refs = template.children
        lod_swap: dict | None = None
        if template.is_lod_selector and children_refs:
            selected_refs = self._select_lod_children(
                children_refs, report, template.name)
            if self.first_person:
                lod_swap = self._lod_swap(template, children_refs, selected_refs[0])
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

        # An Engine's accumulated rotation reaches its plain visual children —
        # the propeller LodObject — but never the sub-parts that are physics
        # bodies of their own (`hasMobilePhysics 1`): a Corsair's landing gear
        # hangs off its Engine without turning with the prop. An Engine with a
        # mesh of its own (carrier screws) simply is the propeller, and spins
        # itself instead.
        spin_axes = engine_spin_axes(template)
        engine_self_spins = bool(spin_axes) and mesh_index is not None
        if spin_axes and not engine_self_spins:
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

        # A FireArms that launches something gets muzzle nodes (and, for plane
        # guns, its `visibleBarrelTemplate` flash baked under each one).
        fire_extras: dict | None = None
        if template.kind.lower() == "firearms" and template.projectile_template:
            muzzle_nodes, fire_extras = self._fire_arms(
                builder, template, report, control, depth)
            child_indices += muzzle_nodes

        # A Camera has no geometry and usually no children, but its placement
        # IS the seat's viewpoint — worth a (mesh-less) node so a viewer can
        # snap its own camera to the pilot's or gunner's eyes, and parked
        # inside the turret it was authored in so it traverses with it.
        # Meshless FireArms survive the same way: their muzzles are the seat's
        # guns (a Spitfire's wing guns are nodes on empty air).
        is_camera = template.kind.lower() == "camera"
        if mesh_index is None and not child_indices and not is_camera:
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
        if is_camera:
            extras["cameraView"] = {"control": control or "vehicle"}
            report.cameras.append(f"[{control or 'vehicle'}] {template.name}")
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
        # cockpit meshes) the leftover slider would pose empty air.
        if (rig := browse_rig(template, has_visible_springs=self._visible_springs)
                ) and (mesh_index is not None or child_indices):
            rig["control"] = control or "vehicle"
            extras["rig"] = rig
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
            })
            report.animated_parts.append(
                f"{template.name} continuous "
                + "/".join(f"{axis} {speed:g}" for axis, speed in axes.items())
                + " deg/s")

        return node_index

    def _flush_spin_animations(self, builder: gltf.GlbBuilder) -> None:
        """Bake the gathered spin specs as looping glTF rotation clips.

        Tracks are grouped by period and each group becomes its own clip, so
        every clip loops seamlessly at exactly one revolution of its parts —
        no least-common-multiple juggling when a B17 mixes 500 and 600 deg/s
        engines. Keyframes sit every quarter turn of the fastest axis, which
        is as coarse as slerp allows without ever taking the short way round.
        """
        groups: dict[float, list] = {}
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
            groups.setdefault(round(period, 6), []).append(
                (track["node"], tuple(times), transforms))
        for index, key in enumerate(sorted(groups)):
            builder.add_animation(
                "spin" if index == 0 else f"spin.{index}", groups[key])

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
                }.items()
                if value is not None
            }
        self._visible_springs = self._has_visible_spring(root_template)
        root = self.build_node(builder, root_template, report)
        if root is None:
            raise ValueError(f"nothing renderable resolved for template {root_template!r}")
        self._flush_spin_animations(builder)
        return builder.build([root], extras=report.as_dict()), report
