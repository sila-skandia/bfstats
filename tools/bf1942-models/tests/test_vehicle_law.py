"""Every ground hull the page drives against the BF1942 dedicated server's, per tick.

`vehicle_law_harness.mjs` builds a hull from a chassis fixture
(`lab/veh_law_chassis.mjs` on the real level: the drive's node tree, each
spring's col0 probe depth, the inertia box), replays a `lab/veh_law_probe.mjs`
run's words through the page's own drive (`TrackedVehicle`, `GroundVehicle`)
on the level's terrain window, and measures the hull against the server's
control state at every ack, four ways:

  acked   the server's position, rotation and velocity put back at every ack
  free    never corrected
  seat    `acked`, the drive first put on the server's pose from 2 cm and
          0.2 degrees off, as a seated page's first correction does
  lag     the page's own correction four ticks behind, as `net-room.js`
          `correctDrivenHull` runs it live: `TrackedVehicle.rewind` takes the
          server's state at the acked tick (pose, velocity, spin, the
          accumulators, the sleep flag, the Engine) and runs the ticks since
          again on their own inputs

`lag` is the live page. The delta reconciler it replaced added the acked
tick's error to the present a round trip late, and the springs answered: a
seated Sherman at idle bounced 460 mm median (1 m worst) where the
uncorrected run sat within 0.02 mm (2026-10-22, the owner's "wobbling
badly"), and the lab M3A1 40 mm at idle and centimetres in every phase even
with its wheels re-stood (`reanchor`). Ledger TANK-18..TANK-27.
"""

from __future__ import annotations

import gzip
import json
import math
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_tank_law import MODULES as TANK_MODULES, THREE_PACKAGE, VENDOR, VIEWER  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "vehicle_law_harness.mjs"
MODULES = TANK_MODULES + ["wheeled-vehicle.js", "netcode-reconcile.js", "mouse-input.js"]


def run_harness(stem: str, start: int | None = None) -> dict:
    """`start` seeds every run from that serial's state (the harness's FROM)."""
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        for name, source in VENDOR.items():
            if not source.exists():
                raise unittest.SkipTest(f"{source.name} is not in the tree")
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs"),
             str(FIXTURES / f"{stem}.ndjson.gz"),
             str(FIXTURES / f"{stem}_terrain.json.gz"),
             str(FIXTURES / f"{stem}_chassis.json.gz")],
            capture_output=True, text=True, timeout=180,
            env={**os.environ, **({"FROM": str(start)} if start else {})})
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class ShermanLawTests(unittest.TestCase):
    """The lab Sherman (vanilla Wake, the run `test_tank_law` replays)."""

    stem = "vehicle_law_sherman"
    phases = ["idle", "throttle", "throttle+right", "throttle+left", "release",
              "brake/reverse", "idle2", "throttle+left2", "coast"]
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness(cls.stem)

    def check(self, mode: str, median: float, worst: float, vertical: float, yaw: float) -> None:
        for key in self.phases:
            r = self.results[mode][key]
            with self.subTest(mode=mode, phase=key):
                self.assertLessEqual(r["horizontal"]["median"], median, r["horizontal"])
                self.assertLessEqual(r["horizontal"]["max"], worst, r["horizontal"])
                self.assertLessEqual(r["vertical"]["max"], vertical, r["vertical"])
                self.assertLessEqual(r["yaw"]["max"], yaw, r["yaw"])

    def test_corrected_every_ack(self) -> None:
        self.check("acked", 2.0, 10.0, 10.0, 0.2)

    def test_put_on_the_servers_pose_from_elsewhere(self) -> None:
        self.check("seat", 2.0, 10.0, 10.0, 0.2)

    def test_under_the_pages_own_reconciler_a_round_trip_late(self) -> None:
        # The live page: no bounce at idle, millimetres driving.
        self.check("lag", 2.0, 10.0, 10.0, 0.2)
        idle = self.results["lag"]["idle"]["vertical"]
        self.assertLess(idle["max"], 1.0, idle)

    def test_the_hull_sleeps_with_the_server(self) -> None:
        # Within two ticks: the seat's spring state comes in 2 mm steps, and
        # on the M3A1 that kept the accumulator over the root's wake test two
        # ticks longer than the server's (8321 against 8319); it wakes on the
        # same tick.
        sleep = self.results["sleep"]
        for page, server in zip(sleep["pageFree"], sleep["server"]):
            self.assertLessEqual(abs(page - server), 2, sleep)


class ShermanSouthBaseLawTests(ShermanLawTests):
    """A second lab Sherman (Wake's South Base pad, 2026-10-23; the hull the
    old `test_sim_vehicles` South Base words drove): ten phases, a hard turn
    from 120 ticks of throttle among them, which meets an object at its end
    (the harness has no statics), so that phase is held to its median."""

    stem = "vehicle_law_sherman_south"
    phases = ["idle", "throttle", "throttle+right", "throttle+left", "release",
              "brake/reverse", "idle2", "throttle2"]

    def test_the_hard_turn_tracks_to_its_contact(self) -> None:
        h = self.results["lag"]["hardturn"]["horizontal"]
        self.assertLessEqual(h["median"], 2.0, h)

    def test_the_coast_after_the_contact_takes_the_servers_spin(self) -> None:
        # `acked` puts back pose and velocity only, and leaves the spin the
        # contact gave the server's hull (0.9 degrees off in the coast); the
        # page's `rewind` takes it with the rest (`lag`).
        r = self.results["lag"]["coast"]
        self.assertLessEqual(r["horizontal"]["max"], 2.0, r)
        self.assertLessEqual(r["yaw"]["max"], 0.05, r)


class M3A1LawTests(ShermanLawTests):
    """The lab M3A1 half-track (vanilla Wake, 2026-10-22): two steered
    `c_PGFRollGrip` front wheels on their bundles' 80 deg/s servo, four driven
    bogies, its wheels' undefined material 37 (resistance 0.02).

    The turns are not all the law's: the server's hull met objects the
    harness has no collision for (a 0.4 m step against something at serial
    8504 in the right turn, the left turn's 1.9 m at 8530, and the whole hard
    turn pressed against an obstacle, `fr` with a vertical part, at 0.3 m/s).
    Those phases are held to their medians; the clean ones to the Sherman's
    millimetres."""

    stem = "vehicle_law_m3a1"
    phases = ["idle", "throttle", "release", "brake/reverse", "idle2"]

    def test_the_turns_track_between_the_object_contacts(self) -> None:
        for mode in ("acked", "lag"):
            for key in ("throttle+right", "throttle+left", "throttle2"):
                h = self.results[mode][key]["horizontal"]
                with self.subTest(mode=mode, phase=key):
                    self.assertLessEqual(h["median"], 5.0, h)

    def test_it_does_not_jump_under_the_reconciler(self) -> None:
        # The owner's "a mess, it jumps along the ground": the delta
        # reconciler's vertical bounce, 20-110 mm at idle.
        for key in self.phases:
            v = self.results["lag"][key]["vertical"]
            with self.subTest(phase=key):
                self.assertLess(v["max"], 1.0, v)


class KubelwagenLawTests(unittest.TestCase):
    """A lab Kubelwagen (vanilla El Alamein co-op, the Axis base, 2026-10-25),
    the first wheeled car measured against the server: two steered
    `c_PGFRollGrip` fronts on bundles at 200 deg/s, two driven `c_PGFEngineGrip`
    rears, the car's running-mean load (`c_ETCar`, TANK-13) and a gearbox it
    shifts through four gears to 19 m/s, on flat sand. The page drives it with
    `TrackedVehicle`, the same per-tick law as a tank (PHY-33, TANK-18); the
    old `GroundVehicle` model ran the same words 5-37 mm off a tick under the
    page's own reconciler, 40-78 mm vertically, and rolled the car over
    uncorrected. The run met a static at the end of its left turn (serial
    3600, 15.8 m/s to 0.3 in 20 ticks) and again in its last throttle, which
    the harness has no collision for, so those phases are not held."""

    stem = "vehicle_law_kubelwagen"
    phases = ["idle", "throttle", "throttle+right", "throttle+left", "brake/reverse", "idle2"]
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness(cls.stem)

    def test_a_car_is_driven_by_the_per_tick_law(self) -> None:
        # `veh_law_chassis.mjs` seats a bot through the page's own occupancy.
        self.assertEqual(self.results["cls"], "TrackedVehicle")

    def test_corrected_every_ack(self) -> None:
        # Pose and velocity only: the friction latch and the gearbox stay the
        # page's own, so a toggle the server took a tick apart costs a
        # centimetre on one ack.
        for key in self.phases:
            r = self.results["acked"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["horizontal"]["median"], 1.5, r["horizontal"])

    def test_under_the_pages_own_reconciler_a_round_trip_late(self) -> None:
        for mode in ("lag",):
            for key in self.phases:
                r = self.results[mode][key]
                with self.subTest(mode=mode, phase=key):
                    self.assertLessEqual(r["horizontal"]["median"], 1.5, r["horizontal"])
                    self.assertLessEqual(r["horizontal"]["max"], 15.0, r["horizontal"])
                    self.assertLessEqual(r["vertical"]["max"], 10.0, r["vertical"])
                    self.assertLessEqual(r["yaw"]["max"], 0.3, r["yaw"])
                    self.assertEqual(r["gearMisses"], 0, r)

    def test_the_gearbox_follows_the_server(self) -> None:
        # Through four up-shifts in the throttle phase the page's revs stay
        # within a hundredth of the server's under the reconciler.
        r = self.results["lag"]["throttle"]
        self.assertLessEqual(r["revs"]["max"], 0.02, r["revs"])


class WillyLawTests(KubelwagenLawTests):
    """A lab Willys (vanilla El Alamein co-op, the airfield, 2026-10-25). Its
    turns ran onto the airfield's escarpment and an object on it, so only the
    straight phases are held. Before the page took the Engine's throttle angle
    over its own limit (`TrackedVehicle.adopt`, `EngineNetworkable::getNetUpdate`
    0x082279d0), every correction set a Willys's throttle angle to 1 of 5000
    and its throttle phase ran 20 mm a tick behind the server."""

    stem = "vehicle_law_willy"
    phases = ["throttle", "release", "brake/reverse", "idle2", "throttle2"]

    def test_the_gearbox_follows_the_server(self) -> None:
        r = self.results["lag"]["throttle"]
        self.assertLessEqual(r["revs"]["max"], 0.01, r["revs"])



class PumaLawTests(unittest.TestCase):
    """The lab's Puma (Sd.Kfz. 234/2, FHSW desert_hill, the axis base,
    2026-10-28): eight wheels under `c_PIYaw` bundles, the rear two axles
    `direction -1`, a `c_ETCar` Engine, 26 m/s in 6 s and then 5 s of full
    right lock, which retail slid through: the slip angle rose to 68 degrees
    in 2 s while the speed fell from 26 to 8 m/s, then held 26 degrees at
    74 deg/s. The census flagged the page's 46-89 degrees on this and the
    other short or all-wheel-steered hulls as `crab`; under the page's own
    reconciler the slide holds to a millimetre an ack, so it is the
    server's law (ledger TANK-30)."""

    stem = "vehicle_law_puma"
    phases = ["idle", "throttle", "throttle+right", "release"]
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness(cls.stem)

    def test_a_car_is_driven_by_the_per_tick_law(self) -> None:
        self.assertEqual(self.results["cls"], "TrackedVehicle")

    def test_corrected_every_ack(self) -> None:
        for key in self.phases:
            r = self.results["acked"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["horizontal"]["median"], 1.5, r["horizontal"])

    def test_the_slide_at_full_lock_tracks_under_the_reconciler(self) -> None:
        for key in self.phases:
            r = self.results["lag"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["horizontal"]["median"], 1.5, r["horizontal"])
                self.assertLessEqual(r["horizontal"]["max"], 20.0, r["horizontal"])
                self.assertLessEqual(r["vertical"]["max"], 2.0, r["vertical"])
                self.assertLessEqual(r["yaw"]["max"], 0.2, r["yaw"])
                self.assertEqual(r["gearMisses"], 0, r)

    def test_the_uncorrected_slide_ends_within_a_metre(self) -> None:
        # Never corrected from the seat: 26 m/s into 5 s of lock, the page
        # ends the slide under a metre and 6 degrees from the server.
        r = self.results["free"]["throttle+right"]
        self.assertLessEqual(r["horizontal"]["max"], 1000.0, r["horizontal"])
        self.assertLessEqual(r["yaw"]["max"], 6.0, r["yaw"])


class SdKfz251Pak38LawTests(unittest.TestCase):
    """The lab's FHSW SdKfz251-Pak38 (kharkov_winter-1941, open ground from
    heading 123, 2026-10-28): a half-track towing a Pak 38, its track four
    EngineGrip springs among sixteen sprung EngineDummyGrip rollers, two
    RollGrip fronts under +-30 degree bundles, a `c_ETTank` Engine, 5.5 s of
    throttle to 10 m/s and then right lock.

    The replay once ran it 5.5 m/s where the server ran 7.8, a gear behind,
    its resistance accumulator 1.5 times the server's. The page's drive was
    not the cause: the replay built the hull from the chassis's node list and
    took springs the page leaves out, the two tow hooks and the towed gun's
    two wheels, and those wheels counted in the resistance sum and the
    friction mean. The server counts four contacts here, the two driven
    wheels down and the two fronts (ledger TANK-32).

    At serial 1732, in the turn, the server's hull takes an object contact
    (-44.6 m/s^2 in one tick) the terrain-only replay does not have."""

    stem = "vehicle_law_sdkfz251_pak38"
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness(cls.stem)

    def test_a_half_track_is_driven_by_the_per_tick_law(self) -> None:
        self.assertEqual(self.results["cls"], "TrackedVehicle")

    def test_corrected_every_ack(self) -> None:
        for key in ["idle", "throttle", "throttle+right", "release"]:
            r = self.results["acked"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["horizontal"]["median"], 1.5, r["horizontal"])

    def test_the_straight_tracks_under_the_reconciler(self) -> None:
        for key in ["idle", "throttle", "release"]:
            r = self.results["lag"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["horizontal"]["median"], 1.5, r["horizontal"])
                self.assertLessEqual(r["horizontal"]["max"], 30.0, r["horizontal"])
                self.assertEqual(r["gearMisses"], 0, r)

    def test_the_turn_tracks_under_the_reconciler(self) -> None:
        # The object contact at 1732 is 260 mm of it, recovered in 0.3 s.
        r = self.results["lag"]["throttle+right"]
        self.assertLessEqual(r["horizontal"]["median"], 12.0, r["horizontal"])
        self.assertLessEqual(r["yaw"]["max"], 2.0, r["yaw"])

    def test_the_uncorrected_throttle_keeps_up_with_the_server(self) -> None:
        # 5.5 s from rest to 10 m/s through three up-shifts. With the towed
        # gun's wheels in the sum the replay ended the phase 7 m behind and
        # missed 50 gears; the page's own chassis is within a metre.
        r = self.results["free"]["throttle"]
        self.assertLessEqual(r["horizontal"]["max"], 1000.0, r["horizontal"])
        self.assertLessEqual(r["gearMisses"], 6, r)


class DesertPatrolVehicleLawTests(unittest.TestCase):
    """A lab Desert Patrol Vehicle (Desert Combat El Alamein, the Allied base,
    2026-10-28), driven flat out to 28 m/s and put on full right lock for
    2.5 s, then again to 26 m/s and full left lock. The server spun it: 218
    degrees through the right lock and 98 more after it, 28 to 4 m/s, slip
    to 140 degrees, with no contact; 249 and 103 on the left. The ground-drive census's `crab`
    class (46-89 degrees of slip at full lock for this car and its
    short-wheelbase kin) is that spin, not a viewer fault. The first
    throttle met a static at serial 2037 (16.7 to 9.2 m/s), which the
    harness has no collision for, so the straight phases are not held."""

    stem = "vehicle_law_dpv"
    turns = ["throttle+right", "release", "throttle+left2", "coast"]
    # The first word of each lock, by the plan's phase rows.
    right_lock = 2212
    left_lock = 2662

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness(cls.stem)
        # Seeded a few ticks before each lock, at speed, never corrected.
        cls.from_right = run_harness(cls.stem, start=cls.right_lock - 7)
        cls.from_left = run_harness(cls.stem, start=cls.left_lock - 7)

    def test_the_server_spins_it_at_full_lock(self) -> None:
        rows = [json.loads(line) for line in gzip.open(FIXTURES / f"{self.stem}.ndjson.gz", "rt")]
        states = {r["serial"]: r for r in rows if r["kind"] == "cs"}
        def heading(serial: int) -> float:
            x, y, z, w = states[min(s for s in states if s >= serial)]["rot"]
            return math.degrees(math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)))
        def slip(serial: int) -> float:
            st = states[min(s for s in states if s >= serial)]
            v = st["v"]
            d = math.degrees(math.atan2(v[0], v[2])) - heading(serial)
            return abs((d + 180) % 360 - 180)
        lock = [s for s in sorted(states) if self.right_lock <= s <= self.right_lock + 75]
        turned = sum((heading(b) - heading(a) + 180) % 360 - 180 for a, b in zip(lock, lock[1:]))
        self.assertGreater(abs(turned), 150)
        self.assertGreater(max(slip(s) for s in range(self.right_lock, self.right_lock + 70)), 100)

    def test_the_spin_tracks_every_ack(self) -> None:
        for key in self.turns:
            r = self.results["acked"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["horizontal"]["median"], 2.5, r["horizontal"])
                self.assertLessEqual(r["horizontal"]["max"], 40.0, r["horizontal"])
                self.assertLessEqual(r["yaw"]["max"], 1.0, r["yaw"])

    def test_the_spin_runs_open_loop_from_its_onset(self) -> None:
        # Through 2.5 s of full lock, about 300 degrees of spin with the coast:
        # the uncorrected page stays within a metre and ten degrees of it.
        for run, key in ((self.from_right, "throttle+right"), (self.from_left, "throttle+left2")):
            r = run["free"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["horizontal"]["max"], 1000.0, r["horizontal"])
                self.assertLessEqual(r["yaw"]["max"], 10.0, r["yaw"])


if __name__ == "__main__":
    unittest.main()
