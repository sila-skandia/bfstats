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
import math
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
ObjectTemplate.hasOverDamage 1
ObjectTemplate.intensityOverTime 0/1|100/0.5
ObjectTemplate.positionalSpeedInUp CRD_UNIFORM/2/0/0
ObjectTemplate.positionalSpeedInRight CRD_UNIFORM/3/-3/0
ObjectTemplate.rotationalSpeedInUp CRD_UNIFORM/1/10/0

ObjectTemplate.create EffectBundle e_wdustPanz
ObjectTemplate.saveInSeparateFile 1
ObjectTemplate.addTemplate Em_richoBasic
ObjectTemplate.timeToLive CRD_NONE/-1/0/0
ObjectTemplate.addWorkOnMaterial 2
ObjectTemplate.addWorkOnMaterial 3
ObjectTemplate.addWorkOnMaterial 11
ObjectTemplate.minDistanceUnderwaterSurface 0
ObjectTemplate.maxDistanceUnderwaterSurface 0.01

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

    def test_a_bare_emitter_name_bakes_as_a_one_emitter_bundle(self) -> None:
        """`addArmorEffect` names Emitters directly, not only EffectBundles.

        Every aircraft and ship damage-smoke tier does it — `em_PlaneDamage`,
        `em_StukaDamage`, `em_LcvpDamage` and 17 more in vanilla, each created as
        `ObjectTemplate.create Emitter` and never wrapped. `bundle_tree` used to
        require an EffectBundle and returned None for all of them, so a damaged
        plane baked no smoke at all while a tank baked its `e_PanzDamage`.
        """
        # `Em_richoStone` is an Emitter in the fixture, named directly here the
        # way a vehicle's damage tier names its own.
        tree = effects.bundle_tree(library(), "Em_richoStone")
        self.assertIsNotNone(tree, "a bare Emitter must bake, not vanish")
        self.assertEqual(1, tree.count())
        self.assertEqual([], tree.bundles)
        self.assertEqual("em_richostone", tree.emitters[0][1].name.lower())
        # And it carries a real spec, not an empty shell.
        self.assertIn("particle", tree.emitters[0][3])

    def test_an_emitter_with_no_payload_still_declines(self) -> None:
        lib = library()
        orphan = con_mod.ObjectTemplate(name="em_Orphan", kind="Emitter")
        lib.objects["em_orphan"] = orphan
        self.assertIsNone(effects.bundle_tree(lib, "em_Orphan"))

    def test_a_non_effect_template_still_declines(self) -> None:
        lib = library()
        gun = con_mod.ObjectTemplate(name="SomeGun", kind="HandFireArms")
        lib.objects["somegun"] = gun
        self.assertIsNone(effects.bundle_tree(lib, "SomeGun"))

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

    def test_emitter_spec_maps_has_over_damage_and_intensity_over_time(self) -> None:
        """Remaining high-count Emitter words after intensity itself landed.

        `hasOverDamage` (33 vanilla emitters) gates damage-tier smoke; 
        `intensityOverTime` (23) ramps particles/second over the emitter life.
        Both sit in `EmitterTemplate` (client strings at 0x008eba18 / 0x008ebc04).
        """
        lib = library()
        spec = effects.emitter_spec(lib.object("Em_richoStone"),
                                    lib.object("Fx_richoStone"))
        self.assertTrue(spec["hasOverDamage"])
        self.assertEqual([[0.0, 1.0], [100.0, 0.5]], spec["intensityOverTime"])
        self.assertEqual(["u", -2.0, 2.0, 1], spec["intensity"])

    def test_effect_bundle_keeps_work_on_materials_after_add_template(self) -> None:
        """`addWorkOnMaterial` is written after `addTemplate` and must accumulate.

        The raw-prop capture used to require `child is None`, so every material
        filter on dust/wake bundles (48 lines in vanilla) was dropped.
        """
        lib = library()
        bundle = lib.object("e_wdustPanz")
        self.assertEqual([2, 3, 11], bundle.work_on_materials)
        self.assertEqual("0", bundle.effect_props["mindistanceunderwatersurface"])
        self.assertEqual("0.01", bundle.effect_props["maxdistanceunderwatersurface"])
        # Child-instance timeToLive after addTemplate must not overwrite the
        # bundle's own effect_props (there is none authored before addTemplate).
        self.assertNotIn("timetolive", bundle.effect_props)

    def test_sprite_blend_follows_dest_blend_mode(self) -> None:
        lib = library()
        burst = effects.particle_spec(lib.object("Fx_richoBasic"))
        smoke = effects.particle_spec(lib.object("Fx_rocketFume_Smoke"))
        self.assertEqual("add", burst["blend"])
        self.assertEqual("alpha", smoke["blend"])
        self.assertEqual(["u", 1.0, 180.0, 0], burst["initRotation"])
        # SPR-5 (corrected): the underlying D3DBLEND ordinals, not just the
        # two-case label. Both templates leave srcBlendMode unset, so both
        # fall back to the constructor's own default (R8-8): BMSourceAlpha=5.
        self.assertEqual((5, 2), (burst["srcBlendMode"], burst["destBlendMode"]))
        self.assertEqual((5, 6), (smoke["srcBlendMode"], smoke["destBlendMode"]))

    def test_sprite_blend_defaults_when_neither_word_is_set(self) -> None:
        # geom::ParticleSystemTemplate's own constructor (FUN_00618350, R8-8)
        # hardcodes srcBlendMode=5/destBlendMode=6 before any `.con` word
        # runs a setter at all.
        lib = library()
        lib.add_con("Objects/Effects/Common/effects.con", """
ObjectTemplate.create SpriteParticle Fx_NoBlendWords
ObjectTemplate.texture e_richogitt_I
ObjectTemplate.timeToLive CRD_NONE/1/0/0
""")
        spec = effects.particle_spec(lib.object("Fx_NoBlendWords"))
        self.assertEqual((5, 6), (spec["srcBlendMode"], spec["destBlendMode"]))
        self.assertEqual("alpha", spec["blend"])

    def test_sprite_blend_ordinals_distinguish_what_the_label_could_not(self) -> None:
        # A template overriding srcBlendMode to BMOne alongside destBlendMode
        # BMOne: the old two-case label calls this "add", identically to
        # `burst` above (test_sprite_blend_follows_dest_blend_mode), but the
        # real pair (2, 2) is a different blend from burst's actual (5, 2) —
        # exactly what SPR-5's fuller mapping recovers and the label alone
        # could never represent.
        lib = library()
        lib.add_con("Objects/Effects/Common/effects.con", """
ObjectTemplate.create SpriteParticle Fx_FullAdditive
ObjectTemplate.texture e_richogitt_I
ObjectTemplate.timeToLive CRD_NONE/1/0/0
ObjectTemplate.srcBlendMode BMOne
ObjectTemplate.destBlendMode BMOne
""")
        spec = effects.particle_spec(lib.object("Fx_FullAdditive"))
        self.assertEqual((2, 2), (spec["srcBlendMode"], spec["destBlendMode"]))
        self.assertEqual("add", spec["blend"], "the coarse label only ever looked at destBlendMode")

    def test_projectile_trail_and_names(self) -> None:
        lib = library()
        self.assertEqual("e_rocketFume",
                         effects.projectile_trail_bundle(lib, lib.object("BazookaProjectile")))
        self.assertIn("e_rocketFume", effects.effect_names_for_projectiles(lib))

    def test_flipbook_sprite_carries_the_animation_words(self) -> None:
        # SPR-6: SpriteParticleNewTemplate::makeScript reads these four words;
        # numAnimationFrames is a plain count (not a CRD), the other two are
        # rolled per particle the same as initRotation/rotationSpeed, and the
        # OverTime word is a ramp like every other one. fx_expl_core's own
        # numbers: 16 frames, starts at frame 8, speed 70, no ramp.
        lib = library()
        lib.add_con("Objects/Effects/Common/effects.con", """
ObjectTemplate.create SpriteParticleNew Fx_Expl_Core
ObjectTemplate.texture e_ExplAni06
ObjectTemplate.timeToLive CRD_NONE/1/0/0
ObjectTemplate.numAnimationFrames 16
ObjectTemplate.initAnimationFrame CRD_NONE/8/0/0
ObjectTemplate.animationSpeed CRD_NONE/70/0/0
ObjectTemplate.destBlendMode BMOne
""")
        spec = effects.particle_spec(lib.object("Fx_Expl_Core"))
        self.assertEqual(16, spec["numAnimationFrames"])
        self.assertEqual(["n", 8.0, 0.0, 0], spec["initAnimationFrame"])
        self.assertEqual(["n", 70.0, 0.0, 0], spec["animationSpeed"])
        self.assertNotIn("animationSpeedOverTime", spec, "not authored on this template")

    def test_ramped_flipbook_sprite_carries_the_curve(self) -> None:
        lib = library()
        lib.add_con("Objects/Effects/Common/effects.con", """
ObjectTemplate.create SpriteParticleNew Fx_AichiValFire
ObjectTemplate.texture e_FireEngine256
ObjectTemplate.timeToLive CRD_UNIFORM/0.8/0.8/0
ObjectTemplate.numAnimationFrames 16
ObjectTemplate.initAnimationFrame CRD_NONE/1/0/0
ObjectTemplate.animationSpeed CRD_NONE/95/100/0
ObjectTemplate.animationSpeedOverTime 0/1|100/0.200049
""")
        spec = effects.particle_spec(lib.object("Fx_AichiValFire"))
        self.assertEqual([[0.0, 1.0], [100.0, 0.200049]], spec["animationSpeedOverTime"])

    def test_single_frame_sprite_is_not_a_flipbook(self) -> None:
        # A single declared frame means no atlas math at all: the key is
        # simply absent, so effects-core.js's `p.spec.numAnimationFrames > 1`
        # gate skips it exactly like a sprite that never mentions the word.
        lib = library()
        spec = effects.particle_spec(lib.object("Fx_richoBasic"))
        self.assertNotIn("numAnimationFrames", spec)


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

    def test_projectile_spec_carries_the_two_path_explosion_rule(self) -> None:
        # HP-9d: `hasCollisionEffect` is what tells an impact round from a fuse
        # round, so it has to reach the viewer. Without it `effects-core.js`
        # would be inferring the difference from `material2`, which carries
        # none of it. `yModOnExplosion` rides along (HP-9).
        lib = library()
        lib.add_con("Objects/HandWeapons/Grenade/Objects.con", """
ObjectTemplate.create HandFireArms GrenadeAllies
ObjectTemplate.projectileTemplate GrenadeAlliesProjectile
ObjectTemplate.velocity 15

ObjectTemplate.create Projectile GrenadeAlliesProjectile
ObjectTemplate.geometry projectile_m1
ObjectTemplate.timeToLive CRD_NONE/3/0/0
ObjectTemplate.material 227
ObjectTemplate.material2 205
ObjectTemplate.damageType 1
ObjectTemplate.hasCollisionEffect 0
ObjectTemplate.radius 15
ObjectTemplate.YModOnExplosion 2.0
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="GrenadeAllies", configuration="complex", lod=0)
        spec, _nodes = assembler._projectile_spec(
            builder, lib.object("GrenadeAllies"), report)
        # An authored `hasCollisionEffect 0` must survive the emit filter —
        # `False is not None`, so it does, and the viewer can see that this
        # round takes the fuse path and NOT the impact path.
        self.assertEqual(
            {"radius": 15.0, "material2": 205, "damageType": 1,
             "hasCollisionEffect": False, "yModOnExplosion": 2.0},
            spec["damage"])

    def test_the_ten_metre_default_covers_damage_type_four_too(self) -> None:
        # HP-9: the 10.0 is the `ProjectileTemplate` constructor's own default
        # (lnxded 0x0831f9b3) and the constructor does not consult
        # `damageType`, so a `damageType 4` round that omits `radius` gets it
        # as well. Six vanilla tank rounds ride the default on the
        # `damageType 1` side; vanilla's four `damageType 4` templates all
        # author a radius, so this is for mods.
        lib = library()
        lib.add_con("Objects/HandWeapons/Mine/Objects.con", """
ObjectTemplate.create HandFireArms Landmine
ObjectTemplate.projectileTemplate LandmineProjectile
ObjectTemplate.velocity 5

ObjectTemplate.create Projectile LandmineProjectile
ObjectTemplate.geometry projectile_m1
ObjectTemplate.material 231
ObjectTemplate.material2 232
ObjectTemplate.damageType 4
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="Landmine", configuration="complex", lod=0)
        spec, _nodes = assembler._projectile_spec(
            builder, lib.object("Landmine"), report)
        self.assertEqual(10.0, spec["damage"]["radius"])
        self.assertEqual(4, spec["damage"]["damageType"])

    def test_a_fractional_radius_reaches_the_viewer_already_truncated(self) -> None:
        # HP-9: the truncation happens at parse because the property is a
        # console `int`. DC's `50calSniper_Projectile radius 0.25` is 0 by the
        # time the assembler sees it, and 0 with the engine's `radius > d`
        # gate is no splash at all — the assembler must NOT then treat the 0
        # as "unset" and hand back the 10.0 default.
        lib = library()
        lib.add_con("Objects/HandWeapons/Sniper/Objects.con", """
ObjectTemplate.create HandFireArms 50calSniper
ObjectTemplate.projectileTemplate 50calSniper_Projectile
ObjectTemplate.velocity 900

ObjectTemplate.create Projectile 50calSniper_Projectile
ObjectTemplate.geometry bullet_m1
ObjectTemplate.material 216
ObjectTemplate.material2 216
ObjectTemplate.damageType 1
ObjectTemplate.hasCollisionEffect 1
ObjectTemplate.radius 0.25
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="50calSniper", configuration="complex", lod=0)
        spec, _nodes = assembler._projectile_spec(
            builder, lib.object("50calSniper"), report)
        self.assertEqual(0.0, spec["damage"]["radius"])


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

    def test_mesh_particle_drag_uses_the_engine_law_not_bare_drag(self) -> None:
        # EMT-5 (verify-r8.md, corrected): a mesh particle's drag is
        # `pi * r^2 * drag` (mass=1.0 always, R8-11), applied as the exact
        # per-tick decay `v *= e^(-k dt)` for the wind=0/scale=1 case every
        # real effect is (see effects-core.js's integrateParticle docstring).
        # Same drag=20 as the sprite puff above, but this mesh particle's own
        # radius (0.1413 m, Fx_RichoStoneDecal's real geometry, R8-14) makes
        # `k` about 1.25 rather than the sprite's bare 20 — it barely slows
        # at all over the same 0.1 s where the sprite lost seven eighths of
        # its speed.
        mesh_drag = self.results["meshDrag"]
        self.assertAlmostEqual(0.1413, mesh_drag["radius"], places=4)
        self.assertAlmostEqual(50.0, mesh_drag["speed0"], places=6)
        k = math.pi * 0.1413 ** 2 * 20.0
        expected = 50.0 * math.exp(-k * 0.1)
        self.assertAlmostEqual(expected, mesh_drag["speedAfter100ms"], places=4)
        # A visible, not just numeric, difference from the sprite's law: the
        # mesh particle above 40 m/s where the sprite fell under 8.
        self.assertGreater(mesh_drag["speedAfter100ms"], 40.0)

    def test_mesh_particle_without_a_radius_falls_back_to_bare_drag(self) -> None:
        # A mesh particle whose geometry never resolved a radius (0) must
        # not silently lose all drag (k=0, decay=1) -- it falls back to the
        # same bare-drag exponential a sprite uses, an explicit
        # approximation rather than a worse regression.
        no_radius = self.results["noRadius"]
        self.assertEqual(0, no_radius["radius"])
        expected = 50.0 * math.exp(-20.0 * 0.1)
        self.assertAlmostEqual(expected, no_radius["speedAfter100ms"], places=6)

    def test_gravity_modifier_scales_the_fall(self) -> None:
        self.assertAlmostEqual(-14.73 * 0.6 * 0.5, self.results["chip"]["vy"], places=4)

    def test_damage_falloff_is_the_engine_line(self) -> None:
        self.assertEqual([1, 1, 0.75, 0.5, 0.5], self.results["damage"])
        self.assertEqual(1, self.results["damageNone"])

    def test_atlas_grid_is_square_from_frame_count(self) -> None:
        # draw() (client 0x0060a56a-0x0060a5c1): columns = round(sqrt(frames)),
        # bumped by one when that does not divide frames evenly; rows is the
        # same number, never a separate computation, and the texture's own
        # aspect ratio is never read. 16 and 9 are perfect squares (no bump);
        # 5 is not (round(sqrt(5))=2, 5%2!=0, so 3); 1 frame is no atlas.
        atlas = self.results["atlas"]
        self.assertEqual({"columns": 4, "rows": 4, "cell": 0.25}, atlas["grid16"])
        self.assertEqual({"columns": 3, "rows": 3, "cell": 1 / 3}, atlas["grid9"])
        self.assertEqual({"columns": 3, "rows": 3, "cell": 1 / 3}, atlas["grid5"])
        self.assertIsNone(atlas["grid1"])

    def test_flipbook_frame_advances_per_second_not_per_phase(self) -> None:
        # fx_expl_core's own numbers (16 frames, initAnimationFrame 8,
        # animationSpeed 70, no ramp): draw() (0x0060a5c4-0x0060a60e) adds
        # animationSpeed * ramp * dt / numAnimationFrames every call — frames
        # per second, seeded from initAnimationFrame at spawn
        # (`FUN_00609ea0`), not a phase-indexed lookup. Over the particle's
        # full 1 s life that is 8 + 70*1/16 = 12.375: still inside the strip,
        # cell (0, 3) of the 4x4 grid.
        atlas = self.results["atlas"]
        self.assertEqual(8, atlas["explCoreStartFrame"])
        self.assertAlmostEqual(12.375, atlas["explCoreFrameAfterOneSecond"], places=6)
        self.assertEqual(12, atlas["explCoreIndexAfterOneSecond"])
        self.assertEqual({"col": 0, "row": 3}, atlas["explCoreCell"])

    def test_animation_speed_over_time_scales_the_rate(self) -> None:
        # A flat 2x animationSpeedOverTime ramp on a speed-10 strip covers 2
        # frames in one second, not 1 — the ramp must actually multiply in,
        # not just exist on the spec unread.
        self.assertAlmostEqual(2.0, self.results["atlas"]["rampedFrameAfterOneSecond"], places=6)

    def test_frame_index_wraps_both_directions(self) -> None:
        # Where the far end of the strip is handled was not found in the
        # engine (SPR-6 is open on wrap vs. clamp); this wraps, which every
        # checked vanilla template is equally consistent with since none of
        # them ever reach it. frameIndex must still be safe on a value below
        # zero even though integrateParticle never produces one on real data.
        atlas = self.results["atlas"]
        self.assertEqual(3, atlas["wrapPositive"])
        self.assertEqual(15, atlas["wrapNegative"])
        self.assertEqual(0, atlas["notAnimated"])


class EffectEmitterNodesTests(unittest.TestCase):
    """Tests for the widened _effect_emitter_nodes vehicle bake path."""
    
    def test_non_additive_sprites_are_baked(self) -> None:
        """BMInvSourceAlpha smoke/dust sprites are now accepted."""
        smoke_con = """
ObjectTemplate.create EffectBundle e_BuildingSmoke
ObjectTemplate.addTemplate em_BuildingSmoke

ObjectTemplate.create Emitter em_BuildingSmoke
ObjectTemplate.template Fx_BuildingSmoke
ObjectTemplate.timeToLive CRD_NONE/1/0/0
ObjectTemplate.intensity CRD_NONE/5/0/0

ObjectTemplate.create SpriteParticle Fx_BuildingSmoke
ObjectTemplate.texture e_muzs1_I
ObjectTemplate.timeToLive CRD_NONE/2/0/0
ObjectTemplate.size CRD_NONE/1.5/0/0
ObjectTemplate.destBlendMode BMInvSourceAlpha
        """
        lib = con_mod.ObjectLibrary()
        lib.add_con("smoke.con", smoke_con)
        pool = ArchivePool()
        asm = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="test", configuration="complex", lod=0)
        # Pre-seed sprite mesh cache to avoid texture lookup
        asm._sprite_mesh_cache["e_muzs1_i#alpha"] = builder.add_mesh("test", [])
        
        bundle = lib.object("e_BuildingSmoke")
        nodes = asm._effect_emitter_nodes(builder, bundle, report)
        
        self.assertEqual(1, len(nodes), "alpha-blended sprite should bake")
        node = builder.node(nodes[0])
        self.assertEqual("sprite", node.extras["effect"]["kind"])
    
    def test_nested_bundles_are_recursed(self) -> None:
        """Cascade bundles with nested EffectBundle children are walked."""
        cascade_con = """
ObjectTemplate.create EffectBundle BazookaCascadesStone
ObjectTemplate.addTemplate e_ExplBazooka
ObjectTemplate.addTemplate e_ScrapMetalBazook

ObjectTemplate.create EffectBundle e_ExplBazooka
ObjectTemplate.addTemplate em_ExplCore
rem setPosition/setRotation 0.0/90.0/0.0

ObjectTemplate.create Emitter em_ExplCore
ObjectTemplate.template Fx_ExplCore
ObjectTemplate.timeToLive CRD_NONE/0.3/0/0
ObjectTemplate.intensity CRD_NONE/10/0/0

ObjectTemplate.create SpriteParticle Fx_ExplCore
ObjectTemplate.texture e_explfire_I
ObjectTemplate.timeToLive CRD_NONE/0.5/0/0
ObjectTemplate.size CRD_NONE/4.0/0/0
ObjectTemplate.destBlendMode BMOne

ObjectTemplate.create EffectBundle e_ScrapMetalBazook
ObjectTemplate.addTemplate em_ScrapDebris

ObjectTemplate.create Emitter em_ScrapDebris
ObjectTemplate.template Fx_ScrapDebris
ObjectTemplate.timeToLive CRD_NONE/0.2/0/0
ObjectTemplate.intensity CRD_NONE/8/0/0

ObjectTemplate.create Particle Fx_ScrapDebris
ObjectTemplate.geometry Richo_meshBrown_m1
ObjectTemplate.timeToLive CRD_UNIFORM/3/1/0
ObjectTemplate.gravityModifier CRD_NONE/1/0/0

GeometryTemplate.create StandardMesh Richo_meshBrown_m1
        """
        lib = con_mod.ObjectLibrary()
        lib.add_con("cascade.con", cascade_con)
        pool = ArchivePool()
        asm = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="test", configuration="complex", lod=0)
        # Pre-seed caches
        mesh_idx = builder.add_mesh("test", [])
        asm._sprite_mesh_cache["e_explfire_i"] = mesh_idx
        asm._geom_mesh["richo_meshbrown_m1"] = (mesh_idx, 1)
        
        bundle = lib.object("BazookaCascadesStone")
        nodes = asm._effect_emitter_nodes(builder, bundle, report)
        
        self.assertGreater(len(nodes), 0, "nested bundles should produce nodes")
        # Should have 2 nested bundle containers
        bundle_nodes = [n for n in nodes if builder.node(n).extras.get("effect", {}).get("kind") == "bundle"]
        self.assertEqual(2, len(bundle_nodes), "both nested bundles should be present")
    
    def test_sound_only_emitters_are_excluded(self) -> None:
        """Emitters with no texture or geometry should not bake."""
        sound_con = """
ObjectTemplate.create EffectBundle e_collision_metal
ObjectTemplate.loadSoundScript Sounds/collision.ssc
ObjectTemplate.addTemplate Em_Silent

ObjectTemplate.create Emitter Em_Silent
ObjectTemplate.template Fx_Silent
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.intensity CRD_NONE/1/0/0

ObjectTemplate.create SpriteParticle Fx_Silent
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
rem no texture
        """
        lib = con_mod.ObjectLibrary()
        lib.add_con("sound.con", sound_con)
        pool = ArchivePool()
        asm = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="test", configuration="complex", lod=0)
        
        bundle = lib.object("e_collision_metal")
        nodes = asm._effect_emitter_nodes(builder, bundle, report)
        
        self.assertEqual(0, len(nodes), "sound-only emitters should be excluded")
    
    def test_view_gating_is_preserved(self) -> None:
        """showInFirstPerson-gated emitters keep their view restriction."""
        view_con = """
ObjectTemplate.create EffectBundle e_MuzzTest
ObjectTemplate.addTemplate em_3P_Flash
ObjectTemplate.addTemplate em_1P_Flash

ObjectTemplate.create Emitter em_3P_Flash
ObjectTemplate.template Fx_Flash
ObjectTemplate.showInThirdPerson 1
ObjectTemplate.showInFirstPerson 0
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.intensity CRD_NONE/1/0/0

ObjectTemplate.create Emitter em_1P_Flash
ObjectTemplate.template Fx_Flash_1P
ObjectTemplate.showInThirdPerson 0
ObjectTemplate.showInFirstPerson 1
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.intensity CRD_NONE/1/0/0

ObjectTemplate.create SpriteParticle Fx_Flash
ObjectTemplate.texture e_muzflash_I
ObjectTemplate.timeToLive CRD_NONE/0.05/0/0
ObjectTemplate.size CRD_NONE/2.0/0/0
ObjectTemplate.destBlendMode BMOne

ObjectTemplate.create SpriteParticle Fx_Flash_1P
ObjectTemplate.texture e_muzflash_I
ObjectTemplate.timeToLive CRD_NONE/0.05/0/0
ObjectTemplate.size CRD_NONE/0.4/0/0
ObjectTemplate.destBlendMode BMOne
        """
        lib = con_mod.ObjectLibrary()
        lib.add_con("view.con", view_con)
        pool = ArchivePool()
        asm = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="test", configuration="complex", lod=0)
        # Pre-seed sprite cache
        mesh_idx = builder.add_mesh("test", [])
        asm._sprite_mesh_cache["e_muzflash_i"] = mesh_idx
        
        bundle = lib.object("e_MuzzTest")
        nodes = asm._effect_emitter_nodes(builder, bundle, report)
        
        self.assertEqual(2, len(nodes))
        views = [builder.node(n).extras["effect"].get("view") for n in nodes]
        self.assertIn("third", views)
        self.assertIn("first", views)
    
    def test_debris_payloads_are_baked(self) -> None:
        """SimpleObject debris meshes (scrap metal, shell casings) are accepted."""
        debris_con = """
ObjectTemplate.create EffectBundle e_ScrapMetal_iron
ObjectTemplate.addTemplate em_ScrapIron

ObjectTemplate.create Emitter em_ScrapIron
ObjectTemplate.template Gibb_iron_m1
ObjectTemplate.timeToLive CRD_NONE/0.2/0/0
ObjectTemplate.intensity CRD_NONE/5/0/0

ObjectTemplate.create SimpleObject Gibb_iron_m1
ObjectTemplate.geometry Gibb_iron_m1

GeometryTemplate.create StandardMesh Gibb_iron_m1
        """
        lib = con_mod.ObjectLibrary()
        lib.add_con("debris.con", debris_con)
        pool = ArchivePool()
        asm = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="test", configuration="complex", lod=0)
        # Pre-seed mesh cache
        mesh_idx = builder.add_mesh("test", [])
        asm._geom_mesh["gibb_iron_m1"] = (mesh_idx, 1)
        
        bundle = lib.object("e_ScrapMetal_iron")
        nodes = asm._effect_emitter_nodes(builder, bundle, report)
        
        self.assertEqual(1, len(nodes), "SimpleObject debris should bake")
        node = builder.node(nodes[0])
        self.assertEqual("mesh", node.extras["effect"]["kind"])


if __name__ == "__main__":
    unittest.main()
