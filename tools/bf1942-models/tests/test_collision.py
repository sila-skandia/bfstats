"""`viewer/collision.js` under node, plus the extractor half it reads.

The collision module is deliberately dependency-free — no `three` import, no
DOM — precisely so it can be run and asserted here rather than only in a
browser. `collision_harness.mjs` builds fake meshes carrying only the four
fields the module reads (`geometry.attributes.position`, `geometry.index`,
`geometry.userData`, `matrixWorld.elements`), exercises every path, and prints
one JSON blob.

Node reads a bare `.js` as CommonJS, so the module is copied next to the
harness as `collision.mjs` for the run; the copy is byte-identical.
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

from bf42 import con as con_mod  # noqa: E402
from extract_map import projectile_materials, write_damage_tables  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "collision.js"
HARNESS = Path(__file__).resolve().parent / "collision_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "collision.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CollisionModuleTests(unittest.TestCase):
    """One node run, many assertions — starting the runtime is the slow part."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_heightfield_rebuilds_the_lattice_from_the_tiles(self) -> None:
        field = self.results["heightfield"]
        self.assertEqual(4, field["dim"])
        self.assertEqual(4, field["spacing"])
        self.assertEqual(1.0, field["coverage"])
        self.assertAlmostEqual(0.0, field["atOrigin"], places=5)
        # y = x / 4, so halfway across the first 4 m cell is 0.5 m up.
        self.assertAlmostEqual(0.5, field["atMidCell"], places=5)
        self.assertAlmostEqual(4.0, field["atFarEdge"], places=5)
        self.assertIsNone(field["offGrid"])   # NaN serialises as null

    def test_sample_spacing_is_inferred_when_the_manifest_omits_it(self) -> None:
        self.assertEqual(4, self.results["inferredDim"])

    def test_terrain_material_is_a_nearest_sample(self) -> None:
        materials = self.results["terrainMaterial"]
        self.assertEqual(10, materials["nearOrigin"])
        self.assertEqual(12, materials["farSide"])

    def test_a_round_stops_on_the_ground(self) -> None:
        hit = self.results["terrainHit"]
        self.assertEqual("terrain", hit["kind"])
        # Dropped from y = 10 onto ground at 0.5 m.
        self.assertAlmostEqual(9.5, hit["t"], places=1)
        self.assertAlmostEqual(0.5, hit["y"], places=1)
        self.assertEqual(10, hit["material"])

    def test_nothing_is_hit_going_up_or_starting_underground(self) -> None:
        self.assertTrue(self.results["upwardMiss"])
        self.assertTrue(self.results["undergroundIgnored"])

    def test_a_flat_round_finds_rising_ground(self) -> None:
        # The case a downward-only test would miss: level flight into a slope.
        hit = self.results["skimHit"]
        self.assertEqual("terrain", hit["kind"])
        self.assertAlmostEqual(4.8, hit["x"], places=1)

    def test_a_round_stops_on_the_water(self) -> None:
        hit = self.results["waterHit"]
        self.assertEqual("water", hit["kind"])
        self.assertAlmostEqual(2.0, hit["y"], places=5)
        self.assertEqual(self.results["waterMaterialId"], hit["material"])
        self.assertEqual(1, hit["material"])   # MaterialManager's Water

    def test_ground_above_the_sea_beats_the_water_plane(self) -> None:
        hit = self.results["landBeatsWater"]
        self.assertEqual("terrain", hit["kind"])
        self.assertGreater(hit["y"], 2.0)

    def test_a_round_already_underwater_is_not_stopped_by_the_surface(self) -> None:
        self.assertTrue(self.results["submergedIgnored"])

    def test_hulls_pack_into_the_grid(self) -> None:
        index = self.results["index"]
        self.assertEqual(4, index["triangles"])       # two quads
        self.assertGreaterEqual(index["entries"], 4)

    def test_the_sweep_catches_a_wall_thinner_than_one_frame_of_travel(self) -> None:
        # The whole point of C-1: a 16 m step over a zero-thickness wall 8 m in.
        # A point test at the new position lands at x = 16 and sees nothing.
        hit = self.results["sweptWall"]
        self.assertIsNotNone(hit)
        self.assertEqual("object", hit["kind"])
        self.assertAlmostEqual(8.0, hit["t"], places=4)
        self.assertAlmostEqual(8.0, hit["x"], places=4)
        self.assertEqual(92, hit["material"])         # concrete
        self.assertTrue(self.results["nearestWins"])

    def test_a_swept_sphere_stops_its_own_radius_short(self) -> None:
        # The body query beside the round query. A ray down the middle of a
        # doorway reports clear while the shoulders are already in the frame;
        # this is the version that does not.
        sweep = self.results["sweptSphere"]
        self.assertIsNotNone(sweep)
        self.assertEqual("object", sweep["kind"])
        self.assertAlmostEqual(7.5, sweep["t"], places=4)
        self.assertAlmostEqual(8.0, sweep["px"], places=4)    # the wall itself
        self.assertAlmostEqual(-1.0, sweep["nx"], places=5)
        self.assertEqual(92, sweep["material"])

    def test_the_sweep_honours_the_owner_skip(self) -> None:
        # Same rule as `cast`: a body must not collide with its own hull.
        hit = self.results["sweptOwnerSkipped"]
        self.assertAlmostEqual(11.5, hit["t"], places=4)
        self.assertEqual(85, hit["material"])

    def test_a_zero_radius_sweep_agrees_with_the_ray(self) -> None:
        # Two independent narrowphases (Moller-Trumbore and a plane crossing)
        # over the same triangle; they have to meet at radius 0.
        self.assertAlmostEqual(8.0, self.results["sweptZeroRadiusMatchesTheRay"],
                               places=4)

    def test_a_level_with_no_hulls_sweeps_to_nothing(self) -> None:
        # Levels exported before the collision flip have a heightfield and a sea
        # and no statics; a body on one must fall back rather than throw.
        self.assertTrue(self.results["sweptWithoutStatics"])

    def test_the_normal_faces_the_incoming_round(self) -> None:
        nx, ny, nz = self.results["facingNormal"]
        self.assertAlmostEqual(-1.0, nx, places=5)
        self.assertAlmostEqual(0.0, ny, places=5)
        self.assertAlmostEqual(0.0, nz, places=5)

    def test_a_gun_does_not_shoot_its_own_hull(self) -> None:
        # Skipping the near wall's owner reaches the far one, 12 m out.
        hit = self.results["ownerSkipped"]
        self.assertAlmostEqual(12.0, hit["t"], places=4)
        self.assertEqual(85, hit["material"])

    def test_a_moved_owner_is_hit_where_it_now_stands(self) -> None:
        # A parked vehicle shoved 3 m along x: the index is not rebuilt, the
        # collider asks again in the hull's baked frame (`setMovedOwner`).
        moved = self.results["movedOwnerCast"]
        self.assertAlmostEqual(11.0, moved["t"], places=6)
        self.assertAlmostEqual(11.0, moved["x"], places=6)
        self.assertEqual(92, moved["material"])
        self.assertEqual(0, moved["owner"])
        self.assertEqual([-1, 0, 0], [round(c) for c in moved["normal"]])
        self.assertTrue(self.results["movedOwnerOldPlaceEmpty"])
        swept = self.results["movedOwnerSweep"]
        self.assertAlmostEqual(10.5, swept["x"], places=4)
        self.assertAlmostEqual(11.0, swept["px"], places=4)
        self.assertEqual(0, swept["owner"])
        # Fired by the moved owner itself: skipped, the far wall (85) is next.
        self.assertEqual(85, self.results["movedOwnerSkipsSelf"])

    def test_a_moved_owner_can_be_turned(self) -> None:
        turned = self.results["movedOwnerTurned"]
        self.assertAlmostEqual(8.0, turned["t"], places=6)
        self.assertAlmostEqual(-8.0, turned["z"], places=6)
        self.assertEqual(0, turned["owner"])
        self.assertEqual([0, 0, 1], [round(c) for c in turned["normal"]])

    def test_clearing_a_moved_owner_puts_its_baked_hull_back(self) -> None:
        back = self.results["movedOwnerCleared"]
        self.assertAlmostEqual(8.0, back["x"], places=6)
        self.assertEqual(92, back["material"])

    def test_a_disabled_owner_stops_blocking(self) -> None:
        # After a wreck fades the pad must be walkable; disableOwner drops that
        # hull from cast/sweep without rebuilding the index.
        past = self.results["disabledOwnerSkipped"]
        self.assertIsNotNone(past)
        self.assertEqual(85, past["material"])
        self.assertTrue(self.results["disabledOwnerRestored"])

    def test_the_segment_length_is_respected(self) -> None:
        self.assertTrue(self.results["shortOfWall"])
        self.assertTrue(self.results["behindMiss"])

    def test_the_nearest_of_terrain_water_and_hulls_wins(self) -> None:
        self.assertEqual("object", self.results["mixedKind"])
        surface = self.results["surfaceHeight"]
        self.assertAlmostEqual(4.0, surface["overLand"], places=5)
        self.assertAlmostEqual(2.0, surface["overSea"], places=5)   # the sea

    def test_the_impact_effect_comes_out_of_the_authored_table(self) -> None:
        effects = self.results["effects"]
        self.assertEqual("e_waterimpact", effects["water"])
        self.assertEqual("GroundExplDry", effects["sand"])
        self.assertEqual("Exp2CascadesStone", effects["concrete"])
        # An undeclared pair means no effect, which `damage.py` documents as the
        # engine's own answer; it must not fall back to a neighbour.
        self.assertIsNone(effects["unknownPair"])
        self.assertIsNone(effects["unknownAttacker"])
        self.assertIsNone(effects["noTable"])

    def test_material_families_follow_the_declared_ranges(self) -> None:
        self.assertEqual(
            ["water", "ground", "armour", "metal", "wood", "stone"],
            self.results["families"])

    def test_cost_accounting_drains(self) -> None:
        cost = self.results["costShape"]
        self.assertGreater(cost["casts"], 0)
        self.assertTrue(cost["hasStats"])
        self.assertTrue(cost["finite"])


class ProjectileMaterialTests(unittest.TestCase):
    """`ObjectTemplate.material` on a Projectile is the attacker id."""

    def library(self, text: str) -> con_mod.ObjectLibrary:
        library = con_mod.ObjectLibrary()
        library.add_con("Objects/Test/Weapons.con", text)
        return library

    def test_projectiles_carry_their_attacker_material(self) -> None:
        library = self.library(
            "ObjectTemplate.create Projectile ShermanProjectile\n"
            "ObjectTemplate.material 236\n"
            "ObjectTemplate.create Projectile RifleProjectile\n"
            "ObjectTemplate.material 218\n")

        table = projectile_materials(library)

        self.assertEqual({"shermanprojectile": {"material": 236},
                          "rifleprojectile": {"material": 218}}, table)

    def test_non_projectiles_and_materialless_projectiles_are_left_out(self) -> None:
        # `ObjectTemplate.material` on a PlayerControlObject is that object's
        # *defending* material (a Sherman is 50), not an attacker id.
        library = self.library(
            "ObjectTemplate.create PlayerControlObject Sherman\n"
            "ObjectTemplate.material 50\n"
            "ObjectTemplate.create Projectile BinocularsProjectile\n")

        self.assertEqual({}, projectile_materials(library))

    def test_no_library_is_an_empty_table_not_a_crash(self) -> None:
        self.assertEqual({}, projectile_materials(None))

    def test_the_table_is_written_into_the_shared_damage_json(self) -> None:
        class Tables:
            def as_dict(self):
                return {"materials": {}, "modifiers": {}, "effects": {}}

        with tempfile.TemporaryDirectory() as tmp:
            shared = Path(tmp) / "_shared"

            report = write_damage_tables(
                Tables(), shared, Path(tmp) / "wake",
                {"shermanprojectile": {"material": 236}})

            payload = json.loads((shared / "damage.json").read_text())
            self.assertEqual(236, payload["projectiles"]["shermanprojectile"]["material"])
            self.assertEqual(1, report["projectiles"])
            self.assertEqual("../_shared/damage.json", report["path"])


if __name__ == "__main__":
    unittest.main()
