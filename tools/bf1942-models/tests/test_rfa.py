from __future__ import annotations

import contextlib
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import rfa  # noqa: E402
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


class LevelObjectTests(unittest.TestCase):
    """`add_level_objects` — templates a level declares inside its own archive."""

    class _Archive:
        def __init__(self, names) -> None:
            self.entries = list(names)

    def _add(self, names):
        pool = ArchivePool()
        archive = self._Archive(names)
        # Stand in for the RfaArchive the real method opens from a path.
        pool._archives.append(("coral_sea", archive))
        added = 0
        for name in archive.entries:
            parts = name.replace("\\", "/").split("/")
            lowered = [p.lower() for p in parts]
            try:
                start = lowered.index("objects")
            except ValueError:
                continue
            if start < 2 or lowered[start - 2] != "levels":
                continue
            entry = ("coral_sea", archive, name)
            for key in (name.lower(), "/".join(parts[start:]).lower()):
                if key not in pool._index:
                    pool._index[key] = entry
                    added += 1
            base = parts[-1].lower()
            pool._basename.setdefault(base, entry)
        return pool, added

    def test_registers_a_level_local_template_under_both_keys(self) -> None:
        pool, added = self._add(["bf1942/Levels/Coral_sea/Objects/Hiryu/Objects.con"])
        self.assertEqual(2, added)
        # The full archive path, which is what build_library iterates...
        self.assertIn("bf1942/levels/coral_sea/objects/hiryu/objects.con", pool._index)
        # ...and the tail, so a Geometries.con reference resolves like a global one.
        self.assertIn("objects/hiryu/objects.con", pool._index)

    def test_ignores_everything_outside_the_objects_subtree(self) -> None:
        pool, added = self._add([
            "bf1942/Levels/Coral_sea/Textures/foo.dds",
            "bf1942/Levels/Coral_sea/ObjectLightmaps/bar.dds",
            "bf1942/Levels/Coral_sea/Init/Terrain.con",
        ])
        self.assertEqual(0, added)
        self.assertEqual({}, pool._index)

    def test_a_folder_merely_called_objects_is_not_a_level_subtree(self) -> None:
        # Only `Levels/<Map>/Objects/...` counts; a stray Objects/ elsewhere in a
        # level archive must not be mistaken for one.
        pool, added = self._add(["bf1942/Something/Objects/Hiryu/Objects.con"])
        self.assertEqual(0, added)


class LevelTextureNameTests(unittest.TestCase):
    """`level_texture_names` - the cheap "could this level reskin it?" index.

    `extract_models.export_template` skips a level when none of these names
    meets a name the model asks for, instead of exporting the whole model and
    discarding it (Eve of Destruction: 68,115 exports to keep about 200). The
    skip is only safe while this index and `ArchivePool.add_level` agree on
    which entries count, so both are driven from one filter and that is pinned.
    """

    ENTRIES = [
        "bf1942/levels/El_Alamein/AltTextures/SherW2_f.dds",
        "bf1942/levels/El_Alamein/Texture/hull.v2.tga",
        "bf1942/levels/El_Alamein/Custom Textures/Willy_Desert.DDS",
        # not vehicle textures, by `add_level`'s own rules:
        "bf1942/levels/El_Alamein/Textures/Tx03x07.dds",          # terrain tile
        "bf1942/levels/El_Alamein/Texture/Menu/briefing.dds",     # menu art
        "bf1942/levels/El_Alamein/Textures/ObjectLightmaps/a.dds",
        "bf1942/levels/El_Alamein/Heightmap.raw",                 # too shallow
        "bf1942/levels/El_Alamein/Sounds/wind.wav",               # wrong subdir
    ]

    def test_a_request_meets_a_level_file_by_leaf_or_stem(self) -> None:
        self.assertEqual({"p4main_f"}, rfa.texture_name_keys("texture/P4main_f"))
        self.assertEqual({"sherw2_f.dds", "sherw2_f"},
                         rfa.texture_name_keys("AltTextures/SherW2_f.dds"))
        # A name with a dot of its own still meets itself.
        self.assertTrue(rfa.texture_name_keys("texture/hull.v2")
                        & rfa.texture_name_keys("Texture/hull.v2.tga"))

    def test_the_index_is_exactly_what_add_level_registers(self) -> None:
        kept = list(rfa._level_texture_entries(self.ENTRIES))
        self.assertEqual(
            ["SherW2_f.dds", "hull.v2.tga", "Willy_Desert.DDS"],
            [basename for _name, basename in kept])

    def test_a_model_that_asks_for_none_of_them_is_skipped(self) -> None:
        names = set()
        for _name, basename in rfa._level_texture_entries(self.ENTRIES):
            names |= rfa.texture_name_keys(basename)
        sherman = rfa.texture_name_keys("texture/sherW2_f") | rfa.texture_name_keys("texture/Brown_r")
        spitfire = rfa.texture_name_keys("texture/spit_main") | rfa.texture_name_keys("texture/Brown_r")
        self.assertTrue(sherman & names, "El Alamein reskins the Sherman")
        self.assertFalse(spitfire & names, "and has nothing for a Spitfire")


if __name__ == "__main__":
    unittest.main()
