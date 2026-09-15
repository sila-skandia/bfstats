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

    def test_ammo_before_heal_priority_starves_m3a1s_heal(self) -> None:
        # SUP-18/19: ammo firing this cycle takes priority over heal — a
        # depot with both (Wake's M3A1SupplyDepot) never reaches the heal
        # branch while its 15/s ammo type keeps firing every cycle. This is
        # the engine's own dispatch order, not a bug.
        r = self.results["m3a1Priority"]
        self.assertEqual(20, r["ammoFiredCount"])
        self.assertEqual(0, r["healFiredCount"])
        self.assertTrue(r["hpUnchanged"])
        self.assertEqual(20, r["refillCalls"])

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
        # Out of scope this round (vehicle repair/rearm is P2/P4's): a
        # workOnVehicles-only depot must never fire for a soldier target,
        # regardless of team/ammo data.
        r = self.results["vehicleOnlyIgnoresSoldier"]
        self.assertFalse(r["eligible"])
        self.assertEqual(0, r["refillCalls"])

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
