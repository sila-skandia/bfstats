from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from extract_models import (  # noqa: E402
    _inline_includes,
    catalogue,
    spawn_folder,
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

        self.assertEqual("SmokeIdle.ssc",
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


if __name__ == "__main__":
    unittest.main()
