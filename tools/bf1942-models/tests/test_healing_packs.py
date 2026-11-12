"""The medic bag and the wrench on retail's law, and a dead engineer's rounds
going with their kit (`viewer/healing-packs.js`, `bot-referee.js` `usePack`,
`gunfire.js` `releaseRounds`, `kit-drops-page.js`).

Retail, read on lnxded:

* `BFSoldier::useMedPack` 0x082768d0 heals every wounded soldier within
  `healDistance` by `healFactor`, with no team test, then the holder by
  `selfHealFactor` (SUP-15, SUP-27): vanilla 10 m, 0.25, 0.15 a round.
* `BFSoldier::useRepairPack` 0x08276100 repairs nothing while the holder
  crouches (`getPose() == 1` at 0x0827612d; the crouched branch disarms
  instead), skips a hull whose PlayerControlObject team is set and not the
  holder's (0x08276731) and an Armor in no PlayerControlObject (0x0827670f),
  and heals the closest wounded hull within `radius + repairDistance`.
* A bot fires its packs through the same Fire branch (SUP-27), so it heals
  by that law, not one friend in a cone.
* `FireArms::releaseProjectilePool` 0x08287ee0, from `~FireArms`, destroys a
  weapon's pooled rounds with no `detonate` (FA-2); the kit is destroyed 30 s
  after a death on foot (KITDROP-5) and at once after one in a seat
  (KITDROP-1).

The room server's half (`server/room-packs.mjs`) is `test_room.py` (z3p).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "healing_packs_harness.mjs"


class HealingPackTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS), str(ROOT)], capture_output=True,
                              text=True, timeout=120, cwd=ROOT)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    # --- useMedPack ----------------------------------------------------------

    def test_the_bag_heals_every_wounded_soldier_in_ten_metres_enemies_too(self) -> None:
        bag = self.r["bag"]
        self.assertEqual({"radius": 10, "allyHeal": 0.25, "selfHeal": 0.15, "kind": "medic"}, bag["pack"])
        self.assertEqual({"friend": 0.25, "enemy": 0.25, "edge": 0.25, "me": 0.15}, bag["healed"])

    def test_the_holder_heals_last_and_only_when_wounded(self) -> None:
        self.assertEqual("me", self.r["bag"]["selfLast"])
        self.assertFalse(self.r["bag"]["wholeHolder"])

    # --- useRepairPack -------------------------------------------------------

    def test_the_wrench_repairs_the_closest_hull_nobody_on_the_other_side_holds(self) -> None:
        w = self.r["wrench"]
        # The enemy's hull at 2.5 m and the static Armor at 1 m are passed
        # over; the empty hull at 3 m beats the holder's own at 3.5 m.
        self.assertEqual("empty", w["standing"])
        self.assertEqual("mine", w["noEmpty"])
        self.assertEqual("near-enemy", w["asEnemy"])
        self.assertIsNone(w["outOfReach"])

    def test_a_crouched_wrench_repairs_nothing(self) -> None:
        self.assertIsNone(self.r["wrench"]["crouched"])

    def test_the_numbers_are_the_holders_soldier_templates(self) -> None:
        p = self.r["params"]
        self.assertEqual(0.2, p["dc"]["repairHeal"])
        self.assertEqual(2.0, p["dc"]["disarmRadius"])
        self.assertEqual(0.5, p["topLevel"]["allyHeal"])
        self.assertIsNone(p["none"])

    def test_only_the_templates_named_medpack_and_repairpack_are_packs(self) -> None:
        self.assertEqual(["medic", "medic", "repair", None, None, None], self.r["params"]["kinds"])

    # --- a bot's pack --------------------------------------------------------

    def test_a_bot_medic_heals_by_the_human_law(self) -> None:
        b = self.r["bot"]
        # A friend behind it and an enemy beside it, both in 10 m, and itself;
        # not the friend 12 m off.
        self.assertEqual({"bot": 0.15, "friendBehind": 0.25, "enemy": 0.25, "farFriend": 0}, b["after"])
        self.assertEqual(["friendBehind", "enemy", "bot"], b["healed"])

    def test_a_bot_wrench_repairs_a_hull_and_not_while_crouched(self) -> None:
        b = self.r["bot"]
        self.assertEqual(7, b["repaired"])
        self.assertEqual(0.15, b["standingRepair"])
        self.assertEqual(0, b["crouchedRepair"])

    # --- the kit's rounds ----------------------------------------------------

    def test_a_destroyed_kit_takes_its_rounds_unexploded(self) -> None:
        rel = self.r["release"]
        self.assertEqual(2, rel["count"])
        self.assertEqual(["mineB", "bullet"], rel["left"])
        self.assertEqual(2, rel["pooled"])
        self.assertEqual(0, rel["none"])

    def test_a_kit_dies_thirty_seconds_after_a_death_on_foot(self) -> None:
        k = self.r["kitDeath"]
        self.assertEqual([], k["at29"])
        self.assertEqual(["first"], k["at30"])

    def test_a_kit_dies_at_once_with_a_death_in_a_seat(self) -> None:
        self.assertEqual(["first", "second"], self.r["kitDeath"]["seat"])

    def test_in_a_room_the_kit_still_goes_thirty_seconds_on(self) -> None:
        k = self.r["kitDeath"]
        self.assertEqual(["first", "second"], k["roomAtOnce"])
        self.assertEqual(["first", "second", "third"], k["room30"])


if __name__ == "__main__":
    unittest.main()
