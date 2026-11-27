"""The control point strip under the minimap (`viewer/cp-strip.js`, ledger
HUD-32).

Why it exists. A 2026-11-28 report on a Berlin replay: the strip of flags
under the minimap counted the uncapturable main bases, and its order was the
level's list order. Retail draws a tally of the capturable points, team 2's
from the left and team 1's from the right (`Score::outputScore`).
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "test_cp_strip.mjs"


class CpStripTest(unittest.TestCase):
    def test_slots(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)


if __name__ == "__main__":
    unittest.main()
