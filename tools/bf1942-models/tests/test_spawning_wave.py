"""The page's own player waits for the reinforcement wave (SPAWN-35).

Retail runs one GameServer for single player and Instant Battle too
(`GameServer::init` 0x08131cd0 turns waves on for every one), so the local
player's death waits for the next spawn window as any player's does
(`killPlayer` 0x0814d920; `gameStatusPlaying` stands nobody whose wait is not
spent, 0x08152917..0x08152987). The page stood the body the moment the player
committed. `viewer/spawning.js` now holds a commit for the wave on the round's
clock, and in a room for its server's `sw`. Driven in node over a stub page by
`tests/spawning_wave_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "spawning_wave_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class SpawningWaveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_fresh_join_spawns_at_once(self) -> None:
        self.assertTrue(self.r["join"]["stood"])
        self.assertFalse(self.r["join"]["waiting"])

    def test_a_death_paints_the_plate_off_a_relay(self) -> None:
        self.assertTrue(self.r["deathAt10"]["plate"].startswith("TIME TO SPAWN: "))

    def test_a_commit_before_the_wave_waits_for_it(self) -> None:
        c = self.r["commitAt13"]
        self.assertFalse(c["stood"])
        self.assertTrue(c["waiting"])
        self.assertFalse(c["screenOpen"])          # closed to the free camera
        self.assertAlmostEqual(12, c["left"], delta=0.05)
        self.assertAlmostEqual(25, c["stoodAt"], delta=0.05)

    def test_suicide_is_a_death_with_its_wave(self) -> None:
        s = self.r["suicide"]
        self.assertFalse(s["soldier"])
        self.assertTrue(s["waiting"])
        self.assertAlmostEqual(10, s["left"], delta=0.05)
        self.assertAlmostEqual(50, s["stoodAt"], delta=0.05)

    def test_a_restart_forgets_the_old_rounds_wait(self) -> None:
        self.assertTrue(self.r["afterRestart"]["stood"])

    def test_a_room_waits_for_its_servers_word(self) -> None:
        room = self.r["room"]
        self.assertFalse(room["stood"])
        self.assertTrue(room["waiting"])
        self.assertTrue(room["stoodAfterWait"])


if __name__ == "__main__":
    unittest.main()
