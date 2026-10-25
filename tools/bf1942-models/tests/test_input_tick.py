"""Every server tick runs the page's word for that tick (2026-10-25).

`input_tick_harness.mjs` drives the page's clock law (map.html's 0.1 s frame
clamp, `feedFrame` and the pacer of `viewer/input-pace.js` on
`viewer/fixed-step.js`) and the sidecar's real `InputSender`
(`sidecar/input.mjs`: its pacing, merge, 30 Hz pump and `atAck`) on a
synthetic clock, against a server that reads at the start of its 1/30 s frame,
keeps four (D-2), runs one a tick (D-3) and acks at 20 Hz.

The fault it holds (features/udp-sidecar/browser.md, "The jump, tick for
tick"; wire.md section 45): on the live page server ticks ran no page word,
45 in 15 s at 45 fps and 83 in 19 s at 9 fps, and each one moved the server's
soldier a tick from the page's. Three causes: a page under 10 fps lost the
rest of every clamped frame (27 words a second for 30); the margin covered
only the last 0.6 s of frames; and the sidecar's bucket, refilling one a tick
at its own phase, held words past the server's read.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "input_tick_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(ROOT / "viewer" / "input-pace.js", work / "input-pace.mjs")
        shutil.copyfile(ROOT / "viewer" / "fixed-step.js", work / "fixed-step.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(ROOT / "sidecar" / "input.mjs")],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class InputTickTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_one_word_a_tick_at_every_frame_rate(self):
        # From 144 fps down to 9, where a frame makes three or four words:
        # past the join every server tick runs exactly the next page word,
        # none merged, none trimmed, none of the sidecar's idle records.
        for name in ("fps144", "fps60", "fps45", "fps30", "fps20", "fps12", "fps9"):
            s = self.r[name]
            with self.subTest(name):
                self.assertGreater(s["ticks"], 1000)
                self.assertEqual(s["starved"], 0)
                self.assertEqual(s["words"], s["ticks"])
                self.assertEqual(s["outOfTurn"], 0)
                self.assertEqual(s["mergedWords"], 0)
                self.assertEqual(s["trimmed"], 0)
                self.assertEqual(s["idleRun"], 0)

    def test_a_page_with_long_frames_starves_only_past_its_cover(self):
        # 45 fps with a 60-180 ms frame 1.5 times a second (a headless
        # renderer's): the margin covers all but the two longest frames of
        # the last 6 s, so a tick in a few hundred starves, and the sidecar
        # merges nothing (the bucket and a merge above three starved 34 and
        # merged 78 words here).
        s = self.r["gappy"]
        self.assertLess(s["starved"], 0.01 * s["ticks"])
        self.assertEqual(s["mergedWords"], 0)
        self.assertEqual(s["outOfTurn"], 0)
        self.assertEqual(s["trimmed"], 0)

    def test_without_the_feed_a_slow_page_starves_the_server(self):
        # The clamp's cut time not carried: about one tick in ten.
        s = self.r["fps9NoFeed"]
        self.assertGreater(s["starved"], 0.05 * s["ticks"])

    def test_the_steady_page_keeps_the_floor(self):
        # No backlog bought for it: a word waits about a frame and the
        # margin's few ms at 144 and 60 fps (c2914afa's 22 ms at 60).
        self.assertLess(self.r["fps144"]["waitMedian"], 16)
        self.assertLess(self.r["fps60"]["waitMedian"], 25)

    def test_an_internet_server_runs_one_word_a_tick(self):
        # 25 to 175 ms each way. The server pacing once counted the words in
        # flight as held, so past ~100 ms one way it sent ~23 a second: at
        # 115 (MoonGamers, 228 ms ping, live 2026-10-25) a quarter of the
        # server's ticks starved and twelve-word backlogs were merged every
        # 1.7 s, each a snap back of the player's run. Each word now waits
        # the trip and the floor, no more.
        for owd in (25, 60, 115, 175):
            s = self.r[f"owd{owd}"]
            with self.subTest(owd=owd):
                self.assertEqual(s["starved"], 0)
                self.assertEqual(s["words"], s["ticks"])
                self.assertEqual(s["mergedWords"], 0)
                self.assertEqual(s["trimmed"], 0)
                self.assertEqual(s["outOfTurn"], 0)
                self.assertLess(s["waitMedian"], owd + 30)

    def test_a_stall_starves_only_its_own_ticks(self):
        # A 300 ms stall every 4 s: the server runs those ticks without the
        # page whatever the law (about nine a stall, past the margin), and
        # nothing else starves.
        s = self.r["stalls"]
        self.assertLessEqual(s["starved"] + s["idleRun"], 9 * 9)
        self.assertEqual(s["mergedWords"], 0)
        self.assertEqual(s["trimmed"], 0)


if __name__ == "__main__":
    unittest.main()
