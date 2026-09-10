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
from . import gltf, rs, skin, stdmesh, treemesh
from .rfa import ArchivePool

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, downscale, encode_png  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from extract_hud_assets import decode_tga  # noqa: E402

TEXTURE_EXTS = (".dds", ".tga")


def geometry_is_first_person(geometry_name: str | None) -> bool:
    """Cockpit / 1P view meshes are named `1P_...` (or `1PPT_...`, `1PBritBody`)."""
    if not geometry_name:
        return False
    base = geometry_name.replace("\\", "/").rsplit("/", 1)[-1]
    return base.lower().startswith("1p")


_DRIVETRAIN_INPUTS = frozenset({"c_PIYaw", "c_PIThrottle"})


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
    mesh_lods: dict[str, dict[str, int]] = field(default_factory=dict)
    part_tree: list[str] = field(default_factory=list)
    rigged_parts: list[str] = field(default_factory=list)
    skinned_parts: list[str] = field(default_factory=list)
    collision_parts: int = 0
    collision_triangles: int = 0
    collision_materials: list[int] = field(default_factory=list)
    armor: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "root": self.root,
            "configuration": self.configuration,
            "lod": self.lod,
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
            "meshLods": dict(sorted(self.mesh_lods.items())),
            "partTree": self.part_tree,
            "riggedParts": self.rigged_parts,
            "skinnedParts": self.skinned_parts,
            "collisionParts": self.collision_parts,
            "collisionTriangles": self.collision_triangles,
            "collisionMaterials": sorted(set(self.collision_materials)),
            "armor": self.armor,
        }


class Assembler:
    def __init__(self, meshes: ArchivePool, textures: ArchivePool,
                 objects: ArchivePool, library: con_mod.ObjectLibrary, *,
                 lod: int = 0, max_texture: int = 1024,
                 configuration: str = "complex",
                 include_collision: bool = True):
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
        self._visible_springs = True
        self._shader_cache: dict[str, dict[str, rs.Shader]] = {}
        self._texture_cache: dict[str, int | None] = {}
        self._material_cache: dict[tuple, int] = {}
        self._geom_mesh: dict[str, tuple[int | None, int]] = {}
        self._geom_collisions: dict[str, list[tuple[int, int, str]]] = {}
        self._collision_material_cache: dict[int, int] = {}
        self._skin_cache: dict[str, skin.Skin | None] = {}

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

        index = builder.add_image_png(
            encode_png(width, height, rgba, drop_alpha=False), name=found)
        report.resolved_textures[path] = f"{self.textures.source_of(found)}:{found}"
        self._texture_cache[path] = index
        return index

    def _material_index(self, builder: gltf.GlbBuilder, shader: rs.Shader | None,
                        material_name: str, report: Report) -> int | None:
        if shader is None:
            report.missing_shaders.append(material_name)
            return None

        texture_path = shader.base_texture
        key = (texture_path, shader.twosided, shader.transparent, shader.alpha_test)
        if key in self._material_cache:
            return self._material_cache[key]

        texture = self._texture_index(builder, texture_path, report) if texture_path else None
        index = builder.add_material(
            name=shader.name,
            texture=texture,
            double_sided=shader.twosided,
            alpha_cutoff=shader.alpha_test,
            blend=shader.transparent and shader.alpha_test is None,
        )
        self._material_cache[key] = index
        return index

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
            primitives.append(gltf.Primitive(
                positions=part.positions,
                normals=part.normals,
                uvs=part.uvs,
                indices=part.indices,
                material=self._material_index(builder, shader, part.name, report),
            ))
        if not primitives:
            return None, 0
        return builder.add_mesh(mesh_file, primitives), triangles

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
        """The 3P body skin — the bind the hands have to be mapped into."""
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

    def _hand_alignment(
            self, template: con_mod.ObjectTemplate, body: skin.Skin | None,
    ) -> tuple[tuple[tuple[float, float, float], ...], tuple[float, float, float], str] | None:
        if body is None or not template.geometry or "hand" not in template.name.lower():
            return None
        hand = self._geometry_skin(template.geometry)
        if hand is None:
            return None
        aligned = skin.alignment(hand, body)
        return aligned

    def _geometry_is_first_person(self, template_name: str) -> bool:
        child = self.library.object(template_name)
        return geometry_is_first_person(child.geometry if child else None)

    def _select_lod_children(self, children_refs: list[con_mod.ChildRef],
                             report: Report, template_name: str,
                             ) -> list[con_mod.ChildRef]:
        selected = con_mod.select_lod_alternative(children_refs, self.configuration)
        if self._geometry_is_first_person(selected.template):
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

    # -- tree --------------------------------------------------------------- #

    def build_node(self, builder: gltf.GlbBuilder, template_name: str, report: Report,
                   *, position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0),
                   depth: int = 0, stack: frozenset[str] = frozenset(),
                   control: str = "",
                   body_skin: skin.Skin | None = None,
                   ) -> int | None:
        if depth > 24:
            return None
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

        # Player inputs are scoped to a seat, not to the vehicle. `c_PIMouseLookY`
        # on a tank's gun and on the commander's MG are two different players'
        # mice — the MG sits inside its own PlayerControlObject. Treating the name
        # as global welds the two together, which is not how either tank behaves.
        control = template.control_scope(control)

        if template.kind.lower() == "bfsoldier":
            body_skin = self._soldier_body_skin(template)

        mesh_index, triangles = (None, 0)
        collision_meshes: list[tuple[int, int, str]] = []
        if template.geometry and not geometry_is_first_person(template.geometry):
            mesh_index, triangles = self._mesh_index(builder, template.geometry, report)
            collision_meshes = self._geom_collisions.get(
                template.geometry.lower(), [])

        children_refs = template.children
        if template.is_lod_selector and children_refs:
            children_refs = self._select_lod_children(
                children_refs, report, template.name)

        child_indices: list[int] = []
        for ref in children_refs:
            child_name = con_mod.instance_template_name(ref, self.library.object)
            if child_name is None:
                continue
            child = self.build_node(
                builder, child_name, report,
                position=ref.position, rotation=ref.rotation,
                depth=depth + 1, stack=stack, control=control,
                body_skin=body_skin,
            )
            if child is not None:
                child_indices.append(child)

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

        if mesh_index is None and not child_indices:
            return None

        if mesh_index is not None:
            report.parts += 1
            report.triangles += triangles
            report.part_tree.append(f"{'  ' * depth}{template.name} [{template.geometry}] {triangles} tris")
        else:
            report.part_tree.append(f"{'  ' * depth}{template.name} ({template.kind})")

        extras: dict = {"templateKind": template.kind, "geometry": template.geometry,
                        "control": control or "vehicle"}
        yaw, pitch, roll = rotation
        if template.kind.lower() == "bfsoldier":
            # Bind-pose soldier meshes stand along Refractor +Z (3ds Max Biped).
            # After the Z mirror they lie along glTF -Z; pitching the root onto
            # +Y is what a browse camera expects, matching vehicles.
            pitch -= 90.0
        node_rotation = gltf.quat_from_ypr(yaw, pitch, roll)
        if aligned := self._hand_alignment(template, body_skin):
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

        return builder.add_node(gltf.Node(
            name=template.name,
            translation=position,
            rotation=node_rotation,
            mesh=mesh_index,
            children=child_indices,
            extras=extras,
        ))

    def export(self, root_template: str) -> tuple[bytes, Report]:
        builder = gltf.GlbBuilder()
        report = Report(
            root=root_template,
            configuration=self.configuration,
            lod=self.lod,
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
        return builder.build([root], extras=report.as_dict()), report
