"""The no-live-strategy fallback (features/bot-map-generation/no-live-strategy.md).

On a generated layer (`ai.generated`) a side none of whose strategies scores
above 0, whose kept strategy finds nothing to attack, holds no order and its
bots walk to the nearest flag they do not hold, as on a level with no layer;
at the first pass where a strategy scores or a target appears the SAI orders
them again. A side with no live strategy that still has a target keeps the
SAI, and a layer without the marker keeps the engine's rule
(`SAI::chooseStrategy` keeps the strategy it has). INVENTION, labelled in
`viewer/strategic-ai.js` `_noLiveStrategyFallback` and in
`features/bf1942-ai-spec/KNOBS.md`. Also the lint's warning
(`sim/botlint.mjs liveStrategiesAtStart`). `tests/bot_no_live_strategy_harness.mjs`
runs the node half.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_no_live_strategy_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr[-2000:])
    return json.loads(proc.stdout)


class NoLiveStrategyTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_no_live_strategy_and_nothing_to_attack_takes_the_no_layer_order(self) -> None:
        for side in ("1", "2"):
            p = self.out["standIns"]["before"][side]
            self.assertFalse(p["live"])
            self.assertTrue(p["fallback"])
            self.assertEqual(p["orders"], [None] * 4)
            self.assertEqual(p["noLayer"], [True] * 4)
            # The garrison's gun rule is off too: a level with no layer has none.
            self.assertEqual(p["guns"], [None] * 4)
            self.assertEqual(p["attacks"], [])

    def test_the_sai_takes_the_side_back_once_a_target_appears(self) -> None:
        axis = self.out["standIns"]["after"]["1"]
        self.assertFalse(axis["fallback"])
        self.assertTrue(all(axis["orders"]))
        self.assertEqual(axis["noLayer"], [False] * 4)
        self.assertTrue(self.out["standIns"]["after"]["2"]["fallback"])

    def test_no_live_strategy_with_a_target_keeps_the_sai(self) -> None:
        # The Maze's case: nothing scores, the kept strategy still attacks.
        for side, target in (("1", "East"), ("2", "West")):
            p = self.out["targets"]["before"][side]
            self.assertFalse(p["live"])
            self.assertFalse(p["fallback"])
            self.assertEqual(p["attacks"], [target])
            self.assertTrue(all(p["orders"]))
            self.assertEqual(p["noLayer"], [False] * 4)

    def test_a_shipped_layer_keeps_the_engine_rule(self) -> None:
        for phase in ("before", "after"):
            for side in ("1", "2"):
                p = self.out["shippedStandIns"][phase][side]
                self.assertFalse(p["fallback"])
                self.assertEqual(p["noLayer"], [False] * 4)
                self.assertTrue(all(p["orders"]))
                self.assertEqual(p["active"], "single")

    def test_the_bot_takes_the_no_layer_order_only_when_told(self) -> None:
        self.assertIsNone(self.out["waypointWithLayer"])
        self.assertEqual(self.out["waypointNoLayerOrder"], "East")

    def test_the_lint_warns_per_side_and_never_errs(self) -> None:
        self.assertFalse(self.out["lintStart"]["1"]["live"])
        self.assertEqual(self.out["lintStart"]["1"]["attackTargets"], [])
        self.assertEqual(self.out["lintErrors"], 0)
        self.assertEqual(len(self.out["lintWarnings"]), 2)
        self.assertIn("side 1 has no live strategy at the start", self.out["lintWarnings"][0])
        self.assertIn("finds nothing to attack", self.out["lintWarnings"][0])
        self.assertIn("no-layer order", self.out["lintWarnings"][0])
        # With a target the warning says what the kept strategy attacks.
        self.assertIn("which attacks East", self.out["lintTargetWarnings"][0])
        # East taken by the Axis at the start: only the Allies are named.
        self.assertEqual(len(self.out["lintLiveWarnings"]), 1)
        self.assertIn("side 2", self.out["lintLiveWarnings"][0])


if __name__ == "__main__":
    unittest.main()
