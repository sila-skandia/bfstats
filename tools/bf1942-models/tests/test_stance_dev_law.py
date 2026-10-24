"""The page's hand-weapon cone is the server's, by stance, movement and jump.

`lab/stance_dev_probe.mjs` drove a sidecar soldier with the BAR on the lab
(vanilla Wake co-op, a REC_FIRE_INDEX recorder): taps standing, walking, at
100 / 300 / 600 ms after he stops, at 150 / 400 / 900 / 1300 ms after a jump,
a burst, crouched and prone, still and moving. `lab/stance_dev_check.py`
read each round's total off its draw at the server's input index (DEV-9,
DEV-14); `fixtures/stance_dev_bar.json` keeps those totals and the words.

`stance_dev_law_harness.mjs` replays the words through `viewer/deviation.js`
one tick a serial, as `hand-fire.js` feeds it. The misc channel's gate is
the bool `BFSoldier::handlePlayerInput` hands `HandFireArms::updateDeviation`
(lnxded 0x08274d7d..0x08274d99, ledger DEV-15): c_PIAction while armed on
the ground and standing, the jump's own tick. The page's earlier gate, every
tick off the ground, put a shot just after landing 1.8 wider than the server.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("stance_dev_law_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class StanceDeviationLawTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_every_lab_round_is_drawn_in_the_servers_cone(self) -> None:
        rounds = self.results["jump"]
        self.assertEqual(28, len(rounds))
        for r in rounds:
            self.assertAlmostEqual(r["server"], r["page"], delta=0.005, msg=r)

    def test_each_case_the_probe_ran_is_in_the_fixture(self) -> None:
        phases = {r["phase"].split(":")[0] for r in self.results["jump"]}
        self.assertTrue({"walk", "settle", "jump", "burst", "crouch", "prone"} <= phases, phases)

    def test_the_cone_after_a_jump_decays_from_the_take_off(self) -> None:
        jumps = [r for r in self.results["jump"] if r["phase"].startswith("jump")]
        self.assertEqual([2.85, 2.05, 0.75, 0.75], [round(r["server"], 2) for r in jumps])

    def test_the_old_airborne_gate_misses_the_server(self) -> None:
        worst = max(abs(r["server"] - r["page"]) for r in self.results["air"])
        self.assertGreater(worst, 1.5)

    def test_a_soldiers_jump_is_one_raise_however_long_he_flies(self) -> None:
        ticks = self.results["soldier"]
        self.assertEqual(1, sum(t["jumps"] for t in ticks))
        self.assertEqual(1, ticks[0]["jumps"])
        airborne = sum(1 for t in ticks if not t["grounded"])
        self.assertGreater(airborne, 15)
        # 0.75 + (2.5 - 0.1) on the jump tick, then 0.1 a tick.
        for k, t in enumerate(ticks[:24]):
            self.assertAlmostEqual(max(0.75, 3.15 - 0.1 * k), t["total"], delta=1e-3, msg=k)


if __name__ == "__main__":
    unittest.main()
