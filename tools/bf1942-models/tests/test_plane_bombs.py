"""The extractor half of the aircraft bomb and torpedo.

`features/plane-bombs-and-torpedoes/README.md` gaps G-4, G-5 and G-6, plus the
two body words a released bomb needs to fall the way the engine drops it.

What was missing, all of it present in the `.con` and none of it reaching JSON:

  * `setHasPointPhysics`, `DetonateOnWaterCollision`, `stopAtEndEffect` and
    `setAsynchronyFire` were not parsed at all (G-6 and half of G-3);
  * `_projectile_spec` never copied `mass` / `drag`, so a viewer integrating a
    bomb had gravity and nothing else;
  * `_projectile_spec` never walked the projectile's `addTemplate` children, so
    a torpedo arrived without its two floaters, its engine and its two wings —
    which are the whole of why it runs level in water (G-4);
  * a rack that declares both `projectilePosition` and `addFireArmsPosition`
    lost the former, and a Stuka's is `0/-0.4/-0.2`;
  * `find_weapon_scripts` walked FireArms only, and `Bomb.ssc` hangs off the
    projectile (G-5). Its own docstring flagged it.

The last group of tests reads the installed game so the numbers here are the
game's and not a fixture's; they skip when it is not installed.
"""

from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
from bf42.con import ChildRef, ObjectLibrary  # noqa: E402
from bf42.rfa import ArchivePool, RfaArchive  # noqa: E402

BF1942_ARCHIVES = (Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
                   / "bf1942/Archives")


def templates_of(path: str, text: str) -> dict:
    """Every ObjectTemplate in one `.con`, keyed by lower-case name."""
    library = ObjectLibrary()
    library.add_con(path, text)
    return dict(library.objects)


def glb_document(data: bytes) -> dict:
    json_size, json_kind = struct.unpack_from("<II", data, 12)
    if json_kind != 0x4E4F534A:
        raise AssertionError("GLB does not start with a JSON chunk")
    return json.loads(data[20:20 + json_size].decode("utf-8"))


# A Stuka's bomb rack and a torpedo rack, cut down to the words under test but
# otherwise verbatim from `Objects/Vehicles/Air/Stuka/Weapons.con` and
# `Objects/Vehicles/Common/Weapons.con` / `Physics.con`.
RACKS_CON = """
ObjectTemplate.create PlayerControlObject Plane
ObjectTemplate.geometry Plane_hull
ObjectTemplate.addTemplate PlaneBombRack
ObjectTemplate.setPosition 0/0/0
ObjectTemplate.addTemplate PlaneTorpedoRack
ObjectTemplate.setPosition 0/0/0
ObjectTemplate.addTemplate PlaneHeavyRack
ObjectTemplate.setPosition 0/0/0

ObjectTemplate.create FireArms PlaneBombRack
ObjectTemplate.projectileTemplate DiveBomberBomb
ObjectTemplate.projectilePosition 0/-0.4/-0.2
ObjectTemplate.magSize 30
ObjectTemplate.numOfMag 1
ObjectTemplate.velocity 0
ObjectTemplate.roundOfFire 0.2
ObjectTemplate.setInputFire c_PIAltFire
ObjectTemplate.addFireArmsPosition 3.3/-0.199/0 0/0/0
ObjectTemplate.addFireArmsPosition -3.3/-0.199/0 0/0/0

ObjectTemplate.create FireArms PlaneHeavyRack
ObjectTemplate.projectileTemplate DiveBomberBomb
ObjectTemplate.magSize 8
ObjectTemplate.numOfMag 10
ObjectTemplate.velocity 0
ObjectTemplate.autoReload 1
ObjectTemplate.reloadtime 15
ObjectTemplate.roundOfFire 4
ObjectTemplate.setAsynchronyFire 1
ObjectTemplate.setInputFire c_PIAltFire
ObjectTemplate.addFireArmsPosition -1/-0.1/0 0/0/0
ObjectTemplate.addFireArmsPosition 1/0.1/0 0/0/0

ObjectTemplate.create FireArms PlaneTorpedoRack
ObjectTemplate.projectileTemplate AircraftTorpedo
ObjectTemplate.magSize 15
ObjectTemplate.numOfMag 1
ObjectTemplate.velocity 0
ObjectTemplate.roundOfFire 0.1
ObjectTemplate.setInputFire c_PIAltFire

ObjectTemplate.create Projectile DiveBomberBomb
ObjectTemplate.geometry Big_Bomb_M1
ObjectTemplate.timeToLive CRD_NONE/20/0/0
ObjectTemplate.damageType 1
ObjectTemplate.material 242
ObjectTemplate.material2 202
ObjectTemplate.radius 20
ObjectTemplate.YModOnExplosion 2.0
ObjectTemplate.hasCollisionEffect 1
ObjectTemplate.dieAfterColl 0
ObjectTemplate.stopAtEndEffect 1
ObjectTemplate.setHasPointPhysics 0
ObjectTemplate.drag 0.08
ObjectTemplate.mass 250
ObjectTemplate.loadSoundScript Sounds/Bomb.ssc
ObjectTemplate.addTemplate Bomb_wing
ObjectTemplate.setPosition 0/0/-1
ObjectTemplate.setRotation 0/0/0
ObjectTemplate.addTemplate Bomb_wing
ObjectTemplate.setPosition 0/0/-1
ObjectTemplate.setRotation 0/0/-90

ObjectTemplate.create Projectile AircraftTorpedo
ObjectTemplate.geometry Torpedo_Sml_M1
ObjectTemplate.timeToLive CRD_NONE/20/0/0
ObjectTemplate.endEffectTemplate WaterExplosionTorpedo
ObjectTemplate.gravityModifier 1.0
ObjectTemplate.hasCollisionEffect 1
ObjectTemplate.setHasPointPhysics 0
ObjectTemplate.DetonateOnWaterCollision 0
ObjectTemplate.drag 0.04
ObjectTemplate.mass 800
ObjectTemplate.material 250
ObjectTemplate.radius 30
ObjectTemplate.addTemplate Torpedo_Floater
ObjectTemplate.setPosition 0/3/-2
ObjectTemplate.setRotation 0/0/0
ObjectTemplate.addTemplate Torpedo_Floater
ObjectTemplate.setPosition 0/3/2
ObjectTemplate.setRotation 0/0/0
ObjectTemplate.addTemplate Torpedo_Engine
ObjectTemplate.setPosition 0/0/-3
ObjectTemplate.setRotation 0/0/0
ObjectTemplate.addTemplate Torpedo_Wing
ObjectTemplate.setPosition 0/0/-3
ObjectTemplate.setRotation 0/0/0
ObjectTemplate.addTemplate Torpedo_Wing
ObjectTemplate.setPosition 0/0/-3
ObjectTemplate.setRotation 0/0/-90

ObjectTemplate.create Wing Bomb_wing
ObjectTemplate.setWingLift 0.2

ObjectTemplate.create Wing Torpedo_Wing
ObjectTemplate.setWingLift 0.2

ObjectTemplate.create FloatingBundle Torpedo_Floater
ObjectTemplate.setHullHeight 4.3
ObjectTemplate.setFloatMaxLift 5.9
ObjectTemplate.setFloatMinLift 5.9
ObjectTemplate.setDragModifier 8000.0
ObjectTemplate.setMinRotation 0/-1/0
ObjectTemplate.setMaxRotation 0/1/0

ObjectTemplate.create Engine Torpedo_Engine
ObjectTemplate.setMaxSpeed 0/0/10000
ObjectTemplate.setAcceleration 0/0/10000
ObjectTemplate.setMaxRotation 0/0/5000
ObjectTemplate.setInputToRoll c_PIThrottle
ObjectTemplate.setEngineType c_ETTorpedo
ObjectTemplate.setTorque 12.5
ObjectTemplate.setNoPropellerEffectAtSpeed 120
ObjectTemplate.setDifferential 5
"""

GEOM_CON = """
GeometryTemplate.create StandardMesh Plane_hull
GeometryTemplate.create StandardMesh Big_Bomb_M1
GeometryTemplate.create StandardMesh Torpedo_Sml_M1
"""


class ConWordTests(unittest.TestCase):
    """The four words that were not parsed anywhere."""

    def setUp(self) -> None:
        self.templates = templates_of("Weapons.con", RACKS_CON)

    def test_has_point_physics_is_read_as_a_bool(self) -> None:
        bomb = self.templates["divebomberbomb"]
        self.assertIs(False, bomb.has_point_physics)

    def test_detonate_on_water_collision_is_read(self) -> None:
        # The one word BOMB-11 turns on. Absent on a bomb, `False` on the
        # torpedo — and the two must stay distinguishable, because "absent"
        # means "behave as the viewer always has".
        self.assertIs(False,
                      self.templates["aircrafttorpedo"].detonate_on_water_collision)
        self.assertIsNone(
            self.templates["divebomberbomb"].detonate_on_water_collision)

    def test_stop_at_end_effect_is_read(self) -> None:
        self.assertIs(True, self.templates["divebomberbomb"].stop_at_end_effect)

    def test_asynchrony_fire_is_read(self) -> None:
        self.assertIs(True, self.templates["planeheavyrack"].asynchrony_fire)
        # A dive bomber's rack declares no such word and must not acquire one:
        # absent is what makes it salvo its pair.
        self.assertIsNone(self.templates["planebombrack"].asynchrony_fire)


class ProjectileSpecTests(unittest.TestCase):
    def _assemble(self) -> dict:
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Air/Plane/Weapons.con", RACKS_CON)
        library.add_con("Objects/Vehicles/Air/Plane/Geometries.con", GEOM_CON)
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        for name in ("Plane_hull", "Big_Bomb_M1", "Torpedo_Sml_M1"):
            mesh_index = builder.add_mesh(name, [triangle])
            assembler._geom_mesh[name.lower()] = (mesh_index, 1)
            assembler._geom_collisions[name.lower()] = []
        report = Report(root="Plane", configuration="complex", lod=0)
        node = assembler.build_node(builder, "Plane", report)
        assert node is not None
        document = glb_document(builder.build([node], extras=report.as_dict()))
        return {n["name"]: n for n in document["nodes"]}

    def setUp(self) -> None:
        self.nodes = self._assemble()

    def test_a_bomb_carries_its_body_words(self) -> None:
        spec = self.nodes["PlaneBombRack"]["extras"]["fireArms"]["projectile"]
        # Without these two the viewer integrates gravity alone.
        self.assertEqual(250.0, spec["mass"])
        self.assertEqual(0.08, spec["drag"])
        self.assertIs(False, spec["hasPointPhysics"])
        self.assertIs(True, spec["stopAtEndEffect"])

    def test_the_water_flag_rides_with_the_contact_words(self) -> None:
        bomb = self.nodes["PlaneBombRack"]["extras"]["fireArms"]["projectile"]
        torpedo = self.nodes["PlaneTorpedoRack"]["extras"]["fireArms"]["projectile"]
        self.assertNotIn("detonateOnWaterCollision", bomb["damage"])
        self.assertIs(False, torpedo["damage"]["detonateOnWaterCollision"])

    def test_a_bombs_fins_reach_the_viewer(self) -> None:
        spec = self.nodes["PlaneBombRack"]["extras"]["fireArms"]["projectile"]
        self.assertEqual(
            [{"template": "Bomb_wing", "kind": "Wing",
              "position": [0.0, 0.0, 1.0], "rotation": [0.0, 0.0, 0.0],
              "wingLift": 0.2},
             {"template": "Bomb_wing", "kind": "Wing",
              "position": [0.0, 0.0, 1.0], "rotation": [0.0, 0.0, -90.0],
              "wingLift": 0.2}],
            spec["parts"])

    def test_the_torpedos_floaters_engine_and_wings_reach_the_viewer(self) -> None:
        spec = self.nodes["PlaneTorpedoRack"]["extras"]["fireArms"]["projectile"]
        parts = spec["parts"]
        # Five physics children; `e_WaterTorpedo` is an EffectBundle and rides
        # out as `trailBundle`, not as a part.
        self.assertEqual(["Torpedo_Floater", "Torpedo_Floater", "Torpedo_Engine",
                          "Torpedo_Wing", "Torpedo_Wing"],
                         [part["template"] for part in parts])
        self.assertEqual(["FloatingBundle", "FloatingBundle", "Engine",
                          "Wing", "Wing"],
                         [part["kind"] for part in parts])
        # 3 m above the hull centre and 2 m either side of it: Refractor
        # 0/3/-2 and 0/3/2 with Z negated into glTF, which is what makes the
        # buoyancy couple a *pitch* couple.
        self.assertEqual([0.0, 3.0, 2.0], parts[0]["position"])
        self.assertEqual([0.0, 3.0, -2.0], parts[1]["position"])
        self.assertEqual(4.3, parts[0]["hullHeight"])
        self.assertEqual(5.9, parts[0]["floatMaxLift"])
        self.assertEqual(5.9, parts[0]["floatMinLift"])
        engine = parts[2]
        self.assertEqual("c_ETTorpedo", engine["engineType"])
        self.assertEqual(12.5, engine["torque"])
        self.assertEqual(5.0, engine["differential"])
        self.assertEqual(120.0, engine["noPropellerEffectAtSpeed"])
        self.assertEqual(0.2, parts[3]["wingLift"])
        self.assertEqual([0.0, 0.0, -90.0], parts[4]["rotation"])

    def test_a_rack_keeps_its_projectile_position_beside_its_barrels(self) -> None:
        fire = self.nodes["PlaneBombRack"]["extras"]["fireArms"]
        self.assertEqual(2, fire["muzzles"])
        # Refractor 0/-0.4/-0.2 -> glTF Z negated.
        self.assertEqual([0.0, -0.4, 0.2], fire["projectilePosition"])
        # A rack with no barrels puts it on the muzzle node instead, so there
        # is nothing to carry beside it.
        self.assertNotIn("projectilePosition",
                         self.nodes["PlaneTorpedoRack"]["extras"]["fireArms"])

    def test_asynchrony_fire_reaches_the_firing_block(self) -> None:
        self.assertIs(True, self.nodes["PlaneHeavyRack"]["extras"]["fireArms"]
                            ["asynchronyFire"])
        self.assertNotIn("asynchronyFire",
                         self.nodes["PlaneBombRack"]["extras"]["fireArms"])


class _ConPool:
    """The two methods `find_weapon_scripts` asks of an `ArchivePool`."""

    def __init__(self, files: dict[str, str]) -> None:
        self.files = files

    def find(self, name: str) -> str | None:
        return name if name in self.files else None

    def read(self, name: str) -> bytes:
        return self.files[name].encode("latin-1")


class WeaponScriptTests(unittest.TestCase):
    """G-5: the bomb's `.ssc` is on the projectile, not on the rack."""

    def setUp(self) -> None:
        self.path = "Objects/Vehicles/Air/Plane/Weapons.con"
        self.library = ObjectLibrary()
        self.library.add_con(self.path, RACKS_CON + """
ObjectTemplate.create FireArms PlaneGuns
ObjectTemplate.projectileTemplate PlaneProjectile
ObjectTemplate.loadSoundScript Sounds/PlaneMG.ssc
ObjectTemplate.create Projectile PlaneProjectile
ObjectTemplate.loadSoundScript Sounds/Ricochet.ssc
""")
        # Hang the gun off the plane so the walk reaches it.
        self.library.object("Plane").children.append(
            ChildRef(template="PlaneGuns"))
        self.pool = _ConPool({self.path: (RACKS_CON + """
ObjectTemplate.create FireArms PlaneGuns
ObjectTemplate.loadSoundScript Sounds/PlaneMG.ssc
ObjectTemplate.create Projectile PlaneProjectile
ObjectTemplate.loadSoundScript Sounds/Ricochet.ssc
""")})

    def _scripts(self) -> dict[str, tuple[str, bool]]:
        from extract_map import find_weapon_scripts
        return {name: (script, from_round) for name, _, script, from_round
                in find_weapon_scripts(self.library, self.pool, "Plane")}

    def test_a_bomb_rack_now_reports_the_projectiles_script(self) -> None:
        scripts = self._scripts()
        # And it is flagged as the round's own, which is what makes
        # `_firing_patch` take the one-shot release rather than the looping
        # in-flight whistle that is Bomb.ssc's first sounding patch.
        self.assertEqual(("Objects/Vehicles/Air/Plane/Sounds/Bomb.ssc", True),
                         scripts["PlaneBombRack"])
        # Under the RACK's name, because that is the node the viewer's weapon
        # audio is keyed on.
        self.assertNotIn("DiveBomberBomb", scripts)

    def test_a_gun_with_its_own_script_keeps_it(self) -> None:
        # The fallback must not let a `Projectile.ssc` ricochet script displace
        # a gun's own fire patch.
        self.assertEqual(("Objects/Vehicles/Air/Plane/Sounds/PlaneMG.ssc", False),
                         self._scripts()["PlaneGuns"])

    def test_a_torpedo_rack_still_reports_nothing(self) -> None:
        # `AircraftTorpedo` declares no `loadSoundScript` in vanilla, so the
        # torpedo genuinely has no release sound and must not acquire one.
        self.assertNotIn("PlaneTorpedoRack", self._scripts())


class RealGameDataTests(unittest.TestCase):
    """The same claims against the installed game, so the numbers are its own."""

    @classmethod
    def setUpClass(cls) -> None:
        if not (BF1942_ARCHIVES / "Objects.rfa").exists():
            raise unittest.SkipTest("Battlefield 1942 is not installed")
        archive = RfaArchive(str(BF1942_ARCHIVES / "Objects.rfa"))
        cls.common = templates_of(
            "Objects/Vehicles/Common/Weapons.con",
            archive.read("Objects/Vehicles/Common/Weapons.con").decode("latin-1"))
        cls.stuka = templates_of(
            "Objects/Vehicles/Air/Stuka/Weapons.con",
            archive.read(
                "Objects/Vehicles/Air/Stuka/Weapons.con").decode("latin-1"))
        cls.b17 = templates_of(
            "Objects/Vehicles/Air/B17/Weapons.con",
            archive.read("Objects/Vehicles/Air/B17/Weapons.con").decode("latin-1"))

    def test_the_torpedo_does_not_detonate_on_the_surface(self) -> None:
        torpedo = self.common["aircrafttorpedo"]
        self.assertIs(False, torpedo.detonate_on_water_collision)
        self.assertEqual(800.0, torpedo.mass)
        self.assertEqual(0.04, torpedo.drag)
        self.assertIs(False, torpedo.has_point_physics)
        # BOMB-11: no `damageType` at all, so neither explosion.
        self.assertIsNone(torpedo.damage_type)
        self.assertEqual(250, torpedo.material)
        # `rem ObjectTemplate.material2 206` — commented out in the shipped
        # file, so a torpedo has no splash material and no splash.
        self.assertIsNone(torpedo.material2)

    def test_the_bombs_are_250_kg_at_drag_008(self) -> None:
        for name in ("fighterbomb", "divebomberbomb", "heavybomberbomb"):
            bomb = self.common[name]
            self.assertEqual(250.0, bomb.mass, name)
            self.assertEqual(0.08, bomb.drag, name)
            self.assertIs(False, bomb.has_point_physics, name)
            self.assertIs(True, bomb.stop_at_end_effect, name)
            self.assertIsNone(bomb.detonate_on_water_collision, name)

    def test_the_stuka_rack_is_two_barrels_off_a_30_round_magazine(self) -> None:
        rack = self.stuka["stukabombrack"]
        self.assertEqual(2, len(rack.fire_arms_positions))
        self.assertEqual(30, rack.mag_size)
        self.assertEqual(0.0, rack.velocity)
        self.assertEqual("c_PIAltFire", rack.input_fire)
        self.assertIsNone(rack.asynchrony_fire)
        self.assertEqual((0.0, -0.4, -0.2), rack.projectile_position)

    def test_the_b17_rack_is_the_only_vanilla_plane_that_lays_a_stick(self) -> None:
        rack = self.b17["b17bombrack"]
        self.assertIs(True, rack.asynchrony_fire)
        self.assertEqual(2, len(rack.fire_arms_positions))
        self.assertEqual(8, rack.mag_size)
        self.assertEqual(10, rack.num_of_mag)
        self.assertEqual(4.0, rack.round_of_fire)
        self.assertEqual(15.0, rack.reload_time)

    def test_the_bomb_release_sound_script_is_on_the_projectile(self) -> None:
        # G-5 in one assertion: the rack declares no script, the projectile
        # does, and it is the one with the release thump and the whistle.
        self.assertIsNone(self.stuka["stukabombrack"].sound_script)
        self.assertEqual("../air/common/Sounds/Bomb.ssc",
                         self.common["divebomberbomb"].sound_script)


class FiringPatchTests(unittest.TestCase):
    """`_firing_patch`'s release mode, which is what keeps a bomb from whistling
    for ever off a momentary trigger."""

    class _Sample:
        def __init__(self, file: str, loop: bool) -> None:
            self.file, self.loop = file, loop

    class _Patch:
        def __init__(self, samples) -> None:
            self.samples = samples

    def _bomb_ssc(self):
        # `Objects/Vehicles/Air/Common/Sounds/Bomb.ssc`, in its own order: the
        # looping whistle first, the release thump second.
        S, P = self._Sample, self._Patch
        return [
            P([S("Sound/shellair.wav", True), S("Sound/Shellwhine.wav", True),
               S("Sound/haxxar.wav", True)]),
            P([S("Sound/bmbreal1.wav", False), S("Sound/bmbreal3.wav", False)]),
            P([S("Sound/bmbreal2.wav", False)]),
        ]

    def test_a_held_gun_trigger_still_takes_the_fire_loop(self) -> None:
        from extract_map import _firing_patch
        picked = _firing_patch(self._bomb_ssc())
        self.assertEqual(["Sound/shellair.wav", "Sound/Shellwhine.wav",
                          "Sound/haxxar.wav"], [s.file for s in picked])

    def test_a_release_takes_the_one_shot_thump(self) -> None:
        from extract_map import _firing_patch
        picked = _firing_patch(self._bomb_ssc(), release=True)
        self.assertEqual(["Sound/bmbreal1.wav", "Sound/bmbreal3.wav"],
                         [s.file for s in picked])


if __name__ == "__main__":
    unittest.main()
