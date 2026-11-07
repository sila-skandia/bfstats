"""Out of his lock: the Dip, the Flip and the Ninja (features/dogfight-school,
reviews/dfn-ol.md). Each demo flown from the nine starts (`STARTS`) and scored by
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
        # three are flown against `olAce`: `olHunter`, who turns back, and
        # who does not pull up after you into a hang (the review).
        for kind in ("dip", "flip", "ninja"):
            self.assertEqual("olAce", self.demo(kind)["ace"], kind)

    def test_the_dip_goes_under_him_and_he_gives_up_the_chase(self) -> None:
        # "Out in all nine and never hit. In 5 of 9 he had his guns on you as
        # you met head-on, 270 to 350 m out, and in 6 of 9 180 to 260 m behind
        # you at 18 to 22 s, but he holds his fire to 150 m and never fired;
        # he gave the chase up at 28 to 31 s, and at 40 s you were 1140 to
        # 1410 m clear and opening." The pass: within about 25 m.
        scores = self.demo("dip")["scores"]
        for s in scores:
            self.assertEqual(["turn", "meet", "dip-run"], s["phases"], s)
            self.assertTrue(s["ok"], s)
            self.assertFalse(s["hisFired"], s)
            self.assertEqual([0, 0], s["hits"], s)
            self.assertTrue(24 <= s["minRange"] <= 26, s)
            self.assertTrue(28 <= s["gaveUpAt"] <= 31, s)
            self.assertTrue(1140 <= s["endRange"] <= 1410, s)
            self.assertGreater(s["opening"], 0, s)
            self.assertTrue(180 <= s["hisShotRange"][0] and s["hisShotRange"][1] <= 350, s)
        self.assertEqual(5, sum(1 for s in scores if s["hisShotFrom"] < 9))
        self.assertEqual(6, sum(1 for s in scores if s["hisShotTo"] > 15))

    def test_the_flip_lands_a_pass_across_his_beam_but_does_not_make_you_the_hunter(self) -> None:
        # "After the move he never had a shot and never hit you; the pass
        # landed 10 to 22 hits and shot him down in 3 of 9. ... only once, as
        # he went down, were you on his tail ... for the 2 s". Slow over the
        # top: under 35 m/s near him for 2.2 to 2.7 s. He is at 35 to 44 m/s
        # when the burst lands, not hanging.
        scores = self.demo("flip")["scores"]
        for s in scores:
            self.assertEqual(["turn", "meet", "flip-up"], s["phases"][:3], s)
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertTrue(10 <= s["hits"][1] <= 22, s)
            self.assertGreaterEqual(s["minRange"], 15, s)
            self.assertTrue(2 <= s["hang"] <= 2.8, s)
            self.assertTrue(35 <= s["burstHisSpeed"] <= 44, s)
            self.assertEqual(s["ok"], s["killed"] and s["bestQuarter"] >= 2, s)
        self.assertEqual(3, sum(1 for s in scores if s["killed"]))

    def test_the_ninja_gets_one_pass_and_his_nose_follows_you_up(self) -> None:
        # "One pass in all nine, 10 to 22 hits, down in 3 ... as you met
        # head-on he had his guns on you for 0.3 to 0.6 s at 270 to 350 m,
        # where he holds his fire; and in the 6 he lived he followed you up:
        # at 30 s he was 290 to 330 m behind and 40 to 60 m under you, on your
        # tail for 5 to 6 s of the climb." The theatre's start is one he lives.
        self.assertGreaterEqual(self.demo("ninja")["seconds"], 30)
        scores = self.demo("ninja")["scores"]
        self.assertFalse(scores[0]["killed"], scores[0])
        for s in scores:
            self.assertEqual(1, s["attacks"], s)
            self.assertTrue(10 <= s["hits"][1] <= 22, s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertFalse(s["hisFired"], s)
            self.assertTrue(0.3 <= s["hisShot"] <= 0.65, s)
            if not s["killed"]:
                self.assertIn("ninja-perch", s["phases"], s)
                self.assertTrue(290 <= s["endRange"] <= 335, s)
                self.assertTrue(40 <= s["endHigh"] <= 62, s)
                self.assertTrue(4.9 <= s["sixLost"] <= 6.3, s)
        self.assertEqual(3, sum(1 for s in scores if s["killed"]))


if __name__ == "__main__":
    unittest.main()
