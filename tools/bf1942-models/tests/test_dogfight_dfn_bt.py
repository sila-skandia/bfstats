"""Can you get out of the break turn's circle? (features/dogfight-school/reviews/dfn-bt.md)

The pilot in trouble is the one who broke: the break spoiled the attacker's
shot, and now the school's hunter sits behind him in a circle nobody wins.
The lesson's three move demos (the Dip, the Flip, the Ninja), each flown by
that pilot in the other seat against the hunter, are flown from the nine
nearby starts and scored by the shared measure (`dogfight_dfn_measure.mjs`);
each demo's declared verdict must be what was flown, and the lesson's
survival verdict must follow from the three. The words' own numbers are
held too.

`dogfight_dfn_bt.mjs` runs after the head of `dogfight_school_harness.mjs`.
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
SHAPE = HERE / "dogfight_dfn_bt.mjs"


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
        body = SHAPE.read_text()
        imports = [line for line in body.splitlines() if line.startswith("import ")]
        rest = "\n".join(line for line in body.splitlines() if not line.startswith("import "))
        (work / "shape.mjs").write_text("\n".join(imports) + "\n" + head + "\n" + rest)
        proc = subprocess.run(["node", str(work / "shape.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"shape harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BreakTurnSurvivalTests(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def demo(self, demo_id: str) -> dict:
        d = self.shape["demos"][demo_id]
        self.assertIsNotNone(d, demo_id)
        self.assertEqual(9, len(d["scores"]), demo_id)
        return d

    def test_each_move_demo_says_what_was_flown(self) -> None:
        for demo_id in ("dip", "flip", "ninja"):
            d = self.demo(demo_id)
            self.assertEqual(demo_id, d["kind"])
            self.assertEqual(d["declared"]["works"], d["measured"]["works"], (demo_id, d["scores"]))
            self.assertEqual(9, d["declared"]["of"])
            self.assertEqual("no" if d["measured"]["works"] < 3 else
                             "partly" if d["measured"]["works"] < 7 else "works",
                             d["measured"]["verdict"])

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [self.demo(i)["measured"]["verdict"] for i in ("dip", "flip", "ninja")]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.shape["survival"]["verdict"])

    def test_the_early_break_leaves_him_no_shot_before_or_during_it(self) -> None:
        # "Break at 360 m, before his sight is on you."
        for demo_id in ("dip", "flip", "ninja"):
            for s in self.demo(demo_id)["scores"]:
                self.assertGreaterEqual(s["breakRange"], 355, s)
                self.assertEqual(0, s["hisShotBeforeBreak"], s)

    def test_the_dip_is_never_hit_once_you_run_and_he_gives_up(self) -> None:
        # "In 7 of 9 none of his rounds lands once you run, he gives up the
        # chase he cannot win 37 to 52 s in, and at 60 s you are 1.2 to 3 km
        # apart; in the other two he is still 305 and 379 m behind".
        scores = self.demo("dip")["scores"]
        for s in scores:
            self.assertIsNotNone(s["t0"], s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertFalse(s["grounded"], s)
        gone = [s for s in scores if s["ok"]]
        self.assertEqual(7, len(gone))
        for s in gone:
            self.assertGreaterEqual(s["letGoT"], 37, s)
            self.assertLessEqual(s["letGoT"], 52.5, s)
            self.assertGreaterEqual(s["endRange"], 1200, s)
            self.assertLessEqual(s["endRange"], 3010, s)
        for s in scores:
            if not s["ok"]:
                self.assertLess(s["endRange"], 400, s)

    def test_the_flip_gets_behind_him_late_and_seldom_gets_the_shot(self) -> None:
        # "in 7 of 9 you sit in his rear quarter for 3.3 to 9.4 s, but only
        # 17 to 27 s after the zoom ... half a second in 1 of 9; he hit you
        # in one".
        scores = self.demo("flip")["scores"]
        behind = [s for s in scores if s["bestQuarter"] >= 3]
        self.assertEqual(7, len(behind))
        for s in behind:
            self.assertLessEqual(s["bestQuarter"], 9.4, s)
            self.assertGreaterEqual(s["flipAt"] - s["t0"], 17, s)
            self.assertLessEqual(s["flipAt"] - s["t0"], 27.5, s)
        self.assertEqual(1, sum(1 for s in scores if s["myShot"] >= 0.5))
        self.assertEqual(1, sum(1 for s in scores if s["hitsAll"] > 0))

    def test_the_ninja_denies_him_his_guns_and_gets_behind_him_in_five(self) -> None:
        # "In 5 of 9 his guns never have you and you sit in his rear quarter
        # for 3.8 to 9.4 s".
        ok = [s for s in self.demo("ninja")["scores"] if s["ok"]]
        self.assertEqual(5, len(ok))
        for s in ok:
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertGreaterEqual(s["bestQuarter"], 3.8, s)
            self.assertLessEqual(s["bestQuarter"], 9.4, s)
        for s in self.demo("ninja")["scores"]:
            self.assertGreater(s["minRange"], 15, s)


if __name__ == "__main__":
    unittest.main()
