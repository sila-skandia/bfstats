"""A human's rounds draw at the serial of the record that fired them (ledger DEV-14).

`FireArms::fireBarrel` 0x0828aba0 draws a round's two deviation uniforms at
`k = (Game::getCurrentInputIndex() + barrel) & 0x3ff` (DEV-9). For a human the
index is the serial of the record the server runs: `processRcvdPlayerActions`
0x08148470 queues each record with `ActionBuffer::pushBack`, which keeps the
received entry's own +0x14 (its serial), and `simulatePlayerUpdate`
0x0815bd00 reads it into Game+0x68. `ActionBuffer::add`, which counts
arrivals, has no caller.

The lab pinned it: `lab/dev_index_probe.mjs` fired a sidecar soldier's BAR
prone (22 taps, a burst of 8) through a merge and an idle spell, with serials
from 5001, and a recorder built to read Game+0x68 at each `fireBarrel` wrote
it beside the round (`tests/fixtures/dev_index_bar_prone.json`, read by
`lab/dev_index_check.py`). `human_deviation_harness.mjs` holds the page's
side: the sidecar's `ai` (input.mjs `actionIndexOf`), the page's prediction
from it (viewer/input-index.js) and the dice that put the round on the point
(viewer/bot-deviation.js `inputDice`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "human_deviation_harness.mjs"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "dev_index_bar_prone.json"
sys.path.insert(0, str(ROOT / "lab"))
import dev_index_check as dic  # noqa: E402


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def lab_offsets(fix: dict) -> list[tuple[dict, tuple[float, float]]]:
    """Each round with its offset on the launch frame's (up, right), hundredths."""
    out = []
    for r in fix["rounds"]:
        ts = [j / 30 for j in range(len(r["track"]))]
        v = [dic.polyfit(ts, [p[ax] for p in r["track"]], 2 if ax == 1 else 1)[1] for ax in range(3)]
        out.append((r, dic.offsets({"d": r["d"], "ra": r["ra"], "rb": r["rb"], "v": v})))
    return out


class LabRoundsTests(unittest.TestCase):
    fix: dict
    rows: list

    @classmethod
    def setUpClass(cls) -> None:
        cls.fix = json.loads(FIXTURE.read_text())
        cls.rows = lab_offsets(cls.fix)

    def test_the_index_is_the_fire_words_serial(self):
        # 30 rounds, every one fired by a word with the fire bit, each at that
        # word's serial; the serials started at 5001 and the server's own
        # index came back in the same thousands, not a count from the join.
        self.assertEqual(len(self.rows), 30)
        self.assertEqual(self.fix["firstSerial"], 5001)
        for r, _ in self.rows:
            self.assertTrue(r["fireWord"]["fire"])
            self.assertEqual(r["gi"], r["fireWord"]["serial"])
            self.assertGreater(r["gi"], 5000)

    def test_every_round_lands_on_its_index_point(self):
        # The BAR has no addFireArmsPosition, so Fire hands fireBarrel barrel
        # -1 and the draw is at index - 1. Taps sit at the prone floor 0.75;
        # the burst's rounds bloom from it (DEV-12: the stored total).
        for r, off in self.rows:
            res, total = dic.fit_k(off, (r["gi"] - 1) & 0x3FF)
            self.assertLess(res, 0.002, r["t"])
            self.assertGreater(total, 0.745)
            self.assertLess(total, 0.83)
        taps = [dic.fit_k(off, (r["gi"] - 1) & 0x3FF)[1] for r, off in self.rows[:22]]
        for t in taps:
            self.assertAlmostEqual(t, 0.75, delta=0.002)

    def test_a_count_of_words_released_does_not_fit(self):
        # The merges and the idle records between the taps move a count away
        # from the serial: a count keeps a constant offset only between two of
        # them, so no one offset puts every round on its point that way,
        # where the serial (offset 0) puts all thirty.
        self.assertGreater(len(self.fix["merges"]), 0)
        self.assertGreater(self.fix["idleRecords"], 0)
        best = 0
        for c in range(1024):
            on = sum(1 for r, off in self.rows
                     if dic.fit_k(off, (r["fireWord"]["released"] - 1 + c) & 0x3FF)[0] < 0.002)
            best = max(best, on)
        self.assertLess(best, len(self.rows) - 5)


class PagePredictionTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_sidecar_reports_the_serial(self):
        self.assertEqual(self.r["actionIndexOf"], [5623, None, None])

    def test_steady_words_are_predicted_exactly(self):
        p = self.r["prediction"]
        for row in p["steady"] + p["reacked"]:
            self.assertEqual(row["predicted"], row["ran"], row)

    def test_a_merged_word_runs_at_its_groups_newest_serial(self):
        # A hitch merges the waiting words: the group runs as one record
        # under its newest serial, so an older word of it is predicted at its
        # own and runs as many serials later as it is words older; every word
        # that kept a record of its own is exact.
        p = self.r["prediction"]
        self.assertTrue(p["merges"])
        merged = [row for row in p["hitch"] if not row["own"]]
        self.assertTrue(merged)
        for row in p["hitch"]:
            self.assertEqual(row["ran"] - row["predicted"], row["carrierTag"] - row["seq"], row)
            if row["own"]:
                self.assertEqual(row["ran"], row["predicted"])

    def test_idle_records_are_counted_from_the_next_ack(self):
        # The page quiet: the sidecar's idle records take serials the page
        # never saw, so until the next ack its prediction is short by them.
        p = self.r["prediction"]
        short = {row["ran"] - row["predicted"] for row in p["afterQuiet"]}
        self.assertEqual(len(short), 1)
        self.assertGreater(short.pop(), 0)
        self.assertGreater(p["idle"], 0)

    def test_a_page_that_stopped_sending_has_no_index(self):
        g = self.r["gap"]
        self.assertIsNotNone(g["at"])
        self.assertIsNone(g["past"])
        self.assertIsNone(g["noAck"])


class DiceTests(unittest.TestCase):
    d: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.d = run_harness()["dice"]

    def test_the_page_table_is_the_labs(self):
        up, right = dic.deviation_point(538)
        self.assertAlmostEqual(self.d["point"][0], up, places=6)
        self.assertAlmostEqual(self.d["point"][1], right, places=6)

    def test_the_round_lands_on_the_point(self):
        # Looking down -z: right is +x, up +y, each u x total / 100.
        up, right = self.d["point"]
        self.assertAlmostEqual(self.d["off538"][0], right * 0.0075, places=7)
        self.assertAlmostEqual(self.d["off538"][1], up * 0.0075, places=7)
        # The bots' own frame puts the same point on the same side.
        self.assertAlmostEqual(self.d["bot538"][0], self.d["off538"][0], places=6)
        self.assertAlmostEqual(self.d["bot538"][1], self.d["off538"][1], places=6)

    def test_a_barrel_less_gun_draws_at_index_less_one(self):
        self.assertEqual(self.d["inputK"], [538, (5659 + 3) & 0x3FF])
        self.assertEqual(self.d["inputOff"], self.d["off538"])
        self.assertIsNone(self.d["none"])


if __name__ == "__main__":
    unittest.main()
