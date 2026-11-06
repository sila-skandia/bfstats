"""OPTIONS > CONTROLS rebinding: retail's DEFINE KEY, written as retail's SAVE.

features/viewer-profile-controls ("DEFINE KEY"), and #1 of
features/browser-play-feedback-2026-11-06. The sentence these tests defend:

    a box the player defines is written the way retail writes it, and the
    page then plays on what was written -- nothing else in the files moves.

`controls_rebind_harness.mjs` drives `viewer/controls-edit.js` (the boxes,
retail's `setKey` rules, the conflict scan, the writer) and reads what it
writes back through `viewer/controls.js`, the parser the game page plays on.
The owner's profile (`fixtures/controls-profile-skandia/`) was written by
retail's own SAVE, so rewriting it unchanged must give it back byte for byte.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "controls_rebind_harness.mjs"
SCREEN_HARNESS = Path(__file__).resolve().parent / "controls_screen_harness.mjs"
LAYOUT = (Path(__file__).resolve().parents[1] / "viewer" / "maps" / "_shared" / "hud" / "menu"
          / "controls-layout.json")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def key(code: str) -> dict:
    return {"type": "key", "code": code}


class _Harness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()


class UntouchedTests(_Harness):
    def test_retails_own_save_comes_back_byte_for_byte(self) -> None:
        self.assertEqual({"common": True, "infantry": True, "air": True, "land": True},
                         self.results["untouched"]["owner"])

    def test_the_shipped_maps_gain_only_what_retails_save_adds(self) -> None:
        u = self.results["untouched"]
        self.assertTrue(u["shippedBoxes"])
        self.assertEqual({"common": [], "infantry": [], "air": [], "land": []}, u["shippedRemoved"])
        # The map-vote rows join each context file's common block, and the
        # screenshot its game-map twin: both are in the owner's retail save.
        self.assertEqual(["ControlMap.addKeyToTriggerMapping c_GIScreenShot IDFKeyboard IDKey_PrintScreen c_CMNonRepetive"],
                         u["shippedAdded"]["common"])
        for context in ("infantry", "air", "land"):
            self.assertEqual(3, len(u["shippedAdded"][context]))
            self.assertTrue(all("Vote" in line for line in u["shippedAdded"][context]))

    def test_neither_profile_conflicts(self) -> None:
        self.assertEqual({"owner": 0, "shipped": 0}, self.results["untouched"]["conflicts"])


class CaptureTests(_Harness):
    def test_a_defined_key_is_written_and_played_on(self) -> None:
        c = self.results["capture"]
        self.assertEqual(["ControlMap.addKeysToAxisMapping c_PIThrottle IDFKeyboard IDKey_I IDKey_S"], c["throttle"])
        self.assertEqual(1, c["forwardOnI"])
        self.assertEqual(0, c["forwardOnW"])
        self.assertEqual(["I"], c["labels"])

    def test_the_alternate_box_is_the_trailing_1(self) -> None:
        c = self.results["capture"]
        self.assertEqual([
            "ControlMap.addKeyToTriggerMapping c_PIReload IDFKeyboard IDKey_R c_CMNonRepetive",
            "ControlMap.addButtonToTriggerMapping c_PIReload IDFMouse IDButton_2 c_CMNonRepetive 1",
        ], c["reload"])
        self.assertEqual(["R", "MOUSE 3"], c["reloadLabels"])
        self.assertTrue(c["reloadOnMiddle"])

    def test_save_is_kept_and_sent_on(self) -> None:
        c = self.results["capture"]
        # `edit` is the change profile-sync.js saves to the account.
        self.assertEqual(["edit"], c["changes"])
        self.assertEqual("profile", c["source"])
        self.assertTrue(c["stored"])

    def test_lines_the_screen_does_not_own_stay(self) -> None:
        self.assertTrue(self.results["capture"]["kept"])
        self.assertTrue(self.results["capture"]["otherFiles"])


class SetKeyRuleTests(_Harness):
    def test_an_alternate_with_no_primary_becomes_the_primary(self) -> None:
        r = self.results["rules"]
        self.assertEqual(0, r["landed"])
        self.assertEqual([key("KeyB"), None], r["zoom"])

    def test_an_alternate_never_repeats_the_primary(self) -> None:
        self.assertEqual([key("KeyE"), None], self.results["rules"]["use"])
        # And a primary set to the alternate's key takes it from the alternate.
        self.assertEqual([key("Space"), None], self.results["rules"]["fire"])

    def test_a_lone_alternate_line_is_refused_and_a_later_primary_wins(self) -> None:
        self.assertEqual([key("KeyY"), None], self.results["slots"])


class UnbindTests(_Harness):
    def test_escape_unbinds_the_box(self) -> None:
        u = self.results["unbind"]
        self.assertEqual([], u["jumpLines"])
        self.assertEqual([None, None], u["jump"])
        self.assertEqual(["ControlMap.addKeyToTriggerMapping c_PIRun IDFKeyboard IDKey_LeftCtrl c_CMPushAndHold"],
                         u["run"])

    def test_half_a_key_pair_unbound_keeps_the_other_half(self) -> None:
        u = self.results["unbind"]
        self.assertEqual(["ControlMap.addKeysToAxisMapping c_PIYaw IDFKeyboard IDKey_D IDKey_Unknown"], u["yawLines"])
        self.assertEqual([[key("KeyD"), None], [None, None]], u["yaw"])
        self.assertEqual(1, u["rightOnD"])
        self.assertEqual(0, u["leftOnA"])


class AxisPairTests(_Harness):
    def test_an_axis_fills_both_halves_with_its_push(self) -> None:
        a = self.results["axes"]
        speed_up, slow_down = a["filled"]
        self.assertEqual({"type": "padAxis", "axis": 1, "dir": -1}, speed_up[1])
        self.assertEqual({"type": "padAxis", "axis": 1, "dir": 1}, slow_down[1])
        # Speed up is the pull: the line carries the invert flag, in the
        # alternate slot.
        self.assertEqual("ControlMap.addAxisToAxisMapping c_PIThrottle IDFGameController_0 IDAxis_1 1 1", a["line"][1])
        self.assertEqual(0, a["selfConflict"])

    def test_a_key_on_one_half_takes_the_axis_out_of_both(self) -> None:
        a = self.results["axes"]
        self.assertIsNone(a["replaced"][0][1])
        self.assertEqual(key("KeyX"), a["replaced"][1][1])
        self.assertEqual("ControlMap.addKeysToAxisMapping c_PIThrottle IDFKeyboard IDKey_Unknown IDKey_X 1",
                         a["replacedLine"][1])

    def test_escape_on_an_axis_half_unbinds_both(self) -> None:
        plus, minus = self.results["axes"]["rollCleared"]
        self.assertIsNone(plus[1])
        self.assertIsNone(minus[1])

    def test_the_wheel_on_a_movement_row_is_the_wheel_axis(self) -> None:
        a = self.results["axes"]
        self.assertEqual("ControlMap.addAxisToAxisMapping c_PIPitch IDFMouse IDAxis_2 0 1", a["wheelLine"][1])
        self.assertEqual({"type": "mouseAxis", "axis": 2, "dir": 1}, a["wheelBack"][1])

    def test_one_axis_on_two_channels_conflicts(self) -> None:
        self.assertEqual(["air|A:c_PIPitch:+|1", "air|A:c_PIPitch:-|1", "air|A:c_PIRoll:+|1", "air|A:c_PIRoll:-|1"],
                         self.results["axes"]["twoChannels"])


class MixedVerbTests(_Harness):
    def test_retails_three_mixed_verbs_are_written(self) -> None:
        self.assertEqual([
            "ControlMap.addButtonAndKeyToAxisMapping c_PIThrottle IDFGameController_0 IDButton_3 IDFKeyboard IDKey_S",
            "ControlMap.addKeyAndButtonToAxisMapping c_PIYaw IDFKeyboard IDKey_D IDFGameController_0 IDButton_5",
            "ControlMap.addButtonsToAxisMapping c_PIPitch IDFGameController_0 IDButton_6 IDButton_7",
        ], self.results["mixed"]["written"])

    def test_and_read(self) -> None:
        parsed = self.results["mixed"]["parsed"]
        self.assertEqual(["c_PIThrottle", "c_PIYaw", "c_PIPitch"], [b["trigger"] for b in parsed])
        self.assertEqual([{"device": "controller", "index": 0, "button": 3},
                          {"device": "keyboard", "index": 0, "code": "KeyS"}], parsed[0]["parts"])
        self.assertEqual("keyboard", parsed[1]["parts"][0]["device"])
        self.assertEqual([3, 4], [p["button"] for p in parsed[2]["parts"]])
        self.assertTrue(parsed[2]["secondary"])

    def test_the_boxes_and_the_game_read_them(self) -> None:
        m = self.results["mixed"]
        self.assertEqual({"speedUp": ["JOYSTICK 4"], "slowDown": ["S"], "left": ["JOYSTICK 6"], "right": ["D"]},
                         m["labels"])
        self.assertEqual(-1, m["backOnS"])
        self.assertEqual(1, m["rightOnD"])


class ConflictTests(_Harness):
    def test_a_clash_marks_both_boxes_in_its_map(self) -> None:
        c = self.results["conflicts"]
        self.assertEqual([["common|T:c_PIUse|0", ["infantry"]], ["infantry|T:c_PIReload|0", ["infantry"]]],
                         c["inInfantry"])

    def test_common_names_the_maps_it_clashes_in(self) -> None:
        c = self.results["conflicts"]
        self.assertEqual("CONFLICT DETECTED: INFANTRY", c["text"])
        self.assertEqual("CONFLICT DETECTED: INFANTRY AND AIR", c["both"])
        self.assertEqual("CONFLICT DETECTED", c["onTab"])

    def test_infantry_and_air_never_clash(self) -> None:
        self.assertEqual(0, self.results["conflicts"]["acrossMaps"])

    def test_one_key_on_both_halves_of_a_pair_clashes(self) -> None:
        self.assertEqual(["infantry|A:c_PIThrottle:+|0", "infantry|A:c_PIThrottle:-|0"],
                         self.results["conflicts"]["sameKeyBothHalves"])


class CommonBlockTests(_Harness):
    def test_a_common_row_is_written_into_every_file(self) -> None:
        for context, found in self.results["common"]["map"].items():
            self.assertEqual("ControlMap.addKeyToTriggerMapping c_PIMap IDFKeyboard IDKey_Q c_CMNonRepetive",
                             found[0], context)
            self.assertEqual(2, len(found), context)

    def test_the_game_maps_twin_follows(self) -> None:
        c = self.results["common"]
        self.assertIn("ControlMap.addButtonToTriggerMapping c_GIShowScoreBoard IDFGameController_0 IDButton_9 "
                      "c_CMPushAndHold 1", c["scoreboard"])
        self.assertIn("ControlMap.addButtonToTriggerMapping c_PIShowScoreBoard IDFGameController_0 IDButton_9 "
                      "c_CMPushAndHold 1", c["contextScoreboard"])

    def test_a_game_map_row_stays_in_common(self) -> None:
        self.assertEqual({"common": ["ControlMap.addKeyToTriggerMapping c_GIInGameMenu IDFKeyboard IDKey_J c_CMNonRepetive"],
                          "infantry": [], "air": [], "land": []}, self.results["common"]["spawn"])


class WheelTests(_Harness):
    def test_the_wheel_is_written_as_retails_pair(self) -> None:
        w = self.results["wheel"]
        self.assertEqual(["ControlMap.addAxisToTriggerMapping c_PIPrevItem c_PINextItem IDFMouse IDAxis_2"], w["line"])
        self.assertIn("c_PIPrevItem", w["up"])
        self.assertEqual([["MOUSE WHEEL DOWN"], ["MOUSE WHEEL UP"]], w["labels"])

    def test_one_direction_alone_is_not_written(self) -> None:
        self.assertEqual([], self.results["wheel"]["lone"])


class LayoutTests(_Harness):
    def test_the_german_less_than_key_is_oem_102(self) -> None:
        l = self.results["layout"]
        self.assertEqual(["IntlBackslash", "IDKey_OEM_102"], l["oem"])
        self.assertEqual("ControlMap.addKeyToTriggerMapping c_PILie IDFKeyboard IDKey_OEM_102 c_CMNonRepetive",
                         l["lines"][0])
        self.assertTrue(l["lessOnIntl"])

    def test_labels_follow_the_layout_and_fall_back_to_us(self) -> None:
        l = self.results["layout"]
        self.assertEqual([["<"], ["Z"]], l["us"])
        # On a German board the key the US calls Z prints Y.
        self.assertEqual([["<"], ["Y"]], l["german"])

    def test_engine_names(self) -> None:
        self.assertEqual(["Equal", "IDKey_Equals", "F11", None], self.results["layout"]["equals"])


class DefaultTests(_Harness):
    def test_default_refills_every_box_and_word_for_save(self) -> None:
        r = self.results["reset"]
        self.assertTrue(r["dirty"])
        self.assertTrue(r["boxes"])
        self.assertEqual(["game.setCommonMouseSensitivity 0.25"], r["sensitivity"])
        self.assertEqual(["ControlMap.addKeyToTriggerMapping c_PIMap IDFKeyboard IDKey_M c_CMNonRepetive"], r["map"])


class ScreenTests(unittest.TestCase):
    """The DEFINE KEY flow on the real screen (`controls_screen_harness.mjs`):
    a click, then an input, as the player gives them."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        if not LAYOUT.is_file():
            raise unittest.SkipTest("controls-layout.json is not extracted — run extract_controls_menu_layout.py")
        proc = subprocess.run(["node", str(SCREEN_HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_a_click_waits_and_a_key_answers(self) -> None:
        r = self.results
        self.assertEqual({"key": "CONTROLS_INFANTRY_FORWARD", "slot": 0}, r["waiting"])
        self.assertEqual({"defining": None, "forward": ["I", ""], "dirty": True}, r["key"])

    def test_escape_unbinds_and_is_the_screens_while_a_box_waits(self) -> None:
        r = self.results
        self.assertTrue(r["escapeClaimedWhileWaiting"])
        self.assertEqual(["", ""], r["unbound"])
        # With nothing waiting it is the host's: it closes the Escape menu.
        self.assertFalse(r["escapeWhenIdle"])
        self.assertEqual(["MOUSE 1", ""], r["wheel"]["unbound"])

    def test_grave_is_not_mappable(self) -> None:
        self.assertEqual({"message": "THIS KEY IS NOT MAPPABLE!", "defining": None, "reload": ["R", ""]},
                         self.results["grave"])

    def test_mouse_buttons_and_the_browsers_own_uses_of_them(self) -> None:
        m = self.results["mouse"]
        self.assertEqual(["MOUSE 4", ""], m["drop"])
        self.assertTrue(m["prevented"])
        self.assertTrue(m["back"])
        self.assertTrue(m["menu"])
        self.assertEqual(["MOUSE 2", ""], m["altFire"])

    def test_the_wheel(self) -> None:
        w = self.results["wheel"]
        self.assertEqual(["MOUSE 1", "MOUSE WHEEL UP"], w["fire"])
        # Allowed while editing, and marked: NEXT WEAPON is the wheel up.
        self.assertEqual(["infantry|T:c_PIFire|1", "infantry|T:c_PINextItem|0"], w["clash"])

    def test_a_tab_lets_the_box_go(self) -> None:
        self.assertEqual({"defining": None, "tab": "infantry"}, self.results["tabCancels"])

    def test_the_stick(self) -> None:
        r = self.results
        self.assertEqual(["LEFT SHIFT", "JOYSTICK 6"], r["padButton"])
        # An axis fills both halves; the half clicked reads the push.
        self.assertEqual({"left": ["A", "JOYSTICK AXIS 1-"], "right": ["D", "JOYSTICK AXIS 1+"]}, r["padAxis"])
        self.assertEqual({"key": "CONTROLS_INFANTRY_RELOAD", "slot": 1}, r["axisOnButtonRow"])

    def test_windows_altgr_is_right_alt_and_a_real_ctrl_is_ctrl(self) -> None:
        self.assertEqual(["RIGHT ALT", ""], self.results["altGr"])
        self.assertEqual(["LEFT CTRL", ""], self.results["realCtrl"])

    def test_save_refuses_a_conflict(self) -> None:
        c = self.results["conflict"]
        self.assertEqual(["common|T:c_PIUse|0", "infantry|T:c_PIMenuSelect1|0"], c["marked"])
        self.assertTrue(c["redBar"])
        self.assertFalse(c["saved"])
        self.assertEqual("FAILED TO SAVE CONTROLS! THERE IS A CONFLICT!", c["message"])
        self.assertTrue(c["unwritten"])

    def test_save_writes(self) -> None:
        s = self.results["saved"]
        self.assertTrue(s["ok"])
        self.assertEqual("KEY ASSIGNMENT HAS BEEN SAVED", s["message"])
        self.assertEqual(1, s["changed"])
        self.assertFalse(s["dirty"])
        self.assertEqual([
            "ControlMap.addKeysToAxisMapping c_PIThrottle IDFKeyboard IDKey_I IDKey_S",
            "ControlMap.addKeyToTriggerMapping c_PICrouch IDFKeyboard IDKey_RightAlt c_CMPushAndHold",
            "ControlMap.addButtonToTriggerMapping c_PIDrop IDFMouse IDButton_3 c_CMNonRepetive",
        ], s["lines"])

    def test_default_asks_then_refills_for_save(self) -> None:
        c = self.results["confirm"]
        self.assertTrue(c["up"])
        self.assertTrue(c["escape"])
        self.assertFalse(c["after"])
        self.assertEqual({"up": False, "forward": ["W", ""], "dirty": True, "unwritten": True}, c["ok"])

    def test_leaving_drops_what_save_did_not_write(self) -> None:
        self.assertEqual({"forward": ["I", ""], "dirty": False}, self.results["left"])


if __name__ == "__main__":
    unittest.main()
