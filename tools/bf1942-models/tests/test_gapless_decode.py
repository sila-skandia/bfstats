"""Runs `test_gapless_decode.mjs`: a looping sample wraps where its wav did.

The published samples are MP3s, and a browser that ignores the LAME header's
encoder delay and padding (WebKit) put 26 to 143 ms of silence into every
pass of every loop. `viewer/gapless-decode.js` cuts the decoded buffer back to
the wav's own frames (features/world-vehicle-audio/loop-seam.md, ledger
SND-46).
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_gapless_decode.mjs")


class GaplessDecodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
