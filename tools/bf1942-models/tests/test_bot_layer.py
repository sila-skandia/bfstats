"""Generated bot layers (features/bot-map-generation): the area rule and its
script, the bake's hook, the lint, the trace detectors, the judge, the
painter's doorways and the menu's tag.

`tests/bot_layer_harness.mjs` runs the node halves on synthetic inputs; the
Python half reads the layer kept as source under `bot-layers/`.
"""

# watches: tools/bf1942-models/bot-layers/*/*/* tools/bf1942-models/bot-layers/*/*/*/* tools/bf1942-models/bot-layers/*/*/*/*/*

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

    def test_bots_are_kept_off_a_spawn_the_layer_lists(self) -> None:
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


class WalkTestTests(unittest.TestCase):
    """`sim/walkflood.mjs`: the fine flood on a world of boxes."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_body_is_the_pages_soldier(self) -> None:
        body = self.out["body"]
        # The hull reach less the skin, the standing height, the step, a jump's apex at 30 Hz, the free fall.
        self.assertEqual((body["radius"], body["height"], body["step"], body["drop"]), (0.39, 1.8, 0.45, 2))
        self.assertAlmostEqual(body["jump"], 1.12, delta=0.01)
        # Water no deeper than a swimmer stands up in: deeper, a soldier swims and the water bleeds them.
        self.assertEqual(body["wade"], 1.35)

    def test_the_walk_test_wades_and_does_not_swim(self) -> None:
        # The bed 1 m down (half a metre of water over it) is walked; 2.2 m
        # down (1.7 m of water) and beyond is not, though each step down the
        # shelf is a small one and the ray that finds it starts under water.
        self.assertEqual(self.out["channel"], {"shallows": "walk", "swim": "none", "across": "none"})

    def test_a_door_is_a_way_and_a_slit_is_not(self) -> None:
        self.assertEqual((self.out["way"]["door"], self.out["way"]["slit"]), ("walk", "none"))

    def test_a_step_is_walked_and_a_kerb_takes_a_jump(self) -> None:
        self.assertEqual((self.out["way"]["step"], self.out["way"]["kerb"]), ("walk", "jump"))

    def test_a_ledge_is_walked_off_and_not_back_and_a_long_fall_is_no_way(self) -> None:
        way = self.out["way"]
        self.assertEqual((way["ledge"], way["ledgeBack"], way["cliff"]), ("walk", "none", "none"))

    def test_terrain_the_page_reads_as_steep_refuses_the_step_up_only(self) -> None:
        self.assertEqual(self.out["refused"], ["none", "walk"])

    def test_spawns_and_flags_are_placed_on_the_walked_ground(self) -> None:
        facts = self.out["walkFacts"]
        self.assertEqual(facts["spawns"], {"a1": True, "b1": True, "in": False, "hut": False})
        self.assertEqual(facts["regions"], 2)
        # reachable, walked ground inside the ring, the pole's height over the ground it stands over
        self.assertEqual(facts["flags"]["Mid"], [True, True, 0])
        # 4.2 m up with a 5 m radius: a soldier within 2.7 m of the pole's foot is inside the ring.
        self.assertEqual(facts["flags"]["Pole"], [True, True, 4.2])
        self.assertEqual(facts["flags"]["Tower"], [False, False, 0])
        self.assertEqual(facts["flags"]["Patch"], [False, True, 0])

    def test_a_capped_floods_unfinished_grounds_are_joined_through_the_walk_map(self) -> None:
        capped = self.out["cappedFlood"]
        self.assertTrue(capped["capped"])
        self.assertEqual(capped["apart"], 3)
        self.assertEqual(capped["joined"], 1)
        self.assertTrue(capped["sidesMeet"])
        # The room with no door is ground the flood finished: the map's free cells do not open it.
        self.assertEqual(capped["usable"], {"a1": True, "b1": True, "in": False})
        self.assertEqual([capped["splitJoined"], capped["splitMeet"]], [0, False])
        self.assertEqual([capped["wholeCapped"], capped["wholeJoined"], capped["wholeMeet"]], [False, 0, True])

    def test_two_floors_over_each_other_are_stacked(self) -> None:
        self.assertEqual(self.out["stacked"], {"stacked": True, "share": True, "over": 3.3, "unreachable": True})
        self.assertFalse(self.out["walkFacts"]["stacked"])


class WalkMapTests(unittest.TestCase):
    """`sim/botgen.mjs prepareWalkMap` and the search-map writer."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.walk = cls.out["walkMap"]

    def test_a_pocket_with_a_way_out_has_the_ways_cells_opened(self) -> None:
        ways = {w["who"]: w for w in self.walk["ways"]}
        self.assertEqual(self.walk["source"], "engine")
        self.assertEqual((ways["hut"]["way"], ways["Patch"]["way"]), ("walk", "walk"))
        self.assertGreater(ways["hut"]["opened"], 0)
        self.assertEqual(self.walk["opened"], ways["hut"]["opened"] + ways["Patch"]["opened"])
        self.assertTrue(self.walk["openedWereBlocked"])
        self.assertTrue(self.walk["after"]["spawns"]["hut"])
        self.assertEqual(self.walk["after"]["flags"]["Patch"], [True, True, 0])

    def test_a_sealed_pocket_is_left_shut_and_its_spawn_kept_from_bots(self) -> None:
        ways = {w["who"]: w for w in self.walk["ways"]}
        self.assertEqual(ways["in"], {"who": "in", "kind": "spawn", "way": "none", "opened": 0})
        self.assertFalse(self.walk["after"]["spawns"]["in"])
        self.assertEqual(self.walk["excluded"], ["in"])

    def test_a_flag_no_soldier_on_walkable_ground_stands_inside_is_unreachable(self) -> None:
        self.assertEqual(self.walk["reach"], {"Mid": False, "Pole": False, "Tower": True, "Patch": False})

    def test_the_order_position_is_a_cell_whose_soldier_is_inside_the_ring(self) -> None:
        near, far, none = self.out["order"]
        self.assertEqual(near, [30.5, -20.5])
        # 4 m from the pole's foot is outside the 2.7 m ring: the cell of the nearest place inside it instead.
        self.assertNotEqual(far, [34.5, -20.5])
        self.assertLessEqual(((far[0] - 30) ** 2 + (far[1] + 20) ** 2) ** 0.5, 2.8)
        self.assertIsNone(none)

    def test_a_second_run_puts_the_engines_map_back_first_and_opens_the_same_cells(self) -> None:
        self.assertTrue(self.walk["sameAgain"])

    def test_a_map_that_holds_none_of_the_ground_is_painted_from_the_main_ground(self) -> None:
        painted = self.out["painted"]
        self.assertEqual(painted["source"], "walk test")
        self.assertEqual((painted["street"], painted["room"], painted["wall"]), (0, 1, 1))
        self.assertEqual(painted["usable"], {"a1": True, "b1": True, "in": False, "hut": True})
        self.assertTrue(painted["cover"])
        # What the engine's map held is kept for the record: nothing here, most of it for the map that was kept.
        self.assertEqual(painted["engineCover"], 0)
        self.assertTrue(painted["keptCover"])

    def test_a_painted_vehicle_map_takes_the_widest_brush_that_keeps_the_level_whole(self) -> None:
        # A 4 m street between two yards: at DICE's 3 m the far flag is on
        # another piece of the map; the widest brush that joins both flags
        # and both spawners is taken, and the layer's script declares it.
        v = self.out["vehicleMap"]
        self.assertEqual(v["tried"][0][:2], [3, 1])
        self.assertLess(v["brush"], 3)
        self.assertEqual([t[1] for t in v["tried"] if t[0] == v["brush"]], [2])
        # No wider brush tried did as well.
        self.assertTrue(all(t[1] < 2 for t in v["tried"] if t[0] > v["brush"]))
        self.assertTrue(v["street"])
        self.assertEqual(v["wall"], 1)
        self.assertEqual(v["con"], [True, True])
        # Open ground keeps DICE's 3 m.
        self.assertEqual((v["openBrush"], v["openFlags"]), (3, 2))

    def test_a_hull_is_given_its_own_order_position(self) -> None:
        con = self.out["hullCon"]
        self.assertIn("aiStrategicArea.setOrderPosition Tank 202.5/204.5", con)
        self.assertLess(con.index("setOrderPosition Tank 202.5/204.5"), con.index("setOrderPosition Infantry 200.5/204.5"))
        # Not asked for, not written: an on-foot level's script is as it was.
        self.assertNotIn("setOrderPosition Tank", self.out["con"])

    def test_a_painted_cell_is_free_only_when_a_body_stands_at_its_centre(self) -> None:
        # Half of a cell's fine cells is not enough: the route runs through
        # the centre, so the four fine cells about it must all be walked.
        rule = self.out["paintRule"]
        self.assertEqual((rule["whole"], rule["mostWithCentre"]), (0, 0))
        self.assertEqual((rule["halfNoCentre"], rule["few"], rule["empty"]), (1, 1, 1))

    def test_the_writer_gives_back_the_engines_own_bytes(self) -> None:
        codec = self.out["codec"]
        self.assertEqual(codec["same"], [True, True, True])
        # A pixel of the next level is blocked when any of its four children is.
        self.assertEqual(codec["coarser"], [True, True])

    def test_levels_one_and_two_are_rebuilt_from_level_zero(self) -> None:
        codec = self.out["codec"]
        self.assertEqual(codec["pyramid"], [[0, 256, 1], [1, 128, 1], [2, 64, 1]])
        self.assertTrue(codec["reads"])
        self.assertEqual(codec["parents"], [True, True, False])


class DeadLevelLintTests(unittest.TestCase):
    """The lint's prediction of a level nobody fights on, and the census row that checks it."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.lint = cls.out["deadLint"]

    def test_a_sound_level_predicts_nothing(self) -> None:
        self.assertEqual(self.lint["sound"], {"dead": [], "checks": [], "texts": []})

    def test_a_side_with_no_spawn_that_reaches_a_flag_it_must_take_is_an_error(self) -> None:
        self.assertEqual(self.lint["sealed"]["dead"], ["sealed"])
        self.assertIn("side 1 has no spawn with a route to any flag it must take", self.lint["sealed"]["texts"][0])
        self.assertEqual(self.lint["noSpawn"]["dead"], ["no-spawn"])
        self.assertEqual(self.lint["noRoute"]["dead"], ["no-route"])

    def test_no_capturable_flag_reachable_in_3d_is_an_error(self) -> None:
        self.assertIn("no-flag", self.lint["noFlag"]["dead"])
        self.assertTrue(any("no capturable flag is reachable in 3D" in t for t in self.lint["noFlag"]["texts"]))
        self.assertTrue(any("the pole is 9 m above the ground it stands over" in t for t in self.lint["noFlag"]["texts"]))

    def test_a_sealed_side_on_a_level_with_ladders_is_told_nobody_climbs_them(self) -> None:
        self.assertIn("the level places 3 ladders, which neither the walk test nor a bot climbs", self.out["ladderText"])

    def test_spawns_on_ground_the_page_refuses_to_climb_are_an_error(self) -> None:
        self.assertEqual(self.lint["refused"]["dead"], ["refused"])

    def test_stacked_floors_are_an_error_that_shuts_the_gate_and_not_a_prediction(self) -> None:
        self.assertEqual(self.lint["stacked"]["checks"], ["floors"])
        self.assertEqual(self.lint["stacked"]["dead"], [])
        self.assertIn("stacked floors (40 %", self.lint["stacked"]["texts"][0])

    def test_a_flag_the_generator_excluded_is_not_an_error(self) -> None:
        self.assertEqual(self.lint["excluded"], 0)

    def test_the_census_row_says_whether_the_lint_saw_a_dead_level_coming(self) -> None:
        lively, sealed, missed = self.out["census"]["rows"]
        # level, alive, failed alive checks, predicted classes, lint agrees, kills, spawns off, flags off, floors
        self.assertEqual(lively, ["lively", True, [], [], True, [3, 4], 0, 0, "one"])
        self.assertEqual(sealed, ["sealed", False, ["bothSidesKill", "ticketsBleed"], ["sealed"], True, [0, 0], 1, 0, "one"])
        self.assertEqual(missed[:5], ["missed", False, ["bothSidesKill"], [], False])
        self.assertEqual(self.out["census"]["table"], 4)

    def test_a_level_the_lint_refuses_is_unsuitable_with_no_match_run(self) -> None:
        u = self.out["unsuitable"]
        self.assertIsNone(u["sound"])
        self.assertEqual([u["verdict"], u["outcome"], u["predictedDead"]], ["fail", "unsuitable", ["sealed"]])
        self.assertGreaterEqual(u["errors"], 1)
        self.assertEqual(u["sizes"], {})
        # Never an outcome a layer may be accepted at.
        self.assertFalse(u["acceptable"])

        self.assertEqual(self.out["alive"], ["botErrors"])


class WalkableRefusalTests(unittest.TestCase):
    """README 22: four ways the lint refused a level a soldier walks."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_spawn_sides_are_the_pages_and_carriers_that_stand_at_the_start_count(self) -> None:
        sides = self.out["spawnSides"]
        # A neutral point's group the spawn manager gives a side, and a group no point claims.
        self.assertEqual(sides["m1"], [2, False, False])
        self.assertEqual(sides["line1"], [2, False, False])
        self.assertEqual(sides["v1"], [1, False, False])
        # A spawn the page offers nobody is kept as a start of the flood, on no side.
        self.assertEqual(sides["stray"], [0, False, False])
        # A spawner with a side and no point stands; one filed under a point the other side holds does not.
        self.assertEqual(sides["bunker:b"], [1, True, False])
        self.assertIn("bunker:b#2", sides)
        self.assertIn("townaxis:x", sides)
        self.assertNotIn("townallied:t", sides)
        # A landing craft that seats whoever spawns on it.
        self.assertEqual(sides["lcvp:d"], [2, True, True])

    def test_a_side_that_starts_at_sea_is_told_so(self) -> None:
        text = " ".join(self.out["atSea"])
        self.assertIn("side 2 has no spawn with a route", text)
        self.assertIn("the side starts at sea or in its vehicles", text)
        self.assertIn("1 start at sea", text)
        self.assertIn("1 seat their soldier in a vehicle", text)

    def test_a_spawn_that_drops_onto_the_main_ground_serves_and_a_cliff_does_not(self) -> None:
        ledge, cliff = self.out["oneWay"]["ledge"], self.out["oneWay"]["cliff"]
        self.assertEqual((ledge["onMain"], ledge["exit"], ledge["serves"], ledge["excluded"]), (False, "drop", True, []))
        self.assertEqual((cliff["exit"], cliff["serves"], cliff["excluded"]), (None, False, ["up"]))

    def test_a_capped_flood_seeds_a_flag_beside_its_pole(self) -> None:
        f = self.out["flagSeeds"]
        self.assertLess(f["poleCells"], 10)          # a start inside the pole stays there
        self.assertEqual(f["seeds"], 5)              # the pole and four beside it
        self.assertTrue(f["capped"] and f["poleOnlyCapped"])
        self.assertFalse(f["poleOnlyReachable"])
        self.assertTrue(f["reachable"])

    def test_a_capped_levels_painter_map_is_kept_with_its_ways_opened(self) -> None:
        m = self.out["painterMap"]
        self.assertTrue(m["keptCover"])
        self.assertEqual(m["paintedSource"], "walk test")
        self.assertEqual(m["keptSource"], "engine")
        self.assertIn(["hut", "walk", True], m["keptWays"])
        self.assertIn(["in", "none", False], m["keptWays"])

    def test_a_spawn_within_the_pages_start_resolve_serves(self) -> None:
        r = self.out["resolve"]
        self.assertFalse(r["usable"])
        self.assertGreater(r["resolved"], 3)
        self.assertLessEqual(r["resolved"], 20)
        self.assertTrue(r["serves"])


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

    def test_a_failing_layer_is_classed_against_the_level_with_no_layer(self) -> None:
        o = self.out["outcomes"]
        self.assertEqual([o["pass"], o["better"], o["noBetter"]], ["pass", "better-than-nothing", "no-better-than-nothing"])

    def test_a_level_nobody_fights_on_is_never_better_than_nothing(self) -> None:
        dead = self.out["outcomes"]["noFight"]
        self.assertEqual(dead["outcome"], "no-fight")
        self.assertEqual(dead["dead"], ["8:bothSidesKill"])
        # The comparison alone would have called it better: every movement rate fell.
        self.assertTrue(dead["versusNothing"]["better"])

    def test_a_no_layer_level_nobody_fights_on_sets_no_standard_for_spawn_traps(self) -> None:
        # Nobody dies there, so nobody dies at a spawn: its zero is left out
        # of the comparison and named. Against a no-layer arm that fights,
        # the same rise counts as worse.
        dead, live = self.out["versusDead"]["dead"], self.out["versusDead"]["live"]
        self.assertTrue(dead["better"])
        self.assertEqual(dead["detail"]["8"]["worsened"], [])
        self.assertEqual(dead["detail"]["8"]["notCompared"], ["spawnTrapsPerBotMinute"])
        self.assertFalse(live["better"])
        self.assertEqual(live["detail"]["8"]["worsened"], ["spawnTrapsPerBotMinute"])
        self.assertNotIn("notCompared", live["detail"]["8"])

    def test_a_fight_where_the_level_with_no_layer_has_none_is_better_than_nothing(self) -> None:
        # DC_Basrah_Nights: with no layer nobody kills and nobody moves, so
        # nobody is stuck. A layer that brings a fight and captures is not
        # "worse" for the stuck time of bots that now walk.
        fight = self.out["versusStill"]["fight"]
        self.assertTrue(fight["better"])
        self.assertIs(fight["detail"]["8"]["fightOnlyWithLayer"], True)
        self.assertIn("stuckSecondsPerBotMinute", fight["detail"]["8"]["worsened"])
        # It still has to capture at least as much...
        fewer = self.out["versusStill"]["fewerCaptures"]
        self.assertFalse(fewer["better"])
        self.assertEqual(fewer["detail"]["8"]["captures"], [1, 3])
        # ...and to have a fight of its own.
        neither = self.out["versusStill"]["noFightEither"]
        self.assertFalse(neither["better"])
        self.assertNotIn("fightOnlyWithLayer", neither["detail"]["8"])

    def test_a_layer_that_fails_fewer_of_the_bars_checks_is_better_than_nothing(self) -> None:
        quiet = self.out["versusQuiet"]
        by = quiet["byTheBar"]["detail"]["8"]
        self.assertLess(by["barChecksFailed"][0], by["barChecksFailed"][1])
        self.assertIs(by["fewerFailed"], True)
        self.assertTrue(quiet["byTheBar"]["better"])
        # The movement rates alone call the same pair worse.
        self.assertIn("stuckSecondsPerBotMinute", by["worsened"])
        self.assertFalse(quiet["noBar"]["better"])
        # As many failed as the level with no layer is not fewer.
        self.assertFalse(quiet["noFewer"]["better"])
        self.assertNotIn("fewerFailed", quiet["noFewer"]["detail"]["8"])

    def test_the_owner_may_accept_a_layer_called_no_better_than_nothing(self) -> None:
        own = self.out["ownerAcceptance"]
        self.assertIn("the owner may", own["refusedWithout"])
        self.assertEqual((own["by"], own["outcome"]), ("owner", "no-better-than-nothing"))
        # Since the rollout the owner may also put up a level the runner calls no fight; never an unsuitable one.
        self.assertEqual(own["noFight"], "no-fight")
        self.assertIn("unsuitable", own["unsuitable"])
        self.assertEqual(own["stacked"], "owner")
        self.assertIn("lint errors", own["stackedNotOwner"])
        self.assertIn("lint errors", own["sealed"])
        # It stands at the outcome accepted, and goes when the level gets worse.
        self.assertEqual(own["carried"], "owner")
        self.assertEqual(own["worse"], "now no-fight")
        # It also stands when the level rises, or newly fails a check of a rebuilt bar: the page guards those.
        self.assertEqual(own["better"], "owner")
        self.assertEqual(own["alsoFails"], ["8:madeUpCheck"])
        # An ordinary acceptance still does not survive a fall to no better.
        self.assertEqual(own["ordinaryDoesNotCarry"], "now no-better-than-nothing")

    def test_an_acceptance_is_recorded_only_for_a_layer_better_than_nothing(self) -> None:
        a = self.out["accept"]
        self.assertEqual(a["taken"], {"reason": "one check short", "date": "2026-11-10",
                                      "outcome": "better-than-nothing", "failed": ["16:redeploysPerBotMinute"]})
        self.assertTrue(a["cleared"])
        # No reason, a pass, no better than nothing, a lint error: each refused.
        self.assertEqual(a["refused"], [True, True, True, True])

    def test_an_acceptance_survives_a_rerun_only_while_the_result_is_no_worse(self) -> None:
        a = self.out["accept"]
        self.assertEqual(a["carried"], "one check short")
        self.assertEqual(a["improved"], "one check short")
        self.assertFalse(a["passDrops"])
        self.assertNotIn("accepted", a["worse"])
        self.assertEqual(a["worse"]["acceptanceWithdrawn"]["because"], "now also fails 8:stuckSecondsPerBotMinute")
        self.assertEqual(a["noBetter"], "now no-better-than-nothing")
        self.assertNotIn("accepted", a["none"])
        self.assertNotIn("acceptanceWithdrawn", a["none"])


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

    def test_a_level_that_places_vehicles_opens_only_on_a_verdict_with_them(self) -> None:
        # The marker says what the level places (generator 4 on). Above none,
        # a pass or an acceptance of on-foot matches does not open the layer.
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "bf1942" / "shigaisen_b"
            shutil.copytree(LAYERS / "bf1942" / "shigaisen_b", folder)
            marker = json.loads((folder / "generated.json").read_text())
            verdict = folder / "verdict.json"
            env = {k: v for k, v in os.environ.items() if not k.startswith("BOT_LAYERS_")}
            with mock.patch.dict(os.environ, env, clear=True):
                (folder / "generated.json").write_text(json.dumps({**marker, "objectSpawners": 8}))
                verdict.write_text(json.dumps({"verdict": "pass", "config": "on foot"}))
                ok, why = ai_level.generated_layer_gate(folder)
                self.assertFalse(ok)
                self.assertIn("places 8 vehicles and guns", why)
                verdict.write_text(json.dumps({"verdict": "fail", "accepted": {"reason": "owner played it"}}))
                self.assertFalse(ai_level.generated_layer_gate(folder)[0])
                verdict.write_text(json.dumps({"verdict": "pass", "config": "with vehicles"}))
                self.assertEqual(ai_level.generated_layer_gate(folder), (True, "pass"))
                verdict.write_text(json.dumps({"verdict": "fail", "config": "with vehicles"}))
                self.assertFalse(ai_level.generated_layer_gate(folder)[0])
                # A level that places nothing is judged on foot, as before.
                (folder / "generated.json").write_text(json.dumps({**marker, "objectSpawners": 0}))
                verdict.write_text(json.dumps({"verdict": "pass", "config": "on foot"}))
                self.assertEqual(ai_level.generated_layer_gate(folder), (True, "pass"))
                # A marker older than the count asks for nothing.
                (folder / "generated.json").write_text(json.dumps({k: v for k, v in marker.items() if k != "objectSpawners"}))
                self.assertEqual(ai_level.generated_layer_gate(folder), (True, "pass"))

    def test_a_scratch_run_points_the_bake_at_layers_outside_the_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copytree(LAYERS / "bf1942" / "shigaisen_b", Path(tmp) / "bf1942" / "a_scratch_level")
            self.assertIsNone(ai_level.generated_layer_dir("bf1942", "a_scratch_level"))
            with mock.patch.dict(os.environ, {"BOT_LAYERS_ROOT": tmp}):
                self.assertEqual(ai_level.generated_layer_dir("bf1942", "A_Scratch_Level"), Path(tmp) / "bf1942" / "a_scratch_level")

    def test_the_walk_tests_edit_of_the_map_is_marked_in_short(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "bf1942" / "shigaisen_b"
            shutil.copytree(LAYERS / "bf1942" / "shigaisen_b", folder)
            marker = json.loads((folder / "generated.json").read_text())
            marker["walkMap"] = {"source": "walk test", "opened": [[1, 2], [3, 4]], "ways": [], "floors": {"stacked": False}}
            (folder / "generated.json").write_text(json.dumps(marker))
            with mock.patch.dict(os.environ, {"BOT_LAYERS_UNVERIFIED": "1"}):
                ai = ai_level.load_generated_ai("bf1942", "shigaisen_B", Path(tmp))
            self.assertEqual(ai.generated["walkMap"], {"source": "walk test", "opened": 2, "stacked": False})

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
