"""Soldier against soldier: pushed apart to 1.0 m.

`ResponsePhysics::checkObjectVsObject` lnxded 0x08259690 has a branch for two
`CID_SoldierTemplate` objects (0x9493, the global at 0x086c2b88), read on our
binary at 0x0825a4c7..0x0825a8f0: `d = posB - posA` in 3-D, nothing past
`|d|^2 > 1.0`, `n = d/|d|` or `(0, 0, 1)` below 0.01 (0x086c08a4),
`push = n (1 - |d|)` with its y zeroed, each side weighted
`max(|v . push|, 0.9 |push|)` (0x086d16c8), `posA -= push wA`,
`posB += push (1 - wA)`; positions only. Built as `world-soldier-tick.js`
`separateSoldiers`; the harness is `soldier_separation_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "soldier_separation_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class SoldierSeparationTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def assertAt(self, expected, got, places=3) -> None:
        for e, g in zip(expected, got):
            for a, b in zip(e, g):
                self.assertAlmostEqual(a, b, places=places)

    def test_the_engines_distance_is_one_metre(self) -> None:
        self.assertEqual(1.0, self.results["separation"])

    def test_two_still_soldiers_split_the_push(self) -> None:
        # Both at the 0.9 |push| floor: half each, to 1.0 m apart.
        self.assertAt([[9.7, 0, 10], [10.7, 0, 10]], self.results["still"])

    def test_the_one_moving_into_the_other_takes_more(self) -> None:
        # |vA . push| = 4 x 0.6 = 2.4 against B's 0.9 x 0.6 = 0.54.
        wa = 2.4 / (2.4 + 0.54)
        self.assertAt([[10 - 0.6 * wa, 0, 10], [10.4 + 0.6 * (1 - wa), 0, 10]],
                      self.results["running"])

    def test_coincident_soldiers_part_along_z(self) -> None:
        self.assertAt([[10, 0, 9.5], [10, 0, 10.5]], self.results["coincident"])

    def test_the_distance_is_three_d_and_the_push_flat(self) -> None:
        l = (0.3 ** 2 + 0.9 ** 2) ** 0.5
        k = (0.3 / l) * (1 - l) / 2
        self.assertAt([[10 - k, 0, 10], [10.3 + k, 0.9, 10]], self.results["stacked"])

    def test_past_a_metre_nothing_moves(self) -> None:
        self.assertAt([[10, 0, 10], [11.05, 0, 10]], self.results["apart"])

    def test_the_dead_the_seated_and_the_undeployed_meet_nobody(self) -> None:
        for key in ("dead", "seated", "unspawned"):
            self.assertAt([[10, 0, 10], [10.4, 0, 10]], self.results[key])

    def test_a_push_stops_at_a_wall(self) -> None:
        a, b = self.results["wall"]
        self.assertAlmostEqual(9.7, a[0], places=3)
        # The capsule (0.39 m) stops a skin (0.01 m) short of the wall.
        self.assertAlmostEqual(10.89 - 0.39 - 0.01, b[0], places=3)

    def test_each_pair_once_in_order(self) -> None:
        self.assertAt([[9.75, 0, 10], [10.375, 0, 10], [11.375, 0, 10]], self.results["row"])

    def test_the_world_tick_keeps_two_bots_a_metre_apart(self) -> None:
        w = self.results["world"]
        self.assertTrue(all(abs(g - 1.0) < 1e-3 for g in w["gaps"]), w["gaps"])
        self.assertAlmostEqual(0.4, w["moved"], places=3)


if __name__ == "__main__":
    unittest.main()
