"""A hull's rearm at a supply depot: the owner's B17 on El Alamein.

Dropping a B17's eight bombs on the airfield put all eight back within half a
second: the depot's rearm called `FireState.reset()` on every gun of the crew,
a full loaded magazine every 0.5 s cycle. The engine's
`SupplyDepot::reloadAmmo` hands each gun its ammo type's whole units through
`FireArms::reloadAmmo` (lnxded 0x0828cfd0, SUP-8), which never fills the
loaded magazine of a gun that carries more than one: it puts whole spare
magazines back, and the empty rack waits out its `reloadtime` 15.

`depot_rearm_harness.mjs` drives `world-fields.js` `supplyFieldTick`, the real
`supply.js` depot and the real `fire-state.js` guns under node.
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
HARNESS = Path(__file__).resolve().parent / "depot_rearm_harness.mjs"
MODULES = ("supply.js", "fire-state.js", "world-fields.js", "deviation.js")


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


class DepotRearmTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_rack_dropped_on_the_airfield_waits_its_reload(self) -> None:
        r = self.results["parkedDrop"]
        self.assertEqual(r["dropped"]["ammo"], 0)
        self.assertTrue(r["dropped"]["reloading"])
        # The owner's bug: 8 again within a cycle. Now still empty at 2 s.
        self.assertEqual(r["after2s"]["ammo"], 0)
        self.assertTrue(r["after2s"]["reloading"])
        self.assertEqual(r["after15s"]["ammo"], 8)
        self.assertEqual(r["after15s"]["magsLeft"], 8)
        # The depot gives back the spare rack the reload took.
        self.assertEqual(r["after18s"]["magsLeft"], 9)

    def test_the_reload_is_the_same_away_from_a_depot(self) -> None:
        r = self.results["awayDrop"]
        self.assertEqual(r["after2s"]["ammo"], 0)
        self.assertEqual(r["after16s"], {"ammo": 8, "magsLeft": 8, "reloading": False,
                                         "reloadRemaining": 0})

    def test_an_empty_bomber_lands_and_reloads_at_the_racks_pace(self) -> None:
        r = self.results["emptyLanding"]
        self.assertEqual((r["spent"]["ammo"], r["spent"]["magsLeft"]), (0, 0))
        # 4 bombs a second: one rack of 8 in 2 s, and it starts a 15 s reload.
        self.assertEqual(r["landed2s"]["ammo"], 0)
        self.assertEqual(r["landed2s"]["magsLeft"], 1)
        self.assertTrue(r["landed2s"]["reloading"])
        self.assertEqual(r["landed17s"]["ammo"], 8)
        self.assertEqual(r["landed47s"]["magsLeft"], 9)

    def test_a_one_magazine_gun_is_topped_up_in_place(self) -> None:
        r = self.results["mgTopUp"]
        self.assertEqual(r["before"]["ammo"], 300)
        self.assertGreater(r["oneCycle"]["ammo"], 300)
        self.assertLess(r["oneCycle"]["ammo"], 400)
        self.assertEqual(r["full"]["ammo"], 900)

    def test_an_untagged_gun_still_keeps_its_loaded_rack_empty(self) -> None:
        r = self.results["untagged"]
        self.assertEqual(r["after2s"]["ammo"], 0)
        self.assertTrue(r["after2s"]["reloading"])
        self.assertEqual(r["pick"], 9)
        self.assertEqual(r["tagged"], 9)
        self.assertIsNone(r["none"])

    def test_rearm_returns_what_it_did_not_take(self) -> None:
        r = self.results["rearm"]
        self.assertEqual((r["fullLeft"], r["fullMags"]), (4, 9))
        self.assertEqual((r["leftFromShort"], r["shortMags"], r["shortPool"]), (2, 9, 0))
        self.assertEqual((r["leftPooled"], r["pooledMags"], r["pooledPool"]), (0, 7, 5))
        self.assertEqual((r["mgLeft"], r["mgAmmo"]), (30, 900))
        self.assertEqual(r["unlimitedLeft"], 5)


if __name__ == "__main__":
    unittest.main()
