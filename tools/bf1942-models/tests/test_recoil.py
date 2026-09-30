"""The hand weapon's recoil and its return (`viewer/recoil.js`), driven through the
world's own soldier tick by `recoil_harness.mjs`.

Ledger FA-2..FA-5. `setGoBackOnRecoil 1` was extracted and never read, so DC's
pistols, the Tabuk and the Remington, and vanilla's Colt, K98, Garand, MP40 and
Thompson climbed a full kick a shot for good. The engine arms a 20-tick ride
per shot (8 without goBack) that `handlePlayerInput` spends on the mouse-look
axes through `recoilTabel` / `recoilTabel2`: 0.75 of the drawn kick over eight
ticks and, with goBack, exactly that back over the next twelve.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "recoil_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class RecoilRideTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_the_tables_kick_three_quarters_and_the_go_back_one_returns_it(self) -> None:
        self.assertEqual({"goBackKick": -0.75, "goBackReturn": 0.75, "goBackAll": 0,
                          "kickOnly": -0.75, "goBackTicks": 20, "kickTicks": 8}, self.r["tables"])

    def test_calc_recoil_reads_the_templates_words_and_defaults(self) -> None:
        # No `setHasRecoilForce`: nothing drawn, a ride in progress untouched.
        self.assertEqual({"armed": False, "count": 5, "pitch": 9}, self.r["noForce"])
        # goBack defaults on; an absent up is a fixed 1.0, an absent left-right 0.
        self.assertEqual({"count": 20, "pitch": 1, "yaw": 0, "goBack": True}, self.r["defaults"])
        self.assertEqual({"count": 8, "pitch": 0.3, "yaw": 0, "goBack": False}, self.r["noGoBack"])

    def test_a_go_back_shot_springs_back_to_the_aim_it_left(self) -> None:
        tabuk = self.r["tabukOne"]
        # The Tabuk's 1.2: up 0.9 at the eighth tick, back to 0 at the twentieth.
        self.assertEqual(0.9, max(tabuk["pitch"]))
        self.assertEqual(7, tabuk["pitch"].index(0.9))
        self.assertEqual(0, tabuk["pitch"][19])
        self.assertEqual(0, tabuk["yaw"][19])
        # Its left-right rides the x3 yaw gain: -0.1 draws 0.225 degrees at the peak.
        self.assertEqual(-0.225, min(tabuk["yaw"]))
        remington = self.r["remingtonOne"]
        self.assertEqual(1.5, max(remington["pitch"]))
        self.assertEqual(0, remington["pitch"][-1])

    def test_six_pistol_shots_a_ride_apart_leave_the_aim_where_it_was(self) -> None:
        m9 = self.r["m9Slow"]
        self.assertEqual(0, m9["pitch"][-1])
        self.assertEqual(0, m9["yaw"][-1])
        self.assertEqual(0.375, max(m9["pitch"]))

    def test_shots_inside_the_ride_drop_the_rest_of_its_return(self) -> None:
        # Six M9 rounds 0.2 s apart: each restarts the ride before it has
        # come back, so the aim climbs -- by 1.775 degrees, not six whole kicks (3.0).
        self.assertEqual(1.775, self.r["m9Fast"]["pitch"][-1])

    def test_a_weapon_without_go_back_keeps_its_kick(self) -> None:
        # Ten AK-47 rounds a round per three ticks: 0.49 of 0.3 a round, the
        # last one's whole 0.75.
        self.assertEqual(1.548, self.r["akBurst"]["pitch"][-1])

    def test_no_recoil_force_no_kick(self) -> None:
        self.assertEqual(0, max(self.r["gp30"]["pitch"]))

    def test_the_stances_dev_mod_scales_the_ride(self) -> None:
        self.assertEqual(0.45, max(self.r["crouched"]["pitch"]))
        self.assertEqual(0, self.r["crouched"]["pitch"][-1])

    def test_the_ride_and_the_players_own_hand_share_one_axis(self) -> None:
        # Pulling down through the kick: the ride still nets to zero, and the
        # view ends where the hand alone would have put it.
        self.assertEqual(self.r["mouseAlone"]["pitch"][-1], self.r["againstMouse"]["pitch"][-1])
        self.assertGreater(max(self.r["againstMouse"]["pitch"]), 0.5)

    def test_the_profile_kicks_for_eight_ticks_and_returns_for_twelve(self) -> None:
        profile = self.r["profile"]
        self.assertTrue(all(v < 0 for v in profile[:8]))
        self.assertTrue(all(v > 0 for v in profile[8:20]))
        self.assertEqual([0, 0], profile[20:])


if __name__ == "__main__":
    unittest.main()
