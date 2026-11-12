"""A blast on hulls: the push, a destroyed Armor's own blast, the seated crew.

Gap audit 2026-11-12 (`features/retail-inverse-gap-audit-2026-11-12`), entries
2, 3 and 30, read on `bf1942_lnxded.static`:

  * KNOCK-4 / KNOCK-5's non-soldier arm (`handleExplosionOnObject`
    0x08156500): every root with a physics node that a blast priced above zero
    is pushed `min(explosionForceMod * force / radius, explosionForceMax)`
    along `normalize(s^ + its row most along s)`, or the terrain's normal at
    `d < 0.001`, at the blast's point pulled onto its bounding sphere
    (0x08156ae6..0x08156b92). No exposure, no water tenth, no friendly-fire
    ratio, no soldier rise, no half-radius cut;
  * `Armor::status` (0x081739e0) on death calls `handleExplosion`
    (0x08173df0) at the object's position with its `explosionRadius` (+0xf8),
    `explosionMaterial` (+0xfc), `explosionDamage` (+0x100, only above 0.001),
    `explosionForce` (+0x104), its last hitter (+0x14) and team -1; the
    template defaults are 15 / 10 / 204 / 150 (`SimpleObjectTemplate` ctor
    0x081dbdf4..0x081dbe12). Its own wreck is priced and so pushed, on the
    terrain's normal; a hull it kills blows in turn;
  * HFD-12: `handleExplosion` splashes each seated occupant whose object flag
    bit 0 is clear (a seat reaching a `SeatObject`, SEAT-37) as a soldier.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("explosion_hulls_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True,
                          timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HullPushLawTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_force_has_no_falloff_and_takes_the_ceiling(self) -> None:
        law = self.out["law"]
        # 13 * 150 / 8, the same 4 m or 7.9 m off; nothing at the radius.
        self.assertEqual(243.75, law["sherman"]["force"])
        self.assertEqual(243.75, law["far"]["force"])
        self.assertEqual(0, law["past"]["force"])
        # A Willy's 20 * 150 / 8 = 375, held to the constructor's 300.
        self.assertEqual(300, law["willy"]["force"])
        # No soldier cut at half the radius.
        self.assertEqual(243.75, law["noCut"]["force"])

    def test_direction_is_the_separation_plus_the_nearest_row(self) -> None:
        law = self.out["law"]
        self.assertEqual([243.75, 0, 0], law["sherman"]["a"])
        # A hull turned a quarter: its forward row (world +X) is most along
        # s = (3, 0, 1), so dir = normalize(s^ + (1, 0, 0)).
        self.assertAlmostEqual(240.602568, law["turned"]["a"][0], places=4)
        self.assertAlmostEqual(39.044422, law["turned"]["a"][2], places=4)
        # Under it: the up row. On it: the terrain's normal.
        self.assertGreater(law["under"]["a"][1], 240)
        self.assertEqual([0, 243.75, 0], law["onIt"]["a"])

    def test_push_point_is_clamped_onto_the_bounding_sphere(self) -> None:
        self.assertEqual([3, 0, 0], self.out["point"]["outside"])
        self.assertEqual([1, 1, 0], self.out["point"]["inside"])


class DeathBlastWordTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()["words"]

    def test_template_words_over_the_constructor_defaults(self) -> None:
        self.assertEqual({"explosionRadius": 8, "explosionDamage": 5, "explosionMaterial": 204,
                          "explosionForce": 150, "explosionForceMod": 13,
                          "explosionForceMax": 300}, self.out["sherman"])
        # Vanilla's Daihatsu writes none of the four: 10 over 15 m.
        self.assertEqual(15, self.out["daihatsu"]["explosionRadius"])
        self.assertEqual(10, self.out["daihatsu"]["explosionDamage"])

    def test_no_blast_at_zero_damage_or_without_the_table(self) -> None:
        self.assertIsNone(self.out["raft"])        # Elco80Raft: explosionDamage 0
        self.assertIsNone(self.out["noArmor"])     # not an Armor
        self.assertIsNone(self.out["oldTree"])     # a damage.json from before

    def test_record_is_handleExplosions_arguments(self) -> None:
        rec = self.out["shermanRecord"]
        self.assertEqual([1, 2, 3], rec["splashPoint"])
        self.assertEqual((8, 204, 5, 150),
                         (rec["splashRadius"], rec["splashMaterial2"],
                          rec["splashDamage"], rec["splashForce"]))
        self.assertIsNone(rec["firer"])


class DeathBlastPathTests(unittest.TestCase):
    """The page's path (`vehicle-hits.js`, the headless runner's too) and
    the room server's (`room-hits.mjs` `deathBlasts`), on one scene."""
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def check_scene(self, run: dict) -> None:
        # The tank's blast (5 over 8 m, 204) kills the 9 HP jeep 3 m off:
        # 5 * (1 - 3/8) * 3 = 9.375; the jeep blows in turn.
        self.assertEqual(0, run["hp"]["jeep"])
        # The boat 6 m back takes 5 * (1 - 6/8) * 3 from the tank and
        # 5 * (1 - sqrt(45)/8) * 3 from the jeep.
        self.assertAlmostEqual(143.8279, run["hp"]["boat"], places=3)
        self.assertEqual(100, run["hp"]["far"])
        # A crouched man 4 m off: 5 * (1 - 4/8) * 12 = 30, dead.
        self.assertEqual(0, run["footBot"])
        # The boat's passenger (a SeatObject seat) is splashed; the far
        # tank's driver (no SeatObject, bit 0 set) never is.
        self.assertLess(run["crewBot"], 30)
        self.assertEqual(30, run["driverBot"])
        pushes = run["pushes"]
        # Each wreck's own blast pushes it up the terrain's normal at its
        # origin: 13 * 150 / 8 for the tank, 300 for the jeep.
        self.assertIn({"p": [0, 0, 0], "a": [0, 243.75, 0]}, pushes["1"]["pushes"])
        self.assertIn({"p": [3, 0, 0], "a": [0, 300, 0]}, pushes["2"]["pushes"])
        # The tank's blast on the jeep: at its sphere (radius 2), along +X.
        self.assertIn({"p": [1, 0, 0], "a": [300, 0, 0]}, pushes["2"]["pushes"])
        # Nothing out of reach is touched.
        self.assertEqual([], pushes["4"]["pushes"])

    def test_page(self) -> None:
        run = self.out["page"]
        self.check_scene(run)
        self.assertEqual([1, 2], run["wrecked"])
        # Every kill and wound names the man who destroyed the tank.
        self.assertEqual("p1", run["jeepKiller"])
        self.assertTrue(all(row["attacker"] == "p1" for row in run["landed"]))
        self.assertIn({"id": "footBot", "lost": 30, "attacker": "p1"}, run["landed"])

    def test_room(self) -> None:
        run = self.out["room"]
        self.check_scene(run)
        self.assertEqual(2, run["blasts"])
        self.assertEqual([1, 2], run["died"])
        self.assertEqual(7, run["footBotLastHit"])

    def test_a_tree_without_the_table_blows_nothing(self) -> None:
        run = self.out["pageOldTree"]
        self.assertEqual(9, run["hp"]["jeep"])
        self.assertEqual(30, run["footBot"])
        self.assertTrue(all(not b["pushes"] for b in run["pushes"].values()))


if __name__ == "__main__":
    unittest.main()
