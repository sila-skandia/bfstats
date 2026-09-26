"""`viewer/parachute.js` against the engine, through node.

Every constant asserted here is an address in `bf1942_lnxded.static`
(the Linux dedicated server, not stripped); the write-up with the commands that
reproduce each one is `features/viewer-parachute/README.md`. The landmarks at
the end -- a 6.03 m/s descent, a 12.28 m/s glide, a 2.037:1 glide ratio and a
landing that costs nothing -- are what the whole thing has to produce when a
real `Soldier` is bailed out over a real heightfield and flown down.
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
MODULES = [
    ROOT / "viewer" / "ladder-climb.js",
    ROOT / "viewer" / "parachute.js",
    ROOT / "viewer" / "swim.js",
    ROOT / "viewer" / "soldier.js",
    ROOT / "viewer" / "spawn-flags.js",
    ROOT / "viewer" / "physics.js",
    ROOT / "viewer" / "walking-body.js",
    ROOT / "viewer" / "soldier-resolve.js",
    ROOT / "viewer" / "soldier-pose.js",
    ROOT / "viewer" / "soldier-locomotion.js",
    ROOT / "viewer" / "point-body.js",
    ROOT / "viewer" / "fixed-step.js",
    ROOT / "viewer" / "world-collider.js",
    ROOT / "viewer" / "static-index.js",
    ROOT / "viewer" / "collision-meshes.js",
    ROOT / "viewer" / "drivable-mask.js",
    ROOT / "viewer" / "collision-materials.js",
    ROOT / "viewer" / "heightfield.js",
    ROOT / "viewer" / "fall-damage.js",
    ROOT / "viewer" / "spawn-safety.js",
]
HARNESS = Path(__file__).resolve().parent / "parachute_harness.mjs"


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
            capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ParachuteTests(unittest.TestCase):
    """One node run, many assertions."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the constants, each with the address it was read from -------------

    def test_the_free_fall_gate_is_minus_eight_and_ten_metres(self) -> None:
        # BFSoldier::handlePlayerInput 0x08275eaa reads -8.0 from 0x086d2714
        # and 0x08275f13 reads 10.0 from 0x086b9314; the height is measured
        # against terrainBase->getHeight(x, z), not against a raycast.
        c = self.results["constants"]
        self.assertEqual(-8.0, c["fallStateSpeed"])
        self.assertEqual(10.0, c["fallStateHeight"])

    def test_the_chute_closes_at_two_metres_a_second(self) -> None:
        # |getPositionalSpeed().y| <= 2.0 -> setIsParachuting(false), in both
        # arms of BFSoldier::handleUpdate (0x08272f3b, 0x08273129).
        self.assertEqual(2.0, self.results["constants"]["chuteCloseSpeed"])

    def test_the_shipped_pair_is_drag_24_and_speed_30(self) -> None:
        # CommonSoldierData.inc; BFSoldierTemplate +0x2e4 and +0x2e8, written
        # by ConsoleClass181/182::executeObjectMethod (0x082bc110, 0x082bc3e0).
        c = self.results["constants"]
        self.assertEqual(24, c["parachuteDrag"])
        self.assertEqual(30, c["parachuteSpeed"])

    def test_the_sound_layers_carry_the_ssc_times(self) -> None:
        # SoldierFallingHigh.ssc: each layer is a `Volume <- Time` Ramp with a
        # `trigger Volume`, so p1 is when it starts. The 11.5 s one is the
        # easter egg, and it is in the ambience patch, not with the @Language
        # screams.
        layers = {l["id"]: l for l in self.results["constants"]["layers"]}
        self.assertEqual(0, layers["rcktlp1"]["at"])
        self.assertTrue(layers["rcktlp1"]["loop"])
        self.assertEqual(0, layers["luft2"]["at"])
        self.assertTrue(layers["luft2"]["loop"])
        self.assertEqual(1.2, layers["fhs1"]["at"])
        self.assertEqual(2.3, layers["fhs2"]["at"])
        self.assertEqual(3.3, layers["scream"]["at"])
        self.assertEqual(11.5, layers["soprupp"]["at"])

    def test_the_clip_names_are_the_engines_own(self) -> None:
        # animations/AnimationStatesParachute.con, and the one that matters:
        # Ub_ParachuteOpen's `addTransitionWhenDone Ub_StandAim` is why a man
        # under a canopy can aim and fire.
        clips = self.results["constants"]["clips"]
        self.assertEqual("Lb_ParachuteFall", clips["falling"]["lower"])
        self.assertEqual("Lb_ParachuteOpen", clips["open"]["lower"])
        self.assertEqual("Lb_ParachuteIdle", clips["glide"]["lower"])
        self.assertEqual("Ub_StandAim", clips["glide"]["upper"])
        self.assertEqual("Lb_ParachuteHitGround", clips["landed"]["lower"])
        self.assertEqual("Lb_ParachuteDie", clips["dead"]["lower"])
        self.assertEqual("Lb_ParachuteDeadHitGround", clips["deadLanded"]["lower"])

    # --- the gates ---------------------------------------------------------

    def test_both_gates_have_to_pass(self) -> None:
        g = self.results["gate"]
        self.assertEqual("none", g["tooSlow"])
        self.assertEqual("falling", g["fastEnough"])
        self.assertEqual("none", g["tooLow"])
        self.assertEqual("falling", g["highEnough"])
        # No terrain to measure against is "no", not "infinitely high".
        self.assertEqual("none", g["noTerrain"])

    def test_free_fall_steers_on_the_look_axis_and_cannot_lift_you(self) -> None:
        # 0x082726fd takes the CAMERA's absolute transform row 2 and clamps the
        # y of the product at 0x0827274d-0x08272764.
        self.assertEqual({"x": 0, "y": 0, "z": 0}, self.results["upwardLookIsClamped"])
        self.assertAlmostEqual(-30.0, self.results["downwardLook"]["y"])
        self.assertAlmostEqual(30.0, self.results["levelLook"]["z"])
        self.assertAlmostEqual(0.0, self.results["levelLook"]["y"])

    def test_key_nine_only_opens_a_chute_while_falling(self) -> None:
        # c_PIMenuSelect9 (input bit 22) -> TemplateMessage 18
        # (GameServer::checkPlayerTriggers 0x08150018) -> BFSoldier::handleMessage
        # 0x0827728b, which takes it only while the lower body is in
        # Lb_ParachuteFall (0x08277b96).
        d = self.results["deploy"]
        self.assertEqual("none", d["onGround"])
        self.assertEqual("open", d["falling"])
        self.assertEqual(24, d["drag"])
        self.assertIn(d["opened"][0], ("para1", "para2", "para3"))

    # --- the descent -------------------------------------------------------

    def test_the_glide_ratio_is_the_engines_and_needs_no_radius(self) -> None:
        # Both terms divide by the same drag coefficient, so the ratio is
        # parachuteSpeed : |g| whatever the bounding radius turns out to be.
        cf = self.results["closedForm"]
        self.assertAlmostEqual(30 / 14.73, cf["glideRatio"], places=6)
        self.assertAlmostEqual(2.0367, cf["glideRatio"], places=4)

    def test_the_scaled_drag_reproduces_the_engines_coefficient(self) -> None:
        # The viewer carries SOLDIER_BOUNDING_RADIUS = 0.8 for the soldier's own
        # inert drag; the parachute flies at PARACHUTE_DRAG_RADIUS instead, and
        # only r^2 * drag reaches the integrator.
        cf = self.results["closedForm"]
        self.assertAlmostEqual(cf["enginePairK"], cf["viewerPairK"], places=9)

    def test_a_chute_settles_at_six_metres_a_second(self) -> None:
        # Terminal descent goes as 1/r^2 off PARACHUTE_DRAG_RADIUS, which is
        # 1.8: inside the only bound PARA-6 still has (r < 3.126, the canopy
        # must not close in mid-air) and set by play -- the owner reports the
        # 2.5 this used to carry descends at about half retail's rate. The
        # glide is the ratio away and needs no radius.
        for case in ("chute", "lowChute"):
            with self.subTest(case=case):
                self.assertAlmostEqual(6.0297, self.results[case]["descent"], places=3)
                self.assertAlmostEqual(12.2805, self.results[case]["glide"], places=3)

    def test_the_canopy_is_handed_a_zero_impact_speed(self) -> None:
        # BFSoldier::handleCollision 0x0827d3b0 overrides SimpleObject's and
        # forwards to it with a locally built zero Vec3 in place of argument 3
        # -- the impact speed -- for as long as state bit 0x10 is set
        # (0x0827d470 tests it, 0x0827d483-0x0827d491 builds the zeroes,
        # 0x0827d4a2 pushes them). The not-parachuting tail at 0x0827dc60 is
        # the same code pushing the caller's real vector instead.
        self.assertTrue(self.results["constants"]["zeroesImpactSpeed"])
        self.assertEqual(0, self.results["landingImpactSpeed"]["underCanopy"])
        self.assertAlmostEqual(
            13.681, self.results["landingImpactSpeed"]["freeFall"], places=3)

    def test_a_chute_landing_costs_nothing_at_any_speed(self) -> None:
        # The engine's own data requires the landing to be free:
        # Lb_ParachuteHitGround ends `addTransitionWhenDone Lb_Stand`.
        #
        # It is free for the engine's own reason. F is still the WHOLE drop --
        # Armor::update only ever raises lastCollisionHeight
        # (0x081730b0-0x081730e7), so a parachutist's F is his full altitude,
        # and the viewer does not re-stamp it. The body really does arrive at
        # 13.68 m/s, well over HP-14's 8.0 m/s floor; what the handler is told
        # is 0, so |v| - 8.0 goes negative and it returns before Q^2.
        for case in ("chute", "lowChute"):
            with self.subTest(case=case):
                landing = self.results[case]["landing"]
                self.assertIsNotNone(landing)
                self.assertEqual(0, landing["hp"])
                self.assertGreater(landing["fallHeight"], 100)
                self.assertTrue(landing["underCanopy"])
                self.assertEqual(0, landing["impactSpeed"])
                # What the body actually did, which HP-14 would have billed.
                self.assertAlmostEqual(13.681, landing["bodyImpactSpeed"], places=2)

    def test_no_chute_is_still_lethal(self) -> None:
        free = self.results["freeFall"]
        self.assertIsNone(free["trace"]["openedAt"])
        # 120 m looking straight down: gravity plus the engine's own -30 m/s^2
        # look term, so the arrival is far faster than 0.5*g*t^2 alone.
        self.assertGreater(free["landing"]["impactSpeed"], 95)
        self.assertGreater(free["landing"]["hp"], 30)

    def test_the_falling_state_arms_where_the_engine_arms_it(self) -> None:
        fired = self.results["chute"]["trace"]["fallFiredAt"]
        self.assertIsNotNone(fired)
        # Dropped from rest: -8 m/s arrives at t = 8 / 14.73 = 0.543 s, and the
        # tick that crosses it is the one that arms the state.
        self.assertAlmostEqual(0.567, fired["t"], places=2)
        self.assertGreater(fired["height"], 10.0)

    def test_the_sound_schedule_fires_at_the_scripts_own_times(self) -> None:
        by_id = {}
        for event in self.results["soundSchedule"]:
            by_id.setdefault(event["id"], event["t"])
        self.assertEqual(0, by_id["rcktlp1"])
        self.assertEqual(0, by_id["luft2"])
        for name, at in (("fhs1", 1.2), ("fhs2", 2.3), ("scream", 3.3),
                         ("soprupp", 11.5)):
            with self.subTest(layer=name):
                # Fires on the first tick at or past the script's own time, so
                # it lands within one 60 Hz tick of it.
                self.assertGreaterEqual(by_id[name], at - 1 / 60)
                self.assertLess(by_id[name], at + 1 / 60)

    def test_the_landing_state_is_reached(self) -> None:
        for case in ("chute", "lowChute"):
            with self.subTest(case=case):
                self.assertIsNotNone(self.results[case]["trace"]["landedAt"])

    def test_free_fall_steers_up_to_the_canopy_glide_and_no_further(self) -> None:
        cap = self.results["trackSpeed"]
        self.assertAlmostEqual(12.2805, cap, places=3)
        rest = self.results["levelFallFromRest"]
        self.assertEqual("falling", rest["state"])
        # It used to reach 30 m/s of forward speed a second, without bound.
        self.assertLessEqual(rest["peak"], cap + 1e-6)
        self.assertGreater(rest["speed"], cap - 0.1)

    def test_free_fall_keeps_the_planes_speed_without_adding_to_it(self) -> None:
        plane = self.results["levelFallFromPlane"]
        self.assertEqual("falling", plane["state"])
        self.assertLessEqual(plane["peak"], 50.0 + 1e-6)
        # The soldier's own drag 1.0 is all that takes anything off it:
        # 50 * exp(-pi * 0.8^2 * 1.0 / 100 * 8 s) = 42.6.
        self.assertAlmostEqual(50 * math.exp(-math.pi * 0.64 / 100 * 8), plane["speed"], delta=0.3)

    def test_a_bail_out_passes_through_the_hull_it_left(self) -> None:
        held = self.results["bailOntoHull"]["held"]
        through = self.results["bailOntoHull"]["through"]
        # Without the grace the wing stands him up and takes all 50 m/s.
        self.assertTrue(held["grounded"])
        self.assertLess(held["speed"], 1.0)
        # With it he keeps the aircraft's speed and falls away from it.
        self.assertFalse(through["grounded"])
        self.assertGreater(through["speed"], 49.0)
        self.assertLess(through["y"], 300.0)

    def test_stepping_out_of_a_jeep_carries_its_speed(self) -> None:
        carry = self.results["carryFromJeep"]
        # 20 m/s bled at 4.8 * 9.82 m/s^2: 0.42 s and v^2 / 2a = 4.2 m.
        self.assertTrue(carry["grounded"])
        self.assertGreater(carry["slid"], 3.5)
        self.assertLess(carry["slid"], 5.0)
        self.assertLess(carry["stoppedAt"], 0.5)


if __name__ == "__main__":
    unittest.main()
