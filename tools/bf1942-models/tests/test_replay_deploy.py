"""The spawn screen of a dead followed player in a replay.

A server recording's `spawnPick` (the server recorder's SpawnRequest and
AIPlayer hooks) is the group and kit a player chose on the spawn screen.
While the followed player waits to spawn, in his first person, the replay
opens the page's own deploy screen read-only: his side's rings, his pick
(kept across lives, as retail's map keeps its selection, SPAWNGRP-12), his
kit row and the TIME TO SPAWN plate counting to his next spawn. With no
pick, the ring and kit are read off where and with what he next spawned
(features/replay-feature-sweep-2026-11-01, entry 14).

Run under node through `replay_deploy_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_deploy_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayDeployTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_spawn_picks_parse(self) -> None:
        self.assertEqual(self.results["skipped"], 0)
        self.assertEqual(self.results["picks"], [
            {"t": 10.5, "pid": 5, "group": 5, "kit": 3}, {"t": 10.6, "pid": 5, "group": 0, "kit": 3}])

    def test_nothing_while_he_is_alive(self) -> None:
        self.assertIsNone(self.results["alive"])

    def test_before_his_pick_the_ring_is_where_he_spawned(self) -> None:
        dead = self.results["dead"]
        self.assertEqual(dead["source"], "spawned")
        self.assertIsNone(dead["group"])
        self.assertEqual(dead["spawnAt"][0::2], [100, 200])
        self.assertEqual((dead["countdown"], dead["since"]), (10, 10))

    def test_his_pick_names_the_group_and_kit_row(self) -> None:
        picked = self.results["picked"]
        self.assertEqual((picked["source"], picked["group"], picked["kit"], picked["kitRow"]),
                         ("recorded", 5, "medic", 3))
        self.assertEqual(picked["countdown"], 5)

    def test_a_pick_stands_into_the_next_life_and_a_clear_does_not_undo_it(self) -> None:
        kept = self.results["kept"]
        self.assertEqual((kept["group"], kept["kit"], kept["since"]), (5, "medic", 30))
        self.assertEqual(self.results["lastPick"], [None, 5])

    def test_a_player_without_picks_or_kit(self) -> None:
        bravo = self.results["bravo"]
        self.assertEqual((bravo["team"], bravo["source"], bravo["kit"]), (1, "spawned", None))

    def test_kit_rows_from_the_levels_slots_then_the_class(self) -> None:
        self.assertEqual(self.results["rows"], [1, 0, 0, 3, None, None])

    def test_the_presenter_shows_in_first_person_until_escape(self) -> None:
        presenter = self.results["presenter"]
        self.assertEqual(presenter["frames"], [
            ["orbit, dead", False], ["pov, dead", True], ["same second", True], ["next second", True],
            ["escape", False], ["same wait", False], ["alive", False], ["next wait", True]])
        # One show a change (the countdown's second), none for the same frame.
        self.assertEqual(presenter["calls"], [["show", 5, 5], ["show", 5, 4], ["hide"], ["show", 5, 5], ["hide"]])


if __name__ == "__main__":
    unittest.main()
