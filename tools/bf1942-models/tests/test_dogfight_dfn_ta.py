"""The Immelmann and the split-S's Dip, Flip and Ninja (features/dogfight-school,
reviews/dfn-ta.md): each demo flown from the nine nearby starts the school's
tests use and scored with the shared measure (`dogfight_dfn_measure.mjs`).
The runs are deterministic, so the measured works/9 must equal the demo's
own `verdict.works`, and the lesson's survival verdict must follow from the
three.
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
SHAPE = HERE / "dogfight_dfn_ta.mjs"


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


class TurnaroundsDfnTests(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def test_each_demo_scores_what_its_verdict_says(self) -> None:
        for demo_id, demo in self.shape["demos"].items():
            self.assertEqual(demo_id, demo["kind"])
            self.assertEqual("taAce", demo["ace"], demo_id)
            measured = demo["measured"]
            self.assertEqual(9, measured["of"], demo_id)
            self.assertEqual(demo["declared"]["works"], measured["works"], (demo_id, demo["scores"]))
            self.assertEqual(9, demo["declared"]["of"], demo_id)
            self.assertEqual(category(demo["declared"]["works"]), measured["verdict"], demo_id)

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [d["measured"]["verdict"] for d in self.shape["demos"].values()]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.shape["survival"]["verdict"])

    def test_the_dip_turns_back_under_his_immelmann_and_he_cannot_catch_you(self) -> None:
        for s in self.shape["demos"]["dip"]["scores"]:
            # He Immelmanns after the pass, and the Dip starts then too.
            self.assertIsNotNone(s["immelmannAt"], s)
            self.assertLess(abs(s["t0"] - s["immelmannAt"]), 1.0, s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertEqual(0, s["hisShot"], s)
            # He does chase, from inside 300 m, and lets go (the school's
            # rule) only past his reach + 30 m, 6 s in and not closing: here
            # 570-600 m out.
            self.assertIsNotNone(s["chaseAt"], s)
            self.assertLess(s["chaseRange"], 300, s)
            self.assertIsNotNone(s["homeAt"], s)
            self.assertGreaterEqual(s["homeAt"] - s["chaseAt"], 6, s)
            self.assertGreater(s["homeRange"], 500, s)
            self.assertGreater(s["endRange"], 1500, s)

    def test_the_flip_puts_you_on_his_tail_but_the_shot_is_a_snap(self) -> None:
        for s in self.shape["demos"]["flip"]["scores"]:
            self.assertIsNotNone(s["splitAt"], s)
            self.assertIsNotNone(s["flipAt"], s)
            self.assertGreaterEqual(s["bestQuarter"], 3.5, s)
            self.assertEqual(0, s["hisShot"], s)
            self.assertLess(s["myShot"], 0.8, s)
            # He defends: he breaks once he is out of his half loop.
            self.assertTrue(s["evaded"], s)

    def test_the_ninja_dives_on_his_split_s_and_he_never_points_at_you(self) -> None:
        for s in self.shape["demos"]["ninja"]["scores"]:
            self.assertIsNotNone(s["splitAt"], s)
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertGreaterEqual(s["bestQuarter"], 3.5, s)
            self.assertGreater(s["minRange"], 40, s)
            self.assertLess(s["myShot"], 0.5, s)
            self.assertTrue(s["evaded"], s)


if __name__ == "__main__":
    unittest.main()
