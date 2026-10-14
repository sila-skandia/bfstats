"""FHSW's Norden bombs: a round whose Engine and Wing both sit on its centre of
mass is never turned (PHY-21: a push makes a moment only through its arm), so
it keeps its launch attitude; its motor pushes along the Engine's own row,
`setRotation 0/30/0` nose-down (PHY-20), and its fin by the aircraft's wing
law (physics.md section 4). Pushed along its flight path with no fin, the
bomb flew 650 to 980 m past the A-26's bomb sight
(`features/fhswe-mechanics-audit`, item 10)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "round_attitude_harness.mjs"


class RoundAttitudeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_rounds_wing_law_is_the_aircrafts(self) -> None:
        for ours, theirs in self.r["lift"]:
            self.assertAlmostEqual(ours, theirs, places=3)

    def test_a_wing_makes_nothing_at_1000_m_and_ten_times_under_water(self) -> None:
        self.assertEqual(0, self.r["ceiling"])
        self.assertAlmostEqual(10, self.r["submerged"], places=3)

    def test_only_a_round_with_every_part_on_its_centre_is_held(self) -> None:
        self.assertEqual({"norden": True, "finned": False, "bare": False}, self.r["onCentre"])

    def test_the_fin_keeps_its_mount_and_its_summed_lift(self) -> None:
        wing = self.r["wings"][0]
        self.assertEqual(60, wing["pitch"])
        self.assertAlmostEqual(1.5, wing["coeff"], places=3)

    def test_the_motor_pushes_30_degrees_under_the_nose(self) -> None:
        self.assertEqual(30, self.r["pitch"])
        self.assertEqual([0, -0.5, -0.866], self.r["heldAxis"])
        self.assertEqual([-0.866, -0.5, 0], self.r["heldAxisYawed"])
        self.assertEqual([0, -0.5, -0.866], self.r["pathAxis"])

    def test_an_untilted_motor_pushes_along_the_nose(self) -> None:
        self.assertEqual([0, -0.6, -0.8], self.r["plainAxis"])


if __name__ == "__main__":
    unittest.main()
