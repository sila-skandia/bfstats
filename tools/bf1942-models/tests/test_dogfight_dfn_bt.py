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

    def test_the_dip_and_the_ninja_break_before_he_is_in_reach(self) -> None:
        # "Turn into him at once, 500 m out, before he is in reach."
        for demo_id in ("dip", "ninja"):
            for s in self.demo(demo_id)["scores"]:
                self.assertGreaterEqual(s["breakRange"], 460, s)
                self.assertEqual(0, s["hisShotBeforeBreak"], s)

    def test_the_flip_breaks_into_the_circle_at_360_m_unless_he_was_out_of_sight(self) -> None:
        # Under the pilots' eyes (reviews/eyes.md) one start loses him
        # behind the headrest as he comes in and breaks late, at 278 m.
        scores = self.demo("flip")["scores"]
        early = [s for s in scores if s["breakRange"] >= 339]
        self.assertEqual(8, len(early))
        for s in early:
            self.assertLessEqual(s["breakRange"], 360, s)
        for s in scores:
            self.assertGreaterEqual(s["breakRange"], 270, s)
            self.assertEqual(0, s["hisShotBeforeBreak"], s)

    def test_the_dip_is_never_hit_and_he_gives_up(self) -> None:
        # "In all nine his guns never have you and none of his rounds lands:
        # he follows you up, slows, chases your run without closing and
        # gives it up 27 to 28 s in (41 s in one, where you wait longer over
        # the top); at 50 s you are 1.4 to 2.9 km apart and opening."
        scores = self.demo("dip")["scores"]
        for s in scores:
            self.assertTrue(s["ok"], s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertEqual(0, s["hisShot"], s)
            self.assertGreaterEqual(s["endRange"], 1400, s)
            self.assertLessEqual(s["endRange"], 2950, s)
            # No hanging at the top of the zoom.
            self.assertEqual(0, s["hang"], s)
        lets = sorted(s["letGoT"] for s in scores)
        self.assertGreaterEqual(lets[0], 26.5)
        self.assertLessEqual(lets[-2], 28.5)
        self.assertEqual(41, round(lets[-1]))

    def test_the_flip_shoots_at_him_but_never_from_behind_in_time(self) -> None:
        # "you put rounds on him in 6 of 9 (up to 20), but the dives meet him
        # from the side or the front: 2 s in his rear quarter only twice, 20
        # and 27 s after the zoom. In five a dive passes him inside 15 m, in
        # three he hits you (1 to 3 rounds), and in one he never sits close
        # enough behind you to zoom from."
        scores = self.demo("flip")["scores"]
        flown = [s for s in scores if s["t0"] is not None]
        self.assertEqual(8, len(flown))
        self.assertEqual(6, sum(1 for s in flown if s["hitsOnHim"]))
        self.assertEqual(20, max(s["hitsOnHim"] for s in flown))
        self.assertEqual([20, 27], sorted(int(s["flipAt"] - s["t0"]) for s in flown if s["flipAt"] is not None))
        self.assertEqual(5, sum(1 for s in flown if s["minRange"] <= 15))
        self.assertEqual([1, 1, 3], sorted(s["hitsAll"] for s in scores if s["hitsAll"]))

    def test_the_ninja_never_gives_him_a_chance_and_never_gets_the_dive(self) -> None:
        # "in all 9 his guns never have you and he never sits on your six,
        # but over the top his nose never leaves you, so the dive never
        # comes and you never fire. You leave, and he gives the chase up 27
        # to 28 s in (41 s in one): 1.4 to 2.9 km apart at 50 s."
        scores = self.demo("ninja")["scores"]
        self.assertEqual(41, round(max(s["letGoT"] for s in scores)))
        for s in scores:
            # Flown long enough that what follows is seen, not assumed.
            self.assertGreaterEqual(s["flown"], 45, s)
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertLess(s["sixLost"], 1, s)
            self.assertEqual(0, s["attacks"], s)
            self.assertEqual(0, s["myShot"], s)
            self.assertGreaterEqual(s["letGoT"], 26.5, s)
            self.assertGreaterEqual(s["endRange"], 1400, s)
            self.assertLessEqual(s["endRange"], 2950, s)


if __name__ == "__main__":
    unittest.main()
