"""The page's world clock against a real server's tick (`viewer/input-pace.js`).

The page makes one input word per world tick on its own clock and the server
runs one per tick on its own (ledger D-3), so a backlog a word meets stands
for good: on the lab a word waited 74 ms at the median from the sidecar to
the tick that ran it, with 1-3 words standing, where 0-1 is the floor
(features/udp-sidecar/wire.md section 39, the 2026-10-24 note). The pacer
scales the page's clock a few percent from the shortest wait the acks
report, each counted as if its word had been made on time, against a margin
of the target plus the page's longest recent frame; the world's feed
(`feedFrame`, world.js `inputFeed`) carries the time map.html's 0.1 s clamp
cut off a slow page's frame and cuts a stall to what the margin covers
(wire.md section 45, 2026-10-25).

`input_pace_harness.mjs` runs the pacer in a model of the whole path: the
page's jittering frames and 1/30 s clock, the sidecar's bucket, and a server
that reads at its frame start, runs one word a tick and trims above four
(D-1..D-4), acking at 20 Hz. `test_input_tick.py` runs the same page law
against the sidecar's real `InputSender`.
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
        # Without the feed's cut the catch-up words queue and drain slowly.
        nodrop = self.r["stallsNoDrop"]
        never = [float("inf") if x is None else x for x in nodrop["recover"]]
        self.assertGreater(sorted(never)[len(never) // 2], 500)

    def test_a_jittery_page_keeps_a_margin(self):
        # 30 fps with 25 ms of jitter: the margin holds the longest frame,
        # so starvation stays away at a backlog under a word.
        s = self.r["jittery"]
        self.assertLess(s["starvedSettledPct"], 0.3)
        self.assertLess(s["backlogMean"], 1.0)
        self.assertGreater(s["pace"]["margin"], 1000 / 30 + 25 - 5)

    def test_every_tick_runs_a_word_from_144_fps_down_to_9(self):
        # The fault (2026-10-25, browser.md "The jump, tick for tick"): a
        # headless page at 9 fps starved the server of 83 ticks in 19 s and at
        # 45 fps with long frames 45 in 15. Past the join, at every rate,
        # none now, with the page making one word a server tick.
        for fps in (144, 60, 45, 30, 20, 9):
            s = self.r[f"fps{fps}"]
            self.assertEqual(s["starvedSettledPct"], 0, fps)
            self.assertEqual(s["trims"], 0, fps)
            self.assertAlmostEqual(s["wordsPerTick"], 1, delta=0.01, msg=fps)
        # Under 10 fps the clamp cut every frame: 27 words a second for 30.
        self.assertLess(self.r["fps9NoFeed"]["wordsPerTick"], 0.92)
        self.assertGreater(self.r["fps9NoFeed"]["starvedSettledPct"], 5)

    def test_a_page_with_long_frames_learns_them(self):
        # 45 fps with a 60-180 ms frame 1.5 times a second (the headless
        # renderer's): the margin grows to hold all but the two longest of
        # the last 6 s, so only a frame longer than those starves the server.
        g = self.r["gappy"]
        self.assertLess(g["starvedSettledPct"], 0.6)
        self.assertGreater(g["pace"]["margin"], 120)
        self.assertLess(g["starvedSettledPct"], self.r["gappyNoFeed"]["starvedSettledPct"] + 0.3)

    def test_a_steady_page_pays_no_backlog_for_it(self):
        # c2914afa's floor stands: at 60 and 144 fps a word waits about a
        # frame and a margin, and nothing stands.
        for name, wait in (("fps144", 16), ("fps60", 25)):
            s = self.r[name]
            self.assertLess(s["waitMedian"], wait, name)
            self.assertLess(s["backlogMean"], 0.2, name)

    def test_the_unit_edges(self):
        u = self.r["unit"]
        self.assertEqual(u["noRows"], 1)
        self.assertLess(u["slow"], 1)
        self.assertGreater(u["fast"], 1)
        self.assertEqual(u["stale"], 1)
        self.assertEqual(u["bumped"]["bumped"], 1)
        self.assertEqual(u["notBumped"]["bumped"], 0)
        self.assertEqual(u["lateWait"], 50)
        self.assertIsNone(u["feedBefore"])
        self.assertAlmostEqual(u["feedFast"]["hitch"], 0.1)
        self.assertAlmostEqual(u["feedFast"]["cover"], 1 / 30)
        self.assertAlmostEqual(u["feedFast"]["debt"], 0)
        self.assertAlmostEqual(u["feedSlow"]["debt"], 0.011)
        self.assertAlmostEqual(u["feedSlow"]["hitch"], 0.333)
        f = u["frames"]
        self.assertEqual(f["none"], {"fed": 0.016, "hitch": False})
        self.assertAlmostEqual(f["debt"]["fed"], 0.111)
        self.assertFalse(f["debt"]["hitch"])
        self.assertEqual(f["stall"], {"fed": 0.034, "hitch": True})
        self.assertEqual(f["zero"], {"fed": 0, "hitch": False})


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
