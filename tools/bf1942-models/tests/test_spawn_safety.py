"""A player is never stood inside a model, and never in a pocket.

Reported from the map viewer: "on the battle of britain map, you spawn inside
the factory, inside the model and can't get out."

Two things answer it and this pins both halves of the second.

The FIRST half is data, and it is the real cause on that level:
`spawnPointManager.OnlyForAI 1` is the engine's own audience filter on a spawn
group, and Battle of Britain declares each of its four radar towers TWICE —
five `OnlyForHuman` points spread around the building, and ONE `OnlyForAI`
point at the building's own origin, indoors under a 2.25 m ceiling. The
extractor now carries the word and `pickSpawn` refuses it (see
`test_spawn_groups`).

The SECOND half is this module: a geometry check for everything the level's
own words cannot say. It is deliberately narrow — it answers "is the body
jammed inside something, or in a pocket too small to walk out of", not "is
this room sealed". The sealed-room case is checked here too, as a PASS, so
that the limit is a decision on the record rather than a gap somebody trips
over later.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "spawn-safety.js"
HARNESS = Path(__file__).resolve().parent / "spawn_safety_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not MODULE.exists():
        raise unittest.SkipTest("spawn-safety.js is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type":"module"}')
        shutil.copyfile(MODULE, work / MODULE.name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        result = subprocess.run(["node", "harness.mjs"], cwd=work,
                                capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise AssertionError(result.stderr[-4000:])
        return json.loads(result.stdout.strip().splitlines()[-1])


class SpawnSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_open_ground_is_a_spawn(self):
        self.assertIsNone(self.out["open"])

    def test_a_point_inside_a_solid_block_is_embedded(self):
        self.assertEqual(self.out["insideABlock"], "embedded")

    def test_a_pocket_too_small_to_turn_round_in_is_boxed(self):
        self.assertEqual(self.out["pocket"], "boxed")

    def test_standing_beside_a_building_is_fine(self):
        self.assertIsNone(self.out["againstAWall"])
        self.assertIsNone(self.out["lowKerb"])

    def test_an_indoor_spawn_with_room_to_move_is_allowed(self):
        # Not a gap: telling a sealed room from one with a door needs a flood
        # fill, and the cheap approximations of it reject Stalingrad. The
        # engine's own `OnlyForAI` is what keeps players out of the one
        # bunker that motivated this.
        self.assertIsNone(self.out["roomWithADoor"])
        self.assertIsNone(self.out["sealedRoom"])

    def test_a_bad_point_is_walked_past_to_the_next_one(self):
        self.assertEqual(self.out["walkedPast"], "outside")

    def test_a_good_point_is_left_exactly_where_it_was_asked_for(self):
        self.assertEqual(self.out["keepsTheAskedForOneWhenItIsFine"], "outside")

    def test_a_flag_with_nothing_good_still_spawns_you(self):
        # A deploy button that does nothing is worse than a bad spawn.
        self.assertEqual(self.out["fallbackName"], "a")
        self.assertEqual(self.out["fallbackReason"], "embedded")

    def test_a_page_with_no_collider_uses_the_authored_point(self):
        self.assertEqual(self.out["noWorldName"], "inside")
        self.assertIsNone(self.out["noWorldReason"])

    def test_a_flag_with_no_spawns_at_all_is_null(self):
        self.assertIsNone(self.out["emptyPool"])


if __name__ == "__main__":
    unittest.main()
