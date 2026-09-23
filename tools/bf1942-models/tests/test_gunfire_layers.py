"""A round leaves the viewmodel's layer when it leaves the gun.

The bug: map.html puts a first-person arms rig wholesale on `VIEWMODEL_LAYER`
so the near pass can draw it over cleared depth, `GunFire.collect` then finds
the `projectileMesh` *inside* that rig, and `Object3D.clone()` copies `layers`.
A thrown grenade therefore went into the world scene on layer 1, where the
world camera's mask does not reach and the near camera never looks — it flew,
bounced, came to rest and exploded, all of it invisible. The same silence would
have hidden a bazooka's rocket body fired from an fp rig.

`GunFire.#adopt` is the fix and this is what pins it: the harness builds the
real rig shape, moves it to layer 1 exactly where map.html does, fires, and
asks whether a layer-0 camera can see what came out. Run under node through
`gunfire_layers_harness.mjs`, the same pattern as test_mouse_input.
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
HARNESS = Path(__file__).resolve().parent / "gunfire_layers_harness.mjs"

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
    # gunfire.js's own import graph, all of it leaf modules bar three.
    "collision.js": VIEWER / "collision.js",
    "world-collider.js": VIEWER / "world-collider.js",
    "static-index.js": VIEWER / "static-index.js",
    "collision-meshes.js": VIEWER / "collision-meshes.js",
    "drivable-mask.js": VIEWER / "drivable-mask.js",
    "collision-materials.js": VIEWER / "collision-materials.js",
    "heightfield.js": VIEWER / "heightfield.js",
    "effects-core.js": VIEWER / "effects-core.js",
    "projectile-damage.js": VIEWER / "projectile-damage.js",
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


class ProjectileLayerTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_rig_gives_up_its_projectile_template(self) -> None:
        self.assertEqual(1, self.results["collected"])
        self.assertTrue(self.results["foundProjectileMesh"])
        # The template stays on layer 1: it is part of the arms rig, which is
        # the near pass's business. 1 << VIEWMODEL_LAYER = 2.
        self.assertEqual(2, self.results["templateLayerMask"])

    def test_a_thrown_round_is_visible_to_the_world_camera(self) -> None:
        self.assertEqual(1, self.results["projectilesInFlight"])
        self.assertTrue(self.results["roundParentIsScene"])
        # Both the body and its nested child: `#adopt` traverses.
        self.assertEqual(["GrenadeAllies projectile", "GrenadeAllies pigg"],
                         self.results["worldCameraSees"])
        # And it is no longer the near pass's to draw, so it cannot be drawn
        # twice — once in the world and once pasted over cleared depth.
        self.assertEqual([], self.results["nearCameraSees"])

    def test_firing_does_not_drag_the_rig_onto_the_world_layer(self) -> None:
        self.assertGreater(self.results["rigStillOnViewmodelLayer"], 0)
        self.assertEqual(0, self.results["rigOnWorldLayer"])
        # And the template was cloned, not adopted out of the rig.
        self.assertEqual(3, self.results["weaponChildCount"])

    def test_a_pooled_round_is_re_adopted(self) -> None:
        # A pool outlives the weapon it came from, so the second round must not
        # be trusted to still be on the world layer just because the first was.
        self.assertEqual(1, self.results["pooledAfterExpiry"])
        self.assertTrue(self.results["secondRound"])
        self.assertEqual(["GrenadeAllies projectile", "GrenadeAllies pigg"],
                         self.results["secondRoundWorldCameraSees"])

    def test_the_round_carries_the_authored_tumble(self) -> None:
        # `rotationalSpeed 8/0/0`, the first component, off the weapon's own
        # throw block. A round with none spins at 0 and keeps the nose-along-
        # flight orientation alone.
        self.assertEqual(8, self.results["spin"])


if __name__ == "__main__":
    unittest.main()
