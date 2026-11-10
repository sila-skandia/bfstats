"""Runs `test_seat_fire_once.mjs` under node: a seat gun's `fireOnce`
(ledger GUN-22) held by `gun-cycle.js`: one round a press, a press
inside the cycle refused, a held gun without the word unchanged.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_seat_fire_once.mjs")


class SeatFireOnceNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
