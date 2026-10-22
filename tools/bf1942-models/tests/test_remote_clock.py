"""The clock a sidecar page draws remote objects by (`viewer/net-sidecar.js`).

Retail (BF1942.exe): `GameClient::predictAll` 0x00491f00 calls every
networkable's `predict` with 1000 x the client's game time 0x009a2160, which is
its tick counter 0x009a2168 over the sim rate. Each control-object state resets
that counter to the ghost block's server tick and adds one per unacknowledged
action replayed (0x00491c90, 0x00491d36, 0x00491e9f); `predict` draws at that
time less interpolationTime. So a remote is drawn 100 ms behind the tick that
runs a shot fired now, whatever the ping. The page drew it 100 ms behind the
newest sample instead, a round trip further back, and its rounds went behind
the planes it aimed at (features/udp-sidecar/wire.md section 38).

The harness (`remote_clock_harness.mjs`) runs the helpers and a scripted
client under node; the modules are copied as `test_sidecar_client.py` copies
them.
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
HARNESS = Path(__file__).resolve().parent / "remote_clock_harness.mjs"

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


class RemoteClockTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls):
        cls.results = run_harness()

    def test_the_lead_is_the_ticks_in_flight(self):
        lead = self.results["lead"]
        # Block tick 900 ran word 100; words up to 104 are made: the clock is
        # tick 904, 4/30 s past a server clock of 900/30.
        self.assertAlmostEqual(lead["a"], 4 / 30, places=9)
        self.assertIsNone(lead["noTick"])
        self.assertEqual(lead["ahead"], 0)          # never behind the newest block

    def test_the_lead_is_filtered_and_steps_only_for_a_jump(self):
        lead = self.results["lead"]
        self.assertEqual(lead["first"], 0.12)
        self.assertAlmostEqual(lead["eased"], 0.12 + 0.04 * lead["share"], places=9)
        self.assertEqual(lead["jump"], 0.6)
        self.assertEqual(lead["capped"], 1.0)
        self.assertEqual(lead["ignored"], 0.12)

    def test_the_drawn_lead_moves_at_a_bounded_rate(self):
        lead = self.results["lead"]
        # One second at 60 fps moves it LEAD_RATE, never the whole 0.1 s.
        self.assertAlmostEqual(lead["slewed"], 0.1 + lead["rate"], places=6)
        self.assertEqual(lead["slewJump"], 0.6)

    def test_a_pairs_turn_carries_on(self):
        quat = self.results["quat"]
        self.assertAlmostEqual(quat["half"], 25, places=6)
        self.assertAlmostEqual(quat["two"], 40, places=6)
        self.assertAlmostEqual(quat["flip"], 170, places=6)   # over 90 degrees: held

    def test_a_new_sample_is_drawn_without_a_step(self):
        blend = self.results["blend"]
        # Raw, the switch is a 0.04 m jump plus a 5 m/s kink in one frame.
        self.assertLess(blend["maxKink"], 0.15 * blend["rawStep"])
        self.assertLess(blend["lateErr"], 1e-3)               # back on the server's law
        self.assertLess(blend["snap"], 1e-9)                  # a 30 m step snaps

    def test_remotes_are_drawn_on_the_clients_clock(self):
        retail = self.results["client"]["retail"]
        # Four words in flight: drawn (tick + 4)/30 - 0.1, which is 23 ms
        # AHEAD of the server's present in this script (the block 10 ms old,
        # the frame 10 ms after it), where the old law drew 110 ms behind.
        self.assertAlmostEqual(retail["lead"], 4 / 30, places=6)
        self.assertAlmostEqual(retail["lag"], 0.010 - (4 / 30 - 0.1), places=3)
        self.assertLess(retail["xErr"], 1e-6)                 # on the plane's own track

    def test_lookback_keeps_the_old_law(self):
        old = self.results["client"]["lookback"]
        self.assertEqual(old["lead"], 0)
        # Newest sample (10 ms old at the frame + 10 ms) less 100 ms.
        self.assertAlmostEqual(old["lag"], 0.110, places=3)

    def test_a_turret_turn_carries_on_past_its_newest_sample(self):
        joints = self.results["joints"]
        self.assertAlmostEqual(abs(joints["onNewest"]), 3, places=3)
        self.assertAlmostEqual(abs(joints["oneTickOn"]), 6, places=3)


if __name__ == "__main__":
    unittest.main()
