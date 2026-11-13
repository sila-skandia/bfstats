"""The HUD's proximity icons: the friendly-mine warning and the depot icons in a seat.

Gap audit 2026-11-12, entries 23 and 44. The client's `MenuMapNode::onPaint`
writes `ShowMineIcon`, `ShowRepairIcon`, `ShowHealIcon` and `ShowReloadIcon`
every paint:

- the mine icon for a friendly round of `projectileType 1` within 30 m of a
  seated player, or within 15 m of an engineer on foot, and never for anyone
  else on foot;
- the depot icons from `SupplyDepot::show{Repair,Heal,Ammo}IconInMenu`
  (lnxded 0x083245d0, 0x08324700, 0x08324810): the wrench never on foot, and
  seated for a listed template in radius whatever its hit points.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "hud_proximity_icons_harness.mjs"
sys.path.insert(0, str(ROOT))


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in ("mine-icon.js", "supply.js"):
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class MineIconTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_retails_numbers(self) -> None:
        o = self.out
        self.assertEqual([15, 30], o["radii"])
        self.assertEqual(1, o["type"])
        self.assertEqual(4, o["kit"])

    def test_on_foot_only_the_engineer_within_fifteen_metres(self) -> None:
        o = self.out
        self.assertTrue(o["engineer15"])
        self.assertFalse(o["engineer15_1"])
        self.assertFalse(o["medicOnFoot"])
        self.assertFalse(o["liveFar"])

    def test_seated_within_thirty_metres(self) -> None:
        o = self.out
        self.assertTrue(o["seated30"])
        self.assertFalse(o["seated30_1"])
        self.assertTrue(o["liveFriendly"])

    def test_only_a_live_players_own_sides_type_one_round(self) -> None:
        o = self.out
        for key in ("enemyMine", "otherRound", "dead", "liveEnemy", "livePack"):
            self.assertFalse(o[key], key)
        self.assertTrue(o["keepsTeam"])

    def test_the_type_comes_from_the_table(self) -> None:
        o = self.out
        self.assertEqual(1, o["typeFromRow"])
        self.assertEqual(-1, o["typeOther"])
        self.assertEqual(1, o["typeLegacy"])
        self.assertEqual(-1, o["typeLegacyOther"])
        self.assertEqual(-1, o["typeNamedButTableKnows"])

    def test_the_exporter_carries_a_listed_rounds_type(self) -> None:
        from bf42 import con
        from extract_map import projectile_materials
        library = con.ObjectLibrary()
        library.add_con("Objects/Test/Weapons.con",
            "ObjectTemplate.create Projectile LandmineProjectile\n"
            "ObjectTemplate.addToProjectileList 1\n"
            "ObjectTemplate.projectileType 1\n"
            "ObjectTemplate.create Projectile FloatingMine\n"
            "rem ObjectTemplate.projectileType 1\n"
            "ObjectTemplate.create Projectile Unlisted\n"
            "ObjectTemplate.projectileType 1\n")
        table = projectile_materials(library)
        self.assertEqual(1, table["landmineprojectile"]["projectileType"])
        self.assertNotIn("projectileType", table.get("floatingmine", {}))
        self.assertNotIn("projectileType", table.get("unlisted", {}))


class SeatedDepotIconTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_tank_on_a_repair_pad(self) -> None:
        o = self.out
        self.assertEqual({"repair": True, "heal": False, "reload": True}, o["driver"])
        self.assertTrue(o["wholeTankStillShows"])
        self.assertTrue(o["caseBlind"])
        self.assertTrue(o["atRadius"]["repair"])
        self.assertEqual({"repair": False, "heal": False, "reload": False}, o["outOfRange"])

    def test_the_wrench_is_for_the_listed_template_only(self) -> None:
        self.assertFalse(self.out["otherTemplate"]["repair"])

    def test_reload_asks_the_seat_guns_ammo_type(self) -> None:
        o = self.out
        self.assertFalse(o["otherAmmoTag"]["reload"])
        self.assertTrue(o["unknownTag"]["reload"])
        self.assertFalse(o["noGuns"]["reload"])

    def test_a_seated_soldier_is_healed_only_by_a_depot_on_their_own_root(self) -> None:
        o = self.out
        self.assertFalse(o["driver"]["heal"])
        self.assertEqual({"repair": False, "heal": True, "reload": True}, o["ridingTheDepot"])
        self.assertEqual({"repair": False, "heal": False, "reload": False}, o["ridingEnemySide"])

    def test_the_page_writes_them(self) -> None:
        foot = (VIEWER / "soldier-view.js").read_text()
        self.assertIn("page.hudBridge.vars['ShowRepairIcon'] = false;", foot)
        self.assertIn("page.hudBridge.vars['ShowMineIcon'] = friendlyMineNear(", foot)
        seat = (VIEWER / "vehicle-hud.js").read_text()
        for name in ("ShowRepairIcon", "ShowHealIcon", "ShowReloadIcon", "ShowMineIcon"):
            self.assertIn(f"setHudVar('{name}',", seat)


if __name__ == "__main__":
    unittest.main()
