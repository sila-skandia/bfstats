"""The dogfight school's theatre draws its planes the game's way
(features/dogfight-school, "The planes' own propellers and tracers"): the
propeller turned on the revs each flight records, by the engine's own tail,
and the guns' own tracer streak on every interval-th round of the gun's real
rate, sized as the engine sizes it.

`dogfight_plane_look.mjs` runs after the head of `dogfight_school_harness.mjs`
and prints the measurements.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_dogfight_school import HARNESS, MODULES, THREE_PACKAGE
from test_flight import VIEWER

LOOK = Path(__file__).resolve().parent / "dogfight_plane_look.mjs"
LOOK_MODULES = {
    **MODULES,
    "dogfight-plane-look.js": VIEWER / "dogfight-plane-look.js",
    "engine-spin.js": VIEWER / "engine-spin.js",
    "round-visuals.js": VIEWER / "round-visuals.js",
}


def run_look() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[: head.index("const out = {};")]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in LOOK_MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "look.mjs").write_text(head + "\n" + LOOK.read_text())
        proc = subprocess.run(["node", str(work / "look.mjs")],
                              capture_output=True, text=True, timeout=300, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"plane look harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class PlaneLookTests(unittest.TestCase):
    look: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.look = run_look()

    def test_every_tick_of_a_flight_records_the_propellers_revs(self) -> None:
        revs = self.look["revs"]
        self.assertEqual(revs["n"], revs["finite"], revs)
        # A fighter flying a fight runs its engine past the disc's 0.08^2.
        self.assertGreater(revs["min"], 0.0064, revs)
        self.assertLessEqual(revs["max"], 1.2, revs)

    def test_a_tracer_on_every_interval_th_round_of_the_guns_real_rate(self) -> None:
        # 12 rounds a second, every third a tracer: 4 in a second's burst;
        # every round a tracer: 12. The duel's 30 a tick are not drawn.
        self.assertEqual([4, 12], self.look["cadence"])

    def test_the_propeller_turns_on_its_revs_and_blurs_past_the_comparison(self) -> None:
        props = self.look["props"]
        self.assertEqual(1, props["pairs"])
        # 0.005 revs: under 0.08^2, the blades, 400 x 0.005 = 2 degrees a tick.
        self.assertEqual({"disc": False, "blades": True, "turned": 6}, props["slow"])
        # Full revs: the disc, 20 degrees a tick, three ticks.
        self.assertEqual({"disc": True, "blades": False, "turned": 60}, props["fast"])
        # Paused, it holds.
        self.assertEqual(60, props["paused"])

    def test_the_streak_is_the_guns_own_mesh_sized_as_the_engine_sizes_it(self) -> None:
        t = self.look["tracer"]
        self.assertEqual((12, 3), (t["rate"], t["interval"]))
        self.assertTrue(t["visible"])
        # 400 m/s over tracerScaler 50: an 8 m streak, 10x across (TRC-1),
        # its tail grown out of the muzzle over the first metres.
        self.assertEqual(8, t["length"])
        self.assertEqual([10, 10, 4], t["young"])
        self.assertEqual([10, 10, 8], t["grown"])
        # The tail trails behind the round, back up the line of fire.
        self.assertGreater(t["tailZ"], -200)
        # Far off it is held at a couple of pixels and dimmed by as much.
        self.assertGreater(t["far"]["across"], 10)
        self.assertLess(t["far"]["opacity"], 0.9)
        # A drawn fighter with no guns of its own gets the stand-in.
        self.assertTrue(t["standIn"])


if __name__ == "__main__":
    unittest.main()
