"""`bf42/ai_level.py`: the level's strategic AI scripts as the viewer reads them.

The grammar is pinned on inline script text (no game install needed), and one
test reads the real El Alamein archives when they are installed.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42.ai_level import (  # noqa: E402
    LevelAi, parse_ai_con, parse_conditions, parse_prerequisites,
    parse_strategic_areas, parse_strategies, parse_pathfinding_con, load_level_ai,
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


if __name__ == "__main__":
    unittest.main()
