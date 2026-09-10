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
from dataclasses import dataclass, field
from pathlib import Path

from . import con as con_mod
from . import gltf, rs, stdmesh
from .rfa import ArchivePool

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, downscale, encode_png  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from extract_hud_assets import decode_tga  # noqa: E402

TEXTURE_EXTS = (".dds", ".tga")


@dataclass
class Report:
    root: str
    parts: int = 0
    triangles: int = 0
    missing_geometry_templates: list[str] = field(default_factory=list)
    missing_meshes: list[str] = field(default_factory=list)
    missing_shaders: list[str] = field(default_factory=list)
    missing_textures: list[str] = field(default_factory=list)
    resolved_textures: dict[str, str] = field(default_factory=dict)
    unresolved_templates: list[str] = field(default_factory=list)
    skipped_lod_alternatives: list[str] = field(default_factory=list)
    part_tree: list[str] = field(default_factory=list)
    rigged_parts: list[str] = field(default_factory=list)
    skinned_parts: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "root": self.root,
            "parts": self.parts,
            "triangles": self.triangles,
            "missingGeometryTemplates": sorted(set(self.missing_geometry_templates)),
            "missingMeshFiles": sorted(set(self.missing_meshes)),
            "materialsWithoutShader": sorted(set(self.missing_shaders)),
            "texturesNotFound": sorted(set(self.missing_textures)),
            "texturesResolved": dict(sorted(self.resolved_textures.items())),
            "unresolvedTemplates": sorted(set(self.unresolved_templates)),
            "lodAlternativesSkipped": sorted(set(self.skipped_lod_alternatives)),
            "partTree": self.part_tree,
            "riggedParts": self.rigged_parts,
            "skinnedParts": self.skinned_parts,
        }


class Assembler:
    def __init__(self, meshes: ArchivePool, textures: ArchivePool,
                 objects: ArchivePool, library: con_mod.ObjectLibrary, *,
                 lod: int = 0, max_texture: int = 1024, include_interior: bool = False):
        self.meshes = meshes
        self.textures = textures
        self.objects = objects
        self.library = library
        self.lod = lod
        self.max_texture = max_texture
        self.include_interior = include_interior
        self._shader_cache: dict[str, dict[str, rs.Shader]] = {}
        self._texture_cache: dict[str, int | None] = {}
        self._material_cache: dict[tuple, int] = {}

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

    # -- geometry ----------------------------------------------------------- #

    def _mesh_index(self, builder: gltf.GlbBuilder, geometry_name: str,
                    report: Report) -> tuple[int | None, int]:
        template = self.library.geometry(geometry_name)
        if template is None:
            report.missing_geometry_templates.append(geometry_name)
            return None, 0

        mesh_file = template.mesh_file
        entry = self.meshes.resolve_ext(f"standardMesh/{mesh_file}", (".sm",))
        if not entry:
            report.missing_meshes.append(mesh_file)
            return None, 0

        try:
            mesh = stdmesh.parse(self.meshes.read(entry), entry)
        except stdmesh.MeshError as exc:
            report.missing_meshes.append(f"{mesh_file} ({exc})")
            return None, 0

        if not mesh.lods:
            report.missing_meshes.append(f"{mesh_file} (no lods)")
            return None, 0

        lod = mesh.lods[min(self.lod, len(mesh.lods) - 1)]
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
            return None, 0
        return builder.add_mesh(mesh_file, primitives), triangles

    # -- tree --------------------------------------------------------------- #

    def build_node(self, builder: gltf.GlbBuilder, template_name: str, report: Report,
                   *, position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0),
                   depth: int = 0, stack: frozenset[str] = frozenset(),
                   control: str = "") -> int | None:
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

        # Player inputs are scoped to a seat, not to the vehicle. `c_PIMouseLookY`
        # on a tank's gun and on the commander's MG are two different players'
        # mice — the MG sits inside its own PlayerControlObject. Treating the name
        # as global welds the two together, which is not how either tank behaves.
        if template.kind.lower() == "playercontrolobject":
            control = template.name

        mesh_index, triangles = (None, 0)
        if template.geometry:
            mesh_index, triangles = self._mesh_index(builder, template.geometry, report)

        children_refs = template.children
        if template.is_lod_selector and children_refs:
            # A LodObject holds Complex / Simple / Wreck alternatives for the same
            # object. Only the first is the full-detail one; drawing all three
            # stacks a wreck inside a pristine hull.
            report.skipped_lod_alternatives += [c.template for c in children_refs[1:]]
            children_refs = children_refs[:1]

        child_indices: list[int] = []
        for ref in children_refs:
            child = self.build_node(
                builder, ref.template, report,
                position=ref.position, rotation=ref.rotation,
                depth=depth + 1, stack=stack, control=control,
            )
            if child is not None:
                child_indices.append(child)

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
        if rig := template.rig():
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
            rotation=gltf.quat_from_ypr(*rotation),
            mesh=mesh_index,
            children=child_indices,
            extras=extras,
        ))

    def export(self, root_template: str) -> tuple[bytes, Report]:
        builder = gltf.GlbBuilder()
        report = Report(root=root_template)
        root = self.build_node(builder, root_template, report)
        if root is None:
            raise ValueError(f"nothing renderable resolved for template {root_template!r}")
        return builder.build([root], extras=report.as_dict()), report
