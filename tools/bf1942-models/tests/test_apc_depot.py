"""A half-track's own supply depot: who it serves, and from where.

The owner's report: mounting the back of an APC reloads and heals you, and in
our implementation it did nothing. Two measurements were wrong, both against
retail's `SupplyDepot::workOnSoldiers` (lnxded 0x08323dc0, ledger SUP-5,
SUP-20, SUP-23, PHY-10, SEAT-37):

- A man on foot was measured from his feet. Retail measures to the soldier's
  `getAbsolutePosition` (0x08323e67), his object origin, which stands 1.0 m over
  his feet (PHY-10). The M3A1's locker is 1.36 m over the ground, radius 1.3:
  a soldier on the ground under it was out of reach by his feet and in it by
  his origin.
- A man in a seat was measured from the hull's origin. He is the SeatObject's
  child (SEAT-37), so he stands at the seat. Hanomag's locker (radius 1.4) is
  1.46 m from the hull's origin, so no rider was ever served; from the seats it
  is 0.55 to 1.32 m. The radius is cut to the rear seats: the driver and the
  gunner are outside it.

`apc_depot_harness.mjs` drives the real `supply.js` and `world-fields.js`.
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
HARNESS = Path(__file__).resolve().parent / "apc_depot_harness.mjs"
MODULES = ("supply.js", "fire-state.js", "world-fields.js", "deviation.js")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ApcDepotTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_soldiers_origin_is_a_metre_over_his_feet(self) -> None:
        self.assertEqual(self.results["originOverFeet"], 1.0)

    def test_a_man_on_the_ground_at_the_back_is_served(self) -> None:
        r = self.results["m3a1Standing"]
        # 4 hit points a second from 10: full (30) well inside 10 s.
        self.assertEqual(r["hp"], 30)
        self.assertGreater(r["gives"], 0)

    def test_two_metres_further_back_he_is_not(self) -> None:
        r = self.results["m3a1TooFar"]
        self.assertEqual(r["hp"], 10)
        self.assertEqual(r["gives"], 0)

    def test_every_rear_seat_of_both_half_tracks_is_in_reach(self) -> None:
        for name, radius in (("m3a1", 1.3), ("hanomag", 1.4)):
            for seat in self.results[name]["rear"]:
                self.assertLessEqual(seat["seatReach"], radius, name)
                self.assertGreater(seat["hp"], 10, name)
                self.assertGreater(seat["gives"], 0, name)

    def test_hanomags_hull_origin_is_out_of_reach_so_the_seat_decides(self) -> None:
        # The bug: from the origin the Hanomag's locker is 1.46 m off.
        self.assertGreater(self.results["hanomag"]["originReach"], 1.4)

    def test_the_driver_and_the_gunner_are_not_served(self) -> None:
        for name in ("m3a1", "hanomag"):
            self.assertEqual(self.results[name]["gunner"], {"hp": 10, "gives": 0}, name)
        self.assertEqual(self.results["m3a1"]["driver"], {"hp": 10, "gives": 0})

    def test_the_retail_rates(self) -> None:
        r = self.results["rates"]
        # `setHealth -1 4.0 0`: 4 hit points a second, 2 a 0.5 s cycle: from 2
        # to 22 in 5 s (ten cycles).
        self.assertAlmostEqual(r["hp"], 22, delta=2.01)
        # `addAmmoType 1 -1 15 0`: 15 a second, so 7 or 8 whole units a cycle;
        # `2 -1 1.2 0`: a unit every 0.83 s, so 0 or 1 a cycle.
        self.assertTrue(all(u in (7, 8) for u in r["units"] if u), r["units"])
        self.assertGreaterEqual(sum(r["units"]), 70)
        self.assertTrue(all(u in (0, 1) for u in r["pouch"]))

    def test_the_locker_rides_the_hull(self) -> None:
        r = self.results["moving"]
        self.assertGreater(r["before"], 5)
        self.assertGreater(r["after"], r["before"] + 3)
        self.assertAlmostEqual(r["depotAt"][0], 140, delta=0.01)
        self.assertAlmostEqual(r["depotAt"][2], 91.1, delta=0.01)

    def test_the_heal_and_reload_icons_follow_the_seat(self) -> None:
        icons = self.results["icons"]
        self.assertEqual(icons["rearSeat"], {"repair": False, "heal": True, "reload": True})
        self.assertEqual(icons["gunnerSeat"], {"repair": False, "heal": False, "reload": False})
        # Without a seat object the hull's origin is the soldier (1.46 m).
        self.assertFalse(icons["hullOriginOnly"]["heal"])


class WiringTests(unittest.TestCase):
    """The same depot pass runs on every path that has the mechanic."""

    def test_the_headless_runner_gives_its_world_the_levels_depots(self) -> None:
        stage = (ROOT / "sim" / "stage.mjs").read_text()
        env = (ROOT / "sim" / "env.mjs").read_text()
        self.assertIn("collectSupplyDepots", env)
        self.assertIn("world.setSupplyDepots(S.collectSupplyDepots(root", stage)

    def test_the_room_and_the_page_collect_them_too(self) -> None:
        self.assertIn("world.setSupplyDepots(collectSupplyDepots(root",
                      (ROOT / "server" / "level-data.mjs").read_text())
        self.assertIn("level.world.setSupplyDepots(collectSupplyDepots(level.currentRoot))",
                      (VIEWER / "level-load.js").read_text())

    def test_a_riders_distance_is_taken_from_the_seat_object(self) -> None:
        fields = (VIEWER / "world-fields.js").read_text()
        self.assertIn("seatBodyAt(player.occupancy", fields)
        self.assertIn("seatObjects?.[0]", fields)
        self.assertIn("seat?.seatObjects?.[0]", (VIEWER / "vehicle-hud.js").read_text())


if __name__ == "__main__":
    unittest.main()
