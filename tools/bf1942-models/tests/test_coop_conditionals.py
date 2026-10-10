"""`v_is_coop` tests in object and level scripts (ledger FHR-3).

Forgotten Hope ships `game/is_coop.con` and its scripts branch on it. The
library reads a script without running it, so it has to decide the test the
way a Conquest host does: both arms used to apply and the later one won.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import con as con_mod  # noqa: E402
from bf42.kit import parse_level_kits  # noqa: E402

PAK = """Var v_is_coop
ObjectTemplate.create PlayerControlObject Pak40Mount
if v_is_coop == False
\tObjectTemplate.setMaxSpeed 5/0/0
\tObjectTemplate.setInputToYaw c_PIYaw
else
\tObjectTemplate.setMaxSpeed 13/0/0
\tObjectTemplate.setInputToYaw c_PIMouseLookX
endIf
ObjectTemplate.create PlayerControlObject Seated
if v_is_coop == False
\tObjectTemplate.addTemplate Passenger_PCO3
endIf
if v_is_coop == True
\tObjectTemplate.hpLostWhileCriticalDamage 1
else
\tObjectTemplate.hpLostWhileCriticalDamage 0
endIf
"""


class CoopConditionalTests(unittest.TestCase):
    def library(self, text: str) -> con_mod.ObjectLibrary:
        lib = con_mod.ObjectLibrary()
        lib.add_con("objects/Test/Objects.con", text)
        return lib

    def test_a_conquest_host_takes_the_false_arm(self) -> None:
        lib = self.library(PAK)
        pak = lib.object("Pak40Mount")
        self.assertEqual(pak.max_speed, (5.0, 0.0, 0.0))
        self.assertEqual(pak.inputs["yaw"], "c_PIYaw")
        seated = lib.object("Seated")
        self.assertEqual([c.template for c in seated.children], ["Passenger_PCO3"])

    def test_a_coop_host_takes_the_true_arm(self) -> None:
        text = con_mod.resolve_coop_conditionals(PAK, is_coop=True)
        self.assertIn("setMaxSpeed 13/0/0", text)
        self.assertNotIn("setMaxSpeed 5/0/0", text)
        self.assertNotIn("Passenger_PCO3", text)
        self.assertIn("hpLostWhileCriticalDamage 1", text)

    def test_other_tests_keep_both_arms(self) -> None:
        text = "if v_gameplaymode == gpm_cq\nA\nelse\nB\nendIf\n"
        self.assertEqual(con_mod.resolve_coop_conditionals(text).split(),
                         text.split())

    def test_level_kits_follow_the_arm(self) -> None:
        init = ("game.setTeamSkin 1 GermanSoldier\n"
                "if v_is_coop == True\n"
                "game.setKit 1 0 1German_CloseQuartersMp40P\n"
                "else\n"
                "game.setKit 1 0 1German_CloseQuartersMp40\n"
                "endIf\n")
        self.assertEqual(parse_level_kits(init)[1].slots[0], "1German_CloseQuartersMp40")
        flipped = init.replace("== True", "== False")
        self.assertEqual(parse_level_kits(flipped)[1].slots[0], "1German_CloseQuartersMp40P")


if __name__ == "__main__":
    unittest.main()
