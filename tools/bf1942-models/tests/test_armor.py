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

    def test_max_hitpoints_ceiling(self) -> None:
        # R4-5: 128 is a hard ceiling, applied even to a wildly over-authored
        # template — this viewer never has one, but the rule is the engine's.
        r = self.results["ceiling"]
        self.assertEqual(128, r["max"])
        self.assertEqual(128, r["hp"])


if __name__ == "__main__":
    unittest.main()
