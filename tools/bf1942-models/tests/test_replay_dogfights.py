"""The round's dogfights on the replay's timeline (features/dogfight-recordings,
"On the replay's timeline").

The owner (2026-11-08): "if there's a fight extracted it shows on the
scrubber, so it takes you to the dogfight school." `replay-dogfights.js` reads
the dogfight index and keeps the rows of the recording(s) the page plays; the
timeline (`replay-timeline.js`) draws each as a span with a plane that links to
`dogfight.html?fight=<id>`. This holds which rows are kept and where they land
on the page's clock: a recording's own clock, or a merged round's through each
member's fit. Run under node through `replay_dogfights_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_dogfights_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayDogfightsTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_recording_is_named_by_its_slug(self) -> None:
        self.assertEqual(self.results["slugs"], ["aaaaaaaaaa", "aaaaaaaaaa", "aaaaaaaaaa", None, None],
                         "a feed link and a file named by its slug; never a dogfight clip")

    def test_one_recording_marks_its_own_dogfights_on_its_own_clock(self) -> None:
        # The bounce is left out, the other recordings' fights too, and a fight
        # running past the end is cut at it.
        self.assertEqual(self.results["single"], [["aaaaaaaaaa-1", 100, 120], ["aaaaaaaaaa-3", 900, 920]])

    def test_a_merged_round_moves_each_members_fights_onto_its_clock(self) -> None:
        self.assertEqual(self.results["merged"], [
            ["aaaaaaaaaa-1", 105, 125],
            ["bbbbbbbbbb-1", 160, 175],
            ["aaaaaaaaaa-3", 905, 935],
        ])

    def test_a_merge_that_fell_back_marks_the_first_recording_only(self) -> None:
        self.assertEqual([f[0] for f in self.results["fellBack"]], ["aaaaaaaaaa-1", "aaaaaaaaaa-3"])

    def test_a_fight_links_to_the_school_on_it(self) -> None:
        # Beside the replay page, wherever the viewer is served from.
        self.assertTrue(self.results["href"].endswith("/viewer/dogfight.html?fight=aaaaaaaaaa-1&mod=bf1942"), self.results["href"])

    def test_a_fight_is_said_as_the_schools_list_says_it(self) -> None:
        self.assertEqual(self.results["title"], "Option_X (Spitfire) v Zincha (Ju88A)")
        self.assertTrue(self.results["sub"].startswith("20 s · turning fight"), self.results["sub"])

    def test_a_clip_and_the_schools_own_map_mark_none(self) -> None:
        self.assertEqual(self.results["clip"], [])
        self.assertEqual(self.results["school"], [])


if __name__ == "__main__":
    unittest.main()
