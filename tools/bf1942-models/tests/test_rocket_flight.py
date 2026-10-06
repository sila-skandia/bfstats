"""Artillery rockets fall, and a rocket's motor flies its own data.

The viewer half of `features/rocket-flight/README.md`, driven under node
through `rocket_flight_harness.mjs` against the real `viewer/gunfire.js`, the
same pattern as `test_bomb_release.py`. The rounds in the harness are copies of
the shipped glbs' `fireArms` blocks; `RoundsMatchTheTrees` checks the copies
against whatever trees are extracted on this machine.

  gravity  a round that declares no `gravityModifier` falls at 1.0 whatever
           kind the exporter baked it as (ledger IMP-7).
  range    vanilla's Katyusha and Desert Combat's MLRS, BM-21 and SCUD-B land,
           at 30 and 45 degrees, inside their `timeToLive`.
  bullets  an invisible round (baked `kind: 'bullet'`) and a tracer fall by
           their own `gravityModifier`; a retail rifle round still flies flat.
  motor    a rocket's own Engine flies it on the engine's thrust law and
           gearbox (PHY-16..PHY-19), and every long-lived one finds a top
           speed against the box drag law.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "rocket_flight_harness.mjs"

MODULE_NAMES = [
    "gunfire.js", "round-visuals.js", "round-impact.js", "projectile-flight.js",
    "round-launch.js", "rocket-motor.js", "engine-revs.js", "proximity-fuse.js",
    "gun-groups.js", "camera-dof.js",
    "gun-cycle.js", "bomb-release.js", "torpedo-run.js", "seats.js",
    "seat-survey.js", "camera-pivot.js", "turret-rig.js", "vehicle-occupancy.js",
    "entry-points.js", "spawned-craft.js", "fire-state.js", "deviation.js",
    "seat-dots.js", "idle-vehicle.js", "world-collider.js", "static-index.js",
    "collision-meshes.js", "drivable-mask.js", "collision-materials.js",
    "heightfield.js", "effects-core.js", "projectile-damage.js",
    "crash-damage.js", "physics.js", "walking-body.js", "soldier-resolve.js",
    "soldier-pose.js", "soldier-locomotion.js", "point-body.js", "fixed-step.js",
    "parachute.js", "contact-response.js",
]
MODULES = {name: VIEWER / name for name in MODULE_NAMES}
MODULES["node_modules/three/three.module.js"] = VIEWER / "vendor" / "three.module.js"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})

# Where each round's glb lives, by tree.
SOURCES = {
    "KatyushaRocket": "models/Katyusha.glb",
    "MLRSRocket": "models/mods/desertcombat/MLRS.glb",
    "BM21_Rocket": "models/mods/desertcombat/BM21.glb",
    "SCUD-BRocket": "models/mods/desertcombat/SCUD-B.glb",
}


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
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def glb_json(path: Path) -> dict:
    with path.open("rb") as f:
        head = f.read(20)
        length = struct.unpack_from("<I", head, 12)[0]
        return json.loads(f.read(length))


class RocketFlightTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- gravity -----------------------------------------------------------

    def test_an_artillery_rocket_comes_back_down(self) -> None:
        # None of the four declares `gravityModifier`, so each falls at 1.0.
        # Flown flat (the old `kind: 'rocket'` rule) a 45 degree MLRS round
        # was 2.75 km up and still climbing when its 20 s ran out.
        for name, by_angle in self.results["range"].items():
            for degrees, flight in by_angle.items():
                with self.subTest(round=name, degrees=degrees):
                    self.assertTrue(flight["landed"], flight)
                    self.assertLess(flight["endHeight"], 1.0)

    # --- range, on the real motor and the box drag law -----------------------

    # Measured 2026-10-06 (features/rocket-flight section 3). The motor and the
    # drag are both the engine's laws; what they add up to has not been seen
    # in the real game, so these pin the viewer, not retail.
    RANGES = {
        "KatyushaRocket": {"30": 228.5, "45": 480.6},
        "MLRSRocket": {"30": 806.6, "45": 1313.3},
        "BM21_Rocket": {"30": 595.3, "45": 952.2},
        "SCUD-BRocket": {"30": 1518.6, "45": 4056.6},
    }

    def test_each_artillery_rocket_lands_where_it_was_measured(self) -> None:
        for name, by_angle in self.RANGES.items():
            for degrees, metres in by_angle.items():
                with self.subTest(round=name, degrees=degrees):
                    flight = self.results["range"][name][degrees]
                    self.assertAlmostEqual(metres, flight["range"],
                                           delta=metres * 0.02)

    def test_the_landing_does_not_move_with_the_frame_rate(self) -> None:
        # The motor runs on the engine's 30 Hz tick whatever the page's rate.
        ranges = [f["range"] for f in self.results["frameRate"].values()]
        self.assertLess(max(ranges) - min(ranges), 0.01 * min(ranges))

    # --- the motor on its own ------------------------------------------------

    def test_the_throttle_servo_reaches_full_in_nine_ticks(self) -> None:
        # `maxSpeed` and `acceleration 100000` deg/s(^2) over `maxRotation
        # 5000`: the roll angle, and so `T1`, is at 1.0 by the ninth tick.
        ticks = {t["tick"]: t for t in self.results["motorAlone"]["ticks"]}
        self.assertAlmostEqual(0.022, ticks[1]["t1"], delta=0.001)
        self.assertLess(ticks[6]["t1"], 1.0)
        self.assertEqual(1.0, ticks[9]["t1"])

    def test_the_revs_settle_under_their_own_load(self) -> None:
        # 3.5 * differential 30 / 0.94; the revs settle at 0.604, not the
        # pinned 1.0, because the load `feedbackLoop` takes from the push
        # holds them down (TANK-12, TANK-13).
        alone = self.results["motorAlone"]
        self.assertAlmostEqual(111.702, alone["ratio"], delta=0.001)
        ticks = {t["tick"]: t for t in alone["ticks"]}
        self.assertAlmostEqual(0.604, ticks[120]["revs"], delta=0.002)
        # At 100 m/s an MLRS motor pushes 35.2 m/s^2 (the placeholder was 25).
        self.assertAlmostEqual(35.19, ticks[120]["accel"], delta=0.05)
        self.assertAlmostEqual(ticks[60]["accel"], ticks[120]["accel"], delta=0.1)

    def test_the_speed_term_fades_with_the_air(self) -> None:
        # At 1000 m `rho` is 0, so `e` is the revs alone and K = 0.1 r + r^2.
        alone = self.results["motorAlone"]
        r = alone["highRevs"]
        self.assertAlmostEqual(0.1 * r + r * r, alone["highK"], delta=0.002)

    def test_no_thrust_below_the_water(self) -> None:
        # Bit 3 clear: below the water level the revs are zeroed and nothing
        # pushes (`0x0824cc92`).
        self.assertEqual({"push": 0, "revs": 0}, self.results["motorAlone"]["wet"])

    def test_only_a_rocket_engine_flies_a_round(self) -> None:
        motors = self.results["motorAlone"]["motorsOf"]
        self.assertTrue(motors["rocket"])
        # The torpedo engine pushes under water only (torpedo-run.js), and a
        # plane engine on a round has no one to start or throttle it.
        self.assertFalse(motors["torpedo"])
        self.assertFalse(motors["plane"])
        self.assertFalse(motors["wing"])
        self.assertEqual(1, motors["silkworm"])
        self.assertIsNone(motors["shell"])

    def test_every_long_lived_rocket_finds_a_top_speed(self) -> None:
        # The placeholder's 25 m/s^2 had none: thrust now fades toward
        # `noPropellerEffectAtSpeed` and the load and drag meet it.
        for name in ("HydraRocket", "HellfireRocket", "Aim9", "AA-10",
                     "Rocket_MagicII", "AT2Rocket"):
            with self.subTest(round=name):
                at = self.results["motor"][name]["speedAt"]
                self.assertAlmostEqual(at["5"], at["10"], delta=0.03 * at["10"])

    def test_a_point_body_with_no_drag_stays_under_the_laws_ceiling(self) -> None:
        # DC Final's TOW: a point body of 500 kg at drag 0.1, so drag is
        # nothing and only the thrust law limits it. K reaches 0 where
        # e = -sqrt(0.1 revs), i.e. 1000 * (1.2 + sqrt(0.12)) = 1546 m/s.
        self.assertLess(self.results["motor"]["DefenderTOW"]["maxSpeed"], 1546)

    # --- the CBU-87 ----------------------------------------------------------

    def test_a_cbu_pull_lands_all_fourteen_in_the_authored_spread(self) -> None:
        # An A-10C at 100 m/s, 150 m up: one pull fires all fourteen barrels
        # (BOMB-1), each down its own `addFireArmsPosition` turn at 15 m/s on
        # top of the jet's speed, and each falls at 1.0. Flying level, as they
        # did on the old no-gravity tracer path, none of them ever landed.
        cbu = self.results["cbu"]
        self.assertEqual(14, cbu["fired"])
        self.assertEqual(14, cbu["landed"])
        # Every bomblet lands where its own barrel and gravity put it, to
        # within one frame's travel.
        self.assertLess(cbu["worstMiss"], 2.5)
        # The pattern the turns (up to 19 degrees) authored: about 38 m across
        # and 74 m along track, 473 m past the release.
        self.assertAlmostEqual(38.5, cbu["across"], delta=2)
        self.assertAlmostEqual(73.9, cbu["along"], delta=3)
        self.assertAlmostEqual(472.8, cbu["throw"], delta=10)

    # --- expiry: hasOnTimeEffect (PROX-7) -------------------------------------

    def test_a_flak_shell_that_sets_the_word_still_bursts_in_its_window(self) -> None:
        # `AA_Allies_Projectile` CRD_UNIFORM/0.8/1.4 and `Flak38_Projectile`
        # 0.8/1.2 at 300 m/s: 240..420 m and 240..360 m (PROX-7).
        for name, top in (("AA_Allies_Projectile", 420), ("Flak38_Projectile", 360)):
            for flight in self.results["expiry"][name]:
                with self.subTest(round=name, flight=flight):
                    self.assertTrue(flight["burst"])
                    self.assertGreaterEqual(flight["at"], 239)
                    self.assertLessEqual(flight["at"], top + 1)

    def test_a_dc_shilka_shell_expires_with_no_splash(self) -> None:
        # Desert Combat writes `hasOnTimeEffect 0` on it; the engine answers
        # its expiry with `resetProjectile`, so nothing bursts.
        for flight in self.results["expiry"]["ShilkaProjectile"]:
            self.assertTrue(flight["gone"])
            self.assertFalse(flight["burst"])
            self.assertEqual(0, flight["records"])

    def test_assets_too_old_to_say_keep_the_old_burst(self) -> None:
        for flight in self.results["expiry"]["staleShilka"]:
            self.assertTrue(flight["burst"])

    # --- bullets -----------------------------------------------------------

    def drops(self, name: str) -> list[float]:
        return [r["drop"] for r in self.results["bullets"][name]]

    def test_a_retail_rifle_round_still_flies_flat(self) -> None:
        # Every vanilla, XPack1 and XPack2 rifle and MG round declares
        # `gravityModifier 0` (census in the feature README).
        self.assertEqual([0, 0], self.drops("barProjectile"))

    def test_the_25mm_falls_at_its_authored_fifth(self) -> None:
        g1 = self.results["bullets"]["expectedDropAtG1"]
        for drop in self.drops("25mmChaingunProjectile"):
            self.assertAlmostEqual(0.2 * g1, drop, delta=0.01)

    def test_a_cluster_submunition_falls_at_one(self) -> None:
        # `CBU87Prj` is invisible, so baked `kind: 'bullet'`, and declares no
        # `gravityModifier`: it falls like a bomb, not level beside the jet.
        g1 = self.results["bullets"]["expectedDropAtG1"]
        for flight in self.results["bullets"]["CBU87Prj"]:
            self.assertAlmostEqual(g1, flight["drop"], delta=0.01)
            # And the streak turns down its path: 15 m/s and 7.4 m/s down.
            self.assertAlmostEqual(26.2, flight["pitchDown"], delta=0.5)

    def test_a_tracer_falls_by_its_own_word_not_the_rounds(self) -> None:
        # Desert Combat's `50cal_Projectile` flies flat; its tracer, every
        # second round, declares `gravityModifier 1`.
        g1 = self.results["bullets"]["expectedDropAtG1"]
        rounds = self.results["bullets"]["50cal_Projectile"]
        self.assertEqual([False, True], [r["bright"] for r in rounds])
        self.assertEqual(0, rounds[0]["drop"])
        self.assertAlmostEqual(g1, rounds[1]["drop"], delta=0.01)

    def test_a_gun_with_no_velocity_launches_at_two_hundred(self) -> None:
        # `FireArmsTemplate`'s constructor writes 200.0 (ledger FA-3); an
        # authored 0 (every aircraft bomb rack) is still 0 (BOMB-8).
        self.assertEqual({"absent": 200, "zero": 0, "declared": 45},
                         self.results["velocityDefault"])

    def test_vanillas_tracer_flies_flat_fresh_or_stale(self) -> None:
        # `Tracer_Projectile` declares 0.0; a glb baked before the tracer
        # carried its gravity keeps the straight streak.
        self.assertEqual([0, 0], self.drops("vanillaTracer"))
        self.assertEqual([0, 0], self.drops("staleTracer"))


# Where each bullet's glb lives, and the gun's node name.
BULLET_SOURCES = {
    "barProjectile": "models/viewmodels/BritishSoldier__Bar1918.fp.glb",
    "25mmChaingunProjectile": "models/mods/desertcombat/AH64.glb",
    "CBU87Prj": "models/mods/desertcombat/A10_C.glb",
    "50cal_Projectile": "models/mods/desertcombat/Browning.glb",
}


class RoundsMatchTheTrees(unittest.TestCase):
    """The harness's copies are the shipped glbs' blocks, where those exist."""

    FIELDS = ("template", "kind", "gravity", "mass", "drag", "hasPointPhysics",
              "timeToLive")
    PART_FIELDS = ("template", "kind", "position", "engineType", "torque",
                   "differential", "noPropellerEffectAtSpeed", "maxRotation",
                   "maxSpeed", "acceleration", "wingLift")

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        # The harness flies its rounds on import and needs the staged viewer
        # to do it; only its table is wanted here, so evaluate that alone.
        text = HARNESS.read_text()
        start = text.index("const ROCKET_ENGINE")
        end = text.index("// --- a world")
        body = text[start:end].replace("export const", "const")
        proc = subprocess.run(
            ["node", "--input-type=module", "-e",
             body + "\nconsole.log(JSON.stringify({ ROUNDS, BULLETS }));"],
            capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        tables = json.loads(proc.stdout)
        cls.rounds = tables["ROUNDS"]
        cls.bullets = tables["BULLETS"]
        start = text.index("export const CBU = {")
        end = text.index("\n};\n", start) + 3
        proc = subprocess.run(
            ["node", "--input-type=module", "-e",
             text[start:end].replace("export const", "const")
             + "\nconsole.log(JSON.stringify(CBU));"],
            capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.cbu = json.loads(proc.stdout)

    def test_the_cbu_barrels_match_the_a10c(self) -> None:
        path = VIEWER / "models/mods/desertcombat/A10_C.glb"
        if not path.exists():
            self.skipTest("A10_C.glb is not extracted on this machine")
        nodes = glb_json(path)["nodes"]
        rack = next(n for n in nodes if n.get("name") == "A10_CBU87"
                    and (n.get("extras") or {}).get("fireArms"))
        self.assertEqual(self.cbu["node"]["translation"], rack["translation"])
        for a, b in zip(self.cbu["node"]["rotation"], rack["rotation"]):
            self.assertAlmostEqual(a, b, places=6)
        muzzles = [nodes[c]["rotation"] for c in rack["children"]
                   if (nodes[c].get("extras") or {}).get("muzzle") is not None]
        self.assertEqual(14, len(muzzles))
        for ours, theirs in zip(self.cbu["muzzles"], muzzles):
            for a, b in zip(ours, theirs):
                self.assertAlmostEqual(a, b, places=5)

    def test_each_copy_matches_its_glb(self) -> None:
        checked = 0
        for name, rel in SOURCES.items():
            path = VIEWER / rel
            if not path.exists():
                continue
            found = None
            for node in glb_json(path).get("nodes", []):
                fire = (node.get("extras") or {}).get("fireArms") or {}
                projectile = fire.get("projectile")
                if isinstance(projectile, dict) and projectile.get("template") == name:
                    found = fire
                    break
            self.assertIsNotNone(found, f"{name} not in {rel}")
            mine = self.rounds[name]
            with self.subTest(round=name):
                self.assertEqual(found["velocity"], mine["velocity"])
                for field in self.FIELDS:
                    self.assertEqual(found["projectile"].get(field),
                                     mine["projectile"].get(field), field)
                theirs = found["projectile"].get("parts", [])
                ours = mine["projectile"]["parts"]
                self.assertEqual(len(theirs), len(ours))
                for a, b in zip(theirs, ours):
                    for field in self.PART_FIELDS:
                        self.assertEqual(a.get(field), b.get(field), field)
            checked += 1
        if not checked:
            self.skipTest("no rocket glb is extracted on this machine")

    def test_each_bullet_copy_matches_its_glb(self) -> None:
        checked = 0
        for name, rel in BULLET_SOURCES.items():
            path = VIEWER / rel
            if not path.exists():
                continue
            found = find_fire_arms(path, name)
            self.assertIsNotNone(found, f"{name} not in {rel}")
            mine = self.bullets[name]
            with self.subTest(round=name):
                self.assertEqual(found["velocity"], mine["velocity"])
                for field in ("template", "kind", "gravity", "timeToLive"):
                    self.assertEqual(found["projectile"].get(field),
                                     mine["projectile"].get(field), field)
                tracer = found.get("tracer")
                if mine.get("tracer"):
                    self.assertEqual(mine["tracer"]["template"], tracer["template"])
                    self.assertEqual(mine["tracer"]["interval"], tracer["interval"])
                    # A tree baked before the tracer carried its gravity has
                    # none; a fresh one must agree.
                    if "gravity" in tracer:
                        self.assertEqual(mine["tracer"]["gravity"], tracer["gravity"])
            checked += 1
        if not checked:
            self.skipTest("no bullet glb is extracted on this machine")


def find_fire_arms(path: Path, template: str) -> dict | None:
    for node in glb_json(path).get("nodes", []):
        fire = (node.get("extras") or {}).get("fireArms") or {}
        projectile = fire.get("projectile")
        if isinstance(projectile, dict) and projectile.get("template") == template:
            return fire
    return None


if __name__ == "__main__":
    unittest.main()
