"""A bot driver's collision prediction and side step (ledger AI-95, AI-119).

Every driven ground and boat row of `AIbehaviours.con` registers `Avoid
BBAvoid BBPAvoidCollision2d`. `BBAvoid::calculateUrgency` 0x0855c650 looks
the Mobile plug-in's `avoidCollisionLookAhead` (5 s, both `AITemplateMobile`
ctors 0x085e0bf0 / 0x085e0cb0) ahead through `collisionPredicted` 0x0855d2f0,
which returns 1.0 or 0.0. A predicted hit on an object moving at least
`getPotentialObstacleMaxSpeed` (1.0) adds `mass x |relVel| / |rel|`
(0x0855cf1d..0x0855cf8e); a slower one, or one touching now, is planted as a
potential obstacle (0x0855cee7 -> `addSlowMovingPathfindingObstacle`
0x0855d550). `BBPAvoidCollision2d::createPlan` 0x08586420 turns the hull's
velocity by pi/6 (0x087029c8) away from the other's heading, -pi/6
(0x087029cc) when the two are within 75 deg of head-on (cos -0.2588,
0x087029c4), and drives `BAPAMoveToDirect` to where that line leaves the
hull's box on its map (`AIPathfinding::getBox` 0x0847d110, `getIntersection`
0x08612210), until `1.5 t` (0x086be4d0) or within 1.0 m of it.

Viewer: bot-vehicle.js `HULL_AVOID`, `hullAvoidUrgency`, `hullAvoidTurn`;
bot-route.js `hullAvoid`, `planHullAvoid`, `execHullAvoid`, `predictObstacles`.
The harness runs on the module set `test_bot_ai.py` stages.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_bot_ai import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "hull_avoid_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            if not source.exists():
                raise unittest.SkipTest(f"{source.name} is not in the tree")
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def f32(x: float) -> float:
    import struct
    return struct.unpack("f", struct.pack("f", x))[0]


class HullAvoidTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_retail_constants(self) -> None:
        c = self.r["constants"]
        self.assertEqual(c["lookAhead"], 5.0)
        self.assertEqual(c["movingSpeed"], 1.0)
        self.assertEqual(c["frontCos"], f32(-0.2588))      # 0x087029c4
        self.assertEqual(c["turn"], f32(math.pi / 6))      # 0x087029c8, 0.5235988
        self.assertEqual(c["headOnTurn"], -f32(math.pi / 6))  # 0x087029cc
        self.assertEqual(c["clamp"], 1000)                 # 0x086b1ca8 / 0x086b1cac
        self.assertEqual(c["timeFactor"], 1.5)             # 0x086be4d0
        self.assertEqual(c["arrive"], 1.0)                 # BAPConPosition(point, 1.0)

    def test_a_moving_friend_raises_the_urgency(self) -> None:
        x = self.r["crossing"]
        rel_vel = math.hypot(3, -10)
        self.assertAlmostEqual(x["urgency"], 100 * rel_vel / math.hypot(-6, 20), places=9)
        self.assertEqual(x["best"], "p:cross")
        self.assertGreater(x["t"], 0)
        self.assertLess(x["t"], 5)
        self.assertEqual(x["still"], [])

    def test_a_still_friend_is_an_obstacle_not_an_urgency(self) -> None:
        self.assertEqual(self.r["standing"]["urgency"], 0)
        self.assertIsNone(self.r["standing"]["best"])
        self.assertEqual(self.r["standing"]["still"], ["p:stand"])
        self.assertEqual(self.r["slow"]["urgency"], 0)
        self.assertEqual(self.r["slow"]["still"], ["p:slow"])

    def test_reach_mass_and_self(self) -> None:
        self.assertEqual(self.r["far"]["urgency"], 0)
        self.assertEqual(self.r["far"]["still"], 0)
        self.assertEqual(self.r["pair"]["best"], "h:jeep")
        self.assertEqual(self.r["self"], 0)

    def test_the_turn(self) -> None:
        k = f32(math.pi / 6)
        # Engine frame: driving -z, n = (v.z, -v.x) = (-1, 0); the other
        # heading +x has n . u = -1, so the turn is +pi/6.
        a = self.r["turnCrossPlusX"]
        self.assertAlmostEqual(a["angle"], k, places=7)
        # (cos, sin) applied to the engine's (0, -10): (10 sin, -10 cos); the
        # viewer's z is the engine's negated.
        self.assertAlmostEqual(a["dir"][0], 10 * math.sin(k), places=5)
        self.assertAlmostEqual(a["dir"][1], 10 * math.cos(k), places=5)
        b = self.r["turnCrossMinusX"]
        self.assertAlmostEqual(b["angle"], -k, places=7)
        self.assertAlmostEqual(b["dir"][0], -10 * math.sin(k), places=5)
        self.assertAlmostEqual(self.r["turnHeadOn"]["angle"], -k, places=7)
        self.assertEqual(self.r["turnStill"]["angle"], 0)
        self.assertAlmostEqual(self.r["turnStill"]["dir"][1], 10, places=9)
        # A standing hull turns its heading (+x here).
        rest = self.r["turnFromRest"]
        self.assertAlmostEqual(math.hypot(*rest["dir"]), 1, places=6)

    def test_the_plan_runs_to_the_box_edge(self) -> None:
        p = self.r["plan"]
        self.assertIsNotNone(p)
        self.assertEqual(p["otherId"], "p:cross")
        self.assertAlmostEqual(p["until"], 10 + 1.5 * 1.6, places=9)
        # Along the turned line from the hull at (32.5, -32.5).
        k = f32(math.pi / 6)
        dx, dz = p["point"][0] - 32.5, p["point"][2] + 32.5
        self.assertAlmostEqual(math.atan2(dx, dz), k, places=5)
        self.assertGreater(math.hypot(dx, dz), 1.0)
        # Walled two cells east: the box ends at the wall's line, x <= 36.
        w = self.r["planWalled"]
        self.assertIsNotNone(w)
        self.assertLessEqual(w["point"][0], 36.0 + 1e-9)
        self.assertIsNone(self.r["planBlocked"])
        self.assertIsNone(self.r["planNoBest"])

    def test_the_hull_plants_still_bodies(self) -> None:
        h = self.r["hullPlant"]
        self.assertTrue(h["drives"])
        self.assertEqual(h["planted"], 1)
        self.assertEqual(len(h["obstacles"]), 1)
        o = h["obstacles"][0]
        self.assertEqual(o["id"], "p:stand")
        self.assertEqual(o["r"], 3 + 1.0)
        self.assertEqual(o["unit"], "me")
        self.assertEqual(o["drop"], 5 * 12 + 3)
        self.assertEqual(self.r["hullDrop"], [60])
        # The carrier the hull stands beside is left out; the friend is not.
        self.assertEqual(self.r["enclosedIds"], ["p:stand"])
        self.assertEqual(self.r["gunner"], 0)
        self.assertFalse(self.r["pilot"])


class LandingCraftSeatTests(unittest.TestCase):
    """`BBChangeLandingCraft::calculateUrgency` 0x085602b0: a landing craft's
    seats, not `BBChangeTeleport`'s (the Daihatsu helm <-> gunner flip)."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()["landing"]

    def test_the_factors(self) -> None:
        t = self.r["table"]
        self.assertEqual(t["root"], {"root": 1.0, "self": 1.0, "other": 0.25})            # 0x08560488, 0x08560cc1
        self.assertEqual(t["seatUnderDriver"], {"root": 0.25, "self": 1.0, "other": 0.25})  # 0x08560da1
        self.assertEqual(t["seatShip"], {"root": 1.0, "self": 0.5, "other": 0.25})         # 0x08560dc3
        self.assertEqual(t["seatLand"], {"root": 1.0, "self": 0.25, "other": 0.25})        # 0x08560de5
        self.assertEqual(t["seatAir"], {"root": 1.5, "self": 0.25, "other": 0.25})         # 0x08560df8 / dfe

    def test_a_lone_bot_keeps_the_helm(self) -> None:
        # 67.28 x 0.25 = 16.82 does not beat the helm's 21.94.
        self.assertIsNone(self.r["helm"]["best"])
        self.assertEqual(self.r["helm"]["urgency"], 0)
        # The teleport's 0.5 would have sent them to the gun (the flip).
        self.assertEqual(self.r["helmTeleport"]["best"]["id"], "gunner")

    def test_from_the_gun_to_the_free_helm(self) -> None:
        g = self.r["gunner"]
        self.assertEqual(g["best"]["id"], "root")
        self.assertAlmostEqual(g["best"]["u"], 35.56, places=9)
        self.assertEqual(self.r["gunnerNoOrder"]["best"]["u"], g["best"]["u"])
        self.assertEqual(self.r["gunnerNoOrder"]["urgency"], g["urgency"])
        self.assertEqual(self.r["stayNoPlan"]["urgency"], 0)


if __name__ == "__main__":
    unittest.main()
