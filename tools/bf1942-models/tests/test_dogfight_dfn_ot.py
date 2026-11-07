"""On his tail's Dip, Flip and Ninja (features/dogfight-school,
reviews/dfn-ot.md): each demo flown from the nine nearby starts the school's
tests use and scored with the shared measure (`dogfight_dfn_measure.mjs`).
The runs are deterministic, so the measured works/9 must equal the demo's
own `verdict.works`, and the lesson's survival verdict must follow from the
three. The pilot in trouble is the attacker, stuck in the circle of a
defender who breaks and never stops turning.
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
SHAPE = HERE / "dogfight_dfn_ot.mjs"
GUNS = 268  # the Spitfire's guns' reach (README, "What the airframe does")


def category(works: int) -> str:
    return "works" if works >= 7 else "partly" if works >= 3 else "no"


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
        shutil.copyfile(HERE / "dogfight_dfn_measure.mjs", work / "dogfight_dfn_measure.mjs")
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "shape.mjs").write_text(head + "\n" + SHAPE.read_text())
        proc = subprocess.run(["node", str(work / "shape.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"dfn harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class OnHisTailDfnTests(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def scores(self, demo_id: str) -> list[dict]:
        rows = self.shape["demos"][demo_id]["scores"]
        self.assertEqual(9, len(rows), demo_id)
        return rows

    def test_each_demo_scores_what_its_verdict_says(self) -> None:
        self.assertEqual("otBreaker", self.shape["ace"])
        for demo_id, demo in self.shape["demos"].items():
            self.assertEqual(demo_id, demo["kind"])
            self.assertEqual("otBreaker", demo["ace"], demo_id)
            measured = demo["measured"]
            self.assertEqual(9, measured["of"], demo_id)
            self.assertEqual(demo["declared"]["works"], measured["works"], (demo_id, demo["scores"]))
            self.assertEqual(9, demo["declared"]["of"], demo_id)
            self.assertEqual(category(demo["declared"]["works"]), measured["verdict"], demo_id)

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [d["measured"]["verdict"] for d in self.shape["demos"].values()]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.shape["survival"]["verdict"])

    def test_the_dip_leaves_his_circle_and_he_chases_out_of_reach_then_lets_go(self) -> None:
        # "he got in behind you 276 to 329 m back, outside his guns, never
        # closed, and gave up 21 to 23 s in, turning away; at 40 s you were
        # 2150 to 2449 m apart and never hit" (the school's one give-up rule).
        for s in self.scores("dip"):
            # A turn and more in his circle first (he breaks about 3 s in).
            self.assertGreater(s["t0"] - s["breakAt"], 8, s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertEqual(0, s["hisShot"], s)
            # He does turn after you: a real chase, not a pilot who keeps circling.
            self.assertIsNotNone(s["chaseAt"], s)
            self.assertGreater(s["chaseMin"], GUNS, s)
            self.assertTrue(20.5 <= s["letGoAt"] <= 23, s)
            self.assertTrue(2150 <= s["endRange"] <= 2449, s)
            self.assertGreater(s["endSpeed"], 60, s)

    def test_the_yo_yo_dives_on_him_and_never_gets_the_shot(self) -> None:
        for s in self.scores("flip"):
            self.assertGreaterEqual(s["dives"], 1, s)
            self.assertEqual(0, s["myShot"], s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertLessEqual(s["hisShot"], 0.1, s)

    def test_out_wide_neither_of_you_has_the_other(self) -> None:
        for s in self.scores("ninja"):
            self.assertLessEqual(s["hisShot"], 0.1, s)
            self.assertLessEqual(s["myShot"], 0.15, s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertEqual(0, s["bestQuarter"], s)
            self.assertGreater(s["minRange"], 50, s)


if __name__ == "__main__":
    unittest.main()
