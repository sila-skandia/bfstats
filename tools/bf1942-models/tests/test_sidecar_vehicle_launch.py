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

Then (same day, wire.md section 50, "The M3A1's pivot and the round's
tick"): the M3A1's .50 fires from `M3A1Camera2`, whose `setPivotPosition
0/0.3/-1` the chain now carries (it was the 0.8 m left over), and the
writer takes the hull and the aims by the server's ticks, not by arrival
time: the round's aims `lag` ticks before the block that shows the
counter's step, the hull's of the same tick, or of the next for a gunner on
a land or sea hull, which the server has moved that tick before his round
leaves.

`fixtures/sidecar_vehicle_launch.json` holds 90 of that round's paired
rounds, every bomb release among them: the pose and aim histories the
writer held near each, the ticks it derived, and the server's row.
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
        cls.rows = json.loads(out.stdout.strip().splitlines()[-1])["rows"]
        for r in cls.rows:
            cls.by[(r["tmpl"], r["w"])].append(r)

    def stats(self, key, which):
        rows = self.by[key]
        self.assertTrue(rows, key)
        return (median([math.dist(r[which]["p"], r["server"]["p"]) for r in rows]),
                median([angle(r[which]["d"], r["server"]["d"]) for r in rows]))

    def errors(self, key, which):
        return [math.dist(r[which]["p"], r["server"]["p"]) for r in self.by[key]]

    def test_guns_turned_on_their_mounts_fire_forward(self):
        for key in [("AichiVal", "MG42_Air"), ("M3A1", "Browning")]:
            _, before = self.stats(key, "before")
            metres, now = self.stats(key, "now")
            self.assertGreater(before, 150, key)
            self.assertLess(now, 0.5, key)
            self.assertLess(metres, 0.05, key)

    def test_a_seat_camera_fires_from_its_pivot(self):
        # M3A1Camera2's `setPivotPosition 0/0.3/-1`: without it the .50 left
        # 1 m ahead of the server's point, along the gun.
        without, _ = self.stats(("M3A1", "Browning"), "noPivot")
        metres, _ = self.stats(("M3A1", "Browning"), "now")
        self.assertGreater(without, 0.9)
        self.assertLess(metres, 0.05)

    def test_a_land_or_sea_gunner_fires_from_the_hull_of_the_rounds_tick(self):
        # A Daihatsu at 14 m/s: its gunner's round leaves from where the
        # server moved the hull that tick, 0.46 m on from the tick before.
        # By arrival time the writer was a round (0.93 m) out.
        same, _ = self.stats(("Daihatsu", "MG42"), "samePose")
        arrival, _ = self.stats(("Daihatsu", "MG42"), "arrival")
        metres, now = self.stats(("Daihatsu", "MG42"), "now")
        self.assertGreater(same, 0.4)
        self.assertGreater(arrival, 0.8)
        self.assertLess(metres, 0.05)
        self.assertLess(now, 0.5)
        # The M3A1's turret is the tick before's: a tick later it is 0.3 deg off.
        _, later = self.stats(("M3A1", "Browning"), "arrival")
        _, now = self.stats(("M3A1", "Browning"), "now")
        self.assertGreater(later, 0.2)
        self.assertLess(now, 0.1)

    def test_an_aircraft_fires_from_the_hull_of_the_tick_before(self):
        # Moving 1.5 to 2 m a tick, a plane's guns pin the tick: every round
        # on the server's point, none a tick out.
        for key in [("SBD", "SBDGuns"), ("Corsair", "CorsairGuns"), ("AichiVal", "MG42_Air")]:
            self.assertLess(max(self.errors(key, "now")), 0.05, key)
            self.assertGreater(median(self.errors(key, "tickEarlier")), 0.9, key)

    def test_a_bomb_leaves_on_the_tick_its_counter_says(self):
        # A bomb rack's round leaves `fireTicks` (101 for the SBD's
        # roundOfFire 0.3, 151 for the Aichi Val's 0.2) before the block that
        # shows its counter's step, from the plane as the tick before left
        # it: no release delay, and nothing of the plane's speed in the
        # point. When the server sent the step a tick late (it changed on a
        # tick no block carried) the release is a tick earlier, and nothing
        # on the wire tells the two apart: every release is on the point or
        # exactly a tick of flight out. By arrival time five of the SBD's
        # seven were a tick out.
        bombs = [r for r in self.rows if "Bomb" in r["w"]]
        self.assertGreaterEqual(len(bombs), 12)
        for r in bombs:
            on = math.dist(r["now"]["p"], r["server"]["p"])
            early = math.dist(r["tickEarlier"]["p"], r["server"]["p"])
            self.assertLess(min(on, early), 0.05, r["w"])
        sbd = self.errors(("SBD", "SBDBombRack"), "now")
        self.assertGreaterEqual(sum(e < 0.05 for e in sbd), 5)
        self.assertGreaterEqual(sum(e > 1 for e in self.errors(("SBD", "SBDBombRack"), "arrival")), 5)

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
        for key in [("Zero", "ZeroGuns"), ("Corsair", "CorsairGuns"), ("Corsair", "CorsairBombDummy")]:
            metres, now = self.stats(key, "now")
            self.assertLess(metres, 0.05, key)
            self.assertLess(now, 1, key)


if __name__ == "__main__":
    unittest.main()
