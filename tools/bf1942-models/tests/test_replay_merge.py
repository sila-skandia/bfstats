"""`viewer/replay-merge.js` under node: several recordings of one round merged
into one (features/round-replay-merge).

One node run (`replay_merge_harness.mjs`), many assertions. A synthetic round
two clients recorded pins the fit, the dedupe, the choice of file per object
and the mapping of each file's part ids; a real round (35 s of the public
Bocage round of 2026-09-28, `fixtures/merge_bocage_350-385.ndjson.gz`) split
by side with the server's own rule (round-replay-capture §19) and merged back
pins that the merge gives the original back where the two files cover it.
With the whole round on this PC (536 s, 34 players) the same again.

The guard: the first real pair shared to the feed, two rounds the fit once
lined up by the server's adverts, is refused (and merged only by force);
the first real pair of one round merges (`fixtures/merge_guard_*`, their
events only); where the scores cannot decide, the world clock does.
"""

from __future__ import annotations

import gzip
import json
import shutil
import subprocess
import tempfile
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


class ReplayMergeGuardTests(unittest.TestCase):
    """The guard (`replay-merge-guard.js`): an alignment a few events agreed on
    by chance is two rounds, and is not merged; one round's files are."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()
        cls.g = cls.results["guard"]

    def test_the_first_real_pair_two_rounds_is_refused(self) -> None:
        # kqqaqxdwtr and nj2dyh58te: the fit once lined them up by 58 events,
        # 55 of them the server's adverts, 1377.5 s apart.
        for run in (self.g["falsePair"], self.g["falsePairReversed"]):
            self.assertFalse(run["merged"])
            self.assertEqual(run["error"], "MergeRefused")
            found = run["guard"]["files"][0]
            self.assertEqual(found["by"], "scores")
            self.assertEqual(found["scores"]["matched"], 1)
            self.assertEqual(sorted(found["scores"]["held"]), [551, 670])
            self.assertGreater(found["worldClock"]["apartSeconds"], 2000)
            self.assertEqual(
                run["message"],
                "These look like different rounds: of the 551 kills and scores both recorded, 1 lines up,"
                " and the server's clock puts them 35:47 apart.")

    def test_forced_the_pair_merges_and_says_so(self) -> None:
        run = self.g["falsePairForced"]
        self.assertTrue(run["merged"])
        self.assertFalse(run["guard"]["credible"])
        self.assertTrue(any(w.startswith("merged by force: These look like different rounds") for w in run["warnings"]))

    def test_the_real_pair_of_one_round_merges(self) -> None:
        # nj2dyh58te and skandia's recording of the same round, 791.2 s apart.
        run = self.g["genuinePair"]
        self.assertTrue(run["merged"])
        found = run["guard"]["files"][0]
        self.assertEqual(found["by"], "scores")
        self.assertGreater(found["scores"]["share"], 0.99)
        self.assertLess(found["worldClock"]["apartSeconds"], 0.1)
        self.assertAlmostEqual(run["offset"], -791.22, delta=0.05)

    def test_the_split_rounds_merge(self) -> None:
        for name in ("split", "synthetic"):
            guard = self.results[name]["guard"]
            self.assertTrue(guard["credible"], name)
            self.assertEqual(guard["files"][0]["by"], "scores", name)
            self.assertGreater(guard["files"][0]["scores"]["share"], 0.95, name)
        if self.results["fullRound"] is not None:
            self.assertTrue(self.results["fullRound"]["guard"]["credible"])

    def test_where_the_scores_cannot_decide_the_world_clock_does(self) -> None:
        agrees = self.g["clockAgrees"]
        self.assertTrue(agrees["merged"])
        self.assertEqual(agrees["guard"]["files"][0]["by"], "world clock")
        self.assertLess(agrees["guard"]["files"][0]["worldClock"]["apartSeconds"], 0.1)
        refused = self.g["clockDisagrees"]
        self.assertFalse(refused["merged"])
        self.assertEqual(refused["guard"]["files"][0]["by"], "world clock")
        self.assertEqual(refused["message"], "These look like different rounds: the server's clock puts them 5:00 apart.")


class ReplayMergeCommandLineTests(unittest.TestCase):
    """`merge_replays.mjs` reports a refusal and exits 1 unless forced."""

    def test_the_first_real_pair_is_refused_unless_forced(self) -> None:
        if shutil.which("node") is None:
            self.skipTest("node is not installed")
        cli = HARNESS.parent.parent / "merge_replays.mjs"
        fixtures = HARNESS.parent / "fixtures"
        with tempfile.TemporaryDirectory() as tmp:
            files = []
            for name in ("merge_guard_kqqaqxdwtr.ndjson.gz", "merge_guard_nj2dyh58te_1370-1930.ndjson.gz"):
                target = Path(tmp) / name.replace(".gz", "")
                target.write_bytes(gzip.decompress((fixtures / name).read_bytes()))
                files.append(str(target))
            out = str(Path(tmp) / "merged.ndjson")
            refused = subprocess.run(["node", str(cli), *files, "-o", out], capture_output=True, text=True, timeout=300)
            self.assertEqual(refused.returncode, 1, refused.stderr)
            self.assertIn("not merged: These look like different rounds", refused.stderr)
            self.assertIn("REFUSED by scores", refused.stderr)
            self.assertFalse(Path(out).exists())
            forced = subprocess.run(["node", str(cli), *files, "-o", out, "--force"], capture_output=True, text=True, timeout=300)
            self.assertEqual(forced.returncode, 0, forced.stderr)
            self.assertIn("warning: merged by force", forced.stdout)
            self.assertTrue(Path(out).exists())


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
