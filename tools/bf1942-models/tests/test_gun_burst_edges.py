"""Runs `test_gun_burst_edges.mjs`: a vehicle gun's press and release, from
`gun-cycle.js` through the rack (ledger SND-12, SND-14).

Same shape as `test_vehicle_audio.py`, so `unittest discover` (and therefore
`verify.sh`) runs it.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_gun_burst_edges.mjs")


class GunBurstEdgeNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
