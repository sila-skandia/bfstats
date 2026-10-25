"""Which of his rows a standing soldier's move runs along while he turns.

`BFSoldier::handlePlayerInput` copies his forward row at its top
(`0x08273d26`), turns him by the word's look (`0x082745e5`), and reads his
right row after (`0x082748eb`): the run goes along the facing from before the
look, the strafe along the turned one (ledger PHY-38). `strafe_turn_harness.mjs`
replays `lab/strafe_turn_probe.mjs`'s lab run (vanilla Wake, 2026-10-25)
through `Soldier.step`, the position put back at each ack, with both rows
after the look (`post`), both before (`pre`) and the engine's split, and the
split is the only one that holds every turning phase to the millimetre.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_move_law import MODULES, VIEWER  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "strafe_turn_harness.mjs"
STEM = "strafe_turn_wake"
TURNING = ["run-turn", "strafeR-turn", "strafeL-turn", "diag-turn", "back-turn", "strafeL-turnR"]


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
            ["node", str(work / "harness.mjs"), str(FIXTURES / f"{STEM}.ndjson.gz"),
             str(FIXTURES / f"{STEM}_terrain.json.gz")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)["T"]


class StrafeTurnTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_split_rows_track_the_server_while_turning(self) -> None:
        for key in TURNING:
            n, median, _ = self.results["split"][key]["h"]
            with self.subTest(phase=key):
                self.assertGreaterEqual(n, 20)
                self.assertLessEqual(median, 1.5)

    def test_both_rows_from_either_side_of_the_look_miss(self) -> None:
        # Both before the look: every strafe that turns is 40 mm and more off.
        for key in ["strafeR-turn", "strafeL-turn", "strafeL-turnR"]:
            with self.subTest(order="pre", phase=key):
                self.assertGreater(self.results["pre"][key]["h"][1], 20.0)
        # Both after it: the run that turns is.
        for key in ["run-turn", "diag-turn", "back-turn"]:
            with self.subTest(order="post", phase=key):
                self.assertGreater(self.results["post"][key]["h"][1], 20.0)


if __name__ == "__main__":
    unittest.main()
