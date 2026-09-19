"""`viewer/seats.js` under node: seat survey, occupancy and the manned-gun
aim/fire runtime, exercised with plain `THREE.Object3D` trees rather than a
real extracted glb.

Same pattern as `test_ground.py` — one node run producing a JSON blob, the
vendored three.js stood up as an importable `three` package so `seats.js`
imports byte-for-byte (the file under test is the file the page loads).
`seats.js` has no dependency on `flight.js`/`ground.js`/a GLTFLoader by
design (`VehicleOccupancy`'s `classes` are dependency-injected — see its own
doc), so unlike `test_ground.py` nothing else needs copying alongside it.

The Defgun/Sherman node shapes the harness builds are transcribed from
BRIEFING2.md's own scene survey (control tags, EntryPoint radii, rig axes,
FireArms stats) — the real glb is not in the repository, but this is the same
shape `bf42/assemble.py`/`con.py` produce for both.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "test_seats_harness.mjs"

MODULES = {
    "seats.js": VIEWER / "seats.js",
    # `gunfire.js` and the three modules it imports, so the rate-of-fire
    # cadence below is measured against the real `GunFire.advance`/`setFiring`
    # the page loads rather than a re-implementation of them in the harness.
    "gunfire.js": VIEWER / "gunfire.js",
    "collision.js": VIEWER / "collision.js",
    "physics.js": VIEWER / "physics.js",
    "effects-core.js": VIEWER / "effects-core.js",
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


class SeatsModuleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- classification (GUN-10, verify-r6.md) ------------------------------

    def test_defgun_root_is_a_manned_gun(self) -> None:
        self.assertEqual("gun", self.results["classify"]["defgunRoot"])

    def test_sherman_root_is_a_tank(self) -> None:
        self.assertEqual("tank", self.results["classify"]["shermanRoot"])

    def test_sherman_hull_gunner_seat_is_a_manned_gun(self) -> None:
        self.assertEqual("gun", self.results["classify"]["shermanGunnerSeat"])

    def test_a_root_with_no_engine_motion_or_firearms_is_a_bare_seat(self) -> None:
        self.assertEqual("seat", self.results["classify"]["bareSeat"])

    # --- seat order matches SEAT-24's own reading ---------------------------

    def test_root_is_always_seat_position_zero(self) -> None:
        # SEAT-24 (verify-r5.md): Sherman driver = setSelectKey PIMenuSelect1
        # (position 0, key 1); shermanBrowning_PCO1 = PIMenuSelect2 (position
        # 1, key 2). `order[0]` must be the root regardless of traversal.
        order = self.results["seatOrder"]
        self.assertEqual("Sherman", order[0])
        self.assertEqual("shermanBrowning_PCO1", order[1])

    def test_a_nested_pco_buckets_by_control_tag_not_by_its_own_node_name(self) -> None:
        # Confirmed against the live Wake scene headless this round: a second
        # Sherman instance's `shermanBrowning_PCO1` node is itself renamed
        # `shermanBrowning_PCO1_1` (scene-wide name disambiguation) while its
        # own descendants keep reporting the bare name as `control` --
        # bucketing the PCO by its own (possibly renamed) node name instead
        # split one seat into an empty `.node`-only half and a fully-armed
        # half with no `.node`, and pushed the real gunner to seat position 2.
        r = self.results["renamedGunnerNode"]
        self.assertEqual(["Sherman", "shermanBrowning_PCO1"], r["order"])
        self.assertTrue(r["gunnerSeatExists"])
        self.assertTrue(r["gunnerSeatHasNode"])
        self.assertEqual(["Browning"], r["gunnerSeatFireArms"])
        self.assertEqual(1, r["gunnerSeatAxisCount"])
        self.assertEqual("gun", r["gunnerKind"])

    # --- every PlayerControlObject's own EntryPoint is found ----------------

    def test_findAllVehicleRoots_sees_the_bare_gun_and_the_tank(self) -> None:
        roots = self.results["entryPoints"]["roots"]
        self.assertIn("Defgun", roots)
        self.assertIn("Sherman", roots)
        # Only true PCO roots -- a nested seat is not its own root.
        self.assertNotIn("shermanBrowning_PCO1", roots)

    def test_listEntryPoints_tags_each_door_with_its_own_seat(self) -> None:
        entries = self.results["entryPoints"]["shermanEntries"]
        by_node = {e["node"]: e["seatId"] for e in entries}
        self.assertEqual("Sherman", by_node["ShermanEntry"])
        self.assertEqual("shermanBrowning_PCO1", by_node["ShermanEntry_2"])

    # --- pickNearest: round 3's second disclosed gap ------------------------
    # (SEAT-22's declaration-order convention applied to a tied door; see
    # verify-r5.md and the harness's own comment for the real Sherman/M3A1
    # numbers this is checked against.)

    def test_pickNearest_returns_null_on_an_empty_or_fully_disqualified_list(self) -> None:
        r = self.results["pickNearest"]
        self.assertIsNone(r["emptyIsNull"])
        self.assertIsNone(r["allDisqualifiedIsNull"])

    def test_pickNearest_breaks_an_exact_tie_by_declaration_order(self) -> None:
        r = self.results["pickNearest"]
        self.assertEqual("first", r["exactTieKeepsFirstDeclared"])
        # Order is `candidates`' own order, not always "the first id
        # alphabetically" -- swapping the two swaps which one is "first".
        self.assertEqual("second", r["exactTieKeepsFirstDeclaredReversed"])

    def test_pickNearest_is_not_swayed_by_the_sherman_s_own_measured_float_noise(self) -> None:
        # The actual bug this fixes: a plain `distance < best` compare lets a
        # candidate a few ULPs closer win regardless of declared order --
        # exactly the Sherman's driver/gunner door pair (~1.1e-13 m apart).
        r = self.results["pickNearest"]
        self.assertEqual("first", r["noiseAboveKeepsFirstDeclared"])
        self.assertEqual("first", r["noiseBelowKeepsFirstDeclared"])

    def test_pickNearest_breaks_a_four_way_tie_the_same_way(self) -> None:
        # M3A1's own shape: four passenger EntryPoints compose to a bit-exact
        # (zero-gap) tie at its one side door.
        self.assertEqual("a", self.results["pickNearest"]["fourWayTieKeepsFirstDeclared"])

    def test_pickNearest_still_prefers_a_genuinely_closer_candidate(self) -> None:
        # The tie-break must never mask a real difference -- only noise within
        # TIE_EPSILON is ignored, and TIE_EPSILON (1e-6 m) sits several orders
        # of magnitude below any real gap between two distinct doors.
        self.assertTrue(self.results["pickNearest"]["genuinelyCloserWinsRegardlessOfOrder"])

    def test_pickNearest_never_returns_a_radius_disqualified_candidate(self) -> None:
        self.assertEqual(
            "genuinelyFarther",
            self.results["pickNearest"]["disqualifiedNeverWinsOverAnyRealCandidate"],
        )

    def test_pickNearest_epsilon_is_far_above_measured_noise_and_far_below_a_real_gap(self) -> None:
        # Measured this round (scratchpad/t2/dump.json): the Sherman's own
        # tied doors differ by ~1.1457e-13 m; two genuinely different doors on
        # any vanilla vehicle are metres apart, not micrometres.
        epsilon = self.results["pickNearest"]["epsilon"]
        self.assertGreater(epsilon, 1.1457e-13 * 1000)
        self.assertLess(epsilon, 0.01)

    # --- VehicleOccupancy: drivetrain injection, seat switching -------------

    def test_ensureDrive_builds_lazily_through_the_injected_class(self) -> None:
        occ = self.results["occupancy"]
        self.assertTrue(occ["beforeDriveNull"])
        self.assertTrue(occ["driveIsFakeInstance"])
        self.assertEqual("tank", occ["rootKind"])

    def test_a_gunner_seat_gets_its_own_rig(self) -> None:
        # Was `test_turret_exists_only_for_a_gun_seat`, whose other half
        # asserted that a tank's ROOT never gets one. That was true of the
        # code and false of the game — see
        # `test_a_tanks_driving_seat_aims_its_own_main_gun`.
        occ = self.results["occupancy"]
        self.assertTrue(occ["gunnerTurretIsRig"])
        self.assertEqual(1, occ["gunnerAxisCount"])

    def test_active_fire_arms_scope_to_the_active_seat_only(self) -> None:
        self.assertEqual(["Browning"], self.results["occupancy"]["gunnerFireArms"])

    def test_a_tanks_driving_seat_aims_its_own_main_gun(self) -> None:
        # The defect this closes: `setActiveSeat` asked `classifySeat` for
        # `'gun'`, which is exactly the answer an Engine at the root takes
        # away, so a Sherman's driver got no aim rig — and `applyRig` re-posed
        # `ShermanTower`/`ShermanGunBase` to hull-forward every frame from a
        # surface table nothing writes `c_PIMouseLookX/Y` into. Both axes are
        # in our own extracted data and always were: a free 35 deg/s traverse
        # and a -20..+5 elevation, under the tank's OWN control.
        occ = self.results["occupancy"]
        self.assertEqual("tank", occ["rootKind"])
        self.assertTrue(occ["rootTurretIsRig"])
        self.assertEqual(["pitch", "yaw"], occ["rootTurretAxes"])
        self.assertTrue(occ["rootTurretFreeYaw"])

    def test_the_rig_claims_the_mouse_axes_and_leaves_the_steering_alone(self) -> None:
        # A seat can declare both. The V-100's driving seat carries a turret
        # and a steered front axle, and thirteen vehicles across vanilla and
        # the mods have that shape. The rig takes the two the mouse reaches
        # and no others; the steering bundles stay `applyRig`'s to pose.
        sel = self.results["aimAxisSelection"]
        self.assertEqual(["c_PIMouseLookX", "c_PIMouseLookY"], sel["aimInputs"])
        self.assertTrue(sel["mixedHasAim"])
        self.assertEqual(["pitch", "yaw"], sel["mixedRigAxes"])
        self.assertEqual(["c_PIMouseLookX", "c_PIMouseLookY"], sel["mixedRigInputs"])
        self.assertEqual(["V-100GunBase", "V-100Turret"], sel["mixedRigNodes"])

    def test_an_aim_axis_beats_a_non_aim_one_for_the_same_slot(self) -> None:
        # `surveyVehicle` keeps one bundle per axis NAME. First-wins handed
        # the V-100's `yaw` slot to whichever front wheel it traversed first
        # and left the turret unreachable; an axis the mouse actually reaches
        # now takes the slot from one it does not.
        self.assertEqual("V-100Turret",
                         self.results["aimAxisSelection"]["mixedYawSlotNode"])

    def test_stationary_browning_pitch_prefers_the_movable_axis(self) -> None:
        # Point is first and declares pitch at maxSpeed 0; Rotation owns the
        # real elevation. Without a maxSpeed preference, elevation stays dead.
        sel = self.results["aimAxisSelection"]
        self.assertEqual("StationaryBrowningPoint", sel["browningYawNode"])
        self.assertEqual("StationaryBrowningRotation", sel["browningPitchNode"])

    def test_a_vehicle_with_nothing_to_aim_gets_no_rig(self) -> None:
        # Willy steers and nothing else, so the mouse stays the camera's.
        sel = self.results["aimAxisSelection"]
        self.assertFalse(sel["jeepHasAim"])
        self.assertTrue(sel["jeepTurretNull"])

    def test_a_turret_stays_where_it_was_left_across_a_seat_switch(self) -> None:
        # Rebuilding the rig on every seat change lost the angle: climb from
        # a Sherman's driving seat to its hull gun and back and the tower
        # snapped to hull-forward. One rig per seat, kept.
        across = self.results["turretAcrossSeats"]
        self.assertGreater(across["traversed"], 30.0)
        self.assertTrue(across["rigWhileAwayIsTheGunners"])
        self.assertTrue(across["sameRigOnReturn"])
        self.assertEqual(across["traversed"], across["angleOnReturn"])

    def test_the_mouse_pushed_right_traverses_right(self) -> None:
        # `lookDelta` used to negate before calling `aim`, borrowed from the
        # soldier's own `look()` whose yaw counts the other way, and that
        # landed on top of RIG_SIGN's flip inside `_apply`. The two together
        # inverted both axes on every manned gun in the viewer. +X is the
        # vehicle's own right (TANK-10/12's `side` convention).
        self.assertGreater(self.results["aimSense"]["rightwardsX"], 0.1)

    def test_hitpoints_hud_is_the_roots_shared_by_every_seat(self) -> None:
        # R2-31 (verify-r2.md, corrected): one Armor per vehicle, not per seat.
        occ = self.results["occupancy"]
        self.assertEqual("Vehicle/Icon_sherman.tga", occ["rootHudIcon"])
        self.assertTrue(occ["gunnerHudSameAsRoot"])

    def test_exit_location_falls_back_to_the_root_when_the_seat_has_none(self) -> None:
        self.assertTrue(self.results["occupancy"]["exitLocationFallsBackToRoot"])

    # --- TurretAxis: the engine's velocity servo (ledger GUN-2) -------------
    #
    # Every assertion below pins one clause of GUN-2's closed form, read out
    # of `RotationalBundle::calculateAndClipAngle` (lnxded `0x081d7490`, all
    # 361 instructions re-traced independently in the 2026-09-19 round).

    def test_a_saturated_hand_runs_the_axis_at_its_scaled_maxSpeed(self) -> None:
        # GUN-2: `speed -> sign(acceleration) * input * maxSpeed`. `maxSpeed`
        # is a GAIN, deg/s per unit of input, and what magnitude the client's
        # mouse axis delivers is GUN-2b, still open — so the viewer's own
        # choice is that a saturating hand is input 1 and the ceiling is
        # `maxSpeed * TURRET_SPEED_SCALE`. Sherman 35 * 4 = 140 deg/s, MG42
        # 70 * 4 = 280, both minus the sliver spent ramping to it.
        servo = self.results["turretServo"]
        self.assertAlmostEqual(servo["shermanCap"], servo["shermanDegPerSec"], delta=1.0)
        self.assertAlmostEqual(servo["mg42Cap"], servo["mg42DegPerSec"], delta=3.0)

    def test_the_velocity_register_ramps_at_its_own_acceleration(self) -> None:
        # `|acceleration|` deg/s^2, the axis's own `setAcceleration` when the
        # extract carries it. Scaled alongside the cap so the wind-up TIME is
        # `maxSpeed/acceleration`, the game's own ratio: 350 deg/s^2 against a
        # 35 deg/s cap is a tenth of a second either way.
        servo = self.results["turretServo"]
        self.assertAlmostEqual(140.0, servo["ownAccelAtTenth"], delta=0.5)

    def test_an_axis_without_one_falls_back_and_is_slower(self) -> None:
        # Every glb baked before `con.py` started emitting the magnitude. The
        # fallback is the middle of the confirmed 30–150 band, 90 deg/s^2 —
        # scaled that is 360 deg/s^2, reaching the 140 deg/s cap in ~0.39 s.
        servo = self.results["turretServo"]
        self.assertEqual(90, servo["fallbackAcceleration"])
        self.assertAlmostEqual(36.0, servo["fallbackAccelAtTenth"], delta=0.5)
        self.assertAlmostEqual(140.0, servo["fallbackAccelAtHalf"], delta=0.5)

    def test_there_is_no_input_bank_so_a_flick_does_not_coast(self) -> None:
        # The `+0x128` register a previous reading of this file modelled as a
        # ±40 degree bank of aim is an INPUT BACKLOG in input units, and it
        # exists only under `rememberExcessInput` — which no turret, manned
        # gun or tank in any of 18 installs declares. So a one-frame flick
        # turns the axis by exactly one tick of servo and what follows is only
        # the velocity register ramping down: 1.11 deg in the tick, and under
        # two degrees of travel in the whole second after. The bank model gave
        # the same flick 19.7 deg of coast.
        servo = self.results["turretServo"]
        self.assertAlmostEqual(1.111, servo["flickOneTickDegrees"], delta=0.01)
        self.assertLess(servo["flickCoastDegrees"], 2.0)

    def test_a_bounded_axis_clamps_at_its_declared_bounds(self) -> None:
        # `angle > max -> max`, else `angle < min -> min`, on the authored
        # components and in that order. Nothing zeroes the velocity register
        # at a bound, so a reversed input answers straight off the stop.
        servo = self.results["turretServo"]
        self.assertEqual(servo["declaredMax"], servo["clampedAtMax"])
        self.assertEqual(servo["declaredMin"], servo["afterReverse"])

    def test_the_wrap_gate_is_both_bounds_zero_not_a_zero_width_range(self) -> None:
        # GUN-2's correction, and the one with the most data behind it: the
        # engine wraps only when `minRotation == 0 && maxRotation == 0` (the
        # template default). `min == max == 45` PINS at 45 — 151 input-bound
        # axes across 13 installs author such a range, three of them in
        # vanilla, and the old `lo == hi` rule spun every one of them.
        servo = self.results["turretServo"]
        self.assertTrue(servo["freeWrapped"])
        self.assertEqual(45, servo["zeroWidthRangePins"])

    def test_continuous_rotation_is_added_every_tick(self) -> None:
        # `angle += speed*dt + continousRotationSpeed*dt`, unconditionally, in
        # the non-`automaticReset` path. Fed no input at all, an axis carrying
        # `setContinousRotationSpeed 12` turns 12 degrees in a second; fed a
        # 60 deg/s ask as well, it turns 72 — the term rides on top of the
        # traverse rather than replacing it.
        servo = self.results["turretServo"]
        self.assertAlmostEqual(12.0, servo["continuousOnlyDegrees"], delta=0.2)
        self.assertAlmostEqual(72.0, servo["continuousPlusInputDegrees"], delta=0.5)

    def test_automatic_reset_is_a_rate_law_that_returns_to_rest(self) -> None:
        # A different control law, not a variation: the angle ramps straight
        # toward `input * maxRotation` at `|acceleration|` deg/s — a RATE, so
        # one tick from rest moves exactly `acceleration * dt` — with no
        # velocity register and no continuous term. Release and the target is
        # zero, so the part drives itself home at the same rate. That is what
        # a steering wheel is, and 221 vanilla templates declare it.
        servo = self.results["turretServo"]
        self.assertEqual(servo["wheelRatePerTick"], servo["wheelOneTickDegrees"])
        self.assertEqual(servo["wheelMaxRotation"], servo["wheelHeld"])
        self.assertTrue(servo["wheelSpeedRegisterStaysZero"])
        self.assertEqual(0, servo["wheelHome"])

    def test_a_critically_damaged_vehicle_traverses_at_one_fifth(self) -> None:
        # HP-15, which retires ARM-6. `RotationalBundle::handlePlayerInput`
        # multiplies all three input axes by the double at `ds:0x86c8678` =
        # 0.2 while `SimpleObject+0xee` is set. `step`'s `inputScale` is that
        # multiplier's seam; `map.html` supplies it.
        servo = self.results["turretServo"]
        self.assertAlmostEqual(0.2, servo["criticallyDamagedDegrees"] / servo["healthyDegrees"],
                               delta=0.01)

    # --- FireState: gate order, heat/overheat, reload (GUN-12) --------------

    def test_firing_decrements_ammo_one_per_shot(self) -> None:
        shots = self.results["fireState"]["shots"]
        ammos = [s["ammo"] for s in shots if s["canFire"]]
        self.assertEqual(ammos, sorted(ammos, reverse=True))
        self.assertEqual(3, ammos[0])

    def test_empty_mag_blocks_fire_until_reload_completes(self) -> None:
        shots = self.results["fireState"]["shots"]
        # The 4th attempt (index 3) is after 3 shots emptied a magSize-3 mag.
        self.assertFalse(shots[3]["canFire"])

    def test_reload_takes_about_reloadTime_and_refills_from_the_pouch(self) -> None:
        self.assertTrue(self.results["fireState"]["reloadTookAboutReloadTime"])
        after = self.results["fireState"]["afterReload"]
        self.assertEqual(3, after["ammo"])
        # `numOfMag 2` is two magazines in total, not two spares beside a
        # third in the gun — the same reading map.html's hand weapon has
        # always used (`hw.mags = magazines - 1`, which is what puts a
        # Thompson's confirmed 30/4 on the HUD rather than 30/5). So the
        # fixture starts with one spare and the reload spends it.
        self.assertEqual(0, after["magsLeft"])
        self.assertTrue(after["canFire"])

    def test_heat_clamps_at_one_and_blocks_fire_there(self) -> None:
        # GUN-12's corrected `getHasHeat()` reading (`template+0x300 >
        # template+0x304`) is a different, template-level predicate, not this
        # runtime gate -- see `FireState.canFire`'s own comment. Blocking at
        # heat>=1 on this viewer's [0,1] scale follows the corrected report's
        # Viewer Recipe ("clamp [0,1] ... block fire ... on reaching 1.0"),
        # an approximation of the real trigger, not a confirmed comparison.
        self.assertTrue(self.results["fireState"]["heatClampsAtOne"])

    def test_overheat_blocks_fire_for_the_declared_delay_then_releases_it(self) -> None:
        fs = self.results["fireState"]
        self.assertFalse(fs["overheatedCanFire"])
        self.assertAlmostEqual(2.0, fs["overheatRemainingAfterShots"], delta=0.2)
        self.assertTrue(fs["canFireAfterCooldown"])

    def test_unlimited_ammo_sentinel_never_blocks_on_ammo(self) -> None:
        self.assertTrue(self.results["fireState"]["unlimitedNeverBlocksOnAmmo"])

    # --- held trigger x rate-of-fire, ticked in real time (round 3's bug
    # report: "held the trigger for 25 stepped frames ... ammo stayed at 499
    # of 499") -----------------------------------------------------------

    def test_held_trigger_fires_immediately_not_after_a_full_period(self) -> None:
        # `GunFire.setFiring`'s own "first round leaves immediately": a
        # 5-second-cadence gun (roundOfFire 0.2, the Defgun's own number)
        # still spends its first round well inside a 25-frame (0.42s) window,
        # not only once a whole period has elapsed.
        self.assertEqual(498, self.results["heldTriggerCadence"]["after25Frames"])

    def test_held_trigger_fires_the_second_round_only_after_its_own_period(self) -> None:
        # 400 frames is ~6.7s, past the Defgun's 5s cadence -- exactly one
        # more round than the 25-frame check, not a burst of them.
        self.assertEqual(497, self.results["heldTriggerCadence"]["after400Frames"])

    def test_releasing_the_trigger_stops_the_cadence(self) -> None:
        self.assertEqual(497, self.results["heldTriggerCadence"]["afterRelease"])

    def test_tapping_the_trigger_cannot_outrun_the_rate_of_fire(self) -> None:
        # The defect this pair of assertions exists for: `setFiring` used to
        # zero the cooldown on every rising edge, so a Sherman's cannon
        # (roundOfFire 0.35, one shell every 2.86 s) fired 28 shells in a
        # second of tapping — its whole magazine. Tapping and holding must
        # now agree, because the timer is the gun's, not the trigger's.
        cadence = self.results["triggerCadence"]
        self.assertEqual(1, cadence["tappedShotsInOneSecond"])
        self.assertEqual(4, cadence["heldShotsInTenSeconds"])

    def test_a_rested_gun_is_ready_on_the_press_and_owes_no_backlog(self) -> None:
        # The other half of not resetting on the edge: a gun left idle for
        # ten periods must not have banked ten rounds for the `while` inside
        # `advance` to fire off in the frame the trigger goes down. One shot
        # to start it, one on the press ten seconds later, and no more.
        self.assertEqual(2, self.results["triggerCadence"]["shotsAfterRestingTenSeconds"])

    # --- chainOnShot and readWorldPose: the small plumbing helpers ----------

    def test_chainOnShot_calls_the_previous_handler_then_the_new_one(self) -> None:
        chain = self.results["chainOnShot"]
        self.assertEqual(["first", "second"], chain["order"])
        self.assertTrue(chain["sawGroup"])

    def test_readWorldPose_follows_a_moved_parent(self) -> None:
        pose = self.results["readWorldPose"]
        self.assertEqual([10, 2, 0], pose["before"])
        self.assertEqual([10, 2, 5], pose["after"])

    # --- seat pose animation strings (SEAT-9) ---------------------------------

    def test_a_passenger_seat_carries_its_pose_animation_strings(self) -> None:
        # SEAT-9: `seatAnimationUpperBody`/`seatAnimationLowerBody` name the
        # animation states `setUseSeat` resolves. They come through the assembled
        # glb's `extras.seat.poseAnimation` and the survey carries them as-is.
        pose = self.results["seatPose"]
        self.assertTrue(pose["hasPoseAnimation"])
        self.assertEqual("Ub_PassengerInWilly", pose["upperBody"])
        self.assertEqual("Lb_PassengerInWilly", pose["lowerBody"])

    def test_a_passenger_seat_carries_its_cvm_camera_view_flags(self) -> None:
        # camera-modes.md §3: CVM* booleans say which views (C) a seat offers.
        pose = self.results["seatPose"]
        self.assertEqual({"CVMInside": True, "CVMChase": False}, pose["cameraViewModes"])

    def test_a_driver_seat_has_no_pose_animation(self) -> None:
        # The root seat declares no `seatAnimation*` strings — it falls back to
        # the soldier's own template, so `poseAnimation` stays null.
        self.assertTrue(self.results["seatPose"]["driverHasNoPose"])


if __name__ == "__main__":
    unittest.main()
