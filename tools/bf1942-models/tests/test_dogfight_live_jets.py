"""The live fight on the Range (FLY IT, `viewer/dogfight-live.js`) fitted to
a jet, the way the school's recorded duels are
(features/dogfight-lessons-jets/live-fight.md).

The page cannot be driven under node, so the seats' fitting is flown off it:
`fitSeats`, `seatPilot`, `seatGun` and `stepSeat`, the helpers the live fight
now steps its ace, its guide and its instructor through, are flown on the
published F-16 and MiG-29 (`fixtures/dc-jets.json`) beside `runDuel` flying the
same sides. The Spitfire's side is held in `test_dogfight_school.py`
(`LiveSeatsTests`).
"""

from __future__ import annotations

import unittest

from jet_school import jet_live


class LiveFightOnAJetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.live = jet_live()

    def test_each_seat_is_fitted_to_its_own_airframe(self) -> None:
        f16, mig = self.live["F16/Mig29"]["fits"]
        self.assertEqual(({"pitch": 2.5}, 1.28), (f16["hand"], f16["pace"]))
        self.assertEqual(({"pitch": 2.6}, 1.5), (mig["hand"], mig["pace"]))
        for fit in (f16, mig):
            self.assertEqual(1000, fit["gun"]["speed"])

    def test_the_live_seats_fly_the_fight_a_duel_flies(self) -> None:
        # Placed at their paced starts, stepped on the real states with the
        # hands, the cannon and the view of their own pace: twenty seconds of
        # boom and zoom's counter to the millimetre of `runDuel`'s, on one
        # jet and on two different ones.
        for pair in ("F16/F16", "F16/Mig29"):
            self.assertEqual(0, self.live[pair]["apartFromDuel"], pair)

    def test_unfitted_the_live_fight_was_another_fight(self) -> None:
        # The live fight as it was: the Spitfire's hands, starts and view.
        for pair in ("F16/F16", "F16/Mig29"):
            self.assertGreater(self.live[pair]["apartUnfitted"], 300, pair)

    def test_a_jet_starts_at_its_pace(self) -> None:
        r = self.live["F16/Mig29"]
        self.assertEqual([58, 56], r["lessonSpeeds"])
        # The F-16 at 1.28 and the MiG-29 at 1.5 times the lesson's speeds
        # (the first tick's speed, the engines already pulling).
        self.assertAlmostEqual(58 * 1.28, r["startSpeed"][0], delta=1.5)
        self.assertAlmostEqual(56 * 1.5, r["startSpeed"][1], delta=1.5)

    def test_the_world_gun_stays_real_and_the_pilots_is_shrunk(self) -> None:
        r = self.live["F16/F16"]
        self.assertEqual((1000, 5000), (r["aceGun"]["speed"], r["aceGun"]["reach"]))
        self.assertEqual((781.25, 3906.25), (r["pilotGun"]["speed"], r["pilotGun"]["reach"]))
        self.assertEqual({"pitch": 2.5}, r["handedHas"])

    def test_the_lines_fly_on_from_the_real_place(self) -> None:
        # A moment of the live fight handed to `runDuel` (the lines, extend
        # the scene): the state is real, so the duel starts exactly where the
        # plane is; the memory is the pilot's own, in the space it sees.
        for pair in ("F16/F16", "F16/Mig29"):
            self.assertEqual(0, self.live[pair]["handOff"], pair)

    def test_the_ace_on_a_jet_reads_the_jet_lesson(self) -> None:
        era = self.live["era"]
        self.assertEqual(("jet", "jet"), (era["now"], era["lesson"]))
        # Starts stay in the Spitfire's units: the seat paces them.
        self.assertEqual(58, era["aceStart"]["speed"])
        self.assertIsNone(era["after"])

    def test_a_seat_that_cannot_be_built_is_flown_as_the_spitfire(self) -> None:
        self.assertEqual([{"hand": None, "pace": 1, "gun": None}] * 2, self.live["broken"])


if __name__ == "__main__":
    unittest.main()
