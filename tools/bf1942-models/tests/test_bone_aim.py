"""The bots' aim at a soldier's bones, the blast's source Armor and the
material table's fallbacks, as retail's server has them.

* `BFEnvironment::pickSoldierRandomSensePosition` (lnxded 0x085e3d20, ledger
  AI-123): a sense ray at a soldier goes to one of the bones of his own
  skeleton (`BFSoldier+0x274`: `animations/UsSoldier.ske`, 67 bones), index
  `trunc(u * (count - 1))`, every bone the same weight and the last never.
* `BotMain::updateMemory` (0x085244e0): the kept bone is re-tested where it is
  now (`getSoldierSensePosition` 0x085e3f60), then one new random bone.
* `BAPAAimAtObject::getAimVec` (0x0853b820): the aim is the memory record's
  sense point through the target's live matrix, so a bot aims at the bone.
* `GameServer::handleCollisionForProjectile` (0x08153ba0): the impact blast's
  source Armor is the struck object's (0x08153d3d..0x08153d71, pushed at
  0x08154009), so the blast passes over what the round met and not over the
  hull that fired it (ledger HP-9g, corrected).
* `MaterialManager::getDamageMod` (0x08175040, ledger DMG-1): an undefined
  material id is material 0's, and a pair with no cell is 0.0.

Driven by `bone_aim_harness.mjs` on the module set `test_bot_ai.py` stages.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.test_bot_ai import MODULES as BOT_MODULES, THREE_PACKAGE, VIEWER

HARNESS = Path(__file__).resolve().parent / "bone_aim_harness.mjs"
MODULES = dict(BOT_MODULES)
MODULES["rig-capsules.js"] = VIEWER / "rig-capsules.js"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BoneAimTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_pick_is_uniform_over_every_bone_but_the_last(self) -> None:
        p = self.results["pick"]
        # 67 bones: indices 0..65, each reachable, HipPack (66) never.
        self.assertEqual((p["distinct"], p["min"], p["max"]), (66, 0, 65))
        self.assertEqual((p["first"], p["half"], p["top"]), (0, 33, 65))
        self.assertEqual((p["one"], p["two"]), (0, 0))

    def test_a_sense_ray_goes_to_a_bone_and_keeps_its_index(self) -> None:
        r = self.results
        self.assertEqual(r["rays"]["bone"], 2)
        self.assertEqual(r["rays"]["offset"], [0.3, 1.2, 0.1])
        self.assertEqual(r["raysList"], 2)
        # No skeleton posed: the stand-in heights, and no bone.
        self.assertIsNone(r["raysNoHook"])

    def test_the_retest_follows_the_kept_bone_then_draws_one_new(self) -> None:
        r = self.results
        # The kept bone where it is now, with no draw spent.
        self.assertEqual(r["retestKept"], {"bone": 2, "offset": [0.4, 0.6, 0.2], "draws": 0})
        # Hidden: one new random bone, its index kept.
        self.assertEqual(r["retestNew"], {"bone": 0, "draws": 1})
        self.assertIsNone(r["retestLost"])

    def test_a_bot_aims_at_the_sensed_bone_where_it_is_now(self) -> None:
        a = self.results["aim"]
        self.assertEqual(a["sensed"], a["same"])
        for got, want in zip(a["sensed"], [10.3, 1.2, 0.1]):
            self.assertAlmostEqual(got, want, places=6)
        # He turned a quarter: the point turns with him.
        for got, want in zip(a["turned"], [10.1, 1.2, -0.3]):
            self.assertAlmostEqual(got, want, places=6)
        # No record, or a seated man: the object's position (the page's 1 m up).
        self.assertEqual(a["noRecord"], [10, 1.0, 0])
        self.assertEqual(a["seated"], [10, 1.0, 0])
        self.assertEqual(a["standIn"], [10, 1.0, 0])

    def test_a_hull_is_aimed_at_its_origin_or_the_mesh_point_that_saw_it(self) -> None:
        # `getAimVec` 0x0853b820 takes the record's point for a hull too: the
        # zero vector while the origin is in sight (`updateMemory` 0x0852597e,
        # 0x08524b2f), else `pickRandomSensePosition`'s point.
        h = self.results["hullAim"]
        self.assertEqual(h["origin"], [100, 10, 50])
        self.assertEqual(h["meshPoint"], [101, 10.5, 48])
        self.assertEqual(h["noRecord"], [100, 10, 50])
        self.assertEqual(h["standIn"], [100, 11, 50])
        self.assertEqual(h["retest"], [True, None])

    def test_the_trigger_tests_its_line_to_the_point_it_aims_at(self) -> None:
        # Not a metre over the feet: a bot that saw a head over a wall and
        # aimed at it held its fire for good (a room in twenty fell silent).
        t = self.results["triggerLine"]
        self.assertEqual(t["to"], [10.3, 1.2, 0.1])
        self.assertTrue(t["fired"])

    def test_the_drawn_rig_hands_its_joints_in_the_soldiers_frame(self) -> None:
        g = self.results["rig"]
        self.assertEqual(g["count"], 3)                    # the graft is no bone
        self.assertEqual(g["head"], [0, 1.6, 0])
        self.assertEqual(g["last"], [0, 1, -0.2])
        self.assertEqual(g["turned"], [0.2, 1, 0])
        self.assertIsNone(g["detached"])

    def test_an_undefined_material_is_material_zero_and_no_cell_is_nothing(self) -> None:
        c = self.results["cells"]
        self.assertEqual(c["listed"], 200)                 # 100 x 2
        self.assertEqual(c["noCell"], 0)
        self.assertEqual(c["victimUndefined"], 50)         # 100 x cell(202, def 0)
        self.assertEqual(c["attackerUndefined"], 7.5)      # 30 x cell(0, 60)
        self.assertEqual(c["noMaterial"], 0)
        self.assertEqual(c["falloff"], 100)
        # A fall on ground 33 against body 40, neither defined: cell(0, 0), 30.
        self.assertEqual(c["fallUndefinedGround"], {"damageMod": 0.1, "materialDamage": 30})

    def test_the_blast_passes_over_what_the_round_struck_not_its_firer(self) -> None:
        s = self.results["source"]
        self.assertEqual(s["hullStruck"], {"firerHull": True, "struckHull": False, "man": True, "other": True})
        self.assertEqual(s["soldierStruck"], {"firerHull": True, "struckHull": True, "man": False, "other": True})
        self.assertEqual(s["groundStruck"], {"firerHull": True, "struckHull": True, "man": True, "other": True})
        self.assertEqual(s["ownHullStruck"], {"firerHull": False, "struckHull": True, "man": True, "other": True})
        self.assertEqual(s["endOfLife"], {"firerHull": True, "struckHull": True, "man": True, "other": True})


if __name__ == "__main__":
    unittest.main()
