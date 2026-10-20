"""`patch_fireing_force.py`: a finished glb's gun gains the hull shove its
template declares (`fireingForce`, ledger FA-1), exactly as a fresh export
writes it, and a second pass changes nothing.

A tank gun is baked into two places — the vehicle's own model glb and every
level `scene.glb` that places it — so re-baking to add one float would cost
minutes a tree for vanilla and hours for the big mods, and re-send geometry
nothing touched. This is the same JSON-chunk rewrite `patch_engine_limits.py`
and `patch_round_depots.py` do.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from patch_fireing_force import force_of, patch_doc  # noqa: E402

CON = """
ObjectTemplate.create FireArms TestShermanGunBarrel
ObjectTemplate.projectileTemplate TestShell
ObjectTemplate.roundOfFire 0.4
ObjectTemplate.fireingForce 110

ObjectTemplate.create FireArms TestTigerGunBarrel
ObjectTemplate.projectileTemplate TestShell
ObjectTemplate.roundOfFire 0.35
ObjectTemplate.fireingForce 90

ObjectTemplate.create FireArms TestCoaxial
ObjectTemplate.projectileTemplate TestBullet
ObjectTemplate.roundOfFire 12

ObjectTemplate.create FireArms TestZeroed
ObjectTemplate.projectileTemplate TestBullet
ObjectTemplate.roundOfFire 12
ObjectTemplate.fireingForce 0
"""


def gun(name: str, **stats) -> dict:
    return {"name": name, "extras": {"templateKind": "FireArms",
                                     "fireArms": {"projectile": {"template": "TestShell",
                                                                 "kind": "shell"},
                                                  **stats}}}


class ForceOfTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/Test/Weapons.con", CON)

    def test_a_gun_that_declares_it(self) -> None:
        self.assertEqual(110.0, force_of(self.library, "TestShermanGunBarrel"))

    def test_a_gun_that_does_not(self) -> None:
        self.assertIsNone(force_of(self.library, "TestCoaxial"))

    def test_a_gun_that_declares_zero_is_a_gun_that_does_not(self) -> None:
        # The engine gates on `> 0` (`0x0828a293`): the two are one gun.
        self.assertIsNone(force_of(self.library, "TestZeroed"))

    def test_a_name_the_library_does_not_hold(self) -> None:
        self.assertIsNone(force_of(self.library, "NoSuchGun"))

    def test_a_numbered_placement_falls_back_to_the_bare_name(self) -> None:
        self.assertEqual(90.0, force_of(self.library, "TestTigerGunBarrel_3"))


class PatchDocTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/Test/Weapons.con", CON)

    def test_a_gun_gains_its_force_once(self) -> None:
        doc = {"nodes": [gun("TestShermanGunBarrel"), gun("TestCoaxial"),
                         {"name": "Hull"}]}
        self.assertEqual(1, patch_doc(doc, self.library))
        self.assertEqual(110.0, doc["nodes"][0]["extras"]["fireArms"]["fireingForce"])
        self.assertNotIn("fireingForce", doc["nodes"][1]["extras"]["fireArms"])
        # A second pass changes nothing.
        self.assertEqual(0, patch_doc(doc, self.library))

    def test_every_placement_in_a_level_scene_is_reached(self) -> None:
        # A level glb carries one gun node per placed vehicle, under the
        # template's own name (Bocage has three ShermanGunBarrels).
        doc = {"nodes": [gun("TestShermanGunBarrel") for _ in range(3)]
                        + [gun("TestTigerGunBarrel") for _ in range(2)]}
        self.assertEqual(5, patch_doc(doc, self.library))
        forces = [n["extras"]["fireArms"]["fireingForce"] for n in doc["nodes"]]
        self.assertEqual([110.0, 110.0, 110.0, 90.0, 90.0], forces)

    def test_a_force_that_disagrees_is_corrected(self) -> None:
        doc = {"nodes": [gun("TestShermanGunBarrel", fireingForce=12.0)]}
        self.assertEqual(1, patch_doc(doc, self.library))
        self.assertEqual(110.0, doc["nodes"][0]["extras"]["fireArms"]["fireingForce"])

    def test_a_force_the_template_no_longer_earns_is_removed(self) -> None:
        doc = {"nodes": [gun("TestCoaxial", fireingForce=110.0)]}
        self.assertEqual(1, patch_doc(doc, self.library))
        self.assertNotIn("fireingForce", doc["nodes"][0]["extras"]["fireArms"])

    def test_nodes_without_a_firearms_block_are_left_alone(self) -> None:
        doc = {"nodes": [{"name": "TestShermanGunBarrel"},
                         {"name": "Turret", "extras": {"templateKind": "RotationalBundle"}},
                         {"name": "Odd", "extras": {"fireArms": "not a dict"}}]}
        self.assertEqual(0, patch_doc(doc, self.library))

    def test_a_document_with_no_nodes(self) -> None:
        self.assertEqual(0, patch_doc({}, self.library))


if __name__ == "__main__":
    unittest.main()
