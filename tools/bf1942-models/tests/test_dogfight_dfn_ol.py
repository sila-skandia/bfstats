"""Out of his lock: the Dip, the Flip and the Ninja (features/dogfight-school,
reviews/dfn-ol.md). Each demo flown from the nine nearby starts and scored by
`dogfight_dfn_measure.mjs`; the verdict the lesson shows must be the one the
nine runs give, and the lesson's survival verdict must follow from the three.
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
SHAPE = HERE / "dogfight_dfn_ol.mjs"


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
        shutil.copyfile(HERE / "dogfight_dfn_measure.mjs", work / "dogfight_dfn_measure.mjs")
        (work / "shape.mjs").write_text(head + "\n" + SHAPE.read_text())
        proc = subprocess.run(["node", str(work / "shape.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"dfn harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def category(works: int) -> str:
    return "works" if works >= 7 else "partly" if works >= 3 else "no"


class OutOfTheLockDipFlipNinja(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def demo(self, kind: str) -> dict:
        return self.shape["demos"][kind]

    def test_each_verdict_is_what_the_nine_runs_give(self) -> None:
        for kind in ("dip", "flip", "ninja"):
            d = self.demo(kind)
            self.assertEqual(9, d["measured"]["of"], kind)
            self.assertEqual(d["claimed"]["of"], d["measured"]["of"], kind)
            self.assertEqual(d["claimed"]["works"], d["measured"]["works"], (kind, d["scores"]))
            self.assertEqual(category(d["claimed"]["works"]), d["measured"]["verdict"], kind)

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [category(self.demo(k)["claimed"]["works"]) for k in ("dip", "flip", "ninja")]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.shape["survival"]["verdict"])

    def test_the_moves_are_flown_against_the_honest_hunter(self) -> None:
        # The plain hunter runs on after flying past whatever you do; these
        # three are flown against `olHunter`, who turns back.
        for kind in ("dip", "flip", "ninja"):
            self.assertEqual("olHunter", self.demo(kind)["ace"], kind)

    def test_the_dip_gets_away_only_when_he_gives_up_the_chase(self) -> None:
        # "Out in 5 of 9: there he followed more than 300 m back, not
        # closing, gave the chase up at 46 to 54 s, and you were 1000 to
        # 2100 m clear; in the other 4 he stayed 230 to 275 m behind you,
        # inside his reach, and in one he closed and landed 6 hits."
        scores = self.demo("dip")["scores"]
        for s in scores:
            self.assertIn("dip-run", s["phases"], s)
            self.assertGreaterEqual(s["minRange"], 15, s)
            if s["ok"]:
                self.assertIsNotNone(s["gaveUpAt"], s)
                self.assertTrue(45 <= s["gaveUpAt"] <= 55, s)
                self.assertGreaterEqual(s["endRange"], 1000, s)
            else:
                self.assertIsNone(s["gaveUpAt"], s)
                self.assertTrue(225 <= s["endRange"] <= 280, s)
        self.assertLessEqual(sum(1 for s in scores if s["hitsOnMe"] > 0), 1)

    def test_the_flip_makes_him_fly_past_but_never_gives_you_the_burst(self) -> None:
        # "He flew past 14 to 18 m under you in all nine and never hit you,
        # and you landed 21 hits in all, but your guns had him for half a
        # second at most".
        scores = self.demo("flip")["scores"]
        for s in scores:
            self.assertIn("flip-chase", s["phases"], s)
            self.assertTrue(14 <= s["minRange"] <= 18, s)
            self.assertEqual(0, s["hits"][0], s)
            self.assertLessEqual(s["myShot"], 0.5, s)
        self.assertEqual(21, sum(s["hits"][1] for s in scores))

    def test_the_ninja_denies_him_every_shot_and_takes_none(self) -> None:
        # "He had no shot at all in nine fights and nobody was hit, but you
        # never got your guns on him or sat behind him for even half a
        # second."
        for s in self.demo("ninja")["scores"]:
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual([0, 0], s["hits"], s)
            self.assertEqual(0, s["myShot"], s)
            self.assertLess(s["bestQuarter"], 0.5, s)
            self.assertGreaterEqual(s["minRange"], 15, s)


if __name__ == "__main__":
    unittest.main()
