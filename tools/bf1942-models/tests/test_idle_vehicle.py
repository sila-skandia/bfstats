"""An unoccupied vehicle is in its default idle state.

The owner's report: "When a tank or plane spawns, or you exit one while firing,
the firing animation still appears on the plane or tank. I've seen it with the
spitfire where you were flying it and crashed. When it respawns you see it in
the firing state."

One latch behind all three. A gun's firing state lives on scene nodes -- the
baked flash emitter's `visible`, the streak template's `visible`, the barrel's
own `position` -- and `GunFire.advance` is the only thing that ever puts any of
them back. A group spliced out of `guns.groups` on a seat exit is never
advanced again, so whatever the exit caught is frozen there for the rest of the
level; `wreckVehicle` hides the hull with those flags intact and
`respawnVehicle` turns them all back on; and the level-load sweep never named
the streak template at all.

Run under node through `idle_vehicle_harness.mjs`, the same pattern as
test_gunfire_layers.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from page_source import page_source  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "idle_vehicle_harness.mjs"

MODULES = {
    "idle-vehicle.js": VIEWER / "idle-vehicle.js",
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
    "seats.js": VIEWER / "seats.js",
    "seat-survey.js": VIEWER / "seat-survey.js",
    "turret-rig.js": VIEWER / "turret-rig.js",
    "vehicle-occupancy.js": VIEWER / "vehicle-occupancy.js",
    "entry-points.js": VIEWER / "entry-points.js",
    "spawned-craft.js": VIEWER / "spawned-craft.js",
    "fire-state.js": VIEWER / "fire-state.js",
    "seat-dots.js": VIEWER / "seat-dots.js",
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


class IdleVehicleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- entry point 3: a vehicle placed at level load --------------------

    def test_a_freshly_placed_vehicle_shows_no_streak(self) -> None:
        # Straight out of the glb, both payloads are visible: that is what the
        # load sweep is for, and it named every one of them except the streak.
        self.assertIn("ShermanGunBarrel_tracer", self.results["loadBefore"])
        self.assertTrue(self.results["loadStreakBefore"])
        self.assertEqual([], self.results["loadAfter"])

    # --- entry point 1: exit while the trigger is down --------------------

    def test_a_held_trigger_lights_the_flash_and_kicks_the_barrel(self) -> None:
        # The bug needs a real firing state to leave behind, so pin that the
        # rig produces one. `collect` hides the baked payloads on entry, which
        # is why a gun somebody is sitting in never shows a parked streak.
        self.assertEqual(1, self.results["collected"])
        self.assertEqual([], self.results["afterCollect"])
        self.assertEqual(1, self.results["firingShots"])
        self.assertIn("e_MuzzPanz", self.results["firingLit"])
        # recoil.size 3 x RECOIL_KICK_SCALE, one 1/60 s frame into a 0.3 s
        # recovery: the barrel is well out of battery.
        self.assertGreater(self.results["firingOffHome"], 0.2)

    def test_leaving_the_seat_puts_the_gun_out(self) -> None:
        self.assertTrue(self.results["releasedFromIndex"])
        self.assertEqual([], self.results["exitLit"])
        self.assertEqual(0, self.results["exitOffHome"])

    def test_and_it_stays_out(self) -> None:
        # Nothing steps a released group, so if the exit did not put the flash
        # out and the barrel home, nothing ever will. Two whole seconds of
        # `advance` later, which is past the flash's own 5 s life on purpose.
        self.assertEqual([], self.results["exitLitLater"])
        self.assertEqual(0, self.results["exitOffHomeLater"])

    def test_releasing_twice_is_harmless(self) -> None:
        # `leaveManned` delegates to `leaveVehicle`, which calls `releaseGuns`
        # again over a list that may still hold the same group.
        self.assertEqual([], self.results["doubleReleaseLit"])

    # --- entry point 2: wreck, then respawn on the pad --------------------

    def test_a_respawned_hull_comes_back_dark(self) -> None:
        # The state the hull is really in underneath its own wreck.
        self.assertIn("e_MuzzPanz", self.results["wreckedLit"])
        self.assertEqual([], self.results["respawnLit"])
        self.assertEqual(0, self.results["respawnOffHome"])

    def test_a_respawned_hull_comes_back_loaded(self) -> None:
        # The `FireState` WeakMap is keyed on the FireArms node and a respawn
        # reuses that node, so without a reset the new hull inherits the dead
        # one's spent magazine, hot barrel and running reload.
        self.assertEqual(
            {"ammo": 0, "heat": 1, "reload": 1.4, "mags": 0, "canFire": False},
            self.results["wreckedState"])
        self.assertEqual(
            {"ammo": 4, "heat": 0, "reload": 0, "mags": 2, "canFire": True},
            self.results["respawnState"])
        # Named once even though the page hands the same map in twice.
        self.assertEqual(["ShermanGunBarrel"], self.results["respawnReset"])

    # --- the emitter's own transform --------------------------------------

    def test_a_drifting_emitter_goes_back_to_its_authored_placement(self) -> None:
        # Hiding the node is only half of the latch. `advance` places an
        # emitter declaring `offsetInDof`/`speedInDof` at `basePos + drift`
        # and rewrites a billboarded one's quaternion, and both stop the
        # instant the group leaves the index -- while `collect` re-reads
        # `basePos`/`baseQuat` off the live node on the next entry. So a flash
        # left mid-drift is re-baked as the authored placement, and the
        # emitter walks one more drift from the muzzle every cycle.
        # Reproduced on the page with Kasserine Pass' AA_Allies
        # (`Em_MuzzAAgunB_WSmoke`, `speedInDof 10` over 0.5 s): authored local
        # z -1.0, then -1.667, -2.0, -2.333 after one, two and three
        # enter-fire-exit cycles, and it never came back.
        authored = self.results["driftAuthored"]
        self.assertEqual([0.0, 0.0, -1.0], authored)
        for cycle, seen in enumerate(self.results["driftCycles"], start=1):
            self.assertEqual(authored, seen, f"cycle {cycle}")

    def test_a_billboarded_emitter_goes_back_to_its_authored_facing(self) -> None:
        # `baseQuat` is what the drift direction is expressed in, so a
        # billboard quaternion re-baked as the rest pose does not only leave
        # the flash turned -- it sends the next burst's drift off along the
        # camera's axis instead of the line of fire.
        self.assertEqual([0.0, 0.0, 0.0, 1.0], self.results["driftQuat"])

    # --- the module's own contract ----------------------------------------

    def test_an_idle_tree_costs_nothing(self) -> None:
        self.assertEqual([], self.results["idempotentHidden"])
        self.assertEqual([], self.results["idempotentUnrecoiled"])

    def test_a_gun_with_no_home_is_not_moved(self) -> None:
        # `home` is what `collect` stamps; a node without one has no authored
        # rest position to be put back to, and guessing one would teleport it.
        self.assertEqual([1, 2, 3], self.results["bareKeptPosition"])

    def test_a_lookup_holding_nothing_is_not_an_error(self) -> None:
        self.assertEqual([], self.results["emptyLookup"])


class IdleVehicleWiringTests(unittest.TestCase):
    """The three call sites, pinned in `map.html`'s own source.

    The harness above drives `idleFirePose`/`idleFireState` directly, which
    proves the module and the `GunFire.release` road into it -- but nothing in
    the suite went near the other two. Deleting `respawnVehicle`'s pair and the
    level-load sweep's call left all ten of those tests green, so the wiring
    the owner's own repro depends on was carried by nothing. `map.html` is one
    10,000-line inline module that no node harness can import, so it is pinned
    the way `test_map_entry` pins its own contracts: on the source text.
    """

    # The page: `map.html` and the modules it was split into (`page_source.py`).
    source = page_source()

    def test_a_respawned_hull_is_reset_where_it_comes_back(self) -> None:
        # Both halves: the pose, and the `FireState` the respawn inherits
        # through a WeakMap keyed on a node it reuses. Measured on the page
        # (Aberdeen, Sherman, cannon fired twice, destroyed, respawned,
        # re-entered): `Ammo/PrimaryAmmo` 28 of 30 without this, 30 with it.
        self.assertIn("idleFirePose(visual.node);", self.source)
        # Both FireState maps, the page's and the world's -- named through the
        # page's handed-in accessors once the respawn moved to vehicle-wrecks.js.
        self.assertRegex(self.source,
                         r"idleFireState\(visual\.node, \[(?:\w+\.)*fireStates, (?:\w+\.)*world\?\.fireStates\]\);")

    def test_the_level_load_sweep_goes_through_the_same_reset(self) -> None:
        # And no longer spells out its own three-key copy, which is how it
        # came to miss `tracerMesh` -- 15 streak templates drawing across
        # Battle of Britain at load, measured, 0 after.
        self.assertRegex(self.source, r"idleFirePose\((?:\w+\.)*currentRoot\);")
        self.assertNotIn("obj.userData?.projectileTrail) obj.visible = false;",
                         self.source)

    def test_every_seat_exit_funnels_through_release(self) -> None:
        # Four copies of trigger-off-and-splice became one `guns.release`. A
        # fifth copy growing back is the way this defect returns, so no vehicle
        # or manned gun list may splice `guns.groups` by hand again.
        # The seats' gun lists are the hull's instance's now: it collects a
        # seat's groups when the seat is taken and releases them, through
        # `guns.release`, when it is left (`vehicle-instance.js`).
        instance = (VIEWER / "vehicle-instance.js").read_text(encoding="utf-8")
        self.assertNotIn("groups.splice", instance)
        self.assertIn("this.env.guns.release(group)", instance)
        for name in ("collectGuns", "collectMannedGuns", "releaseGuns"):
            self.assertNotIn(f"function {name}(", self.source, name)


if __name__ == "__main__":
    unittest.main()
