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
        # A new life comes up cold; a kit off the ground brings the heat its
        # last owner left (KITDROP-9).
        self.assertTrue(items["respawnedCold"])
        self.assertAlmostEqual(0.0265, items["pickedUp"], places=6)

    def test_a_kit_off_the_ground_brings_its_heat_and_lockout(self) -> None:
        # `dropKit` disables the gun, which keeps the heat and a running
        # lockout, and a disabled item is not updated while the kit lies
        # there; `pickupKit` enables it as it was (KITDROP-9, GUN-16).
        pickup = self.results["pickup"]
        self.assertAlmostEqual(1.0165, pickup["rowHeat"]["heat"], places=5)
        self.assertEqual(1.25, pickup["rowHeat"]["overheat"])
        self.assertNotIn("heat", pickup["rifleRow"])
        self.assertEqual(pickup["rowHeat"], pickup["carriedAgain"])
        # The 1.25 s lockout left, then 1.0165 at 0.01 a tick: about 4.6 s.
        self.assertAlmostEqual(1.25 + 102 / 30, pickup["secondsToCold"], delta=0.1)
        self.assertEqual(0, pickup["freshLife"])

    def test_a_held_m249_locks_after_its_sixty_first_round(self) -> None:
        # 13.5 declared, 10 a second on whole ticks (GUN-13); +0.0265 a round
        # and one tick's 0.01 drained between rounds (GUN-15). In float32 the
        # 60th round leaves the heat a few ulps under 1, the 61st crosses it,
        # and the pull after it is the first one refused (GUN-18), 6.1 s into
        # the burst: the binary's own count. Under the old continuous drain it
        # never overheated; locking at the crossing round, in doubles, it
        # locked after 60.
        engine = self.results["hold"]["m249Engine"]
        self.assertEqual(61, engine["firstRefused"])
        for case in ("m249", "m249At30"):
            hold = self.results["hold"][case]
            self.assertEqual(61, hold["firstRefused"]["rounds"], case)
            self.assertAlmostEqual(6.1, hold["firstRefused"]["t"], delta=0.05)

    def test_a_held_pkm_locks_after_its_fifty_first(self) -> None:
        # The 50th round crosses, at 1.0099996, and its drain tick takes it
        # back under 1, so a 51st is fired before the first refusal.
        self.assertEqual(51, self.results["hold"]["pkmEngine"]["firstRefused"])
        self.assertEqual(51, self.results["hold"]["pkm"]["firstRefused"]["rounds"])

    def test_after_the_lockout_a_held_trigger_fires_at_the_engines_rate(self) -> None:
        # Nothing drains through the 2 s lockout (GUN-15), and a held pull the
        # heat still refuses when it runs out starts it again (GUN-18), so a
        # held trigger gets one tick of cooling a lockout: 0.2 to 0.3 rounds a
        # second, against FireState's 0.4 to 0.5 when it locked only once.
        # The page's order (heat per frame, rounds on world ticks) fires the
        # binary's own total over 30 s.
        for case in ("m249", "pkm"):
            hold = self.results["hold"][case]
            engine = self.results["hold"][f"{case}Engine"]
            self.assertEqual(engine["rounds"], hold["rounds"], case)
            self.assertAlmostEqual(engine["lateRate"], hold["lateRate"], delta=0.11, msg=case)
            self.assertLessEqual(hold["lateRate"], 0.3, case)
            self.assertGreaterEqual(hold["peak"], 1.0)

    def test_a_trigger_let_go_on_the_crossing_round_starts_no_lockout(self) -> None:
        # The round that crosses 1 starts nothing (GUN-18): only a pull does.
        # Let go there, the M249 drains from its next tick and is cold again.
        released = self.results["hold"]["m249Released"]
        self.assertIsNone(released["firstRefused"])
        self.assertGreaterEqual(released["peak"], 1.0)
        self.assertEqual(0, released["heatAtEnd"])

    def test_a_barrel_left_alone_drains_at_its_rate(self) -> None:
        # Twenty rounds is 0.53; at 0.3 a second it is cold in 1.77 s, plus
        # the round's own 0.07 s timer before the drain starts.
        cool = self.results["cool"]
        self.assertAlmostEqual(0.53, cool["after20"], places=6)
        self.assertAlmostEqual(1.85, cool["secondsToCold"], delta=0.05)

    def test_vanillas_seat_guns_run_the_same_law(self) -> None:
        # The same `FireState`, stepped once a world tick: the stationary MG42
        # (15 a second, 0.04 / 0.4) and the pintle Browning (10 a second) lock
        # after 38 rounds, the coaxial Browning (12 declared, 0.05 / 0.3) after
        # 25. Before GUN-15 they took 73, never and 49.
        seats = self.results["seats"]
        self.assertEqual(38, seats["mg42"]["firstRefused"])
        self.assertEqual(38, seats["browning"]["firstRefused"])
        self.assertEqual(25, seats["coax"]["firstRefused"])
        # And after it, held for 30 s, every round on the binary's own tick:
        # the lockout restarted by each refused pull (GUN-18).
        for gun in ("mg42", "browning", "coax"):
            self.assertTrue(seats[gun]["sameTicks"], gun)
            self.assertEqual(seats[f"{gun}Engine"]["rounds"], seats[gun]["rounds"], gun)

    def test_a_caller_that_never_reports_its_trigger_locks_at_the_crossing(self) -> None:
        # `replay-hud.js` `gunStateAt` has only the recorded rounds, so for it
        # the crossing round stands in for a trigger still held.
        self.assertTrue(self.results["seats"]["unreported"]["locked"])

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
