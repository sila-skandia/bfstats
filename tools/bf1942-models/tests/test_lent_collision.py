"""A geometry-less root is tested with the mesh it borrows at its own transform
(ledger COL-18): the page's copy of that mesh at the root, where the bake left
it hanging off the root (an AA gun's barrel). See `viewer/collision-meshes.js`
`addLentCollisionCopies` and features/udp-sidecar/wire.md section 31."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "lent_collision_harness.mjs"


class LentCollisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_an_aa_gun_gets_its_barrel_at_its_base(self) -> None:
        # Bocage's AA_Allies: the lent mesh is the cockpit LOD's under the
        # cannon, 0.987 m up; the engine also tests it at the root.
        self.assertEqual(self.r["aaLent"], "AA_AllCockpitExternal")
        self.assertEqual(self.r["aaAdded"], 1)
        self.assertEqual(self.r["aaCopyAt"], [1216.43, 20.61, -614.92])
        self.assertTrue(self.r["aaCopyCollision"])
        # The part's own copy stays where it stands (COL-17's chain).
        self.assertTrue(self.r["aaOriginalKept"])

    def test_a_house_whose_lent_mesh_is_at_its_root_gets_nothing(self) -> None:
        self.assertEqual(self.r["houseLent"], "afr_house1_steInterior")
        self.assertEqual(self.r["houseAdded"], 0)

    def test_a_root_with_its_own_geometry_or_behind_a_pco_lends_nothing(self) -> None:
        self.assertIsNone(self.r["ownLent"])
        self.assertIsNone(self.r["pcoLent"])


if __name__ == "__main__":
    unittest.main()
