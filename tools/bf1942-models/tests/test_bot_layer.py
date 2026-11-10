"""Generated bot layers (features/bot-map-generation): the area rule and its
script, the bake's hook, the lint, the trace detectors, the judge, the
painter's doorways and the menu's tag.

`tests/bot_layer_harness.mjs` runs the node halves on synthetic inputs; the
Python half reads the layer kept as source under `bot-layers/`.
"""

# watches: tools/bf1942-models/bot-layers/*/*/* tools/bf1942-models/bot-layers/*/*/*/*

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import scene_layers  # noqa: E402
from bf42 import ai_level  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "bot_layer_harness.mjs"
LAYERS = ROOT / "bot-layers"


def run_harness() -> dict:
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr[-2000:])
    return json.loads(proc.stdout)


class GeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.areas = {a["name"]: a for a in cls.out["areas"]}

    def test_one_area_per_control_point_on_the_flag(self) -> None:
        self.assertEqual(len(self.areas), 5)
        # The second corner is the flag, the first the capture radius away (engine z is -z).
        self.assertIn("aiStrategicArea.create Middle 188/193 200/205 300", self.out["con"])
        self.assertIn("aiStrategicArea.setOrderPosition Infantry 200.5/204.5", self.out["con"])

    def test_the_box_is_the_capture_radius_within_bounds(self) -> None:
        self.assertEqual([self.areas[n]["half"] for n in ("AxisBase", "Middle", "North")], [5, 12, 40])

    def test_a_fixed_base_is_a_base_of_its_side_the_enemy_may_not_take(self) -> None:
        self.assertEqual(self.areas["AxisBase"]["flags"], ["Base"])
        self.assertIn("aiStrategicArea.setSide 1\r\naiStrategicArea.setTakeable 2 0", self.out["con"])
        self.assertIn("aiStrategicArea.setSide 2\r\naiStrategicArea.setTakeable 1 0", self.out["con"])

    def test_flags_on_the_line_between_the_bases_are_the_centre_and_the_rest_flanks(self) -> None:
        self.assertEqual(self.areas["Middle"]["flags"], ["Centre", "StrongPoint", "Close", "ControlPoint"])
        self.assertEqual(self.areas["North"]["flags"], ["Flank", "ControlPoint"])

    def test_neighbours_are_routes_with_no_area_on_the_way(self) -> None:
        # Middle lies on the way from base to base, so the bases are not neighbours.
        self.assertNotIn("AlliedBase", self.areas["AxisBase"]["neighbours"])
        self.assertIn("Middle", self.areas["AxisBase"]["neighbours"])
        # An area no route reaches has none: the lint reports it, the generator invents nothing.
        self.assertEqual(self.areas["Island"]["neighbours"], [])
        for name, area in self.areas.items():
            for other in area["neighbours"]:
                self.assertIn(name, self.areas[other]["neighbours"])

    def test_a_flag_no_soldier_can_stand_inside_is_kept_inert(self) -> None:
        mill = self.out["mill"]
        self.assertTrue(mill["unreachable"])
        self.assertEqual((mill["flags"], mill["neighbours"]), ([], []))
        block = self.out["millCon"].split("aiStrategicArea.create Mill")[1]
        self.assertIn("aiStrategicArea.setTakeable 1 0\r\naiStrategicArea.setTakeable 2 0", block)
        self.assertNotIn("setOrderPosition", block)

    def test_a_spawn_with_no_way_down_or_no_ground_is_kept_from_bots(self) -> None:
        self.assertEqual(self.out["excluded"], ["top", "sealed"])
        first, avoided, none_left = self.out["avoid"]
        self.assertEqual((first, avoided), ("top", "foot"))
        self.assertIsNotNone(none_left)

    def test_the_engines_maps_are_declared_in_dices_order(self) -> None:
        text = self.out["pathCon"]
        self.assertLess(text.index("ai.addSearchType Tank 0 0"), text.index("ai.addSearchType Infantry 1 0"))

    def test_the_same_inputs_give_the_same_bytes(self) -> None:
        self.assertTrue(self.out["conAgain"])

    def test_the_ai_script_lists_each_sides_strategies_in_the_templates_order(self) -> None:
        text = self.out["aiCon"]
        self.assertLess(text.index("ai.addSAIStrategy 1 flank"), text.index("ai.addSAIStrategy 1 broad"))
        self.assertIn("aiSettings.setWorldMapSize 1024 1024", text)
        self.assertNotIn("AIpathFinding", text)


class LintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_sound_layer_has_no_finding(self) -> None:
        self.assertEqual(self.out["lintGood"]["errors"], [])
        self.assertEqual(self.out["lintGood"]["warnings"], [])

    def test_each_defect_is_named_by_its_check(self) -> None:
        self.assertEqual(self.out["lintDangling"], ["references"])
        self.assertEqual(self.out["lintUndefinedStrategy"], ["references"])
        self.assertEqual(self.out["lintOutside"], ["coverage"])
        self.assertEqual(self.out["lintOrderBlocked"], ["order"])
        self.assertEqual(self.out["lintCutOff"], ["reach"])
        self.assertEqual(self.out["lintHigh"], ["reach"])
        self.assertEqual(self.out["lintOneWay"], ["references"])

    def test_a_condition_of_any_kind_counts_as_defined(self) -> None:
        self.assertEqual(self.out["defined"], ["a", "weakCond"])


class DetectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.row = run_harness()["detect"]

    def test_a_bot_pushing_at_a_wall_is_one_stuck_episode_where_it_stood(self) -> None:
        self.assertEqual(self.row["stuckEpisodes"], 1)
        self.assertEqual(self.row["stuckPlaces"][0]["at"], "16,-8")
        self.assertAlmostEqual(self.row["stuckPlaces"][0]["seconds"], 26, delta=2)

    def test_idle_oscillation_self_death_and_spawn_trap_are_counted(self) -> None:
        self.assertAlmostEqual(self.row["idleShare"], 41 / 85, delta=0.01)
        # bot_1's A, B, A counts; bot_5's, with a death between each, does not.
        self.assertEqual(self.row["oscillations"], 1)
        self.assertEqual(self.row["selfDeaths"], 1)
        self.assertEqual(self.row["teamKills"], 1)
        self.assertEqual(self.row["enemyKills"], {"1": 1, "2": 0})
        self.assertEqual(self.row["spawnTraps"], 1)

    def test_flag_coverage_and_outcome(self) -> None:
        self.assertEqual(self.row["flagsNeverChanged"], ["G"])
        self.assertEqual(self.row["flagCoverage"], 0.5)
        self.assertEqual(self.row["captures"], {"1": 0, "2": 1})
        self.assertEqual(self.row["ticketsBled"], {"1": 10, "2": 5})
        self.assertGreater(self.row["routeFailuresPerBotMinute"], 0)


class JudgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_bar_is_the_baselines_spread(self) -> None:
        self.assertEqual(self.out["baselineBand"]["p90"], 2.8)
        self.assertEqual(self.out["judgePass"]["verdict"], "pass")

    def test_each_failure_names_its_detector(self) -> None:
        self.assertEqual(self.out["judgeStuck"], ["stuckSecondsPerBotMinute"])
        self.assertEqual(self.out["judgeFlag"], ["flagCoverage"])
        self.assertIn("bothSidesCapture", self.out["judgeOneSide"])
        self.assertEqual(self.out["judgeNoBaseline"], "no-baseline")

    def test_team_kills_and_a_side_that_never_scores_fail_on_their_own_lines(self) -> None:
        self.assertEqual(self.out["judgeTeamKills"], ["teamKillsPerBotMinute"])
        self.assertEqual(self.out["judgeNoFight"], ["enemyKillsPerBotMinute", "bothSidesKill"])

    def test_a_flag_nobody_can_stand_in_is_reported_apart_and_not_counted(self) -> None:
        check = self.out["judgeUnreachable"]
        self.assertEqual(check["unreachable"], ["F"])
        self.assertEqual(check["median"], 1)
        self.assertTrue(check["pass"])

    def test_balance_is_reported_and_a_one_sided_set_is_flagged(self) -> None:
        one, mixed = self.out["judgeBalance"]
        self.assertEqual(one, {"split": [2, 0, 0], "oneSided": 1})
        self.assertEqual(mixed, {"split": [1, 1, 0], "oneSided": None})


class DoorwayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.door = run_harness()["door"]

    def test_a_door_narrower_than_two_cells_stays_open_on_the_soldiers_map(self) -> None:
        self.assertEqual(self.door["doorCells"], [0, 0])
        self.assertTrue(self.door["through"])

    def test_the_wall_beside_it_and_a_slit_stay_shut(self) -> None:
        self.assertEqual(self.door["wallCell"], 4)
        self.assertEqual(self.door["beside"], [4, 4])
        self.assertEqual(self.door["slitCell"], 4)

    def test_a_hulls_map_keeps_the_door_shut(self) -> None:
        self.assertEqual(self.door["tankDoor"], [4, 4])


class MenuTagTests(unittest.TestCase):
    def test_a_generated_level_wears_the_experimental_tag(self) -> None:
        self.assertEqual(run_harness()["tags"], ["NO BOTS", "EXPERIMENTAL BOTS", None, None])


class BakeHookTests(unittest.TestCase):
    def test_a_generated_layer_is_read_with_the_shipped_parsers_and_marked(self) -> None:
        with mock.patch.dict(os.environ, {"BOT_LAYERS_UNVERIFIED": "1"}):
            ai = ai_level.load_generated_ai("bf1942", "shigaisen_B")
        self.assertIsNotNone(ai)
        doc = ai.to_json()
        self.assertEqual(len(doc["strategicAreas"]), 8)
        self.assertEqual(doc["generated"]["generator"], "botgen")
        self.assertIn("infantryMap", doc["generated"]["inputs"])
        self.assertEqual([m["name"] for m in doc["searchMaps"]], ["Tank0", "Infantry1"])
        self.assertEqual(doc["generated"]["unreachable"], ["windmill_west"])
        self.assertEqual(doc["sideStrategies"]["1"], ["normal", "bridge", "finalPush", "breakOut"])

    def test_a_bake_reads_only_a_layer_that_passed_or_was_accepted_with_a_reason(self) -> None:
        src = LAYERS / "bf1942" / "shigaisen_b"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "bf1942" / "shigaisen_b"
            shutil.copytree(src, folder)
            verdict = folder / "verdict.json"
            env = {k: v for k, v in os.environ.items() if not k.startswith("BOT_LAYERS_")}
            with mock.patch.dict(os.environ, env, clear=True):
                verdict.unlink(missing_ok=True)
                self.assertIsNone(ai_level.load_generated_ai("bf1942", "shigaisen_B", root))
                verdict.write_text(json.dumps({"verdict": "fail"}))
                self.assertIsNone(ai_level.load_generated_ai("bf1942", "shigaisen_B", root))
                verdict.write_text(json.dumps({"verdict": "fail", "accepted": {"reason": ""}}))
                self.assertIsNone(ai_level.load_generated_ai("bf1942", "shigaisen_B", root))
                verdict.write_text(json.dumps({"verdict": "fail", "accepted": {"reason": "owner played it"}}))
                self.assertEqual(ai_level.load_generated_ai("bf1942", "shigaisen_B", root).generated["gate"],
                                 "accepted: owner played it")
                self.assertTrue(ai_level.generated_layer_live("bf1942", "shigaisen_B", root))
                verdict.write_text(json.dumps({"verdict": "fail"}))
                self.assertFalse(ai_level.generated_layer_live("bf1942", "shigaisen_B", root))
                verdict.write_text(json.dumps({"verdict": "pass"}))
                self.assertEqual(ai_level.load_generated_ai("bf1942", "shigaisen_B", root).generated["gate"], "pass")
            with mock.patch.dict(os.environ, {**env, "BOT_LAYERS_OFF": "1"}, clear=True):
                self.assertIsNone(ai_level.load_generated_ai("bf1942", "shigaisen_B", root))
            verdict.write_text(json.dumps({"verdict": "fail"}))
            with mock.patch.dict(os.environ, {**env, "BOT_LAYERS_UNVERIFIED": "1"}, clear=True):
                self.assertIsNotNone(ai_level.load_generated_ai("bf1942", "shigaisen_B", root))

    def test_a_shipped_layer_carries_no_marker(self) -> None:
        self.assertNotIn("generated", ai_level.LevelAi().to_json())
        self.assertIsNone(ai_level.load_generated_ai("bf1942", "bocage"))

    def test_every_generated_file_is_the_one_its_marker_names(self) -> None:
        for marker in sorted(LAYERS.glob("*/*/generated.json")):
            doc = json.loads(marker.read_text())
            for rel, digest in doc["files"].items():
                with self.subTest(layer=str(marker.parent.relative_to(LAYERS)), file=rel):
                    self.assertEqual(hashlib.sha256((marker.parent / rel).read_bytes()).hexdigest(), digest)

    def test_the_bake_asks_for_a_generated_layer_only_when_the_level_ships_none(self) -> None:
        ctx = SimpleNamespace(info=SimpleNamespace(static_objects=[]), files=None, library=None,
                              mod="bf1942", level="shigaisen_B", level_dir=lambda: None)
        shipped = ai_level.LevelAi()
        with mock.patch.object(scene_layers, "add_cover_values"), \
             mock.patch.object(scene_layers, "write_level_search_maps"), \
             mock.patch.object(scene_layers.em, "union_mode_statics", return_value=[]):
            with mock.patch.object(scene_layers, "load_level_ai", return_value=shipped), \
                 mock.patch.object(scene_layers, "load_generated_ai") as generated:
                out, _ = scene_layers.layer_ai(ctx)
                generated.assert_not_called()
                self.assertNotIn("generated", out["ai"])
            with mock.patch.object(scene_layers, "load_level_ai", return_value=None), \
                 mock.patch.dict(os.environ, {"BOT_LAYERS_UNVERIFIED": "1"}):
                out, _ = scene_layers.layer_ai(ctx)
                self.assertEqual(out["ai"]["generated"]["generator"], "botgen")
            ctx.level = "a_level_with_no_layer"
            with mock.patch.object(scene_layers, "load_level_ai", return_value=None):
                out, _ = scene_layers.layer_ai(ctx)
                self.assertEqual(out, {})


if __name__ == "__main__":
    unittest.main()
