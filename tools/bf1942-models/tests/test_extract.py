from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import spawn_folder, variant_suffix  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
