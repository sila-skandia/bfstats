"""The up-and-over lesson's shape: the fight flown is the tactic its words
describe, from nine nearby starts (features/dogfight-school,
reviews/vertical.md).

The outcome tests in `test_dogfight_school.py` say who hit whom; these say
how. The move ("You follow him up"): he pulls nearly straight up out of a
real chase, goes over the top in a half loop, and the pilot who follows him
up runs out of speed well below him. The counter ("You follow shallow"): the
follower climbs at 20 to 30 degrees with his nose under the ace, is the
faster plane and inside the guns when the ace hangs at the top, and gets the
first hits.

`dogfight_shape_vertical.mjs` flies the lesson's two demos (the same
Spitfire on the engine's own flight law as the school harness) and prints
the measures; the thresholds below are the adversarial review's
(`reviews/vertical.md` names each one that was relaxed, and why).
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

HARNESS = Path(__file__).resolve().parent / "dogfight_shape_vertical.mjs"


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
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class UpAndOverShape(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def runs(self, demo: str) -> list[dict]:
        return self.results["demos"][demo]

    def every_run(self):
        for demo in ("move", "counter"):
            for r in self.runs(demo):
                yield demo, r

    # --- his move, the same in both demos -----------------------------------

    def test_he_pulls_nearly_straight_up_and_trades_his_speed_for_height(self) -> None:
        # Nose 70 degrees or more, 200 m or more bought, down to 32 m/s or
        # less within 10 s of starting the pull.
        for demo, r in self.every_run():
            with self.subTest(demo=demo, dx=r["dx"], dv=r["dv"]):
                self.assertGreaterEqual(r["pullPitch"], 70, r)
                self.assertGreaterEqual(r["gain"], 200, r)
                self.assertLessEqual(r["topSpeed"], 32, r)
                self.assertLessEqual(r["tTop"] - r["tPull"], 10, r)

    def test_he_pulls_out_of_a_real_chase(self) -> None:
        # A chase first (not a pull on the first tick), and the pull no
        # later than 8 s in.
        for demo, r in self.every_run():
            with self.subTest(demo=demo, dx=r["dx"], dv=r["dv"]):
                self.assertGreaterEqual(r["tPull"], 1.0, r)
                self.assertLessEqual(r["tPull"], 8.0, r)

    def test_over_the_top_he_comes_back_the_way_he_came(self) -> None:
        # A half loop: 120 degrees or more of heading by the time the nose
        # is back below the horizon, within 6 s of starting over.
        for demo, r in self.every_run():
            with self.subTest(demo=demo, dx=r["dx"], dv=r["dv"]):
                self.assertGreaterEqual(r["overTurn"], 120, r)
                self.assertLessEqual(r["overSeconds"], 6, r)

    def test_his_zoom_back_up_is_short(self) -> None:
        for demo, r in self.every_run():
            with self.subTest(demo=demo, dx=r["dx"], dv=r["dv"]):
                self.assertLessEqual(r["zoomMax"], 10, r)

    def test_both_demos_fly_the_other_seat_at_the_same_skill(self) -> None:
        self.assertEqual(1, len(set(self.results["skills"])), self.results["skills"])

    # --- the move: you follow him up -----------------------------------------

    def test_following_him_up_you_climb_steep(self) -> None:
        # From your reaction to his top, a mean climb of 45 degrees or more:
        # you went up after him, nothing like the counter's 25.
        for r in self.runs("move"):
            with self.subTest(dx=r["dx"], dv=r["dv"]):
                self.assertGreaterEqual(r["youClimb"], 45, r)

    def test_following_him_up_you_run_out_of_speed_well_below_him(self) -> None:
        # You hang under 20 m/s, your top 40 m or more below his.
        for r in self.runs("move"):
            with self.subTest(dx=r["dx"], dv=r["dv"]):
                self.assertLess(r["youSlowest"], 20, r)
                self.assertGreaterEqual(r["topGap"], 40, r)

    def test_when_he_has_the_shot_he_has_it_from_above(self) -> None:
        # Of all his seconds with a shot that lands, 70 % or more from 40 m
        # or more above you; and he never trades a head-on pass with a pilot
        # fast enough to fly his guns (at most one stray hit across nine).
        runs = self.runs("move")
        shot = sum(r["aceShot"] for r in runs)
        above = sum(r["aceShotAbove"] for r in runs)
        self.assertGreater(shot, 0, runs)
        self.assertGreaterEqual(above / shot, 0.7, (above, shot))
        head_on = [h for r in runs for h in r["hitsBy"][0] if h["aspect"] > 120 and h["hisV"] >= 35]
        self.assertLessEqual(len(head_on), 1, head_on)

    def test_following_him_up_you_never_get_a_shot_at_him_hanging(self) -> None:
        self.assertEqual(0, sum(1 for r in self.runs("move") if r["shotAtTop"]))

    # --- the counter: you follow shallow -------------------------------------

    def test_following_shallow_you_climb_20_to_30_degrees_nose_under_him(self) -> None:
        runs = self.runs("counter")
        in_band = [r for r in runs if 20 <= r["youClimb"] <= 30]
        self.assertGreaterEqual(len(in_band), 6, [(r["dx"], r["dv"], r["youClimb"]) for r in runs])
        for r in runs:
            with self.subTest(dx=r["dx"], dv=r["dv"]):
                self.assertGreaterEqual(r["youClimb"], 15, r)
                self.assertLessEqual(r["youClimb"], 30, r)
                self.assertGreaterEqual(r["youOff"], 3, r)

    def test_at_his_top_you_are_faster_and_inside_his_reach(self) -> None:
        for r in self.runs("counter"):
            with self.subTest(dx=r["dx"], dv=r["dv"]):
                self.assertGreaterEqual(r["atTop"]["faster"], 15, r)
                self.assertLessEqual(r["atTop"]["range"], 280, r)

    def test_you_have_the_shot_as_he_hangs(self) -> None:
        runs = self.runs("counter")
        self.assertGreaterEqual(sum(1 for r in runs if r["shotAtTop"]), 6,
                                [(r["dx"], r["dv"], r["shotAtTop"], r["atTop"]) for r in runs])

    def test_you_hit_him_first_while_he_is_slow(self) -> None:
        runs = self.runs("counter")
        self.assertGreaterEqual(sum(1 for r in runs if r["youFirst"]), 7,
                                [(r["dx"], r["dv"], r["hitsBy"][1][:1], r["hitsBy"][0][:1]) for r in runs])

    def test_the_words_numbers_hold(self) -> None:
        # The lesson's words: "you hung 45 to 115 m below him every time",
        # "at 13 m/s", "under one hit a fight"; "15 to 18 m/s faster than him
        # and 180 to 275 m away", "first hits in 7 of the 9", "11 a fight to
        # his 0.2".
        move, counter = self.runs("move"), self.runs("counter")
        for r in move:
            self.assertGreaterEqual(r["topGap"], 45, r)
            self.assertLessEqual(r["topGap"], 120, r)
            self.assertLess(r["youSlowest"], 14, r)
        self.assertLess(sum(r["hits"][0] for r in move) / 9, 1)
        for r in counter:
            self.assertGreaterEqual(r["atTop"]["faster"], 15, r)
            self.assertLessEqual(r["atTop"]["faster"], 19, r)
            self.assertGreaterEqual(r["atTop"]["range"], 175, r)
        you = sum(r["hits"][1] for r in counter) / 9
        him = sum(r["hits"][0] for r in counter) / 9
        self.assertGreater(you, 9, you)
        self.assertLess(him, 0.5, him)


if __name__ == "__main__":
    unittest.main()
