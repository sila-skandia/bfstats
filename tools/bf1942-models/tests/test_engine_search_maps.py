"""`engine_search_maps.py`: the archive it hands the retail server and the
script layer it adds (features/bot-map-generation, section 13). The server
run itself needs the lab and is not exercised here."""

from __future__ import annotations

import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import engine_search_maps as esm  # noqa: E402
from bf42.rfa import RfaArchive  # noqa: E402

BLOCK = bytes(range(148))
TRAILER = b"\x00\x00\x00\x00"
TAIL = bytes.fromhex("000000000000000020028a02")
PREFIX = "bf1942/levels/Test_Level"


def game_archive(path: Path, files: dict[str, bytes]) -> None:
    """A compressed archive laid out as the game's: header, 148-byte block, payloads, index, trailer."""
    body, index = bytearray(), bytearray()
    for name, data in files.items():
        blob = esm.pack_file(data)
        raw = name.encode("latin-1")
        index += struct.pack("<I", len(raw)) + raw + struct.pack("<III", len(blob), len(data), 156 + len(body)) + TAIL
        body += blob
    path.write_bytes(struct.pack("<II", 156 + len(body), 1) + BLOCK + bytes(body)
                     + struct.pack("<I", len(files)) + bytes(index) + TRAILER)


SOURCE = {
    f"{PREFIX}/Conquest.con": b"Game.setNumberOfTickets 1 100\r\nrun Conquest/SoldierSpawns\r\nrun Conquest/ObjectSpawns\r\n",
    f"{PREFIX}/Conquest/SoldierSpawns.con": b"Object.create a\r\nObject.absolutePosition 10.26/5/20.5\r\nObject.create b\r\nObject.absolutePosition 30/5/40\r\n",
    f"{PREFIX}/Init/Terrain.con": b"GeometryTemplate.worldSize 2048\r\n",
    f"{PREFIX}/StaticObjects.con": bytes(range(256)) * 200,
}


class ArchiveTests(unittest.TestCase):
    def test_a_literal_only_stream_reads_back_at_every_length_class(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            for n in (4, 17, 238, 239, 500, 16384, 40000):
                path = Path(tmp) / f"{n}.rfa"
                data = bytes((i * 7) % 251 for i in range(n))
                game_archive(path, {"a/b.con": data})
                self.assertEqual(RfaArchive(path).read("a/b.con"), data, n)

    def test_the_rebuilt_archive_keeps_the_header_block_and_trailer_and_adds_the_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "src.rfa", Path(tmp) / "dst.rfa"
            game_archive(src, SOURCE)
            before = src.read_bytes()
            esm.rebuild_archive(src, dst, {f"{PREFIX}/AI.con": b"ai.init 2\r\n", f"{PREFIX}/Conquest.con": b"changed\r\n"})
            self.assertEqual(src.read_bytes(), before)
            out = dst.read_bytes()
            self.assertEqual(out[8:156], BLOCK)
            self.assertTrue(out.endswith(TRAILER))
            arch = RfaArchive(dst)
            self.assertEqual(arch.read(f"{PREFIX}/AI.con"), b"ai.init 2\r\n")
            self.assertEqual(arch.read(f"{PREFIX}/Conquest.con"), b"changed\r\n")
            self.assertEqual(arch.read(f"{PREFIX}/StaticObjects.con"), SOURCE[f"{PREFIX}/StaticObjects.con"])
            names = [n.lower() for n in arch.entries]
            self.assertEqual(names, sorted(names))

    def test_an_archive_without_the_block_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src.rfa"
            blob = esm.pack_file(b"hello there")
            name = b"a/b.con"
            src.write_bytes(struct.pack("<II", 8 + len(blob), 1) + blob + struct.pack("<I", 1)
                            + struct.pack("<I", len(name)) + name + struct.pack("<III", len(blob), 11, 8) + TAIL)
            with self.assertRaises(ValueError):
                esm.rebuild_archive(src, Path(tmp) / "dst.rfa", {})


class ScriptLayerTests(unittest.TestCase):
    def test_the_run_starts_co_op_from_conquest_and_asks_for_the_maps_after_the_statics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src.rfa"
            game_archive(src, SOURCE)
            arch = RfaArchive(src)
            prefix = esm.level_folder(arch)
            self.assertEqual(prefix, PREFIX)
            self.assertEqual(esm.world_size_of(arch, prefix), 2048)
            layer = esm.script_layer(arch, prefix, 2048)
        coop = layer[f"{PREFIX}/Coop.con"].decode()
        self.assertEqual(coop, layer[f"{PREFIX}/GameTypes/Coop.con"].decode())
        self.assertLess(coop.index("run ai v_arg1"), coop.index("run Conquest/ObjectSpawns"))
        path = layer[f"{PREFIX}/AIpathFinding.con"].decode()
        self.assertIn("ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1", path)
        self.assertIn("ai.setMapSpawnPoints 1 10.3/20.5,30.0/40.0", path)
        self.assertLess(path.index("ai.addSearchType Tank 0 0"), path.index("ai.addSearchType Infantry 1 0"))
        self.assertLess(path.index("run StaticObjects"), path.index("ai.createAllMaps"))
        self.assertIn("aiSettings.setWorldMapSize 2048 2048", layer[f"{PREFIX}/AI.con"].decode())


if __name__ == "__main__":
    unittest.main()
