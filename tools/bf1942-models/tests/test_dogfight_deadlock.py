"""Extend the scene (features/dogfight-school, "Extend the scene"): the
deadlocks found in a fight (a turning fight, a manoeuvre fest: nobody's shot
for six seconds inside 600 m, both turning), and the school's ways out flown
from the moment itself against the opponent as they stand, each scored on
whether it put the pilot on their six, got a shot, got clear, stayed locked
or got them shot.

`dogfight_deadlock_harness.mjs` takes the circle lesson (two equals round
one circle, nobody's shot) and the hunter on a pilot flying straight (one
pilot's shot the whole way), and extends the circle from 12 s.
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
from test_dogfight_whatif import EXTRA, closure
from test_flight import VIEWER

SCRIPT = Path(__file__).resolve().parent / "dogfight_deadlock_harness.mjs"


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[: head.index("const out = {};")]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in {**MODULES, **{n: VIEWER / n for n in closure(EXTRA + ["dogfight-deadlock.js"])}}.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        body = SCRIPT.read_text()
        imports = [line for line in body.splitlines() if line.startswith("import ")]
        rest = "\n".join(line for line in body.splitlines() if not line.startswith("import "))
        (work / "d.mjs").write_text("\n".join(imports) + "\n" + head + "\n" + rest)
        proc = subprocess.run(["node", str(work / "d.mjs")], capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"deadlock harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DeadlockTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()

    def test_the_circle_is_a_turning_fight_from_the_window_on(self) -> None:
        c = self.out["circle"]
        spans = c["spans"]
        self.assertEqual(1, len(spans), spans)
        span = spans[0]
        # The window fills six seconds in and the deadlock holds to the end.
        self.assertLessEqual(span["t0"], self.out["rules"]["window"] + 1, span)
        self.assertGreaterEqual(span["t1"], c["duration"] - 1, span)
        self.assertEqual("circle", span["kind"])
        self.assertEqual("circle", c["at12"]["kind"])
        # Both round the same way.
        self.assertEqual(c["at12"]["turn"][0], c["at12"]["turn"][1])

    def test_the_live_watch_finds_the_same_deadlock(self) -> None:
        w = self.out["circle"]["watch"]
        self.assertIsNotNone(w["state"])
        self.assertEqual("circle", w["state"]["kind"])
        self.assertLessEqual(w["firstAt"], self.out["rules"]["window"] + 1.5)
        self.assertGreater(w["state"]["since"], 20)

    def test_a_pilot_holding_the_shot_is_no_deadlock(self) -> None:
        self.assertEqual([], self.out["straight"]["spans"])
        self.assertEqual("shot down", self.out["straight"]["end"]["why"])

    def test_the_lessons_extension_leaves_the_deadlock_behind(self) -> None:
        leave = self.out["leave"]
        self.assertTrue(leave["in10"], leave)
        self.assertFalse(leave["in35"], leave)

    def test_the_scene_is_extended_from_the_exact_moment(self) -> None:
        e = self.out["extend"]
        self.assertAlmostEqual(12, e["t"], delta=0.05)
        self.assertLess(e["joined"], 0.5, e["joined"])
        self.assertTrue(e["splice"]["same"])
        self.assertTrue(e["splice"]["monotonic"])
        self.assertLess(e["splice"]["joined"], 0.5)
        self.assertAlmostEqual(e["t"] + self.out["rules"]["seconds"], e["splice"]["duration"], delta=0.2)

    def test_every_way_out_is_flown_and_ranked(self) -> None:
        e = self.out["extend"]
        self.assertEqual(self.out["ways"], sorted((r["id"] for r in e["results"]), key=self.out["ways"].index))
        for r in e["results"]:
            self.assertIsNone(r["error"], r)
            self.assertIn(r["score"]["result"], {"six", "shot", "clear", "neutral", "locked", "hit", "down", "ground"})
            self.assertTrue(r["words"], r)
            # Every try starts its move at once: no eight seconds of circling first.
            self.assertNotEqual(["circle"], r["phases"], r)
        self.assertTrue(e["sorted"])

    def test_doing_nothing_stays_locked_and_leaving_gets_clear(self) -> None:
        e = self.out["extend"]
        self.assertEqual("locked", e["actual"]["result"], e["actual"])
        by = {r["id"]: r for r in e["results"]}
        # The lesson's answer holds from the moment itself: leaving gets you
        # clear with no hit taken, and nothing puts them on your six.
        self.assertEqual("clear", by["leave"]["score"]["result"], by["leave"])
        self.assertEqual(0, by["leave"]["score"]["hits"])
        self.assertEqual("leave", e["results"][0]["id"], [r["id"] for r in e["results"]])
        self.assertFalse(any(r["score"]["result"] in {"down", "ground"} for r in e["results"]), e["results"])

    def test_every_result_has_its_words(self) -> None:
        words = self.out["words"]
        self.assertIn("On their six 3.4 s in", words["six"])
        self.assertIn("2 hits taken", words["six"])
        self.assertIn("1.2 km apart", words["clear"])
        self.assertIn("Still locked after 30.0 s", words["locked"])
        self.assertIn("They get the shot", words["hit"])
        self.assertIn("Shot down", words["down"])
        for v in words.values():
            self.assertNotIn(" he ", f" {v} ")
            self.assertNotIn(" him ", f" {v} ")


if __name__ == "__main__":
    unittest.main()
