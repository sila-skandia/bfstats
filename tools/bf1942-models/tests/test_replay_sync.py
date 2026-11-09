"""The hit pinned to a time of the video (features/replay-creator-view, "The
hit on a beat"): a creator cutting a clip to music wants the round to strike
on the drums, and the studio works out where the clip starts or how slow its
slow motion plays so it does.

Why it exists. 2026-11-09: a creator cutting a promo to Gimme Shelter wanted
skandia's Mustang bomb on a Tiger (Bocage, `wxprh7ze6n`) to blow the tank up
at 0:41, where the drums come in, with the riff over the Mustang in slow
motion. Working backwards from that to a start frame by hand was the hard
part. One node run (`replay_sync_harness.mjs`), the round's real moments.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_sync_harness.mjs"
HIT = 273.486

_cache: dict | None = None


def run_harness() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300, cwd=HARNESS.parent)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    _cache = json.loads(proc.stdout)
    return _cache


class StartMovesTests(unittest.TestCase):
    """The slow motion held, the clip's start worked out."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_whole_riff_at_a_quarter_starts_ten_seconds_back(self) -> None:
        w = self.r["wholeRiff"]
        self.assertTrue(w["ok"])
        self.assertAlmostEqual(w["landed"], 41, delta=0.01)
        # 41 s of video at 1/4 is 10.25 s of the round, a little more for the
        # ease into the slow motion at the clip's start.
        self.assertGreater(HIT - w["t0"], 10.25)
        self.assertLess(HIT - w["t0"], 10.6)

    def test_slow_motion_kicking_in_late_runs_the_rest_at_normal_speed(self) -> None:
        late = self.r["lateSlow"]
        self.assertTrue(late["ok"])
        self.assertAlmostEqual(late["landed"], 41, delta=0.01)
        # Before the slow motion the clip runs at normal speed: one second of
        # the round is one of the video.
        self.assertAlmostEqual(HIT - 3 - late["t0"], 41 - late["slowPart"], delta=0.02)

    def test_the_kill_shots_bullet_time_alone_lands_too(self) -> None:
        b = self.r["bulletTime"]
        self.assertTrue(b["ok"])
        self.assertAlmostEqual(b["landed"], 41, delta=0.01)

    def test_a_round_that_does_not_go_back_far_enough_says_by_how_much(self) -> None:
        short = self.r["tooShort"]
        self.assertFalse(short["ok"])
        self.assertGreater(short["short"], 20)
        self.assertAlmostEqual(short["t0"], HIT - 5, places=2)

    def test_a_time_too_soon_would_start_after_the_shot(self) -> None:
        soon = self.r["tooSoon"]
        self.assertFalse(soon["ok"])
        self.assertGreater(soon["over"], 0)
        # Never later than 0.3 s before the bomb leaves.
        self.assertAlmostEqual(soon["t0"], 271.952 - 0.3, places=2)


class SpeedWorkedOutTests(unittest.TestCase):
    """The clip's start held, the slow stretch's speed worked out."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_start_held_finds_the_speed_that_lands_it(self) -> None:
        s = self.r["speed"]
        self.assertTrue(s["ok"])
        self.assertAlmostEqual(s["landed"], 41, delta=0.01)
        self.assertGreater(s["speed"], 0.2)
        self.assertLess(s["speed"], 0.3)

    def test_too_long_even_at_normal_speed(self) -> None:
        s = self.r["speedTooLong"]
        self.assertFalse(s["ok"])
        self.assertEqual(s["speed"], 1)
        self.assertAlmostEqual(s["over"], (HIT - 200) - 41, delta=0.05)

    def test_too_short_even_at_a_tenth(self) -> None:
        s = self.r["speedTooShort"]
        self.assertFalse(s["ok"])
        self.assertEqual(s["speed"], 0.1)
        self.assertGreater(s["short"], 0)


class PinWordsTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_pin_is_read_back_or_refused(self) -> None:
        held, odd, other, negative, none = self.r["syncOf"]
        self.assertEqual(held, {"ev": "hit", "at": 41, "hold": "start", "auto": True})
        self.assertEqual(odd["hold"], "slow")
        self.assertIsNone(other)
        self.assertIsNone(negative)
        self.assertIsNone(none)

    def test_times_are_typed_the_way_people_write_them(self) -> None:
        self.assertEqual(self.r["parse"], [41, 41, 41.5, 62, 41.25, None, None, None, None, None])
        self.assertEqual(self.r["videoTime"], ["0:41.0", "0:41.0", "0:10.0", "1:02.5", "0:00.0"])

    def test_the_pin_says_what_is_wrong_and_what_to_do(self) -> None:
        w = self.r["words"]
        self.assertEqual(w["ok"], "The hit lands at 0:41.0")
        self.assertIn("Short by 3.2 s", w["short"])
        self.assertIn("start before the shot", w["soon"])
        self.assertIn("no hit", w["missing"])
        self.assertIn("Too long by 32.5 s even at normal speed", w["long"])
        self.assertIn("even at 1/10", w["slowest"])

    def test_a_worked_out_speed_is_said_as_it_is(self) -> None:
        self.assertEqual(self.r["speedWords"], ["1x", "1/2", "1/4", "1/10", "0.27x", "1/3", "0.24x"])

    def test_only_a_worked_out_speed_may_be_off_the_strips_speeds(self) -> None:
        ro = self.r["rampOf"]
        self.assertEqual(ro["fitted"]["speed"], 0.2712)
        self.assertTrue(ro["fitted"]["fit"])
        self.assertEqual(ro["picked"]["speed"], 1)
        self.assertNotIn("fit", ro["picked"])
        self.assertEqual(ro["tooSlow"]["speed"], 1)


class SongTests(unittest.TestCase):
    """The song a creator hears the clip with (replay-music.js)."""

    song: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.song = run_harness()["song"]

    def test_the_song_runs_from_its_offset_as_the_clip_plays(self) -> None:
        self.assertEqual(self.song["positions"], [None, 0, 41, 53.5, None])

    def test_it_is_left_alone_while_it_plays_along(self) -> None:
        self.assertEqual(self.song["keep"], {"act": "keep"})

    def test_it_starts_in_place_and_stops_with_the_clip(self) -> None:
        self.assertEqual(self.song["start"], {"act": "play", "at": 10})
        self.assertEqual(self.song["paused"], {"act": "pause"})
        self.assertEqual(self.song["beforeClip"], {"act": "pause"})
        self.assertEqual(self.song["pastSong"], {"act": "pause"})

    def test_a_loop_or_a_scrub_puts_it_back_in_place(self) -> None:
        self.assertEqual(self.song["looped"], {"act": "seek", "at": 0})
        self.assertEqual(self.song["scrubbed"], {"act": "seek", "at": 14})


if __name__ == "__main__":
    unittest.main()
