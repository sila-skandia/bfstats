"""The sidecar answers a Challenge the way the retail client does: a
ChallengeResponse with xpack -1, and when the Challenge names an expansion a
second with that xpack (`sidecar/session.mjs` `challengeResponses`,
`features/udp-sidecar/wire.md` section 4). A Secret Weapons server
authenticates a connection twice before it sends the level
(`GameServer::authentificationOk` lnxded 0x08139950)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_challenge_harness.mjs"
# challenge[0..3] little-endian ^ 0xa14aac64 (calculateServerCheckSums).
A = 0x766A6477 ^ 0xA14AAC64


class SidecarChallengeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_an_expansion_gets_the_base_answer_then_its_own(self) -> None:
        self.assertEqual([x["xpack"] for x in self.r["sw"]], [-1, 783])
        self.assertEqual([x["xpack"] for x in self.r["rtr"]], [-1, 713])
        self.assertEqual({x["a"] for x in self.r["sw"]}, {A})

    def test_vanilla_gets_one(self) -> None:
        self.assertEqual(self.r["vanilla"], [{"a": A, "b": 0, "c": 0, "xpack": -1, "flag": 0}])


if __name__ == "__main__":
    unittest.main()
