"""`viewer/skeleton-hit.js` under node: a round against the engine's capsules.

`setSkeletonCollisionBone <bone> <distSq> <stretch> <material>`: the capsule is
the bone's segment to its parent moved by `stretch` lengths, hit when the
round's segment comes within `distSq` (squared), first capsule in declaration
order (`SkeletonCollisionMesh::getDistanceToGeometry` lnxded `0x083aeb10`,
`checkCapsuleCollision` `0x083ae510`; ledger DIE-10).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
HARNESS = Path(__file__).with_name("skeleton_hit_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "skeleton-hit.js", work / "skeleton-hit.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SkeletonHitTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_segment_distance_is_exact(self) -> None:
        # Never above a 200x200 brute-force grid, which can only overestimate.
        self.assertLessEqual(self.results["bruteForceExcess"], 1e-9)
        self.assertAlmostEqual(1.0, self.results["parallel"])

    def test_the_capsule_is_the_bone_segment_moved_by_stretch(self) -> None:
        a, b = self.results["headCapsule"]
        self.assertAlmostEqual(1.7, a[1])     # neck + 2 * 0.1
        self.assertAlmostEqual(1.8, b[1])     # head + 2 * 0.1
        self.assertEqual([[0, 1, 0], [0, 0.5, 0]], self.results["plainCapsule"])

    def test_a_bone_the_rig_lacks_is_skipped(self) -> None:
        self.assertEqual(2, self.results["capsuleCount"])

    def test_head_chest_and_miss(self) -> None:
        r = self.results
        self.assertEqual("Bip01_Head", r["headShot"]["bone"])
        self.assertEqual(40, r["headShot"]["material"])
        self.assertAlmostEqual(10.0, r["headShot"]["t"], places=3)
        self.assertEqual("Bip01_Spine2", r["chestShot"]["bone"])
        self.assertEqual(41, r["chestShot"]["material"])
        self.assertIsNone(r["overHead"])      # 0.2 m above the capsule top
        self.assertIsNone(r["tooShort"])      # the round stops short of him

    def test_the_first_declared_capsule_wins(self) -> None:
        self.assertEqual(["Far", "Near"], self.results["declarationOrder"])

    def test_the_head_bone(self) -> None:
        self.assertEqual([True, True, True, False, False], self.results["isHead"])

    def test_the_sphere_is_the_fallback_only(self) -> None:
        sphere = self.results["sphere"]
        self.assertIsNone(sphere["hit"]["bone"])
        self.assertAlmostEqual(10.0, sphere["hit"]["t"])
        self.assertIsNone(sphere["miss"])
        self.assertIsNone(sphere["behind"])
        self.assertEqual("Bip01_Head", sphere["capsulesWin"])


if __name__ == "__main__":
    unittest.main()
