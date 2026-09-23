"""A thrown explosives pack lies flat, and the plunger reaches it.

Two defects, one round, both reported from the map viewer:

* **The pack tipped up on its end and dug into the ground.** Thrown along the
  ground it slid correctly — `contact-response.js` gives it the engine's own
  friction — and then stood up. `gunfire.js` aims every round nose-along-flight
  with `lookAt(position - velocity)`, which is right in the air and wrong on a
  surface: once friction has taken the horizontal component the only velocity
  left is the hair of downward that gravity adds and the contact cancels each
  tick, so the slab was aimed at the floor. Measured against the pre-fix
  module this harness reads a tilt of **79.8 degrees**; with `layOnSurface` it
  reads 0.

* **There was no way to set one off.** `FireArms::detonateProjectiles` (lnxded
  `0x08287f80`) walks the weapon's own live-projectile array and calls
  `Projectile::detonate()` on each — the same call the end of a fuse makes, so
  a hand-detonated pack does exactly the damage a timed-out one does.

Run under node through `fuse_round_rest_harness.mjs`, the same pattern as
`test_gunfire_layers`.
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
HARNESS = Path(__file__).resolve().parent / "fuse_round_rest_harness.mjs"

MODULES = {
    "gunfire.js": VIEWER / "gunfire.js",
    "round-visuals.js": VIEWER / "round-visuals.js",
    "round-impact.js": VIEWER / "round-impact.js",
    "projectile-flight.js": VIEWER / "projectile-flight.js",
    "round-launch.js": VIEWER / "round-launch.js",
    "gun-groups.js": VIEWER / "gun-groups.js",
    "gun-cycle.js": VIEWER / "gun-cycle.js",
    # `bomb-release.js` (the salvo arithmetic, the release speed and the
    # drag law) and `torpedo-run.js` (an aircraft torpedo's water run),
    # both reached through gunfire.js / seats.js.
    "bomb-release.js": VIEWER / "bomb-release.js",
    "torpedo-run.js": VIEWER / "torpedo-run.js",
    "idle-vehicle.js": VIEWER / "idle-vehicle.js",
    "collision.js": VIEWER / "collision.js",
    "world-collider.js": VIEWER / "world-collider.js",
    "static-index.js": VIEWER / "static-index.js",
    "drivable-mask.js": VIEWER / "drivable-mask.js",
    "collision-materials.js": VIEWER / "collision-materials.js",
    "heightfield.js": VIEWER / "heightfield.js",
    "effects-core.js": VIEWER / "effects-core.js",
    "projectile-damage.js": VIEWER / "projectile-damage.js",
    "physics.js": VIEWER / "physics.js",
    "walking-body.js": VIEWER / "walking-body.js",
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
        result = subprocess.run(["node", "harness.mjs"], cwd=work,
                                capture_output=True, text=True)
        if result.returncode != 0:
            raise AssertionError(result.stderr[-4000:])
        return json.loads(result.stdout.strip().splitlines()[-1])


class FuseRoundRestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_the_pack_reaches_the_floor_and_settles(self):
        self.assertTrue(self.out["collected"])
        self.assertEqual(self.out["inFlight"], 1)
        self.assertTrue(self.out["hasBody"], "a fuse round runs the contact solver")
        self.assertTrue(self.out["resting"])
        self.assertGreater(self.out["contacts"], 0)
        # One standoff above the floor, not buried in it.
        self.assertAlmostEqual(self.out["restY"], 0.02, places=2)

    def test_it_lies_flat_on_what_it_landed_on(self):
        # The defect read 79.8 degrees here.
        self.assertLess(self.out["tiltDegrees"], 1.0)

    def test_the_orientation_is_a_rotation_and_keeps_its_heading(self):
        # A basis built the wrong way round is a mirror, and would turn the
        # mesh inside out rather than lay it down.
        self.assertAlmostEqual(self.out["determinant"], 1.0, places=3)
        # Thrown down -Z, still facing -Z.
        self.assertGreater(self.out["headingDot"], 0.99)

    def test_a_settled_pack_neither_creeps_nor_tips(self):
        self.assertLess(self.out["driftAfter10s"], 0.01)
        self.assertLess(self.out["tiltAfter10s"], 1.0)

    def test_the_plunger_sets_off_every_pack_this_weapon_put_down(self):
        self.assertEqual(self.out["liveBeforePlunger"], 4)
        self.assertEqual(self.out["detonated"], 4)
        self.assertEqual(self.out["liveAfterPlunger"], 0)
        self.assertEqual(self.out["projectilesAfter"], 0)

    def test_a_hand_detonation_is_the_end_of_life_blast(self):
        self.assertEqual(self.out["blastKind"], "endOfLife")
        self.assertEqual(self.out["blastRadius"], 12)
        self.assertEqual(self.out["blastNormal"], [0, 1, 0])

    def test_a_plunger_with_nothing_left_to_set_off_is_quiet(self):
        self.assertEqual(self.out["secondPull"], 0)


if __name__ == "__main__":
    unittest.main()
