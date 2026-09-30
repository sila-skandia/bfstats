"""Bot names as the server gives them (ledger AI-8, AI-134..AI-137).

The page used to name its bots from a hand-written table by side (`bot.js`
`BOT_NAMES`), so Desert Combat's Iraqis were Fritz and Hans, and
`extract_bot_names.py` parsed a `game.addBotName` no shipped file uses.

The game names a bot from the lists the level's `SinglePlayer/Skirmish.con`
loads (`GameServer::loadBots(0)` 0x08131ef0): name files of
`game.addFirstNameOnTeam` / `game.addSecondNameOnTeam` lines, each carrying
its own team, resolved along the mod chain. `Game::getRandomNameForTeam`
0x0805fd50 pairs the two lists by index. `extract_bot_names.py` replays the
scripts into each tree's `_shared/bot-names.json`; `viewer/bot-names.js`
composes a level's lists and draws the names; `tests/bot_names_harness.mjs`
drives it, and the page's referee, in node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_bot_names import (build_manifest, replay, script_key,  # noqa: E402
                               team_lists, tokenize)
from extract_models import DEFAULT_GAME_DIR  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "bot_names_harness.mjs"
VANILLA_GAME = DEFAULT_GAME_DIR / "Mods" / "bf1942" / "Archives" / "bf1942" / "Game.rfa"
DC_DIR = DEFAULT_GAME_DIR / "Mods" / "DesertCombat"

# Every bot of the parity lab's Wake co-op round (run
# 20260927-000617-wake-coop, `<bf:roundstats>`, `is_ai 1`): a dedicated server
# named its Allies from `BritishNames`, which Wake's `Skirmish.con` runs, not
# the `AmericanNames` its `Bots.con` runs, and every name is one index of both
# lists.
LAB_WAKE = {
    1: ["Yoshihisa Tsuji", "Koji Matsumoto", "Shinsuke Mori", "Wataru Suzuki", "Masazumi Kawabe",
        "Yukio Sakuraba", "Takayuki Niwa", "Takehiro Kaminagayoshi", "Naozumi Shoda", "Kiichi Kakuta",
        "Masami Takahashi", "Masatoshi Kazawa", "Takahiro Fukada", "Kanao Hoshino", "Ryuta Suyama"],
    2: ["Murray Soames", "Fred Bailey", "Ronald Griffiths", "Gareth Hewitt", "Keith Taunton",
        "Oscar Fullfoot", "Stephen Bloggs", "Trevor Wobbless", "Robson Blunt", "Terrence Pickles",
        "Joesph Walker", "Stanley Rogers", "Michael Bull", "Cyril Smythe", "Arthur Fowler"],
}


def reader(files: dict[str, str]):
    table = {script_key(k): v for k, v in files.items()}

    def read(key: str):
        text = table.get(key)
        return None if text is None else (text, "test")
    return read


class ConsoleLineTests(unittest.TestCase):
    """`OldConsole::getArgs` 0x083de4d0: space and tab cut, quotes keep."""

    def test_tabs_and_spaces_separate(self) -> None:
        self.assertEqual(["game.addFirstNameOnTeam", "1", "Ahmed"],
                         tokenize("game.addFirstNameOnTeam\t1 Ahmed\r\n"))

    def test_a_quoted_run_keeps_its_space(self) -> None:
        self.assertEqual(["game.addSecondNameOnTeam", "1", "Al Bahrani"],
                         tokenize('game.addSecondNameOnTeam 1 "Al Bahrani"'))

    def test_a_run_line_names_a_con_script(self) -> None:
        self.assertEqual("bf1942/game/common/germannames.con",
                         script_key("Bf1942\\Game\\Common\\GermanNames"))
        self.assertEqual("a/b.con", script_key("a/b.con"))


class ReplayTests(unittest.TestCase):
    """What running a level's bot script leaves in the lists."""

    LEVEL = "bf1942/levels/x/singleplayer/skirmish.con"

    def test_runs_in_order_and_each_line_carries_its_own_team(self) -> None:
        run = replay(self.LEVEL, reader({
            self.LEVEL: "console.useRelativePaths 0\n\nrun bf1942/game/common/b\n"
                        "run bf1942/game/common/a\nconsole.useRelativePaths 1\n",
            "bf1942/game/common/a.con": "game.addFirstNameOnTeam 2 Ann\ngame.addSecondNameOnTeam 2 Ash\n",
            "bf1942/game/common/b.con": "Game.AddFirstNameOnTeam\t1 Carl\ngame.addSecondNameOnTeam 1 Cole\n",
        }))
        self.assertEqual(["bf1942/game/common/b.con", "bf1942/game/common/a.con"],
                         [s.key for s in run.segments])
        self.assertEqual({1: {"first": ["Carl"], "second": ["Cole"]}}, run.segments[0].teams)

    def test_the_console_refuses_a_two_word_name_and_a_team_it_has_no_list_for(self) -> None:
        run = replay("n.con", reader({"n.con": (
            "game.addSecondNameOnTeam 1 Al Bahrani\ngame.addSecondNameOnTeam 1 Talib\n"
            "game.addFirstNameOnTeam 3 Nobody\ngame.addFirstNameOnTeam 0 Nobody\n"
            "game.addFirstNameOnTeam 1\n")}))
        segment = run.segments[0]
        self.assertEqual({1: {"first": [], "second": ["Talib"]}}, segment.teams)
        self.assertEqual(4, len(segment.rejected))

    def test_rem_and_rem_blocks_are_skipped(self) -> None:
        run = replay("n.con", reader({"n.con": (
            "rem game.addFirstNameOnTeam 1 A\nbeginRem\ngame.addFirstNameOnTeam 1 B\nendRem\n"
            "game.addFirstNameOnTeam 1 C\n")}))
        self.assertEqual(["C"], run.segments[0].teams[1]["first"])

    def test_relative_paths_are_the_consoles_and_resolve_against_the_script(self) -> None:
        run = replay("lv/sp/s.con", reader({
            "lv/sp/s.con": "run names\nconsole.useRelativePaths 0\nrun top/names\n",
            "lv/sp/names.con": "game.addFirstNameOnTeam 1 Near\n",
            "top/names.con": "game.addFirstNameOnTeam 1 Far\n",
        }))
        self.assertEqual(["lv/sp/names.con", "top/names.con"], [s.key for s in run.segments])

    def test_a_scripts_own_lines_around_a_run_keep_their_order(self) -> None:
        run = replay("s.con", reader({
            "s.con": "game.addFirstNameOnTeam 1 A\nrun n\ngame.addFirstNameOnTeam 1 C\n",
            "n.con": "game.addFirstNameOnTeam 1 B\n",
        }))
        self.assertEqual(["s.con", "n.con", "s.con#1"], [s.key for s in run.segments])

    def test_a_level_without_the_script_loads_nothing(self) -> None:
        run = replay(self.LEVEL, reader({}))
        self.assertEqual([], run.segments)
        self.assertEqual([self.LEVEL], run.missing)

    def test_the_manifest_lists_each_script_once_and_each_levels_order(self) -> None:
        files = {
            "bf1942/game/common/a.con": "game.addFirstNameOnTeam 2 Ann\ngame.addSecondNameOnTeam 2 Ash\n",
            "bf1942/game/common/b.con": "game.addFirstNameOnTeam 1 Carl\ngame.addSecondNameOnTeam 1 Al Cole\n",
            "bf1942/levels/one/singleplayer/skirmish.con": "run /bf1942/game/common/a\nrun /bf1942/game/common/b\n",
            "bf1942/levels/two/singleplayer/skirmish.con": "console.useRelativePaths 0\nrun bf1942/game/common/b\n",
        }
        read = reader(files)
        manifest = build_manifest("Test", {
            "One": replay("bf1942/levels/one/singleplayer/skirmish.con", read),
            "Two": replay("bf1942/levels/two/singleplayer/skirmish.con", read),
            "Three": replay("bf1942/levels/three/singleplayer/skirmish.con", read),
        })
        self.assertEqual({"one": ["bf1942/game/common/a.con", "bf1942/game/common/b.con"],
                          "two": ["bf1942/game/common/b.con"], "three": []}, manifest["levels"])
        self.assertEqual(["game.addSecondNameOnTeam 1 Al Cole"],
                         manifest["scripts"]["bf1942/game/common/b.con"]["rejected"])
        self.assertEqual({"first": ["Carl"], "second": []}, team_lists(manifest, "two")[1])
        self.assertEqual({"first": [], "second": []}, team_lists(manifest, "three")[2])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class BotNamerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_levels_lists_join_in_run_order_and_drop_other_teams(self) -> None:
        self.assertEqual({"1": {"first": ["Carl"], "second": ["Cole"]},
                          "2": {"first": ["Ann", "Bob", "Dan"], "second": ["Ash", "Birch", "Dune", "Extra"]}},
                         self.r["composed"])
        empty = {"first": [], "second": []}
        self.assertEqual({"1": empty, "2": empty}, self.r["bare"])
        self.assertIsNone(self.r["unknown"])
        self.assertIsNone(self.r["noManifest"])

    def test_the_lists_pair_by_index_up_to_the_shorter(self) -> None:
        self.assertEqual(["A x", "B y"], self.r["pairs"])

    def test_a_taken_name_is_drawn_again_whatever_its_case(self) -> None:
        self.assertEqual({"name": "B y", "draws": 3}, self.r["redraw"])

    def test_twenty_draws_then_the_pairs_in_order(self) -> None:
        self.assertEqual({"name": "B y", "draws": 20, "NAME_DRAWS": 20}, self.r["sweep"])

    def test_every_pair_taken_numbers_the_last_draw(self) -> None:
        self.assertEqual("B y1", self.r["numbered"])
        self.assertEqual("B y2", self.r["numbered2"])

    def test_an_empty_list_is_player_then_player2(self) -> None:
        self.assertEqual("Player", self.r["emptyTeam"])
        self.assertEqual("Player3", self.r["emptyTaken"])
        self.assertEqual(["Player2", "Player3", "Player4"], self.r["namerEmpty"])

    def test_a_namer_never_repeats_a_name_across_teams_or_the_humans(self) -> None:
        names = [n.lower() for n in self.r["namer"]]
        self.assertEqual(len(names), len(set(names)))
        self.assertNotIn("q q", names)

    def test_a_tree_without_the_file_resolves_null(self) -> None:
        self.assertIsNone(self.r["loadMissing"])
        self.assertIsNone(self.r["loadThrows"])
        self.assertTrue(self.r["loadOk"])

    def test_the_referee_names_its_bots_through_name_for(self) -> None:
        bots = self.r["referee"]
        self.assertEqual([1, 2, 1, 2, 1, 2], [b["team"] for b in bots])
        firsts = {1: ("Ahmed", "Ali", "Abdul"), 2: ("Andrew", "Arthur")}
        for bot in bots:
            self.assertTrue(bot["name"].startswith(firsts[bot["team"]]), bot)
        self.assertEqual(len(bots), len({b["name"] for b in bots}))

    def test_without_a_namer_the_bots_keep_the_stand_in_table(self) -> None:
        table = self.r["table"]
        for i, bot in enumerate(self.r["refereeTable"]):
            nation = "German" if bot["team"] == 1 else "American"
            self.assertEqual(table[nation][i % len(table[nation])], bot["name"])

    def test_desert_combats_iraqis_carry_arabic_names(self) -> None:
        tree = self.r["trees"].get("desertcombat") or self.r["trees"].get("dc_final")
        if not tree:
            self.skipTest("no Desert Combat bot-names.json extracted")
        for level in ("el_alamein", "dc_basrahs_edge"):
            row = tree[level]
            # 33 first names; 39 second-name lines, four of them two words.
            self.assertEqual({"first": 33, "second": 35}, row["lists"]["1"])
            arabic = set(row["firstNames"]["1"])
            self.assertIn("Ahmed", arabic)
            for name in row["team1"]:
                self.assertIn(name.split(" ", 1)[0], arabic, name)
        # A DC map with no Skirmish.con loads no names: the engine's fallback.
        self.assertEqual("Player2", tree["dc_oil_fields"]["team1"][0])

    def test_vanilla_germans_carry_german_names(self) -> None:
        tree = self.r["trees"].get("bf1942")
        if not tree:
            self.skipTest("no vanilla bot-names.json extracted")
        german = set(tree["el_alamein"]["firstNames"]["1"])
        self.assertIn("Hans-Jörg", german)
        for name in tree["el_alamein"]["team1"]:
            self.assertIn(name.split(" ", 1)[0], german, name)
        self.assertNotIn("Fritz", {n.split(" ", 1)[0] for n in tree["el_alamein"]["team1"]})


@unittest.skipUnless(VANILLA_GAME.exists(), "needs the BF1942 install")
class InstalledGameTests(unittest.TestCase):
    """The real scripts, and the one real round a dedicated server named."""

    @classmethod
    def setUpClass(cls) -> None:
        from extract_bot_names import read_chain
        from extract_models import mod_chain
        cls.vanilla = build_manifest("bf1942", read_chain(mod_chain(DEFAULT_GAME_DIR, "bf1942")))
        cls.dc = (build_manifest("DesertCombat", read_chain(mod_chain(DEFAULT_GAME_DIR, "DesertCombat")))
                  if DC_DIR.is_dir() else None)

    def test_the_labs_wake_bots_are_index_pairs_of_the_skirmish_lists(self) -> None:
        lists = team_lists(self.vanilla, "wake")
        for team, names in LAB_WAKE.items():
            pairs = {f"{f} {s}" for f, s in zip(lists[team]["first"], lists[team]["second"])}
            for name in names:
                self.assertIn(name, pairs)

    def test_wake_runs_british_names_not_the_bots_con_americans(self) -> None:
        self.assertEqual(["bf1942/game/common/britishnames.con", "bf1942/game/common/japanesenames.con"],
                         self.vanilla["levels"]["wake"])

    def test_every_vanilla_name_file_is_64_by_64(self) -> None:
        for key, script in self.vanilla["scripts"].items():
            for team, lists in script["teams"].items():
                self.assertEqual((64, 64), (len(lists["first"]), len(lists["second"])), (key, team))

    def test_desert_combat_resolves_its_own_files_and_vanillas(self) -> None:
        if self.dc is None:
            self.skipTest("Desert Combat is not installed")
        scripts = self.dc["scripts"]
        german = scripts["bf1942/game/common/germannames.con"]
        self.assertTrue(german["origin"].startswith("DesertCombat/"))
        self.assertEqual((33, 35), (len(german["teams"]["1"]["first"]), len(german["teams"]["1"]["second"])))
        self.assertEqual(4, len(german["rejected"]))
        self.assertTrue(scripts["bf1942/game/common/britishnames.con"]["origin"].startswith("bf1942/"))
        self.assertEqual([], self.dc["levels"]["dc_oil_fields"])


if __name__ == "__main__":
    unittest.main()
