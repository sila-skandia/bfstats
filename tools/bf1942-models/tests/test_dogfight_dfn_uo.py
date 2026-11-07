"""Can you survive the up and over? (features/dogfight-school/reviews/dfn-uo.md)

You are chasing him; he pulls nearly straight up out of your chase, and the
pilot in trouble is you, the follower, once he goes vertical. The lesson's
three move demos (the Dip, the Flip, the Ninja) are flown from the nine
nearby starts against the ace who also dives after a runner (`uoAce`) and
scored by the shared measure (`dogfight_dfn_measure.mjs`); each demo's
declared verdict must be what was flown, and the lesson's survival verdict
must follow from the three. The words' own numbers are held too.

`dogfight_dfn_uo.mjs` runs after the head of `dogfight_school_harness.mjs`.
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
SHAPE = HERE / "dogfight_dfn_uo.mjs"
LEFT = -30  # the three starts 30 m to the left, out of his line


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


class UpAndOverSurvivalTests(unittest.TestCase):
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

    def test_every_move_starts_when_he_goes_up_against_an_ace_who_flies_it(self) -> None:
        for demo_id in ("dip", "flip", "ninja"):
            for s in self.demo(demo_id)["scores"]:
                self.assertIsNotNone(s["pullAt"], (demo_id, s))
                self.assertTrue({"pull", "over"} <= set(s["acePhases"]), (demo_id, s))
                self.assertFalse(s["grounded"], (demo_id, s))
        for demo_id in ("dip", "flip"):
            for s in self.demo(demo_id)["scores"]:
                # The move is the answer to his pull: within 1.5 s of it.
                self.assertGreaterEqual(s["t0"], s["pullAt"], s)
                self.assertLess(s["t0"], s["pullAt"] + 1.5, s)

    def test_the_dip_is_never_hit_and_gets_clear(self) -> None:
        # "Never hit in all nine: he dives after you but cannot close, and
        # ... he gives the chase up; at 35 s you are 1566 to 1765 m apart
        # and opening."
        scores = self.demo("dip")["scores"]
        for s in scores:
            self.assertEqual(0, s["hitsAll"], s)
            self.assertIn("dip-run", s["myPhases"], s)
            self.assertTrue({"chase", "let-go"} <= set(s["acePhases"]), s)
            self.assertGreaterEqual(s["endRange"], 1550, s)
            self.assertLessEqual(s["endRange"], 1800, s)
            self.assertGreater(s["opening"], 0, s)

    def test_the_flip_gets_the_shot_as_he_hangs_except_from_the_left(self) -> None:
        # "In six starts ... the shot as he hangs for 1.0 to 1.3 s, landing 7
        # to 19; from the three starts 30 m to the left ... no shot. His guns
        # land on you for 0.13 s at most, never a hit."
        for s in self.demo("flip")["scores"]:
            self.assertLessEqual(s["hisShot"], 0.13, s)
            self.assertEqual(0, s["hitsAll"], s)
            if s["dx"] == LEFT:
                self.assertFalse(s["ok"], s)
                self.assertEqual(0, s["myShot"], s)
            else:
                self.assertTrue(s["ok"], s)
                self.assertGreaterEqual(s["myShot"], 1.0, s)
                self.assertLessEqual(s["myShot"], 1.4, s)
                self.assertGreaterEqual(s["myHits"], 7, s)
                self.assertLessEqual(s["myHits"], 19, s)

    def test_the_ninja_never_gives_him_a_hit(self) -> None:
        # "his guns are on you for 0.13 s at most and never hit you in 40 s;
        # you land 7 to 19 in six of them and 0 to 2 in the three starts 30 m
        # to the left, and the closest he comes is 17 m."
        for s in self.demo("ninja")["scores"]:
            self.assertLessEqual(s["hisShot"], 0.13, s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertGreaterEqual(s["minRange"], 17, s)
            if s["dx"] == LEFT:
                self.assertLessEqual(s["myHits"], 2, s)
            else:
                self.assertGreaterEqual(s["myHits"], 7, s)
                self.assertLessEqual(s["myHits"], 19, s)


if __name__ == "__main__":
    unittest.main()
