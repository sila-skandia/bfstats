from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import level  # noqa: E402
from bf42.rfa import RfaArchive, write_rfa  # noqa: E402

# DC Final's `Bocage_Day2/Init/Terrain.con`, trimmed: every terrain file is
# the base level's, by full path.
DAY2_TERRAIN = """\
GeometryTemplate.create PatchTerrain terrainGeometry
GeometryTemplate.file bf1942\\levels\\bocage\\Heightmap
GeometryTemplate.materialMap bf1942\\levels\\Bocage\\Materialmap
GeometryTemplate.worldSize 2048
GeometryTemplate.texBaseName bf1942\\levels\\bocage\\Textures\\Tx
GeometryTemplate.detailTexName bf1942\\levels\\bocage\\Textures\\Detail
"""


class BorrowedTerrainTests(unittest.TestCase):
    def test_a_variant_names_the_level_it_borrows_from(self) -> None:
        terrain = level.parse_terrain_con(DAY2_TERRAIN)
        self.assertEqual("bf1942/levels/bocage/Heightmap", terrain.heightmap_file)
        self.assertEqual("bf1942/levels/Bocage/Materialmap", terrain.material_map)
        self.assertEqual(["bocage"], level.borrowed_levels(terrain, "Bocage_Day2"))

    def test_a_level_naming_its_own_files_borrows_nothing(self) -> None:
        terrain = level.parse_terrain_con(DAY2_TERRAIN)
        self.assertEqual([], level.borrowed_levels(terrain, "Bocage"))

    def test_the_underlay_answers_full_paths_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "Bocage.rfa"
            own = Path(tmp) / "Bocage_Day2.rfa"
            write_rfa(base, {"bf1942/levels/Bocage/Heightmap.raw": b"hh",
                             "bf1942/levels/Bocage/Init.con": b"base init"})
            write_rfa(own, {"bf1942/levels/Bocage_Day2/Init.con": b"day2 init",
                            "bf1942/levels/Bocage_Day2/Init/Terrain.con": DAY2_TERRAIN.encode()})
            files = level.LevelFiles([RfaArchive(own)], "Bocage_Day2", [RfaArchive(base)])
            terrain = level.parse_terrain_con(files.read("Init/Terrain.con").decode())
            path = level.terrain_file(files, terrain.heightmap_file, "Heightmap.raw")
            self.assertEqual(b"hh", files.read(path))
            # The base level's own scripts never stand in for the variant's.
            self.assertEqual(b"day2 init", files.read("Init.con"))

    def test_a_level_with_its_own_heightmap_reads_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            own = Path(tmp) / "Wake.rfa"
            write_rfa(own, {"bf1942/levels/Wake/Heightmap.raw": b"ww"})
            files = level.LevelFiles([RfaArchive(own)], "Wake")
            self.assertEqual(b"ww", files.read(
                level.terrain_file(files, "bf1942/levels/Wake/Heightmap", "Heightmap.raw")))
            self.assertEqual(b"ww", files.read(level.terrain_file(files, "", "Heightmap.raw")))


if __name__ == "__main__":
    unittest.main()
