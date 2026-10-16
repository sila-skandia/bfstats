"""BodyDecoder: a rotation-only soldier body turns the soldier.

A human's client turns in place far more often than it steps, so the server
sends many soldier bodies carrying only a rotation (mask 0x4). They were
dropped because only a body with a position produced a transform, which left a
retail player facing one way for a whole life on the page (live, 2026-10-16).
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_body_harness.mjs"


class SidecarBodyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_rotation_only_body_has_a_transform(self):
        turn = self.r["turn"]
        self.assertEqual(turn["mask"], 4)
        self.assertIsNotNone(turn["pos"])
        self.assertEqual(turn["pos"], self.r["full"]["pos"])
        self.assertGreater(abs(turn["rot"][1]), 0.3)


if __name__ == "__main__":
    unittest.main()
