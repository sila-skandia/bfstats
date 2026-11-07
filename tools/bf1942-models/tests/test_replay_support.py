"""A replay's heals, flags and magazines from a server recording.

The server recorder writes (features/server-replay-recorder, sweep entries
13, 15 and 11 of features/replay-feature-sweep-2026-11-01):

  - `heal`: a visit of a medic (BFSoldier::useMedPack), an engineer
    (useRepairPack) or a depot (SupplyDepot::healSoldier / repairVehicle),
    one record as it starts and one with `end` once a second passed without
    a heal (SUP-15). The viewer keeps one visit each (`rec.heals`), writes a
    log row a visit, and the board's SUPPORT view counts them
    (`viewer/replay-support.js`).
  - `flagHolder`: FlagHolderEvent 0x1E, a flag taken or let go (CTF-2, CTF-3);
    a client's file has it as `raw` type 30. `viewer/replay-ctf.js` works out
    where each flag is from the holds, the pick-up, capture and return scores
    and the deaths (CTF-2..CTF-5).
  - `am`: the magazines of the weapon in a soldier's hands, FireArms::mags
    (FA-8, FA-12); `viewer/replay-hud.js` `recordedAmmoAt` gives them for the
    item he holds.

Harness: `tests/replay_support_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "replay_support_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class ReplaySupportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_nothing_is_skipped(self) -> None:
        self.assertEqual(self.r["skipped"], 0)

    def test_a_visit_runs_from_its_first_heal_to_its_last(self) -> None:
        self.assertEqual(self.r["heals"], [
            ["medpack", 5, 6, 901, None, 10, 11.4],
            ["medpack", 5, 5, 900, None, 13, 13.2],
            ["repair", 7, None, 810, None, 20, 24],
            ["depot", None, 6, 901, 820, 30, 30],
            # never ended in the file: open to its end (Infinity)
            ["medpack", 5, 6, 901, None, 40, None],
        ])
        self.assertEqual(self.r["open"], [901])

    def test_one_log_row_a_visit(self) -> None:
        self.assertEqual(self.r["rows"], [
            "Medic healed Patient", "Medic healed themselves", "Engineer repaired a vehicle",
            "Patient healed at a depot", "Medic healed Patient"])

    def test_the_support_board(self) -> None:
        # pid, name, heals, self, repairs, healed, depot
        self.assertEqual(self.r["support"], [
            [5, "Medic", 2, 1, 0, 0, 0], [7, "Engineer", 0, 0, 1, 0, 0], [6, "Patient", 0, 0, 0, 3, 1]])
        self.assertEqual(self.r["supportEarly"], [[5, 1, 1], [6, 0, 0]])

    def test_the_servers_magazines_for_the_item_in_his_hands(self) -> None:
        a = self.r["ammo"]
        self.assertIsNone(a[0])
        self.assertEqual(a[1], {"rounds": 30, "mags": 2, "reserve": 60, "item": 1})
        self.assertEqual(a[2]["rounds"], 29)
        self.assertIsNone(a[3], "another item in his hands: the count is not that weapon's")
        self.assertEqual(self.r["ammoUnlimited"], [{"t": 2, "mag": 7, "reserve": -1, "spares": -1, "item": 2}])

    def test_the_flag_rows(self) -> None:
        self.assertEqual(self.r["holds"], [[50.02, 8, 1], [60, 8, 0], [70, 8, 1], [90, 8, 0]])
        # The take is the score's row; the capture's drop is no row of its own.
        self.assertEqual(self.r["ctfRows"], [
            "50 Thief stole the flag", "60 Thief dropped the flag", "65 Patient returned the flag",
            "70 Thief stole the flag", "90.03 Thief captured the flag"])
        self.assertEqual(self.r["client"], [[5, 3, 1], [9, 3, 0]])

    def test_where_each_flag_is(self) -> None:
        c = self.r["ctf"]
        home1, home2 = [1, True, None, [0, 10, 0]], [2, True, None, [500, 10, 0]]
        self.assertEqual(c["40"], [home1, home2])
        self.assertEqual(c["55"], [[1, False, 8, [108, 20, 55]], home2])
        # dropped where he fell, 1.5 m over the ground (CTF-5)
        self.assertEqual(c["62"], [[1, False, None, [108, 6.5, 60]], home2])
        self.assertEqual(c["62.5"], c["62"])
        self.assertEqual(c["66"], [home1, home2], "returned")
        self.assertEqual(c["80"], [[1, False, 8, [108, 20, 80]], home2])
        self.assertEqual(c["95"], [home1, home2], "captured: home")
        self.assertEqual(self.r["dropAgesOut"], [[1, True], [2, True]], "TimeToReSpawn ran out")


if __name__ == "__main__":
    unittest.main()
