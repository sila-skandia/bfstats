"""Runs `test_flyby_cracks.mjs` under node.

A bullet's passing crack through `EffectAudio`: a round's own script, shaped
as `extract_effects.py` ships it, plays for a round that flies past the
listener. The wrapper exists for the same reason `test_effect_audio.py` does:
a `test_*.mjs` without one is invisible to `unittest discover` and `verify.sh`.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_flyby_cracks.mjs")


class FlybyCracksNodeTests(unittest.TestCase):
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
