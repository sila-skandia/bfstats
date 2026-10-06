"""`viewer/supply.js`: Wake's `SupplyDepot` instances — eligibility, the
leaky-bucket ammo pacing, and the heal tick.

Neither `supply.js` nor `armor.js` imports three.js or the DOM, so this
copies both modules plus the harness into a temp dir and runs
`node harness.mjs`, the same pattern `test_effects.py` uses for
`effects-core.js`. The depot fixtures inside `supply_harness.mjs` are
transcribed verbatim from Wake's own `scene.glb` node extras — see that
file's header for the extraction date and script. Claim ids (`SUP-n`) cite
`verify-r3.md`'s `## Corrected report`.
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
HARNESS = Path(__file__).resolve().parent / "supply_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "supply.js", work / "supply.mjs")
        shutil.copyfile(VIEWER / "armor.js", work / "armor.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                               capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SupplyDepotTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_sparse_data_gets_engine_defaults(self) -> None:
        # SUP-1: Wake's M3A1SupplyDepot ships no team/workOnSoldiers/
        # workOnVehicles word at all — the ctor defaults (team 0,
        # workOnSoldiers true, workOnVehicles false) must apply, not JS's
        # own falsy-undefined.
        d = self.results["defaults"]
        self.assertEqual(0, d["team"])
        self.assertTrue(d["workOnSoldiers"])
        self.assertFalse(d["workOnVehicles"])

    def test_team_gate(self) -> None:
        # SUP-15/16/33: exact-match-or-neutral, against the instance's own
        # team, both directions.
        g = self.results["teamGate"]
        self.assertFalse(g["axisDepotVsAllied"])
        self.assertTrue(g["axisDepotVsAxis"])
        self.assertTrue(g["alliedDepotVsAllied"])
        self.assertEqual([True, True], g["neutralVsEither"])

    def test_radius_is_inclusive_and_three_dimensional(self) -> None:
        # SUP-15: "<=", not "<" — and a real 3-D distance, not a flat one.
        r = self.results["radius"]
        self.assertTrue(r["exactlyAtRadius"])
        self.assertTrue(r["justInside"])
        self.assertFalse(r["justOutside"])
        self.assertTrue(r["verticalAtRadius"])

    def test_self_throttle_cadence(self) -> None:
        # SUP-11: only once 0.5s of real time has accumulated does anything
        # happen — two calls totalling 0.4s must both be inert.
        c = self.results["cadence"]
        self.assertEqual({"gaveAmmo": False, "healed": False, "hp": 10}, c["under"])
        self.assertEqual({"gaveAmmo": False, "healed": False, "hp": 10}, c["stillUnder"])
        # The third call crosses 0.5s (0.6s accumulated) and fires once,
        # against the mediclocker's 4 HP/s rate applied over the *actual*
        # accumulated 0.6s, not a fixed 0.5 — 10 + 0.6*4 = 12.4.
        self.assertEqual(True, c["crosses"]["healed"])
        self.assertAlmostEqual(12.4, c["crosses"]["hp"], places=5)

    def test_ammobox_leaky_bucket_pacing(self) -> None:
        # SUP-21: Ammobox's fastest ammo type is 15/s; against a 0.5s check
        # that is 7.5 whole units every single cycle, so ammo should fire on
        # essentially every tick, never healing (Ammobox's own heal rate is
        # 0 — SUP-19's +0x152 flag is off).
        r = self.results["ammoBoxPacing"]
        self.assertTrue(r["firedEveryTick"])
        self.assertFalse(r["healedAny"])
        self.assertEqual(20, r["refillCalls"])

    def test_mediclocker_heals_at_its_own_rate_and_clamps(self) -> None:
        # SUP-25 (unlimited branch, the only one Wake's data reaches):
        # heal = rate x elapsed, every cycle, clamped at the target's max.
        r = self.results["mediclockerHeal"]
        self.assertTrue(r["healedEveryTick"])
        self.assertAlmostEqual(20.0, r["hpAfter5Cycles"], places=5)
        self.assertEqual(30, r["clampsAtMax"])

    def test_ammo_and_heal_both_run_in_one_cycle(self) -> None:
        # Ledger SUP-18: `workOnSoldiers` calls `reloadAmmo` when an ammo
        # type fired and then `healSoldier` (0x08323ec9..0x08323eff); the
        # old reading, that ammo starves the heal, was wrong. Wake's
        # M3A1SupplyDepot (15/s ammo, 4 HP/s) does both every cycle:
        # 10 + 5 x 0.5 x 4 = 20.
        r = self.results["m3a1BothRun"]
        self.assertEqual(5, r["ammoFiredCount"])
        self.assertEqual(5, r["healFiredCount"])
        self.assertAlmostEqual(20.0, r["hpAfter5Cycles"], places=5)
        self.assertEqual(5, r["refillCalls"])

    def test_a_repair_pad_repairs_its_own_templates_per_cycle(self) -> None:
        # Ledger SUP-19: `repairVehicle` matches the hull's root template
        # against the `addVehicleType` rows and calls `Armor::heal(rate)`
        # with the row's rate as it stands, once a cycle, crewed or not.
        # DC's NimitzRepairpoint: 4 HP a cycle on an empty F-14.
        r = self.results["carrierPad"]
        self.assertTrue(r["repairEnabled"])
        self.assertEqual(70, r["hpAfter5Cycles"])
        self.assertTrue(r["healedEveryCycle"])
        self.assertTrue(r["gaveAmmoEveryCycle"])
        # A template the pad does not list is rearmed and not repaired.
        self.assertEqual(50, r["unlistedHp"])
        self.assertEqual(5, r["unlistedRefills"])
        self.assertEqual(100, r["clampsAtMax"])
        self.assertEqual(50, r["earlyHp"])

    def test_set_health_never_reaches_a_hull(self) -> None:
        # `workOnVehicles` never calls `healSoldier`: the carrier's ammo
        # depot ships `setHealth -1 4 0` and no rows, and only rearms.
        r = self.results["setHealthSkipsHulls"]
        self.assertEqual(50, r["hp"])
        self.assertFalse(r["healedAny"])
        self.assertEqual(4, r["refills"])

    def test_a_kill_depot_destroys_what_it_lists(self) -> None:
        # Medina Ridge's `fk1`: `addVehicleType m1a1 -1 -1000 0` is a heal of
        # -1000 a cycle, matched without regard to case (`getTemplate`), and
        # `setHealth -1 -1000 0` does the same to a soldier. A hull it does
        # not list and one outside its 2 m are untouched.
        r = self.results["killDepot"]
        self.assertTrue(r["tankDestroyed"])
        self.assertEqual(0, r["tankHp"])
        self.assertEqual(50, r["bmpHp"])
        self.assertEqual(50, r["farHp"])
        self.assertTrue(r["soldierDestroyed"])

    def test_a_finite_reserve_pays_only_for_what_was_missing(self) -> None:
        # SUP-19's finite branch: heal min(reserve, rate); the reserve pays
        # the missing hit points at most; it regenerates by elapsed x regen
        # up to its cap first.
        r = self.results["finiteReserve"]
        self.assertEqual({"hp": 100, "reserve": 9}, r["afterFirst"])
        self.assertEqual({"hp": 54, "reserve": 6}, r["afterSecond"])
        self.assertEqual({"hp": 53, "reserve": 0}, r["dry"])

    def test_one_cycle_serves_every_target_in_reach(self) -> None:
        # The world's pass (`SupplyField.update`): both soldiers at the
        # locker heal on the same cycle, and the half-track's own depot
        # (radius 1.3) reaches them too. A seated soldier is served only by
        # a depot riding his own hull (SUP-20); a depot on a destroyed hull
        # does nothing; a tick with no cycle due builds no target list.
        r = self.results["fieldPass"]
        self.assertEqual([14, 14], r["footHp"])
        self.assertEqual(12, r["riderHp"])
        self.assertEqual(10, r["strangerHp"])
        self.assertEqual([True, True, True, False], [x["healed"] for x in r["results"]])
        self.assertTrue(r["soldiersAskedOnce"])
        self.assertEqual(10, r["onWreckHp"])
        self.assertEqual(0, r["idleBuilt"])

    def test_the_hull_repair_icon_needs_a_positive_row_of_its_template(self) -> None:
        r = self.results["hullIcon"]
        self.assertTrue(r["listed"])
        self.assertFalse(r["unlisted"])
        self.assertFalse(r["killDepot"])

    def test_sign_of_rate_selects_damage(self) -> None:
        # SUP-26: a negative rate (an FH-style trap; no Wake depot has one)
        # takes the same heal/damage branch (there are no ammo types to
        # compete with it) but subtracts HP, and is correctly *not* reported
        # as a heal.
        r = self.results["killTrapSign"]
        self.assertTrue(r["tookHealBranch"])
        self.assertFalse(r["reportedAsHeal"])
        self.assertAlmostEqual(24.0, r["hpAfter"], places=5)  # 30 - 1.5*4

    def test_vehicle_only_depot_never_serves_a_soldier(self) -> None:
        # A workOnVehicles-only depot must never fire for a soldier target,
        # regardless of team/ammo data — the capability gate is per kind.
        r = self.results["vehicleOnlyIgnoresSoldier"]
        self.assertFalse(r["eligible"])
        self.assertEqual(0, r["refillCalls"])

    def test_hybrid_depot_serves_each_kind_only_its_own_half(self) -> None:
        # A depot with both capability words serves a foot target through
        # workOnSoldiers and a mounted one through workOnVehicles — the
        # kind never leaks across the other's gate.
        r = self.results["hybridServesBothKinds"]
        self.assertEqual(2, r["foot"]["refillCalls"])
        self.assertEqual(2, r["seated"]["refillCalls"])

    def test_airplane_depot_rearms_an_allied_hull(self) -> None:
        # The airstrip rearm: Wake's AlliedAirplaneSupplyDepot verbatim
        # (team 2, radius 20, ammo-only) refills a mounted allied target
        # every 0.5 s cycle, and never reports a heal (health [0,0,0]).
        r = self.results["airplaneDepotRearmsHull"]
        self.assertTrue(r["firedEveryTick"])
        self.assertFalse(r["healedAny"])
        self.assertEqual(20, r["refillCalls"])

    def test_airplane_depot_team_and_kind_gates(self) -> None:
        # The same depot turns an enemy hull away and ignores a foot
        # soldier standing under it, predicates included.
        r = self.results["airplaneDepotTeamGate"]
        self.assertEqual(0, r["refillCalls"])
        self.assertFalse(r["eligible"])
        f = self.results["airplaneDepotIgnoresFoot"]
        self.assertEqual(0, f["refillCalls"])

    def test_kind_gates_are_mutually_exclusive(self) -> None:
        # A vehicle target is never also a soldier target and the other
        # way, at the predicate level — `tick`'s either-or is then exact.
        k = self.results["kindGates"]
        self.assertFalse(k["vehiclePredicateOnFootTarget"])
        self.assertFalse(k["soldierPredicateOnVehicleTarget"])

    def test_icon_eligibility_is_continuous_and_per_depot_ranged(self) -> None:
        # SUP-33/34: the icon predicates share the team/distance gates but
        # are not paced by the 0.5s clock, and are per-depot, not "any depot
        # anywhere on the level".
        f = self.results["field"]
        self.assertTrue(f["nearCanHeal"])
        self.assertFalse(f["nearCanRearm"])   # the only ammobox is 100m off
        self.assertFalse(f["farCanHeal"])
        self.assertFalse(f["farCanRearm"])
        self.assertEqual("near mediclocker", f["nearestName"])
        self.assertAlmostEqual(0.5, f["nearestDistance"], places=2)


if __name__ == "__main__":
    unittest.main()
