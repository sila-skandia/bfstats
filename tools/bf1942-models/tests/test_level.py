from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.level import (  # noqa: E402
    decode_heightmap,
    parse_cubemap_rcm,
    parse_init_con,
    parse_spawn_templates,
    parse_static_objects,
    parse_terrain_con,
    spawn_vehicle,
    tile_world_origin,
    LevelInfo,
)
from bf42.terrain import apply_detail, tile_mesh, water_mesh  # noqa: E402


class TerrainConfigTests(unittest.TestCase):
    def test_tobruk_offsets_place_tx00_at_combat_origin(self) -> None:
        info = parse_terrain_con(
            """
GeometryTemplate.create patchTerrain terrainGeometry
GeometryTemplate.worldSize 4096
GeometryTemplate.yScale 0.6
GeometryTemplate.materialSize 1024
GeometryTemplate.texOffsetX 4
GeometryTemplate.texOffsetY -10
GeometryTemplate.waterLevel 25
GeometryTemplate.texBaseName bf1942\\levels\\Tobruk\\Textures\\Tx
"""
        )

        self.assertEqual(4096.0, info.world_size)
        self.assertEqual(0.6, info.y_scale)
        self.assertEqual(4, info.tex_offset_x)
        self.assertEqual(-10, info.tex_offset_y)
        self.assertEqual(25.0, info.water_level)
        self.assertEqual((1024.0, 0.0), tile_world_origin(info.tex_offset_x, info.tex_offset_y, 0, 0))
        self.assertEqual((2816.0, 1280.0), tile_world_origin(info.tex_offset_x, info.tex_offset_y, 7, 5))

    def test_wake_offset_places_tx00_in_the_ocean_inset(self) -> None:
        self.assertEqual((512.0, 512.0), tile_world_origin(2, 2, 0, 0))

    def test_berlin_filenames_are_world_patch_indices(self) -> None:
        self.assertEqual((1536.0, 1536.0), tile_world_origin(0, 0, 6, 6))


class HeightmapTests(unittest.TestCase):
    def test_height_matches_placed_object_altitude(self) -> None:
        # Spawn camera on Tobruk sits at Y=69.94 over a sample of 29382.
        sample = 29382
        data = struct.pack("<16H", *([sample] * 16))
        heightmap = decode_heightmap(data, world_size=16.0, y_scale=0.6)

        self.assertEqual(4, heightmap.dim)
        self.assertEqual(4.0, heightmap.spacing)
        self.assertAlmostEqual(68.866, heightmap.height_at(0, 0), places=2)

    def test_tile_mesh_covers_the_patch_in_world_units(self) -> None:
        data = struct.pack("<64H", *([10000] * 64))
        heightmap = decode_heightmap(data, world_size=32.0, y_scale=0.6)
        info = parse_terrain_con(
            """
GeometryTemplate.worldSize 32
GeometryTemplate.yScale 0.6
GeometryTemplate.texOffsetX 0
GeometryTemplate.texOffsetY 0
"""
        )
        primitive = tile_mesh(heightmap, info, 0, 0, patch=16.0)

        self.assertIsNotNone(primitive)
        xs = {p[0] for p in primitive.positions}
        zs = {p[2] for p in primitive.positions}
        self.assertEqual(0.0, min(xs))
        self.assertEqual(16.0, max(xs))
        self.assertEqual(0.0, min(zs))
        self.assertEqual(16.0, max(zs))
        self.assertEqual(len(primitive.indices) // 3, 4 * 4 * 2)
        nys = [n[1] for n in primitive.normals]
        self.assertGreater(min(nys), 0.9)

    def test_water_faces_up(self) -> None:
        info = parse_terrain_con(
            """
GeometryTemplate.worldSize 256
GeometryTemplate.waterLevel 25
GeometryTemplate.texOffsetX 0
GeometryTemplate.texOffsetY 0
"""
        )
        primitive = water_mesh(info, [(0, 0)], patch=16.0)
        self.assertIsNotNone(primitive)
        a, b, c = (primitive.positions[i] for i in primitive.indices[:3])
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        ny = uz * vx - ux * vz
        self.assertGreater(ny, 0.0)


class DetailTextureTests(unittest.TestCase):
    def test_mid_grey_detail_is_identity(self) -> None:
        base = bytes([200, 80, 40, 255] * 4)
        detail = bytes([128, 128, 128, 255] * 4)
        out = apply_detail(base, 2, 2, detail, 2, 2, repeats=1)
        self.assertEqual(base, out)


class StaticObjectTests(unittest.TestCase):
    def test_create_then_position_belongs_to_that_instance(self) -> None:
        instances = parse_static_objects(
            """
Object.create Afri_bush8_M1
Object.absolutePosition 1849.47/72.874/660.429
Object.rotation 10/0/0
Object.create coastline
Object.absolutePosition 3361.73/25/18.94
"""
        )

        self.assertEqual(2, len(instances))
        self.assertEqual("Afri_bush8_M1", instances[0].template)
        self.assertEqual((1849.47, 72.874, 660.429), instances[0].position)
        self.assertEqual((10.0, 0.0, 0.0), instances[0].rotation)
        self.assertIsNone(instances[0].team)
        self.assertEqual("coastline", instances[1].template)

    def test_set_team_belongs_to_the_spawn(self) -> None:
        instances = parse_static_objects(
            """
Object.create ScoutCarSpawner
Object.absolutePosition 2510.61/70.3195/842.627
Object.rotation -177.48/0/0
Object.setTeam 2
Object.create lighttankspawner
Object.absolutePosition 1754.94/68.0798/560.473
Object.setTeam 1
"""
        )
        self.assertEqual(2, instances[0].team)
        self.assertEqual(1, instances[1].team)


class SpawnTemplateTests(unittest.TestCase):
    def test_team_picks_the_vehicle(self) -> None:
        templates = parse_spawn_templates(
            """
ObjectTemplate.create ObjectSpawner lighttankspawner
ObjectTemplate.setObjectTemplate 2 sherman
ObjectTemplate.setObjectTemplate 1 panzeriv
ObjectTemplate.create ObjectSpawner ScoutCarSpawner
ObjectTemplate.setObjectTemplate 2 Willy
ObjectTemplate.setObjectTemplate 1 Kubelwagen
ObjectTemplate.teamOnVehicle 2
"""
        )
        self.assertEqual("sherman", spawn_vehicle("lighttankspawner", 2, templates))
        self.assertEqual("panzeriv", spawn_vehicle("lighttankspawner", 1, templates))
        self.assertEqual("Willy", spawn_vehicle("ScoutCarSpawner", 1, templates))
        self.assertIsNone(spawn_vehicle("AAGunSpawner", 2, templates))


class CubemapTests(unittest.TestCase):
    def test_rcm_faces_follow_the_gltf_z_mirror(self) -> None:
        faces = parse_cubemap_rcm(
            """
[CubeMap]
PositiveX = bf1942\\levels\\Tobruk\\Textures\\env_Tobruk_02.dds
NegativeX = bf1942\\levels\\Tobruk\\Textures\\env_Tobruk_04.dds
PositiveY = bf1942\\levels\\Tobruk\\Textures\\env_Tobruk_05.dds
NegativeY = bf1942\\levels\\Tobruk\\Textures\\env_Tobruk_06.dds
PositiveZ = bf1942\\levels\\Tobruk\\Textures\\env_Tobruk_01.dds
NegativeZ = bf1942\\levels\\Tobruk\\Textures\\env_Tobruk_03.dds
"""
        )
        self.assertEqual(
            "bf1942/levels/Tobruk/Textures/env_Tobruk_02.dds", faces["px"])
        self.assertEqual(
            "bf1942/levels/Tobruk/Textures/env_Tobruk_01.dds", faces["nz"])
        self.assertEqual(
            "bf1942/levels/Tobruk/Textures/env_Tobruk_03.dds", faces["pz"])


class InitConTests(unittest.TestCase):
    def test_combat_area_and_camera(self) -> None:
        info = LevelInfo(name="Tobruk", terrain=parse_terrain_con(""))
        parse_init_con(
            """
renderer.fogColorVec 0.8/0.718/0.531
renderer.fogLinearStart 150
renderer.fogLinearEnd 300
sky.sunLightDirectionVec -0.778/0.58/-0.234
game.setActiveCombatArea 1024 0 2048 2048
game.setBeforeSpawnCameraPosition 1 1983.37/69.94/688.15
water.color 0.63/0.59/0.33
""",
            info,
        )

        self.assertEqual((0.8, 0.718, 0.531), info.fog_color)
        self.assertEqual(150.0, info.fog_start)
        self.assertEqual((1024.0, 0.0, 2048.0, 2048.0),
                         (info.combat.min_x, info.combat.min_z, info.combat.size_x, info.combat.size_z))
        self.assertEqual((1983.37, 69.94, 688.15), info.camera)
        self.assertEqual((0.63, 0.59, 0.33), info.water_color)


if __name__ == "__main__":
    unittest.main()
