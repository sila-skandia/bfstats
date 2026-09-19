"""`viewer/console.js` -- the in-game console -- driven headless by
`console_harness.mjs`.

The module is a reconstruction of `dice::ref2::io::OldConsole`, the class the
retail client (`0x005a2230`) and the Linux dedicated server (`0x083dbfc0`)
share.  Every number and every message below has an address behind it in
`features/bf1942-in-the-browser/console.md`; these tests are what stops a
later edit from quietly changing one.

The case that matters most is `test_reproduces_the_reference_capture`: the
user's screenshot of the real console is four lines of text and a prompt, and
this module has to produce those five strings byte for byte, two spaces and
all.
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
HARNESS = Path(__file__).with_name("console_harness.mjs")
MODULES = {"console.js": VIEWER / "console.js"}


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
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ConsoleHarnessTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # ------------------------------------------------------------ constants

    def test_constructor_defaults_match_the_binaries(self) -> None:
        """Client ctor `0x005a2230`: prompt `"> "`, `param_1[0x4e] = 0x4d`
        (77, the edit buffer's size), `param_1[0x57] = 8` (the PageUp step).
        The drawer `FUN_00464ee0` asks `getLines` for 0x14 = 20 lines at
        `0x00464f96`.  The scrolled-up marker is the sixty `+` at
        `0x00903448`."""
        c = self.results["constants"]
        self.assertEqual("> ", c["prompt"])
        self.assertEqual(77, c["maxLine"])
        self.assertEqual(8, c["pageLines"])
        self.assertEqual(20, c["viewLines"])
        self.assertEqual(60, c["scrollMarkerLength"])
        self.assertEqual("+", c["scrollMarkerChars"])

    # -------------------------------------------------------------- capture

    def test_reproduces_the_reference_capture(self) -> None:
        """The whole point.  `Error  (2):` carries two spaces because the
        message is built as `"Error " + workingFile + " (" + n + "): "` and
        the working file is empty for a typed line; the second line is
        `"Error " + workingFile + ": "`, so it has one space before the
        colon.  Both literals are in the binary: `0x086e38c8` `"Error "`,
        `0x08706306` `" ("`, `0x086b9c63` `"): "`, `0x086f24a2` `": "`."""
        self.assertEqual([
            "Adding <skandia> (0) to buddylist",
            "> game.showHud",
            "Error  (2): game.showHud",
            "Error : Unknown object or method!",
            "> ",
        ], self.results["capture"]["tail"])

    def test_the_line_counter_is_bumped_after_the_error_prints(self) -> None:
        """lnxded `0x083e9f89` sits past the switch, so the number printed is
        how many lines the console had already run, not counting this one."""
        self.assertEqual(3, self.results["capture"]["lineNumberAfter"])

    # ---------------------------------------------------------- the parser

    def test_a_line_splits_at_the_first_dot(self) -> None:
        """lnxded `0x083e422d` scans the first token for `.` and takes
        `substr(0, i)` as the object; everything after is the method, dots
        included."""
        p = self.results["parse"]
        self.assertEqual(("call", "game", "usehud", ["1"]),
                         (p["call"]["kind"], p["call"]["object"],
                          p["call"]["method"], p["call"]["args"]))
        self.assertEqual("b.c", p["dottedMethod"]["method"])
        self.assertEqual("game", p["leadingSpace"]["object"])

    def test_a_token_with_no_dot_is_not_an_object(self) -> None:
        self.assertEqual("bare", self.results["parse"]["bare"]["kind"])
        self.assertEqual("empty", self.results["parse"]["empty"]["kind"])

    def test_keywords_are_case_insensitive(self) -> None:
        """`handleCommand` compares them with `strcasecmp` (lnxded
        `0x083e41b1` for `run`, `0x083e41ef` for `include`)."""
        p = self.results["parse"]
        self.assertEqual("rem", p["keyword"]["keyword"])
        self.assertEqual("rem", p["keywordCased"]["keyword"])

    def test_quoted_arguments_keep_their_spaces(self) -> None:
        """`OldConsole::getArgs` lnxded `0x083de4d0`: a token opening with
        `"` (0x22, tested at `0x083de8cf`) runs to the closing quote."""
        self.assertEqual(["hello there", "2"],
                         self.results["parse"]["quoted"]["args"])
        self.assertEqual(["two words", "tail"], self.results["args"]["quoted"])
        self.assertEqual(["never closed"], self.results["args"]["unterminated"])
        self.assertEqual(["a", "b"], self.results["args"]["runs"])

    def test_an_equals_between_method_and_argument_is_dropped(self) -> None:
        """The viewer's one deliberate divergence.  `getArgs` has no `=`
        case, so the real engine would hand `show.dev = 1` two arguments;
        the page accepts the spelling its own users were told to type."""
        self.assertEqual(["1"], self.results["parse"]["equals"]["args"])

    # -------------------------------------------------------- the dispatcher

    def test_every_dispatcher_message_is_the_binary_s_own_wording(self) -> None:
        """Client block `0x00902cb8`-`0x00902d3c`, lnxded
        `0x086eb01d`-`0x086eb07d`.  "setable" really does have one t."""
        m = self.results["dispatch"]["knownMessages"]
        self.assertEqual("Unknown object or method!", m["unknown"])
        self.assertEqual("Unauthorised method!", m["unauthorised"])
        self.assertEqual("Method is not active!", m["notActive"])
        self.assertEqual("Property is only setable!", m["onlySetable"])
        self.assertEqual("Property is only readable!", m["onlyReadable"])

    def test_an_unknown_command_answers_the_way_the_game_does(self) -> None:
        d = self.results["dispatch"]
        for key in ("unknownObject", "unknownMethod", "bareToken"):
            self.assertEqual(2, d[key]["code"], key)
            self.assertEqual("Unknown object or method!", d[key]["message"], key)

    def test_the_guards_fire_in_the_engine_s_order(self) -> None:
        d = self.results["dispatch"]
        self.assertEqual("Unauthorised method!", d["unauthorised"]["message"])
        self.assertEqual("Method is not active!", d["notActive"]["message"])
        self.assertEqual("Too few arguments, the min no of arguments is 1!",
                         d["tooFew"]["message"])
        self.assertEqual("Too many arguments, the max no of arguments is 1!",
                         d["tooMany"]["message"])
        self.assertEqual("Property is only readable!", d["onlyReadable"]["message"])
        self.assertEqual("Property is only setable!", d["onlySetable"]["message"])

    def test_a_good_line_runs_quietly(self) -> None:
        d = self.results["dispatch"]
        self.assertEqual((1, ""), (d["ok"]["code"], d["ok"]["message"]))
        self.assertEqual((1, ""), (d["okEquals"]["code"], d["okEquals"]["message"]))

    # ------------------------------------------------------------- show.dev

    def test_show_dev_takes_both_spellings_and_either_case(self) -> None:
        self.assertEqual(["1", "1", "0", "1", "0"],
                         self.results["showDev"]["seen"])

    # ----------------------------------------------------------- the keys

    def test_up_and_down_walk_the_command_history(self) -> None:
        """`updateGameInput` (lnxded `0x083eac60`) turns c_GIUp into 0x10 and
        c_GIDown into 0x0e, and `updateAsciiKey` recalls history on both
        (`0x083eaa35`)."""
        h = self.results["history"]
        self.assertEqual(["a.b 3", "a.b 2", "a.b 1", "a.b 1",
                          "a.b 2", "a.b 3", ""], h["walk"])
        self.assertEqual(3, h["size"])

    def test_backspace_drops_one_character_and_delete_clears_the_line(self) -> None:
        """There is no cursor in this console: Backspace (`0x083eab93`)
        decrements the length, Delete (`0x083eab80`) zeroes it."""
        e = self.results["editing"]
        self.assertEqual("ab", e["afterBackspace"])
        self.assertEqual("", e["afterDelete"])
        self.assertEqual("x", e["afterType"])

    def test_the_edit_line_stops_at_the_buffer_s_size(self) -> None:
        e = self.results["editing"]
        self.assertEqual(77, e["clamped"])
        self.assertEqual(77, e["atCap"])
        self.assertEqual("z", e["capTail"])   # the '!' was refused, not swapped in

    def test_page_keys_scroll_by_whole_pages_and_clamp(self) -> None:
        """lnxded `0x083ea9f0` divides the line count by the page size and
        `0x083eaa13`/`0x083eaa27` clamp the offset into `[0, pages - 1]`."""
        s = self.results["scroll"]
        self.assertEqual([0, 1, 2, 6, 0], s["steps"])
        self.assertEqual(7, s["pages"])

    def test_scrolling_up_replaces_the_prompt_with_the_plus_marker(self) -> None:
        """lnxded `0x083ec170` drops one scrollback line when the offset is
        non-zero and `0x083ec28f` pushes the sixty `+` in the prompt's
        place."""
        s = self.results["scroll"]
        self.assertEqual("+" * 60, s["scrolledTail"])
        self.assertEqual("> ", s["bottomTail"])

    # ---------------------------------------------------------- the band

    def test_getlines_returns_at_most_n_and_always_ends_with_the_prompt(self) -> None:
        """lnxded `0x083ec0e0`: up to `n - 1` scrollback lines, then the
        prompt line.  A near-empty console gives a short band, not a padded
        one -- `0x083ec147` jumps past the clamp when there is less
        scrollback than room."""
        g = self.results["getLines"]
        self.assertEqual(["> "], g["emptyOnly"])
        self.assertEqual(5, g["shortCount"])
        self.assertEqual(["m0", "m1", "m2", "m3", "> "], g["shortLines"])
        self.assertEqual(20, g["fullCount"])
        self.assertEqual("m31", g["fullFirst"])
        self.assertEqual("> typing", g["fullLast"])

    def test_the_band_is_the_drawer_s_own_arithmetic(self) -> None:
        """`(lineHeight + 1) * lineCount + 4`, client
        `0x00464fca`-`0x00464fce`.  At the capture's 1124 px screen a full
        20-line band with a 22 px pitch is 444 px, 39.5% -- the capture
        measures 442 px, 39%."""
        b = self.results["band"]
        self.assertEqual(424, b["twentyAt21"])
        self.assertEqual(444, b["twentyAt22"])
        self.assertEqual(109, b["fiveAt21"])
        self.assertAlmostEqual(0.395, b["fractionAt1124"], places=3)

    def test_the_wash_is_a_full_width_white_band_at_alpha_0_8(self) -> None:
        """`FUN_004649f0` loads `texture/white.tga` and `FUN_006084e0(quad,
        0x3f4ccccd)` sets alpha 0.8; blend mode 1 is SRCALPHA/INVSRCALPHA
        (`FUN_00608560` `0x006085e8`)."""
        p = self.results["paint"]
        x, y, w, h, style = p["wash"]
        self.assertEqual((0, 0, 2000), (x, y, w))
        self.assertEqual(444, h)
        self.assertEqual(444, p["band"])
        self.assertEqual("rgba(255, 255, 255, 0.8)", style)

    def test_text_starts_two_pixels_in_and_steps_by_the_pitch(self) -> None:
        """`0x00465078` pushes 2.0f as x; line `i` sits at
        `(pitch) * i + 2` (`0x00465063`-`0x00465067`)."""
        p = self.results["paint"]
        self.assertEqual(2, p["firstText"][1])
        self.assertEqual(2, p["firstText"][2])
        self.assertEqual(20, p["textCount"])
        self.assertEqual(["> game.usehud", 2, 22 * 19 + 2], p["lastText"])

    # ------------------------------------------------------- completion

    def test_tab_completes_to_the_longest_common_prefix(self) -> None:
        """`autoCompletion` (lnxded `0x083e83a0`) prefix-matches object and
        method halves with `strncasecmp` and writes the result back with
        `strncpy`; the candidate list it prints is built out of ` (`, `, `,
        `)` and ` -> `."""
        c = self.results["completion"]
        self.assertTrue(c["unique"]["took"])
        self.assertEqual("show.dev", c["unique"]["line"])
        self.assertEqual(0, c["unique"]["printed"])
        self.assertEqual("game.use", c["ambiguous"]["line"])
        self.assertEqual(["game.usehud (int) -> void",
                          "game.useTrees (int) -> void"],
                         c["ambiguous"]["printed"])
        self.assertFalse(c["none"]["took"])

    # ------------------------------------------------------------- input

    def test_an_open_console_swallows_game_keys_and_a_closed_one_does_not(self) -> None:
        s = self.results["swallow"]
        self.assertFalse(s["closedTook"])
        self.assertTrue(s["openTook"])
        self.assertEqual("w", s["lineAfterW"])

    def test_modified_and_unmapped_keys_stay_with_the_page(self) -> None:
        """Ctrl-anything is the browser's, and Escape has to reach the page
        so it can close the console."""
        s = self.results["swallow"]
        self.assertFalse(s["ctrlTook"])
        self.assertFalse(s["escTook"])

    def test_the_toggle_is_the_tilde_key_and_does_not_repeat(self) -> None:
        """`c_GIToggleConsole` is bound to `IDKey_Grave` and `IDKey_Capital`,
        both `c_CMNonRepetive`, in
        `Mods/bf1942/Settings/Default/Controls/Common.con` lines 26-27 and in
        the client's own compiled fallback map at `0x00927088`/`0x00927020`.
        This page spends Caps Lock on the spawn menu, so only Grave toggles."""
        s = self.results["swallow"]
        self.assertTrue(s["isToggle"])
        self.assertFalse(s["isToggleRepeat"])
        self.assertFalse(s["isToggleOther"])


if __name__ == "__main__":
    unittest.main()
