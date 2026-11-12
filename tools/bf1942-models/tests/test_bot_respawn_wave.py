"""A downed bot waits for the reinforcement wave (SPAWN-35).

Retail's `GameServer::killPlayer` (lnxded 0x0814d920) gives every BFPlayer,
bots included, a wait to the next spawn window (0x0814dee8..0x0814df13), and
`gameStatusPlaying` stands a dead bot only once it is spent
(0x08152917..0x08152987). Windows are 5 s long every 20 + 5 s from the round's
start. `bot-referee.js` `respawnTick` used a flat 8 s of its own
(`BOT_RESPAWN_DELAY`). `tests/bot_respawn_wave_harness.mjs` drives the
referee on a round clock it owns.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_respawn_wave_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class BotRespawnWaveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_death_with_more_than_a_window_to_go_waits_for_the_next(self) -> None:
        r = self.r["at10"]
        self.assertEqual(15, r["waitAtDeath"])
        self.assertAlmostEqual(25, r["stood"], delta=0.05)

    def test_a_window_or_less_to_go_waits_for_the_one_after(self) -> None:
        r = self.r["at46"]
        self.assertEqual(29, r["waitAtDeath"])
        self.assertAlmostEqual(75, r["stood"], delta=0.05)

    def test_a_death_no_hit_path_saw_waits_too(self) -> None:
        # Found down on the next tick (a wreck, the world's own damage): the
        # wait runs from there, never the old instant respawn.
        self.assertAlmostEqual(100, self.r["unseen"]["stood"], delta=0.05)


if __name__ == "__main__":
    unittest.main()
