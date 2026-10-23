"""The page's world clock against a real server's tick (`viewer/input-pace.js`).

The page makes one input word per world tick on its own clock and the server
runs one per tick on its own (ledger D-3), so a backlog a word meets stands
for good: on the lab a word waited 74 ms at the median from the sidecar to
the tick that ran it, with 1-3 words standing, where 0-1 is the floor
(features/udp-sidecar/wire.md section 39, the 2026-10-24 note). The pacer
scales the page's clock a few percent from the shortest wait the acks
report; a hitch's catch-up ticks are dropped (world.js `hitchCatchUp`).

`input_pace_harness.mjs` runs the pacer in a model of the whole path: the
page's jittering frames and 1/30 s clock, the sidecar's bucket, and a server
that reads at its frame start, runs one word a tick and trims above four
(D-1..D-4), acking at 20 Hz.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "input_pace_harness.mjs"
MODULE = ROOT / "viewer" / "input-pace.js"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "input-pace.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class InputPaceTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_without_steering_a_standing_backlog_never_drains(self):
        # The fault: three words standing at the join, the page and the
        # server both at one a tick, and nothing shrinks it.
        legacy = self.r["legacyStanding"]
        self.assertGreaterEqual(legacy["backlogLastSecondMean"], 1.5)
        self.assertGreater(legacy["waitMedian"], 60)

    def test_steering_drains_it_and_holds_the_floor(self):
        for name in ("steady", "joinStanding"):
            s = self.r[name]
            self.assertLess(s["backlogMean"], 0.2, name)
            self.assertLess(s["waitMedian"], 25, name)
            self.assertLess(s["starvedPct"], 0.5, name)

    def test_the_rate_stays_within_a_few_percent(self):
        lim = self.r["limits"]
        for name in ("steady", "joinStanding", "stalls", "jittery"):
            s = self.r[name]
            self.assertGreaterEqual(s["minScale"], 1 - lim["maxSlow"] - 1e-9, name)
            self.assertLessEqual(s["maxScale"], 1 + lim["maxFast"] + 1e-9, name)

    def test_after_a_stall_the_backlog_returns_within_a_second(self):
        s = self.r["stalls"]
        self.assertEqual(len(s["recover"]), 14)
        self.assertTrue(all(x is not None and x < 1000 for x in s["recover"]), s["recover"])
        self.assertLess(s["starvedOutsidePct"], 0.5)
        # Without the hitch drop the catch-up words queue and drain slowly.
        nodrop = self.r["stallsNoDrop"]
        self.assertGreater(sorted(nodrop["recover"])[len(nodrop["recover"]) // 2], 500)

    def test_a_jittery_page_keeps_a_margin(self):
        # 30 fps with 25 ms of jitter: the target grows on starved ticks, so
        # starvation stays rare at a backlog under a word.
        s = self.r["jittery"]
        self.assertLess(s["starvedOutsidePct"], 1.0)
        self.assertLess(s["backlogMean"], 1.0)
        self.assertGreater(s["pace"]["target"], self.r["limits"]["target"])

    def test_the_unit_edges(self):
        u = self.r["unit"]
        self.assertEqual(u["noRows"], 1)
        self.assertLess(u["slow"], 1)
        self.assertGreater(u["fast"], 1)
        self.assertEqual(u["stale"], 1)
        self.assertEqual(u["bumped"]["bumped"], 1)
        self.assertEqual(u["notBumped"]["bumped"], 0)


class InputPathCheckTests(unittest.TestCase):
    """`lab/input_path_check.py` reads the sidecar's `k:"iq"` rows."""

    def test_it_sums_a_run(self):
        import sys
        sys.path.insert(0, str(ROOT / "lab"))
        import input_path_check as chk
        rows = [
            {"k": "iq", "t": 1.0, "tick": 100, "serial": 10, "iq": 0, "sq": 1, "st": 0, "ld": 40.0, "hd": 0},
            {"k": "iq", "t": 1.05, "tick": 102, "serial": 11, "iq": 1, "sq": 0, "st": 1, "ld": 20.0, "hd": 5},
            {"k": "iq", "t": 1.1, "tick": 103, "serial": 12, "iq": 0, "sq": 0, "st": 0},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "run.ndjson"
            path.write_text("\n".join([json.dumps({"k": "s", "t": 1}), *(json.dumps(r, separators=(",", ":")) for r in rows)]) + "\n")
            got = chk.summarise(chk.rows_of(str(path)))
        self.assertEqual(got["acks"], 3)
        self.assertEqual(got["ticks"], 3)
        self.assertEqual(got["starved"], 1)
        self.assertEqual(dict(got["backlog"]), {1: 2, 0: 1})
        self.assertEqual(got["lead"], [40.0, 20.0])


if __name__ == "__main__":
    unittest.main()
