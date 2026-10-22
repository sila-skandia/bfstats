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
  lag     the page's own reconciler (`netcode-reconcile.js`
          `createHullReconciler`) with the ack four ticks behind, as
          `net-room.js` `correctDrivenHull` runs it live

`lag` is the live page. Before `TrackedVehicle.reanchor` a correction reached
the springs as a displacement inside one tick, the damper read it as a
closing speed, and the next correction answered that bounce: a seated Sherman
at idle bounced 460 mm median (1 m worst) under the reconciler where the
uncorrected run sat within 0.02 mm (2026-10-22, the owner's "wobbling badly").
Ledger TANK-18..TANK-25.
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
        sleep = self.results["sleep"]
        self.assertEqual(sleep["pageFree"], sleep["server"])


if __name__ == "__main__":
    unittest.main()
