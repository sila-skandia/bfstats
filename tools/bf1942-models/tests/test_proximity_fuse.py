"""A flak round bursts on the aircraft it meets, driven by anyone.

Reported from the map viewer: an AA gun's rounds went straight through a
bot-flown plane and every one burst at the same distance in the sky. Two
engine reads are behind the fix (ledger PROX-1..PROX-8,
features/flak-proximity-fuse/README.md):

* `Projectile::handleUpdate` (lnxded 0x0831e940) is a proximity fuse. Past
  `ProximityFusePrimer`, any object within `explodeNearEnemyDistance` that is
  heavier than the round, at most 100,000, and moving at 2.5 m/s or more
  detonates it: the end-of-life burst, splash and all. The three flak shells
  author 10 m. Soldiers never set it off and no team is consulted.
* `Projectile::activate` (0x0831e120) draws `timeToLive` per round from its
  CRD, so the AA gun's `CRD_UNIFORM/0.8/1.4/0` bursts 240..420 m out, not
  always at 240.

The hull is a real `CollisionIndex` owner flown by `setMovedOwner` each tick,
the way `hull-bodies.js` publishes a driven hull, so the cast half of the test
is the one a human's or a bot's aircraft meets.
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
HARNESS = Path(__file__).resolve().parent / "proximity_fuse_harness.mjs"

MODULES = {name: VIEWER / name for name in (
    "gunfire.js", "round-visuals.js", "round-impact.js", "projectile-flight.js",
    "round-launch.js", "proximity-fuse.js", "gun-groups.js", "camera-dof.js", "gun-cycle.js",
    "bomb-release.js", "torpedo-run.js", "idle-vehicle.js",
    "world-collider.js", "static-index.js", "collision-meshes.js",
    "drivable-mask.js", "collision-materials.js", "heightfield.js",
    "effects-core.js", "projectile-damage.js", "crash-damage.js", "physics.js",
    "walking-body.js",
    "soldier-resolve.js", "soldier-pose.js", "soldier-locomotion.js",
    "point-body.js", "fixed-step.js", "parachute.js", "contact-response.js",
)}
MODULES["node_modules/three/three.module.js"] = VIEWER / "vendor" / "three.module.js"
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
        result = subprocess.run(["node", "harness.mjs"], cwd=work,
                                capture_output=True, text=True)
        if result.returncode != 0:
            raise AssertionError(result.stderr[-4000:])
        return json.loads(result.stdout.strip().splitlines()[-1])


class ProximityFuseLawTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_the_table_row_is_the_fuse(self):
        self.assertEqual(self.out["fuse"], {"distance": 10, "primer": 0.1, "mass": 1})
        self.assertIsNone(self.out["offWhenAbsent"])
        self.assertIsNone(self.out["offWhenMinusOne"])
        # A landmine's own mass (130) is what a vehicle has to outweigh.
        self.assertEqual(self.out["massFromSpec"], 130)

    def test_the_primer_is_a_strict_age(self):
        self.assertEqual(self.out["armedAt"], [False, False, True])

    def test_in_air_a_moving_vehicle_within_the_distance_sets_it_off(self):
        law = self.out["law"]
        self.assertTrue(law["movingPlane"])
        self.assertTrue(law["onTheEdge"])
        self.assertFalse(law["outside"])

    def test_a_parked_or_slow_vehicle_does_not(self):
        law = self.out["law"]
        self.assertFalse(law["parkedPlane"])
        self.assertFalse(law["justUnderSpeed"])
        self.assertTrue(law["atSpeed"])

    def test_soldiers_the_round_itself_and_ships_are_skipped(self):
        law = self.out["law"]
        self.assertFalse(law["soldier"])
        self.assertFalse(law["notHeavier"])
        self.assertFalse(law["tooHeavy"])

    def test_no_team_is_consulted(self):
        self.assertTrue(self.out["law"]["noTeamTest"])

    def test_under_water_only_a_heavy_hull_at_height_counts(self):
        wet = self.out["underWater"]
        self.assertTrue(wet["shipAbove"])
        self.assertFalse(wet["lightBoat"])
        self.assertFalse(wet["tooHigh"])


class MovingHullTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_the_cast_meets_the_hull_where_it_flies_not_where_it_was_baked(self):
        run = self.out["throughTheHull"]
        hit = run["hit"]
        self.assertEqual(hit["kind"], "object")
        self.assertEqual(hit["owner"], run["owner"])
        self.assertEqual(hit["material"], 60)
        # The underside of the 2 m box at y = 100, not the bake at x = 1000.
        self.assertAlmostEqual(hit["point"][1], 99.0, delta=0.2)
        self.assertLess(abs(hit["point"][0]), 5.5)
        self.assertTrue(run["bakedEmpty"])
        # A flak shell dies on contact with no burst of either kind.
        self.assertIsNone(hit["blast"])

    def test_a_near_miss_bursts_on_the_moving_hull(self):
        run = self.out["passNear"]
        self.assertTrue(run["proximity"])
        hit = run["hit"]
        self.assertEqual(hit["kind"], "endOfLife")
        self.assertEqual(hit["fusedOn"], run["owner"])
        self.assertEqual(hit["splashRadius"], 20)
        # At the crossing, 100 m up, not at the end of its lifetime.
        self.assertLess(hit["travelled"], 105)
        self.assertGreater(hit["travelled"], 85)

    def test_without_the_fuse_the_same_pass_flies_through(self):
        hit = self.out["noFuseNear"]["hit"]
        self.assertIsNone(hit["fusedOn"])
        self.assertGreater(hit["travelled"], 200)

    def test_a_pass_outside_the_distance_does_not_set_it_off(self):
        hit = self.out["passFar"]["hit"]
        self.assertIsNone(hit["fusedOn"])
        self.assertGreater(hit["travelled"], 200)

    def test_a_parked_hull_in_the_path_does_not_set_it_off(self):
        hit = self.out["parkedNear"]["hit"]
        self.assertIsNone(hit["fusedOn"])

    def test_the_lifetime_is_drawn_from_the_crd(self):
        # `sampleCrd` UNIFORM is a + (1 - rand)(b - a).
        self.assertAlmostEqual(self.out["ttlLow"], 0.8, places=3)
        self.assertAlmostEqual(self.out["ttlHigh"], 1.4, places=3)


if __name__ == "__main__":
    unittest.main()
