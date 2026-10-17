"""Every fire path's cadence on the engine's whole ticks (`tests/fire_cadence_harness.mjs`).

A FireArms timer is set to its full period by each round (`Fire`, lnxded
0x0828a24e, client 0x0053dcb7), counted down by the fixed `1/30f` tick and
stored back as a float (lnxded 0x0828938b, client 0x0053e297), and finishes on
the first tick that leaves it at or below 0; nothing carries the overshoot
(ledger GUN-13, LOOP-1). So a held gun fires every `ticks(roundOfFire)` ticks,
counted in float32. The lab server's FHSW Greasegun (`roundOfFire 9.17`) fired
30 rounds in 3.865 s and 3.864 s (`~/.cache/agfhr/lab/runs/20261017-093245-*`
and `-094042-*`, server `f` rows), every 4th tick; the lab's bots hold the
float32 count where it parts from `ceil(30 / roundOfFire)`: a Lancaster MG at
7.5 every 5th tick, DC's M230 at 6 every 6th, the SU-25's rack at 3 every
11th.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "fire_cadence_harness.mjs"


def f32(x: float) -> float:
    return struct.unpack("f", struct.pack("f", x))[0]


def timer_ticks(seconds: float) -> int:
    t, dt, n = f32(seconds), f32(1.0 / 30.0), 0
    while t > 0:
        t = f32(t - dt)
        n += 1
    return n


def fire_ticks(rate: float) -> int:
    return timer_ticks(f32(1.0 / f32(rate)))


_RESULT: dict | None = None


def result() -> dict:
    global _RESULT
    if _RESULT is None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        _RESULT = json.loads(proc.stdout.strip().splitlines()[-1])
    return _RESULT


class RuleTests(unittest.TestCase):
    def test_ticks_are_the_float32_countdown(self):
        for label, row in result()["rule"].items():
            if not isinstance(row, dict) or "rof" not in row:
                continue
            with self.subTest(label):
                self.assertEqual(row["ticks"], fire_ticks(row["rof"]))
                self.assertAlmostEqual(row["cycle"], row["ticks"] / 30, places=9)

    def test_where_float32_parts_from_ceil(self):
        rule = result()["rule"]
        # The lab's bots: 7.5 every 5th tick, 6 every 6th, 3 every 11th.
        self.assertEqual(rule["vanilla JohnsonLMG"]["ticks"], 5)
        self.assertEqual(rule["dc M230Cannon"]["ticks"], 6)
        self.assertEqual(rule["dc SU-25_BombRack"]["ticks"], 11)
        self.assertEqual(rule["fhsw Greasegun"]["ticks"], 4)
        self.assertEqual(rule["vanilla MG42 emplacement"]["ticks"], 2)

    def test_delay_timer(self):
        ticks = result()["rule"]["timerTicks"]
        self.assertEqual(ticks["0"], 0)
        self.assertEqual(ticks["0.12"], 4)
        self.assertEqual(ticks["0.3"], 10)
        self.assertEqual(ticks["1"], 30)

    def test_gun_cycle_reexports_and_default(self):
        rule = result()["rule"]
        self.assertTrue(rule["reexported"])
        # No rate declared: the template ctor's 10 (AI-133), every 3rd tick.
        self.assertEqual(rule["noRate"], 3)


class WorldTickTests(unittest.TestCase):
    """The human's hand automatic and every vehicle gun: `advanceGroups` on
    the world's tick, whatever the frame rate."""

    def test_greasegun_matches_the_lab(self):
        for fps, run in result()["world"]["fhsw Greasegun"].items():
            with self.subTest(fps=fps):
                self.assertEqual(run["rounds"], 30)
                self.assertEqual(run["gaps"], [4])
                self.assertEqual(run["spanTicks"], 116)
                # 3.865 s and 3.864 s on the lab server's own clock.
                self.assertAlmostEqual(run["spanSeconds"], 3.865, delta=0.01)

    def test_every_gun_every_frame_rate(self):
        rule = result()["rule"]
        for label, runs in result()["world"].items():
            ticks = rule[label]["ticks"]
            for fps, run in runs.items():
                with self.subTest(gun=label, fps=fps):
                    self.assertEqual(run["gaps"], [ticks])
                    self.assertEqual(run["spanTicks"], (run["rounds"] - 1) * ticks)


class BotTests(unittest.TestCase):
    def test_held_trigger(self):
        bots = result()["bots"]
        self.assertEqual(bots["greasegun"]["gaps"], [4])
        self.assertEqual(bots["greasegun"]["spanTicks"], 116)
        self.assertEqual(bots["johnson"]["gaps"], [5])
        self.assertEqual(bots["thompson"]["gaps"], [3])

    def test_stab_delay_and_cycle_are_two_timers(self):
        stab = result()["stab"]
        self.assertEqual(stab["expectDelay"], 3)
        self.assertEqual(stab["expectCycle"], 24)
        self.assertTrue(stab["rounds"])
        self.assertEqual(set(stab["delayTicks"]), {3})
        # The round 3 ticks after the press (the delay's 4 with the press's
        # own the first), then 24 + 1: a round the delay fired starts its
        # timer a tick late (`delayedFireCycle`).
        self.assertEqual(set(stab["pressGaps"]), {28})


class ReaderTests(unittest.TestCase):
    def test_hand_stab_machine(self):
        hand = result()["handAlt"]
        self.assertAlmostEqual(hand["delay"], 3 / 30, places=9)
        self.assertAlmostEqual(hand["cycle"], 24 / 30, places=9)

    def test_bot_gunner_hold(self):
        hold = result()["misc"]["holdAI"]
        self.assertEqual(hold["5"], 8)     # 7 ticks, not ceil's 6
        self.assertEqual(hold["7.5"], 6)
        self.assertEqual(hold["12"], 4)

    def test_sidecar_counter_lag(self):
        lag = result()["misc"]["lag"]
        self.assertAlmostEqual(lag["cannon"], lag["cannonCycle"], places=9)
        self.assertAlmostEqual(lag["coaxial"], 0.1, places=9)


if __name__ == "__main__":
    unittest.main()
