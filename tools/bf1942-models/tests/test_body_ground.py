"""`viewer/body-friction.js` and `viewer/body-ground.js`: the Coulomb friction
solver (`ResponsePhysics::addFriction`, `collision-response.md` §8) and
terrain contact + the wheel suspension spring + `ParkedVehicle`
(`checkVsTerrain` §7, `PhysicsSpring::updatePhysics` physics.md §6).

Both modules import real siblings (`rigid-body.js`, and `body-ground.js` also
`body-friction.js`), so — like `test_vehicle_damage.py` — this copies every
module the harness needs into one temp dir, rewriting each file's own
`from './x.js'` imports to `./x.mjs` on the way, and runs `node harness.mjs`.
`body_ground_harness.mjs` covers both files' tests: part (a) of this track's
spec (`addFriction` unit cases) and parts (b)-(d) (`ParkedVehicle` settling,
being shoved, and holding on a slope), against the REAL `rigid-body.mjs`,
`body-contact.mjs` and `crash-damage.mjs`.

Every number asserted below was worked by hand from `collision-response.md`
§7/§8 and `physics.md` §6 (see the comments here and in the harness) — never
read back from either module's own output. The `ParkedVehicle` numbers in
part (b) are the spring law's own equilibrium, derived in THIS file from
`strength`/`damping`/gravity, not copied from a prior run.
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
HARNESS = Path(__file__).resolve().parent / "body_ground_harness.mjs"

GRAVITY = -14.73


def _rewrite_imports(text: str, mapping: dict[str, str]) -> str:
    for old, new in mapping.items():
        text = text.replace(f"from '{old}'", f"from '{new}'")
    return text


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        # Zero-import leaves, copied verbatim.
        shutil.copyfile(VIEWER / "rigid-body.js", work / "rigid-body.mjs")
        shutil.copyfile(VIEWER / "body-contact.js", work / "body-contact.mjs")
        shutil.copyfile(VIEWER / "crash-damage.js", work / "crash-damage.mjs")
        # body-friction.js imports rigid-body.js; body-ground.js imports both.
        bf = _rewrite_imports(
            (VIEWER / "body-friction.js").read_text(),
            {"./rigid-body.js": "./rigid-body.mjs"},
        )
        (work / "body-friction.mjs").write_text(bf)
        bg = _rewrite_imports(
            (VIEWER / "body-ground.js").read_text(),
            {"./rigid-body.js": "./rigid-body.mjs", "./body-friction.js": "./body-friction.mjs"},
        )
        (work / "body-ground.mjs").write_text(bg)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                               capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BodyGroundTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def assertVec(self, actual, expected, places=4, msg=None) -> None:
        self.assertEqual(len(actual), len(expected), msg)
        for a, e in zip(actual, expected):
            self.assertAlmostEqual(a, e, places=places, msg=msg)

    # --- constants and the grip bitfield (physics.md §6) ---------------------

    def test_grip_bitfield_values(self) -> None:
        c = self.results["constants"]
        self.assertEqual(0, c["GRIP_NONE"])
        self.assertEqual(1, c["GRIP_CONTACT"])
        self.assertEqual(2, c["GRIP_ROLL"])
        self.assertEqual(4, c["GRIP_ENGINE"])
        self.assertEqual(8, c["GRIP_ROLL_WHEN_OCCUPIED"])
        self.assertEqual(0x20, c["GRIP_DUMMY"])
        self.assertEqual(0x24, c["GRIP_ENGINE_DUMMY"])
        self.assertEqual(0x80, c["GRIP_STATIC_FRICTION"])

    def test_coulomb_constants(self) -> None:
        c = self.results["constants"]
        self.assertAlmostEqual(9.82, c["COULOMB_GRAVITY"])
        self.assertAlmostEqual(1.5, c["COULOMB_KINETIC_COEFFICIENT"])
        self.assertAlmostEqual(1.5, c["COULOMB_STATIC_MULTIPLIER"])
        self.assertAlmostEqual(0.1, c["WAKE_CONTACT_SPEED_SQ"])
        self.assertAlmostEqual(30, c["SIMULATION_FPS"])
        # R1/V1: the same rodata address rigid-body.js's ROTATION_THRESHOLD_SQ
        # cites, read back as 1.0000001e-6, one ULP off a round 1e-6.
        self.assertAlmostEqual(1.0000001e-6, c["FRICTION_MIN_MAGNITUDE_SQ"], places=12)

    def test_parked_grip_rewrite(self) -> None:
        # physics.md §6 / R1 F9: RollGripWhenOccupied (8) alone becomes
        # ContactGrip|RollGripWhenOccupied (9) for an unoccupied vehicle;
        # a flag with no bit 8 passes through unchanged.
        r = self.results["parkedGrip"]
        self.assertEqual(9, r["rollGripWhenOccupiedAlone"])
        self.assertEqual(9, r["rollGripPlusOccupied"])  # 8|2 also -> 9 (empty overrides which grip bit)
        self.assertEqual(1, r["plainContact"])
        self.assertEqual(0, r["noGrip"])

    # --- (a) addFriction: ContactGrip slide, clamped to limKinetic ----------

    def test_contact_grip_slide_clamps_to_kinetic_limit(self) -> None:
        # mu=1, N.y=1: limKinetic = 1*1*1.5*9.82/30 = 0.491 m/s per tick.
        lim_kinetic = 1.0 * 1.0 * 1.5 * 9.82 / 30
        self.assertAlmostEqual(0.491, lim_kinetic, places=6)

        r = self.results["addFriction"]["contactGripSlide"]
        # dV = -Vt = (-5,0,0) (gravity's V.y += g/30 is exactly cancelled by
        # removing the flat normal's own y-component); |dV|=5 >> limKinetic,
        # so F is dV scaled to exactly limKinetic, opposite the 5 m/s slide.
        self.assertVec(r["result"]["F"], [-lim_kinetic, 0, 0], places=6)
        self.assertFalse(r["result"]["latched"])
        # addFrictionAt receives F*30 = limKinetic*30 = 14.73 m/s^2.
        self.assertEqual(1, len(r["frictionAtCalls"]))
        self.assertVec(r["frictionAtCalls"][0]["f"], [-14.73, 0, 0], places=5)
        self.assertVec(r["frictionAtCalls"][0]["p"], [0, 0, 0], places=6)

    def test_static_latch_sets_holds_breaks(self) -> None:
        lim_kinetic = 1.5 * 9.82 / 30
        lim_static = 1.5 * lim_kinetic
        self.assertAlmostEqual(0.7365, lim_static, places=6)

        calls = self.results["addFriction"]["latchSequence"]
        # Call 1: |dV|=0.3 < limKinetic -> fits inside, the latch SETS, F
        # unclamped (full 0.3).
        self.assertVec(calls[0]["F"], [-0.3, 0, 0], places=6)
        self.assertTrue(calls[0]["latched"])
        # Call 2: |dV|=0.6, ABOVE limKinetic but within limStatic -> the
        # latch HOLDS (hysteresis) and F passes through unclamped at 0.6,
        # even though that already exceeds limKinetic.
        self.assertVec(calls[1]["F"], [-0.6, 0, 0], places=6)
        self.assertTrue(calls[1]["latched"])
        # Call 3: |dV|=1.0 > limStatic -> the latch BREAKS and F is scaled
        # down to exactly limKinetic.
        self.assertVec(calls[2]["F"], [-lim_kinetic, 0, 0], places=6)
        self.assertFalse(calls[2]["latched"])

    def test_side_on_ram_zero_coulomb_but_resistance_and_sample_survive(self) -> None:
        r = self.results["addFriction"]["sideOnRam"]
        # N.y == 0 (a purely horizontal contact normal) -> limKinetic ==
        # limStatic == 0, so the Coulomb term clamps to exactly zero...
        self.assertVec(r["result"]["F"], [0, 0, 0], places=9)
        # ...but the resistance term is independent of the clamp: Vt = V =
        # (0, -0.491, 5) here (N.x=1 removes nothing from V since V.x=0),
        # accel = -0.02 * Vt = (0, 0.00982, -0.1).
        self.assertEqual(1, len(r["accelCalls"]))
        self.assertVec(r["accelCalls"][0], [0, 0.00982, -0.1], places=6)
        # ...and addFrictionAt still gets called, with a (zero) sample.
        self.assertEqual(1, len(r["frictionAtCalls"]))
        self.assertVec(r["frictionAtCalls"][0]["f"], [0, 0, 0], places=9)

    def test_engine_dummy_exit_no_sample_no_reset(self) -> None:
        r = self.results["addFriction"]["engineDummyExit"]
        self.assertFalse(r["result"]["applied"])
        self.assertTrue(r["result"]["spin"])
        self.assertIsNone(r["result"]["F"])
        self.assertEqual(0, r["frictionAtCallCount"])
        self.assertEqual(0, r["accelCallCount"])
        self.assertTrue(r["countUnchanged"])
        self.assertTrue(r["avgSpeedUnchanged"])

    def test_no_contact_and_no_grip_clear_the_latch(self) -> None:
        for key in ("noContactExit", "noGripExit"):
            r = self.results["addFriction"][key]
            self.assertFalse(r["result"]["applied"])
            self.assertFalse(r["result"]["spin"])
            self.assertIsNone(r["result"]["F"])
            self.assertEqual(0, r["liveGripAfter"])

    def test_roll_grip_removes_only_axle_component(self) -> None:
        # avgSpeed=(3,0,4), axle=(1,0,0): Vt=(3,0,4) (flat ground cancels the
        # gravity term the same way as the ContactGrip case). Lat = the
        # component of Vt along the axle = (3,0,0); dV = -Lat = (-3,0,0) --
        # the Z (rolling) component of Vt never enters dV at all. |dV|=3 >
        # limKinetic=0.491, so it clamps to exactly that, still pure X.
        lim_kinetic = 1.5 * 9.82 / 30
        r = self.results["addFriction"]["rollGrip"]
        self.assertVec(r["result"]["F"], [-lim_kinetic, 0, 0], places=6)

    def test_engine_grip_uses_callers_surface_speed(self) -> None:
        # avgSpeed=(1,0,0) -> Vt=(1,0,0); T=(3,0,0) (opts.engineSurfaceSpeed);
        # dV = T - Vt = (2,0,0), clamped to +limKinetic (opposite sign from
        # the ContactGrip/RollGrip cases, since T > Vt here).
        lim_kinetic = 1.5 * 9.82 / 30
        r = self.results["addFriction"]["engineGrip"]
        self.assertVec(r["result"]["F"], [lim_kinetic, 0, 0], places=6)

    def test_wake_on_fast_contact_not_slow_never_when_held(self) -> None:
        r = self.results["addFriction"]["wake"]
        self.assertTrue(r["bigSpeedWoke"])
        self.assertTrue(r["bigResultWoke"])
        self.assertFalse(r["smallSpeedWoke"])  # |0.1|^2 = 0.01 <= 0.1 threshold
        self.assertFalse(r["heldNotWoken"])    # sleepiness < 0: never woken

    # --- (b) drop, settle on springs, sleep -----------------------------------

    def test_settles_and_sleeps_within_bounded_ticks(self) -> None:
        s = self.results["settle"]
        self.assertGreater(s["settleTicks"], 0, "never fell asleep")
        self.assertLess(s["settleTicks"], 1000, "took unreasonably long to settle")
        self.assertTrue(s["staysAsleep"])
        self.assertEqual(0, s["finalSleepiness"])

    def test_settle_grip_rewritten_for_unoccupied_vehicle(self) -> None:
        s = self.results["settle"]
        # Every wheel authored RollGripWhenOccupied (8) -> ContactGrip|8 (9),
        # applied once at ParkedVehicle construction (physics.md §6, R1 F9).
        for grip in s["grippAfterConstruction"]:
            self.assertEqual(9, grip)

    def test_settle_rest_height_matches_the_spring_law(self) -> None:
        s = self.results["settle"]
        # physics.md §6's static equilibrium: strength*d_eq*|g|/9.82, summed
        # over N equal wheels sharing the load equally, cancels |g| exactly:
        #   N * strength * d_eq * |g|/9.82 = |g|  =>  d_eq = 9.82 / (N*strength)
        # (the |g| on both sides cancels -- "suspension sag is
        # gravity-invariant by design", physics.md §6).
        n = s["wheelCount"]
        strength = s["strength"]
        d_eq = 9.82 / (n * strength)
        self.assertAlmostEqual(0.0982, d_eq, places=6)

        for displacement in s["finalDisplacements"]:
            self.assertAlmostEqual(d_eq, displacement, places=3)

        # body.pos.y = restOffsetY's negation, minus the equilibrium sag:
        # the wheel's rest offset is -0.5 (0.5 m below the hull origin), and
        # at equilibrium the wheel sits exactly at ground level (0), i.e.
        # body.pos.y + (-0.5) + d_eq == 0.
        expected_y = 0.5 - d_eq
        self.assertAlmostEqual(expected_y, s["finalBodyPos"][1], places=3)

    # --- (c) shove: decelerates and re-sleeps; off-centre yaws --------------

    def test_shove_moves_decelerates_and_sleeps_again(self) -> None:
        c = self.results["shove"]
        self.assertTrue(c["attempted"], "settle never completed -- shove test not run")
        self.assertTrue(c["movedAtAll"])
        self.assertGreater(c["peakSpeed"], 0.1)
        self.assertLess(c["cameToRestTick"], 200)
        self.assertGreater(c["resleptTick"], 0)
        self.assertLess(c["resleptTick"], 1000)
        self.assertAlmostEqual(0.0, c["finalSpeed"], places=6)

    def test_shove_deceleration_bounded_by_mu_g_plus_resistance(self) -> None:
        c = self.results["shove"]
        # §8: "maximum Coulomb deceleration of a whole vehicle is mu*g*N.y
        # however many wheels touch" (friction is a MEAN over touching
        # parts, not a sum) -- mu=1, N.y=1 on flat ground -> mu*|g| = 14.73
        # m/s^2. Resistance (0.02/tick, an acceleration in its own right) and
        # the coupling with vertical settling add a small amount on top; the
        # bound below is generous but still well short of "unbounded".
        bound = 1.0 * abs(GRAVITY) + 0.02 * c["peakSpeed"] + 3.0
        self.assertLessEqual(c["maxDecelPerTick"], bound)

    def test_off_centre_impulse_yaws_the_body(self) -> None:
        c = self.results["shove"]["offCentre"]
        self.assertVec(c["wBefore"], [0, 0, 0], places=6)
        # Impulse (0,0,8) at (+1 in X, +1.5 in Z) from the centre: torque =
        # r x F = (1,0,1.5) x (0,0,8) = (0*8-1.5*0, 1.5*0-1*8, 1*0-0*0)
        #       = (0, -12, 0) -- pure yaw (Y), nothing else.
        self.assertAlmostEqual(0.0, c["wAfterStep"][0], places=2)
        self.assertLess(c["wAfterStep"][1], -0.01)
        self.assertAlmostEqual(0.0, c["wAfterStep"][2], places=2)

    # --- (d) 10-degree slope: static friction holds, no creep ---------------

    def test_slope_settles(self) -> None:
        s = self.results["slope"]
        self.assertGreater(s["settleTicks"], 0, "never fell asleep on the slope")
        self.assertTrue(s["finalSleeping"])

    def test_slope_no_creep_once_asleep(self) -> None:
        # This is exactly what `V.y += GRAVITY/30` (§8) is for: without it,
        # the static latch would be computed against the CURRENT tick's
        # speed only, missing that gravity is about to add a small downhill
        # component next tick, and the body would creep. With it, once
        # asleep the position must not drift at all over many more ticks.
        s = self.results["slope"]
        self.assertEqual(0.0, s["drift"])


if __name__ == "__main__":
    unittest.main()
