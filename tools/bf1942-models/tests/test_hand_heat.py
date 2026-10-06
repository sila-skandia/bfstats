"""A hand machine gun's heat: Desert Combat's M249 and PKM.

Both declare `heatAddWhenFire`, `coolDownPerSec 0.3` and `timeDelayOnOverHeat 2`
(0.0265 and 0.03 a pull), and the hand weapon had no heat at all. The law is
the vehicle guns' (`fire-state.js` `FireState`, ledger GUN-14 and GUN-15); the
hand weapon keeps one per kit item (`kit-ammo.js` `itemHeat`), steps it, gates
its trigger on it and bills each pull to it (`hand-fire.js`), and the HUD's
heat bar reads it (`soldier-hud.js` `writeSoldierAmmo`, GUN-16).

`hand_heat_harness.mjs` drives the three modules under node.
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
HARNESS = Path(__file__).resolve().parent / "hand_heat_harness.mjs"
MODULES = {"kit-ammo.mjs": VIEWER / "kit-ammo.js", "fire-state.js": VIEWER / "fire-state.js",
           "deviation.js": VIEWER / "deviation.js", "soldier-hud.js": VIEWER / "soldier-hud.js",
           "hud.js": VIEWER / "hud.js", "nation.js": VIEWER / "nation.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HandHeatTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_machine_guns_have_a_heat_and_nothing_else_does(self) -> None:
        items = self.results["items"]
        self.assertTrue(items["m249"])
        self.assertTrue(items["pkm"])
        # A grenade's `heatAddWhenFire 0.03` is its throw's charge
        # (`velocityDependentOnHeat 1`, GUN-14), not an overheat.
        self.assertIsNone(items["grenade"])
        self.assertIsNone(items["rifle"])
        self.assertIsNone(items["noEntry"])

    def test_a_pull_adds_its_heat_once(self) -> None:
        self.assertAlmostEqual(0.0265, self.results["items"]["afterOne"], places=6)

    def test_the_heat_is_the_items_and_outlives_a_swap(self) -> None:
        items = self.results["items"]
        self.assertTrue(items["sameAcrossRaise"])
        # A depot gives rounds, not a cold barrel.
        self.assertAlmostEqual(0.0265, items["afterRefill"], places=6)
        # A new life and a kit off the ground come up cold.
        self.assertTrue(items["respawnedCold"])
        self.assertEqual(0, items["pickedUpCold"])

    def test_the_hud_is_handed_the_raw_heat(self) -> None:
        hud = self.results["hud"]
        self.assertEqual(0.4, hud["hotHeat"])
        # `ATIconAndStrengthBar`: the leaf that draws `Overheat/OverHeat` as
        # the heat bar, beside the round count.
        self.assertEqual(3, hud["hotAmmoType"])
        self.assertEqual(150, hud["hotRounds"])
        # A weapon swap takes it away with the rest of the panel.
        self.assertIsNone(hud["swappedHeat"])


if __name__ == "__main__":
    unittest.main()
