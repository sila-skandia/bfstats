"""`viewer/radio.js` and `viewer/chat-log.js` -- the F1..F8 radio and the
message log, driven headless by `radio_chat_harness.mjs`.

Every expectation below is the client's own behaviour as read out of
BF1942.exe (features/radio-and-chat-log/README.md), or a retail capture the
user took, quoted where it applies.
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
HARNESS = Path(__file__).with_name("radio_chat_harness.mjs")
MODULES = {"radio.js": VIEWER / "radio.js", "chat-log.js": VIEWER / "chat-log.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RadioTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def send(self, mode: int, cat: int, key: int) -> int:
        return self.r["sends"][f"{mode}/{cat}/{key}"]

    def test_the_confirm_page_sends_roger_and_negative_only(self) -> None:
        self.assertEqual([1, 2, 0, 0, 0, 0, 0, 0], [self.send(1, 1, k) for k in range(1, 9)])

    def test_request_and_spotted_pages_are_offsets(self) -> None:
        self.assertEqual(list(range(8, 15)), [self.send(1, 2, k) for k in range(1, 8)])
        self.assertEqual(list(range(15, 22)), [self.send(1, 3, k) for k in range(1, 8)])

    def test_the_game_page_follows_the_mode(self) -> None:
        # Four points: F1-F3 are points 1-3, F4 CLOSEST, F5 point 4, F6/F7 none.
        self.assertEqual([22, 23, 24, 50, 25, 0, 0, 0], [self.send(3, 4, k) for k in range(1, 9)])
        self.assertEqual([0, 0, 0, 55, 56, 57, 58, 0], [self.send(2, 4, k) for k in range(1, 9)])

    def test_the_local_pages(self) -> None:
        self.assertEqual([0, 0, 29, 30, 31, 32, 0, 0], [self.send(1, 5, k) for k in range(1, 9)])
        self.assertEqual(list(range(36, 43)), [self.send(1, 6, k) for k in range(1, 8)])
        self.assertEqual(list(range(43, 50)), [self.send(1, 7, k) for k in range(1, 8)])
        self.assertTrue(self.r["everySentIdKnown"])

    def test_f8_toggles_the_strip_and_a_page_returns_where_it_came_from(self) -> None:
        t = self.r["transitions"]
        self.assertEqual({"category": 3, "back": True, "message": 0}, t["rootF3"])
        self.assertEqual({"category": 8, "back": False, "message": 0}, t["rootF8"])
        self.assertEqual({"category": 0, "back": True, "message": 0}, t["offF8"])
        self.assertEqual({"category": 2, "back": False, "message": 0}, t["offF2"])
        self.assertEqual(8, t["pageClosesToOff"]["category"])
        self.assertEqual({"category": 0, "back": True, "message": 0}, t["pageF8"])

    def test_team_versus_shouted(self) -> None:
        self.assertEqual({1: True, 14: True, 22: True, 28: True, 29: False, 49: False, 50: True,
                          54: False, 55: True, 58: True, 59: False},
                         {k: v for k, v in self.r["team"]})

    def test_the_vehicle_remap(self) -> None:
        self.assertEqual({"stickTogetherInTank": 51, "stickTogetherOnFoot": 47, "medicInPlane": 54,
                          "coverInPlane": 52, "coverInTank": 41, "bailOnShip": 53,
                          "bailInPlane": 42}, self.r["remap"])

    def test_closest_is_three_dimensional_and_owner_blind(self) -> None:
        self.assertEqual(23, self.r["closest"])

    def test_the_retail_chat_line_shapes(self) -> None:
        t = self.r["text"]
        # The retail capture: `[C5] skandia:  [Bridge] Attack!`
        self.assertEqual("[C5] skandia:  [Bridge] Attack!", t["cpAttack"])
        self.assertEqual("[A1] skandia:  [Bridge] Defend!", t["cpDefend"])
        self.assertEqual("[B2] skandia: Roger that!", t["roger"])
        self.assertEqual("skandia: Go go go!", t["go"])
        self.assertEqual("skandia: Go for the enemy flag", t["takePoint"])

    def test_voice_patches(self) -> None:
        p = self.r["patch"]
        self.assertEqual({"script": "radio", "patch": 21}, p["attack"])
        self.assertEqual({"script": "radio", "patch": 22}, p["defend"])
        self.assertEqual({"script": "local", "patch": 20}, p["medic"])
        self.assertEqual({"script": "radio", "patch": 13}, p["apc"])
        self.assertEqual({"script": "radio", "patch": 3}, p["protectFlag"])

    def test_game_modes(self) -> None:
        self.assertEqual([3, 2, 1, 3, 3], self.r["mode"])

    def test_the_spam_limit(self) -> None:
        self.assertEqual([True] * 7 + [False, False, True], self.r["spam"])

    def test_the_menu_alpha_follows_the_mode(self) -> None:
        l = self.r["leaves"]
        self.assertEqual([0.5], l["conquestF4"])
        self.assertEqual([1.0], l["tdmF4"])
        self.assertEqual(1, l["idle"])


class ChatLogTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_sections_stack_kill_info_chat_with_a_blank_row_between(self) -> None:
        self.assertEqual([0, 4, 7], self.r["firstRows"])

    def test_a_full_section_drops_its_oldest(self) -> None:
        self.assertEqual(["k1", "k2", "k3"], self.r["killFull"])

    def test_timers_are_per_section_and_only_chat_resets(self) -> None:
        self.assertEqual({"kill": ["k2", "k3"], "chat": 1}, self.r["afterFive"])
        self.assertEqual(1, self.r["chatAt4_9"])
        self.assertEqual(0, self.r["chatAt5_1"])
        self.assertEqual(1, self.r["exactlyFive"])   # strictly greater

    def test_geometry(self) -> None:
        g = self.r["geometry"]
        self.assertEqual([10, 102, 16, 16], g["row0"]["flag"])
        self.assertEqual(40, g["row0"]["textX"])
        self.assertEqual(113, g["row0"]["baseline"])
        self.assertEqual(211, g["row7"]["baseline"])
        self.assertEqual({"x": 5, "y": 158, "h": 28}, g["div"])

    def test_colours(self) -> None:
        self.assertEqual([[1, 0.35, 0.35], [0.4, 0.6, 1], [0.7, 0.7, 0.7], [0, 1, 0]], self.r["colors"])

    def test_the_retail_lines(self) -> None:
        l = self.r["lines"]
        self.assertEqual("Steffen Schneider [killed] Robbie Pastriani", l["onFoot"])
        self.assertEqual("Steffen Schneider [Thompson] Robbie Pastriani", l["onFootThompson"])
        self.assertEqual("Johannes Werner [Tiger] Larry Vaughn", l["tank"])
        self.assertEqual("Willys", l["unnamedVehicle"])
        self.assertEqual("skandia killed a teammate", l["tk"])
        self.assertEqual("Roger Harris is no more", l["death"])
        self.assertEqual("[Sawmill] Allies captured the control point ", l["capture"])
        self.assertEqual("Axis now hold all controlpoints!", l["allPoints"])


if __name__ == "__main__":
    unittest.main()
