"""`conformance_weapons.py`: the raw reading of a weapon's script and the
five classes it sorts a disagreement into."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import conformance_weapons as cw  # noqa: E402

SCRIPT = """
ObjectTemplate.create HandFireArms Rifle
ObjectTemplate.magSize 5
ObjectTemplate.fireOnce c_True
ObjectTemplate.setRecoilForceUp CRD_UNIFORM/1/2/0
ObjectTemplate.someNewWord 3
ObjectTemplate.addTemplate RifleLod
ObjectTemplate.setPosition 0/1/2
ObjectTemplate.create HandFireArms Rifle
ObjectTemplate.magSize 99
ObjectTemplate.create SimpleObject Other
ObjectTemplate.active Rifle
ObjectTemplate.reloadTime 4
"""


class NoPage:
    def reads(self, pattern):
        return pattern is None or "magazine" not in pattern


class RawReadingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = cw.RawLibrary()
        self.library.add_con("objects/Handweapons/Rifle/Objects.con", SCRIPT)
        self.words = cw.template_words(self.library.raw["rifle"])

    def test_the_first_create_of_a_name_keeps_its_words(self) -> None:
        # LOAD-1: the second `create Rifle` configures nothing.
        self.assertEqual(["5"], self.words["magsize"])
        self.assertEqual(["objects/Handweapons/Rifle/Objects.con"],
                         self.library.shadowed["rifle"])

    def test_a_reopened_template_takes_what_follows(self) -> None:
        self.assertEqual(["4"], self.words["reloadtime"])
        self.assertEqual(1, self.library.reopened["rifle"])

    def test_a_childs_placement_is_not_the_weapons_word(self) -> None:
        self.assertNotIn("setposition", self.words)

    def test_values_are_compared_as_the_engine_reads_them(self) -> None:
        self.assertTrue(cw.same("bool", "c_True", True))
        self.assertTrue(cw.same("vec", "CRD_UNIFORM/1/2/0", [1.0, 2.0]))
        self.assertFalse(cw.same("num", "5", 6))
        self.assertTrue(cw.same("int", "7.9", 7))
        self.assertTrue(cw.same("str", '"Ammo/Icon.tga"', "ammo/icon.tga"))

    def test_each_disagreement_gets_its_class(self) -> None:
        report = cw.Report()
        stats = {"magazine": {"size": 6}, "fireOnce": True, "recoil": {"up": [1.0, 2.0]}}
        cw.check_words(report, "Rifle", self.library.raw["rifle"],
                       {"stats": [("weapon glb", stats)]}, NoPage())
        found = {(row["class"], row["what"]) for row in report.rows}
        self.assertEqual({("c", "magsize"),        # 5 in the script, 6 in the tree
                          ("a", "somenewword"),    # no rule carries it
                          ("a", "reloadtime")},    # a rule, and not in the tree
                         found)
        stats["magazine"] = {"size": 5, "reloadTime": 4.0}
        report = cw.Report()
        cw.check_words(report, "Rifle", self.library.raw["rifle"],
                       {"stats": [("weapon glb", stats)]}, NoPage())
        self.assertEqual({("b", "magsize"), ("b", "reloadtime"), ("a", "somenewword")},
                         {(row["class"], row["what"]) for row in report.rows})

    def test_a_rolled_item_is_each_of_its_variants(self) -> None:
        loadouts = {
            "levels": {"l": {"1": {"soldier": "S", "slots": {"0": "K"}}}},
            "kits": {"K": {"items": ["Roll", "Knife"],
                           "random": [{"template": "Roll", "variants": ["Roll1", None, "Roll3"]}]}},
        }
        dealt = cw.level_weapons(loadouts, ["l"])
        self.assertEqual({"roll1", "roll3", "knife"}, set(dealt))
        self.assertEqual({"S"}, dealt["knife"]["soldiers"])


if __name__ == "__main__":
    unittest.main()
