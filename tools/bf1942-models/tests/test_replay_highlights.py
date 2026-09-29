"""The round replay's highlights (features/round-replay-highlights): kill
streaks and medals, battles found in the recording, who stands apart from his
side, the Auto camera's director and the round's top plays.

One node run (`replay_highlights_harness.mjs`), many assertions. The cases are
small recordings written line by line in the harness; the owner's real rounds
are checked too when `viewer/replays` (untracked) is on disk.

Why it exists. The 2026-09-27 request, after the replay's redesign: name tags
only in the vicinity, and a way to find what is worth watching in a round --
"how do we highlight battles within the map", "if someone is on a streak how
do we identify that and allow them to follow that player", "maybe monitoring
by vehicle", hot spots on a map you can click around, "lone wolfs or people
well outside the battle area".
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "replay_highlights_harness.mjs"

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


class ReplayMedalTests(unittest.TestCase):
    """A1 kills three in 7 s, dies to B1, then A2 knifes B1, B2 makes a 150 m
    rifle kill and B3's mine kills A1 200 m away."""

    medals: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.medals = run_harness()["medals"]

    def test_a_streak_is_the_kills_of_one_life(self) -> None:
        self.assertEqual(self.medals["streakA1"], [0, 1, 2, 3, 3, 0])
        self.assertEqual(self.medals["bestA1"], 3)

    def test_the_rounds_medals(self) -> None:
        self.assertEqual([tuple(m) for m in self.medals["list"]], [
            (10, "A1", "firstblood", "First blood", None),
            (13, "A1", "multi", "Double kill", 2),
            (17, "A1", "multi", "Triple kill", 3),
            (17, "A1", "streak", "Killing spree", 3),
            (17, "A1", "leader", "Kill leader", 3),
            (30, "B1", "shutdown", "Shutdown", 3),
            (30, "B1", "revenge", "Revenge", None),
            (40, "A2", "knife", "Cold steel", None),
            (50, "B2", "longshot", "Long shot", 150),
            (60, "B3", "revenge", "Revenge", None),
        ])

    def test_a_mine_kill_is_no_long_shot(self) -> None:
        self.assertFalse(any(m[2] == "longshot" and m[0] == 60 for m in self.medals["list"]))

    def test_first_blood_needs_the_round_to_start_in_the_recording(self) -> None:
        self.assertFalse(self.medals["joinedFirstBlood"])

    def test_the_kill_leader_needs_three(self) -> None:
        self.assertEqual(self.medals["leader"], [None, 1, 1])

    def test_medals_in_words(self) -> None:
        self.assertEqual(self.medals["describe"], [
            "2 kills in 3.0 s [Mp40]", "3 kills in 7.0 s [Mp40]", "ended A1's streak of 3", "150 m [K98Sniper]",
        ])

    def test_one_play_per_moment_named_by_its_rarest_medal(self) -> None:
        plays = [(p[0], p[1], tuple(p[2])) for p in self.medals["plays"]]
        self.assertEqual(plays[0], ("A1", "Triple kill", ("firstblood", "leader", "multi", "streak")))
        self.assertIn(("B1", "Shutdown", ("revenge", "shutdown")), plays)
        # A lone revenge is too small a play to be a highlight.
        self.assertNotIn("B3", [p[0] for p in plays])


class ReplayBattleTests(unittest.TestCase):
    """Two men trading fire at one place, one man firing alone at another, a
    beached landing craft losing points, a tank taking one hit."""

    battles: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.battles = run_harness()["battles"]

    def test_a_fight_is_a_contested_battle_where_it_burned(self) -> None:
        fight = self.battles["fight"]
        self.assertIsNotNone(fight)
        self.assertTrue(fight["contested"])
        self.assertEqual(fight["pids"], [1, 2])
        # Between the two men, in the viewer's frame (z negated).
        self.assertLess(abs(fight["pos"][0] - 115), 12)
        self.assertLess(abs(fight["pos"][2] + 100), 12)
        self.assertEqual(fight["trackKills"], 1)

    def test_one_side_firing_is_gunfire_and_a_battle_of_its_own(self) -> None:
        self.assertIsNotNone(self.battles["lone"])
        self.assertFalse(self.battles["lone"]["contested"])
        self.assertTrue(self.battles["distinct"])

    def test_a_fight_ends_when_the_firing_stops(self) -> None:
        self.assertTrue(self.battles["fightOver"])

    def test_a_hulls_steady_loss_is_no_fight_and_a_hit_is_the_other_sides(self) -> None:
        self.assertEqual(self.battles["drainEvents"], 0)
        self.assertEqual(self.battles["kinds"]["hullHit"], 1)
        self.assertEqual(self.battles["tankHitTeam"], 1)

    def test_shots_count_per_shooter_per_half_second(self) -> None:
        # The riflemen's 41 and 39 rounds are 21 and 20 half-seconds of fire,
        # the sniper's 81 rounds half a second apart are 81.
        self.assertEqual(self.battles["kinds"]["shot"], 21 + 20 + 81)
        self.assertEqual(self.battles["kinds"]["kill"], 1)

    def test_places_in_words(self) -> None:
        self.assertEqual(self.battles["compass"], ["N", "E", "S", "NW"])
        self.assertEqual(self.battles["places"], ["Village", "N of Landing Beach", "Open ground"])

    def test_the_timelines_heat_peaks_with_the_kill(self) -> None:
        self.assertEqual(self.battles["intensityPeak"], 15)


class ReplayVehicleTests(unittest.TestCase):
    """A Tiger with a driver and a gunner kills at 10 s and is destroyed at
    20 s; an empty Sherman stands by."""

    vehicles: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.vehicles = run_harness()["vehicles"]

    def test_the_crewed_vehicles_with_their_kills(self) -> None:
        self.assertEqual(self.vehicles["at5"], [{"tmpl": "Tiger", "crew": [[1, 0], [2, 1]], "kills": 0, "hp": 100}])
        self.assertEqual(self.vehicles["at16"], [{"tmpl": "Tiger", "crew": [[1, 0], [2, 1]], "kills": 1, "hp": 40}])

    def test_a_wreck_is_no_vehicle_in_play(self) -> None:
        self.assertEqual(self.vehicles["at21"], [])


class ReplayStandoutTests(unittest.TestCase):
    standouts: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.standouts = run_harness()["standouts"]

    def test_standouts_read_in_pieces_are_the_same(self) -> None:
        # The page reads them a few seconds at a time between frames
        # (replay-highlights.js `readStandouts`): in one piece, a 45-minute
        # round froze the view for seconds.
        stepped = self.standouts["stepped"]
        self.assertTrue(stepped["same"])
        self.assertEqual(stepped["pauses"], stepped["seconds"] // 4)

    def test_a_lone_wolf_after_five_seconds_alone(self) -> None:
        self.assertEqual(self.standouts["lone"], [None, "lone"])
        self.assertEqual(self.standouts["loneDetail"], {"d": 200})

    def test_behind_enemy_lines_at_their_flag(self) -> None:
        self.assertEqual(self.standouts["behind"], "behind")
        self.assertEqual(self.standouts["behindDetail"], {"d": 30, "point": "Enemy_Flag"})

    def test_far_from_the_fight_once_past_his_spawn(self) -> None:
        self.assertEqual(self.standouts["far"], [None, "far"])

    def test_a_pilot_is_none_of_them(self) -> None:
        self.assertEqual(self.standouts["pilot"], [None, None])

    def test_a_man_fighting_with_nobody_of_his_near_is_a_lone_wolf(self) -> None:
        self.assertEqual(self.standouts["fighting"], ["lone", "lone"])

    def test_out_of_range_is_last_seen_and_then_unknown(self) -> None:
        live, lost, gone = self.standouts["ghost"]
        self.assertEqual(live, {"fresh": True, "pos": [500, 0, -500], "seen": 5})
        self.assertEqual(lost, {"fresh": False, "pos": [500, 0, -500], "seen": 12})
        self.assertEqual(gone, {"fresh": False, "pos": None, "seen": None})

    def test_headings_on_the_ground(self) -> None:
        # A vehicle and a soldier both face -Z in the viewer's frame (the half
        # turn a soldier's pose glb carries is the model's, not the
        # recording's); a quarter turn about +Y points either along +X.
        self.assertEqual(self.standouts["heading"], [[0, -1], [0, -1], [1, 0], [1, 0]])


class ReplayDirectorTests(unittest.TestCase):
    director: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.director = run_harness()["director"]

    def test_the_director_waits_on_the_recording_player_then_cuts_ahead_of_kills(self) -> None:
        picks = self.director["picks"]
        self.assertEqual(picks[0][1], "Q1")
        self.assertEqual(picks[1][1], "Q2")
        # After his six seconds on the first pick, and before Q2's kill at 10 s.
        self.assertGreaterEqual(picks[1][0], 7)
        self.assertLess(picks[1][0], 10)
        # Y is taken before he kills Q2 at 20 s.
        self.assertEqual(picks[2][1], "Y")
        self.assertLess(picks[2][0], 20)

    def test_a_seek_starts_afresh(self) -> None:
        self.assertEqual(self.director["afterSeek"], 1)

    def test_a_dead_pick_is_held_then_his_killer_followed(self) -> None:
        death = self.director["death"]
        self.assertEqual(death[0][1], "Q2")
        self.assertEqual(death[1][1], "Y")
        self.assertEqual(death[1][2], "the man who killed him")
        self.assertGreaterEqual(death[1][0], 22.8)
        self.assertLess(death[1][0], 23.3)
        self.assertTrue(self.director["interestDead"])


class ReplayOwnersRoundsTests(unittest.TestCase):
    """The owner's recorded rounds, when they are on disk."""

    rounds: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.rounds = run_harness()["rounds"]

    def round(self, name: str) -> dict:
        if name not in self.rounds:
            self.skipTest(f"{name} is not in viewer/replays")
        return self.rounds[name]

    def test_wake_coop_triple_kill_and_spree(self) -> None:
        wake = self.round("replay_20260927-075756")
        self.assertEqual((wake["kills"], wake["placed"]), (28, 28))
        self.assertIn([74.7, "Yukiji Adachi", "Triple kill"], wake["medals"])
        self.assertIn([74.7, "Yukiji Adachi", "Killing spree"], wake["medals"])
        self.assertIn("Triple kill", [p[2] for p in wake["plays"] if p[1] == "Yukiji Adachi"])
        self.assertLess(wake["ms"], 1500)

    def test_kursk_battles_round_work_camp(self) -> None:
        kursk = self.round("replay_20260927-140921")
        self.assertEqual(kursk["kills"], 28)
        self.assertGreaterEqual(kursk["placed"], 24)
        self.assertGreaterEqual(kursk["contested"], 5)
        self.assertTrue(any("Work_Camp" in place for place in kursk["hottest"]), kursk["hottest"])
        self.assertLess(kursk["ms"], 1500)


class ReplayHighlightsWiringTests(unittest.TestCase):
    """The page hands the battle map what it draws, and the name tags keep to
    the players round the camera."""

    def test_the_page_hands_the_replay_its_map(self) -> None:
        page = (VIEWER / "map.html").read_text()
        for accessor in ("mapArt:", "mapProjection:", "viewDistance:"):
            self.assertIn(accessor, page)

    def test_name_tags_are_for_the_vicinity(self) -> None:
        ui = (VIEWER / "replay-ui.js").read_text()
        self.assertIn("TAG_NEAR", ui)
        self.assertNotIn("TAG_RANGE", ui)


if __name__ == "__main__":
    unittest.main()
