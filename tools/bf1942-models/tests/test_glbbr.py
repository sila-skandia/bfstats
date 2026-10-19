from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import optimise_mesh  # noqa: E402
from bf42 import glbbr, glbgz  # noqa: E402
from test_glbopt import CHECKER, png, textured_glb  # noqa: E402

BIG = (b"glTF" + bytes(range(256))) * (glbbr.MIN_BYTES // 260 + 1)  # just over MIN_BYTES


class CompressTests(unittest.TestCase):
    def test_it_inflates_to_the_input(self) -> None:
        data = bytes(range(256)) * 400
        self.assertEqual(data, glbbr.decompress(glbbr.compress(data)))

    def test_the_same_bytes_give_the_same_stream(self) -> None:
        data = b"glTF" + b"\x00" * 5000
        self.assertEqual(glbbr.compress(data), glbbr.compress(bytes(data)))

    def test_the_stream_opens_with_the_metadata_record(self) -> None:
        # The record is the gzip trailer's job done at the front: MAGIC, then
        # the CRC-32 and length of what the stream inflates to, inside an
        # RFC 7932 metadata meta-block every decoder skips.
        data = b"timeToGetControl 10"
        out = glbbr.compress(data)
        self.assertEqual((zlib.crc32(data), len(data)), glbbr.parse_meta(out[:glbbr.HEADER_LEN]))

    def test_an_incompressible_stream_still_carries_the_record(self) -> None:
        # Incompressible input makes the encoder emit uncompressed meta-blocks,
        # whose literals are byte-aligned: the record must not disturb them.
        import random
        data = random.Random(42).randbytes(300000)
        out = glbbr.compress(data)
        self.assertEqual((zlib.crc32(data), len(data)), glbbr.parse_meta(out[:glbbr.HEADER_LEN]))
        self.assertEqual(data, glbbr.decompress(out))

    def test_any_reference_decoder_skips_the_record(self) -> None:
        # node's zlib.brotliDecompressSync is the same reference decoder the
        # browsers ship; what it inflates is what a browser draws.
        data = b"a level scene stand-in " * 999
        with tempfile.TemporaryDirectory() as tmp:
            br = Path(tmp) / "scene.glb.br"
            br.write_bytes(glbbr.compress(data))
            script = ("const z=require('zlib'),fs=require('fs');"
                      f"process.stdout.write(z.brotliDecompressSync(fs.readFileSync({str(br)!r})))")
            node = subprocess.run(["node", "-e", script], capture_output=True, check=True)
        self.assertEqual(data, node.stdout)

    def test_a_plain_brotli_stream_has_no_record(self) -> None:
        # A .br made by hand (plain `brotli scene.glb`) must read as stale.
        enc, _ = glbbr._lib()
        state = enc.BrotliEncoderCreateInstance(None, None, None)
        out = bytearray()
        try:
            glbbr._pump(enc, state, glbbr._FINISH, b"hand-made", out)
        finally:
            enc.BrotliEncoderDestroyInstance(state)
        self.assertIsNone(glbbr.parse_meta(bytes(out)[:glbbr.HEADER_LEN]))

    def test_the_record_sits_within_the_first_19_bytes_whatever_the_window(self) -> None:
        # The WBITS code is 1, 4 or 7 bits; the parsers (the publisher, the
        # API route) read HEADER_LEN bytes and never more.
        for byte0, length in ((0b0, 1), (0b1111, 4), (0b1010001, 7)):
            header = glbbr._header(byte0, glbbr.PAYLOAD_LEN)
            self.assertIsNotNone(header)
            self.assertLessEqual(len(header) + glbbr.PAYLOAD_LEN, glbbr.HEADER_LEN)
        self.assertIsNone(glbbr._header(0b0010001, glbbr.PAYLOAD_LEN))  # reserved


class FreshnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.glb = Path(self.tmp.name) / "scene.glb"
        self.br = glbbr.br_path(self.glb)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_the_br_sits_beside_the_glb(self) -> None:
        self.assertEqual(Path(self.tmp.name) / "scene.glb.br", self.br)

    def test_a_missing_or_foreign_br_is_not_fresh(self) -> None:
        self.assertFalse(glbbr.is_fresh(b"abc", self.br))
        self.br.write_bytes(b"not a brotli stream, but long enough")
        self.assertFalse(glbbr.is_fresh(b"abc", self.br))

    def test_a_br_of_other_bytes_is_stale_even_at_the_same_length(self) -> None:
        self.br.write_bytes(glbbr.compress(b"timeToGetControl 10"))
        self.assertTrue(glbbr.is_fresh(b"timeToGetControl 10", self.br))
        self.assertFalse(glbbr.is_fresh(b"timeToGetControl 20", self.br))

    def test_ensure_writes_once_and_then_leaves_it(self) -> None:
        self.glb.write_bytes(BIG)
        self.assertTrue(glbbr.ensure(self.glb)[0])
        first = self.br.read_bytes()
        rewritten, size = glbbr.ensure(self.glb)
        self.assertFalse(rewritten)
        self.assertEqual(len(first), size)
        self.assertEqual(self.glb.read_bytes(), glbbr.decompress(self.br.read_bytes()))

    def test_a_small_glb_goes_without(self) -> None:
        self.glb.write_bytes(b"glTF" * 100)
        self.assertEqual((False, 0), glbbr.ensure(self.glb))
        self.assertFalse(self.br.exists())

    def test_a_small_glbs_stale_br_is_still_rewritten(self) -> None:
        # The threshold governs CREATING a .br, never leaving a stale one: the
        # publisher refuses it, and brotli_static would serve it.
        self.glb.write_bytes(b"glTF" * 100)
        self.br.write_bytes(glbbr.compress(b"an older copy of the glb"))
        self.assertTrue(glbbr.ensure(self.glb)[0])
        self.assertTrue(glbbr.is_fresh(self.glb.read_bytes(), self.br))

    def test_create_off_writes_nothing_new_but_keeps_an_existing_br_in_step(self) -> None:
        self.glb.write_bytes(BIG)
        self.assertEqual((False, 0), glbbr.ensure(self.glb, create=False))
        self.assertFalse(self.br.exists())
        glbbr.ensure(self.glb)
        self.glb.write_bytes(BIG + b"changed")
        self.assertTrue(glbbr.ensure(self.glb, create=False)[0])
        self.assertTrue(glbbr.is_fresh(self.glb.read_bytes(), self.br))

    def test_a_rebuilt_glb_gets_a_new_br_through_the_same_inode(self) -> None:
        self.glb.write_bytes(BIG)
        glbbr.ensure(self.glb)
        mirror = Path(self.tmp.name) / "mirror.glb.br"
        os.link(self.br, mirror)
        self.glb.write_bytes(BIG[::-1])
        self.assertTrue(glbbr.ensure(self.glb)[0])
        self.assertEqual(BIG[::-1], glbbr.decompress(mirror.read_bytes()))

    def test_a_fresh_br_older_than_its_glb_is_touched(self) -> None:
        # The API sends a .br only if it is at least as new as the glb.
        self.glb.write_bytes(BIG)
        glbbr.ensure(self.glb)
        os.utime(self.br, ns=(1_000_000_000, 1_000_000_000))
        self.assertFalse(glbbr.ensure(self.glb)[0])
        self.assertGreaterEqual(self.br.stat().st_mtime_ns, self.glb.stat().st_mtime_ns)


class OptimiserTests(unittest.TestCase):
    def test_a_big_glb_gets_gz_and_br_from_the_bytes_as_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            level = root / "maps" / "bocage"
            level.mkdir(parents=True)
            glb = level / "scene.glb"
            glb.write_bytes(textured_glb([(png(CHECKER), "a")]))
            with mock.patch.object(glbbr, "MIN_BYTES", 1):
                row = optimise_mesh.process(str(glb), str(root))
                self.assertTrue(row["changed"] and row["gz_written"] and row["br_written"])
                data = glb.read_bytes()
                self.assertEqual(data, glbbr.decompress(glbbr.br_path(glb).read_bytes()))
                self.assertTrue(glbgz.is_fresh(data, glbgz.gz_path(glb)))
                again = optimise_mesh.process(str(glb), str(root))
            self.assertFalse(again["changed"] or again["gz_written"] or again["br_written"])

    def test_a_small_glb_gets_only_its_gz(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            level = root / "maps" / "bocage"
            level.mkdir(parents=True)
            glb = level / "scene.glb"
            glb.write_bytes(textured_glb([(png(CHECKER), "a")]))
            row = optimise_mesh.process(str(glb), str(root))
            self.assertTrue(row["gz_written"])
            self.assertFalse(row["br_written"])
            self.assertFalse(glbbr.br_path(glb).exists())

    def test_no_brotli_writes_nothing_new(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            level = root / "maps" / "bocage"
            level.mkdir(parents=True)
            glb = level / "scene.glb"
            glb.write_bytes(textured_glb([(png(CHECKER), "a")]))
            with mock.patch.object(glbbr, "MIN_BYTES", 1):
                row = optimise_mesh.process(str(glb), str(root), brotli=False)
            self.assertFalse(row["br_written"])
            self.assertFalse(glbbr.br_path(glb).exists())


if __name__ == "__main__":
    unittest.main()
