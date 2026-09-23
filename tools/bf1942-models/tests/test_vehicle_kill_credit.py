"""Which hulls the map shows, who killed a hull's crew, and the line the
message log writes for it: `viewer/map-vehicle-marks.js`,
`viewer/vehicle-damage.js` (`killedBy`) and `viewer/chat-log.js`
(`deathLines`), driven headless by `vehicle_kill_credit_harness.mjs`.

The icon rule is the vehicle pass of the client's `BfMap::update`
(BF1942.exe 0x0046a680, ledger MMAP-3); the kill credit is
`GameServer::_giveDamage` (lnxded 0x0814b870, ledger AI-76).
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
HARNESS = Path(__file__).with_name("vehicle_kill_credit_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        module = ((VIEWER / "vehicle-damage.js").read_text()
                  .replace("from './armor.js'", "from './armor.mjs'")
                  .replace("from './effects-core.js'", "from './effects-core.mjs'"))
        (work / "vehicle-damage.mjs").write_text(module)
        shutil.copyfile(VIEWER / "armor.js", work / "armor.mjs")
        shutil.copyfile(VIEWER / "effects-core.js", work / "effects-core.mjs")
        shutil.copyfile(VIEWER / "projectile-damage.js", work / "projectile-damage.js")
        shutil.copyfile(VIEWER / "map-vehicle-marks.js", work / "map-vehicle-marks.js")
        shutil.copyfile(VIEWER / "chat-log.js", work / "chat-log.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class MapVehicleMarkTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_an_enemy_crewed_hull_is_not_on_the_map(self) -> None:
        self.assertIsNone(self.r["marks"]["enemyCrewed"])
        self.assertIsNone(self.r["marks"]["enemyCrewedTwo"])

    def test_a_friendly_crewed_hull_is_marked_friendly(self) -> None:
        self.assertEqual("friendly", self.r["marks"]["friendlyCrewed"])
        # The rule is the reader's side, not a fixed colour per team.
        self.assertEqual("friendly", self.r["marks"]["axisReaderSeesAxisCrew"])

    def test_an_empty_hull_is_marked_empty_in_the_client_grey(self) -> None:
        self.assertEqual("empty", self.r["marks"]["emptyAlive"])
        # 0.574219 (0x3f130004) of 255.
        self.assertEqual([146, 146, 146], self.r["emptyTint"])

    def test_a_wreck_has_no_icon(self) -> None:
        self.assertIsNone(self.r["marks"]["wreck"])
        self.assertIsNone(self.r["marks"]["wreckFriendlyCrew"])

    def test_an_object_with_no_armor_has_no_icon(self) -> None:
        self.assertIsNone(self.r["marks"]["noArmor"])

    def test_a_hull_held_for_the_other_side_is_hidden(self) -> None:
        self.assertIsNone(self.r["marks"]["heldForEnemy"])
        self.assertEqual("empty", self.r["marks"]["heldForUs"])

    def test_the_last_occupant_walked_decides(self) -> None:
        self.assertEqual("friendly", self.r["marks"]["mixedLastFriendly"])
        self.assertIsNone(self.r["marks"]["mixedLastEnemy"])


class HullKillCreditTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_lethal_hit_names_the_killer(self) -> None:
        c = self.r["credit"]
        self.assertEqual({"last": "bot_3", "killedBy": None}, c["afterFirst"])
        # A hit with nobody behind it leaves the last hitter alone (the Armor's
        # setter is only called when the attacker resolves, 0x0814b947).
        self.assertEqual({"last": "bot_3", "killedBy": None}, c["afterAnon"])
        self.assertEqual({"last": "local", "killedBy": "local", "destroyed": True}, c["afterKill"])

    def test_a_round_into_the_wreck_changes_nothing(self) -> None:
        self.assertEqual({"last": "local", "killedBy": "local"}, self.r["credit"]["afterWreckHit"])

    def test_a_respawned_hull_starts_clean(self) -> None:
        self.assertEqual({"last": None, "killedBy": None}, self.r["credit"]["afterReset"])

    def test_a_burn_down_kills_with_nobody_behind_it(self) -> None:
        b = self.r["burnDown"]
        self.assertTrue(b["destroyed"])
        self.assertEqual("local", b["last"])
        self.assertIsNone(b["killedBy"])

    def test_both_round_paths_carry_the_attacker(self) -> None:
        s = self.r["set"]
        self.assertEqual({"killedBy": "bot_1", "destroyed": True}, s["hit"])
        self.assertEqual("local", s["splash"]["killedBy"])
        self.assertTrue(s["splash"]["destroyed"])
        self.assertTrue(s["splash"]["soldierHit"])


class DeathLineTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def line(self, key: str) -> list:
        return [(row["text"], row["team"]) for row in self.r["lines"][key]["lines"]]

    def test_a_hull_kill_prints_killer_word_victim(self) -> None:
        self.assertEqual([("Player [Sherman] Hans", 2)], self.line("humanTankKillsCrew"))
        self.assertEqual([("Davis [Sherman] Hans", 2)], self.line("botTankKillsCrew"))
        self.assertEqual([("Hans [PanzerIV] Player", 1)], self.line("botTankKillsHuman"))
        self.assertEqual("Hans [PanzerIV] Player", self.r["lines"]["botTankKillsHuman"]["centre"])

    def test_an_on_foot_kill_prints_the_default_word(self) -> None:
        self.assertEqual([("Player [killed] Hans", 2)], self.line("onFootKill"))

    def test_no_killer_or_his_own_hand_is_no_more(self) -> None:
        self.assertEqual([("Hans is no more", 0)], self.line("hullDiedWithNobody"))
        self.assertEqual([("Player is no more", 0)], self.line("ownHand"))

    def test_a_team_kill_is_two_grey_lines(self) -> None:
        self.assertEqual([("Davis killed a teammate", 0), ("Hans is no more", 0)],
                         self.line("teamKill"))


if __name__ == "__main__":
    unittest.main()
