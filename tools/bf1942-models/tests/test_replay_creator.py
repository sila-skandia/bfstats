"""The round replay's creator view (features/replay-creator-view): the camera
track's path through its keys, picking in screen space, the round cam that
rides a round to what it hits in bullet time, the shot's slow motion and the
round worth riding, clip file names and the gate.

One node run (`replay_creator_harness.mjs`), many assertions.

Why it exists. The 2026-09-29 request: content creators want to follow
bullets as they fire at players, chase bazooka shots, isolate parts of the
timeline and make their own shots, click a player or anything major on screen,
behind the admin role for now. The 2026-10-18 pass: the bullet cam goes for
the round that kills rather than the next one (a machine gun's burst is
thirty rounds and one of them counts), and a clip carries a camera move and
slow motion so a short can be cut in the page.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_creator_harness.mjs"

_cache: dict | None = None


def run_harness() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=600,
                          cwd=HARNESS.parent)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    _cache = json.loads(proc.stdout)
    return _cache


class CameraTrackTests(unittest.TestCase):
    """Keys at 10 s (origin, facing -Z), 12 s (10 m along +X, a quarter turn
    left, its quaternion written from the other hemisphere) and 16 s (20 m
    up, facing -Z again)."""

    track: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.track = run_harness()["track"]

    def test_keys_are_kept_in_time_order(self) -> None:
        self.assertEqual(self.track["order"], [10, 12, 16])

    def test_the_camera_is_at_each_key_at_its_moment_and_holds_outside(self) -> None:
        at = {s["t"]: s for s in self.track["sample"]}
        self.assertEqual(at[10]["pos"], [0, 0, 0])
        self.assertEqual(at[12]["pos"], [10, 0, 0])
        self.assertEqual(at[16]["pos"], [0, 20, 0])
        self.assertEqual(at[9]["pos"], [0, 0, 0])
        self.assertEqual(at[17]["pos"], [0, 20, 0])
        self.assertAlmostEqual(at[12]["yaw"], 90, delta=0.2)
        self.assertEqual(at[12]["fov"], 40)
        self.assertEqual(at[11]["fov"], 50)

    def test_a_key_from_the_other_hemisphere_turns_the_short_way(self) -> None:
        self.assertLessEqual(self.track["maxYaw"], 90.5)

    def test_the_path_does_not_stop_or_kink_at_a_key(self) -> None:
        self.assertGreater(self.track["speedAt12"], 1)
        self.assertLess(self.track["kink"], 0.2)

    def test_a_key_kept_again_replaces_the_one_beside_it(self) -> None:
        self.assertEqual(self.track["merged"], [10, 12.03, 16])

    def test_a_key_read_back_broken_is_refused(self) -> None:
        self.assertEqual(self.track["valid"], [True, False, False, False])

    def test_no_keys_is_no_pose_and_one_key_holds(self) -> None:
        self.assertIsNone(self.track["none"])
        self.assertEqual(self.track["one"], [10, 0, 0])
        self.assertEqual(self.track["path"][0], [0, 0, 0])
        self.assertEqual(self.track["path"][-1], [0, 20, 0])


class PickTests(unittest.TestCase):
    """A camera at the origin facing -Z, 90 degrees high on 800 x 600: a man
    20 m ahead, a round 10 m ahead 0.3 m right, a tank 60 m ahead and 30 m
    left, a man behind the camera and one 1 km off."""

    pick: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.pick = run_harness()["pick"]

    def test_the_man_under_the_pointer(self) -> None:
        self.assertEqual(self.pick["centre"]["kind"], "soldier")
        self.assertEqual(self.pick["centre"]["pid"], 1)

    def test_a_round_is_taken_before_the_man_it_flies_past(self) -> None:
        self.assertEqual(self.pick["onTheRound"]["kind"], "round")

    def test_the_tank_and_the_empty_sky(self) -> None:
        self.assertEqual(self.pick["tank"]["kind"], "hull")
        self.assertIsNone(self.pick["nothing"])
        self.assertIsNone(self.pick["offCentre"])

    def test_nothing_behind_the_camera(self) -> None:
        self.assertIsNone(self.pick["behind"])

    def test_a_far_man_is_ten_pixels_wide_to_the_pointer(self) -> None:
        self.assertEqual(self.pick["farExact"]["pid"], 3)
        self.assertEqual(self.pick["farNear"]["pid"], 3)
        self.assertIsNone(self.pick["farMiss"])
        self.assertEqual(self.pick["ppm"], 30)

    def test_a_live_round_is_traced_to_its_shot(self) -> None:
        shot = run_harness()["shotOfRound"]
        self.assertEqual(shot["found"], 7)
        self.assertIsNone(shot["tooOld"])

    def test_a_bonus_asks_for_a_round_ahead_of_a_nearer_one(self) -> None:
        # The killing round of a burst, among the rounds around it.
        bonus = run_harness()["bonus"]
        self.assertTrue(bonus["without"])
        self.assertTrue(bonus["with"])


class RoundCamTests(unittest.TestCase):
    """A1 fires along the view's -Z at 10 s and kills B1, 30 m off, at 10.3 s;
    a round of an earlier burst on the same line, the shot's own, a stray."""

    cam: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.cam = run_harness()["roundcam"]

    def test_it_knows_where_the_man_it_killed_was(self) -> None:
        self.assertTrue(self.cam["armed"])
        self.assertEqual(self.cam["victimAt"][2], -30)
        self.assertAlmostEqual(self.cam["victimDist"], 30, delta=0.5)

    def test_it_waits_on_the_orbit_until_the_shot_is_near(self) -> None:
        self.assertFalse(self.cam["early"])

    def test_the_clock_slows_before_the_trigger(self) -> None:
        self.assertLess(self.cam["speedAtShot"], 0.05)

    def test_it_claims_the_shots_own_round_not_the_bursts(self) -> None:
        self.assertEqual(self.cam["claimed"], "own")
        self.assertEqual(self.cam["state1"], "flying")

    def test_it_rides_behind_the_round_and_lands_in_the_presets_flight(self) -> None:
        # Half a metre behind the bullet, and still gliding in from the
        # shoulder shot a third of a second after it left.
        self.assertGreater(self.cam["behindBy"], 0.5)
        self.assertLess(self.cam["behindBy"], 1.5)
        self.assertAlmostEqual(self.cam["speedInFlight"], 30 / 800 / 2.5, delta=0.001)
        self.assertTrue(self.cam["streakHidden"])
        self.assertAlmostEqual(self.cam["realFlight"], 2.5, delta=0.3)

    def test_the_chase_ends_at_the_man_it_killed_not_where_the_page_round_flew(self) -> None:
        self.assertEqual(self.cam["state2"], "impact")
        self.assertEqual(self.cam["impactAt"], self.cam["victimAt"])

    def test_the_hold_draws_back_while_he_falls_then_hands_the_view_to_him(self) -> None:
        self.assertTrue(self.cam["heldPastKill"])
        self.assertEqual(self.cam["endState"], "idle")
        self.assertEqual(self.cam["followed"], [9])
        self.assertEqual(self.cam["speedAfter"], 1)
        self.assertTrue(self.cam["rigReleased"])
        self.assertAlmostEqual(self.cam["endsAtCamera"][2], -25.5, delta=0.2)

    def test_a_round_with_no_known_end_is_let_go(self) -> None:
        self.assertEqual(self.cam["loose"]["state"], "impact")
        self.assertAlmostEqual(self.cam["loose"]["realFlight"], 7, delta=0.1)

    def test_a_seek_ends_a_chase_and_gives_the_clock_back(self) -> None:
        self.assertEqual(self.cam["seek"], {"flying": "flying", "after": "idle", "speed": 1})

    def test_a_shot_with_no_round_is_given_up(self) -> None:
        missed = self.cam["missed"]
        self.assertEqual(missed["state"], "idle")
        self.assertEqual(missed["missed"], 1)
        self.assertLess(missed["at"], 30.7)
        self.assertEqual(missed["speed"], 1)

    def test_a_seek_past_an_armed_shot_lets_go_quietly(self) -> None:
        self.assertEqual(self.cam["seekPast"], {"state": "idle", "missed": 1, "speed": 1})

    def test_helpers(self) -> None:
        h = self.cam["helpers"]
        # pace 40 m/s unknown end; 340 m at 2000 m/s in 2.5 s; the floor.
        self.assertEqual(h["slow"], [0.05, 0.5333, 1, 1, 0.068, 0.004, 0.16])
        self.assertEqual(h["guess"], [50, 50, 18, 60, 320, 650])
        self.assertEqual(h["ray"], {"ok": True, "pos": [1, 2, -3], "dir": [0, 0, -1], "none": False})
        self.assertEqual(h["next"], [1, 5, None])

    def test_one_round_a_shot_is_told_from_a_burst(self) -> None:
        # A rocket, a tank's gun, a grenade and a bomb are worth riding; a
        # sub-machine gun's and a rifle's rounds are not.
        h = self.cam["helpers"]
        self.assertEqual(h["heavy"], [True, True, True, True, False, False, False])
        # His next heavy round, anybody's next heavy round, anybody's next.
        self.assertEqual(h["nextHeavy"], [3, 2, 1])

    def test_a_thrown_grenade_is_found_in_the_recording(self) -> None:
        thrown = run_harness()["thrown"]
        self.assertEqual(thrown["found"], 900)
        self.assertEqual(thrown["from"], 5.8)
        self.assertIsNone(thrown["far"])


class ShotTests(unittest.TestCase):
    """A clip from 10 s to 16 s at a quarter speed, eased over half a second
    at each end; A1 (pid 4) kills at 12 s with the third round of a burst and
    at 30 s with a bazooka, B1 (pid 5) at 20 s with no round the recording
    could name, and A1's team kill at 33 s is never offered."""

    shot: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shot = run_harness()["shot"]

    def test_the_clock_eases_into_the_slow_stretch_and_out_of_it(self) -> None:
        # Nothing to say outside it, the clip's own speed at each end, a
        # quarter through the middle, halfway through the ease at the middle
        # of the ease.
        self.assertEqual(self.shot["ramp"], [None, 1, 0.625, 0.25, 0.25, 0.25, 0.625, 1, None])

    def test_a_ramp_that_does_nothing_says_nothing(self) -> None:
        self.assertIsNone(self.shot["off"])
        self.assertIsNone(self.shot["noSpan"])

    def test_the_slow_stretch_never_runs_faster_than_the_clip(self) -> None:
        self.assertEqual(self.shot["slower"], 0.25)

    def test_the_slow_stretch_lives_inside_the_clip(self) -> None:
        self.assertEqual(self.shot["inside"], {"t0": 10, "t1": 16})
        self.assertEqual(self.shot["part"], {"t0": 12, "t1": 16})
        self.assertIsNone(self.shot["collapsed"])

    def test_a_speed_is_worded_as_a_fraction(self) -> None:
        self.assertEqual(self.shot["words"], ["1x", "1/2", "1/4", "1/10"])

    def test_a_ramp_read_back_broken_is_filled_in(self) -> None:
        self.assertEqual(self.shot["kept"], {"in": None, "out": 12, "speed": 1, "ease": 4})

    def test_only_the_keys_inside_the_clip_are_its_camera_move(self) -> None:
        self.assertEqual(self.shot["keysIn"], [10, 12, 16])

    def test_the_stretch_between_the_keys_is_first_inside_to_last_inside(self) -> None:
        # "Slow down between the key frames": the ramp's ends from the clip's
        # own keys, nothing with one key inside the clip or no clip at all.
        self.assertEqual(self.shot["between"], {"in": 10.5, "out": 15})
        self.assertIsNone(self.shot["betweenOne"])
        self.assertIsNone(self.shot["betweenNone"])

    def test_every_killing_round_is_indexed_by_the_round_that_made_it(self) -> None:
        self.assertEqual(self.shot["byFire"], [12, 30, 33])

    def test_the_next_round_that_kills_skips_the_rest_of_the_burst(self) -> None:
        # From the start and from the middle of the burst it is the round
        # that kills at 12 s; once that has gone, his bazooka at 30 s.
        self.assertEqual(self.shot["next"][0], [11.2, 9])
        self.assertEqual(self.shot["next"][1], [11.2, 9])
        self.assertEqual(self.shot["next"][2], [29.5, 7])

    def test_anybodys_next_kill_a_kill_with_no_round_and_a_team_kill(self) -> None:
        self.assertEqual(self.shot["next"][3], [11.2, 9])
        self.assertIsNone(self.shot["next"][4])
        self.assertIsNone(self.shot["next"][5])


class ClipAndGateTests(unittest.TestCase):
    def test_clip_file_names(self) -> None:
        clip = run_harness()["clip"]
        self.assertEqual(clip["mp4"], "battle-of-kursk-2m41s-2m53s.mp4")
        self.assertEqual(clip["webm"], "wake-0m05s-1m05s.webm")
        self.assertEqual(clip["none"], "round-0m00s-0m01s.webm")
        self.assertIsNone(clip["mime"])

    def test_the_gate_is_this_pc_or_a_signed_in_account(self) -> None:
        gate = run_harness()["gate"]
        self.assertEqual(gate, {"local": True, "anonymous": False, "admin": True, "user": True})


if __name__ == "__main__":
    unittest.main()
