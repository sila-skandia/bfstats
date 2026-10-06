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
    "round-launch.js", "proximity-fuse.js", "gun-groups.js", "camera-dof.js",
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
        # climbed 4.9 km in its 20 s and never met the ground.
        for name, by_angle in self.results["range"].items():
            for degrees, flight in by_angle.items():
                with self.subTest(round=name, degrees=degrees):
                    self.assertTrue(flight["landed"], flight)
                    self.assertLess(flight["endHeight"], 1.0)

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
