"""A replayed tank's distance-selected sight follows the view's eye.

The owner's report (2026-10-27, FHSWEurope Meuse River Line, recording
xhf8sfkt7k, Chief-H.E.M.P driving an M36B1): the gunner's sight overlay, a
black panel with the round scope and the reticle, drawn over the scene in a
view that is not the sight's. FHSW hangs the M36B1's sight on
`lodM36Cockpit`, a 0.1 m DistanceSelector 1.4 m ahead of M36Camera, where the
Camera's `OutsideHudOffset` puts the nose view's eye (ledger LOD-3). f0861286
gave the page's seat view an eye for that test; the replay's camera gave its
hulls none, so the swap followed the view alone and the sight was up in the
cockpit view and down in the nose view. `ReplayCamera` now hands the drive of
the hull it looks out of its eye (`povEye`), and takes it back with the hull.

Run under node through `replay_seat_sight_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_seat_sight_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplaySeatSightTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_sight_is_grafted_where_the_offset_puts_the_eye(self) -> None:
        self.assertTrue(self.results["grafted"])
        self.assertEqual(self.results["eyeToSight"], 1.4)

    def test_the_cockpit_view_draws_no_sight(self) -> None:
        for key in ("cockpit", "cockpitAgain"):
            view = self.results[key]
            self.assertEqual(view["view"], "cockpit")
            self.assertTrue(view["driveEye"], "the drive is asked the view's eye")
            self.assertFalse(view["sight"], f"{key}: the sight is 1.4 m off the eye, past its 0.1 m")
            self.assertTrue(view["exterior"])

    def test_the_nose_view_is_the_sight(self) -> None:
        self.assertEqual(self.results["toggled"], "nose")
        view = self.results["nose"]
        self.assertEqual(view["eyeToSight"], 0)
        self.assertTrue(view["sight"])
        self.assertFalse(view["exterior"])

    def test_no_view_outside_his_eyes_draws_it(self) -> None:
        for key in ("orbit", "freeFromNose"):
            view = self.results[key]
            self.assertIsNone(view["view"])
            self.assertFalse(view["driveEye"], f"{key}: a hull let go of keeps no eye")
            self.assertFalse(view["sight"], f"{key}: the sight is down")
            self.assertTrue(view["exterior"])


if __name__ == "__main__":
    unittest.main()
