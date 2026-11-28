"""The medic bag's and the wrench's charge, the bar beside their icon that
empties while the pack works and fills again on its own (ledger SUP-34,
`viewer/pack-charge.js`), in the replay (`replay-hud.js`), on the HUD
(`soldier-hud.js` `writeSoldierAmmo`) and for the bots (`bot-referee.js`).

Retail, read on lnxded:

* `BFSoldier::handleMessage`'s Fire branch runs the pack's use only above
  `trunc(reloadTime)` (0x08277714 / 0x0827778a), and passes the pull on to
  the pack unless the use did nothing (0x08277730).
* `FireArms::Fire`'s `magType 1` branch takes `trunc(roundOfFire)` off a
  charge above 0, floored at 0, and sets no fire timer (0x0828aa05).
* `FireArms::handleUpdate` gives back `trunc(reloadTime)` an update
  (0x08288fc8), capped at `magSize`; `HandFireArms::enable` pays a holstered
  pack `trunc(away x reloadTime x 30)` (0x08293cb7).
* A server recording's `am`: a medic's 1800 reads 1791 the tick after a use.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "pack_charge_harness.mjs"


class PackChargeTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS), str(ROOT)], capture_output=True,
                              text=True, timeout=120, cwd=ROOT)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    # --- the law -------------------------------------------------------------

    def test_the_two_packs_are_magtype_1_and_a_rifle_is_not(self) -> None:
        spec = self.r["spec"]
        self.assertEqual({"cap": 1800, "cost": 10, "regen": 1, "raiseRate": 45, "floor": 1}, spec["med"])
        self.assertEqual({"cap": 3000, "cost": 10, "regen": 1, "raiseRate": 33, "floor": 1}, spec["wrench"])
        self.assertIsNone(spec["rifle"])

    def test_one_use_and_one_tick_is_the_server_recordings_1791(self) -> None:
        self.assertEqual(1791, self.r["law"]["oneUse"])

    def test_a_working_pack_empties_in_seconds_and_stays_empty_while_held(self) -> None:
        law = self.r["law"]
        # 1800 at -270 a second: the last use that heals is at 6.67 s, and
        # from then the pull at the floor keeps it at the floor.
        self.assertEqual(6.67, law["medHeld"]["lastWorked"])
        self.assertEqual(1, law["medHeld"]["charge"])
        self.assertEqual(11.13, law["wrenchHeld"]["lastWorked"])

    def test_a_pack_waved_at_nobody_costs_nothing(self) -> None:
        self.assertEqual({"charge": 1800, "worked": 0, "lastWorked": None}, self.r["law"]["medIdle"])

    def test_it_refills_a_unit_a_tick_in_the_hand_and_faster_holstered(self) -> None:
        law = self.r["law"]
        self.assertEqual(60, law["medRefill"])
        self.assertEqual(100, law["wrenchRefill"])
        self.assertEqual(450, law["raisedAfter10"])

    def test_a_pull_at_the_floor_does_nothing_but_still_spends_it(self) -> None:
        self.assertFalse(self.r["law"]["floorPull"])
        self.assertEqual(0, self.r["law"]["floorAfter"])

    # --- the replay ----------------------------------------------------------

    def test_the_replay_reads_the_pack_in_hand_and_its_use_off_the_torso(self) -> None:
        self.assertEqual([[0, 2, False, False], [2, 3, True, False], [3, 13, True, True],
                          [13, 20, True, False], [20, 40, False, False], [40, None, True, False]],
                         self.r["replay"]["spans"])

    def test_a_seat_holsters_the_pack_whatever_his_last_torso_state_says(self) -> None:
        self.assertEqual([[0, 2, False, False], [2, 3, True, False], [3, 5, True, True], [5, 8, False, False],
                          [8, 13, True, True], [13, 20, True, False], [20, 40, False, False], [40, None, True, False]],
                         self.r["seated"])

    def test_the_replay_drains_refills_and_pays_the_holster(self) -> None:
        rp = self.r["replay"]
        self.assertEqual(1800, rp["before"])
        # Ten seconds of use: empty.
        self.assertEqual(2, rp["afterUse"])
        # Two seconds of it healing somebody: 60 uses, 300 ticks.
        self.assertEqual(1800 - 600 + 301, rp["afterTwoSeconds"])
        # Seven seconds in the hand after: +210.
        self.assertEqual(211, rp["afterRest"])
        # Twenty seconds holstered: +900 on the raise, and the tick after it.
        self.assertEqual(211 + 900 + 2, rp["raised"])
        self.assertEqual(1531, rp["refilled"])

    def test_a_pull_works_when_someone_in_reach_or_he_gains_hit_points(self) -> None:
        self.assertEqual({"near": True, "far": False, "self": True, "none": False}, self.r["worked"])
        self.assertEqual([1], self.r["gains"])

    # --- the HUD -------------------------------------------------------------

    def test_both_bars_are_fed_their_charge_and_the_pack_has_no_spare_box(self) -> None:
        hud = self.r["hud"]
        self.assertEqual({"Ammo/AmmoType": 6, "Ammo/PrimaryAmmo": 900, "Ammo/MaxPrimaryAmmo": 1800,
                          "Ammo/SoldierAmmo/SoldierAmmoHasMag": False}, hud["med"])
        self.assertEqual({"Ammo/AmmoType": 4, "Ammo/PrimaryAmmo": 2970, "Ammo/MaxPrimaryAmmo": 3000,
                          "Ammo/SoldierAmmo/SoldierAmmoHasMag": False}, hud["wrench"])
        self.assertEqual(1, hud["rifle"]["Ammo/AmmoType"])
        self.assertTrue(hud["rifle"]["Ammo/SoldierAmmo/SoldierAmmoHasMag"])

    # --- the bots ------------------------------------------------------------

    def test_a_bots_pack_pulls_every_tick_and_pays_only_for_work(self) -> None:
        bot = self.r["bot"]
        self.assertTrue(bot["charged"])
        self.assertEqual(1800, bot["idle"])
        self.assertEqual(1800 - 300 + 29, bot["working"])
        # The report and the arms keep the bag's own 10 a second.
        self.assertEqual(20, bot["reports"])
        self.assertEqual(1701, bot["afterTick"])
        self.assertFalse(bot["dryReady"])
        self.assertEqual(451, bot["raised"])


if __name__ == "__main__":
    unittest.main()
