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
        # Three guns' worth each, and the mould the pool grows from.
        self.assertEqual({"Flak18/36mobilestatic": 4, "Flak18/36mobile": 4}, pool["byTemplate"])
        self.assertTrue(pool["hidden"])

    def test_a_servers_unplaced_hulls_are_parked(self) -> None:
        # A server's Stukas on a level that places none: two of them and the
        # mould. Its BF109s the level already places, so nothing is loaded.
        pool = self.out["serverPool"]
        self.assertEqual(["Stuka"], pool["loads"])
        self.assertEqual({"Stuka": 3}, pool["byTemplate"])
        self.assertEqual(1, pool["moulds"])

    def test_the_pool_grows_when_every_node_is_out(self) -> None:
        # Four rounds, one parked node: the pool grows by its bound (two
        # here), each clone under an owner id of its own with its body.
        grow = self.out["grow"]
        self.assertEqual(3, grow["stood"])
        self.assertEqual(2, grow["grown"])
        self.assertEqual([True, True], grow["emptyOwners"])
        self.assertEqual(2, grow["adopted"])

    def test_a_kit_is_laid_as_a_pads_kit_until_it_is_taken(self) -> None:
        # SPAWN-15: never enabled, it lies until taken; the slot frees then.
        kit = self.out["kit"]
        self.assertEqual(1, kit["first"])
        self.assertEqual(1, kit["whileLying"])
        self.assertEqual(2, kit["afterTaken"])
        self.assertEqual(0, kit["nodes"])
        self.assertEqual("German_FortificationMg34NoMine", kit["kit"])
        self.assertEqual([10, 5.2, 10], kit["at"])
        self.assertAlmostEqual(-90.0, kit["yawDeg"], places=3)
        self.assertEqual(0, kit["unknownLaid"])

    def test_an_object_that_draws_nothing_is_its_logic_node(self) -> None:
        pool = self.out["logicPool"]
        # No glb asked for it; its own spawner's object is followed.
        self.assertEqual(["IconPCO"], pool["loads"])
        self.assertEqual(2, pool["count"])
        self.assertEqual(1, pool["moulds"])
        self.assertEqual("PlayerControlObject", pool["kind"])
        self.assertEqual(800, pool["hp"])
        self.assertEqual(0, pool["meshes"])

    def test_a_logic_object_works_its_depot_and_runs_its_spawner(self) -> None:
        stand = self.out["logicStand"]
        self.assertEqual(1, stand["depots"])
        self.assertIs(False, stand["depotGoneWhileStanding"])
        # At the object (spawner plus its world offset) plus the depot's place.
        self.assertEqual([40, 2.5, 41], stand["depotAt"])
        # Its own spawner runs as a round's while it stands.
        self.assertEqual(2, stand["roundsWhileStanding"])

    def test_a_round_gone_inside_one_tick_still_runs_its_spawner_once(self) -> None:
        # The towing tractors' killer rounds live 0.05..0.1 s; the spawner is
        # built with the round (0x08312910) and stands on its first frame.
        short = self.out["shortLived"]
        self.assertEqual({"stood": 1, "after": 1, "rounds": 0},
                         {k: short[k] for k in ("stood", "after", "rounds")})

    def test_the_hold_carries_the_offset_and_team_on_vehicle_stamps(self) -> None:
        # `handleFrameUpdate` 0x083138c0 adds +0x150..+0x158 to the hold's
        # translation; `spawnObject` 0x083140a0 calls `setTeam(team)` when
        # template+0x185 is set (SEAT-27).
        stand = self.out["logicStand"]
        self.assertEqual([[0, 0, 1]], stand["held"])
        self.assertEqual([1], stand["stamps"])



@unittest.skipUnless(shutil.which("node"), "node is not installed")
class LaunchCountTests(unittest.TestCase):
    """FHX-30: a round that strikes a wall within a frame is gone from
    `state().rounds` before a check samples it; the page counts every
    spawner round launched and every object stood since the level loaded."""

    def test_a_round_gone_inside_one_tick_is_still_counted(self) -> None:
        result = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True,
                                timeout=120, check=True)
        short = json.loads(result.stdout.strip().splitlines()[-1])["shortLived"]
        self.assertEqual(0, short["rounds"])
        self.assertEqual(1, short["launched"])
        self.assertEqual(1, short["stoodCount"])
        # Each standing carries its serial: a node the pool hands out again
        # after its last object was destroyed is a new standing (pakfront).
        self.assertEqual(1, short["serial"])


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class DeployRoleTests(unittest.TestCase):
    """FHX-30: which seat drops a deploy round, and whether a killer it drops is
    lethal to the hull by the material table (`round-spawners.js` `deployRole`)."""

    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True,
                                timeout=120, check=True)
        cls.roles = json.loads(result.stdout.strip().splitlines()[-1])["roles"]

    def test_a_dropped_round_that_stands_a_drawn_gun_deploys(self) -> None:
        self.assertTrue(self.roles["deployRound"]["deploys"])

    def test_the_mobile_guns_killer_is_lethal_to_its_own_gun(self) -> None:
        # 613 against 32 is 999x of damage 10, at the charge's own spot.
        self.assertAlmostEqual(9990.0, self.roles["flakKillerOnGun"]["killerHp"])

    def test_the_tractors_rehook_killer_spares_the_tractor(self) -> None:
        # 613 has no cell against the tractor's 34: DMG-1, no damage.
        self.assertEqual(0, self.roles["rehookOnTractor"]["killerHp"])
        self.assertGreater(self.roles["rehookOnTowedGun"]["killerHp"], 1000)
        # Its spawner stands a logic object, which deploys nothing.
        self.assertFalse(self.roles["rehookOnTractor"]["deploys"])

    def test_shot_rounds_and_logic_objects_are_no_deploy(self) -> None:
        # An AP shell's PenetrateExplosion leaves at 800 m/s, an AA shell
        # bursts 4 km out, a mine's spawner stands an undrawn icon.
        self.assertFalse(self.roles["apShell"]["deploys"])
        self.assertEqual(0, self.roles["flakShell"]["killerHp"])
        self.assertFalse(self.roles["mine"]["deploys"])
        # A bomb rack drops at 0 m/s, but its PenetrateExplosion is held.
        self.assertFalse(self.roles["bombRack"]["deploys"])


if __name__ == "__main__":
    unittest.main()
