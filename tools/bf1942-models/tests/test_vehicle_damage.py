"""`viewer/vehicle-damage.js`: what a shot does to a vehicle.

The engine side is settled in `features/bf1942-engine-reference/` — ledger rows
HP-1/HP-2/HP-5 for the Armor and the burn cadence, ARM-1/ARM-2 for the
`addArmorEffect` tiers — and nothing asserted here is invented. Assertions:

  - the burn is a flat `hpLostWhileCriticalDamage` once per whole second, **not**
    scaled by `dt` (HP-5), so a Sherman critical at 12 HP takes exactly 8 ticks;
  - a living vehicle's tier is re-evaluated continuously (ARM-1) and clears
    again when it is repaired, because the engine's `Armor+0x128` byte is a
    death latch rather than a first-run latch;
  - water damage is a flat `hpLostWhileDamageFromWater` once per second while
    `inWater` (HP-5), and only for vehicles with `damageFromWater` set — boats
    do not drown (HP-12, parity-audit GAP D-2).

Like `test_armor.py`, this copies the module plus the two it imports
(`armor.js`, and `effects-core.js` for the splash formula) into a temp dir and
runs `node harness.mjs` — neither import pulls anything further, so no vendored
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
EFFECTS_CORE = ROOT / "viewer" / "effects-core.js"
HARNESS = Path(__file__).resolve().parent / "vehicle_damage_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        module = (MODULE.read_text()
                  .replace("from './armor.js'", "from './armor.mjs'")
                  .replace("from './effects-core.js'", "from './effects-core.mjs'"))
        (work / "vehicle-damage.mjs").write_text(module)
        shutil.copyfile(ARMOR, work / "armor.mjs")
        shutil.copyfile(EFFECTS_CORE, work / "effects-core.mjs")
        # `effects-core.js` re-exports the damage-block half from its own file.
        (work / "package.json").write_text('{"type": "module"}')
        shutil.copyfile(EFFECTS_CORE.with_name("projectile-damage.js"),
                        work / "projectile-damage.js")
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


class SplashDamageTests(unittest.TestCase):
    """The area pass: `damageType 1` rounds hurt what stands near the blast."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["splash"]

    def test_falloff_is_linear_in_distance(self) -> None:
        # materialDamage(236) 10 x damageMod(236, 50) 2 x (1 - 5/10) = 10.
        self.assertEqual(self.results["hurt"],
                         [{"name": "Near", "lost": 10, "distance": 5}])

    def test_the_firer_is_spared(self) -> None:
        self.assertEqual(self.results["firerHp"], 100)

    def test_who_a_blast_cannot_reach(self) -> None:
        # `Edge` sits exactly on the radius (a hard cutoff, HP-9), `Immune`'s
        # pairing is 0.0 in the table, `OldExtract` predates `splashMaterial`,
        # and owner 99 is not damageable at all. None of them may appear.
        names = {row["name"] for row in self.results["hurt"]}
        self.assertEqual(names, {"Near"})

    def test_a_round_with_no_area_pass(self) -> None:
        self.assertEqual(self.results["directOnly"], 0)
        self.assertEqual(self.results["noSplashMaterial"], 0)

    def test_missing_tables_cost_nothing(self) -> None:
        self.assertEqual(self.results["noTables"], 0)


class WaterDamageTests(unittest.TestCase):
    """HP-5: water damage is a flat `hpLostWhileDamageFromWater` per whole
    second, independent of `dt`, and only for vehicles with `damageFromWater`
    set — boats are excluded (HP-12)."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_flat_tick_per_second(self) -> None:
        # Sherman: 100 HP, hpLostWhileDamageFromWater 10. One second per tick.
        self.assertEqual(90, self.results["waterTick1"]["hp"])
        self.assertEqual(80, self.results["waterTick2"]["hp"])
        self.assertEqual(70, self.results["waterTick3"]["hp"])
        # The accumulator drains whole seconds and never carries a fraction.
        self.assertEqual(0, self.results["waterTick3"]["acc"])

    def test_long_frame_checks_in_less_often(self) -> None:
        # HP-5: a 2 s step costs two ticks (20 HP), never 2 s worth of scaled loss.
        self.assertEqual(80, self.results["waterLongFrame"]["hp"])
        self.assertEqual(0, self.results["waterLongFrame"]["acc"])

    def test_leaving_water_resets_the_countdown(self) -> None:
        # Half a second accumulates but does not tick; going dry resets.
        self.assertEqual(100, self.results["waterExitMid"]["hp"])
        self.assertAlmostEqual(0.5, self.results["waterExitMid"]["acc"])
        self.assertEqual(0, self.results["waterExitDry"]["acc"])

    def test_boats_do_not_drown(self) -> None:
        # damageFromWater is false on the boat template. Armor caps max at 128.
        self.assertEqual(128, self.results["boatNoWaterDamage"]["hp"])

    def test_set_routes_in_water_per_owner(self) -> None:
        # Both owner 3 (Sherman) and 4 (boat) marked in-water; only the Sherman
        # loses HP. Boat max is capped at 128.
        self.assertEqual(70, self.results["setWater"]["shermanHp"])
        self.assertEqual(128, self.results["setWater"]["boatHp"])
        self.assertEqual(0, self.results["setWater"]["shermanAcc"])

    def test_set_without_in_water_flag_loses_nothing(self) -> None:
        self.assertEqual(100, self.results["setNoWater"]["shermanHp"])


class BlastGeometryTests(unittest.TestCase):
    """HP-9: only the **Y** term of the blast distance is scaled, by
    `YModOnExplosion` (lnxded 0x08156613 multiplies `dy` and nothing else).
    The distance itself is to the victim's transform **origin**."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["yMod"]

    def test_the_engine_default_is_one(self) -> None:
        # A target 5 m straight up sits 5 m away when the field is absent, the
        # same as when it is authored 1.0 — the `ProjectileTemplate` default.
        self.assertEqual(5, self.results["absent"])
        self.assertEqual(5, self.results["one"])

    def test_a_bomb_halves_its_vertical_reach(self) -> None:
        # 629 of the 642 declarations surveyed are `2.0` and every one is on a
        # bomb: 5 m up reads as 10 m, which is the whole radius, so the target
        # is outside a blast it would otherwise have been well inside.
        self.assertIsNone(self.results["two"])

    def test_the_horizontal_terms_are_never_scaled(self) -> None:
        # X and Z are untouched: a target 5 m sideways is 5 m away whatever
        # `YModOnExplosion` says.
        self.assertEqual(5, self.results["horizontalAtTwo"])


class BlastCentreTests(unittest.TestCase):
    """HP-9: where an explosion is centred, which is not the hit point.

    `GameServer::handleCollisionForProjectile` builds the impact explosion's
    position as `hitPos + 0.1 * normal` — the 0.1f is loaded at lnxded
    0x08153f5e from `ds:0x086b1ca0` (`cdcccc3d`), multiplied into the normal at
    0x08153f6b-0x08153f73, added at 0x08153f82-0x08153f8f and pushed at
    0x08154026. The collision **effect** is played before all of that, at
    0x08153e5b, on the raw hit point, so the two are different places and the
    record carries both. The end-of-life explosion has no surface and no
    offset: it stands on the projectile's own `getPos()` (0x0831f747).
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["blastCentre"]

    def test_an_impact_blast_stands_off_the_struck_surface(self) -> None:
        # Struck a wall at the origin with normal +X, so the blast sits at
        # x = 0.1 and a victim 5 m out along +X is 4.9 m from it.
        self.assertAlmostEqual(4.9, self.results["impact"], places=6)
        self.assertEqual(5, self.results["unoffset"])

    def test_an_end_of_life_blast_uses_the_projectile_position(self) -> None:
        # No `splashPoint` on the record, so `point` is the centre: a grenade
        # resting at x = 1 is 4 m from a victim at x = 5.
        self.assertEqual(4, self.results["endOfLife"])


class InputGateTests(unittest.TestCase):
    """HP-15, which **retired ARM-6**.

    ARM-6 said a critically damaged vehicle drives and traverses exactly as a
    healthy one. It does not:

      - `hitPoints < criticalDamage` scales every rotational bundle's input by
        **0.2** (`RotationalBundle::handlePlayerInput` 0x081d834f, the double at
        `ds:0x86c8678`);
      - destroyed stops input reaching **any** child at all
        (`PlayerControlObject::handlePlayerInput` 0x08318920, epilogue
        0x08318952).

    Both are persistent state for the whole wrecked lifetime, cleared only when
    the wreck-respawn timer expires — so the rule is polled against the live
    Armor, never latched when a shell lands.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["inputGate"]

    def state(self, label: str) -> dict:
        return next(s for s in self.results["states"] if s["label"] == label)

    def test_the_scale_is_the_engines_own_zero_point_two(self) -> None:
        self.assertEqual(0.2, self.results["scale"])

    def test_a_healthy_or_merely_damaged_vehicle_is_not_gated(self) -> None:
        # 40 of 100 HP is well into the smoke tier and still nowhere near
        # `criticalDamage 12`: full input, which is the half of ARM-6 that
        # survives.
        for label in ("healthy", "damaged"):
            with self.subTest(label):
                self.assertFalse(self.state(label)["blocked"])
                self.assertEqual(1, self.state(label)["rotationalScale"])

    def test_a_critical_vehicle_traverses_at_a_fifth_and_still_drives(self) -> None:
        critical = self.state("critical")
        self.assertTrue(critical["critical"])
        self.assertFalse(critical["destroyed"])
        # Not blocked: a burning tank still answers the throttle. The research
        # pass that read the 0.2 block as an all-or-nothing gate was wrong.
        self.assertFalse(critical["blocked"])
        self.assertEqual(0.2, critical["rotationalScale"])

    def test_a_wreck_accepts_nothing(self) -> None:
        destroyed = self.state("destroyed")
        self.assertTrue(destroyed["blocked"])
        self.assertEqual(0, destroyed["rotationalScale"])

    def test_the_gate_lifts_when_the_wreck_respawns(self) -> None:
        # `reset()` is the pad respawn — the viewer's stand-in for the six
        # conditions inside `SimpleObject::handleUpdate` that end in
        # `setHitPoints(getMaxHitPoints())`. Both bytes clear together.
        respawned = self.state("respawned")
        self.assertFalse(respawned["blocked"])
        self.assertEqual(1, respawned["rotationalScale"])

    def test_something_with_no_armor_is_not_gated(self) -> None:
        # A bare manned gun, a palm, anything `VehicleDamageSet` never
        # registered: full input.
        self.assertEqual({"blocked": False, "rotationalScale": 1},
                         self.results["unregistered"])

    def test_the_result_object_can_be_caller_owned(self) -> None:
        # The gate is polled every frame for as long as anyone is in a
        # vehicle, so `map.html` hands it one object and it is filled in place
        # rather than allocating a fresh pair of fields sixty times a second.
        # The contract that matters is that every field is rewritten: a stale
        # `blocked` from the previous vehicle would refuse the driver of a
        # perfectly healthy one.
        in_place = self.results["inPlace"]
        self.assertTrue(in_place["sameObject"])
        self.assertEqual({"blocked": True, "rotationalScale": 0},
                         in_place["afterWreck"])
        self.assertEqual({"blocked": False, "rotationalScale": 1},
                         in_place["afterHealthy"])

    def test_a_hull_killed_by_anything_else_is_gated_the_same(self) -> None:
        # The gate reads the live Armor, so it does not care what emptied it.
        # A tank that burned itself down on `hpLostWhileCriticalDamage`, and
        # one the combat area's own 5 HP/s `giveDamage` killed, both refuse the
        # driver exactly as one killed by a shell does.
        other = self.results["byOtherCauses"]
        self.assertEqual(0.2, other["whileBurning"]["rotationalScale"])
        self.assertTrue(other["burnedDown"]["destroyed"])
        self.assertTrue(other["burnedDown"]["blocked"])
        self.assertTrue(other["combatArea"]["destroyed"])
        self.assertTrue(other["combatArea"]["blocked"])


class SoldierSplashTests(unittest.TestCase):
    """HP-10: the exposure term, and the soldier who was never splashed at all.

    `handleExplosionOnObject` (lnxded 0x08156500) seeds the exposure with
    `1.0f` at 0x08156505 and replaces it from `checkForHitOnSoldier`
    (0x08156eb6) at 0x08156ece for a soldier victim only, short-circuits the
    whole victim when it comes back 0.0 (0x08156ede), and otherwise multiplies
    it into the distance falloff at 0x081566b4. The sampling itself is
    `viewer/soldier-exposure.js` and `tests/test_soldier_exposure.py`; what is
    pinned here is that `applySplash` spends it, and on whom.

    The grenade's own numbers throughout: `material2 205`, `radius 15`,
    `materialDamage(205)` 30 and `damageMod(205, 40)` 2.0 against a soldier's
    material 40 and his 30 hit points.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["soldierSplash"]


    def test_a_grenade_at_a_soldiers_feet_kills_him(self) -> None:
        # Until this round `applySplash` walked registered vehicles and the
        # man on foot was not one, so a grenade at his feet cost him nothing.
        # A soldier target carries his own Armor instead of an owner id.
        # `materialDamage(205)` 30 x `damageMod(205, 40)` 2.0 = 60 HP at the
        # centre, halved by a standing soldier's 0.5 cap -- still 30, which is
        # exactly his hit points.
        splash = self.results
        self.assertEqual(30, splash["atFeetStanding"]["lost"])
        self.assertTrue(splash["atFeetStanding"]["dead"])
        self.assertEqual(30, splash["atFeetCrouching"]["lost"])
        self.assertTrue(splash["atFeetCrouching"]["dead"])

    def test_the_standing_cap_is_worth_fifteen_hit_points_at_half_radius(self) -> None:
        # The clearest consequence of the 18-against-nine divisor: at 7.5 m
        # inside a grenade's 15 m radius the falloff is 0.5, so 30 HP before
        # exposure. A crouching man takes all of it and dies; a standing man
        # takes half and walks away on 15.
        splash = self.results
        self.assertEqual(15, splash["sevenFiveStanding"]["lost"])
        self.assertEqual(15, splash["sevenFiveStanding"]["hp"])
        self.assertFalse(splash["sevenFiveStanding"]["dead"])
        self.assertEqual(30, splash["sevenFiveCrouching"]["lost"])
        self.assertTrue(splash["sevenFiveCrouching"]["dead"])

    def test_partial_cover_scales_the_damage_by_the_sample_fraction(self) -> None:
        # Two of nine samples through, standing: 2/18 of 30 HP.
        barely = self.results["sevenFiveBarely"]
        self.assertAlmostEqual(2 / 18, barely["exposure"])
        self.assertAlmostEqual(30 * 2 / 18, barely["lost"], places=3)

    def test_total_cover_short_circuits_before_the_damage_mod(self) -> None:
        # `handleExplosionOnObject` returns at 0x08156ede on exposure 0.0
        # rather than multiplying by it, which is why nothing is reported.
        cover = self.results["inCover"]
        self.assertEqual(30, cover["hp"])
        self.assertEqual(0, cover["lost"])
        self.assertIsNone(cover["exposure"])
        # And the strict `radius > d` gate still applies on its own.
        self.assertEqual(30, self.results["outside"]["hp"])

    def test_a_non_soldier_victim_is_never_asked_for_an_exposure(self) -> None:
        # `edi` is seeded 1.0f at 0x08156505 and only a soldier replaces it.
        # There is no occlusion at all for anything else, so a tank behind a
        # wall takes the full falloff.
        not_a_soldier = self.results["notASoldier"]
        self.assertFalse(not_a_soldier["asked"])
        self.assertEqual(30, not_a_soldier["lost"])
        # A soldier with no callback keeps the seeded 1.0 too.
        self.assertEqual(1, self.results["noCallback"]["exposure"])

    def test_the_exposure_callback_is_handed_the_target_and_the_blast(self) -> None:
        # The blast point is the one `applySplash` measured from -- the
        # `splashPoint` when there is one -- so the caller casts its rays from
        # exactly where the damage came from.
        calls = self.results["callbackArguments"]
        self.assertEqual(1, len(calls))
        self.assertEqual(2, calls[0]["pose"])
        self.assertEqual([1, 2, 3], calls[0]["blast"])



if __name__ == "__main__":
    unittest.main()
