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
import os
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


# DC's `e_Browning_Damage/Effects.con`: the destroyed MG's smoke, whose colour
# ramp carries an empty point. Before `con.curve` read ramps the engine's way it
# baked as `[..., [40, ...], [], [100, ...]]`, and the viewer's sampler threw
# `RangeError: Invalid array length` on it every frame.
BROWNING_DESTROY_CON = """
ObjectTemplate.create Emitter Em_Browning_Destroy
ObjectTemplate.template Fx_Browning_Destroy
ObjectTemplate.timeToLive CRD_NONE/1/0/0
ObjectTemplate.intensity CRD_NONE/10/0/0

ObjectTemplate.create SpriteParticle Fx_Browning_Destroy
ObjectTemplate.timeToLive CRD_UNIFORM/2/2/0
ObjectTemplate.size CRD_UNIFORM/2/2.5/0
ObjectTemplate.sizeOverTime 0/0.540239|67/1.72002|100/2.15998
ObjectTemplate.gravityModifierOverTime 0/0.460005|39/0.490005|100/1
ObjectTemplate.texture e_difus1
ObjectTemplate.colorRGBAOverTime 0/255/255/255/133|40/41/38/36/133||100/26/23/19/0
"""


class EngineCurveReadTests(unittest.TestCase):
    """`con.curve` reads a ramp the way the client's parser loop does (EMT-9).

    `FUN_0051dab0` (scalar) and `FUN_00525e20` (colour): `int`, one separator
    `char`, the value(s), write, and go round again while `get()` is `|`.
    """

    def test_a_clean_ramp_is_unchanged(self) -> None:
        self.assertEqual([[0.0, 0.12], [100.0, 9.4]], con_mod.curve("0/0.12|100/9.4"))
        self.assertEqual([[0.0, 255.0, 255.0, 255.0, 204.0], [100.0, 0.0, 0.0, 0.0, 0.0]],
                         con_mod.curve("0/255/255/255/204|100/0/0/0/0", 4))

    def test_an_empty_point_ends_the_ramp_and_zeroes_the_colour_before_it(self) -> None:
        # The failed pass rewrites point 40 through the colour reader's one
        # stack temporary, which holds the stream's address: a denormal, 0.
        self.assertEqual([[0.0, 255.0, 255.0, 255.0, 133.0], [40.0, 0.0, 0.0, 0.0, 0.0]],
                         con_mod.curve("0/255/255/255/133|40/41/38/36/133||100/26/23/19/0", 4))
        # A scalar reads into the parser's own locals: the point stands.
        self.assertEqual([[0.0, 1.0], [40.0, 2.0]], con_mod.curve("0/1|40/2||100/3"))

    def test_a_trailing_bar_is_the_same_failed_pass(self) -> None:
        self.assertEqual([[0.0, 1.0], [100.0, 2.0]], con_mod.curve("0/1|100/2|"))
        self.assertEqual([[0.0, 1.0, 1.0, 1.0, 1.0], [100.0, 0.0, 0.0, 0.0, 0.0]],
                         con_mod.curve("0/1/1/1/1|100/2/2/2/2|", 4))

    def test_a_point_ends_where_its_separators_stop(self) -> None:
        # Vanilla's `Fx_ExplFrozen_Snow`: `2,5` reads 2 and `get()` finds `,`.
        self.assertEqual([[0.0, 0.5], [53.0, 2.0]], con_mod.curve("0/0.5|53/2,5|100/3,5"))
        # `Fx_KatyushaFume_Smoke`'s last point carries eight values: four read.
        self.assertEqual([[0.0, 212.0, 208.0, 200.0, 255.0], [100.0, 200.0, 200.0, 200.0, 0.0]],
                         con_mod.curve("0/212/208/200/255|100/200/200/200/0/0/0/0", 4))
        # The index is an `int`: EoD's `1.5/0.5` is index 1, value 5.
        self.assertEqual([[0.0, 0.5], [1.0, 5.0]], con_mod.curve("0/0.5|1.5/0.5"))
        # DC Final's `...|100/6rem`, a lost newline: 6, then `r` ends it.
        self.assertEqual([[0.0, 2.04004], [100.0, 6.0]], con_mod.curve("0/2.04004|100/6rem"))

    def test_an_unwritten_index_zero_keeps_the_default(self) -> None:
        self.assertEqual(1.0, con_mod.CURVE_DEFAULT)
        self.assertEqual([[0.0, 1.0], [100.0, 0.299997]], con_mod.curve("100/0.299997"))
        self.assertEqual([[0.0, 1.0, 1.0, 1.0, 1.0], [80.0, 0.0, 0.0, 0.0, 117.0]],
                         con_mod.curve("80/0/0/0/117", 4))

    def test_indices_sort_the_last_write_wins_and_out_of_range_drops(self) -> None:
        # DC Final's smoke grenade authors index 0 twice, the second last.
        self.assertEqual([[0.0, 255.0, 255.0, 255.0, 0.0], [10.0, 255.0, 255.0, 255.0, 255.0],
                          [70.0, 200.0, 200.0, 200.0, 100.0]],
                         con_mod.curve("0/255/255/255/255|10/255/255/255/255|"
                                       "70/200/200/200/100|0/255/255/255/0", 4))
        self.assertEqual([[0.0, 1.0], [50.0, 1.0], [90.0, 1.0]],
                         con_mod.curve("0/1|50/1|90/1|110/1"))

    def test_a_first_point_with_no_value_is_no_ramp(self) -> None:
        self.assertIsNone(con_mod.curve("1"))
        self.assertIsNone(con_mod.curve(""))

    def test_the_browning_smoke_bakes_the_engine_ramp(self) -> None:
        lib = con_mod.ObjectLibrary()
        lib.add_con("Objects/Effects/e_Browning_Damage/Effects.con", BROWNING_DESTROY_CON)
        emitter = lib.object("Em_Browning_Destroy")
        spec = effects.emitter_spec(emitter, lib.object(emitter.emitter_template))
        particle = spec["particle"]
        self.assertEqual([[0.0, 255.0, 255.0, 255.0, 133.0], [40.0, 0.0, 0.0, 0.0, 0.0]],
                         particle["colorRGBAOverTime"])
        self.assertTrue(all(point for point in particle["colorRGBAOverTime"]))
        self.assertEqual([[0.0, 0.460005], [39.0, 0.490005], [100.0, 1.0]],
                         particle["gravityModifierOverTime"])
        self.assertEqual([[0.0, 255.0, 255.0, 255.0, 133.0], [40.0, 0.0, 0.0, 0.0, 0.0]],
                         lib.object("Fx_Browning_Destroy").color_over_time)


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

    def test_particle_collision_reads_under_either_console_spelling(self) -> None:
        # CON-15: the console takes `hasCollisionPhysics` and
        # `setHasCollisionPhysics` as one property, and `con.py` files both
        # under the set spelling, so the particle reader must look there.
        lib = library()
        lib.add_con("Objects/Effects/Common/effects.con", """
ObjectTemplate.create SpriteParticle Fx_BareCollision
ObjectTemplate.texture e_richogitt_I
ObjectTemplate.hasCollisionPhysics 1

ObjectTemplate.create SpriteParticle Fx_SetCollision
ObjectTemplate.texture e_richogitt_I
ObjectTemplate.setHasCollisionPhysics 1

ObjectTemplate.create SpriteParticle Fx_NoCollisionWord
ObjectTemplate.texture e_richogitt_I
""")
        for name in ("Fx_BareCollision", "Fx_SetCollision"):
            self.assertIs(True, effects.particle_spec(lib.object(name)).get("hasCollisionPhysics"), name)
        self.assertNotIn("hasCollisionPhysics", effects.particle_spec(lib.object("Fx_NoCollisionWord")))

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
ObjectTemplate.dieAfterColl 0
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
        # round takes the fuse path and NOT the impact path. `dieAfterColl 0`
        # is the same shape, and is the word that says the round is still
        # there after the bounce to take that fuse path at all (HP-9e).
        self.assertEqual(
            {"radius": 15.0, "material2": 205, "damageType": 1,
             "hasCollisionEffect": False, "dieAfterColl": False,
             "yModOnExplosion": 2.0},
            spec["damage"])

    def test_a_flak_shell_carries_the_word_that_ends_it_on_contact(self) -> None:
        # HP-9e, and the regression this word exists for. `damageType 4` gives
        # the shell an end-of-life explosion and no impact explosion, so on
        # `splashSpec` alone the viewer would rest it where it landed and burst
        # 20 m of material2-199 splash there. `hasCollisionEffect 1` (and, on
        # two of the three, `dieAfterColl 1`) is what actually happens: the
        # engine recycles the round on contact through `resetProjectile`
        # without ever calling `startEndEffect`, so it bursts neither way.
        # Both words have to reach the viewer for it to know that.
        lib = library()
        lib.add_con("Objects/Vehicles/Land/AA_Allies/Objects.con", """
ObjectTemplate.create FireArms AA_AlliesGun
ObjectTemplate.projectileTemplate AA_Allies_Projectile
ObjectTemplate.velocity 300

ObjectTemplate.create Projectile AA_Allies_Projectile
ObjectTemplate.geometry projectile_m1
ObjectTemplate.timeToLive CRD_UNIFORM/0.8/1.4/0
ObjectTemplate.material 228
ObjectTemplate.material2 199
ObjectTemplate.damageType 4
ObjectTemplate.hasCollisionEffect 1
ObjectTemplate.dieAfterColl 1
ObjectTemplate.radius 20
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, lib)
        builder = gltf.GlbBuilder()
        report = Report(root="AA_AlliesGun", configuration="complex", lod=0)
        spec, _nodes = assembler._projectile_spec(
            builder, lib.object("AA_AlliesGun"), report)
        self.assertEqual(
            {"radius": 20.0, "material2": 199, "damageType": 4,
             "hasCollisionEffect": True, "dieAfterColl": True},
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
        # `effects-core.js` re-exports the damage-block half from its own file.
        (work / "package.json").write_text('{"type": "module"}')
        shutil.copyfile(MODULE.with_name("projectile-damage.js"),
                        work / "projectile-damage.js")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


# A bundle tree whose sound is one level down, which is the shape 22 of
# vanilla's 70 sounding impact bundles have: the MaterialManager names
# `RichoStoneDecal`, and it is the `e_RichoStone` it wraps that owns the
# script. Each template sits in its own directory so the relative
# `Sounds/...` binding has to be resolved against the *owner's* `.con`.
SOUND_CON_DECAL = """
ObjectTemplate.create EffectBundle RichoStoneDecal
ObjectTemplate.addTemplate e_RichoStone
"""
SOUND_CON_RICHO = """
ObjectTemplate.create EffectBundle e_RichoStone
ObjectTemplate.loadSoundScript Sounds/richostone.ssc
"""
SOUND_CON_OWN = """
ObjectTemplate.create EffectBundle e_ExplGas
ObjectTemplate.loadSoundScript Sounds/High.ssc
ObjectTemplate.addTemplate e_RichoStone
"""
SOUND_CON_MUTE = """
ObjectTemplate.create EffectBundle e_BuildingDust
"""

# The 10-of-159 case: two child bundles, a script each, neither on the parent.
# `MajorImpact_Sand` is the blast (`e_Explani02`) and the rain of sand
# (`e_ExplDrySand`); both are ordinary `addTemplate` instances, so the engine
# stands both up and both sound.
SOUND_CON_MAJOR = """
ObjectTemplate.create EffectBundle MajorImpact_Sand
ObjectTemplate.addTemplate e_Explani02
ObjectTemplate.addTemplate e_ExplDrySand
"""
SOUND_CON_ANI02 = """
ObjectTemplate.create EffectBundle e_Explani02
ObjectTemplate.loadSoundScript Sounds/ExplAni02.ssc
"""
SOUND_CON_DRYSAND = """
ObjectTemplate.create EffectBundle e_ExplDrySand
ObjectTemplate.loadSoundScript Sounds/ExplDrySand.ssc
"""

# `richostone.ssc` in miniature: one patch, four alternates closed with
# `randomPlay 1`, each with the distance ramp that owns its volume.
RICHOSTONE_SSC = """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/stoneimpact1.wav
volume .9
minDistance 5
priority 4
dopplerOff
beginEffect
controlSource Distance
controlDestination Volume
envelope Ramp
param 6
param 25
param 1
param -1
endEffect
load @ROOT/Sound/@RTD/stoneimpact2.wav
volume .9
minDistance 5
priority 4
randomPlay 1
"""

# Two patches, the second of which is a `trigger Volume` layer gated on a step
# `Time` ramp — the speed-of-sound delay every explosion script uses.
EXPLGAS_SSC = """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/explgas.wav
volume 1
minDistance 40
newPatch
load @ROOT/Sound/@RTD/explnrmsemi1.wav
trigger Volume
beginEffect
controlSource Time
controlDestination Volume
envelope Ramp
param 0.3
param 0.3
param 0
param 1
endEffect
"""


def sound_library() -> con_mod.ObjectLibrary:
    lib = con_mod.ObjectLibrary()
    lib.add_con("Objects/Effects/RichoStoneDecal/Objects.con", SOUND_CON_DECAL)
    lib.add_con("Objects/Effects/e_RichoStone/Objects.con", SOUND_CON_RICHO)
    lib.add_con("Objects/Effects/e_ExplGas/Objects.con", SOUND_CON_OWN)
    lib.add_con("Objects/Effects/e_BuildingDust/Objects.con", SOUND_CON_MUTE)
    lib.add_con("Objects/Effects/MajorImpact_Sand/Objects.con", SOUND_CON_MAJOR)
    lib.add_con("Objects/Effects/e_Explani02/Objects.con", SOUND_CON_ANI02)
    lib.add_con("Objects/Effects/e_ExplDrySand/Objects.con", SOUND_CON_DRYSAND)
    return lib


class BundleSoundTests(unittest.TestCase):
    """`loadSoundScript` on an effect tree, and the layers it parses to."""

    def test_a_bundle_takes_its_own_script(self) -> None:
        found = effects.bundle_sound_script(sound_library(), "e_ExplGas")
        self.assertEqual(("Objects/Effects/e_ExplGas/Sounds/High.ssc",
                          "e_ExplGas", 0), found)

    def test_a_wrapper_inherits_the_script_of_the_bundle_it_wraps(self) -> None:
        """The 22-of-70 case. Reading only the named template finds nothing."""
        lib = sound_library()
        self.assertIsNone(lib.object("RichoStoneDecal").sound_script)
        path, owner, depth = effects.bundle_sound_script(lib, "RichoStoneDecal")
        # Resolved against e_RichoStone's own .con, not RichoStoneDecal's.
        self.assertEqual("Objects/Effects/e_RichoStone/Sounds/richostone.ssc", path)
        self.assertEqual("e_RichoStone", owner)
        self.assertEqual(1, depth)

    def test_a_bundle_with_no_script_anywhere_is_silent(self) -> None:
        self.assertIsNone(
            effects.bundle_sound_script(sound_library(), "e_BuildingDust"))

    def test_an_unknown_name_is_silent_rather_than_an_error(self) -> None:
        self.assertIsNone(
            effects.bundle_sound_script(sound_library(), "NoSuchBundle"))

    def test_a_tree_with_two_scripts_yields_both(self) -> None:
        """The 10-of-159 case. Taking only the first is a blast with no
        debris rain — and `bundle_sound_script`'s old docstring said the case
        did not occur, which the data refutes."""
        found = effects.bundle_sound_scripts(sound_library(),
                                             "MajorImpact_Sand")
        self.assertEqual(
            [("Objects/Effects/e_Explani02/Sounds/ExplAni02.ssc",
              "e_Explani02", 1),
             ("Objects/Effects/e_ExplDrySand/Sounds/ExplDrySand.ssc",
              "e_ExplDrySand", 1)],
            found)

    def test_the_single_valued_lookup_takes_the_first(self) -> None:
        self.assertEqual(
            ("Objects/Effects/e_Explani02/Sounds/ExplAni02.ssc",
             "e_Explani02", 1),
            effects.bundle_sound_script(sound_library(), "MajorImpact_Sand"))

    def test_a_parents_own_script_comes_before_its_children(self) -> None:
        found = effects.bundle_sound_scripts(sound_library(), "e_ExplGas")
        self.assertEqual(
            ["Objects/Effects/e_ExplGas/Sounds/High.ssc",
             "Objects/Effects/e_RichoStone/Sounds/richostone.ssc"],
            [path for path, _, _ in found])

    def test_a_template_reached_twice_is_counted_once(self) -> None:
        lib = sound_library()
        lib.add_con("Objects/Effects/Doubled/Objects.con",
                    "ObjectTemplate.create EffectBundle Doubled\n"
                    "ObjectTemplate.addTemplate e_RichoStone\n"
                    "ObjectTemplate.addTemplate e_RichoStone\n")
        self.assertEqual(1, len(effects.bundle_sound_scripts(lib, "Doubled")))

    def test_a_cycle_terminates(self) -> None:
        lib = con_mod.ObjectLibrary()
        lib.add_con("Objects/Effects/a/Objects.con",
                    "ObjectTemplate.create EffectBundle a\n"
                    "ObjectTemplate.addTemplate b\n")
        lib.add_con("Objects/Effects/b/Objects.con",
                    "ObjectTemplate.create EffectBundle b\n"
                    "ObjectTemplate.addTemplate a\n")
        self.assertIsNone(effects.bundle_sound_script(lib, "a"))

    def _layers(self, ssc: str) -> list[dict]:
        from bf42.level import parse_ssc as _parse
        patches = _parse(ssc, level="high")
        return effects.sound_layers(
            patches,
            lambda ref: (Path(ref).name, b""),
            lambda resolved: f"sounds/{Path(resolved[0]).stem}.mp3")

    def test_layers_carry_the_patch_index_and_random_play(self) -> None:
        layers = self._layers(RICHOSTONE_SSC)
        self.assertEqual(2, len(layers))
        self.assertEqual(["sounds/stoneimpact1.mp3", "sounds/stoneimpact2.mp3"],
                         [l["file"] for l in layers])
        # One patch, so one index; `randomPlay 1` closes it and reaches both.
        self.assertEqual([0, 0], [l["patch"] for l in layers])
        self.assertEqual([True, True], [l["randomPlay"] for l in layers])
        self.assertEqual(0.9, layers[0]["volume"])
        self.assertEqual(5.0, layers[0]["minDistance"])
        self.assertEqual(4, layers[0]["priority"])
        self.assertFalse(layers[0]["doppler"])

    def test_layers_keep_the_distance_ramp_that_owns_the_volume(self) -> None:
        mods = self._layers(RICHOSTONE_SSC)[0]["modulators"]
        self.assertEqual(1, len(mods))
        self.assertEqual("volume", mods[0]["dest"])
        self.assertEqual("distance", mods[0]["source"])
        self.assertEqual("ramp", mods[0]["envelope"])
        self.assertEqual([6.0, 25.0, 1.0, -1.0], mods[0]["params"])

    def test_separate_patches_keep_separate_indices(self) -> None:
        layers = self._layers(EXPLGAS_SSC)
        self.assertEqual([0, 1], [l["patch"] for l in layers])
        self.assertEqual([False, False], [l["randomPlay"] for l in layers])
        # The delayed distant layer: `trigger Volume` plus a step Time ramp.
        self.assertEqual("volume", layers[1]["trigger"])
        self.assertEqual([0.3, 0.3, 0.0, 1.0], layers[1]["modulators"][0]["params"])

    def test_an_unresolvable_sample_is_dropped_not_faked(self) -> None:
        from bf42.level import parse_ssc as _parse
        patches = _parse(RICHOSTONE_SSC, level="high")
        layers = effects.sound_layers(patches, lambda ref: None,
                                      lambda resolved: "never")
        self.assertEqual([], layers)


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

    def test_sample_curve_into_matches_the_allocating_form(self) -> None:
        """`sampleCurveInto` is what the per-frame path calls; it may not drift.

        Every branch: before the first point, on it, between two points, a
        zero-width segment, past the last, a missing ramp, an empty ramp, a
        single-point ramp, a multi-component ramp, a later point carrying fewer
        components than the earlier one (NaN on both sides, deliberately), and
        points with no components at all (an empty array on one side, a count
        of 0 on the other -- which is NOT the `null` a missing ramp answers).
        """
        into = self.results["into"]["curve"]
        self.assertGreaterEqual(len(into), 11)
        for name, row in into.items():
            with self.subTest(curve=name):
                self.assertEqual(row["want"], row["got"], "components differ")
                self.assertEqual(row["wantLen"], row["gotLen"], "component count differs")
                self.assertEqual(row["wantFirst"], row["gotFirst"],
                                 "what a `ramp ? ramp[0] : 1` caller reads differs")
        # The two states a caller must be able to tell apart really are distinct.
        self.assertEqual(-1, into["missing"]["gotLen"])
        self.assertEqual(-1, into["empty"]["gotLen"])
        self.assertEqual(0, into["noComponents"]["gotLen"])
        self.assertEqual("undefined", into["noComponents"]["gotFirst"])
        self.assertEqual(1, into["missing"]["gotFirst"])
        # The interpolation branch takes its count from the EARLIER point, so a
        # shorter later point is NaN -- unchanged from the allocating form.
        self.assertEqual("NaN", into["shorterLater"]["got"][1])

    def test_a_timeless_point_is_passed_over_not_thrown_on(self) -> None:
        """Ledger EMT-9: a ramp baked with an empty point (DC's destroyed
        Browning) made `sampleCurveInto` set `out.length = -1` and throw every
        frame. Both samplers now read around it, and agree while doing so."""
        into = self.results["into"]["curve"]
        # 70 % is between 40 and 100 with the empty point between them.
        row = into["emptyBetween"]
        self.assertEqual(4, row["gotLen"])
        k = 30 / 60
        self.assertEqual([41 + (26 - 41) * k, 38 + (23 - 38) * k, 36 + (19 - 36) * k, 133 * (1 - k)],
                         row["got"])
        self.assertEqual([2], into["emptyFirst"]["got"])       # before the first real point
        self.assertEqual([2], into["nullPoint"]["got"])        # 0 -> 100 across the null
        self.assertEqual([3], into["emptyLast"]["got"])        # held past the last real point
        self.assertEqual(-1, into["onlyEmpty"]["gotLen"])      # nothing to read: no ramp
        self.assertIsNone(into["onlyEmpty"]["want"])

    def test_eval_particle_into_matches_the_allocating_form(self) -> None:
        """`evalParticleInto` fills one module-level record; same numbers.

        Four particles across every branch of `evalParticle` -- a mesh with a
        `sizeModifier`, a sprite with size and colour ramps, a sprite with an
        `xySizeRatioOverTime` away from 1, and a mesh with no `sizeModifier`
        (the bare `[1, 1, 1]`) -- each read at six points of its life including
        past the end, where the phase clamps.
        """
        look = self.results["into"]["look"]
        self.assertEqual({"decal", "puff", "ratio", "bare"}, set(look))
        for name, rows in look.items():
            self.assertEqual(6, len(rows))
            for row in rows:
                with self.subTest(particle=name, frac=row["frac"]):
                    self.assertTrue(row["same"], f"look differs: {row['want']}")
                    self.assertEqual(row["wantColorNull"], row["gotColorNull"])
        # The sprite branches must actually have produced a colour and a
        # non-unit x scale, or the comparison above proved nothing about them.
        self.assertFalse(look["puff"][1]["wantColorNull"])
        self.assertNotEqual(look["ratio"][3]["want"]["scale"][0],
                            look["ratio"][3]["want"]["scale"][1])
        # ... and the bare-mesh branch really is the unit scale.
        self.assertEqual([1, 1, 1], look["bare"][2]["want"]["scale"])
        # One record, reused: that is the whole point, and the contract the
        # call site in `effects.js` documents.
        self.assertTrue(self.results["into"]["reuse"]["sameObject"])
        self.assertTrue(self.results["into"]["reuse"]["sameScale"])

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


class TwoPathExplosionTests(unittest.TestCase):
    """**HP-9d**: the engine has two explosions and `damageType` alone does not
    say which a round gets.

        impact, on collision:   damageType == 1 && hasCollisionEffect
        end of life, on fuse:   damageType in {1, 4}, flag NOT tested

    `hasCollisionEffect` is the impact-versus-fuse **discriminator**, not a
    splash-capability flag. Requiring it for splash generally — the F1 report's
    recommendation, refuted by a verifier — would silently delete grenade,
    explosives-pack, satchel and landmine splash, which is the most-used splash
    damage in the game.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["splashSpec"]

    def test_a_tank_shell_takes_both_paths(self) -> None:
        # `damageType 1` with the flag. The Sherman authors no radius at all,
        # so this is also the 10.0 constructor default (HP-9) arriving intact.
        sherman = self.results["sherman"]
        self.assertTrue(sherman["impact"])
        self.assertTrue(sherman["endOfLife"])
        self.assertEqual(10, sherman["radius"])

    def test_a_grenade_has_no_impact_path_at_all(self) -> None:
        # The case the refuted recommendation would have broken: `damageType 1`
        # without the flag is a FUSE weapon, not a dud. Its 15 m blast is real
        # and arrives only when `timeToLive` ends.
        for name in ("grenade", "expack"):
            with self.subTest(name):
                spec = self.results[name]
                self.assertFalse(spec["impact"])
                self.assertTrue(spec["endOfLife"])
                self.assertGreater(spec["radius"], 0)

    def test_damage_type_four_never_bursts_on_impact(self) -> None:
        # The landmine has the flag clear; vanilla's three flak shells have it
        # SET, and for the EXPLOSION it still does not matter — the flag is not
        # consulted for type 4. What it does decide for them is whether the
        # round survives the contact at all, which is `diesOnContact` below.
        for name in ("landmine", "flak"):
            with self.subTest(name):
                spec = self.results[name]
                self.assertEqual(4, spec["damageType"])
                self.assertFalse(spec["impact"])
                self.assertTrue(spec["endOfLife"])

    def test_a_round_with_no_area_pass(self) -> None:
        # `material2 -1` is the authored "no splash" (fighter MGs); type 0 is
        # direct-only; type 3 (binoculars) takes neither path.
        for name in ("noSplash", "direct", "binoculars", "none"):
            with self.subTest(name):
                self.assertIsNone(self.results[name])

    def test_a_fractional_radius_is_no_splash_on_either_path(self) -> None:
        # HP-9: the radius is a console `int` truncated at parse, so DC's
        # `50calSniper_Projectile radius 0.25` is 0 and the strictly
        # `radius > d` gate reaches nothing. The end-of-life path's
        # "untruncated" radius is an ABSENT SECOND TRUNCATION, not a surviving
        # fraction — handing it 0.25 would resurrect a splash the engine has
        # never had, so the fuse case must be None too.
        self.assertIsNone(self.results["fractional"])
        self.assertIsNone(self.results["fractionalFuse"])

    def test_an_old_bakes_fractional_radius_is_repaired(self) -> None:
        # FH's `BismarckFatProjectile 17.63` from a glb baked before `con.py`
        # truncated: 17 here, the same integer the engine holds.
        self.assertEqual(17, self.results["oldBake"]["radius"])

    def test_a_glb_baked_before_either_word_behaves_as_it_always_did(self) -> None:
        # No `damageType`, no `hasCollisionEffect`. Assumed 1 and true
        # respectively, which is what 2,935 of 3,161 surveyed templates are —
        # so a stale asset keeps its splash instead of silently losing it.
        legacy = self.results["legacy"]
        self.assertEqual(1, legacy["damageType"])
        self.assertTrue(legacy["impact"])
        self.assertTrue(legacy["endOfLife"])


class SurvivingContactTests(unittest.TestCase):
    """HP-9e: which rounds live through a contact, and which are recycled.

    `Projectile::handleCollision` (lnxded 0x0831ee80) kills the round when
    `dieAfterColl` (0x0831ef4b) **or** `hasCollisionEffect` (0x0831ef54) is
    set, through `Projectile::resetProjectile` (0x0831e720, called at
    0x0831f00a), which sets the detonate latch `Projectile+0x10d` and despawns
    it **without** calling `startEndEffect`. So a round that dies on contact
    explodes neither way, and one that survives is free to burst on its fuse.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["diesOnContact"]

    def test_the_four_vanilla_fuse_weapons_survive_contact(self) -> None:
        # Both grenades, the explosives pack and the landmine write
        # `hasCollisionEffect 0` and `dieAfterColl 0`. This is what lets a
        # grenade bounce off a wall and go off three seconds later.
        for name in ("grenade", "expack", "landmine"):
            with self.subTest(name):
                self.assertFalse(self.results[name])

    def test_a_flak_shell_dies_on_contact_and_bursts_neither_way(self) -> None:
        # The regression this class exists for. All three vanilla flak rounds
        # (`AA_Allies_Projectile`, `Carrier_AA_Projectile`, `Flak38_Projectile`)
        # are `damageType 4` — so `splashSpec` gives them an end-of-life blast
        # and no impact blast — and all three set `hasCollisionEffect 1`. Read
        # the flag as "dead on a type-4 round" and the viewer rests the shell
        # where it landed and detonates 20 m of material2-199 splash there,
        # which is a blast the game never has: the engine deletes the round.
        self.assertTrue(self.results["flakBoth"])
        self.assertTrue(self.results["flakFlagOnly"])

    def test_either_word_alone_is_enough(self) -> None:
        self.assertTrue(self.results["sherman"])   # the flag alone
        self.assertTrue(self.results["dieOnly"])   # dieAfterColl alone

    def test_only_four_vanilla_templates_are_fuse_rounds(self) -> None:
        # The whole three-condition rule on the real vanilla numbers: an
        # end-of-life blast, no impact blast, and surviving contact. A tank
        # shell and a bomb fail the second; the flak shells fail the third.
        fuse = run_harness()["fuseRound"]
        self.assertEqual(
            {"grenade": True, "expack": True, "landmine": True,
             "sherman": False, "bomb": False,
             "flakAllies": False, "flak38": False},
            fuse)

    def test_an_old_bake_assumes_the_round_ends_at_the_wall(self) -> None:
        # Neither word on the block, or no block at all. Assuming survival
        # would leave every tank shell in a stale extract lying on the ground
        # running a fuse down; assuming death is what 25 of vanilla's 28
        # `damageType 1` templates actually do.
        self.assertTrue(self.results["legacy"])
        self.assertTrue(self.results["none"])


class BlastGeometryTests(unittest.TestCase):
    """HP-9: the distance, its Y scale, the falloff, and DMG-1's unlisted pair."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_only_the_y_term_is_scaled(self) -> None:
        # lnxded 0x08156613 multiplies `dy` and nothing else.
        d = self.results["blastDistance"]
        self.assertEqual(5, d["plainUp"])
        self.assertEqual(10, d["scaledUp"])
        self.assertEqual(5, d["sideways"])
        # 3 across, 4 up at yMod 2 -> hypot(3, 8) = 8.544004.
        self.assertAlmostEqual(8.544004, d["diagonal"], places=5)

    def test_a_fuse_round_lives_out_its_authored_fuse(self) -> None:
        # The 20 s ceiling is a viewer recycling guard for a round that is
        # still FLYING. It became load-bearing the moment the fuse started
        # firing a blast: `ExpPackProjectile` authors 240 s and
        # `LandmineProjectile` 360 s, and the engine really does detonate them
        # then (`Projectile::handleUpdate` 0x0831e940 -> `detonate`
        # 0x0831e680). Clamping those to 20 s does not expire them early in
        # some harmless cosmetic sense — it drops 12 m and 4 m of real splash
        # on the player twenty seconds after he puts the charge down.
        life = self.results["lifetime"]
        self.assertEqual(240, life["expack"])
        self.assertEqual(360, life["landmine"])
        self.assertEqual(3, life["grenade"])
        self.assertEqual(600, life["longFuse"])

    def test_a_flying_round_is_still_held_to_the_ceiling(self) -> None:
        # Nothing vanilla flies for twenty seconds, but a mod round with a
        # huge fuse and a slow muzzle would sail on forever, and that is what
        # the ceiling is for. A flak shell is NOT a fuse round, so it keeps
        # the ceiling too — though its own fuse is under a second anyway.
        life = self.results["lifetime"]
        self.assertEqual(20, self.results["flightCeiling"])
        self.assertEqual(20, life["longFlier"])
        self.assertEqual(3, life["sherman"])
        self.assertAlmostEqual(0.8, life["flakAllies"])
        self.assertEqual(10, life["unspecified"])   # the no-timeToLive default

    def test_the_impact_blast_is_centred_off_the_surface(self) -> None:
        # `hitPos + 0.1 * normal`, lnxded 0x08153f5e (`ds:0x086b1ca0` =
        # `cdcccc3d` = 0.1f) through 0x08153f8f, pushed as the explosion
        # position at 0x08154026. The collision EFFECT is played earlier, at
        # 0x08153e5b, on the raw hit point — the two are not the same place.
        self.assertEqual(0.1, self.results["impactBlastOffset"])

    def test_truncation_is_toward_zero(self) -> None:
        t = self.results["truncate"]
        self.assertEqual(15, t["exact"])
        self.assertEqual(17, t["down"])
        self.assertEqual(0, t["toZero"])
        self.assertEqual(0, t["negative"])   # not -1: toward zero, not floor
        self.assertEqual(10, t["default"])

    def test_the_falloff_is_linear_to_a_hard_cutoff(self) -> None:
        # `t = clamp((radius - d)/radius, 0, 1)`, and the gate is a strict
        # `radius > d`, so a victim exactly on the radius takes nothing.
        s = self.results["splashDamage"]
        self.assertEqual(20, s["centre"])
        self.assertEqual(10, s["half"])
        self.assertEqual(0, s["edge"])

    def test_an_unlisted_material_pair_really_means_no_damage(self) -> None:
        # DMG-1: the engine's fallback is `defaultDamageMod`, which is 0.0 from
        # both constructors, has a setter nothing calls and no console word —
        # so no mod can change it either. Returning the base damage instead
        # (the F1 report's recommendation) is refuted.
        self.assertEqual(0, self.results["splashDamage"]["unlistedPair"])

    def test_exposure_multiplies_and_zero_short_circuits(self) -> None:
        # The soldier-only cover term (`checkForHitOnSoldier`, 0x08156eb6,
        # short-circuit at 0x08156ede). Callers in this viewer pass 1 because
        # there is no soldier-limb volume to sample; the parameter exists so
        # the gap is visible rather than silently folded away.
        s = self.results["splashDamage"]
        self.assertEqual(10, s["halfExposed"])
        self.assertEqual(0, s["noExposure"])


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


class SpawnParticleIntoTests(unittest.TestCase):
    """The pooled spawn is the same particle as the allocating one."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["spawnInto"]

    def test_same_record_as_spawn_particle(self):
        self.assertTrue(self.results["same"],
                        f"{self.results['fresh']}\n!=\n{self.results['reused']}")
        self.assertTrue(self.results["sameRecord"])


# Vanilla's PT boat (`Objects/Vehicles/Sea/Elco80/Effects.con`, cut down): its
# death tier leaves the raft through a spawn effect. Desert Combat's ruined
# objectives (`e_*WRECKPCO`) are this emitter copied word for word.
SPAWN_CON = """
ObjectTemplate.create EffectBundle e_PTBoatWreck
ObjectTemplate.addTemplate Em_PTBoatSpawnRaft
ObjectTemplate.setPosition 0/0/0
ObjectTemplate.timeToLive CRD_NONE/1.8/0/0

ObjectTemplate.create Emitter Em_PTBoatSpawnRaft
ObjectTemplate.template Elco80Raft
ObjectTemplate.lodDistance 375
ObjectTemplate.timeToLive CRD_NONE/1/0/0
ObjectTemplate.intensity CRD_NONE/1/0/0
ObjectTemplate.IsSpawnEffect 1

ObjectTemplate.create EffectBundle e_ChunkFall
ObjectTemplate.addTemplate Em_ChunkFall

ObjectTemplate.create Emitter Em_ChunkFall
ObjectTemplate.template Raft_Chunk
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0

ObjectTemplate.create PlayerControlObject Elco80Raft
ObjectTemplate.hasMobilePhysics 1
ObjectTemplate.addTemplate Elco80RaftHull
ObjectTemplate.hasArmor 1
ObjectTemplate.hitpoints 200
ObjectTemplate.timetoliveafterdeath 0

ObjectTemplate.create SimpleObject Elco80RaftHull
ObjectTemplate.geometry Raft_m1

ObjectTemplate.create SimpleObject Raft_Chunk
ObjectTemplate.geometry Raft_m1

GeometryTemplate.create StandardMesh Raft_m1
"""


class SpawnEffectTests(unittest.TestCase):
    """EMT-10: `isSpawnEffect 1` makes the game create its template as an
    object (`GameServer::spawnObject`), not a particle."""

    def spawn_library(self) -> con_mod.ObjectLibrary:
        lib = con_mod.ObjectLibrary()
        lib.add_con("Objects/Vehicles/Sea/Elco80/Effects.con", SPAWN_CON)
        return lib

    def test_a_spawn_effect_is_an_object_and_a_plain_emitter_still_debris(self) -> None:
        lib = self.spawn_library()
        [(_ref, _em, _payload, raft)] = effects.bundle_tree(lib, "e_PTBoatWreck").emitters
        self.assertEqual({"kind": "object", "template": "Elco80Raft", "hasMobilePhysics": True},
                         raft["particle"])
        self.assertTrue(raft["isSpawnEffect"])
        self.assertEqual(375.0, raft["lodDistance"])
        # Before, the PCO payload had no particle at all and the raft emitter
        # was dropped: `e_PTBoatWreck` baked as missing.
        self.assertIsNone(effects.particle_spec(lib.object("Elco80Raft")))
        # The same mesh thrown by an emitter without the word is still debris.
        [(_ref, _em, _payload, chunk)] = effects.bundle_tree(lib, "e_ChunkFall").emitters
        self.assertEqual("mesh", chunk["particle"]["kind"])
        self.assertTrue(chunk["particle"]["debris"])

    def test_the_spawned_template_says_whether_its_body_moves(self) -> None:
        # PHY-17: the bit decides the physics node, and a template that never
        # writes it is static like one that writes 0 (Desert Combat's ruins).
        lib = self.spawn_library()
        lib.add_con("Objects/Ruins/Effects.con", """
ObjectTemplate.create EffectBundle e_RuinWRECKPCO
ObjectTemplate.addTemplate Em_RuinWRECKPCO
ObjectTemplate.create Emitter Em_RuinWRECKPCO
ObjectTemplate.template Ruin_wreck
ObjectTemplate.IsSpawnEffect 1
ObjectTemplate.create EffectBundle e_ShedWRECKPCO
ObjectTemplate.addTemplate Em_ShedWRECKPCO
ObjectTemplate.create Emitter Em_ShedWRECKPCO
ObjectTemplate.template Shed_wreck
ObjectTemplate.IsSpawnEffect 1
ObjectTemplate.create PlayerControlObject Ruin_wreck
ObjectTemplate.hasMobilePhysics 0
ObjectTemplate.create PlayerControlObject Shed_wreck
""")
        for bundle, mobile in (("e_PTBoatWreck", True), ("e_RuinWRECKPCO", False),
                               ("e_ShedWRECKPCO", False)):
            [(_ref, _em, _payload, spec)] = effects.bundle_tree(lib, bundle).emitters
            self.assertIs(mobile, spec["particle"]["hasMobilePhysics"], bundle)

    def test_the_bake_hangs_the_whole_object_under_its_emitter(self) -> None:
        lib = self.spawn_library()
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, lib, include_collision=False)
        assembler.apply_material_diffuse = True
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
                                  indices=[0, 1, 2])
        assembler._geom_mesh["raft_m1"] = (builder.add_mesh("Raft_m1", [triangle]), 1)
        assembler._geom_collisions["raft_m1"] = []
        report = Report(root="effects", configuration="complex", lod=0)
        roots, index = assembler.bake_effect_library(builder, ["e_PTBoatWreck"], report)
        self.assertEqual({"e_PTBoatWreck": {"emitters": 1}}, index["bundles"])
        self.assertEqual([], index["missing"])
        # The bake's own setting is back for the next particle.
        self.assertTrue(assembler.apply_material_diffuse)
        glb = builder.build(roots, extras={"effects": index})
        import struct
        doc = json.loads(glb[20:20 + struct.unpack_from("<I", glb, 12)[0]])
        nodes = doc["nodes"]
        [emitter] = [n for n in nodes if (n.get("extras") or {}).get("effectEmitter")]
        self.assertEqual("object", emitter["extras"]["effectEmitter"]["particle"]["kind"])
        self.assertNotIn("mesh", emitter)
        [raft] = [nodes[i] for i in emitter["children"]]
        self.assertEqual("Elco80Raft", raft["name"])
        self.assertEqual("PlayerControlObject", raft["extras"]["templateKind"])
        self.assertEqual(200, raft["extras"]["armor"]["hitpoints"])
        # HP-19: how long it stays once destroyed rides with its Armor.
        self.assertEqual(0, raft["extras"]["armor"]["timeToLiveAfterDeath"])
        hull = nodes[raft["children"][0]]
        self.assertIn("mesh", hull)


class LevelEffectsTests(unittest.TestCase):
    """`extract_effects.py --levels`: what a level's own `effects.glb` holds,
    and the `maps.json` row that names it."""

    def test_only_what_the_levels_scripts_declare(self) -> None:
        import extract_effects
        lib = con_mod.ObjectLibrary()
        lib.add_con("Objects/Effects/Common/Effects.con", """
ObjectTemplate.create EffectBundle e_ModWide
ObjectTemplate.addTemplate em_ModWide
ObjectTemplate.create Emitter em_ModWide
""")
        lib.add_con("bf1942/levels/DC_No_Fly_Zone/objects/air_control_tower_m1/Effects.con", """
ObjectTemplate.create EffectBundle e_air_control_tower_desWRECKPCO
ObjectTemplate.addTemplate Em_air_control_tower_desWRECKPCO
ObjectTemplate.create Emitter Em_air_control_tower_desWRECKPCO
ObjectTemplate.create Emitter em_LevelSmoke
""")
        lib.add_con("bf1942/levels/DC_No_Fly_Zone/objects/air_control_tower_m1/objects.con", """
ObjectTemplate.create PlayerControlObject air_control_tower_des
ObjectTemplate.addArmorEffect 50 em_LevelSmoke 0/1/0
ObjectTemplate.addArmorEffect 20 e_ModWide 0/1/0
""")
        self.assertEqual({"e_air_control_tower_desWRECKPCO", "em_LevelSmoke"},
                         extract_effects.level_bundle_names(lib))

    def test_the_row_names_the_glb_and_loses_it_with_the_files(self) -> None:
        import extract_effects
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp)
            (tree / "dc_no_fly_zone").mkdir()
            row = {"name": "DC_No_Fly_Zone", "glb": "dc_no_fly_zone/scene.glb"}
            written = extract_effects.write_level_effects(
                tree, row, b"glTF", {"bundles": {"e_x": {"emitters": 1}}})
            self.assertEqual([tree / "dc_no_fly_zone" / "effects.glb"], written)
            self.assertEqual("dc_no_fly_zone/effects.glb", row["effects"])
            self.assertTrue((tree / "dc_no_fly_zone" / "effects.report.json").is_file())
            (tree / "dc_no_fly_zone" / "effects.glb.gz").write_bytes(b"")
            self.assertEqual([], extract_effects.write_level_effects(tree, row, None, {}))
            self.assertNotIn("effects", row)
            self.assertEqual([], sorted(p.name for p in (tree / "dc_no_fly_zone").iterdir()))

    def test_a_rebake_never_leaves_the_old_gzip_beside_a_new_glb(self) -> None:
        # With `--no-optimise` nothing rewrites the `.gz`, and a stale one is
        # what the publisher refuses (or, served, what a client would get).
        import extract_effects
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp)
            level = tree / "battle_of_britain"
            level.mkdir()
            row = {"name": "Battle_of_Britain", "glb": "battle_of_britain/scene.glb"}
            (level / "effects.glb").write_bytes(b"old glb")
            (level / "effects.glb.gz").write_bytes(b"gzip of the old glb")
            extract_effects.write_level_effects(tree, row, b"new glb", {"bundles": {}})
            self.assertEqual(b"new glb", (level / "effects.glb").read_bytes())
            self.assertFalse((level / "effects.glb.gz").exists())

    def test_the_row_names_the_levels_sounds_and_loses_them_with_the_file(self) -> None:
        import extract_effects
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp)
            (tree / "kasserine_pass").mkdir()
            row = {"name": "Kasserine_Pass", "glb": "kasserine_pass/scene.glb"}
            extract_effects.write_level_sounds(
                tree, row, {"bundles": {"e_fire": {"name": "e_Fire"}}, "scripts": {}})
            self.assertEqual("kasserine_pass/effects.sounds.json", row["effectSounds"])
            self.assertTrue((tree / "kasserine_pass" / "effects.sounds.json").is_file())
            # Nothing sounding: the file and the key go.
            extract_effects.write_level_sounds(tree, row, {"bundles": {}, "silent": {"e_x": ""}})
            self.assertNotIn("effectSounds", row)
            self.assertEqual([], list((tree / "kasserine_pass").iterdir()))


GAME_DIR = Path(os.path.expanduser("~/.wine/drive_c/EA Games/Battlefield 1942"))


@unittest.skipUnless((GAME_DIR / "Mods" / "bf1942").is_dir(), "no Battlefield 1942 install")
class LevelEffectSoundsTests(unittest.TestCase):
    """A level's own bundles' sounds, from the install: Battle of Britain's
    factory chimneys and Kasserine Pass's own fire, which `_shared` cannot
    hold. Samples copied as wav into a scratch tree (no ffmpeg needed)."""

    @classmethod
    def setUpClass(cls) -> None:
        import extract_effects
        import scene_layers
        cls.manifests = {}
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp)
            for level in ("Battle_of_Britain", "Kasserine_Pass"):
                ctx = scene_layers.LevelContext(GAME_DIR, "bf1942", level, out=tree)
                cls.manifests[level] = extract_effects.level_sound_manifest(ctx, tree, "wav")
            cls.samples = sorted(p.name for p in (tree / "_shared" / "sounds").iterdir())

    def test_the_chimneys_sound_the_explosion_they_bundle(self) -> None:
        # `e_BritainFactory_SmokeStacks` adds `e_scrapmetal` and `e_ExplGas`.
        bob = self.manifests["Battle_of_Britain"]
        entry = bob["bundles"]["e_britainfactory_smokestacks"]
        self.assertEqual("e_ExplGas", entry["soundOwner"])
        self.assertIn("sounds/explgas.wav",
                      [layer["file"] for layer in bob["scripts"][entry["script"]]["layers"]])

    def test_kasserines_fire_is_its_own(self) -> None:
        kasserine = self.manifests["Kasserine_Pass"]
        entry = kasserine["bundles"]["e_fire"]
        self.assertTrue(entry["script"].startswith("bf1942/levels/kasserine_pass/"))
        self.assertEqual(["sounds/vefr1.wav", "sounds/vefr2.wav", "sounds/vefr3.wav"],
                         sorted({layer["file"] for layer in kasserine["scripts"][entry["script"]]["layers"]}))
        self.assertIn("vefr1.wav", self.samples)


if __name__ == "__main__":
    unittest.main()
