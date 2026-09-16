"""`viewer/seats.js` under node: seat survey, occupancy and the manned-gun
aim/fire runtime, exercised with plain `THREE.Object3D` trees rather than a
real extracted glb.

Same pattern as `test_ground.py` — one node run producing a JSON blob, the
vendored three.js stood up as an importable `three` package so `seats.js`
imports byte-for-byte (the file under test is the file the page loads).
`seats.js` has no dependency on `flight.js`/`ground.js`/a GLTFLoader by
design (`VehicleOccupancy`'s `classes` are dependency-injected — see its own
doc), so unlike `test_ground.py` nothing else needs copying alongside it.

The Defgun/Sherman node shapes the harness builds are transcribed from
BRIEFING2.md's own scene survey (control tags, EntryPoint radii, rig axes,
FireArms stats) — the real glb is not in the repository, but this is the same
shape `bf42/assemble.py`/`con.py` produce for both.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "test_seats_harness.mjs"

MODULES = {
    "seats.js": VIEWER / "seats.js",
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


class SeatsModuleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- classification (GUN-10, verify-r6.md) ------------------------------

    def test_defgun_root_is_a_manned_gun(self) -> None:
        self.assertEqual("gun", self.results["classify"]["defgunRoot"])

    def test_sherman_root_is_a_tank(self) -> None:
        self.assertEqual("tank", self.results["classify"]["shermanRoot"])

    def test_sherman_hull_gunner_seat_is_a_manned_gun(self) -> None:
        self.assertEqual("gun", self.results["classify"]["shermanGunnerSeat"])

    def test_a_root_with_no_engine_motion_or_firearms_is_a_bare_seat(self) -> None:
        self.assertEqual("seat", self.results["classify"]["bareSeat"])

    # --- seat order matches SEAT-24's own reading ---------------------------

    def test_root_is_always_seat_position_zero(self) -> None:
        # SEAT-24 (verify-r5.md): Sherman driver = setSelectKey PIMenuSelect1
        # (position 0, key 1); shermanBrowning_PCO1 = PIMenuSelect2 (position
        # 1, key 2). `order[0]` must be the root regardless of traversal.
        order = self.results["seatOrder"]
        self.assertEqual("Sherman", order[0])
        self.assertEqual("shermanBrowning_PCO1", order[1])

    def test_a_nested_pco_buckets_by_control_tag_not_by_its_own_node_name(self) -> None:
        # Confirmed against the live Wake scene headless this round: a second
        # Sherman instance's `shermanBrowning_PCO1` node is itself renamed
        # `shermanBrowning_PCO1_1` (scene-wide name disambiguation) while its
        # own descendants keep reporting the bare name as `control` --
        # bucketing the PCO by its own (possibly renamed) node name instead
        # split one seat into an empty `.node`-only half and a fully-armed
        # half with no `.node`, and pushed the real gunner to seat position 2.
        r = self.results["renamedGunnerNode"]
        self.assertEqual(["Sherman", "shermanBrowning_PCO1"], r["order"])
        self.assertTrue(r["gunnerSeatExists"])
        self.assertTrue(r["gunnerSeatHasNode"])
        self.assertEqual(["Browning"], r["gunnerSeatFireArms"])
        self.assertEqual(1, r["gunnerSeatAxisCount"])
        self.assertEqual("gun", r["gunnerKind"])

    # --- every PlayerControlObject's own EntryPoint is found ----------------

    def test_findAllVehicleRoots_sees_the_bare_gun_and_the_tank(self) -> None:
        roots = self.results["entryPoints"]["roots"]
        self.assertIn("Defgun", roots)
        self.assertIn("Sherman", roots)
        # Only true PCO roots -- a nested seat is not its own root.
        self.assertNotIn("shermanBrowning_PCO1", roots)

    def test_listEntryPoints_tags_each_door_with_its_own_seat(self) -> None:
        entries = self.results["entryPoints"]["shermanEntries"]
        by_node = {e["node"]: e["seatId"] for e in entries}
        self.assertEqual("Sherman", by_node["ShermanEntry"])
        self.assertEqual("shermanBrowning_PCO1", by_node["ShermanEntry_2"])

    # --- VehicleOccupancy: drivetrain injection, seat switching -------------

    def test_ensureDrive_builds_lazily_through_the_injected_class(self) -> None:
        occ = self.results["occupancy"]
        self.assertTrue(occ["beforeDriveNull"])
        self.assertTrue(occ["driveIsFakeInstance"])
        self.assertEqual("tank", occ["rootKind"])

    def test_turret_exists_only_for_a_gun_seat(self) -> None:
        occ = self.results["occupancy"]
        self.assertTrue(occ["rootTurretNull"])
        self.assertTrue(occ["gunnerTurretIsRig"])
        self.assertEqual(1, occ["gunnerAxisCount"])

    def test_active_fire_arms_scope_to_the_active_seat_only(self) -> None:
        self.assertEqual(["Browning"], self.results["occupancy"]["gunnerFireArms"])

    def test_hitpoints_hud_is_the_roots_shared_by_every_seat(self) -> None:
        # R2-31 (verify-r2.md, corrected): one Armor per vehicle, not per seat.
        occ = self.results["occupancy"]
        self.assertEqual("Vehicle/Icon_sherman.tga", occ["rootHudIcon"])
        self.assertTrue(occ["gunnerHudSameAsRoot"])

    def test_exit_location_falls_back_to_the_root_when_the_seat_has_none(self) -> None:
        self.assertTrue(self.results["occupancy"]["exitLocationFallsBackToRoot"])

    # --- TurretAxis: deadzone, direction, clamp, free wrap ------------------

    def test_small_input_stays_inside_the_deadzone(self) -> None:
        self.assertEqual(0, self.results["turretAxis"]["belowDeadzone"])

    def test_sustained_input_moves_the_axis_the_way_it_was_pushed(self) -> None:
        axis = self.results["turretAxis"]
        self.assertTrue(axis["movedNonZero"])
        self.assertTrue(axis["movedSameSignAsInput"])

    def test_a_bounded_axis_clamps_at_its_declared_max(self) -> None:
        self.assertTrue(self.results["turretAxis"]["clampedAtMax"])

    def test_a_free_axis_stays_inside_the_wrap_range(self) -> None:
        self.assertTrue(self.results["turretAxis"]["freeStaysInWrapRange"])

    # --- FireState: gate order, heat/overheat, reload (GUN-12) --------------

    def test_firing_decrements_ammo_one_per_shot(self) -> None:
        shots = self.results["fireState"]["shots"]
        ammos = [s["ammo"] for s in shots if s["canFire"]]
        self.assertEqual(ammos, sorted(ammos, reverse=True))
        self.assertEqual(3, ammos[0])

    def test_empty_mag_blocks_fire_until_reload_completes(self) -> None:
        shots = self.results["fireState"]["shots"]
        # The 4th attempt (index 3) is after 3 shots emptied a magSize-3 mag.
        self.assertFalse(shots[3]["canFire"])

    def test_reload_takes_about_reloadTime_and_refills_from_the_pouch(self) -> None:
        self.assertTrue(self.results["fireState"]["reloadTookAboutReloadTime"])
        after = self.results["fireState"]["afterReload"]
        self.assertEqual(3, after["ammo"])
        self.assertEqual(1, after["magsLeft"])
        self.assertTrue(after["canFire"])

    def test_heat_clamps_at_one_and_blocks_fire_there(self) -> None:
        # GUN-12's corrected `getHasHeat()` reading (`template+0x300 >
        # template+0x304`) is a different, template-level predicate, not this
        # runtime gate -- see `FireState.canFire`'s own comment. Blocking at
        # heat>=1 on this viewer's [0,1] scale follows the corrected report's
        # Viewer Recipe ("clamp [0,1] ... block fire ... on reaching 1.0"),
        # an approximation of the real trigger, not a confirmed comparison.
        self.assertTrue(self.results["fireState"]["heatClampsAtOne"])

    def test_overheat_blocks_fire_for_the_declared_delay_then_releases_it(self) -> None:
        fs = self.results["fireState"]
        self.assertFalse(fs["overheatedCanFire"])
        self.assertAlmostEqual(2.0, fs["overheatRemainingAfterShots"], delta=0.2)
        self.assertTrue(fs["canFireAfterCooldown"])

    def test_unlimited_ammo_sentinel_never_blocks_on_ammo(self) -> None:
        self.assertTrue(self.results["fireState"]["unlimitedNeverBlocksOnAmmo"])

    # --- chainOnShot and readWorldPose: the small plumbing helpers ----------

    def test_chainOnShot_calls_the_previous_handler_then_the_new_one(self) -> None:
        chain = self.results["chainOnShot"]
        self.assertEqual(["first", "second"], chain["order"])
        self.assertTrue(chain["sawGroup"])

    def test_readWorldPose_follows_a_moved_parent(self) -> None:
        pose = self.results["readWorldPose"]
        self.assertEqual([10, 2, 0], pose["before"])
        self.assertEqual([10, 2, 5], pose["after"])


if __name__ == "__main__":
    unittest.main()
