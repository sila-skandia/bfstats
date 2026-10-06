"""`viewer/world-damage.js`'s per-hull readings under node: the upside-down test
`Armor::update` runs once its one-second bank is full (ledger HP-18) and a hull's
depth under the sea (PHY-16). `world_damage_harness.mjs` builds fake worlds;
the module and everything it imports are the files the page loads.
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
HARNESS = Path(__file__).resolve().parent / "world_damage_harness.mjs"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        # world-damage.js reaches the body world; copy every module.
        for source in VIEWER.glob("*.js"):
            shutil.copyfile(source, work / source.name)
        three = work / "node_modules" / "three"
        three.mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js", three / "three.module.js")
        (three / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        result = subprocess.run(["node", "harness.mjs"], cwd=work,
                                capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise AssertionError(result.stderr[-4000:])
    return json.loads(result.stdout)


class UpsideDownTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_bound_is_the_engines(self) -> None:
        self.assertAlmostEqual(0.3, self.results["cos"])

    def test_a_hull_on_its_roof_or_side_is_upside_down(self) -> None:
        self.assertTrue(self.results["roofAsleep"])
        self.assertTrue(self.results["side"])
        # up.y = cos(75) = 0.26 is under 0.3; cos(70) = 0.34 is not.
        self.assertTrue(self.results["at75"])
        self.assertFalse(self.results["at70"])
        self.assertFalse(self.results["upright"])

    def test_only_a_hull_touching_something_or_asleep_is_billed(self) -> None:
        # Still but awake: no contact fired (`handleCollision` needs a tangent
        # speed over sqrt 0.1) and the root is not asleep yet.
        self.assertFalse(self.results["roofAwakeStill"])
        self.assertTrue(self.results["roofSliding"])
        # A driven root still for 100 ticks is the engine's asleep.
        self.assertEqual(100, self.results["drivenQuietFirstTick"])

    def test_a_hull_flipped_in_the_air_is_not(self) -> None:
        self.assertFalse(self.results["flippedHigh"])

    def test_a_rate_of_a_hundredth_is_off(self) -> None:
        self.assertFalse(self.results["rateOff"])

    def test_near_the_ground_the_tilt_is_against_its_normal(self) -> None:
        # 35 degrees off a 45 degree slope's normal, 10 above the horizon.
        self.assertFalse(self.results["onSlopeLow"])
        self.assertTrue(self.results["onSlopeHigh"])


class SubmersionDepthTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_depth_is_the_root_parts_lowest_vertex_under_the_sea(self) -> None:
        self.assertAlmostEqual(4.0, self.results["depthSunk"])
        self.assertEqual(0, self.results["depthDry"])
        # No `waterPart` on the spec: nothing to measure on.
        self.assertEqual(0, self.results["depthNoPart"])


if __name__ == "__main__":
    unittest.main()
