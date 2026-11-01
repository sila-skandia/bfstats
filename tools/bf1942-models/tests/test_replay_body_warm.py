"""The replay loads its soldiers' bodies before it shows (replay-bodies.js
`warmAt`, called from replay.js `load`).

The owner's report (2026-11-01): ilw's body was not drawn at 2:15 of
ymdy248edr. Every soldier was missing, not ilw: on a fresh page the first
seek drew 0 of 19 bodies for 2.5 s on the live site while their pose pairs
loaded; a second seek drew them in 0.3 s. The load now fetches every kit's
pose pair, those of the men alive where the replay opens first, waiting at
most ten seconds for them.

Run under node through `replay_body_warm_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_body_warm_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayBodyWarmTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_men_alive_at_the_opening_come_first(self) -> None:
        # At 350 the medic and the assault man are alive; the scout is not.
        self.assertEqual(self.results["at350"]["warmed"], [
            "BritishSoldier|2|Thompson", "BritishSoldier|2|Bar1918", "BritishSoldier|2|Colt",
            "GermanSoldier|1|K98Sniper", "GermanSoldier|1|Luger",
        ])

    def test_every_kit_pair_of_the_round_once(self) -> None:
        for case in ("at350", "at0"):
            r = self.results[case]
            self.assertEqual(r["done"], 5)
            self.assertEqual(len(set(r["warmed"])), 5)
            self.assertEqual(r["first"], [0, 5])
            self.assertEqual(r["last"], [5, 5])

    def test_without_bodies_nothing_loads(self) -> None:
        self.assertEqual(self.results["noBodies"], 0)


if __name__ == "__main__":
    unittest.main()
