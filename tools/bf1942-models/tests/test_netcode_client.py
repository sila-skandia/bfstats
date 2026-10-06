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
        self.assertEqual(self.results["ticketCount"], 95)

    def test_ctf_rows_reach_the_page_whole(self):
        # `ctf-page.js` `onRow` places the flag from the event's kind, actor
        # and position; a row stripped to the feed's common keys arrived
        # with none of them and every room client ignored it. The message
        # log prints nothing for them (the page writes the CTF line itself).
        self.assertEqual(self.results["ctfRows"], [
            {"type": "ctf", "kind": "dropped", "flag": 1, "player": 2, "team": 2,
             "position": [10, 41.5, -20], "text": ""},
            {"type": "ctf", "kind": "home", "flag": 1, "player": None, "team": 0,
             "position": [0, 7.6, 0], "text": ""},
        ])

    def test_a_blasts_flight_rides_the_swim_bits_spare_codes(self):
        self.assertEqual({"flight": "flyBackward", "swim": None}, self.results["flight"])

    def test_a_rows_own_keys_ride_through(self):
        # The page reads a round's result off the row (`map.html`
        # `roomRoundEnd`) and the restart's flags and tickets, so every key a
        # row carries reaches it; neither row, nor a round end's cleared
        # deaths, prints a feed line (the debriefing and the restart do).
        rows = self.results["roundRows"]
        self.assertEqual(["roundEnd", "restart", "killed"], [r["type"] for r in rows])
        self.assertEqual((2, 10, [{"slot": 2, "team": 2, "medal": "gold", "score": 4}]),
                         (rows[0]["winner"], rows[0]["restartIn"], rows[0]["medals"]))
        self.assertEqual(([{"team": 1}, {"team": 2}], {"team1": 100, "team2": 100}),
                         (rows[1]["flags"], rows[1]["tickets"]))
        self.assertTrue(rows[2]["cleared"])
        self.assertEqual(["", "", ""], [r["text"] for r in rows])

    def test_explicit_leave(self):
        self.assertTrue(self.results["pingFrame"])
        self.assertTrue(self.results["leaveSent"])
        self.assertTrue(self.results["socketClosed"])
        self.assertEqual(self.results["closedState"], "closed")

    def test_server_close_surface(self):
        self.assertEqual(self.results["c2State"], "closed")
        self.assertEqual(self.results["c2Code"], "room_full")


def wire(value: float) -> float:
    """`floatToFixed(v, 12, 16)` (W-2) then `PlayerAction::get`'s decode and
    0.01 snap (W-3), as mouse-input.js has them."""
    import math
    x = max(-1.0, min(1.0, value / 16.0))
    n = math.trunc((x + 1) * 0.5 * 4095)
    v = ((2 * n) / 4095 - 1) * 16
    return round(v * 100) / 100


class RecordThrottleAndRudderTests(unittest.TestCase):
    """The aircraft's throttle and rudder are the engine's c_PIThrottle and
    c_PIYaw, which retail carries as analogue 12-bit channels like the stick
    (ledger W-1, W-2): the record carries them so, past its 13 engine
    bytes."""

    results: dict

    @classmethod
    def setUpClass(cls):
        cls.results = run_harness()["codec"]

    def test_the_record_grows_by_the_two_channels(self):
        c = self.results
        self.assertEqual(17, c["bytes"])
        self.assertEqual(14, c["minBytes"])
        self.assertEqual(4 + 17, c["frameBytes"])

    def test_keys_cross_as_full_steps(self):
        self.assertEqual(1, self.results["keys"]["forwardKeys"])
        self.assertEqual(-1, self.results["keys"]["rudder"])

    def test_a_joysticks_lever_and_rudder_cross_analogue(self):
        j = self.results["joystick"]
        self.assertEqual(wire(0.6), j["forwardKeys"])
        self.assertEqual(wire(0.37), j["rudder"])
        self.assertNotIn(j["rudder"], (1, -1))

    def test_a_mouse_rudder_crosses_at_its_rate_and_clips_at_sixteen(self):
        self.assertEqual(wire(-3.46), self.results["mouseRudder"]["rudder"])
        self.assertEqual(16, self.results["pastTheWire"]["rudder"])
        self.assertEqual(0, self.results["rest"]["rudder"])
        self.assertEqual(0, self.results["rest"]["forwardKeys"])

    def test_the_engine_channels_are_untouched(self):
        j = self.results["joystick"]
        self.assertEqual(7, j["seq"])
        self.assertEqual(wire(0.5), j["strafe"])
        self.assertEqual(wire(0.25), j["forward"])
        self.assertEqual(wire(-1.3), j["roll"])
        self.assertEqual(wire(2.4), j["pitch"])

    def test_a_fourteen_byte_record_still_reads_its_signs(self):
        old = self.results["legacy"]
        self.assertEqual(18, old["length"])
        self.assertEqual(1, old["forwardKeys"])
        self.assertEqual(-1, old["rudder"])
        self.assertEqual(wire(0.5), old["strafe"])
        # Byte 13 keeps the signs for a reader of that record: throttle up
        # (bit 0), rudder left (bit 3).
        self.assertEqual(0b1001, self.results["signByte"])


if __name__ == "__main__":
    unittest.main()