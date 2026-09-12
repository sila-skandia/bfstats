from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import con as con_mod  # noqa: E402
from bf42 import verify  # noqa: E402
from bf42.gltf import GlbBuilder, Node, Primitive  # noqa: E402
from verify_models import find_shadow_geometry  # noqa: E402


def quad(size: float = 1.0, x: float = 0.0) -> Primitive:
    """Two triangles filling a square in the Y-Z plane, centred on the origin.

    The exporter mirrors Z on the way out, so a symmetric footprint keeps the
    tests readable: what goes in is what comes out.
    """
    s = size
    return Primitive(
        positions=[(x, -s, -s), (x, -s, s), (x, s, s), (x, s, -s)],
        indices=[0, 1, 2, 0, 2, 3],
    )


def write_glb(builder: GlbBuilder, roots: list[int]) -> Path:
    path = Path(tempfile.mkdtemp()) / "model.glb"
    path.write_bytes(builder.build(roots))
    return path


def build_scene(nodes: list[Node], builder: GlbBuilder) -> Path:
    indices = [builder.add_node(node) for node in nodes]
    root = builder.add_node(Node(name="Root", children=indices))
    return write_glb(builder, [root])


class ReadGlbTests(unittest.TestCase):
    def test_reads_back_what_the_builder_wrote(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("part", [quad()])
        path = build_scene([Node(name="Part", mesh=mesh,
                                 extras={"boundBone": "mag"})], builder)

        doc, blob = verify.read_glb(path)
        parts = verify.scene_parts(doc, blob)

        self.assertEqual(1, len(parts))
        self.assertEqual("Part", parts[0].name)
        self.assertEqual("mag", parts[0].bound_bone)
        self.assertEqual(2, len(parts[0].triangles))

    def test_rejects_a_file_that_is_not_a_glb(self) -> None:
        path = Path(tempfile.mkdtemp()) / "nope.glb"
        path.write_bytes(b"not a glb at all")
        with self.assertRaises(verify.VerifyError):
            verify.read_glb(path)

    def test_world_transform_moves_the_triangles(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("part", [quad()])
        path = build_scene(
            [Node(name="Part", mesh=mesh, translation=(5.0, 0.0, 0.0))], builder)

        doc, blob = verify.read_glb(path)
        parts = verify.scene_parts(doc, blob)

        xs = [p[0] for tri in parts[0].triangles for p in tri]
        self.assertTrue(all(abs(x - 5.0) < 1e-6 for x in xs))
        self.assertEqual((5.0, 0.0, 0.0), parts[0].world_translation)


class GeometryStatsTests(unittest.TestCase):
    def test_counts_zero_area_triangles(self) -> None:
        degenerate = Primitive(
            positions=[(0, 0, 0), (1, 0, 0), (2, 0, 0)],  # collinear
            indices=[0, 1, 2],
        )
        builder = GlbBuilder()
        mesh = builder.add_mesh("part", [quad(), degenerate])
        path = build_scene([Node(name="Part", mesh=mesh)], builder)

        doc, blob = verify.read_glb(path)
        stats = verify.geometry_stats(verify.scene_parts(doc, blob))

        self.assertEqual(3, stats.triangles)
        self.assertEqual(1, stats.zero_area)

    def test_collision_nodes_are_not_counted(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("hit", [quad()])
        path = build_scene(
            [Node(name="Hull collision 0", mesh=mesh,
                  extras={"collision": True})], builder)

        doc, blob = verify.read_glb(path)
        stats = verify.geometry_stats(verify.scene_parts(doc, blob))

        self.assertEqual(0, stats.triangles)


class OriginPileTests(unittest.TestCase):
    def _parts(self, spec: list[tuple[str, tuple, str | None]]) -> list[verify.Part]:
        return [
            verify.Part(name=name, world_translation=at,
                        extras={"boundBone": bone} if bone else {},
                        triangles=[((0, 0, 0), (1, 0, 0), (0, 1, 0))])
            for name, at, bone in spec
        ]

    def test_a_soldier_body_and_head_stack_is_allowed(self) -> None:
        parts = self._parts([
            ("Body", (0, 0, 0), None),
            ("Head", (0, 0, 0), None),
        ])
        self.assertEqual([], verify.origin_pile(parts))

    def test_bound_parts_resting_on_the_origin_are_vouched_for(self) -> None:
        # The Type99's mag and bolt bones genuinely rest on its base bone.
        parts = self._parts([
            ("Type99Complex", (0, 0, 0), None),
            ("Type99Mag", (0, 0, 0), "Type99Mag"),
            ("Type99Reload", (0, 0, 0), "Type99Reload"),
        ])
        self.assertEqual([], verify.origin_pile(parts))

    def test_an_unbound_pile_is_the_collapse_signature(self) -> None:
        # bindToSkeletonPart unparsed: no boundBone extras, everything at zero.
        parts = self._parts([
            ("ColtComplex", (0, 0, 0), None),
            ("ColtTrigger", (0, 0, 0), None),
            ("ColtMantel", (0, 0, 0), None),
            ("Gunmag", (0, 0, 0), None),
        ])
        self.assertEqual(4, len(verify.origin_pile(parts)))

    def test_parts_placed_away_from_the_origin_do_not_count(self) -> None:
        parts = self._parts([
            ("Hull", (0, 0, 0), None),
            ("Turret", (0, 1.2, 0), None),
            ("Barrel", (0, 1.2, 2.0), None),
            ("Wheel", (1, 0, 0), None),
        ])
        self.assertEqual([], verify.origin_pile(parts))


class UnplacedBoundPartTests(unittest.TestCase):
    def test_splits_missing_bones_from_missing_skeletons(self) -> None:
        report = {"boundParts": [
            "K98Trigger -> Trigger (relative to BaseK98)",
            "FooMag -> mag (no such bone)",
            "GrenadeAlliesSprint -> sprint (no skeleton in scope)",
        ]}
        no_bone, no_skeleton = verify.unplaced_bound_parts(report)
        self.assertEqual(1, len(no_bone))
        self.assertIn("FooMag", no_bone[0])
        self.assertEqual(1, len(no_skeleton))
        self.assertIn("GrenadeAlliesSprint", no_skeleton[0])


def square_triangles(cy: float, cz: float, half: float) -> list[verify.Triangle]:
    """A filled square in the Z-Y plane at x=0, as two world-space triangles."""
    lo_y, hi_y = cy - half, cy + half
    lo_z, hi_z = cz - half, cz + half
    return [
        ((0, lo_y, lo_z), (0, lo_y, hi_z), (0, hi_y, hi_z)),
        ((0, lo_y, lo_z), (0, hi_y, hi_z), (0, hi_y, lo_z)),
    ]


class SilhouetteTests(unittest.TestCase):
    def test_a_part_inside_the_shadow_measures_zero(self) -> None:
        shadow = square_triangles(0.0, 0.0, 1.0)
        result = verify.silhouette_outside(
            {"mag": square_triangles(0.0, 0.0, 0.3)}, shadow, resolution=128)
        self.assertAlmostEqual(0.0, result.aggregate, places=3)

    def test_a_part_clear_of_the_shadow_measures_one(self) -> None:
        shadow = square_triangles(0.0, 0.0, 1.0)
        result = verify.silhouette_outside(
            {"mag": square_triangles(5.0, 0.0, 0.3)}, shadow, resolution=128)
        self.assertGreater(result.aggregate, 0.95)

    def test_a_part_straddling_the_edge_measures_its_overhang(self) -> None:
        shadow = square_triangles(0.0, 0.0, 1.0)
        # Square spanning y 0.5..1.5 against a shadow ending at 1.0.
        result = verify.silhouette_outside(
            {"bolt": square_triangles(1.0, 0.0, 0.5)}, shadow, resolution=256)
        self.assertAlmostEqual(0.5, result.aggregate, delta=0.05)

    def test_the_aggregate_weights_parts_by_area(self) -> None:
        shadow = square_triangles(0.0, 0.0, 1.0)
        result = verify.silhouette_outside({
            "big_inside": square_triangles(0.0, 0.0, 0.9),
            "small_outside": square_triangles(5.0, 0.0, 0.1),
        }, shadow, resolution=256)
        # The small stray part is ~1% of the area, so the aggregate stays low
        # while its own figure reads fully outside.
        self.assertLess(result.aggregate, 0.05)
        self.assertGreater(result.per_part["small_outside"], 0.9)

    def test_no_shadow_or_no_parts_is_not_a_measurement(self) -> None:
        shadow = square_triangles(0.0, 0.0, 1.0)
        self.assertIsNone(verify.silhouette_outside({}, shadow))
        self.assertIsNone(verify.silhouette_outside(
            {"mag": square_triangles(0, 0, 1)}, []))


class DimensionTests(unittest.TestCase):
    def test_a_known_length_within_tolerance_passes(self) -> None:
        check = verify.dimension_check("K98", 1.131, {"K98": 1.11})
        self.assertTrue(check.ok())
        self.assertAlmostEqual(0.019, check.deviation, places=3)

    def test_a_doubled_length_fails(self) -> None:
        check = verify.dimension_check("K98", 2.2, {"K98": 1.11})
        self.assertFalse(check.ok())

    def test_an_unknown_name_is_not_checked(self) -> None:
        self.assertIsNone(verify.dimension_check("Wobbler", 1.0, {"K98": 1.11}))
        self.assertIsNone(verify.dimension_check("K98", None, {"K98": 1.11}))


class TriageTests(unittest.TestCase):
    def test_nothing_wrong_is_clean(self) -> None:
        triage = verify.triage_report("Sherman", {"texturesNotFound": []})
        self.assertEqual("clean", triage.status)

    def test_missing_mesh_files_are_broken(self) -> None:
        triage = verify.triage_report(
            "Foo", {"missingMeshFiles": ["Foo_Hull_M1"]})
        self.assertEqual("broken", triage.status)

    def test_unresolved_textures_are_degraded(self) -> None:
        triage = verify.triage_report(
            "Foo", {"texturesNotFound": ["texture/foo_c"]})
        self.assertEqual("degraded", triage.status)

    def test_never_shipped_vanilla_textures_are_recorded_not_penalised(self) -> None:
        triage = verify.triage_report(
            "Sherman", {"texturesNotFound": ["texture/sherW2_f"]})
        self.assertEqual("clean", triage.status)
        # ...unless the extraction is not vanilla, where the fact list is void.
        triage = verify.triage_report(
            "Sherman", {"texturesNotFound": ["texture/sherW2_f"]},
            vanilla_facts=False)
        self.assertEqual("degraded", triage.status)

    def test_authored_shaderless_materials_are_recorded_not_penalised(self) -> None:
        triage = verify.triage_report(
            "Thompson", {"materialsWithoutShader": ["Thompson_m1_Material0"]})
        self.assertEqual("clean", triage.status)
        triage = verify.triage_report(
            "Mp40", {"materialsWithoutShader": ["Mp40_Material9"]})
        self.assertEqual("degraded", triage.status)

    def test_silhouette_thresholds(self) -> None:
        ok = verify.SilhouetteResult(aggregate=0.05, per_part={})
        warn = verify.SilhouetteResult(aggregate=0.08, per_part={})
        fail = verify.SilhouetteResult(aggregate=0.30, per_part={})
        self.assertEqual("clean", verify.triage_report("K98", None, silhouette=ok).status)
        self.assertEqual("degraded", verify.triage_report("K98", None, silhouette=warn).status)
        self.assertEqual("broken", verify.triage_report("K98", None, silhouette=fail).status)

    def test_authored_silhouette_ceilings_apply_to_vanilla_only(self) -> None:
        # The Type5 measures 58.8% against the K98 shadow vanilla lends it.
        measured = verify.SilhouetteResult(aggregate=0.588, per_part={})
        self.assertEqual(
            "clean",
            verify.triage_report("Type5", None, silhouette=measured).status)
        self.assertEqual(
            "broken",
            verify.triage_report("Type5", None, silhouette=measured,
                                 vanilla_facts=False).status)
        past_ceiling = verify.SilhouetteResult(aggregate=0.80, per_part={})
        self.assertEqual(
            "broken",
            verify.triage_report("Type5", None, silhouette=past_ceiling).status)

    def test_an_explained_origin_pile_is_degraded_an_unexplained_one_broken(self) -> None:
        pile = [
            verify.Part(name=f"P{i}", world_translation=(0, 0, 0),
                        triangles=[((0, 0, 0), (1, 0, 0), (0, 1, 0))])
            for i in range(3)
        ]
        explained = verify.triage_report(
            "GrenadeAllies",
            {"skeletonsNotRead": ["animations/GrenadeAllies.ske"]},
            parts=pile)
        self.assertEqual("degraded", explained.status)
        unexplained = verify.triage_report("GrenadeAllies", {}, parts=pile)
        self.assertEqual("broken", unexplained.status)

    def test_a_bound_part_with_no_bone_is_broken(self) -> None:
        triage = verify.triage_report(
            "Foo", {"boundParts": ["FooMag -> mag (no such bone)"]})
        self.assertEqual("broken", triage.status)

    def test_a_wrong_dimension_is_broken(self) -> None:
        bad = verify.DimensionCheck(expected=1.11, measured=2.3)
        triage = verify.triage_report("K98", None, dimensions=bad)
        self.assertEqual("broken", triage.status)

    def test_an_empty_scene_is_broken(self) -> None:
        triage = verify.triage_report("Foo", None, parts=[])
        self.assertEqual("broken", triage.status)


class ShadowGeometryTests(unittest.TestCase):
    def test_the_simple_alternative_is_the_shadow(self) -> None:
        library = con_mod.ObjectLibrary()
        library.add_con("Objects/HandWeapons/Foo/Objects.con", "\n".join([
            "ObjectTemplate.create HandFireArms Foo",
            "ObjectTemplate.addTemplate FooLod",
            "ObjectTemplate.create SimpleObject FooSimple",
            "ObjectTemplate.geometry Shad_Foo",
            "ObjectTemplate.create AnimatedBundle FooComplex",
            "ObjectTemplate.geometry Foo",
            "ObjectTemplate.create LodObject FooLod",
            "ObjectTemplate.lodselector HandWeaponLodSelector",
            "ObjectTemplate.addTemplate FooComplex",
            "ObjectTemplate.addTemplate FooSimple",
        ]))
        self.assertEqual("Shad_Foo", find_shadow_geometry(library, "Foo"))

    def test_a_weapon_without_a_simple_alternative_has_no_shadow(self) -> None:
        library = con_mod.ObjectLibrary()
        library.add_con("Objects/HandWeapons/Bar/Objects.con", "\n".join([
            "ObjectTemplate.create HandFireArms Bar",
            "ObjectTemplate.addTemplate BarComplex",
            "ObjectTemplate.create AnimatedBundle BarComplex",
            "ObjectTemplate.geometry Bar",
        ]))
        self.assertIsNone(find_shadow_geometry(library, "Bar"))


if __name__ == "__main__":
    unittest.main()
