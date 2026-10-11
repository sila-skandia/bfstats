"""`viewer/model-clips.js`: the model browser's engine switch turns the
propeller and rotor pairs that hang under an Engine on that Engine's revs
(ledger PHY-30), and no longer plays the baked clip that swung everything
else the exporter listed under it."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
HARNESS = Path(__file__).resolve().parent / "model_clips_harness.mjs"
MODULES = ["model-clips.js", "engine-spin.js", "engine-revs.js"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "node_modules" / "three").mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js",
                        work / "node_modules" / "three" / "three.module.js")
        (work / "node_modules" / "three" / "package.json").write_text(json.dumps({
            "name": "three", "version": "0.0.0", "type": "module",
            "main": "three.module.js", "exports": "./three.module.js"}))
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ModelClipsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_an_input_less_engines_rotor_runs_with_the_switch_and_no_lever(self) -> None:
        r = self.out["rotors"]
        self.assertTrue(r["before"]["hasEngine"])
        self.assertFalse(r["before"]["mixer"])           # no clip: the switch still exists
        self.assertEqual([True, True], [s["blade"] for s in r["before"]["state"]])
        # Revs climb toward the 1.2 clamp (T1 pinned at 1) and the disc turns.
        self.assertEqual([1.2, 1.2], [s["revs"] for s in r["running"]])
        self.assertEqual([True, True], [s["disc"] for s in r["running"]])
        self.assertGreater(r["running"][0]["discTurn"], 0)
        self.assertGreater(r["early"][0]["revs"], 0)
        self.assertLess(r["early"][0]["revs"], 1.2)
        # Off: blades at their authored pose.
        self.assertEqual([0, 0], [s["revs"] for s in r["off"]])
        self.assertEqual([0, 0], [s["discTurn"] for s in r["off"]])
        self.assertEqual([True, True], [s["blade"] for s in r["off"]])
        self.assertGreaterEqual(r["animating"], 1)

    def test_a_bound_engine_follows_its_lever_and_its_clip_stays_stopped(self) -> None:
        r = self.out["bound"]
        self.assertTrue(r["hasEngine"])
        self.assertEqual(0, r["clipActions"])
        self.assertEqual(1.0, r["hatch"])               # the hatch never turns
        self.assertEqual(0, r["leverAtRest"][0]["revs"])
        self.assertTrue(r["leverAtRest"][0]["blade"])
        self.assertEqual(1.2, r["leverFull"][0]["revs"])
        self.assertTrue(r["leverFull"][0]["disc"])

    def test_a_model_with_no_engine_pair_keeps_the_baked_clips(self) -> None:
        r = self.out["legacy"]
        self.assertFalse(r["hasEngine"])
        self.assertIsNone(r["pairEngine"])
        self.assertEqual(1, r["clipActions"])
        self.assertTrue(r["state"][0]["disc"])           # the bare swap


if __name__ == "__main__":
    unittest.main()
