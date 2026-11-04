"""The Short loader's first scene (viewer/play/loaders/brass.js,
features/replay-shorts, "The loader"): the prone rifleman whose spent cases
stack into a pyramid while a Short is on its way.

The pile is the part with arithmetic in it: every case has its own place,
none overlaps another, each row sits on the one below and is one shorter, and
the whole pyramid stays clear of the rifle (it sits on the ground in front of
the soldier, lower on the stage).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

LOADER = Path(__file__).resolve().parents[1] / "viewer" / "play" / "loaders" / "brass.js"
SPRITE = LOADER.with_name("brass-soldier.webp")

SCRIPT = f"""
const m = await import({json.dumps(LOADER.as_uri())});
const slots = Array.from({{ length: m.PILE }}, (_, i) => m.pileSlot(i));
console.log(JSON.stringify({{ pile: m.PILE, slots }}));
"""


class ShortLoaderTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", "--input-type=module", "-e", SCRIPT], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"loader did not load:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_the_pile_is_a_pyramid_of_seven_rows(self) -> None:
        self.assertEqual(self.r["pile"], 28)
        rows: dict[float, list[float]] = {}
        for s in self.r["slots"]:
            rows.setdefault(round(s["y"], 3), []).append(s["x"])
        widths = [len(rows[y]) for y in sorted(rows, reverse=True)]
        self.assertEqual(widths, [7, 6, 5, 4, 3, 2, 1])

    def test_no_two_cases_share_a_place(self) -> None:
        slots = self.r["slots"]
        for i, a in enumerate(slots):
            for b in slots[i + 1:]:
                gap = ((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5
                self.assertGreaterEqual(gap, 6.0, (a, b))

    def test_each_row_rests_on_the_row_below(self) -> None:
        # A case above sits in the notch of the two below it: half a case across.
        slots = self.r["slots"]
        bottom = [s for s in slots if s["y"] == max(t["y"] for t in slots)]
        second = sorted((s for s in slots if s not in bottom and s["y"] == max(t["y"] for t in slots if t not in bottom)), key=lambda s: s["x"])
        xs = sorted(s["x"] for s in bottom)
        for j, s in enumerate(second):
            self.assertAlmostEqual(s["x"], (xs[j] + xs[j + 1]) / 2)

    def test_the_sprite_ships_beside_the_module(self) -> None:
        # The module loads it from the viewer root's play/loaders/ (VIEWER_ROOT).
        self.assertTrue(SPRITE.is_file())
        self.assertEqual(SPRITE.read_bytes()[8:12], b"WEBP")
        self.assertLess(SPRITE.stat().st_size, 40_000)


if __name__ == "__main__":
    unittest.main()
