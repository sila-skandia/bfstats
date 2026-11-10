"""The move cards' steps hold to the flown demos (features/dogfight-school,
"Move cards").

Each Dip, Flip and Ninja demo carries a few short steps, each anchored to a
phase of the seat's plan (`viewer/dogfight-steps.js`). The theatre pins a
step where the flown fight enters that phase, so a step whose phase never
comes, or comes after the part shown, would draw a card that lies.
`dogfight_steps.mjs` runs after the head of `dogfight_school_harness.mjs`.
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

HERE = Path(__file__).resolve().parent
SHAPE = HERE / "dogfight_steps.mjs"


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
        body = SHAPE.read_text()
        imports = [line for line in body.splitlines() if line.startswith("import ")]
        rest = "\n".join(line for line in body.splitlines() if not line.startswith("import "))
        (work / "shape.mjs").write_text("\n".join(imports) + "\n" + head + "\n" + rest)
        proc = subprocess.run(["node", str(work / "shape.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"steps harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class MoveStepsTests(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def test_every_move_demo_has_steps_and_no_steps_are_orphaned(self) -> None:
        missing = [k for k, v in self.shape["demos"].items() if v is None]
        self.assertEqual([], missing, "a move demo with no steps in dogfight-steps.js")
        self.assertEqual([], self.shape["orphans"], "steps for a demo the lessons no longer have")
        self.assertEqual(30, len(self.shape["demos"]))

    def test_every_step_happens_in_order_inside_the_part_shown(self) -> None:
        for key, d in self.shape["demos"].items():
            times = [s["t"] for s in d["steps"]]
            with self.subTest(key):
                self.assertTrue(2 <= len(times) <= 5, f"{len(times)} steps")
                self.assertNotIn(None, times, f"a step's phase never comes: {d['steps']}")
                self.assertEqual(sorted(times), times)
                self.assertGreaterEqual(times[0], d["from"])
                self.assertLessEqual(times[-1], d["to"])

    def test_a_move_that_does_not_always_work_says_why(self) -> None:
        for key, d in self.shape["demos"].items():
            if d["works"] is not None and d["works"] < 7:
                with self.subTest(key):
                    self.assertTrue(d["why"], "a move that works under 7 of 9 needs its `why`")

    def test_steps_are_short_and_say_they(self) -> None:
        # The card is read in a glance; players are they, never he
        # (the owner's rule for user-facing copy).
        for key, d in self.shape["demos"].items():
            for s in d["steps"]:
                with self.subTest(key=key, say=s["say"]):
                    self.assertLessEqual(len(s["say"]), 90)
                    self.assertNotRegex(f" {s['say']} ", r"(?i)\b(he|him|his)\b")

    def test_every_lesson_with_moves_names_a_best_answer(self) -> None:
        # Every lesson is survivable by one move at least (README, "What
        # the eight lessons show"), and the tabs mark it.
        for lesson, best in self.shape["best"].items():
            # Lessons with no Dip, Flip or Ninja: the ace, the gunnery
            # drill's target and the falling leaf (features/dogfight-doctrine).
            if lesson in ("free", "gunnery", "falling-leaf"):
                continue
            with self.subTest(lesson):
                self.assertIsNotNone(best)
        self.assertEqual("dip", self.shape["best"]["boom-and-zoom"])

    def test_step_times_resolve_in_order_and_stop_at_a_missing_phase(self) -> None:
        u = self.shape["unit"]
        self.assertEqual([0, 2, 3], u["plain"])
        self.assertEqual([3, 5], u["from"])
        self.assertEqual([4, None, None], u["lost"])


if __name__ == "__main__":
    unittest.main()
