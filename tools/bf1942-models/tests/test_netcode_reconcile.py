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


if __name__ == "__main__":
    unittest.main()
