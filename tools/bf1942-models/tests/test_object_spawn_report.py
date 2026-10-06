"""`extract_map._object_spawn_report` (the `spawns` layer's `objectSpawns`):
the abandoned clock's three words on every pad (ledger SPAWN-13).

`spawnObject` arms every vehicle a pad places with the template's
`TimeToLive`; it runs while the hull stands farther than `Distance` from its
spawner with nobody in or beside it, and then bills `damageWhenLost` a second.
The report writes the template's words, and the ctor's 30 / 100 / 1.0 where
the template sets none (SPAWN-9, SPAWN-17), so the viewer can tell a scene
that has the clock from one written before it.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402
from bf42.level import (  # noqa: E402
    GameplayObjects, LevelInfo, SpawnTemplate, StaticInstance, TerrainInfo,
    parse_spawn_templates,
)

DC_TANK_SPAWNER = """
ObjectTemplate.create ObjectSpawner heavytankspawner
ObjectTemplate.setObjectTemplate 1 T72
ObjectTemplate.setObjectTemplate 2 M1A1
ObjectTemplate.minSpawnDelay 70
ObjectTemplate.maxSpawnDelay 110
ObjectTemplate.spawnDelayAtStart 0
ObjectTemplate.TimeToLive 45
ObjectTemplate.Distance 40
ObjectTemplate.DamageWhenLost 10
"""


def report(templates: dict[str, SpawnTemplate], template: str) -> dict:
    layer = GameplayObjects(
        mode="Conquest",
        object_spawns=[StaticInstance(template, (100.0, 10.0, 200.0), (0.0, 0.0, 0.0), team=2)],
        object_spawn_templates=templates)
    info = LevelInfo(name="T", terrain=TerrainInfo())
    info.gameplay = layer
    info.spawn_objects = layer.object_spawns
    info.spawn_templates = layer.object_spawn_templates
    [pad] = extract_map._object_spawn_report(info)
    return pad


class AbandonedClockWordsTests(unittest.TestCase):
    def test_a_template_s_own_words_are_written(self) -> None:
        pad = report(parse_spawn_templates(DC_TANK_SPAWNER), "heavytankspawner")
        self.assertEqual("M1A1", pad["vehicle"])
        self.assertEqual({"1": "T72", "2": "M1A1"}, pad["templates"])
        self.assertEqual(45.0, pad["timeToLive"])
        self.assertEqual(40.0, pad["distance"])
        self.assertEqual(10.0, pad["damageWhenLost"])

    def test_a_silent_template_gets_the_ctor_s_values(self) -> None:
        pad = report({"jeepspawner": SpawnTemplate(name="jeepspawner", vehicles={1: "Willy", 2: "Willy"})},
                     "jeepspawner")
        self.assertEqual(30.0, pad["timeToLive"])
        self.assertEqual(100.0, pad["distance"])
        self.assertEqual(1.0, pad["damageWhenLost"])


class DesertCombatArchiveTests(unittest.TestCase):
    """Desert Combat 0.7's Gazala, against the shipped archives: every pad
    sets the three words (1,415 of DC's 1,529 spawner templates at 45 s)."""

    @classmethod
    def setUpClass(cls) -> None:
        from extract_models import DEFAULT_GAME_DIR, mod_chain
        from bf42.level import find_level_archives, load_gameplay_objects, load_level_files
        if not (DEFAULT_GAME_DIR / "Mods" / "DesertCombat").is_dir():
            raise unittest.SkipTest("Desert Combat is not installed")
        paths = find_level_archives(DEFAULT_GAME_DIR, "DesertCombat", "Gazala",
                                    chain=mod_chain(DEFAULT_GAME_DIR, "DesertCombat"))
        if not paths:
            raise unittest.SkipTest("Desert Combat's Gazala is not installed")
        layer = load_gameplay_objects(load_level_files(paths, "Gazala"), "Conquest")
        info = LevelInfo(name="Gazala", terrain=TerrainInfo())
        info.gameplay = layer
        info.spawn_objects = layer.object_spawns
        info.spawn_templates = layer.object_spawn_templates
        cls.pads = extract_map._object_spawn_report(info)

    def test_every_pad_carries_the_clock(self) -> None:
        self.assertTrue(self.pads)
        for pad in self.pads:
            self.assertIn("timeToLive", pad)
            self.assertIn("distance", pad)
            self.assertIn("damageWhenLost", pad)

    def test_the_tanks_time_out_as_dc_wrote_them(self) -> None:
        tanks = [pad for pad in self.pads if pad["spawner"].lower() == "heavytankspawner"]
        self.assertTrue(tanks)
        for pad in tanks:
            self.assertEqual((45.0, 40.0, 10.0),
                             (pad["timeToLive"], pad["distance"], pad["damageWhenLost"]))


if __name__ == "__main__":
    unittest.main()
