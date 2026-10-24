"""The page's soldier through his stance changes against the BF1942 dedicated server's.

`stance_law_harness.mjs` replays `lab/move_law_probe.mjs`'s words (vanilla El
Alamein co-op, flat sand at the Allied base, 2026-10-25) through the page's
own `Soldier.step`: a run into the prone dive with forward held through it
and on into the crawl, lying still, standing up, a run with a jump, and a
standing jump. Per acknowledged tick the page's feet against the server's,
the server's position put back at each ack (`acked`) and never (`free`).

The dive is ledger PHY-36: `Lb_RunStandToLie` lasts one pass of its clip at
`set3pAnimationSpeed 1.40`, 0.714 s (ANIM-2), and its 6.0 scales the command
and its cap on the same tick. The page's dive used to end at 0.282 s, 14 ticks
before the server's, 0.34 m an ack behind.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_move_law import MODULES, VIEWER  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "stance_law_harness.mjs"
PHASES = ["idle", "run, lie", "crawl", "prone", "stand up", "run", "running jump", "stop",
          "standing jump", "idle2"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs"), str(FIXTURES / "stance_law_alamein.ndjson.gz"),
             str(FIXTURES / "stance_law_alamein_terrain.json.gz")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class StanceLawTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_every_phase_tracks_the_server_an_ack(self) -> None:
        for key in PHASES:
            r = self.results["acked"][key]
            with self.subTest(phase=key):
                self.assertGreater(r["horizontal"]["n"], 4)
                self.assertLessEqual(r["horizontal"]["median"], 1.0, r["horizontal"])
                self.assertLessEqual(r["horizontal"]["max"], 2.0, r["horizontal"])
                self.assertLessEqual(r["vertical"]["max"], 2.0, r["vertical"])

    def test_the_dive_keeps_the_run_as_long_as_the_server_does(self) -> None:
        # The crawl phase holds the dive's last 15 ticks and its end: its
        # speed matches the server's to a few mm/s on every ack.
        r = self.results["acked"]["crawl"]["speed"]
        self.assertLessEqual(r["max"], 10.0, r)

    def test_uncorrected_the_whole_plan_stays_within_a_few_millimetres(self) -> None:
        for key in PHASES:
            r = self.results["free"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["horizontal"]["max"], 4.0, r["horizontal"])
                self.assertLessEqual(r["vertical"]["max"], 2.0, r["vertical"])


if __name__ == "__main__":
    unittest.main()
