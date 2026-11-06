"""A soldier bot's aim frame past 90 degrees of view pitch (ledger AI-108,
VIEW-14; report #8 of features/browser-play-feedback-2026-11-06).

`soldierFrame` built the camera's right as forward x world up, which turns
over once the view pitch passes 90 degrees (the limit is 95 since VIEW-14).
A bot turning toward a point behind it was driven over the top and then
flipped its yaw count every tick, +/-12 degrees, never facing its goal: the
trembling soldiers of the feedback video. The engine's soldier camera
(AI-123) pitches about a right row that pitch never changes.

The harness runs on the module set `test_bot_ai.py` stages.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_bot_ai import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "bot_aim_frame_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            if not source.exists():
                raise unittest.SkipTest(f"{source.name} is not in the tree")
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierAimFrameTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_right_row_is_level_and_the_same_either_side_of_ninety(self) -> None:
        frames = self.results["frames"]
        level = frames["0"]["r"]
        for pitch, frame in frames.items():
            with self.subTest(pitch=pitch):
                self.assertEqual(frame["r"], level)
                self.assertAlmostEqual(frame["fr"], 0, places=3)
                self.assertAlmostEqual(frame["fu"], 0, places=3)
                self.assertAlmostEqual(frame["ru"], 0, places=3)
                self.assertAlmostEqual(frame["uu"], 1, places=3)

    def test_a_steep_bot_turning_round_does_not_tremble(self) -> None:
        for case in ("behind", "behindLeft", "side", "down"):
            with self.subTest(case=case):
                r = self.results[case]
                self.assertLessEqual(r["longest"], 2, r)
                self.assertLessEqual(r["reversals"], 3, r)

    def test_a_steep_bot_turns_round_and_levels_its_view(self) -> None:
        for case in ("behind", "behindLeft", "side", "down"):
            with self.subTest(case=case):
                r = self.results[case]
                self.assertGreaterEqual(r["settled"], 0, r)
                self.assertLess(r["finalYawErr"], 1, r)
                self.assertLess(abs(r["finalPitch"]), 1, r)


if __name__ == "__main__":
    unittest.main()
