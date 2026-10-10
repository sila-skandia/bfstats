"""The rounds a rack carries in view.

The owner's report (DC Wake, 2026-10-09): "The AV-8 that spawns beside the
large helicopter on the Nimitz has no missiles on its wings. Retail DC shows
them." The AIM-9s are `AV8AAim9Rack`'s `visibleDummyProjectileTemplate`, one
per `addFireArmsPosition`; the exporter bakes that body once, hidden, for the
rounds in flight, and nothing drew the loaded ones. `loaded-rounds.js` does,
and keeps them in step with the seat's magazine.

Run under node through `loaded_rounds_harness.mjs`, the same pattern as
test_idle_vehicle.
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
HARNESS = Path(__file__).resolve().parent / "loaded_rounds_harness.mjs"

MODULES = {
    "idle-vehicle.js": VIEWER / "idle-vehicle.js",
    "gunfire.js": VIEWER / "gunfire.js",
    "round-visuals.js": VIEWER / "round-visuals.js",
    "round-impact.js": VIEWER / "round-impact.js",
    "projectile-flight.js": VIEWER / "projectile-flight.js",
    "round-launch.js": VIEWER / "round-launch.js",
    # round-launch.js builds a rocket's motor (features/rocket-flight).
    "rocket-motor.js": VIEWER / "rocket-motor.js",
    "engine-revs.js": VIEWER / "engine-revs.js",
    "proximity-fuse.js": VIEWER / "proximity-fuse.js",
    "gun-groups.js": VIEWER / "gun-groups.js",
    "loaded-rounds.js": VIEWER / "loaded-rounds.js",
    "camera-dof.js": VIEWER / "camera-dof.js",
    "gun-cycle.js": VIEWER / "gun-cycle.js",
    # `bomb-release.js` (the salvo arithmetic, the release speed and the
    # drag law) and `torpedo-run.js` (an aircraft torpedo's water run),
    # both reached through gunfire.js / seats.js.
    "bomb-release.js": VIEWER / "bomb-release.js",
    "torpedo-run.js": VIEWER / "torpedo-run.js",
    "seats.js": VIEWER / "seats.js",
    "seat-survey.js": VIEWER / "seat-survey.js",
    "camera-pivot.js": VIEWER / "camera-pivot.js",
    "turret-rig.js": VIEWER / "turret-rig.js",
    "vehicle-occupancy.js": VIEWER / "vehicle-occupancy.js",
    "entry-points.js": VIEWER / "entry-points.js",
    "spawned-craft.js": VIEWER / "spawned-craft.js",
    "fire-state.js": VIEWER / "fire-state.js",
    # fire-state.js runs a seat gun's cone (XHIT-15).
    "deviation.js": VIEWER / "deviation.js",
    "seat-dots.js": VIEWER / "seat-dots.js",
    # gunfire.js's own import graph, all of it leaf modules bar three.
    "world-collider.js": VIEWER / "world-collider.js",
    "static-index.js": VIEWER / "static-index.js",
    "collision-meshes.js": VIEWER / "collision-meshes.js",
    "drivable-mask.js": VIEWER / "drivable-mask.js",
    "collision-materials.js": VIEWER / "collision-materials.js",
    "heightfield.js": VIEWER / "heightfield.js",
    "effects-core.js": VIEWER / "effects-core.js",
    "projectile-damage.js": VIEWER / "projectile-damage.js",
    "crash-damage.js": VIEWER / "crash-damage.js",
    "physics.js": VIEWER / "physics.js",
    "walking-body.js": VIEWER / "walking-body.js",
    "soldier-resolve.js": VIEWER / "soldier-resolve.js",
    "soldier-pose.js": VIEWER / "soldier-pose.js",
    "soldier-locomotion.js": VIEWER / "soldier-locomotion.js",
    "point-body.js": VIEWER / "point-body.js",
    "fixed-step.js": VIEWER / "fixed-step.js",
    "parachute.js": VIEWER / "parachute.js",
    "contact-response.js": VIEWER / "contact-response.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


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


class LoadedRoundsTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- which rack draws its rounds --------------------------------------

    def test_a_rack_with_a_visible_dummy_draws_its_rounds(self) -> None:
        # `Aim9Dummy` for `Aim9`: the body is the dummy, and the engine draws
        # it on the pylon. The Stuka's body is `DiveBomberBomb` itself, the
        # exporter's fallback for a rack naming no dummy, and draws nothing.
        self.assertTrue(self.results["drawsAim9"])
        self.assertFalse(self.results["drawsStuka"])
        self.assertEqual(0, self.results["stukaRounds"])

    # --- the parked hull at level load ------------------------------------

    def test_a_parked_harrier_hangs_four_sidewinders(self) -> None:
        r = self.results
        self.assertEqual(0, r["beforeMount"])
        self.assertEqual(4, r["restored"])
        self.assertEqual([True] * 4, r["afterMount"])
        self.assertEqual([f"AV8AAim9Rack muzzle {i}" for i in (1, 2, 3, 4)], r["parents"])
        self.assertEqual([[0, 0, 0]] * 4, r["localPositions"])
        self.assertTrue(r["keepsBodyRotation"])
        self.assertEqual([f"AV8AAim9Rack round {i}" for i in (1, 2, 3, 4)], r["names"])

    def test_a_bomb_hangs_level_whatever_way_it_is_released(self) -> None:
        # The Mk 83 rack's muzzles carry `0/35/0`, the release direction. The
        # dummy lies in the rack's frame (no relative rotation beyond the
        # body's own, none here), and the muzzle keeps its 35 degrees.
        r = self.results
        self.assertEqual([f"F14BMk83Rack muzzle {i}" for i in (1, 2, 3, 4)], r["mk83Parents"])
        for angle in r["mk83RelativeAngles"]:
            self.assertLess(angle, 1e-6)
        for aim in r["mk83MuzzleAim"]:
            self.assertAlmostEqual(-35.0, aim, places=6)
        self.assertAlmostEqual(35.0, r["mk83FireDirTilt"], places=6)
        self.assertTrue(r["mk83WorldAtMuzzle"])

    def test_the_idle_sweep_leaves_the_pylons_alone(self) -> None:
        # `idleFirePose` darkens the firing payloads; a loaded round is the
        # opposite payload and carries none of their marks.
        self.assertEqual([True] * 4, self.results["afterIdleSweep"])

    def test_mounting_twice_adds_nothing(self) -> None:
        self.assertEqual(4, self.results["mountTwice"])
        self.assertEqual([1, 1, 1, 1], self.results["childrenPerMuzzle"])

    # --- the magazine -----------------------------------------------------

    def test_the_first_barrels_empty_first(self) -> None:
        # A salvo fires its barrels from the first, so the first `spent`
        # pylons are the bare ones.
        sync = self.results["sync"]
        self.assertEqual([True, True, True, True], sync["4"])
        self.assertEqual([False, True, True, True], sync["3"])
        self.assertEqual([False, False, True, True], sync["2"])
        self.assertEqual([False, False, False, True], sync["1"])
        self.assertEqual([False, False, False, False], sync["0"])
        self.assertEqual([True] * 4, self.results["syncUnlimited"])

    # --- a seat firing through GunFire ------------------------------------

    def test_the_pylons_follow_the_seats_magazine(self) -> None:
        r = self.results
        self.assertTrue(r["groupLoadedRounds"])
        self.assertEqual([True] * 4, r["afterCollect"])
        # Two rounds in a second at `roundOfFire 2`, each billed to the
        # magazine and each taking its Sidewinder off the wing.
        last = r["fired"][-1]
        self.assertEqual(2, last["shots"])
        self.assertEqual(2, last["ammo"])
        self.assertEqual([False, False, True, True], last["shown"])
        self.assertEqual(0, r["spent"]["ammo"])
        self.assertEqual([False] * 4, r["spent"]["shown"])
        # `reloadTime 5`, `numOfMag 2`: the reload refills the rack and the
        # pylons with it.
        self.assertEqual(4, r["reloaded"]["ammo"])
        self.assertEqual([True] * 4, r["reloaded"]["shown"])

    def test_a_respawn_hangs_them_all_again(self) -> None:
        self.assertEqual([False] * 4, self.results["respawnBefore"])
        self.assertEqual([True] * 4, self.results["respawnAfter"])


if __name__ == "__main__":
    unittest.main()
