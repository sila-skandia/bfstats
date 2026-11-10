"""Round recordings as flat tables (features/recording-ml).

`recording_tables_harness.mjs` writes a 45 s round in the recorder's own
format (a Spitfire shooting a Bf 109 down after 30 s behind it, and a second
Bf 109 flying past that nobody fires at), runs `export_recording_tables.mjs`
on it, and reads back what it wrote. These tests hold the encounter rules and
the promise that no table carries a player's name.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "recording_tables_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"recording tables harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RecordingTablesTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_every_table_is_written(self) -> None:
        self.assertEqual(
            ["accuracy", "air_encounters", "air_fights", "air_ticks", "captures", "kills", "players", "recordings", "tickets"],
            self.out["files"])

    def test_no_table_holds_a_name_or_a_chat_line(self) -> None:
        self.assertEqual([], self.out["namesInTables"])
        self.assertFalse(self.out["chatInTables"])

    def test_a_name_is_a_key_that_only_the_key_file_fixes(self) -> None:
        keys = [p["player"] for p in self.out["players"]]
        for key in keys:
            self.assertRegex(key, re.compile(r"^[0-9a-f]{16}$"))
        self.assertEqual(3, len(set(keys)))
        # The same key file gives the same keys; another gives others.
        self.assertTrue(self.out["sameKeysOnASecondRun"])
        self.assertFalse(set(keys) & set(self.out["keysUnderAnotherKey"]))
        # The kill names its two players by those keys.
        kill = self.out["kills"][0]
        self.assertEqual([keys[0], keys[1]], [kill["killer"], kill["victim"]])

    def test_the_recording_row_carries_its_hash_and_versions(self) -> None:
        row = self.out["recording"]
        self.assertRegex(row["content_hash"], re.compile(r"^[0-9a-f]{64}$"))
        for column in ("export_version", "encounter_version", "air_rules_version", "manoeuvre_rules_version"):
            self.assertIsInstance(row[column], int)
        self.assertEqual(["battle_of_britain", "conquest", 3, 0], [row["level"], row["mode"], row["humans"], row["bots"]])

    def test_a_pass_with_no_shot_is_an_encounter_and_no_fight(self) -> None:
        # The detector finds the one fight; the export finds it as an
        # encounter, and beside it the fly-past nobody fired in.
        self.assertEqual(1, len(self.out["fights"]))
        shot, passed = self.out["encounters"]
        self.assertEqual(["shot", True, [100, 200]], [shot["ref"], shot["fight"], shot["nids"]])
        self.assertEqual(["closest", False, [100, 300]], [passed["ref"], passed["fight"], passed["nids"]])
        self.assertEqual([None, None, [0, 0]], [passed["first_shot_side"], passed["kill_side"], passed["aimed"]])
        # Two planes of one side are no encounter: the two Bf 109s.
        self.assertNotIn([200, 300], [e["nids"] for e in self.out["encounters"]])

    def test_the_first_shooter_and_the_kill_are_the_lower_ids_side(self) -> None:
        shot = self.out["encounters"][0]
        self.assertEqual([0, 0], [shot["first_shot_side"], shot["kill_side"]])
        self.assertGreater(shot["aimed"][0], 2)
        self.assertEqual(0, shot["aimed"][1])
        self.assertAlmostEqual(30.0, shot["t_ref"], places=1)

    def test_ticks_start_twenty_seconds_before_the_first_shot(self) -> None:
        first, last = self.out["tickSpan"]
        self.assertAlmostEqual(-20.0, first, places=1)
        self.assertGreater(last, 0)
        # Ten seconds before it the Spitfire sits behind the Bf 109, nose on.
        hunter, prey = self.out["before"]
        self.assertTrue(hunter["live"] and hunter["piloted"] and prey["live"])
        self.assertLess(hunter["ata"], 30)
        self.assertGreater(prey["ata"], 150)
        self.assertEqual(["offensive", "defensive"], [hunter["situation"], prey["situation"]])
        self.assertAlmostEqual(hunter["range"], prey["range"], places=1)

    def test_an_unchanged_recording_is_not_exported_again(self) -> None:
        first, second, forced = self.out["tallies"]
        self.assertEqual([1, 0], [first["written"], first["skipped"]])
        self.assertEqual([0, 1], [second["written"], second["skipped"]])
        self.assertEqual(1, forced["written"])
        # Every fight the detector finds lies inside an encounter.
        self.assertEqual(0, first["outside"])


if __name__ == "__main__":
    unittest.main()
