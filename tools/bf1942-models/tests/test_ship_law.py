"""The page's ship under way against the BF1942 dedicated server's, per tick.

`ship_law_harness.mjs` replays the input words `lab/veh_law_probe.mjs` sent a
real server (vanilla Wake, a Daihatsu, 2026-10-23) through `viewer/ship.js` and
measures the page's hull against the server's at every acknowledged serial,
the server's position, rotation, velocity and omega put back at every ack as
the hull reconciler does. The runs are open water: full ahead, either helm
with and without way on, release, astern with and without helm, rudder alone
and a coast.

The law is SHIPLAW-1..SHIPLAW-4 (`features/bf1942-engine-reference/ledger.md`,
`viewer/ship-law.js`): one tick a 1/30 s, the Engine's roll axis and gearbox
and the rudders' automatic-reset ramps first, then the screw's thrust, the
rudders' lift and the floats into the root's accumulators, then the root's
sleep, box drag with the submerged scale on both arms, and one Euler step. The
`old` mode is the page before it: the 240 Hz pedal path.

Thresholds, per acknowledged tick: horizontal median at most 0.5 mm and worst
at most 1 mm in every phase, vertical worst at most 1 mm, yaw at most 0.02
degrees, the revs within 1e-3 of the server's; two 1/60 s frames a word give
the same; one uncorrected run stays within 25 mm through the whole 30 s plan;
and the law at least four times closer than the pedal path in every phase
with way on.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "ship_law_daihatsu_wake.json.gz"
HARNESS = HERE / "ship_law_harness.mjs"
#: Phases with way on, where the pedal path's error is the drive's and not the
#: wire's quantisation.
UNDER_WAY = {"throttle", "throttle+right", "throttle2", "throttle+left", "release"}


def run_harness() -> dict:
    proc = subprocess.run(["node", str(HARNESS), str(FIXTURE)],
                          capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class ShipLawTests(unittest.TestCase):
    result: dict = {}

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = run_harness()

    def test_the_daihatsu_runs_on_the_law(self) -> None:
        r = self.result
        self.assertTrue(r["law"])
        self.assertEqual(r["floats"], 4)
        # `setAcceleration 0/+-36/0` under `setAutomaticReset 1`: the rudders
        # ramp at 36 deg/s, not at the rig's `setMaxSpeed` 18; and their lift
        # coefficient is `(0 + 2) * 14.73 / 9.82` = 3.
        for wing in r["wings"]:
            self.assertEqual(wing["acceleration"], 36)
            self.assertTrue(wing["automaticReset"])
            self.assertAlmostEqual(wing["coeff"], 3.0, places=6)

    def test_each_acked_tick_is_within_a_millimetre(self) -> None:
        for run, modes in self.result["runs"].items():
            for mode in ("acked", "frame60"):
                for phase, e in modes[mode].items():
                    with self.subTest(run=run, mode=mode, phase=phase):
                        self.assertGreater(e["horizontal"]["n"], 0)
                        self.assertLessEqual(e["horizontal"]["median"], 0.5)
                        self.assertLessEqual(e["horizontal"]["max"], 1.0)
                        self.assertLessEqual(e["vertical"]["max"], 1.0)
                        self.assertLessEqual(e["yaw"]["max"], 0.02)
                        self.assertLessEqual(e["revs"]["max"], 1e-3)

    def test_an_uncorrected_run_stays_within_centimetres(self) -> None:
        for phase, e in self.result["runs"]["wake_d2"]["free"].items():
            with self.subTest(phase=phase):
                self.assertLessEqual(e["horizontal"]["max"], 25.0)
                self.assertLessEqual(e["vertical"]["max"], 1.0)
                self.assertLessEqual(e["yaw"]["max"], 0.02)

    def test_the_law_beats_the_pedal_path_it_replaced(self) -> None:
        for run, modes in self.result["runs"].items():
            for phase, old in modes["old"].items():
                if phase not in UNDER_WAY:
                    continue
                with self.subTest(run=run, phase=phase):
                    law = modes["acked"][phase]
                    self.assertGreater(old["horizontal"]["max"], 2.0)
                    self.assertLess(law["horizontal"]["max"] * 4, old["horizontal"]["max"])


if __name__ == "__main__":
    unittest.main()
