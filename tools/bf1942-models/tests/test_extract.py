from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import spawn_folder  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
