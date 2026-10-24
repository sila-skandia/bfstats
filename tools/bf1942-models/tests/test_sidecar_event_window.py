"""The sidecar's reliable event stream keeps retail's send window.

`GameEventManager::transmit` (lnxded 0x0812d770) opens a new block only
while `getNumUnconfirmed` (0x0812e540), `(next - lastConfirmed) & 31`, is
under `+0x9c` = 15 (the ctor, 0x0812bc7a), and `lastConfirmed` (`+0x98`,
31 at the start) moves only over blocks delivered in order
(`advanceLastConfirmedBlockIndex` 0x0812ddf0). The sidecar used to count the
blocks still outstanding instead, so a lost block with its followers
delivered let the 5-bit index run on and lap the receiver's reorder map
(ledger SESS-2; features/udp-sidecar/wire.md section 49).
`sidecar_event_window_harness.mjs` drives a Session over a stub datagram
layer.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_event_window_harness.mjs"


class EventWindowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_a_fresh_stream_opens_fourteen_blocks(self):
        self.assertEqual(self.r["freshBlocks"], list(range(14)))
        self.assertEqual(self.r["freshHeld"], 6)

    def test_a_lost_block_holds_the_window_until_its_resend_lands(self):
        # only the resend of block 0 goes out while it is lost
        self.assertEqual(self.r["afterLoss"], [0])
        self.assertEqual(self.r["lastConfirmedWhileLost"], 31)
        # its delivery confirms 0..13 at once and the next block is 14
        self.assertEqual(self.r["lastConfirmedAfterResend"], 13)
        self.assertEqual(self.r["afterResend"], [0, 14])

    def test_the_window_law(self):
        law = self.r["law"]
        self.assertEqual(law["cap"], 15)
        self.assertFalse(law["start"])
        self.assertTrue(law["thirteenOut"])
        self.assertFalse(law["wrapOpen"])
        self.assertTrue(law["wrapShut"])


if __name__ == "__main__":
    unittest.main()
