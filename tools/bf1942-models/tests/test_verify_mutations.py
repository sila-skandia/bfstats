"""Break real models on purpose and check the verifier notices.

The other two verify suites prove the checks compute what they claim and that
the false alarms are gone. This one exists for the opposite failure: a verifier
that has quietly stopped being able to say broken is exactly as useless as one
that always says it, and passing everything is how it looks from the outside.

So every case here takes a `.glb` the pipeline really produced, reproduces one
of the failure modes the pipeline has really had in its own bytes (see
`glb_mutate`), and asserts the verdict. The two viewmodels are tracked in the
repo, so those cases run everywhere. The rest work on the shared extraction
tree when it is present -- they are the same mutations over the models the
checks were tuned against (a Sherman, a Bar1918, a soldier), and they are the
cases quoted in `features/bf1942-3d-models/verifier-truth.md`.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import glb_mutate as gm  # noqa: E402
from bf42 import verify  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
VIEWMODELS = ROOT / "viewer" / "models" / "viewmodels"
THOMPSON = VIEWMODELS / "USSoldier__Thompson.fp.glb"
MP40 = VIEWMODELS / "GermanSoldier__MP40.fp.glb"
#: The shared extraction tree, which lives once in the main checkout and is
#: gitignored -- present on a developer machine, absent in CI, and reachable
#: from a worktree either through `link_viewer_assets.sh` or by pointing
#: `BF1942_MODELS` at the checkout that holds it.
CATALOGUE = Path(os.environ.get("BF1942_MODELS") or (ROOT / "viewer" / "models"))


def parts_of(path: Path) -> list[verify.Part]:
    doc, blob = verify.read_glb(path)
    return verify.scene_parts(doc, blob)


def broken_findings(triage: verify.Triage) -> list[str]:
    return [f.message for f in triage.findings if f.severity == "broken"]


class MutationHelperTests(unittest.TestCase):
    """The harness has to be trustworthy before the verdicts mean anything."""

    def test_a_round_trip_changes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            copy = gm.mutate(THOMPSON, Path(tmp) / "same.glb")
            self.assertEqual(
                [(p.name, len(p.triangles), p.world_translation)
                 for p in parts_of(THOMPSON)],
                [(p.name, len(p.triangles), p.world_translation)
                 for p in parts_of(copy)])

    def test_the_binary_chunk_is_copied_through(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            copy = gm.mutate(THOMPSON, Path(tmp) / "same.glb",
                             gm.scale_root(2.0))
            self.assertEqual(gm.read(THOMPSON)[1], gm.read(copy)[1])


class TrackedViewmodelTests(unittest.TestCase):
    """The two `.fp.glb` fixtures the repo tracks: a real soldier's arms, a
    real weapon, real bind offsets, real bytes."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_the_pristine_fixture_has_nothing_broken(self) -> None:
        for source in (THOMPSON, MP40):
            triage = verify.triage_report(source.stem, {}, parts=parts_of(source))
            self.assertEqual([], broken_findings(triage), source.name)

    def test_collapsing_the_whole_rig_onto_the_origin_is_a_pile(self) -> None:
        # Every placement lost -- bind offsets, skeleton and all -- which is
        # the shape the `bindToSkeletonPart` failure had when it hit a weapon:
        # the receiver, the magazine and the bolt handle all on one point.
        parts = parts_of(gm.mutate(
            THOMPSON, self.dir / "collapsed.glb",
            gm.collapse_translations(), gm.unbind(),
            gm.strip_extras("skeleton")))
        pile = verify.origin_pile(parts, model_size=verify.body_length(parts))
        self.assertEqual({"ThompsonComplex", "ThompsonMagasin", "ThompsonFlerp"},
                         set(pile))
        self.assertEqual("broken",
                         verify.triage_report("Thompson", {}, parts=parts).status)

    def test_two_parts_on_one_point_stay_inside_the_allowance(self) -> None:
        # Why the case above has to lose the skeleton as well, and the limit of
        # the placement check: the propeller-static/propeller-blurred pattern
        # puts two parts on one point on 42 of the 285 EoD models, so two is
        # allowed, and a weapon with only two loose sub-parts collapses under
        # the gate. `unstamped_binds` is what covers that.
        parts = parts_of(gm.mutate(THOMPSON, self.dir / "two.glb",
                                   gm.collapse_translations(), gm.unbind()))
        self.assertEqual([], verify.origin_pile(
            parts, model_size=verify.body_length(parts)))

    def test_a_bind_the_report_recorded_and_the_file_lost_is_broken(self) -> None:
        # The half of the collapse the placement check cannot see on its own:
        # strip the binds and the silhouette check has nothing left to measure
        # while the pile stays inside the allowance.
        report = {"boundParts": ["ThompsonMagasin -> magasin (relative to base)",
                                 "ThompsonFlerp -> flerp (relative to base)"]}
        pristine = verify.triage_report("Thompson", report, parts=parts_of(THOMPSON))
        self.assertEqual([], broken_findings(pristine))

        parts = parts_of(gm.mutate(THOMPSON, self.dir / "unbound.glb", gm.unbind()))
        triage = verify.triage_report("Thompson", report, parts=parts)
        self.assertEqual("broken", triage.status)
        self.assertTrue(any("carry no bind in the file" in m
                            for m in broken_findings(triage)),
                        broken_findings(triage))

    def test_a_skinned_bind_carries_no_offset_and_is_not_a_loss(self) -> None:
        # Every soldier's head is bound to `Bip01_Spine3` through its skin, so
        # the assembler records the bind and stamps no bone. Reading that as a
        # lost bind would put all 32 soldiers back in the broken column.
        report = {"boundParts":
                  ["ThompsonMagasin -> magasin (skinned, bind pose is identity)"]}
        parts = parts_of(gm.mutate(THOMPSON, self.dir / "unbound.glb", gm.unbind()))
        self.assertEqual([], verify.unstamped_binds(parts, report))

    def test_a_part_dropped_from_the_file_is_broken(self) -> None:
        pristine = parts_of(THOMPSON)
        body = verify.body_parts(pristine)
        report = {"parts": len(body),
                  "triangles": sum(len(p.triangles) for p in body)}
        self.assertEqual(
            "clean",
            verify.triage_report("Thompson", report, parts=pristine).status)

        parts = parts_of(gm.mutate(THOMPSON, self.dir / "dropped.glb",
                                   gm.drop_node("ThompsonMagasin")))
        triage = verify.triage_report(
            "Thompson", report, parts=parts,
            inventory=verify.inventory_check(parts, report))
        self.assertEqual("broken", triage.status)
        self.assertTrue(any("the exporter's own report counted" in m
                            for m in broken_findings(triage)),
                        broken_findings(triage))

    def test_a_tripled_model_measures_three_times_as_long(self) -> None:
        pristine = verify.body_length(parts_of(THOMPSON))
        parts = parts_of(gm.mutate(THOMPSON, self.dir / "big.glb",
                                   gm.scale_root(3.0)))
        self.assertAlmostEqual(pristine * 3, verify.body_length(parts), places=4)
        check = verify.dimension_check("X", verify.body_length(parts),
                                       known={"X": pristine})
        self.assertFalse(check.ok())

    def test_mirroring_moves_the_bound_parts_and_nothing_else(self) -> None:
        doc, _ = gm.read(THOMPSON)
        bound = gm.bound_part_names(doc)
        self.assertEqual({"ThompsonMagasin", "ThompsonFlerp"}, bound)
        before = {p.name: p.world_translation for p in parts_of(THOMPSON)}
        after = {p.name: p.world_translation for p in parts_of(
            gm.mutate(THOMPSON, self.dir / "mirrored.glb", gm.mirror_z(bound)))}
        for name, position in before.items():
            if name in bound:
                self.assertNotEqual(position, after[name], name)
            else:
                self.assertEqual(position, after[name], name)


@unittest.skipUnless((CATALOGUE / "models.json").is_file(),
                     "the shared extraction tree is not present")
class SharedCatalogueMutationTests(unittest.TestCase):
    """The same mutations over the models the checks were tuned against.

    Skipped where `viewer/models` has not been extracted. These are the cases
    recorded in the feature doc, so they are worth being able to re-run.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.entries = {e["name"]: e for e in
                        json.loads((CATALOGUE / "models.json").read_text())}

    def model(self, name: str) -> tuple[Path, dict]:
        entry = self.entries[name]
        report_path = CATALOGUE / (entry["glb"][:-4] + ".report.json")
        report = json.loads(report_path.read_text()) if report_path.is_file() else {}
        return CATALOGUE / entry["glb"], report

    def verdict(self, name: str, *changes) -> verify.Triage:
        source, report = self.model(name)
        parts = parts_of(gm.mutate(source, self.dir / f"{name}.glb", *changes))
        return verify.triage_report(
            name, report, parts=parts,
            stats=verify.geometry_stats(parts),
            dimensions=verify.dimension_check(
                name, verify.body_length(parts),
                category=self.entries[name].get("category")),
            inventory=verify.inventory_check(parts, report))

    def test_a_sherman_collapsed_onto_its_hull_is_broken(self) -> None:
        # W3-E's case: 27 parts onto the hull's own running-gear mount, well
        # away from (0, 0, 0).
        triage = self.verdict("Sherman", gm.collapse_translations())
        self.assertEqual("broken", triage.status)
        self.assertTrue(any("piled on the origin" in m
                            for m in broken_findings(triage)))

    def test_a_sherman_without_its_turret_is_broken(self) -> None:
        triage = self.verdict("Sherman", gm.drop_node("ShermanTower"))
        self.assertEqual("broken", triage.status)
        self.assertTrue(any("report counted" in m for m in broken_findings(triage)))

    def test_a_bar1918_three_times_too_long_is_broken(self) -> None:
        triage = self.verdict("Bar1918", gm.scale_root(3.0))
        self.assertEqual("broken", triage.status)
        self.assertTrue(any("1.194 m real" in m for m in broken_findings(triage)))

    def test_a_bar1918_at_its_own_size_is_not(self) -> None:
        triage = self.verdict("Bar1918")
        self.assertEqual([], broken_findings(triage))

    def test_a_soldier_that_lost_its_skeleton_is_broken(self) -> None:
        triage = self.verdict("BritishSoldier", gm.strip_extras("skeleton"))
        self.assertEqual("broken", triage.status)
        self.assertTrue(any("no skeleton in scope" in m
                            for m in broken_findings(triage)))

    def test_the_same_soldier_untouched_is_clean(self) -> None:
        triage = self.verdict("BritishSoldier")
        self.assertEqual([], broken_findings(triage))

    def test_a_bar1918_whose_binds_were_lost_is_broken(self) -> None:
        triage = self.verdict("Bar1918", gm.unbind())
        self.assertEqual("broken", triage.status)
        self.assertTrue(any("carry no bind in the file" in m
                            for m in broken_findings(triage)))


if __name__ == "__main__":
    unittest.main()
