"""`viewer/kit-ammo.js`: the soldier's per-item ammunition, kept for the life
of the soldier rather than on the viewmodel rig.

The owner's report (2026-09-23): "if you have grenades, and throw them all,
if you change weapon then back to grenades they're full again. You need to
reload next to an ammo box." `map.html` minted the counts on every
`loadHandWeapon`, and a slot switch rebuilds the rig. The module touches no
DOM and no `three` import, so this copies it plus the harness into a temp
dir and runs `node harness.mjs`, the same pattern `test_supply.py` uses.
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
HARNESS = Path(__file__).resolve().parent / "kit_ammo_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "kit-ammo.js", work / "kit-ammo.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class KitAmmoTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_grenades_thrown_stay_thrown_across_a_slot_switch(self) -> None:
        g = self.results["grenades"]
        # `GrenadeAllies.glb`: magSize 3, numOfMag 1 -> three in the pouch,
        # nothing spare.
        self.assertEqual({"rounds": 3, "mags": 0}, g["atSpawn"])
        self.assertEqual({"rounds": 0, "mags": 0}, g["afterThrowing"])
        # The bug: 3 -> Thompson -> 4 used to read 3 again.
        self.assertEqual({"rounds": 0, "mags": 0}, g["afterSwitchBack"])
        self.assertTrue(g["sameEntryRecased"])

    def test_only_a_depot_refills_the_pouch(self) -> None:
        g = self.results["grenades"]
        self.assertTrue(g["gave"])
        self.assertEqual({"rounds": 3, "mags": 0}, g["afterRefill"])
        # Standing on the box with a full pouch is owed nothing, and hears
        # nothing (`supply.js` ticks every half second).
        self.assertFalse(g["gaveAgain"])

    def test_a_rifle_keeps_its_spent_magazines_too(self) -> None:
        r = self.results["rifle"]
        self.assertEqual({"rounds": 30, "mags": 4}, r["atSpawn"])
        self.assertEqual({"rounds": 18, "mags": 3}, r["beforeSwitch"])
        self.assertEqual({"rounds": 18, "mags": 3}, r["afterSwitchBack"])
        self.assertEqual({"rounds": 30, "mags": 4}, r["afterRefill"])

    def test_a_spawn_is_the_one_reset(self) -> None:
        s = self.results["respawn"]
        self.assertTrue(s["newEntry"])
        self.assertEqual(3, s["rounds"])
        self.assertEqual(0, s["mags"])
        self.assertIsNone(s["peekUnraised"])

    def test_unlimited_and_pouch_edges(self) -> None:
        e = self.results["edges"]
        # `magSize -1` is the engine's unlimited ammo: never short, never
        # refilled, and its `numOfMag 4` is three spares nobody can spend.
        self.assertTrue(e["knifeUnlimited"])
        self.assertEqual(3, e["knifeMags"])
        # ExpPack: magSize 4 x numOfMag 1, all four down.
        self.assertEqual(0, e["packLeft"])
        self.assertEqual(0, e["packMags"])
        self.assertTrue(e["packFullAfterRefill"])
        self.assertTrue(e["sizeOfNone"])
        self.assertEqual(0, e["sparesOfNone"])
        self.assertEqual(0, e["sparesOfOne"])
        self.assertEqual(4, e["sparesOfFive"])
        self.assertEqual(["KnifeAllies", "ExpPack"], [r["name"] for r in e["snapshot"]])


if __name__ == "__main__":
    unittest.main()
