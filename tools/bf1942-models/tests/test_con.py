from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import (  # noqa: E402
    ChildRef,
    ObjectLibrary,
    ObjectTemplate,
    instance_template_name,
    select_lod_alternative,
)


class ObjectLibraryTests(unittest.TestCase):
    def test_argumentless_command_does_not_consume_geometry_declaration(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Geometries.con",
            """
renderer.endGlobalCluster

GeometryTemplate.create StandardMesh TestHull
GeometryTemplate.file SharedHull
""",
        )

        geometry = library.geometry("TestHull")

        self.assertIsNotNone(geometry)
        self.assertEqual("SharedHull", geometry.mesh_file)

    def test_child_transform_is_applied_to_last_added_child(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Objects.con",
            """
ObjectTemplate.create Bundle TestComplex
ObjectTemplate.geometry TestHull
ObjectTemplate.addTemplate TestTurret
ObjectTemplate.setPosition 1/-2/3
ObjectTemplate.setRotation 10/20/30
""",
        )

        root = library.object("TestComplex")

        self.assertEqual((0.0, 0.0, 0.0), root.position)
        self.assertEqual((1.0, -2.0, 3.0), root.children[0].position)
        self.assertEqual((10.0, 20.0, 30.0), root.children[0].rotation)

    def test_numeric_inputs_and_free_rotation_are_preserved(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Objects.con",
            """
ObjectTemplate.create RotationalBundle TestTurret
ObjectTemplate.setInputToYaw 4
ObjectTemplate.setInputToPitch 5
""",
        )

        rig = library.object("TestTurret").rig()

        self.assertEqual("c_PIMouseLookX", rig["axes"]["yaw"]["input"])
        self.assertEqual("c_PIMouseLookY", rig["axes"]["pitch"]["input"])
        self.assertTrue(rig["axes"]["yaw"]["free"])
        self.assertTrue(rig["axes"]["pitch"]["free"])

    def test_rotation_span_distinguishes_rate_from_pose(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Objects.con",
            """
ObjectTemplate.create Engine TestDrivetrain
ObjectTemplate.setMinRotation 0/0/-5000
ObjectTemplate.setMaxRotation 0/0/5000
ObjectTemplate.setInputToRoll c_PIThrottle

ObjectTemplate.create Engine TestLean
ObjectTemplate.setMinRotation 0/0/-1
ObjectTemplate.setMaxRotation 0/0/1
ObjectTemplate.setInputToRoll c_PIThrottle
""",
        )

        drivetrain = library.object("TestDrivetrain").rig()
        lean = library.object("TestLean").rig()

        self.assertEqual("rate", drivetrain["axes"]["roll"]["driver"])
        self.assertEqual("position", lean["axes"]["roll"]["driver"])

    def test_player_control_object_starts_a_new_input_scope(self) -> None:
        seat = ObjectTemplate(name="CommanderSeat", kind="PlayerControlObject")
        turret = ObjectTemplate(name="Turret", kind="RotationalBundle")

        self.assertEqual("CommanderSeat", seat.control_scope("vehicle"))
        self.assertEqual("CommanderSeat", turret.control_scope("CommanderSeat"))

    def test_vehicle_armor_properties_are_preserved(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Objects.con",
            """
ObjectTemplate.create PlayerControlObject Test
ObjectTemplate.hasArmor 1
ObjectTemplate.hitpoints 100
ObjectTemplate.maxhitpoints 100
ObjectTemplate.material 50
ObjectTemplate.criticalDamage 12
ObjectTemplate.hpLostWhileCriticalDamage 1.5
""",
        )

        vehicle = library.object("Test")

        self.assertTrue(vehicle.has_armor)
        self.assertEqual(100, vehicle.hitpoints)
        self.assertEqual(100, vehicle.max_hitpoints)
        self.assertEqual(50, vehicle.material)
        self.assertEqual(12, vehicle.critical_damage)
        self.assertEqual(1.5, vehicle.hp_lost_while_critical_damage)

    def test_available_configurations_and_selection_follow_lod_roles(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Objects.con",
            """
ObjectTemplate.create PlayerControlObject Test
ObjectTemplate.addTemplate lodTest

ObjectTemplate.create LodObject lodTest
ObjectTemplate.addTemplate TestComplex
ObjectTemplate.addTemplate TestSimple
ObjectTemplate.addTemplate TestWreck

ObjectTemplate.create Bundle TestComplex
ObjectTemplate.addTemplate lodTestCockpit

ObjectTemplate.create LodObject lodTestCockpit
ObjectTemplate.addTemplate TestCockpitExternal
ObjectTemplate.addTemplate TestCockpitInternal
""",
        )

        self.assertEqual(
            ["complex", "wreck"],
            library.available_configurations("Test"),
        )

        root_alternatives = [
            ChildRef("TestComplex"),
            ChildRef("TestSimple"),
            ChildRef("TestWreck"),
        ]
        cockpit_alternatives = [
            ChildRef("TestCockpitExternal"),
            ChildRef("TestCockpitInternal"),
        ]
        self.assertEqual(
            "TestWreck",
            select_lod_alternative(root_alternatives, "wreck").template,
        )
        self.assertEqual(
            "TestComplex",
            select_lod_alternative(root_alternatives, "complex").template,
        )
        self.assertEqual(
            "TestCockpitExternal",
            select_lod_alternative(cockpit_alternatives, "complex").template,
        )
        self.assertEqual(
            "afr_house1_steExterior",
            select_lod_alternative(
                [ChildRef("afr_house1_steInterior"), ChildRef("afr_house1_steExterior")],
                "complex",
            ).template,
        )

    def test_geometry_set_skin_is_kept_on_the_template(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Soldiers/Test/Geometries.con",
            """
GeometryTemplate.create AnimatedMesh Soldier/3PTestBody
GeometryTemplate.setSkin animations/TestBody.skn
GeometryTemplate.file TestBody
""",
        )

        geometry = library.geometry("Soldier/3PTestBody")

        self.assertEqual("AnimatedMesh", geometry.kind)
        self.assertEqual("TestBody", geometry.mesh_file)
        self.assertEqual("animations/TestBody.skn", geometry.skin)

    def test_soldier_children_skip_first_person_and_distant_head(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Soldiers/Test/Objects.con",
            """
ObjectTemplate.create BFSoldier TestSoldier
ObjectTemplate.addTemplate TestComplexHead
ObjectTemplate.setRandomGeometries 3
ObjectTemplate.setIsFirstPersonPart 0
ObjectTemplate.setLodValue 0.01
ObjectTemplate.addTemplate TestHead
ObjectTemplate.setIsFirstPersonPart 0
ObjectTemplate.setLodValue -0.01
ObjectTemplate.addTemplate Test3PBody
ObjectTemplate.setIsFirstPersonPart 0
ObjectTemplate.addTemplate Test1PBody
ObjectTemplate.setIsFirstPersonPart 1

ObjectTemplate.create AnimatedBundle TestComplexHead1
ObjectTemplate.geometry Soldier/TestFace
ObjectTemplate.create SimpleObject TestHead
ObjectTemplate.geometry Soldier/TestHead
ObjectTemplate.create SimpleObject Test3PBody
ObjectTemplate.geometry Soldier/3PBody
ObjectTemplate.create SimpleObject Test1PBody
ObjectTemplate.geometry Soldier/1PBody
""",
        )

        names = [
            instance_template_name(child, library.object)
            for child in library.object("TestSoldier").children
        ]

        self.assertEqual(["TestComplexHead1", None, "Test3PBody", None], names)

    def test_create_invisible_is_stored_on_the_template(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Sea/Test/Physics.con",
            """
ObjectTemplate.create Spring PT_FrontWheel
ObjectTemplate.geometry Willy_WheelR_M1
ObjectTemplate.createInvisible 1

ObjectTemplate.create Spring VisibleWheel
ObjectTemplate.geometry Willy_WheelR_M1
ObjectTemplate.createInvisible 0
""",
        )

        self.assertTrue(library.object("PT_FrontWheel").invisible)
        self.assertFalse(library.object("VisibleWheel").invisible)

    def test_bind_to_skeleton_part_belongs_to_the_child_not_the_template(self) -> None:
        """A hand weapon places its sub-parts with a bone name instead of an offset."""
        library = ObjectLibrary()
        library.add_con(
            "Objects/HandWeapons/Test/Objects.con",
            """
ObjectTemplate.create AnimatedBundle TestComplex
ObjectTemplate.geometry TestBody
ObjectTemplate.createSkeleton animations/Test.ske
ObjectTemplate.addTemplate TestTrigger
ObjectTemplate.bindToSkeletonPart Trigger
ObjectTemplate.addTemplate TestMag
ObjectTemplate.bindToSkeletonPart mag
""",
        )

        template = library.object("TestComplex")

        self.assertEqual("animations/Test.ske", template.skeleton)
        self.assertEqual(
            [("TestTrigger", "Trigger"), ("TestMag", "mag")],
            [(c.template, c.skeleton_part) for c in template.children])

    def test_bind_to_skeleton_part_ignores_the_trailing_bone_index(self) -> None:
        """Soldiers write `bindToSkeletonPart Bip01_Spine3 3`; only the name matters."""
        library = ObjectLibrary()
        library.add_con(
            "Objects/Soldiers/Test/Objects.con",
            """
ObjectTemplate.create BFSoldier TestSoldier
ObjectTemplate.addTemplate TestComplexHead
ObjectTemplate.bindToSkeletonPart Bip01_Spine3 3
""",
        )

        self.assertEqual(
            "Bip01_Spine3", library.object("TestSoldier").children[0].skeleton_part)

    def test_use_skeleton_part_as_main_belongs_to_the_template(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/HandWeapons/Test/Objects.con",
            """
ObjectTemplate.create HandFireArms Test
ObjectTemplate.createSkeleton animations/Test.ske
ObjectTemplate.useSkeletonPartAsMain TestBody
ObjectTemplate.addTemplate TestLod
""",
        )

        template = library.object("Test")

        self.assertEqual("TestBody", template.skeleton_main)
        self.assertEqual("animations/Test.ske", template.skeleton)
        self.assertIsNone(template.children[0].skeleton_part)


if __name__ == "__main__":
    unittest.main()
