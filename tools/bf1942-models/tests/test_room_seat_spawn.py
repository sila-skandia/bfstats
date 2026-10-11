"""A spawn into a vehicle's seat in a room, and the arm a held craft rides.

Ledger FHR-10 (features/fh-mod-extraction/MECHANICS.md, sections 1 and 2).
A `setEnterOnSpawn 1` point seats its player, and FH's flying spawn hangs
such a point on a Hellcat that a static's spawner holds on a turning arm.
On the page alone that worked; in a room the server put its copy of the
player on the point, on foot, and never turned the arm at all.

`room_seat_spawn_harness.mjs` drives the room's core with virtual peers:

* the arm's angle is the world's tick time through the level's own keys
  (`viewer/held-arm.js`, `World.tickTime`), so the server and every page
  stand it at one angle for one tick;
* the spawn row names the seat point, the server puts the player on it, and
  the seat row that follows seats him the way any seat is taken;
* a seat the server will not give is said so (`spawnRefused`,
  `seatRefused`), so the page's prediction is undone;
* on FH's Tarawa, when that tree is extracted: the Hellcat is a table entry
  of its own, held on its arm with and without a pilot, and let go at
  rest when the throttle opens (SPAWN-23: a static root's tangent speed is zero);
* and the same level built the page's way (the match runner's stage, which
  is `hull-bodies.js` and the registry under node) holds the craft in the
  same place at the same tick as the room's, and lets it go on the same one.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "room_seat_spawn_harness.mjs"

# 7 deg/s on a 140 m arm.
ARM_SPEED = 140 * 7 * 3.141592653589793 / 180


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class RoomSeatSpawnTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS), str(VIEWER)],
                              capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    def part(self, name: str) -> dict:
        if name not in self.r:
            self.skipTest(f"{name}: its assets are not in this tree")
        return self.r[name]

    # --- the arm -------------------------------------------------------------

    def test_the_arm_stands_where_the_time_says(self) -> None:
        arm = self.r["arm"]
        self.assertLess(arm["at10"], 1e-3)
        self.assertLess(arm["wrapped"], 1e-3)
        self.assertLess(arm["negative"], 1e-3)
        self.assertAlmostEqual(ARM_SPEED, arm["speed"], delta=0.02)

    def test_two_trees_at_one_time_agree(self) -> None:
        arm = self.r["arm"]
        self.assertEqual(0, arm["apart"])
        self.assertGreater(arm["moved"], 10)

    def test_the_world_names_its_ticks(self) -> None:
        clock = self.r["clock"]
        self.assertEqual(90, clock["ticks"])
        self.assertAlmostEqual(3.0, clock["alone"])
        # A page in a room adds the server's lead, which may be a fraction.
        self.assertAlmostEqual(1000.5 / 30, clock["followed"])

    # --- the seat spawn ------------------------------------------------------

    def test_a_seat_spawn_seats_the_player_on_the_server(self) -> None:
        first = self.part("seat")["first"]
        self.assertTrue(first["enterOnly"])
        self.assertEqual({"template": "Willy", "seat": 0}, first["seat"])
        self.assertTrue(first["drives"])
        self.assertTrue(first["alive"])
        self.assertEqual([40, 40], [first["onPoint"][0], first["onPoint"][2]])
        # And the others are told, by the rows any spawn and any seat send.
        self.assertEqual({"seated": True, "vehicleId": first["vehicleId"], "seatIndex": 0}, first["wire"])
        self.assertEqual(1, first["spawnRows"])
        self.assertEqual(1, first["seatEnterRows"])

    def test_a_taken_seat_refuses_the_spawn_and_the_seat(self) -> None:
        seat = self.part("seat")
        second = seat["second"]
        self.assertEqual(1, second["spawnRefused"])
        self.assertEqual([seat["first"]["vehicleId"]], second["seatRefused"])
        self.assertIsNone(second["seat"])
        self.assertFalse(second["revived"])
        self.assertEqual(0, second["leaked"])

    def test_the_seat_is_given_once_it_is_free(self) -> None:
        third = self.part("seat")["third"]
        self.assertIsNone(third["first"])
        self.assertEqual({"template": "Willy", "seat": 0}, third["seat"])
        self.assertTrue(third["drives"])
        self.assertEqual(1, third["seatRefused"])

    def test_a_row_naming_no_point_seats_nobody(self) -> None:
        unnamed = self.part("seat")["unnamed"]
        self.assertIsNone(unnamed["seat"])
        self.assertEqual(0, unnamed["spawnRows"])

    # --- FH's Tarawa ---------------------------------------------------------

    def test_the_held_craft_is_a_vehicle_of_the_room(self) -> None:
        table = self.part("tarawa")["table"]
        self.assertEqual("air", table["hellcatKind"])
        self.assertIsNotNone(table["hellcatNode"])
        self.assertEqual(table["hellcatNode"], table["wire"]["node"])
        self.assertEqual(["Piper_Cub", "F6F_Hellcat"], table["held"])
        self.assertAlmostEqual(140, table["radius"], places=3)
        self.assertEqual(5, table["keys"])
        self.assertAlmostEqual(360 / 7, table["turn"], places=4)

    def test_a_carried_point_is_not_a_second_hull(self) -> None:
        table = self.part("tarawa")["table"]
        self.assertEqual(1, table["fletchers"])
        self.assertEqual(8, table["lvts"])

    def test_the_servers_arm_turns_with_its_ticks(self) -> None:
        tarawa = self.part("tarawa")
        parked = tarawa["parked"]
        self.assertEqual(parked["roomTick"], parked["tick"])
        self.assertLess(parked["startErr"], 1e-3)
        self.assertLess(parked["err"], 1e-3)
        # Three seconds at 7 deg/s, on the 140 m circle 300 m up.
        self.assertAlmostEqual(21, parked["turned"], delta=0.01)
        self.assertAlmostEqual(140, parked["radius"], delta=0.01)
        self.assertAlmostEqual(300, parked["height"], delta=0.01)
        # A second room of the level is on its own time and moves nobody else's.
        self.assertLess(tarawa["other"]["err"], 1e-3)
        self.assertLess(tarawa["other"]["firstStill"], 1e-3)

    def test_a_spawn_into_the_hellcat_seats_its_pilot_on_the_arm(self) -> None:
        tarawa = self.part("tarawa")
        seated = tarawa["seated"]
        self.assertTrue(seated["onHellcat"])
        self.assertEqual(0, seated["seat"])
        self.assertTrue(seated["drives"])
        self.assertEqual("air", seated["kind"])
        # Put on the point where the arm has it now, not where it was baked.
        self.assertLess(seated["pointErr"], 0.01)
        self.assertGreater(seated["bakedErr"], 10)
        held = tarawa["held"]
        self.assertFalse(held["released"])
        self.assertLess(held["err"], 1e-3)
        self.assertAlmostEqual(0.0, held["speed"], delta=0.05)
        wire = held["wire"]
        self.assertTrue(wire["seated"])
        self.assertEqual(tarawa["table"]["wire"]["id"], wire["vehicleId"])
        self.assertEqual(0, wire["seatIndex"])
        self.assertTrue(wire["occupied"])
        self.assertLess(wire["hullErr"], 0.01)

    def test_a_second_pilot_is_refused(self) -> None:
        taken = self.part("tarawa")["taken"]
        self.assertEqual(1, taken["spawnRefused"])
        self.assertEqual(1, taken["seatRefused"])
        self.assertFalse(taken["seated"])

    def test_the_throttle_lets_it_go_at_rest(self) -> None:
        flown = self.part("tarawa")["flown"]
        self.assertIsNotNone(flown["releasedAt"])
        self.assertAlmostEqual(0.0, flown["releaseSpeed"], delta=0.05)
        self.assertGreater(flown["offArm"], 1)

    # --- the page's code against the room's, tick for tick --------------------

    def test_page_and_room_hold_the_craft_in_one_place(self) -> None:
        agree = self.part("agree")
        for part in ("parked", "held"):
            self.assertEqual(agree[part]["pageTick"], agree[part]["serverTick"], part)
            self.assertLess(agree[part]["gap"], 1e-3, part)
            self.assertLess(agree[part]["turn"], 1e-2, part)
        self.assertAlmostEqual(0.0, agree["held"]["roomSpeed"], delta=0.05)
        self.assertAlmostEqual(0.0, agree["held"]["pageSpeed"], delta=0.5)

    def test_page_and_room_seat_the_same_pilot(self) -> None:
        seat = self.part("agree")["seat"]
        self.assertTrue(seat["carrier"])
        self.assertTrue(seat["page"])
        self.assertTrue(seat["room"])
        self.assertTrue(seat["pageOff"])
        self.assertFalse(seat["roomOpen"])

    def test_page_and_room_let_go_on_the_same_tick(self) -> None:
        flown = self.part("agree")["flown"]
        self.assertIsNotNone(flown["pageAt"])
        self.assertEqual(flown["pageAt"], flown["roomAt"])
        # Free flight from there is each side's own; they part by the release
        # speed's rounding, not by the arm.
        self.assertLess(flown["gap"], 5)

    def test_an_lvts_seat_point_seats_its_driver(self) -> None:
        lvt = self.part("tarawa")["lvt"]
        self.assertEqual(8, lvt["points"])
        self.assertLess(lvt["apart"], 3)
        self.assertTrue(lvt["seated"])
        self.assertTrue(lvt["drives"])


if __name__ == "__main__":
    unittest.main()
