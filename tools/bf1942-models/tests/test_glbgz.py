from __future__ import annotations

import gzip
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import optimise_mesh  # noqa: E402
from bf42 import glbgz, glbopt  # noqa: E402
from test_glbopt import CHECKER, png, textured_glb  # noqa: E402


class CompressTests(unittest.TestCase):
    def test_it_inflates_to_the_input_with_any_gzip_reader(self) -> None:
        data = bytes(range(256)) * 400
        self.assertEqual(data, gzip.decompress(glbgz.compress(data)))

    def test_the_same_bytes_give_the_same_gzip(self) -> None:
        # No name and no timestamp in the header, so a rebuild that changes
        # nothing does not give the publisher a new file to send.
        data = b"glTF" + b"\x00" * 5000
        self.assertEqual(glbgz.compress(data), glbgz.compress(bytes(data)))
        self.assertEqual(b"\x1f\x8b\x08\x00\x00\x00\x00\x00", glbgz.compress(data)[:8])


class FreshnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.glb = Path(self.tmp.name) / "scene.glb"
        self.gz = glbgz.gz_path(self.glb)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_the_gz_sits_beside_the_glb(self) -> None:
        self.assertEqual(Path(self.tmp.name) / "scene.glb.gz", self.gz)

    def test_a_missing_or_foreign_gz_is_not_fresh(self) -> None:
        self.assertFalse(glbgz.is_fresh(b"abc", self.gz))
        self.gz.write_bytes(b"not a gzip at all, twenty bytes")
        self.assertFalse(glbgz.is_fresh(b"abc", self.gz))

    def test_a_gz_of_other_bytes_is_stale_even_at_the_same_length(self) -> None:
        # A layer patch keeps the length (`timeToGetControl 10` -> `20`).
        self.gz.write_bytes(glbgz.compress(b"timeToGetControl 10"))
        self.assertTrue(glbgz.is_fresh(b"timeToGetControl 10", self.gz))
        self.assertFalse(glbgz.is_fresh(b"timeToGetControl 20", self.gz))

    def test_ensure_writes_once_and_then_leaves_it(self) -> None:
        self.glb.write_bytes(b"glTF" * 1000)
        self.assertTrue(glbgz.ensure(self.glb)[0])
        first = self.gz.read_bytes()
        rewritten, size = glbgz.ensure(self.glb)
        self.assertFalse(rewritten)
        self.assertEqual(len(first), size)
        self.assertEqual(self.glb.read_bytes(), gzip.decompress(self.gz.read_bytes()))

    def test_a_rebuilt_glb_gets_a_new_gz_through_the_same_inode(self) -> None:
        self.glb.write_bytes(b"old" * 1000)
        glbgz.ensure(self.glb)
        mirror = Path(self.tmp.name) / "mirror.glb.gz"
        os.link(self.gz, mirror)
        self.glb.write_bytes(b"new" * 1000)
        self.assertTrue(glbgz.ensure(self.glb)[0])
        self.assertEqual(b"new" * 1000, gzip.decompress(mirror.read_bytes()))

    def test_a_fresh_gz_older_than_its_glb_is_touched(self) -> None:
        # The API sends a .gz only if it is at least as new as the glb.
        self.glb.write_bytes(b"same" * 1000)
        glbgz.ensure(self.glb)
        os.utime(self.gz, ns=(1_000_000_000, 1_000_000_000))
        self.assertFalse(glbgz.ensure(self.glb)[0])
        self.assertGreaterEqual(self.gz.stat().st_mtime_ns, self.glb.stat().st_mtime_ns)


class OptimiserTests(unittest.TestCase):
    def test_the_gz_is_made_from_the_glb_as_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            level = root / "maps" / "bocage"
            level.mkdir(parents=True)
            glb = level / "scene.glb"
            glb.write_bytes(textured_glb([(png(CHECKER), "a")]))
            row = optimise_mesh.process(str(glb), str(root))
            self.assertTrue(row["changed"])
            self.assertTrue(row["gz_written"])
            inflated = gzip.decompress(glbgz.gz_path(glb).read_bytes())
            self.assertEqual(glb.read_bytes(), inflated)
            doc, _ = glbopt.read_glb(inflated)
            self.assertIn("uri", doc["images"][0])

            again = optimise_mesh.process(str(glb), str(root))
            self.assertFalse(again["changed"] or again["gz_written"])

    def test_a_stale_gz_is_replaced_on_the_next_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            level = root / "maps" / "bocage"
            level.mkdir(parents=True)
            glb = level / "scene.glb"
            glb.write_bytes(textured_glb([(png(CHECKER), "a")]))
            glbgz.gz_path(glb).write_bytes(glbgz.compress(b"a glb from an older bake"))
            self.assertEqual(0, optimise_mesh.run([root / "maps"], root, jobs=1))
            self.assertTrue(glbgz.is_fresh(glb.read_bytes(), glbgz.gz_path(glb)))

    def test_a_tracked_fixture_gets_a_gz_and_keeps_its_textures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            glb = root / "models" / "viewmodels" / "fixture.fp.glb"
            glb.parent.mkdir(parents=True)
            original = textured_glb([(png(CHECKER), "a")])
            glb.write_bytes(original)
            with mock.patch.object(optimise_mesh, "tracked", lambda _: {glb.resolve()}):
                self.assertEqual(0, optimise_mesh.run([root / "models"], root, jobs=1))
            self.assertEqual(original, glb.read_bytes())
            self.assertEqual(original, gzip.decompress(glbgz.gz_path(glb).read_bytes()))


if __name__ == "__main__":
    unittest.main()
