"""`viewer/round-spawners.js` and `level-statics.js` `loadRoundSpawnPool`
under node (`round_spawners_harness.mjs`): a round's ObjectSpawner stands its
object on the pad law's clock, where the engine's `spawnObject` puts it, once
per `nrOfObjectToSpawn`, held back by the 2 m clearance, and the level parks
nodes enough for every gun that can throw it."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "round_spawners_harness.mjs"


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class RoundSpawnersTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        env = dict(os.environ)
        result = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True,
                                timeout=120, env=env, check=True)
        cls.out = json.loads(result.stdout.strip().splitlines()[-1])

    def test_the_deploy_round_stands_the_static_at_four_seconds_once(self) -> None:
        deploy = self.out["deploy"]
        # `spawnDelayAtStart 1` draws the 4 s window at the round's birth.
        self.assertEqual(0, deploy["before"])
        self.assertEqual(1, deploy["after"])
        self.assertEqual(1, deploy["live"])
        # `nrOfObjectToSpawn 1` is spent.
        self.assertEqual(0, deploy["nrToSpawn"])

    def test_it_stands_at_the_spawner_turned_as_the_round(self) -> None:
        deploy = self.out["deploy"]
        self.assertEqual(deploy["expect"], deploy["at"])
        self.assertAlmostEqual(30.0, deploy["yawDeg"], places=3)

    def test_what_it_stood_outlives_the_round(self) -> None:
        deploy = self.out["deploy"]
        self.assertEqual(0, deploy["roundsAfterEnd"])
        self.assertEqual(1, deploy["stillStanding"])

    def test_a_human_on_the_point_holds_it_back(self) -> None:
        # `createObjectOnAllClients` 0x08133a10 (SPAWN-14).
        self.assertEqual({"held": 0, "afterStepAway": 1}, self.out["clearance"])

    def test_no_free_node_stands_nothing(self) -> None:
        self.assertEqual(1, self.out["exhausted"]["stood"])

    def test_the_abandon_clock_bills_one_a_second_with_the_spawner_gone(self) -> None:
        # SPAWN-13: `TimeToLive 600`, then the step unscaled (no spawner).
        abandon = self.out["abandon"]
        self.assertEqual(99, abandon["hpAt600"])
        self.assertAlmostEqual(89.0, abandon["hpAt610"], delta=1.0)

    def test_a_destroyed_object_frees_its_node(self) -> None:
        self.assertEqual({"live": 0, "standing": 0}, self.out["freed"])

    def test_the_pool_follows_the_spawned_models_guns(self) -> None:
        pool = self.out["pool"]
        self.assertEqual(["Flak18/36mobilestatic", "Flak18/36mobile"], pool["loads"])
        self.assertEqual({"Flak18/36mobilestatic": 3, "Flak18/36mobile": 3}, pool["byTemplate"])
        self.assertTrue(pool["hidden"])


if __name__ == "__main__":
    unittest.main()
