"""`viewer/soldier.js` under node, against the real `viewer/collision.js`.

Same trick as `test_collision.py`, and for the same reason: `soldier.js` imports
nothing, so the movement and capsule arithmetic can be run and asserted here
rather than only in a browser. The collider it is given is the **real**
`WorldCollider` over fake meshes, not a stub — a capsule that slides correctly
against a mock and not against the module that ships would be worth nothing.

`soldier_harness.mjs` builds a 64 m world with a ramp, a 60-degree face, a wall,
two kerbs, a low beam and a platform, walks a soldier at each of them, and
prints one JSON blob. Node reads a bare `.js` as CommonJS, so both modules are
copied next to the harness as `.mjs` for the run; the copies are byte-identical.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
SOLDIER = ROOT / "viewer" / "soldier.js"
COLLISION = ROOT / "viewer" / "collision.js"
HARNESS = Path(__file__).resolve().parent / "soldier_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(SOLDIER, work / "soldier.mjs")
        shutil.copyfile(COLLISION, work / "collision.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierModuleTests(unittest.TestCase):
    """One node run, many assertions — starting the runtime is the slow part."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # -- the numbers the game declares -------------------------------------- #

    def test_eye_heights_are_the_declared_pose_camera_offsets(self) -> None:
        eye = self.results["constants"]["eye"]
        self.assertEqual({"stand": 1.56, "crouch": 1.03, "prone": 0.21}, eye)
        # The deltas are what `setPoseCameraPos` states outright: 0.65 / 0.12 /
        # -0.70 puts crouch 0.53 m below standing and prone 1.35 m below it.
        self.assertAlmostEqual(0.53, eye["stand"] - eye["crouch"], places=6)
        self.assertAlmostEqual(1.35, eye["stand"] - eye["prone"], places=6)

    def test_the_four_derived_speeds(self) -> None:
        speed = self.results["constants"]["speed"]
        self.assertEqual({"run": 2.28, "walk": 1.08, "crouch": 1.58, "prone": 0.69},
                         speed)
        # Each is step length / footstep period, both measured off the archives.
        period = self.results["constants"]["stepPeriod"]
        for gait, step in (("run", 0.821), ("walk", 0.711),
                           ("crouch", 0.790), ("prone", 0.414)):
            self.assertAlmostEqual(step / period[gait], speed[gait], places=2)

    def test_the_declared_look_clamp_and_fov(self) -> None:
        constants = self.results["constants"]
        self.assertEqual(38, constants["pitchLimitDeg"])
        # `set1pFov 0.47` read as a half-angle in radians.
        self.assertAlmostEqual(2 * 0.47 * 180 / math.pi, constants["fovDeg"], places=1)

    def test_the_capsule_and_step_are_the_measured_body(self) -> None:
        constants = self.results["constants"]
        self.assertEqual(0.31, constants["radius"])     # 0.62 m body bbox, halved
        self.assertEqual(0.43, constants["stepUp"])     # knee 0.547 - ankle 0.121
        self.assertEqual(45, constants["maxSlopeDeg"])

    # -- stances ------------------------------------------------------------ #

    def test_a_spawned_soldier_lands_on_the_ground_standing(self) -> None:
        spawn = self.results["spawnSettles"]
        self.assertTrue(spawn["grounded"])
        self.assertAlmostEqual(0.0, spawn["y"], places=3)
        self.assertAlmostEqual(1.56, spawn["eyeY"], places=3)

    def test_crouch_and_prone_reach_their_declared_eye_heights(self) -> None:
        self.assertAlmostEqual(1.03, self.results["crouchEye"], places=3)
        self.assertAlmostEqual(0.21, self.results["proneEye"], places=3)
        self.assertAlmostEqual(1.56, self.results["standEye"], places=3)

    def test_stance_transitions_take_the_time_the_clips_declare(self) -> None:
        # `Lb_CrouchToLie` is 9 frames at 1.6x = 216 ms = 13 frames at 60 Hz;
        # `Lb_LieToStand` is 9 frames at -3.0x = 115 ms = 7 frames.
        self.assertEqual(13, self.results["crouchToProneFrames"])
        self.assertEqual(7, self.results["proneToStandFrames"])
        self.assertTrue(self.results["proneEaseMonotonic"])

    # -- movement ----------------------------------------------------------- #

    def test_one_second_of_each_gait_covers_its_speed(self) -> None:
        travel = self.results["travel"]
        for gait, expected in (("run", 2.28), ("walk", 1.08),
                               ("crouch", 1.58), ("prone", 0.69)):
            self.assertAlmostEqual(expected, travel[gait], places=3, msg=gait)

    def test_shift_is_the_slower_gait_not_a_sprint(self) -> None:
        # `c_PIWalk` is bound to LeftShift and the state machine enters
        # `Lb_WalkForward` from it. BF1942 has no sprint.
        self.assertTrue(self.results["shiftIsSlower"])
        self.assertLess(self.results["travel"]["walk"], self.results["travel"]["run"])

    def test_pitch_clamps_at_38_degrees_and_yaw_does_not(self) -> None:
        look = self.results["look"]
        self.assertAlmostEqual(look["limit"], look["up"], places=6)
        self.assertAlmostEqual(-look["limit"], look["down"], places=6)
        self.assertAlmostEqual(38.0, math.degrees(look["up"]), places=3)
        self.assertGreater(look["yaw"], math.pi)      # free, and unwrapped

    # -- the world stopping him --------------------------------------------- #

    def test_a_wall_stops_the_capsule_at_its_own_radius(self) -> None:
        wall = self.results["wall"]
        self.assertTrue(wall["blocked"])
        # The wall's face is at x = 10; the capsule is 0.31 m and keeps a 2 cm
        # skin, so the body centre may not pass x = 9.67.
        self.assertAlmostEqual(0.31, wall["gap"], places=2)
        self.assertLess(wall["x"], 9.70)

    def test_a_diagonal_run_into_a_wall_slides_along_it(self) -> None:
        slide = self.results["slide"]
        self.assertTrue(slide["blocked"])
        self.assertAlmostEqual(0.31, 10 - slide["x"], places=1)
        # The into-wall component is removed and the along-wall one survives.
        self.assertGreater(slide["movedAlong"], 4.0)

    def test_a_kerb_under_the_step_height_is_climbed(self) -> None:
        step = self.results["stepUp"]
        self.assertAlmostEqual(0.30, step["peakY"], places=3)
        # The kerb's near face is at x = 13; he is on top within a few cm of it.
        self.assertAlmostEqual(13.0, step["climbedAt"], places=1)
        # And steps down off the far side again, which is why the end is 0.
        self.assertAlmostEqual(0.0, step["endY"], places=3)

    def test_a_kerb_over_the_step_height_is_refused(self) -> None:
        step = self.results["stepRefused"]
        self.assertTrue(step["blocked"])
        self.assertAlmostEqual(0.0, step["peakY"], places=3)
        self.assertLess(step["x"], 16.0)           # stopped in front of it

    def test_a_walkable_slope_is_climbed_and_the_feet_follow_it(self) -> None:
        ramp = self.results["rampClimb"]
        self.assertAlmostEqual(32.4, ramp["x"], places=1)     # up the whole ramp
        self.assertAlmostEqual(ramp["expected"], ramp["y"], places=3)

    def test_a_slope_past_the_limit_is_refused(self) -> None:
        cliff = self.results["cliffRefused"]
        self.assertTrue(cliff["blocked"])
        # The 60-degree face starts at x = 40 and he does not get onto it.
        self.assertLess(cliff["x"], 40.1)
        self.assertAlmostEqual(4.37, cliff["y"], places=1)

    def test_walking_off_a_ledge_falls(self) -> None:
        ledge = self.results["ledge"]
        self.assertAlmostEqual(4.0, ledge["fell"], places=2)
        self.assertTrue(ledge["grounded"])         # and lands
        # sqrt(2 * 4 / 9.81) = 0.90 s of airtime, 54 frames at 60 Hz.
        self.assertGreater(ledge["airborneFrames"], 45)
        self.assertLess(ledge["airborneFrames"], 65)

    def test_the_jump_reaches_the_height_its_clip_length_implies(self) -> None:
        jump = self.results["jump"]
        # v^2 / 2g = 0.46 m; Euler integration at 60 Hz undershoots slightly.
        self.assertAlmostEqual(jump["predicted"], jump["apex"], delta=0.04)
        self.assertTrue(jump["landed"])

    def test_you_cannot_stand_up_under_a_beam(self) -> None:
        under = self.results["headroom"]
        self.assertEqual("crouch", under["stance"])
        self.assertAlmostEqual(1.03, under["eyeY"], places=3)
        # The same release two metres away does stand up, so it is the beam.
        clear = self.results["headroomClear"]
        self.assertEqual("stand", clear["stance"])
        self.assertAlmostEqual(1.56, clear["eyeY"], places=3)

    # -- view bob ----------------------------------------------------------- #

    def test_view_bob_peaks_at_the_declared_amplitude(self) -> None:
        bob = self.results["bob"]
        # `setCameraShakeUpDown 0 0.08 15` on Lb_RunForward, `0 0.06 7` on walk.
        self.assertAlmostEqual(bob["declaredRun"], bob["runPeak"], delta=0.002)
        self.assertAlmostEqual(bob["declaredWalk"], bob["walkPeak"], delta=0.002)
        self.assertGreater(bob["runPeak"], bob["walkPeak"])

    def test_view_bob_fades_out_when_you_stop(self) -> None:
        self.assertEqual(0, self.results["bob"]["restPeak"])

    def test_footsteps_land_on_the_declared_clock(self) -> None:
        steps = self.results["steps"]
        # `setRunFrequency 0.36` over five seconds is 13.9 steps.
        self.assertAlmostEqual(steps["expected"], steps["taken"], delta=1.0)

    # -- cost --------------------------------------------------------------- #

    def test_a_frame_costs_about_ten_casts(self) -> None:
        casts = self.results["casts"]
        # Nine sweep probes plus the floor probe; a blocked frame adds the
        # post-move step test and drops a sweep pass.
        self.assertLessEqual(casts["open"], 12)
        self.assertLessEqual(casts["blocked"], 30)
        self.assertEqual(10, self.results["perFrameCasts"])

    def test_a_frame_is_far_inside_the_budget(self) -> None:
        # `projectile-collision.md` measured 1.2-2.1 us per cast and allowed
        # 192 of them a frame. Ten of them is not a budget problem, and this
        # asserts only the order of magnitude so it cannot fail on a slow box.
        self.assertLess(self.results["perFrameMicroseconds"], 200)

    # -- spawning at a flag -------------------------------------------------- #

    def test_flags_join_to_the_spawns_their_group_owns(self) -> None:
        flags = self.results["flags"]
        self.assertEqual(3, len(flags))            # the fourth owns no spawns
        axis = flags[0]
        self.assertEqual("2nd_Panzer_Division_HQ", axis["name"])
        self.assertEqual(1, axis["team"])
        self.assertEqual(1, axis["group"])
        self.assertTrue(axis["uncapturable"])
        self.assertEqual(4, axis["spawns"])
        self.assertEqual([1, 2, 0], [f["team"] for f in flags])

    def test_paratrooper_spawns_are_skipped_both_ways(self) -> None:
        # One is declared `paratrooper`, one is only 160 m above the ground —
        # the fallback for every level extracted before the flag existed.
        self.assertEqual(["a", "b", "a", "b"], self.results["picked"])
        self.assertIn("para", self.results["pickedNames"])
        self.assertIn("legacy-para", self.results["pickedNames"])

    def test_without_a_ground_probe_only_the_declared_flag_filters(self) -> None:
        self.assertEqual("a", self.results["pickedWithoutGround"])

    def test_a_spawn_faces_the_way_it_was_authored(self) -> None:
        yaw = self.results["spawnYaw"]
        # Refractor +Z is forward and the exporter mirrors Z, so the page's own
        # lookVector convention agrees at PI - yaw.
        self.assertAlmostEqual(math.pi, yaw["zero"], places=6)
        self.assertAlmostEqual(math.pi / 2, yaw["ninety"], places=6)
        self.assertAlmostEqual(0.0, yaw["oneEighty"], places=6)
        # yaw 0 must look down -Z, which is where Refractor +Z lands.
        x, z = self.results["spawnForward"]["zero"]
        self.assertAlmostEqual(0.0, x, places=6)
        self.assertAlmostEqual(-1.0, z, places=6)

    # -- degenerate input ---------------------------------------------------- #

    def test_a_soldier_with_no_collider_still_walks_and_falls(self) -> None:
        # A level whose lattice would not rebuild has no collider at all; the
        # page must still be steerable rather than throwing every frame.
        free = self.results["noCollider"]
        self.assertTrue(free["finite"])
        self.assertAlmostEqual(2.28, free["z"], places=2)
        self.assertLess(free["y"], 10)             # gravity still applies


if __name__ == "__main__":
    unittest.main()
