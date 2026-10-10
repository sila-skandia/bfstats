"""Artillery spotting: `viewer/spotter.js`, driven headless by
`spotter_harness.mjs`, and the con words and table behind it (`bf42/con.py`,
`extract_vehicle_spotting.py`).

The rules are the engine's: `FireArms::placeScoutCamera` (lnxded 0x0828dde0),
`Game::placeScoutCamera` / `removeScoutCamera`, the client's selector
(BF1942.exe 0x006a65b0 .. 0x006a6b80) and `Camera::getTransformation` in view
mode 17. Ledger SPOT-1..SPOT-13; `features/artillery-spotting`.
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
sys.path.insert(0, str(ROOT))

import extract_vehicle_spotting as evs  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402

VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("spotter_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "spotter.js", work / "spotter.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


OFF = {"selected": None, "viewing": False, "view": None, "line": None}


def on(marker: int) -> dict:
    return {"selected": marker, "viewing": True, "view": marker, "line": marker}


class MarkerTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_engines_constants(self) -> None:
        self.assertEqual({"RAY_RANGE": 10000, "EYE_LIFT": 30, "REMOVE_DELAY": 0.2,
                          "LOOK_AHEAD": 20, "LOOK_EASE": 0.1, "NO_OWNER": -1},
                         self.r["constants"])

    def test_mag_type_two_marks_and_damage_type_three_alone_does_not(self) -> None:
        self.assertEqual({"binoculars": True, "medPack": False, "rifle": False,
                          "damageTypeAlone": False, "none": False}, self.r["markerWeapon"])

    def test_the_look_at_matrix_is_forward_then_up_cross_forward(self) -> None:
        down = self.r["lookAt"]["down"]
        self.assertEqual([10, 40, 10], down["position"])
        self.assertEqual([1, 0, 0], down["right"])
        self.assertAlmostEqual(-0.3714, down["forward"][1], places=4)
        self.assertAlmostEqual(0.9285, down["forward"][2], places=4)
        self.assertAlmostEqual(0.9285, down["up"][1], places=4)

    def test_a_look_straight_down_leaves_the_position_at_the_origin(self) -> None:
        down = self.r["lookAt"]["straightDown"]
        self.assertTrue(down["degenerate"])
        self.assertEqual([0, 0, 0], down["position"])
        self.assertEqual([0, -1, 0], down["forward"])

    def test_the_marker_sits_thirty_above_the_eye_looking_at_the_hit(self) -> None:
        pose = self.r["pose"]["hit"]
        self.assertTrue(pose["hit"])
        self.assertEqual([100, 10, 500], pose["target"])
        self.assertEqual([100, 40, 100], pose["matrix"]["position"])
        self.assertLess(pose["matrix"]["forward"][1], 0)

    def test_a_hit_must_be_strictly_inside_the_range(self) -> None:
        self.assertFalse(self.r["pose"]["atRange"])
        self.assertTrue(self.r["pose"]["justInside"])

    def test_a_miss_keeps_the_fire_transform(self) -> None:
        pose = self.r["pose"]["miss"]
        self.assertFalse(pose["hit"])
        self.assertIsNone(pose["target"])
        self.assertEqual([100, 10, 100], pose["matrix"]["position"])
        self.assertEqual([0, 0, 1], pose["matrix"]["forward"])

    def test_the_list_is_newest_first_and_holds_both_teams(self) -> None:
        self.assertEqual([2, 1], self.r["list"]["order1"])
        self.assertEqual({"owner": 1, "team": 1, "target": [0, 2, 200], "eye": [0, 32, 0]},
                         self.r["list"]["a"])

    def test_a_re_mark_removes_the_weapons_old_marker_a_fifth_of_a_second_later(self) -> None:
        lst = self.r["list"]
        self.assertEqual([3, 2, 1], lst["order2"])
        self.assertEqual([3, 2, 1], lst["during"])
        self.assertEqual([3, 2], lst["after"])

    def test_firing_at_the_sky_removes_the_old_marker_and_lists_an_unowned_one(self) -> None:
        lst = self.r["list"]
        self.assertEqual([4, 2], lst["afterSky"])
        self.assertEqual({"owner": -1, "team": None, "hit": False, "position": [0, 2, 0]},
                         lst["sky"])

    def test_a_marker_lives_its_time_to_live(self) -> None:
        lst = self.r["list"]
        self.assertEqual(60, lst["remainingB"])
        self.assertEqual([4, 2], lst["beforeExpiry"])
        self.assertEqual([4], lst["afterExpiry"])
        self.assertEqual([1, 3, 2], lst["removed"])


class ViewTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()["view"]

    def test_the_camera_refuses_without_extern_trace_or_at_the_origin(self) -> None:
        self.assertFalse(self.r["refusedNoCamera"])
        self.assertFalse(self.r["refusedOrigin"])
        self.assertTrue(self.r["on"])

    def test_the_look_at_is_seeded_twenty_along_the_markers_forward(self) -> None:
        eye = self.r["rest"]["position"]
        seeded = self.r["seeded"]
        self.assertEqual([0, 30, 0], eye)
        distance = sum((a - b) ** 2 for a, b in zip(seeded, eye)) ** 0.5
        self.assertAlmostEqual(20.0, distance, places=9)
        self.assertEqual(seeded, self.r["rest"]["target"])

    def test_the_gaze_closes_a_tenth_of_the_gap_to_the_shell_a_call(self) -> None:
        self.assertAlmostEqual(0.9, self.r["ratio"], places=9)
        for got, want in zip(self.r["onShell"], [100, 50, 100]):
            self.assertAlmostEqual(want, got, delta=0.05)

    def test_with_no_shell_the_gaze_drifts_back_to_the_marked_line(self) -> None:
        for got, want in zip(self.r["back"], self.r["seeded"]):
            self.assertAlmostEqual(want, got, delta=0.001)

    def test_off_restores_what_on_saved_once_and_only_in_an_art_pos_seat(self) -> None:
        self.assertFalse(self.r["outside"])
        self.assertTrue(self.r["stillOn"])
        self.assertTrue(self.r["off"])
        self.assertEqual(["save", "restore cockpit 60"], self.r["log"])
        self.assertFalse(self.r["offAgain"])
        self.assertIsNone(self.r["stepOff"])


class SelectorTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_gate_wants_an_art_pos_seat_and_a_current_teammates_marker(self) -> None:
        self.assertEqual({"noMarkers": False, "enemyOnly": False, "onFoot": False,
                          "friendly": True, "turncoat": False, "skyOnly": False,
                          "toggleShut": False, "stepShut": False}, self.r["gate"])

    def test_alt_fire_turns_the_view_on_at_the_teams_first_marker_and_off_again(self) -> None:
        t = self.r["toggle"]
        self.assertTrue(t["took"])
        self.assertEqual(on(t["ids"]["mine"]), t["on"])
        self.assertEqual(OFF, t["off"])
        self.assertEqual(1, t["restored"])
        self.assertEqual(2, t["fades"])

    def test_a_seat_with_no_extern_trace_camera_gets_the_line_without_the_view(self) -> None:
        self.assertEqual({"selected": 1, "viewing": True, "view": None, "line": 1},
                         self.r["noCamera"])

    def test_next_takes_the_newest_and_previous_the_oldest(self) -> None:
        s = self.r["steps"]
        self.assertEqual(on(s["ids"]["m2"]), s["nextFromNone"])
        self.assertEqual(on(s["ids"]["m1"]), s["prevFromNone"])

    def test_stepping_does_not_skip_an_enemys_marker_and_then_stalls(self) -> None:
        s = self.r["steps"]
        stuck = {"selected": s["ids"]["e3"], "viewing": True,
                 "view": s["ids"]["m2"], "line": s["ids"]["m2"]}
        self.assertEqual(stuck, s["ontoEnemy"])
        self.assertEqual(stuck, s["stalled"])
        self.assertEqual(OFF, s["cleared"])

    def test_stepping_wraps_at_the_ends(self) -> None:
        s = self.r["steps"]
        self.assertEqual(on(s["ids"]["m2"]), s["wrapped"])

    def test_nothing_selected_and_an_enemys_marker_at_the_end_does_nothing(self) -> None:
        self.assertEqual(OFF, self.r["steps"]["enemyNewest"])

    def test_a_list_of_one_does_not_step(self) -> None:
        one = self.r["steps"]["listOfOne"]
        self.assertEqual(one["before"], one["after"])

    def test_the_view_ends_when_its_marker_leaves_the_list(self) -> None:
        e = self.r["endings"]
        self.assertEqual(on(1), e["on"])
        self.assertEqual(on(1), e["stillOld"])
        self.assertEqual({"selected": 1, "viewing": True, "view": None, "line": 1},
                         e["removed"])
        self.assertEqual(0, e["secondsAfter"])
        self.assertEqual(OFF, e["framed"])

    def test_the_view_ends_when_the_markers_whole_seconds_run_out(self) -> None:
        e = self.r["endings"]
        self.assertEqual(on(e["second"]), e["onSecond"])
        self.assertEqual(1, e["lastSecond"])
        self.assertEqual(on(e["second"]), e["beforeExpiry"])
        self.assertEqual(0, e["zero"])
        self.assertEqual(OFF, e["expired"])
        self.assertEqual(2, e["restored"])

    def test_leaving_the_seat_restores_nothing(self) -> None:
        self.assertEqual({**OFF, "restored": 0}, self.r["endings"]["left"])


class HudTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_gunner_is_shown_his_teams_live_markers_only(self) -> None:
        self.assertEqual([1], self.r["hud"]["live"])
        self.assertEqual([], self.r["hud"]["dead"])

    def test_the_scout_icon_changes_frame_every_second_and_a_half(self) -> None:
        self.assertEqual([1, 1, 2, 2, 1], self.r["hud"]["icon"])

    def test_the_viewed_wedge_blinks_by_set_camera_blink(self) -> None:
        self.assertEqual([0, 0, 0.6, 0.6, 0, 0.6], self.r["hud"]["blink"])

    def test_the_fade_holds_half_a_second_then_clears_over_two_and_a_half(self) -> None:
        self.assertEqual([1, 1, 0.5, 0, 0], self.r["hud"]["fade"])

    def test_the_lines(self) -> None:
        self.assertEqual("Scout: Sgt. Rock", self.r["hud"]["scoutLine"])
        self.assertEqual("Sgt. Rock called for artillery (timeleft: 118)",
                         self.r["hud"]["calledLine"])

    def test_a_seat_is_found_in_the_table_by_its_template_whatever_the_case(self) -> None:
        self.assertEqual({"hit": "Priest_Gunner_PCO1", "miss": None, "noTable": None},
                         self.r["seat"])


class MarkerPullNodeTests(unittest.TestCase):
    """`gun-cycle.js` against a marker weapon's group, in `test_spotter_pull.mjs`."""

    def test_a_marker_weapons_press_marks_once_and_fires_nothing(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        script = Path(__file__).with_name("test_spotter_pull.mjs")
        proc = subprocess.run(["node", str(script)], capture_output=True, text=True,
                              timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{script.name} failed:\n{proc.stdout}\n{proc.stderr}")


def library(text: str) -> ObjectLibrary:
    lib = ObjectLibrary()
    lib.add_con("Objects/Vehicles/Test/Objects.con", text)
    return lib


CON = """
ObjectTemplate.create Camera TestGunCamera
ObjectTemplate.CVMExternTrace 1

ObjectTemplate.create Camera TestPlainCamera
ObjectTemplate.CVMChase 1

ObjectTemplate.create Projectile TestMarkerProjectile
ObjectTemplate.timeToLive CRD_NONE/120/0/0
ObjectTemplate.damageType 3

ObjectTemplate.create FireArms TestCannon
ObjectTemplate.setInputFire c_PIFire

ObjectTemplate.create FireArms TestCoax
ObjectTemplate.setInputFire c_PIAltFire

ObjectTemplate.create FireArms TestSpotter
ObjectTemplate.magType 2
ObjectTemplate.setInputFire c_PIAltFire
ObjectTemplate.projectileTemplate TestMarkerProjectile

ObjectTemplate.create FireArms TestMedPack
ObjectTemplate.magType 1

ObjectTemplate.create PlayerControlObject TestGunner
ObjectTemplate.artPos 1
ObjectTemplate.DirBarXScale 25
ObjectTemplate.DirBarYScaleAbove 40
ObjectTemplate.DirBarYScaleBelow 0
ObjectTemplate.DirBarYScaleMin -90
ObjectTemplate.DirBarYScaleMax -50
ObjectTemplate.DirBarRotate 180
ObjectTemplate.addTemplate TestGunCamera
ObjectTemplate.addTemplate TestCannon

ObjectTemplate.create PlayerControlObject TestBlindGunner
ObjectTemplate.artPos 1
ObjectTemplate.addTemplate TestPlainCamera
ObjectTemplate.addTemplate TestCoax
ObjectTemplate.addTemplate TestGunner

ObjectTemplate.create PlayerControlObject TestDriver
ObjectTemplate.artPos 0
ObjectTemplate.addTemplate TestGunner
ObjectTemplate.addTemplate TestSpotter
"""


class ExtractionTests(unittest.TestCase):
    lib: ObjectLibrary

    @classmethod
    def setUpClass(cls) -> None:
        cls.lib = library(CON)
        cls.table = evs.build_table("test", cls.lib)

    def test_the_parser_reads_art_pos_and_the_dir_bar_words(self) -> None:
        gunner = self.lib.object("TestGunner")
        self.assertTrue(gunner.art_pos)
        self.assertEqual({"dirbarxscale": 25.0, "dirbaryscaleabove": 40.0,
                          "dirbaryscalebelow": 0.0, "dirbaryscalemin": -90.0,
                          "dirbaryscalemax": -50.0, "dirbarrotate": 180.0}, gunner.dir_bar)
        self.assertFalse(self.lib.object("TestDriver").art_pos)
        self.assertIsNone(self.lib.object("TestCannon").art_pos)
        self.assertIsNone(self.lib.object("TestDriver").dir_bar)

    def test_only_art_pos_seats_are_listed(self) -> None:
        self.assertEqual(["TestBlindGunner", "TestGunner"],
                         [s["seat"] for s in self.table["seats"]])

    def test_a_seat_carries_its_camera_its_weapons_inputs_and_its_bars(self) -> None:
        gunner = next(s for s in self.table["seats"] if s["seat"] == "TestGunner")
        self.assertEqual(
            {"seat": "TestGunner", "externTrace": True, "weaponInputs": ["c_PIFire"],
             "dirBar": {"xScale": 25.0, "yScaleAbove": 40.0, "yScaleBelow": 0.0,
                        "yScaleMin": -90.0, "yScaleMax": -50.0, "rotate": 180.0}},
            gunner)

    def test_a_nested_seats_camera_and_weapons_are_its_own(self) -> None:
        blind = next(s for s in self.table["seats"] if s["seat"] == "TestBlindGunner")
        self.assertEqual({"seat": "TestBlindGunner", "externTrace": False,
                          "weaponInputs": ["c_PIAltFire"]}, blind)

    def test_the_marker_weapons_are_those_with_mag_type_two(self) -> None:
        self.assertEqual(
            [{"template": "TestSpotter", "input": "c_PIAltFire",
              "projectile": "TestMarkerProjectile", "timeToLive": 120.0}],
            self.table["markerWeapons"])

    def test_the_blink_is_the_last_one_init_con_reaches(self) -> None:
        files = {
            "bf1942/game/init.con": "run Init/Menu\n",
            "bf1942/game/init/menu.con": "Game.setCameraBlink 0.5 2\n",
        }
        self.assertEqual((0.5, 2.0), evs.camera_blink(lambda p: files.get(p.lower())))
        self.assertEqual((0.75, 1.5), evs.camera_blink(lambda p: None))
        self.assertEqual([0.75, 1.5], self.table["cameraBlink"])

    def test_the_table_carries_the_strings_and_sprites_it_is_handed(self) -> None:
        table = evs.build_table("m", self.lib, blink=(1.0, 2.0), strings={"SCOUT": "Scout"},
                                sprites={"camview": "spotting/camview.png"})
        self.assertEqual("m", table["mod"])
        self.assertEqual([1.0, 2.0], table["cameraBlink"])
        self.assertEqual({"SCOUT": "Scout"}, table["strings"])
        self.assertEqual({"camview": "spotting/camview.png"}, table["sprites"])


if __name__ == "__main__":
    unittest.main()
