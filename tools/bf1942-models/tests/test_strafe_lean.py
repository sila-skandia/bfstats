"""A strafing soldier's legs turn toward where he goes (`viewer/strafe-lean.js`).

Retail plays the forward run clip for `Lb_StrafeLeft`/`Lb_StrafeRight` and for
a diagonal, and turns the skeleton's root `value x 90` degrees about his up
with each of `Bip01 Spine`, `Spine1`, `Spine2` turned back `value x -30`,
`value` easing at 3.0 a second toward a target read off his state bits
(`BFSoldier::updateAnimations`, ledger ANIM-21). The replay drew the forward
run with the legs square to his facing while he slid sideways (8t224pppqe,
Player, 0:22-0:27). The harness checks the law, the clock and the drawn pose.

Run with `python3 -m unittest tests.test_strafe_lean` from tools/bf1942-models.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "strafe_lean_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class StrafeLeanTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_target_is_the_engines_from_the_state_bits(self) -> None:
        self.assertEqual({
            "none": 0, "forward": 0, "back": 0,
            "right": 0.8, "left": -0.8,
            "forwardRight": 0.5, "forwardLeft": -0.4,
            "backRight": -0.5, "backLeft": 0.4,
            "rightLying": 0.8, "forwardRightZoomed": 0.5,
            "undefined": 0,
        }, self.r["targets"])

    def test_the_lean_moves_at_three_a_second(self) -> None:
        r = self.r
        self.assertEqual(3, r["rate"])
        self.assertEqual(0, r["settled"])
        for want, got in zip([0, 0.3, 0.6, 0.8, 0.8], r["rampRight"]):
            self.assertAlmostEqual(want, got, places=9)
        self.assertAlmostEqual(0.8, r["onRight"], places=9)
        self.assertAlmostEqual(0.65, r["toDiagonal"], places=9)
        self.assertAlmostEqual(0.5, r["onDiagonal"], places=9)
        # A 0.1 s tap left from +0.5 takes it to 0.2, then back to 0 forward.
        self.assertAlmostEqual(0.2, r["tapLeft"], places=9)
        self.assertAlmostEqual(0, r["afterTap"], places=9)
        self.assertAlmostEqual(0, r["afterTapSettled"], places=9)

    def test_a_new_body_starts_from_zero(self) -> None:
        for want, got in zip([0, 0.3, 0.8], self.r["firstRows"]):
            self.assertAlmostEqual(want, got, places=9)
        self.assertEqual(0, self.r["beforeFirst"])
        self.assertEqual(0, self.r["empty"])

    def test_a_seek_draws_the_same_lean(self) -> None:
        self.assertLess(self.r["seekDrift"], 1e-9)

    def test_the_legs_turn_and_the_chest_stays_on_the_aim(self) -> None:
        for name, value in [("right", 0.8), ("left", -0.8), ("forwardRight", 0.5), ("forwardLeft", -0.4)]:
            p = self.r["pose"][name]
            with self.subTest(name=name):
                self.assertEqual(4, p["bones"])
                # Positive to his right: a right strafe turns the legs right.
                self.assertAlmostEqual(value * 90, p["legs"], places=6)
                self.assertAlmostEqual(value * 60, p["spine"], places=6)
                self.assertAlmostEqual(value * 30, p["spine1"], places=6)
                self.assertAlmostEqual(0, p["chest"], places=6)
                self.assertLess(p["rootHeightMoved"], 1e-9)
                self.assertLess(p["rootRadiusMoved"], 1e-9)

    def test_no_lean_touches_nothing(self) -> None:
        self.assertLess(self.r["zero"], 1e-4)

    def test_holding_a_lean_does_not_wind_the_legs(self) -> None:
        h = self.r["held"]
        self.assertAlmostEqual(72, h["first"], places=6)
        self.assertLess(h["drift"], 1e-6)
        self.assertLess(abs(h["restored"]), 1e-6)
        # And the trap is real: without the unlean three frames wind past it.
        self.assertGreater(abs(h["windWithoutUnlean"] - 72), 90)


if __name__ == "__main__":
    unittest.main()
