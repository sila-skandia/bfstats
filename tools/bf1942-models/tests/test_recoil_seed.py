"""A human's recoil kick is drawn from his round's input index (ledger FA-22).

`BFSoldier::calcRecoil` (lnxded 0x0827e2f0) seeds its `Random` from
`Game::getCurrentInputIndex()` and draws the pitch and then the yaw by
`getContinuousRandom`. On the lab a sidecar soldier's held BAR moved its aim
between two rounds by exactly the ride of the first round's draw at its own
index: 61 pairs, `fixtures/recoil_seed_bar.json` (lab/recoil_seed_check.py).
The page drew its own kick from the gun's dice, so after every round its
view and the server's aim went their separate ways by up to 0.35 deg of yaw.

`recoil_seed_harness.mjs` arms `viewer/recoil.js` with `inputRecoilRand` at
each pair's first index and runs the ride over the ticks to the next round.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("recoil_seed_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RecoilSeedTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_seeded_ride_moves_the_aim_as_the_server_did(self) -> None:
        pairs = self.results["seeded"]
        self.assertEqual(61, len(pairs))
        for p in pairs:
            self.assertAlmostEqual(p["dYaw"], p["yaw"], delta=2e-4, msg=p)
            self.assertAlmostEqual(p["dPitch"], p["pitch"], delta=2e-4, msg=p)

    def test_dice_do_not(self) -> None:
        worst = max(abs(p["dYaw"] - p["yaw"]) for p in self.results["dice"])
        self.assertGreater(worst, 0.2)

    def test_no_index_no_seeded_draw(self) -> None:
        self.assertIsNone(self.results["noIndex"])


if __name__ == "__main__":
    unittest.main()
