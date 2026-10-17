"""Where E reaches a door (ledger SEAT-31, SEAT-32): `viewer/vehicle-entry.js`
`nearestEntry` asks the server's own finder, so the prompt is offered exactly
where a press seats (`tests/vehicle_entry_reach_harness.mjs`).

`GameServer::toggleEntryPoint` 0x0814ee70 runs `BFfindEntryPoint(origin, 3.0,
team, useEntryRadius = 1)` 0x0831d770 for a human. Its candidates come from
`ObjectManager::getObjectsFromGrid` 0x0819dc40: the vehicle roots whose
bounding sphere (about the root's origin, holding every part and door under
it) comes within 3 m of the soldier's origin, and every door under them. Of
those, the nearest free door strictly inside its own `setEntryRadius`, the
distance cut to whole centimetres. The M3A1 is Wake's, posed as the server had
it on 2026-10-17 (`features/udp-sidecar/wire.md` section 27)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "vehicle_entry_reach_harness.mjs"


class VehicleEntryReachTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_m3a1_doors_stand_where_the_server_puts_them(self) -> None:
        self.assertEqual([1019.669, 858.17], [self.r["rearDoor"][0], self.r["rearDoor"][2]])
        self.assertEqual([1017.308, 857.079], [self.r["centreDoor"][0], self.r["centreDoor"][2]])

    def test_a_hulls_sphere_holds_every_door_under_it(self) -> None:
        """`getBoundingRadius` 0x08165630: each child's distance plus its own
        radius, recursively. The Browning's PCO, 1.49 m up, and its doors 1.81 m
        under it make 3.30; the passenger doors (2.6) and wheels (3.04) are
        inside that."""
        self.assertAlmostEqual(3.313, self.r["m3a1Radius"], places=3)

    def test_the_rear_door_is_offered_where_the_page_pressed(self) -> None:
        """0.66 m off the rear door, 3.50 m from the hull's origin: the hull is
        in the query (3.50 < 3 + 3.31), the door 1.4 m off, inside 2.6. The
        server's finder gives the same seat, so the six refused presses were
        not the finder's (SEAT-32)."""
        self.assertEqual(3.504, self.r["rearHullDistance"])
        self.assertEqual("passenger2", self.r["atRearDoor"])

    def test_the_centre_door_is_offered_where_the_server_seated(self) -> None:
        self.assertEqual("driver", self.r["atCentre"])

    def test_with_the_passengers_seated_the_rear_spot_reaches_the_driver(self) -> None:
        """The centre door is 3.46 m from his origin there: inside its 3.5."""
        self.assertEqual("driver", self.r["rearAllTaken"])

    def test_past_every_doors_radius_nothing_is_offered(self) -> None:
        self.assertIsNone(self.r["behindOut"])

    def test_the_grid_turns_away_a_wide_door_of_a_small_hull(self) -> None:
        """3.2 m off a 3.5 m door at the origin of a hull with no extent: the
        hull's sphere is not within 3 m, so the door is no candidate."""
        self.assertEqual(0, self.r["bareRadius"])
        self.assertIsNone(self.r["bareGun"])
        # A 0.5 m mesh puts the hull's sphere within 3 m: offered.
        self.assertEqual(0.5, self.r["meshedRadius"])
        self.assertEqual("MeshedGun", self.r["meshedGun"])
        # Inside 3 m of the hull's origin the door's own radius decides.
        self.assertEqual("BareGun", self.r["bareGunNear"])


if __name__ == "__main__":
    unittest.main()
