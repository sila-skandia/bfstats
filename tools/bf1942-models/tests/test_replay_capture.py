"""A replay's capture rings from the server's own timers (`viewer/replay-
capture.js`).

The server recorder writes a control point's capture law as the server runs
it, `cpt` records: the state (ControlPoint+0x17c), the getting team
(+0x170), the get and lose timers (+0x16c, +0x168) and, on a file's first
row of a point, the template's full times (+0x1f4, +0x1f8), ledger AI-100.
No client is sent any of it (NET-16), so a client's file has none and its
rings stay the estimate (`capture-rings.js`, features/capture-progress-
rings). The ring itself is the page's own addition: retail rings no control
point (HUD-15, OBJ-7). Harness: `tests/replay_capture_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "replay_capture_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class ReplayCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_server_file_carries_the_timers_on_its_points(self) -> None:
        self.assertTrue(self.r["cpTimers"])
        self.assertEqual(self.r["rows"], 45)
        self.assertEqual(self.r["full"], [10, 10])
        # A row for a point the file never named is left out.
        self.assertEqual(self.r["skipped"], 1)

    def test_a_client_file_has_none(self) -> None:
        self.assertIsNone(self.r["clientTimers"])
        self.assertIsNone(self.r["clientPointTimers"])

    def test_a_running_timer_is_carried_between_rows(self) -> None:
        self.assertEqual(self.r["between"], {"t": 20.125, "state": 2, "by": 0, "get": 10, "lose": 9.875})

    def test_the_rings_by_the_servers_state(self) -> None:
        rings = self.r["rings"]
        # Held (state 4): no ring.
        self.assertIsNone(rings["0"])
        self.assertIsNone(rings["10"])
        # Run down (state 2): drains in the holder's colour.
        self.assertEqual(rings["20"], {"kind": "losing", "team": 2, "fraction": 1})
        self.assertEqual(rings["25.1"], {"kind": "losing", "team": 2, "fraction": 0.49})
        self.assertEqual(rings["29.99"], {"kind": "losing", "team": 2, "fraction": 0.025})
        # Lost (state 1, neutral): none.
        self.assertIsNone(rings["30"])
        self.assertIsNone(rings["30.5"])
        # Being taken by 1 (state 3): fills in the taker's colour.
        self.assertEqual(rings["31.5"], {"kind": "getting", "team": 1, "fraction": 0.053})
        self.assertEqual(rings["32.5"], {"kind": "getting", "team": 1, "fraction": 0.103})
        # The taker left (no getting team, timers full): none.
        self.assertIsNone(rings["33"])
        self.assertIsNone(rings["40"])

    def test_the_level_gives_the_full_time_a_file_did_not(self) -> None:
        self.assertEqual(self.r["noFullTimes"], {"kind": "getting", "team": 1, "fraction": 0.527})

    def test_the_page_reads_the_timers_and_falls_back_to_the_estimate(self) -> None:
        t = self.r["pageTimers"]
        self.assertEqual(t["source"], "timers")
        self.assertEqual(t["ring"]["kind"], "getting")
        self.assertEqual(t["ring"]["sprite"], "objective000")
        self.assertIsNone(t["other"])
        self.assertEqual(t["key"], "ALLIES_village:1:objective000;")
        e = self.r["pageEstimate"]
        self.assertEqual(e["source"], "replay")
        self.assertIsNone(e["ring"])


if __name__ == "__main__":
    unittest.main()
