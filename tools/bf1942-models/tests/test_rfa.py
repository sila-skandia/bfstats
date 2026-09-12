from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.rfa import ArchivePool  # noqa: E402


class ArchivePoolTests(unittest.TestCase):
    def test_basename_fills_an_exact_texture_miss(self) -> None:
        pool = ArchivePool()
        nested = ("warfront", None, "Texture/ItalyBritts/britt1_r.dds")
        pool._index["texture/italybritts/britt1_r.dds"] = nested
        pool._basename["britt1_r.dds"] = nested

        self.assertEqual(
            "Texture/ItalyBritts/britt1_r.dds",
            pool.resolve_ext("texture/britt1_r", (".dds", ".tga")),
        )

    def test_exact_texture_path_wins_over_basename(self) -> None:
        pool = ArchivePool()
        nested = ("warfront", None, "Texture/African/Brit/sherma_i.dds")
        exact = ("vanilla", None, "Texture/sherma_i.dds")
        pool._index["texture/sherma_i.dds"] = exact
        pool._basename["sherma_i.dds"] = nested

        self.assertEqual(
            "Texture/sherma_i.dds",
            pool.resolve_ext("texture/sherma_i", (".dds", ".tga")),
        )

    def test_extend_from_keeps_first_hits(self) -> None:
        primary = ArchivePool()
        fallback = ArchivePool()
        first = ("level", None, "bf1942/levels/Wake/Texture/foo.dds")
        second = ("mod", None, "Texture/foo.dds")
        primary._index["texture/foo.dds"] = first
        fallback._index["texture/foo.dds"] = second
        fallback._basename["foo.dds"] = second
        primary.extend_from(fallback)

        self.assertEqual(
            "bf1942/levels/Wake/Texture/foo.dds",
            primary.resolve_ext("texture/foo", (".dds", ".tga")),
        )
        self.assertEqual("Texture/foo.dds", primary._basename["foo.dds"][2])

    def test_alternative_path_wins_over_the_exact_texture(self) -> None:
        # Tobruk's `textureManager.alternativePath Texture/Africa`: the desert
        # repaint must beat the green `texture/sherma_i` a shader asks for.
        pool = ArchivePool()
        base = ("vanilla", None, "Texture/sherma_i.dds")
        desert = ("vanilla", None, "Texture/Africa/sherma_i.dds")
        pool._index["texture/sherma_i.dds"] = base
        pool._index["texture/africa/sherma_i.dds"] = desert
        pool.set_alternative_paths(["Texture/Africa"])

        self.assertEqual(
            "Texture/Africa/sherma_i.dds",
            pool.resolve_ext("texture/sherma_i", (".dds", ".tga")),
        )

    def test_alternative_path_misses_fall_through(self) -> None:
        pool = ArchivePool()
        base = ("vanilla", None, "Texture/palm02_l.dds")
        pool._index["texture/palm02_l.dds"] = base
        pool.set_alternative_paths(["Texture/Africa"])

        self.assertEqual(
            "Texture/palm02_l.dds",
            pool.resolve_ext("texture/palm02_l", (".dds", ".tga")),
        )

    def test_no_alternative_path_changes_nothing(self) -> None:
        pool = ArchivePool()
        desert = ("vanilla", None, "Texture/Africa/sherma_i.dds")
        base = ("vanilla", None, "Texture/sherma_i.dds")
        pool._index["texture/africa/sherma_i.dds"] = desert
        pool._index["texture/sherma_i.dds"] = base

        self.assertEqual(
            "Texture/sherma_i.dds",
            pool.resolve_ext("texture/sherma_i", (".dds", ".tga")),
        )

    def test_mod_prefix_fills_a_vanilla_basename_miss(self) -> None:
        pool = ArchivePool()
        nested = ("fh", None, "texture/FH_pahile_c.dds")
        pool._basename["fh_pahile_c.dds"] = nested

        self.assertEqual(
            "texture/FH_pahile_c.dds",
            pool.resolve_ext("texture/PAHILE_C", (".dds", ".tga")),
        )


if __name__ == "__main__":
    unittest.main()
