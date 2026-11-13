"""The even frame cadence remaster mode keeps (viewer/frame-pacer.js).

A page whose frames cost between one and two display refreshes shows some
for one refresh and some for two, in no order, which reads as stutter. The
pacer draws on every second refresh instead. The harness runs it against a
simulated display.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "frame_pacer_harness.mjs"


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class FramePacerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        out = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, check=True)
        cls.r = json.loads(out.stdout)

    def even(self, case: str, gap: str) -> None:
        self.assertEqual([gap], list(self.r[case]["gaps"]), case)

    def test_a_fast_page_is_left_on_every_refresh(self) -> None:
        self.assertEqual(1, self.r["proMotionFast"]["divisor"])
        self.even("proMotionFast", "8.33")
        self.assertEqual(1, self.r["sixtyFast"]["divisor"])
        self.even("sixtyFast", "16.67")

    def test_frames_that_straddle_the_refresh_are_drawn_on_every_second_one(self) -> None:
        # 7 and 10 ms frames at 120 Hz: 8 and 17 ms on screen in no order
        # without it, an even 60 with it.
        self.assertEqual(2, self.r["proMotionMixed"]["divisor"])
        self.even("proMotionMixed", "16.67")
        self.assertEqual(60, self.r["proMotionMixed"]["fps"])

    def test_frames_that_all_overrun_are_already_even(self) -> None:
        self.assertEqual(1, self.r["proMotionSlow"]["divisor"])
        self.even("proMotionSlow", "16.67")
        self.even("heavy", "33.33")

    def test_one_late_frame_in_six_does_not_cost_the_page_half_its_rate(self) -> None:
        self.assertEqual(1, self.r["sixtyOccasional"]["divisor"])
        self.assertEqual([], self.r["sixtyOccasional"]["changes"])

    def test_half_the_frames_late_at_sixty_is_an_even_thirty(self) -> None:
        self.assertEqual(2, self.r["sixtyHalf"]["divisor"])
        self.even("sixtyHalf", "33.33")

    def test_it_lets_go_when_the_frames_get_cheap(self) -> None:
        self.assertEqual([2, 1], self.r["recovers"]["changes"])
        self.even("recovers", "8.33")

    def test_it_does_not_swing_when_the_cost_sits_on_the_refresh(self) -> None:
        self.assertEqual([2], self.r["hovering"]["changes"])
        self.even("hovering", "16.67")


class WiringTests(unittest.TestCase):
    """Where the page asks it, read from the source."""

    def setUp(self) -> None:
        self.page = (HERE.parent / "viewer" / "map.html").read_text(encoding="utf-8")

    def test_only_remaster_mode_is_paced(self) -> None:
        self.assertIn("const framePacer = REMASTER &&", self.page)

    def test_a_rig_measures_raw_frames_unless_it_asks(self) -> None:
        self.assertIn("renderQuery.has('pace') ? renderQuery.get('pace') !== '0' : !renderQuery.has('shots')", self.page)

    def test_a_take_is_never_held_back(self) -> None:
        self.assertIn("if (framePacer && !framePacer.gate(now) && !filming) return;", self.page)


if __name__ == "__main__":
    unittest.main()
