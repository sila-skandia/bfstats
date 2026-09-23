"""`bf42/ai_level.py`: the level's strategic AI scripts as the viewer reads them.

The grammar is pinned on inline script text (no game install needed), and one
test reads the real El Alamein archives when they are installed.
"""

from __future__ import annotations

import os
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42.ai_level import (  # noqa: E402
    LevelAi, parse_ai_con, parse_conditions, parse_prerequisites,
    parse_strategic_areas, parse_strategies, parse_pathfinding_con, load_level_ai,
    read_search_map_raw, level_search_maps,
)

AREAS = """
if v_arg1 == host
aiStrategicArea.create AlliedBase 1652/692 1702/792 50
aiStrategicArea.create Pass 811/831 836/856 50

aiStrategicArea.setActive AlliedBase
AIStrategicArea.addNeighbour Pass
aiStrategicArea.addObjectTypeFlag Base
AIStrategicArea.setOrderPosition Infantery 1702/792
aiStrategicArea.setSide 2
aiStrategicArea.vehicleSearchRadius 190.0
aiStrategicArea.setTakeable 1 0
rem a comment line
aiStrategicArea.setActive Pass
aiStrategicArea.addObjectTypeFlag Flank
aiStrategicArea.addObjectTypeFlag ChokePoint
endIf
"""

CONDITIONS = """
aiStrategy.createConstantCondition timeCond Fuzzy EqualSmaller Friendly StartTime 200
aiStrategy.setConditionStrength AdvisoryNegative
aiStrategy.setIsAbortCondition 1
aiStrategy.createConstantCondition flankCond Crisp EqualGreater Enemy Front 2
aiStrategy.setConditionStrength Required | AdvisoryNegative
"""

PREREQS = """
aiStrategy.createPrerequisite flankPrereq
aiStrategy.addCondition flankCond     5.0
aiStrategy.addCondition timeCond      1.5
"""

STRATEGIES = """
aiStrategy.createStrategy flank
aiStrategy.Aggression 0.65
aiStrategy.NumberOfAttacks 1
aiStrategy.NumberOfDefences 1
aiStrategy.TimeLimit 400
aiStrategy.setPrerequisite flankPrereq
aiStrategy.setStrategicObjectsModifier Centre 2.0 Owned
aiStrategy.setStrategicObjectsModifier ControlPoint 2.0
"""

AI_CON = """
aiSettings.setWorldMapSize 2048 2048
aiSettings.setViewDistance 300
AIBotManager.setPlannedDecisionMakingThreshold 0.5 0.5 0.5
ai.saiMapXDimension 64
ai.addSAIStrategy 1 broad
ai.addSAIStrategy 2 broad
ai.addSAIStrategy 2 flank
"""

LANDING = """
aiStrategicArea.create CrossRoads 1140/747 1153/757 150 land
aiStrategicArea.create DefGun1 614.5/1048.5 640/1074 50 land
AILandingZone.createLandingZone SouthLanding 1110/593 1196/713 LZZMax
AILandingZone.createLandingZone EastLanding 1560/1026 1440/938 LZXMin
rem AILandingZone.createLandingZone NorthTipLanding 744/1353 864/1443 LZXMax
AILandingZone.createLandingZone Odd 0/0 10/10 Sideways
aiStrategicArea.setActive CrossRoads
AIStrategicArea.attachLandingZone SouthLanding
AIStrategicArea.addLandingZoneUnit LandingCraft
aiStrategicArea.setActive DefGun1
AIStrategicArea.addExpelledUnit LandingCraft
"""

VEHICLE_GROUPS = """
aiSettings.createVehicleGroup land
aiSettings.createVehicleGroup infantry
aiSettings.createVehicleGroup any
aiSettings.createVehicleGroup sea
aiSettings.addVehicleToVehicleGroup 0  land
aiSettings.addVehicleToVehicleGroup 3  infantry
aiSettings.addVehicleToVehicleGroup 7  any
aiSettings.addVehicleToVehicleGroup 12 sea
aiStrategicArea.create SeaArea1 975/305 1240/452 10 sea
AIStrategicArea.addAllowedVehicleGroup any
AIStrategicArea.addAllowedVehicleGroup sea
"""

PATHFINDING = """
ai.numAStarResources 12
ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1
ai.setSmoothing 1 10
"""


class AiLevelGrammarTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ai = LevelAi()

    def test_strategic_areas_land_in_the_gltf_frame(self) -> None:
        parse_strategic_areas(AREAS, self.ai)
        self.assertEqual([a.name for a in self.ai.strategicAreas], ["AlliedBase", "Pass"])
        base = self.ai.strategicAreas[0]
        # The engine's z is the exporter's -z: the box's z bounds swap.
        self.assertEqual(base.min, [1652.0, -792.0])
        self.assertEqual(base.max, [1702.0, -692.0])
        self.assertEqual(base.radius, 50.0)
        self.assertEqual(base.neighbours, ["Pass"])
        self.assertEqual(base.flags, ["Base"])
        self.assertEqual(base.orderPositions["Infantery"], [1702.0, -792.0])
        self.assertEqual(base.side, 2)
        self.assertEqual(base.vehicleSearchRadius, 190.0)
        self.assertEqual(base.takeable, {"1": False})
        self.assertEqual(self.ai.strategicAreas[1].flags, ["Flank", "ChokePoint"])

    def test_vehicle_groups_are_the_aisettings_words(self) -> None:
        # Wake's `StrategicAreas.con`: `aiSettings.createVehicleGroup <name>`
        # and `aiSettings.addVehicleToVehicleGroup <type> <group>`
        # (`AISettings::addVehicleToVehicleGroup` 0x08484860). The exporter
        # read `aiStrategicArea.createVehicleGroup` / `addVehicleType`, words
        # no level uses, and every level exported `vehicleGroups: {}`.
        parse_strategic_areas(VEHICLE_GROUPS, self.ai)
        self.assertEqual(self.ai.vehicleGroups, {"land": ["0"], "infantry": ["3"], "any": ["7"], "sea": ["12"]})
        self.assertEqual(list(self.ai.vehicleGroups), ["land", "infantry", "any", "sea"])   # creation order
        self.assertEqual(self.ai.strategicAreas[0].allowedVehicleGroups, ["any", "sea"])

    def test_landing_zones_and_the_areas_that_use_them(self) -> None:
        # `AILandingZone.createLandingZone` (Wake's lines): the corners sorted
        # per axis (ctor 0x0863ac80), z negated into the glTF frame, and the
        # beach edge the direction names in that frame (the engine's ZMax is
        # the exporter's zMin). A `rem` zone is not created.
        parse_strategic_areas(LANDING, self.ai)
        zones = {z.name: z for z in self.ai.landingZones}
        self.assertEqual(list(zones), ["SouthLanding", "EastLanding", "Odd"])
        south = zones["SouthLanding"]
        self.assertEqual(south.min, [1110.0, -713.0])
        self.assertEqual(south.max, [1196.0, -593.0])
        self.assertEqual((south.direction, south.beach), ("LZZMax", "zMin"))
        east = zones["EastLanding"]
        self.assertEqual(east.min, [1440.0, -1026.0])
        self.assertEqual(east.max, [1560.0, -938.0])
        self.assertEqual(east.beach, "xMin")
        self.assertIsNone(zones["Odd"].beach)
        cross, defgun = self.ai.strategicAreas
        self.assertEqual(cross.category, "land")
        self.assertEqual(cross.landingZones, ["SouthLanding"])
        self.assertEqual(cross.landingZoneUnits, ["LandingCraft"])
        self.assertEqual(defgun.expelledUnits, ["LandingCraft"])
        self.assertEqual(defgun.landingZones, [])
        out = self.ai.to_json()
        self.assertEqual(out["landingZones"][0]["beach"], "zMin")
        self.assertEqual(out["strategicAreas"][0]["landingZoneUnits"], ["LandingCraft"])

    def test_conditions_prerequisites_and_strategies(self) -> None:
        parse_conditions(CONDITIONS, self.ai)
        parse_prerequisites(PREREQS, self.ai)
        parse_strategies(STRATEGIES, self.ai)
        time_cond, flank_cond = self.ai.conditions
        self.assertEqual((time_cond.fuzzy, time_cond.op, time_cond.subject, time_cond.object, time_cond.value),
                         ("Fuzzy", "EqualSmaller", "Friendly", "StartTime", 200.0))
        self.assertTrue(time_cond.abort)
        self.assertEqual(flank_cond.strength, ["Required", "AdvisoryNegative"])
        self.assertEqual(self.ai.prerequisites[0].conditions,
                         [{"name": "flankCond", "weight": 5.0}, {"name": "timeCond", "weight": 1.5}])
        flank = self.ai.strategies[0]
        self.assertEqual((flank.aggression, flank.attacks, flank.defences, flank.timeLimit, flank.prerequisite),
                         (0.65, 1, 1, 400.0, "flankPrereq"))
        self.assertEqual(flank.modifiers[0], {"flag": "Centre", "factor": 2.0, "owner": "Owned"})
        self.assertEqual(flank.modifiers[1], {"flag": "ControlPoint", "factor": 2.0, "owner": None})

    def test_ai_con_settings_and_side_lists(self) -> None:
        parse_ai_con(AI_CON, self.ai)
        parse_pathfinding_con(PATHFINDING, self.ai)
        self.assertEqual(self.ai.settings["viewDistance"], 300.0)
        self.assertEqual(self.ai.settings["saiMapX"], 64)
        self.assertEqual(self.ai.sideStrategies, {"1": ["broad"], "2": ["broad", "flank"]})
        self.assertEqual(self.ai.searchMaps[0]["lowClip"], 0.4)
        self.assertEqual(self.ai.settings["smoothing"], {"1": 10})
        self.assertIsInstance(self.ai.to_json()["strategicAreas"], list)


class AiLevelInstallTests(unittest.TestCase):
    def test_el_alamein_from_the_installed_game(self) -> None:
        try:
            from bf42.level import find_level_archives, load_level_files
            from extract_models import DEFAULT_GAME_DIR
        except Exception as exc:  # noqa: BLE001
            raise unittest.SkipTest(str(exc))
        game_dir = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
        if not game_dir.exists():
            raise unittest.SkipTest("no game install")
        try:
            paths = find_level_archives(game_dir, "bf1942", "el_alamein")
        except Exception as exc:  # noqa: BLE001
            raise unittest.SkipTest(str(exc))
        ai = load_level_ai(load_level_files(paths, "el_alamein"))
        self.assertIsNotNone(ai)
        self.assertEqual(len(ai.strategicAreas), 9)
        self.assertEqual(sorted(ai.sideStrategies), ["1", "2"])
        self.assertEqual([s.name for s in ai.strategies], ["flank", "broad", "breakOut", "cleanUp"])
        self.assertEqual(ai.landingZones, [])

    def test_wake_landing_zones_from_the_installed_game(self) -> None:
        try:
            from bf42.level import find_level_archives, load_level_files
            from extract_models import DEFAULT_GAME_DIR
        except Exception as exc:  # noqa: BLE001
            raise unittest.SkipTest(str(exc))
        game_dir = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
        try:
            paths = find_level_archives(game_dir, "bf1942", "wake")
        except Exception as exc:  # noqa: BLE001
            raise unittest.SkipTest(str(exc))
        ai = load_level_ai(load_level_files(paths, "wake"))
        self.assertIsNotNone(ai)
        # Four live zones (two more are `rem`med out), each attached to one
        # land area whose landing-zone unit is the Daihatsu's `LandingCraft`.
        self.assertEqual(sorted(z.name for z in ai.landingZones),
                         ["CentreLanding", "EastLanding", "SouthBayLanding", "SouthLanding"])
        users = {a.name: a.landingZones for a in ai.strategicAreas if a.landingZones}
        self.assertEqual(users, {"CrossRoads": ["SouthLanding"], "NorthernMainBaseExit": ["EastLanding"],
                                 "SouthernBase": ["SouthBayLanding"], "WesternMainBaseExit": ["CentreLanding"]})
        for a in ai.strategicAreas:
            if a.landingZones:
                self.assertEqual(a.landingZoneUnits, ["LandingCraft"])
        expelled = sorted(a.name for a in ai.strategicAreas if "LandingCraft" in a.expelledUnits)
        self.assertEqual(expelled, ["DefGun1", "DefGun2", "FirstNorthenBase", "MainBase", "SecondNorthenBase"])


def _raw_map(records) -> bytes:
    """A one-bit level-0 search map of 2 x 2 blocks (128 m square):
    `records` is four entries, a special-cell index or a 512-byte block."""
    out = struct.pack("<5i", 1, 1, 6, 0, 0) + struct.pack("<i", 2) + struct.pack("<2I", 0, 0xFFFFFFFF)
    for rec in records:
        if isinstance(rec, int):
            out += struct.pack("<i", rec)
        else:
            out += struct.pack("<i", -1) + rec
    return out


PATHFINDING_LEVELS = """
ai.addSearchMap Tank0 0 0 25 3.0 0.3 2.5 0
ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1 0 2
ai.addSearchMap Boat2 1 5 0 125.0 0.3 2.5 0 2 5
ai.addSearchMap LandingCraft3 1 1.4 0 4.0 0.3 2.5 0 2
beginrem
ai.addSearchMap Car4 0 0 20 4.0 0.3 2.5 0
endrem
ai.loadMaps
"""


def _level_file(level: int, blocks_bits: int) -> bytes:
    """An all-free search-map level: header, special cells, every block the
    special cell 0."""
    n = (1 << blocks_bits) ** 2
    return (struct.pack("<5i", blocks_bits, blocks_bits, level + 6, level, 0)
            + struct.pack("<i2I", 2, 0, 0xFFFFFFFF) + struct.pack(f"<{n}i", *([0] * n)))


class _Files:
    def __init__(self, files: dict[str, bytes]):
        self.files = {k.lower(): v for k, v in files.items()}

    def find(self, rel: str):
        return rel if rel.lower() in self.files else None

    def read(self, rel: str) -> bytes:
        return self.files[rel.lower()]


class SearchMapLoadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ai = LevelAi()
        parse_pathfinding_con(PATHFINDING_LEVELS, self.ai)

    def test_levels_default_to_zero_and_two(self) -> None:
        # ConsoleClass344 0x084e4880: eight arguments -> 0, 2; nine -> arg, 2.
        levels = [(m["name"], m["minLevel"], m["maxLevel"]) for m in self.ai.searchMaps]
        self.assertEqual(levels, [("Tank0", 0, 2), ("Infantry1", 0, 2), ("Boat2", 2, 5), ("LandingCraft3", 2, 2)])

    def test_a_beginrem_block_declares_nothing(self) -> None:
        self.assertNotIn("Car4", [m["name"] for m in self.ai.searchMaps])

    def test_the_engine_stops_at_the_first_map_it_cannot_load(self) -> None:
        files = {f"Pathfinding/Tank0Level{lv}Map.raw": _level_file(lv, 5 - lv) for lv in range(3)}
        files.update({f"Pathfinding/Boat2Level{lv}Map.raw": _level_file(lv, 5 - lv) for lv in range(2, 6)})
        files.update({"Pathfinding/LandingCraft3Level2Map.raw": _level_file(2, 3)})
        # Infantry1Level1Map.raw missing: Infantry1 fails, and Boat2 and
        # LandingCraft3 are never loaded though their files are there.
        files.update({"Pathfinding/Infantry1Level0Map.raw": _level_file(0, 5),
                      "Pathfinding/Infantry1Level2Map.raw": _level_file(2, 3)})
        rows = level_search_maps(_Files(files), self.ai)
        self.assertEqual([r["loaded"] for r in rows], [True, False, False, False])
        self.assertEqual(rows[0]["level"], 0)
        self.assertIn("Infantry1Level1Map.raw", rows[1]["reason"])
        self.assertEqual(rows[2]["reason"], "an earlier map failed to load")
        files["Pathfinding/Infantry1Level1Map.raw"] = _level_file(1, 4)
        rows = level_search_maps(_Files(files), self.ai)
        self.assertEqual([r["loaded"] for r in rows], [True, True, True, True])
        self.assertEqual([r["level"] for r in rows], [0, 0, 2, 2])
        self.assertEqual(rows[2]["data"], files["Pathfinding/Boat2Level2Map.raw"])

    def test_a_header_that_does_not_match_the_level_fails(self) -> None:
        files = {f"Pathfinding/Tank0Level{lv}Map.raw": _level_file(lv, 5 - lv) for lv in range(3)}
        files["Pathfinding/Tank0Level1Map.raw"] = _level_file(0, 4)
        rows = level_search_maps(_Files(files), self.ai)
        self.assertFalse(rows[0]["loaded"])
        self.assertIn("header", rows[0]["reason"])


class SearchMapRawTests(unittest.TestCase):
    def test_special_cells_and_an_inline_block(self) -> None:
        block = bytearray(512)
        # Pixel (col 5, row 2) and (col 40, row 63) blocked: word row * 2 +
        # (col >> 5), bit col & 31.
        block[(2 * 2) * 4] = 1 << 5
        word = 63 * 2 + 1
        block[word * 4 + 1] = 1 << (8 - 8)   # bit 8 of the word: col 40
        m = read_search_map_raw(_raw_map([0, 1, bytes(block), 0]))
        self.assertEqual((m.width, m.height, m.level, m.block_pixels), (128, 128, 0, 64))
        self.assertFalse(m.blocked(10, 10))            # block 0: all free
        self.assertTrue(m.blocked(70, 10))             # block 1: all blocked
        self.assertTrue(m.blocked(5, 66))              # block 2: row 2, col 5
        self.assertFalse(m.blocked(6, 66))
        self.assertTrue(m.blocked(40, 127))            # block 2: row 63, col 40
        self.assertFalse(m.blocked(100, 100))          # block 3: all free
        self.assertTrue(m.blocked(-1, 0))              # outside the map

    def test_trailing_bytes_are_refused(self) -> None:
        with self.assertRaises(ValueError):
            read_search_map_raw(_raw_map([0, 0, 0, 0]) + b"\0\0\0\0")

    def test_bocage_tank_map_carries_its_bridges(self) -> None:
        try:
            from bf42.level import find_level_archives, load_level_files
            from extract_models import DEFAULT_GAME_DIR
        except Exception as exc:  # noqa: BLE001
            raise unittest.SkipTest(str(exc))
        game_dir = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
        if not game_dir.exists():
            raise unittest.SkipTest("no game install")
        try:
            files = load_level_files(find_level_archives(game_dir, "bf1942", "bocage"), "bocage")
        except Exception as exc:  # noqa: BLE001
            raise unittest.SkipTest(str(exc))
        hit = files.find("Pathfinding/Tank0Level0Map.raw")
        if not hit:
            raise unittest.SkipTest("no baked tank map")
        m = read_search_map_raw(files.read(hit))
        self.assertEqual((m.width, m.height), (2048, 2048))
        # The small stone bridge at (812, 1414): its deck is free across the
        # river, the water either side of it blocked.
        self.assertTrue(all(not m.blocked(x, 1413) for x in range(790, 846)))
        self.assertTrue(m.blocked(815, 1395))
        self.assertTrue(m.blocked(815, 1430))


if __name__ == "__main__":
    unittest.main()
