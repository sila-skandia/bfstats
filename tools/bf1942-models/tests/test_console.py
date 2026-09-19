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
        """Client ctor `0x005a2230`: prompt `"> "`, `[esi+0x138] = 0x4d`
        (77, the edit buffer's size), `[esi+0x15c] = 8` (the PageUp step).
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

    def test_the_two_deque_caps_are_1024_and_10(self) -> None:
        """Not 10000.  `setMaxHistorySize` (lnxded `0x083edf60`) writes
        `this+0x2c`, which is what `output` compares the scrollback deque
        against before popping (`0x083dd018`); the constructor sets it to
        `0x400` (lnxded `0x083dc037`, client `0x005a224c`).
        `setMaxCommandHistorySize` (`0x083edff0`) writes `this+0x5c`, the cap
        of the Up/Down deque, and the constructor sets that to 10 (lnxded
        `0x083dc09c`, client `0x005a226e`).  The 10000 the constructor also
        writes (`[edi+0x1bc]` / `[esi+0x2fc]`) is neither of them: no reader
        in `handleCommand`, `output` or `getLines` touches it."""
        c = self.results["constants"]
        self.assertEqual(1024, c["maxScrollback"])
        self.assertEqual(10, c["maxCommandHistory"])

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

    def test_a_typed_line_does_not_move_the_line_counter(self) -> None:
        """The increment at lnxded `0x083e9f89` sits past the dispatch switch
        AND behind `cmp BYTE PTR [ebp-0x8b5],0` (`0x083e9f7d`) -- the fifth
        bool parameter of `executeLine`, stored from `ebp+0x24` at
        `0x083e9b0d`.  The client is the same, incrementing `[esi+0x328]`
        behind `cmp byte ptr [ESP+0x768]` at `0x005a12a5`.

        `updateAsciiKey`'s Enter branch pushes `0, 0, 1, 1, 1` (lnxded
        `0x083eabe5`, client `0x005a1381`), so that bool is false for every
        line a player types.  Only `run` passes it true (`0x083ecafd`) -- and
        `run` saves, zeroes and restores the counter around the file
        (`0x083ec6d3` / `0x083ec6f1` / `0x083ecbac`), as does `include`.

        So `Error  (N):` is a line number inside a running `.con` file, and
        at the prompt it is a constant: the same N on every error."""
        cap = self.results["capture"]
        self.assertEqual(2, cap["lineNumberAfter"])
        self.assertEqual("Error  (2): game.showHud", cap["secondError"])

    def test_a_fresh_console_prints_zero_and_keeps_printing_zero(self) -> None:
        """Which is what the page itself does.  The owner's capture reads (2)
        because that client's counter held 2; this reconstruction cannot
        derive that value, and inventing a starting number would be a lie
        about a counter that does not count."""
        f = self.results["freshCounter"]
        self.assertEqual(["Error  (0): game.showHud",
                          "Error  (0): game.showHud"], f["lines"])
        self.assertEqual(0, f["lineNumber"])

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
        """The viewer's one deliberate divergence.  The whole server binary
        compares a token against the `"="` literal (`0x086e6da4`) in three
        places, all in `handleCommand` and all on the `var` / `const` /
        `v_`-assignment paths: `0x083e14c3`, `0x083e1a43`, `0x083e78ce`.
        There is no `cmp ...,0x3d` in `handleCommand` at all, and `getArgs`
        tests only 0x20 and 0x22 -- so the real engine hands `show.dev = 1`
        two arguments.  The page accepts the spelling its own users were
        told to type."""
        p = self.results["parse"]
        self.assertEqual(["1"], p["equals"]["args"])
        self.assertEqual([], p["equalsAlone"]["args"])

    def test_the_equals_divergence_cannot_touch_any_other_line(self) -> None:
        """It is stripped off the raw argument text by a regex anchored at
        the start and requiring whitespace or end after it, so a quoted
        `"="`, an `=` glued to its value and an `=` in any later position all
        reach the method exactly as the engine would pass them."""
        p = self.results["parse"]
        self.assertEqual(["=", "tail"], p["equalsQuoted"]["args"])
        self.assertEqual(["=1"], p["equalsGlued"]["args"])
        self.assertEqual(["x", "=", "y"], p["equalsLater"]["args"])

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

    def test_the_command_history_keeps_only_the_last_ten(self) -> None:
        """The constructor's `[edi+0x5c] = 0xa` (lnxded `0x083dc09c`, client
        `[esi+0x34]` `0x005a226e`), the member `setMaxCommandHistorySize`
        writes."""
        h = self.results["history"]
        self.assertEqual(10, h["cappedSize"])
        self.assertEqual("a.b 15", h["cappedOldest"])

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

    def test_scrolling_up_adds_the_plus_marker_above_the_prompt(self) -> None:
        """Not in the prompt's place.  lnxded `0x083ec170` drops one
        scrollback line when the offset is non-zero and `0x083ec28f` pushes
        the sixty `+`; then the marker block falls out at `0x083ec2cd` into
        the same `0x083ec1ff` the unscrolled path reaches, which appends the
        edit buffer to the prompt and pushes that too.  The client agrees:
        `0x005a2037` skips only the marker, `0x005a2060` always runs.  So the
        view is still `n` lines and you can still see what you are typing."""
        s = self.results["scroll"]
        self.assertEqual(20, s["scrolledCount"])
        self.assertEqual("+" * 60, s["scrolledMarker"])
        self.assertEqual("> typing", s["scrolledTail"])
        self.assertEqual("> typing", s["bottomTail"])

    def test_any_other_key_snaps_the_view_back_to_the_bottom(self) -> None:
        """The common tail at lnxded `0x083ea973` multiplies the scroll
        offset by `(ch == 0x02 || ch == 0x06)` and the history index by
        `(ch == 0x10 || ch == 0x0e)` -- the two `imul` at `0x083ea9a0` and
        `0x083ea98b`.  Every branch of `updateAsciiKey` reaches it, Enter
        (`0x083eac29`) and Tab (`0x083eab77`) included."""
        t = self.results["tailResets"]
        self.assertEqual(1, t["scrolled"])
        self.assertEqual(0, t["afterTyping"])
        self.assertEqual(0, t["afterBackspace"])
        self.assertEqual(0, t["pageKeysKeepIt"])   # up then down, back to 0
        self.assertEqual(0, t["afterHistory"])
        self.assertEqual("a.b 1", t["historyLine"])

    def test_output_splits_on_newlines_and_at_the_line_size(self) -> None:
        """`OldConsole::output` (lnxded `0x083dcf50`) closes the current line
        on NUL, on `\\n` (`0x083dcf9c`) and on the buffer filling -- `cmp
        ecx,[edi+0x160]` / `jle` at `0x083dcfce`, where `[edi+0x160]` is
        `maxLineSize`.  The `jle` is why a chunk is 78 characters and not 77.
        Then the deque is trimmed from the front against `this+0x2c`
        (`0x083dd018`)."""
        o = self.results["output"]
        self.assertEqual(["one", "two"], o["newlines"])
        self.assertEqual([78, 78, 3], o["wrapped"])
        self.assertEqual(1024, o["capped"])
        self.assertEqual("l30", o["oldestKept"])

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

    def test_tab_is_swallowed_even_when_nothing_completes(self) -> None:
        """`updateAsciiKey`'s 0x09 branch (`0x083eab6e`) calls
        `autoCompletion` and returns through the same tail as every other
        key: the game never sees Tab.  Neither may the browser -- an
        unprevented Tab moves focus into the hidden `#side` panel sitting
        behind the console."""
        c = self.results["completion"]
        self.assertTrue(c["noneKey"])
        self.assertTrue(c["noneEvent"])

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

    def test_the_toggle_is_the_physical_key_not_the_character(self) -> None:
        """`event.code` is the physical key regardless of layout, which is
        the right analogue of `IDKey_Grave`: the engine's control map names a
        DirectInput scancode, not a character.  The key left of `1` prints a
        superscript two on AZERTY and a circumflex on QWERTZ, and all three
        layouts open the console there; a `~` produced by some other physical
        key does not."""
        s = self.results["swallow"]
        self.assertTrue(s["isToggleAzerty"])
        self.assertTrue(s["isToggleQwertz"])
        self.assertFalse(s["isToggleTildeElsewhere"])
        # A key event with no `code` falls back on the character.
        self.assertTrue(s["isToggleNoCodeGrave"])
        self.assertTrue(s["isToggleNoCodeTilde"])
        self.assertFalse(s["isToggleNoCodeOther"])

    def test_every_game_key_is_eaten_while_the_console_is_up(self) -> None:
        """WASD, use, fire, the view and map keys and the weapon row all
        become characters in the edit line; modifiers and function keys stay
        with the page, which is what lets Escape close the console and the
        browser keep its own shortcuts."""
        g = self.results["swallow"]["gameKeys"]
        for code in ("KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "Space",
                     "KeyC", "KeyM", "KeyN", "Digit1", "Digit5"):
            self.assertTrue(g[code], code)
        for code in ("ShiftLeft", "ControlLeft", "F5", "Home"):
            self.assertFalse(g[code], code)
        self.assertEqual("wasde cmn15", self.results["swallow"]["typed"])


if __name__ == "__main__":
    unittest.main()
