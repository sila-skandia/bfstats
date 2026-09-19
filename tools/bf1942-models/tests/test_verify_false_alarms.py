"""One test per class of false alarm the verifier used to raise.

On the 2026-09-19 rebuild `verify_models.py` called 42 of 96 vanilla models
and 96 of 285 Eve of Destruction models BROKEN, and every one was checked by
eye and was wrong. Four things were behind all of them, and each gets a small
synthetic `.glb` here built the way the exporter builds one -- so the test
says what the exporter writes, not what a name happens to look like:

1. emitters, tracers and projectile previews counted as parts,
2. a model measured across those, so a Bar1918 drew 2.02 m against 1.19 m real,
3. a skinned soldier read as four unbound parts on the origin,
4. `bodycollision_m1`, which no vanilla archive ships, read as a hole.

Plus the two the repair turned up: a vehicle sub-part modelled in hull space
(node at the origin, geometry metres away) is not collapsed, and a "shadow
mesh" that is really the weapon's own body at full detail cannot measure
anything.

Each test also asserts the *other* half: that the real failure the check
exists for still fails. A verifier that never says broken is no better than
one that always does.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import verify  # noqa: E402
from bf42.gltf import GlbBuilder, Node, Primitive  # noqa: E402


def box(size: float, centre: tuple[float, float, float] = (0, 0, 0)) -> Primitive:
    """Two triangles spanning `size` in Y and Z, centred where asked."""
    s = size / 2
    cx, cy, cz = centre
    return Primitive(
        positions=[(cx, cy - s, cz - s), (cx, cy - s, cz + s),
                   (cx, cy + s, cz + s), (cx, cy + s, cz - s)],
        indices=[0, 1, 2, 0, 2, 3],
    )


def scene(nodes: list[Node], builder: GlbBuilder) -> list[verify.Part]:
    indices = [builder.add_node(node) for node in nodes]
    root = builder.add_node(Node(name="Root", children=indices))
    path = Path(tempfile.mkdtemp()) / "model.glb"
    path.write_bytes(builder.build([root]))
    doc, blob = verify.read_glb(path)
    return verify.scene_parts(doc, blob)


def weapon_with_effects(builder: GlbBuilder) -> list[verify.Part]:
    """A 1.19 m weapon body with the furniture the exporter now bakes beside
    it: a muzzle-flash cone reaching 2 m, a billboard glow, a shell eject and
    a 1 m tracer streak. This is the Bar1918's shape, simplified."""
    body = builder.add_mesh("body", [box(1.19)])
    flash = builder.add_mesh("flash", [box(2.02)])
    glow = builder.add_mesh("glow", [box(1.0)])
    shell = builder.add_mesh("shell", [box(0.05)])
    tracer = builder.add_mesh("tracer", [box(1.0)])
    return scene([
        Node(name="Bar1918Complex", mesh=body,
             extras={"templateKind": "AnimatedBundle", "geometry": "Bar1918"}),
        Node(name="em_MuzzSG44", mesh=flash,
             extras={"templateKind": "Particle",
                     "effect": {"kind": "mesh", "timeToLive": 0.07}}),
        Node(name="em_MuzzSG44_glow", mesh=glow,
             extras={"templateKind": "SpriteParticle",
                     "effect": {"kind": "sprite", "billboard": True}}),
        Node(name="Em_Shell792mm", mesh=shell,
             extras={"templateKind": "Particle", "effect": {"kind": "mesh"}}),
        Node(name="Bar1918 tracer", mesh=tracer,
             extras={"templateKind": "Projectile",
                     "tracerMesh": {"template": "Tracer_Projectile",
                                    "geometry": "TLight_m1"}}),
    ], builder)


# ------------------------------------------------- 1. the exporter's furniture

class HelperNodeTests(unittest.TestCase):
    """What a node is, asked of the extras rather than the name."""

    def setUp(self) -> None:
        self.parts = weapon_with_effects(GlbBuilder())
        self.by_name = {p.name: p for p in self.parts}

    def test_a_particle_emitter_is_an_effect(self) -> None:
        self.assertTrue(self.by_name["em_MuzzSG44"].is_effect)
        self.assertTrue(self.by_name["em_MuzzSG44_glow"].is_effect)
        self.assertFalse(self.by_name["em_MuzzSG44"].is_body)

    def test_a_tracer_is_a_preview_not_a_part(self) -> None:
        tracer = self.by_name["Bar1918 tracer"]
        self.assertTrue(tracer.is_preview)
        self.assertFalse(tracer.is_body)

    def test_a_projectile_mesh_is_a_preview_too(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("bomb", [box(1.5)])
        parts = scene([Node(name="BF109BombRack projectile", mesh=mesh,
                            extras={"templateKind": "Projectile",
                                    "projectileMesh": {"template": "FighterBomb",
                                                       "geometry": "Big_Bomb_M1"}})],
                      builder)
        self.assertTrue(parts[0].is_preview)

    def test_the_weapon_body_is_the_only_body_part(self) -> None:
        self.assertEqual(["Bar1918Complex"],
                         [p.name for p in verify.body_parts(self.parts)])

    def test_a_renamed_emitter_is_still_an_emitter(self) -> None:
        # The classification must not depend on the `em_` prefix: mods spell
        # their emitters however they like.
        builder = GlbBuilder()
        mesh = builder.add_mesh("x", [box(3.0)])
        parts = scene([Node(name="TotallyNormalPart", mesh=mesh,
                            extras={"templateKind": "SpriteParticle",
                                    "effect": {"kind": "sprite"}})], builder)
        self.assertTrue(parts[0].is_effect)


# ----------------------------------------------------- 2. measuring the model

class BodyLengthTests(unittest.TestCase):

    def test_a_weapon_measures_its_own_length_not_its_muzzle_flash(self) -> None:
        parts = weapon_with_effects(GlbBuilder())
        self.assertAlmostEqual(1.19, verify.body_length(parts), places=3)

    def test_the_old_whole_file_box_is_what_it_is_not(self) -> None:
        # The same scene measured over everything is the 2.02 m the rebuild
        # reported for the Bar1918 against 1.194 m real -- 68.8% off, and a
        # broken verdict.
        parts = weapon_with_effects(GlbBuilder())
        points = [v for p in parts for tri in p.triangles for v in tri]
        whole = max(max(v[i] for v in points) - min(v[i] for v in points)
                    for i in range(3))
        self.assertAlmostEqual(2.02, whole, places=3)

    def test_the_length_check_passes_on_the_bodys_measurement(self) -> None:
        parts = weapon_with_effects(GlbBuilder())
        check = verify.dimension_check("Bar1918", verify.body_length(parts))
        self.assertIsNotNone(check)
        self.assertTrue(check.ok())

    def test_a_genuinely_doubled_model_still_fails(self) -> None:
        check = verify.dimension_check("Bar1918", 1.194 * 2)
        self.assertFalse(check.ok())

    def test_collision_hulls_never_count_towards_the_size(self) -> None:
        builder = GlbBuilder()
        body = builder.add_mesh("body", [box(1.0)])
        hull = builder.add_mesh("hull", [box(4.0)])
        parts = scene([
            Node(name="Body", mesh=body, extras={"templateKind": "SimpleObject"}),
            Node(name="Body collision 1", mesh=hull, extras={"collision": True}),
        ], builder)
        self.assertAlmostEqual(1.0, verify.body_length(parts), places=3)


# --------------------------------------------------------- 3. skinned soldiers

class SkinnedSoldierTests(unittest.TestCase):
    """Body, head and two hands, all authored in bind space and all resting on
    the origin. This is every soldier in the game and it was 19 of the vanilla
    rebuild's 42 broken verdicts."""

    def soldier(self) -> list[verify.Part]:
        builder = GlbBuilder()
        parts = []
        for name, geometry, size in (
                ("GerSoldier3PBody", "Soldier/3PGerBody", 1.63),
                ("GerSoldierComplexHead1", "Soldier/GerComplexHead1", 0.30),
                ("GerSoldierRightHand", "Soldier/GerRightHand", 0.22),
                ("GerSoldierLeftHand", "Soldier/GerLeftHand", 0.15)):
            mesh = builder.add_mesh(name, [box(size)])
            parts.append(Node(name=name, mesh=mesh, extras={
                "templateKind": "SimpleObject", "geometry": geometry,
                "skin": f"animations/{name}.skn"}))
        return scene(parts, builder)

    def test_a_skinned_part_is_recognised(self) -> None:
        for part in self.soldier():
            self.assertTrue(part.is_skinned, part.name)

    def test_four_skinned_parts_on_the_origin_are_not_a_pile(self) -> None:
        self.assertEqual([], verify.origin_pile(self.soldier()))

    def test_the_soldier_comes_out_clean(self) -> None:
        triage = verify.triage_report("GermanSoldier", {}, parts=self.soldier())
        self.assertEqual("clean", triage.status)

    def test_the_node_that_carries_the_skeleton_counts_as_skinned_too(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("head", [box(0.3)])
        parts = scene([Node(name="Head", mesh=mesh,
                            extras={"skeleton": "animations/UsFace.ske"})],
                      builder)
        self.assertTrue(parts[0].is_skinned)


# --------------------------------------------------- 4. a mesh never shipped

class AbsentBaseGameMeshTests(unittest.TestCase):

    def test_bodycollision_is_recorded_as_a_fact_not_a_hole(self) -> None:
        triage = verify.triage_report(
            "GermanSoldier", {"missingMeshFiles": ["bodycollision_m1"]})
        self.assertEqual("clean", triage.status)
        self.assertEqual(["info"], [f.severity for f in triage.findings])

    def test_it_holds_for_a_mod_chain_too(self) -> None:
        # Every installed mod inherits `Mods/bf1942`, so a file the base game
        # never shipped is absent there as well -- 19 EoD soldiers and two
        # each in Road to Rome and Secret Weapons.
        triage = verify.triage_report(
            "NVASoldier", {"missingMeshFiles": ["bodycollision_m1"]},
            vanilla_facts=False)
        self.assertEqual("clean", triage.status)

    def test_any_other_missing_mesh_is_still_broken(self) -> None:
        triage = verify.triage_report(
            "Foo", {"missingMeshFiles": ["sherman_hull_m1"]})
        self.assertEqual("broken", triage.status)


# -------------------------------------- 5. sub-parts modelled in parent space

class HullSpacePartTests(unittest.TestCase):
    """A `.con` gives a sub-part no `setPosition` when the mesh already sits
    where it belongs. EoD's LCT-Mk6 has five such parts and their geometry is
    up to 17 m from the origin of a 35 m craft. Nothing is collapsed."""

    def landing_craft(self) -> list[verify.Part]:
        builder = GlbBuilder()
        nodes = []
        for name, size, centre in (
                ("Hull", 35.0, (0, 0, 0)),
                ("Port", 2.0, (0, 3.6, 6.7)),
                ("Starboard", 2.0, (0, 3.1, 5.4)),
                ("SternRamp", 2.0, (0, 1.7, 17.3)),
                ("Walkway", 2.0, (0, 3.0, 13.5))):
            mesh = builder.add_mesh(name, [box(size, centre)])
            nodes.append(Node(name=name, mesh=mesh,
                              extras={"templateKind": "SimpleObject",
                                      "geometry": name}))
        return scene(nodes, builder)

    def test_geometry_metres_from_the_origin_is_not_collapsed(self) -> None:
        parts = self.landing_craft()
        self.assertEqual([], verify.origin_pile(
            parts, model_size=verify.body_length(parts)))

    def test_without_a_model_size_the_old_reading_still_flags_them(self) -> None:
        # The node translation alone says all five are at the origin, which is
        # exactly the reading that produced the false alarm.
        self.assertEqual(5, len(verify.origin_pile(self.landing_craft())))

    def test_sub_parts_whose_geometry_is_on_the_origin_do_still_flag(self) -> None:
        # The failure mode itself: a placement lost, so each sub-part's own
        # geometry lands on the model origin.
        builder = GlbBuilder()
        nodes = [Node(name="Body", mesh=builder.add_mesh("body", [box(1.1)]),
                      extras={"templateKind": "AnimatedBundle"})]
        for name in ("Trigger", "Mag", "Bolt", "Clip"):
            mesh = builder.add_mesh(name, [box(0.02)])
            nodes.append(Node(name=name, mesh=mesh,
                              extras={"templateKind": "SimpleObject"}))
        parts = scene(nodes, builder)
        pile = verify.origin_pile(parts, model_size=verify.body_length(parts))
        self.assertEqual({"Body", "Trigger", "Mag", "Bolt", "Clip"}, set(pile))

    def test_a_bind_the_report_already_explains_is_not_counted_twice(self) -> None:
        builder = GlbBuilder()
        nodes = [Node(name="Body", mesh=builder.add_mesh("body", [box(1.1)]),
                      extras={"templateKind": "AnimatedBundle"})]
        for name in ("No4Block", "No4Mag"):
            nodes.append(Node(name=name,
                              mesh=builder.add_mesh(name, [box(0.02)]),
                              extras={"templateKind": "SimpleObject"}))
        parts = scene(nodes, builder)
        report = {"boundParts": ["No4Trigger -> Trigger (relative to BaseK98)",
                                 "No4Block -> Block (no such bone)",
                                 "No4Mag -> Mag (no such bone)"]}
        self.assertEqual(
            [], verify.origin_pile(parts,
                                   explained=verify.unplaced_part_names(report),
                                   model_size=verify.body_length(parts)))


# ------------------------------------------------- 6. what a shadow mesh is

class ShadowPremiseTests(unittest.TestCase):
    """The silhouette check only means anything against a low-poly stand-in.
    Vanilla's JohnsonLMG points its Simple alternative at the weapon's own
    1,183-triangle body (against a 1,520-triangle model) and Secret Weapons'
    Gewehr43_zf4 at 1,285 of 1,555 -- comparing a weapon to itself measures
    the trigger-guard hole, which is how the G43's trigger, bolt and clip all
    read 85-90% outside on a perfectly good model."""

    def test_a_real_shadow_is_a_small_fraction_of_the_model(self) -> None:
        # The fattest genuine shadow measured across the four installed
        # catalogues is the medkit's wrench at 0.18; the K98's is 0.05.
        for ratio in (0.05, 0.18):
            self.assertLess(ratio, verify.SHADOW_TRIANGLE_RATIO)

    def test_the_two_impostors_are_above_the_gate(self) -> None:
        for ratio in (1183 / 1520, 1285 / 1555):
            self.assertGreater(ratio, verify.SHADOW_TRIANGLE_RATIO)


# ------------------------------------- 7. severity that matches the failure

class SeverityTests(unittest.TestCase):

    def test_one_weapon_outside_its_shadow_is_a_degradation(self) -> None:
        high = verify.SilhouetteResult(aggregate=0.38, per_part={})
        self.assertEqual("degraded",
                         verify.triage_report("K98Bayonet", None,
                                              silhouette=high).status)

    def test_a_catalogue_that_reads_high_is_broken(self) -> None:
        high = verify.SilhouetteResult(aggregate=0.38, per_part={})
        self.assertEqual("broken",
                         verify.triage_report("K98Bayonet", None, silhouette=high,
                                              silhouette_fatal=True).status)

    def test_a_missing_bone_beside_binds_that_worked_is_the_games_data(self) -> None:
        report = {"boundParts": ["No4Trigger -> Trigger (relative to BaseK98)",
                                 "No4Load -> Load (relative to BaseK98)",
                                 "No4Block -> Block (no such bone)"]}
        triage = verify.triage_report("M40", report)
        self.assertEqual("degraded", triage.status)

    def test_a_missing_bone_with_no_bind_working_at_all_is_broken(self) -> None:
        report = {"boundParts": ["FooMag -> mag (no such bone)"]}
        self.assertEqual("broken", verify.triage_report("Foo", report).status)

    def test_an_asset_only_a_projectile_wanted_leaves_the_model_whole(self) -> None:
        triage = verify.triage_report(
            "BF109", {"missingGeometryTemplates": ["Big_Bomb_M1"]},
            missing_asset_roles={"big_bomb_m1": "projectile"})
        self.assertEqual("degraded", triage.status)

    def test_an_asset_a_drawn_part_wanted_is_broken(self) -> None:
        triage = verify.triage_report(
            "Ilyushin", {"missingGeometryTemplates": ["Big_Bomb_M1"]},
            missing_asset_roles={"big_bomb_m1": "part"})
        self.assertEqual("broken", triage.status)

    def test_an_unclassified_asset_keeps_the_strict_verdict(self) -> None:
        # No archives, so nothing is known about what wanted it.
        triage = verify.triage_report(
            "Cammo_Raft", {"missingGeometryTemplates": ["CammoRaft_Motor_M1"]})
        self.assertEqual("broken", triage.status)


if __name__ == "__main__":
    unittest.main()
