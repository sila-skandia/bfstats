"""The shape of the turnarounds lesson (features/dogfight-school): the
Immelmann and the split-S, flown from the nine nearby starts the school's
tests use, held to what a pilot sees from the side, not only to who won.

`dogfight_shape_loop.mjs` runs after the head of `dogfight_school_harness.mjs`
(its imports, the Spitfire and `makePlane`) and prints the measurements.
The thresholds are the reviewer's (features/dogfight-school/reviews/loop.md).
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

SHAPE = Path(__file__).resolve().parent / "dogfight_shape_loop.mjs"
IMMELMANNS = ("immelmann", "immelmann-counter")
# The dive on his split-S is now the lesson's Ninja (reviews/dfn-ta.md),
# flown against the ace who breaks when you get on his tail.
SPLITS = ("split", "ninja")


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
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"shape harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class TurnaroundShapeTests(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def runs(self, demo: str, key: str) -> list[dict]:
        rows = [r[key] for r in self.shape["demos"][demo]["runs"]]
        self.assertEqual(9, len(rows), demo)
        return rows

    # --- the Immelmann ------------------------------------------------------

    def test_the_immelmann_starts_after_the_pass_and_climbs_in_its_plane(self) -> None:
        for demo in IMMELMANNS:
            for m in self.runs(demo, "immelmann"):
                self.assertTrue(m["flown"], demo)
                # He goes up only once the other plane is behind his wing.
                self.assertGreater(m["ataAtStart"], 90, (demo, m))
                self.assertGreaterEqual(m["entrySpeed"], 58, (demo, m))
                # Wings level to the vertical, and no sideways drift out of
                # the loop's plane all the way over the top.
                self.assertLessEqual(m["bankUp"], 15, (demo, m))
                self.assertLess(m["drift"], 15, (demo, m))

    def test_the_immelmann_rolls_upright_on_top_onto_the_reversed_heading(self) -> None:
        for demo in IMMELMANNS:
            for m in self.runs(demo, "immelmann"):
                # The roll waits for the nose to come back to the horizon,
                # upside down.
                self.assertLessEqual(abs(m["roll"]["pitch"]), 15, (demo, m))
                self.assertLess(m["roll"]["up"], -0.8, (demo, m))
                self.assertGreaterEqual(m["headingTurned"], 165, (demo, m))

    def test_the_immelmann_trades_speed_for_height_and_keeps_it(self) -> None:
        for demo in IMMELMANNS:
            for m in self.runs(demo, "immelmann"):
                self.assertTrue(80 <= m["gain"] <= 140, (demo, m))
                self.assertTrue(25 <= m["topSpeed"] <= 40, (demo, m))
                # Not thrown away in a dive after it: still 60 m up 4 s on.
                self.assertGreaterEqual(m["keptAboveEntry"], 60, (demo, m))

    def test_following_him_up_from_close_in_runs_you_out_of_speed(self) -> None:
        for m in self.runs("immelmann", "immelmann"):
            self.assertLess(m["rangeAtTop"], 150, m)
            self.assertGreaterEqual(m["seatSteepest"], 65, m)
            self.assertLessEqual(m["seatSlowest"], 30, m)
            self.assertLess(m["seatSlowest"], m["topSpeed"], m)
            self.assertLessEqual(m["seatShots"], 0.3, m)

    def test_holding_off_puts_the_nose_on_the_top_of_his_loop_and_shoots(self) -> None:
        rows = self.runs("immelmann-counter", "immelmann")
        placed = [m for m in rows if 250 <= m["rangeAtTop"] <= 450 and m["seatAimAtTop"] < 10]
        self.assertGreaterEqual(len(placed), 7, rows)
        self.assertGreaterEqual(sum(1 for m in rows if m["seatShots"] >= 0.3), 7, rows)
        for m in rows:
            self.assertGreater(m["seatSlowest"], 35, m)
            self.assertLessEqual(m["seatSteepest"], 30, m)

    # --- the split-S --------------------------------------------------------

    def test_the_split_s_rolls_with_the_nose_level_then_pulls_through_in_its_plane(self) -> None:
        for demo in SPLITS:
            for m in self.runs(demo, "split"):
                self.assertTrue(m["flown"], demo)
                self.assertGreaterEqual(m["pull"]["bank"], 165, (demo, m))
                self.assertLessEqual(abs(m["pull"]["pitch"]), 20, (demo, m))
                self.assertLessEqual(m["lowestPitch"], -75, (demo, m))
                self.assertTrue(160 <= m["headingTurned"] <= 200, (demo, m))
                self.assertLess(m["drift"], 20, (demo, m))

    def test_the_split_s_trades_height_for_speed(self) -> None:
        for demo in SPLITS:
            for m in self.runs(demo, "split"):
                self.assertTrue(80 <= m["heightLost"] <= 250, (demo, m))
                self.assertGreaterEqual(m["exitSpeed"], m["entrySpeed"] + 15, (demo, m))

    def test_letting_a_split_s_go_lets_him_go(self) -> None:
        for m in self.runs("split", "split"):
            self.assertGreaterEqual(m["seatAboveAfter"], 150, m)
            self.assertEqual(0, m["seatShots"], m)
            self.assertEqual(0, m["aceShots"], m)

    def test_diving_on_a_split_s_at_once_takes_no_fire(self) -> None:
        # Against an ace who breaks once he is out of the half loop the fire
        # is a snap (under 0.5 s, held in test_dogfight_dfn_ta); he never
        # fires back, and you zoom before you are below him. His break
        # climbs, so the closest you come to his height is 0 to 32 m above.
        rows = self.runs("ninja", "split")
        for m in rows:
            self.assertEqual(0, m["aceShots"], m)
            self.assertLess(m["seatShots"], 0.5, m)
            self.assertGreaterEqual(m["seatAboveAfter"], 0, m)

    def test_nobody_is_shot_down_in_a_turnaround(self) -> None:
        for demo in (*IMMELMANNS, *SPLITS):
            for r in self.shape["demos"][demo]["runs"]:
                key = "immelmann" if demo in IMMELMANNS else "split"
                self.assertIsNone(r[key]["winner"], (demo, r["dx"], r["dv"]))


if __name__ == "__main__":
    unittest.main()
