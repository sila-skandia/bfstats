"""How a sidecar page draws a remote soldier and a remote turret, and the
clock it draws remotes by through a server hitch and a round restart
(`viewer/net-sidecar.js`).

Retail (Linux server build, the same predict code the client runs):

- `BFSoldierNetworkable::predict` 0x08222e50, prediction mode 1: past the
  newest record the position takes the record's velocity and the rotation is
  the newest record's (toMat of +0x3c, 0x08224049..0x0822405c); the aim
  registers +0x68 / +0x6c go into the soldier's +0x284 / +0x288 lerped with the
  transform between the embracing records (0x08223a85..0x08223ac1) and as the
  newest past it (0x08223f4e..0x08223f5f).
- `RotationalBundleNetworkable::predict` 0x08234f10: the records embracing the
  render time are found in the whole 16-record ring (`findEmbracingIndices`
  0x08235910) and lerped when 0 < gap < 500 ms; past the newest, the last
  pair's turn is carried for up to extrapolationTime.
- The client's clock is the control state's block tick plus the actions in
  flight, taken whole (ledger P-6), so it follows the server's tick wherever
  that goes. On the lab a 0.45 s and a 1.25 s stall of the server advanced its
  tick by 2 (it does not catch the stall up); the page's old mapping of the
  server clock drew remotes 0.3 s off retail's clock for 5 s after the first
  (`lab/remote_draw_check.py`, features/udp-sidecar/wire.md section 45).

The harness (`remote_draw_harness.mjs`) runs under node on copies of the
modules, as `test_remote_clock.py` does.
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
HARNESS = Path(__file__).resolve().parent / "remote_draw_harness.mjs"

MODULES = {
    "net-sidecar.mjs": VIEWER / "net-sidecar.js",
    "netcode.js": VIEWER / "netcode.js",
    "mouse-input.js": VIEWER / "mouse-input.js",
    "soldier-pose.js": VIEWER / "soldier-pose.js",
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RemoteDrawTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls):
        cls.results = run_harness()

    def test_a_soldier_holds_his_newest_facing_past_it(self):
        hold = self.results["soldierHold"]
        # A 60 degree snap in one tick, drawn 0.05 s past it: retail draws 60,
        # not 60 carried on to 150.
        self.assertAlmostEqual(hold["soldierYaw"], 60, places=3)
        # His position still takes the pair's velocity (1 m a tick).
        self.assertAlmostEqual(hold["soldierX"], 1 + 1.5, places=6)
        # A hull carries its pair's turn: 6 degrees a tick, 1.5 ticks on.
        self.assertAlmostEqual(hold["hullYaw"], 6 + 9, places=3)

    def test_the_aim_registers_are_drawn_on_the_bodys_clock(self):
        aim = self.results["aim"]
        self.assertIsNotNone(aim["slot"])
        mid, held, past, newest = aim["mid"], aim["held"], aim["past"], aim["newest"]
        # Halfway between the blocks that said 0 and 10 (twist 0 and 4).
        self.assertAlmostEqual(mid["aim"], 5, places=6)
        self.assertAlmostEqual(mid["twist"], 2, places=6)
        # A block that changed nothing holds the registers.
        self.assertAlmostEqual(held["aim"], 10, places=6)
        self.assertAlmostEqual(held["twist"], 4, places=6)
        # Past the newest sample, and with no render time, the newest.
        self.assertAlmostEqual(past["aim"], 10, places=6)
        self.assertAlmostEqual(newest["aim"], 10, places=6)
        self.assertAlmostEqual(newest["twist"], 4, places=6)

    def test_a_turret_is_read_off_its_ring(self):
        ring = self.results["ring"]
        # Ticks 300..305 turn 3 degrees each: at tick 303.5 it is 10.5. Two
        # samples held the older one (12) for a render time before it.
        self.assertAlmostEqual(ring["behind"], 10.5, places=3)
        self.assertAlmostEqual(ring["past"], 18, places=3)
        self.assertAlmostEqual(ring["newest"], 15, places=3)
        # A row with no tick is timed by the block clock (tick 306).
        self.assertAlmostEqual(ring["untimed"], 16.5, places=3)

    def test_the_clock_follows_retails_through_a_server_hitch(self):
        hitch = self.results["hitch"]
        self.assertLess(hitch["before"], 0.005)
        # The stall's own catch-up: the drawn clock is slewed, retail's steps.
        self.assertLess(hitch["after"], 0.005)

    def test_the_clock_follows_retails_through_a_round_restart(self):
        restart = self.results["restart"]
        self.assertLess(restart["before"], 0.005)
        self.assertLess(restart["after"], 0.005)


if __name__ == "__main__":
    unittest.main()
