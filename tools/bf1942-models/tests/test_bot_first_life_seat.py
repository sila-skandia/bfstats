"""A bot's first life takes the seat its spawn point gives (SPAWN-27).

`spawnBots` stands each bot on a flag before any hull has landed and cannot
ask a seat, so a point that only seats (`setEnterOnSpawn`) was never a first
spawn and a bot stood on a seat point never sat in it. On BF1918 fao_landing in
Conquest the British own no control point: all eight bots stood on the Gnat's
point and none took any of the eleven landing boats, for the whole round
(tester finding F7, 2026-11-11). `bot-referee.js` `placeFirstLives` redoes
each first life the way `respawnTick` does a respawn, on the first tick that
has a seat to give. `tests/bot_first_life_seat_harness.mjs` runs it on the
level's own spawn points.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_first_life_seat_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class FirstLifeSeatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_boats_are_a_first_spawn_and_seat_their_bots(self) -> None:
        run = self.r["ready"]
        self.assertFalse(run["pending"])
        british = [b for b in run["after"] if b["team"] == 2]
        self.assertEqual(["gnatdriversoldierspawn", "b_spawner1"] * 2, [b["flag"] for b in british])
        boats = {b["id"] for b in british if b["flag"] == "b_spawner1"}
        self.assertEqual(boats, {s["id"] for s in run["seated"]})

    def test_each_bot_gets_a_seat_of_his_own(self) -> None:
        seats = [s["seat"] for s in self.r["crowded"]["seated"]]
        self.assertEqual(3, len(seats))
        self.assertEqual(len(seats), len(set(seats)))

    def test_a_side_with_no_seat_point_keeps_its_first_life(self) -> None:
        for name in ("ready", "crowded"):
            run = self.r[name]
            for before, after in zip(run["before"], run["after"]):
                if before["team"] == 1:
                    self.assertEqual(before, after)

    def test_it_waits_for_the_hulls_then_gives_up(self) -> None:
        waiting = self.r["notLanded"]
        self.assertTrue(waiting["pending"])
        self.assertEqual(waiting["before"], waiting["after"])
        self.assertEqual([], waiting["seated"])
        late = self.r["late"]
        self.assertFalse(late["pending"])
        self.assertEqual(late["before"], late["after"])


if __name__ == "__main__":
    unittest.main()
