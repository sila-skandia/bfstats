"""The shape of the break turn: not only who wins, but what is flown.

features/dogfight-school (reviews/break.md). The break-turn lesson's three
demos and the two "On his tail" demos that fly the same breaking defender
(`breakTurn`), from the nine nearby starts the school's tests use, measured
by `dogfight_shape_break.mjs` the way a pilot reads them from above and
from the side.

What they defend, in the lesson's words:

- he breaks 300 m out, just outside the guns' reach, with the attacker in
  his rear quarter and closing, and the break goes toward the attacker;
- the attacker's closure carries him past the defender's tail, at a safe
  distance, and the defender reverses into him within two seconds;
- afterwards the attacker is back behind him, close, with his nose behind
  him (no lead) and no shot: BF1942's faster Spitfire turns faster, not
  wider (radius 55 to 75 m from 45 to 130 m/s, measured on the flight law),
  so the textbook "he flies out in front and you reverse onto his tail"
  does not happen, and the lesson does not claim it;
- the patient attacker's high yo-yo starts within a second and a half of
  the break, far out, climbs 40 m and more above him and stays there,
  never comes past his tail, and nobody lands a hit after the break.

The review asked the patient attacker to sit "behind him, under 300 m and
within 100 m to the side" 80% of the time. A Spitfire's hard turn is a
circle 110 to 120 m across, turned in about 9 s: anyone further than the
circle from him who is not in it sits beside it half the time. Staying out
of the circle is the yo-yo's point, so the test holds him above it instead.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_dogfight_school import HARNESS, MODULES, THREE_PACKAGE

SHAPE = Path(__file__).resolve().parent / "dogfight_shape_break.mjs"


def run_shape() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[: head.index("const out = {};")]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "shape.mjs").write_text(head + "\n" + SHAPE.read_text())
        proc = subprocess.run(["node", str(work / "shape.mjs")],
                              capture_output=True, text=True, timeout=300, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"shape harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BreakTurnShape(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_shape()

    def runs(self, key: str) -> list[dict]:
        return self.results[key]

    def each(self, key: str):
        for run in self.runs(key):
            with self.subTest(demo=key, dx=run["dx"], dv=run["dv"]):
                yield run

    # --- the break --------------------------------------------------------

    def test_he_breaks_300_m_out_into_an_attacker_on_his_rear_quarter(self) -> None:
        for key in ("break-turn/move", "break-turn/counter"):
            for run in self.each(key):
                self.assertTrue(270 <= run["breakRange"] <= 330, run)
                self.assertGreater(run["breakClosure"], 10, run)
                self.assertLess(run["breakHisNose"], 20, run)
                # Far enough to one side that which way is "into him" shows.
                self.assertGreaterEqual(abs(run["breakAcross"]), 40, run)
                self.assertGreater(abs(run["firstBank"]), 45, run)
                self.assertTrue(run["intoHim"], run)

    def test_on_his_tail_he_breaks_whether_you_rush_in_or_arrive_slow(self) -> None:
        # The break goes on range and the rear cone, not on the closure:
        # arriving slow does not stop him breaking.
        for key in ("on-his-tail/move", "on-his-tail/counter"):
            for run in self.each(key):
                self.assertTrue(270 <= run["breakRange"] <= 330, run)
                self.assertGreater(abs(run["firstBank"]), 45, run)
        for run in self.each("on-his-tail/move"):
            self.assertGreater(run["breakDv"], 15, run)
        for run in self.each("on-his-tail/counter"):
            self.assertLessEqual(abs(run["breakDv"]), 6, run)

    # --- the overshoot and the reversal ------------------------------------

    def test_the_rushing_attacker_comes_past_his_tail_and_he_reverses(self) -> None:
        for key in ("break-turn/move", "on-his-tail/move"):
            for run in self.each(key):
                self.assertIsNotNone(run.get("overT"), run)
                self.assertLessEqual(run["overT"] - run["breakT"], 10, run)
                self.assertGreaterEqual(run["minRange"], 25, run)
                # Within 2.5 s: the plan waits until he is 8 m across (so a
                # wobble does not flip the turn), and rolling from a full
                # turn one way to 45 degrees the other takes a Spitfire
                # about 1.8 s.
                self.assertIsNotNone(run["reversalT"], run)
                self.assertLessEqual(run["reversalT"], 2.5, run)

    def test_after_the_overshoot_he_is_back_behind_but_with_no_lead_and_no_shot(self) -> None:
        # "he swings back in behind you, close, inside your turn, his nose
        # behind you: he has no shot".
        for key in ("break-turn/move", "on-his-tail/move"):
            for run in self.each(key):
                self.assertGreaterEqual(run["afterBehind"], 70, run)
                self.assertLess(run["afterMedRange"], 80, run)
                self.assertGreaterEqual(run["afterNoLead"], 80, run)
                self.assertLessEqual(run["afterShotB"], 0.3, run)
                self.assertEqual(0, run["afterShotA"], run)

    def test_the_break_takes_his_shot_no_hit_after_its_first_two_seconds(self) -> None:
        # "barely took a hit, all of them in the first two seconds of the
        # break".
        for key in ("break-turn/move", "on-his-tail/move"):
            runs = self.runs(key)
            self.assertTrue(all(r["winner"] is None for r in runs), key)
            self.assertEqual(0, sum(r["hitsAfter"][1] for r in runs), key)
        # The green attacker barely gets a hit in; the sharper one rushing in
        # on "On his tail" lands about 3, all as the wings go over.
        self.assertLessEqual(sum(r["hits"][1] for r in self.runs("break-turn/move")) / 9, 1)
        self.assertLessEqual(sum(r["hits"][1] for r in self.runs("on-his-tail/move")) / 9, 4)

    # --- the counter: the high yo-yo ---------------------------------------

    def test_the_patient_attacker_yo_yos_as_he_breaks_and_stays_above_his_turn(self) -> None:
        for key in ("break-turn/counter", "on-his-tail/counter"):
            for run in self.each(key):
                self.assertLessEqual(run["yoyoAfterBreak"], 1.5, run)
                self.assertGreater(run["yoyoRange"], 150, run)
                self.assertGreaterEqual(run["yoyoMaxAbove"], 40, run)
                self.assertGreaterEqual(run["yoyoAboveShare"], 80, run)
                self.assertGreaterEqual(run["yoyoMinSpeed"], 35, run)

    def test_staying_patient_he_never_comes_past_close_and_nobody_is_hit(self) -> None:
        for run in self.each("break-turn/counter"):
            self.assertGreaterEqual(run["yoyoMinRange"], 60, run)
            self.assertEqual(0, run["reverses"], run)
            self.assertEqual(["watch", "break"], run["phasesA"], run)
            self.assertEqual([0, 0], run["hitsAfter"], run)
            self.assertEqual(0, run["shotA"], run)
        for run in self.each("on-his-tail/counter"):
            self.assertGreaterEqual(run["yoyoMinRange"], 40, run)
            self.assertEqual([0, 0], run["hitsAfter"], run)
            self.assertEqual(0, run["shotA"], run)
            self.assertNotIn("chase", run["phasesA"], run)

    # --- the words: labels and the fight without the break ------------------

    def test_he_reads_as_going_for_the_shot_only_with_his_nose_on_the_attacker(self) -> None:
        for key in ("break-turn/move", "break-turn/counter", "on-his-tail/move", "on-his-tail/counter"):
            for run in self.each(key):
                if run["attackNoseShare"] is not None:
                    self.assertGreaterEqual(run["attackNoseShare"], 90, run)

    def test_flying_straight_he_is_shot_down_every_time(self) -> None:
        self.assertEqual(9, sum(1 for r in self.runs("break-turn/without") if r["winner"] == 1))


if __name__ == "__main__":
    unittest.main()
