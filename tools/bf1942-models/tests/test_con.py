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
    is_propeller_blur_pair,
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
        # With no selector to consult, only the name role is available.
        self.assertEqual(
            "afr_house1_steExterior",
            select_lod_alternative(
                [ChildRef("afr_house1_steInterior"), ChildRef("afr_house1_steExterior")],
                "complex",
            ).template,
        )

    def test_distance_selector_takes_the_near_rung_not_the_complex_name(self) -> None:
        """A building's `Interior` is the near LOD, and it is what gets drawn.

        `SupplydeExterior` is the hollow shell the engine drops to past 70 m.
        Picking it by name role is what left level bakes with buildings you
        could walk into and then see straight out of.
        """
        library = ObjectLibrary()
        library.add_con(
            "Objects/Buildings/Common/Supplyde/Objects.con",
            """
ObjectTemplate.create Bundle Supplyde_m1
ObjectTemplate.addTemplate lodSupplyde

LodSelectorTemplate.create DistanceSelector SupplydeSelector
LodSelectorTemplate.addLodDistance 70
ObjectTemplate.create LodObject lodSupplyde
ObjectTemplate.lodSelector SupplydeSelector
ObjectTemplate.addTemplate SupplydeInterior
ObjectTemplate.addTemplate SupplydeExterior

ObjectTemplate.create Bundle SupplydeInterior
ObjectTemplate.geometry Supplyde_m1

ObjectTemplate.create SimpleObject SupplydeExterior
ObjectTemplate.geometry Supplyde_m2
""",
        )
        lod = library.object("lodSupplyde")
        selector = library.selector(lod.lod_selector)
        self.assertTrue(selector.ranks_by_distance)
        self.assertEqual(
            "SupplydeInterior",
            select_lod_alternative(lod.children, "complex", selector).template,
        )

    def test_compare_selector_keeps_the_name_role_over_child_order(self) -> None:
        """A cockpit swap is a state, not a ladder, so order carries nothing."""
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Air/Corsair/Objects.con",
            """
LodSelectorTemplate.create DistCompareSelector CorsairCockpitSelector
LodSelectorTemplate.addLodDistance 20
LodSelectorTemplate.addLodComparison 0.5
ObjectTemplate.create LodObject lodCorsairCockpit
ObjectTemplate.lodSelector CorsairCockpitSelector
ObjectTemplate.addTemplate CorsairCockpitInternal
ObjectTemplate.addTemplate CorsairCockpitExternal
""",
        )
        lod = library.object("lodCorsairCockpit")
        selector = library.selector(lod.lod_selector)
        self.assertFalse(selector.ranks_by_distance)
        # The interior is listed first here; the role still decides.
        self.assertEqual(
            "CorsairCockpitExternal",
            select_lod_alternative(lod.children, "complex", selector).template,
        )

    def test_propeller_static_and_blurred_are_recognised_regardless_of_order(self) -> None:
        # Neither name matches an interior/wreck/simple/complex role, so
        # `select_lod_alternative` would otherwise fall back to child order —
        # this is the pair `_select_lod_children` has to catch first.
        self.assertTrue(is_propeller_blur_pair(
            [ChildRef("CorsairPropellerStatic"), ChildRef("CorsairPropellerBlurred")]))
        self.assertTrue(is_propeller_blur_pair(
            [ChildRef("CorsairPropellerBlurred"), ChildRef("CorsairPropellerStatic")]))

    def test_propeller_blur_pair_requires_exactly_the_two_named_alternatives(self) -> None:
        # An ordinary complex/wreck LodObject must never be mistaken for one.
        self.assertFalse(is_propeller_blur_pair(
            [ChildRef("CorsairComplex"), ChildRef("CorsairWreck")]))
        # A third alternative (unseen in the shipped data) is not the swap
        # either — the engine's `CompareSelector` only ever holds two.
        self.assertFalse(is_propeller_blur_pair([
            ChildRef("CorsairPropellerStatic"),
            ChildRef("CorsairPropellerBlurred"),
            ChildRef("CorsairPropellerExtra"),
        ]))

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

    def test_type_qualified_geometry_reference_resolves_to_the_bare_template(self) -> None:
        # `Fx_Shell792mm`, the shell-eject emitter payload, writes
        # `ObjectTemplate.geometry StandardMesh:Shell792mmHI_m1` while the
        # GeometryTemplate is declared under the bare name.
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Geometries.con",
            """
GeometryTemplate.create StandardMesh Shell792mmHI_m1
GeometryTemplate.file shell792mmHi_m1
""",
        )

        qualified = library.geometry("StandardMesh:Shell792mmHI_m1")

        self.assertIs(library.geometry("Shell792mmHI_m1"), qualified)
        self.assertEqual("shell792mmHi_m1", qualified.mesh_file)
        self.assertEqual(
            "Objects/Vehicles/Test/Art",
            library.art_dir("StandardMesh:Shell792mmHI_m1"),
        )

    def test_geometry_qualifier_is_matched_case_insensitively(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Geometries.con",
            "GeometryTemplate.create StandardMesh Shell9mmHI_m1\n",
        )

        self.assertIsNotNone(library.geometry("standardMesh:shell9mmHI_m1"))

    def test_geometry_qualifier_disagreeing_with_the_declaration_does_not_resolve(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Test/Geometries.con",
            "GeometryTemplate.create StandardMesh TestHull\n",
        )

        self.assertIsNone(library.geometry("TreeMesh:TestHull"))

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

    def test_load_sound_script_rides_out_on_the_weapon_stats(self) -> None:
        # `loadSoundScript` binds to whichever template is active, exactly as
        # `parse_sound_scripts` reads it — K98/Objects.con declares two
        # HandFireArms and each keeps its own script. The path is kept
        # relative and forward-slashed; resolving it against the `.con`'s
        # folder is the sound extraction's job, not the parser's.
        library = ObjectLibrary()
        library.add_con(
            "Objects/HandWeapons/K98/Objects.con",
            """
ObjectTemplate.create HandFireArms K98
ObjectTemplate.loadSoundScript Sounds\\K98.ssc

ObjectTemplate.create HandFireArms K98Sniper
ObjectTemplate.loadSoundScript Sounds/K98.ssc
""",
        )
        rifle = library.object("K98")
        self.assertEqual("Sounds/K98.ssc", rifle.sound_script)
        self.assertEqual("Sounds/K98.ssc",
                         library.object("K98Sniper").sound_script)
        self.assertEqual("Sounds/K98.ssc", rifle.weapon_stats()["soundScript"])

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


class PhysicsVocabularyTests(unittest.TestCase):
    """The `.con` physics vocabulary, out of the shipped files verbatim.

    Every block below is copied from vanilla `Objects.rfa` with nothing
    normalised — including `setTorque 4.0` written with a decimal point and
    `setTorque 2` without, and `ObjectTemplate.Grip` being the one physics
    directive with no `set` prefix. Where a number looks wrong it is quoted
    from the file anyway and the reason is in the test.
    """

    @staticmethod
    def library(text: str, path: str = "Objects/Vehicles/Land/Test/Physics.con") -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con(path, text)
        return library

    def test_tank_drivetrain_is_read_off_the_engine(self) -> None:
        # Objects/Vehicles/Land/Sherman/Physics.con:4-27.
        library = self.library("""
ObjectTemplate.create Engine ShermanEngine
ObjectTemplate.setMinRotation -1/0/-1
ObjectTemplate.setMaxRotation 1/0/1
ObjectTemplate.setInputToYaw c_PIYaw
ObjectTemplate.setInputToRoll c_PIThrottle
ObjectTemplate.setEngineType c_ETTank
ObjectTemplate.setTorque 4.0
ObjectTemplate.setDifferential 4.0
ObjectTemplate.setNumberOfGears 5
ObjectTemplate.setGearUp 0.95
ObjectTemplate.setGearDown 0.45
ObjectTemplate.setGearChangeTime 0.05
""")

        self.assertEqual(
            {"engineType": "c_ETTank", "torque": 4.0, "differential": 4.0,
             "numberOfGears": 5, "gearUp": 0.95, "gearDown": 0.45,
             "gearChangeTime": 0.05},
            library.object("ShermanEngine").physics(),
        )

    def test_ship_engine_declares_a_thrust_zero_speed_and_no_gearbox(self) -> None:
        # Objects/Vehicles/Sea/fletcher/Physics.con:28-40.
        library = self.library("""
ObjectTemplate.create Engine Fletcher_Engine
ObjectTemplate.setEngineType c_ETShip
ObjectTemplate.setTorque 2
ObjectTemplate.setDifferential 2
ObjectTemplate.setNoPropellerEffectAtSpeed 120
""", "Objects/Vehicles/Sea/fletcher/Physics.con")

        self.assertEqual(
            {"engineType": "c_ETShip", "torque": 2.0, "differential": 2.0,
             "noPropellerEffectAtSpeed": 120.0},
            library.object("Fletcher_Engine").physics(),
        )

    def test_grip_is_a_bitfield_and_a_zeroed_spring_is_not_an_absent_one(self) -> None:
        """`c_PGFEngineDummyGrip` is EngineGrip|DummyGrip, not a fifth class.

        Both templates are Objects/Vehicles/Land/Sherman/Physics.con, the
        load-bearing wheel at :57-66 and the cosmetic one at :29-37. Telling
        them apart is the difference between a Sherman riding on four springs
        and riding on twelve, and it is a bit test — 0x24 & 0x04 is true.
        """
        library = self.library("""
ObjectTemplate.create Spring ShermanWheelL3
ObjectTemplate.Grip c_PGFEngineGrip
ObjectTemplate.setStrength 18
ObjectTemplate.setDamping 4

ObjectTemplate.create Spring ShermanWheelL3Dummy
ObjectTemplate.Grip c_PGFEngineDummyGrip
ObjectTemplate.setStrength 0
ObjectTemplate.setDamping 0
""")

        real = library.object("ShermanWheelL3").physics()
        dummy = library.object("ShermanWheelL3Dummy").physics()

        self.assertEqual(
            {"grip": "c_PGFEngineGrip", "gripFlags": 0x04,
             "strength": 18.0, "damping": 4.0},
            real)
        self.assertEqual(
            {"grip": "c_PGFEngineDummyGrip", "gripFlags": 0x24,
             "strength": 0.0, "damping": 0.0},
            dummy)
        self.assertTrue(dummy["gripFlags"] & 0x04)   # engine-driven
        self.assertTrue(dummy["gripFlags"] & 0x20)   # and cosmetic
        # A zeroed spring keeps its zeros. Pruning falsy values instead of
        # None ones would delete exactly the field that identifies it.
        self.assertIn("strength", dummy)

    def test_spring_strength_is_not_normalised_by_gravity(self) -> None:
        """The engine multiplies; the exporter must not.

        `PhysicsSpring::updatePhysics` (0x0057f0d0) applies
        `strength * displacement * |g|/9.82`, so at the engine's real
        -14.73 m/s^2 a spring pushes about 1.5x as hard as its `.con` value.
        Folding that in here would make the export disagree with the file.
        """
        library = self.library("""
ObjectTemplate.create Spring CorsairWheelLeft
ObjectTemplate.Grip c_PGFRollGripWhenOccupied
ObjectTemplate.setStrength 24
ObjectTemplate.setDamping 12
""", "Objects/Vehicles/Air/Corsair/Physics.con")

        self.assertEqual(24.0, library.object("CorsairWheelLeft").physics()["strength"])

    def test_unknown_grip_name_keeps_the_name_and_claims_no_bits(self) -> None:
        library = self.library("""
ObjectTemplate.create Spring ModdedWheel
ObjectTemplate.Grip c_PGFHoverGrip
ObjectTemplate.setStrength 5
""")

        physics = library.object("ModdedWheel").physics()

        self.assertEqual("c_PGFHoverGrip", physics["grip"])
        self.assertNotIn("gripFlags", physics)

    def test_wing_carries_both_lift_terms_and_its_application_point(self) -> None:
        # Objects/Vehicles/Air/Corsair/Physics.con — the left regulator flap,
        # whose offset is the exact negation of its attach position so that
        # sustaining lift acts at the centre of mass and produces no torque.
        library = self.library("""
ObjectTemplate.create Wing CorsairFlapLeftMiddle
ObjectTemplate.setMinRotation 0/-2/0
ObjectTemplate.setMaxRotation 0/2/0
ObjectTemplate.setPitchOffset 0.5
ObjectTemplate.setPositionOffset 2.564/0.135/-0.895
ObjectTemplate.setFlapLift 4
ObjectTemplate.setRegulateToLift 4.91
ObjectTemplate.setWingToRegulatorRatio 1
""", "Objects/Vehicles/Air/Corsair/Physics.con")

        self.assertEqual(
            {"flapLift": 4.0, "pitchOffset": 0.5,
             "positionOffset": [2.564, 0.135, -0.895],
             "regulateToLift": 4.91, "wingToRegulatorRatio": 1.0},
            library.object("CorsairFlapLeftMiddle").physics(),
        )

    def test_ship_rudder_keeps_its_zero_wing_lift(self) -> None:
        """A rudder aligned with the flow must make no force, so `setWingLift
        0` is the datum, not a missing value. Same class as an aileron —
        Objects/Vehicles/Sea/fletcher/Physics.con:14-25."""
        library = self.library("""
ObjectTemplate.create Wing Fletcher_rudder
ObjectTemplate.setMinRotation 0/-25/0
ObjectTemplate.setMaxRotation 0/25/0
ObjectTemplate.setInputToPitch c_PIYaw
ObjectTemplate.setPositionOffset 0/0/0
ObjectTemplate.setWingLift 0
ObjectTemplate.setFlapLift 2
""", "Objects/Vehicles/Sea/fletcher/Physics.con")

        physics = library.object("Fletcher_rudder").physics()

        self.assertEqual(0.0, physics["wingLift"])
        self.assertEqual(2.0, physics["flapLift"])

    def test_elevator_remembers_excess_input(self) -> None:
        library = self.library("""
ObjectTemplate.create Wing CorsairFlapTailLeft
ObjectTemplate.rememberExcessInput 1
ObjectTemplate.setWingLift 0.5
ObjectTemplate.setFlapLift 0.5
""", "Objects/Vehicles/Air/Corsair/Physics.con")

        self.assertIs(True,
                      library.object("CorsairFlapTailLeft").physics()["rememberExcessInput"])

    def test_buoyancy_point_and_the_asymmetric_lift_that_is_a_dive(self) -> None:
        # Objects/Vehicles/Sea/fletcher/Physics.con:47-50 and
        # Objects/Vehicles/Sea/Gato/Physics.con:93-103. The submarine's
        # min/max spread is the whole of its dive model.
        library = self.library("""
ObjectTemplate.create FloatingBundle Fletcher_Floater
ObjectTemplate.setHullHeight 20
ObjectTemplate.setFloatMaxLift 2
ObjectTemplate.setFloatMinLift 2

ObjectTemplate.create FloatingBundle GatoFloater
ObjectTemplate.setHullHeight 3.3
ObjectTemplate.setFloatMaxLift 1.6275
ObjectTemplate.setFloatMinLift 0.8275
""", "Objects/Vehicles/Sea/fletcher/Physics.con")

        self.assertEqual(
            {"hullHeight": 20.0, "floatMaxLift": 2.0, "floatMinLift": 2.0},
            library.object("Fletcher_Floater").physics())
        self.assertEqual(
            {"hullHeight": 3.3, "floatMaxLift": 1.6275, "floatMinLift": 0.8275},
            library.object("GatoFloater").physics())

    def test_hull_drag_and_sinking_speed_ride_on_the_floater(self) -> None:
        library = self.library("""
ObjectTemplate.create FloatingBundle HatsuzukiFloater
ObjectTemplate.setHullHeight 10
ObjectTemplate.setFloatMaxLift 2
ObjectTemplate.setFloatMinLift 2
ObjectTemplate.setSinkingSpeedMod 7
ObjectTemplate.setDragModifier 8000.0
""", "Objects/Vehicles/Sea/Hatsuzuki/Physics.con")

        physics = library.object("HatsuzukiFloater").physics()

        self.assertEqual(7.0, physics["sinkingSpeedMod"])
        self.assertEqual(8000.0, physics["dragModifier"])

    def test_landing_gear_thresholds_are_not_the_engines_gearbox(self) -> None:
        """Two unrelated vocabularies that share the word "gear".

        `setGearUp`/`setGearDown` on an Engine are transmission shift points
        as a fraction of max revs; `setGearUpHeight` and friends on a
        LandingGear are metres and throttle positions. The Corsair declares
        both, with different numbers.
        """
        library = self.library("""
ObjectTemplate.create Engine CorsairEngine
ObjectTemplate.setEngineType c_ETPlane
ObjectTemplate.setTorque 15
ObjectTemplate.setGearUp 0.7
ObjectTemplate.setGearDown 0.3
ObjectTemplate.setNoPropellerEffectAtSpeed 70

ObjectTemplate.create LandingGear CorsairLandingGearLeft
ObjectTemplate.setGearUpHeight 23
ObjectTemplate.setGearDownHeight 25
ObjectTemplate.setGearUpEngineInput 0.7
ObjectTemplate.setGearDownEngineInput 0.4
""", "Objects/Vehicles/Air/Corsair/Physics.con")

        engine = library.object("CorsairEngine").physics()
        gear = library.object("CorsairLandingGearLeft").physics()

        self.assertEqual(0.7, engine["gearUp"])
        self.assertEqual(0.3, engine["gearDown"])
        self.assertNotIn("gearUpHeight", engine)
        self.assertEqual(
            {"gearUpHeight": 23.0, "gearDownHeight": 25.0,
             "gearUpEngineInput": 0.7, "gearDownEngineInput": 0.4},
            gear)

    def test_body_carries_mass_drag_inertia_and_the_occupancy_scalars(self) -> None:
        # Objects/Vehicles/Land/Willy/Objects.con:1-44, trimmed to the
        # physics-bearing lines; `setVehicleType` really is written with two
        # spaces after it in the shipped file.
        library = self.library("""
ObjectTemplate.create PlayerControlObject Willy
ObjectTemplate.damageFromWater 1
ObjectTemplate.drag 1.5
ObjectTemplate.mass 2500
ObjectTemplate.speedMod 1
ObjectTemplate.exitTimer 0.75
ObjectTemplate.hpLostWhileUpSideDown 5
ObjectTemplate.hpLostWhileDamageFromWater 5
ObjectTemplate.setSoldierExitLocation -1.5/0/-0.8 0/0/0
ObjectTemplate.setVehicleCategory VCLand
ObjectTemplate.setVehicleType  VTScoutCar
ObjectTemplate.hasRestrictedExit 1
""", "Objects/Vehicles/Land/Willy/Objects.con")

        self.assertEqual(
            {"mass": 2500.0, "drag": 1.5, "speedMod": 1.0,
             "vehicleCategory": "VCLand", "vehicleType": "VTScoutCar",
             "exitTimer": 0.75, "hasRestrictedExit": True,
             "soldierExitLocation": {"position": [-1.5, 0.0, -0.8],
                                     "rotation": [0.0, 0.0, 0.0]},
             "damageFromWater": True,
             "hpLostWhileDamageFromWater": 5.0,
             "hpLostWhileUpSideDown": 5.0},
            library.object("Willy").physics(),
        )

    def test_aircraft_body_keeps_per_axis_inertia_ratios(self) -> None:
        # Corsair/Objects.con:12 against B17/Objects.con:13 — the ratios are
        # shipped data even though the base tensor is not.
        library = self.library("""
ObjectTemplate.create PlayerControlObject Corsair
ObjectTemplate.mass 2500
ObjectTemplate.drag 0.0652
ObjectTemplate.inertiaModifier 1.05/0.850/0.94
ObjectTemplate.angleMod 1
ObjectTemplate.speedMod 2
ObjectTemplate.setVehicleCategory VCAir
""", "Objects/Vehicles/Air/Corsair/Objects.con")

        physics = library.object("Corsair").physics()

        self.assertEqual([1.05, 0.85, 0.94], physics["inertiaModifier"])
        self.assertEqual(0.0652, physics["drag"])
        self.assertEqual(1.0, physics["angleMod"])

    def test_malformed_vehicle_category_is_passed_through_not_repaired(self) -> None:
        """`AA_Allies` declares bare `Land` where 56 templates say `VCLand`.

        Normalising it would hide a shipped data bug from anything that keys
        on the exact string.
        """
        library = self.library("""
ObjectTemplate.create PlayerControlObject AA_Allies
ObjectTemplate.setVehicleCategory Land
ObjectTemplate.setVehicleType AAGun
""", "Objects/Vehicles/Land/AA_Base/Objects.con")

        self.assertEqual("Land",
                         library.object("AA_Allies").physics()["vehicleCategory"])

    def test_submarine_data_is_seven_unnamed_floats_in_declaration_order(self) -> None:
        """Nothing establishes what any of the seven mean, so nothing is named.

        Objects/Vehicles/Sea/Gato/Objects.con:73-75. The two vanilla
        submarines differ in exactly one position, the fifth.
        """
        library = self.library("""
ObjectTemplate.create PlayerControlObject Gato
ObjectTemplate.mass 800000
ObjectTemplate.submarineData 0.009 0.03 1 10 19.5 40 5
ObjectTemplate.setSubmarineHudDepthModifier 5.9
ObjectTemplate.setSubmarineHudDirModifier 0.01
""", "Objects/Vehicles/Sea/Gato/Objects.con")

        physics = library.object("Gato").physics()

        self.assertEqual([0.009, 0.03, 1.0, 10.0, 19.5, 40.0, 5.0],
                         physics["submarineData"])
        self.assertEqual(5.9, physics["submarineHudDepthModifier"])
        self.assertEqual(0.01, physics["submarineHudDirModifier"])

    def test_soldier_exit_location_keeps_its_rotation_and_survives_without_one(self) -> None:
        library = self.library("""
ObjectTemplate.create PlayerControlObject Fletcher_Back_Canons_PCO
ObjectTemplate.setSoldierExitLocation 0.5/4/-26 120/0/0

ObjectTemplate.create PlayerControlObject TestNoRotation
ObjectTemplate.setSoldierExitLocation 1.2/0.2/0
""", "Objects/Vehicles/Sea/fletcher/Objects.con")

        self.assertEqual(
            {"position": [0.5, 4.0, -26.0], "rotation": [120.0, 0.0, 0.0]},
            library.object("Fletcher_Back_Canons_PCO").physics()["soldierExitLocation"])
        self.assertEqual(
            {"position": [1.2, 0.2, 0.0], "rotation": [0.0, 0.0, 0.0]},
            library.object("TestNoRotation").physics()["soldierExitLocation"])

    def test_inert_pivot_position_is_dropped_and_a_real_one_kept(self) -> None:
        # 22 of the 30 vanilla uses are 0/0/0. LynxCamera is one that is not.
        library = self.library("""
ObjectTemplate.create Camera LynxCamera
ObjectTemplate.setPivotPosition 0/0.25/0.3

ObjectTemplate.create Wing SBDFlapLeft
ObjectTemplate.setPivotPosition 0/0/0
ObjectTemplate.setWingLift 1
""", "Objects/Vehicles/Land/Lynx/Objects.con")

        self.assertEqual({"pivotPosition": [0.0, 0.25, 0.3]},
                         library.object("LynxCamera").physics())
        self.assertEqual({"wingLift": 1.0}, library.object("SBDFlapLeft").physics())

    def test_directive_names_are_case_insensitive(self) -> None:
        """The shipped files are not consistent and the engine does not care.

        `ObjectTemplate.Grip` is capitalised, `objectTemplate.cullRadiusScale`
        lower-cases the namespace, and mods spell everything else however they
        like.
        """
        library = self.library("""
objectTemplate.create SPRING TestWheel
OBJECTTEMPLATE.grip C_PGFENGINEGRIP
ObjectTemplate.SETSTRENGTH 18
objecttemplate.setdamping 4
""")

        self.assertEqual(
            {"grip": "C_PGFENGINEGRIP", "gripFlags": 0x04,
             "strength": 18.0, "damping": 4.0},
            library.object("TestWheel").physics())

    def test_a_part_with_no_physics_declares_none(self) -> None:
        library = self.library("""
ObjectTemplate.create RotationalBundle ShermanTower
ObjectTemplate.geometry Sherman_Tower_M1
ObjectTemplate.setInputToYaw c_PIMouseLookX
""")

        self.assertIsNone(library.object("ShermanTower").physics())


class HudSupplyAndSoldierWordsTests(unittest.TestCase):
    """SupplyDepot, vehicle/hand-weapon HUD, kit HUD and soldier constants.

    Every snippet below is verbatim from vanilla's `Objects.rfa` (F1 round,
    2026-09-16) unless the docstring says otherwise.
    """

    def library(self, path: str, text: str) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con(path, text)
        return library

    def test_supply_depot_words_are_read_from_the_ammobox_bundle(self) -> None:
        # Objects/Buildings/Common/Ammobox/Objects.con, verbatim: a Bundle
        # nesting two SupplyDepot templates, one soldier-facing and one
        # vehicle-facing.
        library = self.library(
            "Objects/Buildings/Common/Ammobox/Objects.con",
            """
ObjectTemplate.create Bundle Ammobox
ObjectTemplate.geometry Ammobox_m1
ObjectTemplate.addTemplate AmmoboxSupplyDepot
ObjectTemplate.setPosition 0/0/0
ObjectTemplate.setRotation 0/0/0
ObjectTemplate.addTemplate AmmoboxVehicleSupplyDepot
ObjectTemplate.setPosition 0/0/0
ObjectTemplate.setRotation 0/0/0

ObjectTemplate.create SupplyDepot AmmoboxSupplyDepot
ObjectTemplate.radius 3
ObjectTemplate.team 0
ObjectTemplate.setHealth 0 0 0
ObjectTemplate.addAmmoType 1 -1 15 0
ObjectTemplate.addAmmoType 2 -1 1.2 0
ObjectTemplate.addAmmoType 3 -1 1.2 0
ObjectTemplate.workOnVehicles 0
ObjectTemplate.workOnSoldiers 1
ObjectTemplate.loadSoundScript ../../../Common/Sounds/SupplyDepot.ssc

ObjectTemplate.create SupplyDepot AmmoboxVehicleSupplyDepot
ObjectTemplate.radius 15
ObjectTemplate.team 0
ObjectTemplate.setHealth 0 0 0
ObjectTemplate.addAmmoType 0 -1 20 0
ObjectTemplate.workOnVehicles 1
ObjectTemplate.workOnSoldiers 0
ObjectTemplate.loadSoundScript ../../../Common/Sounds/SupplyDepot.ssc
""")
        soldier_depot = library.object("AmmoboxSupplyDepot")
        vehicle_depot = library.object("AmmoboxVehicleSupplyDepot")

        self.assertEqual(3.0, soldier_depot.supply_radius)
        self.assertEqual(0, soldier_depot.supply_team)
        self.assertEqual((0.0, 0.0, 0.0), soldier_depot.supply_set_health)
        self.assertEqual(
            [(1.0, -1.0, 15.0, 0.0), (2.0, -1.0, 1.2, 0.0), (3.0, -1.0, 1.2, 0.0)],
            soldier_depot.supply_ammo_types)
        self.assertFalse(soldier_depot.supply_work_on_vehicles)
        self.assertTrue(soldier_depot.supply_work_on_soldiers)
        self.assertEqual("../../../Common/Sounds/SupplyDepot.ssc",
                         soldier_depot.sound_script)

        self.assertEqual(15.0, vehicle_depot.supply_radius)
        self.assertEqual([(0.0, -1.0, 20.0, 0.0)], vehicle_depot.supply_ammo_types)
        self.assertTrue(vehicle_depot.supply_work_on_vehicles)
        self.assertFalse(vehicle_depot.supply_work_on_soldiers)

    def test_supply_depot_radius_does_not_collide_with_a_projectiles_splash_radius(self) -> None:
        # `radius` is spelled identically on a SupplyDepot (work range) and a
        # Projectile (splash radius) -- the parser must route it by kind.
        library = self.library(
            "Objects/Buildings/Common/mediclocker/Objects.con",
            """
ObjectTemplate.create SupplyDepot mediclockerRepairpoint
ObjectTemplate.radius 2
ObjectTemplate.team 0
ObjectTemplate.workOnVehicles 0
ObjectTemplate.workOnSoldiers 1
ObjectTemplate.setHealth -1 4.0 0

ObjectTemplate.create Projectile TestShell
ObjectTemplate.radius 8
""")
        depot = library.object("mediclockerRepairpoint")
        shell = library.object("TestShell")

        self.assertEqual(2.0, depot.supply_radius)
        self.assertIsNone(depot.explosion_radius)
        self.assertEqual((-1.0, 4.0, 0.0), depot.supply_set_health)
        self.assertEqual(8.0, shell.explosion_radius)
        self.assertIsNone(shell.supply_radius)

    def test_repair_depot_carries_vehicle_types_not_ammo_types(self) -> None:
        # Objects/Buildings/Common/landrep1_supply/Objects.con, trimmed to
        # three vehicle types plus the trailing addAmmoType every land depot
        # also carries (for a stray soldier's rifle ammo).
        library = self.library(
            "Objects/Buildings/Common/landrep1_supply/Objects.con",
            """
ObjectTemplate.create SupplyDepot repairpoint
ObjectTemplate.radius 5
ObjectTemplate.team 0
ObjectTemplate.addVehicleType tiger -1 4 0
ObjectTemplate.addVehicleType Panzeriv -1 4 0
ObjectTemplate.addVehicleType sherman -1 4 0
ObjectTemplate.addAmmoType 0 -1 10 0
ObjectTemplate.workOnVehicles 1
ObjectTemplate.workOnSoldiers 0
""")
        depot = library.object("repairpoint")

        self.assertEqual(
            [("tiger", -1.0, 4.0, 0.0), ("Panzeriv", -1.0, 4.0, 0.0),
             ("sherman", -1.0, 4.0, 0.0)],
            depot.supply_vehicle_types)
        self.assertEqual([(0.0, -1.0, 10.0, 0.0)], depot.supply_ammo_types)

    def test_vehicle_hud_words_are_read_off_the_playercontrolobject_root(self) -> None:
        # Objects/Vehicles/Land/Defgun/Objects.con and
        # Objects/Vehicles/Land/Sherman/Objects.con, trimmed to the HUD block.
        library = self.library(
            "Objects/Vehicles/Land/Defgun/Objects.con",
            """
ObjectTemplate.create PlayerControlObject Defgun
ObjectTemplate.hitpoints 50
ObjectTemplate.maxhitpoints 50
ObjectTemplate.setVehicleIcon "Vehicle/Icon_defgun.tga"
ObjectTemplate.setNumberOfWeaponIcons 1
ObjectTemplate.setPrimaryAmmoIcon "Ammo/Icon_cannon.tga"
ObjectTemplate.setPrimaryAmmoBar ABAmmoBarReloadBar

ObjectTemplate.create PlayerControlObject Sherman
ObjectTemplate.hitpoints 100
ObjectTemplate.maxhitpoints 100
ObjectTemplate.setVehicleIcon "Vehicle/Icon_sherman.tga"
ObjectTemplate.setNumberOfWeaponIcons 2
ObjectTemplate.setPrimaryAmmoIcon "Ammo/Icon_cannon.tga"
ObjectTemplate.setPrimaryAmmoBar ABAmmoBarReloadBar
ObjectTemplate.setSecondaryAmmoIcon "Ammo/Icon_bullet.tga"
ObjectTemplate.setSecondaryAmmoBar ABAmmoBarHeatBar
""")
        defgun = library.object("Defgun")
        sherman = library.object("Sherman")

        self.assertEqual("Vehicle/Icon_defgun.tga", defgun.vehicle_icon)
        self.assertEqual("Ammo/Icon_cannon.tga", defgun.vehicle_primary_ammo_icon)
        self.assertEqual("ABAmmoBarReloadBar", defgun.vehicle_primary_ammo_bar)
        self.assertIsNone(defgun.vehicle_secondary_ammo_bar)
        # `menu/InGame` paints the one-panel copy of the ammo bar at 1 and the
        # two-panel copy at 2 (verify-r2.md R2-13); a seat that declares
        # neither paints no ammo at all.
        self.assertEqual(1, defgun.vehicle_weapon_icons)

        self.assertEqual("Vehicle/Icon_sherman.tga", sherman.vehicle_icon)
        self.assertEqual("ABAmmoBarReloadBar", sherman.vehicle_primary_ammo_bar)
        self.assertEqual("Ammo/Icon_bullet.tga", sherman.vehicle_secondary_ammo_icon)
        self.assertEqual("ABAmmoBarHeatBar", sherman.vehicle_secondary_ammo_bar)
        self.assertEqual(100.0, sherman.hitpoints)
        self.assertEqual(100.0, sherman.max_hitpoints)
        self.assertEqual(2, sherman.vehicle_weapon_icons)

    def test_vehicle_firearms_carry_magazine_reload_and_heat_words(self) -> None:
        # Objects/Vehicles/Land/Defgun/Weapons.con (no heat -- a single-shot
        # cannon) and Objects/Stationary_Weapons/Coaxial_Browning/Objects.con
        # (a machine gun: magazine *and* heat, independently of each other).
        library = self.library(
            "Objects/Vehicles/Land/Defgun/Weapons.con",
            """
ObjectTemplate.create FireArms DefgunGunBarrel
ObjectTemplate.projectileTemplate Defgun_Projectile
ObjectTemplate.magSize 499
ObjectTemplate.numOfMag 999
ObjectTemplate.velocity 125
ObjectTemplate.reloadtime 5
ObjectTemplate.roundOfFire 0.2

ObjectTemplate.create FireArms Coaxial_browning
ObjectTemplate.projectileTemplate Browning_Projectile
ObjectTemplate.magSize 400
ObjectTemplate.numOfMag 1
ObjectTemplate.magType 0
ObjectTemplate.reloadtime 0.1
ObjectTemplate.roundOfFire 12
ObjectTemplate.autoReload 1
objectTemplate.heatAddWhenFire 0.05
objectTemplate.coolDownPerSec 0.3
objectTemplate.timeDelayOnOverHeat 2
""")
        cannon = library.object("DefgunGunBarrel")
        mg = library.object("Coaxial_browning")

        self.assertEqual(499, cannon.mag_size)
        self.assertEqual(999, cannon.num_of_mag)
        self.assertEqual(5.0, cannon.reload_time)
        self.assertIsNone(cannon.heat_add_when_fire)

        self.assertEqual(400, mg.mag_size)
        self.assertEqual(1, mg.num_of_mag)
        self.assertEqual(0, mg.mag_type)
        self.assertEqual(0.1, mg.reload_time)
        self.assertTrue(mg.auto_reload)
        self.assertEqual(0.05, mg.heat_add_when_fire)
        self.assertEqual(0.3, mg.cool_down_per_sec)
        self.assertEqual(2.0, mg.time_delay_on_overheat)

    def test_hand_weapon_hud_words_and_the_shipped_amom_typo(self) -> None:
        # Objects/HandWeapons/M1Garand/Objects.con spells the position words
        # correctly; Objects/HandWeapons/K98/Objects.con -- like 13 of
        # vanilla's 16 hand weapons that declare a position at all -- ships
        # `setAmomBarPosX/Y` / `setAmomBarTextPosX/Y`. Both must resolve to
        # the same fields or most of vanilla's weapons report no position.
        library = self.library(
            "Objects/HandWeapons/M1Garand/Objects.con",
            """
ObjectTemplate.create HandFireArms M1Garand
ObjectTemplate.setHudAmmoType ATAmmoBar
ObjectTemplate.setAmmoBar "Ingame/Magbar_Rifle_empty_32x64.tga"
ObjectTemplate.setAmmoBarFill "Ingame/Magbar_Rifle_full_32x64.tga"
ObjectTemplate.setAmmoBarSize 20
ObjectTemplate.setAmmoBarPosX 6
ObjectTemplate.setAmmoBarPosY -17
ObjectTemplate.setAmmoBarTextPosX 5
ObjectTemplate.setAmmoBarTextPosY 10

ObjectTemplate.create HandFireArms K98
ObjectTemplate.setHudAmmoType ATAmmoBar
ObjectTemplate.setAmmoBar "Ingame/Magbar_Rifle_empty_32x64.tga"
ObjectTemplate.setAmmoBarFill "Ingame/Magbar_Rifle_full_32x64.tga"
ObjectTemplate.setAmmoBarSize 20
ObjectTemplate.setAmomBarPosX 6
ObjectTemplate.setAmomBarPosY -17
ObjectTemplate.setAmomBarTextPosX 5
ObjectTemplate.setAmomBarTextPosY 10

ObjectTemplate.create HandFireArms Bazooka
ObjectTemplate.setHudAmmoType ATIcon
ObjectTemplate.setAmmoIcon "Ammo/Icon_bazooka_64x32.tga"
""")
        garand = library.object("M1Garand")
        k98 = library.object("K98")
        bazooka = library.object("Bazooka")

        for weapon in (garand, k98):
            self.assertEqual("ATAmmoBar", weapon.hud_ammo_type)
            self.assertEqual("Ingame/Magbar_Rifle_empty_32x64.tga", weapon.hud_ammo_bar)
            self.assertEqual("Ingame/Magbar_Rifle_full_32x64.tga", weapon.hud_ammo_bar_fill)
            self.assertEqual(20.0, weapon.hud_ammo_bar_size)
            self.assertEqual(6.0, weapon.hud_ammo_bar_pos_x)
            self.assertEqual(-17.0, weapon.hud_ammo_bar_pos_y)
            self.assertEqual(5.0, weapon.hud_ammo_bar_text_pos_x)
            self.assertEqual(10.0, weapon.hud_ammo_bar_text_pos_y)

        self.assertEqual("Ammo/Icon_bazooka_64x32.tga", bazooka.hud_ammo_icon)

    def test_weapon_stats_carries_the_new_hud_block(self) -> None:
        library = self.library(
            "Objects/HandWeapons/M1Garand/Objects.con",
            """
ObjectTemplate.create HandFireArms M1Garand
ObjectTemplate.setAmmoBar "Ingame/Magbar_Rifle_empty_32x64.tga"
ObjectTemplate.setAmmoBarFill "Ingame/Magbar_Rifle_full_32x64.tga"
ObjectTemplate.setAmmoBarSize 20
ObjectTemplate.setAmmoBarPosX 6
ObjectTemplate.setAmmoBarPosY -17
ObjectTemplate.setAmmoBarTextPosX 5
ObjectTemplate.setAmmoBarTextPosY 10
""")
        stats = library.object("M1Garand").weapon_stats()

        self.assertEqual({
            "ammoBar": "Ingame/Magbar_Rifle_empty_32x64.tga",
            "ammoBarFill": "Ingame/Magbar_Rifle_full_32x64.tga",
            "ammoBarSize": 20.0,
            "posX": 6.0,
            "posY": -17.0,
            "textPosX": 5.0,
            "textPosY": 10.0,
        }, stats["hud"])

    def test_kit_hud_icons_and_weapon_icon_row(self) -> None:
        # Objects/Items/USKit/Medic/Objects.con, verbatim.
        library = self.library(
            "Objects/Items/USKit/Medic/Objects.con",
            """
ObjectTemplate.create Kit  US_Medic
ObjectTemplate.setType Medic
ObjectTemplate.setKitTeam 2
ObjectTemplate.addTemplate Medic_helm_us
ObjectTemplate.setHealthBarIcon "Ingame/Healthbar_empty_medic_64x64.tga"
ObjectTemplate.setHealthBarFullIcon "Ingame/Healthbar_full_medic_64x64.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_alliesKnife.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_colt.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_thompson.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_grenadeallies.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_medpack.tga"
ObjectTemplate.setKitIcon 3 "kits/Icon_medic_allies_selected.tga"
ObjectTemplate.addTemplate Thompson
ObjectTemplate.addTemplate Colt
""")
        kit = library.object("US_Medic")

        self.assertEqual("Ingame/Healthbar_empty_medic_64x64.tga", kit.kit_health_bar_icon)
        self.assertEqual("Ingame/Healthbar_full_medic_64x64.tga", kit.kit_health_bar_full_icon)
        self.assertEqual((3, "kits/Icon_medic_allies_selected.tga"), kit.kit_icon)
        self.assertEqual([
            "Weapon/Icon_alliesKnife.tga", "Weapon/Icon_colt.tga",
            "Weapon/Icon_thompson.tga", "Weapon/Icon_grenadeallies.tga",
            "Weapon/Icon_medpack.tga",
        ], kit.kit_weapon_icons)

    def test_soldier_constants_off_the_spliced_common_soldier_data(self) -> None:
        # `include ../Common/CommonSoldierData.inc` is not a `Namespace.cmd`
        # directive, so the parser never sees it: the caller has to splice
        # the included file's text in before `add_con` runs (see
        # `extract_models._inline_includes`). This test feeds the parser the
        # already-spliced result -- CommonSoldierData.inc's own body, kept
        # verbatim -- to prove the *words* parse once that has happened.
        library = self.library(
            "Objects/Soldiers/USSoldier/Objects.con",
            """
ObjectTemplate.create BFSoldier USSoldier
ObjectTemplate.createSkeleton animations/USSoldier.ske

ObjectTemplate.HasArmor 1
ObjectTemplate.HitPoints 30
ObjectTemplate.MaxHitPoints 30
ObjectTemplate.repairDistance 2.0
ObjectTemplate.healDistance 10.0
objectTemplate.healFactor 0.25
objectTemplate.selfHealFactor 0.15
objectTemplate.repairFactor 0.15
""")
        soldier = library.object("USSoldier")

        self.assertEqual(30.0, soldier.hitpoints)
        self.assertEqual(30.0, soldier.max_hitpoints)
        self.assertEqual(10.0, soldier.heal_distance)
        self.assertEqual(0.25, soldier.heal_factor)
        self.assertEqual(0.15, soldier.self_heal_factor)
        self.assertEqual(2.0, soldier.repair_distance)
        self.assertEqual(0.15, soldier.repair_factor)


if __name__ == "__main__":
    unittest.main()
