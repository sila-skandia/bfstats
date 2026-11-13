"""OPTIONS > CONTROLS: the retail screen, filled from the player's profile.

features/viewer-profile-controls. The sentence these tests defend:

    every row the game's CONTROLS screen draws says what the player's profile
    binds it to, in the game's own words, and lights when that binding is
    pressed.

The pages are the game's own (`extract_controls_menu_layout.py` ->
`viewer/maps/_shared/hud/menu/controls-layout.json`); the row-to-trigger
table is `viewer/controls-rows.js`, since the engine's index is in no file.
The owner's profile is `fixtures/controls-profile-skandia/`, and its COMMON
page is checked against a capture of the retail options screen showing it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "controls_menu_harness.mjs"
LAYOUT = ROOT / "viewer" / "maps" / "_shared" / "hud" / "menu" / "controls-layout.json"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not LAYOUT.is_file():
        raise unittest.SkipTest(
            "controls-layout.json is not extracted — run extract_controls_menu_layout.py")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class _Harness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()


class LayoutTests(unittest.TestCase):
    """What the extractor takes out of `menu.rfa`."""

    @classmethod
    def setUpClass(cls) -> None:
        if not LAYOUT.is_file():
            raise unittest.SkipTest("controls-layout.json is not extracted")
        cls.layout = json.loads(LAYOUT.read_text())

    def test_the_four_tabs_and_their_pages(self) -> None:
        tabs = self.layout["tabs"]
        self.assertEqual({"common": 3, "infantry": 2, "air": 2, "landSea": 2},
                         {k: len(v["pages"]) for k, v in tabs.items()})
        # `Options/Controls/Tab` as the tab heads set it: LAND & SEA is 3.
        self.assertEqual({"common": 1, "infantry": 2, "landSea": 3, "air": 4},
                         {k: v["id"] for k, v in tabs.items()})

    def test_the_row_pages_sit_on_the_plate(self) -> None:
        # The retail capture puts ENTER / EXIT VEHICLE's box top at y=160.
        first = self.layout["tabs"]["common"]["pages"][0]["rows"][0]
        self.assertEqual("ENTER / EXIT VEHICLE:", first["text"])
        self.assertEqual([217.0, 160.0, 90.0, 19.0], first["primary"])
        self.assertEqual([317.0, 160.0, 90.0, 19.0], first["alternate"])

    def test_the_pointer_plates_are_kept(self) -> None:
        # `menu/ControlsMenu`'s DEFINE KEY plates and conflict bar, parked off
        # screen by their pointer placement, come out beside the pages with
        # their corner at the pointer.
        popups = self.layout["popups"]
        define = popups["defineKey"]
        self.assertEqual(["DEFINE KEY", "DEFINE ALTERNATE KEY"],
                         [el["text"] for el in define if el["kind"] == "text"])
        fills = [el for el in define if el["kind"] == "fill"]
        self.assertEqual([[0.0, 0.0, 120.0, 15.0]] * 2, [el["rect"] for el in fills])
        self.assertEqual([0.5078, 0.5234, 0.4297, 1.0], fills[0]["color"])
        self.assertEqual([0.0, 3.0], [el["rect"][:2] for el in define if el["kind"] == "text"][0])
        bar = [el for el in popups["conflict"] if el["kind"] == "fill"]
        self.assertEqual([0.0, 0.0, 300.0, 15.0], bar[0]["rect"])
        self.assertEqual([0.6953, 0.2852, 0.2852, 1.0], bar[0]["color"])
        # None of them is left among the drawn elements.
        for page in self.layout["pages"].values():
            self.assertTrue(all(abs(v) < 1e6 for el in page["elements"] for v in el["rect"]))

    def test_the_pager_arrows(self) -> None:
        pages = self.layout["tabs"]["common"]["pages"]
        self.assertEqual({"next"}, set(pages[0]["pager"]))
        self.assertEqual({"prev", "next"}, set(pages[1]["pager"]))
        self.assertEqual({"prev"}, set(pages[2]["pager"]))


    def test_the_video_screen_is_the_games(self) -> None:
        # `menu/VideoMenu`: three plates, and one row per `Video.con` setting.
        video = self.layout["pages"]["video"]["elements"]
        self.assertEqual("menu/VideoMenu", self.layout["pages"]["video"]["source"])
        self.assertEqual(
            ["VIDEO PERFORMANCE", "DISPLAY MODE", "VIDEO OPTIONS"],
            [el["text"] for el in video if el.get("key") in (
                "VIDEO_OPTIONS_VIDEO_PERF", "VIDEO_OPTIONS_DISPLAY_MODE", "VIDEO_OPTIONS")])
        rows = [el["text"] for el in video
                if el["kind"] == "text" and el["rect"][0] == 312.0 and el["rect"][1] > 140]
        self.assertEqual(
            ["GRAPHICS QUALITY:", "EFFECTS QUALITY:", "ENVIRONMENT MAPPING:", "LIGHTMAPS:",
             "SHADOWS:", "TEXTURE QUALITY:", "VIEW DISTANCE:", "ALTERNATIVE SPAWN INTERFACE:"],
            rows)
        # The game draws no anti-aliasing row: that one is this site's.
        self.assertFalse([el for el in video if "ALIAS" in el.get("text", "").upper()])
        for name in ("menu_options_512x512", "menu_videoperf_256x128", "menu_videodispl_256x256"):
            self.assertIn(name, self.layout["textures"])


class VideoTests(_Harness):
    """OPTIONS > VIDEO: features/video-options."""

    def test_the_panel_is_the_games_plate_and_heading(self) -> None:
        video = self.results["video"]
        self.assertTrue(video["has"])
        self.assertEqual([["picture", "menu_options_512x512"], ["text", "VIDEO OPTIONS"]],
                         video["panel"])

    def rows(self) -> dict:
        return {r["id"]: r for r in self.results["video"]["rows"]}

    def test_the_rows_are_the_games_in_its_order_on_its_lines(self) -> None:
        video = self.results["video"]
        # The file's eight lines, and the eight rows set on them in order:
        # the game's seven the viewer has something behind, each on its own
        # line, then this site's anti-aliasing on the last, and the remaster
        # on a line of the page's own, one step further down the plate. The
        # resolution is DISPLAY MODE's list (`test_display_mode.py`), not a row.
        self.assertEqual([165, 195, 230, 260, 290, 315, 345, 375], video["lines"])
        self.assertEqual(
            [("graphicsQuality", "GRAPHICS QUALITY:", 165), ("effectsQuality", "EFFECTS QUALITY:", 195),
             ("environmentMapping", "ENVIRONMENT MAPPING:", 230), ("lightmaps", "LIGHTMAPS:", 260),
             ("shadows", "SHADOWS:", 290),
             ("textureQuality", "TEXTURE QUALITY:", 315), ("viewDistance", "VIEW DISTANCE:", 345),
             ("antialias", "ANTI-ALIASING:", 375), ("remaster", "REMASTER:", 405)],
            [(r["id"], r["label"], r["y"]) for r in video["rows"]])
        # ALTERNATIVE SPAWN INTERFACE has nothing behind it.
        labels = {r["label"] for r in video["rows"]}
        self.assertNotIn("ALTERNATIVE SPAWN INTERFACE:", labels)
        # Painted plain: the page paints each value itself.
        self.assertTrue(all(r["key"] is None for r in video["rows"]))

    def test_a_slider_is_the_games_track_and_value_box(self) -> None:
        gq = self.rows()["graphicsQuality"]
        self.assertEqual("slider", gq["kind"])
        # A 76x11 grey track around a 74x9 black inside, a 55x19 value box.
        self.assertEqual([[473, 164, 76, 11], [474, 165, 74, 9], [554, 160, 55, 19], [555, 161, 53, 17]],
                         gq["frame"])
        self.assertEqual([474, 165, 74, 9], gq["track"])
        self.assertEqual({"1": "LOW", "2": "MEDIUM", "3": "HIGH"}, gq["values"])
        self.assertEqual([312, 160, 297, 19], gq["hit"])
        # TEXTURE QUALITY on its own line, under SHADOWS: its value box and
        # the file's percentages and % sign.
        tq = self.rows()["textureQuality"]
        self.assertEqual([554, 310, 55, 19], tq["box"])
        self.assertEqual({"1": "20", "2": "40", "3": "60", "4": "80", "5": "100"}, tq["values"])
        self.assertEqual([587, 315, 115, 20], tq["unit"])
        # VIEW DISTANCE's value is the file's edit box.
        self.assertEqual([558, 345, 28, 20], self.rows()["viewDistance"]["edit"])

    def test_a_tick_box_is_the_games(self) -> None:
        # A 19-unit grey frame, a 17-unit black inside, a 9-unit olive mark.
        aa = self.rows()["antialias"]
        self.assertEqual("tick", aa["kind"])
        self.assertEqual([[473, 370, 19, 19], [474, 371, 17, 17]], aa["frame"])
        self.assertEqual([[478, 375, 9, 9], None], aa["mark"])
        self.assertEqual([312, 370, 180, 19], aa["hit"])
        # SHADOWS is the file's own tick row, on its own line.
        sh = self.rows()["shadows"]
        self.assertEqual("tick", sh["kind"])
        self.assertEqual([[473, 285, 19, 19], [474, 286, 17, 17]], sh["frame"])
        self.assertEqual([[478, 290, 9, 9], None], sh["mark"])
        env = self.rows()["environmentMapping"]
        self.assertEqual([[478, 230, 9, 9], None], env["mark"])

    def test_a_click_along_the_track_picks_the_step_under_it(self) -> None:
        self.assertEqual({"left": 1, "middle": 2, "right": 3, "past": 3}, self.results["video"]["pick"])
        self.assertEqual({"low": [474, 166, 7, 7], "high": [541, 166, 7, 7]}, self.results["video"]["knob"])

    def test_video_performance_is_the_games_four_lines(self) -> None:
        perf = self.results["video"]["perf"]
        self.assertEqual(["menu_videoperf_256x128", "VIDEO PERFORMANCE"], perf["elements"])
        self.assertEqual([[0, "CUSTOM", [71, 153, 170, 14], [71, 153, 170, 14], None],
                          [1, "LOW", [71, 170, 170, 14], [71, 170, 170, 14], None],
                          [2, "MEDIUM", [71, 187, 170, 14], [71, 187, 170, 14], None],
                          [3, "HIGH", [71, 204, 170, 14], [71, 204, 170, 14], None]], perf["lines"])

    def test_default_and_save_are_the_video_screens_own(self) -> None:
        nav = self.results["video"]["nav"]
        self.assertEqual({"default": [345.0, 85.0, 109.0, 25.0], "save": [453.0, 85.0, 109.0, 25.0]},
                         nav)

    def test_a_pack_without_the_page_has_no_video_section(self) -> None:
        older = self.results["video"]["olderPack"]
        self.assertEqual({"has": False, "rows": 0, "perf": None, "nav": {}}, older)


class SoundTests(_Harness):
    """OPTIONS > SOUND: features/sound-hardware-path."""

    def test_the_plate_stands_where_sound_menu_puts_it(self) -> None:
        sound = self.results["sound"]
        self.assertTrue(sound["has"])
        # menu/SoundMenu: the plate at (250,125), its heading SOUND OPTIONS
        # (the VIDEO plate is at 300).
        self.assertEqual([["picture", "menu_options_512x512", 250.0, 125.0, None],
                          ["text", "SOUND OPTIONS", 262.0, 133.0, None]], sound["panel"])

    def test_the_row_is_hardware_acceleration_on_the_first_line(self) -> None:
        row = self.results["sound"]["row"]
        self.assertEqual(["HARDWARE ACCELERATION:", [262.0, 165.0, 160.0, 20.0]], row["label"])
        self.assertEqual([423.0, 160.0, 19.0, 19.0], row["box"])
        self.assertEqual([428.0, 165.0, 9.0, 9.0], row["mark"])
        self.assertEqual([262.0, 160.0, 180.0, 19.0], row["hit"])

    def test_default_and_save_are_where_sound_navigation_puts_them(self) -> None:
        self.assertEqual({"default": [453.0, 85.0, 109.0, 25.0], "save": [561.0, 85.0, 109.0, 25.0]},
                         self.results["sound"]["nav"])

    def test_a_pack_without_the_video_page_has_no_sound_section(self) -> None:
        self.assertFalse(self.results["sound"]["olderPack"])

    def test_the_choice_is_kept_and_off_by_default(self) -> None:
        sound = self.results["sound"]
        self.assertEqual([None, True, "1", False, None], sound["stored"])
        self.assertIsNone(sound["throwing"])
        self.assertEqual([
            {"hardware": False, "reason": "default"},
            {"hardware": True, "reason": "stored"},
            {"hardware": False, "reason": "hw3d=0"},
            {"hardware": True, "reason": "hw3d=1"},
            {"hardware": False, "reason": "default"},
        ], sound["choose"])


class RowTableTests(_Harness):
    def test_every_row_the_game_draws_has_a_trigger(self) -> None:
        self.assertEqual(78, self.results["rows"])
        self.assertEqual([], self.results["unmapped"])

    def test_the_table_names_no_row_the_game_lacks(self) -> None:
        self.assertEqual([], self.results["unused"])

    def test_the_shipped_maps_in_the_games_words(self) -> None:
        d = self.results["defaults"]
        self.assertEqual(["M"], d["common.1"]["SHOW MAP:"])
        self.assertEqual(["ENTER"], d["common.1"]["SHOW SPAWNINTERFACE:"])
        self.assertEqual(["PRINT SCREEN"], d["common.2"]["SCREENSHOT:"])
        self.assertEqual(["MOUSE 1"], d["infantry.1"]["FIRE:"])
        self.assertEqual(["MOUSE WHEEL UP"], d["infantry.1"]["NEXT WEAPON:"])
        self.assertEqual(["LEFT CTRL"], d["infantry.2"]["CROUCH:"])
        # `c_PIPitch` positive is nose down: PITCH UP is the Down arrow. The
        # boxes are the slots: the shipped Air.con's primary pitch is the
        # mouse (`IDFMouse IDAxis_1 0`), the arrows its alternate (`... 1`).
        self.assertEqual(["MOUSE UP", "DOWN ARROW"], d["air.1"]["PITCH UP:"])
        self.assertEqual(["MOUSE LEFT", "LEFT ARROW"], d["air.1"]["ROLL LEFT:"])
        self.assertEqual(["MOUSE 1", "SPACE"], d["air.1"]["FIRE:"])


class ProfileTests(_Harness):
    def test_common_page_matches_the_retail_screen(self) -> None:
        # The owner's options screen, COMMON 1/3, row for row.
        self.assertEqual({
            "ENTER / EXIT VEHICLE:": ["E", "JOYSTICK 12"],
            "PARACHUTE:": ["9", "JOYSTICK 11"],
            "SAY ALL:": ["K"],
            "SAY TEAM:": ["L"],
            "SHOW SCOREBOARD:": ["TAB", "JOYSTICK 16"],
            "SHOW SPAWNINTERFACE:": ["ENTER"],
            "SHOW MAP:": ["F", "JOYSTICK 13"],
            "ZOOM MAP:": ["LEFT ALT"],
            "INSIDE:": ["F9", "JOYSTICK 14"],
            "CHASE REAR:": ["F10"],
            "CHASE FRONT:": ["F11", "JOYSTICK 4"],
            "FLY BY:": ["F12", "JOYSTICK 15"],
        }, self.results["profile"]["common.1"])

    def test_the_stick_axes_read_as_directions(self) -> None:
        air = self.results["profile"]["air.1"]
        self.assertEqual(["JOYSTICK AXIS 1-", "LEFT ARROW"], air["ROLL LEFT:"])
        # The throttle axis carries the invert flag: speed up is the lever's
        # negative travel.
        self.assertEqual(["W", "JOYSTICK AXIS 4-"], air["SPEED UP:"])

    def test_a_whole_profile_folder_imports(self) -> None:
        applied = {a["context"] for a in self.results["import"]["applied"]}
        self.assertEqual({"common", "infantry", "air", "land"}, applied)
        self.assertEqual("skandia", self.results["profileName"])

    def test_default_forgets_the_profile(self) -> None:
        self.assertEqual({"profileName": None, "map": "M"}, self.results["afterReset"])


class TryItTests(_Harness):
    def test_a_pressed_binding_lights_its_own_box(self) -> None:
        lit = self.results["lit"]
        self.assertTrue(lit["forwardOnW"])
        self.assertFalse(lit["forwardOnS"])
        self.assertTrue(lit["altFireOnRight"])
        self.assertTrue(lit["nextOnWheelUp"])
        self.assertFalse(lit["prevOnWheelUp"])

    def test_the_probe_answers_for_the_named_map(self) -> None:
        self.assertEqual({"pitch": -1, "yaw": -1, "fire": True, "capturedAxis": 0},
                         self.results["probe"])

    def test_the_stick_lights_its_boxes(self) -> None:
        self.assertEqual({"rollLeft": True, "rollRight": False, "fire": True},
                         self.results["stick"])


class InGameTests(_Harness):
    def test_a_soldier_in_the_pilots_seat_flies_on_the_air_map(self) -> None:
        seated = self.results["seated"]
        self.assertEqual("air", seated["pilot"])
        # The engine's gunner positions are VCLand, even on an aircraft.
        self.assertEqual("land", seated["gunner"])
        self.assertEqual("infantry", seated["walker"])
        # The profile's stick rolls the plane and its button 1 fires.
        self.assertLess(seated["roll"], -0.5)
        self.assertTrue(seated["fire"])


class HatTests(_Harness):
    """The game folds the POV hat into buttons numButtons+0..3 (up, right,
    down, left; `0x0066ea28`); the owner's twelve-button stick binds them as
    JOYSTICK 13-16."""

    def test_the_linux_hat_axes_are_buttons_12_to_15(self) -> None:
        hat = self.results["hat"]
        self.assertEqual(["c_PIMap"], hat["up"])
        self.assertEqual(["c_PICameraMode1"], hat["right"])
        self.assertEqual(["c_PICameraMode4"], hat["down"])
        self.assertEqual(sorted(["c_GIShowScoreBoard", "c_PIShowScoreBoard"]), sorted(hat["left"]))

    def test_a_diagonal_presses_nothing(self) -> None:
        self.assertEqual([], self.results["hat"]["diagonal"])

    def test_the_windows_stepped_axis(self) -> None:
        self.assertEqual(["c_PICameraMode1"], self.results["hatWindows"])


class MouseInvertTests(_Harness):
    def test_the_invert_box_is_per_profile(self) -> None:
        self.assertEqual({"air": -1, "infantry": 1, "landSea": 1}, self.results["invert"])


class HintTests(_Harness):
    def test_hints_name_the_profiles_keys(self) -> None:
        self.assertEqual("WASD move · L Ctrl crouch · M map",
                         self.results["defaultHints"]["foot"])
        self.assertEqual("Down/Up pitch · LMB guns · R reset",
                         self.results["defaultHints"]["pilot"])
        self.assertEqual({"fly": "F map", "zoom": "L Alt zoom"}, self.results["profileHints"])


if __name__ == "__main__":
    unittest.main()
