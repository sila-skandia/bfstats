"""Can you survive boom and zoom? (features/dogfight-school/reviews/dfn-bz.md)

The pilot in trouble sits 400 m under a boom-and-zoomer, slower and with no
height to spend. The three moves fly against `bzAceMeet`, the lesson's ace
who also meets a dive he sees coming once his own height is gone. The lesson's three move demos (the Dip, the Flip, the
Ninja) are flown from the nine L9 starts (`STARTS`) and scored by the shared
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

    def test_every_move_flies_against_the_ace_who_meets_him(self) -> None:
        for demo_id in ("dip", "flip", "ninja"):
            self.assertEqual("bzAceMeet", self.demo(demo_id)["ace"], demo_id)

    def test_the_dip_runs_until_he_gives_up_the_chase(self) -> None:
        # "from 15 s on never gets within 700 m or hits you; in four he gives
        # up a chase he cannot win at about 80 s and climbs away, and at 90 s
        # you are 1.1 to 1.9 km apart and opening".
        scores = self.demo("dip")["scores"]
        for s in scores:
            self.assertIsNotNone(s["t0"], s)
            self.assertLess(s["t0"], 10, s)  # the run starts out of the first pass
            self.assertEqual(0, s["hitsAll"], s)
            self.assertFalse(s["grounded"], s)
            # re-pinned 2026-11-12 on retail g and box area
            # (features/retail-parity-cross-check-2026-11-12): the closest
            # from 15 s on went from 732 to 731 m; the words now say 700 m,
            # a claim with 31 m of margin rather than one metre.
            self.assertGreaterEqual(s["runMin15"], 700, s)
            self.assertGreaterEqual(s["endRange"], 1050, s)
            self.assertLessEqual(s["endRange"], 1950, s)
            self.assertGreater(s["opening"], 0, s)
        let_go = [s["letGo"] for s in scores if s["letGo"] is not None]
        self.assertEqual(4, len(let_go), scores)
        self.assertGreaterEqual(min(let_go), 79)
        self.assertLessEqual(max(let_go), 82)

    def test_the_flip_and_the_ninja_open_with_his_height_spent(self) -> None:
        for demo_id in ("flip", "ninja"):
            d = self.demo(demo_id)
            self.assertLessEqual(d["seconds"], 30, demo_id)  # ends when it is decided
            for s in d["scores"]:
                self.assertEqual(0, s["hisShotAll"], s)
                self.assertEqual(0, s["hitsAll"], s)
                self.assertEqual(0, s["myShotAll"], s)
                self.assertLess(s["sixLost"], 1, s)
                self.assertEqual(0, s["hang"], s)

    def test_the_flip_turns_in_behind_him_but_never_gets_the_nose_on(self) -> None:
        # "9 to 10 s in, his nose away, you turn in after him, but at even
        # energy your nose
        # never comes onto him: not a moment in his rear quarter, no landing
        # shot. You leave 3 s later and at 22 s you are 0.8 to 1 km apart".
        for s in self.demo("flip")["scores"]:
            self.assertIsNotNone(s["t0"], s)
            self.assertGreaterEqual(s["t0"], 8.5, s)
            self.assertLessEqual(s["t0"], 10.5, s)
            self.assertEqual(0, s["bestQuarter"], s)
            self.assertGreaterEqual(s["endRange"], 770, s)
            self.assertLessEqual(s["endRange"], 1000, s)

    def test_the_ninja_makes_one_pass_from_above_then_runs(self) -> None:
        # "you get over him and dive at 7 to 9 s, but he turns to face
        # you (in six he is still turning into the dive as it ends) and no
        # shot ever bears;
        # you run, and at 25 s you are 0.9 to 1.2 km apart".
        d = self.demo("ninja")
        scores = d["scores"]
        for s in scores:
            self.assertIsNotNone(s["dived"], s)
            self.assertGreaterEqual(s["dived"], 6.9, s)
            self.assertLessEqual(s["dived"], 9.2, s)
            self.assertEqual(0, s["hisShot"], s)
            self.assertGreaterEqual(s["endRange"], 900, s)
            self.assertLessEqual(s["endRange"], 1200, s)
            self.assertGreater(s["opening"], 0, s)
        self.assertEqual(6, sum(s["metDive"] for s in scores), scores)

if __name__ == "__main__":
    unittest.main()
