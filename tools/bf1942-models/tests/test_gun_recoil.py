"""`fireingForce`: the shove a round gives the hull its gun is bolted to.

The word is `ObjectTemplate.fireingForce` (sic), and ledger FA-1 found it in
`FireArms::Fire` (lnxded `0x0828a090`) where an earlier reading had taken
`FireArmsTemplate+0x2ec` for a spread. Re-read in full on 2026-10-18, the block
at `0x0828a43f` is:

    ebx  = getRootParent(this)[0x60]              ; the HULL's physics node
    call [ebx]+0xd4                               ; PhysicsNode::setIsAwake
    eax  = this->getAbsoluteTransformation()      ; FireArms vtable +0x40
    a    = -(eax[0x20..0x28]) * tmpl[0x2ec]       ; -(matrix row 2) * force
    p    = this->getAbsolutePosition()            ; FireArms vtable +0x38
    call [ebx]+0x68                               ; addAccelerationAtAbsolutePosition(p, a)

Three things in that make the behaviour:

  * it is an ACCELERATION, mass-independent, spent over one 30 Hz tick because
    `updatePhysics` re-seeds the accumulator every tick, so one shot is
    `fireingForce / 30` m/s of hull velocity;
  * it goes in AT THE GUN, so `addAccelerationAtAbsolutePosition`'s
    `(p - com) x a` arm turns a side-on shot into roll and yaw as well as a
    slide — which is why firing a Sherman's cannon across the hull shoves the
    tank over rather than just backwards;
  * it is posted ONCE PER TRIGGER PULL, outside the barrel dispatch, so a
    multi-barrel salvo pushes once.

Vanilla writes it on eleven tanks and guns plus the Yamato's two turrets
(Sherman 110 down to Yamato 10); the Fletcher's and Hatsuzuki's declarations are
commented out with `rem`, so the two destroyers push nothing.

Driven under node through the real `viewer/gun-recoil.js`, `viewer/gunfire.js`,
`viewer/rigid-body.js` and `viewer/hull-bodies.js` by
`tests/gun_recoil_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "gun_recoil_harness.mjs"

#: The engine's fixed server tick.
TICK = 1 / 30
#: `Objects.rfa` of the shipped game, read 2026-10-18.
SHERMAN_FORCE = 110

_RESULT: dict | None = None


def result() -> dict:
    global _RESULT
    if _RESULT is None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)],
                              capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        _RESULT = json.loads(proc.stdout.strip().splitlines()[-1])
    return _RESULT


class PushVectorTests(unittest.TestCase):
    """R-1: `-(matrix row 2) * force` at `getAbsolutePosition()`."""

    def test_the_push_is_backwards_out_of_the_barrel(self) -> None:
        straight = result()["r1"]["straight"]
        # The exporter mirrors Refractor's +Z forward onto glTF's -Z, so the
        # engine's `-forward` is +Z here: out of the breech, not the muzzle.
        self.assertEqual(SHERMAN_FORCE, straight["az"])
        self.assertEqual(0, straight["ax"])
        self.assertEqual(0, straight["ay"])

    def test_a_gun_across_the_hull_pushes_across_it(self) -> None:
        sideways = result()["r1"]["sideways"]
        # Yawed 90 degrees: the barrel points down -X, so the hull takes +X.
        self.assertEqual(SHERMAN_FORCE, sideways["ax"])
        self.assertEqual(0, sideways["az"])

    def test_the_push_goes_in_at_the_guns_own_position(self) -> None:
        # `getAbsolutePosition()` of the FireArms, not the muzzle and not the
        # hull's origin: this is the arm that makes the tank lean.
        sideways = result()["r1"]["sideways"]
        self.assertEqual([2, 1.5, -0.5],
                         [sideways["px"], sideways["py"], sideways["pz"]])

    def test_a_scaled_gun_node_does_not_scale_the_force(self) -> None:
        self.assertAlmostEqual(SHERMAN_FORCE, result()["r1"]["scaledLength"], places=3)

    def test_the_gates(self) -> None:
        r1 = result()["r1"]
        # The engine tests `> 0` (`0x0828a293`), so nothing, zero and a
        # negative all push nothing, and so does a gun with no transform.
        for key in ("none", "zero", "negative", "noMatrix"):
            with self.subTest(key):
                self.assertIsNone(r1[key])

    def test_no_allocation_per_shot(self) -> None:
        self.assertTrue(result()["r1"]["reusesOut"])


class OncePerPullTests(unittest.TestCase):
    """R-2 / R-3: where `FireArms::Fire` posts it, and when it does not."""

    def test_one_barrel_one_push(self) -> None:
        r2 = result()["r2"]
        self.assertEqual(1, r2["singleBarrels"])
        self.assertEqual(1, r2["singlePushes"])

    def test_a_four_barrel_salvo_pushes_once(self) -> None:
        r2 = result()["r2"]
        # The block sits outside the barrel dispatch (`0x0828a43f`, reached
        # from `code_r0x0828a230`): four rounds leave, the hull is shoved once.
        self.assertEqual(4, r2["salvoBarrels"])
        self.assertEqual(4, r2["salvoShots"])
        self.assertEqual(1, r2["salvoPushes"])

    def test_each_pull_pushes(self) -> None:
        self.assertEqual(3, result()["r2"]["heldPushes"])

    def test_a_gun_that_declares_none_pushes_nothing(self) -> None:
        r2 = result()["r2"]
        # The Sherman's coaxial Browning: it fires, and the hull stands still.
        self.assertEqual(1, r2["coaxFired"])
        self.assertEqual(0, r2["coaxPushes"])

    def test_the_flash_only_path_carries_no_recoil(self) -> None:
        # `GunFire.flash` is a round something else already resolved (a bot's
        # rifle through the referee). No round, no recoil — as it has no
        # `Fire` behind it.
        self.assertEqual(0, result()["r2"]["flashPushes"])


class HullResponseTests(unittest.TestCase):
    """R-4 / R-5: what one tick of the acceleration does to a Sherman."""

    def test_one_shot_is_force_over_thirty(self) -> None:
        r4 = result()["r4"]
        # The accumulator is re-seeded every tick, so the push is spent once:
        # 110 / 30 = 3.667 m/s.
        self.assertAlmostEqual(SHERMAN_FORCE * TICK, r4["forwardVz"], places=3)
        self.assertAlmostEqual(r4["expectedVz"], r4["forwardVz"], places=4)
        self.assertEqual(0, r4["forwardVx"])

    def test_a_gun_above_the_centre_of_mass_pitches_the_hull(self) -> None:
        # 1.6 m of arm over the centre of mass: firing forward lifts the nose.
        self.assertGreater(result()["r4"]["forwardSpin"], 0.3)

    def test_a_gun_across_the_hull_slides_and_rolls_it(self) -> None:
        r5 = result()["r5"]
        # This is the behaviour the viewer was missing: the hull goes sideways
        self.assertAlmostEqual(SHERMAN_FORCE * TICK, r5["vx"], places=3)
        self.assertAlmostEqual(0, r5["vz"], places=6)
        # ... and leans, because the push is applied at the gun. Roll is the
        # larger of the two body rates, and it is big enough to see: about
        # -0.97 rad/s, 56 deg/s, before the suspension takes it back.
        self.assertLess(r5["rollRate"], -0.5)
        self.assertGreater(abs(r5["rollRate"]), abs(r5["yawRate"]))

    def test_the_roll_is_not_a_rounding_wobble(self) -> None:
        self.assertGreater(result()["r5"]["spin"], 0.9)


class SleepTests(unittest.TestCase):
    """R-6: `setIsAwake()` before the post, as the engine calls it."""

    def test_a_parked_hull_is_asleep_until_the_shot(self) -> None:
        r6 = result()["r6"]
        self.assertTrue(r6["asleepFirst"])
        self.assertAlmostEqual(SHERMAN_FORCE * TICK, r6["parkedVz"], places=3)

    def test_a_large_push_wakes_a_hull_by_itself(self) -> None:
        # `step`'s own `WAKE_ACCEL_SQ` is 2.5, so any vanilla force (10 and up)
        # clears it. The explicit wake is not what carries these.
        self.assertAlmostEqual(SHERMAN_FORCE * TICK, result()["r6"]["unwokenVz"], places=3)

    def test_a_small_push_needs_the_explicit_wake(self) -> None:
        r6 = result()["r6"]
        # Under 1.58 m/s^2 the automatic test does not fire, and this is where
        # the engine's `setIsAwake()` call is the whole story. No vanilla gun
        # is this weak; a mod's could be, and the asleep branch would
        # otherwise throw the push away.
        self.assertEqual(0, r6["tinyUnwokenVz"])
        self.assertAlmostEqual(1 * TICK, r6["tinyWokenVz"], places=3)


class PageLookupTests(unittest.TestCase):
    """R-7: `hull-bodies.js` `recoilOnHull` — which body takes the shove."""

    def test_a_parked_hull_takes_it_and_wakes(self) -> None:
        r7 = result()["r7"]
        self.assertTrue(r7["tookParked"])
        self.assertTrue(r7["parkedAsleepBefore"])
        self.assertTrue(r7["parkedAwakeAfter"])
        self.assertAlmostEqual(SHERMAN_FORCE * TICK, r7["parkedVz"], places=3)

    def test_a_crewed_hull_takes_it_through_its_driven_body(self) -> None:
        r7 = result()["r7"]
        self.assertTrue(r7["tookDriven"])
        self.assertEqual(1, r7["drivenWoken"])
        self.assertEqual(1, r7["drivenCalls"])
        # The gun is yawed across the hull at the mantlet: +X, at 1.4/1.6/0.6.
        self.assertEqual([SHERMAN_FORCE, 0, 0], r7["drivenAccel"])
        self.assertEqual([1.4, 1.6, 0.6], r7["drivenAt"])

    def test_a_gun_on_no_placed_object_pushes_nothing(self) -> None:
        r7 = result()["r7"]
        # A static emplacement's gun, or a hull whose pad has not spawned it.
        self.assertFalse(r7["tookOrphan"])

    def test_the_guards(self) -> None:
        r7 = result()["r7"]
        self.assertFalse(r7["tookNothing"])
        # The model browser's turntable has no body world at all.
        self.assertFalse(r7["noWorld"])


class VanillaTableTests(unittest.TestCase):
    def test_the_sherman_is_the_hardest_hitting_tank_in_vanilla(self) -> None:
        table = result()["vanilla"]
        self.assertEqual(SHERMAN_FORCE, table["Sherman"])
        self.assertEqual(SHERMAN_FORCE, max(table.values()))
        # And the Yamato's turrets the softest, for all their calibre: a
        # battleship is 50,000 tonnes of hull and does not care.
        self.assertEqual(10, min(table.values()))


if __name__ == "__main__":
    unittest.main()
