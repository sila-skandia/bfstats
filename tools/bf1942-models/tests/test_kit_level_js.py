"""The kit a level really hands out, on the page side.

A level's declaration of a template beats the mod's (ledger LOAD-1, LOAD-2,
LOAD-5), so `_shared/loadouts.json` carries a level's own kit rows in
`levelKits[<level>]` and `viewer/kit-loadout.js` serves every reader the file
as the current level sees it (`levelLoadouts`); a kit wearing a `nochute`
(`overrideAirMovementInhibitations`) keeps its soldier out of free fall
(`kitOverridesAirMovement`, `parachute.js` `freeFallBarred`). The kits page
says which levels hand out their own copy (`kit-panels.js` `variantNotes`).
Driven headless by `kit_level_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("kit_level_harness.mjs")
MODULES = ("kit-loadout.js", "kit-icon.js", "kit-panels.js")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class KitLevelTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_level_sees_its_own_kit_over_the_mods(self) -> None:
        view = self.results["view"]
        self.assertEqual(["SMAW", "KnifeAllies", "Landmine"], view["firstLightItems"])
        self.assertEqual(["M16A2"], view["firstLightKeepsOthers"])
        self.assertTrue(view["stable"])
        self.assertEqual(2, view["fileUntouched"])

    def test_a_level_without_rows_and_an_old_file_read_as_before(self) -> None:
        view = self.results["view"]
        self.assertTrue(view["plainIsFile"])
        self.assertTrue(view["noDirIsFile"])
        self.assertEqual(["SMAW", "KnifeAllies"], view["oldFile"])
        self.assertIsNone(view["nullFile"])

    def test_the_nochute_is_the_levels(self) -> None:
        nochute = self.results["nochute"]
        self.assertIs(True, nochute["nopara"])
        self.assertIs(False, nochute["plain"])
        self.assertIs(False, nochute["noKit"])
        self.assertIs(False, nochute["noFile"])

    def test_the_page_follows_the_level_it_is_on(self) -> None:
        page = self.results["page"]
        self.assertEqual("US_AT3", page["firstLightKit"])
        self.assertEqual(["SMAW", "KnifeAllies", "Landmine"], page["firstLightItems"])
        self.assertEqual("Us_Assault", page["noparaKit"])
        self.assertIs(True, page["noparaNoChute"])
        self.assertIs(False, page["plainNoChute"])

    def test_the_kits_page_names_each_level_variant(self) -> None:
        notes = self.results["notes"]
        self.assertEqual(["DC First Light: the level's own US_AT3, + Landmine."],
                         notes["firstLight"])
        self.assertEqual(
            ["DC LostVillage nopara: the level's own US_Sniper, wears Us_Helmet, "
             "US_Assault_BackPack; no parachute (nochute)."],
            notes["nopara"])
        self.assertEqual([], notes["none"])


if __name__ == "__main__":
    unittest.main()
