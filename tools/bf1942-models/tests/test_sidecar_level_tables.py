"""The sidecar's level tables on a machine without the game installed.

`sidecar/level-tables.mjs` fetches the baked tables (`sidecar/bake-tables.mjs`,
published beside each level bake on mesh.bfstats.io) into the cache before a
level needs them, and `template-table.mjs` / `game-tables.mjs` resolve memo ->
local cache -> install -> the downloaded copy -> the recorded fallback. The
session holds a SetLevel, and everything after it, until the tables are there
(`session.mjs` `levelGate`), so no object is named and no world dump acked
before. Run against a local HTTP server, with BF1942_DIR an empty directory:
no install, and no Python needed.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_level_tables_harness.mjs"


class SidecarLevelTablesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        (root / "no-install").mkdir()
        (root / "cache").mkdir()
        env = {**os.environ, "BF1942_DIR": str(root / "no-install"), "SIDECAR_CACHE": str(root / "cache"),
               "SIDECAR_PYTHON": "/nonexistent/python3"}
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60, env=env)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])
        cls.stderr = proc.stderr

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    # -- the mapping ---------------------------------------------------------
    def test_vanilla_is_the_root_tree(self) -> None:
        self.assertEqual(self.r["urls"]["bf1942"], "https://mesh.example/maps/wake/sidecar/coop.json")
        self.assertEqual(self.r["urls"]["BF1942"], "https://mesh.example/maps/market_garden/sidecar/conquest.json")

    def test_other_mods_are_their_own_tree(self) -> None:
        u = self.r["urls"]
        self.assertEqual(u["XPack1"], "https://mesh.example/maps/mods/xpack1/anzio/sidecar/coop.json")
        self.assertEqual(u["xpack2"], "https://mesh.example/maps/mods/xpack2/essen/sidecar/objectivemode.json")
        self.assertEqual(u["DC_Final"], "https://mesh.example/maps/mods/dc_final/dc_lostvillage/sidecar/ctf.json")
        self.assertEqual(u["FHSW"], "https://mesh.example/maps/mods/fhsw/lake_ladoga-1944/sidecar/conquest.json")
        self.assertEqual(u["noSlash"], "https://mesh.example/maps/mods/desertcombat/tobruk/sidecar/coop.json")

    def test_level_and_mode_keys(self) -> None:
        self.assertEqual(self.r["keys"]["level"], "market_garden")
        self.assertEqual(self.r["keys"]["mode"], ["coop", "conquest", "conquest", "objectivemode"])

    # -- the resolution order --------------------------------------------------
    def test_nothing_before_the_download(self) -> None:
        self.assertIsNone(self.r["before"]["table"])
        self.assertIsNone(self.r["before"]["anim"])

    def test_download_fills_the_cache_and_the_sync_lookups(self) -> None:
        self.assertEqual(self.r["first"]["source"], "download")
        self.assertEqual(self.r["cacheFile"], "bf1942/wake-coop.baked.json")
        a = self.r["after"]
        self.assertEqual((a["count"], a["tid5"], a["cls3"]), (6, "TestTank", "PlayerControlObject"))
        self.assertTrue(a["layouts"])
        self.assertEqual((a["anim"], a["cp"]), (3, "Airfield"))
        self.assertEqual(a["named"], {"computed": True, "tid4": "Tiger"})

    def test_memo_then_cache_without_a_second_request(self) -> None:
        self.assertEqual(self.r["again"], "download")
        self.assertEqual(self.r["fresh"], "cache")
        self.assertEqual(self.r["requestsAfterFirst"], 0)

    def test_requests_name_the_tree(self) -> None:
        req = self.r["requests"]
        self.assertEqual(req[0], "/maps/wake/sidecar/coop.json")
        self.assertIn("/maps/mods/xpack1/anzio/sidecar/coop.json", req)
        self.assertEqual(self.r["xpack"], "download")

    def test_unpublished_level_falls_back(self) -> None:
        self.assertEqual(self.r["missing"], "none")
        self.assertIsNone(self.r["missingTable"])
        self.assertFalse(self.r["missingNamed"])

    def test_failures_are_bounded_and_refused(self) -> None:
        self.assertEqual(self.r["slow"], {"source": "none", "quick": True})
        self.assertEqual(self.r["garbled"], "none")
        self.assertEqual(self.r["off"], "none")

    def test_failures_are_logged_once(self) -> None:
        self.assertEqual(self.stderr.count("could not download the tables for bf1942|no_such_level|conquest"), 1)

    # -- the session's level load -----------------------------------------------
    def test_the_level_load_holds_everything_after_the_setlevel(self) -> None:
        g = self.r["gate"]
        self.assertEqual(g["held"]["order"], ["ServerInfo"])
        self.assertNotIn("Ack", g["held"]["outbox"])
        self.assertEqual(g["held"]["gate"]["mod"], "bf1942")
        self.assertEqual(g["held"]["gate"]["levelPath"], "bf1942/levels/wake/")
        self.assertEqual(g["order"], ["ServerInfo", "SetLevel", "CreateObject", "DataBaseComplete", "ghost", "CreateObject"])
        self.assertIn("Ack", g["outbox"])
        self.assertEqual(g["release"], {"timedOut": False, "source": "download"})

    def test_the_real_gate_names_objects_from_the_download(self) -> None:
        g = self.r["realGate"]
        self.assertEqual(g["heldOrder"], ["ServerInfo"])
        self.assertEqual(g["source"], "download")
        self.assertEqual(g["tmpl700"], "TestTank")
        self.assertTrue(g["ack"])

    def test_a_gate_that_never_answers_times_out(self) -> None:
        self.assertTrue(self.r["gateTimeout"]["timedOut"])
        self.assertEqual(self.r["gateTimeout"]["order"], ["ServerInfo", "SetLevel", "CreateObject", "DataBaseComplete"])

    def test_no_gate_is_unchanged(self) -> None:
        self.assertEqual(self.r["noGate"], ["ServerInfo", "SetLevel", "CreateObject", "DataBaseComplete"])

    # -- the objects.rfa CRC ------------------------------------------------------
    def test_bundled_objects_crc(self) -> None:
        c = self.r["crc"]
        self.assertEqual(c["bf1942"], 0x56210250)   # the retail 1.61 archive (test_sidecar_challenge)
        self.assertIsInstance(c["xpack2"], int)
        self.assertIsNone(c["unknown"])
        self.assertIsNone(c["notBundled"])


if __name__ == "__main__":
    unittest.main()
