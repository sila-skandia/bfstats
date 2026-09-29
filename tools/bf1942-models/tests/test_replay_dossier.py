"""A player's dossier in the round replay (replay-dossier.js): the recorded
round that made each kill, how far each kill was, and one player's round
sliced into his streaks, longest shots, multi-kills, vehicles destroyed,
deaths and weapons, each row a moment the replay can jump to.

One node run (`replay_dossier_harness.mjs`), many assertions. The cases are
small recordings written line by line in the harness; the owner's real rounds
are checked too when `viewer/replays` (untracked) is on disk.

Why it exists. A content creator watching a replay clicks a player and wants
that player's round laid out to cut from: his kill streaks, his longest shots
ordered by distance, his multi-kills, the vehicles he destroyed, his deaths
and his weapons. A kill line names only the killer and his weapon, so the
distance of a kill is read off the recorded round that made it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "replay_dossier_harness.mjs"

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


class ReplayKillingRoundTests(unittest.TestCase):
    """Duels far apart, each pinning one rule of how a kill's round is
    found (the harness's cases (a) to (l))."""

    rounds: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.rounds = run_harness()["rounds"]

    def round(self, name: str) -> dict | None:
        return self.rounds[name]["round"]

    def test_of_a_burst_the_round_that_pointed_at_him(self) -> None:
        r = self.round("burst")
        self.assertEqual((r["weapon"], r["t"], r["kind"]), ("Thompson", 9.8, "direct"))
        self.assertAlmostEqual(r["angle"], 0.5, delta=0.05)
        self.assertAlmostEqual(r["distance"], 30, delta=0.1)

    def test_age_costs_two_degrees_a_second(self) -> None:
        # 0.5 degrees 1.5 s before scores 3.5; 2 degrees 0.1 s before, 2.2.
        self.assertEqual(self.round("age")["t"], 19.9)

    def test_a_round_more_than_twelve_degrees_off_is_not_his(self) -> None:
        self.assertIsNone(self.round("wide"))
        # The kill still has the distance between the two men.
        self.assertEqual(self.rounds["wide"]["fact"]["distance"], 30)

    def test_a_vehicle_kill_is_its_own_guns_named_after_it(self) -> None:
        # The kill names `PanzerIV`, the round `PanzerIVGunBarrel`: the
        # barrel's, though the coaxial gun's round points closer.
        r = self.round("prefix")
        self.assertEqual((r["weapon"], r["t"]), ("PanzerIVGunBarrel", 39.5))
        self.assertEqual(self.rounds["prefix"]["fact"]["from"], "vehicle")

    def test_without_a_round_of_its_weapon_any_he_fired(self) -> None:
        # The barrel's round 4 s old: the coaxial gun's, which names no tank.
        self.assertEqual(self.round("coaxial")["weapon"], "Coaxial_MG42")

    def test_a_grenade_is_the_throw_its_fuse_fits(self) -> None:
        # Thrown 3 s and 1 s before the kill: the first, not the latest.
        r = self.round("grenade")
        self.assertEqual((r["weapon"], r["t"], r["kind"]), ("GrenadeAxis", 57, "thrown"))

    def test_a_mine_has_no_round(self) -> None:
        self.assertIsNone(self.round("landmine"))
        self.assertEqual(self.rounds["landmine"]["fact"]["distance"], 5)

    def test_a_round_is_turned_into_the_viewers_frame(self) -> None:
        # Along +z in BF1942's frame, at a man at -z in the viewer's: his.
        r = self.round("plus z")
        self.assertLess(r["angle"], 0.1)
        self.assertAlmostEqual(r["distance"], 60, delta=0.1)
        # The same round at a man behind him: not his.
        self.assertIsNone(self.round("minus z"))

    def test_the_last_thing_a_plane_fired_decides(self) -> None:
        # Its guns, then its bomb: the bomb.
        r = self.round("mustang")
        self.assertEqual((r["weapon"], r["t"], r["kind"]), ("MustangBombDummy", 79, "bomb"))
        # Its bomb, then its guns: the guns, the later of two as close.
        r = self.round("bf109")
        self.assertEqual((r["weapon"], r["t"], r["kind"]), ("BF109Guns", 89.8, "direct"))

    def test_of_a_stick_of_bombs_the_latest_that_had_fallen(self) -> None:
        # Released 0.12 and 0.39 s before the kill: too soon to have hit.
        r = self.round("b17")
        self.assertEqual((r["weapon"], r["t"], r["kind"]), ("B17BombRack", 95.54, "bomb"))

    def test_a_man_out_of_range_has_the_latest_round_and_no_distance(self) -> None:
        r = self.round("unseen")
        self.assertEqual((r["weapon"], r["t"]), ("K98Sniper", 104.5))
        self.assertIsNone(r["angle"])
        self.assertIsNone(r["distance"])
        fact = self.rounds["unseen"]["fact"]
        self.assertIsNone(fact["distance"])
        self.assertFalse(fact["fresh"])

    def test_rounds_point_at_his_chest(self) -> None:
        # From 3 m a point 0.3 m over his feet is 17 degrees below the round.
        r = self.round("point blank")
        self.assertEqual(r["weapon"], "Colt")
        self.assertLess(r["angle"], 1)
        self.assertEqual(self.rounds["point blank"]["fact"]["distance"], 3)

    def test_a_man_just_out_of_a_vehicle_is_not_placed(self) -> None:
        rejoin = self.rounds["rejoin"]
        # The recording has him live where he got in, 693 m off ...
        self.assertEqual(rejoin["whereIs"], {"fresh": True, "ground": 693})
        # ... which the dossier does not take: no distance, the round by time.
        self.assertIsNone(rejoin["fact"]["distance"])
        self.assertFalse(rejoin["fact"]["fresh"])
        self.assertEqual(rejoin["round"]["weapon"], "Thompson")
        self.assertIsNone(rejoin["round"]["distance"])


class ReplayDossierTests(unittest.TestCase):
    """Hero's round: a triple kill in a streak of four Nemo ends, a team
    kill, a 150 m snipe in a double kill his suicide ends, a grenade kill, a
    kill line naming himself, and two more deaths."""

    dossier: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.dossier = run_harness()["dossier"]

    def test_the_summary(self) -> None:
        self.assertEqual((self.dossier["name"], self.dossier["team"]), ("Hero", 1))
        self.assertEqual(self.dossier["summary"], {
            "kills": 8, "deaths": 5, "teamkills": 1, "suicides": 2, "ratio": 1.6, "bestStreak": 4,
            "longest": 150, "vehicles": 2, "rounds": 10,
            "favourite": {"weapon": "Thompson", "name": "Thompson SMG", "kills": 5},
            "nemesis": {"pid": 5, "name": "Nemo", "kills": 2},
            "prey": {"pid": 2, "name": "Vic", "kills": 5},
        })

    def test_a_streak_is_a_life_and_names_what_ended_it(self) -> None:
        streaks = self.dossier["streaks"]
        self.assertEqual([(s["n"], s["t0"], s["t1"], s["kills"]) for s in streaks],
                         [(4, 10, 30, [10, 13, 17, 30]), (2, 60, 64, [60, 64])])
        self.assertEqual(streaks[0]["end"], {"t": 40, "kind": "kill", "by": 5, "byName": "Nemo",
                                             "weapon": "Thompson", "weaponName": "Thompson SMG"})
        # His own death ends one too: no killer to name.
        self.assertEqual(streaks[1]["end"], {"t": 70, "kind": "death", "by": None, "byName": None,
                                             "weapon": None, "weaponName": None})

    def test_multi_kills_most_first(self) -> None:
        self.assertEqual([(m["n"], m["t0"], m["t1"], m["label"], m["kills"]) for m in self.dossier["multis"]],
                         [(3, 10, 17, "Triple kill", [10, 13, 17]), (2, 60, 64, "Double kill", [60, 64])])

    def test_longest_shots_farthest_first_and_aimed(self) -> None:
        # Not the grenade kill (25 m), nor the team kill 200 m off.
        self.assertEqual([tuple(r) for r in self.dossier["longest"]], [
            (60, "Vic", "K98Sniper", 150), (30, "Vic", "Thompson", 90), (13, "Val", "Thompson", 45),
            (64, "Vic", "K98Sniper", 30), (10, "Vic", "Thompson", 20), (95, "Vera", "Thompson", 12),
            (17, "Vera", "Thompson", 8),
        ])

    def test_his_kills_in_time_order_the_team_kill_flagged(self) -> None:
        kills = self.dossier["kills"]
        self.assertEqual([k[0] for k in kills], [10, 13, 17, 20, 30, 60, 64, 80, 95])
        self.assertEqual([k[0] for k in kills if k[6]], [20])
        self.assertEqual(kills[3][:4], [20, "Mate", "Thompson", 200])
        # Weapons as the game shows them, what he was in, the round's kind.
        self.assertEqual(kills[5][4:], ["Kar98k scope", "foot", False, "direct"])
        self.assertEqual(kills[7][3:], [25, "GrenadeAxis", "foot", False, "thrown"])

    def test_every_death_of_every_kind(self) -> None:
        deaths = [(d["t"], d["kind"], d["killer"], d["killerName"], d["weapon"], d["distance"]) for d in self.dossier["deaths"]]
        self.assertEqual(deaths, [
            (40, "kill", 5, "Nemo", "Thompson", 30),
            (70, "death", None, None, None, None),
            (85, "kill", 1, "Hero", "GrenadeAxis", None),
            (90, "kill", 3, "Val", "M1Garand", 40),
            (100, "kill", 5, "Nemo", "Thompson", 30),
        ])

    def test_his_weapons(self) -> None:
        self.assertEqual(self.dossier["weapons"], [
            {"weapon": "Thompson", "name": "Thompson SMG", "kills": 5, "longest": 90},
            {"weapon": "K98Sniper", "name": "Kar98k scope", "kills": 2, "longest": 150},
            {"weapon": "GrenadeAxis", "name": "GrenadeAxis", "kills": 1, "longest": 25},
        ])

    def test_vehicles_destroyed_not_his_own_sides(self) -> None:
        self.assertEqual(self.dossier["vehicles"], [
            {"t": 50, "tmpl": "Sherman", "name": "M4 Sherman", "crew": 1},
            {"t": 54, "tmpl": "Willys", "name": "Willys", "crew": 0},
        ])

    def test_his_medals_each_in_its_final_form(self) -> None:
        # The triple kill, not the double it grew from at 13 s.
        self.assertEqual([tuple(m) for m in self.dossier["medals"]], [
            (10, "First blood"), (17, "Triple kill"), (17, "Killing spree"), (17, "Kill leader"),
            (50, "Destroyed"), (54, "Destroyed"), (60, "Long shot"), (64, "Double kill"),
        ])

    def test_one_row_per_kill_in_every_list(self) -> None:
        self.assertTrue(self.dossier["shared"])

    def test_facts_are_for_kill_lines_with_a_killer_not_the_victim(self) -> None:
        # Not his fall at 70 s nor the kill line naming himself at 85 s.
        times = [line[0] for line in self.dossier["factLines"]]
        self.assertEqual(times, [10, 13, 17, 20, 30, 40, 60, 64, 80, 90, 95, 100])

    def test_a_life_the_round_ended_has_no_end(self) -> None:
        nemo = self.dossier["nemo"]
        self.assertEqual(nemo["streaks"], [[2, 40, 100, None]])
        self.assertEqual(nemo["summary"]["prey"], {"pid": 1, "name": "Hero", "kills": 2})
        self.assertIsNone(nemo["summary"]["nemesis"])

    def test_a_player_with_nothing(self) -> None:
        nobody = self.dossier["nobody"]
        self.assertEqual(nobody["name"], "player 99")
        self.assertEqual(nobody["lists"], [0] * 8)
        self.assertEqual(nobody["summary"]["ratio"], 0)
        self.assertIsNone(nobody["summary"]["favourite"])

    def test_without_facts_it_reads_them(self) -> None:
        self.assertEqual(self.dossier["ownFacts"], 150)


class ReplayDossierIdTests(unittest.TestCase):
    """Omen kills Xan twice and leaves; Niconan joins under his id and kills
    Xan once."""

    reuse: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.reuse = run_harness()["reuse"]

    def test_the_ids_last_holder_by_default(self) -> None:
        last = self.reuse["last"]
        self.assertEqual((last["name"], last["kills"], last["rounds"]), ("Niconan", [50], 1))
        self.assertIsNone(last["prey"])

    def test_the_holder_at_a_time(self) -> None:
        first = self.reuse["first"]
        self.assertEqual((first["name"], first["kills"], first["rounds"]), ("Omen", [10, 20], 2))
        self.assertEqual(first["prey"], {"pid": 8, "name": "Xan", "kills": 2})

    def test_a_nemesis_is_a_player_not_an_id(self) -> None:
        # Three kills by pid 7, two of them Omen's.
        xan = self.reuse["xan"]
        self.assertEqual(xan["deaths"], 3)
        self.assertEqual(xan["nemesis"], {"pid": 7, "name": "Omen", "kills": 2})


class ReplayDossierOwnersRoundsTests(unittest.TestCase):
    """The owner's recorded rounds, when they are on disk."""

    real: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.real = run_harness()["real"]

    def round(self, name: str) -> dict:
        if name not in self.real:
            self.skipTest(f"{name} is not in viewer/replays")
        return self.real[name]

    def test_the_killing_round_of_most_kills_found_fast(self) -> None:
        r = self.round("replay_20260928-133433")
        self.assertEqual(r["kills"], 159)
        self.assertGreaterEqual(r["withRound"], 95)
        self.assertLess(r["ms"], 1000)

    def test_the_best_killers_longest_shots(self) -> None:
        r = self.round("replay_20260928-133433")
        self.assertEqual((r["best"]["name"], r["best"]["kills"]), ("SoldierHEad", 11))
        distances = [shot[3] for shot in r["top3"]]
        self.assertEqual(distances, sorted(distances, reverse=True))
        self.assertEqual(r["top3"][0][1:4], ["SwissChz", "No4", 141])

    def test_grenades_kill_on_their_fuse(self) -> None:
        low, high = self.round("replay_20260928-133433")["grenadeAges"]
        self.assertGreaterEqual(low, 2.5)
        self.assertLessEqual(high, 3.6)

    def test_a_man_out_of_his_kubelwagen_is_not_459_m_off(self) -> None:
        exit = self.round("replay_20260928-133433")["exit"]
        self.assertEqual(exit["whereIs"], {"fresh": True, "ground": 459})
        self.assertIsNone(exit["fact"]["distance"])
        self.assertEqual(exit["fact"]["round"]["weapon"], "Sg44")

    def test_a_45_minute_round_is_quick(self) -> None:
        r = self.round("replay_20260928-161948")
        self.assertGreaterEqual(r["kills"], 700)
        self.assertGreaterEqual(r["withRound"], 500)
        self.assertLess(r["ms"], 1000)
        self.assertLess(r["everyoneMs"], 1000)


if __name__ == "__main__":
    unittest.main()
