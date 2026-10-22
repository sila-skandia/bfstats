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

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_tank_law import MODULES as TANK_MODULES, THREE_PACKAGE, VENDOR, VIEWER

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "vehicle_law_harness.mjs"
MODULES = TANK_MODULES + ["wheeled-vehicle.js", "netcode-reconcile.js", "mouse-input.js"]


def run_harness(stem: str) -> dict:
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
            capture_output=True, text=True, timeout=180)
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


if __name__ == "__main__":
    unittest.main()
