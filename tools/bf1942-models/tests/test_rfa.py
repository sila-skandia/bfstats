from __future__ import annotations

import contextlib
import io
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


class TryReadTests(unittest.TestCase):
    """One corrupt entry is one missing file, not a dead extraction.

    EoD's `objects.rfa` has three entries whose LZO streams overrun their
    lookbehind window, out of 4806. Reading every `.con` in the pool must
    survive them.
    """

    class _Archive:
        def __init__(self, payloads: dict[str, bytes | Exception]):
            self.entries = list(payloads)
            self._payloads = payloads

        def read(self, name: str) -> bytes:
            value = self._payloads[name]
            if isinstance(value, Exception):
                raise value
            return value

    def _pool(self, payloads) -> ArchivePool:
        pool = ArchivePool()
        archive = self._Archive(payloads)
        for name in archive.entries:
            pool._index[name.lower()] = ("objects.rfa", archive, name)
        return pool

    def test_returns_none_for_an_undecompressable_entry(self) -> None:
        pool = self._pool({
            "objects/Good.con": b"ObjectTemplate.create",
            "objects/Bad.con": ValueError("lzo1x_decompress_safe returned -6"),
        })

        self.assertEqual(b"ObjectTemplate.create", pool.try_read("objects/good.con"))
        with contextlib.redirect_stderr(io.StringIO()) as warned:
            self.assertIsNone(pool.try_read("objects/bad.con"))
            # Warned once, not once per pass over the pool.
            self.assertIsNone(pool.try_read("objects/bad.con"))
        self.assertEqual(1, warned.getvalue().count("objects/Bad.con"))
        # And still raises for callers that want the failure.
        with self.assertRaises(ValueError):
            pool.read("objects/bad.con")

    def test_missing_name_is_none_rather_than_a_key_error(self) -> None:
        self.assertIsNone(self._pool({}).try_read("objects/nope.con"))


if __name__ == "__main__":
    unittest.main()
