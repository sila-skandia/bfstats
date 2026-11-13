"""`viewer/room-host-client.js` and CREATE GAME's settings under node: the vote
lines in the shipped lexicon's words, the vote keys, the join row's host half
and the settings a create carries (gap audit entries 26, 28, 48).

The strings are `lexiconAll.dat`'s (`VOTEMSG_*`, `VOTEFEEDBACK_*`, `VOTE_*`,
`PASSWORD_INVALID*`, `ERROR_KICKED_FROM_SERVER`); the action codes are the
server's (`tests/test_room_host.py`).
"""
# watches: tools/bf1942-models/viewer/room-host-client.js tools/bf1942-models/viewer/play/create-game.js tools/bf1942-models/tests/room_host_client_harness.mjs

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "room_host_client_harness.mjs"


class RoomHostClientTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            shutil.copyfile(VIEWER / "room-host-client.js", work / "room-host-client.js")
            shutil.copyfile(HARNESS, work / "harness.mjs")
            (work / "package.json").write_text('{"type":"module"}\n')
            proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True,
                                  text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_the_words_are_the_shipped_lexicons(self) -> None:
        s = self.results["strings"]
        self.assertEqual("Kick Vote in progress...", s["VOTEMSG_KICK_PROGRESS"])
        self.assertEqual("Kick Vote ended: kicking player #PLAYERNAME#", s["VOTEMSG_KICK_SUCCESS"])
        self.assertEqual("Map Vote ended: changing to map #MAPNAME#", s["VOTEMSG_MAP_SUCCESS"])
        self.assertEqual("Team-Kick Vote ended: non-conclusive", s["VOTEMSG_TEAMKICK_NONCONCLUSIVE"])
        self.assertEqual("Vote to kick #PLAYERNAME# (#PLAYERID#)? (Teamkick)", s["VOTEFEEDBACK_TEAMKICK"])
        self.assertEqual("Vote for map #MAPNAME#?", s["VOTEFEEDBACK_MAP"])

    def test_a_kick_vote_reads_as_retails(self) -> None:
        l = self.results["lines"]
        self.assertEqual("Kick Vote in progress...", l["kickIssued"][0])
        self.assertTrue(l["kickIssued"][1].startswith("Vote to kick Griefer (3)? [1 Cast, 4 Needed]"))
        self.assertIn("Time Left: 60", l["kickIssued"][1])
        self.assertEqual(1, len(l["kickLaid"]))
        self.assertIn("[2 Cast, 4 Needed]", l["kickLaid"][0])
        self.assertIn("Time Left: 42", l["kickLaid"][0])
        self.assertEqual(["Kick Vote ended: non-conclusive"], l["kickFailed"])
        self.assertEqual(["Kick Vote ended: kicking player Griefer"], l["kickPassed"])
        self.assertEqual(["Team-Kick Vote ended: kicking player Griefer"], l["teamPassed"])
        self.assertEqual("Team-Kick Vote in progress...", l["teamIssued"])

    def test_a_map_vote_names_the_list_entry(self) -> None:
        l = self.results["lines"]
        self.assertEqual("Map Vote in progress...", l["mapIssued"][0])
        self.assertTrue(l["mapIssued"][1].startswith("Vote for map berlin (Tdm)?"))
        self.assertEqual(["Map Vote ended: changing to map berlin (Tdm)"], l["mapPassed"])
        self.assertEqual(["Map Vote ended: non-conclusive"], l["mapFailed"])

    def test_a_packs_own_words_win(self) -> None:
        self.assertEqual(["Nein"], self.results["lines"]["localised"])

    def test_the_question_names_the_bound_keys(self) -> None:
        q = self.results["lines"]["question"]
        self.assertIn("Yes: F7", q)
        self.assertIn("No: F8", q)
        self.assertIn("Time Left: 10", q)

    def test_a_refused_join_speaks_retails_words(self) -> None:
        n = self.results["notices"]
        self.assertEqual("This server requires password.", n["bad_password"]["text"])
        self.assertTrue(n["bad_password"]["password"])
        self.assertEqual("This server has reserved slots. Enter Reserved Password!",
                         n["reserved_slots"]["text"])
        self.assertEqual("KICKED FROM SERVER", n["kicked"]["title"])
        self.assertEqual("BANNED FROM SERVER", n["banned"]["title"])
        self.assertTrue(n["banned"]["final"])
        self.assertEqual("FAILED TO CONNECT TO SERVER! SERVER IS FULL!", n["room_full"]["text"])
        self.assertIsNone(n["bad_name"])

    def test_a_join_row_carries_the_host_half(self) -> None:
        j = self.results["join"]
        self.assertEqual(["id"], list(j["first"]))
        self.assertRegex(j["first"]["id"], r"^[a-z0-9]{24}$")
        self.assertTrue(j["sameId"])
        self.assertEqual({"gameTime": 15, "password": "pw"}, j["creating"]["settings"])
        # The creator's own password lets a reload back in.
        self.assertEqual("pw", j["creating"]["password"])
        self.assertEqual("abc123", j["admin"]["admin"])
        self.assertEqual(["id"], list(j["other"]))

    def test_the_vote_keys_answer_the_running_vote(self) -> None:
        r = self.results["live"]
        self.assertFalse(r["noVote"])
        self.assertTrue(r["yes"])
        self.assertTrue(r["no"])
        self.assertEqual([[1, 2, 0], [1, 2, 1]], r["sent"])
        # Past its 60 s, and once it has ended, the keys do nothing.
        self.assertFalse(r["late"])
        self.assertFalse(r["after"])
        self.assertIn("Time Left: 30", r["laid"])
        self.assertEqual("Kick Vote ended: non-conclusive", r["printed"][-1])

    def test_the_hello_and_the_rows_keep_the_rooms_state(self) -> None:
        r = self.results["live"]
        self.assertEqual("Welcome", r["printed"][0])
        self.assertTrue(r["admin"])
        self.assertEqual("k1", r["storedKey"])
        self.assertIsNone(r["createSpent"])
        self.assertEqual({"gameTime": 20}, r["settings"])
        self.assertEqual(["Map Vote: No Map Vote active", "0: wake"], r["mapLines"])
        self.assertFalse(r["other"])


if __name__ == "__main__":
    unittest.main()
