"""Galactic Conquest's dogfight lessons (`viewer/dogfight-lessons/gcmod/`,
features/dogfight-lessons-gcmod): every number their words give, flown from
the school's nine starts on the published X-Wing and TIE fighter
(`fixtures/gc-starfighters.json`) by `dogfight_gcmod_harness.mjs`, and the
lessons shown on GCMOD only.
"""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent / "viewer"
HARNESS = HERE / "dogfight_gcmod_harness.mjs"

_RUNS = None


def runs() -> dict:
    global _RUNS
    if _RUNS is None:
        out = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, check=True, timeout=1200)
        _RUNS = json.loads(out.stdout.strip().splitlines()[-1])
    return _RUNS


def wins(demo, who):
    return sum(1 for r in demo if r["winner"] == who)


def span(demo, key, idx=None):
    vals = [r[key] if idx is None else r[key][idx] for r in demo]
    vals = [v for v in vals if v is not None]
    return min(vals), max(vals)


class NeverRaceATie(unittest.TestCase):
    """`dont-race-a-tie`: running and braking lose 9 of 9; the turn is never hit."""

    def setUp(self):
        self.L = runs()["dont-race-a-tie"]

    def test_running_is_shot_down_every_time(self):
        d = self.L["move"]
        self.assertEqual(9, wins(d, "ace"))
        lo, hi = span(d, "t")
        self.assertGreaterEqual(lo, 15.8 - 0.05)
        self.assertLessEqual(hi, 16.2 + 0.05)
        self.assertEqual({7}, {r["hits"][0] for r in d})
        self.assertEqual({0}, {r["hits"][1] for r in d})
        self.assertEqual((95, 95), span(d, "closest"))

    def test_the_brakes_do_not_save_you(self):
        d = self.L["brake"]
        self.assertEqual(9, wins(d, "ace"))
        lo, hi = span(d, "t")
        self.assertGreaterEqual(lo, 14.7 - 0.05)
        self.assertLessEqual(hi, 16.8 + 0.05)
        self.assertEqual((25, 25), span(d, "minSpeed", 1))
        lo, hi = span(d, "minSpeed", 0)
        self.assertGreaterEqual(lo, 39)
        self.assertLessEqual(hi, 41)
        passed = [r["passed"] for r in d if r["passed"] is not None]
        self.assertEqual(3, len(passed))
        self.assertTrue(all(18.5 <= p <= 19.5 for p in passed))

    def test_the_turn_is_never_hit(self):
        d = self.L["counter"]
        self.assertEqual(9, sum(1 for r in d if r["winner"] is None))
        self.assertEqual({0}, {r["hits"][0] for r in d})
        lo, hi = span(d, "passed")
        self.assertGreaterEqual(lo, 8.5)
        self.assertLessEqual(hi, 19.5)
        self.assertEqual(9, sum(1 for r in d if r["passed"] is not None))
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertEqual((52, 224), span(d, "apart"))
        self.assertEqual(1, sum(1 for r in d if r["hits"][1] == 2))
        self.assertEqual(8, sum(1 for r in d if r["hits"][1] == 0))


class FourGunsToOne(unittest.TestCase):
    """`four-guns-to-one`: the X-Wing wins the joust; a TIE that leaves is never hit."""

    def setUp(self):
        self.L = runs()["four-guns-to-one"]

    def test_the_x_wing_wins_the_joust(self):
        d = self.L["move"]
        self.assertEqual(9, wins(d, "you"))
        lo, hi = span(d, "t")
        self.assertGreaterEqual(lo, 6.1 - 0.05)
        self.assertLessEqual(hi, 7.1 + 0.05)
        self.assertEqual({4}, {r["hits"][1] for r in d})
        self.assertEqual((0, 4), span(d, "hits", 0))

    def test_coming_back_round_still_loses_five(self):
        d = self.L["slash"]
        self.assertEqual(5, wins(d, "you"))
        self.assertEqual(4, sum(1 for r in d if r["winner"] is None))
        self.assertEqual(0, wins(d, "ace"))
        times = [r["t"] for r in d if r["winner"] == "you"]
        self.assertGreaterEqual(min(times), 10.3 - 0.05)
        self.assertLessEqual(max(times), 10.9 + 0.05)
        self.assertLessEqual(span(d, "hits", 0)[1], 2)

    def test_the_tie_that_leaves_is_never_hit(self):
        d = self.L["counter"]
        self.assertEqual(9, sum(1 for r in d if r["winner"] is None))
        self.assertEqual({0}, {r["hits"][0] for r in d} | {r["hits"][1] for r in d})
        self.assertGreaterEqual(span(d, "closest")[0], 1124)
        lo, hi = span(d, "apart")
        self.assertGreaterEqual(lo, 2150)
        self.assertLessEqual(hi, 2250)


class TheWordsQuoteTheRuns(unittest.TestCase):
    """The lessons' own words carry the numbers the runs hold."""

    def test_the_words(self):
        src = (VIEWER / "dogfight-lessons" / "gcmod" / "index.js").read_text()
        for phrase in ("shot you down in all nine, 16 s in", "15 to 17 s in", "52 to 224 m apart",
                       "6.1 to 7.1 s in", "five of nine, 10.3 to 10.9 s in", "1,124 m", "2.2 km apart",
                       "108 m/s to the X-Wing's 79", "21 bolts a second", "4.8"):
            self.assertIn(phrase.replace("'", "\\'"), src, phrase)


class TheBrake(unittest.TestCase):
    """`gc_brake_probe.mjs`: full reverse stands the X-Wing on its lift engines."""

    def test_the_x_wing_stands_on_the_air(self):
        out = subprocess.run(["node", str(HERE / "gc_brake_probe.mjs"), "X-Wing"], capture_output=True, text=True,
                             check=True, timeout=300)
        got = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertAlmostEqual(86.3, got["brakeAt"], delta=0.15)
        self.assertAlmostEqual(7.7, got["lowest"], delta=0.15)
        self.assertAlmostEqual(9.8, got["after"], delta=0.15)
        self.assertAlmostEqual(51.1, got["climbed"], delta=1)
        src = (VIEWER / "dogfight-lessons" / "gcmod" / "index.js").read_text()
        self.assertIn("from 86 m/s to 7.7 in 9.8 s, climbing 51 m", src)


class ShownOnGcmodOnly(unittest.TestCase):
    """`lessonsFor`: GCMOD's lessons first on GCMOD, on no other tree; found by id anywhere."""

    def test_listing(self):
        script = (
            "const { lessonsFor, lessonById, fighterRank } = await import(" + json.dumps((VIEWER / "dogfight-lessons.js").as_uri()) + ");"
            "console.log(JSON.stringify({ gc: lessonsFor('gcmod').slice(0, 2).map(l => l.id),"
            " vanilla: lessonsFor(null).filter(l => l.mods).length, dc: lessonsFor('desertcombat').filter(l => l.mods).length,"
            " byId: !!lessonById('four-guns-to-one'),"
            " ranks: ['X-Wing', 'tiefighter', 'tiebomber', 'Lambda', 'Spitfire'].map(fighterRank) }));"
        )
        out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True,
                             cwd=VIEWER)
        got = json.loads(out.stdout)
        self.assertEqual(["dont-race-a-tie", "four-guns-to-one"], got["gc"])
        self.assertEqual(0, got["vanilla"])
        self.assertEqual(0, got["dc"])
        self.assertTrue(got["byId"])
        x, tie, bomber, lam, spit = got["ranks"]
        self.assertLess(x, 100)
        self.assertLess(tie, 100)
        self.assertEqual(900, bomber)
        self.assertEqual(900, lam)
        self.assertEqual(0, spit)


if __name__ == "__main__":
    unittest.main()
