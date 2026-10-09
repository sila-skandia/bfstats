"""`extract_map.write_skybox`: the reflection cube's faces resolve through the
chain-wide texture pool, by full path and by basename, and the `.rcm` the
level's `Init.con` names is tried first.

211 of Eve of Destruction's 239 levels, and vanilla's Coral Sea, Guadalcanal,
Truk and Invasion of the Philippines, list faces that are not in their own
archive (another level's, or their own under a misspelt folder); before this
every one of them shipped `envmap: null` and flat, unreflecting water.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402


WAKE_RCM = """[CubeMap]
PositiveX = bf1942\\levels\\Wake\\Textures\\env_Wake_02.dds
NegativeX = bf1942\\levels\\Wake\\Textures\\env_Wake_04.dds
PositiveY = bf1942\\levels\\Wake\\Textures\\env_Wake_05.dds
NegativeY = bf1942\\levels\\Wake\\Textures\\env_Wake_06.dds
PositiveZ = bf1942\\levels\\Wake\\Textures\\env_Wake_01.dds
NegativeZ = bf1942\\levels\\Wake\\Textures\\env_Wake_03.dds
"""

BROKEN_RCM = """[CubeMap]
PositiveX = textures/ENVMAP_0.tga
NegativeX = textures/ENVMAP_1.tga
PositiveY = textures/ENVMAP_2.tga
NegativeY = textures/ENVMAP_3.tga
PositiveZ = textures/ENVMAP_4.tga
NegativeZ = textures/ENVMAP_5.tga
"""


class FakeFiles:
    """A level archive: `names`, `find`, `read`, case-insensitive like `LevelFiles`."""

    def __init__(self, entries: dict[str, bytes]):
        self.entries = entries

    def names(self):
        return list(self.entries)

    def find(self, relative):
        key = relative.replace("\\", "/").lower()
        for name in self.entries:
            low = name.lower()
            if low == key or low.endswith("/" + key):
                return name
        return None

    def read(self, name):
        return self.entries[name]


class FakePool(ArchivePool):
    """An `ArchivePool` fed directly, no archive on disk."""

    def __init__(self, entries: dict[str, bytes]):
        super().__init__()
        self._data = entries
        for name in entries:
            entry = ("fake", self, name)
            self._index.setdefault(name.lower(), entry)
            self._basename.setdefault(name.rsplit("/", 1)[-1].lower(), entry)

    def read(self, name):
        _label, _archive, real = self._index[name.lower()]
        return self._data[real]


def one_texel(width=1, height=1):
    return (width, height, bytes([200, 100, 50, 255]) * (width * height))


class WriteSkyboxTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        patcher = mock.patch.object(extract_map, "decode_dds",
                                    side_effect=lambda data: one_texel())
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def faces(self, level, stem, ext=".dds"):
        return {f"bf1942/levels/{level}/Textures/{stem}_{n:02d}{ext}": b"dds"
                for n in range(1, 7)}

    def test_another_levels_faces_come_from_the_chain_pool(self):
        # M.I.A.'s own archive holds the .rcm and nothing it names.
        files = FakeFiles({"bf1942/levels/M_I_A/Textures/ENVMAP_G_.rcm":
                           WAKE_RCM.encode("latin-1")})
        pool = FakePool(self.faces("Wake", "env_Wake"))

        self.assertIsNone(extract_map.write_skybox(files, self.out))
        written = extract_map.write_skybox(
            files, self.out, textures=pool,
            rcm="bf1942/levels/M_I_A/Textures/ENVMAP_G_.rcm")

        self.assertEqual(["sky/px.png", "sky/nx.png", "sky/py.png",
                          "sky/ny.png", "sky/pz.png", "sky/nz.png"], written)
        for face in written:
            self.assertTrue((self.out / face).is_file(), face)

    def test_a_misspelt_folder_resolves_by_basename(self):
        # Coral Sea names `Corall_sea/`; the files are its own, under `Coral_sea/`.
        rcm = WAKE_RCM.replace("Wake", "Corall_sea").replace("env_Corall_sea", "env_Corall")
        files = FakeFiles({"bf1942/Levels/Coral_sea/Textures/ENVMAP_G_.rcm":
                           rcm.encode("latin-1")})
        pool = FakePool({f"bf1942/Levels/Coral_sea/Textures/env_Corall_{n:02d}.dds": b"d"
                         for n in range(1, 7)})

        written = extract_map.write_skybox(files, self.out, textures=pool)

        self.assertEqual(6, len(written or []))

    def test_tga_names_find_the_dds_the_archive_holds(self):
        # Guadalcanal's ENVMAP.rcm: `textures/ENVMAP_0.tga`, shipped as Envmap_0.dds.
        files = FakeFiles({"bf1942/levels/GuadalCanal/Textures/ENVMAP.rcm":
                           BROKEN_RCM.encode("latin-1")})
        pool = FakePool({f"bf1942/levels/GuadalCanal/Textures/Envmap_{n}.dds": b"d"
                         for n in range(6)})

        written = extract_map.write_skybox(files, self.out, textures=pool)

        self.assertEqual(6, len(written or []))

    def test_the_named_rcm_is_tried_first_and_a_failed_one_is_not_the_end(self):
        entries = {
            # Sorts first, resolves to nothing: before, this ended the search.
            "bf1942/levels/X/Textures/ENVMAP.rcm": BROKEN_RCM.encode("latin-1"),
            "bf1942/levels/X/Textures/ENVMAP_G_.rcm": WAKE_RCM.encode("latin-1"),
        }
        files = FakeFiles(entries)
        pool = FakePool(self.faces("Wake", "env_Wake"))

        self.assertEqual(
            ["bf1942/levels/X/Textures/ENVMAP_G_.rcm",
             "bf1942/levels/X/Textures/ENVMAP.rcm"],
            extract_map._cubemap_candidates(files, "bf1942/levels/X/Textures/ENVMAP_G_.rcm"))
        # Unnamed: the broken one is tried and skipped, the good one wins.
        self.assertEqual(6, len(extract_map.write_skybox(files, self.out, textures=pool) or []))

    def test_an_unreadable_face_fails_that_rcm_only(self):
        files = FakeFiles({"bf1942/levels/X/Textures/ENVMAP_G_.rcm":
                           WAKE_RCM.encode("latin-1")})
        pool = FakePool(self.faces("Wake", "env_Wake"))
        with mock.patch.object(extract_map, "decode_dds",
                               side_effect=ValueError("scrambled header")):
            self.assertIsNone(extract_map.write_skybox(files, self.out, textures=pool))
        self.assertFalse((self.out / "sky").exists())


if __name__ == "__main__":
    unittest.main()
