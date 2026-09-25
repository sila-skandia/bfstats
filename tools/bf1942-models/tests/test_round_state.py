"""`viewer/round-state.js` -- the score a kill, a death and a capture pay, and
the two ticket counters, driven headless by `round_state_harness.mjs`.

The numbers under test are the game's own, not the viewer's invention:

  - the score table is `Bf1942/Game/ScoreManagerSettings*.con` from the mod's
    `Game.rfa` (vanilla: kill 1, death 0, capture 10, attack 2, defence 5,
    TK -2), with the `ScoreManager` constructor's values behind it;
  - a death costs the dead player's team a ticket (`setTicketLosePerDeath`,
    which no shipped level declares, so 1);
  - a side bleeds one ticket per `60 / rate` seconds while the ENEMY's summed
    `areaValue` is greater than 99 (`GameServer::gameStatusPlaying`).

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
        capture = self.results["capture"]
        self.assertEqual({"score": 10, "captures": 1}, {
            "score": capture["one"]["score"], "captures": capture["one"]["captures"]})
        self.assertEqual(2, capture["two"]["captures"])
        self.assertEqual(20, capture["two"]["score"])

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


if __name__ == "__main__":
    unittest.main()
