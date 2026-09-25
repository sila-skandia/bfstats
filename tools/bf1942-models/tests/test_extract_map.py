# Gap 12 exporter regression: the shared defaultTexture.dds fallback and the
# dry gate, exercised through `build_scene` on a real level (the counting rule
# lives in test_level.py; this file pins what the EXPORTER emits).
import json
import struct
import unittest
from pathlib import Path

from bf42.level import (LevelInfo, decode_heightmap, find_level_archives,
                        load_level_files, parse_init_con, parse_terrain_con)
from bf42.rfa import ArchivePool
from bf42.terrain import default_patches
from extract_map import build_scene


def _game_files(level: str):
    game_dir = Path.home() / "bf1942-game"
    if not (game_dir / "Mods" / "bf1942").is_dir():
        return None
    return load_level_files(
        find_level_archives(game_dir, "bf1942", level), level)


def _level_state(files, level: str):
    info = LevelInfo(
        name=level,
        terrain=parse_terrain_con(files.read("Init/Terrain.con").decode("latin-1")))
    parse_init_con(files.read("Init.con").decode("latin-1"), info)
    heightmap = decode_heightmap(
        files.read("Heightmap.raw"), info.terrain.world_size,
        info.terrain.y_scale)
    return info, heightmap


def _texture_pool(game_dir: Path) -> ArchivePool:
    pool = ArchivePool()
    for name in ("texture.rfa", "texture_001.rfa"):
        path = game_dir / "Mods" / "bf1942" / "Archives" / name
        if path.exists():
            pool.add(path)
    return pool


def _material_names(glb: bytes) -> set[str]:
    clen = struct.unpack("<I", glb[12:16])[0]
    document = json.loads(glb[20:20 + clen])
    return {material.get("name", "") for material in document.get("materials", [])}


class DefaultTextureFallbackTests(unittest.TestCase):
    """Berlin ships no terrainDefault.dds and has sea: with the texture pool
    the uncovered patches fill with the SHARED texture and the dry gate skips
    the wet ones; without a pool nothing fills (today's behaviour, pre-Gap-12)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.files = _game_files("Berlin")
        if cls.files is None:
            raise unittest.SkipTest("no BF1942 install")
        cls.info, cls.heightmap = _level_state(cls.files, "Berlin")
        cls.game_dir = Path.home() / "bf1942-game"

    def _build(self, textures) -> tuple[bytes, dict]:
        return build_scene(
            self.files, self.info, self.heightmap, None,
            max_texture=512, include_objects=False, textures=textures)

    def test_pool_fallback_fills_dry_patches_only(self) -> None:
        glb, report = self._build(_texture_pool(self.game_dir))

        self.assertGreater(report["terrain"]["defaultTiles"], 0)
        self.assertIn("textureDefault", _material_names(glb))

        total = len(default_patches(
            self.info.terrain, [(c, r) for c, r, _ in self.files.tiles()]))
        # Berlin has sea floor: the gate must leave SOME patches unfilled.
        self.assertLess(report["terrain"]["defaultTiles"], total)
        self.assertGreater(total - report["terrain"]["defaultTiles"], 0)

    def test_no_pool_means_no_fill(self) -> None:
        glb, report = self._build(None)

        self.assertEqual(0, report["terrain"]["defaultTiles"])
        self.assertNotIn("textureDefault", _material_names(glb))


if __name__ == "__main__":
    unittest.main()
