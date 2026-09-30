"""Runs `test_gun_one_shots.mjs` under node.

The per-round one-shot gun (DC Final's MG42, `mg_temp.wav` every round), the
eight-instance cap on one sample, the `randomPlay` roll that counts silences,
and the case-blind weapon lookups, against a stubbed Web Audio context. A
`test_*.mjs` without a wrapper is invisible to `unittest discover` and to
`verify.sh`.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_gun_one_shots.mjs")


class GunOneShotNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
