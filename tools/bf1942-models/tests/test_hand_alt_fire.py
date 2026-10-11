"""A knife's stab on the right button (`viewer/hand-alt-fire.js`) through
`hand_alt_fire_harness.mjs`: SW's `CommandoKnifeStab` and RtR's bayonets."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "hand_alt_fire_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HandAltFireTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_stabs_numbers_are_the_child_fire_arms_words(self) -> None:
        self.assertEqual(self.r["spec"], {"delay": 0.3, "cycle": 0.625, "name": "CommandoKnifeStab"})
        self.assertEqual(self.r["bayonet"], {"delay": 0.12, "cycle": 0.7692})

    def test_a_press_starts_a_swing_and_the_round_leaves_a_fire_delay_later(self) -> None:
        one = self.r["onePress"]
        self.assertEqual(one["began"], [0])
        self.assertAlmostEqual(one["pulledAt"], 0.3, delta=0.02)
        self.assertEqual(one["log"], [True, False])        # pulled, then let go once the round exists

    def test_a_press_inside_the_cycle_is_spent_on_nothing(self) -> None:
        self.assertEqual(self.r["cycle"]["stabs"], 2)      # 0 s and 1.0 s; the one at 0.33 s is not banked

    def test_a_weapon_that_may_not_swing_spends_the_press_and_begins_nothing(self) -> None:
        self.assertEqual(self.r["notReady"], {"began": False, "spent": True, "wind": 0})

    def test_putting_it_away_ends_the_swing(self) -> None:
        self.assertEqual(self.r["stopped"], {"firing": False, "wind": 0, "pulse": False})

    def test_a_round_that_never_comes_is_let_go_at_the_ceiling(self) -> None:
        self.assertTrue(self.r["ceiling"]["first"])
        self.assertFalse(self.r["ceiling"]["after"])


if __name__ == "__main__":
    unittest.main()
