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

    def test_the_pager_arrows(self) -> None:
        pages = self.layout["tabs"]["common"]["pages"]
        self.assertEqual({"next"}, set(pages[0]["pager"]))
        self.assertEqual({"prev", "next"}, set(pages[1]["pager"]))
        self.assertEqual({"prev"}, set(pages[2]["pager"]))


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
        # `c_PIPitch` positive is nose down: PITCH UP is the Down arrow.
        self.assertEqual(["DOWN ARROW"], d["air.1"]["PITCH UP:"])
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
