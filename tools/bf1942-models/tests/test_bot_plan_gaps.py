"""Four bot plans retail runs that the page did not (the retail inverse gap
audit of 2026-11-12, entries 18, 31, 33 and 39), read on lnxded 2026-11-13.

* **A soldier's Avoid** (ledger AI-192). The Infantery row is `Avoid BBAvoid
  BBPAvoidCollisionInfantery`. `BBAvoid::calculateUrgency` 0x0855c650 is the
  generator a driver runs: a hit predicted inside the Mobile look-ahead (5 s
  for a soldier, AI-119) on a body of the bot's side moving 1.0 m/s or more
  adds `mass x |relVel| / |rel|`. `BBPAvoidCollisionInfantery::createPlan`
  0x08588400 steps along the diagonal of the soldier's velocity on the side
  away from the body (0.7071, 0x08702470), a second of travel long, at 0.3 of
  his speed (0x086c030c) unless the body is behind him, until `1.1 t`
  (0x086c4c08) or within 5.0 m (0x0858a110); with no room in the box he
  stands in, he goes on to his waypoint or stops for the body to pass.
* **A hull's TakeCover** (AI-182). The Tank and ArtilleryDriver rows are
  `TakeCover BBTakeCover BBPTakeCover`. `BBTakeCover::calculateUrgency`
  0x0857c120: fire and spotted occupied units at their strength against the
  hull's class (`/ max(d, 5)`, unaimed fire x 0.8); a cover object within the
  Mobile `coverSearchRadius` is required, scored `coverValue / (d x base)`,
  the point 0.75 R to 3 R behind it; each cover found scales the danger (x
  1.3 a new best, x `0.3 score / best + 1` another); `urgency = (SCurve(max(d,
  10) x 0.1) x Declein(danger) - 0.19) x (1 + Take cover) x mod`.
  `BBPTakeCover::createPlan` 0x085c6b80 drives there and looks at the danger,
  with no pose.
* **A hull's Scout** (AI-181). `BBPScout::createPlan` 0x085c3a70, for a unit
  whose Mobile template is `isTurnable`: `If(ObjectValidYawAiming(dir),
  look and sense, TurnTowardsDirection(dir, 5 deg))`.
* **The throw** (AI-158, AI-183). `soldier_choseThrownWeapon` 0x085cf300:
  the first thrown weapon with ammunition, a strength above 0 and `minRange
  <= d`. `BBPFireInfantery::createPlan` 0x085a3870 throws when no direct
  weapon is to be had, one round, and waits `5 + 5 x rand` s for the next.

Viewer: bot-route.js `footAvoid`, `standingBox`; bot-plans.js
`footAvoidPlan`, `execSoldierMoveToDirect`, `planHullTakeCover`,
`hullScoutTurns`, `hullYawAimValid`, `execHullTurnTo`,
`soldierChoseThrownWeapon`, `fireDecision`; bot-behaviours.js
`HullTakeCoverState`; bot-decision.js `urgencyAvoid`, `urgencyHullTakeCover`.
The harness runs on the module set `test_bot_ai.py` stages.
"""

from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_bot_ai import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "bot_plan_gaps_harness.mjs"
ROOT = Path(__file__).resolve().parent.parent


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
    return struct.unpack("f", struct.pack("f", x))[0]


class _Harness(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()


class SoldierAvoidTests(_Harness):
    def test_retail_constants(self) -> None:
        c = self.r["constants"]["footAvoid"]
        self.assertEqual(c["diagonal"], f32(0.7071))        # 0x08702470
        self.assertEqual(c["aheadSpeed"], f32(0.3))         # 0x086c030c
        self.assertEqual(c["timeFactor"], f32(1.1))         # 0x086c4c08
        self.assertEqual(c["arrive"], 5.0)                  # push 0x40a00000, 0x0858a110
        self.assertEqual(c["push"], 3.0)                    # 0x086c08c8
        self.assertEqual(c["back"], 2.0)                    # push 0x40000000, 0x08589239
        self.assertEqual(c["backSpeed"], 0.5)               # 0x086b05e8
        self.assertEqual(c["stillSpeed"], f32(0.1))         # push 0x3dcccccd, 0x085897b6

    def test_a_friend_walking_at_the_bot_is_predicted(self) -> None:
        h = self.r["headOn"]
        # mass 100 x |relVel| 10 / |rel| 12, met after (12 - 2) / 10 s.
        self.assertAlmostEqual(h["urgency"], 100 * 10 / 12, places=6)
        self.assertEqual(h["best"], "p:a")
        self.assertAlmostEqual(h["t"], 1.0, places=6)
        self.assertTrue(h["changed"])

    def test_a_crossing_friend_is_predicted(self) -> None:
        c = self.r["crossing"]
        self.assertGreater(c["urgency"], 0)
        self.assertGreater(c["t"], 0)
        self.assertLess(c["t"], 5.0)

    def test_what_is_not_scored(self) -> None:
        self.assertEqual(self.r["standing"], 0)    # under 1.0 m/s: the obstacle half's
        self.assertEqual(self.r["abreast"], 0)     # no relative speed
        self.assertEqual(self.r["far"], 0)         # past 5 s of travel
        self.assertEqual(self.r["passenger"], 0)   # a seat that does not drive
        self.assertEqual(self.r["touching"], 0)    # already in contact: the contact rule's (INVENTION)

    def test_the_step_is_the_diagonal_away_from_the_body(self) -> None:
        k = f32(0.7071) * 5
        right, left = self.r["planAheadRight"][0], self.r["planAheadLeft"][0]
        # Walking +z from (32.5, -32.5): the body on +x sends him toward -x.
        self.assertAlmostEqual(right["point"][0], 32.5 - k, places=5)
        self.assertAlmostEqual(right["point"][1], -32.5 + k, places=5)
        self.assertAlmostEqual(left["point"][0], 32.5 + k, places=5)
        self.assertAlmostEqual(left["point"][1], -32.5 + k, places=5)
        for m in (right, left):
            self.assertEqual(m["speed"], f32(0.3))
            self.assertAlmostEqual(m["time"], f32(1.1) * 2, places=6)
            self.assertEqual(m["arrive"], 5.0)

    def test_a_body_behind_leaves_the_speed(self) -> None:
        self.assertTrue(self.r["planBehindFlag"])
        self.assertEqual(self.r["planBehind"][0]["speed"], 1)

    def test_no_room_goes_on_to_the_waypoint_or_stands(self) -> None:
        ahead, behind = self.r["planLaneAhead"][0], self.r["planLaneBehind"][0]
        self.assertEqual(self.r["planLaneAheadBranch"], "B")
        self.assertEqual(ahead["point"], [32.5, 10])
        self.assertEqual(ahead["speed"], 0)            # the body is ahead: stand
        self.assertEqual(ahead["arrive"], 2)           # 2 R
        self.assertEqual(behind["speed"], 1)
        self.assertEqual(self.r["planNoBoxBranch"], "B")
        self.assertEqual(self.r["planNoBox"][0]["speed"], 0)
        self.assertEqual(self.r["planSideA"], "A")
        self.assertEqual(self.r["planSideB"], "B")

    def test_the_plan_is_a_stand_pose_and_a_direct_move(self) -> None:
        self.assertEqual(self.r["planActions"], ["SoldierPose", "SoldierMoveToDirect"])
        self.assertEqual(self.r["planPose"], "stand")
        self.assertEqual(self.r["planOther"], "p:a")
        self.assertTrue(self.r["planKept"])
        m = self.r["planMove"]
        self.assertEqual(m["speed"], f32(0.3))
        self.assertGreater(m["until"], 10)

    def test_the_box_he_stands_in(self) -> None:
        self.assertIsNotNone(self.r["box"])
        self.assertIsNone(self.r["boxBlocked"])

    def test_the_invented_step_is_gone(self) -> None:
        src = (ROOT / "viewer" / "bot-plans.js").read_text()
        self.assertNotIn("AVOID_STEP", src)
        self.assertNotIn("AVOID_TIME", src)


class HullTakeCoverTests(_Harness):
    def test_retail_constants(self) -> None:
        c = self.r["constants"]["hullTakeCover"]
        self.assertEqual(c["unaimedFire"], f32(0.8))        # 0x086d2954 at 0x0857c513
        self.assertEqual(c["minDistance"], 5.0)             # 0x086c5288 at 0x0857d7a8
        self.assertEqual(c["behindNear"], 0.75)             # 0x086ba8cc at 0x0857cba9
        self.assertEqual(c["behindFar"], 3.0)               # 0x086c08c8 at 0x0857cc35
        self.assertEqual(c["widthScale"], f32(0.2))         # 0x086c4f74
        self.assertEqual(c["heightScale"], 0.5)             # 0x086b05e8
        self.assertEqual(c["heightWeight"], 0.75)
        self.assertEqual(c["widthWeight"], 0.25)            # 0x086c08ac
        self.assertEqual(c["portalScale"], f32(0.1))        # 0x086b1ca0 at 0x0857d311
        self.assertEqual(c["newBest"], f32(1.3))            # 0x087023e0
        self.assertEqual(c["otherCover"], f32(0.3))         # 0x086c030c
        self.assertEqual(c["dangerMin"], 10.0)              # 0x086b9314
        self.assertEqual(c["urgencyOffset"], f32(0.19))     # 0x08702868
        self.assertEqual(c["coverSearchRadius"], 50.0)      # every vanilla land hull's word
        self.assertEqual(c["arriveMin"], 4.0)               # 0x086c0304
        self.assertEqual(c["lookTolerance"], f32(0.314))    # push 0x3ea0c49c
        self.assertEqual(c["reuseMoveStatic"], 3.0)         # 9.0 squared, 0x086c08cc
        self.assertEqual(c["reuseMoveObject"], 1.0)

    def test_a_threat_falls_in_an_axis_and_a_diagonal_quadrant(self) -> None:
        for a, b in self.r["quadrants"]:
            self.assertIn(a, (0, 1, 2, 3))
            self.assertIn(b, (4, 5, 6, 7))
        self.assertEqual(len({tuple(q) for q in self.r["quadrants"]}), 4)

    def test_no_cover_no_urgency(self) -> None:
        self.assertEqual(self.r["noCover"], 0)
        self.assertEqual(self.r["noTrace"], 0)

    def test_the_urgency_and_the_point_behind_the_cover(self) -> None:
        h = self.r["house"]
        self.assertAlmostEqual(h["urgency"], self.r["houseByHand"], places=6)
        self.assertGreater(h["urgency"], 0)
        # The enemy at +z 80, the house at -z 30, R 6: 3 R behind it.
        self.assertEqual(h["goal"], [0, -48])
        self.assertEqual(h["dangerId"], "e1")
        self.assertEqual(h["cover"], 7)
        self.assertTrue(h["hull"])
        self.assertTrue(h["changed"])
        self.assertFalse(self.r["houseAgain"])
        # coverValue 60 / (30 m x (0.25 x 0.4 + 0.75 x 1.0)).
        self.assertAlmostEqual(h["score"], 60 / (30 * (0.25 * f32(0.2) * 2 + 0.75)), places=5)
        self.assertEqual(h["scale"], f32(1.3))

    def test_the_base_divides_so_a_low_wall_outscores_a_house(self) -> None:
        p = self.r["pair"]
        self.assertEqual(p["cover"], 8)
        self.assertAlmostEqual(p["scale"], f32(1.3) * f32(1.3), places=6)

    def test_distance_and_fire_terms(self) -> None:
        near, at5 = self.r["nearClamp"]
        self.assertEqual(near, at5)
        self.assertAlmostEqual(near, self.r["nearByHand"], places=6)
        f = self.r["fire"]
        self.assertAlmostEqual(f["aimed"], self.r["fireByHand"][0], places=6)
        self.assertAlmostEqual(f["loose"], self.r["fireByHand"][1], places=6)
        self.assertLess(f["loose"], f["aimed"])
        self.assertIsNone(f["dangerId"])
        self.assertFalse(f["object"])

    def test_portals_and_the_radio(self) -> None:
        self.assertAlmostEqual(self.r["portalScore"], self.r["house"]["score"] / f32(0.1), places=3)
        self.assertAlmostEqual(self.r["radio"], 2 * self.r["house"]["urgency"], places=6)

    def test_the_row_names_the_generator(self) -> None:
        self.assertEqual(self.r["dispatch"], {"foot": False, "tank": True, "noRow": True, "infantryRow": False})

    def test_the_plan_drives_and_looks_with_no_pose(self) -> None:
        p = self.r["coverPlan"]
        self.assertEqual(p["types"], ["InfanteryMoveTo", "MouseTurretLookAt"])
        self.assertEqual(p["arrive"], 6)          # 0.5 x maxSpeed 12
        self.assertEqual(p["waypoint"], [0, 0, -48])
        self.assertEqual(p["look"], [0, 0, 80])
        self.assertEqual(p["poses"], 0)
        self.assertTrue(p["hull"])
        self.assertEqual(self.r["slowArrive"], 4)
        self.assertEqual(self.r["gunnerPlan"], ["MouseTurretLookAt"])

    def test_the_plan_is_kept_until_the_danger_moves(self) -> None:
        self.assertTrue(self.r["coverKept"])
        self.assertTrue(self.r["coverRebuilt"])
        self.assertTrue(self.r["firePlanKept"])

    def test_the_point_is_traced_toward_the_cover(self) -> None:
        # `AIPathfinding::trace` (vt+0x4c at 0x085c6ef4): the last free point.
        x, z = self.r["traceToWall"]
        self.assertEqual(x, 20.5)
        self.assertLessEqual(z, -41.0)       # short of the blocked row at z -41..-40
        self.assertGreater(z, -42.0)
        self.assertEqual(self.r["traceFree"], [20.5, -30.5])
        wx, _, wz = self.r["coverPlanTraced"]
        self.assertGreater(wz, -48.5)        # moved up toward the cover
        self.assertLessEqual(wz, -41.0)      # and stopped at its paint

    def test_a_mesh_tail_gives_its_portals(self) -> None:
        import struct
        sys.path.insert(0, str(ROOT))
        from bf42 import stdmesh
        quad = [(0.0, 0.0, 1.0), (1.0, 0.0, 1.0), (1.0, 2.0, 1.0), (0.0, 2.0, 1.0)]
        body = struct.pack("<III", stdmesh.PORTAL_MAGIC, 3, 1) + struct.pack("<I", 4)
        body += b"".join(struct.pack("<3f", *v) for v in quad) + b"\0" * 16
        tail = struct.pack("<II", 0, len(body)) + body
        self.assertEqual(stdmesh._portals(b"xx" + tail, 2), [quad])
        # No portals (the 54-byte chunk), a named block (cid 1), a short tail.
        empty = struct.pack("<III", stdmesh.PORTAL_MAGIC, 3, 0) + b"\0" * 42
        self.assertEqual(stdmesh._portals(struct.pack("<II", 0, 54) + empty, 0), [])
        self.assertEqual(stdmesh._portals(struct.pack("<II", 1, len(body)) + body, 0), [])
        self.assertEqual(stdmesh._portals(b"\0\0", 0), [])

    def test_the_exporter_carries_the_portals(self) -> None:
        src = (ROOT / "extract_vehicle_ai.py").read_text()
        self.assertIn('out["coverPortals"] = portals', src)
        self.assertIn("coverPortals", (ROOT / "viewer" / "bot-units.js").read_text())
        self.assertIn("vehicleAiCoverPortals", (ROOT / "sim" / "level.mjs").read_text())
        self.assertIn("aiCoverPortals", (ROOT / "sim" / "stage.mjs").read_text())

    def test_the_exporter_carries_the_search_radius(self) -> None:
        src = (ROOT / "extract_vehicle_ai.py").read_text()
        self.assertIn('info["coverSearchRadius"] = p.get("coversearchradius")', src)


class HullScoutTests(_Harness):
    def test_tolerance(self) -> None:
        self.assertEqual(self.r["constants"]["scoutTurn"], f32(0.08726646))   # push 0x3db2b8c2, 0x085c40a5

    def test_a_turnable_hull_turns_to_a_direction_its_gun_cannot_reach(self) -> None:
        s = self.r["scout"]
        self.assertTrue(s["turns"])
        self.assertEqual(s["types"], ["HullTurnTo"])
        self.assertFalse(s["valid"])
        t = self.r["scoutTurning"]
        self.assertEqual(t["throttle"], 1)
        self.assertNotEqual(t["steer"], 0)
        self.assertTrue(t["turning"])
        self.assertEqual(t["sensed"], 0)

    def test_facing_it_the_hull_looks_and_senses(self) -> None:
        f = self.r["scoutFacing"]
        self.assertEqual((f["throttle"], f["steer"]), (0, 0))
        self.assertEqual((f["sensed"], f["looked"]), (1, 1))
        self.assertFalse(f["turning"])

    def test_the_yaw_window(self) -> None:
        self.assertEqual(self.r["scoutTolerance"], [True, False])
        self.assertEqual(self.r["scoutWindow"], [True, False])
        self.assertTrue(self.r["scoutRig"])

    def test_other_units_keep_their_plan(self) -> None:
        self.assertFalse(self.r["scoutSherman"]["turns"])
        self.assertEqual(self.r["scoutSherman"]["types"], ["SoldierPose", "MouseTurretLookAt", "Sense"])
        self.assertEqual(self.r["scoutSoldier"], ["SoldierPose", "MouseTurretLookAt", "Sense"])


class ThrowTests(_Harness):
    def test_retail_constants(self) -> None:
        c = self.r["constants"]["fireThrow"]
        self.assertEqual(c["resetAfter"], 5.0)     # 0x086c5288
        self.assertEqual(c["waitMin"], 5.0)        # fadds 0x086c5288 at 0x085a4db2
        self.assertEqual(c["waitSpan"], 5.0)
        self.assertEqual(c["rounds"], 1)
        self.assertEqual(c["history"], 8)
        self.assertEqual(self.r["states"], {"none": 0, "direct": 1, "throwAtTarget": 2})

    def test_the_thrown_weapon(self) -> None:
        t = self.r["thrown"]
        self.assertEqual(t["at12"], 1)
        self.assertEqual(t["at5"], 1)          # minRange <= d
        self.assertEqual(t["at4_9"], -1)       # inside minRange: none
        self.assertEqual(t["at60"], 1)         # no maxRange test
        self.assertEqual(t["noAmmo"], -1)
        self.assertEqual(t["weak"], -1)        # a strength of 0.9 is the int 0
        self.assertEqual(t["air"], -1)
        self.assertEqual(t["expPack"], -1)     # indirect, not thrown
        self.assertEqual(t["oldData"], 1)
        self.assertEqual(t["oldDataRifle"], -1)

    def test_a_direct_weapon_is_fired(self) -> None:
        self.assertEqual(self.r["decideDirect"], {"state": 1, "weaponIndex": 0})

    def test_the_throw_and_its_clock(self) -> None:
        d1, d2, d3, d4 = self.r["decideThrow"]
        self.assertEqual(d1, {"state": 2, "weaponIndex": 1})
        self.assertEqual(d2["state"], 0)
        self.assertEqual(d3["state"], 0)       # 7.4 s after: the wait is 7.5
        self.assertEqual(d4, {"state": 2, "weaponIndex": 1})
        self.assertEqual(self.r["decideWait"], 7.5)
        self.assertEqual(self.r["decideHistory"], [2, 2])

    def test_no_throw_inside_the_minimum_range(self) -> None:
        self.assertEqual(self.r["decideInside"], {"state": 0, "weaponIndex": -1})

    def test_the_data_starts_over(self) -> None:
        self.assertEqual(self.r["decideAfterGap"], 2)
        self.assertEqual(self.r["decideNewTarget"], 2)

    def test_the_exporter_carries_is_thrown(self) -> None:
        sys.path.insert(0, str(ROOT))
        from bf42.con import AiWeaponTemplate
        self.assertFalse(AiWeaponTemplate(name="x").is_thrown)
        self.assertIn('"isThrown": ai.is_thrown', (ROOT / "extract_loadouts.py").read_text())
        self.assertIn('cmd == "isthrown"', (ROOT / "bf42" / "con.py").read_text())


if __name__ == "__main__":
    unittest.main()
