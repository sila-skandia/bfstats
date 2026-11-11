"""The briefing screen's credit line for a generated bot layer (viewer/briefing-screen.js)."""

import json
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "briefing_bot_credit_harness.mjs"


class BriefingBotCredit(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"briefing_bot_credit_harness.mjs failed:\n{proc.stderr[-3000:]}")
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_a_generated_layer_is_credited_under_comments(self) -> None:
        self.assertEqual(self.out["credit"], "Bot support added by skandia | bfstats.io")
        self.assertEqual(self.out["generated"], self.out["credit"])
        self.assertEqual(self.out["noComments"], self.out["credit"])

    def test_the_levels_own_words_come_first(self) -> None:
        self.assertEqual(self.out["withWords"], "Hold the ridge. | Bot support added by skandia | bfstats.io")

    def test_a_level_with_shipped_ai_or_none_is_left_as_it_was(self) -> None:
        self.assertEqual(self.out["shipped"], "Hold the ridge.")
        self.assertEqual(self.out["shippedEmpty"], "")
        self.assertEqual(self.out["noAi"], "")


if __name__ == "__main__":
    unittest.main()
