"""Damage parity (ledger DMG-3, DMG-4), driven headless by
`damage_parity_harness.mjs`.

The engine's direct-hit law (`GameServer::handleCollisionForProjectile`
0x08153ba0, bf1942_lnxded.static) is angle term x damageMod x
`Projectile::getDamage`: the round's material damage, falling off linearly
from `distToStartLoseDamage` to `minDamage` at `distToMinDamage` from where
it was fired (0x0831f3c0). A soldier is priced by the capsule the round met
(head 40, chest 41, limbs 42, each its own defence group), and his
`angleMod 1` makes the angle term 1. A hull pays `angleMod + (1 - angleMod)
sin(abs(cos) pi/2)` with its own `angleMod`; the template default is 0 and
only the aircraft author one.

The prices are vanilla's: the Colt 17.5 / 10 / 5 halving between 20 and 40 m,
the Thompson 15 / 9 / 5 halving between 40 and 80 m, the K98 50 / 20 / 10
with no falloff.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("damage_parity_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DamageParityTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- a bot's hand-weapon round ------------------------------------------------

    def test_a_round_is_priced_by_the_material_it_meets(self) -> None:
        colt = self.results["price"]["colt"]
        self.assertEqual(17.5, colt["head10"])
        self.assertEqual(10, colt["chest10"])
        self.assertEqual(5, colt["limb10"])
        k98 = self.results["price"]["k98"]
        self.assertEqual([50, 20, 10], [k98["head150"], k98["chest150"], k98["limb150"]])

    def test_a_pistol_round_halves_between_20_and_40_m(self) -> None:
        colt = self.results["price"]["colt"]
        self.assertEqual(10, colt["chest20"])
        self.assertEqual(7.5, colt["chest30"])
        self.assertEqual(5, colt["chest40"])
        # Flat beyond `distToMinDamage`.
        self.assertEqual(5, colt["chest60"])
        self.assertEqual(8.75, colt["head60"])

    def test_an_smg_round_halves_between_40_and_80_m(self) -> None:
        thompson = self.results["price"]["thompson"]
        self.assertEqual(9, thompson["chest30"])
        self.assertEqual(6.75, thompson["chest60"])
        self.assertEqual(4.5, thompson["chest100"])
        self.assertEqual(11.25, thompson["head60"])

    def test_a_rifle_round_does_not_fall_off(self) -> None:
        self.assertEqual(20, self.results["price"]["k98"]["chest150"])

    def test_the_stand_in_body_is_priced_as_the_torso(self) -> None:
        price = self.results["price"]
        self.assertEqual(41, price["standIn"])
        self.assertEqual(10, price["colt"]["unnamed"])

    def test_a_weapon_without_its_round_spec_has_no_falloff_to_apply(self) -> None:
        # The table still names the round's material; only the falloff is lost.
        self.assertEqual(10, self.results["price"]["colt"]["templateOnly60"])

    # --- the referee -------------------------------------------------------------

    def test_the_referee_prices_the_stand_in_at_the_distance_it_met(self) -> None:
        ref = self.results["referee"]
        self.assertEqual([41, 10], ref["standIn10"]["asked"])
        self.assertEqual(10, ref["standIn10"]["damage"])
        self.assertEqual([41, 30], ref["standIn30"]["asked"])
        self.assertEqual(7.5, ref["standIn30"]["damage"])

    def test_the_referee_prices_a_drawn_body_by_its_capsule(self) -> None:
        head = self.results["referee"]["head30"]
        self.assertEqual([40, 30], head["asked"])
        self.assertEqual(40, head["material"])
        self.assertEqual(13.125, head["damage"])

    # --- the runner --------------------------------------------------------------

    def test_the_synthetic_level_uses_the_same_law(self) -> None:
        syn = self.results["synthetic"]
        self.assertEqual(10, syn["coltUnnamed"])
        self.assertEqual(17.5, syn["coltHead10"])
        self.assertEqual(7.5, syn["coltChest30"])
        self.assertEqual(5, syn["coltChest60"])
        self.assertEqual(5, syn["coltLimb10"])
        self.assertEqual(6.75, syn["thompsonChest60"])
        self.assertEqual(20, syn["k98Unnamed"])
        self.assertEqual(50, syn["k98Head150"])

    # --- the angle term ----------------------------------------------------------

    def test_only_an_authored_angle_mod_is_read(self) -> None:
        mods = self.results["angleModOf"]
        self.assertEqual(1, mods["aircraft"])
        self.assertIsNone(mods["tank"])
        self.assertIsNone(mods["placed"])
        self.assertIsNone(mods["unknown"])

    def test_a_hull_without_an_angle_mod_takes_the_sine(self) -> None:
        angle = self.results["angle"]
        self.assertEqual({"incidence": 1, "damage": 100}, angle["tankSquare"])
        # sin(0.5 pi/2) at 60 deg off square, not the bare cosine's 0.5.
        self.assertEqual({"incidence": 0.7071, "damage": 70.7107}, angle["tank60"])
        self.assertEqual({"incidence": 0, "damage": 0}, angle["tankGraze"])
        self.assertEqual(angle["tank60"], angle["placed60"])
        self.assertEqual(angle["tank60"], angle["browser60"])

    def test_an_aircraft_and_a_soldier_pay_full_at_any_angle(self) -> None:
        angle = self.results["angle"]
        self.assertEqual({"incidence": 1, "damage": 100}, angle["aircraft60"])
        self.assertEqual({"incidence": 1, "damage": 100}, angle["soldier60"])

    def test_the_angle_mod_blends_toward_full(self) -> None:
        self.assertEqual({"incidence": 0.8536, "damage": 85.3553}, self.results["angle"]["half60"])


if __name__ == "__main__":
    unittest.main()
