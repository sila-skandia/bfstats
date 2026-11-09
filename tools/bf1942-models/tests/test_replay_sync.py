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

    def test_too_short_even_at_a_twentieth(self) -> None:
        s = self.r["speedTooShort"]
        self.assertFalse(s["ok"])
        self.assertEqual(s["speed"], 0.05)
        self.assertGreater(s["short"], 0)

    def test_a_start_trimmed_close_keeps_the_hit_on_its_time(self) -> None:
        # The owner, 2026-11-09: "the clip gets to it with 17s because I
        # compressed the start". The late stretch alone cannot fill 41 s; it
        # is grown back to the clip's start and slowed over all of it.
        t = self.r["trimmed"]
        self.assertFalse(t["alone"]["ok"])
        self.assertGreater(t["alone"]["short"], 0)
        self.assertTrue(t["ok"])
        self.assertTrue(t["grown"])
        self.assertIsNone(t["in"])
        self.assertAlmostEqual(t["landed"], 41, delta=0.01)
        self.assertGreater(t["speed"], 0.05)
        self.assertLess(t["speed"], 0.15)

    def test_a_longer_stretch_does_not_help_a_clip_too_long_at_normal_speed(self) -> None:
        o = self.r["trimmedOver"]
        self.assertFalse(o["ok"])
        self.assertFalse(o["grown"])
        self.assertGreater(o["over"], 30)


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
        self.assertIn("even at 1/20 from the clip's start", w["slowest"])

    def test_a_worked_out_speed_is_said_as_it_is(self) -> None:
        self.assertEqual(self.r["speedWords"], ["1x", "1/2", "1/4", "1/10", "0.27x", "1/3", "0.24x", "1/20"])

    def test_only_a_worked_out_speed_may_be_off_the_strips_speeds(self) -> None:
        ro = self.r["rampOf"]
        self.assertEqual(ro["fitted"]["speed"], 0.2712)
        self.assertTrue(ro["fitted"]["fit"])
        self.assertEqual(ro["picked"]["speed"], 1)
        self.assertNotIn("fit", ro["picked"])
        self.assertEqual(ro["twentieth"]["speed"], 0.05)
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
        self.assertEqual(self.song["keep"], {"act": "keep", "rate": 1})
        self.assertEqual(self.song["inStep"], {"act": "keep", "rate": 1})

    def test_a_drift_is_closed_by_its_rate_and_a_big_one_by_a_seek(self) -> None:
        # The recorded file's picture follows the clip's clock: a song left on
        # its own ran 0.2 s off the explosion (2026-11-09). The song is a
        # buffer whose rate bends its pitch (2026-11-10), so the pull is at
        # most 3% and a drift over 0.15 s is a crossfaded restart instead.
        self.assertEqual(self.song["limits"], {"seek": 0.15, "pull": 0.03})
        self.assertAlmostEqual(self.song["behind"]["rate"], 1.03, places=3)
        self.assertAlmostEqual(self.song["ahead"]["rate"], 0.97, places=3)
        self.assertEqual(self.song["offABit"]["act"], "keep")
        self.assertEqual(self.song["farBehind"], {"act": "seek", "at": 10})
        self.assertEqual(self.song["frozen"], {"act": "keep", "rate": 1})
        self.assertEqual([round(r, 3) for r in self.song["rates"]], [0.97, 0.97, 1, 1.01, 1.03, 1.03])

    def test_it_starts_in_place_and_stops_with_the_clip(self) -> None:
        self.assertEqual(self.song["start"], {"act": "play", "at": 10})
        self.assertEqual(self.song["paused"], {"act": "pause"})
        self.assertEqual(self.song["beforeClip"], {"act": "pause"})
        self.assertEqual(self.song["pastSong"], {"act": "pause"})

    def test_a_loop_or_a_scrub_puts_it_back_in_place(self) -> None:
        self.assertEqual(self.song["looped"], {"act": "seek", "at": 0})
        self.assertEqual(self.song["scrubbed"], {"act": "seek", "at": 14})


class MoreSlowMotionTests(unittest.TestCase):
    """More than one stretch of slow motion: the victim's circle slowed on
    its own, after the pin's stretch to the hit (2026-11-09)."""

    m: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.m = run_harness()["more"]

    def test_only_whole_stretches_at_the_strips_speeds_are_kept(self) -> None:
        self.assertEqual(self.m["kept"], [{"in": 276, "out": 279, "speed": 0.1}])

    def test_each_stretch_slows_its_own_part(self) -> None:
        self.assertEqual([s[2] for s in self.m["stretches"]], [0.25, 0.1])
        self.assertEqual(self.m["speeds"][0], 0.25)
        self.assertEqual(self.m["speeds"][1], 0.1)
        self.assertIsNone(self.m["speeds"][2])

    def test_a_stretch_after_the_hit_leaves_the_pin_where_it_was(self) -> None:
        self.assertEqual(self.m["hitSame"], 0)
        slowed, plain = self.m["circle"]
        self.assertGreater(slowed, plain * 5)

    def test_where_stretches_overlap_the_slowest_wins(self) -> None:
        # The owner's edit: the circle inside the 1/4 that runs past the hit.
        self.assertEqual(self.m["overlap"], 0.1)
        self.assertEqual(self.m["slower"], [0.5, 0.25, 0.1, 0.1, 0.25])

    def test_more_stretches_alone_still_run_the_clips_clock(self) -> None:
        self.assertTrue(self.m["onlyMore"])
        self.assertFalse(self.m["none"])


class CutAfterCircleTests(unittest.TestCase):
    """A cut after the victim's circle stays after it when slow motion moves
    the moment he goes down (replay-cuts.js `anchorAfter`)."""

    c: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.c = run_harness()["cutAfterCircle"]

    def test_it_is_kept_by_his_going_down(self) -> None:
        self.assertEqual(self.c["at"], {"ev": "down", "dt": 3})

    def test_it_stays_after_the_circle_when_that_moment_moves(self) -> None:
        # He goes down 4 s later than when the cut was added (the slow motion
        # over the hold changed): the cut moves with him.
        self.assertEqual(self.c["keptAfter"], [["shoulder", 263], ["chase", 272], ["victim", 280], ["gamefront", 283]])
        # Kept by the hit, as before, the circle was squeezed to nothing.
        self.assertEqual(self.c["oldWay"], [["shoulder", 263], ["chase", 272], ["victim", 280], ["gamefront", 280]])

    def test_before_the_circle_it_is_kept_by_the_hit_as_ever(self) -> None:
        self.assertEqual(self.c["beforeDown"], {"ev": "hit", "dt": 1.5})
        # Following the circle, a cut is kept by his going down even before it.
        self.assertEqual(self.c["afterChase"], {"ev": "down", "dt": -1})


class SongLaneTests(unittest.TestCase):
    """The Music lane's waveform and drag (replay-music.js)."""

    w: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.w = run_harness()["wave"]

    def test_the_waveform_keeps_the_loudest_of_each_fiftieth(self) -> None:
        self.assertEqual(self.w["length"], 100)
        self.assertAlmostEqual(self.w["quiet"], 0.1, places=2)
        self.assertAlmostEqual(self.w["loud"], 0.8, places=2)
        self.assertEqual(self.w["between"], [0.1, 0.8, 0])

    def test_a_drag_right_starts_the_song_earlier_held_inside_it(self) -> None:
        self.assertEqual(self.w["slid"], [8, 12, 0, 199.5])


class WaitingCameraTests(unittest.TestCase):
    """The camera waiting on a shooter in a hull faces the way the hull
    travels until the shot comes near (replay-roundcam.js `waitingDir`)."""

    w: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.w = run_harness()["waiting"]

    def test_it_follows_the_hull_until_the_shot_comes_near(self) -> None:
        self.assertEqual(self.w["early"], [1, 0, 0])
        self.assertEqual(self.w["setup"], [1, 0, 0])

    def test_it_eases_onto_the_line_of_fire_by_the_shot(self) -> None:
        x, _, z = self.w["half"]
        self.assertAlmostEqual(x, -z, places=2)
        self.assertEqual(self.w["shot"], [0, 0, -1])
        self.assertEqual(self.w["after"], [0, 0, -1])

    def test_a_hull_standing_still_waits_on_the_line_of_fire(self) -> None:
        self.assertEqual(self.w["still"], [0, 0, -1])


class BombLandingTests(unittest.TestCase):
    """A dropped bomb lands at its kill line every play, so a pinned hit is
    the explosion (replay-roundcam.js `landingOf`)."""

    b: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.b = run_harness()["bombLanding"]

    def test_the_mustangs_bomb_lands_on_the_tigers_death_released_as_recorded(self) -> None:
        self.assertEqual(self.b["mustang"], {"landAt": HIT})

    def test_drops_the_page_cannot_have_seen_or_the_server_flew_are_left_alone(self) -> None:
        self.assertIsNone(self.b["tooQuick"])
        self.assertIsNone(self.b["tooLong"])
        self.assertIsNone(self.b["serverFlown"])


if __name__ == "__main__":
    unittest.main()
