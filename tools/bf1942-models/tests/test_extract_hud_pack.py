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


class IconKeyTests(unittest.TestCase):
    def test_strips_directory_and_extension_and_lowercases(self) -> None:
        self.assertEqual("minimap_icon_tank_16x16",
                          ehp.icon_key("Minimap/minimap_icon_tank_16x16.tga"))

    def test_handles_backslash_separators(self) -> None:
        self.assertEqual("icon_flak38", ehp.icon_key(r"Vehicle\Icon_flak38.tga"))


if __name__ == "__main__":
    unittest.main()
