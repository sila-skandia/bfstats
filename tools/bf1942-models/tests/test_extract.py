from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR,
    _inline_includes,
    build_library,
    build_pools,
    catalogue,
    discover_levels,
    home_levels,
    mod_chain,
    own_templates,
    template_category,
    spawn_folder,
    spawned_templates,
    spawner_templates,
    model_file_stem,
    variant_suffix,
)


def library_with(*sources: tuple[str, str]) -> ObjectLibrary:
    library = ObjectLibrary()
    for path, text in sources:
        library.add_con(path, text)
    return library


# The shape of `Objects/HandWeapons/K98/Objects.con`, cut down to the two
# `HandFireArms` it declares and the render bundles they choose between.
K98_FOLDER = """
ObjectTemplate.create HandFireArms K98
ObjectTemplate.magSize 5
ObjectTemplate.addTemplate K98Lod

ObjectTemplate.create HandFireArms K98Sniper
ObjectTemplate.useScope 1
ObjectTemplate.addTemplate K98SniperLod

ObjectTemplate.create LodObject K98Lod
ObjectTemplate.addTemplate K98Complex

ObjectTemplate.create LodObject K98SniperLod
ObjectTemplate.addTemplate K98SniperComplex

ObjectTemplate.create SimpleObject K98Scope
ObjectTemplate.geometry K98Scope
"""

# `Objects/Vehicles/Sea/fletcher/Objects.con`, cut down: the two hulls share
# one LOD and one gun, and differ in the deck spawn points they add.
FLETCHER_FOLDER = """
ObjectTemplate.create PlayerControlObject Fletcher
ObjectTemplate.addTemplate lodFletcher
ObjectTemplate.addTemplate FletcherSoldierSpawn

ObjectTemplate.create LodObject lodFletcher
ObjectTemplate.addTemplate FletcherComplex

ObjectTemplate.create Bundle FletcherComplex
ObjectTemplate.geometry fletcher_hull_m1
ObjectTemplate.addTemplate fletcher_GunBase

ObjectTemplate.create PlayerControlObject fletcher_GunBase
ObjectTemplate.geometry fletcher_gun_m1

ObjectTemplate.create SpawnPoint FletcherSoldierSpawn
ObjectTemplate.setGroup 69

ObjectTemplate.create SpawnPoint FletcherSoldierSpawnAlt
ObjectTemplate.setGroup 81

rem *** Fletcher ***
ObjectTemplate.create PlayerControlObject Fletcher2
ObjectTemplate.addTemplate lodFletcher
ObjectTemplate.addTemplate FletcherSoldierSpawnAlt
"""


class SpawnFolderTests(unittest.TestCase):
    def test_vehicle_folder_is_the_leaf_directory(self) -> None:
        self.assertEqual(
            "Sherman",
            spawn_folder("Objects/Vehicles/Land/Sherman/Objects.con"),
        )
        self.assertEqual(
            "Stuka",
            spawn_folder("Objects/Vehicles/Air/Stuka/Objects.con"),
        )
        self.assertEqual(
            "Elco80",
            spawn_folder("Objects/Vehicles/Sea/Elco80/Objects.con"),
        )

    def test_soldier_folder_is_not_the_con_filename(self) -> None:
        self.assertEqual(
            "BritishSoldier",
            spawn_folder("Objects/Soldiers/BritishSoldier/Objects.con"),
        )


class VariantSuffixTests(unittest.TestCase):
    def test_default_variant_has_no_suffix(self) -> None:
        self.assertEqual("", variant_suffix("complex", 0, None))

    def test_cockpit_leads_the_suffix_so_the_file_sorts_with_its_vehicle(self) -> None:
        self.assertEqual(
            ".cockpit", variant_suffix("complex", 0, None, first_person=True))
        self.assertEqual(
            ".cockpit.lod1.Truk",
            variant_suffix("complex", 1, "Truk", first_person=True),
        )
        self.assertEqual(".wreck", variant_suffix("wreck", 0, None))


class ModelFileStemTests(unittest.TestCase):
    """A slash is legal in a template name (FHSW's `SdKfz251/1`) but not in a
    file name; the exporter and the viewer must spell it the same way."""

    NAMES = ["Sherman", "SdKfz251/1", "Flak18/36_Coverd", "SdKfz7Tractor-Flak18/36",
             "sFH414(f)Battery3Wreck"]

    def test_a_slash_is_spelled_underscore(self) -> None:
        self.assertEqual("SdKfz251_1", model_file_stem("SdKfz251/1"))
        self.assertEqual("Sherman", model_file_stem("Sherman"))

    def test_the_viewer_spells_every_name_the_same_way(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        module = (Path(__file__).resolve().parents[1] / "viewer" / "model-file.js").as_uri()
        script = (f"const {{ modelFileStem }} = await import({json.dumps(module)});"
                  f"console.log(JSON.stringify({json.dumps(self.NAMES)}.map(modelFileStem)));")
        proc = subprocess.run(["node", "--input-type=module", "-e", script],
                              capture_output=True, text=True, check=True)
        self.assertEqual([model_file_stem(n) for n in self.NAMES], json.loads(proc.stdout))


class CatalogueTests(unittest.TestCase):
    """What counts as a spawnable object — folder layout, or declaration."""

    def test_a_second_handfirearms_in_one_folder_is_catalogued(self) -> None:
        library = library_with(("Objects/HandWeapons/K98/Objects.con", K98_FOLDER))

        names = {name for name, _category, _source in catalogue(None, library)}

        # The whole point: `K98Sniper` is declared in `K98/`, so it is named
        # after no folder at all, yet it is a weapon in its own right.
        self.assertIn("K98", names)
        self.assertIn("K98Sniper", names)

    def test_the_parts_a_weapon_is_made_of_are_not_weapons(self) -> None:
        library = library_with(("Objects/HandWeapons/K98/Objects.con", K98_FOLDER))

        names = {name for name, _category, _source in catalogue(None, library)}

        # `K98Scope` is a SimpleObject the sniper carries, and the two LodObjects
        # are the alternatives it picks between. Admitting them would put four
        # spare parts in the armoury next to the rifle they belong to.
        self.assertEqual({"K98", "K98Sniper"}, names)

    def test_a_vehicle_folder_still_yields_only_the_vehicle(self) -> None:
        # A vehicle declares dozens of PlayerControlObjects — turrets and
        # sub-vehicles — so kind cannot decide there and the folder name must.
        library = library_with(("Objects/Vehicles/Land/Sherman/Objects.con", """
ObjectTemplate.create PlayerControlObject Sherman
ObjectTemplate.addTemplate ShermanTurret

ObjectTemplate.create PlayerControlObject ShermanTurret
ObjectTemplate.geometry ShermanTurret
"""))

        self.assertEqual(
            [("Sherman", "land", "Objects/Vehicles/Land/Sherman/Objects.con")],
            catalogue(None, library),
        )

    def test_a_folder_spelled_with_a_separator_still_names_its_vehicle(self) -> None:
        # The Axis AA gun: `flak38` in `Flak_38/`, with the two turning
        # bundles its folder also declares. An exact match left it out of the
        # models tree, and every replay drew no Axis AA gun.
        library = library_with(("Objects/Vehicles/Land/Flak_38/Objects.con", """
ObjectTemplate.create PlayerControlObject flak38
ObjectTemplate.addTemplate flak38_body

ObjectTemplate.create RotationalBundle flak38_body
ObjectTemplate.geometry flak38_lavett_m1
ObjectTemplate.addTemplate flak38_gun

ObjectTemplate.create RotationalBundle flak38_gun
"""))

        self.assertEqual(
            [("flak38", "land", "Objects/Vehicles/Land/Flak_38/Objects.con")],
            catalogue(None, library),
        )

    def test_a_soldiers_parachute_is_not_a_soldier(self) -> None:
        library = library_with(("Objects/Soldiers/Common/Parachute/Objects.con", """
ObjectTemplate.create AnimatedBundle Parachute
ObjectTemplate.geometry Parachute
"""), ("Objects/Soldiers/USSoldier/Objects.con", """
ObjectTemplate.create BFSoldier USSoldier
ObjectTemplate.geometry USSoldier
"""))

        self.assertEqual(
            ["USSoldier"], [name for name, _c, _s in catalogue(None, library)])

    def test_a_second_hull_a_level_spawns_is_catalogued(self) -> None:
        # `Sea/fletcher/Objects.con` declares two complete destroyers, and
        # Midway's `DestroyerSpawner2` fields the one named after no folder.
        # Without it the replay asked for a `Fletcher2.glb` no tree had and
        # drew no destroyer at all.
        library = library_with(("Objects/Vehicles/Sea/fletcher/Objects.con", FLETCHER_FOLDER))

        self.assertEqual(
            ["Fletcher"], [name for name, _c, _s in catalogue(None, library)])
        self.assertEqual(
            [("Fletcher", "sea", "Objects/Vehicles/Sea/fletcher/Objects.con"),
             ("Fletcher2", "sea", "Objects/Vehicles/Sea/fletcher/Objects.con")],
            catalogue(None, library, spawned={"FLETCHER2"}))

    def test_the_parts_a_spawned_hull_is_made_of_stay_parts(self) -> None:
        # Only what a spawner names comes in: the gun both hulls carry is
        # still a part of them, never a model of its own.
        library = library_with(("Objects/Vehicles/Sea/fletcher/Objects.con", FLETCHER_FOLDER))

        names = {name for name, _c, _s in catalogue(None, library,
                                                    spawned={"fletcher", "fletcher2"})}

        self.assertEqual({"Fletcher", "Fletcher2"}, names)

    def test_a_spawned_kit_stays_out(self) -> None:
        # Secret Weapons' levels spawn the elite jet pack, a Kit filed under
        # `Objects/Items/`: a pickup, and `extract_kits.py`'s, not a model.
        library = library_with(("Objects/Items/GerEliteKit/JetPack/Objects.con", """
ObjectTemplate.create Kit GermanElite_JetPack
ObjectTemplate.geometry JetPack
"""))

        self.assertEqual([], catalogue(None, library, spawned={"germanelite_jetpack"}))

    def test_a_template_a_level_declares_and_spawns_is_catalogued(self) -> None:
        # Al Nas's mobile spawn truck lives in the level's own archive and
        # nowhere else; only the category prefix was asked, so no tree had it.
        library = library_with(("bf1942/levels/DC_Al_Nas/objects/nx_M-923/Objects.con",
                                NX_M923))

        self.assertEqual([], catalogue(None, library))
        self.assertEqual(
            [("nx_M-923", "land", "bf1942/levels/DC_Al_Nas/objects/nx_M-923/Objects.con")],
            catalogue(None, library, spawned={"nx_m-923"}))
        # Its own map tree bakes Al Nas; a mod that only inherits the level
        # does not.
        self.assertEqual(1, len(catalogue(None, library, spawned={"nx_m-923"},
                                          own_levels={"dc_al_nas"})))
        self.assertEqual([], catalogue(None, library, spawned={"nx_m-923"},
                                       own_levels={"dc_weapon_bunkers"}))

    def test_an_objective_with_no_seat_is_an_object(self) -> None:
        # Weapon Bunkers' bunkers say `VCLand` like every DC PlayerControlObject,
        # but nobody gets into one.
        library = library_with(("bf1942/levels/DC_Weapon_Bunkers/objects/mil_wpbunker_m1/Objects.con", """
ObjectTemplate.create PlayerControlObject mil_wpbunkerleft_des
ObjectTemplate.setVehicleCategory VCLand
ObjectTemplate.geometry mil_wpbunker_m1
"""))

        self.assertEqual("object", template_category(library, "mil_wpbunkerleft_des"))

    def test_a_level_copy_of_the_stock_layout_is_filed_the_same_way(self) -> None:
        library = library_with(
            ("bf1942/levels/Raid_on_Agheila/Objects/Vehicles/Air/Flettner/Objects.con", """
ObjectTemplate.create PlayerControlObject Flettner
ObjectTemplate.geometry Flettner_Hull_M1
"""),
            ("Objects/Buildings/Armory/DC_Armory_M82/Objects.con", """
ObjectTemplate.create Bundle Armory_M82
ObjectTemplate.geometry armory_m82
"""))

        self.assertEqual("air", template_category(library, "Flettner"))
        # A spawned prop from a folder that is no category at all.
        self.assertEqual(
            [("Armory_M82", "object", "Objects/Buildings/Armory/DC_Armory_M82/Objects.con")],
            catalogue(None, library, spawned={"armory_m82"}))


# Al Nas's `objects/nx_M-923/Objects.con`, cut down to what the catalogue reads.
NX_M923 = """
ObjectTemplate.create PlayerControlObject nx_M-923
ObjectTemplate.setVehicleCategory VCLand
ObjectTemplate.geometry nx_M-923_Hull_M1
ObjectTemplate.addTemplate nx_M-923Entry

ObjectTemplate.create EntryPoint nx_M-923Entry
"""


# Midway's `Conquest/ObjectSpawnTemplates.con`, the ships only: each spawner
# names a hull per team, and the second pair is the one no folder is named
# after.
MIDWAY_SHIP_SPAWNERS = """
ObjectTemplate.create ObjectSpawner battleshipSpawner
ObjectTemplate.setObjectTemplate 1 yamato
ObjectTemplate.setObjectTemplate 2 princeow
ObjectTemplate.MinSpawnDelay 300
ObjectTemplate.create ObjectSpawner DestroyerSpawner
ObjectTemplate.setObjectTemplate 1 hatsuzuki
ObjectTemplate.setObjectTemplate 2 fletcher
ObjectTemplate.create ObjectSpawner DestroyerSpawner2
ObjectTemplate.setObjectTemplate 1 hatsuzuki2
ObjectTemplate.setObjectTemplate 2 fletcher2
ObjectTemplate.create ObjectSpawner ParaSpawner
ObjectTemplate.setObjectTemplate 2 ParatrooperSpawnObject
"""


class SpawnerTemplatesTests(unittest.TestCase):
    def test_every_team_of_every_spawner_lower_case(self) -> None:
        self.assertEqual(
            {"yamato", "princeow", "hatsuzuki", "fletcher", "hatsuzuki2", "fletcher2"},
            spawner_templates(MIDWAY_SHIP_SPAWNERS))

    def test_a_file_without_spawners_names_nothing(self) -> None:
        self.assertEqual(set(), spawner_templates("ObjectTemplate.create Bundle Foo\n"))


def _vanilla_chain() -> list[Path] | None:
    game = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
    if not (game / "Mods" / "bf1942").is_dir():
        return None
    return mod_chain(game, "bf1942")


@unittest.skipIf(_vanilla_chain() is None, "no BF1942 install")
class RetailSpawnedCatalogueTests(unittest.TestCase):
    def test_the_second_destroyers_are_vanilla_models(self) -> None:
        chain = _vanilla_chain()
        _meshes, _textures, objects, _game = build_pools(chain, [])
        library = build_library(objects)
        spawned = spawned_templates(discover_levels(chain))

        self.assertLessEqual({"fletcher2", "hatsuzuki2"}, spawned)
        names = {name for name, _c, _s in catalogue(objects, library, spawned=spawned)}
        self.assertLessEqual({"Fletcher", "Fletcher2", "Hatsuzuki", "Hatsuzuki2"}, names)
        # Everything the folder rule already listed is still listed.
        self.assertLessEqual({name for name, _c, _s in catalogue(objects, library)}, names)


def _dc_final_chain() -> list[Path] | None:
    game = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
    if not (game / "Mods" / "DC_Final").is_dir():
        return None
    return mod_chain(game, "DC_Final")


@unittest.skipIf(_dc_final_chain() is None, "no Desert Combat Final install")
class RetailLevelTemplateTests(unittest.TestCase):
    """DC Final's Battle of Britain: its own Ju88A scripts over vanilla's level."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.chain = _dc_final_chain()
        _meshes, _textures, cls.objects, _game = build_pools(cls.chain, [])
        cls.levels = discover_levels(cls.chain)
        from extract_models import add_level_objects
        add_level_objects(cls.objects, cls.levels, cls.chain)
        cls.library = build_library(cls.objects)

    def test_the_level_is_read_through_every_copy_of_it(self) -> None:
        # DC Final's copy ships the Ju88A scripts and no Conquest spawners;
        # the round runs vanilla's, so read nearest-only nothing spawned it.
        nearest = spawned_templates(self.levels)
        underlay = spawned_templates(self.levels, self.chain)
        self.assertNotIn("ju88a", nearest)
        self.assertIn("ju88a", underlay)
        self.assertLessEqual(nearest, underlay)

    def test_a_level_template_is_built_from_its_levels_archives(self) -> None:
        home = home_levels(self.chain, self.library, "Ju88A")
        mods = [path.parents[3].name for _label, path in home]
        self.assertEqual("DC_Final", mods[0])
        self.assertIn("bf1942", mods)
        self.assertTrue(all(path.stem.lower().startswith("battle_of_britain")
                            for _label, path in home))
        self.assertEqual([], home_levels(self.chain, self.library, "M1A1"))

    def test_the_catalogue_has_the_level_templates_its_maps_spawn(self) -> None:
        own = {stem.lower() for stem, _ in discover_levels(self.chain[:1])}
        names = {name for name, _c, _s in catalogue(
            self.objects, self.library,
            spawned=spawned_templates(self.levels, self.chain), own_levels=own)}
        self.assertLessEqual({"Ju88A", "nx_M-923", "nx_M-923c", "camel2", "Landslide",
                              "mil_wpbunkerleft_des", "air_radardome_des"}, names)
        # A spawned kit stays with the kits.
        self.assertNotIn("US_Sniper_hvy", names)

    def test_a_mods_own_level_templates_are_its_own(self) -> None:
        self.assertIn("nx_m-923", own_templates(self.chain, self.library))


class FakeObjects:
    """The `try_read` face of an ArchivePool over an in-memory dict."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self._files = {key.lower(): value for key, value in files.items()}

    def try_read(self, name: str) -> bytes | None:
        return self._files.get(name.replace("\\", "/").lower())


class InlineIncludesTests(unittest.TestCase):
    """`include <relpath>` is the one `.con` directive outside `Namespace.cmd`.

    Every nation's soldier uses it to pull in `CommonSoldierData.inc`
    (`hitpoints`, `healDistance`, ...) -- 2147 uses across the 14 installed
    mods, `build_library` never reads `.inc`/`.tweak` files as top-level
    entries, and this is the only thing that lets their bare directives land
    on the template the includer had open.
    """

    def test_a_relative_include_is_spliced_in_and_lands_on_the_open_template(self) -> None:
        objects = FakeObjects({
            "Objects/Soldiers/Common/CommonSoldierData.inc": b"""
ObjectTemplate.HitPoints 30
ObjectTemplate.MaxHitPoints 30
""",
        })
        text = _inline_includes(objects, "Objects/Soldiers/USSoldier/Objects.con", """
ObjectTemplate.create BFSoldier USSoldier
include ../Common/CommonSoldierData.inc
ObjectTemplate.healDistance 10.0
""")
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/USSoldier/Objects.con", text)
        soldier = library.object("USSoldier")

        self.assertEqual(30.0, soldier.hitpoints)
        self.assertEqual(30.0, soldier.max_hitpoints)
        # The directive after the spliced include still lands on the same
        # template -- the splice does not close it off.
        self.assertEqual(10.0, soldier.heal_distance)

    def test_a_backslash_path_and_double_space_still_resolve(self) -> None:
        # Objects/Effects/e_SmokeIdleXpack/Effects.con, verbatim spelling,
        # shipped in WarFront/XPack1/bf1918.
        objects = FakeObjects({
            "Objects/Effects/e_SmokeIdleXpack/Sounds/SmokeIdleXpack.con": b"""
ObjectTemplate.loadSoundScript SmokeIdle.ssc
""",
        })
        text = _inline_includes(
            objects, "Objects/Effects/e_SmokeIdleXpack/Effects.con", """
ObjectTemplate.create EffectBundle e_SmokeIdleXpack
include  Sounds\\SmokeIdleXpack.con
""")
        library = ObjectLibrary()
        library.add_con("Objects/Effects/e_SmokeIdleXpack/Effects.con", text)

        # The script sits beside the included file, not beside Effects.con
        # (ledger CON-14), so the path comes out rebased onto Effects.con.
        self.assertEqual("Sounds/SmokeIdle.ssc",
                         library.object("e_SmokeIdleXpack").sound_script)

    def test_an_unresolvable_include_fails_soft(self) -> None:
        text = _inline_includes(FakeObjects({}), "Objects/Soldiers/Foo/Objects.con", """
ObjectTemplate.create BFSoldier Foo
include ../Common/Missing.inc
ObjectTemplate.hitpoints 1
""")
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/Foo/Objects.con", text)

        self.assertEqual(1.0, library.object("Foo").hitpoints)

    def test_a_commented_out_include_is_not_a_directive(self) -> None:
        # A `rem`/`beginrem` line that happens to start with the word
        # "include" must not be spliced -- this is why `_inline_includes`
        # strips comments itself rather than trusting `add_con` to do it
        # after the fact.
        objects = FakeObjects({
            "Objects/Common/X.inc": b"ObjectTemplate.hitpoints 999\n",
        })
        text = _inline_includes(objects, "Objects/Foo/Objects.con", """
ObjectTemplate.create BFSoldier Foo
rem include X.inc
ObjectTemplate.hitpoints 1
""")
        library = ObjectLibrary()
        library.add_con("Objects/Foo/Objects.con", text)

        self.assertEqual(1.0, library.object("Foo").hitpoints)

    def test_a_self_including_cycle_does_not_hang(self) -> None:
        objects = FakeObjects({
            "Objects/A.inc": b"include A.inc\nObjectTemplate.hitpoints 5\n",
        })
        text = _inline_includes(objects, "Objects/Root.con", """
ObjectTemplate.create BFSoldier Root
include A.inc
""")
        library = ObjectLibrary()
        library.add_con("Objects/Root.con", text)

        # The cycle is broken (no RecursionError); the directive that reached
        # before the repeat was detected still lands.
        self.assertEqual(5.0, library.object("Root").hitpoints)


class IncludedSoundScriptPathTests(unittest.TestCase):
    """A `loadSoundScript` path is relative to the file the line is in.

    The engine prefixes the console's working path (client `0x0054d8ba`), and
    `include` sets that to the included file's own folder until it returns
    (lnxded `OldConsole::include` `0x083ed110`; ledger CON-14). FHSW's
    `objects/Handweapons/!_PACK_COMMON/Compressed.con` includes
    `../K98/K98.inc`, whose `loadSoundScript Sounds/k98.ssc` means
    `Handweapons/K98/Sounds/k98.ssc`; read against the pack file it named a
    script that does not exist, and 277 hand weapons were silent.
    """

    PACK = "objects/Handweapons/!_PACK_COMMON/Compressed.con"

    def library(self, files: dict[str, bytes], path: str, text: str) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con(path, _inline_includes(FakeObjects(files), path, text))
        return library

    def test_a_script_named_in_an_include_resolves_beside_the_include(self) -> None:
        from bf42.level import resolve_ssc_path
        library = self.library({
            "objects/Handweapons/K98/K98.inc": b"""
ObjectTemplate.networkableInfo HandFireArmsInfo
ObjectTemplate.loadSoundScript Sounds/k98.ssc
""",
        }, self.PACK, """
ObjectTemplate.create HandFireArms K98
include ../K98/K98.inc
ObjectTemplate.numOfMag 10
""")
        k98 = library.object("K98")

        self.assertEqual("../K98/Sounds/k98.ssc", k98.sound_script)
        self.assertEqual("objects/Handweapons/K98/Sounds/k98.ssc",
                         resolve_ssc_path(k98.source, k98.sound_script))

    def test_a_path_the_pack_already_wrote_relative_to_itself_is_left_alone(self) -> None:
        # The FH packer rewrote the lines it copied into Compressed.con
        # (`../345RCL/Sounds/345RCL.ssc`); those are the pack file's own.
        library = self.library({}, self.PACK, """
ObjectTemplate.create HandFireArms RCL345
ObjectTemplate.loadSoundScript ../345RCL/Sounds/345RCL.ssc
""")
        self.assertEqual("../345RCL/Sounds/345RCL.ssc",
                         library.object("RCL345").sound_script)

    def test_an_include_in_the_same_folder_keeps_its_path(self) -> None:
        library = self.library({
            "objects/Handweapons/SuomiKP31/SuomiKP31_71.inc":
                b"ObjectTemplate.loadSoundScript Sounds/SuomiKP31.ssc\n",
        }, "objects/Handweapons/SuomiKP31/Objects.con", """
ObjectTemplate.create HandFireArms SuomiKP31_71
include SuomiKP31_71.inc
""")
        self.assertEqual("Sounds/SuomiKP31.ssc",
                         library.object("SuomiKP31_71").sound_script)

    def test_a_nested_include_resolves_beside_the_innermost_file(self) -> None:
        # The SVT40 shape one level deeper: AKT40.inc names SVT40's script
        # relative to itself, and is reached through a second include.
        from bf42.level import resolve_ssc_path
        library = self.library({
            "objects/Handweapons/AKT40/AKT40.inc":
                b"include Common/AKT40Sound.inc\n",
            "objects/Handweapons/AKT40/Common/AKT40Sound.inc":
                b"ObjectTemplate.loadSoundScript ../../SVT40/Sounds/SVT40.ssc\n",
        }, self.PACK, """
ObjectTemplate.create HandFireArms AKT40
include ../AKT40/AKT40.inc
""")
        akt = library.object("AKT40")

        self.assertEqual("objects/Handweapons/SVT40/Sounds/SVT40.ssc",
                         resolve_ssc_path(akt.source, akt.sound_script))

    def test_a_quoted_backslash_path_is_rebased_too(self) -> None:
        library = self.library({
            "Objects/Soldiers/Common/Sounds/SoldierSound.inc":
                b'ObjectTemplate.loadSoundScript "High\\SoldierStop.ssc"\n',
        }, "Objects/Soldiers/USSoldier/Objects.con", """
ObjectTemplate.create BFSoldier USSoldier
include ../Common/Sounds/SoldierSound.inc
""")
        self.assertEqual("../Common/Sounds/High/SoldierStop.ssc",
                         library.object("USSoldier").sound_script)


if __name__ == "__main__":
    unittest.main()
