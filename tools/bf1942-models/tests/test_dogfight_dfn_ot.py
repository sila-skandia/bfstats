"""On his tail's Dip, Flip and Ninja (features/dogfight-school,
reviews/dfn-ot.md): each demo flown from the nine nearby starts the school's
tests use and scored with the shared measure (`dogfight_dfn_measure.mjs`).
The runs are deterministic, so the measured works/9 must equal the demo's
own `verdict.works`, and the lesson's survival verdict must follow from the
three. The nine are the measure's `STARTS` (an L9 array over sideways, along,
height and speed). The pilot in trouble is the attacker: the defender breaks
into him, turns into a dive he sees coming, and climbs away once nobody is on
his tail and the other is above him (`otAce`). reviews/dfn-ot.md,
"Ascendancy (2026-11-07)".
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
SHAPE = HERE / "dogfight_dfn_ot.mjs"
GUNS = 268  # the Spitfire's guns' reach (README, "What the airframe does")


def category(works: int) -> str:
    return "works" if works >= 7 else "partly" if works >= 3 else "no"


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
        (work / "shape.mjs").write_text(head + "\n" + SHAPE.read_text())
        proc = subprocess.run(["node", str(work / "shape.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"dfn harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class OnHisTailDfnTests(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def scores(self, demo_id: str) -> list[dict]:
        rows = self.shape["demos"][demo_id]["scores"]
        self.assertEqual(9, len(rows), demo_id)
        return rows

    def test_each_demo_scores_what_its_verdict_says(self) -> None:
        self.assertEqual("otAce", self.shape["ace"])
        for demo_id, demo in self.shape["demos"].items():
            self.assertEqual(demo_id, demo["kind"])
            self.assertEqual("otAce", demo["ace"], demo_id)
            measured = demo["measured"]
            self.assertEqual(9, measured["of"], demo_id)
            self.assertEqual(demo["declared"]["works"], measured["works"], (demo_id, demo["scores"]))
            self.assertEqual(9, demo["declared"]["of"], demo_id)
            self.assertEqual(category(demo["declared"]["works"]), measured["verdict"], demo_id)

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [d["measured"]["verdict"] for d in self.shape["demos"].values()]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.shape["survival"]["verdict"])

    def test_the_dip_gets_clear_in_six_and_is_caught_from_further_back(self) -> None:
        # "In six of the nine he got in behind you 252 to 319 m back, at the
        # edge of his reach but never with a shot, gave up 19 to 25 s in, and
        # at 40 s you were 1942 to 2530 m apart, never hit. From 30 m further
        # back he caught you at 99 to 110 m and shot you down twice; from 30 m
        # nearer you passed him at 14 m and were only 1030 m clear at 40 s."
        # (1034 m before the 2026-11-12 retail-g re-pin.)
        rows = self.scores("dip")
        for s in rows:
            # A turn and more in his circle first (he breaks about 3 s in),
            # after passing 14 to 35 m from him.
            self.assertGreater(s["t0"] - s["breakAt"], 6, s)
            self.assertTrue(14 <= s["minRange"] <= 35, s)
            self.assertIsNotNone(s["chaseAt"], s)
        clear = [s for s in rows if s["ok"]]
        for s in clear:
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertTrue(252 <= s["chaseMin"] <= 319, s)
            self.assertTrue(19 <= s["letGoAt"] <= 25, s)
            self.assertTrue(1942 <= s["endRange"] <= 2530, s)
        down = [s for s in rows if s["end"] == "shot down"]
        self.assertEqual(2, len(down))
        # re-pinned 2026-11-12 on retail g and box area
        # (features/retail-parity-cross-check-2026-11-12): 110 to 117 m before.
        self.assertTrue(all(s["dz"] == 30 and 99 <= s["chaseMin"] <= 110 for s in down), down)
        near = [s for s in rows if not s["ok"] and s["end"] is None]
        self.assertEqual(1, len(near))
        self.assertEqual(-30, near[0]["dz"])
        self.assertEqual(1030, near[0]["endRange"])

    def test_the_yo_yo_never_gets_the_shot_and_is_shown_from_the_pull_up(self) -> None:
        # "your guns had him for 0.27 s at most (4 rounds, in two of the
        # nine)"; never hit, and on your six for 1.2 s at most.
        # re-pinned 2026-11-12 on retail g and box area
        # (features/retail-parity-cross-check-2026-11-12): one start (dx -30, dz 30, dv -3) now
        # has him on your six for 1.17 s, where every start was under 1 s;
        # the bound is 1.5 s.
        self.assertEqual(7, self.shape["demos"]["flip"]["startAt"])
        rows = self.scores("flip")
        for s in rows:
            self.assertGreaterEqual(s["dives"], 1, s)
            self.assertLessEqual(s["myShot"], 0.27, s)
            self.assertLessEqual(s["hitsOnHim"], 4, s)  # 3 before the 2026-11-12 re-pin
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertLess(s["sixLost"], 1.5, s)
        self.assertEqual(2, sum(1 for s in rows if s["hitsOnHim"] > 0))

    def test_the_ninja_gets_one_pass_and_then_he_is_on_your_tail(self) -> None:
        # "Three times in nine, each from 30 m to one side, the pass shot him
        # down (14, 17 and 26 s in). In the other six it landed 2 to 21 rounds
        # and did not, and he was on your tail 5 to 24 s after it; no second shot
        # came in any. His guns never had you."
        demo = self.shape["demos"]["ninja"]
        self.assertGreaterEqual(demo["seconds"], 45)
        rows = self.scores("ninja")
        for s in rows:
            self.assertEqual(0, s["hisShot"], s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertEqual(1, s["attacks"], s)
        kills = [s for s in rows if s["killed"]]
        self.assertEqual(3, len(kills))
        self.assertTrue(all(s["dx"] != 0 and 13.5 <= s["killAt"] <= 26 for s in kills), kills)
        for s in rows:
            if not s["killed"]:
                self.assertTrue(2 <= s["hitsOnHim"] <= 21, s)
                self.assertTrue(4.5 <= s["sixLost"] <= 24, s)
                self.assertEqual(50, s["flown"], s)
        # The theatre's run: ten rounds (nine before the 2026-11-12 retail-g
        # re-pin), then he on your tail for 16 s.
        first = rows[0]
        self.assertEqual((0, 0, 0, 0), (first["dx"], first["dz"], first["dy"], first["dv"]))
        self.assertEqual(10, first["hitsOnHim"])
        self.assertTrue(15 <= first["sixLost"] <= 17, first)


if __name__ == "__main__":
    unittest.main()
