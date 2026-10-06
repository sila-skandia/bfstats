"""A blast's push where it meets the soldier's other movers, headless.

`tests/knockback_seams_harness.mjs` drives a real `Soldier`:

  * on a ladder the climb takes the tick whole, and the engine's climb stores
    its own velocity into his node every tick (ledger LADDER-4) while each
    tick's integrate spends and zeroes the accumulator (KNOCK-6), so a blast
    that reaches a climber must not be banked for the first tick off the
    ladder;
  * two blasts in one tick add in the one accumulator, each held under the
    ceiling on its own (KNOCK-4).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("knockback_seams_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True,
                          timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class KnockbackSeamTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_blast_on_a_ladder_is_not_held_for_the_let_go(self) -> None:
        r = self.results["ladder"]
        self.assertTrue(r["climbing"])
        self.assertTrue(r["stillClimbing"])
        self.assertTrue(r["offLadder"])
        # The let-go is a drop from where he hung: nowhere near the 20 m/s
        # the blast three seconds earlier would have given, and no flight.
        self.assertLess(r["fastest"], 8.0)
        self.assertIsNone(r["family"])

    def test_two_blasts_in_one_tick_add(self) -> None:
        r = self.results["twoBlasts"]
        self.assertAlmostEqual(r["each"], 20.0, places=2)
        self.assertAlmostEqual(r["horizontal"], r["expectedHorizontal"], places=2)


if __name__ == "__main__":
    unittest.main()
