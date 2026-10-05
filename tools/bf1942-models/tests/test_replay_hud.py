"""A round replay's first person: the game's crosshair where the game put it,
and the HUD fed from the recording.

The owner's ask (2026-09-29): "Can we render a cross hair on the FPV that
would be honest to the game-play? I don't mind if we calculate the cross hair
size, but placing it exactly where the game does would be handy", then: "With
the HUD, how faithful can we be to the in-game? E.g. the player's health bar,
the vehicle's health bar? What about ammo?"

The game draws its cross at the centre of the screen, so the replay's view
has to be his. His recorded rotation is his heading; the torso twist the body
record carries is a third of the view's turn off it, and the aim pitch 0.4 of
the view's pitch (measured on 1,615 hand-weapon rounds of three recordings).
At a round the recording has his view exactly: a hand weapon fires along the
camera, so the view is laid on each round's own axis. Health is recorded;
the spread is his weapon's deviation run over his recorded stance, movement
and rounds; ammunition is counted from his rounds, reloads and refills. His
zoom is the body record's state bit 0x20, which the server sends for every
soldier: the weapon's zoom lens, and a scoped rifle's scope in place of the
cross.

Run under node through `replay_hud_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_hud_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayFirstPersonTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_aim_eases_into_each_record(self) -> None:
        aim = self.results["aim"]
        self.assertEqual(aim["before"], {"pitch": 0, "twist": 0})
        self.assertEqual(aim["halfway"], {"pitch": 2, "twist": 3})
        self.assertEqual(aim["at"], {"pitch": 4, "twist": 6})
        self.assertEqual(aim["scales"], [2.5, 3])

    def test_the_view_is_his_heading_turned_by_his_twist_and_raised_by_his_aim(self) -> None:
        view = self.results["view"]
        self.assertEqual(view["modelDegrees"], [18, 10], "6 recorded twist is 18, 4 pitch is 10")
        self.assertEqual(view["eyeY"], 2.65)
        self.assertEqual(view["lens"], 57.3)

    def test_at_a_round_the_view_is_the_rounds_own_axis(self) -> None:
        view = self.results["view"]
        self.assertGreater(view["modelOff"], 3, "the records alone are 3 degrees off the round")
        self.assertEqual(view["viewOff"], 0, "the view is laid on the round")
        self.assertEqual(view["firstOff"], 0)
        self.assertEqual(view["cameraOff"], 0, "and the camera looks along it")
        # Between two rounds of a burst the view goes from one axis to the
        # next; a third of a second after the last it is his aim again.
        self.assertLess(view["betweenYaw"], 17.1)
        self.assertEqual(view["laterOff"], 0)
        # A grenade leaves above his view: it moves nothing.
        self.assertEqual(view["thrownMoved"], 0)
        self.assertEqual(view["sight"], {"kind": "foot", "nid": 50, "looking": False})

    def test_lying_on_a_slope_the_view_is_on_his_bodys_own_axes(self) -> None:
        # The owner's report (2026-09-29): at 35:20 of replay_20260928-161948
        # Instant Replay shoots env()->Amsterdam lying down, and his first
        # person looks at the sky. His body lay on 27 degrees of downhill and
        # his aim is off the slope, not the level.
        prone = self.results["prone"]
        self.assertEqual(prone["alone"], {"pitch": -6.212, "off": 0},
                         "the records alone put the view on the round, 6 degrees down")
        self.assertEqual(prone["atRound"], 0)
        self.assertEqual(prone["roundPitch"], -6.212)
        self.assertGreater(prone["levelOff"], 28, "read off the level, the view was 28 degrees into the sky")
        self.assertGreater(abs(prone["roll"]), 10, "rolled with the slope across him, as the game's view is")
        self.assertEqual(prone["eyeOff"], 0, "the eye is 0.7 m down his body's up, where his round left")

    def test_the_eye_travels_between_stances_as_the_engine_moves_it(self) -> None:
        # 0.65 standing, -0.7 lying; the running dive takes 0.282 s down, a
        # get-up from lying 0.115 s (soldier.js STANCE_TRANSITION).
        self.assertEqual(self.results["prone"]["lift"], [0.65, 0.65, -0.025, -0.7, -0.7, -0.7, -0.025, 0.65])

    def test_the_weapon_in_his_hands_is_the_kit_item_he_holds(self) -> None:
        self.assertEqual(self.results["held"], ["Bar1918", "GrenadeAllies"])

    def test_ammunition_is_counted_from_his_rounds_reloads_and_refills(self) -> None:
        ammo = self.results["ammo"]
        self.assertEqual(ammo["events"], {"rounds": 20, "reloads": [8]})
        self.assertEqual(ammo["refills"], [20])
        state = lambda key: [ammo[key]["rounds"], ammo[key]["mags"], ammo[key]["reloading"]]
        self.assertEqual(state("spawn"), [20, 5, False], "a full kit: 20 and five spare")
        self.assertEqual(state("afterBurst"), [17, 5, False])
        self.assertEqual(state("reloading"), [17, 5, True], "the change takes its reloadTime")
        self.assertEqual(state("reloaded"), [20, 4, False], "a fresh magazine; the old one's 17 are lost")
        self.assertEqual(state("refilled"), [20, 5, False], "the depot fills the kit")
        self.assertEqual(state("burst2"), [3, 5, False])
        # A bazooka goes dry with every round and reloads itself.
        self.assertEqual([[t["rounds"], t["mags"], t["reloading"]] for t in self.results["tube"]],
                         [[1, 5, False], [0, 5, True], [1, 4, False], [1, 4, False]])

    def test_the_spread_is_his_weapons_deviation_over_what_he_did(self) -> None:
        # The whole cone, `setMinDev 0.4` included: the game hands the cross
        # the total (`getMenuCrossHairRadius`, XHIT-14), not the part above it.
        spread = self.results["spread"]
        self.assertAlmostEqual(spread["still"], 0.4, places=3, msg="standing still: the floor")
        self.assertAlmostEqual(spread["burst"], 1.0, places=3)
        self.assertAlmostEqual(spread["settled"], 0.4, places=3)
        self.assertAlmostEqual(spread["running"], 1.36, places=3, msg="the floor and the speed channel's cap, 0.8 x 1.2")
        self.assertEqual(spread["none"], 0)
        self.assertEqual(spread["settle"], [1.333, 3.889])

    def test_a_seat_guns_magazine_heat_and_reload(self) -> None:
        gun = self.results["gun"]
        self.assertEqual([gun["ammo"], gun["magsLeft"], gun["heat"], gun["last"]], [18, 2, 0.3, 2.1])
        self.assertEqual(gun["cannon"], {"ammo": 0, "reloading": 3, "magsLeft": 19})

    def test_on_foot_the_hud_is_his(self) -> None:
        feed = self.results["feed"]
        foot = feed["foot"]
        self.assertEqual(foot["icon"], "Soldier/Icon_us_soldier_crouching.tga")
        self.assertTrue(foot["shown"])
        self.assertEqual(foot["hp"], [18, 30], "his recorded hit points")
        self.assertEqual(foot["bar"], "healthbar_empty_US_Assault")
        self.assertEqual(foot["ammo"], [1, 3, 20, 5])
        self.assertFalse(foot["vehicle"])
        self.assertTrue(foot["weapon"])
        # No centre dot: the server's rule. The deviation is degrees, the
        # weapon's whole cone: its 0.75 floor and the tail of his last steps.
        self.assertEqual(feed["aim"], {"style": "CHTCrossHair", "centre": False, "deviation": 0.765})
        self.assertIsNone(feed["looking"], "dragged off his aim, no cross")
        self.assertEqual(feed["after"], {"shown": False, "hp": None, "ammo": None, "aim": None})

    def test_in_a_seat_the_hud_is_the_vehicles(self) -> None:
        seat = self.results["seat"]
        self.assertEqual(seat["icon"], "Vehicle/Icon_Sherman.tga")
        self.assertTrue(seat["shown"])
        self.assertEqual(seat["hp"], [612, 900], "the hull's recorded hit points")
        self.assertEqual(seat["dots"], [1, 2])
        self.assertEqual(seat["turret"], 0.5, "IconLookRotation: the view half a radian right of the hull")
        self.assertEqual(seat["ammo"], [1, 28, 1])
        self.assertEqual(seat["ready"], 0.175, "half a second into a 2.86 s cooldown")
        self.assertEqual(seat["soldierHp"], 30)
        self.assertEqual(seat["aim"], {"style": "CHTCrossHair", "deviation": 0, "scoped": False, "centre": False})
        self.assertFalse(seat["weapon"])
        self.assertEqual(seat["leftVehicleVars"], [], "the seat's variables go when he gets out")
        self.assertFalse(seat["backOnFoot"])

    def test_his_zoom_is_the_recorded_bit_and_the_weapons_own_lens(self) -> None:
        zoom = self.results["zoom"]
        self.assertEqual(zoom["bits"], [False, True, True, False, False], "state bit 0x20, 3 s to 6 s")
        self.assertEqual(zoom["zoomOf"], {"zoomed": True, "fov": 5.729577951308232}, "a K98 sniper's 0.1 rad")
        # The engine's ease, 0.3 of the way a frame: 57.3 * 0.7 + 5.73 * 0.3.
        self.assertEqual(zoom["fovs"], {"before": 57.3, "first": 41.829, "zoomed": 5.73, "after": 57.3})

    def test_a_scoped_rifle_draws_its_scope_not_the_cross(self) -> None:
        zoom = self.results["zoom"]
        self.assertEqual(zoom["scope"], {"show": True, "index": 1, "icon": "sniper.tga", "sniper": True})
        self.assertEqual(zoom["scopedAim"], {"style": "CHTNone", "scoped": True})
        self.assertEqual(zoom["unzoomedIndex"], 0)
        self.assertFalse(zoom["unzoomedAim"])
        # A BAR zooms without a scope: its cross stays, through a 28.6 degree lens.
        self.assertFalse(zoom["barAim"])
        self.assertEqual(zoom["barFov"], 28.648)

    def test_the_pages_cross_asks_the_replay_first(self) -> None:
        aim = self.results["pageAim"]
        self.assertEqual(aim["replay"], {"style": "CHTIcon", "deviation": 0, "scoped": False, "centre": False})
        self.assertEqual(aim["none"], {"style": None, "deviation": 0, "scoped": False})

    def test_the_cross_opens_five_units_a_degree_whatever_the_lens(self) -> None:
        """`BfCrosshairNode::draw` (client 0x007db970) runs each arm from
        `Radius` off centre to the rect's half-size 10 plus `Deviation`; the
        soldier HUD feed (0x006e9690) writes both as the weapon's total
        deviation times `Game.setCrossHairRadius` / `setCrossHairSize`, 5 in
        the shipped `Game/Init/Menu.con` (XHIT-14). No field of view in it."""
        cross = self.results["cross"]
        for case in cross.values():
            self.assertTrue(case["shown"])
        # 1600x1200: 2 px a unit. A still Thompson (0.4 degrees): 2 units of
        # gap, not closed; arms always 10 units long.
        self.assertEqual([cross["still"][k] for k in ("gapX", "gapY", "lenX", "lenY")], [4, 4, 20, 20])
        self.assertEqual([cross["running"][k] for k in ("gapX", "gapY", "lenX", "lenY")], [13.6, 13.6, 20, 20])
        self.assertEqual(cross["zoomed"], cross["running"], "zooming changes the lens, not the cross")
        self.assertEqual([cross["none"][k] for k in ("gapX", "gapY")], [0, 0])
        # 2560x1440 stretches the units 3.2 x 2.4: the DP at its floor
        # (0.75 degrees) parts 3.75 units on both axes, the owner's
        # capture (XHIT-11).
        wide = cross["wide"]
        self.assertEqual([wide["ux"], wide["uy"]], [3.2, 2.4])
        self.assertEqual([wide["gapX"], wide["gapY"]], [12, 9])
        self.assertEqual([wide["lenX"], wide["lenY"]], [32, 24])


if __name__ == "__main__":
    unittest.main()
