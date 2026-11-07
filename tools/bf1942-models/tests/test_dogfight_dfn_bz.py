"""Can you survive boom and zoom? (features/dogfight-school/reviews/dfn-bz.md)

The pilot in trouble sits 400 m under a boom-and-zoomer, slower and with no
height to spend. The lesson's three move demos (the Dip, the Flip, the
Ninja) are flown from the nine nearby starts and scored by the shared
measure (`dogfight_dfn_measure.mjs`); each demo's declared verdict must be
what was flown, and the lesson's survival verdict must follow from the
three. The words' own numbers are held too.

`dogfight_dfn_bz.mjs` runs after the head of `dogfight_school_harness.mjs`.
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
SHAPE = HERE / "dogfight_dfn_bz.mjs"


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


class BoomAndZoomSurvivalTests(unittest.TestCase):
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

    def test_the_dip_runs_until_he_gives_up_the_chase(self) -> None:
        # "he dives after you for a minute but never gets inside 416 m or
        # hits you, gives up ... at 62 to 76 s ... at 90 s you are 1.9 to
        # 2.9 km apart and opening".
        for s in self.demo("dip")["scores"]:
            self.assertIsNotNone(s["t0"], s)
            self.assertLess(s["t0"], 10, s)  # the run starts out of the first pass
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertFalse(s["grounded"], s)
            self.assertGreaterEqual(s["runMin"], 416, s)
            self.assertIsNotNone(s["letGo"], s)
            self.assertGreaterEqual(s["letGo"], 61, s)
            self.assertLessEqual(s["letGo"], 77, s)
            self.assertGreaterEqual(s["endRange"], 1850, s)
            self.assertLessEqual(s["endRange"], 2900, s)
            self.assertGreater(s["opening"], 0, s)

    def test_the_flip_gets_behind_him_but_never_gets_the_shot(self) -> None:
        # "he overshoots about 40 m off ... not one round lands in nine ...
        # his rear quarter for 1.3 to 2 s ... your nose never gets onto his
        # lead".
        for s in self.demo("flip")["scores"]:
            self.assertIsNotNone(s["t0"], s)
            self.assertLessEqual(s["hisShot"], 0.2, s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertEqual(0, s["myShot"], s)
            # Counted only at 35 m/s or more (the measure's IN_CONTROL).
            self.assertGreaterEqual(s["bestQuarter"], 1.3, s)
            self.assertLessEqual(s["bestQuarter"], 2.3, s)
            self.assertGreaterEqual(s["minRange"], 35, s)
            self.assertLessEqual(s["minRange"], 45, s)

    def test_the_ninja_denies_him_everything_and_gets_nothing(self) -> None:
        # "his guns are never on you and he never hits you, but he never
        # sits in front of your guns either (passes 62 to 161 m apart)".
        for s in self.demo("ninja")["scores"]:
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertEqual(0, s["myShot"], s)
            self.assertGreaterEqual(s["minRange"], 62, s)
            self.assertLessEqual(s["minRange"], 161, s)


if __name__ == "__main__":
    unittest.main()
