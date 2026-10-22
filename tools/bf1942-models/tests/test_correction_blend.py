"""`viewer/correction-blend.js` under node: the drawn pose eases onto a
server correction instead of jumping with it.

The simulation keeps every correction whole, as the retail client does; only
what is drawn carries the jump and fades it. These tests pin that the drawn
pose is continuous at the instant a correction lands, that the offset fades to
nothing, that a teleport still snaps, and that a walk corrected whole twenty
times a second is drawn smooth (the lab's walking shake, 2026-10-22).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "correction_blend_harness.mjs"

MODULES = {
    "correction-blend.mjs": VIEWER / "correction-blend.js",
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")], capture_output=True, text=True,
            timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class CorrectionBlendTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_drawn_pose_does_not_move_when_a_correction_lands(self) -> None:
        a = self.results["a"]
        self.assertAlmostEqual(a["drawnBefore"], a["drawnAfter"], places=9)
        self.assertAlmostEqual(a["offset"], -0.05, places=9)

    def test_the_offset_fades_to_nothing(self) -> None:
        b = self.results["b"]
        self.assertTrue(b["monotone"])
        self.assertTrue(b["sameSign"])
        # Down to a third of itself in ~0.1 s, gone in half a second.
        self.assertLess(abs(b["after100ms"]), 0.05 * 0.45)
        self.assertLess(abs(b["after500ms"]), 0.001)
        self.assertEqual(b["after1s"], 0)

    def test_a_teleport_snaps(self) -> None:
        c = self.results["c"]
        self.assertFalse(c["blended"])
        self.assertEqual(c["offset"], 0)
        self.assertEqual(c["snaps"], 1)

    def test_a_turn_correction_is_drawn_continuous(self) -> None:
        d = self.results["d"]
        self.assertAlmostEqual(d["drawnYawAtInstant"], 0, places=6)
        self.assertAlmostEqual(d["simYaw"], 3, places=6)
        self.assertGreater(d["drawnYawAfter500ms"], 2.9)

    def test_a_walk_corrected_twenty_times_a_second_is_drawn_smooth(self) -> None:
        e = self.results["e"]
        # Corrected whole, the model's drawn speed jitters by 2.1% rms from
        # this mismatch alone (the real page, with its turn corrections on top,
        # measured 15.3%). Blended, it is a fifth of that.
        self.assertGreater(e["whole"]["jitterPct"], 1.5)
        self.assertLess(e["blended"]["jitterPct"], e["whole"]["jitterPct"] / 4)
        # And the drawn body keeps up: the blend adds no lag of its own beyond
        # the prediction's (both sit the same distance behind the server).
        self.assertLess(abs(e["blended"]["endGap"] - e["whole"]["endGap"]), 0.02)


if __name__ == "__main__":
    unittest.main()
