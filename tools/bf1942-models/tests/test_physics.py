"""`viewer/physics.js` under node: the engine's arithmetic, and a body on it.

Same pattern as `test_collision.py` — the module imports nothing, so node can
run it with no renderer and `physics_harness.mjs` exercises every path and
prints one JSON blob. `collision.js` is copied in alongside it because the
harness builds a real `WorldCollider` to walk against; a fake world would only
test the fake.

The numbers asserted here are the retail client's, recorded in
`features/bf1942-engine-reference/symbols.json` under subsystem `physics`. If
one of them changes, either the binary was re-read or somebody has guessed.
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
MODULES = {
    "physics.mjs": ROOT / "viewer" / "physics.js",
    "collision.mjs": ROOT / "viewer" / "collision.js",
}
HARNESS = Path(__file__).resolve().parent / "physics_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class PhysicsModuleTests(unittest.TestCase):
    """One node run, many assertions — starting the runtime is the slow part."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the constants -----------------------------------------------------

    def test_gravity_is_the_engines_and_not_the_earths(self) -> None:
        # BasicPhysicsSystem ctor, 0x00578f00: 0xC16BAE14. Nothing in vanilla
        # data overrides it, so this is the live value on every map.
        self.assertEqual(-14.73, self.results["constants"]["gravity"])

    def test_one_update_is_four_substeps(self) -> None:
        self.assertEqual(4, self.results["constants"]["subSteps"])

    def test_the_soldier_speed_tables_are_the_ones_in_the_exe(self) -> None:
        constants = self.results["constants"]
        # 0x009581b4 and 0x009581cc, byte-identical to the lnxded copies.
        self.assertEqual([6, 4, 2, 2, 1, 1], constants["directional"])
        self.assertEqual([4, 2, 1], constants["strafe"])
        self.assertAlmostEqual(1 / 3, constants["walkFactor"], places=4)

    def test_the_speed_index_is_pose_times_two_plus_no_forward_input(self) -> None:
        table = self.results["speedTable"]
        self.assertEqual(6, table["standForward"])
        self.assertEqual(4, table["standBack"])
        # The index tests `forwardInput <= 0`, so standing still takes the same
        # slot as walking backwards. That is the table, not a rounding of it.
        self.assertEqual(4, table["standStill"])
        self.assertEqual(2, table["crouchForward"])
        self.assertEqual(2, table["crouchBack"])
        self.assertEqual(1, table["proneForward"])
        self.assertEqual(1, table["proneBack"])

    def test_the_pose_comes_out_of_the_flag_bits(self) -> None:
        poses = self.results["poses"]
        self.assertEqual(0, poses["none"])
        self.assertEqual(1, poses["crouch"])
        self.assertEqual(2, poses["prone"])
        # `(flags & 0x20) ? 1 : (flags & 0x40) >> 5` tests crouch first.
        self.assertEqual(1, poses["both"])

    def test_eye_heights_are_the_pose_camera_offsets_plus_character_height(self) -> None:
        eyes = self.results["constants"]["eyeHeights"]
        self.assertAlmostEqual(1.65, eyes[0], places=6)
        self.assertAlmostEqual(1.12, eyes[1], places=6)
        self.assertAlmostEqual(0.30, eyes[2], places=6)

    # --- the integrator ----------------------------------------------------

    def test_the_integrator_is_four_semi_implicit_substeps(self) -> None:
        # The distinguishing number. Four sub-steps of h = dt/4, each `v += a*h`
        # and then a position advance with the updated v, sum to
        # a*h^2*(1+2+3+4) = 0.625*a*dt^2. One semi-implicit step would give 1.0,
        # one explicit step 0.0, and the exact answer 0.5.
        tick = self.results["oneTick"]
        self.assertAlmostEqual(0.625, tick["ratio"], places=9)
        # Velocity after one tick is still just a*dt — sub-stepping splits the
        # position, not the impulse.
        self.assertAlmostEqual(-14.73 / 60, tick["velocityY"], places=9)

    def test_the_accumulator_is_cleared_and_gravity_reseeded(self) -> None:
        # `updatePhysics` zeroes the accumulator after integrating and then adds
        # exactly one gravity back for the next update. A missing clear shows up
        # as an acceleration that applies forever.
        self.assertAlmostEqual(-14.73, self.results["oneTick"]["accelY"], places=9)
        push = self.results["accelIsSpentOnce"]
        self.assertTrue(push["same"])
        self.assertAlmostEqual(10 / 60, push["after"], places=9)

    def test_a_second_of_free_fall(self) -> None:
        fall = self.results["oneSecond"]
        self.assertAlmostEqual(-14.73, fall["velocityY"], places=6)
        # 0.5*g*t^2 is -7.365; the sub-step bias puts it a few millimetres
        # further, which is the engine's answer rather than the calculus one.
        self.assertAlmostEqual(-7.3957, fall["y"], places=3)

    # --- drag --------------------------------------------------------------

    def test_the_parachute_drag_reproduces_the_shipped_parachute_speed(self) -> None:
        # setParachuteDrag 24 and setParachuteSpeed 30 are two independent lines
        # of CommonSoldierData.inc. `accel -= v * pi * r^2 * drag / mass` turns
        # the first into the second to within 2%, which is the evidence for the
        # shape of the drag equation — and, more weakly, for the bounding radius.
        chute = self.results["parachute"]
        self.assertAlmostEqual(chute["closedForm"], chute["terminal"], places=3)
        self.assertLess(abs(chute["terminal"] - chute["declared"]), 0.6)

    def test_a_soldiers_own_drag_barely_slows_the_fall(self) -> None:
        # drag 1.0 over mass 100 is a terminal velocity of ~730 m/s: a man falls
        # in near-vacuum, which is what the game looks like.
        self.assertGreater(self.results["soldierDragIsNearlyInert"], 14.5)

    def test_drag_is_wind_relative(self) -> None:
        # The part that is not `-drag * v`: a body at rest in a wind is pushed by
        # it. Vanilla wind is zero, so nothing in the viewer sees this, but the
        # term is in the disassembly and so it is here.
        self.assertGreater(self.results["windPushesAStillBody"], 0.05)

    # --- the fixed clock ---------------------------------------------------

    def test_the_clock_runs_whole_ticks_and_keeps_the_remainder(self) -> None:
        clock = self.results["clock"]
        self.assertEqual([1, 0, 1, 6, 12], clock["ticks"])
        self.assertAlmostEqual(0.5, clock["halfAlpha"], places=6)

    def test_a_long_stall_is_dropped_rather_than_owed(self) -> None:
        # A backgrounded tab must not come back and run an hour of ticks. The
        # excess is discarded, so the accumulator is under one tick afterwards.
        clock = self.results["clock"]
        self.assertEqual(12, clock["cappedAt"])
        self.assertGreater(clock["dropped"], 1000)
        self.assertGreaterEqual(clock["accumulator"], 0)
        self.assertLess(clock["accumulator"], 1 / 60)

    # --- the swept sphere --------------------------------------------------

    def test_a_swept_sphere_stops_its_radius_short_of_the_wall(self) -> None:
        sweep = self.results["sweepFace"]
        self.assertIsNotNone(sweep)
        self.assertAlmostEqual(7.5, sweep["t"], places=4)
        self.assertEqual(92, sweep["material"])
        # The normal separates the sphere from the hull.
        self.assertAlmostEqual(-1.0, sweep["nx"], places=5)
        pair = self.results["sweepVsCast"]
        self.assertAlmostEqual(0.5, pair["cast"] - pair["sweep"], places=4)

    def test_the_edge_case_is_the_edge(self) -> None:
        # The centre passes 0.3 m above a 10 m parapet, so the face test misses
        # entirely and only the edge quadratic can catch it. The contact must be
        # on the top edge and the normal must lean up and back.
        edge = self.results["sweepEdge"]
        self.assertIsNotNone(edge)
        self.assertAlmostEqual(10.0, edge["py"], places=4)
        self.assertAlmostEqual(8.0, edge["px"], places=4)
        self.assertAlmostEqual(0.6, edge["ny"], places=4)
        self.assertAlmostEqual(7.6, edge["t"], places=4)

    def test_a_sweep_that_misses_reports_nothing(self) -> None:
        self.assertTrue(self.results["sweepClears"])
        self.assertTrue(self.results["sweepMissesPastTheEnd"])
        self.assertTrue(self.results["sweepBehind"])
        self.assertTrue(self.results["sweepShort"])

    def test_the_sweep_does_not_tunnel_through_a_thin_wall(self) -> None:
        self.assertTrue(self.results["sweepDoesNotTunnel"])

    def test_a_downward_sweep_finds_a_roof(self) -> None:
        roof = self.results["sweepRoof"]
        self.assertIsNotNone(roof)
        self.assertAlmostEqual(3.0, roof["py"], places=4)
        self.assertAlmostEqual(3.5, roof["y"], places=4)   # centre, one radius up
        self.assertAlmostEqual(1.0, roof["ny"], places=5)

    # --- a body that walks -------------------------------------------------

    def test_a_walking_body_moves_at_the_table_speed(self) -> None:
        # A second of held input over flat ground, in metres. The shortfall in
        # the last digit is the soldier's own drag 1.0, which is real.
        speeds = self.results["walkSpeeds"]
        self.assertAlmostEqual(6.0, speeds["standForward"], places=2)
        self.assertAlmostEqual(4.0, speeds["standBack"], places=2)
        self.assertAlmostEqual(4.0, speeds["standStrafe"], places=2)
        self.assertAlmostEqual(2.0, speeds["standWalking"], places=2)
        self.assertAlmostEqual(2.0, speeds["crouchForward"], places=2)
        self.assertAlmostEqual(2.0, speeds["crouchStrafe"], places=2)
        self.assertAlmostEqual(1.0, speeds["proneForward"], places=2)

    def test_a_diagonal_does_not_beat_the_table(self) -> None:
        # Forward 6 and strafe 4 summed would be 7.2 m/s, faster than anything
        # the engine's tables allow. The resultant is capped at the larger.
        self.assertAlmostEqual(6.0, self.results["walkSpeeds"]["diagonal"], places=2)

    def test_the_body_walks_where_it_is_facing(self) -> None:
        # Yaw 0 faces +Z, matching the viewer's own look vector.
        east = self.results["walkHeading"]
        self.assertAlmostEqual(6.0, east["dx"], places=2)
        self.assertAlmostEqual(0.0, east["dz"], places=4)
        south = self.results["walkHeadingPi"]
        self.assertAlmostEqual(0.0, south["dx"], places=4)
        self.assertAlmostEqual(-6.0, south["dz"], places=2)

    def test_a_dropped_body_lands_on_the_heightfield_and_stops(self) -> None:
        landed = self.results["landsOnTerrain"]
        self.assertTrue(landed["grounded"])
        self.assertAlmostEqual(0.0, landed["y"], places=6)
        self.assertEqual(0.0, landed["vy"])

    def test_the_fall_arc_is_the_engines_gravity_and_not_earths(self) -> None:
        # Three samples off a 20 m drop. Under -14.73 the body is 7.4 m down at
        # one second; under -9.81 it would be 4.9 m down, which is 2.5 m of
        # daylight between the two and no tolerance can hide it.
        for sample in self.results["fallArc"]:
            t = sample["t"]
            expected = 20 - 0.5 * 14.73 * t * t
            self.assertLess(abs(sample["y"] - expected), 0.06, sample)

    def test_the_ground_is_the_higher_of_the_terrain_and_the_sea(self) -> None:
        # Requirement in the engine's own terms: `surfaceHeight` is
        # max(heightfield, waterLevel), and the feet follow it.
        sea = self.results["standsOnTheSea"]
        self.assertTrue(sea["grounded"])
        self.assertAlmostEqual(3.0, sea["y"], places=6)

    def test_a_body_stops_at_a_hull(self) -> None:
        # Free ground would have carried it 18 m past the wall.
        wall = self.results["stopsAtTheWall"]
        self.assertGreaterEqual(wall["contacts"], 1)
        self.assertLess(wall["x"], 8.0)
        # Parked one body radius short, to within the skin width.
        self.assertLess(abs(wall["short"]), 0.02)

    def test_a_body_slides_along_a_wall_it_hits_at_an_angle(self) -> None:
        # 45 degrees into a wall at 6 m/s for two seconds: blocked in x, and the
        # along-wall component (6/sqrt(2) = 4.24 m/s) carried it 8.5 m in z.
        slide = self.results["slidesAlongTheWall"]
        self.assertLess(slide["x"], 8.0)
        self.assertAlmostEqual(8.49, slide["movedAlong"], places=1)

    def test_a_body_steps_onto_a_kerb_but_not_over_a_wall(self) -> None:
        kerb = self.results["stepsOntoAKerb"]
        self.assertGreater(kerb["x"], 10.0)
        self.assertAlmostEqual(0.3, kerb["y"], places=3)
        self.assertTrue(kerb["grounded"])
        blocked = self.results["doesNotClimbAWall"]
        self.assertLess(blocked["x"], 8.0)
        self.assertAlmostEqual(0.0, blocked["y"], places=6)

    def test_a_jump_leaves_the_ground_and_comes_back(self) -> None:
        # The jump *speed* is a tunable and is labelled as one in the module.
        # What is asserted here is that the arc it produces is the arc this
        # gravity gives it, which is the part that is not a guess.
        jump = self.results["jump"]
        self.assertGreater(jump["apex"], 0.5)
        self.assertLess(abs(jump["apex"] - jump["predicted"]), 0.05)
        self.assertGreater(jump["airborne"], 30)
        self.assertTrue(jump["landed"])
        self.assertAlmostEqual(0.0, jump["y"], places=6)

    def test_a_prone_body_does_not_jump(self) -> None:
        self.assertTrue(self.results["proneDoesNotJump"])

    def test_the_eye_animates_between_poses(self) -> None:
        eye = self.results["eye"]
        self.assertAlmostEqual(1.65, eye["standing"], places=6)
        # One tick after ducking it is on its way, not already there.
        self.assertLess(eye["afterOneTick"], 1.65)
        self.assertGreater(eye["afterOneTick"], 1.12)
        self.assertAlmostEqual(1.12, eye["crouched"], places=3)
        # `eye()` is the world position, which over flat ground at y = 0 is the
        # same number.
        self.assertAlmostEqual(eye["crouched"], eye["worldY"], places=6)


if __name__ == "__main__":
    unittest.main()
