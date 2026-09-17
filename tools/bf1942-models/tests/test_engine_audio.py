"""Runs `test_engine_audio_default.mjs`, which nothing else did.

That file is a self-contained node test over `viewer/engine-audio.js` — a stub
Web Audio context, no browser — and it was the only `test_*` in this directory
with no Python wrapper, so `unittest discover` (and therefore `verify.sh`)
walked straight past it. Everything it asserts had to be run by hand to be
worth anything.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_engine_audio_default.mjs")


class EngineAudioNodeTests(unittest.TestCase):
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
