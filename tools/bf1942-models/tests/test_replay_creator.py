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
        # The speed lane's automatic bullet time: from just before the shot
        # until the man has fallen.
        self.assertEqual(h["bulletSpan"], [{"t0": 9.55, "t1": 11.3}, {"t0": 9.55, "t1": 10.9}, None])

    def test_the_chased_bullet_leaves_the_drawn_muzzle(self) -> None:
        # Out of the barrel, half way back on the line at 10 m, on it from
        # 20 m; a kill 4 m off joins it by 2 m; no muzzle known, the round.
        d = self.cam["helpers"]["drawn"]
        self.assertEqual(d["start"], [0.3, 1.2, 0])
        self.assertEqual(d["half"], [0.15, 1.4, -10])
        self.assertEqual(d["joined"], [0, 1.6, -20])
        self.assertEqual(d["past"], [0, 1.6, -40])
        self.assertEqual(d["near"], [0, 1.6, -2])
        self.assertEqual(d["none"], [0, 1.6, 0])
        # The drawn muzzle noted for that very shot; none three metres
        # off the eye, for a rocket (the page draws it), for another shot
        # object at the same moment, or for a shot no drawn gun fired.
        m = self.cam["helpers"]["muzzle"]
        self.assertEqual(m["gun"], [0.3, -0.4, -0.5])
        # A fixed MG's gunner's camera, 2.3 m behind the gun on the line.
        self.assertEqual(m["nest"], [0, 0, -2.3])
        self.assertEqual(m["placed"], [0, -0.3, 0])
        self.assertEqual({k: m[k] for k in ("far", "rocket", "later", "body")},
                         {"far": None, "rocket": None, "later": None, "body": None})

    def test_one_round_a_shot_is_told_from_a_burst(self) -> None:
        # A rocket, a tank's gun, a grenade and a bomb are worth riding; a
        # sub-machine gun's and a rifle's rounds are not.
        h = self.cam["helpers"]
        self.assertEqual(h["heavy"], [True, True, True, True, False, False, False])
        # His next heavy round, anybody's next heavy round, anybody's next.
        self.assertEqual(h["nextHeavy"], [3, 2, 1])

    def test_a_stand_in_lays_the_take_out_without_the_pages_round(self) -> None:
        m = self.cam["model"]
        # Over his shoulder before the shot, and still there held on him.
        self.assertEqual(m["armed"], {"ok": True, "state": "armed", "pos": [0.6, 2.05, 2.4], "hero": False})
        self.assertEqual(m["shoulderAfter"]["pos"], [0.6, 2.05, 2.4])
        # 60% of the way on the line to B1: just behind the round, drawn.
        self.assertEqual(m["flying"], {"ok": True, "state": "flying", "pos": [0.07, 1.51, -17.451], "hero": True})
        # From the victim: 2.2 m beyond him, to his side.
        self.assertEqual(m["reverse"]["pos"], [0.9, 1.65, -32.2])
        # The hold from where the chase had the camera at the hit, drawn back.
        self.assertEqual([h["pos"] for h in m["hold"]], [[0.07, 1.39, -29.451], [0, 2.645, -25.5]])
        self.assertEqual((m["style"], m["victimAt"], m["none"]), ("chase", [0, 1.3, -30], False))
        self.assertEqual(m["kinds"], ["tracer", "rocket", "thrown", "bomb", "shell"])

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


class ActionTests(unittest.TestCase):
    """The owner's 2026-10-18 report: a bazooka kill clipped, the camera keyed
    at the clip's two ends and slow motion set, and "the tank blows up, then
    another ten seconds of the pan".

    RuppoPeaGame fires at 224.058 s and the tank goes up at 224.958 s -- 0.9 s
    -- inside a clip of 221.058 to 227.458, because a clip marked round a kill
    carries a 3 s lead-in and a 2.5 s tail. Keys at the clip's own ends spread
    6.4 s of camera over 0.9 s of action, and slow motion cannot fix the
    ratio: it slows both by the same factor. The clip now knows the action
    inside it, and the camera move and the slow motion go there."""

    action: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.action = run_harness()["action"]

    def test_the_action_is_the_shot_to_a_moment_past_the_hit(self) -> None:
        # The round leaves at 224.058 and the camera lands 0.4 s after the
        # tank goes up, on the wreck, not dead on the flash.
        self.assertEqual(self.action["action"], [224.058, 225.358])

    def test_a_round_that_kills_too_fast_to_pan_over_is_grown(self) -> None:
        # Jano's No4 kills 0.16 s after the trigger; a move over that is a
        # cut, so the action is a second from the shot.
        self.assertEqual(self.action["sniper"], [41.991, 42.991])
        self.assertEqual(self.action["moment"], 1)

    def test_the_action_is_held_inside_the_clip(self) -> None:
        self.assertEqual(self.action["clamped"], [10, 11])
        self.assertIsNone(self.action["none"])
        self.assertIsNone(self.action["notATime"])

    def test_the_move_fits_to_the_action_and_keeps_its_poses(self) -> None:
        # A and B slide off the clip's ends onto the action; each key keeps
        # the view it was stamped with (x = where it was keyed).
        self.assertEqual(self.action["fitted"], [224.058, 225.358])
        self.assertEqual(self.action["fittedKeepsPose"], [221.058, 227.458])

    def test_a_key_between_them_keeps_its_place_proportionally(self) -> None:
        # 1.6 s into a 6.4 s move is a quarter of the way: 0.325 s into 1.3 s.
        self.assertEqual(self.action["fitThree"], [224.058, 224.383, 225.358])

    def test_a_move_outside_the_clip_or_already_fitted_is_left_alone(self) -> None:
        self.assertIsNone(self.action["fitAlready"])
        self.assertIsNone(self.action["fitOne"])
        self.assertIsNone(self.action["fitNoBeat"])
        self.assertEqual(self.action["fitOutside"], [10, 224.058, 225.358])

    def test_the_wide_move_crawls_on_long_after_the_hit(self) -> None:
        # The report, measured: at a quarter over the action, a move keyed at
        # the clip's ends takes 8.9 s to watch and the tank goes up 5.9 s in,
        # leaving 3 s of pan over nothing -- and 1/10 would treble it.
        self.assertAlmostEqual(self.action["wideWatch"], 8.89, places=2)
        self.assertAlmostEqual(self.action["wideToHit"], 5.90, places=2)
        self.assertGreater(self.action["wideWatch"] - self.action["wideToHit"], 2.5)

    def test_the_fitted_move_is_the_action_and_nothing_else(self) -> None:
        # 1.3 s of the round, 3.8 s on screen at a quarter, ending with the
        # wreck. The hit is two thirds of the way through it.
        self.assertAlmostEqual(self.action["fittedWatch"], 3.79, places=2)
        self.assertAlmostEqual(self.action["atSpeed"], 1.3, places=2)
        self.assertEqual(self.action["backwards"], 0)


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


class ShotStyleTests(unittest.TestCase):
    """One rifle take per shot style (features/replay-creator-view, "Shot
    styles"): A1 fires down the view's -Z at 10 s and kills B1 30 m off at
    10.3 s. "ahead" is how far the camera is in front of the round (it flies
    toward -Z), "abreast" how far to its side."""

    styles: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.styles = run_harness()["styles"]

    def test_every_style_claims_the_round_and_lets_go(self) -> None:
        for name, take in self.styles.items():
            if name == "aim":
                continue
            with self.subTest(name):
                self.assertEqual(take["claimed"], "flying")
                self.assertEqual(take["endState"], "idle")

    def test_chase_rides_behind(self) -> None:
        chase = self.styles["chase"]
        self.assertLess(chase["early"]["ahead"], 0)
        self.assertLess(chase["late"]["ahead"], 0)

    def test_chase_360_starts_in_front_ends_behind_and_turns_on_round_the_man(self) -> None:
        orbit = self.styles["orbit"]
        # Before the shot: in front of the shooter, facing him.
        self.assertLess(orbit["armedCam"][2], 0)
        self.assertGreater(orbit["early"]["ahead"], 0)
        self.assertLess(orbit["late"]["ahead"], 0)
        # The hold's half turn: from the shooter's side of B1 (z -30) to the
        # far side of him.
        self.assertGreater(orbit["holdStart"][2], -30)
        self.assertLess(orbit["holdEnd"][2], -33)

    def test_side_on_keeps_abreast(self) -> None:
        side = self.styles["side"]
        self.assertAlmostEqual(side["early"]["abreast"], 0.7, delta=0.05)
        self.assertAlmostEqual(side["late"]["abreast"], 0.7, delta=0.05)
        self.assertGreater(side["armedCam"][0], 3)

    def test_from_the_victim_waits_beyond_him(self) -> None:
        rev = self.styles["reverse"]
        self.assertLess(rev["armedCam"][2], -31)
        self.assertEqual(rev["holdStart"], rev["holdEnd"])
        self.assertGreater(rev["early"]["ahead"], 20)

    def test_your_angle_stays_where_it_was_put_and_stays_after(self) -> None:
        for name in ("fixed", "locked"):
            take = self.styles[name]
            self.assertEqual(take["armedCam"], [12, 4, -10])
            self.assertEqual(take["holdEnd"], [12, 4, -10])
            self.assertEqual(take["freed"], 1)

    def test_your_angle_follows_the_action_or_holds_its_framing(self) -> None:
        aim = self.styles["aim"]
        self.assertGreater(aim["track"]["atMan"], 0.99)
        self.assertEqual(aim["lock"]["atKept"], 1)
        self.assertLess(aim["lock"]["atMan"], 0.9)

    def test_your_angle_with_none_kept_is_the_chase(self) -> None:
        self.assertEqual(self.styles["fixedNoAngle"]["armedCam"], self.styles["chase"]["armedCam"])


class MeleeTests(unittest.TestCase):
    """A knife's kill (recording 8t224pppqe, Berlin, 114.40 s: BF6 knifes pid
    0, and the bullet cam drew a bullet). The swing is a fire record of its
    own; the page flies a knife round beside it."""

    melee: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.melee = run_harness()["melee"]

    def test_the_dossier_names_the_swing_as_melee(self) -> None:
        self.assertEqual(self.melee["kind"], "melee")
        self.assertEqual(self.melee["weapon"], "KnifeAxis")

    def test_nothing_is_chased_and_no_bullet_is_drawn(self) -> None:
        self.assertFalse(self.melee["claimed"])
        self.assertFalse(self.melee["heroSeen"])
        self.assertNotIn("flying", self.melee["states"])

    def test_the_swing_is_slowed_and_the_clock_given_back(self) -> None:
        self.assertEqual(self.melee["slowest"], 0.35)
        self.assertEqual(self.melee["end"], "idle")
        self.assertEqual(self.melee["speedAfter"], 1)

    def test_a_placed_camera_films_it_from_where_it_was_put(self) -> None:
        fixed = self.melee["fixedStyle"]
        self.assertEqual(fixed["style"], "fixed")
        self.assertEqual(fixed["cam"], [12, 4, -10])

    def test_which_weapons_are_melee(self) -> None:
        self.assertEqual(self.melee["melee"], [True, True, True, False, False])


class SuggestionTests(unittest.TestCase):
    """The angles offered on a kill, worked out from the muzzle and the man."""

    s: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.s = run_harness()["shotstyle"]

    def test_chase_360_turns_half_in_flight_and_half_in_the_hold(self) -> None:
        self.assertEqual(self.s["yaw"][:2], [3.142, 3.142])
        self.assertEqual(self.s["yaw"][-1], 0)
        self.assertEqual(self.s["hold"], [0, 1.571, 3.142])

    def test_five_angles_on_open_ground(self) -> None:
        ids = [a["id"] for a in self.s["flat"]]
        self.assertEqual(ids, ["side", "shoulder", "victim", "high", "low"])
        self.assertTrue(all(a["clear"] for a in self.s["flat"]))

    def test_every_angle_takes_the_side_the_hill_leaves_open(self) -> None:
        for a in self.s["hill"]:
            with self.subTest(a["id"]):
                self.assertTrue(a["clear"])
                self.assertLessEqual(a["x"], 2)

    def test_in_a_street_the_side_on_comes_in_between_the_walls(self) -> None:
        side = next(a for a in self.s["street"] if a["id"] == "side")
        self.assertTrue(side["clear"])
        self.assertLessEqual(abs(side["x"]), 4)

    def test_angles_the_level_blocks_are_offered_but_marked(self) -> None:
        self.assertEqual(self.s["walled"], [False] * 5)

    def test_a_knife_kill_still_gets_room_to_see_both_men(self) -> None:
        self.assertTrue(all(d >= 2.5 for d in self.s["knife"]))

    def test_helpers(self) -> None:
        self.assertEqual(self.s["clear"], [True, False])
        self.assertEqual(self.s["angle"][0], {"pos": [1, 2, 3], "look": [4, 5, 6], "aim": "lock"})
        self.assertIsNone(self.s["angle"][1])
        self.assertEqual(self.s["styleOf"], ["orbit", "chase", "chase"])


class ClipBarTests(unittest.TestCase):
    """The clip editor's strip (replay-clipbar.js): the stretch of the round it
    spans, its ticks, and the loop's cue."""

    cb: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.cb = run_harness()["clipbar"]

    def test_the_strip_shows_the_clip_with_room_either_side(self) -> None:
        w = self.cb["windows"]
        # 6 s clip: 3.6 s either side; held inside the round at both ends;
        # a long clip gets no more than 10 s.
        self.assertAlmostEqual(w[0]["w0"], 96.4, places=3)
        self.assertAlmostEqual(w[0]["w1"], 109.6, places=3)
        self.assertEqual(w[1]["w0"], 0)
        self.assertEqual(w[2], {"w0": 90, "w1": 150})
        self.assertEqual(w[3]["w1"], 600)

    def test_ticks_thin_out_as_the_strip_grows(self) -> None:
        self.assertEqual(self.cb["steps"], [0.5, 1, 2, 5])

    def test_the_loop_goes_round_only_when_play_crosses_the_out_point(self) -> None:
        # Crossed playing; already past; no last frame; a seek across; short.
        self.assertEqual(self.cb["crossed"], [True, False, False, False, False])

    def test_the_camera_lane_names_each_camera_and_its_hand_over(self) -> None:
        self.assertEqual(self.cb["lane"], [
            ["Your camera", "Push in", "cam:placed", None],
            ["Bullet chase", "automatic", "style:chase", "cut"],
            ["From the victim", "automatic", "style:reverse", "glide"]])
        # Every camera has its glyph; the moves, hand-overs and the tray's too.
        self.assertTrue(self.cb["cameraGlyphs"])
        self.assertEqual(self.cb["icons"], 33)

    def test_a_hand_over_being_dragged_says_what_it_is_kept_at(self) -> None:
        self.assertEqual(self.cb["words"], [
            "On the shot", "0.50 s before the shot", "60% of the way to him", "As the round hits", "0.25 s into the hit",
            "As he goes down", "At this moment of the round", "From the clip's start"])

    def test_export_offers_the_frames_the_recording_crops_to(self) -> None:
        self.assertEqual(self.cb["frames"], ["169", "916", "11", "239", "none"])


class KeyMoveTests(unittest.TestCase):
    """A move on each keyframe (replay-camtrack.js `TrackRig`, KEY_MOVES and
    END_MOVES): A at 10 s 10 m east of the origin, B at 14 s 10 m north, both
    looking at it, the action at the origin, the clip ending at 20 s."""

    km: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.km = run_harness()["keyMoves"]

    def test_a_360_takes_the_long_way_round_and_lands_on_b(self) -> None:
        half, end = self.km["full"]
        # Half way: five eighths of a turn on from A, still 10 m out, facing in.
        self.assertEqual(half, {"pos": [-7.071, 2, 7.071], "facing": 1})
        self.assertEqual(end["pos"], [0, 2, -10])

    def test_a_whip_pan_holds_then_goes_fast(self) -> None:
        held, mid = self.km["whip"]
        self.assertEqual(held["pos"], [10, 2, 0])
        self.assertEqual(mid["pos"], [5, 2, -5])

    def test_moves_from_the_last_keyframe_run_to_the_end_on_the_action(self) -> None:
        self.assertEqual(self.km["spin"], {"pos": [-10, 2, 0], "facing": 1})
        self.assertEqual(self.km["push"], {"pos": [4, 2, 0], "facing": 1})
        self.assertEqual(self.km["pull"], {"pos": [22, 6.5, 0], "facing": 1})
        self.assertEqual(self.km["crane"], {"pos": [10, 11, 0], "facing": 1})
        self.assertEqual(self.km["hold"]["pos"], [10, 2, 0])
        # With no clip end known, it holds.
        self.assertEqual(self.km["noEnd"]["pos"], [10, 2, 0])

    def test_an_end_move_left_on_an_inner_keyframe_glides(self) -> None:
        self.assertEqual(self.km["stale"]["pos"], [5, 2, -5])

    def test_move_names(self) -> None:
        self.assertEqual(self.km["ids"], ["glide", "orbit360", "whip", "crane", "hold", None, None])
        self.assertEqual(self.km["labels"], ["360 round the action", "Whip pan", "Push in", "Glide"])


class TemplateWordsTests(unittest.TestCase):
    def test_templates_the_game_does_not_name_read_as_words(self) -> None:
        self.assertEqual(run_harness()["templateWords"],
                         ["Mustang Bomb", "K98 Sniper", "No4 Sniper", "Bazooka", "MG42", "Panzer IV", "BAR", "SBD Guns"])


class StudioTests(unittest.TestCase):
    """The studio's edits (replay-studio-fx.js, replay-studio.js): a clip
    from 100 s to 108 s, its kill at 104 s, its shot at 103.6 s."""

    st: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.st = run_harness()["studio"]

    def test_fades_title_lower_third_flash_and_tag_over_time(self) -> None:
        a = {round(t * 100): o for t, o in zip([100, 100.5, 100.8, 101.5, 102.5, 103.2, 104, 104.2, 107.75, 108], self.st["at"])}
        # A 1 s fade in from black: all black, half way, gone.
        self.assertEqual(a[10000]["black"], 1)
        self.assertEqual(a[10050]["black"], 0.5)
        self.assertEqual(a[10150]["black"], 0)
        # The title from +0.5 s for 2 s, eased over 0.3 s each way.
        self.assertEqual((a[10050]["title"], a[10080]["title"], a[10250]["title"]), (0, 1, 0))
        # The lower third 0.6 s before the shot (103.0), for 3 s: coming in
        # at 103.2, in by 104.
        self.assertEqual((a[10320]["lower"], a[10400]["lower"]), (0.741, 1))
        # The flash at the kill, gone a fifth of a second on.
        self.assertEqual(a[10400]["white"], 0.85)
        self.assertLess(a[10420]["white"], 0.1)
        # A half-second fade out to black, half way at 107.75.
        self.assertEqual((a[10775]["black"], a[10800]["black"]), (0.5, 1))
        self.assertEqual(a[10400]["tag"], "skandia")

    def test_the_kill_feed_shows_each_kill_for_four_seconds_newest_first(self) -> None:
        f = self.st["feed"]
        # At 100: the kill at 99 still up; at 101.5 it and the new one; at
        # 104.5 the newest first; at 107.9 the last fading out.
        self.assertEqual(f["at"][0], ["E>F:1"])
        self.assertEqual(f["at"][1], ["A>B:1", "E>F:1"])
        self.assertEqual(f["at"][2], ["C>D:1", "A>B:1"])
        self.assertEqual(f["at"][3], ["C>D:0.16"])
        self.assertIsNone(f["off"])
        self.assertTrue(f["shows"])

    def test_the_lower_third_writes_itself_unless_typed(self) -> None:
        self.assertEqual(self.st["lowerLines"], ["Him", "MG 42"])
        self.assertEqual(self.st["typed"], ["My words"])

    def test_zoom_punch_and_shake_on_the_kill(self) -> None:
        self.assertEqual(self.st["punch"], [1, 1, 0.87, 0.74, 0.904, 1])
        self.assertEqual(self.st["shake"], [None, "on", None])
        self.assertEqual(self.st["noPunch"], 1)

    def test_edits_read_back_are_checked(self) -> None:
        c = self.st["clean"]
        self.assertEqual((c["grade"], c["vignette"], c["fadeIn"], c["freeze"]), ("none", 1, 0, 0))
        self.assertEqual(c["title"]["text"], "")
        self.assertNotIn("extra", c)
        self.assertEqual(self.st["shows"], [False, True, False])
        self.assertEqual(self.st["grades"], ["none", "cinematic", "warm", "cold", "bleach", "vivid", "bw", "night"])

    def test_a_recipe_sets_its_look_and_keeps_the_clips_words(self) -> None:
        r = self.st["recipe"]
        self.assertEqual((r["grade"], r["flash"], r["title"]), ("vivid", True, False))
        self.assertEqual(r["lower"], {"on": True, "text": "Mine", "t": 1, "dur": 3})
        self.assertEqual(self.st["cinemaTitle"], "Kill of the round")

    def test_the_monitor_takes_the_frames_shape(self) -> None:
        b = self.st["boxes"]
        self.assertEqual(b[0], {"x": 10, "y": 89, "w": 1000, "h": 562})
        self.assertEqual(b[1], {"x": 314, "y": 20, "w": 393, "h": 700})
        self.assertEqual(b[2], {"x": 10, "y": 170, "w": 600, "h": 600})
        self.assertEqual(b[3], {"x": 10, "y": 20, "w": 800, "h": 600})


class CutsTests(unittest.TestCase):
    """The clip's cameras (replay-cuts.js): a kill shot at 10 s whose round
    lands at 10.2 s, the man down at 11 s, in a clip 7 to 15 s."""

    c: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.c = run_harness()["cuts"]

    def test_a_kill_shot_opens_on_three_cameras(self) -> None:
        d = self.c["defaults"]
        self.assertEqual(d["take"], [
            ["shoulder", None, None], ["chase", {"ev": "shot", "dt": 0}, "cut"], ["victim", {"ev": "down", "dt": 0}, "glide"]])
        self.assertEqual(d["plain"], ["free"])
        # A kill shot that killed nobody has no man to circle.
        self.assertEqual(d["noVictim"], ["shoulder", "chase"])
        self.assertEqual(self.c["resolved"], [["shoulder", 7, 10], ["chase", 10, 11], ["victim", 11, 15]])

    def test_a_hand_over_is_kept_by_what_it_happens_at(self) -> None:
        self.assertEqual(self.c["times"], [9, 10.1, 10.5, 11.5, 8, 7])
        self.assertEqual(self.c["anchors"], [
            ["shot", -1], ["shot", 0], ["flight", 0.25], ["hit", 0], ["hit", 0.3], ["down", 0], ["down", 1]])
        # A clip with no take keeps the round's own clock: a trim moves nothing.
        self.assertEqual(self.c["plainAnchor"], {"ev": "time", "t": 9})

    def test_from_the_victim_dropped_mid_flight_cuts_the_chase_there(self) -> None:
        self.assertEqual(self.c["inserted"], [["shoulder", 7, 10], ["chase", 10, 10.12], ["incoming", 10.12, 11], ["victim", 11, 15]])
        self.assertEqual(self.c["insertedAt"], ["flight", 0.6])
        # Dropped on a hand-over, the camera there is swapped instead.
        self.assertEqual(self.c["swapped"], ["shoulder", "orbit", "victim"])

    def test_cameras_are_taken_away_moved_and_hand_over_their_way(self) -> None:
        self.assertEqual(self.c["removedFirst"], [["chase", None], ["victim", {"ev": "down", "dt": 0}]])
        self.assertEqual(self.c["removedMid"], [["shoulder", 7, 11], ["victim", 11, 15]])
        self.assertEqual(self.c["last"], 1)
        # Before the shot, half way through the flight, and held short of the next.
        self.assertEqual(self.c["moved"], [["shot", -0.6], ["flight", 0.5], ["hit", 0.78]])
        self.assertEqual(self.c["handOver"], "whip")
        self.assertEqual(self.c["placed"], {"cam": "placed", "view": {"pos": [1, 2, 3], "quat": [0, 0, 0, 1], "fov": 40}, "motion": "push"})

    def test_cameras_read_back_are_checked(self) -> None:
        r = self.c["read"]
        self.assertEqual(r[0], [{"cam": "chase"}, {"cam": "victim", "at": {"ev": "down", "dt": 0}, "into": "cut"}])
        self.assertIsNone(r[1])
        self.assertEqual(r[2], [{"cam": "free"}])
        self.assertIsNone(r[3])
        self.assertEqual(r[4], [{"cam": "chase"}])
        self.assertEqual(self.c["usable"], [9, ["placed", "free"], False])
        self.assertTrue(all(ok for _, ok in self.c["recipes"]))

    def test_keyframes_kept_before_cameras_become_cameras(self) -> None:
        # A lead-in keyframe pushing in, the chase, a lead-out keyframe craning
        # up: the man circled no more, the lead-out was the keyframe's.
        self.assertEqual(self.c["keys"], [
            ["shoulder", None, None], ["placed", "push", "glide"], ["chase", None, "cut"], ["placed", "crane", "glide"]])

    def test_your_camera_moves_to_its_end_camera(self) -> None:
        e = self.c["ends"]
        self.assertEqual(e["withEnd"], {
            "cam": "placed", "view": {"pos": [0, 0, 0], "quat": [0, 0, 0, 1]}, "motion": "still",
            "end": {"pos": [10, 0, 0], "quat": [0, 0, 0, 1], "fov": 40}, "move": "orbit"})
        # Its end camera taken away, and gone with it when it is swapped.
        self.assertNotIn("end", e["noEnd"])
        self.assertNotIn("move", e["noEnd"])
        self.assertEqual(e["swapped"], {"cam": "chase"})
        # Read back: a move it does not know is a glide; a broken end camera
        # leaves a camera that holds.
        self.assertEqual(e["read"][0]["move"], "glide")
        self.assertNotIn("end", e["read"][1])
        # A new camera glides in, but into his eyes it cuts.
        self.assertEqual(e["intos"], ["glide", "glide", "cut", "glide"])


class ClipClockTests(unittest.TestCase):
    """The clip as it plays (replay-clipclock.js): 100 to 108 s, a round
    leaving at 103 s and landing 0.1 s later 70 m off, strong bullet time."""

    k: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.k = run_harness()["clock"]

    def test_the_clocks_speed_as_the_clip_plays_it(self) -> None:
        # Normal speed, the flight's bullet time (0.1 s over 2.5 s), the
        # hold, outside the clip, and a freeze no speed of its own.
        s = self.k["speedAt"]
        self.assertEqual(s[0], 1)
        self.assertAlmostEqual(s[1], 0.04, places=2)
        self.assertEqual(s[2], 0.35)
        self.assertEqual(s[3], 1)
        self.assertGreater(s[4], 0.01)

    def test_a_clip_with_nothing_to_slow_it_is_the_rounds_own_seconds(self) -> None:
        self.assertEqual(self.k["plain"], [8, 4, 104, -1, 10, None])

    def test_bullet_time_lays_the_flight_out_as_it_plays(self) -> None:
        # Normal speed until it slows for the trigger; the flight the preset's
        # 2.5 s of video; the hold until he is down; 13 s of video in all.
        self.assertEqual(self.k["lead"], 2.5)
        self.assertEqual(self.k["flight"], 2.49)
        self.assertEqual(self.k["hold"], 2.4)
        self.assertEqual(self.k["down"], 103.9)
        self.assertEqual(self.k["turnHold"], 2.4)
        self.assertEqual(self.k["length"], 13.03)
        self.assertTrue(self.k["monotone"])
        self.assertEqual(self.k["inverse"], [100.5, 103.05, 103.5, 107])

    def test_with_bullet_time_off_or_slow_motion_of_its_own(self) -> None:
        self.assertEqual((self.k["offFlight"], self.k["offDown"]), (0.1, 104.51))
        # The clip's own slow motion runs the clock: the flight is the round's.
        self.assertEqual(self.k["own"], {"flight": 0.1, "slow": 6.59})

    def test_the_freeze_is_seconds_of_video_at_one_moment(self) -> None:
        self.assertEqual(self.k["frozen"], [1, 103.1])


class CutRigTests(unittest.TestCase):
    """The clip's cameras as a rig (replay-camtrack.js `CutRig`): your camera
    from 7 s, the chase from the shot at 10 s, From the victim 60% of the way,
    Circle the victim once he is down at 11 s. The round cam places each style
    at its own x (y 1), the stand-in at the same x (y 2)."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()["cutRig"]

    def test_paused_or_scrubbed_each_camera_films_its_stretch(self) -> None:
        self.assertEqual(self.r["scrub"], [
            ["placed", 5, 5], ["chase", 100, 2], ["incoming", 400, 2], ["incoming", 400, 2], ["victim", 5.17, 1.4]])

    def test_played_the_hand_overs_follow_the_pages_round(self) -> None:
        # From the victim the frame the round is 60% along; the circle not
        # while the page's round is still held, though the laid-out man down
        # has passed; then on the frame it lets go.
        self.assertEqual(self.r["play"], [
            ["placed", 5, 5], ["chase", 100, 1], ["chase", 100, 1], ["incoming", 400, 1], ["incoming", 400, 1],
            ["incoming", 400, 1], ["incoming", 400, 1], ["victim", 4.52, 1.4]])
        self.assertEqual(self.r["fromReset"], 0)
        # Down when the page's round cam lets go, before the laid-out 11 s.
        self.assertEqual([f[0] for f in self.r["letGo"]], ["chase", "incoming", "victim"])

    def test_a_glide_takes_its_seconds_from_where_it_took_over(self) -> None:
        self.assertEqual(self.r["glide"], [4, 4, 52, 100])

    def test_his_eyes_are_the_pages_and_hand_over_from_where_they_left_it(self) -> None:
        self.assertEqual(self.r["eyes"], [["eyes", None, None], ["chase", 7, 7], ["chase", 53.5, 4]])
        # With no eyes to look through: over his shoulder.
        self.assertEqual(self.r["noEyes"], ["eyes", 100, 2])

    def test_your_cameras_moves(self) -> None:
        # Following the action from the framing kept: the action 3 m to the
        # left at the start, at the middle at 10 s, the camera turned 16.7 deg.
        self.assertEqual(self.r["track"], [0, -16.7])
        # A push in over the camera's stretch, in seconds of the video.
        self.assertEqual(self.r["push"], [10, -8, -26])
        self.assertEqual(self.r["lens"], 30)

    def test_your_camera_moves_from_its_camera_to_its_end_camera(self) -> None:
        # Over its part in seconds of the video, the lens with it.
        self.assertEqual(self.r["abMove"], [[0, 60], [5, 45], [10, 30]])

    def test_circle_the_victim_starts_off_the_rounds_line(self) -> None:
        self.assertEqual(self.r["circle"], [4.308, 1.4, -46.581])

    def test_drags_swing_round_cameras_only(self) -> None:
        self.assertEqual((self.r["dragRound"], self.r["near"], self.r["dragYours"]), ("live", 0.1, True))


class MoveTests(unittest.TestCase):
    """The camera from view A to view B (replay-camtrack.js `TrackRig`): A at
    10 s 10 m east of the origin, B at 14 s 10 m north, both looking at it."""

    m: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.m = run_harness()["move"]

    def test_every_way_holds_a_before_and_b_after(self) -> None:
        for name in ("glide", "orbit"):
            first, last = self.m[name][0], self.m[name][-1]
            self.assertEqual(first["pos"], [10, 2, 0], name)
            self.assertEqual(last["pos"], [0, 2, -10], name)

    def test_the_glide_goes_straight_across(self) -> None:
        mid = self.m["glide"][1]
        self.assertEqual(mid["pos"], [5, 2, -5])
        self.assertAlmostEqual(mid["dist"], 7.07, delta=0.01)

    def test_the_orbit_swings_round_the_action_facing_it(self) -> None:
        for p in self.m["orbit"]:
            self.assertAlmostEqual(p["dist"], 10, delta=0.01)
            self.assertGreater(p["facing"], 0.999)
        self.assertAlmostEqual(self.m["orbit"][2]["pos"][0], 7.071, delta=0.01)

    def test_with_no_kill_the_orbit_turns_round_where_a_and_b_look(self) -> None:
        self.assertEqual(self.m["meet"], [0, 2, 0])
        self.assertAlmostEqual(self.m["orbitMeet"]["dist"], 10, delta=0.01)

    def test_the_cut_holds_a_until_b(self) -> None:
        self.assertEqual([p["pos"] for p in self.m["cut"]], [[10, 2, 0], [10, 2, 0], [0, 2, -10]])

    def test_move_style_names(self) -> None:
        self.assertEqual(self.m["styles"], ["glide", "orbit", "cut", "glide", "glide"])
