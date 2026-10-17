"""`patch_round_spawners.py`: a finished glb's round spec gains the
ObjectSpawners the round carries, exactly as a fresh export writes them, and a
second pass changes nothing."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.assemble import box_min, round_spawners  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from patch_round_spawners import patch_doc  # noqa: E402

CON = """
ObjectTemplate.create Projectile TestTransformSpawnerProjectile
ObjectTemplate.invisible 1
ObjectTemplate.addTemplate TestTransformObjSpawner
ObjectTemplate.setPosition -0.305/-0.2/-0.746

ObjectTemplate.create Projectile TestBullet
ObjectTemplate.invisible 1

ObjectTemplate.create ObjectSpawner TestTransformObjSpawner
ObjectTemplate.setObjectTemplate 1 TestStatic
ObjectTemplate.setObjectTemplate 2 TestStatic
ObjectTemplate.SpawnDelayAtStart 1
ObjectTemplate.minSpawnDelay 4
ObjectTemplate.maxSpawnDelay 4
ObjectTemplate.team 1

ObjectTemplate.create PlayerControlObject TestStatic
ObjectTemplate.setVehicleCategory VCLand
"""


def node(name, projectile):
    return {"name": name, "extras": {"templateKind": "FireArms",
                                     "fireArms": {"projectile": {"template": projectile,
                                                                 "kind": "bullet"}}}}


class PatchRoundSpawnersTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/Test/Objects.con", CON)

    def test_a_round_with_a_spawner_gains_it_once(self) -> None:
        doc = {"nodes": [node("TestTransformSpawnerGunBarrel", "TestTransformSpawnerProjectile"),
                         node("Coax", "TestBullet"), {"name": "Hull"}]}
        self.assertEqual(1, patch_doc(doc, self.library, {}))
        spawners = doc["nodes"][0]["extras"]["fireArms"]["projectile"]["spawners"]
        self.assertEqual(round_spawners(self.library,
                                        self.library.object("TestTransformSpawnerProjectile")),
                         spawners)
        [spawner] = spawners
        self.assertEqual("TestStatic", spawner["templates"]["1"])
        self.assertEqual([-0.305, -0.2, 0.746], spawner["translation"])
        self.assertIs(True, spawner["spawnDelayAtStart"])
        self.assertNotIn("spawners", doc["nodes"][1]["extras"]["fireArms"]["projectile"])
        # A second pass finds nothing to do.
        self.assertEqual(0, patch_doc(doc, self.library, {}))

    def test_a_spawner_round_with_a_box_gains_its_low_corner(self) -> None:
        # FH's deploy round: `Projectile_Invis_Box6x3x6m_m1`, header box
        # -0.5/-0.1/-0.5 .. 0.5/1.0/0.5 (the bounds are seeded in the cache
        # here; the script reads them from the mod's meshes).
        doc = {"nodes": [node("Gun", "TestTransformSpawnerProjectile")]}
        doc["nodes"][0]["extras"]["fireArms"]["projectile"]["box"] = [1.0, 1.1, 1.0]
        cache = {("box", "testtransformspawnerprojectile"):
                 box_min(((-0.5, -0.1, -0.5), (0.5, 1.0, 0.5)))}
        self.assertEqual(1, patch_doc(doc, self.library, cache))
        self.assertEqual([-0.5, -0.1, -0.5],
                         doc["nodes"][0]["extras"]["fireArms"]["projectile"]["boxMin"])
        self.assertEqual(0, patch_doc(doc, self.library, cache))

    def test_an_older_record_is_brought_up_to_date(self) -> None:
        # A glb patched before an entry said `drawn` and `logic`.
        doc = {"nodes": [node("Gun", "TestTransformSpawnerProjectile")]}
        patch_doc(doc, self.library, {})
        projectile = doc["nodes"][0]["extras"]["fireArms"]["projectile"]
        entry = projectile["spawners"][0]["objects"]["TestStatic"]
        self.assertIs(False, entry["drawn"])
        del entry["drawn"], entry["logic"]
        self.assertEqual(1, patch_doc(doc, self.library, {}))
        self.assertIs(False, projectile["spawners"][0]["objects"]["TestStatic"]["drawn"])
        self.assertEqual(0, patch_doc(doc, self.library, {}))

    def test_an_unknown_round_is_left_alone(self) -> None:
        doc = {"nodes": [node("Gun", "NoSuchProjectile")]}
        self.assertEqual(0, patch_doc(doc, self.library, {}))
        self.assertNotIn("spawners", doc["nodes"][0]["extras"]["fireArms"]["projectile"])


if __name__ == "__main__":
    unittest.main()
