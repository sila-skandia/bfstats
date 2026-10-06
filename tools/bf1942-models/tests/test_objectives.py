"""`viewer/objectives.js` and ObjectiveMode's round in `viewer/round-state.js`,
driven headless by `objectives_harness.mjs` (ledger OBJ-1..OBJ-6).

What is under test is the server's law, read 2026-10-07:

  - every objective asks `evaluate` until it is met, pays its immediate
    award, then waits out `objectiveDelay` and is done (`Objective::
    handleUpdate` 0x083112e0);
  - a Composite or a Timer that is done wins the round for its side, a total
    victory (`TeamWinsAward::give` 0x08310c20); a DestroyTarget pays its
    destroyer `objective` or `objectiveTK` by his side (`PlayerAward`);
  - the Timer's limit is `timeLimit * objectiveAttackerTicketsMod / 100`;
  - the defender starts on a flat 100, an attacker's death costs a ticket
    and a defender's none, and each side's HUD count is its real count times
    one less the enemy root objective's completion, truncated.

`test_objective_setup.py` covers the exporter that writes the report.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("objectives_harness.mjs")
MODULES = {"objectives.js": VIEWER / "objectives.js",
           "round-state.js": VIEWER / "round-state.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type": "module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ObjectiveModeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_defender_starts_on_a_flat_hundred(self):
        start = self.results["start"]
        # Axis: 100 at 32 slots is 200; the Allies set none and get 100.
        self.assertEqual({"1": 200, "2": 100}, start["tickets"])
        self.assertEqual(start["objective"], start["gpm"])

    def test_the_timer_wins_three_seconds_after_its_limit(self):
        timer = self.results["timer"]
        self.assertEqual("playing", timer["half"]["status"])
        self.assertAlmostEqual(0.5, timer["half"]["completion"], places=6)
        # Halfway the Axis HUD count is halved (99, not 100, from the 30 Hz
        # sum's last bit), the Allies' untouched.
        self.assertIn(timer["half"]["tickets"]["1"], (99, 100))
        self.assertEqual(100, timer["half"]["tickets"]["2"])
        # Past 900 s the timer is met but not yet done: its 3 s delay runs.
        self.assertEqual("playing", timer["atLimit"]["status"])
        self.assertFalse(timer["atLimit"]["timerDone"])
        self.assertEqual(0, timer["atLimit"]["tickets"]["1"])
        end = timer["end"]
        self.assertEqual(("endGame", 2, end["total"], "objective"),
                         (end["status"], end["winner"], end["type"], end["reason"]))
        self.assertGreater(end["clock"], 903.0)
        self.assertLess(end["clock"], 903.2)
        self.assertEqual({"1": 0, "2": 1}, end["roundsWon"])

    def test_the_server_mod_stretches_the_timer(self):
        # At 50 the limit is 450 s, and the round is over by 453.2 s.
        self.assertEqual({"status": "endGame", "winner": 2}, self.results["mod50"])

    def test_targets_end_the_round_for_the_attacker(self):
        t = self.results["targets"]
        # Half the factory gone is a tenth of the composite: the Allied HUD 90.
        self.assertAlmostEqual(0.1, t["damaged"]["completion"], places=6)
        self.assertEqual(90, t["damaged"]["tickets"]["2"])
        # A destroyed target is met at once and done a second later.
        self.assertFalse(t["pending"]["factoryDone"])
        self.assertTrue(t["met"]["factoryDone"])
        # The Axis bomber is paid `objective` (5), the Allied soldier who
        # blew up his own tower `objectiveTK` (-15).
        self.assertEqual((5, 1), (t["met"]["score7"], t["met"]["objectives7"]))
        self.assertEqual((-15, 1), (t["met"]["score9"], t["met"]["objectiveTks9"]))
        self.assertEqual(["objective", "objectiveTk", "objective", "objective", "objective"],
                         [a["kind"] for a in t["awards"]])
        # All five met: the Allied HUD reads 0, the composite waits its 3 s.
        self.assertEqual(("playing", False, 0),
                         (t["allMet"]["status"], t["allMet"]["composite"], t["allMet"]["alliedTickets"]))
        self.assertEqual({"status": "endGame", "winner": 1, "type": 3, "reason": "objective"}, t["end"])

    def test_only_the_attackers_deaths_cost(self):
        d = self.results["deaths"]
        self.assertEqual({"1": 199, "2": 100}, d["real"])
        # The Axis HUD count also carries the timer's first 0.1 s.
        self.assertEqual(198, d["tickets"]["1"])

    def test_a_restart_makes_the_objectives_anew(self):
        r = self.results["restart"]
        self.assertEqual("endGame", r["ended"])
        self.assertEqual(("playing", {"1": 200, "2": 100}, 0, False),
                         (r["status"], r["tickets"], r["timer"], r["done"]))
        self.assertEqual({"1": 0, "2": 1}, r["roundsWon"])

    def test_an_absent_target_reads_met_but_never_wins(self):
        # `getCompletion` answers 1 with no object to watch; `evaluate` never
        # answers yes without one.
        a = self.results["absent"]
        self.assertEqual(0, a["tickets"]["2"])
        self.assertEqual(("playing", False), (a["status"], a["composite"]))

    def test_secret_weapons_sides_are_swapped(self):
        n = self.results["nest"]
        # The Axis defend: their flat 100, the Allies' 100 at 16 slots.
        self.assertEqual({"1": 100, "2": 100}, n["start"])
        # One door gone and half the safe: the Axis HUD count is at a quarter.
        self.assertEqual(25, n["mid"]["1"])
        self.assertEqual(("endGame", 2), (n["status"], n["winner"]))

    def test_each_target_finds_its_pad(self):
        self.assertEqual({"factory01": "a", "radartower01": "b"}, self.results["match"])

    def test_other_modes_keep_their_rules(self):
        c = self.results["conquest"]
        self.assertEqual({"1": 100, "2": 99}, c["tickets"])
        self.assertIsNone(c["real"])


if __name__ == "__main__":
    unittest.main()
