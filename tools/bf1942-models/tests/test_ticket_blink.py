"""The ticket blink above the minimap, by the retail client's own rule (`viewer/ticket-feed.js` ticketBlinks).

The server sends nothing that says a side bleeds: the client sums each side's area value over the points it
holds and blinks the other side's tickets at 100 or more (map draw 0x0046a680), tickets <= 10 in
ObjectiveMode, in Conquest, CoOp and ObjectiveMode only. On Wake's co-op layer the Allies hold all five
points at 20 each, so the Japanese tickets blink, and losing one point stops it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("ticket_blink_harness.mjs")


class TicketBlinkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_wake_coop_blinks_the_japanese(self) -> None:
        self.assertEqual(sum(w for _, team, w in self.r["wakeCoop"]["weights"] if team == 2), 100)
        self.assertEqual(self.r["wakeCoop"]["blinks"], {"1": True, "2": False})

    def test_taking_a_point_stops_it(self) -> None:
        self.assertEqual(self.r["beachTaken"], {"1": False, "2": False})

    def test_conquest_follows_the_same_rule(self) -> None:
        self.assertEqual(self.r["conquestSame"], {"1": True, "2": False})

    def test_tdm_and_ctf_never_blink(self) -> None:
        self.assertEqual(self.r["tdm"], {"1": False, "2": False})
        self.assertEqual(self.r["ctf"], {"1": False, "2": False})

    def test_objective_mode_blinks_at_ten_tickets(self) -> None:
        self.assertEqual(self.r["objective"]["low"], {"1": True, "2": False})
        self.assertEqual(self.r["objective"]["none"], {"1": False, "2": False})


if __name__ == "__main__":
    unittest.main()
