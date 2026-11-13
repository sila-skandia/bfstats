"""Two small room notices: the host is told when the memory cap gave the room
fewer bots than the settings allow, and the room's HELLO says which tier runs."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"


class BotTierLineTests(unittest.TestCase):
    def test_a_lower_tier_is_named_and_the_top_tier_is_silent(self) -> None:
        code = ("import {botTierLine} from './chat-log.js';"
                "console.log(JSON.stringify([botTierLine(3, 3), botTierLine(null, 3), botTierLine(0, 3),"
                "botTierLine(1, 3), botTierLine(2, 3), botTierLine(1, 1)]))")
        out = subprocess.run(["node", "--input-type=module", "-e", code], cwd=VIEWER,
                             capture_output=True, text=True, check=True).stdout
        lines = json.loads(out.strip().splitlines()[-1])
        self.assertEqual([None, None], [lines[0], lines[1]])
        self.assertIn("no bots", lines[2])
        self.assertIn("on foot only", lines[3])
        self.assertIn("in ships", lines[4])
        self.assertIsNone(lines[5])


if __name__ == "__main__":
    unittest.main()
