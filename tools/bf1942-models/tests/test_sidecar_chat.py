"""The sidecar's text chat: the pieces a line travels in, both directions.

A chat line goes over the wire as ChatFragment events (0x28) of at most 15
bytes, one every 0.5 s, the first carrying the team flag, the sender and the
line's length (ChatFragmentEvent::serialize 0x08120e10, StringManager
0x0815d280..0x0815d580 in bf1942_lnxded.static; sidecar/chat.mjs has the
whole protocol). The fixture is a lab capture of 2026-10-16: two sidecar
sessions on Kursk, chatA saying all and team lines and chatB hearing them,
before and after chatB changed side. Its `received` datagrams are the retail
server's own bytes; its `sent` ones are what the server accepted and logged.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "sidecar_chat_harness.mjs"
FIXTURE = HERE / "fixtures" / "sidecar_chat_lab.json"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SidecarChatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()
        cls.fx = json.loads(FIXTURE.read_text())

    def test_server_pieces_reassemble_to_what_the_server_logged(self):
        # Each line as the event log has it, all and team, the 63-byte cut
        # included; chatB never hears chatA's team line once on the other side.
        self.assertEqual(self.r["heard"], self.fx["heard"])
        texts = [h["text"] for h in self.r["heard"] if h["who"] == "chatB"]
        self.assertNotIn("team after switch, B must NOT see this one", texts)
        self.assertIn("all after switch: can you read me?", texts)

    def test_only_a_first_piece_carries_the_sender(self):
        for p in self.r["pieces"]:
            self.assertLessEqual(p["len"], 15)
            if p["first"]:
                self.assertIn(p["pid"], (1, 2))
            else:
                self.assertIsNone(p["pid"])

    def test_team_flag_is_the_sides_channel(self):
        heard = {h["text"]: h["team"] for h in self.r["heard"]}
        self.assertEqual(heard["team: ok?"], 1)
        self.assertEqual(heard["hi all"], 0)

    def test_sent_datagrams_rebuild_byte_for_byte(self):
        same = [x for x in self.r["sentRebuilt"] if "same" in x]
        self.assertTrue(same)
        self.assertTrue(all(x["same"] for x in same), same)
        counts = [x for x in self.r["sentRebuilt"] if "pieces" in x]
        for c in counts:
            self.assertEqual(c["pieces"], c["datagrams"])

    def test_sent_lines_read_back_as_said_cut_to_63(self):
        said = [(s["who"], s["text"][:63], s["team"]) for s in self.fx["said"]]
        back = [(s["who"], s["text"], s["team"]) for s in self.r["sentHeard"]]
        self.assertEqual(back, said)
        # the retail client sends 0xff; the server fills in the connection's id
        self.assertTrue(all(s["pid"] == 255 for s in self.r["sentHeard"]))

    def test_piece_layout_sizes(self):
        self.assertEqual(self.r["sizes"], {"later": 29, "serverFirst": 40, "playerFirst": 48})

    def test_server_line_names_nobody(self):
        self.assertEqual(self.r["serverLine"], {"e": "chat", "pid": -1, "text": "abc", "team": 0, "server": 1})

    def test_splitting(self):
        s = self.r["split"]
        self.assertEqual(s["short"], ["hi"])
        self.assertEqual(s["exact"], [15])
        self.assertEqual(s["sixteen"], [15, 1])
        self.assertEqual(s["long"], [15, 15, 15, 15, 3])
        self.assertEqual(s["total"], 63)
        self.assertEqual(s["wide"], "a?b")

    def test_receiver_refuses_what_the_engine_refuses(self):
        self.assertEqual(self.r["refusals"], {
            "laterFirst": "a later piece with no line open",
            "firstWhileOpen": "first piece while a line is open",
            "overLong": "line longer than 64 bytes",
        })

    def test_sender_paces_half_a_second_and_holds_four_lines(self):
        s = self.r["sender"]
        self.assertEqual(s["accepted"], [True, True, True, True, False, False])
        self.assertEqual(s["times"], [0, 500, 1000, 1500, 2000, 2500, 3000])
        self.assertEqual(s["firsts"], [True, False, False, False, True, True, True])
        self.assertEqual(s["teams"], [False, False, True, False])


if __name__ == "__main__":
    unittest.main()
