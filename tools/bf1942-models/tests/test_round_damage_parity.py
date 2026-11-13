"""A rifle round against a soldier on foot costs the same from the page's own
round and from a bot's (ledger DMG-3, DMG-1, IMP-2).

The regression this guards: a bot's round whose weapon data had not resolved
(no weapon glb, as in the headless runner's model cache) was read as material
0, whose cell against the chest is x0.001, so it did 0.03 HP instead of 30.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("round_damage_parity_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr[-4000:])
    return json.loads(proc.stdout.strip().splitlines()[-1])


class RoundDamageParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_no_ff_sound_round_carries_the_flag_to_its_touch(self) -> None:
        # `Projectile::handleCollision` lnxded 0x0831efe6 calls
        # `BFSoldier::projectileHit` (the teammate's "Watch your aim!") only
        # while the template's `noFFSound` byte (+0x14f) is clear (FF-6).
        self.assertEqual({"riflegrenade": True, "rifle": False}, self.out["noFFSound"])

    def test_the_pages_k98_round_is_the_templates_damage(self) -> None:
        # 5 (material 219) x 10 / 4 / 2 against head 40, chest 41, limbs 42.
        self.assertEqual({"head": 50, "chest": 20, "limbs": 10}, self.out["page"])

    def test_a_bots_k98_round_is_the_same(self) -> None:
        bot = self.out["bot"]
        self.assertEqual([50, 20, 10], [bot["head"], bot["chest"], bot["limbs"]])
        self.assertEqual(20, bot["byTemplate"])

    def test_missing_weapon_data_is_the_stand_in_not_material_zero(self) -> None:
        bot = self.out["bot"]
        self.assertEqual(30, bot["noData"])
        self.assertEqual(30, bot["unlisted"])

    def test_an_unauthored_material_is_the_engines_zero(self) -> None:
        # Template +0x88 = -1 (lnxded 0x081dbd4c) leaves the contact's own
        # material, 0 for a round (0x08257540): 30 x 0.001.
        self.assertAlmostEqual(0.03, self.out["bot"]["unauthored"], places=6)

    def test_the_pages_round_keeps_our_gap_out_of_material_zero(self) -> None:
        gaps = self.out["pageGaps"]
        self.assertIsNone(gaps["unlisted"])
        self.assertAlmostEqual(0.03, gaps["unauthored"], places=6)


if __name__ == "__main__":
    unittest.main()
