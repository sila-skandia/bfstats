"""`engine_search_maps.py`: the archive it hands the retail server and the
script layer it adds (features/bot-map-generation, section 13), and the
instance it builds for a mod the lab's server lacks. The server run itself
needs the lab and is not exercised here.

Also the writer for the maps it brings back (`sim/botgen.mjs
encodeSearchMap`), against DICE's own shipped files where the game is
installed."""

# watches: tools/bf1942-models/engine_search_maps.py tools/bf1942-models/sim/botgen.mjs tools/bf1942-models/viewer/nav-baked.js

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import engine_search_maps as esm  # noqa: E402
from bf42.rfa import RfaArchive  # noqa: E402



def find_game_dir() -> Path | None:
    """The retail install: `BF1942_GAME_DIR`, wine's, or a Mac's CrossOver bottle."""
    candidates = [os.environ.get("BF1942_GAME_DIR"),
                  Path.home() / ".wine/drive_c/EA Games/Battlefield 1942",
                  Path.home() / "Library/Application Support/CrossOver/Bottles/BF1942"
                                "/drive_c/EA Games/Battlefield 1942"]
    for c in candidates:
        if c and (Path(c) / "Mods/bf1942/Archives/bf1942/levels").is_dir():
            return Path(c)
    return None


#: Decode each search-map level in a folder, write it back, and compare; and
#: rebuild each next level from the one below it.
ROUND_TRIP = """
import { readFileSync, readdirSync } from 'node:fs';
const gen = await import(process.argv[1] + '/sim/botgen.mjs');
const baked = await import(process.argv[1] + '/viewer/nav-baked.js');
const dir = process.argv[2], out = {};
const pixels = f => { const m = baked.decodeSearchMap(new Uint8Array(readFileSync(dir + '/' + f))); return [m, gen.searchMapPixels(m)]; };
for (const f of readdirSync(dir).sort()) {
  const [m, px] = pixels(f);
  out[f] = { same: gen.encodeSearchMap(px, m.width, m.level).equals(readFileSync(dir + '/' + f)) };
  const up = f.replace(/level(\\d)/, (s, d) => 'level' + (+d + 1));
  if (up !== f && readdirSync(dir).includes(up)) out[f].coarser = Buffer.from(gen.coarserPixels(px, m.width)).equals(Buffer.from(pixels(up)[1]));
}
console.log(JSON.stringify(out));
"""

BLOCK = bytes(range(148))
TRAILER = b"\x00\x00\x00\x00"
TAIL = bytes.fromhex("000000000000000020028a02")
PREFIX = "bf1942/levels/Test_Level"


def game_archive(path: Path, files: dict[str, bytes], compressed: int = 1) -> None:
    """An archive laid out as the game's: header, 148-byte block, payloads, index, trailer."""
    body, index = bytearray(), bytearray()
    for name, data in files.items():
        blob = esm.pack_file(data) if compressed else data
        raw = name.encode("latin-1")
        index += struct.pack("<I", len(raw)) + raw + struct.pack("<III", len(blob), len(data), 156 + len(body)) + TAIL
        body += blob
    path.write_bytes(struct.pack("<II", 156 + len(body), compressed) + BLOCK + bytes(body)
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

    def test_an_archive_stored_uncompressed_stays_uncompressed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "src.rfa", Path(tmp) / "dst.rfa"
            game_archive(src, SOURCE, compressed=0)
            esm.rebuild_archive(src, dst, {f"{PREFIX}/AI.con": b"ai.init 2\r\n", f"{PREFIX}/Conquest.con": b"changed\r\n"})
            out = dst.read_bytes()
            self.assertEqual(struct.unpack_from("<I", out, 4)[0], 0)
            self.assertEqual(out[8:156], BLOCK)
            self.assertTrue(out.endswith(TRAILER))
            # Stored as it is: the added file's bytes are in the archive verbatim.
            self.assertIn(b"ai.init 2\r\n", out)
            arch = RfaArchive(dst)
            self.assertEqual(arch.read(f"{PREFIX}/AI.con"), b"ai.init 2\r\n")
            self.assertEqual(arch.read(f"{PREFIX}/Conquest.con"), b"changed\r\n")
            self.assertEqual(arch.read(f"{PREFIX}/StaticObjects.con"), SOURCE[f"{PREFIX}/StaticObjects.con"])

    def test_an_archive_without_the_block_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src.rfa"
            blob = esm.pack_file(b"hello there")
            name = b"a/b.con"
            src.write_bytes(struct.pack("<II", 8 + len(blob), 1) + blob + struct.pack("<I", 1)
                            + struct.pack("<I", len(name)) + name + struct.pack("<III", len(blob), 11, 8) + TAIL)
            with self.assertRaises(ValueError):
                esm.rebuild_archive(src, Path(tmp) / "dst.rfa", {})


class ReferencedLevelTests(unittest.TestCase):
    def test_a_variant_names_the_level_whose_files_it_reads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src.rfa"
            day2 = "bf1942/levels/Test_Level_day2"
            game_archive(src, {
                f"{day2}/Init/Terrain.con": b"GeometryTemplate.file bf1942\\levels\\Test_Level\\Heightmap\r\n"
                                            b"GeometryTemplate.texBaseName bf1942/levels/Test_Level/Textures/Tx\r\n"
                                            b"GeometryTemplate.detailTexName bf1942\\levels\\Test_Level_day2\\Textures\\Detail\r\n",
                f"{day2}/Conquest.con": b"run Conquest/SoldierSpawns\r\n",
            })
            arch = RfaArchive(src)
            self.assertEqual(esm.referenced_levels(arch, esm.level_folder(arch)), ["Test_Level"])

    def test_a_level_that_reads_only_its_own_files_names_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src.rfa"
            game_archive(src, SOURCE)
            arch = RfaArchive(src)
            self.assertEqual(esm.referenced_levels(arch, esm.level_folder(arch)), [])


DC_INIT = ("game.setCustomGameName DesertCombat\r\ngame.addModPath Mods/DesertCombat/\r\n"
           "game.addModPath Mods/BF1942/\r\ngame.customGameFlushArchives 0 \r\n")


class ModInstanceTests(unittest.TestCase):
    """A mod the lab's server lacks, linked in from a client install."""

    def client_mod(self, root: Path) -> Path:
        mod = root / "game" / "Mods" / "DesertCombat"
        for rel in ("init.con", "lexiconall.dat", "DCreadme.txt", "Movies/intro.con", "Settings/Profile.con",
                    "Archives/OBJECTS.rfa", "Archives/GUI_RFAPack.exe", "Archives/bf1942/game.rfa",
                    "Archives/bf1942/Levels/DC_Test.rfa", "Archives/bf1942/Levels/DC_Test_001.rfa",
                    "Archives/bf1942/Levels/DC_Other.rfa"):
            (mod / rel).parent.mkdir(parents=True, exist_ok=True)
            (mod / rel).write_bytes(DC_INIT.encode() if rel == "init.con" else rel.encode())
        return mod

    def test_a_mods_init_names_itself_then_the_mods_it_builds_on(self) -> None:
        self.assertEqual(esm.mod_paths(DC_INIT), ["DesertCombat", "BF1942"])
        self.assertEqual(esm.mod_paths('game.addModPath "Mods\\bf1918\\"\nrem game.addModPath Mods/xpack1/\n'
                                       "Game.AddModPath mods/bf1942/\ngame.addModPath Mods/BF1942/\n"), ["bf1918", "bf1942"])

    def test_the_servers_own_mod_wins_and_the_case_on_disk_does_not_matter(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            mod = self.client_mod(Path(tmp))
            server = Path(tmp) / "server" / "mods"
            (server / "bf1942").mkdir(parents=True)
            (mod.parent / "BF1942").mkdir()
            roots = [server, mod.parent]
            self.assertEqual(esm.find_mod("BF1942", roots), server / "bf1942")
            self.assertEqual(esm.find_mod("desertcombat", roots), mod)
            self.assertIsNone(esm.find_mod("FH", roots))

    def test_a_client_mod_becomes_a_lower_case_tree_of_links_without_the_levels_own_archives(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            mod = self.client_mod(Path(tmp))
            before = sorted(p.relative_to(mod).as_posix() for p in mod.rglob("*"))
            dest = Path(tmp) / "inst" / "mods" / "desertcombat"
            count = esm.link_mod(mod, dest, lambda rel: rel.startswith("archives/bf1942/levels/dc_test"))
            got = sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if not p.is_dir())
            # Scripts, the lexicon and archives only; no movies, settings, readme or tool.
            self.assertEqual(got, ["archives/bf1942/game.rfa", "archives/bf1942/levels/dc_other.rfa",
                                   "archives/objects.rfa", "init.con", "lexiconall.dat"])
            self.assertEqual(count, len(got))
            for rel in got:
                self.assertTrue((dest / rel).is_symlink(), rel)
            self.assertEqual((dest / "archives/objects.rfa").resolve(), (mod / "Archives/OBJECTS.rfa").resolve())
            self.assertEqual((dest / "archives/objects.rfa").read_bytes(), b"Archives/OBJECTS.rfa")
            # The level's own folder is a real one, for the rebuilt archive, and the install is as it was.
            self.assertFalse((dest / "archives/bf1942/levels").is_symlink())
            self.assertEqual(sorted(p.relative_to(mod).as_posix() for p in mod.rglob("*")), before)

    def test_the_maps_count_as_written_only_when_all_six_are_there_with_content(self) -> None:
        want = [f"{name}Level{lv}Map.raw" for name, _, _ in esm.SEARCH_MAPS for lv in esm.LEVELS]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "dc_test" / "Pathfinding"
            folder.mkdir(parents=True)
            self.assertIsNone(esm.map_sizes(Path(tmp), want))
            # The server writes lower-case names, and an 8-bit preview beside each.
            for w in want[:-1]:
                (folder / w.lower()).write_bytes(bytes(96))
                (folder / w.lower().replace("map.raw", "map8bit.raw")).write_bytes(bytes(4096))
            self.assertIsNone(esm.map_sizes(Path(tmp), want))
            (folder / want[-1].lower()).write_bytes(b"")
            self.assertIsNone(esm.map_sizes(Path(tmp), want))
            (folder / want[-1].lower()).write_bytes(bytes(608))
            self.assertEqual(esm.map_sizes(Path(tmp), want), {**{w: 96 for w in want[:-1]}, want[-1]: 608})


class SearchMapWriterTests(unittest.TestCase):
    """`sim/botgen.mjs encodeSearchMap` against DICE's own Kharkov maps."""

    def test_dices_shipped_maps_are_written_back_byte_for_byte(self) -> None:
        game = find_game_dir()
        if game is None:
            self.skipTest("Battlefield 1942 is not installed")
        files: dict[str, bytes] = {}
        for path in sorted((game / "Mods/bf1942/Archives/bf1942/levels").glob("[Kk]harkov*.rfa")):
            arch = RfaArchive(path)
            for name in arch.entries:
                low = name.lower()
                if "/pathfinding/" in low and low.endswith("map.raw"):
                    files[low.rsplit("/", 1)[-1]] = arch.read(name)
        if not files:
            self.skipTest("Kharkov's search maps are not in the install")
        with tempfile.TemporaryDirectory() as tmp:
            for name, data in files.items():
                (Path(tmp) / name).write_bytes(data)
            proc = subprocess.run(["node", "--input-type=module", "-e", ROUND_TRIP, str(ROOT), tmp],
                                  capture_output=True, text=True, timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stderr[-1500:])
        out = json.loads(proc.stdout)
        self.assertGreaterEqual(len(out), 6)
        for name, row in out.items():
            with self.subTest(file=name):
                self.assertTrue(row["same"])
                # Level 1 is level 0's pixels ORed four to one, and level 2 level 1's.
                if "level2" not in name:
                    self.assertTrue(row["coarser"])


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

    def test_the_terrain_only_diagnosis_asks_for_the_maps_before_any_static_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src.rfa"
            game_archive(src, SOURCE)
            arch = RfaArchive(src)
            path = esm.script_layer(arch, PREFIX, 2048, statics=False)[f"{PREFIX}/AIpathFinding.con"].decode()
        self.assertNotIn("StaticObjects", path)
        self.assertLess(path.index("ai.loadMaps"), path.index("ai.createAllMaps"))


if __name__ == "__main__":
    unittest.main()
