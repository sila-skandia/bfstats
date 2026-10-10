"""A real `Soldier` wearing XPack2's rocket pack, through
`rocket_pack_soldier_harness.mjs`: what the jump key does with it, and what
the pack's `Damping 0.0` does to a fall."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "rocket_pack_soldier_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RocketPackSoldierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_pack_lifts_a_man_a_plain_jump_does_not(self) -> None:
        plain, held = self.r["plainJump"], self.r["packHeld"]
        self.assertLess(plain["apex"], 1.5)               # 6 m/s at 14.73: 1.2 m
        self.assertGreater(held["apex"], 15)              # two seconds of bursts
        self.assertEqual(plain["burstEvents"], 0)
        self.assertGreater(held["burstEvents"], 10)
        self.assertLess(held["heatPeak"], 1.1)

    def test_a_tap_is_a_hop_and_he_comes_down(self) -> None:
        tap = self.r["packTap"]
        self.assertGreater(tap["apex"], self.r["plainJump"]["apex"])
        self.assertTrue(tap["endGrounded"])

    def test_in_the_air_the_legs_are_the_glides_under_the_packs_name(self) -> None:
        clips = self.r["packHeld"]["clips"]
        self.assertEqual(clips["lower"], "Lb_ParachuteIdle")
        self.assertIsNone(clips["upper"])                  # `Empty`: his torso is his own
        self.assertIsNone(self.r["plainJump"]["clips"])

    def test_the_packs_damping_takes_the_height_out_of_a_fall(self) -> None:
        pack, plain = self.r["fallPack"], self.r["fallPlain"]
        self.assertEqual(pack["damping"], 0)
        self.assertEqual(plain["damping"], 1)
        # The idle lift (7.7 against 14.73) slows his fall to 23 m/s where a
        # plain soldier's is 36; the same landing billed with and without the
        # kit's damping is what the part's `Damping 0.0` is worth.
        self.assertLess(pack["impact"], plain["impact"])
        self.assertGreater(plain["plain"], 30)             # a 40 m fall kills a 30 HP man
        self.assertGreater(pack["plain"], 30)              # ... and so would his, undamped
        self.assertLess(pack["withKit"], pack["plain"] / 100)
        self.assertLess(pack["withKit"], 30)               # he lives

    def test_a_crouch_blocks_the_pack(self) -> None:
        self.assertLess(self.r["crouched"]["rose"], 0.2)
        self.assertEqual(self.r["crouched"]["state"], 3)

    def test_no_room_overhead_no_burst(self) -> None:
        self.assertFalse(self.r["noRoom"]["hasRoom"])
        self.assertEqual(self.r["noRoom"]["heat"], 0)

    def test_a_man_without_the_part_is_unchanged(self) -> None:
        self.assertIsNone(self.r["noPack"]["pack"])
        self.assertEqual(self.r["noPack"]["damping"], 1)
        self.assertIsNone(self.r["noPack"]["clips"])


if __name__ == "__main__":
    unittest.main()
