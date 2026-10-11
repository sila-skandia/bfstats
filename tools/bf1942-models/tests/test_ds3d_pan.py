"""Runs `test_ds3d_pan.mjs`: a placed voice is panned by amplitude, never a head.

`viewer/ds3d-pan.js` is DirectSound's no-virtualization pan (ledger SND-30)
and the point a Web Audio panner stands at to reproduce it
(features/sound-mix-parity, "The pan"). The node suite is wrapped here so
`unittest discover`, and therefore `verify.sh`, runs it.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_ds3d_pan.mjs")


class Ds3dPanNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
