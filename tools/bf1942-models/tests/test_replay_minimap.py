"""The replay's minimap marks (features/round-replay-minimap): both sides on
the corner map while a round plays back, by the client's own marking rules
otherwise, with the followed player as the ring.

One node run (`replay_minimap_harness.mjs`), many assertions. The case is a
small recording written in the harness; the owner's Bocage round is read too
when `viewer/replays` (untracked) is on disk.

Why it exists. The 2026-09-29 report: "With the round replayer, the mini map
doesn't show anyone on it - like it would when playing in-game. I think it
makes sense to show both teams on the map." The corner map read the page's
own world, which a replay never fills, and so marked the level's parked
vehicles (hidden in the 3D view) and nobody else.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_minimap_harness.mjs"

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


def by_pid(marks: dict) -> dict:
    return {s["pid"]: s for s in marks["soldiers"]}


def by_tmpl(marks: dict) -> dict:
    return {h["tmpl"]: h for h in marks["hulls"]}


class ReplayMinimapTests(unittest.TestCase):
    """At 5 s: A1 (Axis) on foot facing east, B1 (Allied) on foot, B2 driving
    a Sherman with B3 in its seat 1, an empty Tiger, a wrecked Hanomag, a
    Kubelwagen out of range since 2 s, and G1 (Axis) last seen at 3 s."""

    def setUp(self) -> None:
        self.r = run_harness()

    def test_both_sides_on_foot_are_marked(self) -> None:
        men = by_pid(self.r["free"])
        self.assertEqual(men[1]["team"], 1)
        self.assertEqual(men[2]["team"], 2)
        # The viewer's frame is BF1942's with z negated.
        self.assertEqual((men[1]["x"], men[1]["z"]), (100, -50))

    def test_heading_is_the_map_angle(self) -> None:
        men = by_pid(self.r["free"])
        self.assertAlmostEqual(men[1]["angle"], math.pi / 2, places=2)
        self.assertAlmostEqual(men[2]["angle"], 0, places=2)

    def test_a_crewed_hull_is_one_mark_in_its_crews_colour(self) -> None:
        free = self.r["free"]
        # B2 and B3 are aboard: no arrow of their own.
        self.assertNotIn(3, by_pid(free))
        self.assertNotIn(4, by_pid(free))
        shermans = [h for h in free["hulls"] if h["tmpl"] == "Sherman"]
        self.assertEqual(len(shermans), 1)
        self.assertEqual(shermans[0]["team"], 2)
        self.assertAlmostEqual(shermans[0]["angle"], math.pi / 2, places=2)

    def test_an_empty_hull_is_grey_and_a_wreck_is_not_marked(self) -> None:
        hulls = by_tmpl(self.r["free"])
        self.assertEqual(hulls["Tiger"]["team"], 0)
        self.assertNotIn("Hanomag", hulls)

    def test_an_empty_hull_out_of_range_is_not_marked(self) -> None:
        self.assertNotIn("Kubelwagen", by_tmpl(self.r["free"]))

    def test_a_last_sighting_is_faded(self) -> None:
        g1 = by_pid(self.r["free"])[5]
        self.assertFalse(g1["fresh"])
        self.assertEqual((g1["x"], g1["z"]), (0, -300))
        self.assertTrue(by_pid(self.r["free"])[1]["fresh"])

    def test_no_ring_of_its_own_on_a_free_camera(self) -> None:
        self.assertIsNone(self.r["free"]["focus"])

    def test_the_followed_man_is_the_ring(self) -> None:
        follow = self.r["followA1"]
        self.assertEqual((follow["focus"]["x"], follow["focus"]["z"]), (100, -50))
        self.assertAlmostEqual(follow["focus"]["angle"], math.pi / 2, places=2)
        self.assertNotIn(1, by_pid(follow))

    def test_the_followed_crew_is_the_ring_not_their_hull(self) -> None:
        for case in ("followDriver", "followGunner"):
            with self.subTest(case):
                follow = self.r[case]
                self.assertEqual((follow["focus"]["x"], follow["focus"]["z"]), (0, 0))
                self.assertNotIn("Sherman", by_tmpl(follow))
                self.assertNotIn(3, by_pid(follow))
                self.assertNotIn(4, by_pid(follow))

    def test_a_followed_man_out_of_range_leaves_the_ring_to_the_camera(self) -> None:
        follow = self.r["followG1"]
        self.assertIsNone(follow["focus"])
        self.assertFalse(by_pid(follow)[5]["fresh"])

    def test_the_key_follows_the_marks(self) -> None:
        self.assertTrue(self.r["key"]["same"])
        self.assertTrue(self.r["key"]["followChanges"])


class ReplayMinimapRealRoundTests(unittest.TestCase):
    """The owner's Bocage round, when it is on disk."""

    def setUp(self) -> None:
        rounds = run_harness()["rounds"]
        if "replay_20260928-133433" not in rounds:
            raise unittest.SkipTest("the Bocage recording is not on disk")
        self.round = rounds["replay_20260928-133433"]

    def test_both_sides_are_on_the_map(self) -> None:
        for t, moment in self.round["moments"].items():
            with self.subTest(t=t):
                self.assertGreater(moment["soldiers"]["1"] + moment["hulls"]["1"], 0)
                self.assertGreater(moment["soldiers"]["2"] + moment["hulls"]["2"], 0)

    def test_it_is_cheap_enough_for_a_frame(self) -> None:
        self.assertLess(self.round["worstMs"], 8)


if __name__ == "__main__":
    unittest.main()
