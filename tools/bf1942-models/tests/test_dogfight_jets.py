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

from jet_school import jet_fit, jet_guides, jet_lesson, jet_steps, jet_tops


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
        # The fight is made larger, speed and place alike; a height is bent
        # over under the roof every jet's pilot flies under.
        paced = self.f["paced"]
        self.assertAlmostEqual(74.24, paced["speed"], places=2)
        self.assertEqual([-448, 730.5, 384], [round(v, 1) for v in paced["at"]])
        self.assertLess(paced["at"][1], self.f["pace"]["roof"])
        self.assertEqual({"at": [1, 2, 3], "speed": 50}, self.f["unpaced"])

    def test_a_start_height_is_bent_over_under_the_roof(self) -> None:
        # Up to 600 m as paced; from there toward 760 m, never reached.
        self.assertEqual({"knee": 600, "roof": 760}, {k: self.f["pace"][k] for k in ("knee", "roof")})
        self.assertEqual([500, 600, 674.4, 735.5, 760.0], self.f["bent"])
        # The lessons' heights (230 to 700 m at the Spitfire's size): the
        # low ones as paced, the perches under 760, and no two the same.
        f16, mig = self.f["heights"]["F16"], self.f["heights"]["Mig29"]
        self.assertEqual([294.4, 384.0, 588.8], f16[:3])
        self.assertEqual([345.0, 450.0], mig[:2])
        for hs in (f16, mig):
            self.assertEqual(hs, sorted(set(hs)))
            self.assertLess(hs[-1], 760)
        self.assertEqual([730.5, 734.8], f16[-2:])
        # Over a level's own ground a jet's fight keeps its heights in the
        # sky (the Range over Desert Shield's 40 m flies the fight that was
        # measured); over ground higher than 80 m the rest is bent.
        self.assertEqual([730.5, 730.5, 740.9], self.f["overGround"])
        self.assertEqual([294.4, 294.4, 364.4], self.f["lowOverGround"])

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


class JetFileTests(unittest.TestCase):
    """How a lesson's jet file is laid over it (`dogfight-lessons.js`
    `lessonFor`). Boom and zoom's own jet fights are held in
    `test_dogfight_jet_boom_and_zoom.py`."""

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        jet = jet_lesson("boom-and-zoom", demo="counter")
        self.assertEqual("jet", jet["era"])
        self.assertIsNone(jet_lesson("boom-and-zoom", demo="counter", base=True)["era"])
        # A lesson with no jet file is flown as written.
        self.assertIsNone(jet_lesson("falling-leaf", demo="move")["era"])


class TheRoofTests(unittest.TestCase):
    """Every pilot of a jet flies under the roof (`dogfight-jet-ceiling.js`
    `underRoof`, in `stepPilot`): nine starts of every demo and move of
    every lesson with a jet version, and the highest either plane went."""

    def test_nobody_on_the_f16_reaches_the_ceiling_guard(self) -> None:
        tops = jet_tops()
        self.assertEqual(9, len(tops))
        for lesson, demos in tops.items():
            for demo, x in demos.items():
                # The roof is 800 m; the guard, 880, is never reached, and
                # the wings stop lifting at 1,000.
                self.assertLess(max(x["top"]), 860, f"{lesson}/{demo}")
                self.assertEqual([0, 0], x["past"], f"{lesson}/{demo}")

    def test_nobody_on_the_mig29_reaches_it_either(self) -> None:
        # The MiG-29 flies the F-16's files, a fifth faster: its zooms carry
        # further, and it too stays under the guard.
        for lesson, demos in jet_tops("Mig29").items():
            for demo, x in demos.items():
                self.assertLess(max(x["top"]), 870, f"{lesson}/{demo}")
                self.assertEqual([0, 0], x["past"], f"{lesson}/{demo}")

    def test_every_fight_starts_under_the_roof(self) -> None:
        for plane in ("F16", "Mig29"):
            for lesson, demos in jet_tops(plane).items():
                for demo, x in demos.items():
                    self.assertLess(max(x["start"]), 760, f"{plane} {lesson}/{demo}")


class JetStepsTests(unittest.TestCase):
    """A move's step list on a jet (`dogfight-steps.js` `stepsOf`): the jet
    file's own where it re-flew the move, and none where it did not. The
    Spitfire's lists carry the Spitfire's distances."""

    def test_a_move_the_jet_file_re_flew_has_its_own_steps_and_each_one_comes(self) -> None:
        tail = jet_steps("on-his-tail")
        self.assertEqual(["close", "dip-out"], [s["phase"] for s in tail["steps"]["dip"]])
        over = jet_steps("up-and-over")
        self.assertEqual(["chase", "dip-shot", "dip-pass", "dip-run"], [s["phase"] for s in over["steps"]["dip"]])
        boom = jet_steps("boom-and-zoom")
        self.assertEqual(["climb", "face", "dip-run"], [s["phase"] for s in boom["steps"]["dip"]])
        for card in (tail["steps"]["dip"], over["steps"]["dip"], boom["steps"]["dip"]):
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
        self.assertEqual(["dip"], list(jet_steps("boom-and-zoom")["steps"]))


class JetGuideTests(unittest.TestCase):
    """What FLY IT's guide and instructor fly on a jet (`flightOf`)."""

    def test_the_guide_never_flies_a_move_that_does_not_work_on_a_jet(self) -> None:
        guides = jet_guides()
        self.assertEqual(9, len(guides))
        for lesson, g in guides.items():
            self.assertTrue(g["known"], (lesson, g))
            # The lesson's counter or its own guide (no count), or a move
            # that works there: never the best of several at 0 of 9.
            self.assertTrue(g["works"] is None or g["works"] > 0, (lesson, g))

    def test_where_nothing_gets_you_out_the_guide_stays_in(self) -> None:
        guides = jet_guides()
        self.assertEqual(("jetScAce", "jetScissors"), (guides["scissors"]["ace"], guides["scissors"]["guide"]))
        self.assertEqual("ciCircle", guides["the-circle"]["guide"])

    def test_the_jet_aces_fly_it_puts_up_are_the_roofs_own(self) -> None:
        # Boom and zoom's dives as soon as you are 30 degrees under it (a
        # pilot climbing to meet it was level with `bzAce` before it dived);
        # the Immelmann's loops only where the loop fits under the roof.
        guides = jet_guides()
        self.assertEqual("jetBzAce", guides["boom-and-zoom"]["ace"])
        self.assertEqual("jetTaAce", guides["turnarounds"]["ace"])


if __name__ == "__main__":
    unittest.main()
