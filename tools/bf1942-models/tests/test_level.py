from __future__ import annotations

import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.level import (  # noqa: E402
    decode_heightmap,
    find_level_archives,
    load_level_files,
    parse_briefing,
    parse_cubemap_rcm,
    parse_init_con,
    parse_spawn_point_groups,
    parse_spawn_point_manager,
    parse_spawn_templates,
    parse_static_objects,
    parse_terrain_con,
    parse_tickets,
    resolve_briefing,
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

    def test_geometry_scale_survives_its_second_dot(self) -> None:
        # `Object.geometry.scale` has a dotted command name, which the shared
        # single-dot regex silently dropped — 8,596 of vanilla's 18,258
        # placed statics carry one, which is why every forest rendered as
        # identical clones.
        instances = parse_static_objects(
            """
Object.create birch1_M1
Object.absolutePosition 100/10/200
Object.geometry.scale 0.932941/0.935059/0.990118
Object.create birch1_M1
Object.absolutePosition 120/10/210
"""
        )
        self.assertEqual((0.932941, 0.935059, 0.990118), instances[0].scale)
        self.assertIsNone(instances[1].scale)

    def test_geometry_color_survives_its_second_dot(self) -> None:
        instances = parse_static_objects(
            """
Object.create birch1_M1
Object.absolutePosition 100/10/200
Object.geometry.color 0.6/0.7/0.5
Object.create birch1_M1
Object.absolutePosition 120/10/210
"""
        )
        self.assertEqual((0.6, 0.7, 0.5), instances[0].color)
        self.assertIsNone(instances[1].color)

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
        # `teamOnVehicle` is a bool, not a team index: the *instance's* team
        # still picks the hull.
        self.assertEqual("Kubelwagen", spawn_vehicle("ScoutCarSpawner", 1, templates))
        self.assertEqual("Willy", spawn_vehicle("ScoutCarSpawner", 2, templates))
        self.assertIsNone(spawn_vehicle("AAGunSpawner", 2, templates))

    # Midway's own `Conquest/ObjectSpawnTemplates.con`, verbatim. Both fleets
    # share these three spawners and `ObjectSpawns.con` gives each hull its
    # own `Object.setteam` — 2 for the American fleet at x ~ 3400, 1 for the
    # Japanese at x ~ 700. Reading `teamOnVehicle 1` as an owner team forced
    # every pad to the Japanese hull, so the US fleet sailed as shokaku,
    # hatsuzuki and hatsuzuki2.
    MIDWAY_FLEET = """
ObjectTemplate.create ObjectSpawner DestroyerSpawner
ObjectTemplate.setObjectTemplate 2 fletcher
ObjectTemplate.setObjectTemplate 1 hatsuzuki
ObjectTemplate.SpawnDelay 200
ObjectTemplate.SpawnDelayAtStart 0
ObjectTemplate.TimeToLive 120
ObjectTemplate.Distance 200
ObjectTemplate.teamOnVehicle 1
ObjectTemplate.create ObjectSpawner DestroyerSpawner2
ObjectTemplate.setObjectTemplate 2 fletcher2
ObjectTemplate.setObjectTemplate 1 hatsuzuki2
ObjectTemplate.SpawnDelay 200
ObjectTemplate.SpawnDelayAtStart 0
ObjectTemplate.TimeToLive 120
ObjectTemplate.Distance 200
ObjectTemplate.teamOnVehicle 1
ObjectTemplate.create ObjectSpawner carrierSpawner
ObjectTemplate.setObjectTemplate 2 enterprise
ObjectTemplate.setObjectTemplate 1 shokaku
ObjectTemplate.SpawnDelay 300
ObjectTemplate.SpawnDelayAtStart 0
ObjectTemplate.TimeToLive 120
ObjectTemplate.Distance 200
ObjectTemplate.teamOnVehicle 1
"""

    def test_midways_allied_fleet_is_american(self) -> None:
        templates = parse_spawn_templates(self.MIDWAY_FLEET)
        self.assertEqual("fletcher", spawn_vehicle("DestroyerSpawner", 2, templates))
        self.assertEqual("fletcher2", spawn_vehicle("DestroyerSpawner2", 2, templates))
        self.assertEqual("enterprise", spawn_vehicle("carrierSpawner", 2, templates))

    def test_midways_axis_fleet_is_still_japanese(self) -> None:
        templates = parse_spawn_templates(self.MIDWAY_FLEET)
        self.assertEqual("hatsuzuki", spawn_vehicle("DestroyerSpawner", 1, templates))
        self.assertEqual("hatsuzuki2", spawn_vehicle("DestroyerSpawner2", 1, templates))
        self.assertEqual("shokaku", spawn_vehicle("carrierSpawner", 1, templates))

    def test_team_on_vehicle_is_a_bool(self) -> None:
        # `ObjectSpawnerTemplate + 0x185` is a `char` the engine registers as
        # a `bool` property, and `makeScript` (0x08314f70) round-trips it as
        # the literal line `ObjectTemplate.teamOnVehicle 1` with no value
        # appended. EoD writes `0` on 9,274 spawners, which is not a team at
        # all; XPack2 writes `2`.
        templates = parse_spawn_templates(
            """
ObjectTemplate.create ObjectSpawner OffSpawner
ObjectTemplate.setObjectTemplate 2 fletcher
ObjectTemplate.setObjectTemplate 1 hatsuzuki
ObjectTemplate.teamOnVehicle 0
ObjectTemplate.create ObjectSpawner OnSpawner
ObjectTemplate.setObjectTemplate 2 fletcher
ObjectTemplate.setObjectTemplate 1 hatsuzuki
ObjectTemplate.teamOnVehicle 1
ObjectTemplate.create ObjectSpawner TwoSpawner
ObjectTemplate.setObjectTemplate 2 fletcher
ObjectTemplate.setObjectTemplate 1 hatsuzuki
ObjectTemplate.teamOnVehicle 2
ObjectTemplate.create ObjectSpawner SilentSpawner
ObjectTemplate.setObjectTemplate 2 fletcher
"""
        )
        self.assertFalse(templates["offspawner"].team_on_vehicle)
        self.assertTrue(templates["onspawner"].team_on_vehicle)
        self.assertTrue(templates["twospawner"].team_on_vehicle)
        self.assertFalse(templates["silentspawner"].team_on_vehicle)
        # Whatever the flag says, the hull follows the instance's team.
        for name in ("OffSpawner", "OnSpawner", "TwoSpawner"):
            self.assertEqual("fletcher", spawn_vehicle(name, 2, templates))
            self.assertEqual("hatsuzuki", spawn_vehicle(name, 1, templates))

    def test_respawn_window_from_min_max_and_single_delay(self) -> None:
        templates = parse_spawn_templates(
            """
ObjectTemplate.create ObjectSpawner HeavyTankSpawner
ObjectTemplate.setObjectTemplate 2 sherman
ObjectTemplate.MinSpawnDelay 70
ObjectTemplate.MaxSpawnDelay 110
ObjectTemplate.create ObjectSpawner MachinegunSpawner
ObjectTemplate.setObjectTemplate 2 Stationary_browning
ObjectTemplate.SpawnDelay 60
"""
        )
        self.assertEqual((70.0, 110.0),
                         templates["heavytankspawner"].respawn_window())
        self.assertEqual((60.0, 60.0),
                         templates["machinegunspawner"].respawn_window())


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
renderer.fogStart 150
renderer.fogEnd 300
sky.sunLightDirectionVec -0.778/0.58/-0.234
game.setActiveCombatArea 1024 0 2048 2048
game.setBeforeSpawnCameraPosition 1 1983.37/69.94/688.15
water.color 0.63/0.59/0.33
""",
            info,
        )

        self.assertEqual((0.8, 0.718, 0.531), info.fog_color)
        self.assertEqual(150.0, info.fog_start)
        self.assertEqual(300.0, info.fog_end)
        self.assertEqual((1024.0, 0.0, 2048.0, 2048.0),
                         (info.combat.min_x, info.combat.min_z, info.combat.size_x, info.combat.size_z))
        self.assertEqual((1983.37, 69.94, 688.15), info.camera)
        self.assertEqual((0.63, 0.59, 0.33), info.water_color)

    def test_dead_fog_spellings_are_ignored(self) -> None:
        # fogLinear* and setFogColorVec ship in Init.con but are not registered
        # in BF1942.exe — honouring them fogged Tobruk to authored-dead 150/300
        # and Midway to a colour the engine never applies.
        info = LevelInfo(name="Tobruk", terrain=parse_terrain_con(""))
        parse_init_con(
            """
renderer.fogColorVec 0.8/0.718/0.531
renderer.fogLinearStart 150
renderer.fogLinearEnd 300
renderer.setFogColorVec 0.1/0.2/0.3
Game.setViewDistance 300
""",
            info,
        )
        self.assertEqual((0.8, 0.718, 0.531), info.fog_color)
        self.assertIsNone(info.fog_start)
        self.assertIsNone(info.fog_end)

        midway = LevelInfo(name="Midway", terrain=parse_terrain_con(""))
        parse_init_con(
            "renderer.setFogColorVec 0.812/0.832/0.921\nGame.setViewDistance 500\n",
            midway,
        )
        self.assertEqual((0.7, 0.7, 0.7), midway.fog_color)

    def test_live_fogstart_beats_dead_foglinear(self) -> None:
        # Kharkov writes both; only fogstart/fogend reach Setup.
        info = LevelInfo(name="Kharkov", terrain=parse_terrain_con(""))
        parse_init_con(
            """
renderer.fogLinearStart 120
renderer.fogLinearEnd 200
renderer.fogColorVec 0.75/0.738/0.726
Game.setViewDistance 400
renderer.fogstart -40
renderer.fogend 400
""",
            info,
        )
        self.assertEqual(-40.0, info.fog_start)
        self.assertEqual(400.0, info.fog_end)


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
        # The REM'd-out cloud geometry must not register: without an active
        # cloud template the engine draws no cloud layer (vanilla ships no
        # cloud mesh at all), so cloud_mesh stays None and no clouds are
        # emitted for this level.
        self.assertIsNone(info.sky.cloud_mesh)
        self.assertEqual((-0.03, 0.015), info.sky.cloud_speed)
        self.assertEqual(8.0, info.sky.cloud_tex_scale)
        self.assertEqual(3500.0, info.sky.cloud_height)
        self.assertEqual(2500.0, info.sky.cloud_ofs_height)
        self.assertEqual(333.0, info.sky.cloud_dist)

    def test_active_cloud_geometry_registers_cloud_mesh(self) -> None:
        # The mod pattern (bf1918, FHSW, GCMOD, ...): an ACTIVE cloud template
        # plus a shipped mesh is what actually makes the engine draw clouds.
        info = LevelInfo(name="Battle_of_Cer", terrain=parse_terrain_con(""))
        parse_init_con(
            """
GeometryTemplate.create StandardMesh SkyBox
GeometryTemplate.file Sky_Cer_m1
Sky.initSky

GeometryTemplate.create StandardMesh Cloud
GeometryTemplate.file ../bf1942/levels/Battle_of_Cer/standardMesh/cloud

Sky.addCloud
Cloud.setTexScale 8
""",
            info,
        )

        self.assertEqual("Sky_Cer_m1", info.sky.mesh)
        self.assertTrue(info.sky.has_cloud)
        self.assertEqual("cloud", info.sky.cloud_mesh)

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

    def test_undeclared_fog_range_stays_none(self) -> None:
        # 18 of 23 vanilla levels declare only fogColorVec; the range must
        # stay None so the exporter can derive it from Game.setViewDistance
        # instead of inventing one.
        info = LevelInfo(name="Berlin", terrain=parse_terrain_con(""))
        parse_init_con(
            "renderer.fogColorVec 0.68/0.62/0.55\nGame.setViewDistance 100\n",
            info,
        )

        self.assertIsNone(info.fog_start)
        self.assertIsNone(info.fog_end)
        self.assertEqual(100.0, info.game_view_distance)


class TerrainDirectiveTests(unittest.TestCase):
    """Gap 10 of level-content.md: what Terrain.con's LOD/wave words mean.

    `targetTriCount` is read by the client (two call sites next to the
    PatchTerrain/RoamTerrain init) and is recorded as metadata.
    `lodDistance` has no string in BF1942.exe at all — dead in retail —
    and must stay unparsed. `waveHeight` is a live PatchTerrain property
    feeding the water surface (Gap 17); `waveScale` is dead.
    """

    def test_target_tri_count_is_read(self) -> None:
        info = parse_terrain_con(
            "GeometryTemplate.worldSize 2048\n"
            "GeometryTemplate.targetTriCount 5000\n"
        )
        self.assertEqual(5000, info.target_tri_count)

    def test_target_tri_count_4000_on_the_small_worlds(self) -> None:
        info = parse_terrain_con("GeometryTemplate.targetTriCount 4000\n")
        self.assertEqual(4000, info.target_tri_count)

    def test_undeclared_target_tri_count_stays_none(self) -> None:
        info = parse_terrain_con("GeometryTemplate.worldSize 2048\n")
        self.assertIsNone(info.target_tri_count)

    def test_lod_distance_is_dead_and_not_read(self) -> None:
        # 22 levels author it; the retail client never reads it. Recording it
        # would imply a viewer behaviour the engine never had.
        info = parse_terrain_con(
            "GeometryTemplate.worldSize 2048\n"
            "GeometryTemplate.lodDistance 350\n"
            "GeometryTemplate.targetTriCount 5000\n"
        )
        self.assertEqual(5000, info.target_tri_count)
        self.assertFalse(any("lod" in field for field in vars(info)))

    def test_wave_height_is_read(self) -> None:
        info = parse_terrain_con(
            "GeometryTemplate.worldSize 2048\n"
            "GeometryTemplate.waveHeight 0.1\n"
        )
        self.assertEqual(0.1, info.wave_height)

    def test_zero_wave_height_is_recorded_as_zero(self) -> None:
        # Nine levels write waveHeight 0.0 explicitly; None would blur
        # "declared zero" into "never declared".
        info = parse_terrain_con("GeometryTemplate.waveHeight 0.0\n")
        self.assertEqual(0.0, info.wave_height)

    def test_undeclared_wave_height_stays_none(self) -> None:
        info = parse_terrain_con("GeometryTemplate.worldSize 2048\n")
        self.assertIsNone(info.wave_height)

    def test_wave_scale_is_dead_and_not_read(self) -> None:
        # El Alamein is the only level that ships it, and its paired
        # waveHeight is 0 anyway; the string is absent from both binaries.
        info = parse_terrain_con(
            "GeometryTemplate.waveHeight 0\n"
            "GeometryTemplate.waveScale 0.01\n"
        )
        self.assertEqual(0.0, info.wave_height)
        self.assertFalse(hasattr(info, "wave_scale"))

    def test_basetex_and_guadalcanals_bump_words_are_not_read(self) -> None:
        # `Water.baseTex` (32 levels), `bumpTex`/`bumpTile`/
        # `specularBumpMapFactor`/`envIntensity` (GuadalCanal): none of the
        # strings exists in either binary. Terrain.con's `Water.*` lines are
        # not dispatched to _parse_water at all, and none of these verbs may
        # sneak in under the geometrytemplate namespace either.
        info = LevelInfo(name="GuadalCanal", terrain=parse_terrain_con(
            "Water.baseTex texture/Water\n"
            "Water.bumpTex texture/normalMap\n"
            "Water.envIntensity 0.6\n"
        ))
        parse_init_con(
            "Water.baseTex texture/Water\n"
            "Water.bumpTex texture/normalMap\n"
            "Water.envIntensity 0.6\n",
            info,
        )
        self.assertEqual("", info.water.tex_layer1)
        self.assertIsNone(info.water.envmap_color)


class WaterEnvmapColorTests(unittest.TestCase):
    """Gap 17: `water.envmapColor`, live in the client's property table."""

    def test_envmapcolor_is_a_registered_field(self) -> None:
        info = LevelInfo(name="Battle_of_Britain", terrain=parse_terrain_con(""))
        parse_init_con("water.envmapcolor 0.70/0.80/0.70\n", info)
        self.assertEqual((0.7, 0.8, 0.7), info.water.envmap_color)

    def test_raids_warm_desert_tint(self) -> None:
        info = LevelInfo(name="Raid_on_Agheila", terrain=parse_terrain_con(""))
        parse_init_con("water.envmapcolor 0.5/0.4/0.3\n", info)
        self.assertEqual((0.5, 0.4, 0.3), info.water.envmap_color)

    def test_telemarks_lowercase_spelling_parses_the_same(self) -> None:
        # Telemark writes `0.7/0.8/0.7` lower-case; commands are already
        # case-insensitive, so it lands on the same field.
        info = LevelInfo(name="Telemark", terrain=parse_terrain_con(""))
        parse_init_con("water.envmapcolor 0.7/0.8/0.7\n", info)
        self.assertEqual((0.7, 0.8, 0.7), info.water.envmap_color)

    def test_undeclared_envmapcolor_is_none(self) -> None:
        info = LevelInfo(name="Wake", terrain=parse_terrain_con(""))
        parse_init_con("water.waterShallowAlpha 0.1\n", info)
        self.assertIsNone(info.water.envmap_color)

    def test_el_alameins_typo_is_not_rescued(self) -> None:
        # `water.wateShallowAlpha 0.5` — the engine's property table has no
        # such string, so retail renders El Alamein's shoreline with the
        # built-in default shallow alpha. Honoring the misspelled value would
        # make the viewer more correct than the shipped game.
        info = LevelInfo(name="El_Alamein", terrain=parse_terrain_con(""))
        parse_init_con("water.wateShallowAlpha 0.5\n", info)
        self.assertIsNone(info.water.envmap_color)
        self.assertEqual(1.0, info.water.shallow_alpha)   # the ctor default


class RenderSettingsTests(unittest.TestCase):
    def test_lighting_view_distance_and_alternative_path(self) -> None:
        info = LevelInfo(name="Tobruk", terrain=parse_terrain_con(""))
        parse_init_con(
            """
textureManager.alternativePath Texture/Africa
shadow.shadowColor 0.55
renderer.globalAmbientColor .2/.2/.2
renderer.setViewdistance 700
Game.setViewDistance 300
renderer.ambientColor .12/.1/.08
renderer.diffuseColor .55/.52/0.38
renderer.specularColor .3/.3/.3
""",
            info,
        )

        self.assertEqual("Texture/Africa", info.texture_alternative_path)
        self.assertEqual(700.0, info.view_distance)
        # Game.setViewDistance is the engine's real draw distance; the stray
        # renderer.setViewdistance (Tobruk only) is kept separately.
        self.assertEqual(300.0, info.game_view_distance)
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

    def test_tile_v_runs_south_to_north_down_the_image(self) -> None:
        """DDS row 0 is a tile's south edge.

        V mirrored puts every tile's texture north-south backwards: baked road
        and shadow art lands mirrored inside its own 256 m tile and every row
        boundary becomes a hard seam. The correct orientation was established
        by stitching the raw Tobruk tiles into mosaics both ways and checking
        which is continuous across rows (and matches InGameMap.dds).
        """
        data = struct.pack("<64H", *([10000] * 64))
        heightmap = decode_heightmap(data, world_size=32.0, y_scale=0.6)
        info = parse_terrain_con(
            "GeometryTemplate.worldSize 32\nGeometryTemplate.yScale 0.6\n"
            "GeometryTemplate.texOffsetX 0\nGeometryTemplate.texOffsetY 0\n")
        primitive = tile_mesh(heightmap, info, 0, 0, patch=16.0)

        south = [uv for p, uv in zip(primitive.positions, primitive.uvs)
                 if p[2] == 0.0]
        north = [uv for p, uv in zip(primitive.positions, primitive.uvs)
                 if p[2] == 16.0]
        # glTF V: 0 is the top of the image. South edge samples the top row.
        self.assertTrue(all(v == 0.0 for _, v in south))
        self.assertTrue(all(v == 1.0 for _, v in north))

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


    def test_combat_area_scopes_dry_fill_to_three_levels(self) -> None:
        """Gap 12 of level-content.md, the counting rule.

        The 84 patches in the audit are DRY fill patches outside the combat
        area: 30 on Battle of the Bulge, 28 on Liberation of Caen, 26 on
        Tobruk. `default_patches` alone is world-grid bookkeeping (Tobruk's
        208 unpainted patches are mostly wet and count differently), so this
        test pins the audit numbers the way the audit counts: on the 256 m
        patch grid, a patch is dry when its MAXIMUM heightmap sample exceeds
        `waterLevel + 0.5 m` (level-content.md, "Ground truth"), with the
        shipped combat rect subtracted.
        """
        cases = {
            "Battle_of_the_Bulge": 30,
            "Liberation_of_Caen": 28,
            "Tobruk": 26,
        }
        for level, expected in cases.items():
            with self.subTest(level=level):
                game_dir = Path.home() / "bf1942-game"
                if not (game_dir / "Mods" / "bf1942").is_dir():
                    self.skipTest("no BF1942 install")
                files = load_level_files(
                    find_level_archives(game_dir, "bf1942", level), level)
                info = LevelInfo(
                    name=level,
                    terrain=parse_terrain_con(
                        files.read("Init/Terrain.con").decode("latin-1")))
                parse_init_con(files.read("Init.con").decode("latin-1"), info)
                heightmap = decode_heightmap(
                    files.read("Heightmap.raw"), info.terrain.world_size,
                    info.terrain.y_scale)
                fill = default_patches(info.terrain,
                                       [(c, r) for c, r, _ in files.tiles()])
                combat = info.combat
                self.assertIsNotNone(combat, f"{level} must ship a combat area")
                assert combat is not None
                ps = 256.0  # PATCH_METERS: the audit's uniform 256 m patch grid
                dry_outside = []
                for col, row in fill:
                    mesh = patch_mesh(heightmap, col, row, ps)
                    if mesh is None:
                        continue
                    # Dry = the patch's MAX sample clears water + 0.5 m
                    # (level-content.md "Ground truth"); a min-sample test
                    # also counts patches that merely dip below the plane.
                    if max(p[1] for p in mesh.positions) <= info.terrain.water_level + 0.5:
                        continue                       # wet: sea floor, not Gap 12
                    if (col * ps < combat.max_x and (col + 1) * ps > combat.min_x
                            and row * ps < combat.max_z
                            and (row + 1) * ps > combat.min_z):
                        continue                       # inside the combat rect
                    dry_outside.append((col, row))
                self.assertEqual(expected, len(dry_outside))


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
        name=name, primitive=4, flags=0x411, stride=32, vertex_count=4,
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


class LevelArchiveLookupTests(unittest.TestCase):
    """`Archives/bf1942/levels/` in *every* mod, plus the parent underlay."""

    def _install(self, root: Path, mod: str, archives: str,
                 levels: list[str]) -> None:
        directory = root / "Mods" / mod / archives / "bf1942" / "levels"
        directory.mkdir(parents=True, exist_ok=True)
        for name in levels:
            (directory / name).write_bytes(b"")

    def test_mod_levels_live_under_bf1942_not_under_the_mod_name(self) -> None:
        # EoD's levels are in `EoD/archives/bf1942/levels/`: a level archive's
        # internal paths start `bf1942/`, and Refractor mounts an archive at its
        # own prefix. Searching `EoD/archives/EoD/` finds nothing.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._install(root, "EoD", "archives", ["Hamburger_Hill.rfa"])

            found = find_level_archives(root, "EoD", "Hamburger_Hill")

            self.assertEqual(["Hamburger_Hill.rfa"], [p.name for p in found])

    def test_parent_archives_underlay_the_mod_ones(self) -> None:
        # A mod map that only overrides some files resolves the rest from the
        # parent's copy. LevelFiles lets later archives win, so the parent's
        # must come first.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._install(root, "EoD", "archives", ["Tobruk.rfa"])
            self._install(root, "bf1942", "Archives",
                          ["Tobruk.rfa", "Tobruk_003.rfa"])
            chain = [root / "Mods" / "EoD", root / "Mods" / "bf1942"]

            found = find_level_archives(root, "EoD", "Tobruk", chain=chain)

            self.assertEqual(
                [("bf1942", "Tobruk.rfa"),
                 ("bf1942", "Tobruk_003.rfa"),
                 ("EoD", "Tobruk.rfa")],
                [(p.parents[3].name, p.name) for p in found],
            )

    def test_without_a_chain_only_the_named_mod_is_searched(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._install(root, "EoD", "archives", [])
            self._install(root, "bf1942", "Archives", ["Tobruk.rfa"])

            self.assertEqual([], find_level_archives(root, "EoD", "Tobruk"))


class TicketParsingTests(unittest.TestCase):
    def test_conquest_tickets_are_read_from_both_teams(self) -> None:
        info = parse_tickets("""
Game.setNumberOfTickets 1 200
Game.setNumberOfTickets 2 150
""")

        self.assertEqual(200, info.team1)
        self.assertEqual(150, info.team2)

    def test_ticket_loss_per_minute_is_read(self) -> None:
        info = parse_tickets("""
Game.setNumberOfTickets 1 250
Game.setNumberOfTickets 2 250
Game.setTicketLostPerMin 1 2
Game.setTicketLostPerMin 2 3
""")

        self.assertEqual(250, info.team1)
        self.assertEqual(250, info.team2)
        self.assertEqual(2, info.loss_per_min_team1)
        self.assertEqual(3, info.loss_per_min_team2)

    def test_decimal_tickets_are_cast_to_int(self) -> None:
        # The dossier script handles float() first, so match that.
        info = parse_tickets("""
Game.setNumberOfTickets 1 200.5
Game.setNumberOfTickets 2 150.8
""")

        self.assertEqual(200, info.team1)
        self.assertEqual(150, info.team2)

    def test_missing_tickets_leave_fields_none(self) -> None:
        info = parse_tickets("""
Game.setNumberOfTickets 1 100
""")

        self.assertEqual(100, info.team1)
        self.assertIsNone(info.team2)
        self.assertIsNone(info.loss_per_min_team1)
        self.assertIsNone(info.loss_per_min_team2)

    def test_empty_file_yields_all_none(self) -> None:
        info = parse_tickets("")

        self.assertIsNone(info.team1)
        self.assertIsNone(info.team2)
        self.assertIsNone(info.loss_per_min_team1)
        self.assertIsNone(info.loss_per_min_team2)

    def test_case_insensitive_command_matching(self) -> None:
        # The engine and con_mod both treat commands case-insensitively.
        info = parse_tickets("""
game.SETNUMBEROFTICKETS 1 300
GAME.setTicketLostPerMin 1 5
""")

        self.assertEqual(300, info.team1)
        self.assertEqual(5, info.loss_per_min_team1)

    def test_comments_are_ignored(self) -> None:
        info = parse_tickets("""
rem Game.setNumberOfTickets 1 999
Game.setNumberOfTickets 1 100
rem This is a comment
Game.setNumberOfTickets 2 80
""")

        self.assertEqual(100, info.team1)
        self.assertEqual(80, info.team2)

    def test_malformed_values_are_skipped_softly(self) -> None:
        info = parse_tickets("""
Game.setNumberOfTickets 1 not_a_number
Game.setNumberOfTickets 2 200
Game.setTicketLostPerMin 1 invalid
Game.setTicketLostPerMin 2 4
""")

        self.assertIsNone(info.team1)
        self.assertEqual(200, info.team2)
        self.assertIsNone(info.loss_per_min_team1)
        self.assertEqual(4, info.loss_per_min_team2)


class LensFlareParsingTests(unittest.TestCase):
    """`ObjectTemplate.create LensFlare` and the ~16 verbs under it.

    Shapes come from the survey over every installed mod
    (`survey_flare.py`): 319 levels in 11 mods declare flares, 21 of the 23
    vanilla ones among them, with one uniform vocabulary. Wake's own block is
    the fixture -- five flares, two coronas -- because it is the exact text
    the extractor has to read.
    """

    WAKE = """
ObjectTemplate.create LensFlare TSun
ObjectTemplate.setLensFlareCount 5
ObjectTemplate.setBackFlareCount 0
ObjectTemplate.setCoronaCount 2
ObjectTemplate.initLensFlares
ObjectTemplate.setVisibilityAngleDeg 360

REM *** Falre no:1 ***
ObjectTemplate.setFlareSrcBlend BMSourceAlpha 0
ObjectTemplate.setFlareDestBlend BMOne 0
ObjectTemplate.setFlareTexture ring5.tga 0
ObjectTemplate.setFlareSize 3 0
ObjectTemplate.setFlareScale -1.5 0
ObjectTemplate.setFlareRot 0 0
ObjectTemplate.setFlareColor 255/255/255/50 0
ObjectTemplate.setFlareDistFadeScale 1 0

REM *** Falre no:2 > LittleDot***
ObjectTemplate.setFlareTexture ring3.tga 1
ObjectTemplate.setFlareSize 0.5 1
ObjectTemplate.setFlareColor 255/255/255/200 1

REM *** Corona no:1 - Red aura***
ObjectTemplate.setCoronaTexture sunflare9.tga 1
ObjectTemplate.setCoronaSize 5 1
ObjectTemplate.setCoronaScale 5 1
ObjectTemplate.setCoronaColor 255/150/0/100 1

Object.create TSun
Object.isSaveable 0
Object.name sun
ObjectTemplate.setflarefadeall 0.1
ObjectTemplate.setcoronafadeall 0.3

Sky.setSun sun
"""

    def parse(self, text: str) -> LevelInfo:
        info = LevelInfo(name="Test", terrain=parse_terrain_con(""))
        parse_init_con(text, info)
        return info

    def test_the_template_its_counts_and_its_object_are_read(self) -> None:
        info = self.parse(self.WAKE)
        self.assertEqual("sun", info.sun_object)
        self.assertEqual({"sun": "TSun"}, info.flare_objects)
        flare = info.lens_flares["TSun"]
        self.assertEqual(5, flare.flare_count)
        self.assertEqual(0, flare.back_flare_count)
        self.assertEqual(2, flare.corona_count)
        self.assertEqual(360.0, flare.visibility_angle_deg)

    def test_the_two_fade_all_verbs_are_read_whatever_their_case(self) -> None:
        # Vanilla writes them lower-case (`setflarefadeall`), FHSW and
        # bfheroes camel-case (`setFlareFadeAll`); both appear in the survey.
        info = self.parse(self.WAKE)
        flare = info.lens_flares["TSun"]
        self.assertAlmostEqual(0.1, flare.flare_fade_all)
        self.assertAlmostEqual(0.3, flare.corona_fade_all)
        camel = self.parse(self.WAKE.replace("setflarefadeall", "setFlareFadeAll")
                           .replace("setcoronafadeall", "setCoronaFadeAll"))
        self.assertAlmostEqual(0.1, camel.lens_flares["TSun"].flare_fade_all)
        self.assertAlmostEqual(0.3, camel.lens_flares["TSun"].corona_fade_all)

    def test_the_trailing_index_addresses_the_sprite(self) -> None:
        info = self.parse(self.WAKE)
        flares = info.lens_flares["TSun"].ordered("flare")
        self.assertEqual(2, len(flares))
        self.assertEqual("ring5.tga", flares[0].texture)
        self.assertEqual("ring3.tga", flares[1].texture)
        self.assertEqual(3.0, flares[0].size)
        self.assertEqual(0.5, flares[1].size)
        self.assertEqual(-1.5, flares[0].scale)

    def test_colours_are_rgba_out_of_255(self) -> None:
        info = self.parse(self.WAKE)
        flares = info.lens_flares["TSun"].ordered("flare")
        r, g, b, a = flares[0].color
        self.assertEqual((1.0, 1.0, 1.0), (r, g, b))
        self.assertAlmostEqual(50 / 255, a)
        # The alpha is genuinely load-bearing: vanilla's five sun flares run
        # 50, 200, 155, 50 and 100, which is most of what shapes the effect.
        self.assertAlmostEqual(200 / 255, flares[1].color[3])

    def test_coronas_are_a_separate_indexed_list(self) -> None:
        info = self.parse(self.WAKE)
        coronas = info.lens_flares["TSun"].ordered("corona")
        self.assertEqual(1, len(coronas))
        self.assertEqual("sunflare9.tga", coronas[0].texture)
        self.assertEqual(5.0, coronas[0].size)
        self.assertAlmostEqual(150 / 255, coronas[0].color[1])

    def test_blend_words_are_kept_verbatim(self) -> None:
        info = self.parse(self.WAKE)
        flare = info.lens_flares["TSun"].ordered("flare")[0]
        self.assertEqual("BMSourceAlpha", flare.src_blend)
        self.assertEqual("BMOne", flare.dest_blend)
        self.assertEqual(1.0, flare.dist_fade_scale)

    def test_a_lower_case_object_template_prefix_still_parses(self) -> None:
        # `objectTemplate.setFlareColor2` and friends appear in bf1918 and
        # FHSW; the con reader lower-cases the namespace, so this is really a
        # check that nothing downstream re-introduces case sensitivity.
        info = self.parse(self.WAKE.replace("ObjectTemplate.setFlareSize 3 0",
                                            "objectTemplate.setFlareSize 3 0"))
        self.assertEqual(3.0, info.lens_flares["TSun"].ordered("flare")[0].size)

    def test_the_rare_second_endpoint_verbs_are_read(self) -> None:
        # `setFlareSize2` / `setFlareColor2` / `setCoronaSize2` /
        # `setCoronaColor2` / `setFlareFadeAngleFactor` appear only in FHSW's
        # `On_the_moon-1969` car headlights and in bfheroes, but the client
        # registers them, so they are read rather than silently dropped.
        info = self.parse("""
ObjectTemplate.create LensFlare FX_CarFlare1
ObjectTemplate.setFlareTexture glow.tga 0
ObjectTemplate.setFlareSize 0.1 0
ObjectTemplate.setFlareSize2 0.010 0
ObjectTemplate.setFlareColor 200/180/50/255 0
objectTemplate.setFlareColor2 200/180/50/0 0
ObjectTemplate.setFlareFadeAngleFactor 0.7 0
ObjectTemplate.setCoronaSize2 0.02 0
ObjectTemplate.setCoronaColor2 255/0/0/80 0
""")
        flare = info.lens_flares["FX_CarFlare1"].ordered("flare")[0]
        self.assertEqual(0.01, flare.size2)
        self.assertEqual(0.0, flare.color2[3])
        self.assertEqual(0.7, flare.fade_angle_factor)
        corona = info.lens_flares["FX_CarFlare1"].ordered("corona")[0]
        self.assertEqual(0.02, corona.size2)
        self.assertAlmostEqual(80 / 255, corona.color2[3])

    def test_a_second_template_does_not_absorb_the_firsts_verbs(self) -> None:
        # FHSW declares several LensFlare templates in one file. A `create`
        # of any kind closes the block, so a `GeometryTemplate` between two
        # of them cannot leak either.
        info = self.parse("""
ObjectTemplate.create LensFlare A
ObjectTemplate.setFlareTexture a.tga 0
ObjectTemplate.create LensFlare B
ObjectTemplate.setFlareTexture b.tga 0
""")
        self.assertEqual("a.tga", info.lens_flares["A"].ordered("flare")[0].texture)
        self.assertEqual("b.tga", info.lens_flares["B"].ordered("flare")[0].texture)

    def test_verbs_outside_a_lens_flare_block_are_ignored(self) -> None:
        info = self.parse("""
ObjectTemplate.create SimpleObject NotAFlare
ObjectTemplate.setFlareTexture stray.tga 0
""")
        self.assertEqual({}, info.lens_flares)

    def test_a_level_with_no_flare_block_reads_clean(self) -> None:
        info = self.parse("Sky.initSky\n")
        self.assertEqual({}, info.lens_flares)
        self.assertEqual("", info.sun_object)

    def test_a_malformed_value_is_skipped_rather_than_raising(self) -> None:
        info = self.parse("""
ObjectTemplate.create LensFlare T
ObjectTemplate.setFlareSize wide 0
ObjectTemplate.setFlareColor 255/255 0
ObjectTemplate.setFlareTexture ok.tga 0
""")
        flare = info.lens_flares["T"].ordered("flare")[0]
        self.assertIsNone(flare.size)
        self.assertIsNone(flare.color)
        self.assertEqual("ok.tga", flare.texture)

    def test_a_verb_with_no_index_addresses_sprite_zero(self) -> None:
        info = self.parse("""
ObjectTemplate.create LensFlare T
ObjectTemplate.setFlareTexture only.tga
""")
        self.assertEqual("only.tga", info.lens_flares["T"].ordered("flare")[0].texture)


if __name__ == "__main__":
    unittest.main()


class SpawnPointManagerTests(unittest.TestCase):
    """`spawnPointManagerSettings.con`, whole — sides AND the audience filter.

    Battle of Britain is the level that made this matter twice over. Its four
    radar towers each get TWO spawn groups: an `OnlyForHuman 1` group of five
    points spread around the building, and an `OnlyForAI 1` group of one point
    at the building's own origin, which is indoors. A player handed that point
    spawns inside the model. The words were never read — the old parser closed
    a group block on `groupTeam`, which is the line immediately before
    `OnlyForAI` in every vanilla file, so it could not have seen it.
    """

    # The Conquest layer's own file, trimmed to the shape that matters.
    BOB = """
spawnPointManager.group 1
spawnPointManager.groupTeam 1
spawnPointManager.groupEnableToChangeTeam 0
spawnPointManager.groupIcon test1.tga

spawnPointManager.group 64
spawnPointManager.groupTeam 2
spawnPointManager.groupEnableToChangeTeam 0
spawnPointManager.groupIcon test2.tga
spawnPointManager.OnlyForAI 1

spawnPointManager.group 74
spawnPointManager.groupTeam 2
spawnPointManager.groupEnableToChangeTeam 0
spawnPointManager.groupIcon test2.tga
spawnPointManager.OnlyForHuman 1

rem the CTF shared group: no side at all
spawnPointManager.group 20
spawnPointManager.groupTeam 0
"""

    def test_a_group_block_runs_to_the_next_group_line(self) -> None:
        groups = parse_spawn_point_groups(self.BOB)
        self.assertTrue(groups[64].only_for_ai)
        self.assertFalse(groups[64].only_for_human)
        self.assertTrue(groups[74].only_for_human)
        self.assertFalse(groups[74].only_for_ai)
        self.assertFalse(groups[1].only_for_ai)

    def test_sides_still_come_out_the_way_they_did(self) -> None:
        self.assertEqual(
            {1: 1, 64: 2, 74: 2}, parse_spawn_point_manager(self.BOB))
        # `groupTeam 0` is no side and is not recorded, but the group is still
        # known — it can carry an audience filter of its own.
        groups = parse_spawn_point_groups(self.BOB)
        self.assertIn(20, groups)
        self.assertIsNone(groups[20].team)

    def test_group_enable_to_change_team(self) -> None:
        """Battle of Britain's `groupEnableToChangeTeam 0`; on by default."""
        groups = parse_spawn_point_groups(
            "spawnPointManager.group 1\nspawnPointManager.groupTeam 1\n"
            "spawnPointManager.groupEnableToChangeTeam 0\n"
            "spawnPointManager.group 2\nspawnPointManager.groupTeam 2\n")
        self.assertFalse(groups[1].enable_to_change_team)
        self.assertTrue(groups[2].enable_to_change_team)

    def test_an_empty_file_is_an_empty_map(self) -> None:
        self.assertEqual({}, parse_spawn_point_groups(""))
        self.assertEqual({}, parse_spawn_point_manager(""))

    def test_a_word_before_any_group_line_is_ignored(self) -> None:
        self.assertEqual(
            {}, parse_spawn_point_groups("spawnPointManager.OnlyForAI 1"))


class BriefingTests(unittest.TestCase):
    """`Menu/Init.con`'s multiplayer trio — the loading screen's text.

    Shapes are the two the 23 vanilla levels actually ship: a bare
    `lexiconAll.dat` key (21 of 23, e.g. Wake) and a quoted literal sentence
    (Kasserine_Pass, Truk). Both carry a bare `mapType` key either way, which
    is why the quoting decides key-versus-literal and `game.setLocalized`
    does not.
    """

    WAKE = """
Game.setLocalized 1

rem ** Allied Briefing **
game.setAlliedCampaign BRIEFING_ALLIED_CAMPAIGN_WAKE
game.setAlliedObjectives BRIEFING_ALLIED_OBJECTIVES_WAKE

rem ** Multiplayer Briefing **
game.setMultiplayerBriefingObjectives MULTIPLAYER_BRIEFING_WAKE
game.setMultiplayerBriefingMapType MULTIPLAYER_MAP_TYPE_ASSAULT_MAP

game.setLoadPicture Load/Pacific.tga
game.setMapId "BF1942"
"""

    KASSERINE = """Game.setLocalized 0
rem ----- Multiplayer Briefing -----
game.setMultiplayerBriefingObjectives "The 21st and 10th Panzer Divisions attacked into the US held Kasserine Pass from 20-23 February 1943."
game.setMultiplayerBriefingMapType MULTIPLAYER_MAP_TYPE_HEADON_MAP
game.setMapId "bf1942"
"""

    def test_a_lexicon_key_level_resolves_through_the_chain_lexicon(self) -> None:
        info = parse_briefing(self.WAKE)
        self.assertEqual("MULTIPLAYER_BRIEFING_WAKE", info.objectives)
        self.assertEqual("MULTIPLAYER_MAP_TYPE_ASSAULT_MAP", info.map_type)
        self.assertEqual("BF1942", info.map_id)

        resolved = resolve_briefing(info, {
            "MULTIPLAYER_BRIEFING_WAKE":
                "This is a Conquest: Assault map.  Your team will win if you "
                "cause your opponent's tickets to reach zero.",
            "MULTIPLAYER_MAP_TYPE_ASSAULT_MAP": "ASSAULT MAP",
        })
        self.assertIsNotNone(resolved.objectives)
        self.assertTrue(resolved.objectives.startswith("This is a Conquest"))
        self.assertEqual("ASSAULT MAP", resolved.map_type)
        self.assertEqual("BF1942", resolved.map_id)

    def test_an_inline_text_level_keeps_its_sentence(self) -> None:
        # Kasserine_Pass and Truk quote the objectives straight in the .con.
        # The quoted value is the text, not a key: the lexicon never sees it,
        # and the mapType beside it still resolves as a key.
        info = parse_briefing(self.KASSERINE)
        self.assertIsNotNone(info.objectives)
        self.assertTrue(info.objectives.startswith('"The 21st'))

        resolved = resolve_briefing(
            info, {"MULTIPLAYER_MAP_TYPE_HEADON_MAP": "HEAD ON MAP"})
        self.assertIsNotNone(resolved.objectives)
        self.assertTrue(resolved.objectives.startswith("The 21st"))
        self.assertFalse(resolved.objectives.startswith('"'))
        self.assertEqual("HEAD ON MAP", resolved.map_type)
        self.assertEqual("bf1942", resolved.map_id)

    def test_single_player_verbs_are_not_read(self) -> None:
        # The SP campaign/skirmish/debriefing screens have no multiplayer
        # role; only the trio is parsed. The SP verbs' keys name the same
        # BRIEFING_* family, so a stray read would show here.
        text = self.WAKE + """
game.setAlliedDebriefingMajorVictory DEBRIEFING_ALLIED_MAJOR_VICTORY_WAKE
game.setAxisObjectives BRIEFING_AXIS_OBJECTIVES_WAKE
"""
        info = parse_briefing(text)
        self.assertEqual("MULTIPLAYER_BRIEFING_WAKE", info.objectives)
        self.assertEqual("MULTIPLAYER_MAP_TYPE_ASSAULT_MAP", info.map_type)
        self.assertEqual("BF1942", info.map_id)

    def test_an_unresolved_key_stays_a_key(self) -> None:
        # A key the lexicon does not answer keeps its name so the gap is
        # visible in scene.json rather than silently dropped.
        resolved = resolve_briefing(parse_briefing(self.WAKE), {})
        self.assertEqual("MULTIPLAYER_BRIEFING_WAKE", resolved.objectives)
        self.assertEqual("MULTIPLAYER_MAP_TYPE_ASSAULT_MAP", resolved.map_type)

    def test_an_empty_file_reads_none_everywhere(self) -> None:
        info = parse_briefing("")
        self.assertIsNone(info.objectives)
        self.assertIsNone(info.map_type)
        self.assertIsNone(info.map_id)

    def test_a_mod_level_without_the_trio_reads_clean(self) -> None:
        # Init.con alone (every level ships it) carries no briefing verbs;
        # parse_briefing on it finds nothing and load_briefing answers None.
        info = parse_briefing(
            "Game.setViewDistance 300\ngame.setActiveCombatArea 0 0 512 512\n")
        self.assertIsNone(info.objectives)
        self.assertIsNone(info.map_type)
        self.assertIsNone(info.map_id)

    def test_load_briefing_reads_the_menu_init_con_out_of_the_archive(self) -> None:
        # Real archives, real lexicon: Wake resolves end to end. A synthetic
        # overlay archive (Battleaxe_999) with no Menu/Init.con inherits the
        # parent's through LevelFiles, so the missing-file case is exercised
        # on a scratch install instead.
        from bf42.level import load_briefing

        game_dir = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
        if not (game_dir / "Mods" / "bf1942").is_dir():
            self.skipTest("no BF1942 install")

        from extract_spawn_layout import load_chain_lexicon
        from bf42.modmenu import MenuSources
        from extract_models import mod_chain

        files = load_level_files(
            find_level_archives(game_dir, "bf1942", "Wake"), "Wake")
        lexicon = load_chain_lexicon(
            MenuSources(mod_chain(game_dir, "bf1942")).lexicon_paths)
        briefing = load_briefing(files, lexicon)

        self.assertIsNotNone(briefing)
        assert briefing is not None
        self.assertIsNotNone(briefing.objectives)
        self.assertTrue(briefing.objectives.startswith("This is a Conquest"))
        self.assertEqual("ASSAULT MAP", briefing.map_type)
        self.assertEqual("BF1942", briefing.map_id)


if __name__ == "__main__":
    unittest.main()
