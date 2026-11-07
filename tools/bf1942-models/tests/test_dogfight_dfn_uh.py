"""Can you survive a pilot with the height on you? (features/dogfight-school/reviews/dfn-uh.md)

The pilot in trouble sits 520 m under a boom-and-zoomer (`uhAce`: the
lesson's ace, who also chases a runner and turns to face a dive on him).
The lesson's three move demos (the Dip, the Flip, the Ninja) are flown from
the nine nearby starts and scored by the shared measure
(`dogfight_dfn_measure.mjs`); each demo's declared verdict must be what was
flown, and the lesson's survival verdict must follow from the three. The
words' own numbers are held too.

`dogfight_dfn_uh.mjs` runs after the head of `dogfight_school_harness.mjs`.
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
SHAPE = HERE / "dogfight_dfn_uh.mjs"


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
        # The measure's import has to sit with the head's imports.
        body = SHAPE.read_text()
        imports = [line for line in body.splitlines() if line.startswith("import ")]
        rest = "\n".join(line for line in body.splitlines() if not line.startswith("import "))
        (work / "shape.mjs").write_text("\n".join(imports) + "\n" + head + "\n" + rest)
        proc = subprocess.run(["node", str(work / "shape.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"shape harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class UnderTheHeightSurvivalTests(unittest.TestCase):
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

    def test_the_dip_runs_only_once_his_height_is_spent_and_gets_clear(self) -> None:
        # "you break three dives, are never hit, start the run 53 to 57 s in
        # from 470 to 530 m away ... 10 to 11 s into the run he lets you go
        # and climbs away, and at 80 s you are 1.9 to 2.7 km apart and
        # opening".
        for s in self.demo("dip")["scores"]:
            self.assertEqual(3, s["breaks"], s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertLessEqual(s["hisShotAll"], 0.2, s)
            self.assertTrue(53 <= s["t0"] <= 58, s)
            self.assertTrue(460 <= s["startRange"] <= 540, s)
            self.assertIsNotNone(s["letGo"], s)
            self.assertTrue(10 <= s["letGo"] - s["t0"] <= 11.5, s)
            self.assertTrue(1900 <= s["endRange"] <= 2750, s)
            self.assertGreater(s["opening"], 0, s)

    def test_the_flip_onto_his_zoom_leaves_you_hanging_under_him(self) -> None:
        # "he goes past at 71 to 74 m/s to your 42 ... within 8 s you hang at
        # 14 to 15 m/s under him with no shot, hit twice in one of the nine".
        scores = self.demo("flip")["scores"]
        for s in scores:
            self.assertTrue(105 <= s["startRange"] <= 125, s)
            self.assertTrue(70 <= s["startSpeeds"][0] <= 75, s)
            self.assertTrue(40 <= s["startSpeeds"][1] <= 44, s)
            self.assertLessEqual(s["slowest"], 16, s)
            self.assertEqual(0, s["myShot"], s)
            self.assertEqual(0, s["bestQuarter"], s)
        self.assertEqual([2], [s["hitsAll"] for s in scores if s["hitsAll"]])

    def test_the_ninja_never_gives_him_a_shot_and_gets_in_behind_him_in_six(self) -> None:
        # "his guns are never on you and you climb 420 to 570 m; in six you
        # sit in his rear quarter for 6.7 to 9.1 s ... your guns land at most
        # 0.4 s; in three you finish 280 to 310 m above him".
        scores = self.demo("ninja")["scores"]
        for s in scores:
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertTrue(410 <= s["climbed"] <= 575, s)
            self.assertLessEqual(s["myShot"], 0.4, s)
        behind = [s for s in scores if s["ok"]]
        for s in behind:
            self.assertTrue(6.5 <= s["bestQuarter"] <= 9.2, s)
        for s in (s for s in scores if not s["ok"]):
            self.assertTrue(280 <= s["endAbove"] <= 312, s)


if __name__ == "__main__":
    unittest.main()
