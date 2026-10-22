"""The page's walking soldier against the BF1942 dedicated server's, per tick.

`move_law_harness.mjs` replays the input words `lab/move_law_probe.mjs` sent
a real server (vanilla Wake, 2026-10-22) through `viewer/walking-body.js`, on
Wake's own heightmap and material map, and measures the page's feet against
the server's at every acknowledged serial. The law it holds the page to is
PHY-34 (`features/bf1942-engine-reference/ledger.md`): the ramp squared
(PHY-9), the command capped at the unramped table, `0.75 * vCmd` every tick,
one Euler step with the box drag, the feet pushed out of the engine's
checkerboard terrain (TERR-16) along its face normal, and the soldier arm of
`addFriction`. `lab/move_law_check.py` is the same law written out in Python
against the same data.

Thresholds are the task's: per acknowledged tick the horizontal error's
median is at most 2 mm and its worst at most 5 mm in the ramp up, the steady
run, every ramp down, the strafe, the back and the walk; the vertical within a
few millimetres on the terrain.
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
FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "move_law_harness.mjs"
MODULES = [
    "walking-body.js", "soldier-resolve.js", "soldier-pose.js",
    "soldier-locomotion.js", "point-body.js", "fixed-step.js", "parachute.js",
    "heightfield.js", "world-collider.js", "collision-materials.js",
]
SCORED = ["rampUp", "steady", "rampDown", "strafe", "back", "walk"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs"),
             str(FIXTURES / "move_law_wake.ndjson.gz"),
             str(FIXTURES / "move_law_wake_terrain.json.gz")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class MoveLawTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_every_scored_phase_was_replayed(self) -> None:
        for key in SCORED:
            self.assertIn(key, self.results["acked"], key)
            self.assertGreaterEqual(self.results["acked"][key]["horizontal"]["n"], 4, key)

    def test_the_page_tracks_the_server_to_two_millimetres_an_ack(self) -> None:
        for key in SCORED:
            h = self.results["acked"][key]["horizontal"]
            with self.subTest(phase=key):
                self.assertLessEqual(h["median"], 2.0, h)
                self.assertLessEqual(h["max"], 5.0, h)

    def test_the_feet_stand_on_the_servers_terrain(self) -> None:
        for key in SCORED:
            v = self.results["acked"][key]["vertical"]
            with self.subTest(phase=key):
                self.assertLessEqual(v["absMedian"], 2.0, v)
                self.assertLessEqual(v["max"], 5.0, v)

    def test_an_uncorrected_run_does_not_drift(self) -> None:
        # One run from serial 730 with no correction but the static push-out:
        # the start state's own rounding carries through, the law adds none.
        for key in SCORED:
            h = self.results["free"][key]["horizontal"]
            with self.subTest(phase=key):
                self.assertLessEqual(h["max"], 10.0, h)

    def test_strafe_right_is_the_servers_right(self) -> None:
        self.assertGreater(self.results["strafeDot"], 0.99)


if __name__ == "__main__":
    unittest.main()
