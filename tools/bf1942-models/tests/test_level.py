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
from bf42.stdmesh import Lod, Material, StandardMesh  # noqa: E402
from bf42.terrain import (  # noqa: E402
    apply_detail,
    default_patches,
    depth_map,
    patch_mesh,
    sky_primitives,
    tile_mesh,
    water_mesh,
)


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

    def test_z_mirror_also_mirrors_each_face(self) -> None:
        """Swapping the Z faces is only half of a Z mirror.

        Leave the contents alone and neighbouring faces stop agreeing along
        their shared edges, which draws a hard line across anything that
        reflects the cube.
        """
        from extract_map import _FACE_MIRROR, _mirror_rgba

        self.assertEqual(
            {"px": "u", "nx": "u", "py": "v", "ny": "v", "pz": "u", "nz": "u"},
            _FACE_MIRROR)

        # 2x2, one distinct colour per texel, so a flip is unambiguous.
        tl, tr = bytes([1, 1, 1, 255]), bytes([2, 2, 2, 255])
        bl, br = bytes([3, 3, 3, 255]), bytes([4, 4, 4, 255])
        image = tl + tr + bl + br

        self.assertEqual(tr + tl + br + bl, _mirror_rgba(2, 2, image, "u"))
        self.assertEqual(bl + br + tl + tr, _mirror_rgba(2, 2, image, "v"))
        # Mirroring twice on the same axis is the identity.
        self.assertEqual(
            image, _mirror_rgba(2, 2, _mirror_rgba(2, 2, image, "u"), "u"))


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


class SkyAndSunTests(unittest.TestCase):
    def test_initsky_takes_the_preceding_geometry_file(self) -> None:
        # Trimmed from Tobruk's SkyAndSun.con. The commented-out cloud
        # geometry must not shadow the SkyBox file, and `** Clouds` is noise.
        info = LevelInfo(name="Tobruk", terrain=parse_terrain_con(""))
        parse_init_con(
            """
GeometryTemplate.create StandardMesh SkyBox
GeometryTemplate.file Sky_Tobruk_m1
Sky.initSky

** Clouds
REM GeometryTemplate.create StandardMesh Cloud
REM GeometryTemplate.file cloud

Sky.addCloud
Cloud.setName cloud_0
Cloud.setTexScale 8
Cloud.setSpeed -0.03 0.015
Cloud.setHeight 3500

Sky.changeOfsCloudHeight 2500
Sky.changeOfsCloudDist 333
Sky.setSun sun
sky.changeOfsSkyHeight 150
Sky.setRotAngle 180
sky.sunLightDirectionVec -0.778/0.58/-0.234
""",
            info,
        )

        self.assertEqual("Sky_Tobruk_m1", info.sky.mesh)
        self.assertEqual(180.0, info.sky.rot_angle)
        self.assertEqual(150.0, info.sky.height_offset)
        self.assertTrue(info.sky.has_cloud)
        self.assertEqual((-0.03, 0.015), info.sky.cloud_speed)
        self.assertEqual(8.0, info.sky.cloud_tex_scale)
        self.assertEqual(3500.0, info.sky.cloud_height)
        self.assertEqual(2500.0, info.sky.cloud_ofs_height)
        self.assertEqual(333.0, info.sky.cloud_dist)

    def test_geometry_file_keeps_only_the_leaf(self) -> None:
        info = LevelInfo(name="X", terrain=parse_terrain_con(""))
        parse_init_con(
            "GeometryTemplate.file bf1942\\levels\\X\\SkyCustom_m1\nSky.initSky\n",
            info,
        )

        self.assertEqual("SkyCustom_m1", info.sky.mesh)

    def test_no_initsky_means_no_sky_mesh(self) -> None:
        info = LevelInfo(name="X", terrain=parse_terrain_con(""))
        parse_init_con("GeometryTemplate.file Sky_Foo_m1\n", info)

        self.assertEqual("", info.sky.mesh)


class WaterConTests(unittest.TestCase):
    def test_tobruk_shaped_block(self) -> None:
        info = LevelInfo(name="Tobruk", terrain=parse_terrain_con(""))
        parse_init_con(
            """
water.specularEnable 1
water.texLayer1 texture/water07
water.texLayer2 texture/water08
water.normalMap texture/normalMap01
water.scrollDirectionNormalmap 1/1
water.scrollDirection1 1/0
water.scrollDirection2 0/1
water.specularColor 0.85/0.83/0.88
water.scrollLayer1 0.03
water.scrollLayer2 0.03
water.scrollNormalmap 0.01
water.specularStreakFactor 0.001
water.tileLayer1 0.5
water.tileLayer2 0.5
water.tileNormalmap 1
water.lightDirection -0.3/0.5/-0.65
water.color 0.63/0.59/0.33
water.deepcolor 0.5/0.45/0.3
water.waterShallowAlpha 0.5
water.waterAlphaDepth 1.5
""",
            info,
        )

        w = info.water
        self.assertTrue(w.declared)
        self.assertTrue(w.specular)
        self.assertEqual("texture/water07", w.tex_layer1)
        self.assertEqual("texture/normalMap01", w.normal_map)
        self.assertEqual((1.0, 0.0), w.scroll_dir1)
        self.assertEqual((1.0, 1.0), w.scroll_dir_normal)
        self.assertEqual(0.03, w.scroll1)
        self.assertEqual(0.5, w.tile1)
        self.assertEqual(1.0, w.tile_normal)
        self.assertEqual((0.63, 0.59, 0.33), w.color)
        self.assertEqual((0.5, 0.45, 0.3), w.deep_color)
        self.assertEqual((-0.3, 0.5, -0.65), w.light_direction)
        self.assertEqual(0.5, w.shallow_alpha)
        self.assertEqual(1.5, w.alpha_depth)
        # Tobruk carries the legacy field too, for older scene.json readers.
        self.assertEqual((0.63, 0.59, 0.33), info.water_color)

    def test_wake_scalar_deepcolor_is_grey(self) -> None:
        info = LevelInfo(name="Wake", terrain=parse_terrain_con(""))
        parse_init_con(
            """
water.shallowColor 0.95/1/0.85
water.deepColor 0.5
water.waterAlphaDepth 3.0
water.waterColordepth 6
water.waterShallowAlpha 0.1
""",
            info,
        )

        w = info.water
        self.assertEqual((0.95, 1.0, 0.85), w.shallow_color)
        self.assertEqual((0.5, 0.5, 0.5), w.deep_color)
        self.assertEqual(6.0, w.color_depth)
        self.assertEqual(0.1, w.shallow_alpha)

    def test_undeclared_water_reports_undeclared(self) -> None:
        info = LevelInfo(name="Berlin", terrain=parse_terrain_con(""))
        parse_init_con("water.waterShallowAlpha 0.5\n", info)

        self.assertFalse(info.water.declared)


class RenderSettingsTests(unittest.TestCase):
    def test_lighting_view_distance_and_alternative_path(self) -> None:
        info = LevelInfo(name="Tobruk", terrain=parse_terrain_con(""))
        parse_init_con(
            """
textureManager.alternativePath Texture/Africa
shadow.shadowColor 0.55
renderer.globalAmbientColor .2/.2/.2
renderer.setViewdistance 700
renderer.ambientColor .12/.1/.08
renderer.diffuseColor .55/.52/0.38
renderer.specularColor .3/.3/.3
""",
            info,
        )

        self.assertEqual("Texture/Africa", info.texture_alternative_path)
        self.assertEqual(700.0, info.view_distance)
        self.assertEqual(0.55, info.lighting.shadow_color)
        self.assertEqual((0.2, 0.2, 0.2), info.lighting.global_ambient)
        self.assertEqual((0.12, 0.1, 0.08), info.lighting.ambient_color)
        self.assertEqual((0.55, 0.52, 0.38), info.lighting.diffuse_color)


class DefaultTerrainTests(unittest.TestCase):
    def test_default_patches_are_the_uncovered_world_grid(self) -> None:
        info = parse_terrain_con(
            """
GeometryTemplate.worldSize 1024
GeometryTemplate.texOffsetX 0
GeometryTemplate.texOffsetY 0
"""
        )
        missing = default_patches(info, [(0, 0), (1, 0)])

        self.assertEqual(14, len(missing))
        self.assertNotIn((0, 0), missing)
        self.assertNotIn((1, 0), missing)
        self.assertIn((3, 3), missing)

    def test_tex_offset_moves_the_covered_cells(self) -> None:
        # Wake: texOffset 2/2, so file Tx00x00 covers world patch (2, 2).
        info = parse_terrain_con(
            """
GeometryTemplate.worldSize 1024
GeometryTemplate.texOffsetX 2
GeometryTemplate.texOffsetY 2
"""
        )
        missing = default_patches(info, [(0, 0)])

        self.assertNotIn((2, 2), missing)
        self.assertIn((0, 0), missing)

    def test_patch_mesh_uvs_wrap_the_default_texture(self) -> None:
        data = struct.pack("<64H", *([10000] * 64))
        heightmap = decode_heightmap(data, world_size=32.0, y_scale=0.6)
        primitive = patch_mesh(heightmap, 0, 0, patch=16.0, uv_repeats=4.0)

        self.assertIsNotNone(primitive)
        us = {u for u, _ in primitive.uvs}
        self.assertEqual(0.0, min(us))
        self.assertEqual(4.0, max(us))

    def test_water_bounds_override_covers_the_world(self) -> None:
        info = parse_terrain_con("GeometryTemplate.waterLevel 95\n")
        primitive = water_mesh(info, [(0, 0)], bounds=(0.0, 0.0, 2048.0, 2048.0))

        xs = {p[0] for p in primitive.positions}
        self.assertEqual({0.0, 2048.0}, xs)
        self.assertEqual({95.0}, {p[1] for p in primitive.positions})


class DepthMapTests(unittest.TestCase):
    def test_depth_normalises_to_the_deepest_sample(self) -> None:
        # yScale 0.6: sample 65535 is 153.6 m. Water at 15.36 m over a
        # sample at 0 m gives max depth 15.36; a sample at 10% height
        # (15.36 m) is exactly at the surface.
        samples = [0, 6553, 0, 6553]
        data = struct.pack("<4H", *samples)
        heightmap = decode_heightmap(data, world_size=8.0, y_scale=0.6)
        result = depth_map(heightmap, water_level=15.36)

        self.assertIsNotNone(result)
        dim, rgba, max_depth = result
        self.assertEqual(2, dim)
        self.assertAlmostEqual(15.36, max_depth, places=2)
        self.assertEqual(255, rgba[0])          # deepest sample
        self.assertLess(rgba[4], 5)             # sample at the waterline
        self.assertEqual(255, rgba[3])          # opaque alpha

    def test_dry_level_has_no_depth_map(self) -> None:
        data = struct.pack("<4H", *([30000] * 4))
        heightmap = decode_heightmap(data, world_size=8.0, y_scale=0.6)

        self.assertIsNone(depth_map(heightmap, water_level=0.0))


def _sky_quad(name: str) -> Material:
    # One +Z-facing quad at z=2000, pos(3) normal(3) uv(2) per vertex.
    verts: list[float] = []
    for x, y, u, v in ((-2000.0, -1902.0, 0.0, -1.0), (2000.0, -1902.0, 1.0, -1.0),
                       (2000.0, 2098.0, 1.0, 0.0), (-2000.0, 2098.0, 0.0, 0.0)):
        verts += [x, y, 2000.0, 0.0, 0.0, -1.0, u, v]
    return Material(
        name=name, primitive=4, flags=0, stride=32, vertex_count=4,
        index_count=6, unknown=(0, 0, 0, 0), vertices=verts,
        indices=[0, 1, 2, 0, 2, 3],
    )


class SkyPrimitiveTests(unittest.TestCase):
    def test_rot_angle_180_is_baked_into_positions(self) -> None:
        mesh = StandardMesh(
            name="sky", version=10, bounds_min=(0, 0, 0), bounds_max=(0, 0, 0),
            collision_layers=[], lods=[Lod(materials=[_sky_quad("Sky_Material2")])],
        )
        faces = sky_primitives(mesh, rot_angle=180.0)

        self.assertEqual(1, len(faces))
        name, primitive = faces[0]
        self.assertEqual("Sky_Material2", name)
        # Rotating the +Z quad 180 degrees about +Y lands it at z=-2000
        # with X mirrored; Y and the UVs are untouched.
        self.assertAlmostEqual(-2000.0, primitive.positions[0][2], places=3)
        self.assertAlmostEqual(2000.0, primitive.positions[0][0], places=3)
        self.assertAlmostEqual(-1902.0, primitive.positions[0][1], places=3)
        self.assertEqual((0.0, -1.0), primitive.uvs[0])
        self.assertIsNone(primitive.normals)

    def test_zero_rotation_is_identity(self) -> None:
        mesh = StandardMesh(
            name="sky", version=10, bounds_min=(0, 0, 0), bounds_max=(0, 0, 0),
            collision_layers=[], lods=[Lod(materials=[_sky_quad("M0")])],
        )
        _, primitive = sky_primitives(mesh, rot_angle=0.0)[0]

        self.assertAlmostEqual(2000.0, primitive.positions[0][2], places=3)
        self.assertAlmostEqual(-2000.0, primitive.positions[0][0], places=3)


class ObjectLightmapTests(unittest.TestCase):
    def test_filename_encodes_mesh_and_truncated_position(self) -> None:
        from bf42.level import object_lightmap_key, parse_object_lightmap_name

        self.assertEqual(
            ("bunker1_m1", 1969, 80, 835),
            parse_object_lightmap_name(
                "bf1942/levels/Tobruk/ObjectLightmaps/bunker1_M1_1969-80-835.tga"),
        )
        self.assertIsNone(parse_object_lightmap_name("ObjectLightmaps/Palette.pal"))
        self.assertEqual(
            ("bunker1_m1", 1969, 80, 835),
            object_lightmap_key("bunker1_M1.sm", (1969.56, 80.39, 835.095)),
        )


if __name__ == "__main__":
    unittest.main()
