"""Runs `test_effect_audio.mjs` under node.

`viewer/effect-audio.js` imports nothing but `engine-audio.js`, and that
imports nothing at all, so the impact-sound pool runs outside a browser
against a stubbed Web Audio context. The wrapper exists because a `test_*.mjs`
without one is invisible to `unittest discover` and to `verify.sh` — the
lesson `test_engine_audio.py` was written for.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_effect_audio.mjs")


class EffectAudioNodeTests(unittest.TestCase):
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
