"""The map's vehicle pads (`viewer/level-statics.js`), driven headless by
`vehicle_pads_harness.mjs`.

A pad is the engine's ObjectSpawner (ledger SPAWN-2, SPAWN-9..SPAWN-12,
SPAWN-17..SPAWN-19): the side holding its flag picks the template, a neutral
flag's pad spawns nothing, a hull already out is never touched by the flag,
and the delay runs from the hull's destruction, drawn by `calcSpawnDelay`.
Desert Combat's pads
at flags that change hands name a different template per side (a T72 for
Iraq, an M1A1 for the US); the level bakes one, and the other side's comes
from the models tree (`loadPadVariants`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("vehicle_pads_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class VehiclePadTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_other_side_is_loaded_only_where_a_flag_can_change_hands(self) -> None:
        # The village and the road can; the base cannot, so its AA pad loads
        # nothing and its missing AA_allies model is never asked for.
        self.assertEqual(["T72", "UAZ"], self.results["added"])

    def test_the_round_opens_with_the_holder_vehicle_and_nothing_at_a_neutral_flag(self) -> None:
        self.assertEqual(["M1A1", "ZPU-4", "Zodiac"], self.results["atLoad"])
        self.assertFalse(self.results["roadBefore"])

    def test_the_delay_is_drawn_for_the_server_not_at_random(self) -> None:
        # 8 players of 16 between 20 and 60 s: 20 + 40 x (1 - 0.5).
        self.assertEqual(40, self.results["firstDelay"])

    def test_a_capture_leaves_the_parked_hull_and_retargets_the_pad(self) -> None:
        after = self.results["afterCapture"]
        self.assertEqual(["M1A1", "ZPU-4", "Zodiac"], after["live"])
        self.assertEqual(1, after["tankTeam"])
        self.assertTrue(after["active"])
        # `setActive` draws a held delay anew.
        self.assertEqual(40, after["delay"])

    def test_the_captured_pad_respawns_the_capturer_template(self) -> None:
        respawn = self.results["respawn"]
        # A burning hull holds its pad: the delay has not moved in 5 s.
        self.assertEqual(40, respawn["delayWhileBurning"])
        # 40 s from the M1A1's destruction at 5 s (SPAWN-11's `isDestroyed`),
        # not from its going critical or its wreck clearing.
        self.assertAlmostEqual(45, respawn["at"], delta=0.1)
        self.assertEqual(["T72", "ZPU-4", "Zodiac"], respawn["live"])
        # The wreck still burning on the pad goes first.
        self.assertEqual(["destroy M1A1", "spawn T72"], respawn["log"])

    def test_a_neutral_pad_taken_spawns_the_taker_at_once(self) -> None:
        self.assertEqual(["UAZ"], self.results["roadAfter"])

    def test_pads_off_any_flag_and_bases_ignore_the_flags(self) -> None:
        self.assertTrue(self.results["base"])
        self.assertTrue(self.results["boat"])
        # With `osId` in the scene, a pad with none is filed under no point,
        # whatever point the exporter's nearest-guess named.
        self.assertIsNone(self.results["boatPoint"])

    def test_a_scene_written_before_osid_keeps_the_nearest_guess(self) -> None:
        legacy = self.results["legacy"]
        self.assertEqual("village", legacy["boatPoint"])
        self.assertEqual(["M1A1", "ZPU-4", "Zodiac"], legacy["atLoad"])
        self.assertEqual(["Humvee"], legacy["roadAfter"])

    def test_spawn_delay_at_start_is_a_bool_word(self) -> None:
        # `istream >> bool` (SPAWN-9): only a 1 sets it; DC's 60 and 15 fail.
        self.assertEqual([True, False, False, False, True, False], self.results["delayAtStart"])


if __name__ == "__main__":
    unittest.main()
