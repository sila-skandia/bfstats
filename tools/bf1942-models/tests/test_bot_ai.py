"""Stage 1 bot AI input contract (`viewer/world.js` + `viewer/bot.js`).

The plan (`features/bf1942-ai-research-2026-09-21/BOT_AI_IMPLEMENTATION_PLAN.md`
§1, §9) pins the one bug that made bots inert: an absolute-radian write into a
`MouseLookX` channel the world never reads. What this file pins, driven headless
by `bot_ai_harness.mjs` on the same module set `test_world.py` stages:

* a bot's `_aimLook` produces a bounded mouse-count pair the world consumes and
  the soldier actually turns;
* a visible *enemy* human target wins the urgency contest (Fire) and the bot
  turns to face it, while a human on the bot's own side is never sensed and
  never fired on;
* with no target, the nearest uncaptured flag wins (MoveTo) and the bot walks
  toward it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "bot_ai_harness.mjs"

# world.js's dependency closure (test_world.py owns the canonical list) plus
# bot.js's own imports. Every dependency keeps its own name so the unmodified
# imports resolve; the world is copied as `world.mjs` for the harness.
_MODULE_NAMES = [
    "physics", "parachute", "swim", "soldier", "spawn-safety", "mouse-input",
    "fall-damage",
    "body-world", "body-statics", "vehicle-bodies", "combat-area", "supply", "armor",
    "vehicle-damage", "seats", "seat-dots", "rigid-body", "body-contact",
    "body-ground", "body-friction", "crash-damage", "effects-core",
    "bomb-release", "torpedo-run",
    # bot.js's own imports.
    "deviation", "nav-grid",
]
MODULES = {f"{name}.js": VIEWER / f"{name}.js" for name in _MODULE_NAMES}
MODULES["world.mjs"] = VIEWER / "world.js"
MODULES["bot.js"] = VIEWER / "bot.js"
MODULES["node_modules/three/three.module.js"] = VIEWER / "vendor" / "three.module.js"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


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
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BotAiTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the look/input contract --------------------------------------------

    def test_aim_writes_bounded_mouse_counts_not_radians(self) -> None:
        look = self.results["look"]
        self.assertLessEqual(abs(look["lookX"]), 16)
        self.assertLessEqual(abs(look["lookY"]), 16)
        # 90 degrees of yaw at a 3x gain is 30 counts, clamped to 16.
        self.assertAlmostEqual(look["lookX"], -16)

    def test_the_world_applies_the_bot_look(self) -> None:
        self.assertTrue(self.results["look"]["turned"])

    # --- Fire: a visible target wins the contest ----------------------------

    def test_a_visible_human_is_sensed_and_fired_on(self) -> None:
        self.assertTrue(self.results["aim"]["sawTarget"])

    def test_the_bot_turns_toward_the_target(self) -> None:
        aim = self.results["aim"]
        self.assertGreater(aim["initialError"], 0.1)
        self.assertLess(aim["finalError"], 0.1)
        self.assertTrue(aim["turned"])

    # --- Friendly fire: a teammate is never a target ------------------------

    def test_a_teammate_is_never_sensed(self) -> None:
        self.assertIsNone(self.results["friendly"]["sensed"])

    def test_a_teammate_is_never_fired_on(self) -> None:
        friendly = self.results["friendly"]
        self.assertFalse(friendly["sawTarget"])
        self.assertFalse(friendly["fired"])

    # --- Avoid: a static dead ahead fans the heading ------------------------

    def test_a_blocked_heading_is_not_clear(self) -> None:
        self.assertFalse(self.results["avoid"]["clearAhead"])

    def test_the_bot_steers_to_a_clear_side(self) -> None:
        self.assertTrue(self.results["avoid"]["steered"])

    # --- MoveTo: no target, walk to the flag --------------------------------

    def test_the_winner_is_moveto_with_no_target(self) -> None:
        self.assertEqual(self.results["moveTo"]["behaviour"], "MoveTo")

    def test_the_bot_walks_toward_the_objective(self) -> None:
        move = self.results["moveTo"]
        self.assertGreater(move["movedForward"], 30)
        self.assertGreater(move["travelled"], 1.0)


if __name__ == "__main__":
    unittest.main()