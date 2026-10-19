"""A soldier's rearm at an ammo box, under the hull's law (SUP-8).

`hand-weapon.js` `supplyTarget.refillAmmo` used to put the whole kit back to
its spawn loadout every 0.5 s depot cycle: the loaded magazine full at once
and a magazine change in progress cancelled. The engine's
`SupplyDepot::reloadAmmo` (lnxded 0x08323770) walks a soldier's items through
the same `FireArms::reloadAmmo` (0x0828cfd0) a hull's guns go through: a
`numOfMag 1` item is topped up in place at its row's rate, any other only gets
whole spare magazines behind the loaded one.

`foot_rearm_harness.mjs` drives `world-fields.js` `supplyFieldTick`, the real
`supply.js` ammo box and the real `kit-ammo.js` kit under node.
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
HARNESS = Path(__file__).resolve().parent / "foot_rearm_harness.mjs"
MODULES = ("supply.js", "fire-state.js", "world-fields.js", "deviation.js", "kit-ammo.js")


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


class FootRearmTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_dry_thompson_gets_spares_never_its_loaded_magazine(self) -> None:
        r = self.results["dryThompson"]
        # One 0.5 s cycle of the 15-a-second row: units piled, no magazine yet.
        self.assertEqual(r["oneCycle"], {"rounds": 0, "mags": 0, "pool": 8})
        self.assertEqual(r["after2s"], {"rounds": 0, "mags": 1})
        # Every spare back, the loaded magazine still dry: R reloads it.
        self.assertEqual(r["after12s"], {"rounds": 0, "mags": 4})
        # The give sounds once per magazine landed, not every cycle.
        self.assertEqual(r["gives"], 4)

    def test_a_half_spent_magazine_is_owed_nothing(self) -> None:
        r = self.results["halfSpent"]
        self.assertEqual(r["smg"], {"rounds": 12, "mags": 4})
        self.assertEqual(r["gives"], 0)

    def test_a_dry_launcher_gets_rockets_at_its_rows_pace(self) -> None:
        r = self.results["dryTube"]
        self.assertEqual(r["first"], {"rounds": 0, "mags": 1})
        self.assertEqual(r["after11s"], {"rounds": 0, "mags": 5})

    def test_a_one_magazine_pouch_is_topped_up_in_place(self) -> None:
        r = self.results["pouch"]
        self.assertEqual(r["first"], {"rounds": 1, "mags": 0})
        self.assertEqual(r["after3s"], {"rounds": 3, "mags": 0})
        self.assertEqual(r["knife"]["mags"], 0)

    def test_untagged_items_still_keep_the_loaded_magazine(self) -> None:
        r = self.results["untagged"]
        # Fed from the first row that gave units (the guns' 15 a second).
        self.assertEqual(r["pouch"], {"rounds": 3, "mags": 0})
        self.assertEqual(r["smg"], {"rounds": 0, "mags": 0})

    def test_out_of_reach_nothing_comes_back(self) -> None:
        r = self.results["away"]
        self.assertEqual(r["smg"], {"rounds": 0, "mags": 0})
        self.assertEqual(r["gives"], 0)


if __name__ == "__main__":
    unittest.main()
