from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf, skin, stdmesh  # noqa: E402
from bf42.assemble import (  # noqa: E402
    Assembler,
    Report,
    browse_rig,
    reaches_first_person,
)
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


# A cut-down Corsair with the shape that matters: a PCO, a configuration
# LodObject, a cockpit LodObject whose first alternative is the hull, a camera,
# and one control surface that has nothing to do with first person.
COCKPIT_CON = """
ObjectTemplate.create PlayerControlObject Corsair
ObjectTemplate.addTemplate lodCorsair

ObjectTemplate.create LodObject lodCorsair
ObjectTemplate.addTemplate CorsairComplex
ObjectTemplate.addTemplate CorsairWreck

ObjectTemplate.create Bundle CorsairComplex
ObjectTemplate.addTemplate lodCorsairCockpit
ObjectTemplate.setPosition 0/0.5/0
ObjectTemplate.addTemplate CorsairCamera
ObjectTemplate.addTemplate CorsairRudder

ObjectTemplate.create LodObject lodCorsairCockpit
ObjectTemplate.addTemplate CorsairCockpitExternal
ObjectTemplate.addTemplate CorsairCockpitInternal
ObjectTemplate.lodSelector CorsairCockpitSelector

ObjectTemplate.create Bundle CorsairCockpitExternal
ObjectTemplate.geometry Corsair_Hull_M1

ObjectTemplate.create SimpleObject CorsairCockpitInternal
ObjectTemplate.geometry 1P_Corsair

ObjectTemplate.create Camera CorsairCamera

ObjectTemplate.create Wing CorsairRudder
ObjectTemplate.geometry Corsair_Rudder_M1

ObjectTemplate.create Bundle CorsairWreck
ObjectTemplate.geometry Corsair_Wreck_M1

LodSelectorTemplate.create DistCompareSelector CorsairCockpitSelector
LodSelectorTemplate.addLodDistance 20
LodSelectorTemplate.addLodComparison 0.5

GeometryTemplate.create StandardMesh Corsair_Hull_M1
GeometryTemplate.create StandardMesh 1P_Corsair
GeometryTemplate.create StandardMesh Corsair_Rudder_M1
GeometryTemplate.create StandardMesh Corsair_Wreck_M1
"""


def cockpit_library() -> ObjectLibrary:
    library = ObjectLibrary()
    library.add_con("Objects/Vehicles/Air/Corsair/Objects.con", COCKPIT_CON)
    return library


def stub_meshes(assembler: Assembler, builder: gltf.GlbBuilder, *names: str) -> None:
    """Stand in for the `.sm` files an archive-less test has no way to supply.

    `build_node` drops a node with neither a mesh nor a surviving child, so a
    test about tree *shape* needs something behind each geometry name. The
    geometry cache is exactly the seam the archive lookup fills, and seeding it
    keeps the mesh reader out of a test that is not about the mesh reader.
    """
    triangle = gltf.Primitive(
        positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
        indices=[0, 1, 2],
    )
    for name in names:
        assembler._geom_mesh[name.lower()] = (
            builder.add_mesh(name, [triangle]), 1)


class CockpitExportTests(unittest.TestCase):
    def test_reaches_first_person_sees_through_lod_alternatives(self) -> None:
        library = cockpit_library()
        # The interior is the alternative no configuration selects, so a
        # predicate that consulted the selection would never find it.
        self.assertTrue(reaches_first_person(library, "Corsair"))
        self.assertTrue(reaches_first_person(library, "lodCorsairCockpit"))
        self.assertFalse(reaches_first_person(library, "CorsairRudder"))
        self.assertFalse(reaches_first_person(library, "CorsairCockpitExternal"))
        self.assertFalse(reaches_first_person(library, "NoSuchTemplate"))

    def test_ordinary_export_still_takes_the_hull_and_loads_no_1p_mesh(self) -> None:
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, cockpit_library())
        builder = gltf.GlbBuilder()
        report = Report(root="Corsair", configuration="complex", lod=0)

        assembler.build_node(builder, "Corsair", report)
        self.assertIn("lodCorsairCockpit -> CorsairCockpitExternal",
                      report.selected_lod_alternatives)
        self.assertIn("Corsair_Hull_M1", report.missing_meshes)
        self.assertNotIn("1P_Corsair", report.missing_meshes)
        self.assertEqual([], report.cockpit_swaps)

    def test_cockpit_export_takes_the_interior_and_prunes_everything_else(self) -> None:
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, cockpit_library(),
                              first_person=True, include_collision=False)
        builder = gltf.GlbBuilder()
        report = Report(root="Corsair", configuration="complex", lod=0,
                        first_person=True)
        stub_meshes(assembler, builder, "1P_Corsair", "Corsair_Hull_M1",
                    "Corsair_Rudder_M1")

        root = assembler.build_node(builder, "Corsair", report)
        document = glb_document(builder.build([root], extras={}))
        names = [node["name"] for node in document["nodes"]]

        self.assertIn("lodCorsairCockpit -> CorsairCockpitInternal",
                      report.selected_lod_alternatives)
        # Only the branch that reaches first-person geometry survives, so the
        # nodes the ordinary export already owns are not duplicated here.
        self.assertEqual(
            ["CorsairCockpitInternal", "lodCorsairCockpit", "CorsairComplex",
             "lodCorsair", "Corsair"],
            names,
        )
        # The chain above the interior keeps the placement it has in the
        # ordinary export, which is what lets a viewer graft by node name.
        complex_node = document["nodes"][names.index("CorsairComplex")]
        cockpit_node = document["nodes"][names.index("lodCorsairCockpit")]
        self.assertNotIn("translation", complex_node)
        self.assertEqual([0.0, 0.5, 0.0], cockpit_node["translation"])

    def test_cockpit_export_stamps_the_swap_and_its_declared_thresholds(self) -> None:
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, cockpit_library(),
                              first_person=True, include_collision=False)
        builder = gltf.GlbBuilder()
        report = Report(root="Corsair", configuration="complex", lod=0,
                        first_person=True)
        stub_meshes(assembler, builder, "1P_Corsair")

        root = assembler.build_node(builder, "Corsair", report)
        document = glb_document(builder.build([root], extras={}))
        swap = next(node["extras"]["lodAlternative"] for node in document["nodes"]
                    if node["name"] == "lodCorsairCockpit")

        self.assertEqual("CorsairCockpitInternal", swap["selected"])
        self.assertEqual(["CorsairCockpitExternal"], swap["replaces"])
        self.assertEqual("DistCompareSelector", swap["selectorKind"])
        self.assertEqual([20.0], swap["distances"])
        self.assertEqual([0.5], swap["comparisons"])
        self.assertEqual(
            ["lodCorsairCockpit: CorsairCockpitInternal replaces "
             "CorsairCockpitExternal"],
            report.cockpit_swaps,
        )
        # A LodObject whose selection is not first person carries no swap: the
        # configuration LodObject above it picks Complex for both exports.
        self.assertNotIn(
            "lodAlternative",
            next(node for node in document["nodes"]
                 if node["name"] == "lodCorsair").get("extras", {}),
        )

    def test_cockpit_export_finds_a_first_person_alternative_declared_first(self) -> None:
        # Every steering wheel and the B17's gun models pair their alternatives
        # the other way round under a `DistanceSelector`, because there the 1P
        # mesh is the near LOD. Selection must key on geometry, not on index.
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Sea/Elco80/Objects.con",
            """
ObjectTemplate.create LodObject lodPT_Steering
ObjectTemplate.addTemplate PT_HighRSteering
ObjectTemplate.addTemplate PT_LowSteering

ObjectTemplate.create SimpleObject PT_HighRSteering
ObjectTemplate.geometry 1P_PT_Str_M1

ObjectTemplate.create SimpleObject PT_LowSteering
ObjectTemplate.geometry PT_Steering_M1

GeometryTemplate.create StandardMesh 1P_PT_Str_M1
GeometryTemplate.create StandardMesh PT_Steering_M1
""",
        )
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library, first_person=True,
                              include_collision=False)
        builder = gltf.GlbBuilder()
        report = Report(root="lodPT_Steering", configuration="complex", lod=0,
                        first_person=True)

        assembler.build_node(builder, "lodPT_Steering", report)
        self.assertEqual(["lodPT_Steering -> PT_HighRSteering"],
                         report.selected_lod_alternatives)
        self.assertIn("1P_PT_Str_M1", report.missing_meshes)
        self.assertNotIn("PT_Steering_M1", report.missing_meshes)


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

    def test_a_ship_rudder_keeps_its_steer_axis(self) -> None:
        """A `Wing` on `c_PIYaw` is the whole steering model of a destroyer.

        Same shape as the helm above and the opposite answer, because the
        helm is a lever with nothing on the end of it and this is a force.
        """
        rudder = ObjectTemplate(name="Fletcher_rudder", kind="Wing")
        rudder.min_rotation = (0.0, -25.0, 0.0)
        rudder.max_rotation = (0.0, 25.0, 0.0)
        rudder.max_speed = (0.0, 15.0, 0.0)
        rudder.inputs = {"pitch": "c_PIYaw"}

        rig = browse_rig(rudder, has_visible_springs=False)

        self.assertEqual(-25.0, rig["axes"]["pitch"]["min"])
        self.assertEqual(25.0, rig["axes"]["pitch"]["max"])


class PhysicsExportTests(unittest.TestCase):
    """`extras.physics`, on the part that declared it.

    The .con below is a trimmed transcription of the shipped
    `Objects/Vehicles/Sea/fletcher/{Objects,Physics}.con` — a hull, an engine
    aft, a bow hull-wing against a stern rudder, and buoyancy points. Three of
    those four are meshless in the shipped data, which is the whole test: a
    `mesh_index is None and not child_indices` walk deletes a destroyer's
    entire physics and leaves a 10,000-triangle ornament.
    """

    SHIP_CON = """
ObjectTemplate.create PlayerControlObject Fletcher
ObjectTemplate.mass 2500000
ObjectTemplate.drag 3
ObjectTemplate.setVehicleCategory VCSea
ObjectTemplate.setVehicleType VTDestroyer
ObjectTemplate.addTemplate FletcherHull
ObjectTemplate.addTemplate Fletcher_HullWing
ObjectTemplate.setPosition 0/-5/55
ObjectTemplate.addTemplate Fletcher_rudder
ObjectTemplate.setPosition 0/-5/-55
ObjectTemplate.addTemplate Fletcher_Engine
ObjectTemplate.setPosition 0/-4/-40
ObjectTemplate.addTemplate Fletcher_Floater
ObjectTemplate.setPosition -2/7.5/50
ObjectTemplate.addTemplate Fletcher_Floater
ObjectTemplate.setPosition 2/7.5/50
ObjectTemplate.addTemplate FletcherCamera

ObjectTemplate.create SimpleObject FletcherHull
ObjectTemplate.geometry Fletcher_Hull

ObjectTemplate.create Wing Fletcher_HullWing
ObjectTemplate.setMinRotation 0/-25/0
ObjectTemplate.setMaxRotation 0/25/0
ObjectTemplate.setMaxSpeed 0/15/0
ObjectTemplate.setAcceleration 0/-10/0
ObjectTemplate.setInputToPitch c_PIYaw
ObjectTemplate.setAutomaticReset 1
ObjectTemplate.setPositionOffset 0/0/0
ObjectTemplate.setWingLift 0
ObjectTemplate.setFlapLift 2

ObjectTemplate.create Wing Fletcher_rudder
ObjectTemplate.setMinRotation 0/-25/0
ObjectTemplate.setMaxRotation 0/25/0
ObjectTemplate.setMaxSpeed 0/15/0
ObjectTemplate.setAcceleration 0/10/0
ObjectTemplate.setInputToPitch c_PIYaw
ObjectTemplate.setAutomaticReset 1
ObjectTemplate.setPositionOffset 0/0/0
ObjectTemplate.setWingLift 0
ObjectTemplate.setFlapLift 2

ObjectTemplate.create Engine Fletcher_Engine
ObjectTemplate.setEngineType c_ETShip
ObjectTemplate.setTorque 2
ObjectTemplate.setDifferential 2
ObjectTemplate.setNoPropellerEffectAtSpeed 120

ObjectTemplate.create FloatingBundle Fletcher_Floater
ObjectTemplate.setHullHeight 20
ObjectTemplate.setFloatMaxLift 2
ObjectTemplate.setFloatMinLift 2

ObjectTemplate.create Camera FletcherCamera
ObjectTemplate.setPivotPosition 0/0.25/0.3

GeometryTemplate.create StandardMesh Fletcher_Hull
"""

    def _assemble(self, con_text: str, root: str, path: str, *, geometry: str):
        library = ObjectLibrary()
        library.add_con(path, con_text)
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        mesh_index = builder.add_mesh(geometry, [gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])])
        assembler._geom_mesh[geometry.lower()] = (mesh_index, 1)
        assembler._geom_collisions[geometry.lower()] = []
        assembler._visible_springs = assembler._has_visible_spring(root)
        report = Report(root=root, configuration="complex", lod=0)
        node = assembler.build_node(builder, root, report)
        assert node is not None
        return glb_document(builder.build([node], extras=report.as_dict())), report

    def ship_document(self):
        return self._assemble(self.SHIP_CON, "Fletcher",
                              "Objects/Vehicles/Sea/fletcher/Objects.con",
                              geometry="Fletcher_Hull")[0]

    def ship(self):
        document, report = self._assemble(
            self.SHIP_CON, "Fletcher",
            "Objects/Vehicles/Sea/fletcher/Objects.con",
            geometry="Fletcher_Hull")
        return {node["name"]: node for node in document["nodes"]}, report

    def test_meshless_physics_parts_survive_with_their_own_placement(self) -> None:
        nodes, _ = self.ship()

        self.assertIn("Fletcher_rudder", nodes)
        self.assertIn("Fletcher_HullWing", nodes)
        self.assertIn("Fletcher_Engine", nodes)
        # Bow at Refractor +55, stern at -55, and the exporter negates Z.
        self.assertEqual([0.0, -5.0, -55.0], nodes["Fletcher_HullWing"]["translation"])
        self.assertEqual([0.0, -5.0, 55.0], nodes["Fletcher_rudder"]["translation"])

    def test_every_buoyancy_point_is_its_own_node(self) -> None:
        document = self.ship_document()
        floaters = [node for node in document["nodes"]
                    if node["name"] == "Fletcher_Floater"]

        # Two `addTemplate Fletcher_Floater` lines, two nodes carrying the
        # same numbers at different points on the hull. Collapsing them onto
        # one would sink the bow.
        self.assertEqual(2, len(floaters))
        self.assertEqual([[-2.0, 7.5, -50.0], [2.0, 7.5, -50.0]],
                         [node["translation"] for node in floaters])
        self.assertEqual(1, len({json.dumps(node["extras"]["physics"])
                                 for node in floaters}))

    def test_hull_carries_the_body_scalars_and_the_engine_its_own(self) -> None:
        nodes, _ = self.ship()

        self.assertEqual(
            {"mass": 2500000.0, "drag": 3.0,
             "vehicleCategory": "VCSea", "vehicleType": "VTDestroyer"},
            nodes["Fletcher"]["extras"]["physics"])
        self.assertEqual(
            {"engineType": "c_ETShip", "torque": 2.0, "differential": 2.0,
             "noPropellerEffectAtSpeed": 120.0},
            nodes["Fletcher_Engine"]["extras"]["physics"])
        self.assertEqual(
            {"hullHeight": 20.0, "floatMaxLift": 2.0, "floatMinLift": 2.0},
            nodes["Fletcher_Floater"]["extras"]["physics"])

    def test_bow_and_stern_surfaces_deflect_opposite_ways(self) -> None:
        """`setAcceleration` -10 against +10 is what makes the hull carve.

        Both Wings carry the same lift coefficients and the same +/-25 degree
        range; the sign is the only thing that separates them, and it reaches
        the glb through the rig's `direction`.
        """
        nodes, _ = self.ship()

        bow = nodes["Fletcher_HullWing"]["extras"]
        stern = nodes["Fletcher_rudder"]["extras"]

        self.assertEqual(bow["physics"], stern["physics"])
        self.assertEqual(-1.0, bow["rig"]["axes"]["pitch"]["direction"])
        self.assertEqual(1.0, stern["rig"]["axes"]["pitch"]["direction"])
        self.assertEqual(15.0, stern["rig"]["axes"]["pitch"]["maxSpeed"])

    def test_a_camera_pivot_is_physics_data_but_not_a_rig(self) -> None:
        """The exemption that lets a meshless Wing keep its servo is keyed on
        the class, so it does not hand a rig to the eight vanilla Cameras that
        declare a non-zero `setPivotPosition` and to none of the other 46."""
        nodes, _ = self.ship()

        camera = nodes["FletcherCamera"]["extras"]

        self.assertEqual({"pivotPosition": [0.0, 0.25, 0.3]}, camera["physics"])
        self.assertNotIn("rig", camera)

    def test_a_part_with_no_physics_gets_no_physics_key(self) -> None:
        nodes, _ = self.ship()

        self.assertNotIn("physics", nodes["FletcherHull"]["extras"])

    def test_the_report_names_every_part_that_carries_physics(self) -> None:
        _, report = self.ship()

        self.assertEqual(
            ["Fletcher_HullWing", "Fletcher_rudder", "Fletcher_Engine",
             "Fletcher_Floater", "Fletcher_Floater", "FletcherCamera",
             "Fletcher"],
            [line.split()[1] for line in report.physics_parts])
        self.assertEqual(report.physics_parts, report.as_dict()["physicsParts"])

    def test_a_tanks_dummy_wheels_stay_distinguishable_from_its_real_ones(self) -> None:
        """Twelve road wheels, four of them load-bearing.

        Objects/Vehicles/Land/Sherman/Physics.con. A suspension model that
        cannot tell `c_PGFEngineDummyGrip` with `setStrength 0` from
        `c_PGFEngineGrip` with `setStrength 18` puts a Sherman on twelve
        springs.
        """
        document, _ = self._assemble("""
ObjectTemplate.create PlayerControlObject Sherman
ObjectTemplate.mass 25000
ObjectTemplate.drag 2
ObjectTemplate.addTemplate ShermanEngine

ObjectTemplate.create Engine ShermanEngine
ObjectTemplate.setEngineType c_ETTank
ObjectTemplate.setTorque 4.0
ObjectTemplate.setNumberOfGears 5
ObjectTemplate.addTemplate ShermanWheelL3
ObjectTemplate.setPosition -1/0.12/1.2
ObjectTemplate.addTemplate ShermanWheelL3Dummy
ObjectTemplate.setPosition -1/0.12/2.05

ObjectTemplate.create Spring ShermanWheelL3
ObjectTemplate.geometry Sherman_whe3L_M1
ObjectTemplate.Grip c_PGFEngineGrip
ObjectTemplate.setStrength 18
ObjectTemplate.setDamping 4

ObjectTemplate.create Spring ShermanWheelL3Dummy
ObjectTemplate.geometry Sherman_whe3L_M1
ObjectTemplate.Grip c_PGFEngineDummyGrip
ObjectTemplate.setStrength 0
ObjectTemplate.setDamping 0

GeometryTemplate.create StandardMesh Sherman_whe3L_M1
""", "Sherman", "Objects/Vehicles/Land/Sherman/Physics.con",
            geometry="Sherman_whe3L_M1")
        nodes = {node["name"]: node for node in document["nodes"]}

        real = nodes["ShermanWheelL3"]["extras"]["physics"]
        dummy = nodes["ShermanWheelL3Dummy"]["extras"]["physics"]

        self.assertEqual(18.0, real["strength"])
        self.assertEqual(0.0, dummy["strength"])
        self.assertEqual(0x04, real["gripFlags"])
        self.assertEqual(0x24, dummy["gripFlags"])
        self.assertEqual(4.0, nodes["ShermanEngine"]["extras"]["physics"]["torque"])

    def test_a_drivetrain_of_only_hidden_wheels_still_contributes_nothing(self) -> None:
        """The meshless-physics escape must not resurrect an empty Engine.

        A boat's land drivetrain is `createInvisible 1` wheels under an Engine
        that declares no physics of its own; before this change it was
        dropped, and it still is.
        """
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Sea/Test/Objects.con", """
ObjectTemplate.create Engine LandEngine
ObjectTemplate.addTemplate HiddenWheel

ObjectTemplate.create Spring HiddenWheel
ObjectTemplate.geometry Willy_WheelR_M1
ObjectTemplate.createInvisible 1
ObjectTemplate.Grip c_PGFEngineGrip
ObjectTemplate.setStrength 25

GeometryTemplate.create StandardMesh Willy_WheelR_M1
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        report = Report(root="LandEngine", configuration="complex", lod=0)

        self.assertIsNone(
            assembler.build_node(gltf.GlbBuilder(), "LandEngine", report))
        self.assertEqual([], report.physics_parts)


if __name__ == "__main__":
    unittest.main()


class AlphaBleedTests(unittest.TestCase):
    """Foliage RGB must survive filtering into its transparent texels."""

    def test_opaque_colour_dilates_into_transparent_texels(self) -> None:
        from bf42.assemble import Assembler

        # 3x1: one opaque green texel beside two transparent black ones.
        rgba = bytes([0, 200, 0, 255]) + bytes([0, 0, 0, 0]) * 2
        out = Assembler._bleed_alpha(3, 1, rgba, passes=2)

        self.assertEqual((0, 200, 0, 255), tuple(out[0:4]))
        # Neighbour takes the opaque colour; alpha is never touched.
        self.assertEqual((0, 200, 0, 0), tuple(out[4:8]))
        self.assertEqual(0, out[11])
        self.assertNotEqual((0, 0, 0), tuple(out[8:11]))

    def test_fully_opaque_image_is_returned_unchanged(self) -> None:
        from bf42.assemble import Assembler

        rgba = bytes([10, 20, 30, 255]) * 4
        self.assertIs(rgba, Assembler._bleed_alpha(2, 2, rgba))

    def test_fully_transparent_image_does_not_hang(self) -> None:
        from bf42.assemble import Assembler

        rgba = bytes([0, 0, 0, 0]) * 4
        self.assertEqual(bytes(rgba), Assembler._bleed_alpha(2, 2, rgba))

    def test_specular_alpha_skin_is_never_overwritten(self) -> None:
        """Opaque `_I` skins keep reflectivity in alpha (68-254 measured).

        Those texels are content, not cutout background: bleeding across them
        erased whole aircraft liveries (Wake's parked planes rendered as flat
        bled colour). Only near-zero alpha may be treated as cut away.
        """
        from bf42.assemble import Assembler

        # One fully opaque texel beside painted texels at semi alpha.
        rgba = bytes([255, 0, 0, 255]) + bytes([0, 0, 255, 119]) * 3
        out = Assembler._bleed_alpha(4, 1, rgba)

        self.assertEqual(bytes(rgba), bytes(out))


def pack_skn(vertices: list[tuple], bones: list[str]) -> bytes:
    out = bytearray()
    out += struct.pack("<II", 1, len(vertices))
    for rest, influences in vertices:
        out += struct.pack("<3f", *rest)
        out.append(len(influences))
        for bone, weight, offset in influences:
            out += struct.pack("<H", bone)
            out += struct.pack("<f", weight)
            out += struct.pack("<3f", *offset)
    out += struct.pack("<H", len(bones))
    for name in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw))
        out += raw
    return bytes(out)


def apply_bind(rotation, translation, offset):
    return tuple(
        sum(rotation[i][j] * offset[j] for j in range(3)) + translation[i]
        for i in range(3)
    )


class SoldierPartAlignmentTests(unittest.TestCase):
    """Hands AND the head are plugged into the 3P body's bind pose.

    Every `ComplexHead` skin assumes `Bip01 Spine3` in the exporter's default
    standing pose, while the body skin binds the same bone a few cm forward
    and lower (measured on GermanSoldier: head assumes (0, -0.013, 1.504),
    body binds (0.003, 0.018, 1.451)). Emitting the head unaligned leaves it
    floating high and behind the neck stump — the alignment must map the
    head's Spine3-weighted collar verts exactly onto the body's bind.
    """

    IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    # 15 deg about X: the head skin's chest is straighter than the body's.
    _c, _s = 0.9659258263, 0.2588190451
    TILT = ((1.0, 0.0, 0.0), (0.0, _c, -_s), (0.0, _s, _c))
    HEAD_SPINE3 = (0.0, -0.0132, 1.5038)   # head skin's assumed bind
    BODY_SPINE3 = (0.0033, 0.0177, 1.4507)  # where the body actually binds it
    OFFSETS = [(0.0, 0.0, 0.0), (0.05, 0.0, 0.0), (0.0, 0.04, 0.0), (0.0, 0.0, 0.03)]

    def _skin(self, rotation, translation, bone, path):
        verts = [
            (apply_bind(rotation, translation, offset), [(0, 1.0, offset)])
            for offset in self.OFFSETS
        ]
        return skin.parse(pack_skn(verts, [bone]), path)

    def _assembler(self) -> Assembler:
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/Test/Objects.con", """
ObjectTemplate.create BFSoldier TestSoldier
ObjectTemplate.addTemplate TestComplexHead1
ObjectTemplate.addTemplate Test3PBody
ObjectTemplate.addTemplate TestRightHand

ObjectTemplate.create AnimatedBundle TestComplexHead1
ObjectTemplate.geometry Soldier/TestFace

ObjectTemplate.create AnimatedBundle Test3PBody
ObjectTemplate.geometry Soldier/TestBody

ObjectTemplate.create AnimatedBundle TestRightHand
ObjectTemplate.geometry Soldier/TestRightHand
""")
        library.add_con("Objects/Soldiers/Test/Geometries.con", """
GeometryTemplate.create AnimatedMesh Soldier/TestFace
GeometryTemplate.setSkin animations/TestFace.skn

GeometryTemplate.create AnimatedMesh Soldier/TestBody
GeometryTemplate.setSkin animations/TestBody.skn

GeometryTemplate.create AnimatedMesh Soldier/TestRightHand
GeometryTemplate.setSkin animations/TestRightHand.skn
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        # The .skn archives are not on disk in a unit test; seed the cache the
        # same way `_read_skin` would fill it.
        assembler._skin_cache = {
            "animations/testface.skn": self._skin(
                self.IDENTITY, self.HEAD_SPINE3, "Bip01 Spine3", "face.skn"),
            "animations/testbody.skn": self._skin(
                self.TILT, self.BODY_SPINE3, "Bip01 Spine3", "body.skn"),
            "animations/testrighthand.skn": self._skin(
                self.IDENTITY, (-0.3147, 0.2447, 1.2255), "Bip01 R Forearm",
                "hand.skn"),
        }
        return assembler

    def test_head_collar_lands_exactly_on_the_bodys_spine3_bind(self) -> None:
        assembler = self._assembler()
        library = assembler.library
        body = assembler._soldier_body_skin(library.object("TestSoldier"))
        self.assertIsNotNone(body)

        aligned = assembler._part_alignment(library.object("TestComplexHead1"), body)

        self.assertIsNotNone(aligned)
        r_rel, t_rel, bone = aligned
        self.assertEqual("Bip01 Spine3", bone)
        # A collar vertex authored in the head's bind must land where the
        # body's bind puts the same bone-local point.
        for offset in self.OFFSETS:
            source = apply_bind(self.IDENTITY, self.HEAD_SPINE3, offset)
            expected = apply_bind(self.TILT, self.BODY_SPINE3, offset)
            mapped = apply_bind(r_rel, t_rel, source)
            for got, want in zip(mapped, expected):
                self.assertAlmostEqual(want, got, places=5)

    def test_the_body_itself_is_never_re_aligned(self) -> None:
        assembler = self._assembler()
        library = assembler.library
        body = assembler._soldier_body_skin(library.object("TestSoldier"))

        self.assertIsNone(assembler._part_alignment(library.object("Test3PBody"), body))

    def test_hands_still_align_through_the_forearm(self) -> None:
        assembler = self._assembler()
        library = assembler.library
        body = assembler._soldier_body_skin(library.object("TestSoldier"))
        # The body must expose the forearm too for the hand to have a shared
        # bone; rebuild it as a two-bone skin.
        forearm_bind = (self.TILT, (-0.3435, 0.1004, 1.3097))
        verts = [
            (apply_bind(self.TILT, self.BODY_SPINE3, offset), [(0, 1.0, offset)])
            for offset in self.OFFSETS
        ] + [
            (apply_bind(*forearm_bind, offset), [(1, 1.0, offset)])
            for offset in self.OFFSETS
        ]
        two_bone = skin.parse(
            pack_skn(verts, ["Bip01 Spine3", "Bip01 R Forearm"]), "body2.skn")
        assembler._skin_cache["animations/testbody.skn"] = two_bone
        body = assembler._soldier_body_skin(library.object("TestSoldier"))

        aligned = assembler._part_alignment(library.object("TestRightHand"), body)

        self.assertIsNotNone(aligned)
        self.assertEqual("Bip01 R Forearm", aligned[2])


class FireArmsBakeTests(unittest.TestCase):
    """Meshless plane guns must survive as muzzle nodes with firing extras."""

    GUNS_CON = """
ObjectTemplate.create Bundle PlaneComplex
ObjectTemplate.addTemplate PlaneBody
ObjectTemplate.addTemplate PlaneGuns
ObjectTemplate.setPosition 0/0/1

ObjectTemplate.create SimpleObject PlaneBody
ObjectTemplate.geometry Plane_hull

ObjectTemplate.create FireArms PlaneGuns
ObjectTemplate.visibleBarrelTemplate e_TestMuzz
ObjectTemplate.projectileTemplate PlaneProjectile
ObjectTemplate.setTracerTemplate Tracer_Projectile CRD_NONE/3/0/0
ObjectTemplate.magSize 900
ObjectTemplate.velocity 400
ObjectTemplate.roundOfFire 12
ObjectTemplate.addFireArmsPosition 2.6/0.21/1.8 -1.6/0/0
ObjectTemplate.addFireArmsPosition -2.6/0.21/1.8 1.6/0/0

ObjectTemplate.create Projectile Tracer_Projectile
ObjectTemplate.timeToLive CRD_NONE/3/0/0
ObjectTemplate.tracerScaler 50.0

ObjectTemplate.create EffectBundle e_TestMuzz
ObjectTemplate.addTemplate em_TestMuzz

ObjectTemplate.create Emitter em_TestMuzz
ObjectTemplate.template fx_TestMuzz
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0

ObjectTemplate.create Particle fx_TestMuzz
ObjectTemplate.geometry Muzz_m1
ObjectTemplate.timeToLive CRD_NONE/0.07/0/0
ObjectTemplate.sizeOverTime 0/0.12|100/9.4

GeometryTemplate.create StandardMesh Plane_hull
GeometryTemplate.create StandardMesh Muzz_m1
"""

    def _assemble(self, con_text: str | None = None):
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Air/Plane/Weapons.con",
                        con_text or self.GUNS_CON)
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        for geometry_name in ("Plane_hull", "Muzz_m1"):
            mesh_index = builder.add_mesh(geometry_name, [triangle])
            assembler._geom_mesh[geometry_name.lower()] = (mesh_index, 1)
            assembler._geom_collisions[geometry_name.lower()] = []
        report = Report(root="PlaneComplex", configuration="complex", lod=0)
        node = assembler.build_node(builder, "PlaneComplex", report)
        assert node is not None
        return glb_document(builder.build([node], extras=report.as_dict())), report

    def test_meshless_guns_survive_with_muzzles_and_stats(self) -> None:
        document, report = self._assemble()
        nodes = {node["name"]: node for node in document["nodes"]}

        guns = nodes["PlaneGuns"]
        fire = guns["extras"]["fireArms"]
        self.assertEqual(12.0, fire["roundOfFire"])
        self.assertEqual(900, fire["magSize"])
        self.assertEqual(400.0, fire["velocity"])
        self.assertEqual(2, fire["muzzles"])
        self.assertEqual(
            {"template": "Tracer_Projectile", "interval": 3,
             "timeToLive": 3.0, "scaler": 50.0},
            fire["tracer"])
        # The gun bundle's own placement (0/0/1 -> glTF z=-1) survives.
        self.assertEqual([0.0, 0.0, -1.0], guns["translation"])

        muzzle_names = [name for name in nodes if "muzzle" in name]
        self.assertEqual(2, len(muzzle_names))
        first = nodes["PlaneGuns muzzle 1"]
        self.assertEqual({"index": 0}, first["extras"]["muzzle"])
        # Refractor 2.6/0.21/1.8 -> glTF Z negated.
        self.assertEqual([2.6, 0.21, -1.8], first["translation"])

        # The flash chain resolved down to the Particle mesh emitter node.
        flash = nodes["em_TestMuzz"]
        self.assertEqual("mesh", flash["extras"]["effect"]["kind"])
        self.assertAlmostEqual(0.07, flash["extras"]["effect"]["timeToLive"])
        self.assertEqual([[0.0, 0.12], [100.0, 9.4]],
                         flash["extras"]["effect"]["sizeOverTime"])
        self.assertIn("mesh", flash)
        self.assertEqual(1, len(report.fire_arms))

    def test_meshless_projectile_types_as_bullet_without_a_baked_body(self) -> None:
        # PlaneProjectile resolves but has no geometry — invisible in game
        # bar the tracer rounds, so nothing gets baked to fly.
        document, _ = self._assemble(self.GUNS_CON + """
ObjectTemplate.create Projectile PlaneProjectile
ObjectTemplate.timeToLive CRD_NONE/3/0/0
ObjectTemplate.gravityModifier 0
""")
        nodes = {node["name"]: node for node in document["nodes"]}

        fire = nodes["PlaneGuns"]["extras"]["fireArms"]
        self.assertEqual(
            {"template": "PlaneProjectile", "kind": "bullet", "trail": None,
             "timeToLive": 3.0, "gravity": 0.0},
            fire["projectile"])
        self.assertNotIn("PlaneGuns projectile", nodes)

    def test_unresolved_projectile_still_types_as_bullet(self) -> None:
        document, _ = self._assemble(self.GUNS_CON)
        fire = next(node for node in document["nodes"]
                    if node["name"] == "PlaneGuns")["extras"]["fireArms"]
        self.assertEqual(
            {"template": "PlaneProjectile", "kind": "bullet", "trail": None},
            fire["projectile"])


class ProjectileBakeTests(unittest.TestCase):
    """Shells and rockets carry a typed spec and a baked hidden body."""

    ROCKET_CON = """
ObjectTemplate.create FireArms RocketRamp
ObjectTemplate.projectileTemplate TestRocket
ObjectTemplate.visibleDummyProjectileTemplate TestRocketDummy
ObjectTemplate.velocity 45
ObjectTemplate.roundOfFire 1
ObjectTemplate.addFireArmsPosition -1.15/-0.188/0 0/0/0

ObjectTemplate.create SimpleObject TestRocketDummy
ObjectTemplate.geometry Rocket_m1

ObjectTemplate.create Projectile TestRocket
ObjectTemplate.geometry Rocket_m1
ObjectTemplate.timeToLive CRD_NONE/20/0/0
ObjectTemplate.startEffectTemplate e_TestFume
ObjectTemplate.addTemplate TestRocket_Engine

ObjectTemplate.create Engine TestRocket_Engine
ObjectTemplate.setEngineType c_ETRocket

ObjectTemplate.create EffectBundle e_TestFume
ObjectTemplate.addTemplate Em_TestFume_Smoke
ObjectTemplate.addTemplate Em_TestFume_Fire

ObjectTemplate.create Emitter Em_TestFume_Smoke
ObjectTemplate.template Fx_TestFume_Smoke
ObjectTemplate.timeToLive CRD_NONE/7/0/0

ObjectTemplate.create SpriteParticle Fx_TestFume_Smoke
ObjectTemplate.timeToLive CRD_NORMAL/1.5/1.53/0
ObjectTemplate.size CRD_NONE/1.2/0/0
ObjectTemplate.sizeOverTime 0/0.4|16/0.5|100/0.75
ObjectTemplate.texture e_muzs1_I

ObjectTemplate.create Emitter Em_TestFume_Fire
ObjectTemplate.template Fx_TestFume_Fire

ObjectTemplate.create SpriteParticle Fx_TestFume_Fire
ObjectTemplate.timeToLive CRD_NONE/0.2/0.2/0
ObjectTemplate.size CRD_NONE/0.8/0/0
ObjectTemplate.texture e_fire4

GeometryTemplate.create StandardMesh Rocket_m1
"""

    def _assemble(self, root: str):
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Land/Test/Weapons.con", self.ROCKET_CON)
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        mesh_index = builder.add_mesh("Rocket_m1", [triangle])
        assembler._geom_mesh["rocket_m1"] = (mesh_index, 1)
        assembler._geom_collisions["rocket_m1"] = []
        report = Report(root=root, configuration="complex", lod=0)
        node = assembler.build_node(builder, root, report)
        assert node is not None
        return glb_document(builder.build([node], extras=report.as_dict())), report

    def test_rocket_projectile_is_typed_and_baked_under_the_gun(self) -> None:
        document, report = self._assemble("RocketRamp")
        nodes = {node["name"]: node for node in document["nodes"]}

        fire = nodes["RocketRamp"]["extras"]["fireArms"]
        self.assertEqual("TestRocket", fire["projectile"]["template"])
        self.assertEqual("rocket", fire["projectile"]["kind"])
        self.assertEqual(20.0, fire["projectile"]["timeToLive"])
        # The longest-lived sprite is the trail the eye follows — the smoke,
        # not the 0.2 s fire tongue.
        self.assertEqual(
            {"texture": "e_muzs1_I", "timeToLive": 1.5, "size": 1.2,
             "sizeOverTime": [[0.0, 0.4], [16.0, 0.5], [100.0, 0.75]]},
            fire["projectile"]["trail"])

        body = nodes["RocketRamp projectile"]
        self.assertEqual(
            {"template": "TestRocketDummy", "geometry": "Rocket_m1"},
            body["extras"]["projectileMesh"])
        self.assertIn("mesh", body)
        # Baked under the FireArms node, next to the muzzles.
        self.assertIn(
            document["nodes"].index(body),
            nodes["RocketRamp"]["children"])

    def test_shell_without_rocket_engine_types_as_shell(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Land/Test/Weapons.con", """
ObjectTemplate.create FireArms ShellGun
ObjectTemplate.projectileTemplate TestShell
ObjectTemplate.velocity 100

ObjectTemplate.create Projectile TestShell
ObjectTemplate.geometry Rocket_m1
ObjectTemplate.timeToLive CRD_NONE/10/0/0

GeometryTemplate.create StandardMesh Rocket_m1
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        assembler._geom_mesh["rocket_m1"] = (builder.add_mesh("Rocket_m1", [triangle]), 1)
        assembler._geom_collisions["rocket_m1"] = []
        report = Report(root="ShellGun", configuration="complex", lod=0)
        node = assembler.build_node(builder, "ShellGun", report)
        document = glb_document(builder.build([node], extras=report.as_dict()))
        nodes = {n["name"]: n for n in document["nodes"]}

        fire = nodes["ShellGun"]["extras"]["fireArms"]
        self.assertEqual("shell", fire["projectile"]["kind"])
        self.assertIsNone(fire["projectile"]["trail"])
        self.assertIn("ShellGun projectile", nodes)


class HandFireArmsBakeTests(unittest.TestCase):
    """A hand weapon is the FireArms contract held in a hand: same muzzle
    node and firing extras, plus the handling block on the report."""

    HANDGUN_CON = """
ObjectTemplate.create HandFireArms TestSmg
ObjectTemplate.geometry Smg_m1
ObjectTemplate.projectileTemplate TestSmgProjectile
ObjectTemplate.projectilePosition 0/0/0
ObjectTemplate.magSize 30
ObjectTemplate.numOfMag 5
ObjectTemplate.roundOfFire 10
ObjectTemplate.velocity 1000
ObjectTemplate.fireInCameraDof 1
ObjectTemplate.setCrossHairType CHTCrossHair
ObjectTemplate.setMinDev 0.4
ObjectTemplate.setFireDev 2 0.35 0.06
ObjectTemplate.setDevMod 1.2 1.05 0.9
ObjectTemplate.setSpeedDev 0.8 0.2 0.2 0.1

ObjectTemplate.create Projectile TestSmgProjectile
ObjectTemplate.geometry Bullet_m1
ObjectTemplate.timeToLive CRD_NONE/1/0/0
ObjectTemplate.gravityModifier 0
ObjectTemplate.invisible 1

GeometryTemplate.create StandardMesh Smg_m1
GeometryTemplate.create StandardMesh Bullet_m1
"""

    def _export(self):
        library = ObjectLibrary()
        library.add_con("Objects/HandWeapons/TestSmg/Objects.con",
                        self.HANDGUN_CON)
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        # export() drives its own builder, and the mesh cache holds
        # builder-specific indices — so seed lazily through a patched
        # _mesh_index rather than pre-populating against the wrong builder.
        def fake_mesh_index(builder, geometry, report):
            key = geometry.lower()
            if key not in assembler._geom_mesh:
                index = builder.add_mesh(geometry, [triangle])
                assembler._geom_mesh[key] = (index, 1)
                assembler._geom_collisions[key] = []
            return assembler._geom_mesh[key]

        assembler._mesh_index = fake_mesh_index
        data, report = assembler.export("TestSmg")
        return glb_document(data), report

    def test_hand_weapon_bakes_fire_extras_and_reports_handling(self) -> None:
        document, report = self._export()
        nodes = {node["name"]: node for node in document["nodes"]}

        fire = nodes["TestSmg"]["extras"]["fireArms"]
        self.assertEqual(10.0, fire["roundOfFire"])
        self.assertEqual(1000.0, fire["velocity"])
        self.assertEqual(1, fire["muzzles"])
        self.assertIn("TestSmg muzzle 1", nodes)

        # `invisible 1` on the bullet: geometry alone must not promote it to
        # a drawn shell, and no body is baked to fly.
        self.assertEqual("bullet", fire["projectile"]["kind"])
        self.assertEqual(0.0, fire["projectile"]["gravity"])
        self.assertNotIn("TestSmg projectile", nodes)

        weapon = report.weapon
        self.assertTrue(weapon["fireInCameraDof"])
        self.assertEqual("CHTCrossHair", weapon["crossHair"])
        self.assertEqual(0.4, weapon["deviation"]["min"])
        self.assertEqual([2.0, 0.35, 0.06], weapon["deviation"]["fire"])
        self.assertEqual([1.2, 1.05, 0.9], weapon["deviation"]["mod"])
        self.assertEqual([0.8, 0.2, 0.2, 0.1], weapon["deviation"]["speed"])
        self.assertEqual({"size": 30, "magazines": 5},
                         {k: weapon["magazine"][k] for k in ("size", "magazines")})
        # The handling block rides the glb too, on the document extras.
        self.assertEqual(weapon, document["extras"]["weapon"])


class TracerBakeTests(unittest.TestCase):
    """A bullet's tracer is the only part of it the game draws, so its mesh
    is baked like a projectile body rather than left to the viewer to invent."""

    GUN_CON = """
ObjectTemplate.create FireArms WingGuns
ObjectTemplate.projectileTemplate TestBullet
ObjectTemplate.setTracerTemplate Tracer_Projectile CRD_NONE/3/0/0
ObjectTemplate.velocity 400
ObjectTemplate.roundOfFire 12
ObjectTemplate.addFireArmsPosition 2.229/-0.245/2.6 -1.1/0/0
ObjectTemplate.addFireArmsPosition -2.229/-0.245/2.6 1.1/0/0

ObjectTemplate.create Projectile TestBullet
ObjectTemplate.timeToLive CRD_NONE/1.5/0/0

ObjectTemplate.create Projectile Tracer_Projectile
ObjectTemplate.geometry TLight_m1
ObjectTemplate.timeToLive CRD_NONE/3/0/0
ObjectTemplate.tracerScaler 50.0

GeometryTemplate.create StandardMesh TLight_m1
"""

    def _assemble(self, con: str, root: str):
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Air/Test/Weapons.con", con)
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        assembler._geom_mesh["tlight_m1"] = (
            builder.add_mesh("TLight_m1", [triangle]), 1)
        assembler._geom_collisions["tlight_m1"] = []
        report = Report(root=root, configuration="complex", lod=0)
        node = assembler.build_node(builder, root, report)
        assert node is not None
        return glb_document(builder.build([node], extras=report.as_dict()))

    def test_tracer_mesh_is_baked_under_the_gun(self) -> None:
        document = self._assemble(self.GUN_CON, "WingGuns")
        nodes = {node["name"]: node for node in document["nodes"]}

        tracer = nodes["WingGuns"]["extras"]["fireArms"]["tracer"]
        self.assertEqual("Tracer_Projectile", tracer["template"])
        self.assertEqual(3, tracer["interval"])
        self.assertEqual(3.0, tracer["timeToLive"])
        self.assertEqual(50.0, tracer["scaler"])
        # The geometry name rides along so a stale GLB is distinguishable from
        # a gun whose tracer genuinely has no mesh.
        self.assertEqual("TLight_m1", tracer["geometry"])

        streak = nodes["WingGuns tracer"]
        self.assertEqual(
            {"template": "Tracer_Projectile", "geometry": "TLight_m1"},
            streak["extras"]["tracerMesh"])
        self.assertIn("mesh", streak)
        self.assertIn(document["nodes"].index(streak),
                      nodes["WingGuns"]["children"])

    def test_tracer_without_geometry_bakes_no_node(self) -> None:
        con = self.GUN_CON.replace("ObjectTemplate.geometry TLight_m1\n", "")
        document = self._assemble(con, "WingGuns")
        names = [node["name"] for node in document["nodes"]]
        tracer = {node["name"]: node
                  for node in document["nodes"]}["WingGuns"]["extras"]["fireArms"]["tracer"]
        self.assertNotIn("geometry", tracer)
        self.assertNotIn("WingGuns tracer", names)
        # The rest of the tracer metadata still ships.
        self.assertEqual(50.0, tracer["scaler"])


class EmitterMotionBakeTests(unittest.TestCase):
    """Emitter drift along the direction of fire rides the effect extras."""

    def test_speed_and_offset_in_dof_are_exported(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Effects/e_TestMuzz/Effects.con", """
ObjectTemplate.create EffectBundle e_TestMuzz
ObjectTemplate.addTemplate Em_TestSmoke

ObjectTemplate.create Emitter Em_TestSmoke
ObjectTemplate.template Fx_TestSmoke
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.relativePositionInDof CRD_NONE/-0.4/0/0
ObjectTemplate.positionalSpeedInDof CRD_UNIFORM/-5/-10/0

ObjectTemplate.create SpriteParticle Fx_TestSmoke
ObjectTemplate.timeToLive CRD_NONE/0.5/0.5/0
ObjectTemplate.texture e_muz1_I
ObjectTemplate.destBlendMode BMOne
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        report = Report(root="e_TestMuzz", configuration="complex", lod=0)
        # The sprite texture is not on disk in a unit test; seed the quad the
        # same way `_sprite_quad_mesh` would fill its cache.
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        assembler._sprite_mesh_cache["e_muz1_i"] = builder.add_mesh(
            "fx quad", [triangle])
        bundle = library.object("e_TestMuzz")

        emitters = assembler._effect_emitter_nodes(builder, bundle, report)

        self.assertEqual(1, len(emitters))
        document = glb_document(builder.build(emitters, extras=report.as_dict()))
        effect = document["nodes"][0]["extras"]["effect"]
        self.assertEqual(-0.4, effect["offsetInDof"])
        self.assertEqual(-5.0, effect["speedInDof"])


class EmitterViewBakeTests(unittest.TestCase):
    """`showInFirstPerson` / `showInThirdPerson` ride along as `effect.view`.

    This is `e_MuzzHeavy` in miniature — the bundle every vanilla aircraft gun
    names as its `visibleBarrelTemplate`. It carries two flashes, and which one
    the engine draws is the difference between a 0.4 m sprite at the pilot's
    eye and a 1.76 m mesh ramped to nine times its own length.
    """

    def _bake(self):
        library = ObjectLibrary()
        library.add_con("Objects/Effects/e_TestMuzz/Effects.con", """
ObjectTemplate.create EffectBundle e_TestMuzz
ObjectTemplate.addTemplate em_TestMuzz
ObjectTemplate.addTemplate em_1P_TestMuzz
ObjectTemplate.addTemplate em_TestBoth

ObjectTemplate.create Emitter em_TestMuzz
ObjectTemplate.template Fx_TestMuzz
ObjectTemplate.showInThirdPerson 1

ObjectTemplate.create Emitter em_1P_TestMuzz
ObjectTemplate.template Fx_1P_TestMuzz
ObjectTemplate.showInFirstPerson 1

ObjectTemplate.create Emitter em_TestBoth
ObjectTemplate.template Fx_TestBoth

ObjectTemplate.create SpriteParticle Fx_TestMuzz
ObjectTemplate.timeToLive CRD_NONE/0.07/0/0
ObjectTemplate.texture e_muz1_I
ObjectTemplate.destBlendMode BMOne

ObjectTemplate.create SpriteParticle Fx_1P_TestMuzz
ObjectTemplate.timeToLive CRD_NONE/0.05/0/0
ObjectTemplate.texture e_muz1_I
ObjectTemplate.destBlendMode BMOne

ObjectTemplate.create SpriteParticle Fx_TestBoth
ObjectTemplate.timeToLive CRD_NONE/0.05/0/0
ObjectTemplate.texture e_muz1_I
ObjectTemplate.destBlendMode BMOne
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        report = Report(root="e_TestMuzz", configuration="complex", lod=0)
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        assembler._sprite_mesh_cache["e_muz1_i"] = builder.add_mesh(
            "fx quad", [triangle])
        bundle = library.object("e_TestMuzz")
        emitters = assembler._effect_emitter_nodes(builder, bundle, report)
        document = glb_document(builder.build(emitters, extras=report.as_dict()))
        return {node["name"]: node["extras"]["effect"]
                for node in document["nodes"] if "extras" in node}

    def test_first_person_emitters_are_kept_not_dropped(self) -> None:
        # They used to be skipped outright, which is right for a browse
        # thumbnail and wrong the moment a camera sits in a cockpit.
        self.assertIn("em_1P_TestMuzz", self._bake())

    def test_restricted_emitters_name_their_view(self) -> None:
        baked = self._bake()
        self.assertEqual("first", baked["em_1P_TestMuzz"]["view"])
        self.assertEqual("third", baked["em_TestMuzz"]["view"])

    def test_unrestricted_emitters_declare_no_view(self) -> None:
        # 341 of vanilla's 364 emitters declare neither flag and are drawn in
        # both views; so is every emitter in a glb baked before the flag was
        # exported, which is why absence has to mean "both".
        self.assertNotIn("view", self._bake()["em_TestBoth"])


if __name__ == "__main__":
    unittest.main()
