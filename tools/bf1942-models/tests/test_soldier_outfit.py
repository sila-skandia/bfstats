"""What a drawn soldier wears: the level's soldier template for his side, his
kit's primary in his hands, and the kit's worn parts on his bones.

The bots used to wear `GermanSoldier` and `USMarineSoldier` on every level
with nothing on their heads: a `BFSoldier` template is a body, a head and two
hands, and the helmet, the pack and the pouches belong to the KIT, hung off
three bones of the wearer's skeleton (`A`, `backpack`, `HipPack`). These pin
the resolution the page now does for every body it draws -- the bots on foot,
seated and dead, and the human's own -- through `kit-loadout.js`,
`kit-graft.js` and `soldier-dress.js` under node, on the published tree's own
rows. See `features/bot-body-animation/README.md`.
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
HARNESS = Path(__file__).with_name("soldier_outfit_harness.mjs")
MODULES = ["kit-loadout.js", "kit-icon.js", "kit-graft.js", "soldier-dress.js"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierOutfitTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_each_side_wears_the_levels_own_soldier(self) -> None:
        # `game.setTeamSkin`, through `_shared/loadouts.json`: the Afrika Korps
        # and the British on El Alamein, the Japanese and the Marines on Wake.
        soldiers = self.results["soldiers"]
        self.assertEqual({"1": "GermanDesertSoldier", "2": "BritishSoldier"},
                         soldiers["el_alamein"])
        self.assertEqual({"1": "JapaneseSoldier", "2": "USMarineSoldier"},
                         soldiers["wake"])

    def test_a_level_the_loadouts_do_not_know_falls_back_by_nation(self) -> None:
        self.assertEqual({"1": "GermanSoldier", "2": "USSoldier"},
                         self.results["soldiers"]["no_such_level"])

    def test_a_bot_draws_his_sides_kit_and_its_primary(self) -> None:
        self.assertEqual(["GB_Assault:Bar1918"], self.results["alliedKits"])

    def test_the_pose_tried_first_is_the_levels_soldier_with_the_kits_weapon(self) -> None:
        self.assertEqual([["GermanDesertSoldier", "Sg44"], ["GermanSoldier", "Sg44"],
                          ["GermanDesertSoldier", "Colt"], ["GermanSoldier", "Colt"]],
                         self.results["candidates"])
        self.assertEqual([["USMarineSoldier", "Colt"]], self.results["candidatesSame"])
        self.assertEqual([["GermanSoldier", "K98"], ["GermanSoldier", "Colt"]],
                         self.results["candidatesNoLevel"])

    def test_the_kits_parts_hang_on_their_own_bones(self) -> None:
        r = self.results
        self.assertEqual(3, r["hung"])
        self.assertEqual({"head": 1, "back": 1, "hip": 1}, r["worn"])
        self.assertEqual({"head": "A", "back": "backpack", "hip": "HipPack"}, r["bones"])
        # The pinned slot rotation, the one the eye settled in `kits.html`.
        self.assertEqual(r["slotRotation"], r["headRotation"])
        # Each wearer's copy takes the level's shading.
        self.assertEqual(3, r["shaded"])

    def test_undressing_takes_every_part_off_and_frees_only_the_wearers_materials(self) -> None:
        r = self.results
        self.assertEqual(3, r["undressed"])
        self.assertEqual({}, r["afterUndress"])
        self.assertTrue(r["ownDisposed"])

    def test_the_stowed_weapon_is_the_subtree_with_the_meshes(self) -> None:
        # `UsSoldier.ske` has a bone named `Thompson`; the loader names the
        # weapon's own node `Thompson_1`. The death has to hide the latter.
        self.assertEqual("Thompson_1", self.results["weapon"])
        self.assertIsNone(self.results["weaponMissing"])

    def test_a_figure_gone_or_a_kit_unknown_is_left_bare(self) -> None:
        self.assertEqual(0, self.results["lateHung"])
        self.assertEqual(0, self.results["unknownKit"])

    def test_a_mod_tree_dresses_from_its_own_kits_and_falls_back_to_vanillas(self) -> None:
        r = self.results
        self.assertEqual(2, r["modHung"])
        self.assertEqual({"head": 1, "back": 1}, r["modWorn"])
        self.assertEqual(2, r["vanillaKitInMod"])
        self.assertEqual(["models/mods/xp/US_Scout_Helm.kit.glb",
                          "models/Germ_DesertHelmet.kit.glb"], r["partUrls"])


if __name__ == "__main__":
    unittest.main()
