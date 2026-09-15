from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from bf42.kit import TeamLoadout, collect, parse_level_kits  # noqa: E402
from extract_loadouts import build_manifest  # noqa: E402


class LoadoutManifestTests(unittest.TestCase):
    """The file the map page loads: kits by declared name, levels by directory."""

    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Items/JapKit/AntiTank/Objects.con", """
ObjectTemplate.create Kit Jap_AT
ObjectTemplate.setType AT
ObjectTemplate.setKitTeam 1
ObjectTemplate.addTemplate Panzershreck
ObjectTemplate.addTemplate WalterP38
ObjectTemplate.addTemplate KnifeAxis
""")
        library.add_con("Objects/Items/USKit/AntiTank/Objects.con", """
ObjectTemplate.create Kit Us_AT
ObjectTemplate.setType AT
ObjectTemplate.setKitTeam 2
ObjectTemplate.addTemplate Bazooka
ObjectTemplate.addTemplate Colt
""")
        library.add_con("Objects/Items/USKit/Medic/Objects.con", """
ObjectTemplate.create Kit US_Medic
ObjectTemplate.setType Medic
ObjectTemplate.setKitTeam 2
ObjectTemplate.addTemplate Thompson
""")
        library.add_con("Objects/HandWeapons/Panzershreck/Objects.con", """
ObjectTemplate.create HandFireArms Panzershreck
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/Bazooka/Objects.con", """
ObjectTemplate.create HandFireArms Bazooka
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/Thompson/Objects.con", """
ObjectTemplate.create HandFireArms Thompson
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/WalterP38/Objects.con", """
ObjectTemplate.create HandFireArms WalterP38
ObjectTemplate.itemIndex 2
""")
        library.add_con("Objects/HandWeapons/Colt/Objects.con", """
ObjectTemplate.create HandFireArms Colt
ObjectTemplate.itemIndex 2
""")
        library.add_con("Objects/HandWeapons/KnifeAxis/Objects.con", """
ObjectTemplate.create HandFireArms KnifeAxis
ObjectTemplate.itemIndex 1
""")
        return library

    def manifest(self, init: str, level: str = "Wake") -> dict:
        library = self.library()
        kits = collect(library)
        return build_manifest(library, kits, {level: parse_level_kits(init)}, "bf1942")

    def test_levels_are_keyed_by_the_directory_the_map_extractor_writes(self) -> None:
        manifest = self.manifest("""
game.setTeamSkin 1 JapaneseSoldier
game.setKit 1 2 Jap_AT
game.setTeamSkin 2 USSoldier
game.setKit 2 2 us_at
game.setKit 2 3 US_Medic
""", level="Wake")
        self.assertEqual(["wake"], list(manifest["levels"]))
        wake = manifest["levels"]["wake"]
        self.assertEqual("JapaneseSoldier", wake["1"]["soldier"])
        self.assertEqual({"2": "Jap_AT"}, wake["1"]["slots"])
        # The level spelled `us_at`; the slot names the kit as declared, which
        # is the key the page uses into `kits`.
        self.assertEqual({"2": "Us_AT", "3": "US_Medic"}, wake["2"]["slots"])

    def test_kits_carry_their_primary_and_class(self) -> None:
        manifest = self.manifest("""
game.setKit 1 2 Jap_AT
game.setKit 2 2 Us_AT
""")
        self.assertEqual("Panzershreck", manifest["kits"]["Jap_AT"]["primary"])
        self.assertEqual("Anti-tank", manifest["kits"]["Jap_AT"]["class"])
        self.assertEqual("Japanese", manifest["kits"]["Jap_AT"]["nation"])
        self.assertEqual(1, manifest["kits"]["Jap_AT"]["team"])
        self.assertEqual("Bazooka", manifest["kits"]["Us_AT"]["primary"])
        self.assertEqual(["Bazooka", "Colt"], manifest["kits"]["Us_AT"]["items"])
        self.assertEqual(3, manifest["primaryItemIndex"])
        self.assertEqual("bf1942", manifest["mod"])

    def test_only_kits_a_level_binds_are_listed(self) -> None:
        # US_Medic is declared but no level names it here.
        manifest = self.manifest("game.setKit 1 2 Jap_AT\n")
        self.assertEqual(["Jap_AT"], list(manifest["kits"]))

    def test_a_kit_the_library_lacks_keeps_its_name_in_the_slot(self) -> None:
        # Visible in the file rather than dropped: the page treats an unknown
        # kit as no primary and falls back.
        manifest = self.manifest("game.setKit 2 1 Canadian_Assault\n")
        self.assertEqual({"1": "Canadian_Assault"}, manifest["levels"]["wake"]["2"]["slots"])
        self.assertNotIn("Canadian_Assault", manifest["kits"])

    def test_an_empty_sweep_still_writes_a_well_formed_file(self) -> None:
        manifest = build_manifest(self.library(), {}, {}, "bf1942")
        self.assertEqual({}, manifest["kits"])
        self.assertEqual({}, manifest["levels"])

    def test_a_team_with_a_soldier_and_no_kits_is_kept(self) -> None:
        manifest = build_manifest(
            self.library(), collect(self.library()),
            {"Berlin": {1: TeamLoadout(soldier="GermanSoldier")}}, "bf1942")
        self.assertEqual({"soldier": "GermanSoldier", "slots": {}},
                         manifest["levels"]["berlin"]["1"])

    def test_kit_carries_healthbar_icons_weapon_icons_and_soldier_hitpoints(self) -> None:
        # Objects/Items/JapKit/AntiTank/Objects.con and
        # Objects/Soldiers/JapaneseSoldier/Objects.con, trimmed to the words
        # this round adds.
        library = ObjectLibrary()
        library.add_con("Objects/Items/JapKit/AntiTank/Objects.con", """
ObjectTemplate.create Kit Jap_AT
ObjectTemplate.setType AT
ObjectTemplate.setKitTeam 1
ObjectTemplate.setHealthBarIcon "Ingame/Healthbar_empty_at_64x64.tga"
ObjectTemplate.setHealthBarFullIcon "Ingame/Healthbar_full_at_64x64.tga"
ObjectTemplate.setKitIcon 1 "kits/Icon_antitank_jap_selected.tga"
ObjectTemplate.addTemplate Panzershreck
ObjectTemplate.addTemplate WalterP38
ObjectTemplate.addTemplate KnifeAxis
ObjectTemplate.addWeaponIcon "Weapon/Icon_panzershreck.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_walterp38.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_knifeaxis.tga"
""")
        library.add_con("Objects/HandWeapons/Panzershreck/Objects.con", """
ObjectTemplate.create HandFireArms Panzershreck
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/WalterP38/Objects.con", """
ObjectTemplate.create HandFireArms WalterP38
ObjectTemplate.itemIndex 2
""")
        library.add_con("Objects/HandWeapons/KnifeAxis/Objects.con", """
ObjectTemplate.create HandFireArms KnifeAxis
ObjectTemplate.itemIndex 1
""")
        library.add_con("Objects/Soldiers/JapaneseSoldier/Objects.con", """
ObjectTemplate.create BFSoldier JapaneseSoldier
ObjectTemplate.hitpoints 30
ObjectTemplate.maxhitpoints 30
""")
        kits = collect(library)
        manifest = build_manifest(library, kits, {
            "Wake": parse_level_kits(
                "game.setTeamSkin 1 JapaneseSoldier\n"
                "game.setKit 1 2 Jap_AT\n")},
            "bf1942")

        row = manifest["kits"]["Jap_AT"]
        self.assertEqual("Ingame/Healthbar_empty_at_64x64.tga", row["healthBarIcon"])
        self.assertEqual("Ingame/Healthbar_full_at_64x64.tga", row["healthBarFullIcon"])
        self.assertEqual({"index": 1, "icon": "kits/Icon_antitank_jap_selected.tga"},
                         row["kitIcon"])
        self.assertEqual(
            ["Weapon/Icon_panzershreck.tga", "Weapon/Icon_walterp38.tga",
             "Weapon/Icon_knifeaxis.tga"],
            row["weaponIcons"])
        self.assertEqual(30.0, row["hitpoints"])
        self.assertEqual(30.0, row["maxHitpoints"])
        # Untouched by this round.
        self.assertEqual("Japanese", row["nation"])
        self.assertEqual("Panzershreck", row["primary"])

    def test_a_kit_with_none_of_the_new_hud_words_reports_them_as_absent(self) -> None:
        # US_Medic in the shared fixture declares none of setHealthBarIcon /
        # setKitIcon / addWeaponIcon, and no level binds it to a soldier here.
        manifest = self.manifest("game.setKit 2 3 US_Medic\n")
        row = manifest["kits"]["US_Medic"]

        self.assertIsNone(row["healthBarIcon"])
        self.assertIsNone(row["kitIcon"])
        self.assertEqual([], row["weaponIcons"])
        self.assertIsNone(row["hitpoints"])
        self.assertIsNone(row["maxHitpoints"])


if __name__ == "__main__":
    unittest.main()
