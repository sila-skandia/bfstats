"""`spawnBots` hands no bot a flag whose carriers are all down (Essen's Allies
started at the world origin: the carried paratroop group sat second in their
flag list and every Allied bot indexed it) (`tests/bot_spawn_flags_harness.mjs`)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_spawn_flags_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class BotSpawnFlagsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_every_allied_bot_starts_on_the_airfield_not_the_downed_carrier(self) -> None:
        allied = [b for b in self.r["carried"] if b["team"] == 2]
        self.assertEqual(4, len(allied))
        self.assertEqual({"alliedspawn1"}, {b["flag"] for b in allied})

    def test_the_other_side_is_untouched(self) -> None:
        axis = [b for b in self.r["carried"] if b["team"] == 1]
        self.assertEqual({"essen_front"}, {b["flag"] for b in axis})

    def test_a_side_with_every_flag_down_is_handed_none(self) -> None:
        allied = [b for b in self.r["allDown"] if b["team"] == 2]
        self.assertEqual([None, None], [b["flag"] for b in allied])

    def test_a_capture_only_flag_is_never_handed(self) -> None:
        self.assertEqual({"base"}, set(self.r["captureOnly"]))


if __name__ == "__main__":
    unittest.main()
