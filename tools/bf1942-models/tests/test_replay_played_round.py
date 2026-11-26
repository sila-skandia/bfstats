"""The round a recording is about, of every round it holds.

A server recording opens a new file when the level unloads or changes and,
since 2026-11-26, when a round restarts on the same level. Files from before
that hold every round a one-level server played: owlserver's q8uwcxrjcg is two
empty rounds, a round heph waited out alone, then the 1v1 that began when the
second player joined and the server reset the round. Read as its first round
it "ended" at 1220 s and every kill after was dropped (no kill feed, no body
fell). The viewer takes the round with the most score events, and opens
playback a few seconds before its play when other rounds come first
(features/server-replay-recorder/README.md, "One file a round").

Run under node through `replay_played_round_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_played_round_harness.mjs"


class ReplayPlayedRoundTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_a_file_of_many_rounds_is_about_the_one_played(self) -> None:
        owl = self.results["owl"]
        self.assertEqual(owl["started"], 3168.3)
        self.assertEqual(owl["ended"], 4731.2)
        self.assertEqual(owl["kills"], [3194.3, 3231.6, 3386.0])
        self.assertEqual(owl["result"], {"t": 4731.2, "winner": 1, "victory": 3})

    def test_playback_opens_where_that_round_plays(self) -> None:
        self.assertAlmostEqual(self.results["owl"]["playFrom"], 3165.3)

    def test_a_one_round_file_is_as_it_was(self) -> None:
        one = self.results["one"]
        self.assertEqual((one["started"], one["ended"], one["kills"]), (5, 900, [40]))
        self.assertEqual(one["playFrom"], 0)

    def test_a_join_mid_round_has_no_start(self) -> None:
        joined = self.results["joined"]
        self.assertIsNone(joined["started"])
        self.assertEqual((joined["ended"], joined["kills"], joined["playFrom"]), (300, [30], 0))

    def test_rounds_with_no_score_take_the_first(self) -> None:
        quiet = self.results["quiet"]
        self.assertEqual((quiet["started"], quiet["ended"], quiet["playFrom"]), (5, 100, 0))


if __name__ == "__main__":
    unittest.main()
