"""The page's own hand-weapon round leaves on the tick whose word first carried
the press.

A real BF1942 server fires a press on the first input word that carries it
(features/udp-sidecar/wire.md section 42, measured on the lab 2026-10-24: of 11
headless taps through a sidecar, 7 left the page a tick after the server's
round of the same press). The page sampled the word, stepped the world, and
only then, in the frame's presentation, set the hand weapon's group firing, so
a press made in a frame that ran N ticks fired N ticks late. `map.html`
`frame()` now runs `hand-fire.js` `footTrigger` between the input phase and
the world's step.

`hand_trigger_tick_harness.mjs` drives `hand-fire.js` over a stub page in that
frame order with the gun's real per-tick cycle (`gun-cycle.js`
`advanceGroups`), and in the old order beside it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "hand_trigger_tick_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def gaps(rounds: list[int]) -> set[int]:
    return {b - a for a, b in zip(rounds, rounds[1:])}


class HandTriggerTickTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()
        cls.new = cls.r["new"]
        cls.old = cls.r["old"]

    def test_a_press_in_a_two_tick_frame_fires_on_the_first_of_them(self) -> None:
        run = self.new["rifleTwoTickFrame"]
        self.assertEqual(run["rounds"], run["presses"])
        # The old order fired it on the next frame's first tick, two late.
        old = self.old["rifleTwoTickFrame"]
        self.assertEqual(old["rounds"][0] - old["presses"][0], 2)

    def test_a_press_in_a_frame_with_no_tick_fires_on_the_next_tick(self) -> None:
        run = self.new["rifleZeroTickFrame"]
        self.assertEqual(run["rounds"], run["presses"])
        # Its frame runs no tick, so the press's word is the next tick's.
        self.assertEqual(run["frameTicks"][10], 0)

    def test_a_press_in_a_one_tick_frame_fires_on_that_tick(self) -> None:
        run = self.new["rifleOneTickFrame"]
        self.assertEqual(run["frameTicks"][11], 1)
        self.assertEqual(run["rounds"], run["presses"])
        old = self.old["rifleOneTickFrame"]
        self.assertEqual(old["rounds"][0] - old["presses"][0], 1)

    def test_a_semi_auto_click_is_exactly_one_round(self) -> None:
        # A one-tick cycle in a two-tick frame: the pulse lets go on its round.
        self.assertEqual(self.r["fireTicks"]["fastSemi"], 1)
        run = self.new["fastSemiTwoTickFrame"]
        self.assertEqual(run["rounds"], run["presses"])
        # Held through fifteen two-tick frames: still the one press, one round.
        held = self.new["fastSemiHeld"]
        self.assertEqual(len(held["presses"]), 1)
        self.assertEqual(held["rounds"], held["presses"])

    def test_spammed_clicks_keep_the_rifles_cycle(self) -> None:
        run = self.new["rifleSpam"]
        self.assertEqual(run["rounds"][0], run["presses"][0])
        self.assertEqual(gaps(run["rounds"]), {self.r["fireTicks"]["rifle"]})

    def test_a_held_automatic_keeps_its_cadence(self) -> None:
        for name, weapon in (("smgHeld60", "smg"), ("smgHeld15", "smg"),
                             ("greasegunHeldMixed", "greasegun")):
            with self.subTest(name):
                run, old = self.new[name], self.old[name]
                self.assertEqual(run["rounds"][0], run["presses"][0])
                self.assertEqual(gaps(run["rounds"]), {self.r["fireTicks"][weapon]})
                # The same rounds as before, only the burst starts on its press.
                self.assertEqual(gaps(old["rounds"]), gaps(run["rounds"]))
                self.assertEqual(len(old["rounds"]), len(run["rounds"]))

    def test_a_wind_up_counts_from_the_press_tick(self) -> None:
        # `fireDelay 0.8`: 23 ticks after the press's own (fire-timer.js
        # `delayTicks`, as the lab server recorded), at a frame rate whose
        # frames each run at most one tick.
        ticks = self.r["grenadeDelayTicks"]
        self.assertEqual(ticks, 23)
        run = self.new["grenadeOneTickFrame"]
        self.assertEqual(run["rounds"][0] - run["presses"][0], ticks)
        # Under 30 fps the wind-up still counts on the frame clock: the round
        # leaves at a frame's first tick, no earlier than its tick and at most
        # a frame late (the old order was a further frame behind).
        slow = self.new["grenadeTwoTickFrame"]
        self.assertIn(slow["rounds"][0] - slow["presses"][0], (ticks, ticks + 1))


if __name__ == "__main__":
    unittest.main()
