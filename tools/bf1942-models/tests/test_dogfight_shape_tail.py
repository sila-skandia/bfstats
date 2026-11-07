"""The shapes of "Out of his lock" and the chop demos of "On his tail".

features/dogfight-school/reviews/tail.md. Outcome tests let a fight end the
right way for the wrong reason; these hold what is flown, tick by tick, from
the nine nearby starts the school's suite uses: the hunter locked on before
you move, the dive and the hard turn that do not shake him, the early turn
into him that makes the chase a head-on pass, and the chop that, under the
eyes (reviews/eyes.md), no longer makes him fly past; on his tail, the fly-past when you sit close and the
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
        # You bottom out at 24.5 m/s in the chop (the price of it) and at 32
        # pulling out of the dive, he at 29.5 following you down; elsewhere
        # both stay above 34.
        for demo in ("without", "move", "flat", "meet", "counter"):
            for r in self.runs("lock", demo):
                self.assertNotEqual("flew into the ground", r["why"], (demo, r))
                self.assertGreaterEqual(r["lowest"], 150, (demo, r))
                self.assertGreaterEqual(r["hunterMinV"], 34 if demo != "move" else 25, (demo, r))
                self.assertGreaterEqual(r["youMinV"], 34 if demo not in ("move", "counter") else 24, (demo, r))

    def test_flying_straight_he_gets_on_your_tail_and_kills_you(self) -> None:
        for r in self.runs("lock", "without"):
            self.assertEqual(0, r["winner"], r)
            self.assertGreaterEqual(r["tailSecs"], 10, r)
            self.assertGreaterEqual(r["minRange"], 80, r)

    def test_every_counter_starts_with_him_locked_on(self) -> None:
        # He is locked on at least 3 s before you move (5.7 s or more: he
        # comes in from your rear quarter, where a gentle turn toward him
        # keeps him in sight). The early turn is the move made while he is
        # still out at 400 m: locked inside 450 m for 2 s or more.
        for demo in ("move", "flat", "counter"):
            for r in self.runs("lock", demo):
                self.assertGreaterEqual(r["lockBefore300"], 3, (demo, r))
        for r in self.runs("lock", "meet"):
            self.assertGreaterEqual(r["lockBefore450"], 2, r)
            self.assertEqual(0, r["lockBefore300"], r)

    def test_diving_away_does_not_shake_him(self) -> None:
        # "he dives with you, 120 to 145 m behind you all the way down, his
        # nose on you, and when you pull out he closes in: shot down in 7 of
        # 9, and 20 and 4 hits in the other two". In one start he slips into
        # the cone behind your headrest before you dive, and you clear first.
        rows = self.runs("lock", "move")
        for r in rows:
            self.assertEqual("watch", r["phases"][0], r)
            self.assertIn("dive", r["phases"][:3], r)
            self.assertGreaterEqual(r["tailInDive"], 0.9, r)
            self.assertTrue(115 <= r["diveRange"] <= 150, r)
            self.assertGreaterEqual(r["lockAfter"], 8, r)
            self.assertGreaterEqual(r["hits"][0], 4, r)
            self.assertEqual(0, r["hits"][1], r)
            self.assertEqual(0, r["inFrontAfter"], r)
        self.assertEqual(7, sum(1 for r in rows if r["winner"] == 0))

    def test_a_hard_turn_alone_spoils_his_aim_but_he_stays_behind_you(self) -> None:
        # He follows you round, never closer than about 50 m: in your rear half most of
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
            # The pass: 14 to 19 m over him.
            self.assertGreaterEqual(r["minRange"], 14, r)

    def test_the_chop_comes_once_he_is_close_in_the_turn(self) -> None:
        # In 8 of 9 the chop comes 4 s or more into the turn, with him 53 to
        # 56 m behind you; in the ninth he never slides in that close.
        rows = self.runs("lock", "counter")
        chopped = [r for r in rows if r["chopAt"] is not None]
        self.assertEqual(8, len(chopped))
        for r in chopped:
            self.assertGreaterEqual(r["chopAt"] - r["counterAt"], 4, r)
            self.assertTrue(50 <= r["chopRange"] <= 60, r)

    def test_under_the_eyes_the_chop_no_longer_makes_him_fly_past(self) -> None:
        # Under the eyes (reviews/eyes.md) the chop does not break the lock:
        # he slides under your tail, where you cannot see him, and stays in
        # your rear half inside 300 m for all 20 s after the turn. He never
        # flies past, never runs, never sits in front of you; one hit on you
        # in nine fights, none on him.
        rows = self.runs("lock", "counter")
        for r in rows:
            self.assertIsNone(r["overshoot"], r)
            self.assertFalse(r["heRuns"], r)
            self.assertEqual(0, r["heInFront"], r)
            self.assertEqual(20, r["rearAfter"], r)
            self.assertEqual(0, r["hits"][1], r)
        self.assertLessEqual(sum(r["hits"][0] for r in rows), 1)


# On his tail's chop demos (`close`, `lag`) were retired on 2026-11-07
# (reviews/dfn-ot.md, "Ascendancy"): under the eyes the chopper chopped in 4
# of 9 and never into a fly-past, nobody was hit, and lagging out wide shot
# nobody down (0 of 9) while turning in lockstep with him, the move the
# owner objected to. The lesson's Dip, Flip and Ninja are test_dogfight_dfn_ot's.


if __name__ == "__main__":
    unittest.main()
