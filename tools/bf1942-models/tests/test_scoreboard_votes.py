"""The votes on the score board: `viewer/scoreboard-votes.js` under node, and
the two vote groups `extract_scoreboard_layout.py` reads out of `menu/InGame`
(gap audit entry 28).

The layout half runs against the shipped `menu/InGame` and is skipped without
the install.
"""
# watches: tools/bf1942-models/viewer/scoreboard-votes.js tools/bf1942-models/viewer/scoreboard.js tools/bf1942-models/extract_scoreboard_layout.py tools/bf1942-models/tests/scoreboard_votes_harness.mjs

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "scoreboard_votes_harness.mjs"
sys.path.insert(0, str(ROOT))

import extract_scoreboard_layout as esb  # noqa: E402
from bf42.rfa import RfaArchive  # noqa: E402
from extract_spawn_layout import load_lexicon  # noqa: E402

MOD_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942" / "Mods/bf1942"
MENU_RFA = MOD_DIR / "Archives/menu.rfa"


class BoardVotesTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            for name in ("scoreboard-votes.js", "scoreboard.js"):
                shutil.copyfile(VIEWER / name, work / name)
            shutil.copyfile(HARNESS, work / "harness.mjs")
            (work / "package.json").write_text('{"type":"module"}\n')
            proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True,
                                  text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_a_click_picks_the_row_under_it(self) -> None:
        self.assertEqual([1, 4, 9, None, None], self.results["rowAt"])

    def test_vote_kick_needs_a_picked_player_who_is_not_you(self) -> None:
        v = self.results["vars"]
        kick, team = "Scoreboard/EnableVoteKick", "Scoreboard/EnableVoteKickTeam"
        self.assertEqual([False, False], [v["none"][kick], v["none"][team]])
        self.assertEqual([False, False], [v["self"][kick], v["self"][team]])
        self.assertEqual([True, True], [v["mate"][kick], v["mate"][team]])
        # A team kick is the local side's alone.
        self.assertEqual([True, False], [v["foe"][kick], v["foe"][team]])
        self.assertEqual([False, False], [v["offline"][kick], v["offline"][team]])
        self.assertEqual([False, True], [v["switchedOff"][kick], v["switchedOff"][team]])
        self.assertEqual("No Kick Vote active", v["mate"]["Scoreboard/KickVoteActive"])

    def test_the_map_list_is_the_rooms_cycle_under_retails_heads(self) -> None:
        self.assertEqual(["id", "level", "mod", "mode", "votes"], self.results["columns"])
        self.assertEqual({"id": 1, "level": "berlin", "mod": "bf1942", "mode": "Tdm", "votes": 2},
                         self.results["mapRows"][1])
        self.assertEqual("", self.results["mapRows"][0]["votes"])
        cells = {c["field"]: c for c in self.results["cells"]}
        self.assertEqual([174, 213, 354, 454, 566],
                         [cells[f]["x"] for f in ("id", "level", "mod", "mode", "votes")])
        # The list widget's pitch: the second row's baseline at y + 3 * 18.
        self.assertEqual(125 + 54 - 6, cells["id"]["y"])

    def test_the_boards_buttons_issue_the_votes(self) -> None:
        r = self.results["live"]
        self.assertIsNone(r["before"])
        self.assertEqual([False, True, False], r["marked"])
        self.assertEqual("kick", r["picked"]["kick"])
        self.assertTrue(r["picked"]["vars"]["Scoreboard/EnableVoteKickTeam"])
        self.assertFalse(r["foe"]["Scoreboard/EnableVoteKickTeam"])
        # VOTE KICK and VOTE KICK (TEAM) on slot 4, then VOTE FOR MAP on id 1;
        # VOTE FOR MAP with no row picked sends nothing.
        self.assertEqual([[1, 4], [2, 4], [0, 1]], r["sent"])

    def test_the_map_vote_screen_opens_with_the_pointer_and_closes_on_done(self) -> None:
        r = self.results["live"]
        self.assertEqual({"open": True, "pointer": "auto"}, r["mapOpen"])
        self.assertTrue(r["painted"])
        for word in ("wake", "berlin", "Tdm", "bf1942"):
            self.assertIn(word, r["mapText"])
        self.assertTrue(r["closed"])

    def test_the_plate_is_one_centred_line_a_part(self) -> None:
        plate = self.results["live"]["plate"]
        self.assertEqual(4, len(plate))
        self.assertEqual("Vote to kick Griefer (3)?", plate[0][0])
        # Centred in the text leaf (534 + (260 - width) / 2), 12 a line from 230.
        self.assertEqual([230, 242, 254, 266], [line[2] for line in plate])
        self.assertEqual(round(534 + (260 - 5 * len("Time Left: 41")) / 2), plate[3][1])
        self.assertTrue(self.results["live"]["plateReady"])


@unittest.skipUnless(MENU_RFA.exists(), "needs the BF1942 install")
class VoteLayoutTests(unittest.TestCase):
    """The two vote groups of the shipped `menu/InGame`."""

    @classmethod
    def setUpClass(cls) -> None:
        lexicon = load_lexicon(MOD_DIR / "lexiconAll.dat", "last")
        with RfaArchive(MENU_RFA) as menu:
            entry = next(e for e in menu.entries if e.lower() == "menu/ingame")
            cls.layout = esb.decode_layout(menu.read(entry), lexicon)

    def test_the_vote_plate_is_the_tooltip_plate_at_528_224(self) -> None:
        message = self.layout["vote"]["message"]
        self.assertEqual("Scoreboard/ShowVoteMessageIngame", message["var"])
        self.assertEqual([528.0, 224.0, 296.0, 110.0], message["rect"])
        plate, text = message["elements"]
        self.assertEqual("tooltip_256x128", plate["texture"])
        self.assertEqual("Scoreboard/VoteMessageIngame", text["var"])
        self.assertEqual([534.0, 230.0, 260.0, 74.0], text["rect"])
        self.assertEqual("center", text["align"])

    def test_the_map_vote_screen_has_its_plate_heads_list_and_buttons(self) -> None:
        group = self.layout["vote"]["mapVote"]
        self.assertEqual("ScoreboardMapVote/MapVoteActive", group["var"])
        els = group["elements"]
        self.assertEqual("map_vote_497x350", els[0]["texture"])
        heads = {el["key"]: el["rect"][0] for el in els if el["kind"] == "text" and el.get("key", "").startswith("MAPVOTE_")}
        self.assertEqual({"MAPVOTE_HEADING": 165.0, "MAPVOTE_ID": 174.0, "MAPVOTE_MAPNAME": 213.0,
                          "MAPVOTE_MOD": 354.0, "MAPVOTE_GAMEMODE": 454.0, "MAPVOTE_NUMVOTES": 566.0}, heads)
        box = next(el for el in els if el["kind"] == "listbox")
        self.assertEqual("ScoreboardMapVote/MapList22", box["data"])
        self.assertEqual([155.0, 125.0, 488.0, 255.0], box["rect"])
        self.assertEqual(18.0, box["rowHeight"])
        ids = [el.get("id") for el in els if el["kind"] == "button" and el.get("id")]
        self.assertEqual(["RESPAWN_DONE", "SCOREBOARD_VOTE_MAP"], ids)
        self.assertTrue(any(el.get("var") == "ScoreboardMapVote/MapVoteActiveMsg" for el in els))

    def test_the_vote_groups_art_and_faces_are_in_the_pack(self) -> None:
        names = esb.layout_textures(self.layout)
        for name in ("map_vote_497x350", "kick_mapmessage_250x30", "tooltip_256x128"):
            self.assertIn(name, names)
        self.assertIn("trebuchet_ms18", self.layout["fonts"])

    def test_the_boards_vote_buttons_are_its_own_leaves(self) -> None:
        ids = {el.get("id") for el in self.layout["elements"] if el["kind"] == "button"}
        for name in ("SCOREBOARD_VOTE_KICK", "SCOREBOARD_VOTE_KICK_TEAM", "SCOREBOARD_BRINGUP_MAPVOTE"):
            self.assertIn(name, ids)


if __name__ == "__main__":
    unittest.main()
