"""`viewer/round-state.js` -- the score a kill, a death and a capture pay, and
the two ticket counters, driven headless by `round_state_harness.mjs`.

The numbers under test are the game's own, not the viewer's invention:

  - the score table is `Bf1942/Game/ScoreManagerSettings*.con` from the mod's
    `Game.rfa` (vanilla: kill 1, death 0, capture 10, attack 2, defence 5,
    TK -2), with the `ScoreManager` constructor's values behind it;
  - a death costs the dead player's team a ticket (`setTicketLosePerDeath`,
    which no shipped level declares, so 1);
  - a side bleeds one ticket per `60 / rate` seconds while the ENEMY's summed
    `areaValue` is greater than 99 (`GameServer::gameStatusPlaying`), the
    countdown refilled whole while it is not;
  - and both the starting counts and the rates scale by the server's max
    players over 16 (`gamaStatusFirstPreGame`, `setTicketLostPerMin`; ledger
    TKT-1..TKT-4), which the parity lab measured: Wake co-op's 100 starts a
    32-player server at 200 and an 8-player one at 50.

`test_extract_score_settings.py` covers the parser that fills the table.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("round_state_harness.mjs")
MODULES = {"round-state.js": VIEWER / "round-state.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type": "module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RoundStateTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # ---- the table ---------------------------------------------------------

    def test_vanilla_conquest_pays_a_kill_one_and_a_capture_ten(self) -> None:
        table = self.results["table"]["conquest"]
        self.assertEqual(1, table["kill"])
        self.assertEqual(0, table["death"])
        self.assertEqual(10, table["capture"])
        self.assertEqual(2, table["attack"])
        self.assertEqual(5, table["defence"])
        self.assertEqual(-2, table["tk"])

    def test_a_mode_with_its_own_file_uses_it(self) -> None:
        self.assertEqual(0, self.results["table"]["tdm"]["capture"])
        self.assertEqual(3, self.results["table"]["ctf"]["defence"])
        self.assertEqual(0, self.results["table"]["ctf"]["attack"])

    def test_a_mode_without_one_gets_the_base_file(self) -> None:
        # ObjectiveMode ships no file, so the base file answers for it.
        self.assertEqual(10, self.results["table"]["objective"]["capture"])
        self.assertEqual(2, self.results["table"]["objective"]["attack"])

    def test_no_pack_at_all_is_the_constructors_own_table(self) -> None:
        self.assertEqual(self.results["defaults"], self.results["table"]["none"])
        self.assertEqual(3, self.results["table"]["none"]["kill"])

    def test_a_partial_file_keeps_the_defaults_for_what_it_omits(self) -> None:
        table = self.results["table"]["partial"]
        self.assertEqual(25, table["capture"])
        self.assertEqual(-7, table["tk"])
        self.assertEqual(3, table["kill"])
        self.assertEqual(-1, table["death"])

    def test_a_key_in_the_cons_own_case_still_resolves(self) -> None:
        self.assertEqual(12, self.results["table"]["shouted"]["capture"])

    def test_the_settings_file_is_named_for_the_mode(self) -> None:
        self.assertEqual("scoremanagersettingsctf.con", self.results["files"]["ctf"])
        self.assertEqual("scoremanagersettings.con", self.results["files"]["none"])
        self.assertEqual("scoremanagersettingsctf.con", self.results["files"]["lower"])

    def test_the_bleed_threshold_is_the_engines_99(self) -> None:
        self.assertEqual(99, self.results["bleedWeight"])

    # ---- the weight --------------------------------------------------------

    def test_the_weight_is_each_points_area_value_by_holder(self) -> None:
        self.assertEqual({"1": 110, "2": 0}, self.results["weight"]["berlin"])
        self.assertEqual({"1": 25, "2": 25}, self.results["weight"]["even"])
        self.assertEqual({"1": 0, "2": 0}, self.results["weight"]["empty"])

    def test_a_neutral_point_counts_for_nobody(self) -> None:
        # The 125-weight neutral point and the one with no team at all.
        self.assertEqual(25, self.results["weight"]["even"]["1"])
        self.assertEqual(25, self.results["weight"]["even"]["2"])

    # ---- a kill, a team kill and a suicide ---------------------------------

    def test_a_kill_pays_the_killer_and_charges_the_victims_team_a_ticket(self) -> None:
        kill = self.results["kill"]
        self.assertEqual({"score": 2, "kills": 2}, {
            "score": kill["twoKills"]["score"], "kills": kill["twoKills"]["kills"]})
        self.assertEqual(2, kill["killedTwice"]["deaths"])
        # Four deaths on team 1 (5, 6 twice, and 7's own gun) and two on team 2.
        self.assertEqual({"1": 76, "2": 98}, kill["tickets"])

    def test_a_death_pays_nothing(self) -> None:
        self.assertEqual(0, self.results["kill"]["killedTwice"]["score"])

    def test_a_team_kill_pays_the_tk_and_not_the_kill(self) -> None:
        killer = self.results["kill"]["teamKiller"]
        self.assertEqual(1, killer["teamKills"])
        self.assertEqual(0, killer["kills"])
        self.assertEqual(-2, killer["score"])

    def test_a_suicide_is_a_death_on_his_own_line(self) -> None:
        for row in ("selfKilled", "suicide", "blameless"):
            self.assertEqual(1, self.results["kill"][row]["suicides"], row)
            self.assertEqual(1, self.results["kill"][row]["deaths"], row)
            self.assertEqual(0, self.results["kill"][row]["kills"], row)

    def test_one_tally_per_player(self) -> None:
        self.assertEqual(6, self.results["kill"]["counts"])
        self.assertTrue(self.results["kill"]["stable"])

    # ---- a capture ---------------------------------------------------------

    def test_a_capture_pays_every_player_it_is_awarded_to(self) -> None:
        # A Conquest point taken is an Attack (`ControlPoint::handleFrameUpdate`
        # pushes ScoreMsg 1 at 0x08283d5c), so it pays the table's `attack`,
        # vanilla's 2; `capture` (10) is the CTF flag's. Ledger ROUND-7.
        capture = self.results["capture"]
        self.assertEqual({"score": 2, "captures": 1}, {
            "score": capture["one"]["score"], "captures": capture["one"]["captures"]})
        self.assertEqual(2, capture["two"]["captures"])
        self.assertEqual(4, capture["two"]["score"])

    def test_a_capture_costs_no_tickets(self) -> None:
        self.assertEqual({"1": 80, "2": 100}, self.results["capture"]["tickets"])

    # ---- the bleed ---------------------------------------------------------

    def test_the_side_under_the_enemys_weight_bleeds_at_its_own_rate(self) -> None:
        # Berlin: the Germans hold 110, the Russians bleed 5/min.
        self.assertEqual({"1": 110, "2": 0}, self.results["bleed"]["held"])
        self.assertEqual({"1": False, "2": True}, self.results["bleed"]["bleeding"])

    def test_one_ticket_per_sixty_over_the_rate_seconds(self) -> None:
        # 5/min is one every 12s: nothing at 11s, one at 13s.
        self.assertEqual({"1": 80, "2": 100}, self.results["bleed"]["atEleven"])
        self.assertEqual({"1": 80, "2": 99}, self.results["bleed"]["atThirteen"])

    def test_the_gate_is_the_enemys_weight_and_closes_under_99(self) -> None:
        closed = self.results["bleed"]["gateClosed"]
        self.assertEqual({"1": 50, "2": 60}, closed["held"])
        self.assertEqual({"1": False, "2": False}, closed["bleeding"])
        self.assertEqual({"1": 80, "2": 99}, closed["tickets"])

    def test_a_shut_gate_refills_the_countdown(self) -> None:
        # The engine writes `60 / rate` back while the enemy holds 99 or less
        # (ledger TKT-4): 6 s were owed when the gate shut for a frame, and the
        # next ticket still waits the whole 12 s.
        reopened = self.results["bleed"]["reopened"]
        self.assertAlmostEqual(6, reopened["owed"], places=4)
        self.assertEqual(12, reopened["shut"])
        self.assertEqual({"1": 80, "2": 99}, reopened["atEleven"])
        self.assertEqual({"1": 80, "2": 98}, reopened["atThirteen"])

    def test_the_other_side_bleeds_at_its_own_thirty_a_minute(self) -> None:
        axis = self.results["bleed"]["axis"]
        self.assertEqual(30, 80 - axis["tickets"]["1"])
        self.assertEqual({"1": True, "2": False}, axis["bleeding"])

    def test_a_frame_long_enough_spends_more_than_one_ticket(self) -> None:
        frame = self.results["longFrame"]
        self.assertEqual({"1": 0, "2": 5}, frame["lost"])
        self.assertEqual({"1": 80, "2": 95}, frame["tickets"])
        self.assertEqual(12, frame["countdown"])

    def test_tickets_stop_at_zero_and_the_round_is_over(self) -> None:
        floor = self.results["floor"]
        self.assertEqual({"1": 2, "2": 0}, floor["tickets"])
        self.assertTrue(floor["over"])
        self.assertEqual({"1": 0, "2": 0}, floor["lost"])

    def test_a_level_that_declares_no_rate_never_bleeds(self) -> None:
        no_rates = self.results["noRates"]
        self.assertEqual({"1": 0, "2": 0}, no_rates["lost"])
        self.assertEqual({"1": 10, "2": 10}, no_rates["tickets"])
        self.assertEqual({"1": False, "2": False}, no_rates["bleeding"])

    def test_a_death_costs_what_the_level_says(self) -> None:
        self.assertEqual(99, self.results["lossPerDeath"]["one"]["2"])
        self.assertEqual(97, self.results["lossPerDeath"]["three"]["2"])

    # ---- max players (ledger TKT-1..TKT-4) ---------------------------------

    def test_the_parity_labs_rounds(self) -> None:
        # Wake co-op measured on the lab server: 200 / 200 at 32 max players,
        # 50 / 50 at 8, from the level's 100 a side.
        lab = self.results["maxPlayers"]["lab"]
        self.assertEqual({"1": 200, "2": 200}, lab["32"])
        self.assertEqual({"1": 50, "2": 50}, lab["8"])
        self.assertEqual({"1": 100, "2": 100}, lab["16"])

    def test_the_start_is_truncated_not_rounded(self) -> None:
        # 100 x 11 / 16 = 68.75; gamaStatusFirstPreGame's fistp runs under
        # round-toward-zero (`mov ah,0xc`).
        self.assertEqual({"1": 68, "2": 68}, self.results["maxPlayers"]["eleven"])
        self.assertEqual(6, self.results["maxPlayers"]["counts"]["one"])

    def test_a_round_that_names_no_server_keeps_the_levels_numbers(self) -> None:
        self.assertEqual(16, self.results["maxPlayers"]["base"])
        self.assertEqual({"1": 100, "2": 140}, self.results["maxPlayers"]["unnamed"])

    def test_the_root_scripts_counts_scale_like_any_other(self) -> None:
        counts = self.results["maxPlayers"]["counts"]
        self.assertEqual(120, counts["berlinRoot"])       # Berlin's root Coop.con, 60
        self.assertEqual(200, counts["berlinGameTypes"])  # its GameTypes/Coop.con, 100
        self.assertEqual(300, counts["tobruk"])
        self.assertEqual(280, counts["wakeGameTypes"])    # what the old reading predicted
        self.assertEqual(0, counts["none"])
        self.assertEqual(0, counts["negative"])

    def test_max_players_is_a_whole_number_from_one_to_sixty_four(self) -> None:
        clamp = self.results["maxPlayers"]["clamp"]
        self.assertEqual(64, self.results["maxPlayers"]["limit"])
        self.assertEqual(64, clamp["big"])
        self.assertEqual(16, clamp["zero"])
        self.assertEqual(16, clamp["junk"])
        self.assertEqual(20, clamp["fraction"])
        self.assertEqual(32, clamp["text"])
        self.assertEqual(5, clamp["fallback"])

    def test_the_bleed_rate_scales_with_the_server(self) -> None:
        # 15 a minute on a 32-player server is 30 a minute: one every 2 s.
        interval = self.results["maxPlayers"]["interval"]
        self.assertEqual(2, interval["32"])
        self.assertEqual(8, interval["8"])
        self.assertIsNone(interval["none"])  # Infinity: no rate, no bleed
        self.assertEqual({"32": 2, "8": 8}, self.results["maxPlayers"]["countdowns"])

    def test_a_side_bleeds_out_in_the_same_time_on_any_server(self) -> None:
        # 100 tickets at 15/min is 400 s on a 16-player server; the counts and
        # the rate scale together, so 32 and 8 players take the same time.
        out = self.results["maxPlayers"]["bleedOut"]
        for players in ("32", "16", "8"):
            self.assertTrue(out[players]["over"], players)
            self.assertEqual(0, out[players]["tickets"]["2"], players)
            self.assertEqual(400, out[players]["seconds"], players)

    def test_a_levels_own_max_players_sets_the_start_and_not_the_bleed(self) -> None:
        # Kasserine Pass co-op sets `game.maxNrofPlayers 18` after its bleed
        # lines: 100 x 18 / 16 = 112.5 -> 112, and the bleed keeps 32's rate.
        kp = self.results["maxPlayers"]["kasserine"]
        self.assertEqual({"1": 112, "2": 112}, kp["tickets"])
        self.assertEqual(32, kp["maxPlayers"])
        self.assertEqual(18, kp["startPlayers"])
        self.assertEqual(2, kp["countdown"])
        self.assertEqual(18, kp["roundPlayers"])
        self.assertEqual(32, kp["roundPlayersNoScript"])

    def test_the_room_takes_a_fresh_scaled_copy(self) -> None:
        room = self.results["maxPlayers"]["room"]
        # The lobby's 16 slots: the level's numbers.
        self.assertEqual(100, room["at16"]["team1"])
        self.assertEqual(15, room["at16"]["lossPerMin"]["team1"])
        self.assertEqual("CoOp", room["at16"]["mode"])
        self.assertEqual(200, room["at32"]["team2"])
        self.assertEqual(30, room["at32"]["lossPerMin"]["team1"])
        self.assertEqual(20000, room["at32"]["lossPerMin"]["team2"])
        # Kasserine's own 18 reaches a room too; its bleed stays at 16's.
        self.assertEqual(112, room["kasserine16"]["team1"])
        self.assertEqual(15, room["kasserine16"]["lossPerMin"]["team1"])
        self.assertTrue(room["fresh"])
        self.assertEqual(100, room["untouched"]["team1"])
        self.assertEqual(15, room["untouched"]["lossPerMin"]["team1"])
        self.assertIsNone(room["none"])


if __name__ == "__main__":
    unittest.main()


class RoundEndTests(unittest.TestCase):
    """The end of the round: ledger ROUND-1..ROUND-9, the design and what was
    built in `features/round-end-winner-screen/README.md`."""

    end: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.end = run_harness()["end"]

    def test_game_play_modes_are_string_to_gpm(self) -> None:
        gpm = self.end["gpm"]
        self.assertEqual((1, 2, 4, 4, 3, 5, 2, 2), (
            gpm["ctf"], gpm["conquest"], gpm["coop"], gpm["singlePlayer"],
            gpm["tdm"], gpm["objective"], gpm["unknown"], gpm["none"]))
        # The bleed and the ticket end run in modes 2, 4 and 5 only.
        self.assertEqual([False, True, False, True, True], gpm["decides"])

    def test_victory_type_is_the_share_margin_against_40_and_80_percent(self) -> None:
        types = self.end["types"]
        self.assertEqual(3, types["total"])
        self.assertEqual(2, types["major"])
        self.assertEqual(1, types["minor"])
        # `fucompp` with the threshold on top: an equal margin is the larger class.
        self.assertEqual(2, types["atMinor"])
        self.assertEqual(3, types["atMajor"])
        # A winner behind on shares has no margin.
        self.assertEqual(1, types["behind"])
        self.assertEqual(0, types["draw"])

    def test_the_share_is_over_the_raw_count(self) -> None:
        share = self.end["share"]
        self.assertEqual(1.0, share["full"])
        self.assertAlmostEqual(68 / 68.75, share["odd"])
        self.assertEqual(0, share["none"])

    def test_the_restart_delay_is_ten_seconds_clamped_one_to_thirty(self) -> None:
        self.assertEqual({"base": 10, "low": 1, "high": 30, "junk": 10}, self.end["delay"])

    def test_score_messages_are_handle_scores(self) -> None:
        msg = self.end["msg"]
        self.assertEqual((0, 1, 2, 3, 6), (msg["flagCapture"], msg["attack"],
                                           msg["defence"], msg["kill"], msg["tk"]))

    def test_a_side_bled_to_zero_loses_and_the_round_stops(self) -> None:
        bled = self.end["bled"]
        self.assertEqual(("endGame", True, 1, "tickets"), (
            bled["status"], bled["over"], bled["winner"], bled["reason"]))
        # 80 of 80 against nothing: a total victory.
        self.assertEqual(3, bled["victoryType"])
        self.assertEqual({"1": 1, "2": 0}, bled["roundsWon"])
        # EndGame pays nothing and bleeds nothing.
        self.assertEqual(0, bled["killPaid"])
        self.assertEqual(0, bled["deathsAfter"])
        self.assertEqual({"1": 0, "2": 0}, bled["lostAfter"])
        self.assertEqual(10, bled["restartIn"])

    def test_a_multiplayer_round_restarts_ten_seconds_later(self) -> None:
        restart = self.end["restart"]
        self.assertFalse(restart["dueEarly"])
        self.assertTrue(restart["due"])
        self.assertEqual("playing", restart["status"])
        self.assertEqual({"1": 80, "2": 5}, restart["tickets"])
        self.assertEqual(0, restart["counts"])
        # `ScoreManager::reset` leaves the rounds won alone.
        self.assertEqual({"1": 1, "2": 0}, restart["roundsWon"])
        self.assertEqual((None, 4, 1), (restart["winner"], restart["victoryType"],
                                        restart["restarts"]))

    def test_a_death_on_the_last_ticket_ends_the_round_on_the_next_tick(self) -> None:
        death = self.end["death"]
        self.assertEqual("playing", death["beforeTick"])
        self.assertEqual((2, "endGame", "tickets"), (death["winner"], death["status"],
                                                     death["reason"]))

    def test_both_sides_out_on_one_tick_is_a_draw(self) -> None:
        draw = self.end["draw"]
        self.assertEqual((0, 0), (draw["winner"], draw["type"]))
        self.assertEqual({"1": 0, "2": 0}, draw["roundsWon"])

    def test_a_single_player_round_waits_in_end_game(self) -> None:
        sp = self.end["singlePlayer"]
        self.assertIsNone(sp["restartIn"])  # Infinity
        self.assertFalse(sp["due"])
        self.assertEqual("endGame", sp["status"])

    def test_the_time_limit_takes_the_larger_ticket_share(self) -> None:
        timed = self.end["time"]
        self.assertEqual("playing", timed["early"])
        self.assertEqual(("endGame", 2, "time"), (timed["status"], timed["winner"],
                                                   timed["reason"]))
        # 90% against 40%: a margin of 0.5, a major victory.
        self.assertEqual(2, timed["type"])

    def test_ctf_ends_on_the_score_limit_of_flag_captures(self) -> None:
        ctf = self.end["ctf"]
        self.assertEqual("playing", ctf["noTicketEnd"])
        self.assertEqual("playing", ctf["afterOne"])
        self.assertEqual(("endGame", 2, 1, "score"), (ctf["status"], ctf["winner"],
                                                       ctf["type"], ctf["reason"]))
        self.assertEqual(2, ctf["teams"]["2"]["captures"])
        # CTF's own table: a flag home pays 10, a pick-up 0, a return 3.
        self.assertEqual(20, ctf["carrier"]["score"])
        self.assertEqual(2, ctf["carrier"]["flags"])
        self.assertEqual(3, ctf["defender"]["score"])
        self.assertEqual(1, ctf["gpm"])

    def test_ctf_with_no_limit_plays_on_and_its_time_limit_weighs_team_score(self) -> None:
        open_ = self.end["ctfOpen"]
        self.assertEqual("playing", open_["openStatus"])
        self.assertEqual((1, "time", 1), (open_["winner"], open_["reason"], open_["type"]))

    def test_a_conquest_point_pays_attack_on_the_side(self) -> None:
        cp = self.end["cpCapture"]
        self.assertEqual((2, 1, 1, 2), (cp["row"]["score"], cp["row"]["captures"],
                                        cp["row"]["attacks"], cp["row"]["team"]))
        self.assertEqual(2, cp["team"]["score"])

