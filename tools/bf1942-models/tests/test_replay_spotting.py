"""Artillery spotting in a replay (viewer/replay-spotting.js;
features/replay-feature-sweep-2026-11-01 entry 9, features/artillery-spotting).

One node run (`replay_spotting_harness.mjs`), many assertions. The case is a
small recording written in the harness: a scout who marks twice from one
pooled marker object, an enemy scout, and a gunner of the first scout's side
in an artPos seat. The owner's Battleaxe round is read too when
`viewer/replays` (untracked) is on disk.

What it pins: a recorded marker is its first placed sample (a client's
extrapolated drift and snap back are one mark, not several); the same pooled
object turned to a new rotation is a new mark; the scout is the man 30 m under
the marker's eye; the list is newest first and ends where the recording does;
and spotter.js's selector, run over that list, keeps its retail quirks.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_spotting_harness.mjs"

_cache: dict | None = None


def run_harness() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    _cache = json.loads(proc.stdout)
    return _cache


class ReplaySpottingMarkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.r = run_harness()
        self.m = {m["id"]: m for m in self.r["markers"]}

    def test_drift_and_snap_back_are_one_mark(self) -> None:
        self.assertEqual(len(self.r["markers"]), 3)
        first = self.m[1]
        self.assertEqual(first["birth"], 20)
        # The first sample is the matrix, in the viewer's frame (z negated).
        self.assertEqual(first["eye"], [100, 41.6, -200])

    def test_a_new_rotation_of_the_same_object_is_a_new_mark(self) -> None:
        self.assertEqual(self.m[1]["end"], 40)
        self.assertEqual(self.m[3]["nid"], self.m[1]["nid"])
        self.assertEqual(self.m[3]["birth"], 40)
        self.assertEqual(self.m[3]["end"], 70)

    def test_matrix_axes(self) -> None:
        down = self.m[1]
        self.assertAlmostEqual(down["forward"][1], -1, places=2)
        ahead = self.m[3]
        self.assertGreater(ahead["forward"][0], 0.7)
        self.assertLess(ahead["forward"][1], -0.7)

    def test_owner_is_the_man_under_the_eye(self) -> None:
        self.assertEqual((self.m[1]["owner"], self.m[1]["team"]), (1, 1))
        self.assertEqual((self.m[2]["owner"], self.m[2]["team"]), (2, 2))
        self.assertEqual(self.r["owner"]["under"], {"pid": 7, "team": 1})
        self.assertIsNone(self.r["owner"]["tooFar"])

    def test_ends_where_the_recording_loses_it(self) -> None:
        self.assertEqual(self.m[2]["end"], 50)

    def test_live_list_newest_first(self) -> None:
        live = self.r["live"]
        self.assertEqual(live["15"], [])
        self.assertEqual(live["35"], [2, 1])
        self.assertEqual(live["45"], [3, 2])
        self.assertEqual(live["75"], [])

    def test_a_marker_leaves_the_list_at_its_lifes_end(self) -> None:
        # The recording holds marker 1 to 200 s; its life is 120 s from 10 s.
        e = self.r["expiry"]
        self.assertEqual(e["expiry"], [130, 60])
        self.assertEqual(e["noLife"], 200)
        seen = e["seen"]
        self.assertEqual(seen["25"], [[2, 115], [1, 105]])
        self.assertEqual(seen["60"], [[1, 70]])
        self.assertEqual(seen["129.9"], [[1, 0.1]])
        self.assertEqual(seen["130"], [])
        self.assertEqual(seen["150"], [])
        # Each removal is told once, as it goes (the selector's ending, SPOT-12).
        self.assertEqual(e["removed"], [[2, 1], [1, 0]])

    def test_table_templates_and_lives(self) -> None:
        self.assertEqual(dict(self.r["templates"]),
                         {"binocularsprojectile": 120, "land_spotter_projectile": 180})


class ReplaySpottingSelectorTests(unittest.TestCase):
    """G1 (Axis) in an artPos seat, run through spotter.js's ScoutSelector."""

    def setUp(self) -> None:
        self.s = run_harness()["selector"]

    def test_gate_needs_a_teammates_marker(self) -> None:
        self.assertFalse(self.s["gateBefore"])
        self.assertTrue(self.s["gate"])

    def test_toggle_looks_through_the_newest(self) -> None:
        self.assertTrue(self.s["toggle"])
        self.assertEqual(self.s["on"]["view"], 1)
        self.assertEqual(self.s["on"]["eye"], [100, 41.6, -200])

    def test_gaze_rests_ahead_and_eases_toward_a_shell(self) -> None:
        look = self.s["look"]
        self.assertAlmostEqual(look[0], 100, places=2)
        self.assertAlmostEqual(look[1], 21.6, places=1)
        shell = self.s["lookShell"]
        # A tenth of the way from the rest point toward (150, 10, 200).
        self.assertAlmostEqual(shell[0], 105, places=2)
        self.assertAlmostEqual(shell[2], -160, places=1)

    def test_step_onto_an_enemy_marker_keeps_the_view(self) -> None:
        # SPOT-9: next does not skip an enemy marker; the selection moves and
        # the view stays where it was.
        self.assertTrue(self.s["stepNext"])
        self.assertEqual(self.s["afterNext"]["selected"], 2)
        self.assertEqual(self.s["afterNext"]["view"], 1)

    def test_remark_ends_the_view_and_the_next_toggle_takes_the_new_one(self) -> None:
        self.assertIsNone(self.s["remarked"]["view"])
        self.assertIsNone(self.s["remarked"]["selected"])
        self.assertEqual(self.s["newest"]["view"], 3)
        self.assertEqual(self.s["seconds"], 118)

    def test_toggle_off_and_the_end(self) -> None:
        self.assertIsNone(self.s["off"]["view"])
        self.assertFalse(self.s["end"]["gate"])


class ReplaySpottingRealRoundTests(unittest.TestCase):
    def test_battleaxe_markers(self) -> None:
        real = run_harness().get("battleaxe")
        if real is None:
            self.skipTest("the owner's Battleaxe round is not on disk")
        self.assertEqual(len(real), 8)
        owned = [m for m in real if m["owner"] >= 0]
        self.assertEqual(len(owned), 7)
        # The Priest gunner's side (2) has two markers at 684 s.
        live = [m for m in real if m["birth"] <= 684 < m["end"] and m["team"] == 2]
        self.assertEqual(len(live), 2)

    def test_battleaxe_list_has_no_expired_marker(self) -> None:
        r = run_harness()
        if r.get("battleaxe") is None:
            self.skipTest("the owner's Battleaxe round is not on disk")
        # Marker 4 (placed 468.3 s) is drawn by the recording to 595.2 s; its
        # 120 s life ends at 588.3 s, and the list lets it go there.
        self.assertGreater(r["battleaxeLeastRemaining"], 0)
        self.assertNotIn(468.314, r["battleaxeAt590"])


if __name__ == "__main__":
    unittest.main()
