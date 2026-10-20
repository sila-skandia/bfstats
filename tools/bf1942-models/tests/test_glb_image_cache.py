"""`extract_viewmodel.glb_image_names` reads a glb's JSON chunk once per
(size, mtime): the skins pass and the models audit's level-paint check parse
every rig and soldier glb, about 30,000 on FHSWEurope, and that was 80 of the
audit's 90 s whatever a run touched (2026-10-20)."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import extract_viewmodel as ev  # noqa: E402
from bf42 import gltf  # noqa: E402


def glb(image_name: str) -> bytes:
    b = gltf.GlbBuilder()
    tex = b.add_image_png(b"x", image_name)
    mat = b.add_material("m", texture=tex)
    mesh = b.add_mesh("m", [gltf.Primitive(positions=[(0, 0, 0), (1, 0, 0), (0, 1, 0)],
                                           indices=[0, 1, 2], uvs=[(0, 0), (1, 0), (0, 1)],
                                           material=mat)])
    return b.build([b.add_node(gltf.Node("n", mesh=mesh))])


class GlbImageCache(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name) / "cache.json"
        self.patches = [mock.patch.object(ev, "_IMAGE_CACHE_PATH", str(self.cache)),
                        mock.patch.object(ev, "_image_cache", None),
                        mock.patch.object(ev, "_image_cache_new", {})]
        for p in self.patches:
            p.start()
        self.path = Path(self.tmp.name) / "a.fp.glb"
        self.path.write_bytes(glb("texture/a.dds"))

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_an_unchanged_file_is_parsed_once(self):
        real = ev._read_image_names
        with mock.patch.object(ev, "_read_image_names", side_effect=real) as read:
            self.assertEqual(ev.glb_image_names(self.path), ["texture/a.dds"])
            self.assertEqual(ev.glb_image_names(self.path), ["texture/a.dds"])
        self.assertEqual(read.call_count, 1)

    def test_a_rewritten_file_is_read_again(self):
        self.assertEqual(ev.glb_image_names(self.path), ["texture/a.dds"])
        self.path.write_bytes(glb("texture/winter_b.dds"))
        st = self.path.stat()
        os.utime(self.path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
        self.assertEqual(ev.glb_image_names(self.path), ["texture/winter_b.dds"])

    def test_the_cache_survives_the_process_and_skips_scratch_files(self):
        ev.glb_image_names(self.path)
        with mock.patch.object(ev.tempfile, "gettempdir", return_value="/nonexistent-scratch"):
            ev._image_cache_save()
        self.assertIn(str(self.path.resolve()).split("|")[0], self.cache.read_text())
        self.cache.unlink()
        ev._image_cache_save()   # under the real temp dir: nothing is kept
        self.assertNotIn("a.fp.glb", self.cache.read_text() if self.cache.exists() else "")


if __name__ == "__main__":
    unittest.main()
