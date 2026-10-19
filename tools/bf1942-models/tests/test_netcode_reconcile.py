"""`viewer/netcode-reconcile.js` under node: P4's correction law.

One node run, many assertions (the pattern of `test_netcode_client.py`). The
module is pure, so the copy list is the module alone.

What this file pins is the defect written up in
`features/netcode-play-multiplayer/SNAPBACK.md`: a walking player's own view
teleporting backwards twice a second, on loopback, forever.

* the acknowledgement is what makes the comparison honest — the error is
  measured at the tick the authority says it ran, so the input latency the old
  handler read as error (and corrected away) is not error;
* the client's unacknowledged ticks are replayed on top of an accepted
  correction;
* no acknowledgement, no correction — the pre-deploy snapshot that teleported
  a freshly spawned player 1103 m across Aberdeen;
* a standing error decays geometrically instead of accumulating to the grace;
* a correction re-bases the ledger, so corrections converge instead of
  compounding (measured, before that: 1103 m, 2206, 4413, 8824, 17649, 35292);
* the hard limit is the line between "smooth this" and "this is a different
  event", and even a hard set keeps the replay;
* facing is corrected, because a heading error is the one divergence that grows
  without bound;
* a word the authority's trim dropped still finds a tick both sides ran.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "netcode_reconcile_harness.mjs"

MODULES = {
    "netcode-reconcile.mjs": VIEWER / "netcode-reconcile.js",
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")], capture_output=True, text=True,
            timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReconcileTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- (a) the acknowledgement makes the comparison honest ------------------

    def test_error_is_measured_at_the_acknowledged_tick(self) -> None:
        a = self.results["a"]
        # Five unacknowledged ticks of a 0.2 m walk: a metre of latency.
        self.assertAlmostEqual(a["latency"], 1.0, places=4)
        self.assertAlmostEqual(a["nakedComparison"], 1.0, places=4)
        # The authority agrees exactly about the tick it ran, so there is no
        # error and no correction. The naked comparison would have found 1 m.
        self.assertIsNone(a["plan"])

    # --- (b) the replay ------------------------------------------------------

    def test_unacknowledged_ticks_are_replayed_on_the_correction(self) -> None:
        b = self.results["b"]
        plan = b["plan"]
        self.assertIsNotNone(plan)
        self.assertTrue(plan["hard"])
        self.assertAlmostEqual(plan["error"], 5.0, places=4)
        self.assertEqual(plan["acked"], 5)
        # The authority's x, and the five unacknowledged ticks of +z on top.
        self.assertAlmostEqual(plan["x"], 5.0, places=4)
        self.assertAlmostEqual(b["replayedZ"], 1.0, places=4)
        self.assertEqual(plan["replayed"], 5)
        self.assertEqual(b["pending"], 5)

    # --- (c) no acknowledgement, no correction -------------------------------

    def test_a_snapshot_with_no_acknowledgement_corrects_nothing(self) -> None:
        c = self.results["c"]
        self.assertIsNone(c["noAck"])
        self.assertIsNone(c["staleAck"])
        self.assertEqual(c["pending"], 10)
        self.assertEqual(c["stalePending"], 5)

    # --- (d) the smoothing law ----------------------------------------------

    def test_a_standing_error_decays_instead_of_accumulating(self) -> None:
        d = self.results["d"]
        errors = d["errors"]
        share = d["smoothing"]
        self.assertAlmostEqual(errors[0], 1.0, places=5)
        # Each accepted snapshot closes the same share of what is left, so the
        # error is a geometric decay — never a growth, and never an overshoot.
        for before, after in zip(errors, errors[1:]):
            self.assertLess(after, before)
            self.assertAlmostEqual(after, before * (1 - share), places=4)
        self.assertLess(errors[-1], 0.05)
        self.assertGreater(d["finalX"], 0.0)

    # --- (e) the compounding regression -------------------------------------

    def test_a_correction_converges_instead_of_compounding(self) -> None:
        e = self.results["e"]
        errors = e["errors"]
        # A fixed 10 m offset: the first correction is hard and lands it, and
        # every snapshot after it measures less, not more. Before the ledger was
        # re-based this doubled on every snapshot.
        self.assertAlmostEqual(errors[0], 10.0, places=3)
        for before, after in zip(errors, errors[1:]):
            self.assertLessEqual(after, before + 1e-9)
        self.assertLess(errors[-1], 0.5)
        # And the body ends up where the authority has it, not thrown off the
        # map: the x trace converges on 10, it does not run away.
        self.assertLess(max(e["xs"]), 11.0)
        self.assertAlmostEqual(e["xs"][-1], 10.0, places=1)

    # --- (f) the hard limit --------------------------------------------------

    def test_the_hard_limit_separates_a_correction_from_an_event(self) -> None:
        f = self.results["f"]
        self.assertEqual(f["hardLimit"], 4.0)
        inside, outside = f["inside"], f["outside"]
        self.assertFalse(inside["hard"])
        self.assertTrue(outside["hard"])
        # Under the limit the local ground solver keeps y; over it the
        # authority's y is taken with the rest of the event.
        self.assertIsNone(inside["y"])
        self.assertEqual(outside["y"], 999)
        # A smoothed correction moves the body by the share, not the error.
        self.assertAlmostEqual(inside["x"], (4.0 - 0.5) * 0.25, places=4)

    # --- (g) facing ---------------------------------------------------------

    def test_facing_is_corrected_at_the_same_share(self) -> None:
        g = self.results["g"]
        self.assertAlmostEqual(g["whole"], g["expected"], places=8)
        self.assertAlmostEqual(g["share"], g["expected"] * 0.25, places=8)
        # The short way round, and a seated player's NaN facing turns nobody.
        self.assertAlmostEqual(g["shortWay"], -20.0, places=4)
        self.assertEqual(g["nan"], 0)
        # The number the defect cost: 17.719 deg of heading error splays two
        # bodies running the same forward word apart at ~1.85 m/s, so the old
        # 4 m grace was crossed about every two seconds, forever.
        self.assertGreater(g["splayPerSecond"], 1.8)
        self.assertLess(g["splayPerSecond"], 1.9)

    # --- (h) a dropped word, and the bound ----------------------------------

    def test_a_dropped_word_still_finds_a_tick_both_sides_ran(self) -> None:
        h = self.results["h"]
        self.assertEqual(h["acked"], 6)
        self.assertEqual(h["pending"], 4)
        self.assertEqual(h["boundedTicks"], 8)
        self.assertEqual(h["historyTicks"], 120)

    # --- (i) reset ----------------------------------------------------------

    def test_a_reset_forgets_the_body_that_no_longer_exists(self) -> None:
        i = self.results["i"]
        self.assertEqual(i["pending"], 0)
        self.assertEqual(i["lastAck"], 0)
        self.assertIsNone(i["plan"])

    # --- (j) the retail client's facing law ---------------------------------

    def test_acked_facing_is_measured_at_the_acked_tick_and_closed_whole(self) -> None:
        j = self.results["j"]
        # Agreement at the acked tick is no error, whatever the page turned since.
        self.assertIn(j["agree"], (None, 0))
        # A 48 degree disagreement is closed whole, not by a share.
        self.assertAlmostEqual(j["off"], 48.0, places=4)
        # The ledger was rebased: the next acknowledgement agrees.
        self.assertIn(j["after"], (None, 0))
        # A standing soldier's view yaw, not his body yaw (the twist), is the facing.
        self.assertIn(j["standing"], (None, 0))
        # And the room's law is the share against the present, as before.
        self.assertAlmostEqual(j["room"], 20.0 * 0.25, places=4)

    def test_acked_view_pitch_is_closed_whole_and_only_against_a_real_server(self) -> None:
        j = self.results["j2"]
        # The page was at 10 deg at tick 3, the server at -6: the 16 is closed whole.
        self.assertAlmostEqual(j["first"], -16.0, places=4)
        # Rebased: at tick 5 the page's ledger says -10 too.
        self.assertIn(j["next"], (None, 0))
        # No pitch on the row, or the room's share law: nothing.
        self.assertIn(j["noPitch"], (None, 0))
        self.assertIn(j["room"], (None, 0))

    # --- (k) the driven hull --------------------------------------------------

    def test_the_driven_hull_is_corrected_at_the_acked_tick_and_stays_finite(self) -> None:
        k = self.results["k"]
        # Latency is not error: the server agrees about the tick it ran.
        self.assertEqual(k["agree"], 0)
        # A real error is taken whole, position and facing, speed kept.
        self.assertAlmostEqual(k["off"], 0.5, places=5)
        self.assertAlmostEqual(k["afterOff"]["x"], 4.5, places=5)
        self.assertAlmostEqual(k["afterOff"]["yaw"], 10.0, places=3)
        self.assertAlmostEqual(k["afterOff"]["speed"], 12.0, places=5)
        # The newer tick moved with it: the next agreement is no error.
        self.assertEqual(k["rebased"], 0)
        self.assertEqual(k["pending"], 0)
        # Off-unit orientations do not grow the velocity (live: to Infinity).
        self.assertTrue(k["finite"])
        self.assertAlmostEqual(k["grownSpeed"], 10.0, places=4)

    def test_the_driven_hull_takes_the_servers_velocity_at_the_acked_tick(self) -> None:
        # readControlObjectState sets velocities with the transform. A page
        # hull that drove on at 12 m/s through a static its probe missed,
        # against a server hull at rest at the wall (Tobruk, 2026-10-17),
        # loses the 12 m/s with the 0.8 m.
        l = self.results["l"]
        self.assertAlmostEqual(l["wall"]["error"], 0.8, places=5)
        self.assertAlmostEqual(l["wall"]["speedError"], 12.0, places=5)
        self.assertAlmostEqual(l["after"]["x"], 3.2, places=5)
        self.assertAlmostEqual(l["after"]["vx"], 0.0, places=5)
        # Agreement moves nothing.
        self.assertEqual(l["agree"]["error"], 0)
        self.assertEqual(l["agree"]["speedError"], 0)
        self.assertEqual(l["agree"]["vx"], 12)
        # An ack without the hull's velocity (an older sidecar) leaves it.
        self.assertEqual(l["oldVx"], 12)

    def test_the_divergence_is_reported_decomposed(self) -> None:
        # One accept must report the acked-tick divergence term by term so a
        # live drive says which integrator term is adrift: horizontal position,
        # vertical (springs/ground), orientation angle (radians), and speed.
        m = self.results["m"]
        self.assertAlmostEqual(m["error"], 3.0, places=4)      # dz = 3
        self.assertAlmostEqual(m["errorY"], 2.0, places=4)     # dy = 2
        self.assertAlmostEqual(m["oriError"], 1.5708, places=3)  # 90 deg yaw
        self.assertAlmostEqual(m["speedError"], 4.0, places=4)   # 4 m/s


if __name__ == "__main__":
    unittest.main()
