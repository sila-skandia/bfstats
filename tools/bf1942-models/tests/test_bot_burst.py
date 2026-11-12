"""A soldier bot's bursts (`tests/bot_burst_harness.mjs`).

The owner's report (2026-11-12): bots fire their automatic weapons oddly,
round by round, where they should burst. Retail's bots, in the lab's server
recordings of Wake co-op (`~/bf1942-lab/runs/*/server/replay_*.ndjson`, the
`f` records of every bot round), fire a Thompson as 2 rounds 3 ticks apart
then 9 ticks of nothing, a Type99, BAR or Mp18 as 2 rounds 4 apart then 8,
each burst starting 12 ticks (+-1) after the last, a burst sometimes a single
round; and a rifle one round a period. The page's bot holds its trigger on the
same clock (`bot-fire.js triggerWindow`: down from the 6th tick of every 12,
for at most the plan's round budget, `fireRoundBudget`, ledger AI-131 read
with its truncation). These tests pin, through the referee's own fire timer:

* an automatic's rounds per burst (1 or 2) and the gaps inside and between
  bursts (its cycle, then 12 ticks start to start);
* a bolt rifle's one round per burst, its next on the first window after its
  cycle (the K98's 81 ticks wait for the 84th);
* the budget law: 1 to 9 for a burst weapon (10 only at u = 1), its rounds
  held to [1, 10], 2 to 4 for any other weapon.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_burst_harness.mjs"
_CACHE: dict | None = None


def run_harness() -> dict:
    global _CACHE
    if _CACHE is None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        _CACHE = json.loads(proc.stdout.strip().splitlines()[-1])
    return _CACHE


def row(name: str) -> dict:
    return next(r for r in run_harness()["rows"] if r["name"] == name)


class AutomaticBurstTests(unittest.TestCase):
    def check_automatic(self, name: str, cycle: int) -> None:
        r = row(name)
        # Bursts of 1 or 2 rounds, mostly 2 (a budget of 1 is one draw in 9).
        self.assertEqual(set(r["hist"]), {"1", "2"}, r)
        self.assertGreater(r["hist"]["2"], 3 * r["hist"]["1"], r)
        # Inside a burst the weapon's own cycle, never a held stream.
        self.assertEqual(r["inside"], [cycle], r)
        # A 2-round burst then the rest of the 12-tick period, starts 12 apart
        # (a reload's span aside, and the first burst after one).
        self.assertEqual(max(r["between"], key=lambda g: r["between"][g]), str(12 - cycle), r)
        steady = {int(g): n for g, n in r["starts"].items() if int(g) < 60}
        self.assertEqual(max(steady, key=steady.get), 12, r)
        self.assertGreater(steady[12] / sum(steady.values()), 0.85, r)
        self.assertLessEqual(max(steady), 12, r)
        # The trigger goes down 6 ticks into the period.
        self.assertEqual(r["offsets"][0], run_harness()["clock"]["triggerDelayTicks"], r)

    def test_thompson_fires_two_round_bursts_every_twelve_ticks(self):
        self.check_automatic("Thompson", 3)

    def test_type99_fires_two_round_bursts_every_twelve_ticks(self):
        self.check_automatic("Type99", 4)


class BoltRifleTests(unittest.TestCase):
    def test_k98_fires_one_round_on_the_first_window_after_its_cycle(self):
        r = row("K98")
        self.assertEqual(r["hist"], {"1": r["rounds"]}, r)
        self.assertEqual(r["inside"], [], r)
        within = {int(g): n for g, n in r["between"].items() if int(g) < 100}
        # `roundOfFire 0.37`: an 81-tick timer, the next window opens at 84.
        self.assertEqual(within, {84: within.get(84, 0)}, r)
        self.assertGreaterEqual(within[84], 15, r)


class BudgetTests(unittest.TestCase):
    def test_the_budget_truncates(self):
        b = run_harness()["budgets"]
        self.assertEqual(b["burst10"], list(range(1, 10)))
        self.assertEqual(b["burstUnlimited"], list(range(1, 10)))
        self.assertEqual(b["burst3"], [1, 2])
        self.assertEqual(b["single"], [2, 3, 4])
        self.assertEqual((b["burstTop"], b["singleTop"]), (10, 5))
        self.assertAlmostEqual(b["burstOneShare"], 1 / 9, places=3)


if __name__ == "__main__":
    unittest.main()
