"""viewmodel-anim.js — looping fire releases with the trigger, not cool.

Copies the harness + module into a temp dir and runs under node, same pattern
as test_deviation.py. The BAR/Thompson bug was LoopRepeat isRunning() staying
true forever so a fireRunning keep-alive outranked group.firing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "viewmodel_anim_harness.mjs"
MODULE = ROOT / "viewer" / "viewmodel-anim.js"


class ViewmodelAnimTests(unittest.TestCase):
    def test_clip_selection_matrix(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "package.json").write_text('{"type": "module"}')
            shutil.copyfile(MODULE, work / "viewmodel-anim.js")
            shutil.copyfile(HARNESS, work / "harness.mjs")
            proc = subprocess.run(
                ["node", str(work / "harness.mjs")],
                capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}\n{proc.stdout}")
        payload = json.loads(proc.stdout.strip())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["cases"], 13)


if __name__ == "__main__":
    unittest.main()
