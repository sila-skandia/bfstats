"""`viewer/game-modes.js` -- `?mode=`, driven headless by
`game_modes_harness.mjs`.

The module is the whole of the page's mode handling: `map.html` calls
`selectGameMode` where it used to assign the report, `pruneToMode` where it
used to hand the glb straight to the indexer, and `spawnerWindow` inside
`spawnDelayForNode`. Everything worth pinning is pinned here rather than in a
browser.

The two compatibility rules are the point of most of these tests:

  * a `scene.json` with no `modes` key comes back as itself, and
  * a glb node with no `modes` tag is in every mode,

so a published tree extracted before any of this loads unchanged.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("game_modes_harness.mjs")
MODULES = {"game-modes.js": VIEWER / "game-modes.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class GameModeSelectionTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # ---- listing what a level offers -------------------------------------

    def test_wake_offers_its_four_layers_with_conquest_first(self) -> None:
        self.assertEqual(self.results["names"]["wake"],
                         ["Conquest", "Ctf", "Tdm", "SinglePlayer"])

    def test_a_report_without_modes_offers_none(self) -> None:
        for key in ("legacy", "empty", "nullExtras", "arrayModes", "emptyModes"):
            with self.subTest(key):
                self.assertEqual(self.results["names"][key], [])

    def test_a_default_the_map_does_not_carry_is_ignored(self) -> None:
        self.assertEqual(self.results["names"]["strayDefault"], ["Ctf", "Tdm"])

    def test_game_types_name_the_layer_they_load(self) -> None:
        rows = {row["name"]: row["mode"] for row in self.results["gameTypes"]["wake"]}
        # No vanilla level ships a `CoOp/` directory; `GameTypes/CoOp.con`
        # runs `SinglePlayer/*`.
        self.assertEqual(rows, {"Conquest": "Conquest", "CoOp": "SinglePlayer",
                                "Ctf": "Ctf"})

    def test_a_game_type_without_a_mode_falls_back_to_its_own_name(self) -> None:
        self.assertEqual(self.results["gameTypes"]["bare"],
                         [{"name": "Conquest", "mode": "Conquest"}])

    # ---- resolving ?mode= -------------------------------------------------

    def test_no_mode_parameter_is_the_default_layer(self) -> None:
        self.assertEqual(self.results["resolve"]["none"], "Conquest")
        self.assertEqual(self.results["resolve"]["nullWanted"], "Conquest")

    def test_a_layer_can_be_named_in_any_case_or_with_spaces(self) -> None:
        self.assertEqual(self.results["resolve"]["exact"], "SinglePlayer")
        self.assertEqual(self.results["resolve"]["lowered"], "SinglePlayer")
        self.assertEqual(self.results["resolve"]["padded"], "Tdm")

    def test_a_game_type_resolves_to_the_layer_it_loads(self) -> None:
        self.assertEqual(self.results["resolve"]["byGameType"], "SinglePlayer")

    def test_a_mode_this_level_does_not_have_falls_back_to_the_default(self) -> None:
        # Not "no flags at all": a mistyped URL still gets a playable level.
        self.assertEqual(self.results["resolve"]["unknown"], "Conquest")
        self.assertTrue(self.results["unknown"]["unknown"])

    def test_an_old_report_resolves_to_nothing_at_all(self) -> None:
        self.assertIsNone(self.results["resolve"]["legacy"])
        self.assertFalse(self.results["unknown"]["legacy"])

    def test_a_mode_the_level_has_is_not_reported_unknown(self) -> None:
        self.assertFalse(self.results["unknown"]["known"])
        self.assertFalse(self.results["unknown"]["gameType"])
        self.assertFalse(self.results["unknown"]["empty"])

    # ---- the merge --------------------------------------------------------

    def test_the_default_mode_is_the_top_level_report(self) -> None:
        """The compatibility guarantee: no `?mode=` changes nothing."""
        self.assertTrue(self.results["select"]["defaultMatchesTopLevel"])
        self.assertEqual(self.results["select"]["defaultMode"], "Conquest")

    def test_singleplayer_brings_its_own_flags_spawns_and_vehicles(self) -> None:
        select = self.results["select"]
        self.assertEqual(select["singleMode"], "SinglePlayer")
        # Wake's beach flag moves 50 m inland and is re-cased in SinglePlayer.
        self.assertEqual(select["singleControlPoints"],
                         [{"name": "The_Beach", "team": 2}])
        self.assertEqual(select["singleSpawnCount"], 3)
        self.assertEqual(select["singleVehicles"], ["chi-ha"])
        # SinglePlayer's tickets come from `GameTypes/CoOp.con`, so the record
        # names the game type, not the layer.
        self.assertEqual(select["singleTickets"],
                         {"mode": "CoOp", "team1": 140, "team2": 100})

    def test_a_layer_with_no_tickets_reports_none(self) -> None:
        # CTF is decided on flag captures; its script sets no ticket count.
        self.assertIsNone(self.results["select"]["ctfTickets"])
        self.assertEqual(self.results["select"]["ctfVehicles"], [])

    def test_only_the_gameplay_keys_are_overridden(self) -> None:
        select = self.results["select"]
        self.assertEqual(select["keepsLevel"], "Wake")
        self.assertEqual(select["keepsWorldSize"], 2048)
        self.assertEqual(select["keepsTerrain"], {"tiles": 16})
        self.assertEqual(sorted(select["keepsModes"]),
                         ["Conquest", "Ctf", "SinglePlayer", "Tdm"])
        self.assertEqual(sorted(select["keepsGameTypes"]),
                         ["CoOp", "Conquest", "Ctf"])

    def test_the_allowlist_is_the_six_gameplay_keys(self) -> None:
        self.assertEqual(sorted(self.results["modeKeys"]), [
            "combatArea", "controlPoints", "objectSpawns", "soldierSpawns",
            "tickets", "vehicleSoldierSpawns",
        ])

    def test_the_report_is_not_mutated(self) -> None:
        self.assertTrue(self.results["select"]["sourceUntouched"])

    def test_an_old_report_is_returned_unchanged(self) -> None:
        self.assertTrue(self.results["select"]["legacyIdentity"])
        self.assertIsNone(self.results["select"]["nullIdentity"])

    def test_a_key_a_mode_entry_omits_keeps_the_level_wide_value(self) -> None:
        self.assertEqual(self.results["partial"]["combatAreaKept"],
                         {"min": [0, 0, 0], "max": [512, 0, -512]})
        self.assertEqual(self.results["partial"]["controlPointsReplaced"], [])


class ScenePruneTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_conquest_keeps_its_vehicles_flags_and_cloths(self) -> None:
        kept = self.results["prune"]["conquest"]["kept"]
        self.assertIn("willy", kept)
        self.assertIn("sherman", kept)
        self.assertIn("The_beach.t2", kept)
        self.assertIn("flagCloth.t2", kept)
        # The SinglePlayer-only tank and the Tdm-owned flag go.
        self.assertNotIn("chi-ha", kept)
        self.assertNotIn("The_beach.t1", kept)
        self.assertNotIn("flagCloth.t1", kept)
        # And the untagged scene furniture stays.
        self.assertIn("terrain", kept)
        self.assertIn("spawners", kept)

    def test_tdm_keeps_the_flag_it_owns_and_drops_the_other_team_s(self) -> None:
        kept = self.results["prune"]["tdm"]["kept"]
        self.assertIn("The_beach.t1", kept)
        self.assertIn("flagCloth.t1", kept)
        self.assertNotIn("The_beach.t2", kept)
        self.assertNotIn("flagCloth.t2", kept)
        self.assertNotIn("chi-ha", kept)
        self.assertIn("willy", kept)

    def test_a_pruned_flag_takes_its_children_with_it(self) -> None:
        # `flagAnchor` is the cloth's skeleton root, hung under the pole.
        self.assertNotIn("flagAnchor", self.results["prune"]["tdm"]["kept"])

    def test_a_glb_with_no_tags_loses_nothing(self) -> None:
        self.assertEqual(self.results["prune"]["oldGlb"]["removed"], 0)
        self.assertEqual(self.results["prune"]["oldGlb"]["kept"], ["a", "b"])

    def test_no_mode_prunes_nothing(self) -> None:
        self.assertEqual(self.results["prune"]["noMode"]["removed"], 0)
        self.assertEqual(self.results["prune"]["noMode"]["kept"], 11)
        self.assertEqual(self.results["prune"]["nullRoot"], 0)

    def test_the_tag_match_is_case_insensitive(self) -> None:
        self.assertEqual(self.results["prune"]["caseInsensitive"]["kept"],
                         self.results["prune"]["conquest"]["kept"])

    def test_an_untagged_node_belongs_to_every_mode(self) -> None:
        checks = self.results["nodeInMode"]
        self.assertTrue(checks["untagged"])
        self.assertTrue(checks["tagged"])
        self.assertFalse(checks["other"])
        # A malformed tag is treated as untagged, never as "belongs nowhere".
        self.assertTrue(checks["notAnArray"])
        self.assertTrue(checks["noNode"])


class SpawnerWindowTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_pad_every_mode_agrees_on_uses_the_plain_stamp(self) -> None:
        self.assertEqual(self.results["spawnerWindow"]["plain"],
                         {"minSpawnDelay": 30, "maxSpawnDelay": 40})

    def test_a_pad_the_modes_disagree_on_uses_the_active_mode_s_window(self) -> None:
        # DC_Final/Berlin parks a humvee on one slab with a 40-80 s window in
        # Conquest and 70-110 s in Tdm; 2,123 pads do this across the mods.
        self.assertEqual(self.results["spawnerWindow"]["byMode"],
                         {"minSpawnDelay": 70, "maxSpawnDelay": 110})

    def test_a_mode_missing_from_the_table_falls_back_to_the_stamp(self) -> None:
        self.assertEqual(self.results["spawnerWindow"]["byModeMissing"],
                         {"minSpawnDelay": 40, "maxSpawnDelay": 80})

    def test_a_mode_that_declares_no_window_reports_none(self) -> None:
        self.assertIsNone(self.results["spawnerWindow"]["byModeNull"])

    def test_no_stamp_at_all_reports_none(self) -> None:
        self.assertIsNone(self.results["spawnerWindow"]["nothing"])


if __name__ == "__main__":
    unittest.main()
