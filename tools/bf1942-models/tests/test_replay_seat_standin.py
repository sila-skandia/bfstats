"""A player seated when a recording began is drawn in the seat
(replay-bodies.js `seatStandIn`).

Why it exists. 2026-11-09: a creator cutting skandia's Mustang bomb run on
Bocage (`wxprh7ze6n`) noticed nobody in the plane. The recorder's opening
snapshot writes the soldiers on foot and not the seated ones, so a player
already in a vehicle has no soldier in the file until they die and respawn:
BF6 flew the Mustang for six minutes with an empty cockpit, and 20 more
players began that round seated. Who sits where is in the data, so the viewer
draws their side's soldier there. One node run
(`replay_seat_standin_harness.mjs`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_seat_standin_harness.mjs"

_cache: dict | None = None


def run_harness() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300, cwd=HARNESS.parent)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    _cache = json.loads(proc.stdout)
    return _cache


class SeatStandInTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_pilot_seated_from_the_start_is_drawn_until_their_first_death(self) -> None:
        s = self.r["seated"]
        self.assertTrue(s["standIn"])
        self.assertEqual(s["pid"], 6)
        self.assertEqual(s["tmpl"], "USSoldier")
        self.assertEqual(s["destroyed"], 371.751)
        # The kit of their first recorded life, the respawn's.
        self.assertEqual(s["kit"], "US_Medic")
        # They ride the hull's own track; never a network id of the file's.
        self.assertTrue(s["sharesHullTrack"])
        self.assertLess(s["nid"], 0)
        self.assertTrue(self.r["again"])

    def test_nothing_between_their_death_and_their_respawn(self) -> None:
        self.assertIsNone(self.r["afterDeath"])

    def test_the_recorded_soldier_wins_once_there_is_one(self) -> None:
        self.assertFalse(self.r["respawned"]["standIn"])
        self.assertEqual(self.r["respawned"]["nid"], 2359)
        self.assertFalse(self.r["onFoot"]["standIn"])

    def test_a_player_never_seen_on_foot_wears_their_sides_soldier(self) -> None:
        n = self.r["noLifeEver"]
        self.assertTrue(n["standIn"])
        self.assertEqual(n["tmpl"], "GermanSoldier")
        self.assertIsNone(n["kit"])

    def test_nobody_is_made_up_for_a_player_on_foot(self) -> None:
        self.assertIsNone(self.r["notSeated"])


if __name__ == "__main__":
    unittest.main()
