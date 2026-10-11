"""XPack2's rocket pack: `viewer/rocket-pack.js` through `rocket_pack_harness.mjs`.

The part's law is `ActiveKitPart::update` (lnxded 0x082628e0), read from the
decompile; the numbers are `GermanElite_RocketPack`'s own words. What is
pinned here is the arithmetic that law makes of them: the pack burns for 14
ticks (0.47 s) on a full trigger, is dark until its heat is under 1 again,
and takes 14 s to cool.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "rocket_pack_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RocketPackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_templates_words_are_converted_as_the_setters_convert_them(self) -> None:
        spec = self.r["spec"]
        self.assertEqual(spec["trigger"], "PIAction")
        self.assertAlmostEqual(spec["activeHeat"], 2.25 / 30)
        self.assertAlmostEqual(spec["cooling"], 0.07 / 30)
        self.assertAlmostEqual(spec["burstPeriod"], 1 / 30)
        self.assertEqual(spec["persistence"], 0)
        self.assertEqual(spec["damping"], 0)
        self.assertEqual(spec["negative"], ["climbing", "crouching", "lying", "swimming"])
        self.assertEqual(spec["inAirLower"], "Lb_RocketeeringIdle")
        self.assertIsNone(spec["inAirUpper"])      # `Empty`: the torso keeps its own
        self.assertIsNone(spec["noRow"])           # a nochute accelerates nothing

    def test_a_fresh_pack_is_off_until_its_first_tick_and_then_lifts(self) -> None:
        fresh = self.r["fresh"]
        self.assertEqual(fresh["state"], 3)
        self.assertEqual(fresh["accel"], [0, 0, 0])
        self.assertEqual(fresh["afterIdle"]["state"], 1)
        self.assertEqual(fresh["afterIdle"]["accel"], [0, 7.7, 0])

    def test_a_held_trigger_bursts_every_other_tick_until_the_heat_stops_it(self) -> None:
        # 0.0333 is the literal the burst timer runs down by, and a burst sets it
        # to 1/30: one tick later it is still a hair above zero, so it bursts on
        # alternate ticks. Sixteen bursts (+0.075 each, -0.00233 every tick)
        # put the heat over 1.0 on the 29th tick (an independent float32 model).
        held = self.r["held"]
        self.assertEqual(held["burning"], 16)
        by_tick = {t[0]: t for t in held["trace"]}
        self.assertEqual(by_tick[0][1:], [0, 0.0727, 72])      # burning: +0.075 - 0.00233
        self.assertEqual(by_tick[1][1], 1)                     # the timer is a hair over zero
        self.assertEqual(by_tick[1][3], 7.7)                   # idling: the lift
        self.assertEqual(held["firstDark"], 29)
        # Dark, then one more burst the moment the cooling takes it under 1:
        # the pack dribbles from here, one burst a half second or so.
        self.assertGreater(held["lastBurn"], 29)

    def test_it_cools_at_seven_hundredths_a_second(self) -> None:
        cooling = self.r["cooling"]
        self.assertLessEqual(cooling["ready"], 32)             # under 1 again within a second
        self.assertAlmostEqual(cooling["fromReady"], 429, delta=2)  # 1.0 / (0.07 / 30) ticks
        self.assertEqual(cooling["fuelAtCold"], 1)

    def test_a_flag_of_the_negative_mask_blocks_it(self) -> None:
        self.assertEqual(self.r["crouched"]["state"], 3)
        self.assertEqual(self.r["crouched"]["accel"], [0, 0, 0])
        self.assertEqual(self.r["crouched"]["heat"], 0)
        self.assertEqual(self.r["swimming"]["state"], 3)

    def test_no_room_overhead_means_no_burst_and_no_lift_until_asked_again(self) -> None:
        self.assertEqual(self.r["noRoom"]["state"], 1)
        self.assertEqual(self.r["noRoom"]["heat"], 0)
        self.assertFalse(self.r["noRoom"]["hasRoom"])
        self.assertEqual(self.r["noRoom"]["accel"], [0, 0, 0])
        self.assertEqual(self.r["roomAgain"]["state"], 0)

    def test_the_burst_timer_gates_the_press_not_the_key(self) -> None:
        # Held: burns, a hair of timer left, burns... A release and a press in
        # between changes nothing: the timer is the gate, not the key.
        self.assertEqual(self.r["burstSequence"], [True, False, True, False])

    def test_damping_is_the_least_of_the_kits_parts(self) -> None:
        self.assertEqual(self.r["damping"], {"pack": 0, "none": 1, "mixed": 0})

    def test_a_recorded_flight_burns_when_it_climbs_against_what_an_idle_pack_allows(self) -> None:
        replay = self.r["replay"]
        self.assertTrue(replay["burst"])
        self.assertFalse(replay["idle"])
        self.assertFalse(replay["apex"])
        self.assertTrue(replay["still"])   # 0 m/s^2: only asked of a man in the air
        self.assertFalse(replay["noInterval"])
        self.assertEqual(replay["alias"], "Lb_ParachuteIdle")
        self.assertEqual(replay["plain"], "Lb_Stand")


if __name__ == "__main__":
    unittest.main()
