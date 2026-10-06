"""The pilot seat's tick law (`viewer/world-vehicle-tick.js`, air branch).

features/pilot-mouse-look. One node run on `test_world.py`'s own module set,
driven by `world_air_input_harness.mjs` with a mocked aircraft.

What this file pins:

* a key is a step: `c_PIYaw`, `c_PIRoll` and `c_PIPitch` read full deflection
  on the first tick a key is held and rest on the first tick it is let go.
  `ControlMap::buttonsToAxis` (lnxded 0x083f2080) climbs by `dt / riseTime`
  with the 0.001 s the `ControlMap` ctor seeds (0x083f0540) and no shipped
  `.con` changes, so the viewer's own 2.4/s spring that used to sit in front of
  an aircraft's channels is gone, as it is from a ship's (`test_world_ship_pitch`);
* a mouse rate past 1 reaches every airframe whole: a vectored one's racks
  clip at their `maxRotation` (GUN-2), and every surface servo clips at +-1
  after spending a `rememberExcessInput` backlog (MLK-16);
* the wire's +-16 is the ceiling;
* a bot's word takes the same path.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_world  # noqa: E402  (the module set and the harness runner)

HARNESS = Path(__file__).resolve().parent / "world_air_input_harness.mjs"


def run_harness() -> dict:
    original = test_world.HARNESS
    test_world.HARNESS = HARNESS
    try:
        return test_world.run_harness()
    finally:
        test_world.HARNESS = original


class AirInputTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_world_ticks_at_thirty(self) -> None:
        self.assertEqual(30, self.results["tickRate"])

    def test_a_key_gives_a_full_channel_within_one_tick(self) -> None:
        for name in ("planeKeys", "heliKeys"):
            with self.subTest(airframe=name):
                first = self.results[name]["first"]
                self.assertEqual(1, first["yaw"])
                self.assertEqual(-1, first["roll"])
                self.assertEqual(1, first["pitch"])
                self.assertEqual(first, self.results[name]["held"])

    def test_a_released_key_is_rest_on_the_next_tick(self) -> None:
        for name in ("planeKeys", "heliKeys"):
            with self.subTest(airframe=name):
                released = self.results[name]["released"]
                self.assertEqual(0, released["yaw"])
                self.assertEqual(0, released["roll"])
                self.assertEqual(0, released["pitch"])

    def test_a_vectored_airframe_takes_the_mouse_rate_whole(self) -> None:
        heli = self.results["heliMouse"]
        self.assertAlmostEqual(3.46, heli["roll"], places=9)
        self.assertAlmostEqual(-3.47, heli["pitch"], places=9)
        self.assertEqual({"roll": 3.46, "pitch": -3.47}, self.results["heliStick"])

    def test_a_fixed_wing_airframe_takes_it_whole_too(self) -> None:
        # Its surfaces clip themselves, after a `rememberExcessInput`
        # elevator has banked the excess (`vehicle-base.js` `advanceSurfaces`,
        # MLK-16; `test_flight.py`), so the world hands every airframe the
        # rate as it is.
        plane = self.results["planeMouse"]
        self.assertAlmostEqual(3.46, plane["roll"], places=9)
        self.assertAlmostEqual(-3.47, plane["pitch"], places=9)

    def test_the_wire_is_the_ceiling(self) -> None:
        w = self.results["wire"]
        self.assertEqual(16, w["roll"])
        self.assertEqual(-16, w["pitch"])
        self.assertEqual(16, w["yaw"])

    def test_a_bots_word_takes_the_same_path(self) -> None:
        b = self.results["botPad"]
        self.assertAlmostEqual(0.4, b["roll"], places=12)
        self.assertAlmostEqual(-0.2, b["pitch"], places=12)
        # The rudder went through the spring before (0.08 on the first tick).
        self.assertAlmostEqual(0.7, b["yaw"], places=12)

    def test_the_throttle_latch_is_untouched(self) -> None:
        # The fixed-wing W/S latch is the owner's call (WP5); a word with no
        # power leaves it where it is.
        self.assertEqual(0, self.results["planeKeys"]["first"]["throttle"])


if __name__ == "__main__":
    unittest.main()
