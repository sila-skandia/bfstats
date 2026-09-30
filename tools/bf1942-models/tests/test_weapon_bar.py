"""The weapon-select bar: the client HUD's `Weapon` group (`viewer/weapon-bar.js`),
driven headless by `weapon_bar_harness.mjs`.

Ledger HUD-14..HUD-17. The layout gates the bar's fifth and sixth slots on
`Weapon/NumberOfItems`, which nothing wrote, so no kit ever showed its
binoculars, M203, GP30, landmine, repair pack or smoke and no slot past four
highlighted. The engine writes it every painted frame as the length of the
carried kit's `addWeaponIcon` list (0x006d4c20, from 0x006ad836). The rest is
the group's own state machine: the wheel only moves the highlight (3.0 menu
seconds), an item change raises the bar on that item (1.5) or takes it down,
Fire commits a wheel-raised bar, and the layout's timeout node puts the
highlight back on the item in hand.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("weapon_bar_harness.mjs")
MODULES = {"weapon-bar.js": VIEWER / "weapon-bar.js", "hud.js": VIEWER / "hud.js"}
TREES = {
    "vanilla": (VIEWER / "maps/_shared/hud/hud-layout.json", VIEWER / "maps/_shared/loadouts.json"),
    "dc_final": (VIEWER / "maps/mods/dc_final/_shared/hud/hud-layout.json",
                 VIEWER / "maps/mods/dc_final/_shared/loadouts.json"),
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    args = []
    for name, (layout, loadouts) in TREES.items():
        if layout.exists() and loadouts.exists():
            args += [name, str(layout), str(loadouts)]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs"), *args],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class WeaponBarStateTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_number_key_raises_the_bar_on_its_item_for_one_and_a_half_menu_seconds(self) -> None:
        pick = self.r["pick"]
        self.assertEqual({"selecting": True, "picked": True, "weaponSelect": 5, "activeWeapon": 5,
                          "timeOut": 1.5}, {k: pick[k] for k in
                                            ("selecting", "picked", "weaponSelect", "activeWeapon", "timeOut")})
        # 1/30 a painted frame, summed in float32 as the FloatData is: 45 steps
        # land a hair under 1.5, so the node fires on the 46th.
        self.assertEqual(46, pick["frames"])
        self.assertEqual({"selecting": False, "weaponSelect": 5}, pick["after"])

    def test_fire_under_a_number_keys_bar_is_the_weapons(self) -> None:
        self.assertEqual(-1, self.r["pick"]["firePress"])

    def test_the_wheel_moves_the_highlight_and_raises_nothing(self) -> None:
        wheel = self.r["wheel"]
        self.assertEqual({"selecting": True, "picked": False, "weaponSelect": 4, "activeWeapon": 3,
                          "timeOut": 3.0}, wheel["opened"])
        # A second step restarts the timer.
        self.assertEqual({"weaponSelect": 5, "currentTimeOut": 0}, wheel["second"])
        self.assertEqual(91, wheel["frames"])
        # Left alone, the highlight goes back to the item in hand.
        self.assertEqual({"selecting": False, "weaponSelect": 3}, wheel["after"])

    def test_the_wheel_wraps_over_the_kits_own_icon_count(self) -> None:
        self.assertEqual([2, 3, 4, 5, 1, 2], self.r["wrap"]["next"])
        self.assertEqual([5, 4, 3], self.r["wrap"]["prev"])

    def test_fire_commits_the_highlighted_slot(self) -> None:
        self.assertEqual({"press": 6, "selecting": False, "activeWeapon": 6, "weaponSelect": 6},
                         self.r["commit"])
        self.assertEqual({"press": 0, "selecting": False}, self.r["commitSame"])
        # The dispatcher's MenuSelect table stops at six: swallowed, nothing raised.
        self.assertEqual({"weaponSelect": 8, "press": 0, "selecting": True}, self.r["commitPastSix"])
        self.assertEqual({"press": -1}, self.r["commitDown"])

    def test_an_item_change_takes_a_raised_bar_down(self) -> None:
        self.assertEqual({"selecting": False, "activeWeapon": 2, "weaponSelect": 4},
                         self.r["pickWhileUp"])
        self.assertEqual({"took": False, "selecting": False, "weaponSelect": 3}, self.r["hidden"])

    def test_the_feed_writes_number_of_items_and_every_icon(self) -> None:
        feed = self.r["feed"]
        self.assertTrue(feed["sameArray"])
        self.assertEqual(3, feed["vars"]["Weapon/NumberOfItems"])
        self.assertEqual("c", feed["vars"]["Weapon/Icon/WeaponIcon3"])
        self.assertIsNone(feed["vars"]["Weapon/Icon/WeaponIcon4"])
        for name in ("Weapon/SelectingWeapon", "Weapon/WeaponSelect", "Weapon/ActiveWeapon",
                     "Weapon/CurrentWeaponTimeOut", "Weapon/WeaponTimeOut"):
            self.assertIn(name, feed["vars"])


class WeaponBarLayoutTests(unittest.TestCase):
    """The group against each tree's own `hud-layout.json` and loadouts."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()["layouts"]

    def kit(self, tree: str, kit: str) -> dict:
        if tree not in self.r:
            self.skipTest(f"{tree} layout or loadouts not extracted in this tree")
        found = self.r[tree]["kits"].get(kit)
        if found is None:
            self.skipTest(f"{kit} not in {tree} loadouts")
        return found

    def assert_bar(self, tree: str, kit: str, count: int) -> None:
        k = self.kit(tree, kit)
        self.assertEqual(count, len(k["weaponIcons"]))
        for row in k["perSlot"]:
            # Every icon the kit declares, up to the layout's six, whatever is in hand.
            self.assertEqual(list(range(1, min(count, 6) + 1)), row["icons"], (kit, row))
            # The slot in hand highlights, when the kit has that many icons.
            self.assertEqual([row["slot"]] if row["slot"] <= count else [], row["highlight"], (kit, row))

    def test_a_six_item_kit_shows_all_six_and_highlights_five_and_six(self) -> None:
        self.assert_bar("vanilla", "GB_Engineer", 6)          # landmine, repair pack
        self.assert_bar("dc_final", "Us_Assault", 6)          # binoculars, M203
        self.assert_bar("dc_final", "Iraq_Assault", 6)        # binoculars, GP30
        self.assert_bar("dc_final", "US_Support", 6)          # landmine, repair pack
        self.assert_bar("dc_final", "US_SpecOps", 6)          # binoculars, smoke

    def test_a_five_item_kit_shows_five(self) -> None:
        self.assert_bar("vanilla", "GB_Medic", 5)             # medpack
        self.assert_bar("vanilla", "GB_Scout", 5)             # binoculars
        self.assert_bar("dc_final", "Iraq_AT", 5)             # SA-7 at 4, landmine at 5

    def test_a_four_item_kit_still_culls_five_and_six(self) -> None:
        self.assert_bar("vanilla", "GB_Assault", 4)
        self.assert_bar("dc_final", "US_AT3", 4)


if __name__ == "__main__":
    unittest.main()
