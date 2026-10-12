"""`patch_weapon_stats.py` brings a finished weapon glb's magazine block to
what `con.py` `weapon_stats()` writes today (ledger FA-6), without a re-bake."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import glbopt  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
import patch_weapon_stats as patch  # noqa: E402

CON = """
ObjectTemplate.create HandFireArms M1Garand
ObjectTemplate.magSize 8
ObjectTemplate.numOfMag 4
ObjectTemplate.magType 0
ObjectTemplate.reloadtime 4.0
ObjectTemplate.autoReload 0
ObjectTemplate.allowReloadOnEmptyClipOnly 1

ObjectTemplate.create HandFireArms No4
ObjectTemplate.magSize 5
ObjectTemplate.numOfMag 5
ObjectTemplate.magType 0
ObjectTemplate.reloadtime 1.6
"""
OLD_GARAND = {"size": 8, "magazines": 4, "type": 0, "reloadTime": 4.0, "autoReload": False}
NO4 = {"size": 5, "magazines": 5, "type": 0, "reloadTime": 1.6}


def glb(extras: dict) -> bytes:
    return glbopt.write_glb({"asset": {"version": "2.0"}, "extras": extras}, b"")


class PatchWeaponStatsTests(unittest.TestCase):
    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/HandWeapons/M1Garand/Objects.con", CON)
        return library

    def test_the_weapon_glb_gets_the_word_a_fresh_extract_writes(self) -> None:
        data = glb({"root": "M1Garand",
                    "weapon": {"roundOfFire": 3.2, "magazine": dict(OLD_GARAND)}})

        patched = patch.patch_bytes(data, self.library())

        doc, _ = glbopt.read_glb(patched)
        self.assertEqual({**OLD_GARAND, "reloadOnEmptyOnly": True},
                         doc["extras"]["weapon"]["magazine"])
        self.assertEqual(3.2, doc["extras"]["weapon"]["roundOfFire"])
        # A second pass has nothing to do.
        self.assertIsNone(patch.patch_bytes(patched, self.library()))

    def test_a_first_person_rig_names_its_weapon_beside_weapon_stats(self) -> None:
        data = glb({"soldier": "USSoldier", "weapon": "M1Garand",
                    "weaponStats": {"magazine": dict(OLD_GARAND)}})

        doc, _ = glbopt.read_glb(patch.patch_bytes(data, self.library()))

        self.assertIs(True, doc["extras"]["weaponStats"]["magazine"]["reloadOnEmptyOnly"])
        self.assertEqual("M1Garand", doc["extras"]["weapon"])

    def test_a_current_block_and_an_unknown_template_are_left_alone(self) -> None:
        library = self.library()
        self.assertIsNone(patch.patch_bytes(
            glb({"root": "No4", "weapon": {"magazine": dict(NO4)}}), library))
        self.assertIsNone(patch.patch_bytes(
            glb({"root": "Mp18", "weapon": {"magazine": dict(OLD_GARAND)}}), library))
        self.assertIsNone(patch.patch_bytes(glb({"root": "Sherman"}), library))

    def test_the_census_lists_only_the_weapons_that_declare_the_word(self) -> None:
        self.assertEqual({"M1Garand": {"reloadOnEmptyOnly": True}},
                         patch.census(self.library()))


if __name__ == "__main__":
    unittest.main()
