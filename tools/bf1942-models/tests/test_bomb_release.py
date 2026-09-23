"""A plane drops its bombs, and a torpedo bomber's torpedo runs in water.

The viewer half of `features/plane-bombs-and-torpedoes/README.md`, driven under
node through `bomb_release_harness.mjs` against the real `viewer/gunfire.js` --
the same pattern as `test_gunfire_layers.py`.

Every rig in the harness is stamped with the numbers out of the shipped GLBs, so
these are measurements of the page and not of a fixture. What each group pins:

  G-1  `gunfire.js`'s emitter guard no longer discards a weapon with no flash,
       no tracer, no recoil and `velocity 0` -- which is every bomb rack in the
       game, and the single reason no plane in this viewer has ever dropped a
       bomb (ledger BOMB-9).
  G-2  a release is zero muzzle velocity plus the platform's, not the 100 m/s
       `velocity || 100` invented for it (BOMB-8).
  G-6  `setAsynchronyFire` makes the B17 lay a stick of eight one bomb at a
       time, where a dive bomber salvos its pair (BOMB-3).
  BOMB-1 a pull spends one round PER PROJECTILE. A Stuka's `magSize 30` over two
       barrels is fifteen drops of a pair.
  BOMB-5 the partial salvo: on the last round a two-barrel rack drops ONE bomb
       and never goes into ammunition debt.
  G-3  a water contact a `detonateOnWaterCollision 0` round is allowed to
       survive does not end the round; a bomb, which declares no such word,
       still bursts on the sea.
  G-4  the torpedo's floaters, engine and wings reach it, and it floats to a
       running depth instead of sinking.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "bomb_release_harness.mjs"

# `e_WaterTorpedo`'s own `maxDistanceUnderwaterSurface`.
WAKE_MAX_DEPTH = 50

MODULES = {
    "gunfire.js": VIEWER / "gunfire.js",
    "round-visuals.js": VIEWER / "round-visuals.js",
    "round-impact.js": VIEWER / "round-impact.js",
    "projectile-flight.js": VIEWER / "projectile-flight.js",
    "round-launch.js": VIEWER / "round-launch.js",
    "gun-groups.js": VIEWER / "gun-groups.js",
    "gun-cycle.js": VIEWER / "gun-cycle.js",
    "bomb-release.js": VIEWER / "bomb-release.js",
    "torpedo-run.js": VIEWER / "torpedo-run.js",
    "seats.js": VIEWER / "seats.js",
    "seat-survey.js": VIEWER / "seat-survey.js",
    "turret-rig.js": VIEWER / "turret-rig.js",
    "vehicle-occupancy.js": VIEWER / "vehicle-occupancy.js",
    "entry-points.js": VIEWER / "entry-points.js",
    "spawned-craft.js": VIEWER / "spawned-craft.js",
    "fire-state.js": VIEWER / "fire-state.js",
    "seat-dots.js": VIEWER / "seat-dots.js",
    "idle-vehicle.js": VIEWER / "idle-vehicle.js",
    "collision.js": VIEWER / "collision.js",
    "world-collider.js": VIEWER / "world-collider.js",
    "static-index.js": VIEWER / "static-index.js",
    "drivable-mask.js": VIEWER / "drivable-mask.js",
    "collision-materials.js": VIEWER / "collision-materials.js",
    "heightfield.js": VIEWER / "heightfield.js",
    "effects-core.js": VIEWER / "effects-core.js",
    "physics.js": VIEWER / "physics.js",
    "walking-body.js": VIEWER / "walking-body.js",
    "soldier-pose.js": VIEWER / "soldier-pose.js",
    "soldier-locomotion.js": VIEWER / "soldier-locomotion.js",
    "point-body.js": VIEWER / "point-body.js",
    "fixed-step.js": VIEWER / "fixed-step.js",
    "parachute.js": VIEWER / "parachute.js",
    "contact-response.js": VIEWER / "contact-response.js",
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


class BombReleaseTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- G-1 ---------------------------------------------------------------

    def test_a_bomb_rack_gets_a_firing_group(self) -> None:
        g1 = self.results["g1"]
        self.assertEqual(1, g1["groups"])
        self.assertEqual("StukaBombRack", g1["name"])
        self.assertEqual(2, g1["muzzles"])
        # The drag law's frontal area, measured off the drawn body rather than
        # guessed: a 1.8 x 0.4 x 0.4 box's bounding sphere.
        self.assertGreater(g1["boundingRadius"], 0.9)
        self.assertLess(g1["boundingRadius"], 1.1)

    def test_the_guard_still_keeps_out_a_placeholder(self) -> None:
        # No emitters, no tracer, no recoil, `velocity 0` AND nothing drawn to
        # launch. That is what the guard was for and it must stay out: a group
        # for it would own a trigger, a cooldown and a stream of invisible
        # rounds spending collision casts on nobody's behalf.
        self.assertEqual(0, self.results["g1"]["inertGroups"])

    # --- G-2 ---------------------------------------------------------------

    def test_a_released_bomb_leaves_at_the_aircrafts_velocity(self) -> None:
        g2 = self.results["g2"]
        # 80 m/s down -Z and 10 m/s down, which is the Stuka's own motion and
        # nothing else. `velocity || 100` gave these 100 m/s along the muzzle.
        # One frame of gravity and drag has already run by the time this is
        # read, so the y is a quarter of a metre per second past the platform's
        # own -10 and the z is the platform's to three places.
        for vx, vy, vz in g2["velocity"]:
            self.assertEqual(0, vx)
            self.assertAlmostEqual(-10.0, vy, delta=0.3)
            self.assertAlmostEqual(-80.0, vz, places=2)
        for speed in g2["speeds"]:
            self.assertAlmostEqual(80.65, speed, delta=0.1)

    def test_the_pair_appears_at_the_two_wing_barrels(self) -> None:
        # `addFireArmsPosition 3.3/-0.199/0` and `-3.3/...`, 6.6 m apart.
        points = self.results["g2"]["dropPoints"]
        self.assertEqual(2, len(points))
        self.assertAlmostEqual(-3.3, points[0][0], places=3)
        self.assertAlmostEqual(3.3, points[1][0], places=3)

    def test_a_zero_release_does_not_produce_a_nan_gravity_scale(self) -> None:
        # `(speed / authored) ** 2` is 0/0 at a zero release, and a NaN here
        # silently deletes gravity from every bomb in the game.
        self.assertEqual([1, 1], self.results["g2"]["gravityScale"])

    # --- BOMB-1 and BOMB-5 -------------------------------------------------

    def test_one_pull_of_a_dive_bomber_costs_two_rounds(self) -> None:
        g2 = self.results["g2"]
        self.assertEqual(30, g2["ammoBefore"])
        self.assertEqual(2, g2["released"])
        # 28, not 29. This is the assertion the brief said was most likely to be
        # got wrong.
        self.assertEqual(28, g2["ammoAfter"])

    def test_a_thirty_round_magazine_is_fifteen_drops_of_a_pair(self) -> None:
        magazine = self.results["magazine"]
        self.assertEqual(15, magazine["pulls"])
        self.assertEqual(30, magazine["bombs"])
        self.assertTrue(all(step["released"] == 2 for step in magazine["trace"]),
                        magazine["trace"])
        # Two off the counter per pull, all the way down, ending exactly at 0
        # and not at -1 or 1.
        self.assertEqual([28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 0],
                         [step["left"] for step in magazine["trace"]])

    def test_the_partial_salvo(self) -> None:
        partial = self.results["partial"]
        self.assertEqual({"barrels": [0, 1], "rounds": 2}, partial["full"])
        # One round left, two barrels: one bomb, one round, no debt.
        self.assertEqual({"barrels": [0], "rounds": 1}, partial["last"])
        # The `mags == -1` sentinel short-circuits the charge entirely.
        self.assertEqual({"barrels": [0, 1], "rounds": 0}, partial["unlimited"])
        self.assertEqual({"barrels": [0], "rounds": 1}, partial["single"])

    def test_asynchrony_fire_charges_one_round_and_round_robins(self) -> None:
        partial = self.results["partial"]
        self.assertEqual({"barrels": [0], "rounds": 1}, partial["async2of8"])
        self.assertEqual({"barrels": [1], "rounds": 1}, partial["async2of8Next"])

    # --- G-6 ---------------------------------------------------------------

    def test_the_b17_lays_a_stick_of_eight(self) -> None:
        stick = self.results["stick"]
        self.assertEqual(8, stick["bombs"])
        self.assertEqual(0, stick["ammo"])
        # `autoReload 1` with `reloadtime 15` and nine spare magazines.
        self.assertAlmostEqual(15.0, stick["reloading"], places=1)

    def test_the_stick_alternates_barrels(self) -> None:
        # `addFireArmsPosition -1/-0.1/0` then `1/0.1/0`, one per pull.
        xs = self.results["stick"]["barrelX"]
        self.assertEqual([-1, 1, -1, 1, -1, 1, -1, 1], xs)

    def test_the_stick_is_spaced_by_the_rate_of_fire(self) -> None:
        # `roundOfFire 4` is a bomb every 0.25 s; at 60 m/s that is 15 m of
        # along-track spacing, and eight bombs span about 105 m.
        stick = self.results["stick"]
        self.assertAlmostEqual(15.0, stick["spacingMetres"], delta=1.0)
        self.assertAlmostEqual(1.75, stick["releaseTimes"][-1]
                               - stick["releaseTimes"][0], delta=0.1)

    # --- the fall ----------------------------------------------------------

    def test_a_bomb_from_500_metres_falls_and_bursts(self) -> None:
        fall = self.results["fall"]
        # sqrt(2*500/14.73) = 8.24 s, and the drag term is small enough that
        # the answer is still within a fiftieth of it.
        self.assertAlmostEqual(8.24, fall["seconds"], delta=0.05)
        # The pair, both of them.
        self.assertEqual(2, fall["impacts"])
        self.assertEqual("terrain", fall["kind"])
        # Released at 150 m/s: 8.217 s x 150 m of throw, measured 1228.9 m.
        self.assertAlmostEqual(1228.9, fall["throwMetres"], delta=5)

    def test_the_bomb_gets_the_impact_explosion_not_the_fuse_one(self) -> None:
        # `damageType 1` AND `hasCollisionEffect` is the impact path (HP-9d);
        # radius 20, splash material 202, YModOnExplosion 2.0, all authored.
        fall = self.results["fall"]
        self.assertEqual("impact", fall["blast"])
        self.assertEqual(20.0, fall["splashRadius"])
        self.assertEqual(202, fall["splashMaterial2"])
        self.assertEqual(2.0, fall["splashYMod"])

    def test_drag_shortens_the_throw_slightly(self) -> None:
        # The measurement, not an assertion of importance: 250 kg at drag 0.08
        # over a ~1 m bounding radius is a correction of a few metres in 1,200,
        # which is why gravity alone looked right for so long.
        with_drag = self.results["fall"]["throwMetres"]
        without = self.results["fallNoDrag"]["throwMetres"]
        self.assertLess(with_drag, without)
        # 1228.9 m against 1231.9 m: three metres in twelve hundred, a quarter
        # of one per cent.
        self.assertAlmostEqual(3.0, without - with_drag, delta=1.0)

    # --- G-3 ---------------------------------------------------------------

    def test_a_bomb_still_bursts_on_the_sea(self) -> None:
        water = self.results["bombOnWater"]
        self.assertEqual(2, water["impacts"])
        self.assertEqual("water", water["kind"])
        self.assertEqual(0, water["inFlight"])
        self.assertAlmostEqual(0.0, water["y"], places=2)

    def test_a_torpedo_enters_the_water_without_detonating(self) -> None:
        torpedo = self.results["torpedo"]
        self.assertIsNotNone(torpedo["enteredAt"])
        # The contact is swallowed: no impact record, and the round is still
        # alive afterwards.
        self.assertEqual(0, torpedo["impacts"])
        self.assertGreater(len(torpedo["samples"]), 5)

    # --- G-4 ---------------------------------------------------------------

    def test_the_torpedos_parts_are_sorted_by_class(self) -> None:
        parts = self.results["torpedo"]["parts"]
        self.assertTrue(parts["isTorpedo"])
        self.assertEqual(2, len(parts["floaters"]))
        self.assertEqual(1, len(parts["engines"]))
        self.assertEqual(2, len(parts["wings"]))

    def test_two_floaters_out_lift_gravity(self) -> None:
        # 5.9 x 2 = 11.8 is LESS than the engine's 14.73 g and the torpedo would
        # sink; the -9.82 normaliser in PhysicsFloatingBundle::updatePhysics
        # scales each by 1.49995, so the pair reaches 17.70 and it floats.
        probe = dict((row[0], row[1])
                     for row in self.results["torpedo"]["buoyancyByDepth"])
        # Floaters sit 3 m above the body centre, so nothing lifts until the
        # body is 3 m down, and they saturate at 3 + 4.3 = 7.3 m.
        self.assertEqual(0, probe[3])
        self.assertAlmostEqual(17.699, probe[8], places=2)
        self.assertAlmostEqual(17.699, probe[12], places=2)
        # The crossing with gravity is between 6 and 7 m of body depth, which is
        # where the torpedo has to settle.
        self.assertLess(probe[6], 14.73)
        self.assertGreater(probe[7], 14.73)

    def test_the_torpedo_settles_to_a_running_depth_and_stays_wet(self) -> None:
        for name in ("torpedo", "torpedoHigh"):
            torpedo = self.results[name]
            wet = [s for s in torpedo["samples"] if s["depth"] is not None]
            self.assertTrue(wet, name)
            for sample in wet:
                # Never breaches and never dives out of the wake band, so the
                # wake plays for the whole run.
                self.assertGreater(sample["depth"], 0.0, (name, sample))
                self.assertLess(sample["depth"], WAKE_MAX_DEPTH, (name, sample))
                self.assertTrue(sample["running"], (name, sample))
            # The equilibrium the floaters set, and it is arithmetic and not a
            # tuned number: 2 x 5.9 x 1.49995 x ratio = 14.73 gives ratio 0.832,
            # i.e. 3.58 m of floater depth over a 4.3 m hull height, i.e. a body
            # centre 3 + 3.58 = 6.58 m down. Both releases converge on it from
            # different overshoots (14.3 m and 21.8 m).
            self.assertAlmostEqual(6.58, torpedo["finalDepth"], delta=0.1, msg=name)
        self.assertGreater(self.results["torpedoHigh"]["deepest"],
                           self.results["torpedo"]["deepest"])

    def test_the_torpedo_drives_rather_than_coasting(self) -> None:
        # The `c_ETTorpedo` engine's throttle is pinned at 1.0 and the propeller
        # expression accelerates it from its 70 m/s entry. This is the number
        # flagged in BUILD.md as the one most likely to be wrong -- the law is
        # the engine's own and calibrated (the same arithmetic gives a Corsair
        # its real 92 m/s top speed), but `noPropellerEffectAtSpeed 120` makes a
        # torpedo faster than the plane that dropped it.
        torpedo = self.results["torpedo"]
        self.assertGreater(torpedo["finalSpeed"], torpedo["samples"][0]["speed"])
        self.assertAlmostEqual(110.8, torpedo["finalSpeed"], delta=2.0)
        self.assertAlmostEqual(1858, torpedo["ranMetres"], delta=30)

    def test_the_torpedo_runs_straight_and_does_not_steer(self) -> None:
        # BOMB-12: `Torpedo_Engine` binds only `c_PIThrottle` and no steering
        # axis, so there is no guidance anywhere. Dropped straight down -Z, it
        # must not wander in x at all.
        self.assertAlmostEqual(0.0, self.results["torpedo"]["driftX"], places=3)
        self.assertGreater(self.results["torpedo"]["ranMetres"], 200)


if __name__ == "__main__":
    unittest.main()
