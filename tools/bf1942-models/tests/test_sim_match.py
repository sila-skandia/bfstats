"""The headless match runner (`sim/run.mjs`) on the synthetic harness level.

A short seeded match must produce the trace (a header, per-tick bot lines
with the urgency vector, events, samples, a closing summary) and the summary
metrics, and must reproduce byte for byte for the same seed. The replay
timeline and the decision inspector read that trace back.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "sim" / "run.mjs"
SECONDS = 20


def node(*args: str) -> str:
    proc = subprocess.run(["node", str(RUN), *args], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"sim/run.mjs {' '.join(args)} failed:\n{proc.stderr}")
    return proc.stdout


def run_match(out: Path, seed: int) -> tuple[list[dict], dict]:
    node("--synthetic", "--bots", "2", "--time", str(SECONDS), "--seed", str(seed), "--out", str(out), "--quiet")
    lines = [json.loads(line) for line in (out / "trace.jsonl").read_text().splitlines() if line]
    summary = json.loads((out / "summary.json").read_text())
    return lines, summary


class SimMatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.dir_a, cls.dir_b, cls.dir_c = base / "a", base / "b", base / "c"
        cls.lines, cls.summary = run_match(cls.dir_a, 11)
        cls.lines_b, cls.summary_b = run_match(cls.dir_b, 11)
        cls.lines_c, cls.summary_c = run_match(cls.dir_c, 12)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def test_the_trace_opens_with_the_match_header(self) -> None:
        head = self.lines[0]
        self.assertEqual(head["k"], "match")
        self.assertEqual(head["level"], "synthetic")
        self.assertEqual(head["seed"], 11)
        self.assertEqual(len(head["bots"]), 4)
        self.assertEqual(head["behaviours"][:4], ["Avoid", "MoveTo", "Idle", "Fire"])
        self.assertEqual(head["tickHz"], 30)
        self.assertEqual(self.lines[-1]["k"], "summary")

    def test_every_tick_line_carries_the_decision_state(self) -> None:
        every = [r for r in self.lines if r["k"] == "tick"]
        # Four bots, every one of 30 ticks a second; a dead bot's line is short.
        self.assertEqual(len(every), 4 * 30 * SECONDS)
        ticks = [r for r in every if r["alive"]]
        self.assertGreater(len(ticks), len(every) / 2)
        width = len(self.lines[0]["behaviours"])
        for r in ticks[:200]:
            for key in ("t", "bot", "side", "pos", "area", "beh", "u", "act", "mod", "plan", "target", "veh", "terms"):
                self.assertIn(key, r)
            self.assertEqual(len(r["u"]), width)
            self.assertEqual(len(r["pos"]), 3)
        self.assertTrue(any(r["beh"] == "MoveTo" and "moveTo" in r["terms"] for r in ticks))
        self.assertTrue(any(r["area"] for r in ticks), "the strategic AI gives orders on the synthetic level")

    def test_samples_and_events_are_written(self) -> None:
        samples = [r for r in self.lines if r["k"] == "sample"]
        self.assertGreaterEqual(len(samples), SECONDS)
        self.assertIn("tickets", samples[0])
        self.assertIn("flags", samples[0])
        types = {r["type"] for r in self.lines if r["k"] == "ev"}
        self.assertTrue(types, "some event happens in 20 s")
        self.assertTrue(types <= {"capture", "kill", "mount", "dismount", "route_failed", "respawn", "redeploy",
                                  "strategy", "vehicle_destroyed", "vehicle_respawn", "bot_error"}, types)

    def test_the_summary_carries_the_metrics(self) -> None:
        m = self.summary["metrics"]
        for key in ("ticketsOverTime", "flagsHeldOverTime", "timeToFirstCapture", "deathsPerCapture", "kills",
                    "deaths", "captures", "vehicleUtilisation", "routeFailures", "behaviourShare"):
            self.assertIn(key, m)
        self.assertGreater(len(m["ticketsOverTime"]), 2)
        self.assertEqual(m["ticketsOverTime"][0], [0, 100, 100])
        self.assertEqual(self.summary["duration"], SECONDS)
        self.assertEqual(self.summary["result"]["reason"], "time")
        self.assertEqual(m["vehicleUtilisation"]["vehicles"], 4)

    def test_the_same_seed_reproduces_the_match(self) -> None:
        a = (self.dir_a / "trace.jsonl").read_bytes()
        b = (self.dir_b / "trace.jsonl").read_bytes()
        self.assertEqual(a, b)
        self.assertEqual(self.summary["trace"]["sha256"], self.summary_b["trace"]["sha256"])
        self.assertEqual(self.summary["metrics"], self.summary_b["metrics"])

    def test_another_seed_plays_another_match(self) -> None:
        self.assertNotEqual(self.summary["trace"]["sha256"], self.summary_c["trace"]["sha256"])

    def test_the_replay_timeline_reads_the_trace(self) -> None:
        text = node("--replay-summary", str(self.dir_a / "trace.jsonl"), "--step", "10")
        self.assertIn("match synthetic  seed 11", text)
        self.assertIn("state    tickets", text)
        self.assertIn("behaviour share", text)

    def test_the_inspector_explains_one_decision(self) -> None:
        text = node("--why", "bot_0", "10", "--trace", str(self.dir_a / "trace.jsonl"))
        self.assertIn("bot_0 (", text)
        self.assertIn("winner:", text)
        for name in ("Avoid", "MoveTo", "Idle", "Fire", "Scout", "TakeCover", "Change"):
            self.assertIn(name, text)
        self.assertIn("mod(", text)


class SimDoctrineTests(unittest.TestCase):
    """`--doctrine` (viewer/doctrine.js): a baseline trace names no doctrine,
    and a squad run on both sides plays without a bot error and orders its
    followers with the play's kinds."""

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        common = ("--synthetic", "--bots", "4", "--time", "60", "--seed", "1", "--quiet")
        node(*common, "--out", str(base / "sai"))
        node(*common, "--out", str(base / "squad"), "--doctrine", "squad")
        read = lambda d: [json.loads(line) for line in (base / d / "trace.jsonl").read_text().splitlines() if line]
        cls.sai, cls.squad = read("sai"), read("squad")
        cls.sai_summary = json.loads((base / "sai" / "summary.json").read_text())
        cls.summary = json.loads((base / "squad" / "summary.json").read_text())

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def test_a_baseline_trace_names_no_doctrine(self) -> None:
        self.assertNotIn("doctrine", self.sai[0])
        orders = [r["order"] for r in self.sai if r["k"] == "tick" and r.get("alive") and r.get("order")]
        self.assertTrue(orders)
        self.assertTrue(all("kind" not in o for o in orders))
        self.assertNotIn("doctrine", self.sai[-1])
        self.assertEqual(self.sai_summary["doctrine"]["sides"], {"1": "sai", "2": "sai"})

    def test_the_squad_play_runs_without_a_bot_error(self) -> None:
        self.assertEqual(self.squad[0]["doctrine"], {"1": "squad", "2": "squad"})
        self.assertEqual(self.summary["metrics"]["botErrors"], 0)
        kinds = {r["order"].get("kind") for r in self.squad if r["k"] == "tick" and r.get("alive") and r.get("order")}
        self.assertIn("WPMoveTo", kinds)
        self.assertIn("WPFollow", kinds)
        stats = self.summary["doctrine"]["stats"]
        self.assertEqual(stats["1"]["squads"], 1)
        self.assertEqual(stats["2"]["squads"], 1)


if __name__ == "__main__":
    unittest.main()
