"""A dead crew member holds no trigger, throttle or aim (`viewer/world.js`).

A Nebelwerfer's own rocket splashed the man at the launcher dead and left the
launcher whole; the seat's input kept reaching the gun until the page released
the seat, and when that release did not run the dead player still fired it.
The world now reads the player's own Armor: destroyed, the seat takes none of
his input, in any camera and whatever the hull's state.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_world  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "world_dead_crew_harness.mjs"


def run_harness() -> dict:
    original = test_world.HARNESS
    test_world.HARNESS = HARNESS
    try:
        return test_world.run_harness()
    finally:
        test_world.HARNESS = original


class DeadCrewTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_living_gunner_fires_and_yaws_the_carriage(self) -> None:
        alive = self.results["gun"]["alive"]
        self.assertTrue(alive["firing"])
        self.assertEqual(alive["carriage"], 1)

    def test_a_dead_gunner_cannot_fire_a_whole_gun(self) -> None:
        dead = self.results["gun"]["dead"]
        self.assertFalse(dead["firing"])
        self.assertEqual(dead["carriage"], 0)
        self.assertEqual(dead["scale"], 0)
        self.assertTrue(dead["blocked"])

    def test_a_living_driver_drives_and_fires(self) -> None:
        alive = self.results["driver"]["alive"]
        self.assertTrue(alive["firing"])
        self.assertEqual(alive["throttle"], 1)

    def test_a_dead_driver_gets_no_throttle_and_no_trigger(self) -> None:
        dead = self.results["driver"]["dead"]
        self.assertFalse(dead["firing"])
        self.assertEqual(dead["fire"], 0)
        self.assertEqual(dead["scale"], 0)


if __name__ == "__main__":
    unittest.main()
