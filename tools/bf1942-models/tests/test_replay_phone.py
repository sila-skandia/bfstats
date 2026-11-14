"""A replay on a phone: `viewer/replay-phone.js`, `viewer/shown-walk.js` and
the pixel-ratio cap in `viewer/video-apply.js`, under node through
`replay_phone_harness.mjs`.

features/replay-performance, "Phones". The sentence these tests defend:

    a replay opened on a phone draws lean (no MSAA, a pixel ratio of at most
    1.5, the game's LOW LOD and effects, 30 frames a second) unless the
    visitor chose otherwise, nothing else changes for a desktop or for play,
    and the level's shown-only matrix walk draws exactly what three's draws.

And quality on the fly (`viewer/replay-quality.js`, the runtime cap in
`viewer/video-apply.js`): a replay that cannot hold its frame rate steps down
a rung at a time while each rung buys frames, undoes a rung that bought none
and stops there, reads no frame the page spent busy, never moves a pinned
level, and never raises a setting the viewer chose lower.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_phone_harness.mjs"


def run_harness() -> dict:
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayPhoneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_phone_is_a_coarse_pointer_on_a_small_screen(self) -> None:
        self.assertEqual(self.r["isPhone"], {
            "phone": True, "landscapePhone": True, "tablet": False,
            "laptop": False, "fineSmall": False, "noScreen": False,
        })

    def test_only_a_replay_takes_the_profile_and_the_query_overrides(self) -> None:
        self.assertEqual(self.r["phoneReplay"], {
            "phoneReplay": True, "phonePlay": False, "phoneOptOut": False,
            "laptopReplay": False, "laptopOptIn": True, "tabletReplay": False,
        })

    def test_the_video_is_lows_unless_something_is_stored(self) -> None:
        low = self.r["video"]["nothingStored"]
        self.assertEqual((low["graphicsQuality"], low["effectsQuality"], low["environmentMapping"]), (1, 1, False))
        self.assertEqual((low["lightmaps"], low["textureQuality"], low["viewDistance"]), (True, 3, 75))
        self.assertIsNone(low["displayHeight"])
        self.assertEqual(self.r["video"]["stored"], self.r["video"]["chosen"])

    def test_the_gate_draws_thirty_a_second_at_any_refresh(self) -> None:
        g = self.r["gate"]
        self.assertEqual((g["off60"], g["off120"]), (60, 120))
        self.assertEqual((g["at30on60"], g["at30on90"], g["at30on120"]), (30, 30, 30))
        self.assertEqual(g["at60on60"], 60)
        self.assertEqual(self.r["fps"], {"none": 30, "sixty": 60, "junk": 30})

    def test_the_ratio_cap_holds_only_with_no_display_mode(self) -> None:
        ratio = self.r["ratio"]
        self.assertEqual(ratio["phoneDefault"], 2)
        self.assertEqual(ratio["retinaDefault"], 2)
        self.assertEqual(ratio["phoneCapped"], 1.5)
        self.assertEqual(ratio["phoneModeChosen"], 3)
        self.assertEqual(ratio["phoneOverride"], 3)
        self.assertEqual(ratio["lowDpr"], 1)

    def test_the_shown_walk_draws_what_threes_draws(self) -> None:
        w = self.r["walk"]
        self.assertGreater(w["compared"], 500)
        self.assertEqual(w["worst"], 0)
        self.assertEqual(w["forcedWorst"], 0)
        self.assertLess(w["visitsShown"], w["visitsThree"])
        self.assertTrue(w["idempotent"])

    def test_the_visible_walk_draws_what_threes_draws_on_a_moving_tree(self) -> None:
        w = self.r["visibleWalk"]
        self.assertGreater(w["compared"], 500)
        self.assertGreater(w["reshown"], 20)
        self.assertEqual(w["worst"], 0)
        self.assertLess(w["visitsVisible"], w["visitsThree"])
        self.assertTrue(w["idempotent"])

    def test_the_draw_leaves_out_only_what_lies_wholly_out_of_view(self) -> None:
        c = self.r["drawCull"]
        # ahead, behind, past the far plane, just past it, a ship reaching
        # into view, one hidden already, a kit off to the side.
        self.assertEqual(c["during"], [True, False, False, True, True, False, False])
        self.assertEqual(c["after"], [True, True, True, True, True, False, True])
        self.assertTrue(c["droveIn"])
        self.assertTrue(c["off"])

    def test_a_phone_replay_asks_for_the_largest_audio_buffer(self) -> None:
        l = self.r["latency"]
        self.assertEqual(l["phone"], "playback")
        self.assertIsNone(l["desktop"])
        self.assertEqual(l["asked"], "interactive")
        self.assertEqual(l["seconds"], 0.2)
        self.assertIsNone(l["junk"])
        self.assertEqual(l["constant"], "playback")

    def test_auto_steps_down_while_each_rung_buys_frames(self) -> None:
        g = self.r["governor"]
        self.assertEqual(g["ladder"], ["full", "reduced", "low", "lowest"])
        self.assertEqual(g["gpuBound"]["applied"], ["full", "reduced", "low", "lowest"])
        self.assertEqual(g["enoughAtLow"]["final"], "low")
        self.assertEqual(g["phoneSlow"]["final"], "lowest")
        # A 120 Hz phone drawing every fifth refresh (24 of its 30) steps
        # down, and keeps the rung that lets it keep up; 75 % alone did not.
        self.assertEqual(g["phoneMissing"]["applied"], ["full", "reduced"])
        self.assertEqual(g["phoneMissing"]["final"], "reduced")
        self.assertEqual(g["phoneMissingOldRule"]["applied"], ["full"])
        self.assertEqual(g["crawling"]["applied"], ["full", "reduced", "low", "lowest"])

    def test_a_rung_that_buys_nothing_is_undone_and_auto_stops(self) -> None:
        cpu = self.r["governor"]["cpuBound"]
        self.assertEqual(cpu["applied"], ["full", "reduced", "full"])
        self.assertTrue(cpu["stopped"])

    def test_a_page_at_its_rate_or_busy_or_pinned_is_left_alone(self) -> None:
        g = self.r["governor"]
        for case in ("fast", "phoneFine", "busyOnly"):
            with self.subTest(case):
                self.assertEqual(g[case]["applied"], ["full"])
        self.assertEqual(g["pinned"], {"applied": ["reduced"], "final": "reduced", "stopped": False, "mode": "reduced"})
        self.assertEqual(g["modes"], ["auto", "low", None, None])

    def test_a_recording_pauses_auto_and_it_resumes_after(self) -> None:
        f = self.r["governor"]["filming"]
        self.assertEqual(f["duringPause"], ["full"])
        self.assertEqual(f["after"][:2], ["full", "reduced"])
        self.assertFalse(f["paused"])

    def test_the_cap_lowers_and_never_raises(self) -> None:
        cap = self.r["cap"]
        self.assertEqual(cap["none"]["graphicsQuality"], 2)
        low = cap["low"]
        self.assertEqual((low["graphicsQuality"], low["effectsQuality"], low["environmentMapping"], low["viewDistance"]),
                         (1, 1, False, 75))
        self.assertTrue(low["lightmaps"])
        keep = cap["neverRaises"]
        self.assertEqual((keep["graphicsQuality"], keep["viewDistance"], keep["environmentMapping"]), (1, 60, False))


if __name__ == "__main__":
    unittest.main()
