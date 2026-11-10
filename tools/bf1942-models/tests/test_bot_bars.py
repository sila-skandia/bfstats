"""A generated layer's strategy template, chosen by the flags in play, and a
mod's own bar (features/bot-map-generation, section 19).

`tests/bot_bars_harness.mjs` runs `sim/botgen.mjs templateFor`,
`sim/judge.mjs aliveLevels` / `chooseBar` and `sim/botbatch.mjs
verdictWithBar` on hand-written areas and rows; the Python half reads the
two templates kept as source.
"""

from __future__ import annotations

import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "bot_bars_harness.mjs"
TEMPLATES = ROOT / "bot-layers" / "_templates"


def run_harness() -> dict:
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr[-2000:])
    return json.loads(proc.stdout)


class TemplateChoiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_few_flags_in_play_take_kursks_template_and_more_take_kharkovs(self) -> None:
        self.assertEqual(self.out["FEW_FLAGS"], 3)
        self.assertEqual((self.out["three"]["name"], self.out["three"]["inPlay"]), ("few", 3))
        self.assertEqual((self.out["four"]["name"], self.out["four"]["inPlay"]), ("symmetric", 4))

    def test_a_flag_the_probe_took_out_and_a_fixed_base_are_not_in_play(self) -> None:
        # The_Maze: five capturable flags, two of them out of play, two bases nobody can take.
        self.assertEqual((self.out["mazeLike"]["name"], self.out["mazeLike"]["inPlay"]), ("few", 3))
        # Five capturable and no fixed base: every flag counts.
        self.assertEqual((self.out["noBases"]["name"], self.out["noBases"]["inPlay"]), ("symmetric", 5))

    def test_each_template_lists_kursks_and_kharkovs_own_strategies(self) -> None:
        self.assertEqual(self.out["few"]["strategies"], ["breakOut", "holdAndCamp", "single", "double"])
        self.assertIn("Kursk", self.out["few"]["source"])
        self.assertEqual(self.out["many"]["strategies"], ["normal", "bridge", "finalPush", "breakOut"])

    def test_every_template_defines_what_its_side_lists_and_prerequisites_name(self) -> None:
        for name in ("few", "symmetric"):
            folder = TEMPLATES / name
            sides = json.loads((folder / "template.json").read_text())["strategies"]
            strategies = (folder / "Strategies.con").read_text(encoding="latin-1")
            prereqs = (folder / "prerequisites.con").read_text(encoding="latin-1")
            conds = (folder / "conditions.con").read_text(encoding="latin-1")
            made = set(re.findall(r"aiStrategy\.createStrategy (\S+)", strategies))
            self.assertTrue(set(sides) <= made, name)
            wanted = set(re.findall(r"aiStrategy\.setPrerequisite (\S+)", strategies))
            self.assertTrue(wanted <= set(re.findall(r"aiStrategy\.createPrerequisite (\S+)", prereqs)), name)
            used = {l.split()[1] for l in prereqs.splitlines() if l.startswith("aiStrategy.addCondition")}
            self.assertTrue(used <= set(re.findall(r"aiStrategy\.create\w+Condition (\S+)", conds)), name)

    def test_kursks_attack_posts_no_defender(self) -> None:
        text = (TEMPLATES / "few" / "Strategies.con").read_text(encoding="latin-1")
        block = text.split("aiStrategy.createStrategy single")[1].split("aiStrategy.createStrategy")[0]
        self.assertIn("aiStrategy.Aggression 1.0", block)
        self.assertIn("aiStrategy.NumberOfDefences 0", block)


class ModBarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_level_with_no_fight_is_dropped_from_a_bar_with_what_it_fails(self) -> None:
        self.assertEqual(self.out["alive"]["alive"], ["a", "b"])
        self.assertEqual(self.out["alive"]["dropped"], [{"level": "dead", "failed": ["16:bothSidesKill"]}])

    def test_a_mod_level_is_judged_by_its_own_bar_from_three_alive_levels(self) -> None:
        self.assertEqual(self.out["ownThree"]["against"], "desertcombat")
        self.assertEqual(self.out["ownTwo"]["against"], "dice")
        self.assertIn("fewer than 3", self.out["ownTwo"]["why"])
        self.assertEqual(self.out["noOwn"]["against"], "dice")

    def test_a_vanilla_or_community_level_is_always_judged_by_dices_bar(self) -> None:
        self.assertEqual(self.out["vanilla"]["against"], "dice")

    def test_a_pass_on_the_mods_bar_keeps_dices_verdict_beside_it(self) -> None:
        own = self.out["withOwn"]
        self.assertEqual((own["against"], own["verdict"], own["againstDice"]), ("desertcombat", "pass", "fail"))
        thin = self.out["withThin"]
        # A bar too thin to judge by is reported, and the verdict is DICE's.
        self.assertEqual((thin["against"], thin["verdict"], thin["againstOwnMod"]), ("dice", "fail", "pass"))

    def test_the_alive_checks_hold_under_either_bar(self) -> None:
        dead = self.out["deadOwn"]
        self.assertEqual((dead["against"], dead["outcome"], dead["againstDice"]), ("desertcombat", "no-fight", "no-fight"))

    def test_a_mods_bar_is_its_own_file(self) -> None:
        self.assertEqual(self.out["files"], {"dice": "vehicles-dice.json", "mod": "vehicles-desertcombat.json",
                                             "vanilla": "vehicles-dice.json", "foot": "onfoot-fh.json"})


class StandInWeaponTests(unittest.TestCase):
    """A level whose bots would be dealt no kit is not judged (section 19)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_lint_finds_a_side_with_no_kit(self) -> None:
        kits = self.out["kits"]
        self.assertEqual(kits["full"]["missing"], [])
        self.assertEqual(kits["FULL"]["missing"], [])
        self.assertEqual(kits["half"]["missing"], [2])
        self.assertEqual(kits["absent"]["missing"], [1, 2])
        # A kit whose items arm no bot is no kit.
        self.assertEqual(kits["unarmed"]["missing"], [1])
        self.assertEqual(self.out["kitsNoFile"]["missing"], [1, 2])

    def test_the_detector_counts_the_bots_dealt_no_kit(self) -> None:
        self.assertEqual(self.out["botsWithoutKit"], 2)

    def test_matches_with_a_bot_dealt_no_kit_are_refused(self) -> None:
        refusal = self.out["refusal"]
        self.assertEqual((refusal["outcome"], refusal["noKit"]), ("unsuitable", {"matches": 1, "of": 3, "bots": 2}))
        self.assertIsNone(self.out["noRefusal"])


class DoctrineTests(unittest.TestCase):
    """Every match is played under the page's doctrine, and nothing is judged across doctrines (section 19)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_default_is_the_pages_garrison(self) -> None:
        self.assertEqual(self.out["defaultDoctrine"], "garrison")

    def test_a_row_names_its_doctrine_and_one_from_before_the_field_was_the_sai(self) -> None:
        self.assertEqual(self.out["doctrineOf"], ["sai", "garrison", "sai/garrison"])

    def test_a_bar_or_rows_of_another_doctrine_are_refused(self) -> None:
        m = self.out["mismatch"]
        self.assertIsNone(m["same"])
        self.assertIn("sai doctrine", m["oldBar"])
        self.assertIn("matches under sai", m["oldRows"])
        self.assertIsNone(m["saiOnPurpose"])

    def test_an_acceptance_does_not_cross_doctrines(self) -> None:
        self.assertTrue(self.out["carrySameDoctrine"])
        self.assertIn("sai doctrine", self.out["carryOtherDoctrine"])


if __name__ == "__main__":
    unittest.main()
