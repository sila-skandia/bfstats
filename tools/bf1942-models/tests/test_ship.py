"""`viewer/ship.js` -- a ship under way, driven headless by `ship_harness.mjs`.

The claim the whole file rests on is that **the engine has no ship propulsion
code**: `c_ETShip = 9` has bit 0 set (`operator<<(std::ostream&, EngineType)`
`0x0823ef60` -- 1 Plane, 2 Car, 6 Tank, 9 Ship, 0x11 Rocket, 0x19 Torpedo), so a
helm runs the same `PhysicsEngine::updatePhysics` (`0x0824cbb0`) thrust body an
aeroplane does. Bit 3 is the only ship-specific thing in it, and it is the water
rule at `0x0824cc89`/`0x0824d047`.

The harness builds a Fletcher out of its own `.con` data rather than out of a
glb (the extracted scenes are not in the repository), which is the same thing
`flight_harness.mjs` does with the Corsair.

Numbers here are derived from the law, not read back: the draft from
`sum (-f)*lift = 9.82`, the thrust from `K = 0.1*|throttle| + e*|e|` times
`3.5*setDifferential/0.94`, the terminal speed from that against the box drag
law's own `1 + 24*min(depth/DY, 1)`.
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
HARNESS = Path(__file__).with_name("ship_harness.mjs")

MODULES = {
    "ship.mjs": VIEWER / "ship.js",
    "flight.mjs": VIEWER / "flight.js",
    "body-float.js": VIEWER / "body-float.js",
    # `body-float.js`'s own import: `FloatingHull` is a `RigidBody` with the
    # float law posted at each node.
    "rigid-body.js": VIEWER / "rigid-body.js",
    "vendor/loaders/GLTFLoader.js": VIEWER / "vendor" / "loaders" / "GLTFLoader.js",
    "vendor/utils/BufferGeometryUtils.js": VIEWER / "vendor" / "utils" / "BufferGeometryUtils.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})

WATER = 20.0
#: 20 + 20 - 9.82*20/(8*2) - 7.5 -- the Fletcher's closed-form draft.
DRAFT = 20.225
#: `3.5 * setDifferential / gearRatioCurve[100]` = 3.5*2/0.94.
RATIO = 3.5 * 2 / 0.94


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            # `ship.js` imports `./flight.js`; the copy is `flight.mjs`.
            text = source.read_text(encoding="utf-8")
            if name == "ship.mjs":
                text = text.replace("from './flight.js'", "from './flight.mjs'")
            target.write_text(text, encoding="utf-8")
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ShipSpecTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_the_spec_is_read_off_the_hull_not_guessed(self):
        spec = self.out["spec"]
        self.assertEqual(spec["mass"], 2500000)
        self.assertEqual(spec["drag"], 3)
        self.assertEqual(len(spec["engines"]), 1)
        engine = spec["engines"][0]
        self.assertEqual(engine["engineType"], "c_ETShip")
        self.assertEqual(engine["differential"], 2)
        self.assertEqual(engine["fade"], 120)
        # Back in Refractor's own frame, which is what a `flight.js` spec is
        # written in: the exporter mirrored z, and `shipSpec` mirrors it back.
        self.assertEqual(engine["position"], [0, -4, 40])

    def test_a_ship_may_go_astern_and_an_aircraft_may_not(self):
        """`Fletcher_Engine` runs `setMinRotation 0/0/-4000`, and `K` is a
        signed square, so a negative throttle is astern. `CORSAIR`'s own
        `throttleMin` is absent and reads as 0."""
        self.assertEqual(self.out["spec"]["throttleMin"], -1)

    def test_the_throttle_spools_over_the_revs_the_engine_declares(self):
        """`setMaxSpeed 0/0/5000` over `setMaxRotation 0/0/5000` is the whole
        range in a second -- the same reading `CORSAIR.throttleRate` is."""
        self.assertAlmostEqual(self.out["spec"]["throttleRate"], 1.0, places=6)

    def test_both_rudders_are_on_yaw_and_deflect_against_each_other(self):
        surfaces = self.out["spec"]["surfaces"]
        self.assertEqual(len(surfaces), 2)
        for surface in surfaces:
            self.assertEqual(surface["input"], "c_PIYaw")
            # `setWingLift 0 / setFlapLift 2`: a rudder swings its whole area.
            self.assertEqual(surface["wingLift"], 0)
            self.assertEqual(surface["flapLift"], 2)
            self.assertEqual([surface["min"], surface["max"]], [-25, 25])
        self.assertEqual(sorted(s["direction"] for s in surfaces), [-1, 1])
        # 55 m fore and aft of the hull origin: the arm that makes the couple.
        self.assertEqual(sorted(s["attach"][2] for s in surfaces), [-55, 55])

    def test_a_hull_with_no_engine_is_not_a_ship(self):
        self.assertIsNone(self.out["specWithoutEngine"])


class ShipWaterGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_a_screw_under_water_drives_and_one_out_of_it_does_not(self):
        """Bit 3 set. Below the waterline the thrust body runs with the stored
        throttle; above it, with `|throttle| > 0.02`, the thrust is skipped
        entirely and the throttle is **pinned to 1.0** (`0x0824d047`)."""
        gate = self.out["gate"]
        self.assertEqual(gate["submerged"], 1)
        self.assertIsNone(gate["clearOfTheWater"])
        self.assertEqual(gate["throttleAfterPin"], 1)

    def test_the_dead_band_is_two_hundredths(self):
        """`|throttle| > 0.02` -- at or below it the branch is not taken and the
        throttle survives."""
        self.assertEqual(self.out["gate"]["clearInTheDeadBand"], 0.01)

    def test_an_aircraft_gets_the_mirror_rule(self):
        """Bit 3 clear: an engine below the waterline has its throttle zeroed.
        Carrying `engineType` through `Aircraft`'s engine table is what keeps a
        ship off this branch -- a ship's screw is authored under water, so
        without it a destroyer had no thrust at all."""
        self.assertEqual(self.out["gate"]["planeSubmerged"], 0)


class ShipUnderWayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_a_ship_left_alone_floats_at_its_draft(self):
        """Ten seconds with the engine stopped: it neither sinks nor rises, and
        it does not oscillate -- the law is overdamped by about 15."""
        afloat = self.out["afloat"]
        self.assertAlmostEqual(afloat["y"], DRAFT, places=3)
        self.assertLess(abs(afloat["vy"]), 1e-3)
        self.assertLess(abs(afloat["speed"]), 1e-3)
        for y in afloat["trace"]:
            self.assertLess(abs(y - DRAFT), 0.01)

    def test_a_ship_dropped_above_its_draft_comes_back_to_it(self):
        """The closed form is the fixed point the law itself converges to --
        placement and simulation agree. It needs thousands of ticks, which is
        the whole reason placement is closed-form."""
        self.assertAlmostEqual(self.out["dropped"]["y"], DRAFT, places=2)

    def test_full_ahead_reaches_a_terminal_speed_and_stays_afloat(self):
        """Thrust at full throttle from rest is `(0.1 + 1) * 3.5*2/0.94` =
        8.19 m/s^2, and what stops it is the box drag law. The terminal speed
        depends on `underWater`, which is NOT read from the binary (see
        `ship.js`), so what is asserted is that a terminal speed exists, is in
        the range a destroyer plausibly makes, and is reached -- not its
        value."""
        self.assertAlmostEqual(0.1 + 1.0, 1.1, places=9)
        self.assertAlmostEqual(1.1 * RATIO, 8.191, places=3)
        ahead = self.out["ahead"]
        self.assertGreater(ahead["along"], 5)
        self.assertLess(ahead["along"], 30)
        # It is going where it is pointed: nearly all of the speed is along
        # the hull's own forward axis, because thrust is applied on the
        # centreline and there is no side force but the rudders'.
        self.assertAlmostEqual(ahead["speed"], abs(ahead["along"]), places=2)
        # And it is still floating, not driving itself under or taking off. A
        # hull under way settles a little off its static draft -- the rudders'
        # own lift and the box drag both have a vertical share once the hull
        # trims -- so this is "still a ship", not a draft assertion.
        self.assertLess(abs(ahead["y"] - DRAFT), 0.5)

    def test_astern_is_astern(self):
        """A negative throttle drives the hull backwards along its own forward
        axis, which an aircraft's clamp at 0 could not express."""
        astern = self.out["astern"]
        self.assertLess(astern["along"], -5)
        self.assertAlmostEqual(astern["throttle"], -1, places=3)

    def test_the_rudder_turns_the_ship_and_the_sign_follows_the_input(self):
        """Two `Wing`s, opposite `setAcceleration` signs, 110 m apart: the
        couple is `r x F` and nothing in the model says "turn". Full rudder for
        30 s is tens of degrees, not hundreds -- a capital ship's turning circle
        is minutes."""
        one = self.out["turning"]["turned"]
        other = self.out["turningOther"]["turned"]
        # Straight ahead for the same 30 s turns through nothing at all: with
        # both rudders centred their lifts cancel, so the couple is zero and
        # nothing else in the model yaws a hull.
        self.assertLess(abs(self.out["ahead"]["turned"]), 0.5)
        self.assertGreater(abs(one), 5)
        self.assertLess(abs(one), 180)
        # Opposite rudder, opposite way round, and by the same amount.
        self.assertLess(one * other, 0)
        self.assertAlmostEqual(abs(one), abs(other), places=1)
        # ... and it does not capsize or take off while turning. It does rise a
        # little: a hull that heels lifts its own origin, and the rise is the
        # same both ways round, which is what says it is heel and not drift.
        self.assertLess(abs(self.out["turning"]["y"] - DRAFT), 0.5)
        self.assertAlmostEqual(self.out["turning"]["y"],
                               self.out["turningOther"]["y"], places=2)


if __name__ == "__main__":
    unittest.main()
