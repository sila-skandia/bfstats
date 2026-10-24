"""A round leaves with its root's speed and a tick of lift, and falls from its second tick.

`FireArms::fireBarrel` (lnxded 0x0828aba0) adds the root's velocity to a
round of an `addRootSpeed` weapon (the template default) and then
`-(2/30) x gravity` to its y (0x0828b386..0x0828b3c4), and a body's update
integrates before it seeds the tick's gravity (`PointPhysicsNode::
updatePhysics` 0x082562c0), so a new round's first tick carries none (ledger
FA-23). On the lab three grenade throws (`fixtures/throw_launch_grenade.json`,
lab/throw_launch_check.py) fit that law to under a millimetre over eight
ticks; the page's old launch (no lift) was 26 cm low by then and its old
first tick (gravity in it) 13 cm. `throw_launch_harness.mjs` flies them
through `contact-response.js` `FuseRoundBody` with `round-launch.js`
`ROOT_SPEED_LIFT`, and a plain ballistic round through
`projectile-flight.js` `advanceProjectiles` at 30, 60 and 120 fps against
the engine's tick law.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("throw_launch_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ThrowLaunchTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_lab_throws_fly_where_the_server_flew_them(self) -> None:
        self.assertEqual(3, len(self.results["law"]))
        for t in self.results["law"]:
            self.assertLess(t["worst"], 0.002, t)

    def test_without_the_lift_they_fly_low(self) -> None:
        for t in self.results["noLift"]:
            self.assertLess(t["lastY"], -0.2, t)

    def test_with_gravity_on_the_first_tick_they_fly_low(self) -> None:
        for t in self.results["gravityFirst"]:
            self.assertLess(t["lastY"], -0.1, t)

    def test_a_ballistic_round_falls_on_the_engines_tick_at_any_frame_rate(self) -> None:
        ball = self.results["ballistic"]
        self.assertNotIn("error", ball, ball)
        for rate, r in ball.items():
            with self.subTest(rate=rate):
                self.assertLess(r["worst"], 1e-6)


if __name__ == "__main__":
    unittest.main()
