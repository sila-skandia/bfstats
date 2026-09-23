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
import math
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
    "vehicle-camera.js": VIEWER / "vehicle-camera.js",
    "vehicle-discovery.js": VIEWER / "vehicle-discovery.js",
    "body-float.js": VIEWER / "body-float.js",
    # `ship.js`'s own two new imports: the gearbox (`engine-revs.js`, no imports
    # of its own) and the Coulomb constants the beaching friction uses.
    "engine-revs.js": VIEWER / "engine-revs.js",
    "body-friction.js": VIEWER / "body-friction.js",
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

    def test_a_craft_without_a_geometry_chain_is_measured_in_its_own_frame(self):
        g = self.out["craftGeometry"]
        self.assertEqual(g["size"], [3.5, 3.4, 14.1])
        self.assertEqual(g["keel"], -1.83)

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
        """`Fletcher_Engine` runs `setMinRotation 0/0/-4000` to
        `setMaxRotation 0/0/5000`, and `T1 = Engine+0x10c / maxRotation.z` reads
        the CLIPPED angle (`0x0823e1e0`), so the pedal's own floor is
        -4000/5000 = **-0.8**, not -1: astern is 80 per cent of ahead before the
        signed square ever sees it. `CORSAIR`'s own `throttleMin` is absent and
        reads as 0."""
        self.assertAlmostEqual(self.out["spec"]["throttleMin"], -0.8, places=6)

    def test_a_ship_turns_on_the_engines_own_inertia(self):
        """`getGeometryInertia` (`0x08253930`, collision-response.md §4.2) is
        `(DY²+DZ²)/3` and friends off the geometry bounding box -- FOUR times a
        solid box's per unit mass, and the only inertia the engine has. A 134 m
        hull on a solid box's inertia answers the helm four times too quickly."""
        self.assertEqual(self.out["spec"]["inertiaLaw"], "geometry")
        mass, (dx, dy, dz) = 2500000, self.out["spec"]["size"]
        inertia = self.out["inertia"]
        self.assertAlmostEqual(inertia["y"] / (mass * (dx * dx + dz * dz) / 3),
                               1.0, places=6)
        self.assertAlmostEqual(inertia["x"] / (mass * (dz * dz + dy * dy) / 3),
                               1.0, places=6)
        self.assertAlmostEqual(inertia["z"] / (mass * (dx * dx + dy * dy) / 3),
                               1.0, places=6)

    def test_the_geometry_box_is_the_roots_own_mesh(self):
        """`getGeometryInertia` and the box drag both ask the object for its own
        `IGeometry`, which is the root's standard mesh. A turret, a climbing net
        and a muzzle-flash sprite are child OBJECTS with geometry of their own
        and are not in it -- the harness hangs a turret 12 m up and a wash sprite
        5 m down, and neither reaches the box."""
        self.assertEqual(self.out["geometry"]["size"], [18.73, 12.0, 133.86])
        self.assertEqual(self.out["geometry"]["bottom"], -5.0)

    def test_the_box_is_measured_in_the_hulls_own_frame(self):
        """`DX/DY/DZ` are the object's own extents. Measuring a hull at 45
        degrees of yaw through `matrixWorld` would give the world AABB and make
        a destroyer report a beam of 107 m."""
        self.assertEqual(self.out["geometryTurned"], [18.73, 12.0, 133.86])

    def test_the_keel_is_the_collision_boxs_bottom_and_it_is_the_draft(self):
        """`setUnderWater` measures the lowest COLLISION point, not the lowest
        drawn one (`ResponsePhysics::checkVsTerrain` `0x0825a960`), and that
        same point is what rests on the sea bed -- so `groundClearance` is
        `-keel`."""
        spec = self.out["spec"]
        self.assertEqual(spec["keel"], -4.0)
        self.assertEqual(spec["groundClearance"], 4.0)
        # At her draft the keel is 3.775 m under a water level of 20:
        # 20 - (20.225 - 4).
        self.assertAlmostEqual(self.out["afloat"]["underWater"], 3.775, places=3)

    def test_the_box_laws_angular_half_does_nothing_to_a_ship(self):
        """`k' = -drag*|w|/mass` times `(Ax+Az)` about y. It is in the law and is
        implemented, and at five degrees a second of yaw it is 2.2e-9 rad/s²
        -- so a hull's turn is damped by her two `Wing`s and by nothing else."""
        drag = self.out["angularDrag"]
        self.assertLess(drag["momentY"], 0)      # it opposes the rotation
        self.assertLess(abs(drag["alphaY"]), 1e-7)

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
        """Bit 3 set. Below the waterline the thrust body runs on the REVS
        (`+0xa0`); above it, with `|revs| > 0.02`, the thrust is skipped entirely
        and `+0xa0` is **pinned to 1.0** (`0x0824d06d` writes `[edi+0xa0]`)."""
        gate = self.out["gate"]
        self.assertEqual(gate["submerged"], 1)
        self.assertIsNone(gate["clearOfTheWater"])
        self.assertEqual(gate["revsAfterPin"], 1)

    def test_the_pin_lands_on_the_revs_and_not_on_the_helm_order(self):
        """`0x0824d06d` writes `[edi+0xa0]`, the rev state -- not the pedal. A
        hull lifted clear of the water and put back must not come back with the
        helm order changed under the player's hand."""
        self.assertEqual(self.out["gate"]["throttleAfterPin"], 1)

    def test_the_dead_band_is_two_hundredths(self):
        """`|revs| > 0.02` -- at or below it the branch is not taken and the
        revs survive."""
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

    def test_the_pedal_is_not_the_throttle_the_thrust_law_reads(self):
        """`PhysicsEngine::updatePhysics` reads `+0xa0` (`fsubr [edi+0xa0]` at
        `0x0824cf4b`), which `Engine::handleUpdate` writes as
        `revs += 0.05*((T1 - L) - 0.5*revs)`. The load `L` is the thrust itself
        through `feedbackLoop`, so a pedal on the floor does NOT give the thrust
        law 1.0: a Fletcher settles near 0.48, and `revs = 2*(T1 - L)` holds.

        This is the whole of "too quick": without it a destroyer accelerates at
        `(0.1 + 1)*7.447 = 8.19 m/s^2` from rest, five times what she should."""
        self.assertAlmostEqual(1.1 * RATIO, 8.191, places=3)
        ahead = self.out["ahead"]
        self.assertGreater(ahead["revs"], 0.3)
        self.assertLess(ahead["revs"], 0.7)
        self.assertEqual(ahead["throttle"], 1)
        # The gearbox's own fixed point, to the accuracy of one tick of the
        # load that is accumulated after the filter has run.
        self.assertAlmostEqual(ahead["revs"], 2 * (1 - ahead["load"]), places=2)

    def test_full_ahead_reaches_a_terminal_speed_and_stays_afloat(self):
        """What stops her is the box drag law with the submerged multiplier; what
        holds her down to a plausible speed is the rev governor above. The
        terminal speed still depends on the geometry box, so what is asserted is
        that a terminal speed exists, is in the range a destroyer plausibly
        makes, and is reached -- not its value."""
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
        self.assertAlmostEqual(astern["throttle"], -0.8, places=3)
        # ... and she makes less way astern than ahead, because `T1` is -0.8.
        self.assertLess(abs(astern["along"]), self.out["ahead"]["along"])

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


    def test_she_takes_time_to_answer_the_helm(self):
        """The inertia correction shows up here rather than in the steady rate:
        the hull's own two `Wing`s damp the turn and the box law's angular half
        is 2.2e-9 rad/s², so the STEADY rate is set by the wings and the speed
        while the INERTIA sets how long she takes to reach it. Ten seconds of
        full rudder is a sixth of what the first thirty seconds average out to
        per second, which is a hull leaning into a turn rather than pivoting."""
        ten = self.out["turning"]["tenSeconds"]["turned"]
        rate = self.out["turning"]["rate"]
        self.assertLess(abs(ten), 25)
        # The rate she settles at, and the radius that implies: a destroyer's
        # circle is hundreds of metres, not tens.
        speed = self.out["turning"]["speed"]
        radius = speed / abs(rate * math.pi / 180)
        self.assertGreater(radius, 50)
        self.assertLess(radius, 600)
        # She is still accelerating into the turn at 10 s: the first ten seconds
        # are well under a third of the thirty-second total.
        self.assertLess(abs(ten), abs(self.out["turning"]["turned"]) / 2.5)


    def test_the_engines_inertia_is_four_times_a_solid_boxs_where_it_matters(self):
        """The same hull, the same rudder, the same speed -- only the divisor
        changes. `(DY²+DZ²)/3` against `/12` is four times the inertia, so it is
        four times LESS angular acceleration in the first seconds of a turn, and
        it converges on the same steady rate because that rate is the two
        `Wing`s' own balance and has no inertia in it at all."""
        answer = {row["seconds"]: row for row in self.out["helmAnswer"]}
        # Two seconds in, the ratio is the formula's own 4.
        two = answer[2]
        self.assertGreater(abs(two["box"]) / abs(two["geometry"]), 3.0)
        # ... and it closes as she settles into the turn.
        five = answer[5]
        self.assertLess(abs(five["box"]) / abs(five["geometry"]), 3.0)
        self.assertGreater(abs(five["box"]), abs(five["geometry"]))
        # The steady rate is the same to a tenth of a degree a second.
        self.assertAlmostEqual(self.out["turning"]["rate"],
                               self.out["turningSolidBox"]["rate"], places=1)


class ShipAgroundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_a_hull_over_a_shoal_rests_on_its_keel(self):
        """`groundClearance` is the draft, so a sea bed at 17.0 holds a keel at
        relative -4.0 at a root y of 21.0 -- 0.775 m above where she would float.
        She is held up as well as held still, and full ahead does not move her.

        Within a quarter of a metre rather than exactly, since W9-A: the hull
        rests on the LOWEST corner of her own footprint rather than on her
        origin's column (`Ship.hullFloor`), and a sixth of a degree of trim
        moves that corner 0.17 m over a 133 m hull."""
        beached = self.out["beached"]
        self.assertTrue(beached["aground"])
        self.assertAlmostEqual(beached["y"], 21.0, delta=0.25)
        self.assertEqual(beached["speed"], 0)
        self.assertEqual(beached["throttle"], 1)

    def test_she_makes_way_over_deep_water_and_stops_on_the_bank(self):
        """The same hull, full ahead, over deep water for 300 m and then a
        sandbank. `struckAt` is when `grounded` first goes true."""
        run = self.out["ranAground"]
        self.assertIsNotNone(run["struckAt"])
        moving = [p for p in run["track"] if not p["aground"] and p["t"] > 1]
        self.assertTrue(moving, "she never got under way")
        self.assertGreater(max(p["speed"] for p in moving), 5)
        stuck = [p for p in run["track"] if p["aground"]]
        self.assertTrue(stuck, "she never ran aground")
        for point in stuck:
            self.assertLess(point["speed"], 0.01)
            # A quarter of a metre, for the reason in the test above: she rests
            # on the lowest corner of her footprint, and she carries a little
            # trim. Before W9-A she rested on her origin's column and so did not
            # notice the bank until her origin was over it -- which is how her
            # bow came to be half a hull-length inside it.
            self.assertAlmostEqual(point["y"], 21.0, delta=0.25)

    def test_full_throttle_does_not_free_her_and_nor_does_astern(self):
        """The owner's own requirement, and the engine's: the Coulomb budget on
        a hull-on-sand contact is `0.9 * 1.5 * 9.82 = 13.3 m/s²` of velocity
        change a second (physics.md §10's sliding arm, the smaller of the two),
        against a thrust of about 1.5. Ten seconds of full ahead and thirty of
        full astern move her centimetres."""
        run = self.out["ranAground"]
        self.assertLess(abs(run["heldAhead"]["moved"]), 0.5)
        self.assertLess(abs(run["heldAstern"]["moved"]), 0.5)
        self.assertTrue(run["heldAstern"]["aground"])


class ShipReefTests(unittest.TestCase):
    """W9-A: running aground must cost no hit points.

    The engine bills terrain crash damage to a ship like anything else --
    `GameServer::handleCollisionLandOrWater` `0x08154960`, `|c|^3 * speedMod *
    |v|^2 * getDamageMod(matTerrain, matSelf) * getDamageForMaterial(matTerrain)`
    over a `> 1.0` gate -- and for a ship hull the middle pair is brutal:
    `damageMod(11 "Wet sand", 55..59) = 10.0`, authored in
    `Bf1942/Game/Collision_Armor/HeavyArmor.con` under `rem *** Wet Sand ***`
    with `setEffectTemplate e_Collision_ship`, times `materialDamage = 30`. The
    product is 300, where a jeep's hull (material 45) gets 0.01*30 = 0.3 and a
    plane's fuselage 0.1*30 = 3.

    On a real beach that still costs almost nothing, because `c` is the bank's
    own gradient: a few degrees, `c^3` a few times 1e-4, under two hit points.
    What made a hull die was `c` going to 0.8 -- and `c` only goes to 0.8 if the
    hull is allowed to put part of herself INSIDE a wall. The engine never lets
    her: `checkVsTerrain` `0x0825a960` calls `impulseOn` for every col0 vertex
    under the bed, so the hull is pushed out along her whole length. Grounding
    her on her origin's column alone let her bow travel half her length into an
    island first.
    """

    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_no_part_of_the_hull_is_ever_left_under_the_bed(self):
        """The footprint's deepest penetration, measured by the test's own
        sampler over the whole run, never exceeds a few centimetres. Before W9-A
        the bow reached the wall's full 16 m."""
        reef = self.out["reef"]
        self.assertGreater(reef["topSpeed"], 9, "she never got under way")
        self.assertLess(reef["buried"], 0.1)

    def test_the_crash_damage_path_is_never_handed_anything(self):
        """`|c|^3 * 0.05 * |v|^2 * 300` over the `> 1.0` gate, computed for every
        penetrating footprint sample on every tick: zero for the whole run, so
        beaching her costs the ship no hit points and the man at the helm no
        hit points either -- he only ever died because she was wrecked under
        him (`map.html killOccupantInWreck`)."""
        self.assertEqual(self.out["reef"]["worstBill"], 0)

    def test_she_still_stops_at_the_wall_and_stays_there(self):
        """W8-A's behaviour has to survive the fix: she grounds, she stops, and
        ten seconds of full ahead move her centimetres."""
        reef = self.out["reef"]
        self.assertIsNotNone(reef["struckAt"])
        self.assertTrue(reef["aground"])
        self.assertLess(reef["speed"], 0.05)
        self.assertLess(abs(reef["heldAhead"]), 0.5)

    def test_she_is_not_perched_above_the_waterline(self):
        """The push-out is along the bed's own normal (`impulseOn`, section 7),
        so a hull that meets the FACE of a reef is shoved back off it rather
        than lifted up it. Lifting her vertically by the penetration would have
        put a 133 m hull's keel metres clear of the sea."""
        self.assertLess(self.out["reef"]["keelAboveWater"], 0.5)


if __name__ == "__main__":
    unittest.main()
