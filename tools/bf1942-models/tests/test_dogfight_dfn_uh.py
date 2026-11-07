"""Can you survive a pilot with the height on you? (features/dogfight-school/reviews/dfn-uh.md)

The pilot in trouble sits 520 m under a boom-and-zoomer (`uhAce`: the
lesson's ace, who also chases a runner and turns to face a dive on him).
The lesson's three move demos (the Dip, the Flip, the Ninja) are flown from
the nine starts (the shared L9 array, `STARTS`) and scored by the shared measure
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
        # "you break his dive and his chase (one to three breaks), his guns
        # never fire and he is never on your tail; you start the run 30 to 45
        # s in, he follows but cannot close, 6 to 20 s into the run he lets
        # you go and climbs away, and at 70 s you are 1.5 to 3.2 km apart and
        # opening". The run waits for his nose to be well off you.
        for s in self.demo("dip")["scores"]:
            self.assertIn(s["breaks"], (1, 2, 3), s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertEqual(0, s["hisShotAll"], s)
            self.assertEqual(0, s["sixLost"], s)
            self.assertTrue(29.5 <= s["t0"] <= 45, s)
            self.assertIsNotNone(s["letGo"], s)
            self.assertTrue(6 <= s["letGo"] - s["t0"] <= 20.5, s)
            self.assertTrue(1500 <= s["endRange"] <= 3250, s)
            self.assertGreater(s["opening"], 0, s)

    def test_the_flip_reverses_onto_him_but_the_shot_comes_from_a_later_dive(self) -> None:
        # "In eight of nine you reverse onto him 32 to 45 s in and sit in his
        # rear quarter 6 to 12 s later; his guns never fire and he never gets
        # onto your tail. But only once does the reversal itself bring the
        # shot: mostly the turn back slows you to 27 to 33 m/s and leaves you
        # 300 to 330 m behind him, out of gun range, and the shot comes 8 to
        # 14 s later from a dive from above. That dive lands enough in five
        # (and shoots him down in two, the fight shown among them) and too
        # little in two (0.2 and 0.47 s); in the ninth he never comes after
        # you again after his first dive."
        scores = self.demo("flip")["scores"]
        reversed_ = [s for s in scores if s["t0"] is not None]
        self.assertEqual(8, len(reversed_))
        for s in scores:
            self.assertEqual(0, s["hisShotAll"], s)
            self.assertEqual(0, s["hitsAll"], s)
        for s in reversed_:
            self.assertTrue(31.5 <= s["t0"] <= 45, s)
            self.assertTrue(6 <= s["flipAt"] - s["t0"] <= 12.5, s)
            self.assertEqual(0, s["sixLost"], s)
        in_turn = [s for s in reversed_ if s["firstShotPhase"] == "flip-reverse"]
        self.assertEqual(1, len(in_turn), [s["firstShotPhase"] for s in reversed_])
        later = [s for s in reversed_ if s["firstShotPhase"] != "flip-reverse"]
        for s in later:
            self.assertEqual("dive", s["firstShotPhase"], s)
            self.assertTrue(27 <= s["reverseMinV"] <= 33, s)
            self.assertTrue(295 <= s["reverseEndRange"] <= 330, s)
            self.assertTrue(8 <= s["firstShotT"] - s["reverseEnd"] <= 14, s)
        self.assertEqual(5, sum(1 for s in later if s["ok"]))
        self.assertEqual([0.2, 0.47], sorted(s["myShot"] for s in later if not s["ok"]))
        self.assertTrue(scores[0]["ok"] and scores[0]["killedAt"] is not None, scores[0])
        self.assertEqual(2, sum(1 for s in scores if s["killedAt"] is not None))

    def test_the_ninja_wins_the_height_but_holds_it_only_in_the_fight_shown(self) -> None:
        # "In all nine his guns never fire and he is never on your tail, and
        # you win the height back ... Only in the fight shown does the dive
        # finish him (down at 62.6 s). In four a dive lands a burst, but he
        # is not shot down and the bursts do not keep coming (a second in
        # only one of the four, 20 s or more near him without one in three);
        # in four no dive lands at all. Level with him then, you leave rather
        # than circle with him".
        # The energy is yours "35 to 53 s in".
        d = self.demo("ninja")
        # Long enough that holding it is seen, not assumed.
        self.assertGreaterEqual(d["seconds"], 45)
        scores = d["scores"]
        for s in scores:
            self.assertEqual(0, s["hisShotAll"], s)
            self.assertEqual(0, s["hitsAll"], s)
            self.assertEqual(0, s["sixLost"], s)
            self.assertTrue(34.5 <= s["hand"] <= 53, s)
            # Never long circling after him at his height.
            self.assertLessEqual(s["circling"], 10.5, s)
        shown = scores[0]
        self.assertTrue(shown["ok"], shown)
        self.assertTrue(62 <= shown["killedAt"] <= 63, shown)
        rest = scores[1:]
        self.assertTrue(all(not s["ok"] and s["killedAt"] is None for s in rest), rest)
        landed = [s for s in rest if s["attacks"] >= 1]
        self.assertEqual(4, len(landed))
        self.assertEqual(1, sum(1 for s in landed if s["attacks"] >= 2))
        self.assertEqual(3, sum(1 for s in landed if s["idle"] > 20))

if __name__ == "__main__":
    unittest.main()
