"""Two things the Kotlin port's parity audit found in the Node sidecar itself
(features/sidecar-android-app/parity-audit.md):

- a page socket that closes cleanly raised 'close' twice (the close frame,
  then the TCP socket's own close), so the sidecar ran its page-gone path
  twice and printed "page socket closed" twice; it is one close now;
- a flag given last with no value after it (`--name` at the end) took
  `undefined` rather than its default: the player joined as "undefined".
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIDECAR = HERE.parent / "sidecar" / "sidecar.mjs"


def need_node():
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")


class PageSocketCloseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        need_node()
        out = subprocess.run(["node", str(HERE / "sidecar_ws_close_harness.mjs")],
                             capture_output=True, text=True, check=True, timeout=30)
        cls.r = json.loads(out.stdout)

    def test_a_close_frame_is_one_close(self):
        self.assertEqual(self.r["frame"], {"closes": 1, "clients": 0})

    def test_a_dropped_connection_is_one_close(self):
        self.assertEqual(self.r["drop"], {"closes": 1, "clients": 0})

    def test_the_server_closing_is_one_close(self):
        self.assertEqual(self.r["server"], {"closes": 1, "clients": 0})


class TrailingFlagTests(unittest.TestCase):
    def run_sidecar(self, *args):
        need_node()
        with tempfile.TemporaryDirectory() as tmp:
            # Port 9 (discard) never answers; --leave-on-stdin with stdin closed
            # leaves at once, after the name line.
            proc = subprocess.run(
                ["node", str(SIDECAR), "127.0.0.1:9", "--no-prejoin", "--leave-on-stdin",
                 "--out", f"{tmp}/r.ndjson", "--review", f"{tmp}/r.review.ndjson", *args],
                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30)
        return proc.stdout

    def test_a_trailing_name_keeps_the_default(self):
        self.assertIn("[sidecar] player name: sidecar (given)", self.run_sidecar("--name"))

    def test_a_name_with_a_value_is_taken(self):
        self.assertIn("[sidecar] player name: skandia-sc (given)", self.run_sidecar("--name", "skandia-sc"))


if __name__ == "__main__":
    unittest.main()
