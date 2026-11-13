"""Typed chat in a room, the message log's lines about players, the warning
plate, the score board's numbers on the client and the typed console words
about players -- entries 5, 16, 19, 20, 45, 46, 49 and 67 of
`features/retail-inverse-gap-audit-2026-11-12`, driven headless by
`room_chat_harness.mjs`.

Every number is retail's, with the address it was read at. The room server's
half (the relay, the `stats` rows, the ping's round trip) is `test_room.py`'s
`chat` scenario.
"""

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
HARNESS = Path(__file__).with_name("room_chat_harness.mjs")
MODULES = ["chat-log.js", "netcode-client.js", "netcode.js", "ghost-draw.js", "mouse-input.js",
           "console.js", "console-view.js", "console-commands.js", "console-aliases.js", "vehicle-players.js"]

sys.path.insert(0, str(ROOT))


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class RoomChatTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    # ---- retail's numbers ---------------------------------------------------

    def test_the_constants_are_retails(self) -> None:
        self.assertEqual({
            # `StringManager::addStringMsg` lnxded 0x0815d280: `mov eax, 0x3f`
            # (0x0815d30a), the limits at 0x086c0d28 (4) and 0x086c0d2c (16).
            "SAY_LINE_BYTES": 63, "SAY_WAITING_MAX": 4, "SAY_WAITING_MAX_SERVER": 16,
            # `updateSendStream` 0x0815d3c0: `0xf` (0x0815d425), the double
            # 0.5 at 0x086be450.
            "SAY_PIECE_BYTES": 15, "SAY_PIECE_SECONDS": 0.5,
            # `shouldDisplayChokeMessage` BF1942.exe 0x004b4910: 10.0 at
            # 0x008dc0b8.
            "SAY_CHOKE_SECONDS": 10,
            # `GameClient::update`: `cmp eax, 0x2d` (0x00495f1b), `cmp eax,
            # 0x1c2` (0x00495fef).
            "CONNECTION_PROBLEM_TICKS": 45, "DISCONNECT_TICKS": 450,
        }, self.r["constants"])

    # ---- the lines ----------------------------------------------------------

    def test_entered_and_left_your_vehicle(self) -> None:
        l = self.r["lines"]
        self.assertEqual("Bot A entered your vehicle", l["entered"])
        self.assertEqual("Bot A left your vehicle", l["left"])
        self.assertEqual(l["entered"], l["enteredDefault"])
        self.assertEqual(l["left"], l["leftDefault"])

    def test_joined_the_team(self) -> None:
        l = self.r["lines"]
        self.assertEqual("skandia joined the axis team", l["axis"])
        self.assertEqual("skandia joined the allied team", l["allied"])
        self.assertIsNone(l["none"])
        self.assertEqual("skandia tritt bei: Achsenteam", l["german"])

    def test_a_line_is_cut_to_63_bytes(self) -> None:
        c = self.r["cut"]
        self.assertEqual(63, c["ascii"])
        self.assertEqual("hello", c["short"])
        self.assertEqual(31, c["wide"])

    # ---- the sender's queue (CHAT-2) ------------------------------------------

    def test_a_short_line_leaves_at_once(self) -> None:
        self.assertEqual(["hello"], [s["text"] for s in self.r["queue"]["first"]])

    def test_63_bytes_are_five_pieces_half_a_second_apart(self) -> None:
        long = self.r["queue"]["long"]
        self.assertEqual(1, len(long))
        self.assertEqual(63, long[0]["bytes"])
        # Four half seconds after the first piece, on a 30 Hz frame.
        self.assertGreaterEqual(long[0]["after"], 2.0)
        self.assertLess(long[0]["after"], 2.2)

    def test_the_fifth_waiting_line_is_refused_and_chokes_for_ten_seconds(self) -> None:
        q = self.r["queue"]
        self.assertEqual([True, True, True, True, False], q["taken"])
        self.assertEqual(["l0", "l1", "l2", "l3"], q["sent"])
        for gap in q["gaps"]:
            self.assertGreaterEqual(gap, 0.5)
            self.assertLess(gap, 0.57)
        self.assertTrue(q["chokeNow"])
        self.assertTrue(q["chokeAt95"])
        self.assertFalse(q["chokeAt105"])
        self.assertTrue(q["chokeCleared"])
        self.assertEqual(16, q["serverTakes"])

    # ---- the crew watch -------------------------------------------------------

    def test_only_another_players_move_in_the_same_hull_prints(self) -> None:
        self.assertEqual([
            [[], []],            # the local player gets in beside a bot
            [["bot:2"], []],     # a second bot boards
            [[], ["bot:1"]],     # the first leaves
            [[], []],            # the local player gets out
            [[], []],            # and back in, with another crew
            [[], []],            # another hull
        ], self.r["crew"])

    # ---- the warning plate ------------------------------------------------------

    def test_the_plate_follows_the_unanswered_ticks(self) -> None:
        p = self.r["plate"]
        self.assertEqual({"show": False, "disconnected": False, "text": ""}, p["quiet"])
        self.assertFalse(p["at45"])
        self.assertEqual({"show": True, "disconnected": False,
                          "text": "Warning! Connection problems detected!"}, p["at46"])
        self.assertEqual("Warning: Sending messages too fast, discarding", p["flood"]["text"])
        self.assertEqual("Warning! Connection problems detected!", p["problemOverFlood"])
        self.assertFalse(p["at450"])
        self.assertEqual({"show": True, "disconnected": True,
                          "text": "Warning! Disconnected from server!"}, p["at451"])
        self.assertEqual("Warnung!", p["german"])

    def test_the_huds_own_plate_is_vanillas(self) -> None:
        # `menu/InGame` top 52: the two-line plate at (305, 138), the text at
        # (310, 141) in trebuchet_ms8, colour (0.7734, 0.7539, 0.2305). Read
        # off the source: hud.js's own imports are not this test's.
        import re
        src = (VIEWER / "hud.js").read_text()
        body = re.search(r"export const DISCONNECT_MESSAGE_DEFAULT = \{(.*?)\n\};", src, re.S).group(1)
        self.assertIn("rect: [305, 138, 256, 32], when: DISCONNECT_WHEN, texture: 'textmessbg_2line_256x32'", body)
        self.assertIn("rect: [310, 141, 245, 60], color: [0.7734, 0.7539, 0.2305, 1]", body)
        self.assertIn("font: 'trebuchet_ms8'", body)
        self.assertIn("var: 'DisconnectMessage/DisconnectMessage'", body)
        self.assertIn("{ var: 'DisconnectMessage/ShowDisconnectMessage', op: 'eq', value: true }", src)
        respawn = re.search(r"export const RESPAWN_GROUPS = \[(.*?)\];", src).group(1)
        self.assertIn("'disconnectMessage'", respawn)
        order = re.findall(r"'(\w+)'", re.search(r"export const PAINT_ORDER = \[(.*?)\];", src, re.S).group(1))
        self.assertEqual("disconnectMessage", order[-1])

    # ---- the ignore list ----------------------------------------------------------

    def test_the_ignore_list_answers_with_the_clients_strings(self) -> None:
        self.assertEqual([
            "Error: Could not locate player: 7", "", "Error: Player is already ignored!", True,
            "id: 3 name: Mate", False, False,
        ], self.r["ignore"])

    # ---- the room client -------------------------------------------------------------

    def test_hello_and_the_stats_rows_feed_the_board(self) -> None:
        c = self.r["client"]
        self.assertEqual({"score": 12, "kills": 5, "deaths": 2, "ping": 40}, c["atJoin"]["a"])
        self.assertEqual({"score": 0, "kills": 0, "deaths": 0, "ping": 0}, c["atJoin"]["me"])
        self.assertIsNone(c["atJoin"]["nobody"])
        self.assertEqual({"score": 14, "kills": 6, "deaths": 2, "ping": 38}, c["after"]["a"])
        self.assertEqual({"score": 2, "kills": 1, "deaths": 0, "ping": 55}, c["after"]["me"])
        self.assertEqual({"score": 0, "kills": 0, "deaths": 0, "ping": 0}, c["after"]["late"])
        self.assertEqual(1, c["after"]["lateTeam"])
        self.assertEqual("Renamed", c["after"]["aName"])
        self.assertIsNone(c["gone"])
        self.assertIsNone(c["oldServer"])
        # A chat row keeps its text for the message log; the others print nothing.
        self.assertEqual([["stats", ""], ["name", ""], ["chat", "hello"]], c["feedText"])

    def test_the_pong_goes_straight_back_and_chat_is_an_action(self) -> None:
        c = self.r["client"]
        self.assertEqual({"type": True, "bytes": 9, "tail": [0x10, 0x27, 0, 0]}, c["echo"])
        self.assertEqual({"type": True, "row": {"type": "chat", "text": "hello there", "team": True}}, c["chat"])

    # ---- the typed words ----------------------------------------------------------------

    def test_suicide_say_and_name_reach_the_page(self) -> None:
        w = self.r["words"]
        self.assertEqual(["suicide", "say:hello all", "say:hello", "name:Other"], w["calls"])
        self.assertEqual([], w["suicide"])
        self.assertEqual([], w["say"])
        self.assertEqual("Error : Method is not active!", w["inactive"][-1])

    def test_ignore_unignore_and_ignorelist(self) -> None:
        w = self.r["words"]
        self.assertEqual([], w["ignore"])
        self.assertEqual(["Error: Player is already ignored!"], w["ignoreAgain"])
        self.assertEqual(["Error: Could not locate player: 9"], w["ignoreNobody"])
        self.assertEqual(["Error: Could not locate player: 1"], w["ignoreSelf"])
        self.assertEqual(["id: 5 name: Rival"], w["ignorelist"])
        self.assertEqual([5], w["ignored"])
        self.assertEqual([], w["ignoredAfter"])

    def test_the_radio_switches(self) -> None:
        w = self.r["words"]
        self.assertEqual([[], True, ["1"]], w["radioText"])
        self.assertEqual([[], True], w["radioAudio"])
        self.assertEqual({"text": False, "audio": False}, w["both"][1])
        self.assertEqual(["ignore radio text: 0", "ignore radio audio: 0"], w["both"][2])

    def test_the_buddy_list(self) -> None:
        w = self.r["words"]
        self.assertEqual(["1"], w["buddy"])
        self.assertEqual(["1"], w["buddyByName"])
        self.assertEqual("Error: failed  to add player <Ghost> to buddylist. Couldn't locate player.",
                         w["buddyNobody"][0])
        self.assertEqual(["id: 2 name: Mate", "id: 5 name: Rival"], w["buddylist"])
        self.assertEqual([5], w["buddies"])


class ExporterTests(unittest.TestCase):
    """The lexicon keys and the `menu/InGame` top the exporter carries for
    these lines."""

    def test_the_chat_layout_carries_the_lines_words(self) -> None:
        import extract_radio
        for key in ("ENTERED_YOUR_VEHICLE", "LEFT_YOUR_VEHICLE", "JOINED_THE", "AXIS_TEAM", "ALLIED_TEAM"):
            self.assertIn(key, extract_radio.CHAT_STRING_KEYS)

    def test_the_hud_layout_carries_the_warning_plate(self) -> None:
        import extract_hud_layout
        sig, rect = extract_hud_layout.RAW_TOPS["disconnectMessage"]
        self.assertEqual([("is", "DisconnectMessage/ShowDisconnectMessage"),
                          ("not", "Loading/ShowLoadingText")], sig)
        self.assertEqual((310.0, 141.0, 245.0, 60.0), rect)
        self.assertIn("disconnectMessage", extract_hud_layout.RESPAWN_GROUPS)
        for key in ("GAME_MESSAGE_CONNECTION_PROBLEM", "GAME_MESSAGE_DISCONNECTED", "CHAT_FLOOD_ERROR",
                    "DISCONNECTED_FROM_SERVER"):
            self.assertIn(key, extract_hud_layout.CLIENT_STRINGS)


if __name__ == "__main__":
    unittest.main()
