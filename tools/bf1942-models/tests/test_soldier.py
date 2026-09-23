"""`viewer/soldier.js` under node, against the real `physics.js` and `collision.js`.

Same trick as `test_collision.py` and `test_physics.py`, and for the same
reason: none of the three modules touches a renderer or the DOM, so the camera,
the stances and the capsule arithmetic can be run and asserted here rather than
only in a browser. The collider is the **real** `WorldCollider` over fake meshes
and the body is the real `SoldierBody` — a soldier that slides correctly against
a mock and not against the modules that ship would be worth nothing.

`soldier_harness.mjs` builds a 64 m world with a ramp, a 70-degree face, a wall,
two kerbs, a low beam and a platform, walks a soldier at each of them, and
prints one JSON blob.

**The numbers here are the retail client's**, recorded in
`features/bf1942-engine-reference/symbols.json` under subsystem `physics` and
asserted at the source in `test_physics.py`. They are re-asserted here because
they arrive through a presentation layer, and a presentation layer is exactly
the thing that can quietly reintroduce a speed of its own. If one of them
changes, either the binary was re-read or somebody has guessed.

Node reads a bare `.js` as CommonJS, so the run gets a `package.json` declaring
`"type": "module"` and the three modules are copied in under their real names —
`soldier.js` imports `./physics.js` by that name, so renaming them to `.mjs` (as
this file used to) would break the import.
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
MODULES = [
    ROOT / "viewer" / "soldier.js",
    ROOT / "viewer" / "physics.js",
    ROOT / "viewer" / "soldier-pose.js",
    ROOT / "viewer" / "soldier-locomotion.js",
    ROOT / "viewer" / "point-body.js",
    ROOT / "viewer" / "fixed-step.js",
    ROOT / "viewer" / "parachute.js",
    ROOT / "viewer" / "swim.js",
    ROOT / "viewer" / "collision.js",
    ROOT / "viewer" / "world-collider.js",
    ROOT / "viewer" / "static-index.js",
    ROOT / "viewer" / "drivable-mask.js",
    ROOT / "viewer" / "collision-materials.js",
    ROOT / "viewer" / "heightfield.js",
    ROOT / "viewer" / "spawn-safety.js",
]
HARNESS = Path(__file__).resolve().parent / "soldier_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for module in MODULES:
            shutil.copyfile(module, work / module.name)
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
        # `setPoseCameraPos` 0.65 / 0.12 / -0.70 against a soldier origin that
        # `setCharacterHeight -1.00` puts one metre above the feet.
        self.assertAlmostEqual(1.65, eye["stand"], places=6)
        self.assertAlmostEqual(1.12, eye["crouch"], places=6)
        self.assertAlmostEqual(0.30, eye["prone"], places=6)
        # The deltas are what `setPoseCameraPos` states outright, and they
        # survive whatever the origin turns out to be: crouch 0.53 m below
        # standing and prone 1.35 m below it.
        self.assertAlmostEqual(0.53, eye["stand"] - eye["crouch"], places=6)
        self.assertAlmostEqual(1.35, eye["stand"] - eye["prone"], places=6)

    def test_the_speeds_are_the_engines_tables_and_not_a_stride_derivation(self) -> None:
        # The two float tables at 0x009581b4 and 0x009581cc, arriving through
        # `soldier.js` rather than read off `physics.js` directly. An earlier
        # draft of this module derived 2.28 / 1.08 / 1.58 / 0.69 m/s from
        # footstep frequencies times measured stride lengths; every one of them
        # was between two and three times too slow.
        constants = self.results["constants"]
        self.assertEqual([6, 4, 2, 2, 1, 1], constants["directional"])
        self.assertEqual([4, 2, 1], constants["strafe"])
        self.assertAlmostEqual(1 / 3, constants["walkFactor"], places=6)
        self.assertEqual(
            {"run": 6, "walk": 2, "crouch": 2, "prone": 1, "stand": 0},
            constants["gaitSpeed"])
        # Shift is `walkSpeedFactor` on the run, not a fourth table entry.
        self.assertAlmostEqual(constants["gaitSpeed"]["run"] * constants["walkFactor"],
                               constants["gaitSpeed"]["walk"], places=6)

    def test_gravity_arrives_unchanged_through_the_presentation_layer(self) -> None:
        # The single most load-bearing number in the module, and the one a
        # camera layer has no business restating. -14.73 is the
        # `BasicPhysicsSystem` constructor at 0x00578f00.
        self.assertEqual(-14.73, self.results["constants"]["gravity"])

    def test_the_declared_look_clamp_and_fov(self) -> None:
        constants = self.results["constants"]
        self.assertEqual(38, constants["pitchLimitDeg"])
        # `renderer.fieldOfView 1`: the whole vertical angle, one radian.
        # `set1pFov 0.47` is the first-person parts' own draw FOV, not the
        # camera's (soldier.js `FOV_DEG`, corpus rows VIEW-3..VIEW-8).
        self.assertAlmostEqual(180 / math.pi, constants["fovDeg"], places=1)

    def test_the_capsule_and_step_are_the_bodys(self) -> None:
        constants = self.results["constants"]
        self.assertEqual(0.3, constants["radius"])
        self.assertEqual(0.45, constants["stepHeight"])
        # `MAX_GROUND_SLOPE` is cos(60 degrees) and is deliberately permissive:
        # BF1942 infantry climb dunes no modern shooter would allow.
        self.assertAlmostEqual(60.0, constants["maxSlopeDeg"], places=6)

    # -- stances ------------------------------------------------------------ #

    def test_a_spawned_soldier_lands_on_the_ground_standing(self) -> None:
        spawn = self.results["spawnSettles"]
        self.assertTrue(spawn["grounded"])
        self.assertAlmostEqual(0.0, spawn["y"], places=3)
        self.assertAlmostEqual(1.65, spawn["eyeY"], places=3)

    def test_crouch_and_prone_reach_their_declared_eye_heights(self) -> None:
        self.assertAlmostEqual(1.12, self.results["crouchEye"], places=3)
        self.assertAlmostEqual(0.30, self.results["proneEye"], places=3)
        self.assertAlmostEqual(1.65, self.results["standEye"], places=3)

    def test_stance_transitions_take_the_time_the_clips_declare(self) -> None:
        # `Lb_CrouchToLie` is 9 frames at 1.6x = 216 ms = 13 frames at 60 Hz;
        # `Lb_LieToStand` is 9 frames at -3.0x = 115 ms = 7 frames. The easing
        # itself lives in `SoldierBody`; these durations are what `soldier.js`
        # hands it, which is the whole of the arrangement being checked here.
        self.assertEqual(13, self.results["crouchToProneFrames"])
        self.assertEqual(7, self.results["proneToStandFrames"])
        self.assertTrue(self.results["proneEaseMonotonic"])
        transition = self.results["constants"]["stanceTransition"]
        self.assertAlmostEqual(0.216, transition["crouch>prone"], places=6)
        self.assertAlmostEqual(0.115, transition["prone>stand"], places=6)

    # -- movement ----------------------------------------------------------- #

    def test_one_second_of_each_gait_covers_its_table_speed(self) -> None:
        # Measured through `Soldier.step`, over real ground, against a real
        # collider — not read back off a constant. Two corrections, both real
        # and both shipped: the soldier's own `drag 1.0` eats the third
        # decimal, and PHY-6's movement ramp eats the first 0.098 s of every
        # standing start, so a "second" of run is 0.902 s of it.
        travel = self.results["travel"]
        clear = 1.0 - self.results["rampDeficitSeconds"]
        for gait, table in (("run", 6.0), ("back", 4.0), ("walk", 2.0),
                            ("crouch", 2.0), ("prone", 1.0),
                            ("strafe", 4.0), ("crouchStrafe", 2.0)):
            self.assertAlmostEqual(table * clear, travel[gait], places=2, msg=gait)

    def test_dropping_prone_at_a_run_slides_the_length_of_the_dive_clip(self) -> None:
        # PHY-7. `Lb_RunStandToLie` is the state a soldier enters when he
        # presses Z while not moving backward, and it declares
        # `setSpeed 6.0 1.0 1.0` against a prone table of 1 m/s — a full
        # standing run — for the length of `3PJump2LieLower.baf` (11 frames at
        # 1.5x = 0.282 s). That is BF1942's prone slide: about 1.7 m.
        dive = self.results["proneDive"]
        self.assertEqual(6, dive["factor"])
        self.assertAlmostEqual(11 / (26 * 1.5), dive["duration"], places=6)
        self.assertAlmostEqual(1.70, dive["slide"], places=2)
        # The same span of frames once `addTransitionWhenDone Lb_Lie` has
        # handed over: the 1 m/s crawl, six times shorter.
        self.assertAlmostEqual(6.0, dive["slide"] / dive["crawl"], places=2)

    def test_the_other_two_routes_to_the_floor_do_not_slide(self) -> None:
        # The branch is in `handlePlayerInput`: the forward input times the
        # current state's own forward speed, tested for sign. Backing up gives
        # `Lb_StandToLie` and a crouch gives `Lb_CrouchToLie`, and both declare
        # `setSpeed 1.0 1.0 1.0` — so both cover a plain crawl and nothing more.
        dive = self.results["proneDive"]
        self.assertAlmostEqual(dive["crawl"], dive["backwardSlide"], places=6)
        self.assertAlmostEqual(dive["crawl"], dive["fromCrouchSlide"], places=6)

    def test_a_second_at_cruise_is_the_table_speed_exactly(self) -> None:
        # The same second once the ramp has saturated: no deficit, just drag.
        self.assertAlmostEqual(6.0, self.results["travelCruising"], places=2)

    def test_the_backpedal_is_two_thirds_of_the_run(self) -> None:
        # The most visible single consequence of the real table, and the easiest
        # thing to notice walking the map: `directionalSpeed` is indexed
        # `pose * 2 + (forwardInput <= 0)`, so standing forward is 6 and
        # standing anything-else is 4. Any speed model derived from stride
        # length has one number per gait and cannot produce this ratio at all.
        travel = self.results["travel"]
        self.assertAlmostEqual(6 / 4, travel["run"] / travel["back"], places=3)

    def test_the_reported_speed_is_the_bodys_ground_speed(self) -> None:
        # The HUD number has to come off the integrator, not off a distance
        # divided by a frame time — they agree on flat ground and diverge the
        # moment anything is in the way, and only one of them is the truth.
        reported = self.results["reportedSpeed"]
        self.assertAlmostEqual(6.0, reported["speed"], places=2)
        self.assertEqual("run", reported["gait"])

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
        # Free ground would have carried him 18 m past the face at x = 10 in the
        # three seconds this runs. The gap is the capsule's own 0.30 m radius
        # plus at most the 0.01 m skin: the sweep stops the body a skin short of
        # contact, and a tick whose whole travel would land inside the skin is
        # refused outright rather than taken, so the body settles somewhere in
        # that centimetre depending on where its 0.1 m steps happen to fall.
        self.assertGreaterEqual(wall["gap"], 0.30)
        self.assertLessEqual(wall["gap"], 0.32)
        self.assertLess(wall["x"], 9.70)

    def test_a_diagonal_run_into_a_wall_slides_along_it(self) -> None:
        slide = self.results["slide"]
        self.assertTrue(slide["blocked"])
        self.assertGreaterEqual(10 - slide["x"], 0.30)
        self.assertLessEqual(10 - slide["x"], 0.32)
        # The into-wall component is removed and the along-wall one survives at
        # full speed: 6 / sqrt(2) = 4.24 m/s for three seconds, less the
        # movement ramp's own 0.098 s of standing start, is 12.3 m.
        clear = 3.0 - self.results["rampDeficitSeconds"]
        self.assertAlmostEqual(slide["alongSpeed"] * clear, slide["movedAlong"],
                               delta=0.05)

    def test_a_kerb_under_the_step_height_is_climbed(self) -> None:
        step = self.results["stepUp"]
        self.assertAlmostEqual(0.30, step["peakY"], places=3)
        # The kerb's near face is at x = 13 and a run frame is 0.1 m, so he is
        # on top of it within one frame of reaching it.
        self.assertAlmostEqual(13.0, step["climbedAt"], delta=0.15)
        # And steps down off the far side again, which is why the end is 0.
        self.assertAlmostEqual(0.0, step["endY"], places=3)

    def test_a_kerb_over_the_step_height_is_refused(self) -> None:
        step = self.results["stepRefused"]
        self.assertTrue(step["blocked"])
        self.assertAlmostEqual(0.0, step["peakY"], places=3)
        self.assertLess(step["x"], 16.0)           # stopped in front of it

    def test_a_walkable_slope_is_climbed_and_the_feet_follow_it(self) -> None:
        ramp = self.results["rampClimb"]
        # A hundred frames of run from x = 21 is 10 m, less the movement
        # ramp's 0.59 m of standing start — still on the 20-degree ramp (it
        # spans x 20..32), which is what the test is about.
        clear = 100 / 60 - self.results["rampDeficitSeconds"]
        self.assertAlmostEqual(21.0 + 6.0 * clear, ramp["x"], delta=0.1)
        self.assertAlmostEqual(ramp["expected"], ramp["y"], places=3)

    def test_a_slope_past_the_limit_is_refused(self) -> None:
        cliff = self.results["cliffRefused"]
        self.assertTrue(cliff["blocked"])
        # The 70-degree face starts at x = 40 and rises to 26.4 m. Five seconds
        # of held forward gains him one metre of it and then nothing: the
        # collider's normal is a central difference over +-4 m, so the lattice
        # rounds the lip of the face off over about a metre and the slope test
        # only bites once the smoothed normal passes the limit. He is stopped
        # at the foot either way, which is the behaviour that matters.
        self.assertLess(cliff["x"], 42.0)
        self.assertLess(cliff["y"], 8.0)
        self.assertGreater(cliff["y"], cliff["rampTop"] - 0.1)

    def test_walking_off_a_ledge_falls(self) -> None:
        ledge = self.results["ledge"]
        self.assertAlmostEqual(4.0, ledge["fell"], places=2)
        self.assertTrue(ledge["grounded"])         # and lands
        # This is the gravity test that needs no instrumentation: a 4 m drop is
        # sqrt(2h/g) = 0.737 s under -14.73 and 0.903 s under -9.81, which is 44
        # frames against 54. There is no tolerance that covers both.
        self.assertAlmostEqual(ledge["predictedFrames"], ledge["airborneFrames"],
                               delta=2)
        self.assertLess(ledge["airborneFrames"], 50)

    def test_a_held_space_jumps_exactly_once(self) -> None:
        # The game jumps on the press edge only — landing with Space still
        # down never rebounds. An earlier build re-latched every frame and
        # the soldier bounced whenever the key was held.
        held = self.results["heldJump"]
        self.assertEqual(1, held["heldLiftoffs"])
        self.assertTrue(held["rearmed"])

    def test_the_jump_arc_is_the_engines_gravity(self) -> None:
        jump = self.results["jump"]
        # PHY-1: the take-off is a read 6.0 m/s impulse, not a tunable. What is
        # asserted here is the arc it produces under *this* gravity — 1.17 m at
        # the viewer's 60 Hz, where Earth's would give 1.83 m. The engine's own
        # 30 Hz figure (1.12 m) is pinned in `test_physics.py`, which can step
        # the body at an arbitrary rate; this one rides `Soldier.step`.
        self.assertAlmostEqual(1.166, jump["apex"], delta=0.02)
        self.assertLess(jump["apex"], jump["underEarthGravity"] - 0.4)
        # And short of the continuum answer, because four sub-steps are not
        # calculus.
        self.assertLess(jump["apex"], jump["predicted"])
        self.assertTrue(jump["landed"])

    def test_the_jump_is_the_same_on_a_phone_and_a_144hz_monitor(self) -> None:
        # `Soldier.step` takes a frame dt and spends it through a `FixedStep`
        # accumulator running whole 60 Hz ticks, so the sim is the frame
        # rate's business only in how often it is *sampled*. Four rates, one
        # apex. (Retail is not like this: `Setup::mainLoop` integrates with the
        # measured elapsed time — see the harness comment. The divergence is
        # deliberate and is what makes a recorded input stream replayable.)
        runs = {r["fps"]: r for r in self.results["frameRateJump"]}
        self.assertEqual({30, 60, 144, 23.7}, set(runs))
        apexes = [r["apex"] for r in runs.values()]
        self.assertAlmostEqual(min(apexes), max(apexes), places=2)
        # 30, 60 and 144 all land whole ticks on frame boundaries, so those
        # three are exact rather than merely close.
        self.assertEqual(runs[30]["apex"], runs[60]["apex"])
        self.assertEqual(runs[60]["apex"], runs[144]["apex"])
        for fps, run in runs.items():
            self.assertTrue(run["landed"], msg=str(fps))
            self.assertAlmostEqual(0.0, run["y"], places=6, msg=str(fps))
            self.assertAlmostEqual(0.79, run["airTime"], delta=0.04, msg=str(fps))

    def test_a_fall_is_billed_the_same_at_any_frame_rate(self) -> None:
        # Stronger than the jump, and it has to be: the landing happens on one
        # particular tick whatever the frames around it were, so every number
        # `fall-damage.js` is fed must be bit-identical. A frame rate that
        # changed the drop or the impact speed would change how much health an
        # 8 m fall costs, which is the most player-visible thing in HP-14.
        runs = self.results["frameRateFall"]
        self.assertEqual(4, len(runs))
        for run in runs:
            self.assertIsNotNone(run)
            self.assertEqual(runs[0]["impactSpeed"], run["impactSpeed"])
            self.assertEqual(runs[0]["fallHeight"], run["fallHeight"])
            self.assertEqual(runs[0]["cosTheta"], run["cosTheta"])
        self.assertAlmostEqual(8.0, runs[0]["fallHeight"], places=6)

    def test_the_movement_ramp_covers_the_same_ground_at_any_frame_rate(self) -> None:
        # PHY-6's register is stepped by `dt`, so a second of held W is a
        # second of held W whether it arrives in 24 frames or 144. The
        # tolerance is one tick of run, which is all the leftover accumulator
        # can ever be worth.
        runs = self.results["frameRateRamp"]
        travelled = [r["travelled"] for r in runs]
        self.assertAlmostEqual(min(travelled), max(travelled), delta=6.0 / 60)
        for run in runs:
            self.assertAlmostEqual(6.0, run["speed"], places=2)

    def test_you_cannot_stand_up_under_a_beam(self) -> None:
        under = self.results["headroom"]
        self.assertEqual("crouch", under["stance"])
        self.assertAlmostEqual(1.12, under["eyeY"], places=3)
        # The same release two metres away does stand up, so it is the beam.
        clear = self.results["headroomClear"]
        self.assertEqual("stand", clear["stance"])
        self.assertAlmostEqual(1.65, clear["eyeY"], places=3)

    # -- `settle`'s upward escape -------------------------------------------- #

    def test_a_spawn_inside_a_hull_is_lifted_onto_the_deck_over_it(self) -> None:
        """`BFSpawnPoint::spawn` (0x08163d70) writes the authored position and
        nothing else; what saves a point authored inside a hull is the ordinary
        contact push -- soldier as the vertex side at weight 1.0 against the
        ship's col1 faces, mass share over 0.95, so he takes the whole
        correction (collision-response.md §5.3-5.4, §6.1). `settle` probes
        downward only, so it stood him on the hold floor under the deck.
        Authored at 8.1 in a hold whose deck is 1.6 m over it: on the deck."""
        self.assertAlmostEqual(9.8, self.results["escapeFromHold"], places=3)

    def test_a_spawn_with_standing_room_is_left_where_it_is(self) -> None:
        """2.4 m under the weather deck is a place a man stands. The escape must
        not turn every sheltered deck -- a carrier's hangar, a boat bay, a
        bunker -- into a lift to the roof."""
        self.assertAlmostEqual(9.8, self.results["escapeStaysOnDeck"], places=3)
        self.assertAlmostEqual(12.4, self.results["escapeOpenDeck"], places=3)

    def test_a_man_under_a_beam_on_open_ground_stays_under_it(self) -> None:
        """The gate: the floor has to be a hull's, not the world's. The engine's
        push-out goes the shortest way out, and for a man standing on the ground
        under a 1.40 m beam that is downward -- it does not lift him onto the
        beam, it refuses to let him stand up, which is the case two tests
        above."""
        self.assertAlmostEqual(0.0, self.results["escapeUnderBeam"], places=3)

    # -- view bob ----------------------------------------------------------- #

    def test_the_shipped_soldier_has_no_walking_bob(self) -> None:
        # The headline. `BFSoldier::updateCameraShake` (0x004facd0) scales the
        # lower body's shake — every Lb_Walk/Run/Crouch/Lie state, i.e. the whole
        # walking bob — by `cameraShakeFactor`, and that global (0x0099000c, in
        # initialized .data) ships as 0.0 with nothing in vanilla setting it.
        # Retail BF1942 does not bob your view when you walk. The amplitudes in
        # `AnimationStatesLower.con` are real and inert.
        shipped = self.results["bobShipped"]
        self.assertEqual(0, shipped["constant"])
        self.assertEqual(0, shipped["factor"])
        for gait in ("run", "walk", "crouch", "prone"):
            with self.subTest(gait=gait):
                self.assertEqual(0, shipped[gait]["upPeak"])
                self.assertEqual(0, shipped[gait]["sidePeak"])
                self.assertEqual(0, shipped[gait]["yawPeak"])

    def test_view_bob_peaks_at_the_declared_amplitude(self) -> None:
        # With the factor turned up the shape underneath must be the game's.
        shape, declared = self.results["bobShape"], self.results["bobDeclared"]
        for gait in ("run", "walk", "crouch", "prone"):
            with self.subTest(gait=gait):
                self.assertAlmostEqual(
                    declared[gait]["up"], shape[gait]["upPeak"], delta=0.002)
        # Crouching and lying declare a vertical bob and nothing else.
        for gait in ("crouch", "prone"):
            with self.subTest(gait=gait):
                self.assertEqual(0, declared[gait]["side"])
                self.assertEqual(0, shape[gait]["sidePeak"])
                self.assertEqual(0, shape[gait]["yawPeak"])

    def test_view_bob_runs_at_the_declared_rate_in_radians_per_second(self) -> None:
        # The whole point of the exercise. `setCameraShakeUpDown 0 0.08 15` is
        # 15 rad/s, which is 2.387 Hz — not 15 Hz, and not a beat of the 0.36 s
        # footstep clock. Reading it as a step-driven phase ran the run bob at
        # 5.56 Hz, which is the "little bobble" this replaced.
        shape, declared = self.results["bobShape"], self.results["bobDeclared"]
        for gait in ("run", "walk", "crouch", "prone"):
            for channel in ("up", "side", "yaw"):
                rate = declared[gait].get(f"{channel}Rate")
                if not rate:
                    continue
                with self.subTest(gait=gait, channel=channel):
                    self.assertAlmostEqual(
                        rate / (2 * math.pi), shape[gait][f"{channel}Hz"],
                        delta=0.02)

    def test_view_bob_does_not_depend_on_ground_speed(self) -> None:
        # `Lb_RunBackward` and `Lb_StrafeLeft/Right` declare exactly what
        # `Lb_RunForward` declares, and the engine has no speed term anywhere in
        # `getCameraShakeTransform`. So a 4 m/s backpedal and a 4 m/s strafe must
        # bob identically to a 6 m/s run — same amplitude AND same rate.
        shape = self.results["bobShape"]
        run = shape["run"]
        self.assertAlmostEqual(6.0, run["speed"], delta=0.02)
        for gait in ("backpedal", "strafe"):
            with self.subTest(gait=gait):
                other = shape[gait]
                self.assertAlmostEqual(4.0, other["speed"], delta=0.02)
                self.assertAlmostEqual(run["upPeak"], other["upPeak"], places=6)
                self.assertAlmostEqual(run["upHz"], other["upHz"], delta=0.01)
                self.assertAlmostEqual(run["yawHz"], other["yawHz"], delta=0.01)

    def test_the_bob_fade_is_a_rate_not_a_duration(self) -> None:
        # `setCameraShakeFadeIn 0 0.6` is 0.6 per second — `fade += fadeIn * dt`
        # clamped to one, at 0x0832bd78 — so a full ramp is 1.67 s, not 0.6.
        fade = self.results["bobFade"]
        self.assertTrue(fade["monotonic"])
        self.assertAlmostEqual(
            fade["expected"], fade["phaseAfterHalfARamp"], delta=0.02)
        self.assertLess(fade["phaseAfterHalfARamp"], 1.0)

    def test_view_bob_stops_dead_when_you_stop(self) -> None:
        # No locomotion state declares `setCameraShakeFadeOut`; entering an idle
        # state that carries no shake zeroes the accumulator on the spot.
        stop = self.results["bobStop"]
        self.assertGreater(stop["movingPeak"], 0)
        self.assertEqual(0, stop["afterOneStillFrame"])
        self.assertEqual(0, self.results["bobShape"]["still"]["upPeak"])

    def test_footsteps_land_on_the_declared_clock(self) -> None:
        steps = self.results["steps"]
        # `setRunFrequency 0.36` over five seconds is 13.9 steps.
        self.assertAlmostEqual(steps["expected"], steps["taken"], delta=1.0)

    # -- cost --------------------------------------------------------------- #

    def test_a_frame_costs_four_collider_queries(self) -> None:
        casts = self.results["casts"]
        # Three sphere sweeps (the capsule, one slide pass) plus the one
        # downward ray that finds the floor. The ray-ring sweep this replaced
        # cost nine rays and a post-move step test: eleven. Being cheaper is not
        # the point — having one resolver is — but it is worth recording.
        self.assertEqual(4, casts["open"])
        self.assertEqual(4, self.results["perFrameCasts"])
        # A blocked frame pays for the extra slide passes, and a corner is the
        # worst of it: four passes of three spheres plus the floor.
        self.assertLessEqual(casts["blocked"], 13)

    def test_a_frame_is_far_inside_the_budget(self) -> None:
        # `projectile-collision.md` measured 1.2-2.1 us per cast and allowed
        # 192 of them a frame. Four of them is not a budget problem, and this
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

    def test_an_ai_only_spawn_is_never_offered_to_a_player(self) -> None:
        # Battle of Britain: "you spawn inside the factory and can't get out".
        # Each radar tower declares its group twice — five `OnlyForHuman`
        # points spread around the building, and ONE `OnlyForAI` point at the
        # building's own origin, indoors under a 2.25 m ceiling. The engine's
        # filter is the whole answer; walking round the pool never reaches it.
        self.assertEqual(["human-1", "human-2", "human-1", "human-2"],
                         self.results["bunkerPicks"])

    def test_a_spawn_inside_geometry_is_walked_past(self) -> None:
        # And the geometry gate behind the filter, for everything a level's
        # own words cannot say: a collider that reports the first human point
        # solid moves the player to the next one.
        self.assertEqual("human-2", self.results["bunkerAvoidsSolid"])

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
        # Far short of a full 6 m in the second, and correctly so: with no
        # world there is no ground and no contact, so PHY-6's gate is open the
        # whole way and the only horizontal drive is the engine's airborne
        # `0.75 * vCmd` acceleration -- 4.5 m/s^2, which from rest is
        # 0.5 * 4.5 * 1^2 = 2.25 m before the movement ramp is charged for.
        self.assertGreater(free["z"], 1.5)
        self.assertLess(free["z"], 2.25)
        # Dropped from y = 10, one second of -14.73 puts him at 2.6 m.
        self.assertAlmostEqual(10 - 0.5 * 14.73, free["y"], delta=0.1)


if __name__ == "__main__":
    unittest.main()
