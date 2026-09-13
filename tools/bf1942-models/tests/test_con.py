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

    def test_lod_selector_block_is_parsed_and_bound_to_its_lod_object(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Air/Corsair/Objects.con",
            """
ObjectTemplate.create LodObject lodCorsairCockpit
ObjectTemplate.addTemplate CorsairCockpitExternal
ObjectTemplate.addTemplate CorsairCockpitInternal
ObjectTemplate.lodSelector CorsairCockpitSelector

ObjectTemplate.create SimpleObject CorsairCockpitInternal
ObjectTemplate.geometry 1P_Corsair

LodSelectorTemplate.create DistCompareSelector CorsairCockpitSelector
LodSelectorTemplate.addLodDistance 20
LodSelectorTemplate.addLodComparison 0.5
""",
        )

        lod = library.object("lodCorsairCockpit")
        self.assertEqual("CorsairCockpitSelector", lod.lod_selector)
        # `lodSelector` follows two `addTemplate` lines, and everything else
        # that follows one belongs to that child instance. This does not.
        self.assertEqual(
            [None, None],
            [getattr(child, "lod_selector", None) for child in lod.children],
        )

        selector = library.selector("corsaircockpitselector")
        self.assertEqual("DistCompareSelector", selector.kind)
        self.assertEqual([20.0], selector.distances)
        self.assertEqual([0.5], selector.comparisons)
        self.assertEqual(
            {"selector": "CorsairCockpitSelector",
             "selectorKind": "DistCompareSelector",
             "distances": [20.0], "comparisons": [0.5]},
            selector.as_dict(),
        )
        self.assertIsNone(library.selector(None))
        self.assertIsNone(library.selector("NoSuchSelector"))

    def test_selector_thresholds_accumulate_in_declaration_order(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Test/Objects.con",
            """
LodSelectorTemplate.create DistCompareSelector2 TestLodSelector
LodSelectorTemplate.hasDestroyedLod 1
LodSelectorTemplate.addLodDistance 200
LodSelectorTemplate.addLodDistance 400
""",
        )
        selector = library.selector("TestLodSelector")
        self.assertEqual([200.0, 400.0], selector.distances)
        self.assertEqual([], selector.comparisons)

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

    def test_fire_arms_spatial_and_rate_fields_are_read(self) -> None:
        # Verbatim from the Spitfire's Weapons.con: two converged wing
        # muzzles, a muzzle-flash EffectBundle, every-3rd-round tracers.
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Air/Spitfire/Weapons.con",
            """
ObjectTemplate.create FireArms SpitfireGuns
ObjectTemplate.visibleBarrelTemplate e_MuzzHeavy
ObjectTemplate.projectileTemplate SpitfireProjectile
ObjectTemplate.projectilePosition 0/0/2
ObjectTemplate.setTracerTemplate Tracer_Projectile CRD_NONE/3/0/0
ObjectTemplate.magSize 900
ObjectTemplate.velocity 400
ObjectTemplate.roundOfFire 12
ObjectTemplate.addFireArmsPosition 2.6/0.21/1.8 -1.6/0/0
ObjectTemplate.addFireArmsPosition -2.6/0.21/1.8 1.6/0/0
""",
        )
        guns = library.object("SpitfireGuns")
        self.assertEqual("e_MuzzHeavy", guns.visible_barrel_template)
        self.assertEqual("SpitfireProjectile", guns.projectile_template)
        self.assertEqual((0.0, 0.0, 2.0), guns.projectile_position)
        self.assertEqual("Tracer_Projectile", guns.tracer_template)
        self.assertEqual(3, guns.tracer_interval)
        self.assertEqual(900, guns.mag_size)
        self.assertEqual(400.0, guns.velocity)
        self.assertEqual(12.0, guns.round_of_fire)
        self.assertEqual([((2.6, 0.21, 1.8), (-1.6, 0.0, 0.0)),
                          ((-2.6, 0.21, 1.8), (1.6, 0.0, 0.0))],
                         guns.fire_arms_positions)

    def test_tank_recoil_and_crd_time_to_live_are_read(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Sherman/Weapons.con",
            """
ObjectTemplate.create FireArms ShermanGunBarrel
ObjectTemplate.geometry Sherman_Canon1_M1
ObjectTemplate.addTemplate e_MuzzPanz
ObjectTemplate.setPosition 0/0/0.5
ObjectTemplate.projectileTemplate ShermanProjectile
ObjectTemplate.roundOfFire 0.35
ObjectTemplate.recoilSpeed 10
ObjectTemplate.recoilSize 3

ObjectTemplate.create Projectile Tracer_Projectile
ObjectTemplate.timeToLive CRD_NONE/3/0/0
ObjectTemplate.tracerScaler 50.0
""",
        )
        barrel = library.object("ShermanGunBarrel")
        self.assertEqual(3.0, barrel.recoil_size)
        self.assertEqual(10.0, barrel.recoil_speed)
        self.assertEqual(0.35, barrel.round_of_fire)
        # setPosition after addTemplate still places the child, not the gun.
        self.assertEqual((0.0, 0.0, 0.5), barrel.children[0].position)
        tracer = library.object("Tracer_Projectile")
        self.assertEqual(3.0, tracer.time_to_live)
        self.assertEqual(50.0, tracer.tracer_scaler)

    def test_projectile_flight_fields_are_read(self) -> None:
        # Verbatim-shaped from the Katyusha: the FireArms names a separate
        # drawn body, the projectile declares its trail effect, and its motor
        # is a c_ETRocket Engine child.
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Katyusha/Weapons.con",
            """
ObjectTemplate.create FireArms KatyushaFireArmsBundle
ObjectTemplate.projectileTemplate KatyushaRocket
ObjectTemplate.visibleDummyProjectileTemplate KatyushaRocketDummy

ObjectTemplate.create Projectile KatyushaRocket
ObjectTemplate.timeToLive CRD_NONE/20/0/0
ObjectTemplate.startEffectTemplate e_KatyushaFume

ObjectTemplate.create Projectile SpitfireProjectile
ObjectTemplate.gravityModifier 0

ObjectTemplate.create SpriteParticle Fx_KatyushaDamage
ObjectTemplate.gravityModifier CRD_UNIFORM/-0.1/-0.2/0

ObjectTemplate.create Engine KatyushaRocket_Engine
ObjectTemplate.setEngineType c_ETRocket
""",
        )

        guns = library.object("KatyushaFireArmsBundle")
        self.assertEqual("KatyushaRocket", guns.projectile_template)
        self.assertEqual("KatyushaRocketDummy",
                         guns.visible_dummy_projectile_template)
        rocket = library.object("KatyushaRocket")
        self.assertEqual("e_KatyushaFume", rocket.start_effect_template)
        # gravityModifier accepts both bare numbers and CRD triples.
        self.assertEqual(0.0, library.object("SpitfireProjectile").gravity_modifier)
        self.assertEqual(-0.1, library.object("Fx_KatyushaDamage").gravity_modifier)
        self.assertEqual("c_ETRocket",
                         library.object("KatyushaRocket_Engine").engine_type)

    def test_emitter_motion_in_dof_is_read(self) -> None:
        # Verbatim from the Sherman's Em_MuzzPanz_WSmoke (recedes behind the
        # muzzle) and Em_MuzzPanz_Smoke (spawns 0.4 m back).
        library = ObjectLibrary()
        library.add_con(
            "Objects/Effects/e_MuzzPanz/Effects.con",
            """
ObjectTemplate.create Emitter Em_MuzzPanz_WSmoke
ObjectTemplate.template Fx_MuzzPanz_WSmoke
ObjectTemplate.positionalSpeedInDof CRD_UNIFORM/-5/-10/0

ObjectTemplate.create Emitter Em_MuzzPanz_Smoke
ObjectTemplate.template Fx_MuzzPanz_Smoke
ObjectTemplate.relativePositionInDof CRD_NONE/-0.4/0/0
ObjectTemplate.positionalSpeedInDof CRD_NONE/15/0/0
""",
        )

        wsmoke = library.object("Em_MuzzPanz_WSmoke")
        self.assertEqual(-5.0, wsmoke.positional_speed_in_dof)
        self.assertIsNone(wsmoke.relative_position_in_dof)
        smoke = library.object("Em_MuzzPanz_Smoke")
        self.assertEqual(-0.4, smoke.relative_position_in_dof)
        self.assertEqual(15.0, smoke.positional_speed_in_dof)

    def test_effect_chain_fields_are_read(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Effects/e_MuzzHeavy/effects.con",
            """
ObjectTemplate.create Emitter em_MuzzHeavy_glow
ObjectTemplate.template fx_MuzzHeavy_glow
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.showInThirdPerson 1

ObjectTemplate.create SpriteParticle fx_MuzzHeavy_glow
ObjectTemplate.timeToLive CRD_NONE/0.07/0.07/0
ObjectTemplate.size CRD_NONE/0.43/0/0
ObjectTemplate.texture e_fire4
ObjectTemplate.destBlendMode BMOne
ObjectTemplate.colorRGBAOverTime 0/255/255/128/255|100/255/128/0/65

ObjectTemplate.create Particle fx_MuzzHeavy
ObjectTemplate.geometry MuzzHeavy_m1
ObjectTemplate.timeToLive CRD_NONE/0.07/0/0
ObjectTemplate.sizeOverTime 0/0.12009|100/9.40001
""",
        )
        emitter = library.object("em_MuzzHeavy_glow")
        self.assertEqual("fx_MuzzHeavy_glow", emitter.emitter_template)
        self.assertEqual(0.1, emitter.time_to_live)
        self.assertTrue(emitter.show_in_third_person)
        sprite = library.object("fx_MuzzHeavy_glow")
        self.assertEqual("e_fire4", sprite.sprite_texture)
        self.assertEqual(0.43, sprite.sprite_size)
        self.assertEqual("BMOne", sprite.dest_blend_mode)
        self.assertEqual([[0.0, 255.0, 255.0, 128.0, 255.0],
                          [100.0, 255.0, 128.0, 0.0, 65.0]],
                         sprite.color_over_time)
        particle = library.object("fx_MuzzHeavy")
        self.assertEqual([[0.0, 0.12009], [100.0, 9.40001]],
                         particle.size_over_time)


if __name__ == "__main__":
    unittest.main()
