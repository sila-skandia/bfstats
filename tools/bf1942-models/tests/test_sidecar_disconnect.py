"""The sidecar leaves the way retail does: three Disconnect datagrams
(a retail leave from a 1.612 server, 2026-10-24), all sent before the socket
closes (`sidecar/netconn.mjs`). Before this a leave closed the socket in the
same tick and the server pinged the sidecar until it timed out."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_disconnect_harness.mjs"


class SidecarDisconnectTests(unittest.TestCase):
    def test_three_disconnects_reach_the_server(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["types"], [5, 5, 5])


if __name__ == "__main__":
    unittest.main()
