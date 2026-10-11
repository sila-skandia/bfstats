"""ObjectiveMode's objectives as the exporter reads them (`bf42/level.py`
`parse_objective_setup`, `add_objective_targets`; `scene_layers.py`
`_objectives_report`; ledger OBJ-2, OBJ-4).

The scripts below are cut from vanilla Battle of Britain's
`ObjectiveMode/ObjectiveSpawnerTemplates.con`, `ObjectiveSpawners.con` and
`ObjectiveCommon.con`, in the order its `ObjectiveMode.con` runs them.
`test_objectives.py` covers what the viewer does with the report.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42.level import (  # noqa: E402
    GameplayObjects, SpawnTemplate, StaticInstance, add_objective_targets,
    parse_briefing, parse_objective_setup,
)
import scene_layers  # noqa: E402

VEHICLE_PADS = """
ObjectTemplate.create ObjectSpawner britain_FactorySpawner
ObjectTemplate.setObjectTemplate 2 Britain_Factory
"""

TEMPLATES = """
ObjectTemplate.create DestroyTargetObjective DestroyFactory01
ObjectTemplate.setTargetName Factory01
ObjectTemplate.ObjectiveName Factory
ObjectTemplate.setObjectiveDelay 1.0
ObjectTemplate.setTeam 1
ObjectTemplate.create DestroyTargetObjective DestroyRadarTower01
ObjectTemplate.targetName RadarTower01
ObjectTemplate.objectiveDelay 1.0
ObjectTemplate.team 1
ObjectTemplate.create ANDCompositeObjective Composite
ObjectTemplate.addObjectiveSpawnerToComposite ObjectiveSpawner01
ObjectTemplate.addObjectiveSpawnerToComposite ObjectiveSpawner02
ObjectTemplate.setObjectiveDelay 3.0
ObjectTemplate.setTeam 1
ObjectTemplate.create TimerObjective Timer
ObjectTemplate.TimeLimit 900.0
ObjectTemplate.setObjectiveDelay 3.0
ObjectTemplate.setTeam 2
ObjectTemplate.create ObjectSpawner Britain_FactorySpawner
ObjectTemplate.setObjectTemplate 1 Factory_Objective
ObjectTemplate.setObjectTemplate 2 Factory_Objective
ObjectTemplate.SpawnDelay 9999
ObjectTemplate.SpawnDelayAtStart 0
ObjectTemplate.create ObjectSpawner East_Harwick_RadarTower_Spawner
ObjectTemplate.setObjectTemplate 1 RadarTower
ObjectTemplate.setObjectTemplate 2 RadarTower
ObjectTemplate.create ObjectSpawner DestroyObjectiveSpawner01
ObjectTemplate.setObjectTemplate 1 DestroyFactory01
ObjectTemplate.setTeam 1
ObjectTemplate.create ObjectSpawner DestroyObjectiveSpawner02
ObjectTemplate.setObjectTemplate 1 DestroyRadarTower01
ObjectTemplate.setTeam 1
ObjectTemplate.create ObjectSpawner ANDCompositeObjectiveSpawner
ObjectTemplate.setObjectTemplate 1 Composite
ObjectTemplate.setTeam 1
ObjectTemplate.create ObjectSpawner TimerObjectiveSpawner
ObjectTemplate.setObjectTemplate 2 Timer
ObjectTemplate.setTeam 2
"""

SPAWNERS = """
Object.create britain_FactorySpawner
Object.absolutePosition 1227.99/104.742/1727.94
Object.rotation 0.000000/0.000000/0.000000
Object.setName Factory01
Object.setTeam 2
Object.create East_Harwick_RadarTower_Spawner
Object.absolutePosition 1427.34/103.008/1258.13
Object.rotation 1427.34103.008/1258.13
Object.rotation 180.000000/0.000000/0.000000
Object.setName RadarTower01
Object.setTeam 2
Object.create DestroyObjectiveSpawner01
object.setName ObjectiveSpawner01
Object.create DestroyObjectiveSpawner02
object.setName ObjectiveSpawner02
object.create ANDCompositeObjectiveSpawner
object.setName AXIS
object.create TimerObjectiveSpawner
object.setName ALLIED
"""

COMMON = """
objectiveManager.setDefender 2
objectiveManager.registerObjectSpawner ObjectiveSpawner01
objectiveManager.setRootObjectSpawner 2 ALLIED
objectiveManager.setRootObjectSpawner 1 AXIS
"""


def setup():
    scripts = [(f"bf1942/Levels/Battle_of_Britain/ObjectiveMode/{name}.con", text.strip().splitlines())
               for name, text in (("ObjectSpawnTemplates", VEHICLE_PADS),
                                  ("ObjectiveSpawnerTemplates", TEMPLATES),
                                  ("ObjectiveSpawners", SPAWNERS),
                                  ("ObjectiveCommon", COMMON))]
    return parse_objective_setup(scripts)


class ObjectiveSetupTests(unittest.TestCase):
    def test_the_manager_words(self) -> None:
        s = setup()
        self.assertEqual(2, s.defender)
        self.assertEqual({1: "AXIS", 2: "ALLIED"}, s.roots)
        # The ctor's own: a defender's death is free, an attacker's costs.
        self.assertEqual((False, True),
                         (s.defender_lose_tickets_on_death, s.attacker_lose_tickets_on_death))

    def test_the_objective_templates(self) -> None:
        o = setup().objectives
        self.assertEqual({"destroyfactory01", "destroyradartower01", "composite", "timer"}, set(o))
        self.assertEqual(("Factory01", "Factory", 1.0, 1),
                         (o["destroyfactory01"].target, o["destroyfactory01"].objective_name,
                          o["destroyfactory01"].delay, o["destroyfactory01"].team))
        # The bare property name reads like its `set` form (CON-15).
        self.assertEqual(("RadarTower01", 1.0, 1),
                         (o["destroyradartower01"].target, o["destroyradartower01"].delay,
                          o["destroyradartower01"].team))
        self.assertEqual(["ObjectiveSpawner01", "ObjectiveSpawner02"], o["composite"].members)
        self.assertEqual((900.0, 3.0, 2), (o["timer"].time_limit, o["timer"].delay, o["timer"].team))

    def test_a_typod_placement_vector_is_read_off_a_stream(self) -> None:
        # CON-16/CON-18: float, one character, float, one character, float.
        # Mimoyecques ships `907.196/56.1322.616.016` for an anti-tank gun
        # pad; read strictly it stood at the origin of the world.
        s = parse_objective_setup([("x.con", """
Object.create AntiTankGunSpawner
Object.setName gun1
Object.absolutePosition 907.196/56.1322.616.016
Object.rotation 90/0/0`
""".strip().splitlines())])
        gun = next(p for p in s.placements if p.name == "gun1")
        self.assertEqual((907.196, 56.1322, 616.016), gun.position)
        self.assertEqual((90.0, 0.0, 0.0), gun.rotation)

    def test_each_spawner_its_objective(self) -> None:
        pairs = {p.name: (s.spawner_team(p), spec.name)
                 for s in [setup()] for p, spec in s.objective_spawners()}
        self.assertEqual({"ObjectiveSpawner01": (1, "DestroyFactory01"),
                          "ObjectiveSpawner02": (1, "DestroyRadarTower01"),
                          "AXIS": (1, "Composite"), "ALLIED": (2, "Timer")}, pairs)

    def test_the_target_pads_take_the_chains_last_template(self) -> None:
        s = setup()
        pads = s.target_pads()
        self.assertEqual(["Factory01", "RadarTower01"], [p.name for p in pads])
        # `ObjectiveSpawnerTemplates.con` redefined the factory's pad after the
        # vehicle layer made it a `Britain_Factory` one.
        self.assertEqual(["Factory_Objective", "RadarTower"], [s.spawned(p) for p in pads])
        # A malformed rotation keeps the good one after it.
        self.assertEqual((180.0, 0.0, 0.0), pads[1].rotation)

    def test_the_layer_gains_the_pads(self) -> None:
        s = setup()
        layer = GameplayObjects(mode="ObjectiveMode")
        layer.object_spawn_templates["britain_factoryspawner"] = SpawnTemplate(
            name="britain_FactorySpawner", vehicles={2: "Britain_Factory"})
        layer.object_spawns.append(StaticInstance("Jeep", (1.0, 2.0, 3.0), (0.0, 0.0, 0.0), team=1))
        self.assertEqual(2, add_objective_targets(layer, s))
        self.assertEqual(3, len(layer.object_spawns))
        self.assertEqual("Factory_Objective",
                         layer.object_spawn_templates["britain_factoryspawner"].vehicles[2])
        # Idempotent: a second pass places nothing twice.
        self.assertEqual(0, add_objective_targets(layer, s))

    def test_the_report(self) -> None:
        report = scene_layers._objectives_report(setup())
        self.assertEqual(2, report["defender"])
        self.assertEqual({"1": "AXIS", "2": "ALLIED"}, report["roots"])
        kinds = {e["spawner"]: e["kind"] for e in report["objectives"]}
        self.assertEqual({"ObjectiveSpawner01": "DestroyTarget", "ObjectiveSpawner02": "DestroyTarget",
                          "AXIS": "ANDComposite", "ALLIED": "Timer"}, kinds)
        timer = next(e for e in report["objectives"] if e["kind"] == "Timer")
        self.assertEqual((900.0, 3.0, 2), (timer["timeLimit"], timer["delay"], timer["team"]))
        factory = report["targets"][0]
        # glTF axes: z mirrored.
        self.assertEqual({"name": "Factory01", "spawner": "britain_FactorySpawner",
                          "template": "Factory_Objective", "team": 2,
                          "position": [1227.99, 104.742, -1727.94]}, factory)

    def test_a_script_with_no_objective_reports_none(self) -> None:
        self.assertIsNone(scene_layers._objectives_report(parse_objective_setup([("x.con", [])])))

    def test_the_objective_debriefing_lines(self) -> None:
        b = parse_briefing("game.setObjectiveAlliedVictory DEBRIEFING_ALLIED_MAJOR_VICTORY_BRITAIN\n"
                           "game.setObjectiveAxisDefeat \"They lost.\"\n"
                           "game.setAlliedDebriefingMajorVictory X\n")
        self.assertEqual({"alliedVictory": "DEBRIEFING_ALLIED_MAJOR_VICTORY_BRITAIN",
                          "axisDefeat": '"They lost."'}, b.debriefing["objective"])
        self.assertEqual({"majorVictory": "X"}, b.debriefing["allied"])


class BattleOfBritainArchiveTests(unittest.TestCase):
    """Vanilla Battle of Britain against the shipped archive."""

    @classmethod
    def setUpClass(cls) -> None:
        from extract_models import DEFAULT_GAME_DIR, mod_chain
        from bf42.level import find_level_archives, load_game_types, load_level_files
        paths = find_level_archives(DEFAULT_GAME_DIR, "bf1942", "Battle_of_Britain",
                                    chain=mod_chain(DEFAULT_GAME_DIR, "bf1942")) \
            if (DEFAULT_GAME_DIR / "Mods" / "bf1942").is_dir() else None
        if not paths:
            raise unittest.SkipTest("vanilla Battle of Britain is not installed")
        cls.types = load_game_types(load_level_files(paths, "Battle_of_Britain"))

    def test_only_objective_mode_declares_objectives(self) -> None:
        self.assertIsNotNone(self.types["ObjectiveMode"].objectives)
        self.assertIsNone(self.types["Conquest"].objectives)

    def test_five_targets_two_roots(self) -> None:
        s = self.types["ObjectiveMode"].objectives
        self.assertEqual(7, len(s.objective_spawners()))
        self.assertEqual(["Factory01", "RadarTower01", "RadarTower02", "RadarTower03", "RadarTower04"],
                         [p.name for p in s.target_pads()])
        self.assertEqual({1: "AXIS", 2: "ALLIED"}, s.roots)


if __name__ == "__main__":
    unittest.main()
