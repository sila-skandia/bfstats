"""Tooltips, OPTIONS > CUSTOMIZE, the pause and the display-width font metrics.

Gap audit 2026-11-12, entries 22, 50, 56 and 57. What is pinned here is
retail's, each number read at the address the module's own comment gives:

- the tooltip manager (`viewer/tooltips.js`): off under the shipped profile,
  the entry help 15 s with no key rows, priorities, the once-only spawn queue,
  the 4 s state panel, and what T does;
- `tooltip-layout.json` (`extract_tooltips.py`): the plate, the pause message,
  the timers, and `setToolTipType` per vehicle (the Wasserfall's 0x24);
- the general options screen (`viewer/general-options.js`,
  `extract_general_options_layout.py`);
- FONT-3's rescale table and FONT-5's snap (`viewer/bitmap-text.js`);
- P pausing single player (`viewer/page-input.js`).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "hud_options_harness.mjs"
sys.path.insert(0, str(ROOT))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402

GAME = DEFAULT_GAME_DIR.expanduser()
HAS_GAME = (GAME / "Mods" / "bf1942" / "Archives" / "menu.rfa").is_file() \
    or (GAME / "Mods" / "bf1942" / "Archives" / "Menu.rfa").is_file()

_OUT: dict | None = None
_LAYOUTS: dict | None = None


def layouts() -> dict:
    """The two extractors run over the installed game, once."""
    global _LAYOUTS
    if _LAYOUTS is None:
        if not HAS_GAME:
            raise unittest.SkipTest("no game archives on this machine")
        import extract_general_options_layout as general
        import extract_tooltips as tooltips
        tmp = Path(tempfile.mkdtemp(prefix="hud-options-"))
        tooltips.main(["--game-dir", str(GAME), "--out", str(tmp / "hud")])
        tooltips.main(["--game-dir", str(GAME), "--mod", "xpack2", "--out", str(tmp / "xpack2")])
        general.main(["--game-dir", str(GAME), "--out", str(tmp / "hud" / "menu")])
        _LAYOUTS = {
            "tooltips": json.loads((tmp / "hud" / "tooltip-layout.json").read_text()),
            "xpack2": json.loads((tmp / "xpack2" / "tooltip-layout.json").read_text()),
            "general": json.loads((tmp / "hud" / "menu" / "general-options-layout.json").read_text()),
            "dir": tmp,
        }
    return _LAYOUTS


def harness() -> dict:
    global _OUT
    if _OUT is None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            for name in ("tooltips.js", "general-options.js", "bitmap-text.js", "video-settings.js"):
                shutil.copyfile(VIEWER / name, work / name)
            if HAS_GAME:
                (work / "general-options-layout.json").write_text(json.dumps(layouts()["general"]))
            (work / "package.json").write_text('{"type":"module"}\n')
            shutil.copyfile(HARNESS, work / "harness.mjs")
            proc = subprocess.run(["node", str(work / "harness.mjs")], cwd=work,
                                  capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        _OUT = json.loads(proc.stdout)
    return _OUT


class ToolTipManagerTests(unittest.TestCase):
    def test_the_shipped_profile_shows_none(self) -> None:
        o = harness()
        self.assertFalse(o["offShows"])
        self.assertFalse(o["offVars"])
        self.assertFalse(o["pageOff"])
        self.assertFalse(o["pageOffInSeat"])

    def test_the_entry_help_is_fifteen_seconds_with_no_key_rows(self) -> None:
        o = harness()
        self.assertEqual(15, o["constants"]["vehicle"])
        self.assertTrue(o["shows"])
        v = o["vehicle"]
        self.assertEqual([True, False], [v["show"], v["small"]])
        self.assertEqual("HEAVY TANK", v["heading"])
        self.assertEqual("The HEAVY TANK has the best armor.", v["body"])
        self.assertEqual("T TO CLOSE THIS TOOLTIP", v["footer"])
        self.assertEqual(["", ""], [v["key0"], v["keyText0"]])
        self.assertEqual(["TOOLTIPS ARE ON", "T TO CLOSE THIS TOOLTIP"], [v["state"], v["change"]])
        self.assertTrue(o["upAt15"])
        self.assertTrue(o["downAfter15"])
        # The panel stands while tooltips are on (its fade needs
        # `FadeToolTipText`, which only turning them off sets).
        self.assertEqual(4, o["constants"]["fade"])
        self.assertTrue(o["textStays"])

    def test_priority(self) -> None:
        o = harness()
        self.assertFalse(o["lowerWaits"])
        self.assertFalse(o["sameIdAgain"])
        self.assertTrue(o["equalReplaces"])

    def test_a_near_tip_comes_down_when_left(self) -> None:
        o = harness()
        self.assertTrue(o["nearUp"])
        self.assertFalse(o["wrongIdStays"])
        self.assertTrue(o["disabled"])
        self.assertEqual({"active": False, "state": "TOOLTIPS ARE ON", "change": "T TO TURN TOOLTIPS OFF"},
                         o["afterDisable"])

    def test_the_spawn_queue_plays_in_order_each_once(self) -> None:
        o = harness()
        first = o["queueFirst"]
        self.assertEqual([1, 1], [first["id"], first["index"]])
        self.assertEqual(["LEFT CTRL", "Z", "F8", ""], first["keys"])
        self.assertEqual(["crouching/standing", "prone/standing", "radio"], first["texts"])
        self.assertEqual(5, o["queueSecond"])
        self.assertTrue(o["queueEmpty"])
        self.assertTrue(o["onceOnly"])
        self.assertEqual(25, o["constants"]["kit"])
        self.assertEqual([[2, "TOOLTIP_SOLDIER_SCOUT", 5], [3, "TOOLTIP_SOLDIER_ASSAULT", 4],
                          [4, "TOOLTIP_SOLDIER_AT", 4], [5, "TOOLTIP_SOLDIER_MEDIC", 5],
                          [6, "TOOLTIP_SOLDIER_ENGINEER", 6]], o["constants"]["kits"])

    def test_the_tooltip_key(self) -> None:
        o = harness()
        self.assertEqual([True, False], o["tCloses"])
        self.assertEqual([False, "TOOLTIPS ARE OFF", "T TO TURN TOOLTIPS ON"], o["tOff"])
        self.assertEqual([True, "TOOLTIPS ARE ON", "T TO TURN TOOLTIPS OFF"], o["tOn"])
        # Turned off, the panel fades over four seconds and goes.
        self.assertEqual([True, 0.5], o["fadeHalf"])
        self.assertEqual([False, 1], o["fadeDone"])

    def test_the_spawn_screens_tips_are_on_its_canvas(self) -> None:
        o = harness()
        # ids 0 and 0x1e, 10 s each, once (client 0x006ad31f, 0x006ad358).
        self.assertEqual([0, 0x1E, 0x18, 0x1D, 0.2], o["ids"])
        self.assertEqual({"over": [True, "Welcome"], "main": False, "text": False}, o["spawnWelcome"])
        self.assertEqual([True, "RESPAWN INTERFACE", "ENTER", "close the spawninterface"], o["spawnRespawn"])
        self.assertFalse(o["spawnOnce"])
        # Capture the Flag (mode 1): no welcome, the respawn help comes first.
        self.assertEqual("TOOLTIP_RESPAWN_HEADING", o["ctfWelcome"])

    def test_the_flag_and_the_low_tickets(self) -> None:
        o = harness()
        self.assertEqual([True, "CLOSE TO FLAG", False], o["flag"])
        self.assertFalse(o["flagLeft"])
        # Under a fifth, not at it (0x008eaf70 is 0.2, the compare strict).
        self.assertFalse(o["ticketsAtFifth"])
        self.assertEqual([True, "TICKET LOW"], o["ticketsLow"])
        self.assertFalse(o["ticketsOnce"])

    def test_the_page_feeds_it(self) -> None:
        o = harness()
        self.assertTrue(o["pageToggle"])
        self.assertTrue(o["pageOptionWritten"])
        self.assertEqual([True, "HEAVY TANK"], o["pageVehicle"])
        self.assertEqual("HEAVY TANK", o["pageHudType"])
        self.assertEqual("REPAIR", o["pageRepair"])
        self.assertFalse(o["pageRepairGone"])

    def test_the_page_wires_it(self) -> None:
        page = (VIEWER / "map.html").read_text()
        self.assertIn("toolTips.frame(dt);", page)
        self.assertIn("toggleToolTip: () => toolTips.toggleKey(),", page)
        keys = (VIEWER / "page-input.js").read_text()
        self.assertIn("triggers.includes('c_PIToolTip')", keys)
        console = (VIEWER / "page-console.js").read_text()
        self.assertIn("object: 'game', method: 'setToolTip',", console)
        self.assertIn("setToolTip: true, setRadioToolTip: true", console)


class ToolTipTypeTests(unittest.TestCase):
    def test_the_names_are_the_parsers(self) -> None:
        from bf42 import con
        # `operator>>(istream&, ToolTipType&)` lnxded 0x0829be20.
        self.assertEqual(0, con.TOOL_TIP_TYPES["TTHeavyTank"])
        self.assertEqual(0x0E, con.TOOL_TIP_TYPES["TTLcvp"])
        self.assertEqual(0x0F, con.TOOL_TIP_TYPES["TTDefGun"])
        self.assertEqual(0x1C, con.TOOL_TIP_TYPES["TTGoblin"])
        self.assertEqual(0x1D, con.TOOL_TIP_TYPES["TTCommandoRaft"])
        self.assertEqual(0x24, con.TOOL_TIP_TYPES["TTWasserfall"])
        self.assertEqual(0x2E, con.TOOL_TIP_TYPES["TTSasWilly"])
        self.assertEqual(0x2F, con.tool_tip_type_id("TTNoSuchThing"))
        self.assertIsNone(con.tool_tip_type_id(None))
        self.assertEqual("TOOLTIP_WASSERFALL", con.TOOL_TIP_STRINGS[0x24])
        self.assertEqual("TOOLTIP_DEFGUN", con.TOOL_TIP_STRINGS[0x0F])
        self.assertEqual(len(con.TOOL_TIP_TYPES), len(con.TOOL_TIP_STRINGS))

    def test_the_parser_reads_the_word(self) -> None:
        from bf42 import con
        library = con.ObjectLibrary()
        library.add_con("Objects/Test/Objects.con",
                        "ObjectTemplate.create PlayerControlObject Tiger\n"
                        "ObjectTemplate.setToolTipType TTHeavyTank\n"
                        "ObjectTemplate.create PlayerControlObject Crate\n")
        self.assertEqual("TTHeavyTank", library.object("Tiger").tool_tip_type)
        self.assertIsNone(library.object("Crate").tool_tip_type)

    def test_the_pack_table(self) -> None:
        from extract_tooltips import tool_tip_vehicles
        table = tool_tip_vehicles([
            "ObjectTemplate.create PlayerControlObject Wasserfall\n"
            "ObjectTemplate.setToolTipType TTWasserfall\n"
            "ObjectTemplate.create PlayerControlObject Crate\n",
            "ObjectTemplate.active Sherman\nObjectTemplate.setToolTipType TTHeavyTank\n"])
        self.assertEqual({"sherman": 0, "wasserfall": 0x24}, table)


class ToolTipLayoutTests(unittest.TestCase):
    def test_the_plate_and_the_pause_message(self) -> None:
        d = layouts()["tooltips"]
        tip = d["groups"]["toolTip"]["elements"]
        pause = d["groups"]["pause"]["elements"]
        self.assertEqual(58, len(tip))
        self.assertEqual(2, len(pause))
        text = next(el for el in pause if el["kind"] == "text")
        self.assertEqual("Pause/PauseStatusMessage", text["var"])
        self.assertEqual("trebuchet_ms14", text["font"])
        self.assertEqual([310.0, 254.0, 240.0, 20.0], text["rect"])
        self.assertEqual("PAUSED", d["strings"]["GAME_PAUSE"])
        for el in tip:
            self.assertTrue(any(c["var"].startswith("ToolTip/") for c in el["when"]))

    def test_the_timers_are_the_graphs(self) -> None:
        timers = layouts()["tooltips"]["timers"]
        self.assertEqual("ToolTip/ToolTipTime", timers["timeout"]["timeVar"])
        self.assertEqual("ToolTip/MaxToolTipTime", timers["timeout"]["maxVar"])
        self.assertEqual(4.0, timers["textFade"]["endTime"])
        self.assertEqual([1.0, 0.0], [timers["textFade"]["from"], timers["textFade"]["to"]])

    def test_the_vehicle_classes(self) -> None:
        d = layouts()
        vanilla = d["tooltips"]["vehicles"]
        self.assertEqual(0, vanilla["tiger"])
        self.assertEqual(7, vanilla["b17"])
        self.assertNotIn("wasserfall", vanilla)
        # SPAWN-14's exemption reads this one (0x24).
        self.assertEqual(0x24, d["xpack2"]["vehicles"]["wasserfall"])
        self.assertEqual("TOOLTIP_WASSERFALL", d["xpack2"]["types"][0x24])
        self.assertIn("TOOLTIP_HEAVY_TANK_HEADING", d["tooltips"]["strings"])

    def test_its_pictures_and_fonts_are_written(self) -> None:
        d = layouts()
        hud = d["dir"] / "hud"
        for key, entry in d["tooltips"]["icons"].items():
            self.assertTrue((hud / entry["file"]).is_file(), key)
        self.assertIn("tooltip_xl_256x256", d["tooltips"]["icons"])
        self.assertIn("textmessbg_1line_256x32", d["tooltips"]["icons"])
        self.assertEqual({"standard6", "trebuchet_ms14", "trebuchet_ms8"}, set(d["tooltips"]["fontFiles"]))


class GeneralOptionsTests(unittest.TestCase):
    def test_the_rows_and_the_shipped_defaults(self) -> None:
        o = harness()
        self.assertEqual([
            ["toolTip", "tick", "game.setToolTip"],
            ["radioToolTip", "tick", "game.setRadioToolTip"],
            ["staticMinimap", "tick", "game.setStaticMinimap"],
            ["minimapTransparency", "slider", "game.setMinimapTransparency"],
            ["crossHairRed", "slider", "game.setCrossHairColor"],
            ["crossHairGreen", "slider", "game.setCrossHairColor"],
            ["crossHairBlue", "slider", "game.setCrossHairColor"]], o["generalRows"])
        # Profiles/Default/GeneralOptions.con.
        self.assertEqual({"toolTip": False, "radioToolTip": True, "staticMinimap": True,
                          "minimapTransparency": 20, "crossHairRed": 255, "crossHairGreen": 255,
                          "crossHairBlue": 0}, o["generalDefaults"])
        self.assertEqual({"toolTip": True, "radioToolTip": False, "staticMinimap": False,
                          "minimapTransparency": 84, "crossHairRed": 255, "crossHairGreen": 0,
                          "crossHairBlue": 0}, o["generalRead"])

    def test_the_screen_is_the_files(self) -> None:
        if not HAS_GAME:
            raise unittest.SkipTest("no game archives on this machine")
        panel = harness()["panel"]
        self.assertTrue(panel["has"])
        rows = {r["id"]: r for r in panel["rows"]}
        # menu/GeneralOptionsMenu's own rects.
        self.assertEqual([397.0, 206.0, 17.0, 17.0], rows["toolTip"]["hit"])
        self.assertEqual([401.0, 210.0, 9.0, 9.0], rows["toolTip"]["mark"])
        self.assertEqual([397.0, 236.0, 17.0, 17.0], rows["radioToolTip"]["hit"])
        self.assertEqual([397.0, 266.0, 17.0, 17.0], rows["staticMinimap"]["hit"])
        self.assertEqual([397.0, 302.0, 74.0, 9.0], rows["minimapTransparency"]["track"])
        self.assertEqual([397.0, 325.0, 74.0, 9.0], rows["crossHairRed"]["track"])
        self.assertEqual([397.0, 343.0, 74.0, 9.0], rows["crossHairGreen"]["track"])
        self.assertEqual([397.0, 361.0, 74.0, 9.0], rows["crossHairBlue"]["track"])
        self.assertEqual({"default", "save"}, set(panel["nav"]))
        self.assertEqual([400.0, 180.0, 170.0, 20.0], panel["name"])
        o = harness()
        self.assertEqual([0, 100, 50], o["pick"])
        self.assertEqual(255, o["pickRed"])
        self.assertEqual([397.0, 303.0, 7, 7.0], o["knob"][0])

    def test_no_radio_colour_row_ships(self) -> None:
        general = layouts()["general"]
        keys = {el.get("key") for el in general["pages"]["general"]["elements"]}
        self.assertFalse(any(k and "RADIO" in k and "COLOR" in k for k in keys))
        variables = {c["var"] for el in general["pages"]["general"]["elements"] for c in el.get("when", [])}
        self.assertFalse(any("Radio/Color" in v for v in variables))

    def test_the_profile_holds_them(self) -> None:
        controls = (VIEWER / "controls.js").read_text()
        self.assertIn("'game.setToolTip': 0,", controls)
        self.assertIn("'game.setRadioToolTip': 1,", controls)
        self.assertIn("controls.setGeneralOption = (verb, value) => {", controls)
        screen = (VIEWER / "play" / "controls-screen.js").read_text()
        self.assertIn("const SECTIONS = ['controls', 'general', 'video', 'sound'];", screen)
        for caller in ("page-console.js", "play/front-end.js"):
            self.assertIn("{ key: 'MENU_GENERAL_OPTIONS', id: 'general' }", (VIEWER / caller).read_text())


class FontMetricsTests(unittest.TestCase):
    def test_the_table_is_the_clients(self) -> None:
        scales = harness()["scales"]
        # A: floats at client 0x00959f00..0c; B: the immediates of 0x0069a9f0.
        self.assertEqual({"640", "1024", "1152", "1280", "1920", "2048"}, set(scales))
        self.assertEqual([0.95, 1.25], scales["640"])
        self.assertEqual([1.25, 0.78125], scales["1024"])
        self.assertEqual([1.5, 0.625], scales["1280"])
        for width in ("1152", "1920", "2048"):
            self.assertEqual(1.5, scales[width][0])
            self.assertAlmostEqual(0.694444, scales[width][1], places=6)

    def test_trebuchet_ms8_at_1920_is_the_ledgers(self) -> None:
        o = harness()["at1920"]
        # FONT-3: S 6 -> 6.944, A 8 -> 9.028, W 11 -> 11.806, I 3 -> 3.472, space 3 -> 3.472.
        self.assertAlmostEqual(6.944, o["S"], places=3)
        self.assertAlmostEqual(9.028, o["A"], places=3)
        self.assertAlmostEqual(11.806, o["W"], places=3)
        self.assertAlmostEqual(3.472, o["I"], places=3)
        self.assertAlmostEqual(3.472, o["space"], places=3)
        self.assertAlmostEqual(8.333, o["ascent"], places=3)
        self.assertAlmostEqual(8.333, o["drawH"], places=3)
        self.assertAlmostEqual(7.639, o["drawW"], places=3)

    def test_unlisted_widths_are_native(self) -> None:
        o = harness()
        self.assertEqual([6, 6, 6, 6], o["native"])
        self.assertEqual(6 + 8 + 11, o["measure800"])
        self.assertAlmostEqual(6.944 + 9.028 + 11.806, o["measure1920"], places=2)
        self.assertAlmostEqual(10.0, o["at640"], places=6)      # (7 + 1) * 1.25
        self.assertAlmostEqual(7.8125, o["at1024"], places=6)   # (9 + 1) * 0.78125
        self.assertAlmostEqual(8.125, o["at1280"], places=6)    # (11 + 2) * 0.625

    def test_the_round_and_the_snap(self) -> None:
        o = harness()
        self.assertEqual([8, 7, 11, 0], o["rounds"])
        # s = 2.4 at 1920: 10.1 -> 24.24 -> 24 / 2.4 = 10; 10.3 -> 24.72 -> 25 / 2.4.
        self.assertAlmostEqual(10.0, o["snap1920"][0], places=6)
        self.assertAlmostEqual(25 / 2.4, o["snap1920"][1], places=6)
        self.assertEqual(10.3, o["snap800"])

    def test_the_hud_draws_with_them(self) -> None:
        hud = (VIEWER / "hud.js").read_text()
        # `hud.js` ships to its harnesses alone: the page hands the table in.
        self.assertIn("export function setGlyphTable(fn) {", hud)
        self.assertIn("pen + left, y + base - ascent, drawW, drawH);", hud)
        page = (VIEWER / "map.html").read_text()
        self.assertIn("setHudGlyphTable(glyphTable);", page)


class TextPathTests(unittest.TestCase):
    """Every text path takes the display width's metrics, and the list and
    the text field snap (the follow-up to entry 50)."""

    def test_the_menu_and_the_log_take_the_table(self) -> None:
        menu = (VIEWER / "play" / "menu-screen.js").read_text()
        self.assertIn("export function setTextMetrics({ glyphTable = null, snapToPixel = null } = {}) {", menu)
        self.assertIn("export function drawBitmapText(ctx, font, tint, text, x, y, color, snap = false) {", menu)
        comms = (VIEWER / "comms.js").read_text()
        self.assertIn("const glyphRows = () => page.glyphTable?.(font) ?? font.meta.glyphs;", comms)
        page = (VIEWER / "map.html").read_text()
        self.assertIn("setMenuTextMetrics({ glyphTable, snapToPixel });", page)
        self.assertIn("{ glyphTable, snapToPixel },", page)
        self.assertIn("setTextMetrics({ glyphTable, snapToPixel });", (VIEWER / "play" / "front-end.js").read_text())

    def test_the_list_and_the_text_field_snap(self) -> None:
        comms = (VIEWER / "comms.js").read_text()
        # The message log's rows and the open chat line.
        self.assertIn("text(ctx, row.text, g.textX, g.baseline, lineColor(chatLayout, row), true, true);", comms)
        self.assertIn("text(ctx, say.text, ex, baseline, rgb, true, true);", comms)
        board = (VIEWER / "scoreboard.js").read_text()
        self.assertIn("Math.round(cell.x), Math.round(cell.y), rgb, true);", board)
        self.assertIn("{ rgb, snap }", (VIEWER / "scoreboard-screen.js").read_text())
        for name, count in (("multiplay.js", 2), ("create-game.js", 1), ("mod-picker.js", 2),
                            ("campaign-screen.js", 2)):
            src = (VIEWER / "play" / name).read_text()
            self.assertGreaterEqual(len(re.findall(r"drawBitmapText\([^;]*?, true\);", src, re.S)), count, name)

    def test_the_outline_is_the_eight_neighbours(self) -> None:
        self.assertEqual([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
                         harness()["outlineCopies"])
        src = (VIEWER / "bitmap-text.js").read_text()
        self.assertIn("const gy = y + oy + (font.meta.baseline - ascent) * scale;", src)

    def test_the_console_sets_the_flash(self) -> None:
        words = (VIEWER / "console-commands.js").read_text()
        self.assertIn("if (n !== null) get('mapFlash').setCount(n);", words)
        self.assertIn("get('mapFlash').setBlink(a, b);", words)
        self.assertIn("mapFlash: () => mapFlash,", (VIEWER / "map.html").read_text())


class PauseTests(unittest.TestCase):
    def test_p_pauses_only_where_the_page_is_the_server(self) -> None:
        keys = (VIEWER / "page-input.js").read_text()
        self.assertIn("return !!page.world && !page.roomJoined?.() && !page.replayActive?.();", keys)
        self.assertIn("triggers.includes('c_GITogglePause')", keys)
        self.assertIn("vars['Pause/ShowPauseMessage'] = on;", keys)
        self.assertIn("if (on) audio?.suspend?.();", keys)

    def test_a_paused_page_runs_no_frame(self) -> None:
        page = (VIEWER / "map.html").read_text()
        at = page.index("if (pageInput.gamePaused) {")
        self.assertLess(at, page.index("frame(Math.min(clock.getDelta(), 0.1));"))
        self.assertIn("pauseText: () => hudFeed.gameHud.toolTipLayout?.strings?.GAME_PAUSE ?? null,", page)


if __name__ == "__main__":
    unittest.main()
