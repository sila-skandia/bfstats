"""A round replay's Accuracy board: each player's rounds fired and hits.

The owner's ask (2026-11-01): accuracy stats for a recorded round, ordered by
most hits or most fired, "use the server table, falling back to the recorded
values being rebuilt". The server counts both per player and weapon and sends
the whole round's tally at its end (ledger IMP-11, `roundStats`). A player it
names keeps the server's numbers. Anyone else is rebuilt from the recording:
a pull times the gun's barrels, a bullet that passed through a victim whose
next hit points are a drop, and one hit per blast that hurt an enemy.

Run under node through `replay_accuracy_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_accuracy_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayAccuracyTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_bullet_hits_only_when_the_victims_next_hit_points_drop(self) -> None:
        # Through him with a drop, through him without one, and wide of him as
        # he loses hit points to something else.
        self.assertEqual(self.results["rebuilt"]["3|Shooter"]["mp40"], [3, 1])

    def test_a_blast_counts_once_and_on_the_enemy_only(self) -> None:
        self.assertEqual(self.results["rebuilt"]["3|Shooter"]["grenadeallies"], [2, 1])

    def test_a_gun_that_fires_its_barrels_together_counts_each(self) -> None:
        self.assertEqual(self.results["rebuilt"]["6|Pilot"], {"bf109": [6, 0]})

    def test_a_reused_pid_is_two_players(self) -> None:
        self.assertEqual(self.results["rebuilt"]["8|Leaver"], {"mp40": [2, 1]})
        self.assertEqual(self.results["rebuilt"]["8|Joiner"], {"mp40": [1, 0]})

    def test_the_servers_tally_wins_where_it_names_the_player(self) -> None:
        shooter = self.results["board"]["Shooter"]
        self.assertEqual(shooter["source"], "server")
        self.assertEqual((shooter["fired"], shooter["hit"]), (42, 13))
        self.assertEqual(shooter["rows"][0], ["Mp40", "infantry", 40, 12])
        for name in ("Leaver", "Joiner", "Pilot"):
            self.assertEqual(self.results["board"][name]["source"], "marks" if name == "Pilot" else "rebuilt")

    def test_without_a_tally_everyone_is_rebuilt(self) -> None:
        self.assertEqual(sorted(self.results["allRebuilt"]), ["marks"] + ["rebuilt"] * 3)

    def test_the_rebuild_hands_back_each_rounds_verdict(self) -> None:
        # Every round has one; each hit carries where it met its victim.
        v = self.results["verdicts"]
        self.assertEqual(v["rounds"], 11)
        self.assertEqual(v["hits"], 3)
        self.assertEqual(v["pointed"], 3)

    def test_the_servers_own_hit_mark_is_the_pilots_hit(self) -> None:
        pilot = self.results["board"]["Pilot"]
        self.assertEqual(pilot["source"], "marks")
        self.assertEqual(pilot["rows"], [["BF109", "air", 6, 1]])

    def test_a_server_recordings_credits_are_its_hits(self) -> None:
        # One `f` per barrel already (no doubling), the fake round left out.
        self.assertEqual(self.results["server"], {"serverFile": True, "impacts": 1, "source": "server", "fired": 4, "hit": 1})

    def test_the_boards_by_kind(self) -> None:
        self.assertEqual(self.results["kinds"], {"Mp40": "infantry", "BF109": "air", "Tiger": "vehicle", "Sherman": "other"})
        self.assertEqual(self.results["noWeapons"], "other")
        self.assertEqual(self.results["totals"]["infantry"]["fired"], 42)
        self.assertIsNone(self.results["totals"]["air"]["accuracy"])

    def test_accuracy_runs_with_the_round_and_lands_on_the_tally(self) -> None:
        # The recording saw 3 of the shooter's 40 Mp40 rounds and 1 of its 12
        # hits: the running counts keep that shape, each weapon scaled to
        # finish on its row of the tally.
        r = self.results["running"]
        self.assertEqual(r["shooterStart"], [0, 0, True])
        self.assertEqual(r["shooterAfterFirst"], [13.33, 12, True])
        self.assertEqual(r["shooterEnd"], [42, 13, True])
        # A rebuilt player's counts are his own, not scaled.
        self.assertEqual(r["leaverMid"], [1, 1, False])
        self.assertEqual(r["leaverEnd"], [2, 1, False])
        self.assertEqual(r["buckets"], [[2, 1], [1, 0], [2, 1], [0, 0], [0, 0]])

    def test_each_weapon_is_scaled_on_its_own(self) -> None:
        # Battleaxe 2026-11-02: one factor for a rifle and a tank gun put the
        # rifle-only start of the round at 128%. Per weapon, the rifle's two
        # rounds and two hits are its tally's 10 and 6.
        p = self.results["perWeapon"]
        self.assertEqual(p["twoAt3"], [10, 6, 0.6])
        self.assertEqual(p["rifleOnlyAt3"], [10, 6, 0.6])
        self.assertEqual(p["twoEnd"], [110, 8, 0.073])

    def test_hits_never_pass_rounds(self) -> None:
        p = self.results["perWeapon"]
        # One round seen, one hit seen scaled to three: held to the one round.
        self.assertEqual(p["earlyAt1"], [1, 1, 1])
        self.assertEqual(p["earlyEnd"], [4, 3, 0.75])
        self.assertEqual(p["over"], 0)

    def test_a_weapon_never_seen_firing_follows_his_firing(self) -> None:
        p = self.results["perWeapon"]
        # Half his seen rounds by t=1: half the pistol's 4 rounds and 2 hits.
        self.assertEqual(p["unseenAt1"], [3, 2, 0.667])
        self.assertEqual(p["unseenEnd"], [6, 3, 0.5])

    def test_a_levels_own_weapon_row_serves_its_level_only(self) -> None:
        r = self.results["levelRows"]
        self.assertEqual(r["battleaxe"], ["land", 100])
        self.assertEqual(r["kasserine"], ["land", 500])
        # Radar_AA lives in no category folder: it stays an object.
        self.assertEqual(r["levelOnly"], ["object", 600])
        self.assertEqual(r["tigerKind"], "vehicle")

    def test_the_catalogue_places_a_vehicle_the_weapon_table_misses(self) -> None:
        self.assertEqual(self.results["catalogueKinds"], {"AA_Allies": "vehicle", "Hanomag": "vehicle", "Spitfire": "air", "Nothing": "other"})

    def test_a_round_reaches_only_as_far_as_it_lives(self) -> None:
        k = self.results["knife"]
        self.assertEqual(k["life"], 0.0665)
        self.assertEqual(k["capped"], [[5, False], [8, True]])
        # Without its life the swing at the far man reads as a hit.
        self.assertEqual(k["uncapped"], [[5, True], [8, True]])

    def test_rounds_fired_at_a_player(self) -> None:
        # Three that hit him (5.0, 12.0, the grenade at 20.0), three that passed
        # through without a drop (8.0, 12.5, 16.0); the round 15 m wide and the
        # grenade at his enemy's teammate are not fired at him.
        u = self.results["underFire"]
        self.assertEqual((u["rounds"], u["hits"], u["hitsTaken"]), (6, 3, 3))
        self.assertEqual(u["byT13"], 4)
        self.assertEqual(u["shooters"], [["Shooter", 3, 2], ["Leaver", 2, 1], ["Joiner", 1, 0]])

    def test_a_players_detail(self) -> None:
        d = self.results["shooterDetail"]
        self.assertEqual(d["bursts"], 5)
        self.assertEqual(d["targets"], {"soldier": 2, "armour": 0, "air": 0})
        self.assertEqual(d["victims"], [["Victim", 2]])
        # The bullet hit at 30 m; the grenade's is a blast, not a range.
        self.assertEqual(d["ranges"], [0, 1, 0, 0, 0])
        self.assertEqual(d["farthest"], 30)



if __name__ == "__main__":
    unittest.main()
