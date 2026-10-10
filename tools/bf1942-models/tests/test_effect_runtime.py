"""The effect runtime's three-dependent half: a soldier's death tier, the effect
player's fault guard, and the muzzle path's ramp sampler.

Two defects in Desert Combat, one file each side of them:

- A destroyed `Stationary_Browning` baked a colour ramp with an empty point
  (`40/...||100/...`). `sampleCurveInto` threw on it every frame, and the throw
  skipped the rest of the page's world presentation. `con.curve` now reads a
  ramp the way the engine does (ledger EMT-9, `test_effects.py`); here the
  runtime is pinned to never throw on one that slipped through, and the player
  to drop a particle that throws rather than the frame.
- DC's soldiers author `addArmorEffect 0 e_soldierdeath_{us,iraq}` and no death
  ever played it. `viewer/soldier-armor-effects.js` is the engine's rule
  (ledger ARM-8..ARM-10): `Armor::getEffect`'s lookup, the death key, and the
  offset placed in the soldier's own frame at his feet.

`tests/effect_runtime_harness.mjs` loads the page's own modules through
`sim/env.mjs` and prints one JSON object.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "effect_runtime_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class EffectRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_get_effect_is_the_smallest_threshold_at_or_above_the_key(self) -> None:
        # `Armor::getEffect` (lnxded 0x08172820): a living Sherman at full
        # health shows nothing, smokes from 50 and burns from 12 down to 1.
        tiers = self.r["getEffect"]
        self.assertIsNone(tiers["full"])
        self.assertEqual(["e_PanzDamage"], tiers["at50"])
        self.assertEqual(["e_PanzDamage"], tiers["at30"])
        self.assertEqual(["e_PanzFire"], tiers["at12"])
        self.assertEqual(["e_PanzFire"], tiers["at1"])
        self.assertIsNone(tiers["none"])

    def test_a_dead_key_is_exact_else_zero(self) -> None:
        # `playEffect`'s death key (client 0x004bc413): 0 with no hit material,
        # -1 in water, minus the material otherwise; the key's own tier or 0's.
        tiers = self.r["getEffect"]
        death = ["e_ExplGas", "e_scrapmetal", "e_scrapmetal2"]
        self.assertEqual(death, tiers["deadOnLand"])
        self.assertEqual(["WaterWaterExplosion"], tiers["deadInWater"])
        self.assertEqual(death, tiers["deadHitNoWater"])
        self.assertEqual(["e_material40"], tiers["deadKeyOwnTier"])
        self.assertEqual({"noMaterial": 0, "noMaterialInWater": 0, "material": -40,
                          "materialInWater": -1}, self.r["deathKey"])

    def test_a_soldier_shows_his_tier_only_dead(self) -> None:
        tiers = self.r["getEffect"]
        self.assertIsNone(tiers["soldierAlive"])
        self.assertEqual(["e_soldierdeath_us"], tiers["soldierDead"])

    def test_the_offset_lands_in_the_soldiers_own_frame(self) -> None:
        # From feet (10, 5, 20). The US soldier's 0.1 m is along his facing,
        # (sin yaw, 0, cos yaw), and the effect's direction of fire is too.
        frame = self.r["frame"]
        self.assertEqual([10, 5, 20.1], frame["usYaw0"]["position"])
        self.assertEqual([10.1, 5, 20], frame["usYaw90"]["position"])
        self.assertEqual([10, 4.9, 19.5], frame["iraqYaw180"]["position"])
        for name, row in frame.items():
            with self.subTest(frame=name):
                self.assertEqual(row["forward"], row["dof"])
        # Refractor +X is his right: at yaw 0, facing +Z, that is world -X.
        self.assertEqual([9, 5, 20], frame["rightYaw0"]["position"])
        self.assertEqual([-1, 0, 0], frame["rightYaw0"]["right"])

    def test_a_death_plays_the_tier_once_from_the_report(self) -> None:
        page = self.r["page"]
        self.assertEqual((1, 1), (page["us"], page["again"]))
        # A soldier with no tiers, one with no report and one at no position
        # play nothing, and the report is fetched once per template.
        self.assertEqual((0, 0, 0), (page["vanilla"], page["missing"], page["notANumber"]))
        self.assertEqual(3, page["fetches"])
        self.assertEqual(2, page["plays"])
        first = page["played"][0]
        self.assertEqual("e_soldierdeath_us", first["name"])
        self.assertEqual([10.1, 5, 20], first["position"])
        self.assertEqual([1, 0, 0], first["dof"])
        # `addEmitterSpeed 1`: the speed he died at rides with the bundle.
        self.assertEqual([3, 0, 0], first["velocity"])

    def test_the_player_drops_a_throwing_particle_and_keeps_the_rest(self) -> None:
        guard = self.r["guard"]
        self.assertIsNone(guard["threw"])
        self.assertEqual(1, guard["faults"])
        self.assertEqual(["Fx_Broken"], guard["faulted"])
        self.assertEqual([2] * 40, guard["alive"])
        # The legacy ramp reads around its empty point: at 1.33 s of a 2 s life
        # (phase 66.7) alpha is 133 -> 0 between 40 and 100, 73.9 of 255.
        self.assertAlmostEqual(133 * (1 - 26.6667 / 60) / 255, guard["legacyOpacity"], places=3)

    def test_a_texture_under_two_blend_pairs_pools_apart(self) -> None:
        # A rocket puff that took a burning plane's One/InvSrcAlpha mesh drew
        # its whole quad, a trail of squares.
        f = self.r["blendFactors"]
        self.assertEqual([[[f["one"], f["invSrcAlpha"]]],
                          [[f["srcAlpha"], f["invSrcAlpha"]]]], self.r["blendPools"])

    def test_the_muzzle_sampler_reads_around_an_empty_point(self) -> None:
        sample = self.r["roundSample"]
        self.assertEqual([2], sample["emptyBetween"])
        self.assertEqual([], sample["onlyEmpty"])
        self.assertEqual([], sample["none"])
        self.assertEqual([127.5, 127.5, 127.5, 102], sample["clean"])


if __name__ == "__main__":
    unittest.main()
