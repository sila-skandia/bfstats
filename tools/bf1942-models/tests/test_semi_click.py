"""A semi-auto's click is taken on its own tick, or not at all, as the server does.

On the lab (`lab/mag_cycle_probe.mjs` with `PHASES=semi`, a REC_FIRE_INDEX
recorder, vanilla Wake), a sidecar soldier's Colt (`roundOfFire 6`, a 6-tick
cycle) fired one round for a press held 2 s; nothing for a one-word tap 3 or
5 ticks after a round; nothing for a press 2 ticks after a round held 13
ticks past the cycle's end; and, tapped every 2 ticks, a round every 6 ticks
on the taps that landed on a ready tick. `FireArms::handleMessage` 0x082895c0
refuses the fire message while the fire timer runs (GUN-18), and the press
is not taken again when it runs out.

The page banked a click across the cycle and fired it when the cycle ended,
a round (and a magazine round) the server never fired. A click shorter than
a frame also fired the page's round while the input word, which read the
held button only, carried no Fire bit. `semi_click_harness.mjs` drives
`hand-fire.js` over a stub page at 30 and 60 fps and builds each tick's
word as local-player.js does.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("semi_click_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SemiClickTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def each(self, name):
        for rate, run in self.results[name].items():
            with self.subTest(name=name, rate=rate):
                yield run

    def test_a_tap_inside_the_cycle_fires_nothing(self) -> None:
        for name in ("tapThenTap3", "tapThenTap5"):
            for run in self.each(name):
                self.assertEqual([10], run["rounds"])

    def test_a_tap_on_the_ready_tick_fires(self) -> None:
        for run in self.each("tapThenTap6"):
            self.assertEqual([10, 16], run["rounds"])

    def test_a_press_inside_the_cycle_held_past_it_fires_nothing(self) -> None:
        for run in self.each("tapThenHeld"):
            self.assertEqual([10], run["rounds"])

    def test_taps_every_two_ticks_fire_on_the_cycle(self) -> None:
        for run in self.each("tapsEvery2"):
            self.assertEqual([10, 16, 22, 28], run["rounds"])
            # Each tap is its own word: the server sees every press.
            self.assertEqual(list(range(10, 33, 2)), run["wires"])

    def test_every_round_the_page_fires_is_on_a_word_with_the_fire_bit(self) -> None:
        for name in self.results:
            for run in self.each(name):
                self.assertTrue(set(run["rounds"]) <= set(run["wires"]), run)

    def test_a_click_shorter_than_a_frame_reaches_the_server(self) -> None:
        run = self.results["quickClick"]["fps60"]
        self.assertEqual([11], run["rounds"])
        self.assertEqual([11], run["wires"])


if __name__ == "__main__":
    unittest.main()
