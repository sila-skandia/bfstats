"""FLY IT practises the Dip, the Flip or the Ninja on the theatre's tab
(features/dogfight-school, "Fly a move yourself"): the move's own staging,
the ace it was measured against, its plan as the guide and the instructor,
and the coach naming it. Any other tab flies the lesson against its ace with
the school's give-up rule.

`dogfight_fly_moves.mjs` runs after the head of `dogfight_school_harness.mjs`.
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

SCRIPT = Path(__file__).resolve().parent / "dogfight_fly_moves.mjs"
GIVES_UP = {"boom-and-zoom": "bzAce", "under-the-height": "uhAce", "up-and-over": "uoAce",
            "out-of-the-lock": "olAce", "scissors": "scAce", "turnarounds": "taAce", "the-circle": "btHunter"}
# Lessons whose tries are named for what they try (`zoom`, `chop`), several of a kind.
MANY_TRIES = {"the-circle"}


def run() -> dict:
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
        (work / "fly.mjs").write_text(head + "\n" + SCRIPT.read_text())
        proc = subprocess.run(["node", str(work / "fly.mjs")], capture_output=True, text=True,
                              timeout=120, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"fly-moves harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class FlyMovesTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()

    def test_a_move_is_practised_as_it_was_measured(self) -> None:
        for lesson, row in self.out["lessons"].items():
            # Every lesson has its Dip, Flip and Ninja; Breaking the circle
            # has several tries of a kind, each a demo of its own.
            self.assertLessEqual({"dip", "flip", "ninja"} - ({"flip", "ninja"} if lesson in MANY_TRIES else set()),
                                 set(row["moves"]), lesson)
            for demo, m in row["moves"].items():
                # Practising a demo flies that demo's kind of move.
                self.assertEqual(m["kind"], m["move"], (lesson, m))
                if lesson not in MANY_TRIES:
                    self.assertEqual(demo, m["move"], (lesson, m))
                # The guide and the instructor fly the move's own plan...
                self.assertEqual(m["seat"], m["guide"], (lesson, m))
                # ...against the ace it was measured against, from its staging.
                self.assertEqual(m["measuredAce"], m["ace"], (lesson, m))
                self.assertTrue(m["sameStarts"], (lesson, m))
                self.assertTrue(m["sameMemory"], (lesson, m))

    def test_any_other_tab_flies_the_lesson_against_the_ace_that_gives_up(self) -> None:
        for lesson, row in self.out["lessons"].items():
            self.assertIsNone(row["otherTab"], lesson)
            self.assertTrue(row["default"]["known"], (lesson, row["default"]))
            if lesson in GIVES_UP:
                self.assertEqual(GIVES_UP[lesson], row["default"]["ace"], lesson)

    def test_the_coach_names_the_move_and_only_the_ground_comes_first(self) -> None:
        c = self.out["coach"]
        self.assertEqual("THE DIP", c["high"]["line"])
        self.assertIn("running for it", c["high"]["tip"])
        self.assertEqual("GROUND", c["low"])
        # Not practising a move: his tail line as before.
        self.assertNotEqual("THE DIP", c["none"])


if __name__ == "__main__":
    unittest.main()
