"""`viewer/seat-dots.js` under node: the six seat-occupancy dot states.

The engine's own table (VHUD-2, `BfOccupiedVehicleData`'s vtable
`0x0093f300` read as raw bytes) is 0 blank, 1 local, 2 empty, 3 friend,
4 enemy. This pins which live state a seat resolves to: the local player's
own seat, a named occupant's team against the local team, or nobody.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("seat_dots_harness.mjs")
MODULES = {"seat-dots.js": VIEWER / "seat-dots.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SeatDotStateTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_icon_table_is_the_engine_s_five_entries(self) -> None:
        self.assertEqual(
            {"slots": 6, "blank": 0, "local": 1, "empty": 2,
             "friend": 3, "enemy": 4},
            self.results["constants"])

    def test_an_unoccupied_vehicle_is_all_empty_dots(self) -> None:
        self.assertEqual([2, 2, 2, 2, 2, 2], self.results["allEmpty"])
        self.assertEqual([2, 2, 2, 2, 2, 2], self.results["noLocalNoOccupants"])

    def test_the_local_seat_is_the_local_dot(self) -> None:
        self.assertEqual([1, 2, 2, 2, 2, 2], self.results["localAtRoot"])

    def test_a_same_team_occupant_is_the_friend_dot(self) -> None:
        self.assertEqual([1, 2, 3, 2, 2, 2], self.results["friendAtTwo"])

    def test_an_other_team_occupant_is_the_enemy_dot(self) -> None:
        self.assertEqual([1, 2, 2, 2, 4, 2], self.results["enemyAtFour"])

    def test_a_full_crew_reads_local_empty_friend_empty_enemy_empty_friend(self) -> None:
        self.assertEqual([1, 3, 2, 4, 2, 3], self.results["mixedCrew"])

    def test_the_local_seat_beats_an_occupant_row_on_the_same_seat(self) -> None:
        # The row names seat 2 with the other team; the local player is in
        # seat 2, so the dot is local, not enemy.
        self.assertEqual([2, 2, 1, 2, 2, 2], self.results["localWinsTie"])

    def test_two_rows_on_one_seat_settle_on_the_first(self) -> None:
        # Seat 3 is claimed by both teams; the first row (team 1, the local
        # team) wins, so the dot is friend, not enemy.
        self.assertEqual([2, 2, 2, 3, 2, 2], self.results["firstOccupantWins"])

    def test_a_seat_with_no_position_is_blank_even_when_occupied(self) -> None:
        dots = self.results["unplacedIsBlank"]
        self.assertEqual([0, 1, 0, 2, 0, 0], [d["state"] for d in dots])
        self.assertEqual([None, None], [dots[2]["x"], dots[2]["y"]])
        self.assertEqual([None, None], [dots[4]["x"], dots[4]["y"]])
        # The placed seats still carry their own positions.
        self.assertEqual([40.0, 65.0], [dots[1]["x"], dots[1]["y"]])

    def test_an_unplaced_local_seat_draws_nothing(self) -> None:
        self.assertEqual([0, 3, 2, 0, 0, 0], self.results["localUnplaced"])

    def test_seats_past_the_declared_set_are_blank_not_empty(self) -> None:
        self.assertEqual([1, 2, 2, 0, 0, 0], self.results["fewerThanSix"])

    def test_team_zero_against_team_zero_is_the_same_team(self) -> None:
        self.assertEqual([2, 3, 2, 2, 2, 2], self.results["zeroTeamMatchesZero"])

    def test_positions_ride_along_and_are_null_where_unplaced(self) -> None:
        self.assertEqual(
            [[39.0, 75.0], [None, None], [30.0, 59.0],
             [None, None], [None, None], [None, None]],
            self.results["positions"])


if __name__ == "__main__":
    unittest.main()
