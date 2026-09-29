"""`viewer/replay-merge.js` under node: several recordings of one round merged
into one (features/round-replay-merge).

One node run (`replay_merge_harness.mjs`), many assertions. A synthetic round
two clients recorded pins the fit, the dedupe, the choice of file per object
and the mapping of each file's part ids; a real round (35 s of the public
Bocage round of 2026-09-28, `fixtures/merge_bocage_350-385.ndjson.gz`) split
by side with the server's own rule (round-replay-capture §19) and merged back
pins that the merge gives the original back where the two files cover it.
With the whole round on this PC (536 s, 34 players) the same again.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_merge_harness.mjs"


_RESULTS: dict | None = None


def run_harness() -> dict:
    global _RESULTS
    if _RESULTS is None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        _RESULTS = json.loads(proc.stdout)
    return _RESULTS


class ReplayMergeSyntheticTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()
        cls.s = cls.results["synthetic"]

    def test_the_later_files_clock_is_fitted_onto_the_first(self) -> None:
        # B began 30 s into A, its clock 50 ppm fast, its events up to 20 ms off.
        self.assertAlmostEqual(self.s["offset"], 30.0, delta=0.005)
        self.assertAlmostEqual(self.s["driftPpm"], -50, delta=15)
        self.assertGreaterEqual(self.s["matched"], 100)
        self.assertLess(self.s["residualMs"]["median"], 25)

    def test_each_event_once(self) -> None:
        self.assertEqual(self.s["kills"], 40)
        # A's team chat reached his side alone: kept, and B is said to lack it.
        self.assertEqual(self.s["teamChat"], 1)
        self.assertEqual(self.s["missing"][0]["byKind"], {})
        self.assertEqual(self.s["missing"][1]["byKind"], {"chat": 1})
        # His own chat line, shown on his screen half a second before B's.
        self.assertEqual(self.s["chatBox"], [130])

    def test_a_players_own_records_are_named_for_him(self) -> None:
        self.assertEqual(self.s["hit"]["pid"], 3)
        # A shout both heard, and who heard it.
        self.assertEqual(self.s["radio"]["to"], [3, 8])
        self.assertEqual(self.s["shots"], 2)

    def test_each_recording_player_is_in_the_header(self) -> None:
        header = self.s["header"]
        self.assertEqual([m["local"] for m in header], [3, 8])
        self.assertEqual(header[0]["offset"], 0)
        self.assertAlmostEqual(header[1]["offset"], 30.0, delta=0.005)

    def test_an_objects_file_is_its_rider_then_its_nearest_held_against_flapping(self) -> None:
        # Only B has it (40), B is nearer (55), B drives it (70), A runs up to
        # it but must be nearer for 2 s first (81, 85), A loses it (95).
        self.assertEqual(self.s["shermanFrom"], {"40": "B", "55": "B", "70": "B", "81": "B", "85": "A", "95": "B"})
        self.assertEqual(self.s["switches"], {"lost by the other": 1, "nearest": 1})

    def test_each_files_part_ids_are_one_set(self) -> None:
        self.assertEqual([p["name"] for p in self.s["parts"]], ["ShermanTower", "ShermanGunBase"])
        self.assertEqual(self.s["engines"], 1)
        self.assertTrue(self.s["towerTrue"], "the turret turns on through the change of file")


class ReplayMergeOptionTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_disjoint_ids_keep_both_files_parts(self) -> None:
        match = self.results["childMatch"]
        self.assertEqual((match["rank"]["parts"], match["rank"]["engines"]), (2, 1))
        self.assertEqual((match["disjoint"]["parts"], match["disjoint"]["engines"]), (4, 2))

    def test_the_report_catches_parts_listed_the_other_way(self) -> None:
        match = self.results["childMatch"]
        self.assertEqual(match["reversedRank"]["rankVsPosition"], 2)
        self.assertEqual(match["reversedRank"]["partOffsetM"]["median"], 2)
        self.assertEqual(match["reversedPosition"]["partOffsetM"]["median"], 0)

    def test_a_body_state_is_renumbered_by_name_where_the_tables_differ(self) -> None:
        anim = self.results["anim"]
        self.assertEqual(anim["tables"], [True, False])
        self.assertEqual((anim["body"]["lower"], anim["body"]["stance"]), ("Lb_Crouch", "crouch"))

    def test_files_of_two_levels_are_refused(self) -> None:
        self.assertIn("not one round", self.results["otherRound"] or "")

    def test_the_reports_summaries_take_a_real_rounds_numbers(self) -> None:
        # The first real pair threw in the report: Math.max(...) over its pose pairs.
        self.assertEqual({"max": 999, "n": 300000, "maxOf": 999, "minOf": 0, "none": None}, self.results["bigSpread"])


class ReplayMergeViewerTests(unittest.TestCase):
    """Several recording players in the viewer, and the page's merge."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.v = run_harness()["viewer"]

    def test_each_file_has_its_recording_player_the_first_leads(self) -> None:
        self.assertEqual(self.v["recordingPlayers"], [3, 8])
        self.assertEqual(self.v["recordingPlayer"], 3)
        self.assertEqual(self.v["oneFile"], [3])

    def test_his_hits_wash_only_his_first_person(self) -> None:
        self.assertEqual(self.v["hits"], [{"t": 100, "dir": 4, "strength": 15, "pid": 3}])
        self.assertEqual(self.v["washes"], {"followingB": 0, "followingA": 1})

    def test_the_radio_says_who_heard_it(self) -> None:
        self.assertEqual(self.v["radioTo"], [[3, 8]])

    def test_each_recording_player_spawns_into_the_chapters(self) -> None:
        self.assertEqual(self.v["spawnChapters"], [3, 8])

    def test_files_opened_together_are_merged_in_the_page(self) -> None:
        self.assertEqual(self.v["picked"], {"name": "A_merged.ndjson", "merged": True, "players": [3, 8]})
        self.assertEqual(self.v["single"], {"name": "A.ndjson", "merged": None})


class ReplayMergeSplitTests(unittest.TestCase):
    """A real round split by side and merged back."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def check(self, run: dict, offset_ms: float) -> None:
        self.assertLess(abs(run["offsetErrorMs"]), offset_ms)
        self.assertLess(run["residualMs"]["median"], 20)
        self.assertEqual(run["eventsMissing"], 0)
        self.assertEqual(run["eventsExtra"], 0)
        coverage = run["coverage"]
        for side in ("axis", "allies"):
            # Everything either file had in range, and nothing else.
            self.assertAlmostEqual(coverage["merged"][side], coverage["ideal"][side], delta=0.002)
            self.assertGreaterEqual(coverage["merged"][side], max(coverage["a"][side], coverage["b"][side]) - 1e-9)
            self.assertLessEqual(coverage["merged"][side], coverage["original"][side] + 1e-9)
        self.assertLess(run["inventedSeconds"], 1)
        self.assertEqual(run["posesOff"], 0)
        self.assertEqual(run["jointsOff"], 0)
        self.assertEqual(run["partsUnmatched"], 0)
        self.assertEqual(run["header"], [run["local"], run["enemy"]])
        self.assertEqual(run["viewer"]["recordingPlayers"], [run["local"], run["enemy"]])
        self.assertEqual(set(run["viewer"]["hits"]), {run["local"]}, "the original's hits are its own player's")
        self.assertEqual(run["viewer"]["kills"][0], run["viewer"]["kills"][1])
        self.assertEqual(run["viewer"]["deaths"][0], run["viewer"]["deaths"][1])

    def test_the_fixture_comes_back(self) -> None:
        run = self.results["split"]
        self.check(run, offset_ms=5)
        self.assertGreaterEqual(run["matched"], 80)
        # The object's last sample period after its removal, which the
        # original writes and the merge ends at the removal.
        self.assertLess(run["lostSeconds"], 2)

    def test_the_whole_round_comes_back(self) -> None:
        run = self.results["fullRound"]
        if run is None:
            self.skipTest("replay_20260928-133433.ndjson is not on this PC")
        self.check(run, offset_ms=3)
        self.assertAlmostEqual(run["driftPpm"], -40, delta=10)
        self.assertLess(run["lostSeconds"], 30)


if __name__ == "__main__":
    unittest.main()
