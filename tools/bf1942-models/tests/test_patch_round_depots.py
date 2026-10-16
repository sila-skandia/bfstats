"""`patch_round_depots.py`: a finished glb's round spec gains the SupplyDepots
the round carries (FHX-21), exactly as a fresh export writes them, and a second
pass changes nothing."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from patch_round_depots import patch_doc  # noqa: E402

CON = """
ObjectTemplate.create Projectile TestExtinguisherProjectile
ObjectTemplate.invisible 1
ObjectTemplate.addTemplate TestRepairpoint

ObjectTemplate.create Projectile TestBullet
ObjectTemplate.invisible 1

ObjectTemplate.create Projectile TestStickyProjectile
ObjectTemplate.isSticky 1

ObjectTemplate.create SupplyDepot TestRepairpoint
ObjectTemplate.radius 3
ObjectTemplate.team 0
ObjectTemplate.addVehicleType Centurion -1 1 0
ObjectTemplate.workOnVehicles 1
ObjectTemplate.workOnSoldiers 0
"""


def node(name, projectile):
    return {"name": name, "extras": {"templateKind": "FireArms",
                                     "fireArms": {"projectile": {"template": projectile,
                                                                 "kind": "bullet"}}}}


class PatchRoundDepotsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/Test/Weapons.con", CON)

    def test_a_round_with_a_depot_gains_it_once(self) -> None:
        doc = {"nodes": [node("TankFireExtinguisher15_Alt", "TestExtinguisherProjectile"),
                         node("Coax", "TestBullet"), {"name": "Hull"}]}
        self.assertEqual(1, patch_doc(doc, self.library, {}))
        [depot] = doc["nodes"][0]["extras"]["fireArms"]["projectile"]["depots"]
        self.assertEqual("TestRepairpoint", depot["template"])
        self.assertEqual(3.0, depot["radius"])
        self.assertEqual([["Centurion", -1.0, 1.0, 0.0]], depot["vehicleTypes"])
        self.assertNotIn("depots", doc["nodes"][1]["extras"]["fireArms"]["projectile"])
        self.assertEqual(0, patch_doc(doc, self.library, {}))

    def test_a_sticky_round_gains_the_word_once(self) -> None:
        doc = {"nodes": [node("Haft", "TestStickyProjectile"), node("Coax", "TestBullet")]}
        doc["nodes"][0]["extras"]["fireArms"]["projectile"]["damage"] = {"radius": 4.0}
        self.assertEqual(1, patch_doc(doc, self.library, {}))
        damage = doc["nodes"][0]["extras"]["fireArms"]["projectile"]["damage"]
        self.assertEqual({"radius": 4.0, "isSticky": True}, damage)
        self.assertNotIn("damage", doc["nodes"][1]["extras"]["fireArms"]["projectile"])
        self.assertEqual(0, patch_doc(doc, self.library, {}))


if __name__ == "__main__":
    unittest.main()
