"""The page reads the item the server has in its own soldier's hands.

A number key the page refuses and a real server takes leaves the two holding
different items: live on Liberation of Caen (2026-11-19, a 235 ms server) the
player pressed 4 for his grenades in the round trip after leaving a
Kubelwagen, while the page still had him seated. The server, which already
had him on foot, raised them; the page kept the Panzerschreck, and the
server threw two grenades the page never drew, the second at his own feet.
`net-relay.js` `selfItem` is the server's word the page keeps its hand to
(`net-room.js` `keepItemWithServer`, as `keepZoomWithServer` keeps the zoom).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.test_relay_join import VIEWER, _closure

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "relay_self_item_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("net-relay.js"):
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr[-4000:]}")
    return json.loads(proc.stdout)


class RelaySelfItemTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_unknown_until_an_ack_names_the_soldier(self):
        self.assertIsNone(self.r["before"])
        self.assertIsNone(self.r["noAck"])

    def test_the_server_item_follows_its_stance_rows(self):
        self.assertEqual(self.r["panzerschreck"], 3)
        self.assertEqual(self.r["grenades"], 4)
        self.assertEqual(self.r["otherSoldier"], 4)

    def test_a_dead_soldier_holds_nothing(self):
        self.assertIsNone(self.r["dead"])


if __name__ == "__main__":
    unittest.main()
