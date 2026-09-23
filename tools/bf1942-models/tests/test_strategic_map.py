"""The engine's strategic map (ledger AI-117) and the search types that bind
a unit to its maps (AI-118).

`ai.loadMaps` loads, after the search maps, one strategic map per search
type's (map, level) pair (`AIPathfinding::loadSearchTypes` 0x0847c6b0,
`StrategicMap::load` 0x08609b60): 64 m cells of up to four regions with a
point each and links to the next cells' regions, and a two-bit Info map of
which region each pixel is in. The bots plan every route on it
(`viewer/strategic-map.js`, `nav-search.js findStrategicPath`), as
`BotMain::updateStrategicPath` 0x08526e60 does. `bf42/ai_level.py` reads and
writes the files; `tests/strategic_map_harness.mjs` runs the viewer side.

The real-level cases need the untracked maps tree with the `pathfinding/`
folders `extract_search_maps.py` writes (see `test_nav_baked.py`).
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "strategic_map_harness.mjs"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.ai_level import (  # noqa: E402
    LevelAi, add_search_type, parse_pathfinding_con, read_cell_map_raw, read_strategic_map_raw,
    level_strategic_maps, STRATEGIC_CELL_BYTES,
)
from test_nav_baked import ASSETS  # noqa: E402


def run_harness() -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in ("nav-grid.js", "nav-map.js", "nav-search.js", "nav-baked.js", "strategic-map.js"):
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        args = ["node", str(work / "harness.mjs")]
        if ASSETS is not None:
            args.append(str(ASSETS / "maps"))
        proc = subprocess.run(args, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def info_file(level: int, bits: int, fill: int = 0, blocks_bits: int = 5) -> bytes:
    """An all-special-cell `CellMap` file: `2^blocks_bits` blocks a side."""
    head = struct.pack("<5i", blocks_bits, blocks_bits, 6, level, bits)
    head += struct.pack("<iI", 1, fill)
    return head + struct.pack("<i", 0) * (1 << (2 * blocks_bits))


def cells_file(n: int) -> bytes:
    return struct.pack("<2i", n, n) + bytes(STRATEGIC_CELL_BYTES * n * n)


class FakeFiles:
    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = {k.lower(): (k, v) for k, v in files.items()}

    def find(self, rel: str) -> str | None:
        hit = self.files.get(rel.lower())
        return hit[0] if hit else None

    def read(self, name: str) -> bytes:
        return self.files[name.lower()][1]


class SearchTypeTests(unittest.TestCase):
    """`ai.addSearchType` as the console and `AIPathfinding` keep it."""

    def ai(self) -> LevelAi:
        ai = LevelAi()
        parse_pathfinding_con(
            "ai.addSearchMap Tank0 0 0 25 3.0 0.3 2.5 0\n"
            "ai.addSearchType Tank 0 0\n"
            "ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1\n"
            "ai.addSearchType Infantery 1 0\n"
            "ai.addSearchType Boat\n"
            "ai.addSearchType LandingCraft\n"
            "ai.addSearchMap Boat2 1 5 0 125.0 0.3 2.5 0 2 5\n"
            "ai.addSearchType Boat2 2 1\n"          # below the map's own minLevel 2
            "ai.addSearchType Ghost 7 0\n"          # past the maps declared so far
            "ai.addSearchType Boat3 2 2\n", ai)
        return ai

    def test_the_kept_types_are_the_vehicle_numbers(self) -> None:
        # Every vanilla land vehicle names `vehicleNumber 0` (the jeeps too),
        # the soldier 1, the ships 2, the landing craft 3: the list's order.
        self.assertEqual(self.ai().searchTypes, [
            {"name": "Tank", "map": 0, "level": 0},
            {"name": "Infantery", "map": 1, "level": 0},
            {"name": "Boat", "map": -1, "level": -1},
            {"name": "LandingCraft", "map": -1, "level": -1},
            {"name": "Boat3", "map": 2, "level": 2},
        ])

    def test_a_refused_type_takes_no_number(self) -> None:
        ai = LevelAi()
        self.assertFalse(add_search_type(ai, ["Car", "0", "0"]))   # no map declared yet
        self.assertEqual(ai.searchTypes, [])


class StrategicFileTests(unittest.TestCase):
    def test_the_cells_file(self) -> None:
        data = bytearray(cells_file(2))
        o = 8 + (1 * 2 + 0) * STRATEGIC_CELL_BYTES      # cell (0, 1)
        struct.pack_into("<I", data, o, (1 << 16) | 1)
        data[o + 4], data[o + 5] = 0x40 | 10, 20        # region 0 at (10, 20), the overflow bit
        data[o + 12] = 0x10 | 0x40                      # regions 0 and 2 used
        sm = read_strategic_map_raw(bytes(data))
        self.assertEqual((sm.cells_x, sm.cells_z), (2, 2))
        self.assertEqual(sm.used(0, 1), [0, 2])
        self.assertEqual(sm.point(0, 1, 0), (10, 64 + 20))
        with self.assertRaises(ValueError):
            read_strategic_map_raw(bytes(data) + b"\0")

    def test_the_info_file_is_two_bits_a_pixel(self) -> None:
        # A 2 x 2-block map, level 1 (2 m pixels): block 1 inline with pixel
        # (3, 0) = 2 and (0, 1) = 3.
        head = struct.pack("<5i", 1, 1, 6, 1, 1) + struct.pack("<iI", 1, 0)
        block = bytearray(256)
        for (px, pz, v) in ((3, 0, 2), (0, 1, 3)):
            bit = (pz * 32 + px) << 1
            w = struct.unpack_from("<I", block, (bit >> 5) * 4)[0] | (v << (bit & 31))
            struct.pack_into("<I", block, (bit >> 5) * 4, w)
        data = head + struct.pack("<i", 0) + struct.pack("<i", -1) + bytes(block) + struct.pack("<i", 0) * 2
        m = read_cell_map_raw(data)
        self.assertEqual((m.level, m.bits_exp, m.block_pixels), (1, 1, 32))
        self.assertEqual(m.value_at(64 + 6, 0), 2)
        self.assertEqual(m.value_at(64 + 1, 2), 3)
        self.assertEqual(m.value_at(64 + 1, 0), 0)
        self.assertEqual(m.value_at(6, 0), 0)

    def test_load_search_types_stops_at_the_first_failure(self) -> None:
        ai = LevelAi()
        ai.settings["worldMapSize"] = [2048, 2048]
        parse_pathfinding_con(
            "ai.addSearchMap Tank0 0 0 25 3.0 0.3 2.5 0\nai.addSearchType Tank 0 0\n"
            "ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1\nai.addSearchType Infantery 1 0\n"
            "ai.addSearchMap Car4 0 0 20 3.0 0.3 2.5 0\nai.addSearchType Car 2 0\n"
            "ai.addSearchType Jeep 2 0\n", ai)
        ok = [{"loaded": True}] * 3
        files = FakeFiles({
            "Pathfinding/Tank.raw": cells_file(32), "Pathfinding/TankInfo.raw": info_file(1, 1),
            # Infantery's Info has the wrong level: it fails, and Car after it
            # is not loaded although its files are there.
            "Pathfinding/Infantery.raw": cells_file(32), "Pathfinding/InfanteryInfo.raw": info_file(2, 1),
            "Pathfinding/Car.raw": cells_file(32), "Pathfinding/CarInfo.raw": info_file(1, 1),
        })
        rows = level_strategic_maps(files, ai, ok)
        self.assertEqual([(r["name"], r["map"], r["loaded"]) for r in rows],
                         [("Tank", 0, True), ("Infantery", 1, False), ("Car", 2, False)])
        self.assertIn("Info header", rows[1]["reason"])
        self.assertIn("earlier", rows[2]["reason"])
        # No strategic map loads when a search map did not (`loadMaps` is
        # `loadSearchMaps() && loadSearchTypes()`).
        rows = level_strategic_maps(files, ai, [{"loaded": True}, {"loaded": False}, {"loaded": True}])
        self.assertFalse(any(r["loaded"] for r in rows))


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class StrategicMapTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_info_map_decodes(self) -> None:
        i = self.results["info"]
        self.assertEqual((i["level"], i["bits"], i["pixel"]), (1, 1, 2))
        self.assertEqual([i["a"], i["b"], i["c"], i["d"], i["e"], i["outside"]], [0, 1, 0, 2, 3, 0])

    def test_the_links_run_both_ways(self) -> None:
        l = self.results["links"]
        self.assertEqual(l["r00_0"], ["0,1,0"])
        self.assertEqual(l["r00_1"], ["1,0,0"])
        self.assertEqual(sorted(l["r10_0"]), ["0,0,1", "1,1,0"])
        self.assertEqual(sorted(l["r01_0"]), ["0,0,0", "1,1,0"])
        self.assertEqual(sorted(l["r11_0"]), ["0,1,0", "1,0,0"])

    def test_a_pixel_names_its_region(self) -> None:
        r = self.results["regions"]
        self.assertEqual((r["west"], r["east"], r["blocked"]), (0, 1, -1))
        o = self.results["overflow"]
        self.assertEqual((o["open"], o["sealed"]), (3, -1))

    def test_the_search_walks_regions_not_cells(self) -> None:
        s = self.results["search"]
        self.assertEqual(s["eastToFar"], [[48, 32, 1], [96, 32, 0]])
        # The west half of the same cell is not joined to the east cell: it
        # goes round by the cells at +z.
        self.assertEqual(s["westToFar"], [[8, 32, 0], [32, 96, 0], [96, 96, 0], [96, 32, 0]])
        self.assertTrue(s["same"])
        self.assertFalse(s["notUsed"])
        self.assertEqual(s["routeSame"], {"legs": []})
        # The start is dropped; the goal's own region point stays when it is
        # not the only one left.
        self.assertEqual(s["routeWest"]["legs"], [[32, 96, 0], [96, 96, 0], [96, 32, 0]])
        self.assertIsNone(s["routeGoalBlocked"]["legs"])

    def test_the_route_planner_uses_it(self) -> None:
        self.assertEqual(self.results["navPath"],
                         [[10, -20], [32.5, -96.5], [96.5, -96.5], [96.5, -32.5], [100, -20]])

    def test_a_pocket_with_no_region_routes_from_the_nearest_one(self) -> None:
        self.assertEqual(self.results["pocket"]["region"], -1)
        self.assertIsNotNone(self.results["pocket"]["path"])

    def test_a_vehicle_number_names_a_search_type_and_its_maps(self) -> None:
        t = self.results["types"]
        self.assertEqual(t["jeep0"], {"type": "Tank", "map": "Tank0", "strategic": "Tank"})
        self.assertEqual(t["soldier1"], {"type": "Infantry", "map": "Infantry1", "strategic": "Infantry"})
        self.assertEqual(t["boat2"], {"type": "Boat", "map": None, "strategic": None})
        self.assertEqual(t["car3"], {"type": "Car", "map": "Car4", "strategic": "Car"})
        self.assertIsNone(t["plane"])
        self.assertIsNone(t["past"])

    @unittest.skipIf(ASSETS is None, "no maps tree with the levels' pathfinding folders")
    def test_bocage_ships_one_component_a_type_and_the_tank_crosses_the_river(self) -> None:
        b = self.results.get("bocage")
        if b is None:
            self.skipTest("the maps tree has no strategic maps yet (extract_search_maps.py)")
        self.assertEqual(b["strategic"], ["Tank", "Infantery", "Car"])
        for name in ("Tank", "Infantery", "Car"):
            self.assertEqual(b["components"][name]["components"], 1, name)
        self.assertEqual(b["tankNav"], {"source": "baked", "strategic": "Tank"})
        self.assertGreater(b["acrossRiver"]["legs"], 10)
        self.assertEqual(b["acrossRiver"]["localFails"], 0)

    @unittest.skipIf(ASSETS is None, "no maps tree with the levels' pathfinding folders")
    def test_el_alamein_ships_one_component_a_type(self) -> None:
        e = self.results.get("el_alamein")
        if e is None:
            self.skipTest("the maps tree has no strategic maps yet (extract_search_maps.py)")
        for name in ("Tank", "Infantery", "Car"):
            self.assertEqual(e["components"][name]["components"], 1, name)


if __name__ == "__main__":
    unittest.main()
