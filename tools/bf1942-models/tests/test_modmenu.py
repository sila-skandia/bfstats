"""`bf42/modmenu.py` and the mod-aware halves of the five interface extractors.

Two halves, the same way `test_menu_layout.py` splits: what has to hold
against the shipped archives runs against the installed game and is skipped
without it, and what has to hold whatever the archives contain is synthetic.

The property everything here exists to protect is the one in
`features/authentic-spawn-map/README.md` section 8 item 6: a one-mod chain
must behave exactly like opening that one archive, because that is what keeps
a vanilla extraction byte-identical to the one that came before any of this.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_hud_layout as ehl  # noqa: E402
import extract_hud_mods as ehm  # noqa: E402
import extract_hud_pack as ehp  # noqa: E402
import extract_menu_layout as eml  # noqa: E402
from bf42.modmenu import LayeredArchive, MenuSources  # noqa: E402
from bf42.rfa import RfaArchive  # noqa: E402
from extract_models import mod_chain  # noqa: E402
from extract_spawn_layout import load_chain_lexicon, load_lexicon  # noqa: E402

GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
VANILLA_MENU = GAME_DIR / "Mods/bf1942/Archives/menu.rfa"
EOD_MENU = GAME_DIR / "Mods/EoD/archives/menu.rfa"
HAVE_GAME = VANILLA_MENU.exists()
HAVE_EOD = EOD_MENU.exists()


# --------------------------------------------------------------- LayeredArchive

@unittest.skipUnless(HAVE_GAME, "needs the BF1942 install")
class OneArchiveChainTests(unittest.TestCase):
    """A chain of one is that archive: same names, same order, same bytes.

    Everything about vanilla's output being unchanged rests on this.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.plain = RfaArchive(VANILLA_MENU)
        cls.layered = LayeredArchive([VANILLA_MENU], ["bf1942"])

    @classmethod
    def tearDownClass(cls) -> None:
        cls.plain.close()
        cls.layered.close()

    def test_entry_names_and_their_order_are_the_archives_own(self) -> None:
        self.assertEqual(list(self.plain.entries), self.layered.entries)

    def test_reading_gives_the_same_bytes(self) -> None:
        for name in list(self.plain.entries)[:40]:
            self.assertEqual(self.plain.read(name), self.layered.read(name), name)

    def test_lookup_is_case_insensitive_the_way_refractor_is(self) -> None:
        name = next(e for e in self.layered.entries if e.lower() != e)
        self.assertEqual(self.layered.read(name), self.layered.read(name.lower()))

    def test_every_entry_is_owned_by_the_one_mod(self) -> None:
        owners = {self.layered.owner(e) for e in self.layered.entries}
        self.assertEqual({"bf1942"}, owners)


@unittest.skipUnless(HAVE_GAME and HAVE_EOD, "needs the BF1942 install with EoD")
class NearestChildFirstTests(unittest.TestCase):
    """Two archives resolve the way `game.addModPath` does."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.vanilla = RfaArchive(VANILLA_MENU)
        cls.eod = RfaArchive(EOD_MENU)
        cls.layered = LayeredArchive([EOD_MENU, VANILLA_MENU], ["EoD", "bf1942"])

    @classmethod
    def tearDownClass(cls) -> None:
        for arch in (cls.vanilla, cls.eod, cls.layered):
            arch.close()

    def test_a_shared_entry_comes_from_the_nearer_mod(self) -> None:
        # EoD repaints the control-point flags; vanilla's must not win.
        name = "menu/Texture/conp_us.dds"
        self.assertEqual("EoD", self.layered.owner(name))
        self.assertNotEqual(self.vanilla.read(self._real(self.vanilla, name)),
                            self.layered.read(name))

    def test_an_entry_only_vanilla_has_is_still_reachable(self) -> None:
        name = "menu/Texture/conp_can.dds"
        self.assertEqual("bf1942", self.layered.owner(name))
        self.assertEqual(self.vanilla.read(self._real(self.vanilla, name)),
                         self.layered.read(name))

    def test_the_namespace_is_the_union(self) -> None:
        keys = {e.lower() for e in self.layered.entries}
        self.assertTrue({e.lower() for e in self.vanilla.entries} <= keys)
        self.assertTrue({e.lower() for e in self.eod.entries} <= keys)

    def test_the_nearest_archives_entries_come_first_in_its_own_order(self) -> None:
        nearest = [e for e in self.layered.entries
                   if self.layered.owner(e) == "EoD"]
        self.assertEqual(list(self.eod.entries), nearest)

    def test_an_absent_entry_is_absent(self) -> None:
        self.assertNotIn("menu/Texture/conp_nowhere.dds", self.layered)

    @staticmethod
    def _real(arch, name: str) -> str:
        return next(e for e in arch.entries if e.lower() == name.lower())


# ------------------------------------------------------------------ MenuSources

@unittest.skipUnless(HAVE_GAME, "needs the BF1942 install")
class MenuSourcesTests(unittest.TestCase):

    def test_vanilla_is_one_deep(self) -> None:
        sources = MenuSources(mod_chain(GAME_DIR, "bf1942"))
        self.assertEqual("bf1942", sources.mod_id)
        self.assertTrue(sources.is_vanilla)
        self.assertEqual(1, len(sources.menu_paths))
        self.assertEqual(1, len(sources.font_paths))
        self.assertEqual(1, len(sources.lexicon_paths))

    @unittest.skipUnless(HAVE_EOD, "needs EoD")
    def test_a_mod_puts_itself_first_and_vanilla_last(self) -> None:
        sources = MenuSources(mod_chain(GAME_DIR, "EoD"))
        self.assertEqual("eod", sources.mod_id)
        self.assertFalse(sources.is_vanilla)
        self.assertEqual(["EoD", "bf1942"], [d.name for d in sources.chain])
        self.assertEqual(2, len(sources.menu_paths))
        self.assertEqual(2, len(sources.lexicon_paths))

    @unittest.skipUnless(HAVE_EOD, "needs EoD")
    def test_a_mod_with_no_font_rfa_inherits_vanillas_alone(self) -> None:
        # Only five of the installed mods ship a Font.rfa; EoD is not one, so
        # its font chain has to be exactly vanilla's single archive or the
        # console and menu faces would silently change.
        sources = MenuSources(mod_chain(GAME_DIR, "EoD"))
        self.assertEqual([GAME_DIR / "Mods/bf1942/Archives/Font.rfa"],
                         sources.font_paths)

    def test_archives_directory_casing_does_not_matter(self) -> None:
        # EoD and Interstate 82 spell it `archives` (skill section 2).
        for mod in ("EoD", "interstate"):
            if not (GAME_DIR / "Mods" / mod).is_dir():
                continue
            sources = MenuSources(mod_chain(GAME_DIR, mod))
            self.assertTrue(sources.menu_paths, mod)


# --------------------------------------------------------------- sprite renames

class DirGlobRenameRuleTests(unittest.TestCase):
    """The collision rule, not the pair it was derived from."""

    def test_on_vanillas_entries_the_rule_reproduces_sprite_dir_rename(self) -> None:
        if not HAVE_GAME:
            self.skipTest("needs the BF1942 install")
        with RfaArchive(VANILLA_MENU) as arch:
            self.assertEqual(ehp.SPRITE_DIR_RENAME,
                             ehp.dir_glob_renames(list(arch.entries)))

    def test_a_basename_in_one_directory_is_left_alone(self) -> None:
        self.assertEqual({}, ehp.dir_glob_renames([
            "menu/Texture/Ammo/Icon_rifle.dds",
            "menu/Texture/Weapon/Icon_smg.dds",
        ]))

    def test_a_basename_in_two_directories_is_qualified_on_both_sides(self) -> None:
        # EoD files a Molotov under both Ammo/ and Weapon/.
        self.assertEqual(
            {"menu/texture/ammo/molotov.dds": "ammo_molotov",
             "menu/texture/weapon/molotov.dds": "weapon_molotov"},
            ehp.dir_glob_renames(["menu/Texture/Ammo/Molotov.dds",
                                  "menu/Texture/Weapon/Molotov.dds"]))

    def test_casing_of_the_archive_entry_does_not_change_the_name(self) -> None:
        renames = ehp.dir_glob_renames(["MENU/TEXTURE/AMMO/MOLOTOV.DDS",
                                        "menu/texture/weapon/molotov.dds"])
        self.assertEqual({"ammo_molotov", "weapon_molotov"}, set(renames.values()))


# ------------------------------------------------------------ flag mesh nations

class FlagMeshNationTests(unittest.TestCase):
    """`flagMeshNation` maps a control point's flag cloth to the nation whose
    art the pack holds for it."""

    VANILLA = {f"conp_{n}": {} for n in
               ("us", "ger", "brit", "can", "jp", "rus", "neutral")}

    def test_vanillas_table_is_untouched(self) -> None:
        self.assertEqual(ehp.FLAG_MESH_NATION,
                         ehp.flag_mesh_nations(self.VANILLA))

    def test_a_pack_with_its_own_so_art_stops_aliasing_so_to_rus(self) -> None:
        table = ehp.flag_mesh_nations({**self.VANILLA, "conp_so": {}})
        self.assertEqual("so", table["so"])

    def test_road_to_romes_nations_are_added_when_their_art_is_there(self) -> None:
        table = ehp.flag_mesh_nations(
            {**self.VANILLA, "conp_fre": {}, "conp_it": {}})
        self.assertEqual("fre", table["fr"])
        self.assertEqual("it", table["it"])

    def test_a_row_with_no_art_is_not_added(self) -> None:
        self.assertNotIn("fr", ehp.flag_mesh_nations(self.VANILLA))

    def test_every_vanilla_row_survives_a_mod_pack(self) -> None:
        table = ehp.flag_mesh_nations(
            {**self.VANILLA, "conp_fre": {}, "conp_it": {}, "conp_so": {}})
        for code in ehp.FLAG_MESH_NATION:
            self.assertIn(code, table)


# ------------------------------------------------------------------- lexicon

class ChainLexiconTests(unittest.TestCase):
    """A mod's lexicon is an overlay on its parents', not a replacement."""

    def setUp(self) -> None:
        self.dir = Path(__file__).with_name("_lexicon_tmp")
        self.dir.mkdir(exist_ok=True)

    def tearDown(self) -> None:
        for child in self.dir.iterdir():
            child.unlink()
        self.dir.rmdir()

    def write(self, name: str, records: list[tuple[str, str]]) -> Path:
        """A `lexiconAll.dat`: u32 count, u32 columns, then per record a key
        and one UTF-16LE NUL-terminated string per language."""
        blob = bytearray()
        blob += len(records).to_bytes(4, "little")
        blob += (2).to_bytes(4, "little")
        for key, value in records:
            for text in (key, value):
                blob += text.encode("utf-16-le") + b"\0\0"
        path = self.dir / name
        path.write_bytes(bytes(blob))
        return path

    def test_a_near_record_wins_and_the_rest_are_inherited(self) -> None:
        vanilla = self.write("vanilla.dat",
                             [("RESPAWN_AXIS", "AXIS"), ("RESPAWN_MEDIC", "MEDIC")])
        mod = self.write("mod.dat", [("RESPAWN_AXIS", "North Vietnam")])
        merged = load_chain_lexicon([mod, vanilla])
        self.assertEqual("North Vietnam", merged["RESPAWN_AXIS"])
        self.assertEqual("MEDIC", merged["RESPAWN_MEDIC"])

    def test_a_key_only_the_mod_has_comes_through(self) -> None:
        vanilla = self.write("vanilla.dat", [("A", "a")])
        mod = self.write("mod.dat", [("B", "b")])
        self.assertEqual({"A": "a", "B": "b"}, load_chain_lexicon([mod, vanilla]))

    def test_a_one_file_chain_is_that_file(self) -> None:
        only = self.write("only.dat", [("A", "a"), ("B", "b")])
        self.assertEqual(load_lexicon(only), load_chain_lexicon([only]))

    def test_keep_first_is_passed_through_to_each_file(self) -> None:
        # `keep="first"` is what the level-title index needs: within one file
        # the earlier of two records under the same key wins.
        path = self.write("dup.dat", [("Omaha_Beach", "OMAHA BEACH"),
                                      ("Omaha_Beach", "Omaha Beach")])
        self.assertEqual("OMAHA BEACH",
                         load_chain_lexicon([path], keep="first")["Omaha_Beach"])
        self.assertEqual("Omaha Beach", load_chain_lexicon([path])["Omaha_Beach"])

    def test_no_lexicon_anywhere_is_an_empty_table_not_a_crash(self) -> None:
        self.assertEqual({}, load_chain_lexicon([]))


# ---------------------------------------------------------------- hud notes

class HudLayoutNoteTests(unittest.TestCase):
    """`hud-layout.json`'s last note turns on whose archive answered, which is
    what lets a mod that ships no menu/InGame of its own come out
    byte-identical to vanilla and so carry no hud-layout.json at all."""

    def test_vanillas_notes_are_the_constant_itself(self) -> None:
        self.assertIs(ehl.NOTES, ehl.notes_for("bf1942"))

    def test_a_mod_that_ships_its_own_ingame_replaces_the_last_note(self) -> None:
        notes = ehl.notes_for("EoD")
        self.assertEqual(len(ehl.NOTES), len(notes))
        self.assertEqual(ehl.NOTES[:-1], notes[:-1])
        self.assertEqual(ehl.MOD_NOTE, notes[-1])

    def test_the_owner_is_matched_case_insensitively(self) -> None:
        self.assertIs(ehl.NOTES, ehl.notes_for("BF1942"))


# ------------------------------------------------------------- the pack builder

class VanillaTwinTests(unittest.TestCase):
    """Which vanilla file a pack-relative path is compared against."""

    HUD = Path("/v/maps/_shared/hud")
    FONTS = Path("/v/fonts")

    def test_a_sprite_maps_into_the_vanilla_pack(self) -> None:
        self.assertEqual(self.HUD / "conp_us.png",
                         ehm.vanilla_twin(Path("conp_us.png"), self.HUD, self.FONTS))

    def test_a_nested_menu_file_keeps_its_subpath(self) -> None:
        self.assertEqual(
            self.HUD / "menu/textures/background.png",
            ehm.vanilla_twin(Path("menu/textures/background.png"),
                             self.HUD, self.FONTS))

    def test_the_console_face_maps_out_to_viewer_fonts(self) -> None:
        # Vanilla's console font lives outside the pack, in the half of the
        # viewer tree that is baked into the image.
        self.assertEqual(
            self.FONTS / "bf1942.png",
            ehm.vanilla_twin(Path("console/bf1942.png"), self.HUD, self.FONTS))


class DifferingFilesTests(unittest.TestCase):
    """Only the files that actually differ end up in a mod's pack."""

    def setUp(self) -> None:
        self.root = Path(__file__).with_name("_pack_tmp")
        self.staging = self.root / "staging"
        self.vanilla = self.root / "vanilla"
        self.fonts = self.root / "fonts"
        for d in (self.staging, self.vanilla, self.fonts):
            d.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        for path in sorted(self.root.rglob("*"), reverse=True):
            path.unlink() if path.is_file() else path.rmdir()
        self.root.rmdir()

    def write(self, base: Path, rel: str, text: str) -> None:
        path = base / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def test_identical_bytes_are_left_out(self) -> None:
        self.write(self.staging, "hud.json", "same")
        self.write(self.vanilla, "hud.json", "same")
        self.assertEqual(([], 1),
                         ehm.differing_files(self.staging, self.vanilla, self.fonts))

    def test_differing_bytes_are_kept(self) -> None:
        self.write(self.staging, "conp_us.png", "mod")
        self.write(self.vanilla, "conp_us.png", "vanilla")
        changed, same = ehm.differing_files(self.staging, self.vanilla, self.fonts)
        self.assertEqual(["conp_us.png"], changed)
        self.assertEqual(0, same)

    def test_a_file_vanilla_does_not_have_at_all_is_kept(self) -> None:
        self.write(self.staging, "conp_fre.png", "new")
        changed, _ = ehm.differing_files(self.staging, self.vanilla, self.fonts)
        self.assertEqual(["conp_fre.png"], changed)

    def test_paths_are_posix_and_relative_to_the_pack(self) -> None:
        self.write(self.staging, "menu/textures/background.png", "mod")
        self.write(self.vanilla, "menu/textures/background.png", "vanilla")
        changed, _ = ehm.differing_files(self.staging, self.vanilla, self.fonts)
        self.assertEqual(["menu/textures/background.png"], changed)

    def test_the_console_face_is_compared_against_viewer_fonts(self) -> None:
        self.write(self.staging, "console/bf1942.json", "same")
        (self.fonts / "bf1942.json").write_text("same")
        self.assertEqual(([], 1),
                         ehm.differing_files(self.staging, self.vanilla, self.fonts))


class SpriteDiffTests(unittest.TestCase):
    """The measurement the pack manifest records: overridden vs added vs
    inherited."""

    def setUp(self) -> None:
        self.root = Path(__file__).with_name("_diff_tmp")
        self.staging = self.root / "staging"
        self.vanilla = self.root / "vanilla"
        for d in (self.staging, self.vanilla):
            d.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        for path in sorted(self.root.rglob("*"), reverse=True):
            path.unlink() if path.is_file() else path.rmdir()
        self.root.rmdir()

    def pack(self, base: Path, sprites: dict[str, str]) -> None:
        manifest = {name: {"file": f"{name}.png"} for name in sprites}
        (base / "hud.json").write_text(json.dumps({"sprites": manifest}))
        for name, body in sprites.items():
            (base / f"{name}.png").write_text(body)

    def test_same_name_different_bytes_counts_as_overridden(self) -> None:
        self.pack(self.vanilla, {"conp_us": "ww2"})
        self.pack(self.staging, {"conp_us": "vietnam"})
        diff = ehm.sprite_diff(self.staging, self.vanilla)
        self.assertEqual(["conp_us"], diff["overridden"])
        self.assertEqual(0, diff["added"])
        self.assertEqual(0, diff["inherited"])

    def test_same_name_same_bytes_counts_as_inherited(self) -> None:
        self.pack(self.vanilla, {"conp_us": "ww2"})
        self.pack(self.staging, {"conp_us": "ww2"})
        diff = ehm.sprite_diff(self.staging, self.vanilla)
        self.assertEqual([], diff["overridden"])
        self.assertEqual(1, diff["inherited"])

    def test_a_new_name_counts_as_added(self) -> None:
        self.pack(self.vanilla, {"conp_us": "ww2"})
        self.pack(self.staging, {"conp_us": "ww2", "conp_fre": "france"})
        diff = ehm.sprite_diff(self.staging, self.vanilla)
        self.assertEqual(1, diff["added"])
        self.assertEqual(2, diff["total"])

    def test_a_sprite_the_mod_lost_is_reported(self) -> None:
        self.pack(self.vanilla, {"conp_us": "ww2", "conp_can": "canada"})
        self.pack(self.staging, {"conp_us": "ww2"})
        self.assertEqual(["conp_can"],
                         ehm.sprite_diff(self.staging, self.vanilla)["dropped"])


# ------------------------------------------------------------------ menu levels

class LevelFlagTests(unittest.TestCase):
    """Which nation flags the Instant Battle screen has to carry is a
    property of the level list, so a mod's own nations come across."""

    def test_both_sides_of_every_level_are_collected(self) -> None:
        levels = {"levels": [
            {"axis": {"flag": "icon_flag_ger"}, "allied": {"flag": "icon_flag_us"}},
            {"axis": {"flag": "icon_flag_it"}, "allied": {"flag": "icon_flag_fre"}},
        ]}
        self.assertEqual(
            {"icon_flag_ger", "icon_flag_us", "icon_flag_it", "icon_flag_fre"},
            eml.level_flags(levels))

    def test_a_level_with_no_nation_contributes_nothing(self) -> None:
        levels = {"levels": [{"axis": {"skin": "PathetLaosSoldier", "flag": None}}]}
        self.assertEqual(set(), eml.level_flags(levels))

    def test_an_empty_list_is_an_empty_set(self) -> None:
        self.assertEqual(set(), eml.level_flags({}))


class SkinNationTests(unittest.TestCase):
    """The mod team skins were matched to nations from the flags their own
    levels fly, not from their names -- Eve of Destruction's armies map onto
    vanilla's nation *codes* because EoD repaints the art in those slots."""

    def test_the_vietnam_era_armies_use_the_repainted_vanilla_slots(self) -> None:
        self.assertEqual("ger", eml.SKIN_NATION["nvasoldier"])
        self.assertEqual("jp", eml.SKIN_NATION["vietcongsoldier"])
        self.assertEqual("brit", eml.SKIN_NATION["arvnforces"])
        self.assertEqual("us", eml.SKIN_NATION["specialforces"])

    def test_road_to_rome_and_secret_weapons_use_their_own(self) -> None:
        self.assertEqual("it", eml.SKIN_NATION["italiansoldier"])
        self.assertEqual("fre", eml.SKIN_NATION["frenchsoldier"])
        self.assertEqual("brit", eml.SKIN_NATION["britishcommandosoldier"])

    def test_an_army_with_no_flag_art_anywhere_stays_off_the_table(self) -> None:
        # `flagpl_m1` on 11 EoD control points, and no `conp_pl` ships in any
        # installed menu.rfa; a made-up row would be worse than the warning.
        self.assertNotIn("pathetlaossoldier", eml.SKIN_NATION)

    def test_every_key_is_lowercased_because_lookup_lowercases(self) -> None:
        for key in eml.SKIN_NATION:
            self.assertEqual(key, key.lower())


if __name__ == "__main__":
    unittest.main()
