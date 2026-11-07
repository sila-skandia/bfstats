"""The flat scissors' Dip, Flip and Ninja (features/dogfight-school,
reviews/dfn-sc.md): each demo flown from the nine nearby starts the school's
tests use and scored with the shared measure (`dogfight_dfn_measure.mjs`).
The runs are deterministic, so the measured works/9 must equal the demo's
own `verdict.works`, and the lesson's survival verdict must follow from the
three.
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
SHAPE = HERE / "dogfight_dfn_sc.mjs"


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


class ScissorsDfnTests(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def test_each_demo_scores_what_its_verdict_says(self) -> None:
        for demo_id, demo in self.shape["demos"].items():
            self.assertEqual(demo_id, demo["kind"])
            # The Dip against the scissors ace; the Flip and the Ninja against
            # the one who also climbs for height and faces a dive.
            self.assertEqual("scAce" if demo_id == "dip" else "scClimber", demo["ace"], demo_id)
            measured = demo["measured"]
            self.assertEqual(9, measured["of"], demo_id)
            self.assertEqual(demo["declared"]["works"], measured["works"], (demo_id, demo["scores"]))
            self.assertEqual(9, demo["declared"]["of"], demo_id)
            self.assertEqual(category(demo["declared"]["works"]), measured["verdict"], demo_id)

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [d["measured"]["verdict"] for d in self.shape["demos"].values()]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.shape["survival"]["verdict"])

    def test_the_dip_leaves_at_the_second_crossing_and_he_gives_up_out_of_reach(self) -> None:
        for s in self.shape["demos"]["dip"]["scores"]:
            # Two crossings in (about 8 s), never hit, clear past 900 m.
            self.assertTrue(7.5 <= s["t0"] <= 9.5, s)
            self.assertTrue(s["ok"] or s["minRange"] <= 15, s)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertEqual(0, s["hisShot"], s)
            self.assertGreater(s["endRange"], 1500, s)
            # He chases first, and lets go only well out of his reach.
            self.assertIsNotNone(s["letGo"], s)
            self.assertGreaterEqual(s["letGo"], 6, s)

    def test_the_flip_out_slows_him_and_never_gets_behind_him(self) -> None:
        demo = self.shape["demos"]["flip"]
        rows = demo["scores"]
        for s in rows:
            # Throttle back from the first crossing, 3-4 s in; the fight ends
            # at the Flip's 20 s.
            self.assertTrue(2.5 <= s["t0"] <= 4.5, s)
            self.assertLessEqual(demo["seconds"] - s["t0"], 21.5, s)
            # Never in his rear quarter, never a shot.
            self.assertEqual(0, s["bestQuarter"], s)
            self.assertLessEqual(s["myShot"], 0.37, s)
            self.assertIsNone(s["flipAt"], s)
            # His snaps as you cross.
            self.assertLessEqual(s["hisShot"], 0.4, s)
            self.assertLessEqual(s["hitsOnMe"], 2, s)
        self.assertEqual(2, sum(1 for s in rows if s["hitsOnMe"] >= 1), rows)
        self.assertEqual(1, sum(1 for s in rows if s["myShot"] > 0), rows)

    def test_the_ninja_is_over_him_at_4_s_and_under_him_by_8(self) -> None:
        demo = self.shape["demos"]["ninja"]
        rows = demo["scores"]
        # The try is shown to where it fails, not circled for 50 s.
        self.assertEqual(20, demo["seconds"])
        for s in rows:
            self.assertTrue(40 <= s["dy4"] <= 100, s)
            self.assertTrue(-85 <= s["dy8"] <= -30, s)
            self.assertLessEqual(s["hisShot"], 0.2, s)
            self.assertLessEqual(s["hitsOnMe"], 1, s)
            self.assertLess(s["sixLost"], 0.5, s)
            self.assertEqual(0, s["attacks"], s)
            self.assertEqual(0, s["myShot"], s)
            self.assertLessEqual(s["hang"], 3.7, s)
        # Level at even energy at the end in all nine; his one snap.
        self.assertTrue(all(abs(s["edgeEnd"]) <= 30 for s in rows), rows)
        self.assertEqual(1, sum(1 for s in rows if s["hitsOnMe"]), rows)


if __name__ == "__main__":
    unittest.main()
