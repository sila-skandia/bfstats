"""A room's host settings, admin, votes, auto-balance, welcome lines, password,
reserved slots, round count and map list (gap audit entries 26, 28, 47, 48, 55).

One node run of `room_host_harness.mjs` over the room core with virtual peers,
the pattern of `test_room.py`, whose module overlay it reuses.

What it pins, each read from `bf1942_lnxded.static`:

* the defaults of `Setup::initServerSettings` 0x080c09b0 (NET-21);
* the join gate of `NetServer::handleConnectRequest` (the password, the
  reserved slots);
* `kickPlayers`' line, a ban, `admin.serverMessage`;
* the vote law: `calcVotesNeeded` 0x08148880 (0.6f, rounded up on the x87
  stack), `castVote` 0x081497c0 and `updateVoteSystemVote` 0x08149dc0;
* auto-balance in `killPlayer` (0x0814dc02..0x0814dc90);
* the round count of `gameStatusEndGame` 0x08152ca0 and
  `Setup::nextLevelInMaplist` 0x080bff80.
"""

# watches: tools/bf1942-models/server/*.mjs tools/bf1942-models/viewer/*.js

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.test_room import MODULES, SERVER, THREE_PACKAGE, VIEWER

HARNESS = Path(__file__).resolve().parent / "room_host_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    env = dict(os.environ)
    env["REAL_VIEWER"] = str(VIEWER)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        # Every room module and every top-level viewer module, so a module
        # the room's graph gained since the list above was written resolves.
        for source in SERVER.glob("*.mjs"):
            shutil.copyfile(source, work / "server" / source.name)
        for source in VIEWER.glob("*.js"):
            shutil.copyfile(source, work / "viewer" / source.name)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")], capture_output=True, text=True,
            timeout=600, env=env)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class RoomHostTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- entry 26: the settings ------------------------------------------------

    def test_the_defaults_are_init_server_settings(self) -> None:
        """`Setup::initServerSettings` 0x080c09b0 (NET-21)."""
        table = self.results["defaults"]["table"]
        want = {"numberOfRounds": 5, "spawnTime": 20, "spawnDelay": 3, "gameStartDelay": 20,
                "roundStartDelay": 10, "ticketRatio": 100, "soldierFriendlyFire": 100,
                "vehicleFriendlyFire": 100, "soldierFriendlyFireOnSplash": 100,
                "vehicleFriendlyFireOnSplash": 100, "autoBalance": False, "gameTime": 0,
                "scoreLimit": 0, "maxPlayers": 16, "numReservedSlots": 0}
        self.assertEqual(want, {key: table[key] for key in want})
        rules = self.results["defaults"]["rules"]
        self.assertEqual([20, 3, 20, 10, 0, 0, 100, False],
                         [rules[k] for k in ("spawnTime", "spawnDelay", "gameStartDelay",
                                             "roundStartDelay", "gameTime", "scoreLimit",
                                             "ticketRatio", "autoBalance")])

    def test_a_plain_room_is_its_one_level_and_its_creator_is_admin(self) -> None:
        d = self.results["defaults"]
        self.assertTrue(d["admin"])
        self.assertTrue(d["hasKey"])
        self.assertEqual([{"level": "test", "mode": "Conquest"}], d["maps"])
        self.assertEqual(0, d["mapIndex"])
        self.assertFalse(d["hello"]["password"])
        self.assertFalse(d["lobby"]["password"])

    def test_a_create_row_sets_the_room(self) -> None:
        s = self.results["settings"]
        self.assertEqual(4, s["max"])
        self.assertEqual(4, s["lobby"]["max"])
        self.assertTrue(s["lobby"]["password"])
        # The password never rides back; a level the server lacks is dropped.
        self.assertIs(True, s["hello"]["password"])
        self.assertEqual([{"level": "test", "mode": None}, {"level": "second", "mode": "Conquest"}],
                         s["maps"])
        self.assertNotIn("bogus", s["hello"])
        rules = s["rules"]
        self.assertEqual([10, 5, 900, 7, 50, True],
                         [rules[k] for k in ("spawnTime", "gameStartDelay", "gameTime",
                                             "scoreLimit", "ticketRatio", "autoBalance")])
        # `serverGameTime` is minutes, times 60 for the round (`startHostGame`).
        self.assertEqual(900, s["roundGameTime"])
        self.assertEqual(7, s["roundScoreLimit"])
        self.assertEqual(5, s["preGameIn"])

    def test_the_ticket_ratio_scales_the_start_truncated(self) -> None:
        """TKT-1: `trunc(count * ratio)`, the test level's 100 a side at 50 %."""
        self.assertEqual([50, 50], [self.results["settings"]["tickets"][k] for k in ("team1", "team2")])

    def test_friendly_fire_at_zero_costs_a_friend_nothing(self) -> None:
        s = self.results["settings"]
        self.assertEqual({"soldier": 0, "vehicle": 0, "soldierSplash": 0, "vehicleSplash": 0},
                         s["friendly"])
        self.assertEqual(0, s["friendlyHit"])

    def test_settings_are_clamped_to_the_create_game_boxes(self) -> None:
        c = self.results["settings"]["clamped"]
        self.assertEqual(999, c["gameTime"])
        self.assertEqual(10, c["ticketRatio"])
        self.assertEqual(100, c["soldierFriendlyFire"])
        self.assertEqual(16, c["maxPlayers"])
        self.assertEqual(1, c["gameStartDelay"])
        # ERROR_PASSWORD: no blank in a password.
        self.assertEqual("", c["password"])

    def test_a_live_setting_reaches_the_round(self) -> None:
        live = self.results["admin"]["live"]
        self.assertEqual(25, live["friendly"]["soldier"])
        self.assertEqual(25, live["friendly"]["vehicleSplash"])
        self.assertEqual(1200, live["gameTime"])
        self.assertTrue(live["autoBalance"])
        self.assertEqual(20, live["settingsRow"])

    def test_the_spawn_time_sets_the_wave(self) -> None:
        """SPAWN-35 with `serverSpawnTime 10`: a death inside the open window
        waits the window's rest and the time between waves, 15 s less the
        clock."""
        r = self.results["limits"]
        self.assertAlmostEqual(15 - r["clockAtDeath"], r["sw"], delta=0.05)

    def test_the_time_limit_ends_the_round(self) -> None:
        self.assertEqual("time", self.results["limits"]["end"])

    # --- entry 48: password, reserved slots, welcome --------------------------------

    def test_the_password_gates_the_join(self) -> None:
        p = self.results["password"]
        self.assertEqual("bad_password", p["none"])
        self.assertEqual("bad_password", p["wrong"])
        self.assertTrue(p["right"])
        self.assertFalse(p["rightAdmin"])
        self.assertFalse(p["rightKey"])

    def test_max_players_is_the_rooms_own(self) -> None:
        self.assertEqual({"fifth": "room_full", "players": 4}, self.results["maxPlayers"])

    def test_a_reserved_slot_is_kept_for_the_reserved_password(self) -> None:
        """`handleConnectRequest`: a plain joiner must fit under max players
        less the free reserved slots, denied 0x1e while one is kept."""
        self.assertEqual({"host": True, "second": True, "third": "reserved_slots", "vip": True,
                          "full": "room_full"}, self.results["reserved"])

    def test_a_joiner_gets_the_welcome_lines(self) -> None:
        self.assertEqual([[0, "Welcome to the room"], [1, "Play fair"]],
                         self.results["settings"]["welcome"])
        self.assertEqual(2, self.results["password"]["welcome"])

    # --- entry 26: the admin ----------------------------------------------------------

    def test_only_the_creator_is_admin(self) -> None:
        a = self.results["admin"]
        self.assertTrue(a["host"])
        self.assertFalse(a["guest"])
        self.assertTrue(a["refused"]["hostStill"])
        self.assertEqual(1, len(a["refused"]["told"]))

    def test_a_server_message_is_the_servers_line_to_everyone(self) -> None:
        m = self.results["admin"]["message"]
        for row in (m["guest"], m["host"]):
            self.assertEqual("Restart in five", row["text"])
            self.assertNotIn("slot", row)

    def test_a_kick_drops_the_player_and_says_so(self) -> None:
        """`kickPlayers` 0x08148b20: "Player %s was kicked from the server."."""
        k = self.results["admin"]["kicked"]
        self.assertEqual("kicked", k["code"])
        self.assertEqual(4001, k["closed"]["code"])
        self.assertTrue(k["gone"])
        self.assertEqual("Player Other was kicked from the server.", k["line"])

    def test_a_ban_keeps_the_name_and_the_browser_out(self) -> None:
        b = self.results["admin"]["banned"]
        self.assertEqual(["banned", "banned", "banned", True, True],
                         [b["code"], b["byName"], b["byId"], b["stranger"], b["cleared"]])

    def test_restart_map_restarts_the_round(self) -> None:
        self.assertEqual(1, self.results["admin"]["restarted"])

    # --- entry 28: the votes -------------------------------------------------------------

    def test_votes_needed_rounds_point_six_f_up(self) -> None:
        """`calcVotesNeeded` 0x08148880: 0.6f is a hair over 0.6, so 5, 10 and
        15 players need one more than `ceil(0.6 n)` in exact arithmetic."""
        self.assertEqual({"1": 1, "2": 2, "3": 2, "4": 3, "5": 4, "6": 4, "7": 5, "8": 5,
                          "9": 6, "10": 7, "15": 10, "16": 10}, self.results["needed"])
        self.assertEqual({"majority": 0.6, "time": 60, "gap": 180}, self.results["voteConstants"])

    def test_issuing_a_vote_is_a_yes_and_tells_everyone(self) -> None:
        v = self.results["votes"]["issued"]
        self.assertEqual([1, 0, 1, 0, 4, 60], [v[k] for k in ("kind", "action", "yes", "no",
                                                              "required", "time")])

    def test_one_vote_of_a_type_at_a_time(self) -> None:
        self.assertEqual("Vote Failed: Kick Vote already in progress.", self.results["votes"]["busy"])

    def test_a_players_first_vote_stands(self) -> None:
        v = self.results["votes"]["afterNo"]
        self.assertEqual([3, 1, 1], [v["action"], v["yes"], v["no"]])

    def test_a_kick_vote_passes_at_the_count_and_bans_for_the_round(self) -> None:
        """`updateVoteSystemVote`: action 2, then `banPlayer(target, "Round")`."""
        v = self.results["votes"]
        self.assertTrue(v["beforeLast"]["stillIn"])
        self.assertEqual(3, v["beforeLast"]["last"]["yes"])
        self.assertEqual([2, 4, 0], [v["passed"][k] for k in ("action", "yes", "required")])
        self.assertEqual({"gone": True, "code": "banned",
                          "line": "Player F was kicked from the server.", "rejoin": "banned"}, v["kick"])

    def test_a_player_issues_one_vote_of_a_type_every_180_s(self) -> None:
        self.assertEqual("Vote Failed: Minimum 180 seconds between issuing votes.",
                         self.results["votes"]["tooSoon"])

    def test_a_map_vote_stays_inside_the_map_list_and_fails_on_its_clock(self) -> None:
        v = self.results["votes"]
        self.assertEqual("Vote Failed: Map id outside Map Cycle", v["outside"])
        # Five players: 4 needed.
        self.assertEqual([0, 0, 4], [v["mapIssued"][k] for k in ("kind", "action", "required")])
        self.assertEqual(0, v["mapRunning"])
        # Failed: required is what was still missing.
        self.assertEqual([1, 1, 3], [v["mapFailed"][k] for k in ("action", "yes", "required")])

    def test_a_team_kick_is_the_targets_sides_alone(self) -> None:
        v = self.results["votes"]
        needed = {1: 1, 2: 2, 3: 2, 4: 3, 5: 4}[v["mates"]]
        self.assertEqual([2, 0, needed], [v["teamIssued"][k] for k in ("kind", "action", "required")])
        self.assertFalse(v["foeSaw"])
        self.assertEqual("Kick Vote (Team) Failed: Target player not on the same team.", v["foeTold"])

    def test_a_vote_switched_off_says_so(self) -> None:
        self.assertEqual("Vote Failed: Map Vote is disabled on server.", self.results["votes"]["disabled"])

    def test_a_passed_map_vote_moves_the_room(self) -> None:
        """`changeMap(int)` 0x081496b0: the map list's entry, now."""
        m = self.results["mapVote"]
        self.assertEqual(2, m["passed"]["action"])
        self.assertEqual("second", m["change"]["level"])
        self.assertEqual(4002, m["closed"]["code"])
        self.assertTrue(m["newRoom"])
        self.assertEqual("second", m["level"])
        self.assertEqual(0, m["oldEmpty"])
        # The creator is admin again by the key; nobody else is.
        self.assertTrue(m["adminBack"])
        self.assertFalse(m["guestAdmin"])
        self.assertEqual([1, 2], [m["mapIndex"], m["maps"]])

    # --- entry 47: auto-balance ------------------------------------------------------------

    def test_auto_balance_is_off_by_default(self) -> None:
        self.assertEqual(1, self.results["autoBalance"]["off"]["team"])

    def test_a_death_with_the_sides_two_apart_moves_the_dead_player(self) -> None:
        m = self.results["autoBalance"]["moved"]
        self.assertEqual([2, 2], [m["team"], m["world"]])
        self.assertEqual(2, m["row"]["team"])
        self.assertTrue(m["row"]["autoBalance"])

    def test_even_sides_move_nobody(self) -> None:
        self.assertEqual(1, self.results["autoBalance"]["even"])

    # --- entry 55: the rounds and the map list ---------------------------------------------

    def test_a_map_runs_its_rounds_then_the_next_level(self) -> None:
        """`gameStatusEndGame`: restart while more than one round is left,
        then `nextLevelInMaplist`."""
        r = self.results["rounds"]
        self.assertEqual({"restarts": 1, "changes": 0, "left": 1, "same": True}, r["first"])
        self.assertEqual(1, r["second"]["restarts"])
        self.assertEqual("second", r["second"]["change"]["level"])
        self.assertEqual("second", r["second"]["level"])
        self.assertEqual(4002, r["second"]["closed"]["code"])
        self.assertEqual(2, r["second"]["left"])

    def test_a_one_level_room_starts_its_rounds_over_in_place(self) -> None:
        s = self.results["rounds"]["solo"]
        self.assertEqual({"same": True, "restarts": 1, "changes": 0, "won": {"1": 0, "2": 0}, "left": 1}, s)


if __name__ == "__main__":
    unittest.main()
