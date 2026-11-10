"""The break turn on a jet (features/dogfight-lessons-jets/break-turn.md,
`viewer/dogfight-jet-break-turn.js`): what its words claim, flown from the
harness's nine starts on the published F-16.

In this lesson side 0 (the harness's ACE) is the pilot under attack, who
cruises straight or breaks, and side 1 (YOU) the attacker; in the Dip, the
Flip and the Ninja side 0 is the school's hunter and side 1 the pilot who
flies the move. The moves' verdict counts are `movesOn`'s, over the
measure's own nine starts (the lesson's notes say how they were counted);
what is held here is what the harness's starts show of the same flights.
"""

from __future__ import annotations

import unittest

from jet_school import jet_lesson, shot_down


def demo(name: str, base: bool = False) -> list[dict]:
    return jet_lesson("break-turn", demo=name, base=base)["demos"][name]


class FlyingStraightTests(unittest.TestCase):
    def test_flying_straight_is_shot_down_every_time(self) -> None:
        # "the pilot who flew straight was shot down every time, 30 to 40 s in"
        runs = demo("without")
        self.assertEqual(9, shot_down(runs, 0))
        self.assertTrue(all(29 <= r["t"] <= 41 for r in runs), [r["t"] for r in runs])
        self.assertTrue(all(r["hits"][0] == 0 for r in runs))
        # "they close to 25 to 30 m behind you and stay there"
        self.assertTrue(all(20 <= r["closest"] <= 35 for r in runs), [r["closest"] for r in runs])
        # "cruised straight at 86 m/s"
        self.assertTrue(all(84 <= r["speed"][0] <= 88 for r in runs), [r["speed"] for r in runs])

    def test_as_written_the_attacker_flies_through_a_slow_target(self) -> None:
        # The Spitfire's 52 m/s cruise, 67 on the F-16: the attacker comes
        # within a few metres of its tail and on past it, and it survives
        # eight starts of nine with 5 to 20 rounds in it.
        runs = demo("without", base=True)
        self.assertEqual(1, shot_down(runs, 0))
        self.assertTrue(all(r["closest"] <= 10 for r in runs), [r["closest"] for r in runs])
        alive = [r for r in runs if r["winner"] is None]
        self.assertTrue(all(5 <= r["hits"][1] <= 21 for r in alive), [r["hits"] for r in alive])
        self.assertTrue(all("lost" in r["phases"][1] for r in alive))


class TheBreakTests(unittest.TestCase):
    def test_the_break_comes_at_once_and_is_never_shot_down(self) -> None:
        # "they are in reach from the start: turn at once"; "never was, and
        # took 0 to 4 hits".
        runs = demo("move")
        self.assertTrue(all(r["winner"] is None for r in runs))
        self.assertTrue(all(r["phases"][0][0] == "break" for r in runs), [r["phases"][0] for r in runs])
        self.assertTrue(all(r["hits"][1] <= 4 for r in runs), [r["hits"] for r in runs])
        self.assertEqual(4, max(r["hits"][1] for r in runs))

    def test_they_come_past_and_the_breaker_reverses_into_them(self) -> None:
        # "they come past your tail 4 to 7 s later, 40 to 75 m from you. As
        # they cross, reverse"; "they swing back in behind you, about 110 m back"
        runs = demo("move")
        self.assertTrue(all(40 <= r["closest"] <= 75 for r in runs), [r["closest"] for r in runs])
        self.assertTrue(all({"reverse", "turn"} <= set(r["phases"][0]) for r in runs))
        self.assertTrue(all(90 <= r["apart"] <= 130 for r in runs), [r["apart"] for r in runs])
        # "their extra speed is gone (both of you at 70 to 85 m/s)"
        self.assertTrue(all(65 <= v <= 85 for r in runs for v in r["speed"]), [r["speed"] for r in runs])

    def test_the_patient_attacker_stays_above_and_nobody_is_shot_down(self) -> None:
        # "never came within 59 m of the breaker"; "they never land a round on you".
        runs = demo("counter")
        self.assertTrue(all(r["winner"] is None for r in runs))
        self.assertTrue(all(r["hits"][0] == 0 and r["hits"][1] <= 1 for r in runs), [r["hits"] for r in runs])
        self.assertEqual(59, min(r["closest"] for r in runs))
        self.assertTrue(all("yoyo" in r["phases"][1] for r in runs))
        # 40 to 70 m above their circle (the median); at the bell, above them.
        self.assertTrue(all(r["height"][1] > r["height"][0] + 30 for r in runs), [r["height"] for r in runs])


class TheMovesTests(unittest.TestCase):
    def test_the_dip_gets_away_and_they_give_up(self) -> None:
        runs = demo("dip")
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs))
        self.assertTrue(all("let-go" in r["phases"][0] for r in runs))
        self.assertTrue(all(r["apart"] >= 900 for r in runs), [r["apart"] for r in runs])
        self.assertTrue(all(r["phases"][1] == ["break", "zoom", "over", "dip-run"] for r in runs))

    def test_the_flip_never_gets_to_zoom_in_time(self) -> None:
        # "they hang 110 to 750 m away ... until a head-on pass 44 to 46 s in;
        # the zoom starts 46 to 48 s in". Nobody lands a round.
        runs = demo("flip")
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs))
        self.assertTrue(all("headon" in r["phases"][0] for r in runs))
        self.assertTrue(all("flip-over" not in r["phases"][1] and "flip-guns" not in r["phases"][1] for r in runs))
        self.assertTrue(all(r["closest"] >= 90 for r in runs), [r["closest"] for r in runs])

    def test_the_ninja_never_dives(self) -> None:
        # "their nose never leaves you, so the dive never comes and you never fire"
        runs = demo("ninja")
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs))
        self.assertTrue(all("dive" not in r["phases"][1] for r in runs))
        self.assertTrue(all(r["shots"][1] == 0 for r in runs))
        self.assertTrue(all("let-go" in r["phases"][0] for r in runs))


class TheJetFileTests(unittest.TestCase):
    def test_it_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", jet_lesson("break-turn", demo="move")["era"])
        self.assertIsNone(jet_lesson("break-turn", demo="move", base=True)["era"])


if __name__ == "__main__":
    unittest.main()
