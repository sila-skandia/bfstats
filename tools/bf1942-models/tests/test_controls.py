"""`viewer/controls.js` — the control map — under node.

features/viewer-profile-controls. The one sentence these tests defend:

    every `event.code` literal the page used to hardcode is now a binding of
    the game's own control map, and a joystick's axes and buttons land on the
    same engine triggers the profile binds them to.

Two sources exercise the module: the generated `controls-defaults.js` (the
game's shipped maps, baked by `extract_profile_controls.py`) and the owner's
real profile (`fixtures/controls-profile-skandia/`, the four `.con` files the
game writes for a player who flies on a joystick and has the map on F).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "controls_harness.mjs"
DEFAULTS = ROOT / "viewer" / "controls-defaults.js"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "controls-profile-skandia"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not DEFAULTS.is_file():
        raise unittest.SkipTest(
            "viewer/controls-defaults.js is not in the tree — run "
            "extract_profile_controls.py once")
    if not all((FIXTURES / f).is_file()
               for f in ("Common.con", "Infantry.con", "Air.con", "Land.con")):
        raise unittest.SkipTest("the profile fixtures are not in the tree")
    proc = subprocess.run(["node", str(HARNESS)],
                          capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class _Harness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()


class KeyNameTests(_Harness):
    """`IDKey_*` names a DirectInput scancode; `event.code` is the browser's."""

    def test_the_id_names_map_onto_browser_codes(self) -> None:
        k = self.results["parse"]["keyIdToCode"]
        self.assertEqual("Backquote", k["grave"])
        self.assertEqual("CapsLock", k["capital"])
        self.assertEqual("KeyW", k["w"])
        self.assertEqual("Digit9", k["digit9"])
        self.assertEqual("ArrowUp", k["arrowUp"])
        self.assertEqual("Numpad6", k["numpad6"])
        self.assertEqual("F12", k["f12"])
        self.assertEqual("AltLeft", k["leftAlt"])
        self.assertIsNone(k["unknown"])


class ParseTests(_Harness):
    """The four verbs, the variables, and the classification."""

    def test_every_verb_survives_the_parse(self) -> None:
        s = self.results["parse"]["sample"]
        self.assertEqual(6, s["bindings"])
        self.assertEqual({"game.setAirMouseSensitivity": 1.0}, s["vars"])
        self.assertEqual(["AirPlayerInputControlMap"], s["maps"])
        self.assertEqual("KeyF", s["mapCode"])
        self.assertEqual(0, s["fireButton"])

    def test_the_first_trailing_axis_flag_is_invert(self) -> None:
        # `AxisMapping+0x4c`, the word mouse-input.js already reads on the
        # look axes. A second trailing number appears on some joystick lines
        # (yaw, throttle) and its meaning is unchased — parsed as nothing.
        s = self.results["parse"]["sample"]
        self.assertTrue(s["pitchInvert"])
        self.assertFalse(s["yawInvert"])

    def test_a_file_classifies_by_its_own_content(self) -> None:
        c = self.results["parse"]["classify"]
        self.assertEqual({"air": "air", "common": "common",
                          "land": "land", "infantry": "infantry"},
                         c)

    def test_joystick_buttons_display_one_based_like_the_menu(self) -> None:
        # The game's options screen renders IDButton_11 as JOYSTICK 12.
        self.assertEqual("Joystick 12", self.results["parse"]["describe"])
        self.assertEqual("L Alt", self.results["parse"]["describeKeyboard"])


class DefaultsTests(_Harness):
    """Without a profile, the shipped maps answer what the page hardcoded."""

    def test_the_m_n_tab_e_c_z_r_literals_are_all_there(self) -> None:
        d = self.results["defaults"]
        self.assertIn("c_PIMap", d["mapKey"])
        self.assertIn("c_PIZoomMap", d["zoomKey"])
        self.assertIn("c_PIShowScoreBoard", d["tab"])
        self.assertIn("c_PIUse", d["use"])
        self.assertIn("c_PIToggleCameraMode", d["camera"])
        self.assertIn("c_PILie", d["lie"])
        self.assertIn("c_PIReload", d["reload"])
        self.assertIn("c_PIMenuSelect9", d["slot9"])

    def test_seven_and_eight_are_the_vote_keys_not_menu_selects(self) -> None:
        self.assertEqual(["c_PIVoteYes"], self.results["defaults"]["vote7"])

    def test_the_radio_numbers_come_from_the_map(self) -> None:
        d = self.results["defaults"]
        self.assertEqual(1, d["radio1"])
        self.assertEqual(8, d["radio8"])
        self.assertEqual(0, d["radioM"])

    def test_the_console_toggles_on_grave_only(self) -> None:
        # The shipped maps also bind Caps Lock (`IDKey_Capital`), but in the
        # retail game that key is the spawn screen and the viewer drops the
        # line — Caps Lock stays the spawn toggle.
        self.assertEqual(["Backquote"],
                         self.results["defaults"]["consoleToggle"])

    def test_keyboard_axes_sum_and_cancel(self) -> None:
        d = self.results["defaults"]
        self.assertEqual(1.0, d["throttleW"])
        self.assertEqual(0.0, d["throttleWS"])
        self.assertEqual(1.0, d["yawD"])

    def test_no_channel_moves_while_the_page_is_not_captured(self) -> None:
        self.assertEqual(0.0, self.results["defaults"]["throttleUncaptured"])

    def test_walk_and_jump_are_levels(self) -> None:
        d = self.results["defaults"]
        self.assertTrue(d["walk"])
        self.assertTrue(d["jump"])

    def test_the_air_context_puts_the_arrows_on_the_stick(self) -> None:
        d = self.results["defaults"]
        self.assertEqual(1.0, d["pitchArrow"])
        self.assertEqual(-1.0, d["rollArrow"])

    def test_the_context_follows_the_seat_category(self) -> None:
        # The same rule mouse-input.js's profileFor applies to sensitivity:
        # only a pilot flies on Air; land and sea share one map.
        d = self.results["defaults"]
        self.assertEqual("infantry", d["contextOnFoot"])
        self.assertEqual("air", d["contextAir"])
        self.assertEqual("land", d["contextLand"])
        self.assertIsNone(d["contextFree"])

    def test_kblock_covers_the_player_bindings_but_not_the_game_map(self) -> None:
        d = self.results["defaults"]
        for code in ("KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "KeyE", "KeyZ",
                     "KeyM", "Space", "ControlLeft", "ShiftLeft"):
            self.assertIn(code, d["kblock"], code)
        self.assertTrue(d["kblockHasNoGameKeys"])


class ProfileImportTests(_Harness):
    """The owner's own profile: F for the map, Left Alt for the zoom, a stick."""

    def test_the_import_classifies_all_four_files(self) -> None:
        imp = self.results["profile"]["import"]
        self.assertEqual(["common", "infantry", "air", "land"],
                         [a["context"] for a in imp["applied"]])
        self.assertEqual("profile", self.results["profile"]["source"])

    def test_the_map_moved_to_f_and_the_zoom_to_left_alt(self) -> None:
        p = self.results["profile"]
        self.assertEqual(["c_PIMap"], p["mapKey"])
        self.assertEqual([], p["mapKeyM"])
        self.assertIn("c_PIZoomMap", p["zoomKey"])
        self.assertEqual([], p["zoomKeyN"])

    def test_the_joystick_buttons_land_on_the_common_triggers(self) -> None:
        p = self.results["profile"]
        self.assertEqual(["c_PIUse"], p["buttonUse"])
        self.assertEqual(["c_PIMap"], p["buttonMap"])
        self.assertIn("c_PIShowScoreBoard", p["buttonScoreboard"])
        self.assertEqual(["c_PIMenuSelect9"], p["buttonChute"])
        self.assertEqual([], p["buttonUnbound"])   # 7/8 are the vote keys

    def test_the_joystick_buttons_land_on_the_air_triggers(self) -> None:
        p = self.results["profile"]
        self.assertEqual(["c_PIFire"], p["airButtonFire"])
        self.assertEqual(["c_PIAltFire"], p["airButtonAltFire"])

    def test_the_stick_axes_fly_through_the_profile(self) -> None:
        # Air.con: roll IDAxis_0, pitch IDAxis_1 inverted, yaw IDAxis_2,
        # throttle IDAxis_3 — sampled at axes [0.5, -0.8, 0.3, 0.9] through
        # the 0.15 deadzone.
        p = self.results["profile"]
        self.assertAlmostEqual(0.35 / 0.85, p["axisRoll"], places=12)
        self.assertAlmostEqual(0.65 / 0.85, p["axisPitch"], places=12)
        self.assertAlmostEqual(0.15 / 0.85, p["axisYaw"], places=12)
        # The profile binds the throttle lever with the invert flag, so a
        # pushed lever is negative until the live viewer says otherwise.
        self.assertAlmostEqual(-0.75 / 0.85, p["axisThrottle"], places=12)

    def test_a_pad_button_is_a_level_without_any_dom_event(self) -> None:
        p = self.results["profile"]
        self.assertTrue(p["heldFire"])
        self.assertTrue(p["heldAltFire"])

    def test_button_edges_dispatch_onto_the_page(self) -> None:
        p = self.results["profile"]
        self.assertEqual(["c_PICameraMode3", "c_PIMap", "c_PIMenuSelect9",
                          "c_PIUse"], p["edgesDown"])
        self.assertEqual(["c_PIAltFire", "c_PIFire", "c_PIMap",
                          "c_PIMenuSelect9", "c_PIUse"], p["edgesUp"])

    def test_the_profile_sensitivity_variables_survive_the_parse(self) -> None:
        vars_ = self.results["profile"]["vars"]
        self.assertEqual(0.027778, vars_["game.setCommonMouseSensitivity"])
        self.assertEqual(1.0, vars_["game.setAirMouseSensitivity"])

    def test_a_reset_is_a_real_reset(self) -> None:
        p = self.results["profile"]
        self.assertIn("c_PIMap", p["afterResetMap"])
        self.assertEqual("defaults", p["afterResetSource"])


class CrossHairColorTests(_Harness):
    """`game.setCrossHairColor`: what the cross and its hit marks are drawn in
    (ledger XHIT-7), the shipped default profile's until one is imported."""

    SHIPPED_PROFILE = (Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
                       / "Mods/bf1942/Settings/Profiles/Default/GeneralOptions.con")

    def test_the_default_is_the_shipped_default_profiles_yellow(self) -> None:
        c = self.results["crossHair"]
        self.assertEqual([255, 255, 0], c["defaultColor"])
        self.assertEqual(c["shippedDefault"], c["defaultColor"])

    def test_the_default_is_read_off_the_install_when_there_is_one(self) -> None:
        if not self.SHIPPED_PROFILE.is_file():
            self.skipTest("no BF1942 install")
        line = next(l for l in self.SHIPPED_PROFILE.read_text(errors="replace").splitlines()
                    if l.startswith("game.setCrossHairColor"))
        self.assertEqual(self.results["crossHair"]["shippedDefault"],
                         [float(v) for v in line.split()[1:4]])

    def test_the_game_line_parses_and_anything_else_does_not(self) -> None:
        c = self.results["crossHair"]
        self.assertEqual([255, 0, 0], c["parsed"])
        self.assertIsNone(c["parsedAbsent"])
        self.assertIsNone(c["parsedGarbage"])

    def test_a_profile_folder_brings_its_colour_and_a_reset_drops_it(self) -> None:
        c = self.results["crossHair"]
        self.assertEqual(["common"], [a["context"] for a in c["import"]["applied"]])
        self.assertEqual([255, 0, 0], c["afterImport"])
        self.assertEqual([255, 255, 0], c["afterReset"])


class DescribeTests(_Harness):
    """What the sidebar paints."""

    def test_the_defaults_describe_in_the_games_own_words(self) -> None:
        d = self.results["describe"]
        self.assertGreater(d["rows"], 30)
        self.assertEqual({"trigger": "c_PIMap", "labels": ["M"]}, d["mapRow"])
        self.assertEqual({"trigger": "c_PIUse", "labels": ["E"]}, d["useRow"])


if __name__ == "__main__":
    unittest.main()
