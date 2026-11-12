"""Runs `test_ssc_curves.mjs`, the `.ssc` Ramp envelope law (ledger SSC-7).

`viewer/ssc-curves.js` evaluates every `.ssc` modulator the page plays; the node
suite checks each Ramp shape against BF1942.exe 0x00803aa0. Wrapped here so
`unittest discover`, and therefore `verify.sh`, runs it.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_ssc_curves.mjs")


class SscCurvesNodeTests(unittest.TestCase):
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
