"""A submarine dives on its float bundles' key (`viewer/ship.js` `advanceTrim`).

`ship_dive_harness.mjs` drives a hull carrying eight of the Gato's
`GatoFloater`s through `viewer/ship.js`. Each floater is a RotationalBundle on
`c_PIPitch` (0..50, `setMaxSpeed 0/2/0`, `setAcceleration 0/1/0`, no
automatic reset), and `FloatingBundle::handleUpdate` (`0x08240180`) writes the
negated angle into the lift's `angle` term every tick (ledger SHIP-7). Before
2026-11-09 nothing turned it: the dive planes moved on the arrow keys and the
boat stayed on the surface.

What is pinned, every expected number from the law's own algebra:

* the arrows move the setpoint at 2 m a second and it holds where the key is
  released (GUN-2's held axis: the speed register ramps down at 1 m/s^2, so
  a release at 10 m carries on to 12 m);
* fully under, the float plane settles `setpoint + 0.5` m down (SHIP-7:
  `8 x 1.5 x lift(t) = |g|` at `t = 0.5`), here 12.5 m;
* at setpoint 0 she floats with `t` saturated:
  `depth = |g| H / (8 x 1.5 x floatMaxLift) = 14.73 x 3.3 / 19.53 = 2.489`;
* the setpoint stops at 50 and comes back to 0 on the other arrow;
* a root that has gone to sleep (TANK-21) does not dive until it wakes: the
  floats run only while the root is awake, and nothing but the engine or a
  contact wakes it;
* a hull whose floats author no key axis has no setpoint.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "ship_law_daihatsu_wake.json.gz"
HARNESS = HERE / "ship_dive_harness.mjs"

GRAVITY = 14.73
HULL_HEIGHT = 3.3
FLOAT_MAX_LIFT = 1.6275
FLOATS = 8
#: `g / -9.82`, the law's divisor (`body-float.js` `BUOYANCY_DIVISOR`).
DIVISOR_INVERSE = 1.5


def run_harness() -> dict:
    proc = subprocess.run(["node", str(HARNESS), str(FIXTURE)],
                          capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class ShipDiveTests(unittest.TestCase):
    out: dict = {}

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_key_moves_the_setpoint_at_two_metres_a_second(self) -> None:
        # 6 s held from rest at 1 m/s^2 up to 2 m/s: 1 m in the first 2 s,
        # then 2 m/s for 4 s, less the first tick's half step.
        self.assertAlmostEqual(self.out["pressed"]["setpoint"], 10.0, delta=0.1)
        # The float node's angle term is the negated bundle angle.
        for angle in self.out["pressed"]["angles"]:
            self.assertAlmostEqual(angle, -self.out["pressed"]["setpoint"], places=9)

    def test_released_it_coasts_to_a_stop_and_holds(self) -> None:
        # 2 m/s braking at 1 m/s^2 runs on another 2 m.
        self.assertAlmostEqual(self.out["held"]["setpoint"], 12.0, delta=0.1)

    def test_she_settles_half_a_metre_under_the_setpoint(self) -> None:
        held = self.out["held"]
        self.assertAlmostEqual(held["depth"], held["setpoint"] + 0.5, delta=0.02)
        self.assertLess(abs(held["vy"]), 1e-3)

    def test_at_setpoint_zero_she_floats_on_the_saturated_lift(self) -> None:
        expected = GRAVITY * HULL_HEIGHT / (FLOATS * DIVISOR_INVERSE * FLOAT_MAX_LIFT)
        self.assertAlmostEqual(self.out["surface"]["depth"], expected, delta=0.02)
        self.assertAlmostEqual(self.out["surfaced"]["depth"], expected, delta=0.02)
        self.assertEqual(self.out["surfaced"]["setpoint"], 0)

    def test_the_setpoint_stops_at_fifty(self) -> None:
        self.assertEqual(self.out["bottomed"]["setpoint"], 50)

    def test_a_sleeping_root_does_not_dive(self) -> None:
        asleep = self.out["asleep"]
        self.assertEqual(asleep["sleepiness"], 0)
        self.assertGreater(asleep["setpoint"], 5)
        self.assertEqual(asleep["moved"], 0)

    def test_a_hull_without_a_trimmed_float_has_no_setpoint(self) -> None:
        self.assertIsNone(self.out["daihatsu"]["setpoint"])


if __name__ == "__main__":
    unittest.main()
