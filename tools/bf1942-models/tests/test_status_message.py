"""`viewer/status-message.js`: the respawn HUD's status line on a retail server.

The client's law is `FUN_006ad0a0` (ledger HUD-24): while its latch is clear it
shows "ADDITIONAL PLAYERS NEEDED UNTIL GAME STARTS: n" (min players less the
player count, above 0) or, once the count is reached, "GAME IS RESTARTING" for
a six-second timer hidden under one second; the end of a round clears the
latch. The lab's Wake server sends a min of 2 in its SetLevel.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
HARNESS = Path(__file__).resolve().parent / "status_message_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "status-message.js", work / "status-message.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class StatusMessageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_enough_players_is_game_is_restarting_for_five_seconds(self) -> None:
        j = self.out["join"]
        self.assertEqual("GAME IS RESTARTING", j["first"])
        # 6.0 less 0.1 a frame: still up at 4.9 s gone, hidden under 1.0 left.
        self.assertEqual("GAME IS RESTARTING", j["at49"])
        self.assertIsNone(j["at50"])
        self.assertIsNone(j["last"])

    def test_short_of_players_counts_them(self) -> None:
        s = self.out["short"]
        self.assertEqual("ADDITIONAL PLAYERS NEEDED UNTIL GAME STARTS: 2", s["short"])
        self.assertEqual("ADDITIONAL PLAYERS NEEDED UNTIL GAME STARTS: 1", s["nearly"])
        self.assertEqual("GAME IS RESTARTING", s["enough"])

    def test_the_end_of_a_round_shows_it_again(self) -> None:
        self.assertFalse(self.out["restart"]["before"])
        self.assertEqual("GAME IS RESTARTING", self.out["restart"]["after"])

    def test_nothing_known_shows_nothing(self) -> None:
        self.assertIsNone(self.out["unknown"])


if __name__ == "__main__":
    unittest.main()
