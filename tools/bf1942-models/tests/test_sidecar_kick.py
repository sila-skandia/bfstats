"""A server that kicks, bans or closes the sidecar is not rejoined.

The sidecar used to come straight back after any Disconnect that was not a
kick or a ban datagram, and a kick reached the page only as the generic
"connection lost" box. Retail goes back to its menu with KICKED FROM SERVER
and the server's reason (BF1942.exe 0x006b42f0). `sidecar_kick_harness.mjs`
runs the real `sidecar/sidecar.mjs` against a fake server that accepts the
connection and then sends one Disconnect, listens on its page socket as a
page would, and counts what the sidecar sends the server afterwards
(features/udp-sidecar/wire.md, "Kicks, bans and server closes").
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_kick_harness.mjs"


def run_case(name: str) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        proc = subprocess.run(["node", str(HARNESS), name, tmp], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        rec = [json.loads(l) for l in (Path(tmp) / f"{name}.ndjson").read_text().splitlines() if l.strip()]
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    out["recorded"] = [r for r in rec if r.get("e") == "serverLeft"]
    return out


class KickTests(unittest.TestCase):
    def assert_stopped(self, r: dict) -> None:
        # nothing more to the server: no second ConnectRequest, no probe
        self.assertEqual(r["seen"]["afterDisconnect"], {"connectRequests": 0, "probes": 0})
        self.assertFalse(r["stillRunning"])
        self.assertEqual(r["exitCode"], 1)

    def test_a_kick_with_a_reason(self) -> None:
        r = run_case("kicked")
        self.assert_stopped(r)
        self.assertEqual(len(r["serverLeft"]), 1)
        left = r["serverLeft"][0]
        self.assertEqual((left["kind"], left["reason"], left["final"]), ("kicked", 0x15, True))
        self.assertEqual(left["title"], "KICKED FROM SERVER")
        self.assertEqual(left["text"], "Kicked for teamkilling")
        # the page's state row says it too, and the recording keeps the row
        self.assertEqual(r["states"][-1], {"state": "kicked", "title": "KICKED FROM SERVER", "text": "Kicked for teamkilling"})
        self.assertEqual(r["recorded"][0]["title"], "KICKED FROM SERVER")

    def test_a_ban(self) -> None:
        r = run_case("banned")
        self.assert_stopped(r)
        left = r["serverLeft"][0]
        self.assertEqual((left["kind"], left["title"], left["final"]), ("banned", "BANNED FROM SERVER", True))

    def test_a_close_the_server_chose(self) -> None:
        r = run_case("closed")
        self.assert_stopped(r)
        left = r["serverLeft"][0]
        self.assertEqual((left["kind"], left["reason"], left["final"]), ("closed", 0x0D, True))
        self.assertEqual(left["title"], "DISCONNECTED FROM SERVER")

    def test_a_timeout_still_rejoins(self) -> None:
        r = run_case("timeout")
        # a drop is the network's doing: the sidecar probes to get back on
        self.assertTrue(r["stillRunning"])
        self.assertGreaterEqual(r["seen"]["afterDisconnect"]["probes"], 1)
        left = r["serverLeft"][0]
        self.assertEqual((left["kind"], left["final"]), ("drop", False))
        self.assertEqual(r["states"][-1]["state"], "rejoining")


if __name__ == "__main__":
    unittest.main()
