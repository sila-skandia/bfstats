"""`replay-recording.js` `inferKits`: the kit of a soldier the recording never
saw take one, from his own recorded states.

Why this exists. A soldier already alive when a recording began has no spawn
pickup and no join kit, so the replay had no kit for him and his body held the
placeholder Colt all life. On ku8gdc58b6 (Omaha) that was 36 of 281 soldier
lives; Kerem's jump with the Thompson, two grenade throws and his draw back
were all drawn as the run. Each recorded state row carries the kit's item
slot, and the upper state names the weapon, which is enough to pick his kit
(features/replay-state-audit, "Findings on current code").
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_inferred_kits_harness.mjs"


class InferredKitTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_slots_and_weapons_pick_the_kit_and_a_tie_goes_to_the_templates_kit(self) -> None:
        self.assertEqual(self.r["kerem"], {"kit": "USMarine_Medic", "inferred": True})

    def test_weapon_names_ending_in_digits_and_the_knifes_swing_match(self) -> None:
        # German_Medic and its desert copy agree alike: the name decides.
        self.assertEqual(self.r["digits"], {"kit": "German_Medic", "inferred": True})

    def test_more_than_a_twentieth_against_gives_no_kit(self) -> None:
        self.assertEqual(self.r["against"], {"kit": None, "inferred": False})

    def test_only_a_kit_of_his_side(self) -> None:
        self.assertEqual(self.r["wrongSide"], {"kit": None, "inferred": False})

    def test_a_life_with_no_weapon_named_keeps_no_kit(self) -> None:
        self.assertEqual(self.r["deadOnSight"], {"kit": None, "inferred": False})

    def test_a_kit_the_file_saw_is_kept(self) -> None:
        self.assertEqual(self.r["seen"], {"kit": "Us_Assault", "inferred": False})

    def test_counts_what_it_gave_and_needs_a_kit_table(self) -> None:
        self.assertEqual(self.r["given"], 2)
        self.assertEqual(self.r["noTable"], 0)


if __name__ == "__main__":
    unittest.main()
