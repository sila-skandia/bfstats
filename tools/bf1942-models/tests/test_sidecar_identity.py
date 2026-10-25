"""The player name from the page: `sidecar.mjs --name-from-page`.

Retail sends the player's name in the CreatePlayer it queues at the
Challenge, so the name must be known before the sidecar connects. With
`--name-from-page` the sidecar opens its page socket first, waits for the
page's `{type: 'identity', name}` (the account profile's player name, or
null for none), and only then sends the ConnectRequest; with no identity
within `--name-wait` seconds it joins as `--name`. Without the flag nothing
changes: the lab probes connect at once (features/game-profiles).

`sidecar_identity_harness.mjs` runs the real `sidecar/sidecar.mjs` against a
fake server that accepts the connection and notes when the ConnectRequest
came, and plays the page on the sidecar's socket.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "sidecar_identity_harness.mjs"
NAME_MODULE = HERE.parent / "sidecar" / "player-name.mjs"


def run_case(name: str) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        proc = subprocess.run(["node", str(HARNESS), name, tmp], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class IdentityTests(unittest.TestCase):
    def test_the_page_names_the_player_before_the_connect(self) -> None:
        r = run_case("identity")
        # the socket is up before anything goes to the server
        self.assertLess(r["feedAt"], r["connectAt"])
        # and the ConnectRequest waits for the page's identity
        self.assertGreaterEqual(r["connectAt"], r["identityAt"])
        self.assertEqual(r["connectRequests"], 1)
        self.assertEqual(r["nameLine"], "[sidecar] player name: Page Soldier (from the page)")
        self.assertEqual(r["joinedAs"], "Page Soldier")
        self.assertEqual(r["headerName"], "Page Soldier")

    def test_a_null_identity_does_not_wait(self) -> None:
        r = run_case("null")
        self.assertEqual(r["nameLine"], "[sidecar] player name: Fallback Name (fallback)")
        self.assertEqual(r["joinedAs"], "Fallback Name")
        # --name-wait is 10 s in this case: the connect went out at once
        self.assertLess(r["connectAt"] - r["identityAt"], 2000)

    def test_no_page_falls_back_after_the_wait(self) -> None:
        r = run_case("timeout")
        self.assertEqual(r["joinedAs"], "Fallback Name")
        self.assertEqual(r["nameLine"], "[sidecar] player name: Fallback Name (fallback)")
        self.assertIn("[sidecar] no identity from a page within 1.5 s", r["log"])
        # the wait was 1.5 s from the socket coming up
        self.assertGreaterEqual(r["connectAt"] - r["feedAt"], 1400)
        self.assertLess(r["connectAt"] - r["feedAt"], 4000)

    def test_a_name_retail_could_not_send_falls_back(self) -> None:
        r = run_case("invalid")
        self.assertEqual(r["joinedAs"], "Fallback Name")
        self.assertTrue(any("cannot be sent" in l for l in r["log"]), r["log"])
        self.assertLess(r["connectAt"] - r["identityAt"], 2000)

    def test_a_long_name_is_cut_where_the_server_cuts_it(self) -> None:
        r = run_case("long")
        self.assertEqual(r["joinedAs"], "A" * 20 + "BCD")

    def test_a_late_identity_is_ignored(self) -> None:
        r = run_case("late")
        self.assertEqual(r["joinedAs"], "Fallback Name")
        self.assertIn('[sidecar] page identity ignored: already joining as "Fallback Name"', r["log"])

    def test_without_the_flag_nothing_waits(self) -> None:
        r = run_case("noflag")
        self.assertEqual(r["joinedAs"], "Fallback Name")
        # the name given on the command line, said once for the desktop app's
        # status line (no wait, no page)
        self.assertEqual(r["nameLine"], "[sidecar] player name: Fallback Name (given)")
        # connected before a page could have said anything
        self.assertLess(r["connectAt"], r["identityAt"])
        self.assertEqual(r["log"], ["[sidecar] player name: Fallback Name (given)"])


class NameRuleTests(unittest.TestCase):
    """`player-name.mjs` `validPlayerName`: what reaches the server as typed."""

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        cases = ["skandia", "  padded  ", "", "   ", 'say "hi"', "tab\there", "café",
                 "Женя", "x" * 40, "[CLAN] Name_1", None, 12]
        script = (
            "const { validPlayerName } = await import(process.argv[1]);"
            "const cases = JSON.parse(process.argv[2]);"
            "console.log(JSON.stringify(cases.map((c) => validPlayerName(c))));"
        )
        proc = subprocess.run(["node", "--input-type=module", "-e", script, NAME_MODULE.as_uri(), json.dumps(cases)],
                              capture_output=True, text=True, check=True, timeout=30)
        cls.out = dict(zip(range(len(cases)), json.loads(proc.stdout)))

    def test_rules(self) -> None:
        o = self.out
        self.assertEqual(o[0], "skandia")
        self.assertEqual(o[1], "padded")
        self.assertIsNone(o[2])
        self.assertIsNone(o[3])
        self.assertIsNone(o[4])            # a quote: the profile file cannot hold it
        self.assertIsNone(o[5])            # a control character
        self.assertEqual(o[6], "café")  # Latin-1 is a single byte on the wire
        self.assertIsNone(o[7])            # beyond Latin-1 there is no byte to send
        self.assertEqual(o[8], "x" * 23)   # GameServer::createPlayer keeps 23
        self.assertEqual(o[9], "[CLAN] Name_1")
        self.assertIsNone(o[10])
        self.assertIsNone(o[11])


if __name__ == "__main__":
    unittest.main()
