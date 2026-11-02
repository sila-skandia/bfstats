"""A round replay's first person: the weapon in his hands.

The owner's report (2026-09-29): "We just added FPV HUD to the replay - to
show ammo / health etc. But their weapon is not being wielded in the game
(it's just a cross hair)."

The followed player's arms and weapon are the page's own first-person rig
(arms-rig.js), posed from the recording (replay-viewmodel.js). His body
record's upper state is the engine's own animation state, and each state a
weapon declares names its first-person clip; the rig bakes them. So the arms
play the recorded state's clip, blended in at that state's own rate over the
pose they held, and the fire is his rounds. A state with no first-person clip
holds what the arms were doing, and one that puts the weapon away (swimming,
a ladder, a chute) takes them off the screen.

Run under node through `replay_viewmodel_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_viewmodel_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def families(pose):
    return None if pose is None else [[p["family"], p["weight"]] for p in pose]


class ReplayViewmodelTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_recorded_upper_state_is_a_family_of_the_rig(self) -> None:
        s = self.results["states"]
        self.assertEqual(s["Ub_LieFireMp40"], {"family": "proneFire", "n": 0, "weapon": "Mp40"})
        # The number comes after the weapon, whose own name ends in digits.
        self.assertEqual(s["Ub_IdleMp402"], {"family": "idle", "n": 2, "weapon": "Mp40"})
        self.assertEqual(s["Ub_FireKnifeAllies3"], {"family": "fire", "n": 3, "weapon": "KnifeAllies"})
        self.assertEqual(s["Ub_StandAimK98Sniper"]["weapon"], "K98Sniper", "the longest weapon name first")
        self.assertEqual(s["Ub_StandReloadK98"], {"family": "reload", "n": 0, "weapon": "K98"})
        self.assertEqual(s["Ub_TurnMp40"]["family"], "walk", "a turn plays the run clip at 0.7, nearest the walk's 0.5")
        self.assertEqual(s["Ub_StandMp40"]["family"], "idle")
        self.assertIsNone(s["Ub_CrouchToLieKnifeAllies"]["family"], "a stance change has no 1P clip")
        self.assertIsNone(s["Ub_SwimForward"])
        self.assertIsNone(s["Ub_HitChestStand"])
        self.assertEqual(s["Ub_StandAimDP"]["weapon"], "DP")

    def test_a_rig_without_a_family_falls_back_or_holds(self) -> None:
        r = self.results["resolve"]
        self.assertEqual(r["idle2"], "idle2")
        self.assertEqual(r["idle3"], "idle", "a fidget the rig lacks is its aim")
        self.assertEqual(r["swing3"], "fire3")
        self.assertEqual([r["oldCrawl"], r["oldProneFire"], r["oldCrouch"]], ["walk", "fire", "idle"],
                         "a rig without the stance families plays the standing ones")
        self.assertIsNone(r["grenadeReload"], "a grenade has no reload: the arms hold")
        self.assertIsNone(r["none"])

    def test_the_arms_follow_his_recorded_states(self) -> None:
        base = self.results["track"]["base"]
        self.assertEqual(base, [
            [1, "deploy"], [2, "idle"], [6, "reload"], [10.6, "idle"], [11, "run"],
            # 11.8 s: the dive has no 1P clip, the arms hold the run.
            [12, "prone"], [15, "hidden"], [16, "deploy"],
            # From 17 s the grenade is in his hands: its raise is a raise of
            # its own, not the Mp40's run on (16 s); his throw's fire state is
            # the stance's aim here; the medic pack's use at 20 s is none of
            # the Mp40's fire.
            [17, "deploy"], [18, "idle"], [19, "deploy"], [19.9, "idle"], [21, "idle"],
            [22, "deploy"], [22.5, "idle"], [23.05, "crouchWalk"],
        ])

    def test_his_rounds_are_the_fire(self) -> None:
        fires = self.results["track"]["fires"]
        self.assertEqual(fires, [
            # Three rounds 0.11 s apart at 9 a second: one hold of the trigger,
            # released an interval after the last. The interval is the round
            # timer's 4 whole ticks, 0.133 s (GUN-13, `fire-timer.js`).
            [3, 3.353, "fire", True],
            [5, 5.133, "fire", True],
            [13, 13.133, "proneFire", True],
            # A lying fire state no round explains is a shot of its own.
            [14, 14.133, "proneFire", True],
        ])

    def test_each_state_blends_in_at_its_own_rate_over_what_the_arms_held(self) -> None:
        p = self.results["pose"]
        self.assertEqual(p["raise"], [{"family": "deploy", "time": 0.5, "weight": 1}], "a raise cuts in (10000)")
        # The aim comes in at 0.7 a second over the raise's last frame, the
        # engine's way: each frame the bones slerp from what they hold toward
        # the clip by the weight so far (ANIM-20), at 100 frames a second.
        # 0.1 s in it is a third of the way, 0.3 s in nearly all of it, where
        # a straight 1/0.7 s fade would be 7% and 21%.
        self.assertEqual(families(p["aim"]), [["idle", 0.326], ["deploy", 0.674]])
        self.assertEqual(families(p["aimLater"]), [["idle", 0.97], ["deploy", 0.03]])
        # Fire at 4 a second.
        self.assertEqual(families(p["burstStart"]), [["fire", 0.478], ["idle", 0.522]])
        self.assertEqual(p["burstEnd"], [{"family": "fire", "time": 0.3, "weight": 1}],
                         "the burst's loop runs on from its first round")
        self.assertEqual(families(p["settling"]), [["idle", 0.068], ["fire", 0.932]])
        self.assertEqual(families(p["tap"]), [["fire", 0.478], ["idle", 0.522]])
        self.assertEqual(p["reload"], [{"family": "reload", "time": 2, "weight": 1}], "2 s into the magazine")
        self.assertEqual(p["run"][0]["family"], "run")
        self.assertEqual(p["diving"][0]["family"], "run", "the dive holds the arms")
        self.assertEqual(p["prone"][0], {"family": "prone", "time": 2.1, "weight": 0.326})
        self.assertEqual(p["proneShot"][0], {"family": "proneFire", "time": 0.05, "weight": 0.478})
        self.assertEqual(p["unexplained"][0]["family"], "proneFire")
        self.assertIsNone(p["swimming"], "swimming, no weapon in his hands")
        self.assertEqual(p["raisedAgain"], [{"family": "deploy", "time": 0.4, "weight": 1}])
        self.assertTrue(self.results["seek"], "the same instant is the same pose, whatever came before")

    def test_a_throw_winds_up_from_the_click_and_leaves_his_hand_empty(self) -> None:
        g = self.results["grenade"]
        # `fireDelay 0.8`: the round leaves 23 ticks after the tick that took
        # the click (fire-timer.js `delayTicks`, the lab's GrenadeAxis).
        self.assertEqual(g["fires"][0], [18.033, 19.033, "fire", False], "the round left 23 ticks after the click")
        self.assertEqual(g["windUp"], [{"family": "fire", "time": 0.467, "weight": 1}])
        self.assertEqual(g["raise"], [{"family": "deploy", "time": 0.2, "weight": 1}])
        self.assertEqual(g["thrown"], [False, True, True, False], "out of his hand 0.4 s from 18.8 s")
        # A crouch 0.47 s into the second throw ends it there: the torso is
        # put in `Ub_StandToCrouch` (BODY-1), which plays no clip, so the
        # arms hold the throw's frame and the next state's clip takes them
        # from it, as the recorded torso did at 167.70 s in 8t224pppqe.
        self.assertEqual(g["fires"][1], [22.533, 23, "fire", False])
        self.assertEqual(g["cutHeld"], [{"family": "fire", "time": 0.457, "weight": 1}])
        self.assertEqual(families(g["cutAfter"]), [["idle", 0.787], ["fire", 0.213]])
        self.assertEqual(g["cutAfter"][1]["time"], 0.467, "the frame the crouch left it on")

    def test_a_weapon_change_raises_the_new_weapon_from_its_first_frame(self) -> None:
        # 8t224pppqe at 1:18 and 2:37: the scroll wheel through four weapons
        # is four `Ub_StandRaiseWeapon<W>` states. Each rig's raise starts at
        # its own, not at the first weapon's 0.6 s earlier, done by then.
        s = self.results["switch"]
        self.assertEqual(s["mp40"], [{"family": "deploy", "time": 0.4, "weight": 1}])
        self.assertEqual(s["grenade"], [{"family": "deploy", "time": 0.3, "weight": 1}])

    def test_a_state_blends_in_by_slerping_from_what_the_bones_hold(self) -> None:
        # morphWeight(morph, seconds): 0.7 (an aim) at 0.05, 0.1 and 0.3 s,
        # 0.5 (a run) at 0.3 s, 4 (a fire) at 0.05 s, a cut, and nothing yet.
        self.assertEqual(self.results["morph"], [0.101, 0.326, 0.97, 0.914, 0.478, 1, 0])

    def test_the_rig_is_his_in_his_first_person_only(self) -> None:
        v = self.results["viewmodel"]
        self.assertFalse(v["loading"], "nothing is drawn while the rig loads")
        self.assertEqual(v["loads"], ["GermanSoldier__MP40.fp.glb"], "his side's sleeves, his weapon")
        aim = v["aim"]
        self.assertTrue(aim["shown"] and aim["visible"])
        self.assertEqual(aim["key"], "germansoldier__mp40")
        self.assertEqual(aim["active"], [["deploy", 1, 0.674], ["idle", 2.1, 0.326]])
        self.assertEqual(aim["bone"], 0.742, "the mixer blends the clips: 1 x 0.674 + 0.21 x 0.326")
        self.assertEqual(v["burst"], [["fire", 0.05, 0.478], ["idle", 3, 0.522]])
        self.assertEqual(v["orbit"], {"shown": False, "visible": False})
        self.assertEqual(v["seat"], {"shown": False, "visible": False})
        self.assertEqual(v["swimming"], {"shown": False, "visible": False})
        self.assertIn(["prone", 2.1, 0.326], v["prone"])
        self.assertEqual(v["disposed"], {"rigs": 0, "shown": None})

    def test_his_rounds_leave_his_eye_and_flash_at_the_rig(self) -> None:
        fire = self.results["viewmodel"]["fire"]
        self.assertTrue(fire["own"])
        self.assertFalse(fire["otherPid"], "someone else's round goes the third person's way")
        self.assertFalse(fire["otherWeapon"])
        self.assertEqual(fire["fired"], [{"firer": "replay:3", "view": "first", "replay": True}])
        self.assertEqual(fire["ray"], {"origin": [0.5, 2.65, -1.5], "dir": [0, 0, -1]},
                         "from the recorded origin down the recorded axis, in the view's frame")


if __name__ == "__main__":
    unittest.main()
