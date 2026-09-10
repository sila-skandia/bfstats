from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf, stdmesh  # noqa: E402
from bf42.assemble import Assembler, Report, browse_rig  # noqa: E402
from bf42.con import ObjectLibrary, ObjectTemplate  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402


def glb_document(data: bytes) -> dict:
    json_size, json_kind = struct.unpack_from("<II", data, 12)
    if json_kind != 0x4E4F534A:
        raise AssertionError("GLB does not start with a JSON chunk")
    return json.loads(data[20:20 + json_size].decode("utf-8"))


class CollisionExportTests(unittest.TestCase):
    def test_collision_faces_are_grouped_by_material_with_metadata(self) -> None:
        layer = stdmesh.CollisionLayer(
            unknown=(0, 5),
            vertices=[
                (0.0, 0.0, 0.0),
                (1.0, 0.0, 0.0),
                (1.0, 1.0, 0.0),
                (0.0, 1.0, 0.0),
            ],
            vertex_unknown=[1.0] * 4,
            faces=[
                stdmesh.CollisionFace((0, 1, 2), 50, 0),
                stdmesh.CollisionFace((0, 2, 3), 52, 4),
            ],
        )
        coarse = stdmesh.CollisionLayer(
            unknown=(0, 5),
            vertices=layer.vertices[:3],
            vertex_unknown=[1.0] * 3,
            faces=[stdmesh.CollisionFace((0, 1, 2), 43, 0)],
        )
        mesh = stdmesh.StandardMesh(
            name="TestHull",
            version=10,
            bounds_min=(0.0, 0.0, 0.0),
            bounds_max=(1.0, 1.0, 0.0),
            collision_layers=[coarse, layer],
            lods=[],
        )
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, ObjectLibrary())
        builder = gltf.GlbBuilder()
        report = Report(root="Test", configuration="complex", lod=0)

        collision_meshes = assembler._collision_mesh_indices(
            builder, "TestHull", mesh, report)
        mesh_index, layer_index, role = collision_meshes[0]
        root = builder.add_node(gltf.Node(
            name="Test collision",
            mesh=mesh_index,
            extras={"collision": True, "collisionRole": role},
        ))
        document = glb_document(builder.build([root], extras=report.as_dict()))

        self.assertEqual(1, layer_index)
        self.assertEqual("detailed", role)
        self.assertEqual(2, report.collision_triangles)
        self.assertEqual([50, 52], sorted(set(report.collision_materials)))
        self.assertEqual(
            [50, 52],
            [
                primitive["extras"]["defenseMaterial"]
                for primitive in document["meshes"][0]["primitives"]
            ],
        )
        self.assertTrue(document["nodes"][0]["extras"]["collision"])

    def test_include_collision_false_does_not_attach_nodes(self) -> None:
        pool = ArchivePool()
        assembler = Assembler(
            pool, pool, pool, ObjectLibrary(), include_collision=False)
        builder = gltf.GlbBuilder()
        report = Report(root="Test", configuration="complex", lod=0)
        mesh = stdmesh.StandardMesh(
            name="TestHull", version=10,
            bounds_min=(0.0, 0.0, 0.0), bounds_max=(1.0, 1.0, 0.0),
            collision_layers=[], lods=[],
        )
        assembler._geom_collisions["testhull"] = assembler._collision_mesh_indices(
            builder, "TestHull", mesh, report) if assembler.include_collision else []
        self.assertEqual([], assembler._geom_collisions["testhull"])
        self.assertEqual(0, report.collision_parts)


class InvisiblePartTests(unittest.TestCase):
    def test_create_invisible_parts_are_omitted_without_loading_geometry(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Sea/Test/Objects.con",
            """
ObjectTemplate.create Bundle Boat
ObjectTemplate.addTemplate Hull
ObjectTemplate.addTemplate LandEngine

ObjectTemplate.create SimpleObject Hull
ObjectTemplate.geometry TestHull

ObjectTemplate.create Engine LandEngine
ObjectTemplate.addTemplate HiddenWheel

ObjectTemplate.create Spring HiddenWheel
ObjectTemplate.geometry Willy_WheelR_M1
ObjectTemplate.createInvisible 1

GeometryTemplate.create StandardMesh TestHull
GeometryTemplate.create StandardMesh Willy_WheelR_M1
""",
        )
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        report = Report(root="Boat", configuration="complex", lod=0)

        self.assertIsNone(assembler.build_node(builder, "HiddenWheel", report))
        self.assertIsNone(assembler.build_node(builder, "LandEngine", report))
        self.assertEqual([], report.missing_meshes)
        self.assertNotIn("Willy_WheelR_M1", report.missing_geometry_templates)


class FirstPersonLodTests(unittest.TestCase):
    def test_distance_lod_falls_back_from_cockpit_mesh_to_third_person(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Sea/Test/Objects.con",
            """
ObjectTemplate.create RotationalBundle Helm
ObjectTemplate.addTemplate lodHelm
ObjectTemplate.setMinRotation 0/0/-60
ObjectTemplate.setMaxRotation 0/0/60
ObjectTemplate.setInputToRoll c_PIYaw

ObjectTemplate.create LodObject lodHelm
ObjectTemplate.addTemplate HighHelm
ObjectTemplate.addTemplate LowHelm

ObjectTemplate.create SimpleObject HighHelm
ObjectTemplate.geometry 1P_PT_Str_M1

ObjectTemplate.create AnimatedBundle LowHelm
ObjectTemplate.geometry PT_Steering_M1

GeometryTemplate.create StandardMesh 1P_PT_Str_M1
GeometryTemplate.create StandardMesh PT_Steering_M1
""",
        )
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        report = Report(root="Helm", configuration="complex", lod=0)

        self.assertIsNone(assembler.build_node(builder, "HighHelm", report))
        self.assertEqual([], report.missing_meshes)

        assembler.build_node(builder, "lodHelm", report)
        self.assertIn("PT_Steering_M1", report.missing_meshes)
        self.assertNotIn("1P_PT_Str_M1", report.missing_meshes)
        self.assertEqual(["lodHelm -> LowHelm"], report.selected_lod_alternatives)


class BrowseRigTests(unittest.TestCase):
    def test_helm_loses_steer_when_the_vehicle_has_no_visible_springs(self) -> None:
        helm = ObjectTemplate(name="PT_Steering", kind="RotationalBundle")
        helm.min_rotation = (0.0, 0.0, -60.0)
        helm.max_rotation = (0.0, 0.0, 60.0)
        helm.inputs = {"roll": "c_PIYaw"}

        self.assertIsNone(browse_rig(helm, has_visible_springs=False))
        self.assertEqual(
            "c_PIYaw",
            browse_rig(helm, has_visible_springs=True)["axes"]["roll"]["input"],
        )

    def test_aircraft_engine_keeps_throttle_without_springs(self) -> None:
        engine = ObjectTemplate(name="StukaEngine", kind="Engine")
        engine.min_rotation = (0.0, 0.0, -3000.0)
        engine.max_rotation = (0.0, 0.0, 3000.0)
        engine.inputs = {"roll": "c_PIThrottle"}

        rig = browse_rig(engine, has_visible_springs=False)

        self.assertEqual("rate", rig["axes"]["roll"]["driver"])


if __name__ == "__main__":
    unittest.main()
