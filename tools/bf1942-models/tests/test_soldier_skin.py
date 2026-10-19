"""The soldier's paint over a shared weapon rig (`viewer/soldier-skin.js`,
under node), and where `arms-rig.js` applies it.

One rig per weapon (features/mesh-asset-size, phase 5 step 4): the index's
`pairs` rows name a canonical rig file and the soldier's own texture per
canonical image, held by `viewmodels/soldiers/<Soldier>.skin.glb`. The paint
swaps the colour maps before the level's own paint goes on, and the swapped
texture keeps its own name so the level's row keys off the SOLDIER's image —
the engine resolves the texture the shader asked for, and the US soldier's
shader asks for the US sleeve.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from page_source import function_body  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "soldier_skin_harness.mjs"
VIEWER = ROOT / "viewer"


class SoldierSkinModuleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True,
                              text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_the_skin_is_keyed_by_material_and_texture_name(self) -> None:
        self.assertEqual(["texture/ame1_sleeve_t.dds"], self.results["keys"])

    def test_the_rig_takes_the_soldiers_texture_and_keeps_its_name(self) -> None:
        paint = self.results["paint"]
        self.assertEqual(1, paint["changed"])
        self.assertEqual(paint["maps"], [
            "texture/Ame1_sleeve_T.dds",   # the soldier's own sleeve
            "Texture\\STE_HAND2.dds",      # shared across the nations: untouched
            "texture/345RCL.dds",          # the weapon's: untouched
            None,
        ])

    def test_one_skin_glb_is_fetched_per_soldier_per_tree(self) -> None:
        paint = self.results["paint"]
        self.assertEqual(1, paint["again"])
        self.assertEqual(
            ["models/mods/fhsw/viewmodels/soldiers/USSoldier.skin.glb?v=1"],
            paint["asked"])

    def test_the_levels_paint_lands_on_the_soldiers_image_and_comes_off(self) -> None:
        level = self.results["level"]
        self.assertEqual(1, level["onLevel"])
        self.assertEqual("texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds",
                         level["winter"][0])
        # Off the winter level: the SOLDIER's paint comes back, never the
        # canonical nation's.
        self.assertEqual(1, level["back"])
        self.assertEqual("texture/Ame1_sleeve_T.dds", level["maps"][0])

    def test_a_missing_texture_or_skin_warns_and_keeps_the_canonical_paint(self) -> None:
        nicety = self.results["nicety"]
        self.assertEqual((0, 0), (nicety["changed"], nicety["broken"]))
        self.assertEqual(2, nicety["warned"])
        self.assertEqual("texture/Ger1_sleeve_T.dds", nicety["maps"][0])

    def test_entries_without_paint_are_quiet_no_ops(self) -> None:
        self.assertEqual({"bare": 0, "noScene": 0, "noLoader": 0},
                         self.results["noop"])


class ArmsRigWiringTests(unittest.TestCase):
    """Where the paint is applied: in `fetchRig`, on the canonical file, before
    the level's own paint, with the pair's own identity answered."""

    def test_the_soldier_is_painted_before_the_level(self) -> None:
        body = function_body("fetchRig")
        self.assertIn("await paintSoldierRig(gltf.scene, entry,", body)
        self.assertLess(body.index("paintSoldierRig"),
                        body.index("levelSkin.wear"))
        # The file loaded is the canonical rig's; the identity returned is the
        # pair's own, so caches and respawn checks tell two paints apart.
        self.assertIn("const rigFile = entry ? entry.pair ?? entry.stem : null;", body)
        self.assertIn("`viewmodels/${entry.stem}.fp.glb`", body)
        self.assertIn("if (entry.view) applyRigView(gltf, entry.view);", body)

    def test_viewmodel_rig_for_answers_the_pair_identity(self) -> None:
        body = function_body("viewmodelRigFor")
        self.assertIn("entry.pair ?? entry.stem", body)


if __name__ == "__main__":
    unittest.main()
