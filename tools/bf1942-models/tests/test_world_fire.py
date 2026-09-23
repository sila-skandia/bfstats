"""Runs `test_world_fire.mjs`, the world-gunfire pool's node suite.

Same shape as `test_vehicle_audio.py` and `test_engine_audio.py`: a
self-contained node test over `viewer/world-fire.js` with a stub Web Audio
context, wrapped so `unittest discover` (and therefore `verify.sh`) runs it.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_world_fire.mjs")


class WorldFireNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        if not SCRIPT.exists():
            raise unittest.SkipTest(f"{SCRIPT.name} is not in the tree")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
