"""Runs `test_seat_fire_delay.mjs` under node: a seat gun's `fireDelay`
(ledger FA-13) held by `gun-cycle.js`, the battery ripple, the mortar's
second in the tube, and a delay-free gun unchanged.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_seat_fire_delay.mjs")


class SeatFireDelayNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
