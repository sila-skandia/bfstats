"""The dogfight arenas (features/dogfight-school, "The school's own page"):
the battles the school's own page flies its lessons in, read from the model
catalogue, and the address that puts you in one.

`dogfight_arena_harness.mjs` runs `viewer/dogfight-arena.js` over a small
catalogue of its own.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "dogfight_arena_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"dogfight arena harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ArenaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_one_arena_per_pair_of_fighters_with_both_sides(self) -> None:
        arenas = {a["map"]: a for a in self.out["arenas"]}
        # El Alamein's Spitfire v Bf 109 is Battle of Britain's; Midway has
        # no Axis fighter; Kursk is its own.
        self.assertEqual(list(arenas), ["Battle_of_Britain", "Kursk"])
        self.assertEqual((arenas["Battle_of_Britain"]["allied"], arenas["Battle_of_Britain"]["axis"]), (["Spitfire"], ["BF109"]))
        self.assertEqual((arenas["Kursk"]["allied"], arenas["Kursk"]["axis"]), (["Yak9"], ["BF109"]))

    def test_an_arena_flies_its_bombers_too_but_not_a_plane_both_sides_fly(self) -> None:
        planes = {a["map"]: a["planes"] for a in self.out["arenas"]}
        self.assertIn("Ju88A", planes["Battle_of_Britain"])
        self.assertIn("Ilyushin", planes["Kursk"])
        self.assertNotIn("B17", planes["Battle_of_Britain"])
        self.assertNotIn("T34", planes["Kursk"])

    def test_your_plane_and_the_ace_on_the_other_side(self) -> None:
        self.assertEqual(self.out["planeIn"], {"chosen": "BF109", "missing": "Spitfire"})
        self.assertEqual(self.out["ace"], {"againstAxis": "Spitfire", "againstAllied": "BF109"})

    def test_the_address_is_the_range_as_an_arena(self) -> None:
        q = self.out["url"]
        self.assertEqual(self.out["path"], "/map.html")
        self.assertEqual((q["proving"], q["map"], q["team"], q["botCount"], q["spawn"], q["arena"]),
                         ("1", "Kursk", "1", "1", "FiringLine", "dogfight"))
        self.assertEqual((q["dogfight"], q["move"]), ("boom-and-zoom", "dip-1"))


if __name__ == "__main__":
    unittest.main()
