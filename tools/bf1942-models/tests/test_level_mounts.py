"""A level bake resolves files the way the engine mounts a level.

Every level archive of the mod chain is mounted at its own path, so one level
names another's files (`GeometryTemplate.file ../bf1942/levels/<Other>/...`),
`textureManager.alternativePath` lines append to a list probed in the order
written, a level's own copy of a texture wins over the mod's, and the object
scripts a level's `Init.con` runs declare templates wherever they sit in the
archive, not only under `Objects/`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import extract_map as em  # noqa: E402
from bf42 import level  # noqa: E402
from bf42.rfa import ArchivePool, RfaArchive, write_rfa  # noqa: E402


class MountTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _rfa(self, name: str, files: dict[str, bytes]) -> Path:
        path = self.tmp / name
        write_rfa(path, files)
        return path

    def test_a_dotted_mesh_path_reads_another_levels_archive(self) -> None:
        other = self._rfa("DC_No_Fly_Zone.rfa", {
            "bf1942/levels/DC_No_Fly_Zone/standardMesh/air_hangar_bunker_m1.sm": b"sm",
            "bf1942/levels/DC_No_Fly_Zone/standardMesh/air_hangar_bunker_m1.rs": b"rs",
        })
        meshes = ArchivePool()
        meshes.mount_level(other, (".sm", ".rs"))
        stem = "standardMesh/../bf1942/levels/DC_No_Fly_Zone/standardMesh/air_hangar_bunker_m1"
        self.assertEqual(meshes.resolve_ext(stem, (".sm",)),
                         "bf1942/levels/DC_No_Fly_Zone/standardMesh/air_hangar_bunker_m1.sm")
        self.assertEqual(meshes.read(stem + ".rs"), b"rs")
        # A mount answers its full paths only: no basename, no tail.
        self.assertIsNone(meshes.resolve_ext("standardMesh/air_hangar_bunker_m1", (".sm",)))

    def test_a_mount_keeps_the_first_copy_of_a_path(self) -> None:
        near = self._rfa("near.rfa", {"bf1942/levels/L/standardMesh/m.sm": b"near"})
        far = self._rfa("far.rfa", {"bf1942/levels/L/standardMesh/m.sm": b"far"})
        meshes = ArchivePool()
        meshes.mount_level(near, (".sm",))
        meshes.mount_level(far, (".sm",))
        self.assertEqual(meshes.read("bf1942/levels/L/standardMesh/m.sm"), b"near")

    def test_a_levels_own_texture_answers_its_alternative_path(self) -> None:
        """The level ships a sky the mod ships too: the level's is the one drawn."""
        glob = self._rfa("texture.rfa", {"texture/Sky_Bocage_01.dds": b"global"})
        own = self._rfa("DC_Oil_Fields.rfa", {
            "bf1942/levels/DC_Oil_Fields/Textures/Sky_Bocage_01.dds": b"level",
            "bf1942/levels/DC_Oil_Fields/objectTexture/tablemap.dds": b"table",
        })
        textures = ArchivePool()
        textures.add(glob)
        textures.add_level(own, label="DC_Oil_Fields")
        # Without the alternative path the global copy answers `texture/X`.
        self.assertEqual(textures.read(textures.resolve_ext("texture/Sky_Bocage_01", (".dds",))),
                         b"global")
        textures.set_alternative_paths(["bf1942/levels/DC_Oil_Fields/Textures/"])
        self.assertEqual(textures.read(textures.resolve_ext("texture/Sky_Bocage_01", (".dds",))),
                         b"level")
        # A shader naming a level texture by full path reads it, from a
        # folder no alternative path names.
        self.assertEqual(textures.read(textures.resolve_ext(
            "bf1942/levels/DC_Oil_Fields/objectTexture/tablemap", (".dds",))), b"table")

    def test_alternative_paths_are_probed_in_the_order_written(self) -> None:
        textures = ArchivePool()
        textures.add_level(self._rfa("a.rfa", {"bf1942/levels/A/texture/x.dds": b"a"}))
        textures.add_level(self._rfa("b.rfa", {"bf1942/levels/B/texture/x.dds": b"b"}))
        textures.set_alternative_paths(["bf1942/levels/A/texture", "bf1942/levels/B/texture"])
        self.assertEqual(textures.read(textures.resolve_ext("texture/x", (".dds",))), b"a")

    def test_every_alternative_path_line_is_kept(self) -> None:
        info = level.LevelInfo(name="DC_Bridge", terrain=level.TerrainInfo())
        level.parse_init_con(
            "textureManager.alternativePath Texture/Africa\n"
            "textureManager.alternativePath bf1942/levels/DC_Bridge/Textures/\n"
            "textureManager.alternativePath bf1942\\levels\\DC_Bridge\\texture\n", info)
        self.assertEqual(info.texture_alternative_paths,
                         ["Texture/Africa", "bf1942/levels/DC_Bridge/Textures",
                          "bf1942/levels/DC_Bridge/texture"])

    def test_level_object_scripts_follow_init_con(self) -> None:
        """Al Nas's root `objects.con`, Coastal Hammer's `CustomObjects/`."""
        own = self._rfa("L.rfa", {
            "bf1942/levels/L/Init.con": (b"run Init/Terrain\nrun Sounds/Environment\n"
                                         b"run objects\nrun objects/objects\n"
                                         b"run CustomObjects/INIT\n"),
            "bf1942/levels/L/Init/Terrain.con": b"",
            "bf1942/levels/L/Sounds/Environment.con": b"",
            "bf1942/levels/L/objects.con": b"ObjectTemplate.create Bundle dcm_bridge\n",
            "bf1942/levels/L/objects/objects.con": b"",
            "bf1942/levels/L/CustomObjects/INIT.con": b"run house/house\n",
            "bf1942/levels/L/CustomObjects/house/house.con": b"run Objects\n",
            "bf1942/levels/L/CustomObjects/house/Objects.con":
                b"ObjectTemplate.create SimpleObject AL_house\n",
            "bf1942/levels/L/CustomObjects/unused/Objects.con":
                b"ObjectTemplate.create SimpleObject never_run\n",
        })
        files = level.LevelFiles([RfaArchive(own)], "L")
        scripts = em.level_object_scripts(files)
        self.assertEqual(scripts, {
            "bf1942/levels/l/objects.con",
            "bf1942/levels/l/customobjects/init.con",
            "bf1942/levels/l/customobjects/house/house.con",
            "bf1942/levels/l/customobjects/house/objects.con",
        })
        objects = ArchivePool()
        objects.add_level_objects(own, extra=scripts)
        names = {n.lower() for n in objects.names()}
        self.assertIn("bf1942/levels/l/customobjects/house/objects.con", names)
        self.assertIn("bf1942/levels/l/objects.con", names)
        self.assertNotIn("bf1942/levels/l/customobjects/unused/objects.con", names)
        index = em.TemplateIndex(objects)
        self.assertIsNotNone(index.get("dcm_bridge"))
        self.assertIsNotNone(index.get("al_house"))
        self.assertIsNone(index.get("never_run"))


def _game_dir() -> Path | None:
    try:
        from extract_models import DEFAULT_GAME_DIR
    except Exception:  # noqa: BLE001
        return None
    game = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
    return game if (game / "Mods" / "DC_Final").is_dir() else None


@unittest.skipIf(_game_dir() is None, "no DC Final install")
class RetailDesertCombatTests(unittest.TestCase):
    """The defects the 2026-09-30 audit found, against the installed game."""

    def _ctx(self, mod: str, name: str):
        import scene_layers
        ctx = scene_layers.LevelContext(_game_dir(), mod, name, out=Path("/nonexistent"))
        em.mount_level_pools(ctx)
        return ctx

    def test_no_fly_zone_day2_gives_both_sides_a_spawn(self) -> None:
        for mod in ("DesertCombat", "DC_Final"):
            ctx = self._ctx(mod, "DC_No_Fly_Zone_Day2")
            spawns = ctx.vehicle_soldier_spawns_by_mode["Conquest"]
            self.assertEqual({e["team"] for e in spawns}, {1, 2}, mod)
            self.assertEqual({e["group"] for e in spawns}, {97, 99}, mod)

    def test_weapon_bunkers_gives_the_iraqis_their_bunkers(self) -> None:
        ctx = self._ctx("DC_Final", "DC_Weapon_Bunkers")
        spawns = ctx.vehicle_soldier_spawns_by_mode["Conquest"]
        self.assertTrue(spawns)
        self.assertEqual({(e["group"], e["team"]) for e in spawns}, {(99, 1)})

    def test_urban_siege_nimitz_is_found_in_its_level_folder(self) -> None:
        ctx = self._ctx("DesertCombat", "DC_Urban_Siege")
        spawns = ctx.vehicle_soldier_spawns_by_mode["Conquest"]
        self.assertEqual({(e["vehicle"].lower(), e["group"], e["team"]) for e in spawns},
                         {("nimitz_static_heli_urbs", 72, 2), ("nimitz_static_heli_urbs", 74, 2)})

    def test_the_other_levels_meshes_resolve(self) -> None:
        ctx = self._ctx("DesertCombat", "DC_No_Fly_Zone_Day2")
        meshes = ctx.pools[0]
        self.assertIsNotNone(meshes.resolve_ext(
            "standardMesh/../bf1942/levels/DC_No_Fly_Zone/standardMesh/air_airfield_m1", (".sm",)))
        ctx = self._ctx("DC_Final", "DC_Coastal_Hammer")
        self.assertIsNotNone(ctx.pools[0].resolve_ext(
            "standardMesh/../bf1942/levels/DC_Coastal_Hammer/CustomMeshes/AL_sidewalk_block_m1",
            (".sm",)))
        self.assertIsNotNone(ctx.library.object("al_sidewalk_block_m1"))

    def test_al_nas_declares_its_bridges_in_its_root_objects_con(self) -> None:
        ctx = self._ctx("DC_Final", "DC_Al_Nas")
        for name in ("dcm_bridge", "dcm_bridgebase", "dcm_hut1_bridge_m1"):
            self.assertIsNotNone(ctx.library.object(name), name)

    def test_a_levels_own_sky_and_textures_win(self) -> None:
        ctx = self._ctx("DC_Final", "DC_Basrah_Nights")
        textures = ctx.pools[1]
        sky = textures.resolve_ext("texture/Sky_Gazala_01", (".dds", ".tga"))
        self.assertEqual(sky.lower(), "bf1942/levels/dc_basrah_nights/textures/sky_gazala_01.dds")
        ctx = self._ctx("DesertCombat", "DC_Battle_of_73_Easting")
        table = ctx.pools[1].resolve_ext(
            "bf1942/levels/DC_Battle_of_73_Easting/objectTexture/tablemap", (".dds", ".tga"))
        self.assertIsNotNone(table)


if __name__ == "__main__":
    unittest.main()
