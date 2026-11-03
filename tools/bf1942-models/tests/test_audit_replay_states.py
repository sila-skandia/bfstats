"""`audit_replay_states.mjs`'s pure half: the clip vocabulary that says what a
drawn or recorded state is, and the count of recorded states against drawn
ones, over small synthetic recordings read with the viewer's own helpers.

One node run (`replay_states_harness.mjs`), no network and no browser.

Why this exists. Of the fifteen replay nitpicks users reported between
2026-10-25 and 2026-11-02, six were states the recording carried and the page
never drew: a kit pickup, the recorded lower state, 56 survived hit flinches,
the weapon draws. Each was found by hand, by counting, after a report. The
audit makes that count on every recording; played against the viewer from
before those fixes it fails on each of them (features/replay-state-audit).
A wrong rule here either hides such a defect or cries wolf on every run.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_states_harness.mjs"
# watches: tools/bf1942-models/audit_replay_states.mjs tools/bf1942-models/viewer/replay-recording.js tools/bf1942-models/viewer/remote-gait.js


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayStateAuditTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_drawn_clip_names_map_to_gait_families(self) -> None:
        v = self.r["vocab"]
        self.assertEqual(
            (v["lie"], v["runLower"], v["standLower"], v["jump"], v["junk"]),
            ("prone", "run", "stand", "run", None),
        )

    def test_recorded_and_drawn_torso_names_map_to_one_action(self) -> None:
        v = self.r["vocab"]
        self.assertEqual(v["fireEnd"], "fire")
        self.assertEqual(v["fireDrawn"], "fire")
        self.assertEqual(v["altFire"], "altfire")
        self.assertEqual((v["reload"], v["bolt"]), ("reload", "bolt"))
        self.assertEqual((v["hit"], v["hitLie"]), ("hit", "hit"))
        self.assertEqual((v["raise"], v["reset"]), ("raise", "raise"))
        self.assertEqual(v["jumpUpper"], "jump")
        self.assertIsNone(v["gaitUpper"])

    def test_windows_cover_a_short_round_whole_and_spread_over_a_long_one(self) -> None:
        w = self.r["windows"]
        self.assertEqual(w["short"], [[0, 185]])
        self.assertEqual(len(w["long"]), 4)
        self.assertTrue(all(b - a == 60 for a, b in w["long"]))
        self.assertTrue(all(0 <= a and b <= 1800 for a, b in w["long"]))
        self.assertEqual(w["given"], [[100, 130]])

    def test_a_run_breaks_on_a_null_and_on_a_new_window(self) -> None:
        self.assertEqual(
            self.r["runs"],
            [[0, "a", 0, 0.1, 2], [0, "a", 0.3, 0.3, 1], [1, "a", 0.4, 0.4, 1]],
        )

    def test_a_recorded_hit_never_drawn_is_a_miss(self) -> None:
        t = self.r["hitMissed"]["tally"]
        self.assertEqual((t["episodes"], t["drawn"]), (1, 0))
        self.assertEqual(self.r["hitMissed"]["misses"][0]["recorded"], "Ub_HitChestStand")

    def test_a_hit_drawn_just_after_its_state_ends_counts(self) -> None:
        t = self.r["hitLate"]
        self.assertEqual((t["episodes"], t["drawn"]), (1, 1))

    def test_an_action_drawn_under_the_share_fails_the_run(self) -> None:
        self.assertEqual(self.r["hitFails"], ["upper hit: 0 of 5 drawn"])

    def test_a_recorded_run_drawn_standing_is_a_lower_miss(self) -> None:
        low = self.r["lower"]
        self.assertEqual((low["run"]["episodes"], low["run"]["drawn"]), (2, 1))
        self.assertEqual(low["misses"], [[3.0, "Lb_RunForward (run)"]])

    def test_a_far_bots_resting_state_is_excused_only_while_he_is_far(self) -> None:
        s = self.r["lod"]["stand"]
        self.assertGreater(s["excused"], 0)
        self.assertEqual((s["episodes"], s["drawn"]), (1, 1))
        self.assertEqual(self.r["lod"]["misses"], 0)

    def test_an_old_kit_after_a_pickup_fails(self) -> None:
        k = self.r["kit"]
        self.assertEqual([m[:2] for m in k["misses"]], [["German_Scout", "German_Medic"]])
        self.assertEqual(len(k["failures"]), 1)
        self.assertLess(k["kitShare"], 1)

    def test_a_missing_body_fails_unless_a_seek_is_settling(self) -> None:
        b = self.r["body"]
        self.assertEqual(len(b["failures"]), 1)
        self.assertIn("no body for over 2 s", b["failures"][0])
        self.assertEqual(b["settledMisses"], 0)
        self.assertGreaterEqual(b["settledWait"]["max"], 3)


    def test_the_strafe_lean_is_counted_against_the_state_bits(self) -> None:
        lean = self.r["lean"]
        # No lean drawn: five right strafes and a diagonal, none drawn.
        self.assertEqual(5, lean["none"]["right"]["episodes"])
        self.assertEqual(0, lean["none"]["right"]["drawn"])
        self.assertEqual(1, lean["none"]["left"]["episodes"])
        self.assertIn("lean right: 0 of 5 drawn", lean["none"]["failures"])
        # The recorded lean drawn: every one.
        self.assertEqual(5, lean["drawn"]["right"]["drawn"])
        self.assertEqual(1, lean["drawn"]["left"]["drawn"])
        self.assertEqual([], lean["drawn"]["failures"])
        # Legs turned the wrong way are misses.
        self.assertEqual(6, lean["flippedMisses"])
        # A tap too short for the ease to cross over is excused.
        self.assertEqual({"episodes": 0, "drawn": 0, "excused": 1},
                         {k: lean["tap"][k] for k in ("episodes", "drawn", "excused")})


if __name__ == "__main__":
    unittest.main()
