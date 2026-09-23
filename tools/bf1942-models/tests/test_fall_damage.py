"""`viewer/fall-damage.js` against HP-14, through node.

The module is the engine's soldier fall formula
(`GameServer::handleCollisionLandOrWater`, lnxded 0x08154960) and nothing else.
Every constant below carries the address it was read from, and the two
landmarks at the end -- first damage near 4 m, death near 7.5 m for a 30 HP
soldier at g = -14.73 -- are what the whole thing has to produce when a real
`SoldierBody` is dropped onto real ground and billed.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HARNESS = Path(__file__).resolve().parent / "fall_damage_harness.mjs"


def run_harness() -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for name in ("fall-damage", "physics"):
            shutil.copy(ROOT / "viewer" / f"{name}.js", work / f"{name}.mjs")
        # `physics.js` imports `./parachute.js` by that name, so this one keeps
        # its own; the `package.json` above is what lets node read a bare `.js`
        # as a module.
        shutil.copy(ROOT / "viewer" / "parachute.js", work / "parachute.js")
        shutil.copy(ROOT / "viewer" / "swim.js", work / "swim.js")
        # The modules `physics.js` re-exports from, under their own names.
        for name in ("point-body", "fixed-step"):
            shutil.copy(ROOT / "viewer" / f"{name}.js", work / f"{name}.js")
        shutil.copy(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        return json.loads(proc.stdout)


class FallDamageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # -- the constants ------------------------------------------------------ #

    def test_the_constants_are_the_engines(self) -> None:
        c = self.results["constants"]
        # 0x086c08c0, raw `00 00 00 41`. The one the first pass missed.
        self.assertEqual(8.0, c["speedOffset"])
        self.assertEqual(30.0, c["speedSaturation"])
        self.assertEqual(10.0, c["speedLerpFrom"])
        self.assertEqual(20.0, c["speedLerpSpan"])
        self.assertEqual(2.0, c["heightLerpFrom"])
        self.assertEqual(3.0, c["heightSaturation"])
        self.assertEqual(2.0, c["heightFree"])
        # `fucom st(1)` against 1.0 at 0x08154c6b.
        self.assertEqual(1.0, c["threshold"])
        # Vanilla soldier: SpeedMod 0.5, Material 40, HitPoints 30.
        self.assertEqual(0.5, c["speedMod"])
        self.assertEqual(40, c["soldierMaterial"])
        self.assertEqual(30, c["hitPoints"])

    def test_the_per_surface_scalars_come_from_the_damage_tables(self) -> None:
        # HP-14: for every terrain material 0-15, `materialDamage = 30` and
        # `damageMod(ground, 40) = 0.001`, so M1 * M2 = 0.030. That product is
        # what the old fitted `FALL_KINETIC_HP` was standing in for.
        scalars = self.results["scalars"]
        self.assertAlmostEqual(0.001, scalars["dryDirt"]["damageMod"], places=9)
        self.assertAlmostEqual(30.0, scalars["dryDirt"]["materialDamage"], places=6)
        self.assertAlmostEqual(0.030, scalars["product"], places=9)
        # Water is the outlier, about 67x gentler.
        self.assertAlmostEqual(1.5e-05, scalars["water"]["damageMod"], places=12)
        self.assertAlmostEqual(
            0.001 / 1.5e-05, 66.67, delta=0.1)

    def test_an_unlisted_material_pair_does_no_damage(self) -> None:
        # DMG-1, and deliberately not a fallback to `defaultDamageMod`: that
        # field is 0.0 for the life of the process and no console word can
        # reach it, so an unlisted pair really does mean nothing happens.
        self.assertIsNone(self.results["scalars"]["unlisted"]["damageMod"])
        self.assertEqual(0, self.results["unlistedPairIsNoDamage"])

    # -- the formula, term by term ------------------------------------------ #

    def test_the_eight_comes_off_first_and_short_of_it_returns(self) -> None:
        offset = self.results["speedOffset"]
        # Below 8 m/s there is no damage at all, from any height.
        self.assertEqual(0, offset["at7"])
        self.assertEqual(0, offset["at8"])
        # And the kinetic term is `(|v| - 8)^2`, not `|v|^2`: from 10 to 12 m/s
        # the excess doubles, so the severity must quadruple. A raw-speed
        # formula would give (12/10)^2 = 1.44 instead.
        self.assertAlmostEqual(4.0, offset["excess4"] / offset["excess2"], places=6)

    def test_the_height_term_is_squared(self) -> None:
        h = self.results["heightTerm"]
        # `X = 1` below 2 m, so `Q` is pinned at 1 and the two agree.
        self.assertAlmostEqual(h["q1"], h["q1AtTwo"], places=6)
        # Above it `Q = F - 1` and severity goes with `Q^2`: 3 m gives Q = 2
        # and 4 m gives Q = 3, so 4 m is (3/2)^2 = 2.25 times 3 m.
        self.assertAlmostEqual(4.0, h["q2"] / h["q1"], places=6)
        self.assertAlmostEqual(2.25, h["q3"] / h["q2"], places=6)

    def test_the_angle_term_is_cubed_on_land_and_squared_in_water(self) -> None:
        a = self.results["angleTerm"]
        # cos 0.5 cubed is 0.125 of a straight-down arrival.
        self.assertAlmostEqual(0.125, a["glancing"] / a["straightDown"], places=6)
        # Water squares it instead -- 0.25 -- so relative to its own straight
        # arrival it keeps twice as much. (The absolute numbers differ by the
        # material scalars; this compares the shape, not the scale.)
        self.assertAlmostEqual(2.0, (a["glancingSquared"] / a["glancingCubed"]),
                               places=6)

    def test_the_angle_term_is_erased_by_height_and_by_speed(self) -> None:
        a = self.results["angleTerm"]
        # At or above 3 m of fall, `A` saturates to 1 and the angle stops
        # mattering at all.
        self.assertAlmostEqual(a["glancingHigh"], a["straightHigh"], places=6)
        # And likewise above 30 m/s of *excess* speed.
        self.assertAlmostEqual(a["glancingFast"], a["straightFast"], places=6)

    def test_severity_is_delivered_only_above_one(self) -> None:
        t = self.results["threshold"]
        # The under-threshold case is a real, non-zero product that the engine
        # simply does not deliver -- which is the distinction being tested.
        self.assertEqual(0, t["justUnder"])
        self.assertGreater(t["justUnderRaw"], 0.8)
        self.assertLess(t["justUnderRaw"], 1.0)
        self.assertGreater(t["justOver"], 1.0)

    # -- a real body, dropped ----------------------------------------------- #

    def test_the_drop_table_is_monotonic_and_starts_at_nothing(self) -> None:
        table = self.results["dropTable"]
        self.assertTrue(all("never" not in row for row in table), table)
        # Nothing at all below about 3.5 m.
        for row in table:
            if row["height"] <= 3.5:
                self.assertEqual(0, row["hp"], row)
        # And never decreasing with height.
        hps = [row["hp"] for row in table]
        self.assertEqual(hps, sorted(hps), table)

    def test_the_fall_height_is_the_drop_and_not_the_apex(self) -> None:
        # `F` is `getLastCollisionHeight() - pos.y`, and `place` seeds that
        # with where the body was put, so a plain fall bills exactly the drop.
        for row in self.results["dropTable"]:
            self.assertAlmostEqual(row["height"], row["fallHeight"], places=3, msg=row)

    def test_the_impact_speed_is_the_engines_gravity(self) -> None:
        # sqrt(2 g h) at -14.73, sampled before the ground clamp destroys it.
        # Semi-implicit Euler advances the position with the already-updated
        # velocity, so the discrete fall arrives a shade fast -- 2% at 2 m,
        # less further down. Under -9.81 the same drops would be 18% slower,
        # which no tolerance here could absorb.
        for row in self.results["dropTable"]:
            expected = (2 * 14.73 * row["height"]) ** 0.5
            self.assertAlmostEqual(expected, row["impactSpeed"],
                                   delta=0.02 * expected, msg=row)

    def test_first_damage_lands_near_four_metres(self) -> None:
        # HP-14's own landmark, and the one that says the 8.0 is in the right
        # place: without it the formula bites at about 1.5 m instead.
        self.assertAlmostEqual(4.0, self.results["firstDamageHeight"], delta=0.25)

    def test_death_lands_near_seven_and_a_half_metres(self) -> None:
        # 30 HP at g = -14.73. Also the sanity check on the material scalars:
        # they are read from the tables, not fitted, so this number is an
        # output rather than a knob.
        self.assertAlmostEqual(7.5, self.results["lethalHeight"], delta=0.4)

    def test_a_jump_never_costs_hit_points(self) -> None:
        # The take-off and landing speeds match at 6 m/s, which is under the
        # 8.0; and `F` is 0 because the last contact was the floor jumped from.
        jump = self.results["jumpCostsNothing"]
        self.assertIsNotNone(jump["landing"])
        self.assertLess(jump["landing"]["impactSpeed"], 8.0)
        self.assertAlmostEqual(0.0, jump["landing"]["fallHeight"], places=3)
        self.assertEqual(0, jump["hp"])

    def test_falling_into_water_is_far_gentler_than_onto_land(self) -> None:
        wet = self.results["intoWater"]
        dry = self.results["ontoLand"]
        self.assertEqual(1, wet["material"])
        # The same 10 m drop: lethal on land, survivable in the sea.
        self.assertGreaterEqual(dry["hp"], 30)
        self.assertLess(wet["hp"], 30)
        # And the ratio is the two damageMods, 0.001 against 1.5e-05.
        self.assertAlmostEqual(0.001 / 1.5e-05, dry["hp"] / wet["hp"], delta=1.0)


if __name__ == "__main__":
    unittest.main()
