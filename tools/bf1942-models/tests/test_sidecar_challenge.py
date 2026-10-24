"""The sidecar answers a Challenge the way the retail client does: a
ChallengeResponse with xpack -1, and when the Challenge names an expansion a
second with that xpack (`sidecar/session.mjs` `challengeResponses`,
`features/udp-sidecar/wire.md` section 4). A Secret Weapons server
authenticates a connection twice before it sends the level
(`GameServer::authentificationOk` lnxded 0x08139950)."""

from __future__ import annotations

import hashlib
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

    def test_the_crc_is_bzip2s(self) -> None:
        # CRC-32/BZIP2 check value: BF1942.exe 0x005c1220 builds an MSB-first
        # 0x04c11db7 table, 0x005c1280 inits 0xffffffff and NOTs the result.
        self.assertEqual(self.r["checkValue"], 0xFC891918)

    def test_b_is_the_crc_xored_with_the_challenge(self) -> None:
        ch0 = 0x766A6477
        self.assertEqual([x["b"] for x in self.r["injected"]], [0x11111111 ^ ch0, 0x22222222 ^ ch0])
        self.assertEqual({x["c"] for x in self.r["injected"]}, {0})

    def test_a_missing_archive_answers_null(self) -> None:
        self.assertIsNone(self.r["missing"])

    def test_b_matches_the_retail_client(self) -> None:
        if self.r["retailCrc"] is None:
            self.skipTest("no Mods/bf1942/Archives/objects.rfa in the install")
        self.assertEqual(self.r["retailCrc"], 0x56210250)
        (resp,) = self.r["retail"]
        self.assertEqual(resp["b"], 0x31597125)
        self.assertEqual(resp["a"], 0x67787375 ^ 0xA14AAC64)
        self.assertEqual(resp["c"], 0)

    # gcd_compute_response (BF1942.exe 0x0081fa20), independently:
    # md5hex(key) . "%.8x" r . md5hex(key . "%d" (r % 0xffff) . challenge) . NUL.
    @staticmethod
    def gcd(key: str, challenge: str, r: int) -> str:
        md5 = lambda s: hashlib.md5(s.encode("latin1")).hexdigest()
        return md5(key) + f"{r:08x}" + md5(f"{key}{r % 0xFFFF}{challenge}") + "\0"

    def test_the_challenge_string_stops_at_the_servers_nul(self) -> None:
        # initChallengeString NULs the tenth byte, so nine letters.
        self.assertEqual(self.r["chNul"], "wdjvujbwc")
        # Without a NUL the client's strlen runs on into the mod (+0x16).
        self.assertEqual(self.r["chFull"], "abcdefghijxpack2")

    def test_the_key_hash_is_gamespys(self) -> None:
        fixed = self.r["fixed"]
        self.assertEqual(len(fixed), 73)
        self.assertEqual(fixed, self.gcd(self.r["key"], "wdjvujbwc", 0x12345678))

    def test_each_product_hashes_its_own_key(self) -> None:
        for h, key in zip(self.r["swHashes"], [self.r["key"], "xp783"]):
            r = int(h[32:40], 16)
            self.assertEqual(h, self.gcd(key, "wdjvujbwc", r))

    def test_keys_are_generated_once_and_kept(self) -> None:
        st = self.r["store"]
        self.assertRegex(st["base"], r"^[1-9][0-9]{21}$")
        self.assertNotEqual(st["base"], st["sw"])
        self.assertEqual((st["baseAgain"], st["swAgain"]), (st["base"], st["sw"]))
        self.assertEqual((st["overBase"], st["overSw"]), ("OVERRIDE", st["sw"]))

    # The content check (sidecar/content-crc.mjs): the Ack is the level's
    # contentCrc32.con row xor the challenge, as a retail client sent it.
    def test_content_ack_matches_retail(self) -> None:
        if self.r["content"]["marketGarden"] is None:
            self.skipTest("no BF1942 install")
        self.assertEqual(self.r["content"]["marketGarden"], 2545831109)
        self.assertEqual(self.r["tgeAck"], self.r["tge"]["ack"])

    def test_content_ack_unknown_is_zero(self) -> None:
        self.assertIsNone(self.r["content"]["noLevel"])
        self.assertIsNone(self.r["content"]["noInstall"])
        self.assertEqual(self.r["ackUnknown"], 0)

    def test_content_crc_file_parses(self) -> None:
        self.assertEqual(self.r["parsed"], {"xpack1/anzio/gpm_cq": [2747151060, 7]})
        self.assertEqual(self.r["gpm"], ["GPM_CQ", "GPM_COOP", "GPM_CTF", "GPM_TDM", "GPM_OBJECTIVEMODE", None])
        self.assertEqual(self.r["level"], ["market_garden", "Anzio"])


if __name__ == "__main__":
    unittest.main()
