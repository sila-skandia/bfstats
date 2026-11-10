"""The dogfight school on Desert Combat's jets (features/dogfight-lessons-jets):
what a duel makes of a jet's airframe (its hands, its pace, its own cannon,
the fight shown to its pilot at the Spitfire's size), and how a lesson's jet
file is laid over the lesson. Each lesson's own jet fights are held in
`test_dogfight_jet_<lesson>.py`.

Flown on the published F-16 and MiG-29 (`fixtures/dc-jets.json`,
`surveys/airframe_fixture.py`).
"""

from __future__ import annotations

import unittest

from jet_school import jet_fit, jet_lesson, jet_steps, shot_down


class FitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.f = jet_fit()

    def test_a_jets_nose_is_slower_to_answer_and_the_hands_know_it(self) -> None:
        # The Spitfire's pitch rate is at 63% a third of a second after the
        # stick goes back; the F-16's takes 0.83 s, the MiG-29's 0.87.
        self.assertAlmostEqual(1 / 3, self.f["hand"]["ref"])
        self.assertEqual({"pitch": 2.5}, self.f["fits"]["F16"]["hand"])
        self.assertEqual({"pitch": 2.6}, self.f["fits"]["Mig29"]["hand"])

    def test_a_jet_starts_its_fights_at_its_own_pace(self) -> None:
        # Level at 300 m: the Spitfire 75.6 m/s, the F-16 97, the MiG-29 114.
        self.assertEqual(1.28, self.f["fits"]["F16"]["pace"])
        self.assertEqual(1.5, self.f["fits"]["Mig29"]["pace"])
        # The fight is made larger, speed and place alike; a height stops
        # under where the wings stop lifting.
        paced = self.f["paced"]
        self.assertAlmostEqual(74.24, paced["speed"], places=2)
        self.assertEqual([-448, 870.4, 384], [round(v, 1) for v in paced["at"]])
        self.assertLessEqual(paced["at"][1], self.f["pace"]["roof"])
        self.assertEqual({"at": [1, 2, 3], "speed": 50}, self.f["unpaced"])

    def test_a_jet_fights_with_its_own_cannon(self) -> None:
        for name in ("F16", "Mig29"):
            self.assertEqual({"speed": 1000, "reach": 5000, "span": 0.5, "converge": 0}, self.f["fits"][name]["gun"], name)

    def test_its_pilot_sees_the_fight_at_the_spitfires_size(self) -> None:
        v = self.f["view"]
        self.assertEqual([100, 200, -50], [round(x, 6) for x in v["see"]["position"]])
        self.assertEqual([0, 0, -100], [round(x, 6) for x in v["see"]["velocity"]])
        # Angles are untouched.
        self.assertEqual([1, 2, 3], v["see"]["angularVelocity"])
        self.assertEqual((781.25, 3906.25), (v["gun"]["speed"], v["gun"]["reach"]))
        self.assertEqual(([100, 0], 1000), ([round(x, 6) for x in v["arena"]["centre"]], round(v["arena"]["radius"], 6)))
        self.assertAlmostEqual(128, v["ground"])
        # At the Spitfire's pace nothing is touched.
        self.assertEqual("x", self.f["same"])


class BoomAndZoomOnAJetTests(unittest.TestCase):
    """The first lesson re-tuned (`viewer/dogfight-jet-boom-and-zoom.js`)."""

    def test_two_passes_bring_down_the_pilot_who_never_looks_up(self) -> None:
        runs = jet_lesson("boom-and-zoom", demo="move")["demos"]["move"]
        self.assertGreaterEqual(shot_down(runs, 1), 8)
        self.assertTrue(all(r["hits"][1] == 0 for r in runs))
        # As written, with the lesson's 0.6 s burst, two passes leave him alive.
        base = jet_lesson("boom-and-zoom", demo="move", base=True)["demos"]["move"]
        self.assertEqual(0, shot_down(base, 1))
        self.assertTrue(all(12 <= r["hits"][0] <= 21 for r in base), [r["hits"] for r in base])

    def test_meeting_the_dive_is_never_hit(self) -> None:
        runs = jet_lesson("boom-and-zoom", demo="counter")["demos"]["counter"]
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs), [r["hits"] for r in runs])

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        jet = jet_lesson("boom-and-zoom", demo="counter")
        self.assertEqual("jet", jet["era"])
        self.assertIsNone(jet_lesson("boom-and-zoom", demo="counter", base=True)["era"])
        # A lesson with no jet file is flown as written.
        self.assertIsNone(jet_lesson("falling-leaf", demo="move")["era"])


class JetStepsTests(unittest.TestCase):
    """A move's step list on a jet (`dogfight-steps.js` `stepsOf`): the jet
    file's own where it re-flew the move, and none where it did not. The
    Spitfire's lists carry the Spitfire's distances."""

    def test_a_move_the_jet_file_re_flew_has_its_own_steps_and_each_one_comes(self) -> None:
        tail = jet_steps("on-his-tail")
        self.assertEqual(["close", "dip-out"], [s["phase"] for s in tail["steps"]["dip"]])
        over = jet_steps("up-and-over")
        self.assertEqual(["chase", "dip-shot", "dip-run"], [s["phase"] for s in over["steps"]["dip"]])
        for card in (tail["steps"]["dip"], over["steps"]["dip"]):
            times = [s["t"] for s in card]
            self.assertTrue(all(t is not None for t in times), card)
            self.assertEqual(sorted(times), times)

    def test_a_move_flown_as_written_shows_no_spitfire_steps_on_a_jet(self) -> None:
        for lesson in ("on-his-tail", "up-and-over", "boom-and-zoom"):
            got = jet_steps(lesson)
            self.assertEqual("jet", got["era"])
            # The Spitfire has a list for each of the three moves...
            self.assertTrue(all(got["spitfires"][m] for m in ("dip", "flip", "ninja")), lesson)
            # ...and the jet shows only its own.
            self.assertNotIn("flip", got["steps"], lesson)
            self.assertNotIn("ninja", got["steps"], lesson)
        self.assertEqual({}, jet_steps("boom-and-zoom")["steps"])


if __name__ == "__main__":
    unittest.main()
