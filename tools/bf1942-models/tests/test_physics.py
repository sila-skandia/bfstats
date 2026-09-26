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
    "walking-body.js": ROOT / "viewer" / "walking-body.js",
    "soldier-resolve.js": ROOT / "viewer" / "soldier-resolve.js",
    "soldier-pose.js": ROOT / "viewer" / "soldier-pose.js",
    "soldier-locomotion.js": ROOT / "viewer" / "soldier-locomotion.js",
    "point-body.js": ROOT / "viewer" / "point-body.js",
    "fixed-step.js": ROOT / "viewer" / "fixed-step.js",
    "world-collider.js": ROOT / "viewer" / "world-collider.js",
    "static-index.js": ROOT / "viewer" / "static-index.js",
    "collision-meshes.js": ROOT / "viewer" / "collision-meshes.js",
    "drivable-mask.js": ROOT / "viewer" / "drivable-mask.js",
    "collision-materials.js": ROOT / "viewer" / "collision-materials.js",
    "heightfield.js": ROOT / "viewer" / "heightfield.js",
    # `physics.js` imports `./parachute.js` by that name, so this one cannot be
    # renamed with the others; the `package.json` below is what lets node read
    # a bare `.js` as a module.
    "parachute.js": ROOT / "viewer" / "parachute.js",
    "swim.js": ROOT / "viewer" / "swim.js",
}
HARNESS = Path(__file__).resolve().parent / "physics_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
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

    def test_a_level_sweep_meets_the_edge_of_an_open_plate(self) -> None:
        # The centre passes 0.1 m above a zero-thickness plate, moving along its
        # plane: no face contact is possible, so the edge has to answer. Touch
        # is where the edge is one radius off: 2 - sqrt(0.3^2 - 0.1^2).
        lip = self.results["sweepPlateEdge"]
        self.assertIsNotNone(lip)
        self.assertAlmostEqual(1.7172, lip["t"], places=4)
        self.assertAlmostEqual(10.0, lip["px"], places=4)
        self.assertAlmostEqual(1.0, lip["py"], places=4)
        self.assertAlmostEqual(-0.9428, lip["nx"], places=4)
        self.assertAlmostEqual(0.3333, lip["ny"], places=4)
        flank = self.results["sweepPlateSide"]
        self.assertIsNotNone(flank)
        self.assertAlmostEqual(1.7172, flank["t"], places=4)
        self.assertAlmostEqual(2.0, flank["pz"], places=4)
        self.assertTrue(self.results["sweepPlateClear"])

    def test_an_edge_the_sphere_already_overlaps_lets_it_go(self) -> None:
        # Stopping it there would freeze a body caught inside a hull, and the
        # quadratic's far root is the sphere coming out, not a contact.
        self.assertTrue(self.results["sweepOverlapLetsGo"])

    def test_a_seam_inside_a_flat_wall_is_not_an_edge(self) -> None:
        seam = self.results["sweepSeam"]
        self.assertTrue(seam["along"])
        self.assertTrue(seam["diagonal"])
        # The wall's own end, walked into along its plane: 2 - sqrt(0.3^2 - 0.25^2).
        self.assertAlmostEqual(1.8342, seam["endOn"], places=4)

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
        # A second of held input over flat ground once the movement ramp has
        # saturated, in metres. The shortfall in the last digit is the
        # soldier's own drag 1.0, which is real.
        speeds = self.results["topSpeeds"]
        self.assertAlmostEqual(6.0, speeds["standForward"], places=2)
        self.assertAlmostEqual(4.0, speeds["standBack"], places=2)
        self.assertAlmostEqual(4.0, speeds["standStrafe"], places=2)
        self.assertAlmostEqual(2.0, speeds["standWalking"], places=2)
        self.assertAlmostEqual(2.0, speeds["crouchForward"], places=2)
        self.assertAlmostEqual(2.0, speeds["crouchStrafe"], places=2)
        self.assertAlmostEqual(1.0, speeds["proneForward"], places=2)

    def test_the_first_second_is_short_by_exactly_the_ramp(self) -> None:
        # PHY-6: a soldier does not reach the table on the frame he presses the
        # key. The register climbs 10 a tick at 60 Hz and clamps at 127, so the
        # first second covers less than the table speed by the area under the
        # ramp -- sum(1 - state_k / 127) ticks' worth of it.
        ramp = self.results["ramp"]
        step = ramp["accel"] * ramp["engineRate"] / 60.0
        deficit_ticks = sum(
            1.0 - min(step * k, ramp["limit"]) / ramp["limit"]
            for k in range(1, 1 + int(self.results["ramp"]["timing"][1]["upTicks"]))
        )
        for key, table in (("standForward", 6.0), ("standBack", 4.0),
                           ("standStrafe", 4.0), ("proneForward", 1.0)):
            first = self.results["walkSpeeds"][key]
            top = self.results["topSpeeds"][key]
            predicted = table * deficit_ticks / 60.0
            self.assertAlmostEqual(predicted, top - first, places=2, msg=key)
            # And it really is a shortfall, not a rounding wobble.
            self.assertLess(first, top, key)

    def test_a_diagonal_does_not_beat_the_table(self) -> None:
        # Forward 6 and strafe 4 summed would be 7.2 m/s, faster than anything
        # the engine's tables allow. The resultant is capped at the larger.
        self.assertAlmostEqual(6.0, self.results["topSpeeds"]["diagonal"], places=2)

    def test_the_body_walks_where_it_is_facing(self) -> None:
        # Yaw 0 faces +Z, matching the viewer's own look vector. The distance
        # is a ramped first second (see the ramp test); the axis is the point.
        forward_first_second = self.results["walkSpeeds"]["standForward"]
        east = self.results["walkHeading"]
        self.assertAlmostEqual(forward_first_second, east["dx"], places=6)
        self.assertAlmostEqual(0.0, east["dz"], places=4)
        south = self.results["walkHeadingPi"]
        self.assertAlmostEqual(0.0, south["dx"], places=4)
        self.assertAlmostEqual(-forward_first_second, south["dz"], places=6)

    # --- the ramp that reaches those tables (PHY-6) ------------------------

    def test_the_ramp_constants_are_the_engines(self) -> None:
        ramp = self.results["ramp"]
        # lnxded 0x0872ee14 and 0x0872ee18, movsx'd by both call sites.
        self.assertEqual(20, ramp["accel"])
        self.assertEqual(12, ramp["decel"])
        self.assertEqual(127, ramp["limit"])
        self.assertEqual(30, ramp["engineRate"])
        self.assertAlmostEqual(1.0 / 127.0, ramp["scale"], places=15)
        # 127/20 and 127/12 ticks at 30 Hz.
        self.assertAlmostEqual(0.2117, ramp["nominalToFull"], places=4)
        self.assertAlmostEqual(0.3528, ramp["nominalToStop"], places=4)

    def test_at_the_engines_own_rate_the_ramp_walks_the_integer_ladder(self) -> None:
        # The whole point of carrying the register as a rate: at dt = 1/30 the
        # float arithmetic has to land on the engine's signed-byte sequence
        # exactly, or the rate scaling is wrong.
        ramp = self.results["ramp"]
        self.assertEqual([20, 40, 60, 80, 100, 120, 127, 127, 127], ramp["up30"])
        self.assertEqual([115, 103, 91, 79, 67, 55, 43, 31, 19, 7, 0, 0],
                         ramp["down30"])

    def test_a_reversal_snaps_the_register_through_zero(self) -> None:
        # `max(min(state, 0) - accel, -127)`: from a saturated +127 one
        # backward tick gives -20, not +107. A reversal costs one ramp-up, not
        # a ramp-down and a ramp-up.
        self.assertEqual(-20, self.results["ramp"]["reversal30"])

    def test_the_ramp_keeps_its_wall_clock_at_every_tick_rate(self) -> None:
        # The discretisation gives with the rate; the time constants must not.
        for timing in self.results["ramp"]["timing"]:
            self.assertAlmostEqual(0.212, timing["up"], delta=0.025, msg=timing)
            self.assertAlmostEqual(0.353, timing["down"], delta=0.015, msg=timing)
        by_rate = {t["rate"]: t for t in self.results["ramp"]["timing"]}
        # At 30 Hz the ladder needs 7 whole ticks up and 11 down.
        self.assertEqual(7, by_rate[30]["upTicks"])
        self.assertEqual(11, by_rate[30]["downTicks"])

    def test_the_table_slot_comes_from_the_ramp_not_the_input(self) -> None:
        # 0x082747e0 `cmp BYTE [ecx+0x58d],0; setle` -- the row is chosen by
        # the register's sign, so releasing W does not drop a still-coasting
        # soldier onto the backward row.
        slots = self.results["rampChoosesTheSlot"]
        self.assertAlmostEqual(6.0, slots["forwardAtFullRamp"], places=6)
        self.assertAlmostEqual(-4.0, slots["backAtFullRamp"], places=6)
        # The register scales the table linearly.
        self.assertAlmostEqual(3.0, slots["forwardAtHalf"], places=6)
        self.assertAlmostEqual(0.0, slots["atZero"], places=6)
        # walkSpeedFactor 1/3, off the same row.
        self.assertAlmostEqual(2.0, slots["walkingAtFull"], places=6)
        # strafeSpeed is indexed by pose alone -- no forward/back row.
        self.assertAlmostEqual(4.0, slots["strafeAtFull"], places=6)

    def test_the_ramp_reads_only_the_sign_of_the_input(self) -> None:
        # There is no analogue term: a quarter-pressed axis ramps at 20 too.
        signs = self.results["rampReadsTheSignOnly"]
        self.assertEqual(signs["full"], signs["quarter"])
        self.assertEqual(-signs["full"], signs["negative"])

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

    def test_a_man_cannot_walk_on_water(self) -> None:
        # This test used to assert the opposite, and the opposite was the bug:
        # `WorldCollider.surfaceHeight` answers max(heightfield, waterLevel) and
        # the feet were settled onto that, so a soldier stood on the sea and
        # could walk out to the horizon. The engine has no such surface for a
        # soldier -- `BFSoldier::updateSwimming` (`0x08282190`) is the only thing
        # that ever puts a soldier's y on the water, and it puts it 0.4 m under.
        #
        # With no swim state injected the surface is simply not a floor, so the
        # body goes through it. Three metres of water over a flat bed at 0:
        sank = self.results["withoutASwimStateHeSinksToTheBed"]
        self.assertAlmostEqual(0.0, sank["y"], places=3)
        self.assertNotAlmostEqual(3.0, sank["y"], places=1)

    def test_deep_enough_water_puts_him_in_the_swim_state(self) -> None:
        swam = self.results["swimsInsteadOfStanding"]
        self.assertTrue(swam["swimming"])
        # `0x082822d4`: the position is written to `surfaceY - 0.4` every tick,
        # so the draft is exact rather than a settle, and he is not `grounded`.
        self.assertAlmostEqual(swam["waterLevel"] - swam["draft"], swam["y"],
                               places=6)
        self.assertFalse(swam["grounded"])

    def test_wading_is_walking_on_the_seabed(self) -> None:
        # 20 cm of water is under `SWIM_ENTER_DEPTH`, so he keeps his feet, keeps
        # the bed's own normal and material, and covers ground.
        waded = self.results["wadesOnTheSeabed"]
        self.assertFalse(waded["swimming"])
        self.assertTrue(waded["grounded"])
        self.assertAlmostEqual(2.8, waded["y"], places=3)
        self.assertGreater(waded["travelled"], 8.0)

    def test_a_swimmer_can_stand_up_in_the_shallows(self) -> None:
        # The ordering trap, and it is the whole reason the swim state is
        # updated AFTER the tick's resolve rather than before it: the pin puts
        # the feet at `surface - 0.4` every tick, so a depth measured before the
        # resolve is always exactly 0.4 and the 0.35 exit test can never fire.
        # `BFSoldier::updateSwimming` runs out of `handleUpdate`, where the
        # seabed has already had its say.
        shallows = self.results["swimsIntoTheShallows"]
        self.assertTrue(shallows["afloat"]["swimming"])
        self.assertAlmostEqual(2.6, shallows["afloat"]["y"], places=6)
        # `Lb_EndSwim` really plays -- it is not skipped straight to standing.
        self.assertTrue(shallows["sawExitClip"])
        ended = shallows["ended"]
        self.assertFalse(ended["swimming"])
        self.assertIsNone(ended["family"])
        self.assertTrue(ended["grounded"])
        self.assertAlmostEqual(2.7, ended["y"], places=3)

    def test_a_swimmer_moves_and_is_slower_than_a_runner(self) -> None:
        # The force is the engine's `5.0 * vCmd` (`0x08274b6f`) and the ceiling is
        # `swim.js`'s `SWIM_SPEED_CEILING_FACTOR`, which is labelled a viewer
        # number there. What is asserted is the shape: he moves, he stays at his
        # draft, and he is slower than the standing table's 6 m/s.
        swim = self.results["swimsForward"]
        self.assertGreater(swim["travelled"], 5.0)
        self.assertLess(swim["speed"], swim["runSpeed"])
        self.assertAlmostEqual(2.6, swim["y"], places=6)
        self.assertEqual("swimForward", swim["family"])

    def test_a_body_stops_at_a_hull(self) -> None:
        # Free ground would have carried it 18 m past the wall.
        wall = self.results["stopsAtTheWall"]
        self.assertGreaterEqual(wall["contacts"], 1)
        self.assertLess(wall["x"], 8.0)
        # Parked one body radius short, to within the skin width.
        self.assertLess(abs(wall["short"]), 0.02)

    def test_a_body_stops_at_the_edge_of_a_plate_it_walks_level_into(self) -> None:
        # An open plate at chest height: the middle sphere meets its edge moving
        # along its plane. Without the edge test he walked on under it.
        plate = self.results["stopsAtThePlateEdge"]
        self.assertGreaterEqual(plate["contacts"], 1)
        self.assertLess(plate["x"], 8.0)
        self.assertGreater(plate["x"], 7.5)

    def test_a_body_slides_along_a_wall_it_hits_at_an_angle(self) -> None:
        # 45 degrees into a wall at 6 m/s for two seconds: blocked in x, and the
        # along-wall component (6/sqrt(2) = 4.24 m/s) carries it up the face.
        # Short of the full 8.49 m by the movement ramp's first 0.22 s.
        slide = self.results["slidesAlongTheWall"]
        self.assertLess(slide["x"], 8.0)
        self.assertAlmostEqual(8.07, slide["movedAlong"], places=1)

    def test_a_body_steps_onto_a_kerb_but_not_over_a_wall(self) -> None:
        kerb = self.results["stepsOntoAKerb"]
        self.assertGreater(kerb["x"], 10.0)
        self.assertAlmostEqual(0.3, kerb["y"], places=3)
        self.assertTrue(kerb["grounded"])
        blocked = self.results["doesNotClimbAWall"]
        self.assertLess(blocked["x"], 8.0)
        self.assertAlmostEqual(0.0, blocked["y"], places=6)

    # --- the jump (PHY-1) --------------------------------------------------

    def test_the_jump_constants_are_read_not_fitted(self) -> None:
        c = self.results["constants"]
        # 0x008eb25c / 0x086d271c, raw 40c00000.
        self.assertEqual(6.0, c["jumpImpulse"])
        # 0x008d5c04 / 0x086c08ac.
        self.assertEqual(0.25, c["jumpCommandKick"])
        # 0x008c53cc / 0x086b1ca0 -- the only slope threshold in soldier
        # movement, and nothing like `MAX_GROUND_SLOPE`.
        self.assertEqual(0.1, c["jumpContactNormalY"])
        # 0x086ba8cc, and deliberately not multiplied by g_simulationFps.
        self.assertEqual(0.75, c["locomotionGain"])

    def test_the_jump_arc_at_the_engines_own_rate_is_the_ledgers(self) -> None:
        # **The parity assertion.** PHY-1 records a 1.12 m apex and 0.80 s of
        # air from the engine's four sub-steps of dt/4 at 30 Hz. Those figures
        # come out only if the impulse is added to the acceleration
        # accumulator beside gravity: a `v.y = 6.0` velocity set skips
        # gravity's share of the jump tick and peaks at 1.197 m instead.
        jump = self.results["jump30"]
        self.assertAlmostEqual(1.12, jump["apex"], delta=0.01)
        self.assertAlmostEqual(0.80, jump["airTime"], delta=0.04)
        self.assertTrue(jump["landed"])
        self.assertAlmostEqual(0.0, jump["y"], places=6)
        # And it is NOT the continuum answer -- that is 1.222 m, 9% higher.
        self.assertLess(jump["apex"], jump["continuumApex"] - 0.08)

    def test_a_jump_leaves_the_ground_and_comes_back(self) -> None:
        # The viewer's own 60 Hz step. A finer sub-step integrates nearer the
        # continuum, so the apex sits between the engine's 1.12 and the
        # closed-form 1.222 -- the same rate divergence the module header owns.
        jump = self.results["jump"]
        self.assertAlmostEqual(1.166, jump["apex"], delta=0.01)
        self.assertGreater(jump["apex"], self.results["jump30"]["apex"])
        self.assertLess(jump["apex"], jump["continuumApex"])
        self.assertAlmostEqual(0.80, jump["airTime"], delta=0.04)
        self.assertTrue(jump["landed"])
        self.assertAlmostEqual(0.0, jump["y"], places=6)

    def test_the_jump_kicks_a_quarter_of_the_command_backwards(self) -> None:
        # The `-0.25 * vCmd` lands on the *velocity*, so a soldier at a full
        # 6 m/s leaves the ground at 4.5. Writing it as `vCmd *= 0.75` is the
        # refuted form; this asserts the ratio the real one produces.
        run = self.results["runningJump"]
        self.assertAlmostEqual(0.75, run["fraction"], places=3)
        self.assertAlmostEqual(4.5, run["after"], delta=0.02)
        # And then the airborne locomotion force claws it back and more: a
        # running jump lands faster than a run, which is retail's behaviour.
        self.assertGreater(run["airPeak"], run["before"])
        self.assertAlmostEqual(8.0, run["airPeak"], delta=0.2)

    def test_a_ten_centimetre_wall_is_solid_from_either_side(self) -> None:
        # `sweepCapsule` now skips contacts the motion is travelling away
        # from. The question that buys is whether anything that could have
        # stopped the body got dropped with them, and the answer has to hold
        # for a body that starts *overlapping* the geometry -- a fence, a
        # hangar door, or the spot beside a vehicle that `exitVehicle` puts
        # you down on without checking.
        wall = self.results["thinWall"]
        near, far = wall["bounds"]
        radius = wall["radius"]
        # A clean run-up parks one radius short, on the near side.
        self.assertAlmostEqual(near - radius, wall["runUp"]["x"], delta=0.02)
        # Starting 5 cm inside the near face: it does not advance, and above
        # all it does not come out the far side.
        self.assertLess(wall["fromInsideNear"]["x"], near)
        # Put down dead centre in the wall and told to walk into it: still on
        # the near side of the far face. (It cannot walk out along X either --
        # both faces block, one each way -- which is a pre-existing property
        # of a wall thinner than the body, not something the skip changed. It
        # can always slide out along the wall.)
        self.assertLess(wall["fromDeadCentre"]["x"], far)
        # And the mirror.
        self.assertGreater(wall["fromInsideFar"]["x"], near)
        for case in ("runUp", "fromInsideNear", "fromDeadCentre", "fromInsideFar"):
            self.assertTrue(wall[case]["grounded"], msg=case)
            self.assertLess(wall[case]["speed"], 6.1, msg=case)
            self.assertAlmostEqual(0.0, wall[case]["y"], places=6, msg=case)

    def test_an_inside_corner_settles_instead_of_shuttling(self) -> None:
        # Two faces at right angles, walked into at 45 degrees. The push-out
        # from one moves the body along the other, which is exactly the shape
        # that can shuttle between them forever -- so the assertion is that
        # the last ten ticks do not move at all, and that nothing was climbed
        # or launched on the way in.
        corner = self.results["insideCorner"]
        self.assertAlmostEqual(0.0, corner["wanderX"], places=4)
        self.assertAlmostEqual(0.0, corner["wanderZ"], places=4)
        self.assertAlmostEqual(0.0, corner["maxY"], places=6)
        self.assertLessEqual(corner["peakSpeed"], 6.0)
        self.assertTrue(corner["grounded"])
        # One radius plus the skin off each face, which is where a body that
        # resolved both contacts belongs.
        self.assertAlmostEqual(19.69, corner["x"], delta=0.02)
        self.assertAlmostEqual(-12.31, corner["z"], delta=0.02)

    def test_jumping_into_a_wall_kicks_the_body_off_it(self) -> None:
        # The same rule where it actually bites. A soldier pressed into a wall
        # has a velocity of ~0 (the resolver strips it every tick) and a
        # command of a full 6 m/s into the wall, so the engine's
        # `-0.25 * vCmd` is 1.5 m/s *backward, off the wall*. Anything that
        # reads the kick off the command instead of the velocity -- including
        # assigning `v = vCmd` first and then kicking, which looks innocent --
        # sends him 4.5 m/s *into* the wall, the resolver eats it, and he rises
        # straight up still touching it. The sign is the test.
        wall = self.results["jumpOffAWall"]
        self.assertEqual(127, wall["pressed"]["ramp"])       # command saturated
        self.assertAlmostEqual(0.0, wall["pressed"]["vx"], places=6)  # velocity not
        self.assertGreaterEqual(wall["pressed"]["contacts"], 1)
        self.assertAlmostEqual(-1.5, wall["awayX"], places=3)
        self.assertGreater(wall["vy"], 5.0)
        self.assertFalse(wall["grounded"])

    def test_the_open_ground_jump_is_untouched_by_that_ordering(self) -> None:
        # Every measured figure in the report comes from an unblocked runner,
        # whose velocity already equals his command when the tick begins. The
        # ordering must be invisible there: 6.0 still becomes 4.5.
        run = self.results["jumpInTheOpen"]
        self.assertAlmostEqual(0.75, run["ratio"], places=3)
        self.assertAlmostEqual(4.5, run["after"], delta=0.02)

    def test_air_control_is_the_engines_acceleration_not_a_lerp(self) -> None:
        # PHY-6's `0.75 * vCmd` with no `* 30`: at a 6 m/s command that is
        # 4.5 m/s^2, so the horizontal speed climbs linearly instead of
        # snapping to the table. The first sample is still inside the ramp.
        air = self.results["airControl"]
        self.assertAlmostEqual(4.5, air["predictedAccel"], places=6)
        samples = air["samples"]
        self.assertEqual(3, len(samples))
        # Between the second and third samples the ramp is saturated and the
        # slope must be the predicted acceleration, bar a little drag.
        dt = samples[2]["t"] - samples[1]["t"]
        slope = (samples[2]["speed"] - samples[1]["speed"]) / dt
        self.assertAlmostEqual(4.5, slope, delta=0.1)
        # Nowhere near the table speed after a third of a second, which an
        # `AIR_CONTROL` lerp of 0.35 a tick would have been.
        self.assertLess(samples[0]["speed"], 2.0)

    def test_the_jump_gate_is_a_contact_normal_and_not_the_slope_limit(self) -> None:
        gate = self.results["jumpGate"]
        self.assertEqual(0.1, gate["threshold"])
        # The engine's gate is five times more permissive than the viewer's
        # own walk-slope choice, and that gap is the behaviour under test.
        self.assertLess(gate["threshold"], gate["maxGroundSlope"])
        self.assertTrue(gate["flat"]["armed"])
        # 80 degrees: normal.y = 0.174, past cos(60) but over 0.1.
        self.assertTrue(gate["steep"]["armed"])
        self.assertLess(gate["steep"]["ny"], gate["maxGroundSlope"])
        # 87 degrees: normal.y = 0.052, under it.
        self.assertFalse(gate["tooSteep"]["armed"])
        # Flat, but material 1 is Water.
        self.assertFalse(gate["water"]["armed"])

    def test_a_body_standing_on_water_cannot_jump(self) -> None:
        sea = self.results["cannotJumpOffWater"]
        self.assertFalse(sea["armed"])
        self.assertAlmostEqual(0.0, sea["rose"], places=6)
        # And he is swimming rather than standing on it, which is the engine's own
        # refusal: `BFSoldier::handleSwimAction` (`0x08282460`) zeroes the
        # `c_PIAction` axis (PlayerInput +0x24, mask bit 9 at +0xdc) while
        # `c_AsmIsSwimming` is up, so the jump input never reaches the gate.
        self.assertTrue(sea["swimming"])
        self.assertEqual(5, sea["gain"])

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
