"""Can you survive the up and over? (features/dogfight-school/reviews/dfn-uo.md)

You are chasing him; he pulls nearly straight up out of your chase, and the
pilot in trouble is you, the follower, once he goes vertical. The lesson's
three move demos (the Dip, the Flip, the Ninja) are flown from the nine
starts (`STARTS`) against the ace who does not loop twice in front of you
(`uoAceSharp`) and
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
        for s in self.demo("dip")["scores"]:
            # The Dip is the answer to his pull: within 1.5 s of it.
            self.assertGreaterEqual(s["t0"], s["pullAt"], s)
            self.assertLess(s["t0"], s["pullAt"] + 1.5, s)
        for s in self.demo("flip")["scores"]:
            # The Flip is flown by the hunted pilot: one who followed him up.
            self.assertIn("up", s["myPhases"], s)
            self.assertEqual("flip-dive", next(p for p in s["myPhases"] if p.startswith("flip")), s)
            self.assertGreater(s["t0"], s["pullAt"] + 2, s)

    def test_the_ace_does_not_loop_twice_in_front_of_you(self) -> None:
        # uoAceSharp: after his first loop he breaks instead of going up
        # again, or goes after a man running from him.
        for demo_id in ("dip", "flip", "ninja"):
            for s in self.demo(demo_id)["scores"]:
                self.assertTrue({"break", "chase"} & set(s["acePhases"]), (demo_id, s))

    def test_the_dip_gets_clear_as_he_breaks_it_off(self) -> None:
        # "In seven he breaks it off 12.1 to 12.6 s in ... at 35 s you are 2298
        # to 2555 m apart and opening, never hit. From 30 m to the left, 30 m
        # closer and 3 m/s slower he hits you 5 times ...; from 30 m to the
        # right, 30 m further back and 3 m/s faster he chases you over the
        # top, sits on your tail for 7.7 s and lets you go only at 33 s."
        for s in self.demo("dip")["scores"]:
            self.assertIn("dip-run", s["myPhases"], s)
            self.assertIn("let-go", s["acePhases"], s)
            if (s["dx"], s["dz"], s["dv"]) == (-30, 30, -3):
                self.assertFalse(s["ok"], s)
                self.assertEqual(5, s["hitsAll"], s)
            elif (s["dx"], s["dz"], s["dv"]) == (30, -30, 3):
                self.assertFalse(s["ok"], s)
                self.assertIn("chase", s["acePhases"], s)
                self.assertGreater(s["sixLost"], 7, s)
            else:
                self.assertTrue(s["ok"], s)
                self.assertEqual(0, s["hitsAll"], s)
                self.assertIn("break", s["acePhases"], s)
                self.assertGreaterEqual(s["endRange"], 2290, s)
                self.assertLessEqual(s["endRange"], 2560, s)

    def test_the_flip_from_following_him_up_never_works(self) -> None:
        # "It never works: ... 2 to 5 s under 35 m/s inside 300 m of him; in
        # none of the nine are you 2 s in his rear quarter with the shot, he
        # hits you once or twice in four" (three until it was re-pinned
        # 2026-11-12 on retail g and box area,
        # features/retail-parity-cross-check-2026-11-12).
        d = self.demo("flip")
        self.assertGreaterEqual(d["seconds"], 40)
        for s in d["scores"]:
            self.assertFalse(s["ok"], s)
            self.assertIsNone(s["flipAt"], s)
            self.assertGreaterEqual(s["hang"], 2, s)
            self.assertLessEqual(s["hang"], 5.3, s)
            self.assertLessEqual(s["hitsAll"], 2, s)
        self.assertEqual(4, sum(1 for s in d["scores"] if s["hitsAll"] > 0))

    def test_the_ninja_shoots_at_his_top_then_from_behind_him_unseen(self) -> None:
        # "In six you shoot him at the top of his loop at 7 s and again from
        # behind him, unseen, at 16.6 to 17.3 s, and he never has a shot at
        # you: in three he goes down, 18.8 to 20.1 s in; in three he sees you
        # ... and turns in, and you leave, 1308 to 1594 m apart ..." (one down
        # at 19.7 s and five left until it was re-pinned 2026-11-12 on retail
        # g and box area, features/retail-parity-cross-check-2026-11-12).
        d = self.demo("ninja")
        self.assertGreaterEqual(d["seconds"], 45)
        self.assertTrue(d["scores"][0]["ok"], "the start the theatre plays")
        down = left = 0
        for s in d["scores"]:
            self.assertEqual(0, s["hitsAll"], s)
            self.assertLess(s["sixLost"], 1, s)
            if not s["ok"]:
                continue
            self.assertGreaterEqual(s["attackAt"][0], 6.5, s)
            self.assertLessEqual(s["attackAt"][0], 7.4, s)
            self.assertEqual(0, s["hisShot"], s)
            self.assertGreaterEqual(s["attackAt"][1], 16.5, s)
            self.assertLessEqual(s["attackAt"][1], 17.4, s)
            self.assertIn("ninja-stalk", s["myPhases"], s)
            if s["killT"] is not None:
                down += 1
                self.assertTrue(18.7 <= s["killT"] <= 20.2, s)
            else:
                left += 1
                self.assertIn("leave", s["myPhases"], s)
                self.assertGreaterEqual(s["endRange"], 1250, s)
                self.assertLessEqual(s["endRange"], 1600, s)
        self.assertEqual((3, 3), (down, left))
        fails = {(s["dx"], s["dz"], s["dy"], s["dv"]): s for s in d["scores"] if not s["ok"]}
        self.assertEqual({(0, -30, -10, -3), (0, 30, 10, 3), (30, -30, 0, 3)}, set(fails))
        self.assertLess(fails[(0, 30, 10, 3)]["minRange"], 15)

if __name__ == "__main__":
    unittest.main()
