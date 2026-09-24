"""`viewer/body-statics.js`: a driven vehicle's hull against the static world
— `features/bf1942-engine-reference/subsystems/collision-response.md` §5.3's
"B static" arm, §5.5's probe and §6's response (`collision-response.md` below;
section numbers are its numbers).

The module imports only `body-contact.js`, so — like `test_body_ground.py` —
this copies both into a temp dir, rewrites the import, and runs
`node harness.mjs`. Every number asserted here was derived from the spec in
`body_statics_harness.mjs`'s own comments before this file was written.
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
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "body_statics_harness.mjs"


def _rewrite_imports(text: str, mapping: dict[str, str]) -> str:
    for old, new in mapping.items():
        text = text.replace(f"from '{old}'", f"from '{new}'")
    return text


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "body-contact.js", work / "body-contact.mjs")
        bs = _rewrite_imports(
            (VIEWER / "body-statics.js").read_text(),
            {"./body-contact.js": "./body-contact.mjs"},
        )
        (work / "body-statics.mjs").write_text(bs)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BodyStaticsTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def assertVec(self, actual, expected, places=5, msg=None) -> None:
        self.assertEqual(len(actual), len(expected), msg)
        for a, e in zip(actual, expected):
            self.assertAlmostEqual(a, e, places=places, msg=msg)

    # --- the share against a static (collision-response.md 6.1) -------------

    def test_static_mass_is_the_engines(self) -> None:
        self.assertEqual(self.results["share"]["staticMass"], 1e12)

    def test_a_static_gives_the_body_the_whole_correction(self) -> None:
        # s = 1e12 / (m + 1e12) > 0.95 for every vehicle mass, so shareA = 1.
        self.assertEqual(self.results["share"]["jeep"], 1.0)
        self.assertEqual(self.results["share"]["battleship"], 1.0)

    def test_the_low_snap_sign_divergence_is_inherited(self) -> None:
        # The ported -1.0, not the binary's +1.0 (6.1, "sic").
        self.assertEqual(self.results["share"]["lowSnapB"], -1.0)

    # --- the probe and the response (5.5, 6.2, 6.3, 6.4) -------------------

    def test_a_wall_contact_is_found_from_last_ticks_origin(self) -> None:
        wall = self.results["wall"]
        self.assertEqual(wall["applied"], 1)
        self.assertEqual(wall["casts"], 1)
        # S = pos - v*dt = (0, 0, -0.2) - (0, 0, -10)/30.
        self.assertVec(wall["castOrigin"], [0, 0, 0.13333], places=4)

    def test_the_push_out_is_the_penetration_along_the_normal(self) -> None:
        # depth = (E - P).n = -0.1, posAdjust = -depth * n.
        self.assertVec(self.results["wall"]["posAdjust"], [0, 0, 0.1])

    def test_the_closing_speed_along_the_normal_is_cancelled(self) -> None:
        self.assertVec(self.results["wall"]["speedAdjust"], [0, 0, 10])

    def test_the_contact_averages_are_left_for_the_friction_pass(self) -> None:
        wall = self.results["wall"]
        self.assertEqual(wall["count"], 1)
        self.assertVec(wall["avgNormal"], [0, 0, 1])
        # relPos = hit - partPos; the part's origin is the body's here.
        self.assertVec(wall["avgRelPos"], [0, 0, -1.9])
        self.assertEqual(wall["friction"], 1.0)

    def test_solve_moves_the_body_and_posts_the_impulse_at_the_contact(self) -> None:
        wall = self.results["wall"]
        self.assertEqual(len(wall["translate"]), 1)
        self.assertVec(wall["translate"][0], [0, 0, 0.1])
        self.assertVec(wall["bodyPos"], [0, 0, -0.1])
        self.assertEqual(len(wall["accel"]), 1)
        # speedAdjust * 30 * (1 + e) / 2 with e = 0 (6.4).
        self.assertVec(wall["accel"][0]["a"], [0, 0, 150])
        # At the part's position plus the averaged contact offset, i.e. the
        # hit itself — which is what spins the hull.
        self.assertVec(wall["accel"][0]["p"], [0, 0, -2.1])

    # --- friction (section 8, and the plan's warning) ----------------------

    def test_a_side_on_contact_hands_the_friction_pass_no_budget(self) -> None:
        # The Coulomb budget is mu * N.y * |g|, so a vertical face is 0.
        self.assertAlmostEqual(self.results["frictionNormals"]["sideNy"], 0.0)
        self.assertAlmostEqual(self.results["frictionNormals"]["topNy"], 1.0)

    # --- anti-tunnelling (5.5) --------------------------------------------

    def test_the_probe_spans_the_whole_ticks_motion(self) -> None:
        t = self.results["tunnel"]
        self.assertEqual(t["applied"], 1)
        self.assertVec(t["castOrigin"], [0, 0, 0], places=4)
        self.assertAlmostEqual(t["maxDist"], 5.5, places=4)
        self.assertVec(t["posAdjust"], [0, 0, 3.5])

    # --- the gates --------------------------------------------------------

    def test_a_sleeping_body_is_not_probed(self) -> None:
        self.assertEqual(self.results["gates"]["sleepApplied"], 0)
        self.assertEqual(self.results["gates"]["sleepCasts"], 0)

    def test_the_broadphase_gate_skips_every_cast(self) -> None:
        self.assertEqual(self.results["gates"]["nearAsked"], 1)
        self.assertEqual(self.results["gates"]["nearCasts"], 0)
        self.assertEqual(self.results["gates"]["nearApplied"], 0)

    def test_the_cast_carries_the_bodys_own_owner_and_the_deck_gate(self) -> None:
        self.assertEqual(self.results["gates"]["owner"], 3)
        self.assertAlmostEqual(self.results["gates"]["stepTop"], 2.25)

    # --- the handler and the 0.1 threshold (6.2) ---------------------------

    def test_a_vetoing_handler_skips_the_response(self) -> None:
        h = self.results["handler"]
        self.assertEqual(h["vetoApplied"], 0)
        self.assertVec(h["vetoPosAdjust"], [0, 0, 0])
        self.assertEqual(len(h["seen"]), 1)
        # The vertex brings its own material, the face brings the static's.
        self.assertEqual(h["seen"][0]["matSelf"], 61)
        self.assertEqual(h["seen"][0]["matOther"], 90)
        self.assertVec(h["seen"][0]["vRel"], [0, 0, -10])
        self.assertVec(h["seen"][0]["normal"], [0, 0, 1])
        self.assertVec(h["seen"][0]["pos"], [0, 0, -2.1])

    def test_a_resting_contact_costs_no_handler_and_still_responds(self) -> None:
        h = self.results["handler"]
        self.assertEqual(h["slowCalled"], 0)
        self.assertEqual(h["slowApplied"], 1)
        self.assertGreater(h["slowPosAdjust"][2], 0)

    def test_a_hull_at_speed_passes_an_obstacle(self) -> None:
        o = self.results["obstacle"]
        # `Obstacle::handleCollision` is asked about the hit's owner and
        # vetoes the response; barbed wire does not stop a hull.
        self.assertEqual(o["fastApplied"], 0)
        self.assertEqual(o["fastAsked"], [7])
        self.assertVec(o["fastPosAdjust"], [0, 0, 0])
        # Below the 0.1 threshold no handler runs and the wire pushes.
        self.assertEqual(o["slowAsked"], 0)
        self.assertEqual(o["slowApplied"], 1)
        # Anything that is not an Obstacle still stops it.
        self.assertEqual(o["wallApplied"], 1)

    # --- vertex accounting (5.5, 6.3) -------------------------------------

    def test_every_vertex_is_probed_and_contacts_do_not_stack(self) -> None:
        m = self.results["manyVertices"]
        self.assertEqual(m["casts"], 4)
        self.assertEqual(m["applied"], 4)
        self.assertEqual(m["count"], 4)
        # setAdjust keeps the larger of same-sign contributions.
        self.assertVec(m["posAdjust"], [0, 0, 0.1])

    def test_a_three_vertex_part_is_one_probe(self) -> None:
        self.assertEqual(self.results["threeVertices"]["casts"], 1)


if __name__ == "__main__":
    unittest.main()
