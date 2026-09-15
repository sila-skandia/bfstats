"""`viewer/deviation.js` under node: the hand-weapon deviation rule.

Same trick as `test_soldier.py`, and for the same reason: the module touches
no renderer and no DOM, so the cone the crosshair draws and `gunfire.js`
samples inside can be asserted here rather than only in a browser.

`deviation_harness.mjs` feeds the model **the shipped weapon blocks** — the
Thompson's `setMinDev 0.4 / setDevMod 1.2 1.05 0.9 / setSpeedDev 0.8 ... /
setFireDev 2.0 0.35 0.06 / setMiscDev 2.5 ...` as extracted into
`models/Thompson.glb`'s document extras — and prints one JSON blob.

What is asserted is the engine's decompiled arithmetic —
`HandFireArms::updateDeviation`, client 0x00551f50 / lnxded 0x08293e80, per
`features/bf1942-engine-reference/subsystems/handweapon-view-and-deviation.md`:
minDev is the floor and devMod does NOT scale it; each dynamic channel raises
by M² against a cap of a·M and decays d/M per tick; the speed gates are
binary on the 0.01 deadzone; the turn terms are analog; miscDev is the jump
channel; firing adds fireDev.b per shot clamped to fireDev.a and decays
fireDev.c/M per tick; and aiming changes nothing at all. Only the tick
cadence (TICK_HZ) and the AT family's floor-and-lid remain OPEN, and no
assertion below depends on either beyond the per-tick amounts being applied
at the declared 60 Hz.
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

# The Thompson's shipped numbers, restated for the expected-value arithmetic.
MIN_DEV = 0.4
MOD = {"stand": 1.2, "crouch": 1.05, "prone": 0.9}
SPEED = (0.8, 0.2, 0.2, 0.1)     # cap, throttle term, strafe term, decay/tick
MISC = (2.5, 2.5, 0.1)           # cap, jump term, decay/tick
FIRE = (2.0, 0.35, 0.06)         # cap, add/shot, decay/tick
TURNER = (1.0, 0.5, 0.5, 0.01)   # the harness's synthetic turn block


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

    # -- the floor ----------------------------------------------------------- #

    def test_the_floor_is_min_dev_unscaled_in_every_stance(self) -> None:
        # devMod does NOT multiply minDev — the old `min x mod` reading is
        # refuted by the decompile. A still soldier's cone is 0.4, period.
        still = self.results["still"]
        self.assertAlmostEqual(MIN_DEV, still["stand"], places=9)
        self.assertAlmostEqual(MIN_DEV, still["crouch"], places=9)
        self.assertAlmostEqual(MIN_DEV, still["prone"], places=9)

    # -- movement ------------------------------------------------------------ #

    def test_moving_saturates_the_speed_channel_at_cap_times_mod(self) -> None:
        moving = self.results["moving"]
        for stance, mod in MOD.items():
            self.assertAlmostEqual(MIN_DEV + SPEED[0] * mod, moving[stance],
                                   places=9, msg=stance)

    def test_prone_beats_crouch_beats_stand_via_the_mod(self) -> None:
        # The stance ladder lives in the dynamic channels (caps scale by M),
        # which is why you still get down — just not for the floor's sake.
        moving = self.results["moving"]
        self.assertLess(moving["prone"], moving["crouch"])
        self.assertLess(moving["crouch"], moving["stand"])

    def test_the_speed_gate_is_binary_on_the_deadzone(self) -> None:
        # Constant increments: a 0.3 throttle costs exactly what a full one
        # does, and below the 0.01 deadzone nothing at all. The engine never
        # reads the achieved velocity.
        moving = self.results["moving"]
        self.assertAlmostEqual(moving["stand"], moving["softThrottle"], places=9)
        self.assertAlmostEqual(MIN_DEV, moving["deadzone"], places=9)

    def test_throttle_and_strafe_share_one_channel_and_cap(self) -> None:
        moving = self.results["moving"]
        self.assertAlmostEqual(moving["stand"], moving["strafe"], places=9)
        self.assertAlmostEqual(moving["stand"], moving["both"], places=9)

    def test_the_raise_carries_mod_squared(self) -> None:
        # One tick from rest: state = M·(M·b) − d/M, the double multiply read
        # in both binaries, against the linear cap and the inverse decay.
        moving = self.results["moving"]
        for stance, key in (("stand", "standOneTick"), ("prone", "proneOneTick")):
            m = MOD[stance]
            expect = MIN_DEV + min(m * (m * SPEED[1]) - SPEED[3] / m,
                                   SPEED[0] * m)
            self.assertAlmostEqual(expect, moving[key], places=9, msg=stance)

    # -- turning ------------------------------------------------------------- #

    def test_turning_is_analog_and_unsigned(self) -> None:
        turning = self.results["turning"]
        self.assertAlmostEqual(MIN_DEV, turning["still"], places=9)
        # One tick at 6 rad/s vs 3 rad/s: the term scales with the input.
        self.assertLess(turning["oneTickHalf"], turning["oneTickFull"])
        expect_full = MIN_DEV + TURNER[1] * (6 / 60) - TURNER[3]
        self.assertAlmostEqual(expect_full, turning["oneTickFull"], places=9)
        self.assertAlmostEqual(turning["oneTickFull"], turning["oneTickNegative"],
                               places=9)

    def test_turning_saturates_at_its_own_cap(self) -> None:
        turning = self.results["turning"]
        self.assertAlmostEqual(MIN_DEV + TURNER[0], turning["steady"], places=9)
        # MouseLookX drives the c term of the same channel.
        self.assertAlmostEqual(turning["steady"], turning["steadyX"], places=9)

    def test_vanilla_turn_zeros_contribute_nothing(self) -> None:
        # Every vanilla hand weapon ships `setTurnDev 0 0 0 0`.
        self.assertAlmostEqual(MIN_DEV, self.results["turning"]["vanillaZeros"],
                               places=9)

    # -- firing --------------------------------------------------------------- #

    def test_a_shot_blooms_the_cone(self) -> None:
        fire = self.results["fire"]
        self.assertAlmostEqual(fire["rest"] + fire["addPerShot"],
                               fire["oneShot"], places=9)

    def test_a_burst_saturates_at_the_declared_cap(self) -> None:
        # `setFireDev 2.0 ...`: eleven rounds with no time passing sit at
        # floor + 2.0, not floor + 3.85. The cap is NOT scaled by devMod.
        fire = self.results["fire"]
        self.assertAlmostEqual(fire["rest"] + fire["fireCap"], fire["burst"],
                               places=9)

    def test_the_bloom_decays_linearly_back_to_the_floor(self) -> None:
        # fireDev.c / M per tick: standing M = 1.2 empties 2.0 in exactly 40
        # ticks (0-indexed 39) — two thirds of a second at the 60 Hz clock.
        fire = self.results["fire"]
        self.assertTrue(fire["monotonic"])
        self.assertAlmostEqual(fire["rest"], fire["end"], places=9)
        self.assertEqual(39, fire["settledAt"])

    def test_prone_recovers_the_bloom_faster(self) -> None:
        # Decay is ÷M — the counter-intuitive half of the stance multiplier,
        # read twice in the binaries: getting down speeds the recovery.
        fire = self.results["fire"]
        self.assertLess(fire["proneSettledAt"], fire["settledAt"])

    # -- aiming ---------------------------------------------------------------- #

    def test_aiming_changes_nothing(self) -> None:
        # Zoom appears nowhere in the deviation formula, in either binary.
        # The former x0.5 was an invention, and it is gone.
        aim = self.results["aim"]
        self.assertAlmostEqual(aim["hip"], aim["aimed"], places=9)

    # -- jumping --------------------------------------------------------------- #

    def test_jumping_fills_the_misc_channel_to_its_cap(self) -> None:
        air = self.results["airborne"]
        self.assertAlmostEqual(MIN_DEV, air["grounded"], places=9)
        # cap = misc.a x M: a jumping standing SMG is a noisemaker.
        self.assertAlmostEqual(MIN_DEV + MISC[0] * MOD["stand"], air["jumping"],
                               places=9)
        # No mod block: M = 1 and no floor under it.
        self.assertAlmostEqual(MISC[0], air["sniperJumping"], places=9)

    def test_landing_decays_the_jump_penalty_away(self) -> None:
        air = self.results["airborne"]
        self.assertGreaterEqual(air["recovered"], 0)
        self.assertAlmostEqual(MIN_DEV, air["end"], places=9)

    # -- the degenerate shapes -------------------------------------------------- #

    def test_a_sniper_wanders_only_when_its_shooter_does(self) -> None:
        # K98Sniper declares no `setMinDev` and no `setFireDev` at all, and
        # no `setDevMod` means M = 1 exactly.
        sniper = self.results["sniper"]
        self.assertEqual(0.0, sniper["still"])
        self.assertAlmostEqual(SPEED[0], sniper["moving"], places=9)

    def test_the_at_familys_lid_clamps(self) -> None:
        # `maxDeviation 0.5` (combine rule OPEN): whatever the additive terms
        # reach, the cone stops at the declared lid.
        capped = self.results["capped"]
        self.assertEqual(0.0, capped["still"])
        self.assertAlmostEqual(capped["lid"], capped["moving"], places=9)

    def test_no_deviation_block_is_a_point(self) -> None:
        none = self.results["none"]
        self.assertEqual(0.0, none["still"])
        self.assertEqual(0.0, none["moving"])

    # -- sanity ----------------------------------------------------------------- #

    def test_the_constants_are_the_engines(self) -> None:
        constants = self.results["constants"]
        self.assertEqual(0.01, constants["deadzone"])    # both binaries
        self.assertEqual(60, constants["tickHz"])        # OPEN stand-in
        self.assertEqual({"stand": 0, "crouch": 1, "prone": 2},
                         constants["stanceIndex"])

    def test_everything_stays_finite_and_non_negative(self) -> None:
        for section in ("still", "moving", "turning", "aim", "airborne",
                        "sniper", "capped", "none"):
            for key, value in self.results[section].items():
                if key == "recovered" or not isinstance(value, (int, float)):
                    continue   # a tick counter, not a cone
                self.assertGreaterEqual(value, 0.0, msg=f"{section}.{key}")
                # The channels are individually capped and the floor is a
                # constant, so nothing can run away: the Thompson's worst
                # case is min + fire.a + M·(speed.a + misc.a) < 8 degrees.
                self.assertLess(value, 10.0, msg=f"{section}.{key}")


if __name__ == "__main__":
    unittest.main()
