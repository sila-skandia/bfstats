"""`viewer/ctf-page.js` -- Capture the Flag on the page, driven headless by
`ctf_page_harness.mjs` on Desert Shield's two bases (ledger CTF-1..CTF-10,
`features/ctf-mode/README.md`): which layer plays it, which models it draws
the bases and flags with, the law over the page's players and the round it
pays, the lines in the mod's own words, the HUD's carrier icon (CTF-9), the
map's flag marks (CTF-10), the round's end stopping it, a room's rows, and a
Conquest level tearing it down.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "ctf_page_harness.mjs"


class CtfPageTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_only_a_ctf_layer_with_bases_plays_it(self) -> None:
        self.assertEqual({"ctf": True, "conquest": False, "bare": False}, self.results["plays"])

    def test_the_models_are_the_levels_names_then_the_shared_ones(self) -> None:
        c = self.results["candidates"]
        self.assertEqual({"pole": ["UKbase", "FlagPole"], "cloth": ["BrittishFlag", "AnimatedUkFlag"]}, c["uk"])
        # A level's own BlueFlag in the Japanese cloth falls back to its bundle.
        self.assertEqual(["BlueFlag", "AnimatedJapFlag"], c["blueJp"]["cloth"])

    def test_the_bases_and_flags_are_drawn_from_the_models_tree(self) -> None:
        s = self.results["setup"]
        self.assertTrue(s["active"])
        self.assertTrue(s["again"])
        self.assertEqual(["ctf-base-0", "ctf-flag-0", "ctf-base-1", "ctf-flag-1"], s["nodes"])
        self.assertEqual("models/mods/desertcombat/FlagPole.glb", s["models"]["pole0"])
        self.assertEqual("models/mods/desertcombat/AnimatedUkFlag.glb", s["models"]["cloth0"])
        self.assertEqual("models/mods/desertcombat/AnimatedGeFlag.glb", s["models"]["cloth1"])
        # The mod's tree, then vanilla's, for each name before the next name.
        self.assertEqual(["models/mods/desertcombat/UKbase.glb", "models/UKbase.glb"],
                         [u for u in s["loads"] if "UKbase" in u])
        # Home is the base plus setFlagLocation 0/7.6/0 (CTF-1).
        self.assertEqual([804.59, 87.56, -375.59], s["drawnHome"][0])

    def test_the_law_runs_over_the_pages_players(self) -> None:
        play = self.results["play"]
        self.assertEqual(["stole", "stole", "dropped", "returned", "captured"], play["timeline"])
        self.assertEqual(5, play["hansCarrying"]["carrier"])
        # A carried flag is drawn over the carrier's head (a viewer choice).
        self.assertAlmostEqual(79.96 + self.results["carriedHeight"], play["hansCarrying"]["drawn"][1], places=2)
        # A dead carrier's flag lies at the terrain under him plus 1.5, its up
        # axis the terrain's normal there (CTF-5); carried and back on its
        # pole it stands upright.
        self.assertEqual(101.5, play["dropped"][1])
        self.assertEqual([0.6, 0.8, 0], play["droppedUp"])
        self.assertEqual([0, 1, 0], play["carriedUp"])
        self.assertEqual([0, 1, 0], play["returnedUp"])
        self.assertEqual({"1": 0, "2": 1}, play["captures"])
        self.assertEqual(30, play["smithScore"])

    def test_the_lines_are_in_the_mods_words_and_the_actors_colour(self) -> None:
        self.assertEqual([
            ("Hans [Opposition]: stole the flag", 1),
            ("Smith [Coalition]: stole the flag", 2),
            ("Hans [Opposition]: dropped the flag", 1),
            ("Smith [Coalition]: returned the flag", 2),
            ("Smith [Coalition]: captured the flag", 2),
        ], [(line["text"], line["team"]) for line in self.results["play"]["lines"]])

    def test_the_carrier_icon_is_the_local_carriers_alone(self) -> None:
        play = self.results["play"]
        # Hans carrying shows nothing on Smith's HUD; Smith, team 2, carrying
        # the Axis flag raises AxisFlagIcon (CTF-9); the capture clears it.
        self.assertFalse(play["hansCarrying"]["hud"]["AxisFlagIcon"])
        self.assertFalse(play["hansCarrying"]["hud"]["AlliedFlagIcon"])
        self.assertTrue(play["smithCarrying"]["AxisFlagIcon"])
        self.assertFalse(play["smithCarrying"]["AlliedFlagIcon"])
        self.assertEqual(("Icon_flag_ger.tga", "Icon_flag_brit.tga"),
                         (play["smithCarrying"]["AxisCtfFlag"], play["smithCarrying"]["AlliedCtfFlag"]))
        self.assertFalse(play["afterCapture"]["AxisFlagIcon"])

    def test_the_map_marks_each_flag_in_its_sides_icon(self) -> None:
        marks = self.results["play"]["marks"]
        self.assertEqual([("flag_brit", 804.59), ("flag_ger", 938.27)], [(m["icon"], m["x"]) for m in marks])
        self.assertEqual({0.6}, {m["alpha"] for m in marks})
        self.assertEqual("|0:805,-376|1:938,-1716", self.results["play"]["key"])

    def test_the_end_of_the_round_stops_the_law(self) -> None:
        self.assertEqual({"events": [], "home": True}, self.results["ended"])

    def test_a_room_plays_the_servers_rows(self) -> None:
        room = self.results["room"]
        self.assertEqual([], room["tick"])
        self.assertTrue(room["carrying"]["AxisFlagIcon"])
        self.assertEqual([1, 2, 3], room["follow"])
        self.assertAlmostEqual(2 + self.results["carriedHeight"], room["drawnY"])
        self.assertEqual(["Smith [Coalition]: stole the flag"], [line["text"] for line in room["lines"]])
        self.assertIsNone(room["ignored"])

    def test_a_conquest_level_tears_it_down(self) -> None:
        t = self.results["teardown"]
        self.assertEqual((False, False, {}, 0), (t["active"], t["group"], t["hud"], t["marks"]))


if __name__ == "__main__":
    unittest.main()
