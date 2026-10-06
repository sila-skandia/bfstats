"""The room authority on a CTF layer (`server/authority.mjs` running
`viewer/ctf.js`), driven headless by `authority_ctf_harness.mjs`: the law is
the server's, every event goes out as a `ctf` row, and a client that plays
only those rows (`ctf-page.js` `onRow`) holds the server's flags after every
tick (`features/ctf-mode/README.md`, ledger CTF-1..CTF-8).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "authority_ctf_harness.mjs"


class AuthorityCtfTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_the_server_runs_the_law_and_sends_its_rows(self) -> None:
        ctf = self.results["ctf"]
        self.assertTrue(ctf["active"])
        self.assertEqual(["stole:1:1:2", "captured:1:1:2", "stole:0:2:1", "dropped:0:2:1",
                          "returned:0:1:2"], ctf["rows"])
        self.assertEqual([30, 1.5, 30], ctf["dropAt"])
        self.assertEqual([2], ctf["killed"])
        self.assertEqual({"1": 0, "2": 1}, ctf["captures"])

    def test_a_client_on_the_rows_alone_agrees_every_tick(self) -> None:
        self.assertEqual(0, self.results["ctf"]["mismatches"])

    def test_the_rooms_round_plays_the_layers_mode(self) -> None:
        self.assertEqual(1, self.results["ctf"]["mode"])
        self.assertEqual({"1": False, "2": False}, self.results["ctf"]["bleeds"])
        self.assertEqual({"active": False, "rows": 0, "mode": 2}, self.results["conquest"])


if __name__ == "__main__":
    unittest.main()
