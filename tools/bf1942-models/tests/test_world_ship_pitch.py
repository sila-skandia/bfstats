"""A ship's `c_PIPitch` routing (`viewer/world.js`, Issue 2).

The engine binds landing-craft ramps (Lcvp `Lcvp_Ramp` 0..90, Daihatsu
`DaihatsuLanding1` 0..65 + `DaihatsuLanding2` 0..180) and the Gato/Sub7C dive
planes + float trim (`pitch -15..15` planes, `pitch 0..50` float angles) to
`c_PIPitch` -- see `viewer/models/{Lcvp,Daihatsu,Gato,Sub7C}.report.json`
`riggedParts`. The world's ground branch (which ships ride, on `player.kind ==
'ship'`) never fed that channel, so the ramps sat at rest and the subs kept
their trim.

What this file pins, driven headless by `world_ship_pitch_harness.mjs` with
mocked drivetrains on the same module set as `test_world.py`:

* a ship holding ArrowUp ramps `c_PIPitch` to full deflection at the air
  branch's own stick rate, while its throttle never moves;
* W/S reaches only `c_PIThrottle` (the raw `forwardKeys` pair alone moves
  neither the throttle nor the pitch -- a ship reads `forward`, pad folded
  in, as the ground branch always did);
* the mobile pad bypasses the spring (full deflection on the first tick);
* release springs back to rest at `STICK_RETURN`;
* ground/tank hulls never see `c_PIPitch` (no vanilla ground/tank hull binds
  it), while their own throttle keeps working;
* the air branch is unchanged (arrows still spring the pitch, a zero power
  word leaves the latched throttle alone).
"""

from __future__ import annotations

import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_world  # noqa: E402  (the module set and the harness runner)

HARNESS = Path(__file__).resolve().parent / "world_ship_pitch_harness.mjs"


def run_harness() -> dict:
    original = test_world.HARNESS
    test_world.HARNESS = HARNESS
    try:
        return test_world.run_harness()
    finally:
        test_world.HARNESS = original


class ShipPitchTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- a ship's ramp/dive channel -------------------------------------------

    def test_a_held_pitch_word_ramps_c_pipitch_to_full(self) -> None:
        ship = self.results["ship"]
        self.assertEqual(ship["ticks"], 30)
        # The aircraft path's own stick rate: 2.4/s at 1/30 s ticks is 0.08 a
        # tick, so full deflection takes thirteen ticks.
        self.assertAlmostEqual(ship["pitchFirst"], 1 * ship["stickRate"] * ship["tickDt"])
        self.assertAlmostEqual(ship["pitchLast"], 1.0)
        for pitch in ship["pitches"]:
            self.assertGreaterEqual(pitch, 0.0)
            self.assertLessEqual(pitch, 1.0)

    def test_a_ship_heaves_nothing_while_pitching(self) -> None:
        ship = self.results["ship"]
        self.assertEqual(ship["throttles"], [0] * 30)
        self.assertEqual(ship["yaws"], [0] * 30)

    # --- W/S is ahead/astern, never pitch --------------------------------------

    def test_forward_drives_only_the_throttle(self) -> None:
        decouple = self.results["decouple"]
        self.assertEqual(decouple["throttles"], [1] * 10)
        self.assertEqual(decouple["pitches"], [0] * 10)

    def test_the_raw_key_pair_alone_moves_neither(self) -> None:
        # `forwardKeys` is the air branch's latching-throttle feed; a ship
        # reads `forward` (the pad folded in, as the ground branch always
        # did), so the pair alone is neither throttle nor pitch here.
        decouple = self.results["decouple"]
        self.assertEqual(decouple["keysThrottles"], [0] * 5)
        self.assertEqual(decouple["keysPitches"], [0] * 5)

    # --- the mobile pad bypasses the spring ------------------------------------

    def test_the_pad_lands_full_deflection_on_the_first_tick(self) -> None:
        self.assertAlmostEqual(self.results["pad"]["pitchFirst"], 0.7)

    # --- release returns to rest --------------------------------------------------

    def test_release_springs_back_to_rest(self) -> None:
        release = self.results["release"]
        self.assertEqual(release["ticks"], 40)
        self.assertAlmostEqual(release["pitchLast"], 0.0)

    # --- ground/tank hulls bind no c_PIPitch --------------------------------------

    def test_ground_hulls_never_see_c_pipitch(self) -> None:
        ground = self.results["ground"]
        self.assertEqual(ground["pitches"], [0] * 10)
        self.assertEqual(ground["throttles"], [1] * 10)

    def test_tank_hulls_never_see_c_pipitch(self) -> None:
        tank = self.results["tank"]
        self.assertEqual(tank["pitches"], [0] * 10)
        self.assertEqual(tank["throttles"], [1] * 10)

    # --- the air branch is unchanged -------------------------------------------------

    def test_the_air_branch_still_springs_its_own_pitch(self) -> None:
        air = self.results["air"]
        self.assertAlmostEqual(air["pitchFirst"], 1 * self.results["ship"]["stickRate"]
                               * self.results["ship"]["tickDt"])
        self.assertAlmostEqual(air["pitchLast"], 1.0)
        self.assertEqual(air["throttles"], [0] * 30)


if __name__ == "__main__":
    unittest.main()
