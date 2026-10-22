"""The page's aircraft on its wheels against the BF1942 dedicated server's, per tick.

`air_law_harness.mjs` replays the input words `lab/veh_law_probe.mjs` sent a
real server (vanilla Wake, 2026-10-22/23) through `viewer/aircraft.js` and
measures the page's airframe against the server's at every acknowledged
serial, the server's position, rotation, velocity and omega put back at every
ack as the hull reconciler does:

- the SBD on the airfield's terrain: a straight takeoff roll from the pad to
  36 m/s (`takeoff`), and a taxi with rudder each way with and without
  throttle (`taxi`);
- the Aichi Val and the Zero on the Shokaku's flight deck (`deck`), held by
  their spawner until the revs reach 0.1, then a run with rudder each way.

The law is AIRGND-1..AIRGND-5 (`features/bf1942-engine-reference/ledger.md`,
`viewer/aircraft-ground-law.js`): the three `Spring` wheels as TANK-19, the
root's one Euler step and sleep as TANK-21/TANK-22, each awake wheel's col0
vertex 0 pushed out of the terrain or the deck's col0 faces, and
`addFriction`'s RollGrip arm along the (steered) axle. The `clamp` mode is the
page before it: the ride-height clamp, `settle` and `groundFriction`.

Thresholds, per acknowledged tick: horizontal median at most 1.5 mm and worst
at most 10 mm in every phase, vertical median at most 3 mm; the law at least
fifty times closer vertically than the clamp it replaced on the ground. The
vertical residual left above about 8 m/s is the wings' (features/aircraft-
ground-law, "Open"), and the 16 mm worst on a deck is the spawner's release
tick.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
HARNESS = HERE / "air_law_harness.mjs"
RUNS = {
    "SBD": ("air_law_sbd_wake.json.gz", "air_law_sbd_terrain.json.gz"),
    "AichiVal": ("air_law_val_wake.json.gz", "air_law_val_terrain.json.gz"),
    "Zero": ("air_law_zero_wake.json.gz", "air_law_zero_terrain.json.gz"),
}
# Phases on the ground that the clamp comparison scores (the deck runs' last
# phase leaves the deck, the takeoff run's release lifts off).
GROUND = {"idle", "throttle", "throttle+right", "throttle+left", "right", "left"}


def run_harness(template: str) -> dict:
    fixture, terrain = RUNS[template]
    proc = subprocess.run(["node", str(HARNESS), str(FIXTURES / fixture), str(FIXTURES / terrain)],
                          capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class AirLawTests(unittest.TestCase):
    results: dict = {}

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = {t: run_harness(t) for t in RUNS}

    def test_every_airframe_stands_on_its_three_springs(self) -> None:
        for template, r in self.results.items():
            self.assertEqual(r["wheels"], 3, template)

    def test_each_acked_tick_is_within_a_millimetre_or_two(self) -> None:
        for template, r in self.results.items():
            for run, modes in r["runs"].items():
                for phase, e in modes["acked"].items():
                    with self.subTest(template=template, run=run, phase=phase):
                        self.assertGreater(e["horizontal"]["n"], 0)
                        self.assertLessEqual(e["horizontal"]["median"], 1.5)
                        self.assertLessEqual(e["horizontal"]["max"], 10.0)
                        self.assertLessEqual(e["vertical"]["median"], 3.0)
                        self.assertLessEqual(e["yaw"]["max"], 0.05)

    def test_the_law_replaces_a_clamp_half_a_metre_off(self) -> None:
        for template, r in self.results.items():
            for run, modes in r["runs"].items():
                for phase, e in modes["acked"].items():
                    if phase not in GROUND or phase not in modes["clamp"]:
                        continue
                    with self.subTest(template=template, run=run, phase=phase):
                        clamp = modes["clamp"][phase]["vertical"]["median"]
                        self.assertGreater(clamp, 50.0)
                        self.assertLess(e["vertical"]["median"] * 50, clamp)

    def test_a_parked_deck_plane_is_held_exactly(self) -> None:
        for template in ("AichiVal", "Zero"):
            idle = self.results[template]["runs"]["deck"]["acked"]["idle"]
            self.assertEqual(idle["horizontal"]["max"], 0.0, template)
            self.assertEqual(idle["vertical"]["max"], 0.0, template)


if __name__ == "__main__":
    unittest.main()
