"""`viewer/chat-input.js` and its routing through `viewer/page-input.js` and
`viewer/comms.js` -- the say all / say team line on K and L, driven headless
by `chat_input_harness.mjs`.

Every expectation is the retail client's behaviour as read out of BF1942.exe
and `menu/InGame` (features/radio-and-chat-log/README.md, "Typing a chat
line"), except Escape, which the page gives the line as its way out.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("chat_input_harness.mjs")
MODULES = ("chat-input.js", "comms.js", "page-input.js", "radio.js", "chat-log.js",
           "announcer.js", "ds3d-pan.js", "console.js", "console-view.js",
           "touch-controls.js", "kit-icon.js", "pointer-route.js")


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
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ChatLineTests(unittest.TestCase):
    """The line on its own."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_shut_line_takes_no_key(self) -> None:
        self.assertFalse(self.r["closedTakesNothing"])

    def test_typing_backspace_and_the_caret(self) -> None:
        self.assertEqual(self.r["typed"], "hello")
        self.assertEqual(self.r["lineAfterBackspace"], "hell")
        self.assertEqual(self.r["insertAtCaret"], {"text": "hexll", "cursor": 3})
        self.assertEqual(self.r["caretClamped"], 5)

    def test_tab_is_dropped_and_ctrl_chords_go_to_the_browser(self) -> None:
        self.assertEqual(self.r["tabTyped"], "hexll")
        self.assertEqual(self.r["ctrlChord"], "pass")
        self.assertTrue(self.r["altGr"], "AltGr (Ctrl+Alt) types its character")

    def test_enter_sends_once_and_closes(self) -> None:
        self.assertEqual(self.r["sentOnce"], [{"text": "hexll@", "team": False}])
        self.assertFalse(self.r["closedAfterEnter"]["open"])
        self.assertEqual(self.r["closedAfterEnter"]["text"], "")

    def test_an_empty_line_sends_nothing_and_closes(self) -> None:
        self.assertEqual(self.r["emptySends"], 1)
        self.assertFalse(self.r["emptyCloses"])

    def test_the_line_stops_at_63_bytes(self) -> None:
        self.assertEqual(self.r["limit"], {"length": 63, "max": 63})

    def test_escape_drops_the_line(self) -> None:
        self.assertEqual(self.r["escape"], {"open": False, "text": "", "sends": 1})

    def test_only_printable_latin1_is_typed(self) -> None:
        t = self.r["typeable"]
        for ch in ("a", " ", "~", "é", "ÿ"):
            self.assertTrue(t[ch], ch)
        for ch in ("€", "Ж", "\u0085", "Shift", "\u007f"):
            self.assertFalse(t[ch], ch)

    def test_the_caret_blinks_four_tenths_off_four_tenths_on(self) -> None:
        # 0x007DE44A: the timer starts at -0.4 and wraps back once it reaches
        # 0.4; the caret shows while it is non-negative.
        self.assertEqual(self.r["blink"], [False, False, True, True, False, False, True])

    def test_the_prompt_and_the_box(self) -> None:
        self.assertEqual(self.r["prompt"], {"all": "SayAll>", "team": "SayTeam>",
                                            "lexicon": "SagTeam>"})
        box = self.r["box"]
        self.assertEqual(box["prompt"], [7, 350, 150, 20])
        self.assertEqual(box["edit"], [7, 364, 340, 21])
        self.assertAlmostEqual(box["color"][0], 0.957, places=3)
        self.assertEqual(box["caretWidth"], 2)


class ChatRoutingTests(unittest.TestCase):
    """Real key events through page-input.js into comms.js."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_k_opens_say_all_and_is_not_typed(self) -> None:
        self.assertTrue(self.r["kPrevented"])
        say = self.r["afterOpen"]["say"]
        self.assertTrue(say["open"])
        self.assertFalse(say["team"])
        self.assertEqual(say["text"], "")

    def test_l_opens_say_team_and_sends_with_the_team_flag(self) -> None:
        self.assertTrue(self.r["teamOpen"]["open"])
        self.assertTrue(self.r["teamOpen"]["team"])
        self.assertEqual(self.r["teamSent"], {"text": "hold", "team": True})

    def test_movement_stops_but_the_throttle_holds(self) -> None:
        # 0x00446ED0 zeroes the player's input but c_PIThrottle (held at its
        # value when the line opened) and the look axes.
        self.assertEqual(self.r["heldBefore"], ["KeyA", "KeyW"])
        self.assertEqual(self.r["afterOpen"]["keys"], ["KeyW"])
        self.assertEqual(self.r["throttleHeldUnderLine"], ["KeyW"])
        self.assertEqual(self.r["afterEnter"]["keys"], [],
                         "a throttle key let go while typing is let go at close")

    def test_every_key_goes_to_the_text_and_none_to_the_game(self) -> None:
        self.assertEqual(self.r["typedOnPage"], "gg r m")
        self.assertEqual(self.r["gameCallsWhileOpen"], [],
                         "R, M, Space and F1 reached nothing of the game's")
        self.assertEqual(self.r["afterBackspace"], "gg r ")

    def test_enter_sends_once_through_the_room(self) -> None:
        self.assertTrue(self.r["enterPrevented"])
        self.assertEqual(self.r["roomSent"], [{"text": "gg r ", "team": False}])
        self.assertFalse(self.r["afterEnter"]["say"]["open"])
        self.assertEqual(self.r["secondEnterSendsNothing"], 1)
        self.assertEqual(self.r["secondEnterReachedPage"], ["openDeploy"],
                         "with the line shut, Enter is the page's again")

    def test_escape_cancels_without_the_menu(self) -> None:
        esc = self.r["escapeCancels"]
        self.assertFalse(esc["say"]["open"])
        self.assertEqual(esc["sends"], 2)
        self.assertNotIn("setEscMenu", esc["calls"])

    def test_an_empty_line_sends_nothing(self) -> None:
        self.assertEqual(self.r["emptyLine"], {"sends": 2, "open": False})

    def test_the_page_line_stops_at_63(self) -> None:
        self.assertEqual(self.r["pageLimit"], 63)
        self.assertFalse(self.r["ctrlChordPrevented"])
        self.assertFalse(self.r["ctrlChordTyped"])

    def test_the_console_and_a_form_field_come_first(self) -> None:
        self.assertEqual(self.r["consoleFirst"], {"open": False, "calls": ["console"]})
        self.assertFalse(self.r["formFieldFirst"])

    def test_offline_the_line_goes_into_the_log(self) -> None:
        off = self.r["offline"]
        self.assertEqual(off["sent"], 0)
        texts = [(row["text"], row["team"], row["section"]) for row in off["rows"]]
        self.assertEqual(texts, [("Hans: offline", 2, 0),
                                 ("Hans [allies]: team", 2, 0)])


if __name__ == "__main__":
    unittest.main()
