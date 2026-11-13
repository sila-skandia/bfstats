"""`viewer/remaster-lights.js` under node, through `remaster_lights_harness.mjs`.

In remaster mode (features/remaster-browser) a gun's flash, a blast and a
fire light what is around them. Which effect bundle does, and how strongly,
is a table read by name, so the names are what this pins: a tank's main gun
is not a rifle, dust is not fire, and a Spitfire's scrap is not a fire.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "remaster_lights_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RemasterLightsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_flash_is_sized_by_its_gun(self) -> None:
        flash = self.results["flash"]
        rifle, flak, tank = flash["e_MuzzM1"], flash["e_MuzzAAGun"], flash["e_MuzzPanz"]
        self.assertLess(rifle["intensity"], flak["intensity"])
        self.assertLess(flak["intensity"], tank["intensity"])
        self.assertLess(rifle["range"], tank["range"])
        self.assertLess(rifle["life"], tank["life"])
        # A hand gun or a machine gun on a mount keeps the rifle's lift.
        self.assertEqual(rifle, flash["e_MuzzSG44"])
        for name in ("e_MuzzSexton", "e_MuzzDefgun"):
            self.assertEqual(tank, flash[name], name)

    def test_only_a_big_gun_draws_a_burst_at_its_muzzle(self) -> None:
        flash = self.results["flash"]
        self.assertEqual(0, flash["e_MuzzM1"]["burst"])
        self.assertGreater(flash["e_MuzzAAGun"]["burst"], 0)
        self.assertGreater(flash["e_MuzzPanz"]["burst"], flash["e_MuzzAAGun"]["burst"])
        for name in ("e_ExplGas", "e_Bomb"):
            self.assertEqual(0, flash[name]["burst"], name)

    def test_a_blast_outshines_any_gun(self) -> None:
        flash = self.results["flash"]
        for name in ("e_ExplGas", "e_ExplArmor", "e_GranadeExpl", "e_Bomb"):
            self.assertGreater(flash[name]["intensity"], flash["e_MuzzPanz"]["intensity"], name)
            self.assertGreater(flash[name]["life"], flash["e_MuzzPanz"]["life"], name)

    def test_dust_casings_trails_and_smoke_light_nothing(self) -> None:
        flash = self.results["flash"]
        for name in ("e_ExplDrySand", "e_ExplWindow", "e_RichoMetal", "e_Shell792mm", "e_PanzShootTrail",
                     "e_waterimpact", "e_WillyDamage", "e_scrapmetal", "e_scrapmetal_Spitfire",
                     "e_WillyFire", "e_fire4"):
            self.assertIsNone(flash[name], name)
        self.assertEqual([None, None, False, False], self.results["none"])

    def test_a_fire_is_a_burning_bundle_and_nothing_else(self) -> None:
        fire = self.results["fire"]
        burning = {"e_WillyFire", "e_PanzFire", "e_CorsairFire", "e_fire4"}
        for name, is_fire in fire.items():
            self.assertEqual(name in burning, is_fire, name)

    def test_a_flame_flickers_and_never_goes_out(self) -> None:
        flicker = self.results["flicker"]
        self.assertGreater(flicker["low"], 0.4)
        self.assertLessEqual(flicker["high"], 1.0)
        self.assertGreater(flicker["high"] - flicker["low"], 0.3)
        light = self.results["fireLight"]
        # A fire is a steadier, weaker light than a tank gun's flash.
        self.assertLess(light["intensity"], self.results["flash"]["e_MuzzPanz"]["intensity"])
        self.assertGreater(light["reach"], light["range"])


if __name__ == "__main__":
    unittest.main()
