"""`extract_kits.py`: which levels are asked for their own kits, and how their
answers are grouped, whatever order or process read them."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import kit as kit_mod  # noqa: E402
from extract_kits import (bound_keys, build_part, group_variants, item_rows, part_pools,  # noqa: E402
                          pickup_fields, pickup_holders, write_part)


def _kit(template: str) -> kit_mod.Kit:
    return kit_mod.Kit(template=template, source="objects/items/kits.con",
                       nation="US", kit_class="Assault")


def _teams(*slots: dict[int, str]) -> dict[int, kit_mod.TeamLoadout]:
    teams = {}
    for team_id, named in enumerate(slots, start=1):
        team = kit_mod.TeamLoadout()
        team.slots.update(named)
        teams[team_id] = team
    return teams


class BoundKeysTests(unittest.TestCase):
    def setUp(self) -> None:
        self.chosen = [_kit("US_Assault"), _kit("Ger_Assault"), _kit("US_Sniper_hvy")]
        self.loadouts = {"Alpha": _teams({0: "us_assault"}, {0: "GER_ASSAULT"}),
                         "Bravo": _teams({0: "Jap_Assault"}, {})}

    def test_the_kits_a_level_binds_in_the_order_they_were_chosen(self) -> None:
        self.assertEqual(["us_assault", "ger_assault"],
                         bound_keys("Alpha", self.chosen, self.loadouts))

    def test_a_kit_on_a_pad_counts(self) -> None:
        pads = {"Bravo": {"us_sniper_hvy": "US_Sniper_hvy"}}
        self.assertEqual(["us_sniper_hvy"],
                         bound_keys("Bravo", self.chosen, self.loadouts, pads))

    def test_a_level_binding_none_of_them_is_not_asked(self) -> None:
        self.assertEqual([], bound_keys("Bravo", self.chosen, self.loadouts))
        self.assertEqual([], bound_keys("Charlie", self.chosen, self.loadouts))


class GroupVariantsTests(unittest.TestCase):
    def test_levels_that_agree_share_an_entry_and_the_first_keeps_its_kit(self) -> None:
        landmine = {"items": ["M16", "Landmine"]}
        first, second, third = _kit("US_AT3"), _kit("US_AT3"), _kit("US_AT3")
        variants = group_variants([
            ("Alpha", [("us_at3", first, landmine, {"Helmet": ("helmet_m1", "h.sm", "")})]),
            ("Bravo", []),
            ("Charlie", [("us_at3", second, {"items": ["M16", "C4"]}, {})]),
            ("Delta", [("us_at3", third, dict(landmine), {"Helmet": ("other", "o.sm", "")})]),
        ])
        self.assertEqual(["us_at3"], list(variants))
        mine, c4 = variants["us_at3"]
        self.assertEqual(["Alpha", "Delta"], mine["levels"])
        self.assertIs(first, mine["kit"])
        self.assertEqual({"Helmet": ("helmet_m1", "h.sm", "")}, mine["geometry"])
        self.assertEqual(["Charlie"], c4["levels"])
        self.assertIs(second, c4["kit"])

    def test_no_level_with_a_kit_of_its_own_gives_nothing(self) -> None:
        self.assertEqual({}, group_variants([("Alpha", []), ("Bravo", [])]))


class PickupFieldsTests(unittest.TestCase):
    """`pickup_fields`: the row's pads binding, and the `pickupOnly` marker a
    deploy list filters (the cola bottles, which only a machine's own
    spawners lay; FHX-34)."""

    def test_a_kit_no_placement_lays_has_no_fields(self) -> None:
        self.assertEqual({}, pickup_fields(_kit("US_Assault")))

    def test_a_kit_a_slot_also_deals_is_not_pickup_only(self) -> None:
        kit = _kit("US_Sniper")
        kit.pads = ["Bravo"]
        kit.slots = [0]
        kit.pickup_soldiers = ["USSoldier"]
        self.assertEqual({"pads": ["Bravo"], "pickupSoldiers": ["USSoldier"]},
                         pickup_fields(kit))

    def test_a_kit_no_slot_anywhere_deals_is_pickup_only(self) -> None:
        kit = _kit("Us_ColaBottleFighter")
        kit.pads = ["stashuv_area", "alaska-1948"]
        kit.pickup_soldiers = ["RussianSoldier", "GermanSoldier"]
        self.assertEqual({"pads": ["alaska-1948", "stashuv_area"],
                          "pickupSoldiers": ["GermanSoldier", "RussianSoldier"],
                          "pickupOnly": True},
                         pickup_fields(kit))


class ItemRowsTests(unittest.TestCase):
    def test_a_rolled_item_lists_its_variants_and_the_rest_their_names(self) -> None:
        # FHSW's Kiew copy of 4German_OfficerMp40: its rolls are its own.
        kit = _kit("4German_OfficerMp40")
        kit.carried = ["Mp40", "RandomP08P38", "Binoculars"]
        kit.random = [kit_mod.RandomItem("RandomP08P38", 3,
                                         ["RandomP08P381", "RandomP08P382", None])]
        self.assertEqual([{"template": "Mp40"},
                          {"template": "RandomP08P38",
                           "variants": ["RandomP08P381", "RandomP08P382", None]},
                          {"template": "Binoculars"}], item_rows(kit))


class _Assembler:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def export(self, name: str):
        from bf42.assemble import Report
        if self.fail:
            raise ValueError("no geometry")
        report = Report(name, "complex", 0)
        report.triangles = 12
        report.missing_textures = ["b", "a", "b"]
        return b"glTF-bytes", report


class BuildThenWritePartTests(unittest.TestCase):
    """A part built where its library is and written where it is wanted."""

    def test_a_built_part_is_written_under_its_stem(self) -> None:
        import contextlib
        import io
        import tempfile
        built = build_part("Helmet", lambda name: _Assembler())
        with tempfile.TemporaryDirectory() as tmp, \
                contextlib.redirect_stderr(io.StringIO()):
            record = write_part("Helmet", built, Path(tmp), stem="Helmet@Arnhem-1944")
            self.assertEqual(b"glTF-bytes",
                             (Path(tmp) / "Helmet@Arnhem-1944.kit.glb").read_bytes())
            self.assertTrue((Path(tmp) / "Helmet@Arnhem-1944.kit.report.json").is_file())
        self.assertEqual({"glb": "Helmet@Arnhem-1944.kit.glb",
                          "report": "Helmet@Arnhem-1944.kit.report.json",
                          "triangles": 12, "texturesResolved": 0,
                          "texturesMissing": ["a", "b"]}, record)

    def test_a_failed_build_is_reported_when_written_and_writes_nothing(self) -> None:
        import contextlib
        import io
        import tempfile
        built = build_part("Helmet", lambda name: _Assembler(fail=True))
        self.assertEqual("no geometry", built)
        log = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(log):
            self.assertIsNone(write_part("Helmet", built, Path(tmp)))
            self.assertEqual([], list(Path(tmp).iterdir()))
        self.assertEqual("  Helmet: no geometry\n", log.getvalue())


class PartPoolsTests(unittest.TestCase):
    """A part a level declares is built with that level's archives behind the
    chain's: 203 Hill's `Rus_RJcap_m2` draws a mesh only the level ships."""

    def test_a_level_declared_part_reads_its_level_s_meshes(self) -> None:
        import tempfile
        from bf42 import con as con_mod
        from bf42.rfa import ArchivePool, write_rfa
        with tempfile.TemporaryDirectory() as tmp:
            mod = Path(tmp) / "Mods" / "FHSWEurope"
            levels = mod / "Archives" / "bf1942" / "levels"
            levels.mkdir(parents=True)
            write_rfa(levels / "203_hill-1904.rfa", {
                "bf1942/levels/203_hill-1904/StandardMesh/Rus_nichirocap2.sm": b"sm"})
            library = con_mod.ObjectLibrary()
            library.objects["rus_rjcap_m2"] = con_mod.ObjectTemplate(
                name="Rus_RJcap_m2", kind="KitPart", geometry="Rus_RJcap2",
                source="bf1942/levels/203_hill-1904/objects/Ruskit/Objects.con")
            library.objects["russian_hippack"] = con_mod.ObjectTemplate(
                name="Russian_hippack", kind="KitPart", geometry="Russian_hippack",
                source="objects/Items/RusKit/Objects.con")
            meshes, textures = ArchivePool(), ArchivePool()
            own_meshes, own_textures = part_pools([mod], library, "Rus_RJcap_m2",
                                                  meshes, textures)
            self.assertEqual("bf1942/levels/203_hill-1904/StandardMesh/Rus_nichirocap2.sm",
                             own_meshes.find("bf1942/levels/203_hill-1904/standardmesh/"
                                             "rus_nichirocap2.sm"))
            self.assertIsNot(meshes, own_meshes)
            self.assertIsNone(meshes.find("bf1942/levels/203_hill-1904/standardmesh/"
                                          "rus_nichirocap2.sm"))
            # A chain part is built from the chain's pools, untouched.
            self.assertEqual((meshes, textures),
                             part_pools([mod], library, "Russian_hippack", meshes, textures))


class PickupHoldersTests(unittest.TestCase):
    """One pickup glb a distinct bag, however many kits drop it (KITDROP-2:
    what lies on the ground is the kit's own geometry)."""

    def _library(self):
        from bf42 import con as con_mod
        library = con_mod.ObjectLibrary()
        for name, source in (("Kit_German_Assault", "objects/Items/Kits/Geometries.con"),
                             ("Kit_Rus_Medic", "bf1942/levels/Kiew/objects/Geometries.con")):
            library.geometries[name.lower()] = con_mod.GeometryTemplate(
                name=name, kind="StandardMesh", file=f"kits/{name}", source=source)
            library.geometry_dir[name.lower()] = source.rsplit("/", 1)[0].lower()
        return library

    def _kit(self, template: str, pickup: str | None,
             source: str = "objects/Items/Kits/Objects.con") -> kit_mod.Kit:
        kit = kit_mod.Kit(template=template, source=source, nation="Germany",
                          kit_class="Assault")
        kit.pickup = pickup
        return kit

    def test_kits_drawing_one_bag_share_its_glb(self) -> None:
        kits = [self._kit("4German_AssaultMp40", "Kit_German_Assault"),
                self._kit("1German_AssaultK98", "Kit_German_Assault"),
                self._kit("NoBag", None)]
        holders, pickup_of = pickup_holders(kits, self._library())
        self.assertEqual(["Kit_German_Assault__pickup"], list(holders))
        self.assertEqual({"4german_assaultmp40": "Kit_German_Assault__pickup",
                          "1german_assaultk98": "Kit_German_Assault__pickup"}, pickup_of)
        holder = holders["Kit_German_Assault__pickup"]
        self.assertEqual(("SimpleObject", "Kit_German_Assault"), (holder.kind, holder.geometry))

    def test_the_holder_is_placed_where_the_geometry_is_declared(self) -> None:
        # A level-declared bag mounts its level (`part_pools`), whichever kit
        # asked; a chain bag stays on the chain even for a level's kit.
        kits = [self._kit("Rus_Medic", "Kit_Rus_Medic"),
                self._kit("LevelKit", "Kit_German_Assault",
                          source="bf1942/levels/Kiew/objects/Objects.con")]
        holders, _ = pickup_holders(kits, self._library())
        self.assertEqual("bf1942/levels/Kiew/objects/Geometries.con",
                         holders["Kit_Rus_Medic__pickup"].source)
        self.assertEqual("objects/Items/Kits/Geometries.con",
                         holders["Kit_German_Assault__pickup"].source)

    def test_an_undeclared_bag_keeps_the_kit_s_source(self) -> None:
        holders, pickup_of = pickup_holders([self._kit("Odd", "Kit_Nowhere")], self._library())
        self.assertEqual({"odd": "Kit_Nowhere__pickup"}, pickup_of)
        self.assertEqual("objects/Items/Kits/Objects.con",
                         holders["Kit_Nowhere__pickup"].source)


class LevelOwnBagTests(unittest.TestCase):
    """A level's own copy of a kit drops the bag the level's load declares
    (LOAD-1, LOAD-2): built while the level is loaded when it draws another
    mesh than the mod's, shared when it draws the same."""

    @staticmethod
    def _library(prefix: str, geometry: str, mesh: str):
        from bf42.con import ObjectLibrary
        library = ObjectLibrary()
        library.add_con(f"{prefix}/Objects.con", f"""
ObjectTemplate.create Kit 1German_Assault
ObjectTemplate.geometry {geometry}
""")
        library.add_con(f"{prefix}/Geometries.con", f"""
GeometryTemplate.create StandardMesh {geometry}
GeometryTemplate.file {mesh}
""")
        return library

    def _run(self, level_library):
        import types
        from extract_kits import _kit_content, level_own_kits
        mod = self._library("objects/Items/Kits", "Kit_A", "kits/kit_a")
        kit = kit_mod.collect(mod)["1german_assault"]
        base = {"1german_assault": _kit_content(kit, mod, lambda path: None)}
        asked = []

        def own_pickup(geometry, drawn, library, source):
            asked.append((geometry, drawn))
            return (b"glb", None)

        load = types.SimpleNamespace(library=level_library, read=lambda path: None,
                                     release=lambda: None)
        return level_own_kits(load, ["1german_assault"], base, None, own_pickup), asked

    def test_a_bag_the_level_redeclares_over_another_mesh_is_built_there(self) -> None:
        level = self._library("bf1942/levels/Kiew/objects", "Kit_A", "kits/kit_a_winter")
        (found, parts), asked = self._run(level)
        self.assertEqual(1, len(found))
        self.assertEqual(("Kit_A", ("kit_a", "kits/kit_a_winter", "bf1942/levels/kiew/objects")),
                         found[0][2]["pickup"])
        self.assertEqual([("Kit_A", ("kit_a", "kits/kit_a_winter",
                                     "bf1942/levels/kiew/objects"))], asked)
        self.assertEqual({"Kit_A__pickup": (b"glb", None)}, parts)

    def test_a_copy_dropping_the_mod_s_bag_is_no_variant(self) -> None:
        level = self._library("objects/Items/Kits", "Kit_A", "kits/kit_a")
        (found, parts), asked = self._run(level)
        self.assertEqual(([], {}, []), (found, parts, asked))


if __name__ == "__main__":
    unittest.main()
