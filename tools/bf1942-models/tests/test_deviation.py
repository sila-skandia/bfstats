"""`viewer/deviation.js` under node: the hand-weapon deviation approximation.

Same trick as `test_soldier.py`, and for the same reason: the module touches
no renderer and no DOM, so the cone the crosshair draws and `gunfire.js`
samples inside can be asserted here rather than only in a browser.

`deviation_harness.mjs` feeds the model **the shipped weapon blocks** — the
Thompson's `setMinDev 0.4 / setDevMod 1.2 1.05 0.9 / setSpeedDev 0.8 ... /
setFireDev 2.0 0.35 0.06 / setMiscDev 2.5 ...` as extracted into
`models/Thompson.glb`'s document extras — and prints one JSON blob.

What is asserted is the shape the data declares, not the engine's arithmetic:
the combining rule is PROVISIONAL (see the module header) and these tests are
written to survive it being replaced. Prone beats crouch beats stand, moving
costs, firing blooms and decays, aiming tightens — those orderings are in the
numbers themselves, whichever way the engine sums them, and any replacement
rule that broke one of them would be wrong about the game.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
MODULES = [ROOT / "viewer" / "deviation.js"]
HARNESS = Path(__file__).resolve().parent / "deviation_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for module in MODULES:
            shutil.copyfile(module, work / module.name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DeviationModelTests(unittest.TestCase):
    """One node run, many assertions — starting the runtime is the slow part."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # -- the stance ladder --------------------------------------------------- #

    def test_prone_beats_crouch_beats_stand(self) -> None:
        # `setDevMod 1.2 1.05 0.9`: the game saying in data why you get down.
        still = self.results["still"]
        self.assertLess(still["prone"], still["crouch"])
        self.assertLess(still["crouch"], still["stand"])

    def test_the_floor_is_min_times_the_stance_mod(self) -> None:
        # 0.4 x 1.2 / 1.05 / 0.9 — both factors shipped, only the product ours.
        still = self.results["still"]
        self.assertAlmostEqual(0.48, still["stand"], places=6)
        self.assertAlmostEqual(0.42, still["crouch"], places=6)
        self.assertAlmostEqual(0.36, still["prone"], places=6)

    # -- movement ------------------------------------------------------------ #

    def test_moving_widens_the_cone_and_a_run_widens_it_most(self) -> None:
        moving = self.results["moving"]
        self.assertLess(moving["still"], moving["walking"])
        self.assertLess(moving["walking"], moving["running"])
        # `setSpeedDev 0.8` lands in full at the 6 m/s run: 0.48 + 0.8.
        self.assertAlmostEqual(1.28, moving["running"], places=6)

    def test_the_speed_term_saturates_at_the_run(self) -> None:
        # A vehicle-assisted 60 m/s must not widen a rifle tenfold.
        moving = self.results["moving"]
        self.assertAlmostEqual(moving["running"], moving["overRun"], places=6)

    def test_turning_costs_when_the_weapon_declares_it(self) -> None:
        turning = self.results["turning"]
        self.assertLess(turning["still"], turning["half"])
        self.assertLess(turning["half"], turning["full"])
        self.assertAlmostEqual(turning["full"], turning["negative"], places=6)
        # Every vanilla hand weapon ships `setTurnDev 0 0 0 0`, so on real
        # data the term must contribute nothing at any slew rate.
        self.assertAlmostEqual(0.48, turning["vanillaZeros"], places=6)

    # -- firing --------------------------------------------------------------- #

    def test_a_shot_blooms_the_cone(self) -> None:
        fire = self.results["fire"]
        self.assertAlmostEqual(fire["rest"] + fire["addPerShot"],
                               fire["oneShot"], places=6)

    def test_a_burst_saturates_at_the_declared_cap(self) -> None:
        # `setFireDev 2.0 ...` read as the fire term's lid: eleven rounds with
        # no time passing sit at floor + 2.0, not floor + 3.85.
        fire = self.results["fire"]
        self.assertAlmostEqual(fire["rest"] + fire["fireCap"], fire["burst"],
                               places=6)

    def test_the_bloom_decays_back_to_the_floor(self) -> None:
        fire = self.results["fire"]
        self.assertTrue(fire["monotonic"])
        self.assertAlmostEqual(fire["rest"], fire["end"], places=6)
        # 2.0 degrees at 0.06/frame x 60 Hz is 0.55 s; anything inside the
        # window a 2002 shooter recovers over is sane, instant is not.
        self.assertGreaterEqual(fire["settledAt"], 0)
        self.assertGreater(fire["settledSeconds"], 0.2)
        self.assertLess(fire["settledSeconds"], 1.5)

    # -- aiming ---------------------------------------------------------------- #

    def test_aiming_tightens_the_cone(self) -> None:
        aim = self.results["aim"]
        self.assertLess(aim["aimed"], aim["hip"])
        self.assertAlmostEqual(aim["hip"] / 2, aim["aimed"], places=6)
        self.assertAlmostEqual(0.24, aim["aimedStill"], places=6)

    # -- airborne -------------------------------------------------------------- #

    def test_airborne_is_the_worst_case(self) -> None:
        air = self.results["airborne"]
        # `setMiscDev 2.5` on top of the floor: a jumping SMG is a noisemaker.
        self.assertAlmostEqual(air["grounded"] + air["misc"], air["jumping"],
                               places=6)
        # No misc block: the floor is multiplied instead.
        self.assertAlmostEqual(
            air["floorNoMisc"] * self.results["constants"]["airborneMult"],
            air["jumpingNoMisc"], places=6)

    # -- the degenerate shapes -------------------------------------------------- #

    def test_a_sniper_wanders_only_when_its_shooter_does(self) -> None:
        # K98Sniper declares no `setMinDev` and no `setFireDev` at all.
        sniper = self.results["sniper"]
        self.assertEqual(0.0, sniper["still"])
        self.assertAlmostEqual(0.8, sniper["running"], places=6)

    def test_the_at_familys_lid_clamps(self) -> None:
        # `maxDeviation 0.5`: whatever the additive terms reach, the cone
        # stops at the declared lid.
        capped = self.results["capped"]
        self.assertEqual(0.0, capped["still"])
        self.assertAlmostEqual(capped["lid"], capped["running"], places=6)

    def test_no_deviation_block_is_a_point(self) -> None:
        none = self.results["none"]
        self.assertEqual(0.0, none["still"])
        self.assertEqual(0.0, none["running"])

    # -- sanity ----------------------------------------------------------------- #

    def test_everything_stays_in_sane_degree_ranges(self) -> None:
        cap = self.results["constants"]["capDeg"]
        for section in ("still", "moving", "turning", "aim", "airborne",
                        "sniper", "capped", "none"):
            for key, value in self.results[section].items():
                if not isinstance(value, (int, float)):
                    continue
                self.assertGreaterEqual(value, 0.0, msg=f"{section}.{key}")
                self.assertLessEqual(value, cap, msg=f"{section}.{key}")


if __name__ == "__main__":
    unittest.main()
