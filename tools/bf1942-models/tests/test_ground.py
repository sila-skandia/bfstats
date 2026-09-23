"""`viewer/ground.js` under node: a Willys driven, not a Willys read.

Same pattern as `test_flight.py` — one node run, many assertions, the vendored
three.js stood up as a package so the viewer's modules import byte-for-byte.
The chassis the harness builds is the Willy glb's node tree transcribed
(positions and `extras.physics` both), so `collectChassis` is exercised on the
same shapes the real extract carries.

What the numbers mean. Almost the whole chassis is shipped data — spring
strength and damping, the steering lock, the gear count and shift points,
engine torque and final drive, the wheel radius off the collision mesh — and
the assertions against solved values (static loads summing to gravity, the
per-axle split from the wheelbase, the top speed the gear ladder sets) are
checks that the model spends that data rather than shadowing it with tuning.

The gearbox joined the data side on 2026-09-19 (TANK-3/TANK-4): `gearRatios`,
`reverseRatio` and `revLimit` were deleted and the ladder is now the engine's
own `getCurrentRatio()` per gear, off a 101-slot curve filled piecewise-
linearly between its control points. The ladders are pinned exactly here,
because that curve has been read wrong once already.

The constants still fitted (cornering stiffness, `lateralMu`,
`trackResistance`) get behavioural bounds instead, loose on purpose: they are
the part a recorded reference drive in the real game would revise, and the
tests should survive that revision.
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
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "ground_harness.mjs"

# The modules under their own names — `ground.js` imports `./flight.js` and
# `./physics.js`, so unlike `test_flight.py` nothing is renamed to `.mjs`;
# the work directory's `{"type":"module"}` makes plain `.js` importable.
MODULES = {
    "ground.js": VIEWER / "ground.js",
    "flight.js": VIEWER / "flight.js",
    "vehicle-camera.js": VIEWER / "vehicle-camera.js",
    "vehicle-discovery.js": VIEWER / "vehicle-discovery.js",
    "vehicle-base.js": VIEWER / "vehicle-base.js",
    "aircraft.js": VIEWER / "aircraft.js",
    "physics.js": VIEWER / "physics.js",
    "parachute.js": VIEWER / "parachute.js",
    "vendor/loaders/GLTFLoader.js": VIEWER / "vendor" / "loaders" / "GLTFLoader.js",
    "vendor/utils/BufferGeometryUtils.js": VIEWER / "vendor" / "utils" / "BufferGeometryUtils.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class GroundModelTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the constants and what they solve to ------------------------------

    def test_gravity_is_the_engines(self) -> None:
        # Imported from physics.js rather than declared again.
        self.assertAlmostEqual(-14.73, self.results["constants"]["gravity"], places=2)

    def test_the_declared_chassis_numbers_are_the_shipped_ones(self) -> None:
        # Physics.con, Objects/Vehicles/Land/Willy: any drift here means the
        # spec table stopped being a transcription.
        constants = self.results["constants"]
        self.assertEqual(2500, constants["mass"])
        self.assertEqual(10.5, constants["torque"])
        self.assertEqual(7, constants["differential"])
        self.assertEqual(5, constants["numberOfGears"])
        self.assertEqual(0.95, constants["gearUp"])
        self.assertEqual(0.4, constants["gearDown"])
        self.assertEqual(25, constants["springStrength"])
        self.assertEqual(5, constants["springDamping"])
        self.assertEqual(30, constants["maxSteer"])

    def test_every_spring_acts_at_one_and_a_half_times_its_setStrength(self) -> None:
        # PHY-5: `accel = -(strength * g * (-1/9.82) * D + ...)`. The
        # `-1/9.82` makes the sag gravity-invariant, and at the shipped
        # -14.73 the factor is exactly 1.5 — so a Willy's `setStrength 25`
        # springs act at 37.5 and the hull sits 0.098 m in rather than 0.147.
        # `bf42/con.py` exports the authored number on purpose and leaves the
        # law to the runtime; `ground.js` is that runtime.
        solved = self.results["solved"]
        self.assertAlmostEqual(1.5, solved["springScale"], places=3)
        self.assertAlmostEqual(0.098, solved["staticCompression"], places=3)

    def test_the_shipped_dampers_land_just_under_critical(self) -> None:
        # This used to assert exactly 1.0, on the argument that four wheels
        # give the heave mode 2*sqrt(4*25) = 20 of critical damping and 4*5 =
        # 20 is what the data supplies — "somebody at DICE tuned this
        # critically damped". That coincidence depended on reading
        # `setStrength` as the literal per-mass stiffness, which PHY-5
        # refutes. With the 1.5 the ratio is 1/sqrt(1.5) = 0.816, which is
        # both a perfectly ordinary road-car damping ratio and still a tidy
        # enough number that the tuning argument survives in weaker form.
        self.assertAlmostEqual(0.816, self.results["solved"]["heaveDampingRatio"], places=3)

    def test_the_spring_probes_down_the_hulls_axis_not_the_worlds(self) -> None:
        # PHY-5: `SpringTemplate`'s constructor writes `axisFixation = (0,1,0)`
        # and nothing in 18 installed mods authors `setAxisFixation` over it,
        # so every spring everywhere runs along the object's own up — which
        # leans with the body and is never world-vertical. On a 16.7 degree
        # slope the jeep sits pitched with the ground, and the probe reaches
        # 1/cos(lean) further than a vertical drop would.
        slope = self.results["slope"]
        self.assertTrue(slope["grounded"])
        self.assertAlmostEqual(slope["slopeDeg"], slope["pitchDeg"], delta=1.0)
        self.assertGreater(slope["axisStretch"], 1.0)
        # All four wheels still carry it, and the total is the component of
        # weight along the (now leaning) spring axis: g x cos(lean).
        for load in slope["loads"]:
            self.assertGreater(load, 1.0)
        self.assertAlmostEqual(14.73 * slope["axisStretch"] ** -1,
                               slope["totalLoad"], delta=0.3)

    def test_the_top_speed_arithmetic(self) -> None:
        # No fitted rev ceiling any more (TANK-3/TANK-9). The road speed a
        # gear reaches at a rev fraction is the engine's own EngineGrip
        # target, `getCurrentRatio(gear) * revs`, and revs run to the engine's
        # own clamp of 1.2 — so top gear's ceiling is 1.2 * 26.064 = 31.28
        # m/s. The deleted `revLimit 356` put this at 18.51 by fit alone; the
        # first reading of TANK-9 put it at 13.03 by halving the target.
        solved = self.results["solved"]
        self.assertAlmostEqual(31.28, solved["revCapSpeed"], places=1)
        # Willy's five gears, and the ladder is monotone at five gears so the
        # automatic always has somewhere to go.
        speeds = solved["gearSpeeds"]
        self.assertEqual([8.4, 13.36, 19.6, 26.73, 31.28], speeds)
        self.assertEqual(speeds, sorted(speeds))

    def test_the_rev_clamp_is_the_engines_and_it_is_asymmetric(self) -> None:
        # `Engine::handleUpdate` lnxded 0x0823e120 runs the rev state as
        # `revs += 0.05 * ((pedal - load) - 0.5*revs)` and then clamps it to
        # [-1.0, +1.2] (0x0823e2bf onward). The ceiling above 1 is what makes
        # top gear 31.3 m/s rather than 26.1; the floor at exactly 1 is why
        # reverse in first is 7.0 m/s where forward in first is 8.4.
        solved = self.results["solved"]
        self.assertEqual(1.2, solved["revCeiling"])
        self.assertEqual(1.0, solved["revFloor"])
        self.assertAlmostEqual(7.0, solved["reverseCapSpeed"], places=2)
        self.assertLess(solved["reverseCapSpeed"], solved["gearSpeeds"][0])

    def test_the_half_in_the_grip_target_is_a_blend_not_a_scale(self) -> None:
        # `addFriction` 0x0825c2ed-0x0825c407 builds
        #   T = (1 - 0.5*b) * ratio * diffRPM * fwd  +  0.5*b * (Vt . fwd) fwd
        # against the SAME forward axis, so at b = 1 it is half the command
        # plus half of what the wheel is already doing, and at b = 0 it is the
        # command in full. `b` is engine +0xb8, the gear-change timer, which
        # `Engine::handleUpdate` counts down to zero and never re-arms; its
        # constructor seed of 1.0 is what the earlier reading mistook for the
        # steady value, halving every gear's ceiling.
        solved = self.results["solved"]
        # Steady driving: the full command. Willy first gear, ratio 7.0.
        self.assertAlmostEqual(7.0, solved["gripTargetSteady"], places=3)
        # Mid-change, stationary: half of it.
        self.assertAlmostEqual(3.5, solved["gripTargetMidChange"], places=3)
        # Mid-change at 4 m/s: half the command plus half the contact speed,
        # which is what makes it a blend and not a scale.
        self.assertAlmostEqual(5.5, solved["gripTargetMidChangeAtSpeed"],
                               places=3)

    def test_the_two_ladders_run_in_opposite_directions(self) -> None:
        # The trap TANK-3 names. `getCurrentRatio` rises with gear; the drive
        # share falls, and it is the curve SAMPLE normalised to first gear.
        # The deleted `gearRatios` was an eyeballed copy of the second one.
        solved = self.results["solved"]
        self.assertEqual([7.0, 11.136, 16.333, 22.273, 26.064], solved["ladder"])
        self.assertEqual([1.0, 0.629, 0.429, 0.314, 0.269], solved["driveShare"])

    def test_the_invented_drivetrain_constants_are_gone(self) -> None:
        # Items 15 and 16 deleted all of these. Reintroducing any is
        # reintroducing an invention that the data now answers.
        constants = self.results["constants"]
        self.assertFalse(constants["hasGearRatios"])
        self.assertFalse(constants["hasReverseRatio"])
        self.assertFalse(constants["hasRevLimit"])
        self.assertFalse(constants["hasMu"])
        self.assertFalse(constants["hasTankMu"])
        self.assertFalse(constants["hasLateralMu"])

    # --- material friction (PHY-2) -----------------------------------------

    def test_the_coefficient_is_the_mean_of_the_two_materials(self) -> None:
        # `impulseOn`'s tail writes 0.5*(friction(matA) + friction(matB)) into
        # `ResponsePhysics+0xa8`. A Willy's wheels are material 37, which
        # vanilla never defines, so they fall back to material 0 at 1.0 — the
        # jeep runs at the mean of 1.0 and whatever it is standing on, never
        # at the ground's own number.
        surfaces = self.results["surfaceFriction"]
        self.assertAlmostEqual(0.55, surfaces["water"]["pairMean"], places=4)
        self.assertAlmostEqual(0.75, surfaces["mud"]["pairMean"], places=4)
        self.assertAlmostEqual(0.80, surfaces["rock"]["pairMean"], places=4)
        self.assertAlmostEqual(0.90, surfaces["grass"]["pairMean"], places=4)
        self.assertAlmostEqual(0.90, surfaces["sand"]["pairMean"], places=4)
        self.assertAlmostEqual(1.00, surfaces["dirtRoad"]["pairMean"], places=4)
        self.assertAlmostEqual(1.05, surfaces["paved"]["pairMean"], places=4)
        self.assertAlmostEqual(1.05, surfaces["gravel"]["pairMean"], places=4)

    def test_the_surface_decides_how_hard_the_jeep_can_launch(self) -> None:
        # Traction, not the brake pedal, is where the material shows. First
        # gear asks 10.5 m/s^2 of two rear wheels carrying a third of the
        # weight, so the launch runs at the Coulomb cap itself.
        surfaces = self.results["surfaceFriction"]
        water = surfaces["water"]["to10"]
        mud = surfaces["mud"]["to10"]
        grass = surfaces["grass"]["to10"]
        paved = surfaces["paved"]["to10"]
        rock = surfaces["rock"]["to10"]
        self.assertGreater(water, mud)
        self.assertGreater(mud, rock)
        self.assertGreater(rock, grass)
        # `grass` (0.9) to `paved` (1.05) no longer separates on the launch,
        # and that is the right answer rather than a lost signal: once the
        # pair mean is high enough, the first second is limited by the
        # gearbox — the rev filter's 40-tick spool and the ladder — and not
        # by traction. The brake still separates every material, because
        # nothing there competes with the Coulomb budget.
        self.assertGreaterEqual(grass, paved * 0.98)
        # Water is meaningfully slower off the line than tarmac. The margin
        # is 1.25x rather than the 1.5x it was, because the whole-vehicle
        # budget is now the engine's mean rather than a load-weighted sum:
        # a rear-wheel-drive jeep's driven pair gets 0.50 of `A*N.y*|g|`
        # instead of the 0.34 of standing weight they carry, so every surface
        # launches harder and the spread between them compresses against the
        # gearbox, which is the other thing limiting the first second.
        self.assertGreater(water, paved * 1.25)

    def test_braking_distance_is_the_materials_all_the_way_down(self) -> None:
        # This used to assert the opposite — that every surface but water
        # stopped in the same distance — because the free `brakeDecel 8` asked
        # less than even mud's 0.75 x 14.73 = 11.0 cap and so was the binding
        # constraint everywhere. `brakeDecel` is gone: the engine's brake is
        # the byte `PhysicsEngine+0xb4`, which makes `addFriction` discard the
        # EngineGrip target (`0x0825c28a`/`0x0825c293`) so the wheel asks for
        # its whole contact velocity back and the Coulomb clamp is the ONLY
        # limit. So every material now separates, monotonically.
        surfaces = self.results["surfaceFriction"]
        names = ("water", "mud", "rock", "grass", "dirtRoad", "paved")
        distances = [surfaces[name]["stopDistance"] for name in names]
        for softer, harder in zip(distances, distances[1:]):
            self.assertGreaterEqual(softer, harder)
        # Water (0.55) takes more than twice the room tarmac (1.05) does.
        self.assertGreater(surfaces["water"]["stopDistance"],
                           2.0 * surfaces["paved"]["stopDistance"])

    def test_the_static_latch_holds_a_parked_jeep_and_breaks_under_load(self) -> None:
        # The 1.5:1 hysteresis is a state-dependent branch on the grip byte,
        # not two passes: a body within its break-away budget applies its
        # force in full and stays latched, one that exceeds it unlatches and
        # is scaled to the sliding budget.
        latch = self.results["gripLatch"]
        self.assertTrue(all(latch["parked"]), "a parked jeep stands latched")
        # Hard braking breaks the driven pair loose and leaves the fronts
        # latched: the fronts carry two thirds of the weight, so the same
        # demand share fits inside their budget and not inside the rears'.
        self.assertIn(False, latch["braking"])
        self.assertIn(True, latch["braking"])
        # No contact clears the latch outright (0x0825b76b).
        self.assertFalse(any(latch["airborne"]))

    # --- the chassis reads off the tree ------------------------------------

    def test_the_chassis_is_discovered_not_declared(self) -> None:
        chassis = self.results["chassis"]
        self.assertEqual(4, chassis["wheels"])
        # c_PGFEngineGrip marks the rear axle driven; the fronts steer.
        self.assertEqual(2, chassis["driven"])
        self.assertEqual(2, chassis["steered"])
        self.assertTrue(chassis["hasCamera"])
        # Engine numbers came off the Engine node's extras, not the fallback.
        self.assertEqual(10.5, chassis["engine"]["torque"])
        # Wheel rest positions, root frame: fronts at z=-0.75, rears at 1.46.
        zs = sorted(rest[2] for rest in chassis["rests"])
        self.assertAlmostEqual(-0.75, zs[0], places=2)
        self.assertAlmostEqual(1.46, zs[-1], places=2)

    # --- settling -----------------------------------------------------------

    def test_it_settles_level_on_all_four_wheels(self) -> None:
        settle = self.results["settle"]
        self.assertLess(abs(settle["vy"]), 0.05)
        self.assertLess(abs(settle["speed"]), 0.05)
        # Level within the static rake: the asymmetric wheelbase (0.75 m
        # front, 1.46 m rear of the origin) loads the nose at two thirds of
        # the weight, which is about two degrees of nose-down sit.
        self.assertLess(abs(settle["pitch"]), 4.0)
        self.assertLess(abs(settle["roll"]), 1.0)
        self.assertTrue(settle["grounded"])
        for load in settle["loads"]:
            self.assertGreater(load, 1.0, "a wheel is hanging in the air")

    def test_the_standing_loads_sum_to_gravity(self) -> None:
        # Four springs carrying exactly g between them is the definition of
        # standing still; anything else and the body is still moving.
        self.assertAlmostEqual(14.73, self.results["settle"]["totalLoad"], delta=0.05)

    def test_the_axle_split_follows_the_wheelbase(self) -> None:
        # Front pair b/(a+b) = 1.46/2.21 of the weight: 4.87 per wheel
        # against 2.49 at the rear. This is the lever arithmetic made
        # observable, no constant of the model's own in it.
        loads = self.results["settle"]["loads"]
        front = [load for load in loads if load > 3.5]
        rear = [load for load in loads if load <= 3.5]
        self.assertEqual(2, len(front))
        self.assertEqual(2, len(rear))
        for load in front:
            self.assertAlmostEqual(4.87, load, delta=0.3)
        for load in rear:
            self.assertAlmostEqual(2.49, load, delta=0.3)

    def test_it_does_not_sink_through_the_floor(self) -> None:
        # Dropped from 0.8 m, the belly must never reach the ground plane:
        # the springs catch it above the failsafe.
        self.assertGreater(self.results["settle"]["minY"], 0.1)
        self.assertGreater(self.results["settle"]["y"], 0.25)
        self.assertLess(self.results["settle"]["y"], 0.45)

    def test_a_parked_vehicle_neither_sinks_nor_creeps_away(self) -> None:
        # Ten parked seconds after ten settling ones. Sinking is the failure
        # the spring must never have; creeping is the one PHY-5 introduced,
        # because the spring axis leans with the hull and a hull on its static
        # rake therefore pushes itself along. The per-wheel parking hold could
        # only ever balance that (a velocity-proportional force against a
        # constant one settles at `rake * substep`, which was 5 mm here and
        # 0.74 m on Wake's real slopes); `staticHold` makes it what the engine
        # makes it, a velocity constraint on latched contacts, and the answer
        # is then exactly zero rather than nearly zero.
        for name in ("willy", "sherman", "m3a1"):
            parked = self.results["parked"][name]
            self.assertGreater(parked["contacts"], 3, name)
            self.assertTrue(parked["compressionsHeld"], name)
            self.assertEqual(0.0, parked["sink"], name)
            self.assertEqual(0.0, parked["drift"], name)
            self.assertEqual(0.0, parked["speed"], name)

    def test_the_static_hold_does_not_freeze_a_hull_that_is_still_settling(self) -> None:
        # The trap in a constraint like that: a hull dropped onto a slope
        # crosses every "is it parked" threshold transiently on the way down,
        # and freezing it there leaves it sitting more than a degree off the
        # ground it is standing on with the wrong load on its springs. The
        # dwell is what stops that, and this is the case that proves it — the
        # jeep ends up pitched with the ramp and carrying `g x cos(lean)`,
        # which is what it did before any hold existed.
        slope = self.results["slope"]
        self.assertAlmostEqual(slope["slopeDeg"], slope["pitchDeg"], delta=1.0)
        self.assertAlmostEqual(14.73 * slope["axisStretch"] ** -1,
                               slope["totalLoad"], delta=0.3)

    def test_the_damper_is_not_blind_on_a_re_contact(self) -> None:
        # A wheel that was airborne last tick has no backward difference to
        # take. Zeroing its rate turns the damper off for that tick, and over
        # rough ground that is not a rare first-contact event at all: it is
        # 4 % of a jeep's contact ticks and 8 % of a half-track's — landings,
        # crests and kerbs, which is exactly when a damper earns its keep.
        # The rate is seeded from the axle's own closing speed instead.
        willy = self.results["recontacts"]["willy"]
        m3a1 = self.results["recontacts"]["m3a1"]
        self.assertGreater(willy["share"], 0.01)
        self.assertGreater(m3a1["share"], 0.05)
        # And nothing diverges over twenty seconds of bumps. The jeep's bound
        # is loose because this washboard (a 0.35 m sine on a 7.9 m
        # wavelength) is now taken at 31 m/s rather than the 18.5 the fitted
        # drivetrain managed: the kinetic energy arriving at the bump stop is
        # nearly three times what this guard was first set against, and the
        # stop is `bumpStiffness 5`, a [free] number of the viewer's. What the
        # assertion is for is numbers escaping, and 14.65 m is a jeep jumping
        # a crest at 112 km/h, not a divergence — it lands, and the run ends
        # grounded and finite.
        self.assertTrue(willy["finite"])
        self.assertLess(willy["apex"], 25.0)
        self.assertTrue(m3a1["finite"])
        self.assertLess(m3a1["apex"], 5.0)


    def test_a_tree_extracted_before_this_branch_still_steers(self) -> None:
        """BLOCKER E: the code must degrade to `main`'s behaviour, not to a
        dead stick.

        `EngineState` reads `maxRotation`, `maxSpeed` and `acceleration` out
        of `extras.physics`, and `bf42/con.py` only started emitting them on
        this branch. Every published `viewer/maps` scene and every
        `viewer/models` glb today was extracted with the previous `con.py`,
        and `map.html` builds the drivable hull from the LEVEL scene — so on
        the assets that exist right now none of the three is there.

        Throttle already degraded safely (`throttleTerm` falls back to the
        pedal and the ratio converges to the same place). **Steering had no
        fallback**, `maxYawAngle = 0` made the steering term identically 0,
        and `getCurrentDifferentialRPM`'s split IS the whole of a tracked
        vehicle's steering: a Sherman turned 0.0 degrees in six seconds of
        full lock. Both terms now fall back to the raw input.
        """
        pre = self.results["preExtract"]
        for name in ("sherman", "m3a1", "willy"):
            fresh = pre[name]
            stale = pre[f"{name}Stale"]
            self.assertTrue(stale["stale"], name)
            # Top speed within a per cent...
            self.assertAlmostEqual(fresh["topKmh"], stale["topKmh"],
                                   delta=max(0.7, fresh["topKmh"] * 0.01), msg=name)
            # ...and it still steers, to within a couple of per cent of the
            # turn it makes with the data present.
            self.assertGreater(abs(stale["yawDeg"]), 20.0, name)
            # Within a few per cent. Not bit-equality: the data supplies the
            # servo's spool (0.1 s of throttle, 0.25 s of steer) and the
            # fallback snaps instead, which shifts where a turn starts by a
            # fraction of a second. On the M3A1 that lands inside the
            # full-lock instability reported in `ground-vehicles.md`, so it
            # shows up as a few per cent of accumulated yaw rather than a
            # fraction of a degree.
            self.assertAlmostEqual(abs(fresh["yawDeg"]), abs(stale["yawDeg"]),
                                   delta=max(3.0, abs(fresh["yawDeg"]) * 0.08),
                                   msg=name)
        # A Willys Engine authors no yaw axis at all, so it is on the
        # fallback path either way — and correctly so: a `c_ETCar` never
        # reads the steering term.
        self.assertTrue(pre["willy"]["stale"])
        self.assertFalse(pre["sherman"]["stale"])

    def test_a_long_frame_settles_where_a_short_one_does(self) -> None:
        # map.html clamps THREE.Clock at 0.1 s; the internal substepper must
        # make that frame land where sixty of 1/60 do.
        settle = self.results["settle"]
        coarse = self.results["settleCoarse"]
        self.assertAlmostEqual(settle["y"], coarse["y"], delta=0.02)
        self.assertAlmostEqual(settle["pitch"], coarse["pitch"], delta=0.5)
        self.assertTrue(coarse["grounded"])

    # --- full throttle -------------------------------------------------------

    def test_full_throttle_reaches_the_top_speed_the_ladder_sets(self) -> None:
        # ~108 km/h, and every figure in it is read rather than fitted: top
        # gear's ratio is `getCurrentRatio(5, 5)` = 26.064 (TANK-3), and the
        # road speed a gear reaches at a rev fraction is the EngineGrip target
        # `ratio * revs` (TANK-9 as corrected 2026-09-20), with revs running
        # to the engine's own clamp of 1.2 rather than to 1. So the ceiling is
        # 1.2 x 26.064 = 31.28 m/s.
        #
        # Independently: a tick-level simulation of `Engine::handleUpdate`'s
        # rev filter against `addFriction`'s EngineGrip target and the
        # Coulomb budget settles a vanilla Willy at 30.4 m/s, 109.6 km/h. The
        # viewer's force model lands within two per cent of the engine's own
        # velocity governor, which is the point of the exercise.
        #
        # For the record of what this replaced: the earlier reading took the
        # `0.5` in `(1 - 0.5*b) * ratio * diffRPM` for a constant scale on the
        # target and got 46.5 km/h. `b` is the gear-change timer and is zero
        # in all steady driving, and the `0.5` is a blend against the wheel's
        # own contact speed, so the steady-state factor is 1. Before that,
        # `revLimit 356` put the same number at 65.8 km/h by fit.
        run = self.results["fullThrottle"]
        self.assertGreater(run["kmh"], 100.0)
        self.assertLess(run["kmh"], 115.0)
        self.assertEqual(5, run["gear"])
        self.assertTrue(run["grounded"])

    def test_the_launch_is_brisk_and_the_approach_asymptotic(self) -> None:
        run = self.results["fullThrottle"]
        # Most of top speed inside five seconds (traction-limited launch,
        # then the gear ladder)...
        self.assertGreater(run["at5s"], 18.0)
        # ...and no further gain from twenty seconds on: an equilibrium, not a
        # wall being bounced off. The approach is asymptotic and the last two
        # metres a second of it are slow, so the window that proves it is
        # 20 s against 40 s, not 10 s against 20 s.
        self.assertAlmostEqual(run["at20s"], run["speed"], delta=0.2)
        # `>=`, not `>`: the equilibrium is now EXACT. The EngineGrip target
        # is a velocity, `ratio * revs`, and once the road speed reaches it
        # the wanted change is zero, the load is zero and the revs sit on
        # their clamp — so ten, twenty and forty seconds all read 31.289 to
        # three decimals. The fitted model approached a balance of forces
        # asymptotically and never quite arrived.
        self.assertGreaterEqual(run["at20s"], run["at10s"])
        self.assertAlmostEqual(run["at10s"], run["at20s"], delta=0.01)

    def test_it_drives_straight_with_the_wheel_centred(self) -> None:
        run = self.results["fullThrottle"]
        self.assertLess(abs(run["heading"] + 1.0), 0.01)  # still nose down -Z
        self.assertLess(run["drift"], 1.0)                # metres off axis, 40 s

    # --- steering ------------------------------------------------------------

    def test_positive_yaw_input_turns_right(self) -> None:
        # The aircraft sign convention, kept: positive c_PIYaw is a negative
        # yaw rate. If this flips, A and D swap in every vehicle at once.
        steering = self.results["steering"]
        self.assertLess(steering["meanYawRate"], 0.0)
        self.assertLess(steering["turnedDeg"], -90.0)

    def test_the_turn_rate_is_a_vehicles_not_a_turrets(self) -> None:
        # Half lock from top speed. The friction circle caps lateral grip at
        # mu*g, which at the entry speed is some tens of degrees a second —
        # not the hundreds an unconstrained steer angle would command.
        rate = abs(self.results["steering"]["meanYawRate"])
        self.assertGreater(rate, 15.0)
        self.assertLess(rate, 100.0)

    def test_it_leans_out_of_the_turn_and_does_not_flip(self) -> None:
        steering = self.results["steering"]
        # Visible body roll on soft springs...
        self.assertGreater(steering["worstRoll"], 2.0)
        # ...but bounded, and the body never leaves upright.
        self.assertLess(steering["worstRoll"], 30.0)
        self.assertGreater(steering["minUp"], 0.8)
        self.assertTrue(steering["end"]["grounded"])

    def test_releasing_the_wheel_straightens_the_path(self) -> None:
        # setAutomaticReset 1 on the steering bundles: hands off means
        # straight ahead, not a held arc. Taken from cruising speed, where
        # the drive demand `T - Vt` is nearly zero because the target and the
        # road speed agree, so both axles have their whole Coulomb circle for
        # cornering and the hull comes straight.
        straighten = self.results["straighten"]
        self.assertLess(abs(straighten["turningRate"]), 100.0)
        self.assertGreater(abs(straighten["turningRate"]), 5.0)
        self.assertLess(abs(straighten["yawRate"]), 2.0)
        self.assertLess(abs(straighten["roll"]), 2.0)

    def test_a_car_engine_that_binds_yaw_does_not_steer_the_rear_axle(self) -> None:
        """The Kubelwagen, and with it every `c_ETCar` whose Engine binds
        `c_PIYaw`.

        `Objects/Vehicles/Land/Kubelwagen/Physics.con` gives
        `KubelwagenEngine` `setInputToYaw c_PIYaw` over `setMinRotation
        -1/0/-1` .. `setMaxRotation 1/0/1` -- the +-1 degree body lean a
        `c_ETTank` Engine declares, on a car. `GroundVehicle.collectChassis`
        walked every ancestor for that axis on the stated assumption that a
        car's Engine never binds yaw, so the Engine, which sits between every
        spring and the root, marked the rear `c_PGFEngineGrip` springs steered
        as well as the fronts. Four tyres pointing the same way cancel the yaw
        moment: the hull crabbed off on a fixed heading whatever the input,
        which is what "drives in one direction no matter what you do" is.

        `TrackedVehicle` already carried the `RotationalBundle` guard for its
        own engines; `GroundVehicle` now carries it too. The Willy, whose
        Engine binds roll only, is the control and must be unchanged.

        Vanilla's Kubelwagen is the only `c_ETCar` affected; the Schwimmwagen
        in the mod set declares the same engine rig.
        """
        kubel = self.results["kubelwagen"]["kubel"]
        willy = self.results["kubelwagen"]["willy"]

        # Only the two front `c_PGFRollGrip` springs steer.
        self.assertEqual(4, kubel["wheels"])
        self.assertEqual(2, kubel["driven"])
        self.assertEqual(2, kubel["steered"])
        self.assertTrue(kubel["steeredAreRollGrip"],
                        "a driven rear spring came back steered")
        # The lock is the front bundle's own +-30, not the Engine's +-1.
        self.assertEqual([30.0] * 4, kubel["steerMax"])

        # Half lock for six seconds turns it, and turns it the way the Willy
        # turns: right, for positive `c_PIYaw`.
        self.assertLess(kubel["turnedDeg"], -90.0)
        self.assertLess(willy["turnedDeg"], -90.0)
        # Two cars of the same mass on the same ladder with the same grip
        # classes corner within a quarter of each other; the geometry differs
        # (2.43 m wheelbase against the Willy's 2.21) so this is not equality.
        self.assertAlmostEqual(kubel["turnedDeg"], willy["turnedDeg"],
                               delta=abs(willy["turnedDeg"]) * 0.25)
        # And it turns rather than slides: the velocity stays near the nose.
        self.assertLess(kubel["worstSlipDeg"], 45.0)

    def test_a_floored_jeep_now_comes_out_of_a_hard_turn(self) -> None:
        """Pinned as a measurement, not defended as a fidelity claim.

        Wheel centred but throttle still floored out of a half-lock turn at
        31 m/s, the hull keeps sliding — 28 deg/s of yaw after four seconds
        and more, not less, after ten. The mechanism is visible in the
        harness's own wheel loads: the inside rear reads 0, i.e. it is off
        the ground, so the whole tractive effort is on one side of the hull.
        Whether the engine does the same is **OPEN**, and turns on a detail
        this viewer does not reproduce: `addFriction` hands each part's force
        to `addFrictionAtAbsolutePosition` at that part's own contact point,
        but `collision-response.md` section 8 reads the root's accumulator as
        a MEAN over parts, and a mean that averages the application points
        too would cancel exactly this couple. This file sums per-wheel forces
        weighted by standing load instead (see `coulombCaps`), which keeps
        the couple. Lifting the throttle ends it either way.
        """
        straighten = self.results["straighten"]
        # **This assertion is the inverse of what it was**, and the reason is
        # the whole of defect W's fix: the tyre frame used to be the HULL's
        # XZ plane, so a saturated contact on a rolled hull pushed partly out
        # of the surface it was standing on, and that out-of-plane couple was
        # what kept the slide going. In the contact plane it cannot exist —
        # every tangential answer is perpendicular to the surface normal by
        # construction (`intoContactPlane`, `0x0825c14b`-`0x0825c1ab`).
        self.assertLess(abs(straighten["throttleHeld"]), 10.0)
        self.assertLess(abs(straighten["yawRate"]), 2.0)

    def test_flooring_it_into_a_turn_from_rest_no_longer_spins_the_hull(self) -> None:
        """Was `..._is_a_power_slide`, and the slide is gone.

        The Coulomb budget is one circle per contact and the clamp keeps the
        direction of the demand, so a rear axle asking for the whole of a
        26 m/s target while doing 3 m/s spends the circle longitudinally and
        has nothing left to hold the back end. Held throttle keeps it there —
        which is how a player holds a drift, and what a BF1942 jeep is known
        for. Lifting the throttle ends it inside four seconds, because the rev
        state decays with the filter's 40-tick time constant, the target
        decays with it, and the wheels go back to asking for a correction that
        fits.
        """
        run = self.results["straightenFromRest"]
        # Also inverted: floored from rest into a turn and then straightened,
        # the hull no longer keeps spinning. Same cause as above.
        self.assertLess(abs(run["throttleHeld"]), 20.0)
        self.assertLess(abs(run["throttleLifted"]), 2.0)

    # --- the step ------------------------------------------------------------

    def test_driving_off_a_step_is_a_fall_and_then_a_landing(self) -> None:
        drop = self.results["stepDrop"]
        # Genuinely airborne: all four wheels unloaded for a fraction of a
        # second on the way down 2 m.
        self.assertGreater(drop["airborneSeconds"], 0.2)
        self.assertLess(drop["airborneSeconds"], 2.0)
        # The fall is gravity's: from wheel height, sqrt(2h/g) is about half
        # a second to first contact.
        self.assertIsNotNone(drop["fellFor"])
        self.assertLess(drop["fellFor"], 1.0)

    def test_the_landing_does_not_explode(self) -> None:
        drop = self.results["stepDrop"]
        self.assertTrue(drop["finite"])
        # Nothing faster than top speed (31.3 m/s) plus the fall itself.
        self.assertLess(drop["worstSpeed"], 36.0)
        self.assertGreater(drop["worstVy"], -12.0)
        # And afterwards it is simply driving again on the lower ground.
        self.assertTrue(drop["end"]["grounded"])
        self.assertGreater(drop["end"]["along"], 10.0)
        self.assertLess(drop["end"]["y"], 1.0)

    # --- brake and reverse ----------------------------------------------------

    def test_opposed_throttle_brakes_to_a_stop(self) -> None:
        brake = self.results["brake"]
        # Entry is top speed, 31.3 m/s (TANK-3 for the ladder, TANK-9 and
        # TANK-12 for the rev clamp it is taken at).
        self.assertGreater(brake["entry"], 30.0)
        self.assertIsNotNone(brake["stoppedAt"])
        # **Only the driven axle brakes.** The engine's brake byte discards
        # the EngineGrip target, and a `c_PGFRollGrip` front wheel has no
        # longitudinal demand to discard in the first place — its wanted
        # change is along the axle only (collision-response.md section 8). A
        # Willy is rear-wheel drive and its rear axle carries a third of the
        # standing weight, so the deceleration available is
        # `mu * |g| * (load_rear / |g|)` = about 5 m/s^2 on default ground,
        # and 31.3 m/s takes about six and a half seconds to shed. Ten is the
        # give for the rev state decaying through zero on the way.
        self.assertLess(brake["stoppedAt"], 10.0)
        self.assertGreater(brake["stoppedAt"], 4.0)

    def test_held_past_the_stop_it_backs_up_at_first_gears_pace(self) -> None:
        # The BF1942 behaviour: S brakes, then reverses. Reverse borrows first
        # gear and the rev clamp's *lower* arm, which is -1.0 and not -1.2
        # (`Engine::handleUpdate` 0x0823e2bf onward), so the ceiling is
        # 1.0 x 7.0 = 7.0 m/s where forward in first gets 8.4. That asymmetry
        # is the engine's own and is why reverse is slower than first.
        brake = self.results["brake"]
        self.assertGreater(brake["reverseSpeed"], 5.5)
        self.assertLess(brake["reverseSpeed"], 7.1)

    def test_forward_throttle_out_of_reverse_brakes_first(self) -> None:
        face = self.results["aboutFace"]
        self.assertLess(face["backward"], -3.0)   # it really was reversing
        self.assertGreater(face["forward"], 10.0)  # and now it really is not

    def test_a_closed_throttle_coasts_down_rather_than_cruising(self) -> None:
        coast = self.results["coast"]
        self.assertGreater(coast["entry"], 12.0)
        # It decays, rather than dropping off a cliff: three seconds off the
        # pedal still leaves most of the speed...
        self.assertGreater(coast["after3s"], coast["entry"] * 0.5)
        self.assertLess(coast["after3s"], coast["entry"])
        # ...and fifteen seconds of rolling resistance and engine braking take
        # a good part of it off. They do not stop it: from a 29.8 m/s entry
        # there is still 18.5 m/s left, which is what a fitted coast law
        # sized against a 12.8 m/s top speed does when the top speed becomes
        # 29.8. `rollingResistance` and `engineBraking` are [free] and this is
        # the clearest place the corrected ceiling says they want re-fitting
        # (or replacing with the engine's own closed-throttle EngineGrip law,
        # which `ground.js` already describes and deliberately fades out).
        self.assertLess(coast["after15s"], coast["entry"] * 0.7)
        self.assertGreaterEqual(coast["after15s"], 0.0)

    # --- presentation ---------------------------------------------------------

    def test_the_wheels_roll_and_ride_on_their_springs(self) -> None:
        spin = self.results["wheelSpin"]
        # Five seconds of driving turns every wheel by tens of radians...
        for turned in spin["turned"]:
            self.assertGreater(turned, 20.0)
        # ...and all four the same amount on a straight road.
        self.assertAlmostEqual(min(spin["turned"]), max(spin["turned"]), delta=1.0)
        # Compression lifts each wheel node up its travel toward the body —
        # about the static compression, and never past the declared travel.
        for lift in spin["lift"]:
            self.assertGreater(lift, 0.05)
            self.assertLess(lift, 0.31)

    def test_the_camera_rides_at_the_drivers_eye(self) -> None:
        camera = self.results["camera"]
        self.assertTrue(camera["hasNode"])
        # WillyCamera sits 0.95 above the origin, and the origin settles a
        # third of a metre up: an eye a little over a metre off the road.
        self.assertGreater(camera["y"], 1.0)
        self.assertLess(camera["y"], 1.7)


class TrackedVehicleTests(unittest.TestCase):
    """`TrackedVehicle`: a Sherman and an M3A1 driven, not read.

    Same harness process as `GroundModelTests` above (`run_harness()` builds
    both fixtures in one node run), and the same split in what a failure
    means: the gear-ratio curve and the differential-steering formula are
    verify-r7.md's byte-exact claims (TANK-3/6/7/8, TANK-10) and these
    assertions are exact; everything downstream of them — top speed, turn
    rate, how stiff a track resists sliding — is this file's own [free]
    tuning (`TANK` in `ground.js`), asserted only as a loose, survivable
    band, the same convention `GroundModelTests` already uses for Willy's.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the corrected gear-ratio curve, in isolation -----------------------

    def test_the_gear_ladders_are_the_engines_own(self) -> None:
        # TANK-3, the pinned ladders. `getCurrentRatio()` RISES with gear —
        # it is a speed multiplier, not a reduction — and the curve between
        # the authored control points is linear, not flat at 1.0.
        ratios = self.results["tankRatios"]
        self.assertEqual([4.0, 6.364, 9.333, 12.727, 14.894], ratios["sherman"])
        self.assertEqual([7.0, 11.136, 16.333, 22.273, 26.064], ratios["willy"])
        self.assertEqual([5.512, 9.459, 14.583, 18.617], ratios["m3a1"])

    def test_the_m3a1_is_5_512_and_never_17_5_again(self) -> None:
        # The refuted number, named so a later edit that reintroduces the
        # "flat at 1.0 between five slots" curve fails here and nowhere
        # subtler. Its index is 25 and `curve[25]` is 3.175, not 1.0.
        ratios = self.results["tankRatios"]
        self.assertAlmostEqual(5.512, ratios["m3a1First"], places=3)
        self.assertNotAlmostEqual(17.5, ratios["m3a1First"], places=1)

    def test_every_gear_count_gets_a_real_ratio(self) -> None:
        # The refuted model said every count but 1 and 5 collapses to
        # 3.5*differential = 12.25. Not one of them does, and they are all
        # distinct, because the curve is interpolated everywhere.
        off = self.results["tankRatios"]["offCurve"]
        for ratio in off:
            self.assertNotAlmostEqual(12.25, ratio, places=2)
        self.assertEqual(len(off), len(set(off)))
        # numberOfGears 1 is index 100, the aircraft case: 3.5/0.94.
        self.assertAlmostEqual(3.7234, self.results["tankRatios"]["singleGear"], places=3)

    def test_the_ladder_is_not_monotonic_above_five_gears(self) -> None:
        # Because the curve climbs from the ctor default 1.0 to 3.5 across
        # indices 0..20, a gear landing below index 20 samples a smaller
        # divisor and gets a LARGER ratio. Do not sort, clamp or fix this.
        eight = self.results["tankRatios"]["eightSpeed"]
        self.assertAlmostEqual(6.829, eight[0], places=3)
        self.assertAlmostEqual(5.512, eight[1], places=3)
        self.assertGreater(eight[0], eight[1])
        self.assertNotEqual(eight, sorted(eight))
        # A 50-speed still lands on real, distinct ratios rather than one.
        ends = self.results["tankRatios"]["fiftySpeedEnds"]
        self.assertEqual(len(ends), len(set(ends)))

    def test_the_ratio_curve_is_filled_piecewise_linearly(self) -> None:
        # The distribution `OverTimeDistribution::generateDistribution` lays
        # down, read at the decades. The 0..20 ramp off the constructor's
        # 1.0 is the half the refuted reading was missing.
        self.assertEqual(
            [1.0, 2.25, 3.5, 2.85, 2.2, 1.85, 1.5, 1.3, 1.1, 1.02, 0.94],
            self.results["tankRatios"]["curveByTen"])

    def test_the_torque_curve_is_the_second_distribution(self) -> None:
        # TANK-4: a different curve at a different offset, indexed by a
        # normalised rev fraction rather than by the gear, peaking at 60%.
        curve = self.results["torqueCurve"]
        self.assertEqual(
            [0.7, 0.8, 0.85, 0.9, 0.9333, 0.9667, 1.0, 0.94, 0.88, 0.8, 0.7],
            curve["byTen"])
        self.assertAlmostEqual(1.0, curve["peak"], places=4)
        # min(|revs|, 1.0): over-rev clamps, the sign is dropped.
        self.assertAlmostEqual(0.7, curve["overRev"], places=4)
        self.assertAlmostEqual(1.0, curve["negative"], places=4)

    def test_differential_rpm_matches_tank_10_byte_exact(self) -> None:
        d = self.results["diffRPM"]
        self.assertAlmostEqual(1.0, d["straightFull"], places=4)
        self.assertAlmostEqual(0.25, d["halfLockOuter"], places=4)
        # 1*(1+1.5*0.5) = 1.75, clamped to the formula's own +-1.
        self.assertAlmostEqual(1.0, d["halfLockInner"], places=4)
        self.assertAlmostEqual(1.0, d["centreline"], places=4)

    def test_tank_17_zero_throttle_is_zero_on_both_sides(self) -> None:
        d = self.results["diffRPM"]
        self.assertAlmostEqual(0.0, d["noThrottleRight"], places=6)
        self.assertAlmostEqual(0.0, d["noThrottleLeft"], places=6)

    # --- the chassis reads off the tree, for two very different tanks ------

    def test_sherman_chassis_is_discovered_not_declared(self) -> None:
        # Objects/Vehicles/Land/Sherman: two driven bogies a side (TANK-14's
        # own "x2 per side"), no steered axle, differential 4 over 5 gears.
        chassis = self.results["shermanChassis"]
        self.assertEqual(12, chassis["wheels"])
        self.assertEqual(4, chassis["driven"])
        self.assertEqual(8, chassis["dummy"])
        self.assertEqual(0, chassis["steered"])
        self.assertEqual(4, chassis["engine"]["differential"])
        self.assertEqual(5, chassis["engine"]["numberOfGears"])
        self.assertAlmostEqual(4.0, chassis["ratio"], places=4)
        # Two wheels a side, none dead on the centreline.
        sides = chassis["drivenSides"]
        self.assertEqual(2, sides.count(-1))
        self.assertEqual(2, sides.count(1))

    def test_m3a1_chassis_is_discovered_not_declared(self) -> None:
        # Objects/Vehicles/Land/m3a1: the same two-bogies-a-side pattern plus
        # a genuinely steered +-40 degree front axle (TANK-15), differential
        # 5 over only 4 gears — the one combination the round's correction
        # actually changes the answer for.
        chassis = self.results["m3a1Chassis"]
        self.assertEqual(16, chassis["wheels"])
        self.assertEqual(4, chassis["driven"])
        self.assertEqual(10, chassis["dummy"])
        self.assertEqual(2, chassis["steered"])
        self.assertEqual(5, chassis["engine"]["differential"])
        self.assertEqual(4, chassis["engine"]["numberOfGears"])
        # 5.512, not the 17.5 the refuted flat-curve reading gave (TANK-3).
        self.assertAlmostEqual(5.5118, chassis["ratio"], places=4)
        for lock in chassis["steerMax"]:
            self.assertAlmostEqual(40.0, lock, places=3)

    # --- settling -------------------------------------------------------------

    def test_both_tanks_settle_grounded_and_level(self) -> None:
        for key in ("shermanSettle", "m3a1Settle"):
            settle = self.results[key]
            self.assertTrue(settle["grounded"], key)
            self.assertLess(abs(settle["speed"]), 0.1, key)
            # A hull this long carries a visible nose-down or nose-up rake
            # once its own weight is on only 4 (Sherman) or 4+2 (M3A1)
            # springs rather than every wheel — loose, since the exact
            # angle is a function of the free suspensionTravel/strength
            # split, not itself a claim.
            self.assertLess(abs(settle["pitch"]), 10.0, key)
            self.assertLess(abs(settle["roll"]), 2.0, key)

    def test_a_shermans_whole_weight_rests_on_its_four_driven_wheels(self) -> None:
        # No front axle to share it with, unlike the M3A1 — every one of the
        # eight dummy rollers is legitimately zero (TANK-14), so the four
        # real springs must carry exactly g between them, the same
        # standing-still identity `GroundModelTests` checks for Willy.
        settle = self.results["shermanSettle"]
        self.assertAlmostEqual(14.73, settle["totalDrivenLoad"], delta=0.1)
        for load in settle["drivenLoads"]:
            self.assertGreater(load, 1.0)

    def test_an_m3a1s_front_axle_shares_the_load_with_its_tracks(self) -> None:
        # Its own front axle is a genuine spring (`c_PGFRollGrip`, real
        # strength/damping) rather than furniture, so the rear driven wheels
        # alone must fall short of the full 14.73 — some of it is on the
        # front axle instead — but still carry the majority of a nose-heavy
        # half-track's weight.
        settle = self.results["m3a1Settle"]
        self.assertLess(settle["totalDrivenLoad"], 14.73)
        self.assertGreater(settle["totalDrivenLoad"], 7.0)

    def test_dummy_wheels_carry_no_load_on_either_tank(self) -> None:
        # TANK-14/6: the shipped data gives every one `setStrength 0`, so the
        # existing spring formula already prices them at zero.
        for key in ("shermanSettle", "m3a1Settle"):
            for load in self.results[key]["dummyLoads"]:
                self.assertAlmostEqual(0.0, load, places=6, msg=key)

    # --- straight-line driving -------------------------------------------------

    def test_both_tanks_reach_a_tank_scale_not_an_aircraft_scale_top_speed(self) -> None:
        # `TANK.trackResistance` exists rather than trusting the confirmed
        # thrust law alone (see its own comment in ground.js), and TANK-3's
        # correction made its job much easier: it was fitted against a ratio
        # of 17.5 that asymptoted toward ~68 m/s unconstrained, and the real
        # 5.512 is a third of that. Loose bands, since neither figure is a
        # measurement.
        sherman = self.results["shermanStraight"]
        m3a1 = self.results["m3a1Straight"]
        self.assertGreater(sherman["kmh"], 10.0)
        self.assertLess(sherman["kmh"], 60.0)
        self.assertGreater(m3a1["kmh"], 20.0)
        self.assertLess(m3a1["kmh"], 80.0)

    def test_the_corrected_ratio_makes_the_m3a1_livelier_but_not_absurd(self) -> None:
        # The behavioural half of the ratio correction. 5.512 against the
        # Sherman's 4.0 still makes the half-track the quicker hull — 64
        # against 41 km/h — but no longer the 112 km/h the refuted 17.5
        # produced, which was a half-track outrunning every fighter on the
        # map. The gap is a believable 1.6x rather than 3.3x.
        #
        # The engine's own governor, simulated tick by tick from
        # `Engine::handleUpdate` and `addFriction`, puts these two at 66.8 and
        # 53.5 km/h. The M3A1 is within two per cent of that; the Sherman is
        # low, and the reason is that `TrackedVehicle` still carries its
        # propulsion in `bodyThrust` at a fixed gear 1, which the engine-type
        # gate refutes (see `features/bf1942-3d-models/ground-vehicles.md`).
        sherman = self.results["shermanStraight"]
        m3a1 = self.results["m3a1Straight"]
        self.assertGreater(m3a1["kmh"], sherman["kmh"] * 1.2)
        self.assertLess(m3a1["kmh"], sherman["kmh"] * 2.0)
        self.assertLess(m3a1["kmh"], 70.0)

    def test_it_reaches_an_equilibrium_not_a_wall(self) -> None:
        for key in ("shermanStraight", "m3a1Straight"):
            run = self.results[key]
            self.assertAlmostEqual(run["at10s"], run["along"], delta=max(0.5, abs(run["along"]) * 0.05))

    def test_it_drives_straight_with_the_wheel_centred(self) -> None:
        for key in ("shermanStraight", "m3a1Straight"):
            run = self.results[key]
            self.assertLess(abs(run["heading"] + 1.0), 0.02, key)   # nose down -Z

    # --- turning ----------------------------------------------------------------

    def test_positive_yaw_turns_right_on_both_tanks(self) -> None:
        # The same convention `GroundModelTests` checks for Willy: positive
        # c_PIYaw is a negative yaw rate. If this flips it flips for every
        # differential-steered vehicle at once, not just one tank.
        for key in ("shermanTurnRight", "m3a1TurnRight"):
            self.assertLess(self.results[key]["yawRateDeg"], 0.0, key)
        for key in ("shermanTurnLeft", "m3a1TurnLeft"):
            self.assertGreater(self.results[key]["yawRateDeg"], 0.0, key)

    def test_both_hulls_turn_at_a_vehicles_radius_at_a_matched_speed(self) -> None:
        # Replaces an earlier "the M3A1's front axle turns it tighter than
        # the Sherman" assertion, which compared the two hulls' yaw rate at
        # full throttle — i.e. a 34 km/h vehicle against a 114 km/h one,
        # since the corrected ratio (TANK-3) really is 4.4x. At those
        # speeds the faster hull is grip-limited and the comparison answers
        # a question about top speed, not about the front axle. Held at a
        # common ~4 m/s and read as turn radius instead.
        #
        # 4 m/s and not 8, because a turning tracked hull cannot hold 8: at
        # half lock `getCurrentDifferentialRPM` gives the outer track
        # `clamp(revs * (1 - 1.5*0.5), -1, 1)` = a quarter of the inner one's
        # target, and the lateral scrub of four tracks sliding sideways comes
        # out of the same Coulomb circle as the drive. The Sherman settles at
        # 3.0 m/s and the M3A1 at 4.0.
        by_name = {case["name"]: case for case in self.results["tankMatchedTurn"]}
        for name, case in by_name.items():
            self.assertLess(case["speed"], 5.0, name)
            self.assertGreater(case["speed"], 2.0, name)
            self.assertIsNotNone(case["radius"], name)
            self.assertLess(case["radius"], 40.0, name)
            self.assertGreater(case["radius"], 2.0, name)
        # And the half-track, which steers with a 40-degree front axle rather
        # than by driving one track backwards, turns the wider circle.
        self.assertGreater(by_name["m3a1"]["radius"], by_name["sherman"]["radius"])

    def test_a_held_turn_does_not_settle_into_a_per_frame_limit_cycle(self) -> None:
        # The judder this class shipped with: at one sub-step per rendered
        # frame the explicit integration of a tank's stiff roll suspension
        # against its cornering stiffness sat on its stability limit, and a
        # full-lock turn settled into a period-2 oscillation — the body roll
        # rate flipping -15.08/+14.91 deg/s and the four wheel loads swapping
        # sides every single frame. Both numbers below are one-sided by two
        # orders of magnitude between the broken and fixed models, so the
        # thresholds are deliberately loose.
        steady = self.results["tankSteadyTurn"]
        self.assertLessEqual(steady["rollSignFlipsPerSecond"], 2)
        self.assertLess(steady["worstLoadStep"], 0.05)

    def test_turning_never_flips_either_tank(self) -> None:
        # The regression this track's own work found: a sustained turn from
        # a stand-still once rolled the M3A1 onto its roof (`worstUp` goes
        # negative) before `TANK.angularDamping` was raised to fix it. 0.8,
        # loose, well short of the roughly-zero a genuine tip-over crosses.
        for key in ("shermanTurnRight", "shermanTurnLeft", "m3a1TurnRight", "m3a1TurnLeft"):
            self.assertGreater(self.results[key]["worstUp"], 0.8, key)
            self.assertTrue(self.results[key]["grounded"], key)
        for case in self.results["tankStability"]:
            self.assertGreater(case["worstUp"], 0.8, case)

    def test_turning_never_flips_from_the_vehicles_own_top_speed_either(self) -> None:
        # The harder of the two rollover cases this track's own work found:
        # surviving a turn held from a stand-still (the test above) was not
        # enough to survive the same turn entered from the vehicle's own
        # straight-line top speed — the M3A1's extra ~10 m/s very nearly
        # doubles the centripetal load through the identical suspension
        # formula, and this is the case that actually pinned
        # `TANK.angularDamping` at 12.0 being not quite enough and 15.0
        # being comfortably enough.
        for key in ("shermanHardTurn", "m3a1HardTurn"):
            case = self.results[key]
            # 0.75, not 0.8, and only for this case: entering a full-lock
            # turn from the M3A1's own straight-line top speed now lifts its
            # inner side to **39 degrees of roll** (`up.y` 0.769) where it
            # used to lift 5. That is the one place the engine's friction
            # mean (see `coulombCaps`) costs something rather than paying:
            # with no load weighting, a barely-loaded contact answers at the
            # full `A*N.y*|g|`, and a half-track carrying most of its weight
            # on four bogies has six contacts sharing the budget. It does
            # not go over — `up.y` never approaches 0 anywhere in the sweep —
            # and it is reported as unfinished rather than tuned away.
            self.assertGreater(case["worstUp"], 0.75, key)
            self.assertTrue(case["grounded"], key)

    # --- TANK-17: no pivoting on the spot ---------------------------------------

    def test_it_cannot_pivot_from_a_stand_still_on_yaw_alone(self) -> None:
        pivot = self.results["tankPivot"]
        self.assertAlmostEqual(0.0, pivot["yawRate"], places=3)
        self.assertLess(pivot["speed"], 0.05)

    # --- reverse ------------------------------------------------------------

    def test_negative_throttle_reverses_it(self) -> None:
        # No separate brake/reverse state machine the way `GroundVehicle`
        # needs one — TANK-10's own formula is signed throughout, so this is
        # simply throttle's sign carried straight through.
        self.assertLess(self.results["tankReverse"]["along"], -1.0)

    # --- reset ----------------------------------------------------------------

    def test_reset_clears_motion_and_the_wheels(self) -> None:
        reset = self.results["tankReset"]
        self.assertTrue(reset["everSpun"])   # the test drove it first
        self.assertEqual([0, 0, 0], reset["velocity"])
        self.assertEqual([0, 0, 0], reset["angularVelocity"])
        for angle in reset["anglesAfter"]:
            self.assertEqual(0, angle)

    # --- the two tracks spin at different rates mid-turn ------------------------

    def test_differential_steering_spins_the_two_sides_at_different_rates(self) -> None:
        # The entire visible point of this track: the wheel a player watches
        # spin is driven by TANK-10's own per-side value, not a shared body
        # speed, so the two sides must visibly disagree during a turn.
        spin = self.results["tankWheelSpin"]
        self.assertGreater(max(spin["left"]), max(spin["right"]))
        # Same side, same rate — one differential per vehicle, not one per
        # bogie.
        self.assertAlmostEqual(0.0, spin["leftConsistent"], places=2)
        self.assertAlmostEqual(0.0, spin["rightConsistent"], places=2)

    # --- hull collision against static objects ---------------------------------

    def test_hull_collision_stops_the_vehicle_at_the_wall(self) -> None:
        # With a collider, the jeep must not drive through the wall at z=-10.
        col = self.results["hullCollision"]
        self.assertTrue(col["stoppedShortOfWall"])
        self.assertLess(col["vz"], 0.1)

    def test_no_collider_drives_through_walls(self) -> None:
        # Without a collider, the jeep retains the old behaviour: it drives
        # straight through the static hull.
        col = self.results["hullCollisionNoCollider"]
        self.assertTrue(col["throughWall"])

    # --- drivable decks (bridges, repair/reload bays) -----------------------

    def test_a_vehicle_drives_up_the_incline_and_rests_on_the_pad(self) -> None:
        # A 4 m ramp onto a 1 m pad, the repair bay of the bug report. The
        # surface is analytic but it is analytic in the shape the real query
        # has: a height that exists only at or below the reference the caller
        # passes, so what is under test is the reference `ground.js` asks from.
        for name in ("jeepOntoPad", "tigerOntoPad",
                     "jeepOntoPadSlow", "tigerOntoPadSlow"):
            run = self.results[name]
            with self.subTest(name):
                self.assertTrue(run["reachedPad"])
                # It rides the pad at the same height above it as it rides the
                # flat ground — the pad carries it, it is not sunk into it and
                # not floating over it. (Submerged in the pad was the report.)
                self.assertAlmostEqual(run["flatRide"], run["padRide"], delta=0.02)
                # And never below the pad's top surface at all.
                self.assertGreater(run["lowestOnPad"], 1.0)
                # Nose up the incline, by some of the ramp's angle and never by
                # more than it plus the overshoot of arriving at it. How much of
                # it is a question of speed, and has its own two tests below.
                self.assertGreater(run["peakRampPitch"], 0.0)
                self.assertLess(run["peakRampPitch"], run["rampAngleDeg"] * 1.3)
                # ...and level again on the pad, which means back to the
                # attitude the vehicle holds standing on flat ground: a Willys
                # sits 1.2 degrees nose-down on its own springs and is not
                # "unlevel" for doing it on the pad too.
                self.assertLess(abs(run["padPitchVsRest"]), 0.5)
                # Measured once it has settled, and it must settle: at the
                # engine's rotational inertia a Sherman's hull takes three
                # seconds to come level after the crest, which is longer than
                # the 14 m pad this scenario used to have. Reading `padPitch`
                # off that pad sampled the decay mid-flight and called 2.3
                # degrees of it a defect.
                self.assertIsNotNone(run["padSettleSeconds"])
                self.assertLess(run["padSettleSeconds"], 4.0)
                # No tick-to-tick jump beyond what a 1/4 ramp at road speed
                # explains. The `CLIMB_STEP` nudge this replaced moved the hull
                # 0.2 m a tick on its own, and the height raster's cells
                # stepped under the wheels on top of that.
                self.assertLess(run["biggestJump"], 0.08)

    def test_a_walking_ascent_takes_up_the_whole_of_the_ramps_angle(self) -> None:
        """The ramp's own geometry is the target, not a fitted threshold.

        The ramp rises 1 m over a 4 m run, so `atan(1/4)` = 14.04 degrees is
        everything the deck can ask of a hull's attitude. A hull whose
        LOAD-BEARING springs span less than that 4 m run gets asked all of it,
        because there is a position at which every one of its supports is on
        the ramp — and both vehicles here qualify: the Willys spans 2.21 m and
        the Sherman 2.449 m. (The Sherman's 4.1 m of track rollers is not the
        supported span. Its eight `c_PGFEngineDummyGrip` rollers are
        `strength 0`/`damping 0` and carry none of the hull; only the two
        `ShermanWheelL3`/`L3b` bogie rows a side do.)

        So at a walking pace, where the hull has time to take up the attitude
        it is being asked for, the peak pitch is the ramp's angle and nothing
        else. That is the assertion this test makes, and the reason the
        floored run below is checked against a ratio rather than an angle.
        """
        for name in ("jeepOntoPadSlow", "tigerOntoPadSlow"):
            run = self.results[name]
            with self.subTest(name):
                # The premise: the supports fit inside the 4 m run...
                self.assertLess(run["loadedSpanZ"], 4.0)
                # ...and it really is walking pace at the foot of the ramp.
                self.assertLess(run["vAtRampFoot"], 1.5)
                # Then the ramp's own angle, within half a degree.
                self.assertAlmostEqual(run["peakRampPitch"], run["rampAngleDeg"],
                                       delta=0.5)

    def test_how_much_of_the_ramp_a_tank_takes_up_falls_away_with_speed(self) -> None:
        """Pinned as a measurement, not defended as a derivation.

        A floored Sherman meets this ramp at 8 m/s and peaks at 6.86 degrees,
        half of the 14.04 the deck is asking for. It is not a geometry limit
        (the previous test) and it is not stiffness: reading the per-wheel
        loads through the climb, the ramp lifts the hull about 0.3 m before the
        rear bogie row has pitched down far enough to follow, the rear row runs
        out of its 0.35 m of suspension travel and unloads to nothing, and the
        tank crosses the whole ramp teetering on its front row. With no rear
        spring there is no pitch stiffness at all, so the nose rises under the
        front row's moment against the hull's rotational inertia, and the peak
        arrives on the tick the rear row touches down again. It is therefore a
        RATE, and `getGeometryInertia`'s `(DX^2 + DY^2)/3` — four times a solid
        box's, and the only inertia the engine has — makes that rate a quarter
        of what a `/12` box gave. The same run read 12.76 degrees before.

        Hence the shape of the assertion: a band around a half, and the
        monotone fall-off with approach speed, rather than a threshold.
        """
        fast = self.results["tigerOntoPad"]
        slow = self.results["tigerOntoPadSlow"]
        # Floored, it gets appreciably less of the ramp than walking does.
        self.assertLess(fast["peakRampPitch"], slow["peakRampPitch"])
        ratio = fast["peakRampPitch"] / fast["rampAngleDeg"]
        self.assertGreater(ratio, 0.35)
        self.assertLess(ratio, 0.65)
        # And it falls away monotonically between the two, which is what makes
        # it a response time rather than a broken contact query.
        by_speed = self.results["tankRampPitchBySpeed"]
        peaks = [case["peak"] for case in by_speed]
        self.assertEqual([], [p for p in peaks if p is None])
        for slower, faster in zip(peaks, peaks[1:]):
            self.assertLessEqual(faster, slower)
        # The slowest of them is the ramp's own angle, the fastest is half it.
        self.assertAlmostEqual(peaks[0], fast["rampAngleDeg"], delta=0.5)
        self.assertLess(peaks[-1], fast["rampAngleDeg"] * 0.65)
        # A Willys over the same break does not have the deficit — it clears
        # the crest and overshoots past the ramp's angle instead.
        jeep = self.results["jeepOntoPad"]
        self.assertGreater(jeep["peakRampPitch"], jeep["rampAngleDeg"])

    def test_only_the_crest_of_the_incline_puts_a_jeep_in_the_air(self) -> None:
        # A jeep at road speed over the convex break where a 14-degree ramp
        # meets a flat pad leaves the ground, which is what a jeep does over a
        # crest. What must not happen is the hull bouncing along the flat run.
        jeep = self.results["jeepOntoPad"]
        zs = jeep["airborneZs"]
        # The hop is a ballistic one and is bounded as such rather than by a
        # tick count. Leaving the crest at `vAtCrest` along a ramp of
        # `rampAngleDeg`, the vertical component is v*sin(theta) and gravity
        # returns it in 2*v*sin(theta)/g, covering v times that along the pad.
        # Half again on top, for the suspension extending on the way up.
        #
        # This bound was `len(zs) < 15`, which was fitted against the /12
        # inertia and was in fact TIGHTER than ballistics allows: the flight is
        # 0.29 s, or 17 ticks, and the hop had grown to 13 of them.
        flight = (2 * jeep["vAtCrest"]
                  * math.sin(math.radians(jeep["rampAngleDeg"])) / 14.73)
        self.assertLess(len(zs), flight * 60 * 1.5)
        if zs:
            # One contiguous hop, and it starts within a few metres of the crest
            # at z = -10 rather than anywhere on the pad.
            self.assertLess(abs(zs[0] + 10), 4.0)
            self.assertLess(abs(zs[-1] - zs[0]), 3.0)
        # The tank, slower and far heavier, never leaves the deck at all, and
        # neither vehicle does at a walking pace. The airborne window is the
        # whole 200 m pad now, so a hull bouncing 40 m along it would show up
        # here rather than fall off the end of the measurement.
        self.assertEqual(0, self.results["tigerOntoPad"]["airborneOnDeck"])
        self.assertEqual(0, self.results["jeepOntoPadSlow"]["airborneOnDeck"])
        self.assertEqual(0, self.results["tigerOntoPadSlow"]["airborneOnDeck"])

    def test_a_span_overhead_never_lifts_a_vehicle_onto_it(self) -> None:
        # Driving UNDER a bridge whose deck is 8 m up. The shared height overlay
        # this replaced lifted anything at (x, z) onto whatever deck was over it.
        run = self.results["underTheSpan"]
        self.assertTrue(run["passedBeneath"])
        self.assertLess(run["highestBeneath"], 1.0)

    def test_the_hull_sweep_hands_the_collider_the_deck_gate(self) -> None:
        # Two numbers, and the first has to track the surface the wheels are on:
        # the support plus the step a driven vehicle mounts (1 m). On the flat
        # that is 1, on the 1 m pad it is 2 — so a lip within a step is a kerb
        # and a parapet standing above it is still a wall.
        gate = self.results["deckGate"]
        self.assertTrue(gate["asked"])
        self.assertAlmostEqual(1.0, gate["flatStepTop"], places=3)
        self.assertAlmostEqual(2.0, gate["padStepTop"], places=3)
        self.assertEqual(0.5, gate["flatFloorCos"])
        self.assertEqual(0.5, gate["padFloorCos"])



class DrivetrainConstantTests(unittest.TestCase):
    """Every number in `EngineState` against the ledger row that supplies it.

    `Engine::handleUpdate` lnxded `0x0823e120` is the whole gearbox (TANK-12),
    `PhysicsEngine::feedbackLoop` `0x0824c850` the load (TANK-13),
    `getCurrentDifferentialRPM` `0x0824c990` the per-side split and its clamp
    (TANK-9), `EngineTemplate::getEngineType` virtual slot `+0xa0` the type
    bits (TANK-1). These drive the state object with no vehicle around it, so
    a change that happens to look right on a page still has to answer for the
    arithmetic.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- TANK-1: the type is a bitfield, and bit 0 gates updatePhysics -----

    def test_the_engine_type_enum_is_the_jump_tables(self) -> None:
        # Re-derived from the 26-entry jump table at `0x086cf7b0` that
        # `operator<<(ostream&, EngineType)` `0x0823ef60` switches on.
        types = self.results["engineTypes"]
        self.assertEqual(1, types["plane"])
        self.assertEqual(2, types["car"])
        self.assertEqual(6, types["tank"])
        self.assertEqual(9, types["ship"])
        self.assertEqual(0x11, types["rocket"])
        self.assertEqual(0x19, types["torpedo"])
        self.assertEqual(6, types["caseInsensitive"])

    def test_an_unknown_or_absent_type_is_the_constructors_zero(self) -> None:
        # `EngineTemplate::EngineTemplate` writes 0 to `tmpl+0x524` at
        # `0x0823f078`. An invented default would be worse than `reserved`:
        # it is what a mod's unrecognised word has to fall back to. It costs
        # nothing in the installed corpus — all 1,309 ground-vehicle Engines
        # across the 18 installs author `setEngineType`.
        types = self.results["engineTypes"]
        self.assertEqual(0, types["unknown"])
        self.assertEqual(0, types["absent"])

    def test_no_ground_vehicle_type_carries_the_thrust_bit(self) -> None:
        # TANK-7, refuted: `PhysicsEngine::updatePhysics` returns at its
        # second instruction unless `getEngineType() & 1`
        # (`0x0824cc10`-`0x0824cc20`), so `c_ETCar` (2) and `c_ETTank` (6)
        # get no hull thrust at all. `bodyThrust` is gone from `ground.js`
        # because of this and must not come back.
        types = self.results["engineTypes"]
        self.assertFalse(types["carHasThrust"])
        self.assertFalse(types["tankHasThrust"])
        self.assertTrue(types["planeHasThrust"])
        self.assertTrue(types["shipHasThrust"])

    # --- TANK-9: where a tank's 1.0 actually comes from --------------------

    def test_a_cars_diff_rpm_is_the_rev_state_raw(self) -> None:
        # `(type & 4) == 0` returns `PhysicsEngine+0xa0` unclamped and with
        # no split, however far off the centreline the wheel sits — a Willy's
        # rear springs are at x = +-0.6 and must not take a differential.
        rpm = self.results["diffRPMByType"]
        self.assertAlmostEqual(1.2, rpm["carAtCeiling"], places=4)
        self.assertAlmostEqual(1.2, rpm["carSteering"], places=4)
        self.assertAlmostEqual(1.2, rpm["unknownAtCeiling"], places=4)

    def test_a_tanks_ceiling_is_the_differential_clamp_not_the_rev_clamp(self) -> None:
        # The rev clamp is [-1.0, +1.2] for every type alike; `& 4` clamps
        # `revs * (1 -/+ 1.5*steer)` to [-1, +1] at `0x0824ca10`-`0x0824ca2a`,
        # and THAT is why a Sherman tops out at 14.894 and not 17.87.
        rpm = self.results["diffRPMByType"]
        self.assertAlmostEqual(1.0, rpm["tankAtCeiling"], places=4)
        # Half lock: the outer track runs at a quarter, the inner clamps.
        self.assertAlmostEqual(0.25, rpm["tankOuterHalfLock"], places=4)
        self.assertAlmostEqual(1.0, rpm["tankInnerHalfLock"], places=4)
        # Full lock drives the outer track BACKWARDS at half speed — which is
        # why a tracked hull at full lock is very nearly pivoting.
        self.assertAlmostEqual(-0.5, rpm["tankOuterFullLock"], places=4)
        # A wheel dead on the centreline takes neither (`0x0824ca4a`).
        self.assertAlmostEqual(1.2, rpm["tankCentreline"], places=4)

    # --- TANK-3 extended: setNumberOfGears clamps ---------------------------

    def test_the_template_defaults_are_the_constructors(self) -> None:
        # `EngineTemplate::EngineTemplate` `0x0823efc0`: gears 1
        # (`0x0823f018`), differential 10.0, torque 60.0, gearUp 0.7,
        # gearDown 0.3, gearChangeTime 1.0. A `.con` that omits a word gets
        # these, so they are transcribed rather than invented.
        defaults = self.results["engineDefaults"]
        self.assertEqual(1, defaults["numberOfGears"])
        self.assertEqual(10.0, defaults["differential"])
        self.assertEqual(60.0, defaults["torque"])
        self.assertEqual(0.7, defaults["gearUp"])
        self.assertEqual(0.3, defaults["gearDown"])
        self.assertEqual(1.0, defaults["gearChangeTime"])
        # And the live state a fresh PhysicsEngine starts in, including the
        # gear-change lockout's seed of 1.0 (`0x0824c74c`, `0x0824c7cc`).
        self.assertEqual(1, defaults["gear"])
        self.assertEqual(0, defaults["revs"])
        self.assertEqual(1.0, defaults["blend"])

    def test_the_gear_count_is_clamped_to_one_through_five(self) -> None:
        # `setNumberOfGears` `0x0823fd10` clamps to [1,5], so TANK-3's
        # non-monotonic eight-speed ladder is real in the CURVE and
        # unreachable from any `.con`. `gearLadder` deliberately still
        # produces it — it is the curve, and the curve is what is pinned —
        # and the clamp lives where a template is read.
        defaults = self.results["engineDefaults"]
        self.assertEqual(5, defaults["gearsClampedHigh"])
        self.assertEqual(1, defaults["gearsClampedLow"])
        self.assertEqual([5.0, 7.955, 11.667, 15.909, 18.617],
                         defaults["clampedLadder"])
        # The curve's own eight-speed, non-monotonic and never reachable.
        self.assertGreater(defaults["rawEightSpeed"][0],
                           defaults["rawEightSpeed"][1])

    # --- TANK-12: the rev filter -------------------------------------------

    def test_the_rev_filter_gain_is_per_tick_and_is_0_05(self) -> None:
        # `revs += 0.05 * ((T1 - L) - 0.5*revs)`, `ds:0x86c08a8` = 0.05f, and
        # the only `dt` in the whole function is the gear-change lockout's.
        # From rest with T1 already 1 and no load, one tick is exactly 0.05.
        rev = self.results["revFilter"]
        self.assertAlmostEqual(0.05, rev["firstStepFromT1"], places=6)

    def test_the_rev_clamp_is_asymmetric_and_type_independent(self) -> None:
        # `ds:0x86c4f64` = 1.2f ceiling (`0x0823e2f4`), `ds:0x86b05ec` =
        # -1.0f floor (`0x0823e30b`). Both arms apply to a `c_ETTank` too —
        # its 1.0 is the differential's, not this.
        rev = self.results["revFilter"]
        self.assertAlmostEqual(1.2, rev["ceiling"], places=5)
        self.assertAlmostEqual(-1.0, rev["floor"], places=5)

    def test_the_filter_spools_up_over_forty_ticks_not_instantly(self) -> None:
        # Steady state is `revs = 2*(T1 - L)`, reached with a 40-tick time
        # constant — 1.33 s, and LOOP-1 is closed on the 30 Hz that makes it
        # so (`Setup::updateInputs` `0x080bc540` is a fixed-step accumulator;
        # only the tick's own `dt = 1/30` reaches `simulateFrame`). The
        # kinematic `revs = speed / ratio` this replaced had no spool-up.
        trace = {row["tick"]: row for row in self.results["revFilter"]["trace"]}
        self.assertLess(trace[1]["revs"], 0.02)
        self.assertLess(trace[10]["revs"], 0.5)
        self.assertAlmostEqual(1.2, trace[40]["revs"], places=4)

    def test_the_throttle_term_is_the_clipped_roll_angle_over_maxrotation(self) -> None:
        # `T1 = Engine+0x10c / getMaxRotation().z`
        # (`0x0823e1e0`-`0x0823e1f4`), NOT the pedal — so a mod that changes
        # either `setMaxRotation` or the rate changes throttle response, and
        # that is why both had to reach `extras.physics`.
        term = self.results["throttleTerm"]
        self.assertAlmostEqual(0.1, term["willy"]["seconds"], places=2)
        self.assertAlmostEqual(0.1, term["sherman"]["seconds"], places=2)
        # Twice the limit at the same rate: half as far along after one tick.
        self.assertAlmostEqual(1 / 6, term["doubledMaxRotation"], places=4)
        # An Engine with no roll limit has nothing to divide by and falls
        # back to the pedal. No ground vehicle in 18 installs is in that
        # position; all 1,421 author a non-zero `maxRotation.z`.
        self.assertAlmostEqual(0.5, term["noLimit"], places=4)

    def test_the_steering_term_is_the_yaw_angles_sibling(self) -> None:
        # `PhysicsEngine+0xb0` = `Engine+0x104 / maxRotation.x`. A Sherman
        # reaches full lock in 1/4 = 0.25 s; a Willys Engine declares no yaw
        # input or limit at all, so its steering term is identically 0 —
        # which is what makes `getCurrentDifferentialRPM` a no-op for a car
        # even before the type gate.
        term = self.results["steerTerm"]
        self.assertAlmostEqual(0.25, term["shermanSeconds"], delta=0.02)
        # A Willys Engine declares no yaw input or limit at all, so it takes
        # the pre-extract fallback and its steering term reads the raw input
        # rather than 0. **Harmless, and deliberately so**: a `c_ETCar` is
        # `(type & 4) == 0`, so `getCurrentDifferentialRPM` returns the rev
        # state raw and never looks at the steering term. The fallback exists
        # for the tracked hulls, whose whole steering IS the differential and
        # which degraded to a dead stick without it — see
        # `test_a_tree_extracted_before_this_branch_still_steers`.
        self.assertEqual(1, term["carSteer"])

    def test_the_gearbox_rules_are_the_engines(self) -> None:
        # Up: `revs > gearUp` AND `blend == 0` AND `gear < numberOfGears`
        # (`0x0823e391`-`0x0823e3c7`). Down: `revs < gearDown` and
        # `gear > 1`, with NO lockout gate (`0x0823e3d0`-`0x0823e3f1`).
        box = self.results["gearbox"]
        self.assertEqual(1, box["upBlockedByLockout"])
        self.assertEqual(2, box["upWhenFree"])
        self.assertEqual(3, box["downIgnoresLockout"])
        self.assertEqual(1, box["downStopsAtFirst"])

    def test_nothing_re_arms_the_gear_change_lockout(self) -> None:
        # A whole-binary store scan over `[reg+0xb8]` finds four writers and
        # no more: the two `PhysicsEngine` constructors seed 1.0, and
        # `handleUpdate` subtracts `dt/gearChangeTime` and floors it. Not
        # even a gear change re-arms it, so after `gearChangeTime` of the
        # object's life the box can shift one gear per tick — and
        # `setGearChangeTime` is very nearly a dead word. Reproduce with
        # `objdump -d -M intel bf1942_lnxded.static | grep -E
        # '(fstp?|mov) +(DWORD PTR )?\[e..\+0xb8\]'`.
        box = self.results["gearbox"]
        # Sherman 0.05 s at 30 Hz: two ticks.
        self.assertEqual(2, box["lockoutTicksSherman"])
        # The Willys authors none, so it takes the 1.0 s ctor default.
        self.assertEqual(31, box["lockoutTicksWilly"])
        self.assertEqual(0, box["lockoutAfterShift"]["blend"])
        self.assertTrue(box["lockoutAfterShift"]["shifted"])

    def test_the_brake_byte_is_the_pedal_opposing_the_revs(self) -> None:
        # `PhysicsEngine+0xb4` = 1 iff (`P < -0.1` and revs > 0) or
        # (`P > +0.1` and revs < 0) — `ds:0x86cf658` and `ds:0x86ba1d8`, both
        # doubles, read off the RAW input `Engine+0x124` at `0x0823e260`.
        # When it is set `addFriction` discards the whole EngineGrip target
        # (`0x0825c28a`/`0x0825c293`), which is the engine's entire brake.
        cases = {(case["pedal"], case["revs"]): case
                 for case in self.results["brakeByte"]}
        self.assertTrue(cases[(-1, 0.5)]["braking"])
        self.assertEqual(0, cases[(-1, 0.5)]["target"])
        self.assertTrue(cases[(1, -0.5)]["braking"])
        # Inside the +-0.1 dead band it is not a brake.
        self.assertFalse(cases[(-0.05, 0.5)]["braking"])
        self.assertFalse(cases[(0.05, -0.5)]["braking"])
        # Agreeing with the revs is never a brake, and neither is no pedal.
        self.assertFalse(cases[(1, 0.5)]["braking"])
        self.assertFalse(cases[(-1, -0.5)]["braking"])
        self.assertFalse(cases[(0, 0.5)]["braking"])

    # --- TANK-13: the load ---------------------------------------------------

    def test_the_load_is_dv_times_ratio_over_the_torque_curve(self) -> None:
        # `L0 = dot(dV, fwd) * getCurrentRatio() / getCurrentTorque()`
        # (`0x0824c877`, `0x0824c885`, `0x0824c89d`), and `getCurrentTorque`
        # is the TANK-4 curve TIMES `setTorque` (`0x0824cba4 fmul
        # [ecx+0x368]`). So the torque curve is load-bearing drivetrain as
        # the DIVISOR of the load, never a multiplier on drive.
        load = self.results["load"]
        self.assertAlmostEqual(load["expectedSingle"], load["singleSample"],
                               places=5)

    def test_the_load_sample_is_clamped_for_car_and_tank_alike(self) -> None:
        # `& 2` at `0x0824c8ab` clamps `L0` to [-1, +1], and both `c_ETCar`
        # (2) and `c_ETTank` (6) carry the bit.
        load = self.results["load"]
        self.assertAlmostEqual(1.0, load["clampedTank"], places=5)
        # The car's mean applies the 0.99 on top of the clamped sample.
        self.assertAlmostEqual(0.99, load["clampedCar"], places=5)

    def test_a_tank_keeps_the_frames_extreme_and_a_car_its_mean(self) -> None:
        # `& 4` at `0x0824c90f`: the frame MAX of `L0` while revs >= 0 and
        # the MIN while revs < 0. Decoded from `0x0824c91f`'s `fldz; fucompp`
        # (ST = 0.0, SRC = revs, so revs > 0 takes the `jne` to `0x0824c942`,
        # whose `fucom` keeps `L0` only when `L0 > L`). **The v4-gearbox
        # verdict states this pair the other way round**; the max is the one
        # that can hold an engine down and the pair is symmetric in reverse.
        load = self.results["load"]
        self.assertGreater(load["tankKeepsMax"], 0)
        self.assertLess(load["tankKeepsMin"], 0)
        self.assertAlmostEqual(load["tankKeepsMax"], -load["tankKeepsMin"],
                               places=5)
        # The car is a running mean scaled by `ds:0x86d0cdc` = 0.99f.
        self.assertAlmostEqual(0.99, load["meanScale"], places=4)

    def test_a_tank_at_exactly_zero_revs_keeps_the_max(self) -> None:
        # The boundary of the same branch, and it is the MAX arm: `fucompp`
        # sets C3 on equality, `test ah,0x45` at `0x0824c923` is then
        # non-zero, and the `jne` at `0x0824c926` goes to `0x0824c942` — the
        # branch revs > 0 takes. Only `0.0 > revs` falls through to
        # `0x0824c928`'s MIN. Samples -0.3, +0.2, -0.1 at revs = 0 therefore
        # leave +0.2 behind, not -0.3.
        load = self.results["load"]
        self.assertGreater(load["tankAtZeroRevsKeepsMax"], 0)

    def test_every_contacting_part_feeds_the_cars_mean(self) -> None:
        # `addFriction` calls `feedbackLoop` for any part with an `Engine`
        # among its physics-node ancestors (the walk at
        # `0x0825c1b0`-`0x0825c1fa`, storing at `0x0825c556`), not only for
        # driven wheels. A Willy's two `c_PGFRollGrip` fronts hang off
        # `WillyEngine` exactly as its two `c_PGFEngineGrip` rears do, and
        # RollGrip's wanted change is along the axle — perpendicular to the
        # `fwd` the dot product takes — so they feed two honest zeroes and
        # halve the load. That halving is what lets a wheel-spinning jeep sit
        # at `revs = 2*(1 - 0.5) = 1.0`, above `gearUp`, in top gear.
        load = self.results["load"]
        self.assertAlmostEqual(load["carTwoSamples"] / 2,
                               load["carFourWithTwoZeroes"], delta=0.01)

    def test_the_load_accumulator_is_cleared_by_the_tick_that_reads_it(self) -> None:
        # The tail of `handleUpdate` (`0x0823e3f7`-`0x0823e407`) keeps the
        # value in `+0xa8` and zeroes `+0xa4` and `+0xac`, so the samples
        # `addFriction` adds afterwards belong to the NEXT tick.
        cleared = self.results["load"]["clearedOnTick"]
        self.assertGreater(cleared["held"], 0)
        self.assertEqual(0, cleared["after"])
        self.assertEqual(0, cleared["count"])
        self.assertAlmostEqual(cleared["held"], cleared["prev"], places=5)

    # --- the fleet -----------------------------------------------------------

    def test_the_fleet_tops_out_where_the_ladder_and_the_type_say(self) -> None:
        """`ratio_top * 1.2` for a car, `* 1.0` for a tank, and nothing else.

        There is no authored drag on any vanilla ground vehicle — neither
        `setDrag` nor `setMass` nor `setModDrag` nor `setGravityModifier`
        appears anywhere in the vanilla Objects archive — so the ladder and
        the rev cap are the whole of it. Six distinct `setDifferential`
        values landing within about ten per cent of six real road speeds, in
        the right order, is what makes this reading rather than a fit:
        Willys MB 105, M3 half-track 72, M4 Sherman 48, Tiger I 45.
        """
        fleet = self.results["fleetCeilings"]
        self.assertAlmostEqual(112.6, fleet["willy"]["kmh"], delta=0.1)
        self.assertAlmostEqual(80.4, fleet["katyusha"]["kmh"], delta=0.1)
        self.assertAlmostEqual(53.6, fleet["sherman"]["kmh"], delta=0.1)
        self.assertAlmostEqual(46.9, fleet["tiger"]["kmh"], delta=0.1)
        self.assertAlmostEqual(67.0, fleet["m3a1"]["kmh"], delta=0.1)
        # A half-track and a Hanomag share `differential 5, numberOfGears 4`
        # and so share a ceiling; a PzIV shares the Sherman's.
        self.assertEqual(fleet["m3a1"]["kmh"], fleet["hanomag"]["kmh"])
        self.assertEqual(fleet["sherman"]["kmh"], fleet["panzerIV"]["kmh"])

    def test_reverse_is_first_gear_at_the_clamps_lower_arm(self) -> None:
        # The floor is -1.0 against a ceiling of +1.2, so a car reverses at
        # 1/1.2 of first gear. A tank is already clamped to 1.0 by the
        # differential, so its reverse and its first gear match exactly.
        fleet = self.results["fleetCeilings"]
        self.assertAlmostEqual(7.0, fleet["willy"]["reverse"], places=3)
        self.assertAlmostEqual(4.0, fleet["sherman"]["reverse"], places=3)
        self.assertAlmostEqual(5.512, fleet["m3a1"]["reverse"], places=3)


if __name__ == "__main__":
    unittest.main()
