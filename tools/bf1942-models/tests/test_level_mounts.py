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

    def _berlin(self) -> tuple[Path, Path]:
        """Fall of Berlin's shape: `Objects.con` runs one folder and has
        `rem run lightingfix/go`, whose scripts redeclare a mod geometry
        against a mesh no archive holds."""
        mod = self._rfa("objects.rfa", {
            "objects/Buildings/Common/AfricaBuildings/Geometries.con":
                b"GeometryTemplate.create StandardMesh Afr_Stairs_M1\n"
                b"GeometryTemplate.file Afr_Stairs_M1\n",
            "objects/Buildings/Common/AfricaBuildings/Objects.con":
                b"ObjectTemplate.create SimpleObject Afr_Stairs\n"
                b"ObjectTemplate.geometry Afr_Stairs_M1\n"
                b"ObjectTemplate.create SimpleObject Market\n"
                b"ObjectTemplate.geometry Afr_Stairs_M1\n",
        })
        own = self._rfa("L.rfa", {
            "bf1942/levels/L/Init.con": b"run objects/objects\n",
            "bf1942/levels/L/Objects/Objects.con": (
                b"rem run lightingfix/go\n"
                b"run stalls/go\n"),
            "bf1942/levels/L/Objects/stalls/go.con": b"run objects\n",
            "bf1942/levels/L/Objects/stalls/objects.con":
                b"ObjectTemplate.create SimpleObject Market\n"
                b"ObjectTemplate.geometry Market_Own_M1\n",
            "bf1942/levels/L/Objects/lightingfix/go.con": b"run geometries\n",
            "bf1942/levels/L/Objects/lightingfix/geometries.con":
                b"GeometryTemplate.create StandardMesh Afr_Stairs_M1\n"
                b"GeometryTemplate.file Afr_Stairs_M1_fix\n",
            "bf1942/levels/L/Objects/lightingfix/objects.con":
                b"ObjectTemplate.create SimpleObject Fix_Only\n",
        })
        return mod, own

    def test_level_run_order_follows_run_lines_not_rem_lines(self) -> None:
        _mod, own = self._berlin()
        files = level.LevelFiles([RfaArchive(own)], "L")
        self.assertEqual(em.level_run_order(files), [
            "bf1942/levels/l/init.con",
            "bf1942/levels/l/objects/objects.con",
            "bf1942/levels/l/objects/stalls/go.con",
            "bf1942/levels/l/objects/stalls/objects.con",
        ])

    def test_only_the_scripts_init_con_reaches_beat_the_mods(self) -> None:
        from extract_models import build_library
        mod, own = self._berlin()
        files = level.LevelFiles([RfaArchive(own)], "L")
        objects = ArchivePool()
        objects.add(mod)
        objects.add_level_objects(own, extra=em.level_object_scripts(files))
        ordered = em.LevelFirst(objects, em.level_run_order(files))
        library = build_library(ordered)
        # The `rem`-ed lightingfix never runs: the mod's mesh, not `_fix`.
        self.assertEqual(library.geometry("afr_stairs_m1").file, "Afr_Stairs_M1")
        # A reached script still redeclares the mod's template (LOAD-1, LOAD-2).
        self.assertEqual(library.object("market").geometry, "Market_Own_M1")
        # An unreached script only fills a name nothing else declares.
        self.assertIsNotNone(library.object("fix_only"))
        index = em.TemplateIndex(ordered)
        self.assertTrue(index.get("market").source.lower().startswith("bf1942/levels/l/"))
        # Without the run graph every level script goes first, as before.
        self.assertEqual(build_library(em.LevelFirst(objects)).geometry("afr_stairs_m1").file,
                         "Afr_Stairs_M1_fix")

    def test_objects_scripts_load_in_case_insensitive_path_order(self) -> None:
        """LOAD-5: FH's `Medic/` declares `medic_helm_brit` before FHSW's
        `MedicNo4/`, though FHSW is the nearer mod."""
        from extract_models import build_library, load_order
        near = self._rfa("near.rfa", {
            "objects/Items/BritKit/MedicNo4/Objects.con":
                b"ObjectTemplate.create SimpleObject medic_helm_brit\n"
                b"ObjectTemplate.geometry helm_no4\n",
            "Objects/Items/BritKit/Shared.con":
                b"ObjectTemplate.create SimpleObject shared\n"
                b"ObjectTemplate.geometry near_copy\n",
        })
        far = self._rfa("far.rfa", {
            "Objects/Items/BritKit/Medic/Objects.con":
                b"ObjectTemplate.create SimpleObject Medic_Helm_Brit\n"
                b"ObjectTemplate.geometry helm_medic\n",
            "objects/items/britkit/shared.con":
                b"ObjectTemplate.create SimpleObject shared\n"
                b"ObjectTemplate.geometry far_copy\n",
        })
        objects = ArchivePool()
        objects.add(near)
        objects.add(far)
        library = build_library(objects)
        self.assertEqual(library.object("medic_helm_brit").geometry, "helm_medic")
        # One path shipped twice is one script, opened from the nearer mod.
        self.assertEqual(library.object("shared").geometry, "near_copy")
        # strcasecmp order: `_` (0x5f) before a lower-case letter, `/` before
        # `_`, and a level's own scripts after the rest.
        self.assertEqual(load_order(["objects/b/x.con", "objects/_a/x.con", "Objects/A/x.con",
                                     "bf1942/levels/L/x.con", "objects/a_b/x.con"]),
                         ["objects/_a/x.con", "Objects/A/x.con", "objects/a_b/x.con",
                          "objects/b/x.con", "bf1942/levels/L/x.con"])
        # `/ai/` paths are never run (`loadAllConFiles` keys less them),
        # however much a name they hold would sort ahead.
        self.assertEqual(load_order(["objects/ai/z.con", "objects/a/x.con",
                                     "objects/v/4,1inchl65skc33/ai/objects.con"]),
                         ["objects/a/x.con"])

    def test_a_level_load_takes_only_the_objects_scripts_it_runs(self) -> None:
        """LOAD-8: `loadAllConFiles("objects/")` never walks a level archive,
        so a level's `Objects/` script that nothing runs declares nothing. DC
        Final's Lost Village ships the nochute kits and runs none of them."""
        own = self._rfa("L.rfa", {
            "bf1942/levels/L/Init.con": b"run Init/Terrain\nrun Objects/Objects\n",
            "bf1942/levels/L/Init/Terrain.con": b"",
            "bf1942/levels/L/Objects/Objects.con":
                b"run wires/wires\nremrun USKit/Assault/Objects\n",
            "bf1942/levels/L/Objects/wires/wires.con": b"run objects\n",
            "bf1942/levels/L/Objects/wires/objects.con":
                b"ObjectTemplate.create SimpleObject wires_m1\n",
            "bf1942/levels/L/Objects/wires/geometries.con":
                b"GeometryTemplate.create StandardMesh wires_m1\n",
            "bf1942/levels/L/Objects/USKit/Assault/Objects.con":
                b"ObjectTemplate.create Kit US_Assault\n",
            "bf1942/levels/L/Objects/wires/Sounds/wire.ssc": b"newPatch\n",
        })
        files = level.LevelFiles([RfaArchive(own)], "L")
        runs = em.level_run_scripts(files)
        # In the order a host runs them: a `run` executes before the next line.
        self.assertEqual(runs, [
            "bf1942/levels/l/objects/objects.con",
            "bf1942/levels/l/objects/wires/wires.con",
            "bf1942/levels/l/objects/wires/objects.con",
        ])
        self.assertEqual(em.level_object_scripts(files), set())
        objects = ArchivePool()
        objects.add_level_objects(own, runs=runs)
        names = {n.lower() for n in objects.names()}
        self.assertIn("bf1942/levels/l/objects/wires/objects.con", names)
        self.assertNotIn("bf1942/levels/l/objects/wires/geometries.con", names)
        self.assertNotIn("bf1942/levels/l/objects/uskit/assault/objects.con", names)
        # What is not a script stays: the object's sound, its textures.
        self.assertIn("bf1942/levels/l/objects/wires/sounds/wire.ssc", names)
        index = em.TemplateIndex(objects)
        self.assertIsNotNone(index.get("wires_m1"))
        self.assertIsNone(index.get("us_assault"))
        # The census (no `runs`) still takes the whole folder.
        census = ArchivePool()
        census.add_level_objects(own)
        self.assertIn("bf1942/levels/l/objects/uskit/assault/objects.con",
                      {n.lower() for n in census.names()})

    def test_the_first_script_a_level_runs_owns_a_name(self) -> None:
        """Two of a level's scripts declare one kit part (Lost Village nopara's
        `Bacpac_Big_ger`, in its HeavyAssault and Support files): the one the
        level runs first owns it (LOAD-1), whatever the archive's order."""
        own = self._rfa("L.rfa", {
            "bf1942/levels/L/Init.con": b"run Objects/Objects\n",
            "bf1942/levels/L/Objects/Objects.con": b"run Zulu/Objects\nrun Alpha/Objects\n",
            "bf1942/levels/L/Objects/Alpha/Objects.con":
                b"ObjectTemplate.create KitPart Pack\nObjectTemplate.geometry pack_alpha\n",
            "bf1942/levels/L/Objects/Zulu/Objects.con":
                b"ObjectTemplate.create KitPart Pack\nObjectTemplate.geometry pack_zulu\n",
        })
        files = level.LevelFiles([RfaArchive(own)], "L")
        objects = ArchivePool()
        objects.add_level_objects(own, runs=em.level_run_scripts(files))
        from extract_models import build_library
        library = build_library(em.LevelFirst(objects))
        self.assertEqual("pack_zulu", library.object("Pack").geometry)
        self.assertEqual("L/Objects/Zulu/Objects.con",
                         em.TemplateIndex(objects).get("pack").source.split("levels/", 1)[1])


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


@unittest.skipIf(_game_dir() is None or not (_game_dir() / "Mods" / "FHSW").is_dir(),
                 "no FHSW install")
class RetailFhswTests(unittest.TestCase):
    """The 2026-09-30 FHSW level audit, against the installed game."""

    def test_fall_of_berlin_draws_fh_stalls_not_its_remmed_lightingfix(self) -> None:
        import scene_layers
        ctx = scene_layers.LevelContext(_game_dir(), "FHSW", "Fall_of_Berlin-1945",
                                        out=Path("/nonexistent"))
        library = ctx.library
        for name in ("afr_stairs_long2m_m1", "afr_marketroof_1_white_m1",
                     "eod_templeruinpole_01"):
            geometry = library.geometry(name)
            self.assertIsNotNone(geometry, name)
            self.assertFalse(geometry.mesh_file.lower().endswith("_fix"), name)
        # LOAD-5: FH's `Medic/` runs before FHSW's `MedicNo4/`.
        self.assertIn("/items/britkit/medic/",
                      library.object("medic_helm_brit").source.lower())


if __name__ == "__main__":
    unittest.main()
