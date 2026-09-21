"""`viewer/bfmap.js` -- the HUD minimap's zoom and rotation, driven headless by
`bfmap_harness.mjs`.

The module reproduces the engine's `BfMap` zoom and rotation law, read out of
the client (BF1942.exe, sha256 60c9452d...cd3699) and confirmed by a second
reader (W4-F, 2026-09-21). The addresses the module's header carries:

  * `N` (`c_PIZoomMap`) steps a 3-value counter; the HUD frame writes
    `BfMap+0x48 = level + 0.5`.
  * `BfMap+0x44` eases toward `+0x48` at rate 6 (`BfMap__animate` 0x00468fb0),
    and the texture crop is `pow(2.3, (1 - z) * [+0x44])`, where the 2.3 is a
    DOUBLE at 0x008d62a0 (2.2999999523...), not a float.
  * The displayed rotation `+0x64` is recomputed every frame with no easing as
    `(1 - z) * wrapped(+0x68)` (the shorter +-2*PI winding); with the static
    byte `+0x58` set (`game.setStaticMinimap 1`, the shipped default) the map
    stays north-up.

So the closed minimap crops by 2.3^(level+0.5) at steady state -- a factor of
2.3 between each of the three levels -- and the open spawn map crops by 1
(whole map) whatever the level.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("bfmap_harness.mjs")
MODULES = {"bfmap.js": VIEWER / "bfmap.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BfMapTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # ---- the constants -----------------------------------------------------

    def test_the_engine_constants(self) -> None:
        c = self.results["constants"]
        self.assertAlmostEqual(2.3, c["cropBase"], places=6)
        self.assertEqual(6, c["zoomEaseRate"])
        self.assertEqual(3, c["zoomLevels"])
        self.assertAlmostEqual(0.25, c["defaultSpan"], places=6)

    # ---- the zoom counter --------------------------------------------------

    def test_n_steps_three_levels_and_wraps(self) -> None:
        s = self.results["step"]
        self.assertEqual(1, s["from0"])
        self.assertEqual(2, s["from1"])
        self.assertEqual(0, s["from2"])
        self.assertEqual([1, 2, 0, 1], s["wrap"])

    def test_the_hud_frame_writes_level_plus_half(self) -> None:
        t = self.results["target"]
        self.assertAlmostEqual(0.5, t["l0"], places=6)
        self.assertAlmostEqual(1.5, t["l1"], places=6)
        self.assertAlmostEqual(2.5, t["l2"], places=6)

    # ---- the +0x44 ease ----------------------------------------------------

    def test_the_easy_is_a_pure_exponential_at_rate_six(self) -> None:
        e = self.results["ease"]
        # One frame of 1/60 s closes (1 - e^(-6/60)) of the gap.
        self.assertAlmostEqual(1 - math.exp(-6 / 60), e["oneFrame"], places=9)
        # After a whole second, 1 - e^-6 of the way.
        self.assertAlmostEqual(1 - math.exp(-6), e["afterOneSecond"], places=9)
        # Stepping a second in 60th-second frames lands within a frame of it.
        self.assertAlmostEqual(1 - math.exp(-6), e["stepped"], places=2)

    def test_a_junk_timestep_holds_the_value(self) -> None:
        e = self.results["ease"]
        self.assertEqual(0.3, e["zeroDt"])
        self.assertEqual(0.3, e["negDt"])
        self.assertEqual(0.3, e["nanDt"])

    # ---- the crop ----------------------------------------------------------

    def test_the_closed_minimap_crops_by_base_to_level_plus_half(self) -> None:
        c = self.results["crop"]
        self.assertAlmostEqual(2.3 ** 0.5, c["closedL0"], places=9)
        self.assertAlmostEqual(2.3 ** 1.5, c["closedL1"], places=9)
        self.assertAlmostEqual(2.3 ** 2.5, c["closedL2"], places=9)

    def test_the_ratio_between_adjacent_levels_is_the_base(self) -> None:
        c = self.results["crop"]
        self.assertAlmostEqual(2.3, c["ratio01"], places=6)
        self.assertAlmostEqual(2.3, c["ratio12"], places=6)

    def test_the_open_spawn_map_crops_by_one_whatever_the_level(self) -> None:
        # z = 1 -> (1 - z) = 0 -> crop 1: the whole map, which is why the zoom
        # only ever shows on the closed widget.
        c = self.results["crop"]
        self.assertAlmostEqual(1.0, c["openL0"], places=9)
        self.assertAlmostEqual(1.0, c["openL2"], places=9)

    # ---- the span (closed widget) -----------------------------------------

    def test_level_zero_is_the_anchor_and_levels_step_by_the_base(self) -> None:
        s = self.results["span"]
        self.assertAlmostEqual(0.25, s["l0"], places=9)
        self.assertAlmostEqual(0.25 / 2.3, s["l1"], places=9)
        self.assertAlmostEqual(0.25 / 2.3 ** 2, s["l2"], places=9)
        self.assertAlmostEqual(2.3, s["ratio01"], places=6)
        self.assertAlmostEqual(2.3, s["ratio12"], places=6)

    def test_a_custom_base_keeps_the_anchor_and_the_steps(self) -> None:
        s = self.results["span"]
        # Anchoring level 0 to a base of 1 keeps the 2.3 steps from there.
        self.assertAlmostEqual(1.0, s["customBaseL0"], places=9)
        self.assertAlmostEqual(1.0 / 2.3, s["customBaseL1"], places=9)

    # ---- the rotation ------------------------------------------------------

    def test_wrap_angle_takes_the_shorter_winding(self) -> None:
        w = self.results["wrap"]
        self.assertAlmostEqual(0.0, w["zero"], places=9)
        self.assertAlmostEqual(math.pi, w["pi"], places=9)
        self.assertAlmostEqual(-math.pi, w["negPi"], places=9)
        self.assertAlmostEqual(-(math.pi - 0.1), w["pastPi"], places=9)
        self.assertAlmostEqual(0.0, w["twoTurns"], places=9)
        self.assertAlmostEqual(-math.pi / 2, w["threeHalf"], places=9)

    def test_static_is_always_north_up(self) -> None:
        # The shipped default: every stock profile sets game.setStaticMinimap 1.
        r = self.results["rotation"]
        self.assertEqual(0.0, r["staticClosed"])
        self.assertEqual(0.0, r["staticOpen"])

    def test_non_static_follows_the_heading_with_no_easing(self) -> None:
        r = self.results["rotation"]
        # Closed (z = 0): -1 * wrapped(heading).
        self.assertAlmostEqual(-1.0, r["closed"], places=9)
        # Open (z = 1): north-up, because (1 - z) = 0.
        self.assertAlmostEqual(0.0, r["open"], places=9)
        # Mid-transition (z = 0.5): half the heading.
        self.assertAlmostEqual(-0.5, r["half"], places=9)
        # The heading is wrapped to the shorter winding first: PI + 0.1 wraps
        # to -(PI - 0.1), and the display rotation negates that.
        self.assertAlmostEqual(math.pi - 0.1, r["wrappedHeading"], places=9)
        self.assertAlmostEqual(0.5, r["neg"], places=9)

    # ---- the state machine -------------------------------------------------

    def test_the_widget_opens_settled_at_level_zero(self) -> None:
        s = self.results["state"]["initial"]
        self.assertEqual(0, s["level"])
        self.assertAlmostEqual(0.5, s["eased"], places=9)
        self.assertAlmostEqual(0.25, s["span"], places=9)
        self.assertTrue(s["static"])

    def test_three_n_presses_wrap_the_counter(self) -> None:
        levels = self.results["state"]["cycleLevels"]
        # Start at 0, then 1, 2, and back to 0.
        self.assertEqual([0, 1, 2, 0], levels)

    def test_the_settled_spans_step_by_the_base(self) -> None:
        spans = self.results["state"]["settled"]
        self.assertAlmostEqual(0.25, spans[0], places=5)
        self.assertAlmostEqual(0.25 / 2.3, spans[1], places=5)
        self.assertAlmostEqual(0.25 / 2.3 ** 2, spans[2], places=5)

    def test_the_static_flag_gates_the_rotation(self) -> None:
        s = self.results["state"]
        self.assertEqual(0.0, s["rotationStatic"])
        self.assertAlmostEqual(-1.0, s["rotationDynamic"], places=9)
        # setStatic(true) on a dynamic map restores north-up.
        self.assertEqual(0.0, s["setStatic"])


if __name__ == "__main__":
    unittest.main()
