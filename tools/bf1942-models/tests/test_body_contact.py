"""`viewer/body-contact.js`: contact finding and impulse response for rigid
bodies — `features/bf1942-engine-reference/subsystems/collision-response.md`
§5.2, §5.3, §5.5 and §6 (`collision-response.md` below; section numbers are
its numbers).

`body-contact.js` imports nothing, so — like `test_armor.py` running
`armor.js` — this copies the module plus its harness into a temp dir and
runs `node harness.mjs`. Every number asserted here was hand-derived from the
spec in `body_contact_harness.mjs`'s own comments before this file was
written, not read back from the module's output; see that file for the
derivations (`S`/`E`/`e`/`s`/`t`, the mass shares, the "quarter of the
share" velocity change).
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

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "body-contact.js"
HARNESS = Path(__file__).resolve().parent / "body_contact_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "body-contact.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                               capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BodyContactTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def assertVec(self, actual, expected, places=4, msg=None) -> None:
        self.assertEqual(len(actual), len(expected), msg)
        for a, e in zip(actual, expected):
            self.assertAlmostEqual(a, e, places=places, msg=msg)

    # --- setAdjust (collision-response.md §6.3, C3/V0) ----------------------

    def test_set_adjust_truth_table(self) -> None:
        r = self.results["setAdjust"]
        # empty accumulator always takes the candidate, any sign.
        self.assertEqual(5, r["empty"])
        self.assertEqual(-3, r["emptyNegative"])
        self.assertEqual(0, r["emptyZero"])
        # same sign (both positive): keep the LARGER magnitude, not the sum.
        self.assertEqual(5, r["positivePositiveKeepsLarger"])
        self.assertEqual(5, r["positivePositiveKeepsLargerReversed"])
        # opposite signs (or zero candidate): add.
        self.assertEqual(3, r["positiveNegativeAdds"])
        self.assertEqual(5, r["positiveZeroAdds"])
        # same sign (both negative): keep the larger magnitude (more negative).
        self.assertEqual(-5, r["negativeNegativeKeepsLargerMagnitude"])
        self.assertEqual(-5, r["negativeNegativeKeepsLargerMagnitudeReversed"])
        self.assertEqual(-3, r["negativePositiveAdds"])
        self.assertEqual(-5, r["negativeZeroAdds"])

    # --- shares (collision-response.md §6.1, C1/V0/V3) ----------------------

    def test_shares_equal_masses(self) -> None:
        self.assertVec(self.results["shares"]["equalMasses"], [0.5, -0.5])

    def test_shares_jeep_vs_sherman(self) -> None:
        # s = 25000/27500 = 0.9090..., shareB = -(1-s) = -0.0909...
        r = self.results["shares"]["jeepVsSherman"]
        self.assertAlmostEqual(0.909090909, r[0], places=6)
        self.assertAlmostEqual(-0.090909091, r[1], places=6)

    def test_shares_static_snaps(self) -> None:
        # A 1e12 static as the face side: s ~ 1 > 0.95 -> the mobile side
        # (A) takes everything.
        self.assertVec(self.results["shares"]["staticFaceSide"], [1, 0])
        # A 1e12 static as the vertex side: s ~ 0 < 0.05 -> the low snap,
        # LOW_SNAP_SHARE_B (-1), not the binary's +1.0.
        self.assertVec(self.results["shares"]["staticVertexSide"], [0, -1])

    def test_shares_snap_boundaries(self) -> None:
        # s = 100/101 = 0.99009... > 0.95 -> high snap.
        self.assertVec(self.results["shares"]["highSnapBoundary"], [1, 0])
        # s = 1/101 = 0.00990... < 0.05 -> low snap.
        self.assertVec(self.results["shares"]["lowSnapBoundary"], [0, -1])

    def test_shares_no_node_cases(self) -> None:
        # No node on A: the low snap's shares, LOW_SNAP_SHARE_B not +1.
        self.assertVec(self.results["shares"]["noNodeA"], [0, -1])
        # No node on B: the high snap's shares.
        self.assertVec(self.results["shares"]["noNodeB"], [1, 0])

    def test_low_snap_share_b_constant(self) -> None:
        # collision-response.md §6.1/§12: the binary writes +1.0 here; this
        # port's one named bug-parity exception uses -1.0.
        self.assertEqual(-1, self.results["shares"]["LOW_SNAP_SHARE_B"])

    # --- corner drop: probe + collidePair, one direction (§5.5, §6.2) -------

    def test_corner_drop_finds_the_hit(self) -> None:
        r = self.results["cornerDrop"]
        self.assertEqual(1, r["applied"])
        # B's top face normal is (0,1,0); depth is the penetration, signed
        # non-positive per F11, and the contact lands where the one-tick-back
        # ray crosses y=0, which by construction is the world origin.
        log = r["handlerLog"]
        self.assertEqual(2, len(log))
        self.assertVec(log[0]["normal"], [0, 1, 0])
        self.assertVec(log[0]["pos"], [0, 0, 0])

    def test_corner_drop_handler_order_and_swapped_materials(self) -> None:
        log = self.results["cornerDrop"]["handlerLog"]
        # A's own call first, self=A/other=B, materials (vertex, face).
        self.assertEqual("A", log[0]["self"])
        self.assertEqual("B", log[0]["other"])
        self.assertEqual(5, log[0]["matSelf"])
        self.assertEqual(20, log[0]["matOther"])
        # The mirror call: self/other swapped, vRel negated, AND materials
        # swapped relative to the first call (§6.2: "A->handleCollision(B,
        # ..., matV, mat)" then "B->handleCollision(A, ..., mat, matV)").
        self.assertEqual("B", log[1]["self"])
        self.assertEqual("A", log[1]["other"])
        self.assertEqual(20, log[1]["matSelf"])
        self.assertEqual(5, log[1]["matOther"])
        self.assertVec(log[1]["vRel"], [-x for x in log[0]["vRel"]])

    def test_corner_drop_response(self) -> None:
        r = self.results["cornerDrop"]
        # depth = -0.05 (0.05 m penetration); posAdjust = -depth*n = (0,0.05,0).
        self.assertVec(r["responseA"]["posAdjust"], [0, 0.05, 0])
        # speedAdjust cancels the closing speed along the normal: vRel=(0,-3,0),
        # -(speed.n/n.n)*n = (0,3,0).
        self.assertVec(r["responseA"]["speedAdjust"], [0, 3, 0])
        self.assertEqual(1, r["responseA"]["count"])
        self.assertVec(r["responseA"]["avgNormal"], [0, 1, 0])
        # B is static: shareB = 0, so B's response is never touched at all —
        # "static B -> A takes everything" (§6.1's high snap).
        self.assertEqual(0, r["responseB"]["count"])
        self.assertVec(r["responseB"]["posAdjust"], [0, 0, 0])
        # `collidePair` posts no acceleration and moves nothing itself —
        # that is `solve`'s job, run separately by the caller next tick.
        self.assertTrue(r["bodyAStillMoving"])
        self.assertTrue(r["bodyBStillMoving"])

    def test_corner_drop_skipped_when_handler_vetoes(self) -> None:
        r = self.results["cornerDropVetoed"]
        self.assertEqual(0, r["applied"])
        # Only A's handler call happens; B's mirror call is never reached
        # once A's returns false (§6.2: "both must return true").
        self.assertEqual(1, r["handlerCallCount"])
        self.assertTrue(r["responseAUntouched"])
        self.assertTrue(r["responseBUntouched"])

    # --- relative speed^2 <= 0.1 (§6.2) --------------------------------------

    def test_low_relative_speed_skips_handlers_not_response(self) -> None:
        r = self.results["lowRelSpeed"]
        self.assertLessEqual(r["vRelSq"], 0.1)
        self.assertEqual(1, r["applied"])
        self.assertEqual(0, r["handlerCallCount"])
        self.assertTrue(r["responseAApplied"])

    # --- two similar bodies, both directions (§6.4, §12) ---------------------

    def test_symmetric_pair_runs_both_directions(self) -> None:
        r = self.results["symmetricBothDirections"]
        self.assertEqual(2, r["countA"])
        self.assertEqual(2, r["countB"])

    def test_symmetric_pair_speed_adjust_follows_set_adjust(self) -> None:
        # Both directions contribute the SAME candidate to each side (see the
        # harness's derivation): setAdjust keeps the larger of two equal,
        # same-sign values rather than summing them, so the final
        # speedAdjust is one weighted share's worth, not two.
        r = self.results["symmetricBothDirections"]
        self.assertVec(r["speedAdjustA"], [-0.75, 0, 0])
        self.assertVec(r["speedAdjustB"], [0.75, 0, 0])

    def test_symmetric_pair_quarter_share_velocity_change(self) -> None:
        # collision-response.md §6.4's inferred note: "the velocity change is
        # a quarter of the share, not half." share = 0.5 (equal masses);
        # closing speed = 3 m/s; quarter of the share = 0.125 -> 0.375 m/s.
        r = self.results["symmetricBothDirections"]
        self.assertTrue(r["posAdjustAWasNonZero"])
        self.assertTrue(r["bodyATranslated"])
        self.assertTrue(r["bodyBTranslated"])
        # accel = speedAdjust * 30 * (1+e)/1 * 0.5, e = 0 -> speedAdjust*15.
        self.assertVec(r["accelA"], [-11.25, 0, 0])
        self.assertVec(r["accelB"], [11.25, 0, 0])
        self.assertAlmostEqual(-0.375, r["impliedVelocityChangeA"], places=6)

    # --- direction selection (§5.3) ------------------------------------------

    def test_five_x_larger_body_uses_one_direction(self) -> None:
        r = self.results["fiveXLargerOneDirection"]
        self.assertEqual(1, r["countA"])
        self.assertEqual(1, r["countB"])

    def test_static_face_side_takes_everything(self) -> None:
        r = self.results["staticBTakesEverything"]
        self.assertEqual(1, r["responseACount"])
        self.assertVec(r["responseAPosAdjust"], [0, 0.05, 0])
        self.assertTrue(r["responseBUntouched"])
        # `collideBodies` finds and accumulates contacts; it does not call
        # `solve` (that is the caller's separate resolve pass).
        self.assertTrue(r["bodyAUnmoved"])

    # --- narrow-phase vertex-count rule (§5.5) --------------------------------

    def test_three_vertex_layer_probes_only_vertex_zero(self) -> None:
        r = self.results["threeVertexProbesOnlyVertexZero"]
        self.assertEqual(1, r["count"])
        self.assertEqual(0, r["vertexIndex"])
        self.assertAlmostEqual(-0.02, r["depth"], places=4)

    # --- solve() (§6.4, C4/V0) -------------------------------------------------

    def test_solve_noop_when_pos_adjust_zero(self) -> None:
        r = self.results["solveNoop"]
        self.assertIsNone(r["result"])
        self.assertEqual(0, r["translateCalls"])
        self.assertEqual(0, r["accelCalls"])

    def test_spring_solve_returns_clamped_push_without_moving_body(self) -> None:
        r = self.results["springSolve"]
        self.assertVec(r["result"], [0, 0.5, 0])
        self.assertEqual(0, r["translateCalls"])
        self.assertEqual(0, r["accelCalls"])
        self.assertVec(r["posAdjustClearedAfter"], [0, 0, 0])

    def test_spring_solve_clamps_to_one_and_zero(self) -> None:
        self.assertVec(self.results["springSolveClampHigh"], [0, 1, 0])
        self.assertVec(self.results["springSolveClampLow"], [0, 0, 0])


if __name__ == "__main__":
    unittest.main()
