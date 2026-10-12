"""Runs `test_hand_fire_patch_clock.mjs`: a hand weapon's patch has one clock,
and a trigger starts every sample still behind its `Volume <- Time` gate over
(ledger SND-33). The M1 Garand's casings ring once after a clip, not once a
round.

Same shape as `test_reload_sound.py`, so `unittest discover` (and therefore
`verify.sh`) runs it.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_hand_fire_patch_clock.mjs")


class HandFirePatchClockNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
