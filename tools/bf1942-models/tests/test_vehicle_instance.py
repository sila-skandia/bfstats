"""One vehicle instance per hull (`viewer/vehicle-instance.js`).

A bot drives a Sherman and the human takes its gunner's seat: both hold a
seat of ONE instance, which owns the one drivetrain. What used to happen was
two `VehicleOccupancy` objects and two drives on one node -- the bot's
integrated, the human's idle one wrote the node, and on exit the hull
teleported (features/vehicle-instance-refactor/README.md).

Driven headless by `vehicle_instance_harness.mjs` with the real `World` and a
stub drivetrain, on `test_world.py`'s module set.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_world  # noqa: E402  (the module set and the harness runner)

HARNESS = Path(__file__).resolve().parent / "vehicle_instance_harness.mjs"


def run_harness() -> dict:
    original_harness = test_world.HARNESS
    original_modules = dict(test_world.MODULES)
    test_world.HARNESS = HARNESS
    test_world.MODULES["vehicle-instance.js"] = test_world.VIEWER / "vehicle-instance.js"
    # `mannedByEnemy`, the bots' side of the entry rule, and its one import.
    test_world.MODULES["bot-vehicle.js"] = test_world.VIEWER / "bot-vehicle.js"
    test_world.MODULES["bot-behaviours.js"] = test_world.VIEWER / "bot-behaviours.js"
    try:
        return test_world.run_harness()
    finally:
        test_world.HARNESS = original_harness
        test_world.MODULES.clear()
        test_world.MODULES.update(original_modules)


class VehicleInstanceTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_first_driver_builds_and_adopts_the_one_drive(self) -> None:
        r = self.results["botSeat"]
        self.assertEqual(r["seatId"], "Sherman")
        self.assertTrue(r["isRoot"])
        self.assertTrue(r["drive"])
        self.assertEqual(r["built"], 1)
        self.assertEqual(r["log"], ["thaw", "adopt"])

    def test_a_second_occupant_joins_the_same_hull(self) -> None:
        r = self.results["humanSeat"]
        self.assertEqual(r["seatId"], "shermanBrowning_PCO1")
        self.assertTrue(r["sameInstance"])
        self.assertTrue(r["sameDrive"])
        self.assertEqual(r["built"], 1, "no second drive for the gunner")
        self.assertTrue(r["worldVehicle"])
        self.assertTrue(r["humanTurret"] and r["botTurret"] and r["turretsDiffer"])
        self.assertIsNone(r["heldSeat"], "a held seat refuses")

    def test_the_drive_integrates_once_a_tick_from_the_root_seat(self) -> None:
        r = self.results["ticks"]
        self.assertEqual(r["integrations"], 30)
        self.assertEqual(r["lastThrottle"], 1)
        self.assertGreater(r["moved"], 9)

    def test_the_gunner_word_never_reaches_the_drive(self) -> None:
        self.assertEqual(self.results["gunnerThrottle"], 0)

    def test_a_held_seat_refuses_a_switch(self) -> None:
        self.assertIsNone(self.results["switchHeld"])

    def test_one_occupant_leaving_keeps_the_hull_driven(self) -> None:
        r = self.results["humanLeft"]
        self.assertFalse(r["emptied"])
        self.assertEqual(r["log"], [], "no release, no freeze while the driver stays")
        self.assertEqual(r["botStill"], "Sherman")
        self.assertTrue(r["driveKept"])
        self.assertTrue(r["worldCleared"])

    def test_a_seat_swap_keeps_the_drive_and_releases_the_controls(self) -> None:
        r = self.results["swap"]
        self.assertEqual(r["seatId"], "shermanBrowning_PCO1")
        self.assertTrue(r["sameDrive"])
        self.assertEqual(r["throttleReleased"], 0)
        self.assertEqual(r["stepped"], 1, "a hull nobody drives still coasts")
        self.assertEqual(r["built"], 1)
        self.assertIsNone(r["rootHolder"])

    def test_the_last_one_out_parks_the_hull(self) -> None:
        r = self.results["lastOut"]
        self.assertTrue(r["emptied"])
        self.assertEqual(r["log"], ["release", "freeze"])
        self.assertEqual(r["transformed"], 1)
        self.assertTrue(r["forgotten"])

    def test_the_last_one_out_puts_the_wheels_back_at_rest(self) -> None:
        # The next drive reads its axles off these nodes; a lifted wheel left
        # there sank the Sherman 0.14 m on every boarding after the first.
        r = self.results["lastOut"]
        self.assertAlmostEqual(r["wheelY"], -0.68, places=6)
        self.assertAlmostEqual(r["wheelTurned"], 1.0, places=6)

    def test_a_gunner_alone_rides_a_parked_hull_until_someone_drives(self) -> None:
        self.assertFalse(self.results["gunnerAlone"]["drive"])
        r = self.results["driverArrives"]
        self.assertTrue(r["drive"])
        self.assertTrue(r["gunnerSeesIt"])
        self.assertEqual(r["built"], 2)


class HullTeamTests(unittest.TestCase):
    """The entry rule (ledger SEAT-26/27): a hull is its crew's side and an
    empty one nobody's. `GameServer::toggleEntryPoint` (lnxded 0x0814f13d)
    lets a player in only when the root PCO's team is 0 or his own, and
    every occupant stamps his team on it (`PlayerControlObject::enter`
    0x0831714d) until the last one out clears it (`clearTeam` 0x0831a610).
    The owner's report: an enemy bot climbed into the T-34 he was driving."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_an_empty_hull_is_nobodys_and_its_driver_stamps_his_side(self) -> None:
        r = self.results["team"]
        self.assertEqual(r["emptyTeam"], 0)
        self.assertTrue(r["allyDrives"])
        self.assertEqual(r["crewedTeam"], 2)

    def test_the_enemy_is_refused_a_free_seat_of_a_crewed_hull(self) -> None:
        r = self.results["team"]
        self.assertFalse(r["axisIntoGunner"])
        self.assertFalse(r["axisSeated"])
        self.assertEqual(r["seatsAfterRefusal"], {"Sherman": "ally"})

    def test_a_friend_takes_the_free_seat(self) -> None:
        self.assertTrue(self.results["team"]["friendIntoGunner"])

    def test_a_hull_crewed_only_by_its_gunner_is_still_barred(self) -> None:
        r = self.results["team"]
        self.assertEqual(r["teamWithGunnerOnly"], 2)
        self.assertFalse(r["axisIntoFreeWheel"])

    def test_the_last_one_out_clears_the_team_and_the_enemy_may_steal_it(self) -> None:
        r = self.results["team"]
        self.assertEqual(r["emptiedTeam"], {"emptied": True, "team": 0})
        self.assertTrue(r["axisSteals"])
        self.assertEqual(r["stolenTeam"], 1)
        self.assertFalse(r["allyIntoStolen"], "the stolen hull is now the Axis crew's")

    def test_a_player_with_no_side_passes_and_stamps_nothing(self) -> None:
        r = self.results["team"]
        self.assertTrue(r["ghostIntoGunner"])
        self.assertEqual(r["teamAfterGhost"], 1)

    def test_a_refusal_leaves_the_player_where_he_sits(self) -> None:
        r = self.results["team"]
        self.assertFalse(r["refusedFromAnotherHull"])
        self.assertTrue(r["stillInOther"])

    def test_a_seat_switch_inside_his_own_hull_takes_no_rule(self) -> None:
        self.assertEqual(self.results["team"]["axisSwitchesInOwnHull"], "shermanBrowning_PCO1")

    def test_the_rule_and_the_bots_filter(self) -> None:
        r = self.results["teamRule"]
        # hull team, player team: none, none, own, other, other, no side, both none.
        self.assertEqual(r["mayEnterHull"], [True, True, True, False, False, True, True])
        # `BBChange::isMannedByEnemy` 0x0855fcb0: an enemy crew, a friendly one,
        # an empty hull, a bot with no side, a candidate with no team field.
        self.assertEqual(r["mannedByEnemy"], [True, False, False, False, False])


if __name__ == "__main__":
    unittest.main()
