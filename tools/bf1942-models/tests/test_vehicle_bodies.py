"""`viewer/vehicle-bodies.js` and `viewer/body-world.js`: the seam between the
viewer's scene and the rigid-body modules.

Both files are framework-free, so - like `test_body_ground.py` - this copies
them and everything they import into a temp dir as `.mjs`, rewrites the
imports, and runs `node harness.mjs`. Expected numbers are worked from
`features/bf1942-engine-reference/subsystems/collision-response.md` (the box
inertia of section 4.2, the spring law of `PhysicsSpring::updatePhysics`, the
once-per-second damage limiter of section 9.2), never read back from the code.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "vehicle_bodies_harness.mjs"
MODULES = ["rigid-body", "body-contact", "body-statics", "crash-damage",
           "body-friction", "body-ground", "vehicle-bodies", "body-world"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            text = (VIEWER / f"{name}.js").read_text()
            text = re.sub(r"from '\./([a-z-]+)\.js'", r"from './\1.mjs'", text)
            (work / f"{name}.mjs").write_text(text)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class VehicleBodiesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    # --- orientation ---------------------------------------------------------

    def test_axes_are_the_bodys_axes_in_world_space(self) -> None:
        x_axis, y_axis, z_axis = self.r["quarterTurnY"]
        for got, want in zip(x_axis, [0, 0, -1]):
            self.assertAlmostEqual(want, got, places=12)
        for got, want in zip(y_axis, [0, 1, 0]):
            self.assertAlmostEqual(want, got, places=12)
        for got, want in zip(z_axis, [1, 0, 0]):
            self.assertAlmostEqual(want, got, places=12)

    def test_quaternion_round_trip(self) -> None:
        self.assertLess(self.r["quaternionRoundTrip"], 1e-6)

    # --- reading a placed vehicle ---------------------------------------------

    def test_a_placed_vehicle_is_described_from_its_nodes_and_the_sidecar(self) -> None:
        d = self.r["describe"]
        self.assertEqual(2500, d["mass"])
        self.assertEqual([2, 1, 4], d["box"])                 # the hull's visual bounds
        self.assertEqual(1, d["speedMod"])
        self.assertEqual(0, d["angleMod"])                    # engine default, unauthored
        self.assertEqual(1, d["damageMod"])
        self.assertTrue(d["damageFromWater"])
        kinds = [p["kind"] for p in d["parts"]]
        self.assertEqual(["body", "spring", "spring", "spring", "spring"], kinds)
        self.assertEqual([True, False, False, False, False], [p["isRoot"] for p in d["parts"]])
        self.assertEqual(2, d["parts"][0]["layers"])
        self.assertEqual([-0.8, -0.4, -1.5], [round(c, 9) for c in d["parts"][1]["offset"]])
        self.assertEqual({"gripFlags": 2, "strength": 25, "damping": 5}, d["parts"][1]["spring"])
        # Bounding radius: the farthest part origin plus that part's own radius.
        self.assertGreater(d["boundingRadius"], 1.7)

    def test_geometry_names_resolve_case_insensitively_through_the_alias_map(self) -> None:
        self.assertTrue(self.r["describeAlias"])

    def test_a_massless_or_unresolved_vehicle_stays_scenery(self) -> None:
        self.assertIsNone(self.r["describeNoMass"])
        self.assertIsNone(self.r["describeUnresolved"])

    def test_part_offsets_are_in_the_body_frame(self) -> None:
        # World (0, 0, -1) under a root whose X axis points down world -Z.
        for got, want in zip(self.r["describeTurnedOffset"], [1, 0, 0]):
            self.assertAlmostEqual(want, got, places=9)

    # --- a Spring with no collision node of its own -----------------------------

    def test_a_spring_without_a_collision_node_probes_its_own_geometry(self) -> None:
        """The published scenes predate `stdmesh.DEGENERATE_CROSS_SQ`, so the
        Sherman family's suspension carries no `... collision 0` child. The
        Spring still names the geometry, and `PhysicsSpring` reads the probe
        from there in the engine too, so the wheels are found anyway - which
        is the difference between a tank standing on its springs and a tank
        resting on a hull corner at a 13 degree list."""
        bare = self.r["bareSprings"]
        self.assertEqual(4, bare["springs"])
        self.assertEqual(1, bare["body"])
        # The probe lands at the Spring's own transform, which is where the
        # collision node the assembler would have hung there sits.
        rounded = sorted([round(c, 6) for c in offset] for offset in bare["offsets"])
        self.assertEqual([[-0.8, -0.4, -1.5], [-0.8, -0.4, 1.5],
                          [0.8, -0.4, -1.5], [0.8, -0.4, 1.5]], rounded)
        # And it is a real suspension, with the authored spring numbers.
        self.assertEqual(25, bare["spring"]["strength"])
        self.assertEqual(5, bare["spring"]["damping"])
        # The inertia box is still the hull's: a wheel is never the body.
        self.assertEqual([2, 1, 4], bare["box"])

    def test_a_spring_whose_geometry_has_no_collision_stays_scenery(self) -> None:
        self.assertEqual(0, self.r["bareSpringsUnresolved"])

    def test_a_spring_with_both_a_node_and_a_geometry_is_counted_once(self) -> None:
        self.assertEqual(4, self.r["bareSpringsNoDoubleCount"])

    # --- the vehicle under the player -------------------------------------------

    def test_driven_tangent_speed_is_v_plus_w_cross_r(self) -> None:
        self.assertEqual([5, 0, 0], [round(c, 9) for c in self.r["drivenTangent"]])

    def test_driven_push_out_is_immediate(self) -> None:
        self.assertEqual({"x": 1.5, "y": 2, "z": 3}, self.r["drivenTranslated"])

    def test_driven_flush_uses_the_engine_box_inertia(self) -> None:
        f = self.r["drivenFlushed"]
        self.assertAlmostEqual(5.0, f["velocity"]["x"], places=9)      # 4 + 30/30
        # Iy = (4^2 + 2^2)/3; dw = 60 * (1/30) / Iy = 0.3, on top of the 0.5 it had.
        self.assertAlmostEqual(0.8, f["angular"]["y"], places=9)
        self.assertAlmostEqual(0.0, f["angular"]["x"], places=9)
        self.assertAlmostEqual(5.0, self.r["drivenFlushedTwice"]["x"], places=9)

    def test_driven_torque_lands_on_the_body_axis_when_the_vehicle_is_turned(self) -> None:
        a = self.r["drivenTurnedAngular"]
        self.assertAlmostEqual(0.3, a["y"], places=9)
        self.assertAlmostEqual(0.0, a["x"], places=9)
        self.assertAlmostEqual(0.0, a["z"], places=9)

    def test_driven_acceleration_is_clamped_at_1000(self) -> None:
        self.assertAlmostEqual(1000 / 30, self.r["drivenClamped"], places=6)

    # --- the hull-contact hand-over (collision-response.md 8) ---------------------

    def test_a_drive_model_that_has_not_asked_gets_no_hull_contacts(self) -> None:
        self.assertIsNone(self.r["hullContactsOptIn"])

    def test_a_response_with_no_contact_publishes_nothing(self) -> None:
        self.assertEqual(0, self.r["hullContactsEmptyResponse"])

    def test_a_hull_contact_carries_the_normal_the_budget_is_made_of(self) -> None:
        c = self.r["hullContact"]
        # The averaged contact normal, not re-normalised (section 8), and its Y,
        # which is the whole Coulomb budget.
        self.assertEqual([0, 0.25, 0.9], c["normal"])
        self.assertEqual(0.25, c["normalY"])
        self.assertEqual(0.95, c["friction"])
        self.assertEqual(0.01, c["resistance"])
        self.assertEqual(2, c["count"])
        # Where it acts: the part's own position plus the averaged offset, the
        # same point `solveImpulse` posts its acceleration at (section 6.4).
        self.assertAlmostEqual(1.1, c["x"], places=6)
        self.assertAlmostEqual(1.8, c["y"], places=6)
        self.assertAlmostEqual(1.5, c["z"], places=6)

    def test_the_normal_is_copied_not_aliased(self) -> None:
        self.assertEqual(0.25, self.r["hullContactNormalCopied"])

    def test_every_tick_starts_with_no_hull_contacts(self) -> None:
        self.assertEqual(0, self.r["hullContactsClearedBySync"])

    def test_the_hull_contact_list_is_capped(self) -> None:
        self.assertEqual(8, self.r["hullContactsCap"])

    # --- one tick of everything ---------------------------------------------------

    def test_a_parked_vehicle_settles_where_the_spring_law_puts_it_and_sleeps(self) -> None:
        s = self.r["worldSettle"]
        self.assertTrue(s["sleeping"])
        self.assertLess(s["ticks"], 400)
        self.assertAlmostEqual(self.r["worldExpectedRestY"], s["y"], places=2)
        self.assertEqual(0, s["events"])          # wheels are material 37: landing is free
        self.assertTrue(self.r["worldOwnersTagged"])

    def test_a_ram_wakes_pushes_and_damages_both_once_per_second(self) -> None:
        ram = self.r["worldRam"]
        self.assertEqual(45, ram["ticksFor90Frames"])          # 90 frames at 60 Hz
        self.assertTrue(ram["parkedWoke"])
        self.assertGreater(ram["parkedMoved"], 0.2)
        self.assertTrue(ram["drivenSlowed"])
        self.assertEqual([7, 9], ram["victims"])
        self.assertEqual([1, 1], ram["perVictimFirstSecond"])
        self.assertTrue(self.r["worldDrivenHullOnly"])
        self.assertTrue(self.r["worldRemoved"])

    def test_a_backlog_is_dropped_not_replayed(self) -> None:
        self.assertEqual(1, self.r["worldBacklog"])


if __name__ == "__main__":
    unittest.main()
