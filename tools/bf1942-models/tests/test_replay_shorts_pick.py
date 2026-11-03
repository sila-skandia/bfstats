"""Replay Shorts' kill picker (viewer/replay-shorts-pick.js,
features/replay-shorts): which kills of a recording become Shorts.

A render job films the best few kills of each shared recording as 9:16
Shorts. The picker classes each kill by what the two men were in (air to air,
ground to air, tank to tank, a long shot on foot), titles it from its facts,
keys it so it is never clipped twice, and picks at most three a recording,
one of a kind first and never two of the same moment.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_shorts_pick_harness.mjs"


class ShortsPickTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_a_hull_is_classed_from_the_trees_models(self) -> None:
        # Armour is a land hull of 100 hit points or more that is not a gun on
        # the ground; a jeep is land, a mortar is land whatever its points.
        self.assertEqual(self.r["hullKinds"], ["armour", "armour", "land", "land", "air", "sea", None])

    def test_a_kill_is_classed_by_what_both_men_were_in(self) -> None:
        k = self.r["kinds"]
        self.assertEqual(k["airToAir"], "air-to-air")
        self.assertEqual(k["groundToAir"], "ground-to-air")
        self.assertEqual(k["aaFromFoot"], "ground-to-air")
        self.assertEqual(k["tankToTank"], "tank-to-tank")
        self.assertEqual(k["longShot"], "long-shot")
        # Not worth a Short: armour on a jeep or a mortar, a rifle kill under
        # 100 m, a thrown grenade, a tank on a man on foot.
        for name in ("tankToJeep", "tankToMortar", "shortShot", "longGrenade", "tankOnFoot"):
            self.assertIsNone(k[name], name)

    def test_the_key_is_the_apis(self) -> None:
        self.assertEqual(self.r["key"], "xhf8sfkt7k:1664.89:6")

    def test_titles_are_written_from_the_facts(self) -> None:
        self.assertEqual(self.r["levels"], ["Meuse River Line", "El Alamein", "Battle of the Bulge"])
        self.assertEqual(self.r["titles"], [
            "M4A1 kills TIGER at 192 m",
            "Mustang downs Bf109 at 410 m",
            "Bazooka downs Bf109 at 120 m",
            "412 m K98Sniper shot on Bocage",
            # A kill line and its round naming no weapon: no "null" in a title.
            "206 m shot on Omaha Beach",
            # Own goals: a crash, a fall, his own charge (a WASTED Short).
            "Spitfire pilot crashes on Battle of Britain",
            "Falls 36 m to his death on Meuse River Line",
            "Blown up by his own Satchel on Meuse River Line",
        ])

    def test_one_of_a_kind_first_never_two_of_one_moment(self) -> None:
        # Best tank kill, the long shot, then the best of the rest that is not
        # the moment already taken (104 s is 4 s after 100 s).
        self.assertEqual(self.r["picked"], [100, 300, 500])
        self.assertEqual(self.r["pickedOne"], [100])
        # Kills already clipped are left out.
        self.assertEqual(self.r["pickedTaken"], [104, 300, 700])


    def test_a_kill_the_recording_does_not_hold_whole_is_left_out(self) -> None:
        # A plane sampled every 0.1 s throughout is whole. One the recorder had
        # out of range for 0.8 s moved 90 m with nothing in between: a hop on
        # screen (the Mustang on Battle of Britain, 2026-11-03). A gap before
        # the stretch the Short shows does not count.
        c = self.r["continuity"]
        self.assertEqual(c["whole"], {"ok": True, "why": None})
        self.assertEqual(c["hop"], {"ok": False, "why": "hops 90 m at 4.9"})
        self.assertEqual(c["hopOutside"], {"ok": True, "why": None})

if __name__ == "__main__":
    unittest.main()
