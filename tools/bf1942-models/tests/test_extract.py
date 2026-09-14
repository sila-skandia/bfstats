from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from extract_models import catalogue, spawn_folder, variant_suffix  # noqa: E402


def library_with(*sources: tuple[str, str]) -> ObjectLibrary:
    library = ObjectLibrary()
    for path, text in sources:
        library.add_con(path, text)
    return library


# The shape of `Objects/HandWeapons/K98/Objects.con`, cut down to the two
# `HandFireArms` it declares and the render bundles they choose between.
K98_FOLDER = """
ObjectTemplate.create HandFireArms K98
ObjectTemplate.magSize 5
ObjectTemplate.addTemplate K98Lod

ObjectTemplate.create HandFireArms K98Sniper
ObjectTemplate.useScope 1
ObjectTemplate.addTemplate K98SniperLod

ObjectTemplate.create LodObject K98Lod
ObjectTemplate.addTemplate K98Complex

ObjectTemplate.create LodObject K98SniperLod
ObjectTemplate.addTemplate K98SniperComplex

ObjectTemplate.create SimpleObject K98Scope
ObjectTemplate.geometry K98Scope
"""


class SpawnFolderTests(unittest.TestCase):
    def test_vehicle_folder_is_the_leaf_directory(self) -> None:
        self.assertEqual(
            "Sherman",
            spawn_folder("Objects/Vehicles/Land/Sherman/Objects.con"),
        )
        self.assertEqual(
            "Stuka",
            spawn_folder("Objects/Vehicles/Air/Stuka/Objects.con"),
        )
        self.assertEqual(
            "Elco80",
            spawn_folder("Objects/Vehicles/Sea/Elco80/Objects.con"),
        )

    def test_soldier_folder_is_not_the_con_filename(self) -> None:
        self.assertEqual(
            "BritishSoldier",
            spawn_folder("Objects/Soldiers/BritishSoldier/Objects.con"),
        )


class VariantSuffixTests(unittest.TestCase):
    def test_default_variant_has_no_suffix(self) -> None:
        self.assertEqual("", variant_suffix("complex", 0, None))

    def test_cockpit_leads_the_suffix_so_the_file_sorts_with_its_vehicle(self) -> None:
        self.assertEqual(
            ".cockpit", variant_suffix("complex", 0, None, first_person=True))
        self.assertEqual(
            ".cockpit.lod1.Truk",
            variant_suffix("complex", 1, "Truk", first_person=True),
        )
        self.assertEqual(".wreck", variant_suffix("wreck", 0, None))


class CatalogueTests(unittest.TestCase):
    """What counts as a spawnable object — folder layout, or declaration."""

    def test_a_second_handfirearms_in_one_folder_is_catalogued(self) -> None:
        library = library_with(("Objects/HandWeapons/K98/Objects.con", K98_FOLDER))

        names = {name for name, _category, _source in catalogue(None, library)}

        # The whole point: `K98Sniper` is declared in `K98/`, so it is named
        # after no folder at all, yet it is a weapon in its own right.
        self.assertIn("K98", names)
        self.assertIn("K98Sniper", names)

    def test_the_parts_a_weapon_is_made_of_are_not_weapons(self) -> None:
        library = library_with(("Objects/HandWeapons/K98/Objects.con", K98_FOLDER))

        names = {name for name, _category, _source in catalogue(None, library)}

        # `K98Scope` is a SimpleObject the sniper carries, and the two LodObjects
        # are the alternatives it picks between. Admitting them would put four
        # spare parts in the armoury next to the rifle they belong to.
        self.assertEqual({"K98", "K98Sniper"}, names)

    def test_a_vehicle_folder_still_yields_only_the_vehicle(self) -> None:
        # A vehicle declares dozens of PlayerControlObjects — turrets and
        # sub-vehicles — so kind cannot decide there and the folder name must.
        library = library_with(("Objects/Vehicles/Land/Sherman/Objects.con", """
ObjectTemplate.create PlayerControlObject Sherman
ObjectTemplate.addTemplate ShermanTurret

ObjectTemplate.create PlayerControlObject ShermanTurret
ObjectTemplate.geometry ShermanTurret
"""))

        self.assertEqual(
            [("Sherman", "land", "Objects/Vehicles/Land/Sherman/Objects.con")],
            catalogue(None, library),
        )

    def test_a_soldiers_parachute_is_not_a_soldier(self) -> None:
        library = library_with(("Objects/Soldiers/Common/Parachute/Objects.con", """
ObjectTemplate.create AnimatedBundle Parachute
ObjectTemplate.geometry Parachute
"""), ("Objects/Soldiers/USSoldier/Objects.con", """
ObjectTemplate.create BFSoldier USSoldier
ObjectTemplate.geometry USSoldier
"""))

        self.assertEqual(
            ["USSoldier"], [name for name, _c, _s in catalogue(None, library)])


if __name__ == "__main__":
    unittest.main()
