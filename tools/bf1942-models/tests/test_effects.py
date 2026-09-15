"""The effect pipeline: `.con` -> spec -> baked library -> `effects-core.js`.

Three halves. `bf42.effects` turns the raw properties `con.py` captures on
EffectBundle/Emitter/particle templates into the JSON the viewer plays;
`Assembler.bake_effect_library` puts those specs on hidden nodes in a GLB;
`viewer/effects-core.js` — run here under node through `effects_harness.mjs`,
the same way `test_collision.py` runs the collider — does the engine's
arithmetic. The numbers asserted on the JS side are the ones read out of the
engine (see `features/bf1942-engine-reference/subsystems/projectiles-and-impacts.md`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import con as con_mod  # noqa: E402
from bf42 import effects  # noqa: E402
from bf42 import gltf  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "effects-core.js"
HARNESS = Path(__file__).resolve().parent / "effects_harness.mjs"

# A cut-down `RichoStoneDecal`: the ricochet burst plus the bullet-hole decal,
# exactly as `Objects/Effects/Common/effects.con` composes them.
DECAL_CON = """
ObjectTemplate.create EffectBundle RichoStoneDecal
ObjectTemplate.addTemplate e_richoStone
ObjectTemplate.addTemplate em_RichoStoneDecal

ObjectTemplate.create EffectBundle e_RichoStone
ObjectTemplate.saveInSeparateFile 1
ObjectTemplate.addTemplate Em_richoBasic
ObjectTemplate.addTemplate Em_richoStone
ObjectTemplate.timeToLive CRD_NONE/1/0/0

ObjectTemplate.create Emitter Em_richoBasic
ObjectTemplate.template Fx_richoBasic
ObjectTemplate.lodDistance 375
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.intensity CRD_NONE/10/0/0
ObjectTemplate.relativePositionInUp CRD_NONE/0.05/0/0
ObjectTemplate.startRotation CRD_NONE/1/0/0

ObjectTemplate.create SpriteParticle Fx_richoBasic
ObjectTemplate.timeToLive CRD_NONE/0.2/0.2/0
ObjectTemplate.size CRD_UNIFORM/0.11/0.1/0
ObjectTemplate.gravityModifier CRD_NONE/0/0/0
ObjectTemplate.sizeOverTime 0/0.179998|100/1
ObjectTemplate.texture e_richogitt_I
ObjectTemplate.initRotation CRD_UNIFORM/1/180/0
ObjectTemplate.destBlendMode BMOne
ObjectTemplate.rotationSpeed CRD_UNIFORM/1/10/0
ObjectTemplate.colorRGBAOverTime 0/255/255/255/255|100/128/128/0/0

ObjectTemplate.create Emitter Em_richoStone
ObjectTemplate.template Fx_richoStone
ObjectTemplate.startAtCreation 1
ObjectTemplate.addEmitterSpeed 1
ObjectTemplate.emitterSpeedScale 1
ObjectTemplate.timeToLive CRD_UNIFORM/0.1/0/0
ObjectTemplate.intensity CRD_UNIFORM/-2/2/1
ObjectTemplate.positionalSpeedInUp CRD_UNIFORM/2/0/0
ObjectTemplate.positionalSpeedInRight CRD_UNIFORM/3/-3/0
ObjectTemplate.rotationalSpeedInUp CRD_UNIFORM/1/10/0

ObjectTemplate.create Particle Fx_richoStone
ObjectTemplate.geometry Richo_meshBrown_m1
ObjectTemplate.timeToLive CRD_UNIFORM/1/2/0
ObjectTemplate.gravityModifier CRD_NONE/0.6/-0.3/0

ObjectTemplate.create Emitter Em_RichoStoneDecal
ObjectTemplate.template Fx_RichoStoneDecal
ObjectTemplate.startProbability 1
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.intensity CRD_NONE/2/0/0
ObjectTemplate.relativePositionInUp CRD_NONE/0.001/0/0

ObjectTemplate.create Particle Fx_RichoStoneDecal
ObjectTemplate.geometry Decal_Stone_m1
ObjectTemplate.timeToLive CRD_UNIFORM/15/1/0
ObjectTemplate.size CRD_UNIFORM/1/1/0
ObjectTemplate.gravityModifier CRD_NONE/0/0/1
ObjectTemplate.sizeModifier 1/1/1
ObjectTemplate.alphaOverTime 0/1|70/1|100/0

ObjectTemplate.create Projectile ThomsonProjectile
ObjectTemplate.geometry bullet_m1
ObjectTemplate.timeToLive CRD_NONE/1/0/0
ObjectTemplate.material 216
ObjectTemplate.minDamage 0.5
ObjectTemplate.distToStartLoseDamage 40
ObjectTemplate.distToMinDamage 80

ObjectTemplate.create Projectile BazookaProjectile
ObjectTemplate.geometry projectile_m1
ObjectTemplate.timeToLive CRD_NONE/10/0/0
ObjectTemplate.gravityModifier 0.2
ObjectTemplate.material 226
ObjectTemplate.material2 200
ObjectTemplate.radius 4
ObjectTemplate.addTemplate e_rocketFume

ObjectTemplate.create EffectBundle e_rocketFume
ObjectTemplate.timeToLive CRD_NONE/7/0/0
ObjectTemplate.addTemplate Em_rocketFume_Smoke

ObjectTemplate.create Emitter Em_rocketFume_Smoke
ObjectTemplate.template Fx_rocketFume_Smoke
ObjectTemplate.looping 1
ObjectTemplate.addEmitterSpeed 1
ObjectTemplate.timeToLive CRD_NONE/7/0/0
ObjectTemplate.intensity CRD_NONE/100/0/0

ObjectTemplate.create SpriteParticle Fx_rocketFume_Smoke
ObjectTemplate.timeToLive CRD_NORMAL/2.5/2.51/0
ObjectTemplate.size CRD_NONE/1.2/0/0
ObjectTemplate.drag CRD_NONE/20/0/0
ObjectTemplate.texture e_muzs1_I
ObjectTemplate.destBlendMode BMInvSourceAlpha

GeometryTemplate.create StandardMesh Decal_Stone_m1
GeometryTemplate.create StandardMesh Richo_meshBrown_m1
"""


def library() -> con_mod.ObjectLibrary:
    lib = con_mod.ObjectLibrary()
    lib.add_con("Objects/Effects/Common/effects.con", DECAL_CON)
    return lib


class ConCaptureTests(unittest.TestCase):
    def test_effect_templates_keep_every_raw_property(self) -> None:
        lib = library()
        emitter = lib.object("Em_richoStone")
        self.assertEqual("CRD_UNIFORM/-2/2/1", emitter.effect_props["intensity"])
        self.assertEqual("1", emitter.effect_props["addemitterspeed"])
        self.assertNotIn("timetolive", lib.object("e_RichoStone").effect_props,
                         "a timeToLive after addTemplate is the child's, not the bundle's")

    def test_crd4_reads_distribution_ends_and_mirror(self) -> None:
        self.assertEqual(["u", 15.0, 1.0, 0], con_mod.crd4("CRD_UNIFORM/15/1/0"))
        self.assertEqual(["e", 2.0, 0.0, 1], con_mod.crd4("CRD_EXPONENTIAL/2/0/1"))
        self.assertEqual(["g", 2.5, 2.51, 0], con_mod.crd4("CRD_NORMAL/2.5/2.51/0"))
        self.assertEqual(["n", 0.2, 0.0, 0], con_mod.crd4("0.2"))

    def test_projectile_damage_fields(self) -> None:
        lib = library()
        thompson = lib.object("ThomsonProjectile")
        self.assertEqual((0.5, 40.0, 80.0), (thompson.min_damage,
                                              thompson.dist_to_start_lose_damage,
                                              thompson.dist_to_min_damage))
        bazooka = lib.object("BazookaProjectile")
        self.assertEqual((4.0, 200), (bazooka.explosion_radius, bazooka.material2))


class SpecTests(unittest.TestCase):
    def test_bundle_tree_flattens_nested_bundles_and_keeps_placement(self) -> None:
        tree = effects.bundle_tree(library(), "RichoStoneDecal")
        self.assertEqual(3, tree.count())
        self.assertEqual(["em_richostonedecal"], [e[1].name.lower() for e in tree.emitters])
        self.assertEqual(["e_RichoStone"], [b.template.name for b in tree.bundles])
        self.assertEqual(2, tree.bundles[0].count())

    def test_decal_spec_is_a_fading_mesh_particle(self) -> None:
        tree = effects.bundle_tree(library(), "RichoStoneDecal")
        spec = tree.emitters[0][3]
        self.assertEqual(["n", 2.0, 0.0, 0], spec["intensity"])
        self.assertEqual(["n", 0.001, 0.0, 0], spec["relativePosition"]["up"])
        particle = spec["particle"]
        self.assertEqual("mesh", particle["kind"])
        self.assertEqual("Decal_Stone_m1", particle["geometry"])
        self.assertEqual(["u", 15.0, 1.0, 0], particle["timeToLive"])
        self.assertEqual([1.0, 1.0, 1.0], particle["sizeModifier"])
        self.assertEqual([[0.0, 1.0], [70.0, 1.0], [100.0, 0.0]], particle["alphaOverTime"])

    def test_sprite_blend_follows_dest_blend_mode(self) -> None:
        lib = library()
        burst = effects.particle_spec(lib.object("Fx_richoBasic"))
        smoke = effects.particle_spec(lib.object("Fx_rocketFume_Smoke"))
        self.assertEqual("add", burst["blend"])
        self.assertEqual("alpha", smoke["blend"])
        self.assertEqual(["u", 1.0, 180.0, 0], burst["initRotation"])

    def test_projectile_trail_and_names(self) -> None:
        lib = library()
        self.assertEqual("e_rocketFume",
                         effects.projectile_trail_bundle(lib, lib.object("BazookaProjectile")))
        self.assertIn("e_rocketFume", effects.effect_names_for_projectiles(lib))


class BakeTests(unittest.TestCase):
    def test_library_bakes_specs_onto_hidden_nodes(self) -> None:
        lib = library()
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
                                  indices=[0, 1, 2])
        for geom in ("decal_stone_m1", "richo_meshbrown_m1"):
            assembler._geom_mesh[geom] = (builder.add_mesh(geom, [triangle]), 1)
        # No textures in the fake pool: the sprite emitter drops out and says so.
        report = Report(root="effects", configuration="complex", lod=0)
        roots, index = assembler.bake_effect_library(builder, ["RichoStoneDecal", "Nope"], report)
        self.assertEqual(1, len(roots))
        self.assertEqual({"RichoStoneDecal": {"emitters": 3}}, index["bundles"])
        self.assertIn("Nope", index["missing"])
        self.assertIn("e_RichoStone/Em_richoBasic", index["missing"])
        glb = builder.build(roots, extras={"effects": index})
        import struct
        length = struct.unpack_from("<I", glb, 12)[0]
        doc = json.loads(glb[20:20 + length])
        emitters = [n for n in doc["nodes"] if (n.get("extras") or {}).get("effectEmitter")]
        self.assertEqual({"em_richostonedecal", "em_richostone"},
                         {n["name"].lower() for n in emitters})
        decal = next(n for n in emitters if n["name"].lower() == "em_richostonedecal")
        self.assertEqual("Decal_Stone_m1", decal["extras"]["effectEmitter"]["particle"]["geometry"])
        bundles = {n["extras"]["effectBundle"]["name"] for n in doc["nodes"]
                   if (n.get("extras") or {}).get("effectBundle")}
        self.assertEqual({"RichoStoneDecal", "e_RichoStone"}, bundles)
        root_node = doc["nodes"][doc["scenes"][0]["nodes"][0]]
        self.assertEqual("RichoStoneDecal", root_node["extras"]["effectBundle"]["name"])

    def test_projectile_spec_carries_damage_and_trail(self) -> None:
        lib = library()
        lib.add_con("Objects/HandWeapons/Bazooka/Objects.con", """
ObjectTemplate.create HandFireArms Bazooka
ObjectTemplate.projectileTemplate BazookaProjectile
ObjectTemplate.velocity 50
ObjectTemplate.roundOfFire 1
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="Bazooka", configuration="complex", lod=0)
        spec, _nodes = assembler._projectile_spec(builder, lib.object("Bazooka"), report)
        self.assertEqual(226, spec["material"])
        self.assertEqual({"radius": 4.0, "material2": 200}, spec["damage"])
        self.assertEqual("e_rocketFume", spec["trailBundle"])
        self.assertEqual(0.2, spec["gravity"])


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "effects-core.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CoreModuleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_crd_distributions(self) -> None:
        crd = self.results["crd"]
        self.assertAlmostEqual(0.1, crd["none"])
        self.assertAlmostEqual(1.0, crd["uniformTop"], places=3)
        self.assertAlmostEqual(15.0, crd["uniformBottom"], places=1)
        self.assertEqual([3, -3], crd["mirrored"])
        self.assertAlmostEqual(2.0, crd["exponential"], places=5)
        self.assertEqual(0.5, crd["bare"])

    def test_curves(self) -> None:
        curve = self.results["curve"]
        self.assertAlmostEqual(0.5, curve["alphaAt85"][0])
        self.assertEqual([127.5, 127.5, 127.5, 102], curve["rgbaMid"])

    def test_frame_stands_up_on_the_normal(self) -> None:
        basis = self.results["basis"]
        self.assertEqual({"right": [1, 0, 0], "up": [0, 1, 0], "dof": [0, 0, -1]}, basis["ground"])
        self.assertEqual([0, 0, -1], basis["wallMinusZ"]["up"])
        self.assertEqual([1, 0, 0], basis["wallPlusX"]["up"])
        self.assertEqual([0, 0, -1], basis["attached"]["dof"])
        # Rolling 90 degrees about DOF turns Up onto Right.
        rolled = basis["rolled90"]
        self.assertAlmostEqual(1.0, abs(rolled["up"][0]), places=6)
        self.assertAlmostEqual(0.0, rolled["up"][1], places=6)
        self.assertEqual([1, 2, -3], basis["point"])

    def test_emitter_clock(self) -> None:
        clock = self.results["clock"]
        self.assertEqual(1, clock["decalSpawns"], "intensity 2 over 0.1 s still leaves one hole")
        self.assertTrue(clock["decalDone"])
        self.assertEqual(11, clock["dense"])
        self.assertEqual(0, clock["delayedFirstStep"])
        self.assertFalse(clock["loopDone"])
        self.assertFalse(clock["foreverDone"])
        self.assertEqual(5, clock["foreverSpawned"])
        self.assertEqual(100, clock["idleInterval"])
        self.assertAlmostEqual(1 / (23 * 5), clock["atSpeedInterval"], places=6)

    def test_emitter_clock_delay_edge(self) -> None:
        # EMT-2: on the tick a delay (0.2 s) runs out, age grows by the
        # delay's own pre-tick value (0.1, left after the first 0.1 s step),
        # not by the leftover past zero a big second step (0.5 s) would leave
        # (0.4). Two spawns are due by age 0.1 at a 0.1 s interval (t=0,
        # t=0.1); a leftover-based age of 0.4 would owe five.
        clock = self.results["clock"]
        self.assertEqual(2, clock["delayedSecondStep"])
        self.assertAlmostEqual(0.1, clock["delayedAgeAfterSecondStep"], places=9)

    def test_emitter_clock_ttl_edge(self) -> None:
        # EMT-2's other edge: the burst ends at age >= timeToLive. A single
        # step landing exactly on timeToLive must not spawn on that tick and
        # must already be done, not wait one tick longer.
        clock = self.results["clock"]
        self.assertEqual(0, clock["edgeSpawnsAtTtl"])
        self.assertTrue(clock["edgeDoneAtTtl"])

    def test_decal_particle(self) -> None:
        decal = self.results["decal"]
        self.assertAlmostEqual(5.001, decal["position"][1], places=6)
        self.assertEqual([0, 0, 0], decal["velocity"])
        self.assertTrue(1.0 <= decal["ttl"] <= 15.0)
        self.assertEqual(1, decal["size"])
        self.assertEqual(1, decal["opacityEarly"])
        self.assertAlmostEqual(0.5, decal["opacityAt85"], places=6)
        self.assertEqual([1, 1, 1], decal["scale"])
        self.assertAlmostEqual(5.001, decal["afterOneSecond"][1], places=6, msg="no gravity, no drift")

    def test_trail_puff_inherits_speed_and_drag_stops_it(self) -> None:
        puff = self.results["puff"]
        self.assertAlmostEqual(50.0, puff["speed0"], places=6)
        self.assertLess(puff["speedAfter100ms"], 8.0)
        self.assertTrue(1.5 < puff["travelled"] < 3.0)
        # 0.1 s into a 2.5 s life the size ramp (0.4 -> 0.75) has moved 4%.
        self.assertAlmostEqual(1.2 * (0.4 + 0.35 * 0.04), puff["look"]["scale"][0], places=2)

    def test_gravity_modifier_scales_the_fall(self) -> None:
        self.assertAlmostEqual(-14.73 * 0.6 * 0.5, self.results["chip"]["vy"], places=4)

    def test_damage_falloff_is_the_engine_line(self) -> None:
        self.assertEqual([1, 1, 0.75, 0.5, 0.5], self.results["damage"])
        self.assertEqual(1, self.results["damageNone"])


if __name__ == "__main__":
    unittest.main()
