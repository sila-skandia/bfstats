"""The hand weapon's pull, charged as `salvo()` says, and its reload's wait.

`gunfire.js` hands every `onShot` what the pull cost (`salvo()`, ledger
BOMB-1..BOMB-5): one round a barrel for a multi-barrel weapon with no
`setAsynchronyFire`, one for a `blastAmmoCount` salvo (BOMB-13), none for an
unlimited one. The hand weapon charged one a pull whatever it was told, and
answered `roundsLeft` as unlimited, so `salvo()` could not stop a two-barrel
gun at its last round. The multi-barrel hand weapons are in FH (36), FHSW (73),
bf1918 (20) and FinnWars (2); vanilla's and Desert Combat's all have one
barrel, but for the shotguns, which declare `blastAmmoCount`.

A dry magazine waits for the last round's fire cycle before it is changed
(BODY-7), as the reload message does (`handleMessage` 0x082899c8).

`hand_fire_harness.mjs` builds `createHandFire` over a stub page.
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
HARNESS = Path(__file__).resolve().parent / "hand_fire_harness.mjs"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        # `hand-fire.js` reaches most of the page's leaf modules through its
        # imports; copy them all rather than pin the graph here.
        for source in VIEWER.glob("*.js"):
            shutil.copyfile(source, work / source.name)
        three = work / "node_modules" / "three"
        three.mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js", three / "three.module.js")
        (three / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HandChargeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_one_barrel_gun_pays_a_round_a_pull(self) -> None:
        self.assertEqual({"barrels": 1, "roundsAfterOne": 29, "roundsLeft": 29},
                         self.results["rifle"])

    def test_a_multi_barrel_gun_pays_a_round_a_barrel(self) -> None:
        # BOMB-1: both barrels fire and both are charged; before, one was.
        twin = self.results["twin"]
        self.assertEqual(2, twin["barrels"])
        self.assertEqual(6, twin["roundsAfterOne"])

    def test_asynchrony_fires_and_pays_one(self) -> None:
        self.assertEqual({"barrels": 1, "roundsAfterOne": 7, "roundsLeft": 7},
                         self.results["pods"])

    def test_a_blast_ammo_count_salvo_is_one_shell(self) -> None:
        # BOMB-13: the Remington's eight pellets cost one of its eight shells,
        # charged so here even by a `salvo()` not yet told of the flag.
        shotgun = self.results["shotgun"]
        self.assertEqual(8, shotgun["barrels"])
        self.assertEqual(7, shotgun["roundsAfterOne"])

    def test_an_export_without_the_word_keeps_one_round_a_pull(self) -> None:
        # A viewmodel extracted before BOMB-13 carries no `blastAmmoCount`
        # key; its eight pellets still fly, but the pull costs one shell.
        legacy = self.results["legacy"]
        self.assertEqual(8, legacy["barrels"])
        self.assertEqual(7, legacy["roundsAfterOne"])

    def test_the_last_round_fires_one_barrel(self) -> None:
        # BOMB-5's partial salvo, now that the hand answers `roundsLeft`.
        self.assertEqual({"barrels": 1, "roundsAfter": 0}, self.results["twinLast"])

    def test_an_unlimited_weapon_is_charged_nothing(self) -> None:
        unlimited = self.results["unlimited"]
        self.assertEqual(2, unlimited["barrels"])
        self.assertIsNone(unlimited["roundsAfterOne"])   # Infinity, as JSON writes it
        self.assertIsNone(unlimited["roundsLeft"])

    def test_a_gun_out_of_the_hand_still_answers_from_its_fire_state(self) -> None:
        self.assertEqual(42, self.results["seat"]["withState"])
        self.assertIsNone(self.results["seat"]["without"])


class ReloadWaitTests(unittest.TestCase):
    def test_a_dry_magazine_waits_for_the_fire_cycle(self) -> None:
        reload = run_harness()["reload"]
        self.assertEqual(0.5, reload["coolAfterShot"])
        self.assertFalse(reload["duringCycle"])
        self.assertTrue(reload["afterCycle"])
        self.assertEqual(3, reload["reloadTime"])


if __name__ == "__main__":
    unittest.main()
