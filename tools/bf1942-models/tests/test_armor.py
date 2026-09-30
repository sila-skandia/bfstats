"""`viewer/armor.js`: the generic hit-point clamp, death, and sign-dispatch
model every Armor-bearing thing gets.

`armor.js` imports nothing, so — like `test_effects.py` running
`effects-core.js` — this copies the one module plus its harness into a temp
dir and runs `node harness.mjs`. The numbers asserted are `verify-r4.md`'s
`## Corrected report` (`R4-n` ids), read in full in the module's own
docstring; nothing here is invented.
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
MODULE = ROOT / "viewer" / "armor.js"
HARNESS = Path(__file__).resolve().parent / "armor_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "armor.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                               capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ArmorModelTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_constants(self) -> None:
        # R4-2/R4-7: the death epsilon is exactly 0.001, not "close to zero".
        self.assertEqual(0.001, self.results["constants"]["DEATH_EPSILON"])
        # R4-5: setMaxHitPoints' own ceiling.
        self.assertEqual(128, self.results["constants"]["MAX_HITPOINTS_CEILING"])
        # HP-17: a template's hit-point words before a .con sets them.
        self.assertEqual(10, self.results["constants"]["TEMPLATE_HITPOINTS_DEFAULT"])

    def test_spawn_is_full_and_alive(self) -> None:
        spawn = self.results["spawn"]
        self.assertEqual(30, spawn["hp"])
        self.assertEqual(30, spawn["max"])
        self.assertFalse(spawn["destroyed"])

    def test_damage_and_heal_clamp_at_max(self) -> None:
        r = self.results["damageAndHeal"]
        self.assertEqual({"hp": 18, "lost": 12, "destroyed": False}, r["afterDamage"])
        self.assertEqual({"hp": 23, "gained": 5}, r["afterHeal"])
        # R4-4: heal clamps at the current max — 23 + 100 must land on 30,
        # and report only the 7 actually restored, not the 100 requested.
        self.assertEqual({"hp": 30, "gained": 7}, r["afterOverheal"])

    def test_killing_blow_snaps_to_zero_and_reports_true_loss(self) -> None:
        # R4-3: hitPoints=max(hitPoints-amt, floor-to-0.0-below-epsilon). 23
        # HP took a 40-HP hit: dead, at exactly 0, having lost 23 — not -17.
        r = self.results["killingBlow"]
        self.assertEqual(0, r["hp"])
        self.assertEqual(23, r["lost"])
        self.assertTrue(r["destroyed"])

    def test_epsilon_boundary_direction(self) -> None:
        # R4-2/R4-7: the comparison is "<=", so a result landing just below
        # 0.001 must die (and snap to exactly 0, not linger near-zero), and
        # one landing just above it must not.
        r = self.results["epsilonBoundary"]
        self.assertEqual(0, r["belowHp"])
        self.assertTrue(r["belowDestroyed"])
        self.assertFalse(r["aboveDestroyed"])
        self.assertTrue(r["aboveHpNear0011"])

    def test_death_is_final(self) -> None:
        r = self.results["deathIsFinal"]
        self.assertEqual(0, r["hp"])
        self.assertTrue(r["destroyed"])
        self.assertEqual(0, r["damageAfterDeath"])
        self.assertEqual(0, r["healAfterDeath"])

    def test_nonpositive_damage_and_heal_are_noops(self) -> None:
        r = self.results["nonPositiveNoop"]
        self.assertEqual(20, r["hp"])
        self.assertEqual(0, r["d"])
        self.assertEqual(0, r["h"])

    def test_apply_damage_sign_dispatch(self) -> None:
        # R4-19 (corrected this round): amt>0 damages, amt<=0 heals by -amt,
        # both on the same Armor — no parent/root split.
        r = self.results["applyDamageSign"]
        self.assertEqual(14, r["afterPositive"])   # 20 - 6
        self.assertEqual(18, r["afterNegative"])   # 14 + 4
        self.assertEqual(18, r["afterZero"])       # heal(-0) = no change

    def test_apply_damage_can_kill(self) -> None:
        r = self.results["applyDamageLethal"]
        self.assertEqual(0, r["hp"])
        self.assertTrue(r["destroyed"])

    def test_spawn_above_the_ceiling_keeps_the_authored_value(self) -> None:
        # HP-17: setArmorComponent calls setMaxHitPoints (ceiling 128) and
        # then setHitPoints, which raises the max to the starting value. The
        # 128 ceiling that made an Elco80 and an AC-130 spawn critical and
        # bleed to death never survives a spawn with hitPoints == max.
        r = self.results["spawnAboveCeiling"]
        self.assertEqual({"max": 500, "hp": 500, "destroyed": False}, r["elco"])
        self.assertEqual({"max": 2000, "hp": 2000, "destroyed": False}, r["ac130"])

    def test_raised_max_is_the_max_for_heal_and_reset(self) -> None:
        r = self.results["raisedMaxHeals"]
        self.assertEqual(1300, r["afterDamage"])
        self.assertEqual(700, r["gained"])
        self.assertEqual(2000, r["hp"])
        self.assertEqual(2000, r["max"])
        self.assertEqual({"hp": 2000, "max": 2000, "destroyed": False},
                         self.results["raisedMaxReset"])

    def test_ceiling_applies_when_the_start_is_below_it(self) -> None:
        # R4-5's ceiling is real: 155 authored, 40 to start -> 40/128.
        self.assertEqual({"max": 128, "hp": 40}, self.results["ceilingBelowStart"])

    def test_start_above_max_raises_the_max(self) -> None:
        # HP-1: setHitPoints raises the max. DC's Forklift, 80 over 50.
        self.assertEqual({"max": 80, "hp": 80}, self.results["startAboveMax"])

    def test_setters(self) -> None:
        r = self.results["setters"]
        # setMaxHitPoints clamps and leaves hitPoints alone.
        self.assertEqual({"max": 128, "hp": 30}, r["afterSetMax"])
        # setHitPoints raises past the ceiling ...
        self.assertEqual({"max": 600, "hp": 600}, r["afterSetHp"])
        # ... and never lowers the max.
        self.assertEqual({"max": 600, "hp": 20}, r["afterLower"])
        # At or below the epsilon it kills, at exactly 0, and a dead Armor
        # takes no new value.
        self.assertEqual({"hp": 0, "destroyed": True}, r["afterEpsilon"])
        self.assertEqual({"hp": 0, "destroyed": True}, r["afterDeath"])

    def test_spawn_at_the_epsilon_is_dead(self) -> None:
        self.assertEqual({"hp": 0, "destroyed": True}, self.results["spawnDead"])

    def test_template_words(self) -> None:
        # The console stores ceil(v) as an int, and an unset word is 10.
        r = self.results["templateWords"]
        self.assertEqual(2000, r["authored"])
        self.assertEqual(13, r["fraction"])
        self.assertEqual(10, r["missing"])
        self.assertEqual(10, r["nullish"])


if __name__ == "__main__":
    unittest.main()
