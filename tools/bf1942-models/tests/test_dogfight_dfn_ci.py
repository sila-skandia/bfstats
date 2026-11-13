"""Breaking the circle (features/dogfight-school, "Breaking the circle"):
the deadlock and six tries out of it, each flown from the nine nearby starts
the school's tests use and scored with the shared measure
(`dogfight_dfn_measure.mjs`). The runs are deterministic, so each try's
measured works/9 must equal its own `verdict.works`, the lesson's survival
verdict must follow from them, and each failure must fail the way its words
say it does.
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
SHAPE = HERE / "dogfight_dfn_ci.mjs"
TRIES = {"dip": "dip", "zoom": "ninja", "back": "ninja", "chop": "flip", "reverse": "flip", "low": "flip"}


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
        body = SHAPE.read_text()
        imports = [line for line in body.splitlines() if line.startswith("import ")]
        rest = "\n".join(line for line in body.splitlines() if not line.startswith("import "))
        (work / "shape.mjs").write_text("\n".join(imports) + "\n" + head + "\n" + rest)
        proc = subprocess.run(["node", str(work / "shape.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"circle harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CircleTests(unittest.TestCase):
    shape: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = run_shape()

    def rows(self, demo: str) -> list[dict]:
        return self.shape["demos"][demo]["scores"]

    def test_each_try_scores_what_its_verdict_says(self) -> None:
        self.assertEqual({"circle", *TRIES}, set(self.shape["demos"]))
        for demo_id, kind in TRIES.items():
            demo = self.shape["demos"][demo_id]
            with self.subTest(demo_id):
                self.assertEqual(kind, demo["kind"])
                # Every try against the school's hunter, who gives up a chase.
                self.assertEqual("btHunter", demo["ace"])
                measured = demo["measured"]
                self.assertEqual(9, measured["of"])
                self.assertEqual(9, demo["declared"]["of"])
                self.assertEqual(demo["declared"]["works"], measured["works"], [s["ok"] for s in demo["scores"]])
                self.assertEqual(category(demo["declared"]["works"]), measured["verdict"])

    def test_several_tries_of_a_kind_each_have_a_tab_of_their_own(self) -> None:
        tabs = [d["tab"] for k, d in self.shape["demos"].items() if k in TRIES]
        self.assertNotIn(None, tabs)
        self.assertEqual(len(tabs), len(set(tabs)))

    def test_the_survival_verdict_follows_from_the_tries(self) -> None:
        verdicts = [self.shape["demos"][k]["measured"]["verdict"] for k in TRIES]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.shape["survival"]["verdict"])
        # Leaving is the one way out; nothing turns it round.
        self.assertEqual("works", self.shape["demos"]["dip"]["measured"]["verdict"])
        for k in ("zoom", "back", "chop", "reverse", "low"):
            self.assertEqual(0, self.shape["demos"][k]["measured"]["works"], k)

    def test_the_circle_is_a_deadlock(self) -> None:
        # Half a turn apart on one circle for 30 s, from every start: nobody
        # has a shot that would land, nobody is hit, nobody gains height.
        for s in self.rows("circle"):
            self.assertEqual([0, 0], s["shots"], s)
            self.assertEqual([0, 0], s["hits"], s)
            self.assertGreaterEqual(s["range"][0], 50, s)
            self.assertLessEqual(s["range"][1], 220, s)
            self.assertLessEqual(abs(s["endEdge"]), 15, s)

    def test_every_try_starts_from_the_same_deadlock(self) -> None:
        after = self.shape["after"]
        for demo_id in TRIES:
            for s in self.rows(demo_id):
                with self.subTest(demo_id):
                    self.assertEqual([0, 0], s["circleShots"], s)
                    self.assertGreaterEqual(s["circleRange"][0], 75, s)
                    # The move's own phase comes once the circle has been shown.
                    first = min(t for ph, t in s["at"].items() if ph != "circle")
                    self.assertGreaterEqual(first, after - 0.05, s)

    def test_leaving_gets_out_and_they_give_up(self) -> None:
        rows = self.rows("dip")
        for s in rows:
            self.assertAlmostEqual(8, s["t0"], delta=0.05)
            self.assertEqual(0, s["hitsOnMe"], s)
            self.assertEqual(0, s["myShot"], s)
            # They chase out of their reach: never inside 160 m once you run.
            self.assertGreaterEqual(s["closeAfter"], 160, s)
            if s["ok"]:
                self.assertTrue(16 <= s["letGo"] - s["t0"] <= 25, s)
                self.assertGreater(s["endRange"], 1000, s)
            else:
                # The two that fail: still behind you, holding their fire.
                self.assertIsNone(s["letGo"], s)
                self.assertTrue(270 <= s["endRange"] <= 295, s)
        self.assertEqual(7, sum(1 for s in rows if s["ok"]))

    def test_going_straight_up_they_follow_and_it_is_the_circle_again(self) -> None:
        for s in self.rows("zoom"):
            top = s["overTop"]
            self.assertTrue(35 <= top["dy"] <= 50, s)
            self.assertLessEqual(top["v"], 31, s)
            self.assertGreaterEqual(top["aceV"], 40, s)
            self.assertIn("follow", s["acePhases"], s)
            self.assertGreaterEqual(s["sixLost"], 1, s)
            self.assertLessEqual(s["at"]["again"], 17, s)
            self.assertEqual(0, s["myShot"], s)
        # 6 and 8 rounds in two until they were re-pinned 2026-11-12 on
        # retail g and box area (features/retail-parity-cross-check-2026-11-12).
        self.assertEqual([1, 2, 8], sorted(s["hits"][0] for s in self.rows("zoom") if s["hits"][0]))

    def test_coming_back_they_see_you_and_meet_you(self) -> None:
        rows = self.rows("back")
        for s in rows:
            self.assertIn("off", s["at"], s)
        # Never a burst from under their tail: one snap, one round, on a
        # head-on pass that comes within 2 m.
        self.assertEqual(1, sum(s["hitsOnHim"] for s in rows))
        snap = [s for s in rows if s["attacks"]]
        self.assertEqual(1, len(snap))
        self.assertEqual(1, snap[0]["hitsOnHim"])
        self.assertLessEqual(snap[0]["minRange"], 5)
        self.assertNotIn("guns", snap[0]["at"])
        # Let go before you turned back in six; in four of those they turn to
        # meet you (five until it was re-pinned 2026-11-12 on retail g and box
        # area, features/retail-parity-cross-check-2026-11-12), and in two they
        # pass you head-on; in three they never stopped chasing. Six of the
        # passes come within 2 to 25 m.
        self.assertEqual(6, sum(1 for s in rows if s["letGo"] is not None and s["letGo"] < 30))
        self.assertEqual(4, sum(1 for s in rows if s["meet"] is not None))
        self.assertEqual(6, sum(1 for s in rows if 2 <= s["minRange"] <= 25))
        self.assertTrue(all(38 <= s["meet"] <= 53 for s in rows if s["meet"] is not None))

    def test_the_chop_only_slows_you_and_sinks_you(self) -> None:
        for s in self.rows("chop"):
            self.assertLessEqual(s["slowest"], 28, s)
            self.assertLessEqual(s["lowest"], -49, s)
            self.assertLessEqual(s["endEdge"], -42, s)
            self.assertEqual([0, 0], s["shots"], s)
            self.assertEqual(0, s["bestQuarter"], s)

    def test_reversing_makes_it_a_head_on_pass(self) -> None:
        rows = self.rows("reverse")
        for s in rows:
            self.assertEqual(0, s["myShot"], s)
            self.assertEqual(0, s["hitsOnHim"], s)
        passes = [s for s in rows if "flip-guns" in s["at"]]
        self.assertEqual(5, len(passes))
        self.assertTrue(all(15 <= s["minRange"] <= 21 for s in passes), passes)

    def test_nose_low_gets_behind_them_but_far_under_them(self) -> None:
        rows = self.rows("low")
        for s in rows:
            up = s["up"]
            self.assertIsNotNone(up, s)
            self.assertGreaterEqual(up["behind"], 95, s)
            self.assertTrue(-135 <= up["dy"] <= -70, s)
            self.assertLessEqual(s["slowest"], 38, s)
            self.assertEqual(0, s["hitsOnMe"], s)
        self.assertEqual(7, sum(s["hitsOnHim"] for s in rows))
        self.assertEqual(5, sum(1 for s in rows if "evade" in s["acePhases"]))


if __name__ == "__main__":
    unittest.main()
