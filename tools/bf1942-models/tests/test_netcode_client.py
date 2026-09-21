"""`viewer/netcode-client.js` under node: the P2 client wire seam.

Same pattern as `test_world.py` — one node run, many assertions. No three is
needed (netcode-client imports netcode.js imports mouse-input.js, all pure),
so no vendoring; the copy list is the three modules alone.

What this file pins is the P2 contract of
`features/netcode-play-multiplayer/README.md` and the wire law of
`viewer/netcode.js`:

* the join handshake — MSG_JOIN row, MSG_HELLO -> joined, roster from the
  hello's slots, own slot excluded from the remote iteration;
* the input seq — one increasing seq per send, exactly one frame per tick
  the page consumed, no sends before join;
* the snapshot lerp — the last two snapshots blend in render space (the
  engine's single-current-state ghost law, netcode.md §4), NaN-safe before
  any snapshot, stance flags ride the sample;
* the feed and the roster — join/fire/seatEnter/leave rows resolve to text,
  the roster drops a left player;
* the exits — the explicit MSG_LEAVE on close (J-3's 0xd), MSG_CLOSED
  surface, ping cadence on the client's clock.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "netcode_client_harness.mjs"

MODULES = {
    "netcode-client.mjs": VIEWER / "netcode-client.js",
    "netcode.js": VIEWER / "netcode.js",
    "mouse-input.js": VIEWER / "mouse-input.js",
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class NetcodeClientTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls):
        cls.results = run_harness()

    def test_join_row(self):
        row = self.results["joinRow"]
        self.assertEqual(row["room"], "abc")
        self.assertEqual(row["name"], "X")
        self.assertEqual(row["team"], 0)

    def test_hello_applies(self):
        self.assertEqual(self.results["joined"], "joined")
        self.assertEqual(self.results["slot"], 2)
        self.assertEqual(self.results["helloLevel"], "wake")
        # The hello's slots roster the players already in the room.
        self.assertEqual(self.results["rosterNames"], ["A", "X"])

    def test_own_slot_excluded_from_remotes(self):
        self.assertEqual(self.results["remoteSlots"], [1])
        self.assertTrue(self.results["selfNotRemote"])

    def test_snapshot_lerp_window(self):
        # Two snapshots: A at (0,0,0) then (10,0,0); at +50 ms of a 100 ms
        # frame the lerped sample sits halfway, stance rides the newest.
        self.assertAlmostEqual(self.results["lerpX"], 5.0, places=3)
        self.assertTrue(self.results["lerpProne"])
        self.assertEqual(self.results["lerpYaw"], 90)
        self.assertTrue(self.results["noSnapshot"])

    def test_input_seq(self):
        self.assertTrue(self.results["inputSeq1"])
        self.assertEqual(self.results["inputSeq"], 2)
        self.assertTrue(self.results["sendBeforeJoinNoop"])

    def test_action_rows(self):
        self.assertTrue(self.results["actionFrame"])
        row = self.results["actionRow"]
        self.assertEqual(row, {"type": "seat", "vehicle": 3, "seat": 0,
                               "action": "switch"})

    def test_feed_and_roster(self):
        self.assertEqual(self.results["feedCount"], 8)
        texts = self.results["feedTexts"]
        self.assertIn("A joined the room", texts)
        self.assertIn("A opened fire", texts)
        self.assertIn("A got in Willy", texts)
        self.assertIn("A left", texts)
        self.assertEqual(self.results["rosterAfterLeave"], "Player 3")
        self.assertEqual(self.results["teamOfA"], 1)

    def test_p3_feed_rows(self):
        # The kill feed: name attribution where the row carries the killer,
        # a plain death row otherwise (slot 2 is the client's own 'X').
        self.assertEqual(self.results["killedText"], "X killed A")
        self.assertEqual(self.results["diedText"], "X died")
        self.assertEqual(self.results["ticketText"], "Axis tickets: 95")
        self.assertEqual(self.results["capturedText"], "Axis captured West_outpost")

    def test_explicit_leave(self):
        self.assertTrue(self.results["pingFrame"])
        self.assertTrue(self.results["leaveSent"])
        self.assertTrue(self.results["socketClosed"])
        self.assertEqual(self.results["closedState"], "closed")

    def test_server_close_surface(self):
        self.assertEqual(self.results["c2State"], "closed")
        self.assertEqual(self.results["c2Code"], "room_full")


if __name__ == "__main__":
    unittest.main()