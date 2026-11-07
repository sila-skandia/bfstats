"""The shapes of "Out of his lock" and the chop demos of "On his tail".

features/dogfight-school/reviews/tail.md. Outcome tests let a fight end the
right way for the wrong reason; these hold what is flown, tick by tick, from
the nine nearby starts the school's suite uses: the hunter locked on before
you move, the dive and the hard turn that do not shake him, the early turn
into him that makes the chase a head-on pass, the chop only while he sits
close behind you and is closing, the fly-past it makes, and him running in
front of you after it; on his tail, the fly-past when you sit close and the
lag out wide that never flies past.

`dogfight_shape_tail.mjs` flies them (its top is the school harness's).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_dogfight_school import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "dogfight_shape_tail.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=300, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class _Shapes(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def runs(self, lesson: str, demo: str) -> list[dict]:
        return self.results[lesson][demo]


class OutOfTheLockShapes(_Shapes):
    """Two moves that do not shake him (the dive, the hard turn) and two that
    do (turning into him early, the turn then the chop). "Locked" is him in
    your rear quarter, his nose within 30 degrees of you, inside 300 m."""

    def test_every_fight_stays_off_the_ground_and_both_keep_flying_speed(self) -> None:
        # You bottom out at 26 m/s in the chop (the price of it) and at 33
        # pulling out of the dive, as he does following you; elsewhere both
        # stay above 34.
        for demo in ("without", "move", "flat", "meet", "counter"):
            for r in self.runs("lock", demo):
                self.assertNotEqual("flew into the ground", r["why"], (demo, r))
                self.assertGreaterEqual(r["lowest"], 150, (demo, r))
                self.assertGreaterEqual(r["hunterMinV"], 34 if demo != "move" else 25, (demo, r))
                self.assertGreaterEqual(r["youMinV"], 34 if demo not in ("move", "counter") else 25, (demo, r))

    def test_flying_straight_he_gets_on_your_tail_and_kills_you(self) -> None:
        for r in self.runs("lock", "without"):
            self.assertEqual(0, r["winner"], r)
            self.assertGreaterEqual(r["tailSecs"], 10, r)
            self.assertGreaterEqual(r["minRange"], 80, r)

    def test_every_counter_starts_with_him_locked_on(self) -> None:
        # He is locked on at least 3 s before you move. The early turn is the
        # move made while he is still out at 400 m: locked inside 450 m.
        for demo in ("move", "flat", "counter"):
            for r in self.runs("lock", demo):
                self.assertGreaterEqual(r["lockBefore300"], 3, (demo, r))
        for r in self.runs("lock", "meet"):
            self.assertGreaterEqual(r["lockBefore450"], 2.5, r)
            self.assertEqual(0, r["lockBefore300"], r)

    def test_diving_away_does_not_shake_him(self) -> None:
        # "he dives with you, sits about 140 m behind you all the way down,
        # his nose on you, and when you pull out he closes in and lands 7 to
        # 20 hits".
        for r in self.runs("lock", "move"):
            self.assertEqual(["watch", "dive", "zoom"], r["phases"][:3], r)
            self.assertGreaterEqual(r["tailInDive"], 0.9, r)
            self.assertTrue(120 <= r["diveRange"] <= 160, r)
            self.assertGreaterEqual(r["lockAfter"], 8, r)
            self.assertGreaterEqual(r["hits"][0], 5, r)
            self.assertEqual(0, r["hits"][1], r)
            self.assertEqual(0, r["inFrontAfter"], r)

    def test_a_hard_turn_alone_spoils_his_aim_but_he_stays_behind_you(self) -> None:
        # He follows you round 40 to 100 m back: in your rear half most of
        # the time, his nose on you only in short sweeps, never in front.
        for r in self.runs("lock", "flat"):
            self.assertEqual([0, 0], r["hits"], r)
            self.assertLessEqual(r["lockRunAfter"], 2.5, r)
            self.assertEqual(0, r["inFrontAfter"], r)
            self.assertEqual(0, r["headOnPasses"], r)
            self.assertGreaterEqual(r["minRange"], 35, r)
            self.assertGreaterEqual(r["lowest"], 290, r)

    def test_turning_into_him_early_turns_the_chase_into_a_head_on_pass(self) -> None:
        # From 400 m he cannot follow you round: 2 s or so after the turn his
        # lock is gone, he comes at you head-on, and you pass over him.
        for r in self.runs("lock", "meet"):
            # The turn ends with your nose on him; by then he is often inside
            # 130 m and the meeting is the pass itself.
            self.assertEqual(["watch", "turn"], r["phases"][:2], r)
            self.assertIn("pass", r["phases"], r)
            self.assertLessEqual(r["lockAfter"], 3, r)
            self.assertGreaterEqual(r["headOnPasses"], 1, r)
            self.assertLessEqual(r["behindAfter"], 5, r)
            self.assertEqual([0, 0], r["hits"], r)
            self.assertGreaterEqual(r["minRange"], 20, r)

    def test_the_chop_comes_only_once_he_is_close_behind_in_the_turn(self) -> None:
        # The last quarter of the chop is the moment he comes past, which
        # ends it: 70% of it with him behind you on your heading.
        for r in self.runs("lock", "counter"):
            self.assertIsNotNone(r["chopAt"], r)
            self.assertGreaterEqual(r["chopAt"] - r["counterAt"], 4, r)
            self.assertLessEqual(r["chopRange"], 90, r)
            self.assertGreaterEqual(r["chopBehind"], 0.7, r)

    def test_the_chop_makes_him_fly_past_underneath_on_your_heading(self) -> None:
        # He passes close, 5 to 14 m below you: your circle is 120 m across
        # and he is 60 m behind you in it when you chop. A pass under 20 m is
        # what the chop is; nothing collides.
        for r in self.runs("lock", "counter"):
            o = r["overshoot"]
            self.assertIsNotNone(o, r)
            self.assertLessEqual(o["dH"], 15, r)
            self.assertGreaterEqual(o["minR"], 4, r)
            self.assertLessEqual(o["t"] - r["chopAt"], 8, r)

    def test_after_he_flies_past_the_roles_are_swapped(self) -> None:
        # He runs, and for most of the next 15 s he is in front of you with
        # his tail to you, never back on yours. You are slow (26 to 40 m/s)
        # and he is faster, so the strict landing-shot ticks are short (0 to
        # 1.8 s); the hits are what counts: at least one in every fight.
        rows = self.runs("lock", "counter")
        for r in rows:
            self.assertTrue(r["heRuns"], r)
            self.assertGreaterEqual(r["heInFront"], 8, r)
            self.assertLess(r["heBack"], 1, r)
            self.assertGreaterEqual(r["youHitsAfter"], 1, r)
            self.assertEqual(0, r["hits"][0], r)
        self.assertGreaterEqual(sum(r["youHitsAfter"] for r in rows), 15)


class OnHisTailShapes(_Shapes):
    def test_sitting_close_he_chops_you_fly_past_and_he_turns_onto_you(self) -> None:
        for r in self.runs("tail", "close"):
            self.assertIsNotNone(r["chopAt"], r)
            self.assertLessEqual(r["chopOffTail"], 50, r)
            self.assertLessEqual(r["chopRange"], 90, r)
            o = r["overshoot"]
            self.assertIsNotNone(o, r)
            self.assertLessEqual(o["dH"], 15, r)
            self.assertGreaterEqual(o["minR"], 4, r)
            self.assertGreaterEqual(r["heOnYou"], 0.4, r)
            self.assertGreaterEqual(r["hits"][0], 2, r)
            # You run once past him (the hunter's `extend`); a round of yours
            # can land as you go by, never more than one.
            self.assertLessEqual(r["hits"][1], 1, r)

    def test_lagging_out_wide_you_never_fly_past_and_shoot_when_he_rolls_out(self) -> None:
        # His nose sweeps past you once a circle at 190 m and more: under a
        # second inside 200 m in any fight, never a burst worth more than one hit.
        rows = self.runs("tail", "lag")
        for r in rows:
            self.assertGreaterEqual(r["breakAt"], 280, r)
            self.assertTrue(250 <= r["medianRange"] <= 300, r)
            self.assertGreaterEqual(r["minRangeAfter"], 180, r)
            self.assertGreaterEqual(r["fast"], 0.95, r)
            self.assertLessEqual(r["headOn"], 30, r)
            self.assertEqual(0, r["chops"], r)
            self.assertTrue(r["rolledOut"], r)
            self.assertLessEqual(r["hits"][0], 1, r)
            self.assertTrue(all(off <= 45 for off in r["hitsOffTail"]), r)
        self.assertGreaterEqual(sum(1 for r in rows if r["winner"] == 1), 7)


if __name__ == "__main__":
    unittest.main()
