"""The shape of the two height lessons, not just their outcomes.

features/dogfight-school (reviews/height.md). The owner watched the first
reconstructions and saw the planes "spaz out and do their own thing" after
the first contact. These tests hold boom and zoom, and when he has the
height, to the manoeuvres their words describe, from the nine nearby starts
the school's tests use:

    he dives steeply from above, fires one short burst, zooms back above
    you, turns over the top and comes down again; meeting each dive makes
    it a head-on pass he breaks off, and every dive starts lower; climbing
    straight under him is fatal in one pass, turning flat holds your height
    and gets you nothing, climbing between his dives gets the height back.

`dogfight_shape_height.mjs` is run after the head of
`dogfight_school_harness.mjs` (its imports and the Spitfire), and measures
every demo the way a pilot reads it from above and from the side.
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

from test_dogfight_school import HARNESS, MODULES, THREE_PACKAGE  # noqa: E402

SHAPE = Path(__file__).resolve().parent / "dogfight_shape_height.mjs"


def run_shape() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[:head.index("// --- the stick")]
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


class _Shape(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_shape()

    def runs(self, lesson_id: str, demo_id: str) -> list[dict]:
        rows = self.results[lesson_id][demo_id]
        self.assertEqual(9, len(rows))
        return rows

    @staticmethod
    def kill_passes(run: dict) -> list[dict]:
        """The passes he flew up to the kill (or the end)."""
        end = run["end"]["t"] if run["end"] else float("inf")
        return [p for p in run["passes"] if p["t"] <= end]


class BoomAndZoomTests(_Shape):
    """He bounces you; you meet the dive."""

    def test_he_shoots_down_the_pilot_who_never_looks_up_in_two_or_three_passes(self) -> None:
        # "shot down every time, in two or three passes": one burst is fewer
        # rounds than bring a fighter down, so it is never the first pass.
        for run in self.runs("boom-and-zoom", "move"):
            self.assertEqual(0, (run["end"] or {}).get("winner"), run["end"])
            self.assertIn(len(self.kill_passes(run)), (2, 3), run["passes"])
            self.assertEqual(100, run["landedInDive"], run)

    def test_every_pass_is_a_steep_dive_and_one_short_burst(self) -> None:
        for run in self.runs("boom-and-zoom", "move"):
            first = run["passes"][0]
            # "at 45 to 50 degrees", and still diving with a big overtake
            # when he opens fire.
            self.assertLessEqual(first["divePitch"], -40, first)
            self.assertLessEqual(first["firstShot"]["pitch"], -15, first)
            self.assertGreaterEqual(first["firstShot"]["closure"], 35, first)
            for p in self.kill_passes(run):
                self.assertLessEqual(p["fireRun"], 1.0, p)

    def test_after_each_pass_he_zooms_back_above_you(self) -> None:
        for run in self.runs("boom-and-zoom", "move"):
            passes = self.kill_passes(run)
            self.assertGreaterEqual(run["zooms"], len(passes) - 1, run)
            # Every pass but the one that kills (the fight stops there).
            for p in passes[:-1]:
                self.assertGreaterEqual(p["zoomAbove"], 80, p)
                self.assertGreaterEqual(p["aboveAfter"], 0, p)

    def test_meeting_the_dive_makes_each_pass_head_on_and_wide(self) -> None:
        for run in self.runs("boom-and-zoom", "counter"):
            self.assertEqual(0, run["hits"][0], run)
            for p in run["passes"]:
                if p["gap"] >= 100:
                    self.assertGreaterEqual(p["merge"]["range"], 40, p)
                    self.assertGreaterEqual(p["merge"]["noses"], 120, p)
                else:
                    # His height spent, a perch's "dive" from under 100 m
                    # over you never comes near.
                    self.assertGreaterEqual(p["merge"]["range"], 250, p)
            # His first pull-out leaves him above you; the later ones, from
            # 150 m or less, may bottom out level with you.
            self.assertGreaterEqual(run["passes"][0]["aboveAfter"], 50, run["passes"][0])

    def test_every_dive_he_wastes_starts_lower(self) -> None:
        # "his two dives start 400 and 190 to 240 m above you, and
        # after the second he has to climb back up beside you".
        for run in self.runs("boom-and-zoom", "counter"):
            passes = run["passes"]
            self.assertGreaterEqual(len(passes), 2, passes)
            gaps = [p["gap"] for p in passes]
            self.assertEqual(gaps, sorted(gaps, reverse=True), gaps)
            self.assertGreaterEqual(gaps[0], 390, gaps)
            self.assertGreaterEqual(gaps[1], 190, gaps)
            self.assertLessEqual(gaps[1], 240, gaps)
            self.assertTrue(all(g < 100 for g in gaps[2:]), gaps)
            egaps = [p["egap"] for p in passes]
            self.assertTrue(all(a - b >= 50 for a, b in zip(egaps, egaps[1:])), egaps)

    def test_you_face_him_flat_and_only_while_he_comes_down(self) -> None:
        for run in self.runs("boom-and-zoom", "counter"):
            you = run["you"]
            self.assertLessEqual(you["maxPitch"], 30, you)
            self.assertGreaterEqual(you["minV"], 38, you)
            self.assertGreaterEqual(run["faceInDive"], 90, run)

    def test_between_dives_you_climb_shallow_with_him_in_sight(self) -> None:
        # "climb shallow, about 10 degrees, turning gently to keep him in
        # sight".
        for run in self.runs("boom-and-zoom", "counter"):
            you = run["you"]
            self.assertGreaterEqual(you["climbPitch"], 6, you)
            self.assertLessEqual(you["climbPitch"], 20, you)
            self.assertGreaterEqual(you["climbRate"], 5, you)
            self.assertGreaterEqual(you["climbInView"], 60, you)
            self.assertLessEqual(run["maxRange"], 1200, run)


class UnderTheHeightTests(_Shape):
    """You climb straight; you turn flat; you climb between his dives."""

    def test_climbing_straight_is_shot_down_in_one_pass(self) -> None:
        for run in self.runs("under-the-height", "move"):
            self.assertEqual(0, (run["end"] or {}).get("winner"), run["end"])
            self.assertLess(run["end"]["t"], 15, run["end"])
            self.assertEqual(1, len(self.kill_passes(run)), run["passes"])
            self.assertEqual(100, run["landedInDive"], run)
            # "30 degrees nose up, a Spitfire is down to 35 m/s".
            self.assertGreaterEqual(run["you"]["maxPitch"], 25, run["you"])
            self.assertLessEqual(run["you"]["maxPitch"], 32, run["you"])
            self.assertLessEqual(run["vAtEnd"], 37, run)
            self.assertLessEqual(run["passes"][0]["fireRun"], 2.0, run["passes"][0])

    def test_turning_flat_holds_your_height_and_gets_nothing_back(self) -> None:
        for run in self.runs("under-the-height", "flat"):
            you = run["you"]
            self.assertEqual(0, run["hits"][0], run)
            self.assertLessEqual(you["dyMax"], 60, you)
            self.assertEqual(0, you["floor"], you)
            self.assertGreaterEqual(you["minV"], 40, you)
            self.assertGreaterEqual(len(run["passes"]), 2, run["passes"])

    def test_climbing_between_his_dives_breaks_each_one_and_he_comes_down_lower(self) -> None:
        # "in seven of nine fights he never gets above you again for a second
        # dive; in two his second dive starts about 140 m above you, not 520,
        # and he pulls out of it without a shot" (under the eyes he loses you
        # in his zoom, reviews/dfn-uh.md).
        seconds = []
        for run in self.runs("under-the-height", "counter"):
            self.assertEqual(0, run["hits"][0], run)
            passes = run["passes"]
            self.assertIn(len(passes), (1, 2), passes)
            self.assertGreaterEqual(len(run["breaks"]), 1, run["breaks"])
            # The first dive is broken into a few seconds before his pass; the
            # second he pulls out of without a shot, before you need to.
            first = passes[0]
            lead = [first["merge"]["t"] - b for b in run["breaks"] if 0 <= first["merge"]["t"] - b <= 4.5]
            self.assertTrue(lead, (first, run["breaks"]))
            for p in passes[1:]:
                self.assertEqual(0, p["shots"], p)
            gaps = [p["gap"] for p in passes]
            self.assertTrue(all(a > b for a, b in zip(gaps, gaps[1:])), gaps)
            seconds += gaps[1:]
            # He finishes below you.
            self.assertLess(run["aceAboveEnd"], 0, run)
        self.assertEqual(2, len(seconds), seconds)
        self.assertTrue(all(120 <= g <= 160 for g in seconds), seconds)

    def test_climbing_between_his_dives_wins_the_height_back_close_to_him(self) -> None:
        # "climbed 490 to 600 m: from 520 m under him to 70 to 330 m above
        # him", within a kilometre and a half of him, never on the ceiling or
        # the floor.
        flat = self.runs("under-the-height", "flat")
        for run, flat_run in zip(self.runs("under-the-height", "counter"), flat):
            you = run["you"]
            self.assertTrue(480 <= you["yMax"] - you["yMin"] <= 600, you)
            self.assertTrue(-330 <= run["aceAboveEnd"] <= -65, run)
            self.assertLessEqual(run["maxRange"], 1500, run)
            self.assertEqual(0, you["high"], you)
            self.assertEqual(0, you["low"], you)
            self.assertGreaterEqual(you["climbPitch"], 8, you)
            self.assertLessEqual(you["climbPitch"], 25, you)
            self.assertGreaterEqual(you["climbMinV"], 35, you)
            self.assertGreaterEqual(you["climbInView"], 70, you)
            self.assertGreater(you["yMax"] - flat_run["you"]["yMax"], 300, (you, flat_run["you"]))


if __name__ == "__main__":
    unittest.main()
