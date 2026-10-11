"""The vehicle HUD's pictures (VHUD-13, VHUD-14).

A vehicle's `Vehicle/Icon*.tga` can live in a level archive's own
`Menu/Texture/` and in no `menu.rfa`; the sprite pack used to be read from the
menu chain alone, so the HUD drew the layout's literal `Icon_defgun` -- the
flak gun -- for the Secret Weapons Flettner, Greyhound, Krupp, M4A1, munitions
Panzer and rocket station. These tests hold the extractor to reading level
art, keep the level's own vehicle HUD words (Kasserine Pass's `Icon_shermank`)
and run the census over the installed trees: every picture a template names
must resolve in its tree's pack.
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import census_vehicle_icons as census  # noqa: E402
import extract_hud_pack as ehp  # noqa: E402
from bf42.rfa import write_rfa  # noqa: E402

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


def _fake_game(tmp: Path, level_files: dict[str, dict[str, bytes]]) -> tuple[Path, list[Path]]:
    """A one-mod install whose level archives hold `level_files`
    (level name -> archive path -> bytes)."""
    mod = tmp / "Mods" / "bf1942"
    levels = mod / "Archives" / "bf1942" / "levels"
    levels.mkdir(parents=True)
    for level, files in level_files.items():
        write_rfa(levels / f"{level}.rfa", files)
    return tmp, [mod]


class SpriteKeyTests(unittest.TestCase):
    def test_a_path_resolves_dir_qualified_first_then_bare(self) -> None:
        self.assertEqual(["vehicle_iconflettner", "iconflettner"],
                         ehp.sprite_key_candidates("Vehicle/iconFlettner.tga"))
        self.assertEqual(["ammo_icon_demokit", "icon_demokit"],
                         ehp.sprite_key_candidates("Ammo\\Icon_demokit.tga"))
        self.assertEqual(["sniper"], ehp.sprite_key_candidates("sniper.tga"))


class CollectLevelArtTests(unittest.TestCase):
    def test_a_levels_menu_textures_are_found_and_its_loading_screen_is_not(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            game, chain = _fake_game(Path(tmp), {"Raid": {
                "Bf1942/Levels/Raid/Menu/Texture/Vehicle/IconFlettner.dds": b"a",
                "Bf1942/Levels/Raid/Menu/Texture/Minimap/minimap_icon_Flettner.dds": b"b",
                "Bf1942/Levels/Raid/Menu/Texture/Load/Loading_Screen.tga": b"c",
                "Bf1942/Levels/Raid/Menu/Texture/Vehicle/Thumbs.db": b"d",
                "Bf1942/Levels/Raid/Objects/Objects.con": b"e",
            }})
            art = ehp.collect_level_art(game, chain)
            self.assertEqual(["Minimap/minimap_icon_Flettner.dds", "Vehicle/IconFlettner.dds"],
                             [a.rel for a in art])
            flettner = art[1]
            self.assertEqual("Raid", flettner.level)
            self.assertEqual("iconflettner", flettner.name)
            self.assertEqual("Vehicle/IconFlettner.tga", flettner.ref)
            self.assertEqual(b"a", flettner.read())


def _extract(art, menu_entries=()):
    """`extract_sprites` with the decoders stubbed: each file decodes to a
    4x4 image whose single byte is its first raw byte."""
    class Menu:
        labels = ["test"]
        entries = list(menu_entries)

        @staticmethod
        def read(entry):
            return b"M" + entry.encode()

    names = ("decode_dds", "decode_tga", "encode_png")
    originals = {n: getattr(ehp, n) for n in names}
    try:
        ehp.decode_dds = lambda raw: (4, 4, bytes([raw[0]]) * 64)
        ehp.decode_tga = lambda raw: (4, 4, bytes([raw[0]]) * 64)
        ehp.encode_png = lambda w, h, rgba, drop_alpha=True: b"png"
        with tempfile.TemporaryDirectory() as tmp:
            return ehp.extract_sprites(Menu, Path(tmp), force=False, level_art=art)
    finally:
        for n, fn in originals.items():
            setattr(ehp, n, fn)


class _Art(ehp.LevelArt):
    def __init__(self, level, rel, raw):
        super().__init__(level, f"bf1942/levels/{level}/Menu/Texture/{rel}", rel, Path("x"))
        self._raw = raw

    def read(self):
        return self._raw


class LevelArtInSpritesTests(unittest.TestCase):
    def test_level_art_joins_the_pack_under_its_lowercased_basename(self) -> None:
        manifest = _extract([_Art("Raid", "Vehicle/IconFlettner.dds", b"\x01")])
        self.assertEqual({"iconflettner"}, set(manifest))
        self.assertEqual("Vehicle/IconFlettner.tga", manifest["iconflettner"]["ref"])
        self.assertEqual("Raid", manifest["iconflettner"]["level"])

    def test_the_menu_chain_keeps_a_name_it_already_holds(self) -> None:
        # Liberation of Caen re-ships vanilla's `icon_pak40`: not news.
        manifest = _extract(
            [_Art("Caen", "Vehicle/icon_pak40.dds", b"M")],
            menu_entries=["menu/Texture/Vehicle/icon_pak40.dds"])
        self.assertEqual("menu/Texture/Vehicle/icon_pak40.dds", manifest["icon_pak40"]["source"])
        self.assertNotIn("level", manifest["icon_pak40"])

    def test_a_different_picture_in_another_directory_is_filed_qualified(self) -> None:
        # Raid's `Ammo/Icon_Landmine` against the menu's `Weapon/icon_landmine`.
        manifest = _extract(
            [_Art("Raid", "Ammo/Icon_Landmine.dds", b"\x07")],
            menu_entries=["menu/Texture/Weapon/icon_landmine.dds"])
        self.assertEqual({"icon_landmine", "ammo_icon_landmine"}, set(manifest))
        self.assertEqual("Ammo/Icon_Landmine.tga", manifest["ammo_icon_landmine"]["ref"])
        # and hud.js looks the qualified name up first
        self.assertEqual("ammo_icon_landmine",
                         ehp.sprite_key_candidates("Ammo/Icon_Landmine.tga")[0])

    def test_a_different_picture_in_the_same_directory_is_dropped(self) -> None:
        manifest = _extract(
            [_Art("Raid", "Vehicle/icon_willy.dds", b"\x07")],
            menu_entries=["menu/Texture/Vehicle/icon_willy.dds"])
        self.assertEqual("menu/Texture/Vehicle/icon_willy.dds", manifest["icon_willy"]["source"])
        self.assertEqual({"icon_willy"}, set(manifest))


class LevelVehicleHudTests(unittest.TestCase):
    SHERMAN = (
        "ObjectTemplate.create PlayerControlObject Sherman\n"
        'ObjectTemplate.setVehicleIcon "Vehicle/Icon_shermank.tga"\n'
        "ObjectTemplate.setVehicleIconPos 58/100\n"
        "ObjectTemplate.create PlayerControlObject shermanBrowning_PCO1\n"
        'ObjectTemplate.setVehicleIcon "Vehicle/Icon_shermank.tga"\n'
        "ObjectTemplate.setVehicleIconPos 36/64\n"
        "ObjectTemplate.create PlayerControlObject LevelOnly\n"
        'ObjectTemplate.setVehicleIcon "Vehicle/Icon_shermank.tga"\n'
        "ObjectTemplate.create PlayerControlObject Willy\n"
        'ObjectTemplate.setVehicleIcon "Vehicle/Icon_BritJeep.tga"\n'
        "ObjectTemplate.setNumberOfWeaponIcons 1\n"
        'ObjectTemplate.setPrimaryAmmoIcon "Ammo/Icon_75mm.tga"\n'
        "ObjectTemplate.setPrimaryAmmoBar ABAmmoBarHeatBar\n"
        "ObjectTemplate.setCrossHairType CHTCrossHair\n"
    )

    def test_words_are_read_per_template(self) -> None:
        got = ehp.vehicle_hud_in([self.SHERMAN])
        self.assertEqual({"vehicleIcon": "Vehicle/Icon_shermank.tga",
                          "vehicleIconPos": [58.0, 100.0]}, got["sherman"])
        self.assertEqual([36.0, 64.0], got["shermanbrowning_pco1"]["vehicleIconPos"])

    def test_a_level_never_adds_a_weapon_panel_the_model_has_no_gun_for(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            game, chain = _fake_game(Path(tmp), {"Raid": {
                "bf1942/levels/Raid/Objects/Willy/Objects.con": self.SHERMAN.encode(),
            }})
            global_hud = {
                # the chain's jeep has no gun on that seat: `ABNone`/`CHTNone`
                # and no ammo picture
                "willy": {"vehicleIcon": "Vehicle/Icon_willy.tga",
                          "primaryAmmoBar": "ABNone", "crossHairType": "CHTNone"},
            }
            got = ehp.extract_level_vehicle_hud(
                game, chain, global_hud, {"icon_britjeep": {}, "icon_75mm": {}})
            self.assertEqual({"raid": {"willy": {"vehicleIcon": "Vehicle/Icon_BritJeep.tga"}}}, got)

    def test_a_changed_ammo_picture_is_kept(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            game, chain = _fake_game(Path(tmp), {"Kasserine": {
                "bf1942/levels/Kasserine/Objects/Willy/Objects.con": self.SHERMAN.encode(),
            }})
            global_hud = {"willy": {"vehicleIcon": "Vehicle/Icon_BritJeep.tga",
                                    "primaryAmmoIcon": "Ammo/Icon_bullet.tga",
                                    "numberOfWeaponIcons": 2}}
            got = ehp.extract_level_vehicle_hud(
                game, chain, global_hud, {"icon_britjeep": {}, "icon_75mm": {}})
            self.assertEqual({"kasserine": {"willy": {
                "primaryAmmoIcon": "Ammo/Icon_75mm.tga", "numberOfWeaponIcons": 1}}}, got)

    def test_only_differences_on_templates_the_chain_declares_are_kept(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            game, chain = _fake_game(Path(tmp), {"Kasserine": {
                "bf1942/levels/Kasserine/Objects/Sherman/Objects.con": self.SHERMAN.encode(),
            }})
            global_hud = {
                "sherman": {"vehicleIcon": "Vehicle/Icon_sherman.tga",
                            "vehicleIconPos": [54.0, 103.0]},
                # same picture and same place as the level's: nothing to say
                "shermanbrowning_pco1": {"vehicleIcon": "Vehicle/Icon_shermank.tga",
                                         "vehicleIconPos": [36.0, 64.0]},
            }
            sprites = {"icon_shermank": {}}
            got = ehp.extract_level_vehicle_hud(game, chain, global_hud, sprites)
            self.assertEqual({"kasserine": {"sherman": {
                "vehicleIcon": "Vehicle/Icon_shermank.tga",
                "vehicleIconPos": [58.0, 100.0]}}}, got)
            # a picture the pack lacks is not named: the glb's own is better
            # than the layout's literal default
            got = ehp.extract_level_vehicle_hud(game, chain, global_hud, {})
            self.assertEqual({"kasserine": {"sherman": {"vehicleIconPos": [58.0, 100.0]}}}, got)


def _write_glb(path: Path, nodes: list[dict]) -> None:
    body = json.dumps({"asset": {"version": "2.0"}, "nodes": nodes}).encode()
    body += b" " * (-len(body) % 4)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(body))
                     + struct.pack("<I4s", len(body), b"JSON") + body)


class CensusTests(unittest.TestCase):
    def _viewer(self, tmp: Path, *, sprite: bool, png: bool = True, level_hud=None) -> Path:
        viewer = tmp / "viewer"
        hud = viewer / "maps" / "_shared" / "hud"
        hud.mkdir(parents=True)
        sprites = {"icon_defgun": {"file": "icon_defgun.png"}}
        if sprite:
            sprites["iconflettner"] = {"file": "iconflettner.png"}
        (hud / "hud.json").write_text(json.dumps({"sprites": sprites}))
        (hud / "icon_defgun.png").write_bytes(b"x")
        if sprite and png:
            (hud / "iconflettner.png").write_bytes(b"x")
        if level_hud:
            (hud / "vehicle-level-hud.json").write_text(json.dumps(level_hud))
        models = viewer / "models"
        models.mkdir(parents=True)
        _write_glb(models / "Flettner.glb", [
            {"name": "Flettner", "extras": {"hud": {
                "vehicleIcon": "Vehicle/iconFlettner.tga",
                "primaryAmmoIcon": "Ammo/icon_bullet.tga"}}},
            {"name": "NoHud"},
        ])
        (models / "models.json").write_text(json.dumps([
            {"name": "Flettner", "category": "air", "glb": "Flettner.glb",
             "variants": [{"glb": "Flettner.glb", "level": None, "configuration": "complex"}]},
        ]))
        return viewer

    def test_a_named_picture_with_no_sprite_is_a_miss(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rows = census.census(self._viewer(Path(tmp), sprite=False))
        by = {(r["field"]): r for r in rows}
        self.assertEqual("missing-sprite", by["vehicleIcon"]["status"])
        self.assertEqual("missing-sprite", by["primaryAmmoIcon"]["status"])
        self.assertEqual(2, len(census.misses(rows)))

    def test_a_manifest_entry_whose_png_is_gone_is_a_miss(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rows = census.census(self._viewer(Path(tmp), sprite=True, png=False))
        self.assertEqual("missing-file",
                         next(r for r in rows if r["field"] == "vehicleIcon")["status"])

    def test_a_resolving_icon_is_ok_and_a_level_overlay_is_counted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rows = census.census(self._viewer(
                Path(tmp), sprite=True,
                level_hud={"raid": {"flettner": {"vehicleIcon": "Vehicle/iconFlettner.tga"}}}))
        self.assertEqual("ok", next(r for r in rows if r["field"] == "vehicleIcon"
                                    and r["status"] != "level-overlay")["status"])
        self.assertEqual(1, sum(r["status"] == "level-overlay" for r in rows))


@unittest.skipUnless((VIEWER / "models" / "models.json").is_file()
                     and (VIEWER / "maps" / "_shared" / "hud" / "hud.json").is_file(),
                     "needs the extracted viewer trees")
class InstalledTreesTests(unittest.TestCase):
    """The three in-scope trees (vanilla, Road to Rome, Secret Weapons): not
    one vehicle, emplacement or deployable falls back to the default picture."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.rows = census.census(VIEWER)

    def test_no_named_picture_falls_back_to_the_default_icon(self) -> None:
        bad = census.misses(self.rows)
        self.assertEqual([], [
            f"{r['mod']}:{r['template']} {r['field']} {r['name']} ({r['status']})" for r in bad])

    def test_secret_weapons_vehicles_resolve_to_the_levels_own_art(self) -> None:
        # The six that drew the flak gun in the 2026-10-11 Raid on Agheila round.
        names = {"Flettner", "Greyhound", "Krupp", "M4A1", "MunitionsPanzer", "RocketPlatform"}
        seen = {r["template"]: r for r in self.rows
                if r["mod"] == "xpack2" and r["field"] == "vehicleIcon"
                and r["template"] in names}
        if len(seen) < len(names):
            self.skipTest("xpack2 models not extracted here")
        for template, row in seen.items():
            self.assertEqual("ok", row["status"], template)
            self.assertNotEqual("icon_defgun", row["sprite"], template)

    def test_the_flettner_names_its_own_icon(self) -> None:
        flettner = [r for r in self.rows if r["mod"] == "xpack2" and r["template"] == "Flettner"
                    and r["field"] == "vehicleIcon"]
        if not flettner:
            self.skipTest("xpack2 Flettner not extracted here")
        self.assertEqual({"iconflettner"}, {r["sprite"] for r in flettner})

    def test_the_levels_changed_icons_are_overlays_that_resolve(self) -> None:
        overlays = [r for r in self.rows if r["status"] == "level-overlay"]
        if not overlays:
            self.skipTest("no vehicle-level-hud.json in this tree")
        self.assertTrue(any(r["levels"] == ["kasserine_pass"] and r["template"] == "sherman"
                            for r in overlays))


@unittest.skipUnless((GAME_DIR / "Mods/XPack2").is_dir(), "needs Secret Weapons installed")
class InstalledArchivesTests(unittest.TestCase):
    """Every picture the level archives of the three in-scope trees carry is
    in the pack the page loads for that tree, and none was dropped."""

    def test_every_level_picture_is_in_its_trees_pack(self) -> None:
        from extract_models import mod_chain
        missing = []
        for mod, mod_name, _, pack_rel in [
                ("bf1942", "bf1942", None, "_shared/hud"),
                ("xpack1", "XPack1", None, "mods/xpack1/_shared/hud"),
                ("xpack2", "XPack2", None, "mods/xpack2/_shared/hud")]:
            pack = census.Pack(VIEWER, mod, pack_rel)
            if not pack.sprites:
                self.skipTest("no extracted sprite pack here")
            for art in ehp.collect_level_art(GAME_DIR, mod_chain(GAME_DIR, mod_name)):
                keys = {art.name, f"{Path(art.rel).parent.name.lower()}_{art.name}"}
                if not keys & set(pack.sprites):
                    missing.append(f"{mod}:{art.level}:{art.rel}")
        self.assertEqual([], missing)

    def test_no_level_picture_collides_with_a_different_one(self) -> None:
        # The extractor drops (and warns about) a level picture whose name
        # something else holds in the same directory; none does today.
        from extract_models import mod_chain
        by_name: dict[str, tuple[str, bytes]] = {}
        for art in ehp.collect_level_art(GAME_DIR, mod_chain(GAME_DIR, "XPack2")):
            key = art.rel.lower()
            raw = art.read()
            if key in by_name and by_name[key][1] != raw:
                self.fail(f"{art.rel} differs between {by_name[key][0]} and {art.level}")
            by_name[key] = (art.level, raw)


if __name__ == "__main__":
    unittest.main()
