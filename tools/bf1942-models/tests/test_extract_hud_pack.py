from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_hud_pack as ehp  # noqa: E402


class SpriteRefTests(unittest.TestCase):
    """`ref` is what `menu/InGame` and the `.con` data actually spell for a
    sprite — Title Case, `.tga` — kept next to `source` (the real, lower-case
    `.dds` archive entry) so a reader can tell the two apart without
    re-deriving one from the other."""

    def test_ref_from_a_sprites_list_stem_drops_the_texture_prefix(self) -> None:
        self.assertEqual(
            "Ingame/Healthbar_full_scout_64x64.tga",
            ehp.sprite_ref("Texture/Ingame/Healthbar_full_scout_64x64"),
        )

    def test_ref_from_a_stem_with_no_subdirectory(self) -> None:
        self.assertEqual("Icon_flag.tga", ehp.sprite_ref("Texture/Icon_flag"))

    def test_ref_from_an_archive_entry_keeps_its_real_casing(self) -> None:
        self.assertEqual(
            "Ammo/icon_demokit.tga",
            ehp.sprite_ref_from_entry("menu/Texture/Ammo/icon_demokit.dds"),
        )

    def test_ref_from_an_entry_is_case_insensitive_about_the_texture_prefix(self) -> None:
        self.assertEqual(
            "Vehicle/icon_sherman.tga",
            ehp.sprite_ref_from_entry("MENU/TEXTURE/Vehicle/icon_sherman.dds"),
        )

    def test_ref_from_an_entry_outside_menu_texture_is_returned_whole(self) -> None:
        # Never seen in practice (every SPRITE_DIR_GLOBS entry lives under
        # menu/Texture/) but must not raise or silently truncate.
        self.assertEqual("odd/place/x.tga", ehp.sprite_ref_from_entry("odd/place/x.dds"))


class SpriteDirRenameTests(unittest.TestCase):
    """The one known basename collision across the wildcard directories
    (Ammo/Icon_demokit.dds vs Weapon/Icon_demokit.dds — different images,
    checked by hash) must stay resolved to two distinct, stable names."""

    def test_demokit_collision_is_disambiguated_both_ways(self) -> None:
        self.assertEqual(
            {"ammo_icon_demokit", "weapon_icon_demokit"},
            set(ehp.SPRITE_DIR_RENAME.values()),
        )

    def test_rename_keys_are_lowercased_full_entry_paths(self) -> None:
        for key in ehp.SPRITE_DIR_RENAME:
            self.assertEqual(key, key.lower())
            self.assertTrue(key.startswith("menu/texture/"))


class SpritesListTests(unittest.TestCase):
    """`SPRITES` is keyed by lowercased basename with no further
    qualification (task instruction: add new entries "the same way"), so it
    must not itself contain two stems whose basenames collide — the loader
    would silently keep only the second."""

    def test_no_two_stems_share_a_lowercased_basename(self) -> None:
        seen: dict[str, str] = {}
        dupes = []
        for stem in ehp.SPRITES:
            base = Path(stem).name.lower()
            if base in seen and seen[base] != stem:
                dupes.append((seen[base], stem))
            seen.setdefault(base, stem)
        self.assertEqual([], dupes)

    def test_sprite_dir_globs_do_not_overlap_the_explicit_sprites_list(self) -> None:
        explicit = {Path(s).name.lower() for s in ehp.SPRITES}
        # The wildcard directories are asserted (in the docstring above the
        # constant) to be taken in full; if a future edit adds one of their
        # basenames to SPRITES too, extract_sprites() would raise on the
        # resulting collision at run time — catch it here instead.
        for prefix in ehp.SPRITE_DIR_GLOBS:
            self.assertNotIn(prefix.lower(), (p.lower() for p in ehp.SPRITES))


class _StubMenu:
    """The slice of the layered menu view `extract_sprites` needs."""

    labels = ["test"]

    def __init__(self, entries: list[str]) -> None:
        self.entries = entries

    def read(self, entry: str) -> bytes:
        return b"raw entry bytes"


class EditorDroppingSkipTests(unittest.TestCase):
    """Pirates, interstate and FinnWars ship Windows editor droppings inside
    the `SPRITE_DIR_GLOBS` directories of their `menu.rfa` — `Thumbs.db` in
    ten directories across the three, FinnWars also `Kits/ger_MG42.xcf` and
    `Kits/varjo.png`. The glob loops must leave every non-`.dds`/`.tga`
    entry alone: the decoder is chosen by extension (`decode_tga` for
    anything that is not `.dds`), so a `Thumbs.db` reached `decode_tga`,
    whose OLE compound-file signature byte read as TGA image type 17, and
    the whole pack aborted (2026-09-25)."""

    ENTRIES = [
        "menu/Texture/Soldier/Icon_Scout.dds",
        "menu/Texture/Ammo/Thumbs.db",
        "menu/Texture/Kits/ger_MG42.xcf",
        "menu/Texture/Kits/varjo.png",
        "menu/Texture/Vehicle/Icon_Willy.tga",
        "menu/Texture/Thumbs.db",
    ]

    def test_junk_entries_are_skipped_and_images_still_decoded(self) -> None:
        menu = _StubMenu(self.ENTRIES)
        originals = {name: getattr(ehp, name)
                     for name in ("decode_dds", "decode_tga", "encode_png")}
        try:
            ehp.decode_dds = lambda raw: (1, 1, bytes(4))
            ehp.decode_tga = lambda raw: (2, 2, bytes(16))
            ehp.encode_png = lambda w, h, rgba, drop_alpha=True: b"png"
            with tempfile.TemporaryDirectory() as tmp:
                manifest = ehp.extract_sprites(menu, Path(tmp), force=False)
        finally:
            for name, fn in originals.items():
                setattr(ehp, name, fn)
        self.assertEqual({"icon_scout", "icon_willy"}, set(manifest))
        self.assertEqual({"icon_scout": [1, 1], "icon_willy": [2, 2]},
                         {k: v["size"] for k, v in manifest.items()})
        self.assertEqual(["menu/Texture/Soldier/Icon_Scout.dds",
                          "menu/Texture/Vehicle/Icon_Willy.tga"],
                         [v["source"] for v in manifest.values()])


GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


@unittest.skipUnless((GAME_DIR / "Mods/DesertCombat").is_dir(), "needs Desert Combat installed")
class SelectButtonPlateTests(unittest.TestCase):
    """The kit-row plates Desert Combat's `BfSelectButtonNode`s name are
    taken from its `menu/InGame`, not listed, so they come into exactly the
    packs whose layout draws them."""

    @staticmethod
    def plates(mod: str) -> list[str]:
        from extract_models import mod_chain
        from bf42.modmenu import MenuSources
        with MenuSources(mod_chain(GAME_DIR, mod)).open_menu() as menu:
            return ehp.select_button_plates(menu)

    def test_desert_combat_and_dc_final_take_the_three_row_plates(self) -> None:
        want = [f"Texture/Ingame/respawn/respawn_middle_256x128{s}" for s in ("", "_MO", "_CL")]
        self.assertEqual(want, self.plates("DesertCombat"))
        if (GAME_DIR / "Mods/DC_Final").is_dir():
            self.assertEqual(want, self.plates("DC_Final"))

    def test_vanilla_takes_none(self) -> None:
        self.assertEqual([], self.plates("bf1942"))

    @unittest.skipUnless((GAME_DIR / "Mods/Pirates").is_dir(), "needs Pirates installed")
    def test_pirates_ships_the_files_but_draws_no_select_row(self) -> None:
        self.assertEqual([], self.plates("Pirates"))


class _BytesMenu(_StubMenu):
    """`_StubMenu` whose entries all decode (the decoders are stubbed)."""


def _sprites(entries, referenced=()):
    menu = _BytesMenu(entries)
    originals = {name: getattr(ehp, name)
                 for name in ("decode_dds", "decode_tga", "encode_png")}
    try:
        ehp.decode_dds = lambda raw: (16, 16, bytes(16 * 16 * 4))
        ehp.decode_tga = lambda raw: (16, 16, bytes(16 * 16 * 4))
        ehp.encode_png = lambda w, h, rgba, drop_alpha=True: b"png"
        with tempfile.TemporaryDirectory() as tmp:
            return ehp.extract_sprites(menu, Path(tmp), force=False,
                                       referenced=referenced)
    finally:
        for name, fn in originals.items():
            setattr(ehp, name, fn)


class MinimapIconGlobTests(unittest.TestCase):
    """A mod's own `minimap_icon_*` files come into its pack; Desert Combat's
    helicopters and jets drew the vehicle dot without them (audit H1)."""

    def test_a_mods_own_icons_are_taken(self) -> None:
        manifest = _sprites([
            "MENU/Texture/Minimap/minimap_icon_heli1_16x16.dds",
            "MENU/Texture/Minimap/minimap_icon_nimitz_64x64.dds",
        ])
        self.assertIn("minimap_icon_heli1_16x16", manifest)
        self.assertEqual("Minimap/minimap_icon_nimitz_64x64.tga",
                         manifest["minimap_icon_nimitz_64x64"]["ref"])

    def test_only_the_prefix_and_only_the_directory_root(self) -> None:
        manifest = _sprites([
            "menu/Texture/Minimap/map_medic.dds",
            "menu/Texture/Minimap/artillery_minimap_camview_128x128.dds",
            "menu/Texture/Minimap/Deeper/minimap_icon_x_16x16.dds",
            "menu/Texture/Minimap/Thumbs.db",
        ])
        self.assertEqual({}, manifest)


class ReferencedTextureTests(unittest.TestCase):
    """The weapons' `setScopeIcon`/`setSightIcon` pictures, resolved under
    `menu/Texture/` the way the engine's loader does (0x00664aa0)."""

    def test_named_textures_are_taken_whatever_the_extension_says(self) -> None:
        manifest = _sprites(["MENU/Texture/m25_scope.dds", "MENU/Texture/scope_blank.dds"],
                            referenced=["m25_scope.tga", "scope_blank", "not_shipped.tga"])
        self.assertEqual(["m25_scope", "scope_blank"], sorted(manifest))
        self.assertEqual("MENU/Texture/m25_scope.dds", manifest["m25_scope"]["source"])

    def test_a_name_already_in_the_pack_keeps_its_entry(self) -> None:
        manifest = _sprites(["menu/Texture/sniper.tga"], referenced=["sniper.tga"])
        self.assertEqual("sniper.tga", manifest["sniper"]["ref"])


SOLDIER_CON = """
ObjectTemplate.create Soldier IraqSoldier
ObjectTemplate.setSoldierStandingIcon "Soldier/Icon_ger_soldier_standing.tga"
ObjectTemplate.setSoldierCrouchIcon "Soldier/Icon_ger_soldier_crouching.tga"
ObjectTemplate.setSoldierProneIcon "Soldier/Icon_ger_soldier_lying.tga"
ObjectTemplate.setMinimapIcon "flag_ger.tga"
ObjectTemplate.setControlPointIcon "conp_ger.tga"
ObjectTemplate.setTicketIcon "flag_ticket_ger.tga"
ObjectTemplate.setTeamFlagIcon "Icon_flag_ger.tga"
ObjectTemplate.create Kit Iraq_Assault
ObjectTemplate.setMinimapIcon "flag_ger.tga"
ObjectTemplate.create HandFireArms M25Sniper
ObjectTemplate.useScope 1
ObjectTemplate.setScopeIcon "m25_scope.tga"
ObjectTemplate.setSightIcon "scope_blank.tga"
ObjectTemplate.setSniperSight 0
ObjectTemplate.create HandFireArms Mp5
ObjectTemplate.useScope 0
"""


class TemplateTableTests(unittest.TestCase):
    def test_soldier_icons_carry_their_nation(self) -> None:
        soldiers = ehp.soldier_icons_in([SOLDIER_CON])
        self.assertEqual(["iraqsoldier"], list(soldiers))
        self.assertEqual({
            "standing": "Soldier/Icon_ger_soldier_standing.tga",
            "crouch": "Soldier/Icon_ger_soldier_crouching.tga",
            "prone": "Soldier/Icon_ger_soldier_lying.tga",
            "minimap": "flag_ger.tga", "controlPoint": "conp_ger.tga",
            "ticket": "flag_ticket_ger.tga", "teamFlag": "Icon_flag_ger.tga",
            "nation": "ger"}, soldiers["iraqsoldier"])

    def test_scope_map_takes_only_weapons_with_a_picture(self) -> None:
        self.assertEqual({"m25sniper": {"useScope": True, "sniperSight": False,
                                        "scopeIcon": "m25_scope.tga",
                                        "sightIcon": "scope_blank.tga"}},
                         ehp.scope_map_in([SOLDIER_CON]))

    def test_icon_nation(self) -> None:
        self.assertEqual("ger", ehp.icon_nation("conp_ger.tga"))
        self.assertEqual("brit", ehp.icon_nation("flag_ticket_brit.dds"))
        self.assertEqual("us", ehp.icon_nation("Icon_flag_us.tga"))
        self.assertIsNone(ehp.icon_nation("Soldier/Icon_us_soldier_standing.tga"))


@unittest.skipUnless((GAME_DIR / "Mods/DesertCombat").is_dir(), "needs Desert Combat installed")
class InstalledTemplateTableTests(unittest.TestCase):
    """Read off this PC's archives."""

    @staticmethod
    def chain(mod: str):
        from extract_models import mod_chain
        return mod_chain(GAME_DIR, mod)

    def test_desert_combats_armies_fly_their_own_art(self) -> None:
        soldiers = ehp.extract_soldier_icons(self.chain("DesertCombat"))
        self.assertEqual("ger", soldiers["iraqsoldier"]["nation"])
        self.assertEqual("us", soldiers["ussoldier"]["nation"])

    def test_every_vanilla_soldier_names_one_nation_in_all_three_icons(self) -> None:
        for name, entry in ehp.extract_soldier_icons(self.chain("bf1942")).items():
            codes = {ehp.icon_nation(entry.get(k)) for k in ("controlPoint", "ticket", "teamFlag")}
            self.assertEqual({entry["nation"]}, codes, name)

    def test_desert_combats_optics(self) -> None:
        scopes = ehp.extract_scope_map(self.chain("DesertCombat"))
        for weapon in ("m25sniper", "m82sniper", "tabuksniper", "vss", "car-15",
                       "rpg7", "smaw", "ak47gp30", "m203"):
            self.assertIn(scopes[weapon]["sightIcon"], ("scope_blank.tga", "scope_blank"), weapon)
            self.assertFalse(scopes[weapon]["sniperSight"], weapon)
        self.assertEqual("binocular.tga", scopes["binoculars"]["scopeIcon"])

    def test_level_local_icons_are_per_level_and_drawable(self) -> None:
        from extract_models import mod_chain
        chain = mod_chain(GAME_DIR, "DesertCombat")
        icons = ehp.extract_icon_map(chain)
        sprites = {name: {} for name in ("minimap_icon_nimitz_64x64", "minimap_icon_none",
                                          "minimap_icon_stationary_16x16",
                                          "minimap_icon_plane_16x16",
                                          "minimap_icon_aircraft_carrier_64x64",
                                          "minimap_icon_tank_16x16")}
        levels = ehp.extract_level_icon_map(GAME_DIR, chain, icons, sprites)
        self.assertEqual({"icon": "minimap_icon_nimitz_64x64", "size": 64},
                         levels["dc_urban_siege"]["nimitz_static_heli_urbs"])
        # No Fly Zone's buildings name pictures no menu archive holds, so no
        # level carries them.
        self.assertNotIn("dc_no_fly_zone", levels)


class IconKeyTests(unittest.TestCase):
    def test_strips_directory_and_extension_and_lowercases(self) -> None:
        self.assertEqual("minimap_icon_tank_16x16",
                          ehp.icon_key("Minimap/minimap_icon_tank_16x16.tga"))

    def test_handles_backslash_separators(self) -> None:
        self.assertEqual("icon_flak38", ehp.icon_key(r"Vehicle\Icon_flak38.tga"))


if __name__ == "__main__":
    unittest.main()
