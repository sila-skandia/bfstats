"""`isSticky 1`: the round keeps to the object it strikes (FHX-17).

`Projectile::handleCollision` (lnxded 0x0831ee80) tests `ProjectileTemplate
+0x1ab` at 0x0831ef16 on a contact with an object, while the round is not yet
stuck (`+0x10f`): it makes the round the object's child at the contact, in the
object's frame with no rotation of its own, sets `+0x10f`, keeps the object at
`+0x110`, and skips the recycle tests, so the fuse runs on. A terrain contact
has no object and is the ordinary one. FHSW's Haft-Hohlladung, sticky bomb,
magnetic mines and sticky socks set it.

`sticky_round_harness.mjs` throws one through `gunfire.js` under node at a
wall whose node then moves and turns, and on open ground.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sticky_round_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class StickyRoundTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_it_sticks_where_it_strikes_the_object(self) -> None:
        s = self.r["sticky"]
        self.assertTrue(s["stuck"])
        self.assertEqual(1, s["contacts"])
        # On the wall's face (z = -3.1, the standoff off it), in the air.
        self.assertAlmostEqual(-3.08, s["at"][2], places=2)
        self.assertGreater(s["at"][1], 0.5)

    def test_it_rides_the_object_and_wears_its_rotation(self) -> None:
        s = self.r["sticky"]
        # The tank drove 5 m along x and turned a quarter: the contact point
        # (0, y, -3.08) in its frame is (5 - 3.08, y, 0) in the world.
        self.assertEqual([1.92, s["at"][1], 0.0], s["afterMove"])
        self.assertEqual(1.0, s["wearsTankRotation"])

    def test_its_fuse_runs_on(self) -> None:
        s = self.r["sticky"]
        self.assertEqual(1, s["blasted"])
        self.assertEqual(0, s["leftInFlight"])

    def test_without_the_word_it_drops_off_the_wall(self) -> None:
        p = self.r["plain"]
        self.assertFalse(p["stuck"])
        self.assertAlmostEqual(0.02, p["at"][1], places=3)
        self.assertEqual(p["at"], p["afterMove"])

    def test_the_ground_is_no_object(self) -> None:
        g = self.r["stickyOnGround"]
        self.assertFalse(g["stuck"])
        self.assertTrue(g["resting"])
        self.assertGreater(g["contacts"], 1)


if __name__ == "__main__":
    unittest.main()
