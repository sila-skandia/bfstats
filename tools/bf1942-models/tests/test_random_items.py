"""`viewer/random-items.js`: what a kit's `Random*` item hands a spawn.

FHSW's kits carry bundles like `RandomGBTankcommander` with
`setRandomGeometries 4`. The engine never makes an object of that name: every
kit object rolls one process-wide counter per rolled child and creates the
numbered template it lands on (ledger KIT-1..KIT-4). The page passed the bundle
through as if it were a weapon, so Gold Beach's British tank commander was
drawn with a No4 and a bot with the bundle held nothing it could fire. These
pin the engine's counter law and the resolution `kit-loadout.js` does with it,
under node, on FHSW-shaped `loadouts.json` rows.
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
HARNESS = Path(__file__).with_name("random_items_harness.mjs")
MODULES = ["random-items.js", "kit-loadout.js", "kit-icon.js"]

V = "RandomGBTankcommander"
S = "RandomSmokeItem4M8"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RandomItemsTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    # --- the counter (KIT-2) -------------------------------------------------

    def test_the_counter_starts_at_one_so_the_first_roll_is_two(self) -> None:
        # .data 0x08720754 holds 1; `inc` comes before the wrap test.
        self.assertEqual(1, self.r["startsAt"])
        self.assertEqual([2, 3, 4, 1, 2], self.r["fourWay"])

    def test_one_counter_serves_every_child(self) -> None:
        # From 2, a 2-way child bumps to 3, past its N: back to 1. A 6-way
        # child after it continues from that shared 1.
        self.assertEqual(1, self.r["twoWayAfter"])
        self.assertEqual(2, self.r["sixWayAfter"])

    # --- a kit's roll (KIT-1, KIT-3) -----------------------------------------

    def test_a_kit_rolls_every_rolled_child_in_order(self) -> None:
        rolls = self.r["kitRolls"]
        self.assertEqual([f"{V}2", f"{V}4", f"{V}1", f"{V}3"],
                         [r[V.lower()] for r in rolls])
        # The smoke roll bumps the same counter between the weapon rolls.
        self.assertEqual([f"{S}3", f"{S}5", f"{S}2", None],
                         [r[S.lower()] for r in rolls])
        self.assertEqual(4, self.r["counterAfter"])

    def test_a_peek_names_the_next_roll_and_spends_nothing(self) -> None:
        self.assertEqual(1, self.r["peekSpends"])
        self.assertTrue(self.r["peekMatchesFirst"])

    def test_a_resolved_row_names_variants_and_drops_an_empty_roll(self) -> None:
        got = self.r["resolved"]
        self.assertEqual(f"{V}2", got["primary"])
        self.assertEqual([f"{V}2", "KnifeAllies", f"{S}3", "RepairPack"], got["items"])
        self.assertEqual(["KnifeAllies", f"{V}2", f"{S}3", "RepairPack"], got["weapons"])
        # The loadouts row itself is left alone.
        self.assertEqual(V, got["untouched"])
        self.assertTrue(self.r["plainRow"])
        self.assertEqual({"plain": "Mp40", "rolled": f"{V}2", "none": None}, self.r["held"])

    # --- kit-loadout.js (KIT-4) ----------------------------------------------

    def test_each_spawn_holds_the_variant_its_kit_rolled(self) -> None:
        lo = self.r["loadout"]
        # The deploy screen names the next roll before the spawn spends it.
        self.assertEqual(f"{V}2", lo["beforeSpawn"])
        self.assertEqual([f"{V}2", f"{V}4", f"{V}1", f"{V}3"],
                         [life["weapon"] for life in lo["lives"]])
        # Asking again within a life does not roll again.
        self.assertTrue(all(life["weapon"] == life["again"] for life in lo["lives"]))

    def test_the_weapon_slots_name_the_variants(self) -> None:
        lives = self.r["loadout"]["lives"]
        self.assertEqual(["1:KnifeAllies", f"3:{V}2", f"4:{S}3", "6:RepairPack"],
                         lives[0]["slots"])
        # A roll that found no template leaves its slot empty.
        self.assertEqual(["1:KnifeAllies", f"3:{V}3", "6:RepairPack"], lives[3]["slots"])

    def test_a_bot_is_dealt_a_variant_with_its_own_ai_entry(self) -> None:
        bots = self.r["loadout"]["bots"]
        self.assertEqual([f"{V}1", f"{V}3", f"{V}1", f"{V}3"], [b["primary"] for b in bots])
        for bot in bots:
            self.assertEqual([bot["primary"], "KnifeAllies"], bot["weapons"])

    def test_a_picked_up_kit_keeps_the_variant_its_owner_raised(self) -> None:
        self.assertEqual(f"{V}4", self.r["loadout"]["pickedUp"])

    def test_a_kit_with_nothing_rolled_is_unchanged(self) -> None:
        lo = self.r["loadout"]
        self.assertEqual("Mp40", lo["rifleman"])
        self.assertEqual("FrenchSoldier", lo["soldier"])


if __name__ == "__main__":
    unittest.main()
