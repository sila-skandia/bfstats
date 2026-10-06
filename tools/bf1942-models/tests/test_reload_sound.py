"""Runs `test_reload_sound.mjs`: a magazine change's Reload slot for the
shooter, a bot and a seated gun (ledger SND-17).

Same shape as `test_vehicle_audio.py`, so `unittest discover` (and therefore
`verify.sh`) runs it.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_reload_sound.mjs")


class ReloadSoundNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
