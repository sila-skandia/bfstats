"""Wind sway of trees: `viewer/tree-foliage.js` and the words
`extract_tree_billboards.py` carries for it.

Retail's rule, read 2026-11-13 (features/tree-foliage-billboards, "Sway"):

    `TreeMesh::realDraw` (client 0x0067daa0) rocks a tree whose template says
    `swayEnable 1` while the camera is within `swayLodDistance` 40 m times the
    view's FOV modifier, at an amplitude `clamp((R^2 - d^2) / (0.7 R)^2)`.
    `Swayer::update` (server symbols 0x083b91d0) is
    `sin(2 pi f t + phase f) * direction * swayRangeDegrees` with
    `f = 0.2 * speed`, speed rolled per tree in (1, 1.4], and a second sine
    scaled by `swayWindFactor`, 0 unless a script sets it.

Runs `node tree_sway_harness.mjs`.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "tree_sway_harness.mjs"
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from extract_tree_billboards import sway_settings  # noqa: E402

CON = """
GeometryTemplate.create TreeMesh EU_pine1_M1
GeometryTemplate.file EU_pine1_M1
GeometryTemplate.billboard 1
GeometryTemplate.billboardDistance 50
GeometryTemplate.swayEnable 1
GeometryTemplate.swayRangeDegrees 1.1

GeometryTemplate.create TreeMesh EU_Oak_M1
GeometryTemplate.file EU_Oak_M1
GeometryTemplate.swayRangeDegrees 3

GeometryTemplate.create TreeMesh Bare_M1
GeometryTemplate.swayEnable 1

GeometryTemplate.create TreeMesh Windy_M1
GeometryTemplate.swayEnable 1
GeometryTemplate.swayPeriodSeconds 0.5
GeometryTemplate.swayWindFactor 0.25
GeometryTemplate.swayDirection 1/0
GeometryTemplate.swayForceRangeDegrees 10

GeometryTemplate.create StandardMesh Crate_M1
GeometryTemplate.swayEnable 1
"""


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not (ROOT / "node_modules" / "three").exists():
        raise unittest.SkipTest("three is not installed under tools/bf1942-models")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SwayWordTests(unittest.TestCase):
    def test_only_a_tree_that_enables_sway_gets_an_entry(self) -> None:
        words = sway_settings(CON)
        self.assertEqual(sorted(words), ["bare_m1", "eu_pine1_m1", "windy_m1"])

    def test_the_words_a_block_sets_are_carried_and_no_others(self) -> None:
        words = sway_settings(CON)
        self.assertEqual(words["eu_pine1_m1"], {"rangeDegrees": 1.1})
        self.assertEqual(words["bare_m1"], {})
        self.assertEqual(words["windy_m1"],
                         {"periodSeconds": 0.5, "windFactor": 0.25, "direction": [1.0, 0.0]})


class TreeSwayTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_renderer_and_template_constants_are_retails(self) -> None:
        c = self.results["constants"]
        self.assertEqual(c["lodDistance"], 40)            # 0x42200000 at 0x0064ca98
        self.assertEqual(c["fadeFactor"], 0.7)            # 0x3f333333 at 0x0064ca9f
        self.assertEqual(c["rangeDegrees"], 1)            # 0x3f800000 at 0x083bc3ed
        self.assertEqual(c["periodSeconds"], 0.2)         # 0x3e4ccccd at 0x083bc3e2
        self.assertEqual(c["windFactor"], 0)              # 0x083bc3f8
        self.assertEqual((c["speedBase"], c["speedSpread"]), (1, 0.4))  # 0x086c4f70

    def test_the_amplitude_is_full_to_0_714_of_the_range_and_gone_at_it(self) -> None:
        f = self.results["fade"]
        self.assertEqual(f["at0"], 1)
        self.assertEqual(f["at28"], 1)                    # 28 < 40 * sqrt(1 - 0.49) = 28.57
        self.assertAlmostEqual(f["at30"], (1600 - 900) / 784)
        self.assertAlmostEqual(f["at35"], (1600 - 1225) / 784)
        self.assertEqual(f["at40"], 0)
        self.assertEqual(f["at41"], 0)

    def test_a_zoomed_lens_carries_the_range_out(self) -> None:
        f = self.results["fade"]
        self.assertAlmostEqual(f["zoomed60"], f["at30"])
        self.assertEqual(f["zoomed81"], 0)

    def test_the_angle_is_one_sine_at_a_fifth_of_a_hertz_times_the_trees_speed(self) -> None:
        law = self.results["law"]
        self.assertAlmostEqual(law["quarter"]["x"], 1.1)
        self.assertAlmostEqual(law["half"]["x"], 0)
        self.assertAlmostEqual(law["threeQuarter"]["x"], -1.1)
        self.assertEqual(law["quarter"]["z"], 0)

    def test_the_fade_scales_the_angle(self) -> None:
        self.assertAlmostEqual(self.results["law"]["faded"]["x"], 1.1 * 0.25)

    def test_the_phase_is_multiplied_by_the_frequency(self) -> None:
        # phase 2 pi at f = 0.25 is a quarter turn, not a whole one.
        self.assertAlmostEqual(self.results["law"]["phased"]["x"], 1.1)

    def test_the_direction_splits_the_angle_between_the_two_axes(self) -> None:
        d = self.results["law"]["diagonal"]
        self.assertAlmostEqual(d["x"], 1.1 * 0.6)
        self.assertAlmostEqual(d["z"], 1.1 * 0.8)

    def test_the_second_sine_needs_a_wind_factor(self) -> None:
        w = self.results["law"]["wind"]
        self.assertAlmostEqual(w["x"], 0)
        self.assertAlmostEqual(w["z"], 1.1 * 0.5)

    def test_a_template_takes_the_constructors_value_for_a_word_it_omits(self) -> None:
        t = self.results["templates"]
        self.assertEqual(t["pine"]["rangeDegrees"], 1.1)
        self.assertEqual(t["bare"]["rangeDegrees"], 1)
        self.assertEqual(t["bare"]["frequency"], 0.2)
        self.assertEqual(t["bare"]["windFactor"], 0)
        self.assertAlmostEqual(t["pine"]["unit"], 1)

    def test_a_templates_direction_is_the_same_on_every_load(self) -> None:
        t = self.results["templates"]
        self.assertEqual(t["pine"]["dirX"], t["pineAgain"]["dirX"])
        self.assertEqual(t["pine"]["dirZ"], t["pineAgain"]["dirZ"])

    def test_a_scripted_direction_is_normalised_with_its_perpendicular(self) -> None:
        s = self.results["templates"]["set"]
        self.assertAlmostEqual(s["dirX"], 0.6)
        self.assertAlmostEqual(s["dirZ"], 0.8)
        self.assertAlmostEqual(s["perpX"], -0.8)
        self.assertAlmostEqual(s["perpZ"], 0.6)
        self.assertEqual(s["frequency"], 0.5)
        self.assertLessEqual(s["forceFrequency"], 0.5 * 0.5)

    def test_a_trees_rolls_are_in_the_engines_ranges_and_fixed_by_its_place(self) -> None:
        r = self.results["rolls"]
        self.assertGreater(r["minSpeed"], 1)
        self.assertLessEqual(r["maxSpeed"], 1.4)
        self.assertGreater(r["minPhase"], 0)
        self.assertLessEqual(r["maxPhase"], 2 * math.pi)
        self.assertTrue(r["same"])
        self.assertTrue(r["differs"])

    def test_a_near_tree_rocks_about_its_trunk_base_by_at_most_its_range(self) -> None:
        s = self.results["scene"]
        self.assertEqual(s["swaying"], 1)
        self.assertGreater(s["near"], 0.01)
        self.assertLess(s["base"], 1e-6)
        self.assertLessEqual(s["tilt"], 1.1 + 1e-3)
        self.assertGreater(s["tilt"], 0.5)

    def test_a_tree_whose_template_does_not_sway_stands_still(self) -> None:
        self.assertEqual(self.results["scene"]["oakNear"], 0)

    def test_a_tree_past_the_range_is_put_back(self) -> None:
        self.assertEqual(self.results["scene"]["far"], 0)

    def test_the_renderer_switch_stills_every_tree(self) -> None:
        self.assertEqual(self.results["scene"]["switchedOff"], 0)


if __name__ == "__main__":
    unittest.main()
