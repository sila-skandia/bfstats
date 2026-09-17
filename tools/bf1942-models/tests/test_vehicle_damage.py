"""`viewer/vehicle-damage.js`: what a shot does to a vehicle.

The engine side is settled in `features/bf1942-engine-reference/` — ledger rows
HP-1/HP-2/HP-5 for the Armor and the burn cadence, ARM-1/ARM-2 for the
`addArmorEffect` tiers — and nothing asserted here is invented. Two of those
findings are the whole point of the module and are asserted directly:

  - the burn is a flat `hpLostWhileCriticalDamage` once per whole second, **not**
    scaled by `dt` (HP-5), so a Sherman critical at 12 HP takes exactly 8 ticks;
  - a living vehicle's tier is re-evaluated continuously (ARM-1) and clears
    again when it is repaired, because the engine's `Armor+0x128` byte is a
    death latch rather than a first-run latch.

Like `test_armor.py`, this copies the module plus `armor.js` into a temp dir and
runs `node harness.mjs` — the module imports nothing else, so no vendored
three.js is needed.
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
MODULE = ROOT / "viewer" / "vehicle-damage.js"
ARMOR = ROOT / "viewer" / "armor.js"
HARNESS = Path(__file__).resolve().parent / "vehicle_damage_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        module = MODULE.read_text().replace("from './armor.js'", "from './armor.mjs'")
        (work / "vehicle-damage.mjs").write_text(module)
        shutil.copyfile(ARMOR, work / "armor.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class TierSelectionTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_full_health_shows_nothing(self) -> None:
        # The trap in the other direction: a "nearest threshold below" reading
        # of the engine's map lookup would have a pristine Sherman smoking,
        # because 50 is the nearest key below 100.
        tiers = {row["hp"]: row for row in self.results["shermanTiers"]}
        self.assertIsNone(tiers[100]["threshold"])
        self.assertIsNone(tiers[51]["threshold"])

    def test_smoke_tier_starts_at_its_threshold(self) -> None:
        tiers = {row["hp"]: row for row in self.results["shermanTiers"]}
        # At the threshold exactly, not one below it.
        self.assertEqual(50, tiers[50]["threshold"])
        self.assertEqual(["e_PanzDamage"], tiers[50]["names"])
        self.assertEqual(50, tiers[49]["threshold"])
        # Still smoke at 13, one above the fire tier.
        self.assertEqual(50, tiers[13]["threshold"])

    def test_fire_tier_takes_over_and_keeps_burning(self) -> None:
        tiers = {row["hp"]: row for row in self.results["shermanTiers"]}
        # ARM-2: the Sherman's fire tier is authored at exactly its
        # criticalDamage of 12.
        self.assertEqual(12, tiers[12]["threshold"])
        self.assertEqual(["e_PanzFire"], tiers[12]["names"])
        # The lowest matching threshold wins all the way down, so it does not
        # revert to smoke.
        self.assertEqual(12, tiers[11]["threshold"])
        self.assertEqual(12, tiers[1]["threshold"])

    def test_one_tier_can_hold_several_effects(self) -> None:
        # The Spitfire authors two at 65. A "one effect per tier" model drops
        # one of them silently.
        tier = self.results["spitfireAt65"]
        self.assertEqual(65, tier["threshold"])
        self.assertEqual(["em_StukaDamage", "em_PlaneDamage"], tier["names"])

    def test_death_tiers(self) -> None:
        death = self.results["death"]
        self.assertEqual(0, death["threshold"])
        # All three of the Sherman's death effects, in authored order.
        self.assertEqual(
            ["e_ExplGas", "e_scrapmetal", "e_scrapmetalsmoke"], death["names"])
        # -1 is the water death, and it replaces the dry one.
        self.assertEqual(-1, self.results["waterDeath"]["threshold"])
        self.assertEqual(["WaterWaterExplosion"],
                         self.results["waterDeath"]["names"])
        # A template with no water tier falls back rather than showing nothing.
        self.assertEqual(0, self.results["waterDeathFallback"]["threshold"])


class BurnAndDeathTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_spawns_full_and_undamaged(self) -> None:
        spawn = self.results["spawn"]
        self.assertEqual(100, spawn["hp"])
        self.assertFalse(spawn["critical"])
        self.assertFalse(spawn["destroyed"])
        self.assertIsNone(spawn["tier"])

    def test_tier_changes_are_reported_once_each(self) -> None:
        changes = self.results["tierChanges"]
        self.assertEqual(50, changes["smoke"]["threshold"])
        self.assertTrue(changes["smoke"]["changed"])
        self.assertEqual(12, changes["fire"]["threshold"])
        self.assertTrue(changes["fire"]["changed"])
        # 10 HP is at or below criticalDamage 12.
        self.assertTrue(changes["fire"]["critical"])

    def test_burn_is_eight_flat_ticks(self) -> None:
        # HP-5 and HP-12: 12 HP at 1.5 per firing is exactly 8 ticks, one per
        # whole second, and the Sherman dies 8 seconds after going critical.
        burn = self.results["burn"]
        self.assertTrue(burn["died"])
        self.assertEqual(8, burn["tickCount"])
        self.assertEqual([10.5, 9, 7.5, 6, 4.5, 3, 1.5, 0],
                         [tick["hp"] for tick in burn["ticks"]])
        # One tick per second, to within a 1/30 s step.
        for index, tick in enumerate(burn["ticks"]):
            self.assertAlmostEqual(index + 1, tick["at"], delta=0.05)
        self.assertEqual(0, burn["finalTier"]["threshold"])

    def test_a_long_frame_checks_in_less_often_not_harder(self) -> None:
        # HP-5: the loss is a flat amount per firing, not scaled by dt. A single
        # 2 s step costs two ticks (3 HP), never 2 s worth of scaled loss.
        self.assertEqual(9, self.results["longFrame"]["hp"])

    def test_repair_clears_the_tier_and_resets_the_burn(self) -> None:
        # The behavioural consequence of ARM-1's latch being a death latch: a
        # repaired vehicle stops smoking. If it were a first-run latch this
        # would still show fire at 90 HP.
        repair = self.results["repair"]
        self.assertEqual(12, repair["burning"])
        self.assertIsNone(repair["afterHeal"])
        self.assertTrue(repair["changed"])
        self.assertFalse(repair["critical"])
        self.assertEqual(0, repair["accumulator"])

    def test_death_is_announced_exactly_once(self) -> None:
        # A round kills through damage(), outside any update() — so "died" has
        # to mean "newly dead as far as the caller knows", or the explosion
        # never plays for the one case that matters.
        death = self.results["deathOnce"]
        self.assertTrue(death["firstDied"])
        self.assertEqual(
            ["e_ExplGas", "e_scrapmetal", "e_scrapmetalsmoke"],
            death["firstNames"])
        self.assertFalse(death["secondDied"])
        self.assertFalse(death["secondChanged"])
        self.assertTrue(death["destroyed"])


class DamageSetTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_only_armour_bearing_objects_register(self) -> None:
        result = self.results["set"]
        self.assertEqual(2, result["size"])
        # ARM-3: a palm has no armor block at all, and a block with tiers but no
        # hit points is not damageable either.
        self.assertIsNone(result["palm"])
        self.assertIsNone(result["noHp"])

    def test_a_hit_finds_its_vehicle_by_collision_owner(self) -> None:
        result = self.results["set"]
        self.assertEqual(60, result["landedLost"])
        self.assertEqual(40, result["shermanHp"])

    def test_hits_that_do_nothing(self) -> None:
        result = self.results["set"]
        # A round into terrain or a building names an owner with no Armor.
        self.assertIsNone(result["missed"])
        # A bounced round — damageMod 0.0 for this attacker/defender pair — is
        # not a hit on the hit points.
        self.assertIsNone(result["bounced"])

    def test_update_reports_only_what_changed(self) -> None:
        changes = self.results["set"]["changes"]
        # The Spitfire was never touched, so it is not in the list.
        self.assertEqual(1, len(changes))
        self.assertEqual("Sherman", changes[0]["name"])
        self.assertEqual(50, changes[0]["threshold"])
        self.assertFalse(changes[0]["died"])


if __name__ == "__main__":
    unittest.main()
