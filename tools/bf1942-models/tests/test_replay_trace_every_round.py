"""A replay's "Trace every round": every round the replay fires drawn with a
streak, rifles included.

The owner's ask (2026-11-01): "players just want to see a round firing with
its tracer in any particular battle". Retail draws no round for a rifle
(ledger GUN-12) and a streak on one round in a gun's tracer interval, which
the replay keeps by default. The switch (the replay's menu) sets
`guns.traceEveryRound`, which `round-launch.js` honours for a replay's guns
only: a round with no tracer of its own gets a 6 m stand-in streak, held to
a visible width on screen (`projectile-flight.js`).

Run under node through `replay_trace_every_round_harness.mjs`, staged as
`test_tracer_scale.py` stages its own.
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

from test_gunfire_layers import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "replay_trace_every_round_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class TraceEveryRoundTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_off_a_rifles_round_is_drawn_as_retail_draws_it_not_at_all(self) -> None:
        self.assertFalse(self.results["off"]["visible"])

    def test_on_a_replays_rifle_round_is_a_short_streak(self) -> None:
        on = self.results["on"]
        self.assertTrue(on["visible"])
        self.assertTrue(on["bright"])
        self.assertTrue(on["forced"])
        self.assertLessEqual(on["length"], 6)

    def test_on_the_streak_is_held_to_a_visible_width(self) -> None:
        self.assertGreater(self.results["on"]["across"], 1)

    def test_a_gun_that_is_not_the_replays_keeps_retails_rule(self) -> None:
        self.assertFalse(self.results["notReplay"]["visible"])
        self.assertFalse(self.results["notReplay"]["forced"])


if __name__ == "__main__":
    unittest.main()
