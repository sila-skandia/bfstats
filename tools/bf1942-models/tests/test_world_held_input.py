"""Held input survives a slow frame's catch-up ticks (`viewer/world.js`).

One node run, many assertions, on `test_world.py`'s own module set.

A display frame longer than 33 ms owes several 30 Hz world ticks, and the page
feeds one un-sequenced input word for the whole frame. Every tick of that
frame must run against it: the engine's client samples its devices once for
`nTicks` (`InputManager::update` 0x0049cff7), and `mouse-input.js`'s pump
divides the counts by `nTicks / 30` on exactly that promise.

The catch-up ticks used to get the engine's zeroed idle word, so below 30 fps
every frame ended with `guns.setFiring(group, false)`. `group.firing` read
false at draw time, `updateAudio`'s fire-loop gate in map.html closed every
frame (a held vehicle machine gun stuttered), the gun fired on one tick in n,
and the throttle, the steer and the mouse axis were dropped the same way. On
foot a held jump read as released and re-pressed once per frame.

The wire's law stands beside it: a sequenced buffer that runs dry, and a
frame nobody fed, still idle.
"""

from __future__ import annotations

import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_world  # noqa: E402  (the module set and the harness runner)

HARNESS = Path(__file__).resolve().parent / "world_held_input_harness.mjs"


def run_harness() -> dict:
    original = test_world.HARNESS
    test_world.HARNESS = HARNESS
    try:
        return test_world.run_harness()
    finally:
        test_world.HARNESS = original


class HeldInputTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the vehicle trigger ------------------------------------------------

    def test_the_trigger_is_held_on_every_tick_at_every_frame_rate(self) -> None:
        for rate in self.results["rates"]:
            with self.subTest(fps=rate["fps"]):
                self.assertGreaterEqual(rate["ticks"], 29)
                self.assertEqual(rate["heldTicks"], rate["ticks"])
                self.assertEqual(rate["releasedTicks"], 0)

    def test_the_fire_loop_gate_stays_open_at_draw_time(self) -> None:
        # `updateAudio` reads `group.firing` after the step; a false there
        # mutes the looped fire sound for the frame.
        for rate in self.results["rates"]:
            with self.subTest(fps=rate["fps"]):
                self.assertEqual(rate["firingAtDraw"], rate["framesWithTicks"])

    def test_no_rounds_are_dropped_below_30_fps(self) -> None:
        # 600 rpm for a second is ten rounds however the second is sliced.
        shots = {rate["fps"]: rate["shots"] for rate in self.results["rates"]}
        for fps, count in shots.items():
            with self.subTest(fps=fps):
                self.assertAlmostEqual(count, shots[30], delta=1)
        self.assertGreaterEqual(shots[30], 10)

    # --- throttle, steer and the aim axis -----------------------------------

    def test_throttle_and_steer_reach_every_tick(self) -> None:
        for rate in self.results["rates"]:
            with self.subTest(fps=rate["fps"]):
                self.assertEqual(rate["throttleTicks"], rate["ticks"])
                self.assertEqual(rate["steerTicks"], rate["ticks"])

    def test_the_look_axis_reaches_every_tick(self) -> None:
        for rate in self.results["rates"]:
            with self.subTest(fps=rate["fps"]):
                self.assertEqual(rate["aimedTicks"], rate["ticks"])

    # --- what must NOT be held ----------------------------------------------

    def test_a_release_lands_on_every_tick_of_its_own_frame(self) -> None:
        release = self.results["release"]
        self.assertEqual(release["ticks"], 2)
        self.assertEqual(release["releasedTicks"], 2)
        self.assertFalse(release["firingAtDraw"])

    def test_a_frame_nobody_fed_idles(self) -> None:
        unfed = self.results["unfed"]
        self.assertEqual(unfed["ticks"], 2)
        self.assertFalse(unfed["firingAtDraw"])
        self.assertEqual(unfed["throttles"], [0, 0])
        self.assertTrue(unfed["lastIdle"])

    def test_a_dry_sequenced_buffer_still_yields_the_idle_word(self) -> None:
        # `simulatePlayerUpdate` 0x0815bd00: the server never replays a packet.
        wire = self.results["sequenced"]
        self.assertEqual(wire["ticks"], 2)
        self.assertEqual(wire["throttles"], [1, 0])
        self.assertEqual(wire["heldTicks"], 1)
        self.assertFalse(wire["firingAtDraw"])
        self.assertTrue(wire["lastIdle"])

    # --- one trigger, one gun ---------------------------------------------------

    def test_a_drivers_cannon_is_fired_and_stepped_once(self) -> None:
        # One shot is one shell: the active-seat loop must leave the driver's
        # own FireArms to the driver loop, duplicate group or not.
        cannon = self.results["drivenCannon"]
        self.assertGreater(cannon["ticks"], 0)
        self.assertTrue(cannon["driverFiring"])
        self.assertFalse(cannon["twinFiring"])
        self.assertEqual(cannon["steps"], cannon["ticks"])

    def test_a_nested_gunner_still_fires_his_own_gun(self) -> None:
        gunner = self.results["nestedGunner"]
        self.assertTrue(gunner["gunnerFiring"])
        self.assertFalse(gunner["driverFiring"])


    def test_a_walk_covers_the_same_ground_at_15_fps(self) -> None:
        foot = self.results["foot"]
        self.assertAlmostEqual(foot["walked15"], foot["walked60"], delta=0.25)

    def test_a_turn_covers_the_same_angle_at_15_fps(self) -> None:
        foot = self.results["foot"]
        self.assertNotEqual(foot["turned60"]["yaw"], 0)
        per_tick_60 = foot["turned60"]["yaw"] / foot["turned60"]["ticks"]
        per_tick_15 = foot["turned15"]["yaw"] / foot["turned15"]["ticks"]
        self.assertAlmostEqual(per_tick_15, per_tick_60, places=9)

    def test_a_held_jump_is_one_jump(self) -> None:
        foot = self.results["foot"]
        self.assertEqual(foot["heldJumps60"], 1)
        self.assertEqual(foot["heldJumps15"], 1)


if __name__ == "__main__":
    unittest.main()
