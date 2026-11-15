"""Match recaps' picker (viewer/replay-recap-pick.js, features/match-recap).

A recap is a round's key moments the recording player saw well, faded one
into the next, then its "salt": the angriest lines of its chat (the owner,
2026-11-15). These tests hold the salt's scoring, which lines it shows and
never shows, and what the moment checks call a stutter.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_recap_pick_harness.mjs"


class RecapPickTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_a_line_is_salty_for_its_swearing_accusations_and_insults(self) -> None:
        scores = self.r["scores"]
        self.assertEqual(scores[0], 4)        # fucking asshole
        # Capitals alone are hype, not salt (Corfu: "LETS SINK THESE JERMANS").
        self.assertEqual(scores[1], 0)
        # "BANZAI" is not a call for a ban.
        self.assertEqual(scores[2], 0)
        # An apology takes a swear down.
        self.assertLess(scores[3], 0)
        # Shouted and angry scores more than angry: WORTHLESS BS over stupid camper.
        self.assertGreater(scores[4], scores[5])
        self.assertLess(scores[6], 0)         # nice shot
        # A slur scores nothing and is never shown.
        self.assertEqual(scores[8], 0)
        self.assertTrue(self.r["slur"])

    def test_each_angry_word_is_marked_for_the_salt_colour(self) -> None:
        self.assertEqual(self.r["hot"], [[0, 6], [7, 14], [15, 21]])

    def test_a_chat_line_splits_into_its_speaker_and_body(self) -> None:
        team, server = self.r["parts"]
        self.assertEqual(team, {"name": "Tyson", "body": "admin????", "teamChat": True})
        self.assertEqual(server["name"], "")

    def test_the_salt_is_the_rants_of_men_in_round_order(self) -> None:
        # Two lines of one man close together are one slide; the same line
        # again later is not shown twice. Never a bot, the server, a command,
        # a slur, or a man whose name carries one.
        self.assertEqual(self.r["salt"], [
            {"name": "Maj.MerliN", "team": 2, "teamChat": False,
             "lines": ["HOW FUQING STUPID ARE U", "UR AN IDIOT AND THIS IS PROOF"]},
            {"name": "Tyson", "team": 1, "teamChat": True,
             "lines": ["stop raping main base MORON", "admin????"]},
        ])
        for secs in self.r["secs"]:
            self.assertGreaterEqual(secs, 2.6)
            self.assertLessEqual(secs, 5)

    def test_a_stutter_is_a_sparse_gap_while_he_moves(self) -> None:
        # Kursk and Caen (2026-11-14): 0.104 s between samples out to 250 m
        # from the recorder, 0.2 s past 300. A man standing still has no keys
        # and does not stutter.
        g = self.r["gaps"]
        self.assertEqual(g["full"], 0)
        self.assertAlmostEqual(g["stutter"], 0.2, places=3)
        self.assertGreater(g["stutter"], self.r["tune"]["gap"])
        self.assertEqual(g["standing"], 0)
        self.assertEqual(g["outside"], 0)

    def test_a_split_screen_is_for_a_couple_of_moments(self) -> None:
        # The owner, 2026-11-15: "maybe just in a couple of interesting frames".
        self.assertEqual(self.r["tune"]["duels"], 2)


if __name__ == "__main__":
    unittest.main()
