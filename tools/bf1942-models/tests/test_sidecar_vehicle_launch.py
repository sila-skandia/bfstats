"""A remote vehicle's round is written where the server launched it.

The UDP sidecar writes each round of another player's vehicle gun as a
`k:"f"` row whose `p`/`d` the page launches from (`viewer/net-server-rounds.js`
`shot`, through `replay-hulls.js` `recordedLaunch`, which adds the gun's
`projectilePosition` and barrel offsets as the engine's `fireBarrel` does,
ledger XHIT-16). So `p`/`d` must be the server's launch matrix: the FireArms'
own frame, or the seat camera's for a `fireInCameraDof` gun (XHIT-12).

Until 2026-10-28 the writer measured from the seat's pitch part's pivot and
axis alone. On a lab Midway co-op round (features/udp-sidecar/wire.md,
"Where a vehicle's round leaves"), paired with the server recorder's own
rows, the fixed plane guns matched to 1 cm, but the M3A1's and the
Sherman's pintle .50 and the Aichi Val's rear MG, whose FireArms and camera
the `.con` turns 180 degrees on their mounts, were written 157 to 178
degrees off: drawn flying backwards. The writer now carries the hull's pose
down the template's placements to the launch frame (derive-children.mjs
`launchChains`, ghost-writer.mjs `_launchFrame`).

`fixtures/sidecar_vehicle_launch.json` holds 90 of that round's paired
rounds: the hull pose and seat aims the writer held, and the server's row.
"""
import json
import math
import shutil
import subprocess
import unittest
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent


def angle(a, b):
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b)) / na / nb))))


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2]


class SidecarVehicleLaunchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        out = subprocess.run(["node", str(HERE / "sidecar_vehicle_launch_harness.mjs"),
                              str(HERE / "fixtures" / "sidecar_vehicle_launch.json")],
                             capture_output=True, text=True, check=True, timeout=120)
        cls.by = defaultdict(list)
        for r in json.loads(out.stdout.strip().splitlines()[-1])["rows"]:
            cls.by[(r["tmpl"], r["w"])].append(r)

    def stats(self, key, which):
        rows = self.by[key]
        self.assertTrue(rows, key)
        return (median([math.dist(r[which]["p"], r["server"]["p"]) for r in rows]),
                median([angle(r[which]["d"], r["server"]["d"]) for r in rows]))

    def test_guns_turned_on_their_mounts_fire_forward(self):
        _, before = self.stats(("AichiVal", "MG42_Air"), "before")
        metres, now = self.stats(("AichiVal", "MG42_Air"), "now")
        self.assertGreater(before, 150)
        self.assertLess(now, 1)
        self.assertLess(metres, 0.05)
        # The M3A1's .50 still leaves 0.8 m and 3 degrees from the server's
        # (open: features/udp-sidecar/wire.md, "Where a vehicle's round
        # leaves"), against 1.3 m and 177 degrees before.
        before_m, before = self.stats(("M3A1", "Browning"), "before")
        metres, now = self.stats(("M3A1", "Browning"), "now")
        self.assertGreater(before, 150)
        self.assertLess(now, 5)
        self.assertLess(metres, min(1.0, before_m))

    def test_a_gun_on_another_seats_turret_rides_it(self):
        # The Sherman's pintle .50 sits on the gunner's tower (seat 0's yaw).
        _, before = self.stats(("Sherman", "Browning"), "before")
        metres, now = self.stats(("Sherman", "Browning"), "now")
        self.assertGreater(before, 60)
        self.assertLess(now, 2)
        self.assertLess(metres, 0.1)

    def test_a_camera_fired_gun_launches_from_the_seat_camera(self):
        # The Sherman's coaxial (`fireInCameraDof`) from ShermanCamera, 0.3 m
        # off the gun base the writer used.
        before, _ = self.stats(("Sherman", "Coaxial_browning"), "before")
        metres, now = self.stats(("Sherman", "Coaxial_browning"), "now")
        self.assertGreater(before, 0.25)
        self.assertLess(metres, 0.05)
        self.assertLess(now, 1)

    def test_a_gun_off_the_hull_origin_launches_from_its_own_place(self):
        before, _ = self.stats(("SBD", "SBDGuns"), "before")
        metres, now = self.stats(("SBD", "SBDGuns"), "now")
        self.assertGreater(before, 0.7)
        self.assertLess(metres, 0.05)
        self.assertLess(now, 1)

    def test_what_was_right_stays_right(self):
        for key in [("Zero", "ZeroGuns"), ("Corsair", "CorsairGuns"), ("Daihatsu", "MG42"),
                    ("AichiVal", "AichiValBombRack")]:
            metres, now = self.stats(key, "now")
            self.assertLess(metres, 0.05, key)
            self.assertLess(now, 1, key)


if __name__ == "__main__":
    unittest.main()
