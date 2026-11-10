"""What a land or air hull's own spawner holds is an object of its own, held
on the hull (ledger AI-121, SPAWN-30, SPAWN-35), with seats of its own
(`viewer/spawned-craft.js` `hullHeldCraftUnder`,
`tests/hull_held_craft_harness.mjs`). BF1918's Kolossal carries its MG
platform and commander that way (five of its twelve crew positions), the
Zeppelin L30 its two gondola gunners; before, neither the hull's seat row nor
any vehicle of their own took them. The armoured train's cars, stood without
a hold, are vehicles of their own too, kept where they were stood on the
locomotive until the page can push them by their couplers
(features/bf1918-armoured-train)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "hull_held_craft_harness.mjs"


class HullHeldCraftTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        r = json.loads(proc.stdout)
        cls.s = r["synthetic"]
        cls.real = r["real"]

    def test_a_land_and_an_air_hulls_held_objects_are_split_off(self) -> None:
        self.assertEqual(["Boat", "Car", "Gunner", "Platform"], self.s["moved"])
        self.assertEqual("spawners", self.s["parent"]["platform"])
        self.assertEqual("spawners", self.s["parent"]["gunner"])

    def test_the_hull_is_the_holds_host(self) -> None:
        self.assertEqual({"platform": "Tank", "gunner": "Airship"}, self.s["hostOf"])
        self.assertTrue(self.s["onHull"])
        self.assertFalse(self.s["released"])

    def test_split_off_where_it_was_baked_and_it_rides_the_hull(self) -> None:
        self.assertEqual(self.s["before"], self.s["after"])
        # The hull moved to (140, 52, -180) and turned back to north: the
        # platform's 3 m forward and 0.5 m up go with it.
        self.assertEqual([140, 52.5, -177], self.s["rides"])

    def test_its_seats_are_its_own_not_the_hulls(self) -> None:
        self.assertEqual(["Tank"], self.s["hullSeats"])
        self.assertEqual(["Platform", "PlatformMg1", "PlatformMg2"], self.s["platformSeats"])
        self.assertEqual([0, 1, 1], self.s["platformDoors"])

    def test_a_held_object_with_no_door_stays_on_its_hull(self) -> None:
        # FHSW's attitude indicator: a map mark of its hull's.
        self.assertEqual("Tank", self.s["parent"]["ball"])

    def test_a_car_stood_without_a_hold_is_kept_where_it_was_stood(self) -> None:
        self.assertEqual("spawners", self.s["parent"]["car"])
        self.assertEqual({"platform": False, "car": True, "carHost": "Tank"}, self.s["stood"])

    def test_a_held_coupler_with_no_door_stays_on_its_hull(self) -> None:
        self.assertEqual("Tank", self.s["parent"]["coupler"])

    def test_a_ships_held_land_vehicle_stays_baked(self) -> None:
        self.assertEqual("Ship", self.s["parent"]["jeep"])

    def test_on_the_hold_it_stands_with_its_hull(self) -> None:
        self.assertEqual({"up": True, "down": False}, self.s["active"])
        self.assertTrue(self.s["activeLetGo"])
        self.assertIsNone(self.s["notHeld"])

    def test_the_kolossals_platform_has_five_seats(self) -> None:
        k = self.real["kolossal"]
        if k is None:
            self.skipTest("no bf1918 tree")
        self.assertEqual(7, k["hullSeats"])
        self.assertEqual(1, len(k["split"]))
        self.assertTrue(k["split"][0]["host"])
        self.assertEqual(["KolossalMgGunnerExtra1", "KolossalMgGunnerExtra2", "KolossalMgGunnerExtra3",
                          "KolossalMgGunnerExtra4", "KolossalCommander"], k["split"][0]["seats"])

    def test_the_zeppelins_two_gondola_gunners(self) -> None:
        z = self.real["zeppelin"]
        if z is None:
            self.skipTest("no bf1918 tree")
        self.assertEqual(6, z["hullSeats"])
        self.assertEqual([["ZeppelinL30GunnerZusatz2"]] * 2, [c["seats"] for c in z["split"]])

    def test_the_armoured_trains_three_cars_and_their_fifteen_seats(self) -> None:
        t = self.real["train"]
        if t is None:
            self.skipTest("no bf1918 tree")
        self.assertEqual(["ArmouredTrain_GunCarF", "ArmouredTrain_InfantryCarF", "ArmouredTrain_InfantryCarR"],
                         sorted(c["name"] for c in t["split"]))
        self.assertEqual(15, sum(len(c["seats"]) for c in t["split"]))
        self.assertTrue(all(c["host"] for c in t["split"]))
        self.assertEqual(1, t["hullSeats"])

    def test_the_b29s_attitude_indicator_is_not_split_off(self) -> None:
        b = self.real["b29"]
        if b is None:
            self.skipTest("no fhsw tree")
        self.assertEqual([], b["split"])
        self.assertEqual(b["rowBefore"], b["hullSeats"])


if __name__ == "__main__":
    unittest.main()
