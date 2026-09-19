"""`viewer/crash-damage.js` against collision-response.md section 9.

The engine side is `SimpleObject::handleCollision` /
`GameServer::handleCollision` / `handleCollisionObjectVsObject` /
`handleCollisionLandOrWater`. Every number asserted below traces to the spec
(`features/bf1942-engine-reference/subsystems/collision-response.md` section
9) or to the two verification passes that pinned its exact arithmetic:
`features/vehicle-collision-physics/reports/V0-verification-of-L0.md`
(the rate limiter, C7; the object-vs-object product and the soldier branch's
real roles, C8-C9) and `.../V4-verification-of-R4.md` (the material-table
fallback rules, 1.4; the worked numbers, section 6). Nothing here is traced
to the implementation's own output.

Like `test_fall_damage.py`, the module and its harness are copied into a temp
dir and run under plain `node`; the material table is
`tests/fixtures/crash_damage_tables.json`, a hand-picked subset of the real
`viewer/maps/_shared/damage.json` (see the fixture's own `_comment`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "viewer" / "crash-damage.js"
HARNESS = Path(__file__).resolve().parent / "crash_damage_harness.mjs"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "crash_damage_tables.json"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "crash-damage.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        shutil.copyfile(FIXTURE, work / "tables.json")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                               capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CrashDamageTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # -- constants ------------------------------------------------------- #

    def test_constants(self) -> None:
        c = self.results["constants"]
        self.assertEqual(99, c["KILL_MATERIAL"])
        self.assertEqual(37, c["NO_DAMAGE_MATERIAL"])
        self.assertEqual(1, c["WATER_MATERIAL"])
        self.assertEqual(1.0, c["DAMAGE_THRESHOLD"])
        self.assertEqual(8, c["SOLDIER_SPEED_FLOOR"])
        self.assertEqual(1e10, c["KILL_DAMAGE"])
        self.assertEqual(16, c["COLLISION_LIST_SIZE"])
        self.assertEqual(1.0, c["COLLISION_LIST_LIFETIME"])

    # -- material table plumbing, section 9.4 ----------------------------- #

    def test_undefined_material_id_falls_back_to_material_zero(self) -> None:
        m = self.results["materials"]
        self.assertTrue(m["definedIs45"])
        # 37 and 99 are never in the table at all (they are handled by
        # section 9.1 before any material lookup happens); an id nothing
        # defined falls back to material 0's own record either way.
        self.assertTrue(m["undefinedFallsBackToZero"])
        self.assertTrue(m["noIdFallsBackToZero"])

    def test_damage_modifier_is_keyed_by_attgroup_then_defgroup(self) -> None:
        mod = self.results["materials"]["modifier"]
        self.assertAlmostEqual(0.1, mod["willyIntoSpitfireHull"], places=9)
        self.assertAlmostEqual(0.1, mod["spitfireHullIntoWilly"], places=9)

    def test_missing_cell_is_zero_not_a_default(self) -> None:
        # Material 90 has cells as an attacker but effectively none as a
        # defender (section 9.4): whoever owns a 90 face takes nothing,
        # whoever hits it still pays.
        mod = self.results["materials"]["modifier"]
        self.assertEqual(0.0, mod["willyIntoSpitfireFace90"])
        self.assertAlmostEqual(0.1, mod["face90IntoWilly"], places=9)
        self.assertEqual(0.0, mod["untabulatedPair"])

    def test_material_damage(self) -> None:
        d = self.results["materials"]["damage"]
        self.assertAlmostEqual(1.0, d["willy"], places=9)
        self.assertAlmostEqual(30.0, d["groundDefault"], places=9)

    def test_contact_material_values_defaults(self) -> None:
        # A DEFINED material lacking a field takes the Material::Material()
        # ctor default (1.0 / 0 / 0.01, V4 1.4's "O4 closed"); both 45 and 50
        # in the fixture omit elasticity/resistance, so the average is just
        # the ctor default itself.
        c = self.results["contactValues"]
        self.assertAlmostEqual(1.0, c["bothDefined"]["friction"], places=9)
        self.assertAlmostEqual(0.0, c["bothDefined"]["elasticity"], places=9)
        self.assertAlmostEqual(0.01, c["bothDefined"]["resistance"], places=9)
        # An UNDEFINED id (201, never in the table) takes material 0's own
        # values instead of the ctor defaults directly -- here they agree
        # because material 0 also omits elasticity/resistance, but the
        # resolution path is materially different (this is exactly the case
        # `materials.noIdFallsBackToZero` proves above).
        self.assertAlmostEqual(1.0, c["oneUndefined"]["friction"], places=9)
        self.assertEqual(1.0, c["material0FrictionOnly"])

    # -- angleFactor, section 9.3 / C8 ------------------------------------ #

    def test_angle_mod_one_is_always_one(self) -> None:
        # angleMod 1 (aircraft): a glancing scrape costs as much as a
        # head-on hit.
        self.assertEqual(1.0, self.results["angleFactor"]["aircraftAlwaysOne"])

    def test_square_on_is_one_regardless_of_angle_mod(self) -> None:
        for v in self.results["angleFactor"]["squareOnIsOneRegardlessOfMod"]:
            self.assertAlmostEqual(1.0, v, places=9)

    def test_the_named_worked_point_at_45_degrees(self) -> None:
        # angleMod 0 at 45 degrees between velocity and normal gives
        # sin(cos(45deg) * pi/2) -- the exact literal named in the briefing.
        a = self.results["angleFactor"]
        self.assertAlmostEqual(a["at45DegreesExpected"], a["at45DegreesAngleMod0"],
                               places=9)
        self.assertAlmostEqual(0.8960189359268066, a["at45DegreesAngleMod0"],
                               places=9)

    # -- section 9.3 worked numbers, V4 section 6 -------------------------- #

    def test_willy_into_parked_spitfire_hull(self) -> None:
        r = self.results["willySpitfireSherman"]
        self.assertAlmostEqual(45.0, r["spitfireHull"], places=6)
        self.assertAlmostEqual(22.5, r["willyFromHull"], places=6)

    def test_willy_into_parked_spitfire_material_90_face(self) -> None:
        # Spitfire takes nothing on its "dead" material-90 face, but Willy
        # still pays -- material 90 has no cell as a defender but plenty as
        # an attacker.
        r = self.results["willySpitfireSherman"]
        self.assertEqual(0, r["spitfireFace90"])
        self.assertAlmostEqual(22.5, r["willyFromFace90"], places=6)

    def test_willy_into_sherman_both_sides(self) -> None:
        r = self.results["willySpitfireSherman"]
        self.assertAlmostEqual(22.5, r["shermanFromWilly"], places=6)
        self.assertAlmostEqual(22.5, r["willyFromSherman"], places=6)

    def test_the_damage_gate_straddles_2_2_and_2_3_m_per_s(self) -> None:
        t = self.results["threshold"]
        self.assertEqual(0, t["justUnder"])
        self.assertAlmostEqual(1.058, t["justOver"], places=6)

    # -- section 9.5 worked numbers, V4 section 6 --------------------------- #

    def test_spitfire_into_flat_ground_at_40_m_per_s_30_degrees_down(self) -> None:
        g = self.results["spitfireIntoGround"]
        self.assertAlmostEqual(120.0, g["vertex60"], places=3)
        self.assertAlmostEqual(1200.0, g["vertex61"], places=3)
        self.assertAlmostEqual(6000.0, g["vertex61AgainstRock"], places=3)
        self.assertEqual(0, g["vertex90"])
        self.assertEqual(0, g["wheel178"])

    def test_a_willy_survives_landing_on_its_wheels(self) -> None:
        w = self.results["willyLanding"]
        self.assertAlmostEqual(30.0, w["onHull"], places=6)
        self.assertTrue(w["onWheelIsNoDispatch"])

    def test_water_only_with_the_flag_and_no_threshold_gate(self) -> None:
        w = self.results["water"]
        self.assertEqual(0, w["withoutFlagIsZero"])
        # Below the 1.0 threshold, but NOT zeroed -- unlike the land formula,
        # which would zero the identical geometry.
        self.assertGreater(w["noGateBelowThreshold"], 0)
        self.assertLess(w["noGateBelowThreshold"], 1.0)
        self.assertAlmostEqual(0.6, w["noGateBelowThreshold"], places=6)
        self.assertEqual(0, w["landEquivalentWouldBeZero"])

    # -- section 9.1 classification ---------------------------------------- #

    def test_classify_contact(self) -> None:
        c = self.results["classify"]
        self.assertEqual("kill", c["otherIsKill"])
        # matOther == 99 is the only kill condition -- matSelf carrying 99
        # does not make the contact a kill.
        self.assertEqual("normal", c["selfIsKillDoesNotMatter"])
        self.assertEqual("none", c["selfIsNoDamage"])
        self.assertEqual("none", c["otherIsNoDamage"])
        self.assertEqual("normal", c["ordinary"])

    # -- CollisionList, section 9.2, C7 -------------------------------------- #

    def test_the_rate_limiter_expires_at_exactly_one_second(self) -> None:
        r = self.results["rateLimiterTiming"]
        self.assertFalse(r["emptyHasNothing"])
        self.assertTrue(r["hasRightAfterAdd"])
        self.assertTrue(r["stillThereAtPoint99"])
        self.assertFalse(r["goneAfterOneSecond"])

    def test_a_second_add_shares_the_one_second_budget(self) -> None:
        # timer = max(0, 1.0 - sum of queued timers): adding "b" right after
        # "a" leaves it a timer of (about) 0, so it expires on the very next
        # tick along with "a".
        r = self.results["secondAddSharesTheBudget"]
        self.assertTrue(r["hasAOnAdd"])
        self.assertTrue(r["hasBOnAdd"])
        self.assertTrue(r["aGoneAfterOneTick"])
        self.assertTrue(r["bGoneAfterOneTick"])

    def test_terrain_and_an_object_are_separate_entries(self) -> None:
        r = self.results["terrainAndObjectAreSeparateEntries"]
        self.assertTrue(r["hasTerrain"])
        self.assertTrue(r["hasObj"])

    def test_the_sixteenth_entry_evicts_the_oldest(self) -> None:
        r = self.results["sixteenthEvictsOldest"]
        self.assertFalse(r["firstStillThere"])
        self.assertEqual(list(range(1, 16)), r["liveIndices"])
        self.assertEqual(15, len(r["liveIndices"]))

    # -- soldier branches, C8's written-out form ----------------------------- #

    def test_soldier_raw_speed_floor(self) -> None:
        r = self.results["soldierRawFloor"]
        self.assertEqual(0, r["below"])
        # At exactly 8 m/s the engine's own "return if 0 > V-8" does not
        # return -- the boundary is inclusive of 8.
        self.assertGreater(r["atFloorIsNotZeroSpeedFactor"], 0)

    def test_soldier_vprime_combines_both_projections(self) -> None:
        r = self.results["soldierVprime"]
        self.assertAlmostEqual(72.0, r["attackerOnly"], places=6)
        # Doubling the attacker's own projection quadruples the damage
        # (V'^2).
        self.assertAlmostEqual(4.0,
                               r["doubledAttacker"] / r["attackerOnly"], places=6)
        self.assertAlmostEqual(200.0, r["victimContributesPastFloor"], places=6)
        # A victim projection under the 8 m/s floor contributes nothing.
        self.assertAlmostEqual(r["attackerOnly"],
                               r["victimUnderFloorContributesNothing"], places=6)

    def test_soldier_branch_has_no_attacker_damage_mod(self) -> None:
        self.assertTrue(self.results["soldierHasNoAttackerDamageModParam"])

    def test_terrain_soldier_variant_matches_fall_damages_own_shape(self) -> None:
        # This is the same arithmetic fall-damage.js implements for a plain
        # fall, reached through crash-damage.js's ids-plus-table-lookup call
        # shape instead of precomputed scalars -- both must land on the same
        # number.
        t = self.results["terrainSoldier"]
        self.assertAlmostEqual(2.16, t["straightDownV12F4"], places=6)
        self.assertAlmostEqual(t["expectedFromFallDamageShape"],
                               t["straightDownV12F4"], places=9)

    # -- CrashDamage glue, section 9.1/9.2/9.7 -------------------------------- #

    def test_crash_damage_worked_contact_both_sides(self) -> None:
        c = self.results["crashDamageWorkedContact"]
        self.assertAlmostEqual(45.0, c["spitfireResult"]["damage"], places=6)
        self.assertFalse(c["spitfireResult"]["kill"])
        self.assertEqual([45, 60], c["spitfireResult"]["effectCell"])
        self.assertAlmostEqual(22.5, c["willyResult"]["damage"], places=6)
        self.assertEqual([60, 45], c["willyResult"]["effectCell"])

    def test_crash_damage_rate_limiter(self) -> None:
        self.assertIsNone(self.results["crashDamageRateLimited"])
        e = self.results["crashDamageRateLimiterExpiry"]
        self.assertIsNone(e["stillLimitedAtPoint99"])
        self.assertTrue(e["firesAgainAfterOneSecond"])

    def test_crash_damage_kill_material(self) -> None:
        k = self.results["crashDamageKill"]
        self.assertEqual(1e10, k["result"]["damage"])
        self.assertTrue(k["result"]["kill"])
        self.assertIsNone(k["result"]["effectCell"])
        # Spec-ordering read: the 99 check is the first bullet in section
        # 9.1, before the Armor walk that owns isInColList/addColObject, so
        # a kill contact never touches the rate limiter.
        self.assertTrue(k["listUntouched"])

    def test_crash_damage_no_damage_material_both_directions(self) -> None:
        n = self.results["crashDamageNoDamageMaterial"]
        self.assertIsNone(n["victimIsWheel"])
        self.assertIsNone(n["attackerIsWheel"])
        # Material 37 is checked before the rate limiter too -- neither
        # direction leaves a trace in the victim's CollisionList.
        self.assertTrue(n["listUntouchedA"])
        self.assertTrue(n["listUntouchedB"])

    def test_unregistered_attacker_defaults_to_damage_mod_one(self) -> None:
        u = self.results["unregisteredAttackerDefaultsToOne"]
        self.assertAlmostEqual(45.0, u["unregistered"]["damage"], places=6)
        self.assertAlmostEqual(90.0, u["registeredWithDoubleDamageMod"]["damage"],
                               places=6)

    def test_crash_damage_terrain_contact_and_shared_list(self) -> None:
        t = self.results["crashDamageTerrainContact"]
        self.assertAlmostEqual(60.0, t["terrainHit"]["damage"], places=6)
        self.assertAlmostEqual(45.0, t["objectHit"]["damage"], places=6)
        # An object contact on the same victim did not reset the terrain
        # entry's own one-second clock -- they share the ring but not a
        # timer.
        self.assertIsNone(t["terrainAgainIsLimited"])

    def test_crash_damage_soldier_run_over(self) -> None:
        r = self.results["crashDamageSoldierRunOver"]
        self.assertAlmostEqual(200.0, r["damage"], places=6)
        self.assertFalse(r["kill"])


if __name__ == "__main__":
    unittest.main()
