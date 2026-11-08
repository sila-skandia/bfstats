"""Replay Shorts' kill picker (viewer/replay-shorts-pick.js,
features/replay-shorts): which kills of a recording become Shorts.

A render job films the best few kills of each shared recording as 9:16
Shorts. The picker classes each kill by what the two men were in (air to air,
ground to air, tank to tank, a long shot on foot), titles it from its facts,
keys it so it is never clipped twice, and picks at most three a recording,
one of a kind first and never two of the same moment.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_shorts_pick_harness.mjs"


class ShortsPickTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_a_hull_is_classed_from_the_trees_models(self) -> None:
        # Armour is a land hull of 100 hit points or more that is not a gun on
        # the ground; a jeep is land, a mortar is land whatever its points.
        self.assertEqual(self.r["hullKinds"], ["armour", "armour", "land", "land", "air", "sea", None])

    def test_a_kill_is_classed_by_what_both_men_were_in(self) -> None:
        k = self.r["kinds"]
        self.assertEqual(k["airToAir"], "air-to-air")
        self.assertEqual(k["groundToAir"], "ground-to-air")
        self.assertEqual(k["aaFromFoot"], "ground-to-air")
        self.assertEqual(k["tankToTank"], "tank-to-tank")
        self.assertEqual(k["longShot"], "long-shot")
        # A man on foot who kills a tank (2026-11-09: Arnhem's 30 PIAT kills); a jeep is not one.
        self.assertEqual(k["footOnTank"], "tank-buster")
        # Not worth a Short: armour on a jeep or a mortar, a rifle kill under
        # 100 m, a thrown grenade, a tank on a man on foot.
        for name in ("tankToJeep", "tankToMortar", "shortShot", "longGrenade", "tankOnFoot", "footOnJeep"):
            self.assertIsNone(k[name], name)

    def test_the_key_is_the_apis(self) -> None:
        self.assertEqual(self.r["key"], "xhf8sfkt7k:1664.89:6")

    def test_titles_are_written_from_the_facts(self) -> None:
        self.assertEqual(self.r["levels"], ["Meuse River Line", "El Alamein", "Battle of the Bulge"])
        self.assertEqual(self.r["titles"], [
            "M4A1 kills TIGER at 192 m",
            "Mustang downs Bf109 at 410 m",
            "Bazooka downs Bf109 at 120 m",
            "412 m K98Sniper shot on Bocage",
            "Piat kills Tiger at 43 m",
            # A kill line and its round naming no weapon: no "null" in a title.
            "206 m shot on Omaha Beach",
            # Own goals: a crash, a fall, his own charge (a WASTED Short).
            "Spitfire pilot crashes on Battle of Britain",
            # Spawned and killed within 5 s, the timer's time.
            "Spawned and killed in 0.7 s on Battle of Britain",
            "Spawned and killed by their own side in 5.0 s on Meuse River Line",
            # A round's spawn deaths and own goals are reels.
            "4 men killed within seconds of spawning on Savoy",
            "3 crashes on Battle of Britain",
            "3 crashes, falls and own goals on Meuse River Line",
            "Falls 36 m to their death on Meuse River Line",
            "Blown up by their own Satchel on Meuse River Line",
        ])

    def test_one_of_a_kind_first_never_two_of_one_moment(self) -> None:
        # Best tank kill, the long shot, then the best of the rest that is not
        # the moment already taken (104 s is 4 s after 100 s).
        self.assertEqual(self.r["picked"], [100, 300, 500])
        self.assertEqual(self.r["pickedOne"], [100])
        # Kills already clipped are left out.
        self.assertEqual(self.r["pickedTaken"], [104, 300, 700])


    def test_a_kill_the_recording_does_not_hold_whole_is_left_out(self) -> None:
        # A plane sampled every 0.1 s throughout is whole. One the recorder had
        # out of range for 0.8 s moved 90 m with nothing in between: a hop on
        # screen (the Mustang on Battle of Britain, 2026-11-03). A gap before
        # the stretch the Short shows does not count.
        c = self.r["continuity"]
        self.assertEqual(c["whole"], {"ok": True, "why": None})
        self.assertEqual(c["hop"], {"ok": False, "why": "hops 90 m at 4.9"})
        self.assertEqual(c["hopOutside"], {"ok": True, "why": None})

    def test_own_goals_and_spawn_deaths_are_a_reel_each_never_a_short_each(self) -> None:
        # One alone was too quick, or too forced (the owner, 2026-11-03): a
        # round's three or more are one reel, in time order, keyed on its first
        # with a victim of its own; under three, none. The kills are picked as
        # before and the reel kinds never are.
        r = self.r["reels"]
        self.assertEqual(r["own"], {"key": "s:10.00:-2", "times": [10, 30, 50], "victim": -2})
        self.assertIsNone(r["spawn"])
        self.assertEqual(r["picked"], ["tank-to-tank"])

    def test_a_streak_is_one_lifes_credited_kills(self) -> None:
        # A player's idea (2026-11-04): a streak compilation. A streak ends at
        # his death, by whoever (or nothing) killed him; a teamkill counts
        # for nothing; a streak alive at the round's end has no end.
        self.assertEqual(self.r["streaks"], [
            [1, 3, 4, 5],
            [5, 1, None, None],
            [1, 1, None, None],
            [7, 1, 7, None],
            [9, 1, None, None],
        ])

    def test_a_streak_on_foot_is_its_best_stretches(self) -> None:
        # The owner on ration's 16 on Baytown (2026-11-04): the five longest
        # kills were "awkward, and confusing" and the counter skipped. Kills
        # under 10 s apart are a stretch, one take each; the best fit the
        # budget, in time order, and the kill that ended the streak joins the
        # last kill within 8 s of it, the take running to his death.
        s = self.r["stretches"]
        self.assertEqual([x["kills"] for x in s["ended"]], [[7, 8, 9, 10, 11], [12, 13, 14, 15], [16]])
        self.assertEqual([x["ending"] for x in s["ended"]], [False, False, True])
        self.assertEqual(s["ended"][-1]["t1"], 1121.4)
        # Still going at the round's end: no ending, the same two stretches.
        self.assertEqual([x["kills"] for x in s["alive"]], [[7, 8, 9, 10, 11], [12, 13, 14, 15]])
        # A stretch the recording does not hold him whole over gives way.
        self.assertEqual([x["kills"] for x in s["holed"]], [[3, 4, 5, 6], [12, 13, 14, 15], [16]])

    def test_one_shot_that_kills_two_is_one_part_of_a_player_reel(self) -> None:
        # A shell into a crewed hull writes two kill lines at one moment; as
        # two parts the reel showed the same footage twice (the owner,
        # 2026-11-04). Six kills in four moments: four parts, two of them
        # counting two, and the reel still counts six.
        self.assertEqual(self.r["playerReel"], [{"total": 6, "parts": [[241.83, 1], [290.86, 2], [763.06, 2], [771.4, 1]]}])

    # Battlefield ASMR under fire (the owner, 2026-11-07): the rounds going
    # past a man's head, heard where he is, from many guns.

    def test_the_passes_by_his_head_are_a_moment(self) -> None:
        (m,) = self.r["underFire"]
        self.assertEqual(m["pid"], 2)
        self.assertEqual(m["weapon"], "Mp40")
        # A gun's dummy FireArms beside it is not a second round, and a bot's
        # rounds are never in a Short.
        self.assertEqual(m["weapons"], ["K98", "Mp40"])
        self.assertEqual(m["shooters"], [1, 3])
        self.assertEqual(m["passes"], 25)
        # He died at 8.5 s: the moment ends before it.
        self.assertEqual(m["t1"], 8.1)
        self.assertTrue(m["slowAt"], "it slows a second in or later")

    def test_guns_that_sound_alike_are_one_family(self) -> None:
        self.assertEqual(self.r["families"], [True, True, False, True])

    def test_the_week_sets_two_under_fire_moments_between_its_pieces(self) -> None:
        w = self.r["week"]
        self.assertEqual(w["automatic"], [
            "automatic:a:10", "automatic:b:10", "under-fire:a:300",
            "automatic:a:100", "under-fire:a:500", "automatic:b:100",
        ])
        # Two from one round is too few for a mix of its own.
        self.assertIsNone(w["underFire"])
        # A gun not heard yet before a second MG34.
        self.assertEqual(w["whips"], ["under-fire:a:300", "under-fire:a:500"])

    # Battlefield ASMR, the arsenal (the owner, 2026-11-07): the week's guns,
    # each kind its share, a gun not heard yet first.
    def test_the_arsenal_gives_each_kind_its_share(self) -> None:
        # Three big guns at most (the StuG's is a fourth), three a round
        # (round a's MG34 is a fourth there), and a clip with no object to
        # cut out (its nid unknown) is not a gun the range can film.
        self.assertEqual(self.r["arsenal"]["picked"], [
            "cannon:a:TigerCannon", "cannon:a:PantherCannon", "cannon:a:ShermanCannon",
            "automatic:b:MG34_bowMG", "automatic:b:Browning_BowMG", "automatic:b:BesaCoax",
        ])

    def test_an_arsenal_beat_is_cut_from_its_first_shot(self) -> None:
        # 0.8 s before its first shot, 4.5 s in all (its last shot at +9).
        self.assertEqual(self.r["arsenal"]["window"], [99.2, 103.7])


if __name__ == "__main__":
    unittest.main()
