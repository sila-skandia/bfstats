"""The submarine's HUD feed (`viewer/submarine-hud.js`) and the painter's
submarine pieces (`viewer/hud.js` `evalExpr`, `shiftOf`,
`scrollPictureBand`), driven headless by `submarine_hud_harness.mjs`.

The rules are `dice::bf::menu::Submarine::updateSubmarineData` and
`BfScrollPictureNode::onPaint` as the Mac client's symbols name them, and
`menu/InGame`'s own fade nodes (ledger SUB-1..SUB-4). The Gato's numbers are
her `Objects.con`: `submarineData 0.009 0.03 1 10 19.5 40 5`,
`setSubmarineHudDepthModifier 5.9`, `setSubmarineHudDirModifier 0.01`.
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
HARNESS = Path(__file__).with_name("submarine_hud_harness.mjs")
MODULES = {"submarine-hud.js": VIEWER / "submarine-hud.js", "hud.js": VIEWER / "hud.js"}


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
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SubmarineHudTests(unittest.TestCase):
    out: dict = {}

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    # -- which hulls ------------------------------------------------------------

    def test_the_gato_is_a_submarine_and_a_crush_word_on_a_tank_is_not(self) -> None:
        self.assertEqual({"gato": True, "m1a1": False, "none": False}, self.out["isSubmarine"])
        self.assertIsNone(self.out["offSpec"])
        spec = self.out["spec"]
        self.assertEqual((spec["periscopeMax"], spec["crushDepth"], spec["depthModifier"]), (19.5, 40, 5.9))

    # -- updateSubmarineData's numbers ----------------------------------------

    def test_the_depth_is_under_water_less_the_hud_modifier(self) -> None:
        self.assertAlmostEqual(self.out["surface"]["Submarine/Depth"], 7.85 - 5.9, places=9)
        self.assertEqual(self.out["belowSurface"]["Submarine/Depth"], 0)

    def test_the_gauge_scale_is_the_water_under_her(self) -> None:
        deep = self.out["deepInDeepWater"]
        self.assertEqual(deep["Submarine/WaterDepth"], 60.9)
        self.assertEqual(deep["Submarine/MaximumDepth"], 60)

    def test_the_crush_mark_is_out_of_reach_in_shallow_water(self) -> None:
        # 40 m crush in 20 m of water: 9999, less the modifier.
        self.assertAlmostEqual(self.out["surface"]["Submarine/MaxDepth"], 9999 - 5.9, places=9)
        self.assertAlmostEqual(self.out["deepInDeepWater"]["Submarine/MaxDepth"], 40 - 5.9, places=9)
        # A crush depth of -1 is the water column itself.
        self.assertAlmostEqual(self.out["noCrushSpec"]["Submarine/MaxDepth"], 33 - 5.9, places=9)

    def test_the_wanted_depth_is_held_to_three_quarters_of_the_water(self) -> None:
        self.assertEqual(self.out["deepInDeepWater"]["Submarine/WantedDepth"], 45)
        self.assertEqual(self.out["shallowSetpoint"]["Submarine/WantedDepth"], 15)

    def test_air_and_bearing(self) -> None:
        self.assertEqual(self.out["deepInDeepWater"]["Submarine/Oxygen"], 45)
        self.assertAlmostEqual(self.out["deepInDeepWater"]["Submarine/DirectionAngle"], 0.49, places=9)
        self.assertEqual(self.out["surface"]["Submarine/PeriscopeDepth"], 10)

    # -- the periscope and the deep HUD -----------------------------------------

    def test_the_periscope_is_up_no_deeper_than_the_fifth_float(self) -> None:
        rows = {r["depth"]: r for r in self.out["latch"]}
        self.assertTrue(rows[19.5]["periscope"])
        latch = self.out["latch"]
        self.assertFalse(latch[2]["periscope"])   # 19.6

    def test_the_deep_hud_lets_go_half_a_metre_above_where_it_went_under(self) -> None:
        latch = self.out["latch"]
        # Went under at 19.6; holds at 19.5 and 19.2 on the way up; lets go,
        # and closes the map, at 19.09 (19.6 - 19.09 > 0.5).
        self.assertEqual([r["deep"] for r in latch], [False, False, True, True, True, True, False, False])
        self.assertEqual([r["closeMap"] for r in latch], [False] * 6 + [True, False])

    def test_the_black_fade_follows_menu_ingame(self) -> None:
        frames = [f for f in self.out["fade"] if f["t"] != "up"]
        first_black = next(f["t"] for f in frames if f["alpha"] > 0)
        full = next(f for f in frames if f["cockpit"])
        cleared = next(f["t"] for f in frames if f["cockpit"] and f["alpha"] == 0)
        # 0.3 s wait, then 0.5 s up: the first black on the frame after the
        # wait runs out, full at 0.8 s.
        self.assertAlmostEqual(first_black, 0.3333, places=3)
        self.assertAlmostEqual(full["t"], 0.8, places=3)
        self.assertEqual(full["alpha"], 1)
        self.assertTrue(full["openMap"])
        self.assertEqual(sum(1 for f in frames if f["openMap"]), 1)
        # Held 1 s, then 0.5 s down: clear by 2.3 s, a frame or so later at
        # 30 frames a second.
        self.assertAlmostEqual(cleared, 2.3, delta=2 / 30)
        up = self.out["fade"][-1]
        self.assertEqual((up["alpha"], up["cockpit"]), (0, False))

    def test_the_feed_end_to_end(self) -> None:
        self.assertEqual({"show": True, "periscope": True, "deep": False, "kit": 0}, self.out["feedSurface"])
        self.assertFalse(self.out["feedThirdPerson"])
        self.assertEqual({"periscope": False, "deep": True, "cockpit": True, "map": [True]}, self.out["feedDeep"])
        self.assertEqual({"deep": False, "cockpit": False, "map": [True, False]}, self.out["feedUp"])
        self.assertEqual({"show": False, "depth": None, "map": [True, False]}, self.out["feedOut"])

    # -- the painter --------------------------------------------------------------

    def test_expressions_and_shifts(self) -> None:
        self.assertEqual(self.out["expr"], 10 / 40 * 64)
        self.assertEqual(self.out["exprDivZero"], 0)
        self.assertEqual(self.out["shift"], [-21, 0])

    def test_the_tape_slides_and_its_copies_clip_at_their_depths(self) -> None:
        band = self.out["band"]
        # 10 m on a 40 m scale: 527 - 10 x 256/40 - 10/5.
        self.assertEqual(band["tape"], {"top": 461, "clipTop": 527, "clipHeight": 64})
        # Green: (10 - 10) x 2.8 + 32 of the window from its top.
        self.assertEqual(band["green"], {"top": 461, "clipTop": 527, "clipHeight": 32})
        # Red at 10 m against a 34.1 m crush: (24.1 x 2.8 + 32) is past the
        # 64 px window, so none shows; nor green 20 m under periscope depth.
        self.assertIsNone(band["red"])
        self.assertIsNone(band["greenDeep"])
        self.assertIsNone(band["redShallow"])
        self.assertIsNone(band["noMax"])


if __name__ == "__main__":
    unittest.main()
