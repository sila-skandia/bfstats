from __future__ import annotations

import json
import struct
import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf, stdmesh  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
from extract_collision_meshes import (  # noqa: E402
    _bbox_viewer,
    _to_viewer_vertex,
    _viewer_face_normal,
    build_collision_meshes,
    collect_geometry_refs,
    collision_layers_for,
)

# The real vanilla install, if this machine has one -- same pattern as
# `test_damage.py`'s `GAME_RFA` / `test_stdmesh.py`'s `STANDARD_MESH_RFA`.
BF1942_ARCHIVES = (Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
                   "/bf1942/Archives")
STANDARD_MESH_RFA = BF1942_ARCHIVES / "standardMesh.rfa"
OBJECTS_RFA = BF1942_ARCHIVES / "Objects.rfa"


# -- fixtures --------------------------------------------------------------- #

def _collision_layer_bytes(vertices: list[tuple[float, float, float, int]],
                           faces: list[tuple[tuple[int, int, int], int, int]]) -> bytes:
    """One `.sm` collision layer block: xyz + u16 material + u16 pad per
    vertex (collision-response.md #5.4), then i16x3 + u8 material + u8 flags
    per face -- same layout `test_stdmesh.py`'s `collision_layer()` fixture
    uses, parameterised for these tests."""
    payload = bytearray(struct.pack("<3I", 0xEB97C3BA, 5, len(vertices)))
    for x, y, z, material_id in vertices:
        payload += struct.pack("<3fHH", x, y, z, material_id, 0)
    payload += struct.pack("<I", len(faces))
    for (a, b, c), material_id, flags in faces:
        payload += struct.pack("<3hBB", a, b, c, material_id, flags)
    return struct.pack("<I", len(payload)) + payload


def standard_mesh(bounds_min: tuple[float, float, float],
                  bounds_max: tuple[float, float, float],
                  layers: list[bytes]) -> stdmesh.StandardMesh:
    data = bytearray()
    data += struct.pack("<II", 10, 0)
    data += struct.pack("<3f", *bounds_min)
    data += struct.pack("<3f", *bounds_max)
    data += struct.pack("<B", 0)  # qflag
    data += struct.pack("<I", len(layers))
    for layer in layers:
        data += layer
    data += struct.pack("<I", 0)  # lodCount: no render LODs needed here
    return stdmesh.parse(bytes(data), "test.sm")


class FakePool:
    """The two `ArchivePool` methods `build_collision_meshes` calls."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self._files = {key.lower(): value for key, value in files.items()}

    def resolve_ext(self, stem: str, exts: tuple[str, ...]) -> str | None:
        for ext in exts:
            key = f"{stem}{ext}".lower()
            if key in self._files:
                return key
        return None

    def read(self, name: str) -> bytes:
        return self._files[name.lower()]


# -- coordinate conversion ---------------------------------------------------- #

class ViewerConversionTests(unittest.TestCase):
    def test_to_viewer_vertex_negates_z(self) -> None:
        self.assertEqual((1.0, 2.0, -3.0), _to_viewer_vertex((1.0, 2.0, 3.0)))

    def test_face_normal_hand_worked_example_flat_in_xy(self) -> None:
        # Engine triangle P0=(0,0,0) P1=(1,0,0) P2=(0,1,0): all Z=0, so the
        # mirror is a no-op here and N_e = normalize((P2-P0)x(P1-P0)) =
        # (0,0,-1). The correct viewer normal is M(N_e) = (0,0,1).
        q0, q1, q2 = (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
        normal = _viewer_face_normal(q0, q1, q2)
        self.assertAlmostEqual(0.0, normal[0], places=9)
        self.assertAlmostEqual(0.0, normal[1], places=9)
        self.assertAlmostEqual(1.0, normal[2], places=9)

    def test_face_normal_hand_worked_example_crosses_z(self) -> None:
        # Engine triangle P0=(0,0,0) P1=(1,0,0) P2=(0,0,1): N_e =
        # normalize((P2-P0)x(P1-P0)) = (0,1,0); M(N_e) = (0,1,0) (Y is
        # untouched by a Z mirror) -- but P2's Z survives into q2 as -1, so a
        # naive un-mirrored cross product here would get it wrong.
        q0, q1, q2 = _to_viewer_vertex((0.0, 0.0, 0.0)), _to_viewer_vertex((1.0, 0.0, 0.0)), \
            _to_viewer_vertex((0.0, 0.0, 1.0))
        self.assertEqual((0.0, 0.0, -1.0), q2)
        normal = _viewer_face_normal(q0, q1, q2)
        self.assertAlmostEqual(0.0, normal[0], places=9)
        self.assertAlmostEqual(1.0, normal[1], places=9)
        self.assertAlmostEqual(0.0, normal[2], places=9)

    def test_face_normal_is_none_for_a_degenerate_face(self) -> None:
        self.assertIsNone(_viewer_face_normal((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)))
        self.assertIsNone(_viewer_face_normal((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (2.0, 0.0, 0.0)))

    def test_bbox_viewer_negates_z_and_swaps_the_extrema(self) -> None:
        mesh = standard_mesh((-1.0, -2.0, -3.0), (4.0, 5.0, 6.0), [])
        self.assertEqual([[-1.0, -2.0, -6.0], [4.0, 5.0, 3.0]], _bbox_viewer(mesh))


class CollisionLayersForTests(unittest.TestCase):
    def test_flips_winding_keeps_materials_and_rounds_floats(self) -> None:
        layer_bytes = _collision_layer_bytes(
            vertices=[
                (0.0, 0.0, 0.0, 50),
                (1.0, 0.0, 0.0, 51),
                (0.0, 1.0, 0.0, 52),
            ],
            faces=[((0, 1, 2), 90, 3)],
        )
        mesh = standard_mesh((0.0, 0.0, 0.0), (1.0, 1.0, 0.0), [layer_bytes])

        layers = collision_layers_for(mesh)
        self.assertEqual(1, len(layers))
        layer = layers[0]

        # positions: Z negated (all zero here, so unchanged), flattened xyz.
        self.assertEqual([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0], layer["v"])
        self.assertEqual([50, 51, 52], layer["vm"])
        # winding flip: (i0, i1, i2) -> (i0, i2, i1), matching gltf.py.
        self.assertEqual([0, 2, 1], layer["f"])
        self.assertEqual([90], layer["fm"])
        self.assertEqual(1, len(layer["n"]) // 3)

    def test_a_degenerate_face_is_dropped_from_every_parallel_array(self) -> None:
        layer_bytes = _collision_layer_bytes(
            vertices=[
                (0.0, 0.0, 0.0, 50),
                (1.0, 0.0, 0.0, 50),
                (0.0, 1.0, 0.0, 50),
                (0.0, 0.0, 0.0, 50),  # coincides with vertex 0
            ],
            faces=[
                ((0, 1, 2), 60, 0),       # real
                ((0, 3, 1), 61, 0),       # degenerate: vertex 3 == vertex 0
            ],
        )
        mesh = standard_mesh((0.0, 0.0, 0.0), (1.0, 1.0, 0.0), [layer_bytes])

        layer = collision_layers_for(mesh)[0]
        self.assertEqual([60], layer["fm"])
        self.assertEqual(3, len(layer["f"]))
        self.assertEqual(3, len(layer["n"]))

    def test_multiple_layers_are_kept_in_file_order(self) -> None:
        coarse = _collision_layer_bytes(
            vertices=[(0.0, 0.0, 0.0, 1), (1.0, 0.0, 0.0, 1), (0.0, 1.0, 0.0, 1)],
            faces=[((0, 1, 2), 1, 0)],
        )
        fine = _collision_layer_bytes(
            vertices=[(0.0, 0.0, 0.0, 2), (1.0, 0.0, 0.0, 2), (0.0, 1.0, 0.0, 2), (1.0, 1.0, 0.0, 2)],
            faces=[((0, 1, 2), 2, 0), ((1, 3, 2), 2, 0)],
        )
        mesh = standard_mesh((0.0, 0.0, 0.0), (1.0, 1.0, 0.0), [coarse, fine])

        layers = collision_layers_for(mesh)
        self.assertEqual(2, len(layers))
        self.assertEqual([1], layers[0]["vm"][:1])
        self.assertEqual(3, len(layers[0]["v"]) // 3)
        self.assertEqual(4, len(layers[1]["v"]) // 3)
        self.assertEqual(2, len(layers[1]["fm"]))


class BuildCollisionMeshesTests(unittest.TestCase):
    def test_a_geometry_with_collision_is_included_with_bbox_and_layers(self) -> None:
        layer_bytes = _collision_layer_bytes(
            vertices=[(0.0, 0.0, 0.0, 45), (1.0, 0.0, 0.0, 45), (0.0, 1.0, 0.0, 45)],
            faces=[((0, 1, 2), 45, 0)],
        )
        data = bytearray()
        data += struct.pack("<II", 10, 0)
        data += struct.pack("<3f", -1.0, -1.0, -1.0)
        data += struct.pack("<3f", 1.0, 1.0, 1.0)
        data += struct.pack("<B", 0)
        data += struct.pack("<I", 1)
        data += layer_bytes
        data += struct.pack("<I", 0)
        pool = FakePool({"standardmesh/willy_hul_m1.sm": bytes(data)})

        out, stats = build_collision_meshes(pool, {"willy_hul_m1": "Willy_Hul_M1"})

        self.assertIn("willy_hul_m1", out)
        self.assertEqual([[-1.0, -1.0, -1.0], [1.0, 1.0, 1.0]], out["willy_hul_m1"]["bbox"])
        self.assertEqual(1, len(out["willy_hul_m1"]["layers"]))
        self.assertEqual(1, stats["resolved"])
        self.assertEqual(1, stats["layers"])
        self.assertEqual(1, stats["faces"])

    def test_a_missing_sm_is_recorded_and_skipped(self) -> None:
        out, stats = build_collision_meshes(FakePool({}), {"nowhere": "Nowhere"})
        self.assertEqual({}, out)
        self.assertEqual(["Nowhere"], stats["missing"])

    def test_an_unparseable_sm_is_recorded_and_skipped(self) -> None:
        pool = FakePool({"standardmesh/bad.sm": b"not a real mesh"})
        out, stats = build_collision_meshes(pool, {"bad": "Bad"})
        self.assertEqual({}, out)
        self.assertEqual(1, len(stats["parse_errors"]))

    def test_a_mesh_with_no_collision_layers_is_skipped(self) -> None:
        data = bytearray()
        data += struct.pack("<II", 10, 0)
        data += struct.pack("<3f", 0.0, 0.0, 0.0)
        data += struct.pack("<3f", 0.0, 0.0, 0.0)
        data += struct.pack("<B", 0)
        data += struct.pack("<I", 0)   # no collision layers
        data += struct.pack("<I", 0)
        pool = FakePool({"standardmesh/norm.sm": bytes(data)})

        out, stats = build_collision_meshes(pool, {"norm": "Norm"})
        self.assertEqual({}, out)
        self.assertEqual(1, stats["no_collision"])

    def test_a_mesh_whose_only_faces_are_degenerate_is_treated_as_no_collision(self) -> None:
        layer_bytes = _collision_layer_bytes(
            vertices=[(0.0, 0.0, 0.0, 1), (0.0, 0.0, 0.0, 1), (0.0, 0.0, 0.0, 1)],
            faces=[((0, 1, 2), 1, 0)],  # zero area: all three vertices coincide
        )
        data = bytearray()
        data += struct.pack("<II", 10, 0)
        data += struct.pack("<3f", 0.0, 0.0, 0.0)
        data += struct.pack("<3f", 0.0, 0.0, 0.0)
        data += struct.pack("<B", 0)
        data += struct.pack("<I", 1)
        data += layer_bytes
        data += struct.pack("<I", 0)
        pool = FakePool({"standardmesh/flat.sm": bytes(data)})

        out, stats = build_collision_meshes(pool, {"flat": "Flat"})
        self.assertEqual({}, out)
        self.assertEqual(1, stats["no_collision"])


class CollectGeometryRefsTests(unittest.TestCase):
    def test_a_root_under_vehicles_reaches_its_own_geometry(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Willy/Objects.con",
            "ObjectTemplate.create PlayerControlObject Willy\n"
            "ObjectTemplate.geometry Willy_Hull_M1\n")
        library.add_con(
            "Objects/Vehicles/Land/Willy/Geometries.con",
            "GeometryTemplate.create StandardMesh Willy_Hull_M1\n"
            "GeometryTemplate.file Willy_Hul_M1\n")

        refs = collect_geometry_refs(library)
        self.assertEqual({"willy_hul_m1": "Willy_Hul_M1"}, refs)

    def test_a_root_reaches_a_wreck_declared_in_a_different_folder(self) -> None:
        # WillyWreck is declared in the vehicle's own folder (as vanilla does)
        # but its geometry template -- and so its mesh file -- lives under
        # Objects/MOVE_FILES/, exactly like the real Wreck_Willy_M1.
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Willy/Objects.con",
            "ObjectTemplate.create PlayerControlObject Willy\n"
            "ObjectTemplate.addTemplate WillyWreck\n"
            "ObjectTemplate.create SimpleObject WillyWreck\n"
            "ObjectTemplate.geometry Wreck_Willy_M1\n")
        library.add_con(
            "Objects/MOVE_FILES/Wreck_Willy_M1/Geometries.con",
            "GeometryTemplate.create StandardMesh Wreck_Willy_M1\n")

        refs = collect_geometry_refs(library)
        self.assertEqual({"wreck_willy_m1": "Wreck_Willy_M1"}, refs)

    def test_a_root_under_stationary_weapons_is_included(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Stationary_Weapons/AAGun/Objects.con",
            "ObjectTemplate.create PlayerControlObject AAGun\n"
            "ObjectTemplate.geometry AAGun_Mesh\n")
        library.add_con(
            "Objects/Stationary_Weapons/AAGun/Geometries.con",
            "GeometryTemplate.create StandardMesh AAGun_Mesh\n")

        refs = collect_geometry_refs(library)
        self.assertEqual({"aagun_mesh": "AAGun_Mesh"}, refs)

    def test_a_template_outside_the_scoped_folders_and_unreachable_is_ignored(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Willy/Objects.con",
            "ObjectTemplate.create PlayerControlObject Willy\n"
            "ObjectTemplate.geometry Willy_Hull_M1\n")
        library.add_con(
            "Objects/Vehicles/Land/Willy/Geometries.con",
            "GeometryTemplate.create StandardMesh Willy_Hull_M1\n")
        # A soldier: outside the scope and never `addTemplate`d from a vehicle.
        library.add_con(
            "Objects/Soldiers/USSoldier/Objects.con",
            "ObjectTemplate.create BFSoldier USSoldier\n"
            "ObjectTemplate.geometry USSoldier_Mesh\n")
        library.add_con(
            "Objects/Soldiers/USSoldier/Geometries.con",
            "GeometryTemplate.create StandardMesh USSoldier_Mesh\n")

        refs = collect_geometry_refs(library)
        self.assertEqual({"willy_hull_m1": "Willy_Hull_M1"}, refs)

    def test_two_geometry_templates_aliasing_one_mesh_file_collapse_to_one_entry(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Willy/Objects.con",
            "ObjectTemplate.create PlayerControlObject Willy\n"
            "ObjectTemplate.addTemplate WillyCockpitInternal\n"
            "ObjectTemplate.geometry Willy_Hull_M1\n"
            "ObjectTemplate.create SimpleObject WillyCockpitInternal\n"
            "ObjectTemplate.geometry 1P_Willy_Hul_M1\n")
        library.add_con(
            "Objects/Vehicles/Land/Willy/Geometries.con",
            "GeometryTemplate.create StandardMesh Willy_Hull_M1\n"
            "GeometryTemplate.file Willy_Hul_M1\n"
            "GeometryTemplate.create StandardMesh 1P_Willy_Hul_M1\n"
            "GeometryTemplate.file Willy_Hul_M1\n")

        refs = collect_geometry_refs(library)
        self.assertEqual({"willy_hul_m1": "Willy_Hul_M1"}, refs)

    def test_treemesh_geometry_is_skipped(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Willy/Objects.con",
            "ObjectTemplate.create PlayerControlObject Willy\n"
            "ObjectTemplate.geometry WillyBush\n")
        library.add_con(
            "Objects/Vehicles/Land/Willy/Geometries.con",
            "GeometryTemplate.create TreeMesh WillyBush\n")

        self.assertEqual({}, collect_geometry_refs(library))

    def test_a_self_referencing_child_tree_terminates(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Loop/Objects.con",
            "ObjectTemplate.create PlayerControlObject Loop\n"
            "ObjectTemplate.geometry Loop_Mesh\n"
            "ObjectTemplate.addTemplate Loop\n")
        library.add_con(
            "Objects/Vehicles/Land/Loop/Geometries.con",
            "GeometryTemplate.create StandardMesh Loop_Mesh\n")

        refs = collect_geometry_refs(library)
        self.assertEqual({"loop_mesh": "Loop_Mesh"}, refs)


def _unpack_glb(data: bytes) -> tuple[dict, bytes]:
    json_length, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(data[20:20 + json_length])
    binary_offset = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", data, binary_offset)
    assert binary_type == 0x004E4942
    blob = data[binary_offset + 8:binary_offset + 8 + binary_length]
    return doc, blob


def _accessor_vec3(doc: dict, blob: bytes, index: int) -> list[tuple[float, float, float]]:
    accessor = doc["accessors"][index]
    view = doc["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    flat = struct.unpack_from(f"<{accessor['count'] * 3}f", blob, offset)
    return [tuple(flat[i:i + 3]) for i in range(0, len(flat), 3)]


@unittest.skipUnless(STANDARD_MESH_RFA.exists() and OBJECTS_RFA.exists(),
                     "needs the BF1942 install")
class VanillaCollisionMeshTests(unittest.TestCase):
    """End to end against the real vanilla archives.

    Willy/Spitfire/Sherman numbers are collision-response.md #5.4/#9.4's own
    worked examples and R3 F10's measurements (also asserted directly against
    `stdmesh.py` in `test_stdmesh.py`; this class checks the *extractor*'s
    full pipeline -- template walk, mesh resolution and coordinate conversion
    together -- produces the same thing).
    """

    @classmethod
    def setUpClass(cls) -> None:
        import time

        from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, mod_chain

        t0 = time.time()
        chain = mod_chain(DEFAULT_GAME_DIR, "bf1942")
        cls.meshes, cls.textures, cls.objects, cls.game = build_pools(chain, [])
        cls.library = build_library(cls.objects)
        mesh_files = collect_geometry_refs(cls.library)
        cls.out, cls.stats = build_collision_meshes(cls.meshes, mesh_files)
        cls.build_seconds = time.time() - t0

    def test_willy_spitfire_sherman_are_all_present_with_the_spec_numbers(self) -> None:
        willy = self.out["willy_hul_m1"]["layers"][0]
        self.assertEqual(16, len(willy["v"]) // 3)
        self.assertEqual({45: 16}, dict(Counter(willy["vm"])))

        spitfire = self.out["spitfire_fus_m1"]["layers"][0]
        self.assertEqual({60: 4, 61: 5, 63: 7}, dict(Counter(spitfire["vm"])))

        sherman = self.out["sherman_hull_m1"]["layers"][0]
        self.assertEqual({50: 7, 51: 6, 52: 1}, dict(Counter(sherman["vm"])))

    def test_every_layer_is_present_in_file_order_not_just_the_glbs_pick(self) -> None:
        # The scene glb keeps only one collision layer per part (the last
        # non-degenerate one); the sidecar's whole point is carrying both.
        self.assertEqual(2, len(self.out["willy_hul_m1"]["layers"]))
        self.assertEqual(2, len(self.out["spitfire_fus_m1"]["layers"]))
        self.assertEqual(2, len(self.out["sherman_hull_m1"]["layers"]))

    def test_vertex_positions_match_the_assembled_glbs_collision_primitive(self) -> None:
        # Build the exact collision mesh `bf42/assemble.py` would put in a
        # real .glb for Sherman_Hull_M1, decode its POSITION accessor back
        # out of the binary chunk, and check our JSON's vertex set for the
        # SAME layer matches to better than 1e-4 -- proof the coordinate
        # conversion (Z negation, no other transform at this stage) is bit
        # for bit what the render pipeline does, not just independently
        # plausible.
        mesh_file = "Sherman_Hull_M1"
        entry = self.meshes.resolve_ext(f"standardMesh/{mesh_file}", (".sm",))
        mesh = stdmesh.parse(self.meshes.read(entry), entry)

        assembler = Assembler(self.meshes, self.textures, self.objects, self.library,
                              include_collision=True)
        builder = gltf.GlbBuilder()
        report = Report(root="test", configuration="complex", lod=0)
        collision = assembler._collision_mesh_indices(builder, mesh_file, mesh, report)
        self.assertTrue(collision, "assemble.py produced no collision mesh for the Sherman hull")
        mesh_index, layer_index, _role = collision[0]

        glb_bytes = builder.build([])
        doc, blob = _unpack_glb(glb_bytes)
        primitive = doc["meshes"][mesh_index]["primitives"][0]
        glb_positions = _accessor_vec3(doc, blob, primitive["attributes"]["POSITION"])

        our_layer = self.out["sherman_hull_m1"]["layers"][layer_index]
        v = our_layer["v"]
        our_positions = [(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v), 3)]

        self.assertEqual(len(glb_positions), len(our_positions))

        def nearest(p: tuple[float, float, float], pool: list[tuple[float, float, float]]) -> float:
            return min(((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2) ** 0.5
                       for q in pool)

        max_gap = max(nearest(p, glb_positions) for p in our_positions)
        self.assertLess(max_gap, 1e-4)

    def test_normals_point_away_from_the_centroid_for_the_large_majority_of_faces(self) -> None:
        # Not a perfect test on its own (a concave hull's face-centre-to-
        # mesh-centroid vector is only a heuristic proxy for "outward" — a
        # single detailed/concave layer can score as low as ~0.6), which is
        # exactly why the spec says "large majority" rather than "every
        # face": checked here in aggregate across the whole vanilla output
        # (22k+ faces measured at ~0.68) and again per-geometry on three
        # coarse hulls that are close to convex (measured at 0.82-0.92).
        def outward_fraction(layer: dict) -> tuple[int, int]:
            v, f, n = layer["v"], layer["f"], layer["n"]
            verts = [(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v), 3)]
            if not verts:
                return 0, 0
            cx = sum(p[0] for p in verts) / len(verts)
            cy = sum(p[1] for p in verts) / len(verts)
            cz = sum(p[2] for p in verts) / len(verts)
            outward = total = 0
            for i in range(0, len(f), 3):
                i0, i1, i2 = f[i], f[i + 1], f[i + 2]
                fx = (verts[i0][0] + verts[i1][0] + verts[i2][0]) / 3 - cx
                fy = (verts[i0][1] + verts[i1][1] + verts[i2][1]) / 3 - cy
                fz = (verts[i0][2] + verts[i1][2] + verts[i2][2]) / 3 - cz
                nx, ny, nz = n[i], n[i + 1], n[i + 2]
                total += 1
                if fx * nx + fy * ny + fz * nz > 0:
                    outward += 1
            return outward, total

        for geometry in ("willy_hul_m1", "spitfire_fus_m1", "sherman_hull_m1"):
            outward, total = outward_fraction(self.out[geometry]["layers"][0])
            self.assertGreater(outward / total, 0.75, f"{geometry} layer 0")

        agg_outward = agg_total = 0
        for entry in self.out.values():
            for layer in entry["layers"]:
                outward, total = outward_fraction(layer)
                agg_outward += outward
                agg_total += total
        self.assertGreater(agg_outward / agg_total, 0.6)

    def test_extraction_finishes_in_reasonable_time(self) -> None:
        # Not a hard perf contract, just a guard against an accidental O(n^2)
        # in the template walk over vanilla's ~1700 vehicle/weapon templates.
        self.assertLess(self.build_seconds, 30.0)


if __name__ == "__main__":
    unittest.main()



class GeometryAliasTests(unittest.TestCase):
    """`collect_geometry_aliases`: the glb names a geometry template, the file
    is keyed by mesh file; this is the step between them."""

    def test_willy_hull_template_resolves_to_its_mesh_file(self):
        from extract_collision_meshes import collect_geometry_aliases
        from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, mod_chain
        if not DEFAULT_GAME_DIR.is_dir():
            self.skipTest("game not installed")
        chain = mod_chain(DEFAULT_GAME_DIR, "bf1942")
        _meshes, _textures, objects, _game = build_pools(chain, [])
        aliases = collect_geometry_aliases(build_library(objects))
        self.assertEqual("willy_hul_m1", aliases["willy_hull_m1"])
