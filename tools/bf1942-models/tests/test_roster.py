from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from bf42.roster import (  # noqa: E402
    Roster,
    add_kits,
    nation_label,
    side_of,
    theatre_of,
)


class NationTests(unittest.TestCase):
    def test_kit_and_soldier_spellings_resolve_to_one_nation(self) -> None:
        # `German_AT` and `GermanDesertSoldier` are the same army named twice.
        self.assertEqual("German", nation_label("Ger"))
        self.assertEqual("German", nation_label("german"))
        self.assertEqual("German", nation_label("GermanDesert"))
        self.assertEqual("British", nation_label("GB"))
        self.assertEqual("British", nation_label("Brit"))
        self.assertEqual("Soviet", nation_label("Russ"))

    def test_unknown_nation_is_not_invented(self) -> None:
        self.assertIsNone(nation_label("Klingon"))

    def test_sides_split_axis_from_everyone_else(self) -> None:
        self.assertEqual("Axis", side_of("German"))
        self.assertEqual("Axis", side_of("Japanese"))
        self.assertEqual("Allied", side_of("Soviet"))
        self.assertEqual("Allied", side_of("US Marines"))


class TheatreTests(unittest.TestCase):
    def test_desert_kit_wins_over_the_nations_wearing_it(self) -> None:
        # Kasserine Pass fields Germans against Americans, but in desert skins.
        self.assertEqual(
            "North Africa",
            theatre_of(["GermanDesertSoldier", "USSoldier"]))

    def test_marines_or_japanese_read_as_pacific(self) -> None:
        self.assertEqual("Pacific", theatre_of(["JapaneseSoldier", "USMarineSoldier"]))

    def test_soviets_read_as_the_eastern_front(self) -> None:
        self.assertEqual("Eastern Front", theatre_of(["GermanSoldier", "RussianSoldier"]))

    def test_anything_else_is_the_western_campaign(self) -> None:
        self.assertEqual("Western Europe", theatre_of(["GermanSoldier", "USSoldier"]))

    def test_a_level_naming_no_skins_still_gets_a_theatre(self) -> None:
        self.assertEqual("Western Europe", theatre_of([]))


class KitRosterTests(unittest.TestCase):
    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Items/BritKit/AntiTank/Objects.con",
            """
ObjectTemplate.create Kit GB_AT
ObjectTemplate.setType AT
ObjectTemplate.addTemplate Bazoo
ObjectTemplate.addTemplate Colt
""")
        library.add_con(
            "Objects/Items/GerKit/AntiTank/Objects.con",
            """
ObjectTemplate.create Kit German_AT
ObjectTemplate.addTemplate Panzershreck
ObjectTemplate.addTemplate WalterP38
""")
        # The kit names a wrapper; the real weapon is a child of it.
        library.add_con(
            "Objects/HandWeapons/Bazooka/Objects.con",
            """
ObjectTemplate.create LauncherWrapper Bazoo
ObjectTemplate.addTemplate Bazooka

ObjectTemplate.create ProjectileLauncher Bazooka
""")
        return library

    def test_a_kit_reaches_the_weapon_behind_its_wrapper(self) -> None:
        roster = Roster()
        self.assertEqual(2, add_kits(roster, self.library()))

        bazooka = roster.entry("Bazooka")
        self.assertEqual(["British"], bazooka["factions"])
        self.assertEqual(["Allied"], bazooka["sides"])
        self.assertEqual(["Anti-tank"], bazooka["kitClasses"])

    def test_a_weapon_in_both_sides_kits_carries_both(self) -> None:
        library = self.library()
        library.add_con(
            "Objects/Items/USKit/Engineer/Objects.con",
            """
ObjectTemplate.create Kit US_Engineer
ObjectTemplate.addTemplate Colt
""")
        roster = Roster()
        add_kits(roster, library)

        colt = roster.entry("Colt")
        self.assertEqual(["British", "US"], colt["factions"])
        self.assertEqual(["Anti-tank", "Engineer"], colt["kitClasses"])

    def test_lookup_is_case_insensitive(self) -> None:
        roster = Roster()
        add_kits(roster, self.library())
        self.assertEqual(
            roster.entry("bazooka")["factions"],
            roster.entry("BAZOOKA")["factions"])

    def test_a_template_no_kit_carries_has_no_faction(self) -> None:
        roster = Roster()
        add_kits(roster, self.library())
        self.assertEqual([], roster.entry("Sherman")["factions"])

    def test_templates_outside_the_items_tree_are_not_kits(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Sherman/Objects.con",
            """
ObjectTemplate.create Kit NotReallyAKit
ObjectTemplate.addTemplate Sherman
""")
        roster = Roster()
        self.assertEqual(0, add_kits(roster, library))
        self.assertEqual([], roster.entry("Sherman")["factions"])


if __name__ == "__main__":
    unittest.main()
