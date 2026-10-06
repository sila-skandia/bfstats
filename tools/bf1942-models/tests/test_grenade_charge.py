"""A grenade's alt-fire throw: hold to charge, let go to throw at the charge.

Every grenade declares `velocityDependentOnHeat 1`, so its `heatAddWhenFire`
is the strength of the throw (ledger GUN-14). The fire button sets it to 1.0
and throws at the full `velocity`; the alt-fire button adds 0.03 a tick while
it is held, capped at 1, and the tick after it is let go throws at
`velocity × heat` (GUN-19). The page threw every grenade at full strength and
left the bar beside it empty.

`grenade_charge_harness.mjs` drives `hand-fire.js` `footFire` with a stub page
at 60 fps, each round fired on the world tick after its trigger pulse.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_hand_fire  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "grenade_charge_harness.mjs"
VELOCITY = 25


class GrenadeChargeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        original = test_hand_fire.HARNESS
        test_hand_fire.HARNESS = HARNESS
        try:
            cls.results = test_hand_fire.run_harness()
        finally:
            test_hand_fire.HARNESS = original

    def test_half_a_second_of_alt_fire_throws_at_its_charge(self) -> None:
        # 15 ticks of 0.03, then the 1.0 s `fireDelay` wind-up from the
        # release: the round leaves at 0.45 of the velocity, and the heat and
        # the group's own stats are back afterwards.
        half = self.results["half"]
        self.assertAlmostEqual(0.45, half["peak"], places=4)
        self.assertEqual(1, len(half["throws"]))
        self.assertAlmostEqual(VELOCITY * 0.45, half["throws"][0]["velocity"], places=3)
        self.assertAlmostEqual(1.6, half["throws"][0]["t"], delta=0.05)
        self.assertEqual({"heat": 0, "velocity": VELOCITY, "rounds": 3}, half["after"])

    def test_the_charge_is_full_after_34_ticks_and_goes_no_further(self) -> None:
        full = self.results["full"]
        self.assertEqual(1, full["peak"])
        self.assertAlmostEqual(0.1 + 34 / 30, full["fullAt"], delta=1 / 30)
        self.assertEqual(VELOCITY, full["throws"][0]["velocity"])

    def test_a_tap_throws_at_the_feet(self) -> None:
        tap = self.results["tap"]
        self.assertAlmostEqual(0.03, tap["peak"], places=4)
        self.assertAlmostEqual(VELOCITY * 0.03, tap["throws"][0]["velocity"], places=3)

    def test_the_fire_button_throws_at_full_strength_and_fills_the_bar(self) -> None:
        click = self.results["click"]
        self.assertEqual(VELOCITY, click["throws"][0]["velocity"])
        self.assertAlmostEqual(1.1, click["throws"][0]["t"], delta=0.05)
        self.assertEqual(1, click["barDuringWindUp"])
        self.assertEqual(0, click["after"]["heat"])


if __name__ == "__main__":
    unittest.main()
