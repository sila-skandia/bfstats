"""WHAT IF (features/dogfight-recordings): from a moment a pilot is in the
other's sights, his other ways out flown on the flight law and scored as
what he really did is scored, then spliced onto the fight to play on.

`dogfight_whatif_harness.mjs` takes the school's "out of the lock" lesson,
where a pilot flies straight with the hunter closing on his tail and is shot
down, and asks what else he could have done at 10 s.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_dogfight_school import HARNESS, MODULES, THREE_PACKAGE
from test_flight import VIEWER

SCRIPT = Path(__file__).resolve().parent / "dogfight_whatif_harness.mjs"
EXTRA = ["dogfight-whatif.js", "dogfight-recorded.js", "vehicle-players.js"]


def closure(names: list[str]) -> set[str]:
    """The viewer modules `names` import, at every depth: the recorded fight
    reads its paths with the replay's own reader (`replay-recording.js`),
    which brings its own imports."""
    seen: set[str] = set()
    todo = list(names)
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        todo += re.findall(r"""(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]\./([^'"]+)['"]""", (VIEWER / name).read_text())
    return seen


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[: head.index("const out = {};")]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in {**MODULES, **{n: VIEWER / n for n in closure(EXTRA)}}.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "w.mjs").write_text(head + "\n" + SCRIPT.read_text())
        proc = subprocess.run(["node", str(work / "w.mjs")], capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"what-if harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class WhatIfTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()

    def test_it_is_the_chased_pilot_who_is_in_the_sights(self) -> None:
        # The pilot flying straight (side 1) is in the hunter's sights; the
        # hunter never is in his.
        self.assertEqual(1, self.out["chased"][2])
        self.assertNotIn(0, self.out["chased"])

    def test_every_way_out_is_flown(self) -> None:
        self.assertEqual(self.out["ways"], len(self.out["results"]))
        for r in self.out["results"]:
            self.assertIsNone(r["error"], r)
            self.assertIsNotNone(r["score"], r)

    def test_flying_straight_is_the_worst_of_them(self) -> None:
        # What he did: straight on under the hunter's guns, shot down.
        actual = self.out["actual"]
        self.assertTrue(actual["shotDown"], actual)
        self.assertGreater(actual["hisShot"], 5)
        # The best way out leaves the hunter a fraction of that and no kill.
        best = self.out["results"][0]
        self.assertFalse(best["score"]["shotDown"], best)
        self.assertLess(best["score"]["hisShot"], 1.5, best)
        # Ranked best first.
        bads = [r["bad"] for r in self.out["results"]]
        self.assertEqual(sorted(bads), bads)

    def test_the_way_out_plays_on_from_the_recording(self) -> None:
        sp = self.out["splice"]
        self.assertTrue(sp["same"])
        self.assertTrue(sp["monotonic"])
        self.assertEqual(sp["lengths"][0], sp["lengths"][1])
        # The flight starts where the recording stood.
        self.assertLess(sp["joined"], 1.0)
        self.assertAlmostEqual(sp["t0"] + 8, sp["duration"], delta=0.2)
        self.assertEqual(self.out["results"][0]["name"], sp["label"]["label"])


if __name__ == "__main__":
    unittest.main()
