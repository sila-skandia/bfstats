"""`viewer/soldier-death.js` under node: which death the killing blow plays.

The order and the tests are `BFSoldier::handleDamage` (lnxded `0x08270980`),
the state ids those tests land on are the ones `BFSoldierTemplate::init`
(`0x0827a730`) caches, and Back is "the round travelled the way he faces"
(`SkeletonCollisionMesh::getLatestCollision` returns the ray segment,
`0x083aeb10`). See `features/soldier-death-animations/README.md`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "viewer" / "soldier-death.js"
HARNESS = Path(__file__).with_name("soldier_death_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(SOURCE, work / "soldier-death.js")
        shutil.copyfile(SOURCE.with_name("skeleton-hit.js"), work / "skeleton-hit.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierDeathTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_corpse_lasts_the_templates_time_to_live(self) -> None:
        # `ObjectTemplate.timeToLiveAfterDeath 10`, `CommonSoldierData.inc`.
        self.assertEqual(10, self.results["corpseSeconds"])

    def test_the_whole_body_tests_come_first_in_the_engines_order(self) -> None:
        self.assertEqual(
            ["dieInVehicle", "parachuteDie", "swimDie", "dieHitGround",
             "dieChestCrouch"],
            self.results["order"])

    def test_standing_the_round_direction_picks_chest_or_back(self) -> None:
        standing = self.results["standing"]
        self.assertEqual("dieChestStand", standing["front"])
        self.assertEqual("dieBackStand", standing["behind"])
        self.assertEqual("dieChestStand", standing["behindTurned"])
        self.assertEqual("dieChestStand", standing["noHit"])

    def test_a_head_shot_standing_outranks_the_slow_roll(self) -> None:
        standing = self.results["standing"]
        self.assertEqual("dieHead", standing["head"])
        self.assertEqual("dieSlow", standing["slow"])
        self.assertEqual("dieBackStand", standing["notSlow"])

    def test_a_skeleton_hit_is_judged_by_its_bone(self) -> None:
        # The `Bip01_Head` capsule is the head whatever height it was met at,
        # and a chest capsule is not, however high.
        self.assertEqual({"headLow": "dieHead", "chestHigh": "dieChestStand"},
                         self.results["byBone"])

    def test_the_slow_death_is_one_draw_in_four(self) -> None:
        self.assertAlmostEqual(0.25, self.results["slowShare"], places=2)

    def test_crouched_and_prone_have_no_head_or_slow_death(self) -> None:
        self.assertEqual({"front": "dieChestCrouch", "behind": "dieBackCrouch",
                          "head": "dieChestCrouch"}, self.results["crouched"])
        self.assertEqual({"behind": "dieLie", "head": "dieLie"},
                         self.results["prone"])

    def test_back_is_the_horizontal_dot_with_his_forward(self) -> None:
        g = self.results["geometry"]
        self.assertFalse(g["sideOn"])        # exactly side-on: dot 0, not > 0
        self.assertTrue(g["verticalIgnored"])
        self.assertFalse(g["nullTravel"])
        self.assertTrue(g["headAtFloor"])
        self.assertFalse(g["chest"])
        self.assertFalse(g["noHeight"])

    def test_round_hit_is_direction_and_height_above_the_feet(self) -> None:
        r = self.results["roundHit"]
        self.assertEqual([0, 0.1, 10], [round(v, 6) for v in r["hit"]["travel"]])
        self.assertAlmostEqual(1.6, r["hit"]["height"])
        self.assertFalse(r["hit"]["seated"])
        self.assertTrue(r["seated"]["seated"])
        self.assertIsNone(r["zero"])
        self.assertIsNone(r["noFeet"]["height"])

    def test_an_unbound_death_falls_to_the_plainest_death_or_nothing(self) -> None:
        f = self.results["fallback"]
        self.assertEqual("dieHead", f["bound"])
        self.assertEqual("dieChestStand", f["toChest"])
        self.assertEqual("dieChestCrouch", f["crouchFirst"])
        self.assertIsNone(f["nothing"])
        self.assertEqual("dieSlow", f["noPredicate"])


if __name__ == "__main__":
    unittest.main()
