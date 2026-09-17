"""Unit and integration tests for BF1942 loading asset extraction pipeline.

Tests CON parsing, title formatting, asset resolution hierarchy, image decoding/cropping,
audio transcoding command construction, manifest generation/preservation, and a full
synthetic pipeline using mock RFAs and mock game directory structures.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
from unittest.mock import patch, MagicMock
import unittest

from PIL import Image

# Ensure tools/bf1942-models is importable
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
MODELS_DIR = REPO_ROOT / "tools" / "bf1942-models"
if str(MODELS_DIR) not in sys.path:
    sys.path.insert(0, str(MODELS_DIR))

import extract_loading_assets as ela


# --------------------------------------------------------------------------- #
# Synthetic Fixture Generators
# --------------------------------------------------------------------------- #

def make_mock_rfa(entries: dict[str, bytes]) -> bytes:
    """Generate an uncompressed Refractor Flat Archive (RFA) binary blob."""
    header = b"Refractor2 FlatArchive 1.1  "
    data_payload = bytearray()
    offsets: dict[str, int] = {}
    curr_offset = 8  # data_size (4) + compressed_flag (4)
    for name, content in entries.items():
        offsets[name] = curr_offset
        data_payload += content
        curr_offset += len(content)

    data_size = 8 + len(data_payload)
    index_payload = bytearray()
    index_payload += struct.pack("<I", len(entries))
    for name, content in entries.items():
        name_bytes = name.replace("/", "\\").encode("latin-1")
        index_payload += struct.pack("<I", len(name_bytes)) + name_bytes
        c_size = len(content)
        uc_size = len(content)
        index_payload += struct.pack("<III", c_size, uc_size, offsets[name])
        index_payload += b"\x00" * 12  # 12 unused/reserved bytes

    return header + struct.pack("<II", data_size, 0) + bytes(data_payload) + bytes(index_payload)


def make_dummy_tga(
    width: int = 4,
    height: int = 4,
    bgr: tuple[int, int, int] = (128, 120, 70),
) -> bytes:
    """Generate a minimal 24-bit uncompressed TGA byte stream."""
    header = bytes([0, 0, 2]) + (b"\x00" * 5) + struct.pack("<HHHHBB", 0, 0, width, height, 24, 0x20)
    return header + bytes(bgr) * (width * height)


def make_dummy_dds(
    width: int = 512,
    height: int = 64,
    color: tuple[int, int, int, int] = (100, 120, 140, 255),
) -> bytes:
    """Generate a minimal uncompressed/DXT DDS byte stream using Pillow."""
    im = Image.new("RGBA", (width, height), color)
    buf = io.BytesIO()
    im.save(buf, format="DDS")
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# Test Suites
# --------------------------------------------------------------------------- #

class TestConScriptParser(unittest.TestCase):
    """Test Refractor Menu/init.con command extraction."""

    def test_parse_theater_picture(self):
        script = "game.setLoadPicture Load/Pacific2.tga\n"
        res = ela.parse_menu_init_con(script)
        self.assertEqual(res.get("setloadpicture"), "Load/Pacific2.tga")

    def test_parse_level_override_picture(self):
        script = (
            "rem ** Multiplayer Briefing **\n"
            "game.setLoadPicture ../../bf1942/levels/battle_of_britain/menu/texture/Load/Britain_Load.tga\n"
            "game.setMapId \"BF1942\"\n"
        )
        res = ela.parse_menu_init_con(script)
        self.assertEqual(
            res.get("setloadpicture"),
            "../../bf1942/levels/battle_of_britain/menu/texture/Load/Britain_Load.tga",
        )

    def test_parse_with_tabs_and_quotes(self):
        script = "game.setLoadPicture\t\"../../bf1942/levels/a_shau/menu/loader.tga\"\t\n"
        res = ela.parse_menu_init_con(script)
        self.assertEqual(
            res.get("setloadpicture"),
            "../../bf1942/levels/a_shau/menu/loader.tga",
        )

    def test_parse_music_overrides(self):
        script = (
            "Game.setLoadMusicFilename \"music/vehicle4.bik\"\n"
            "game.setBackgroundMusic music/custom_theme.bik\n"
        )
        res = ela.parse_menu_init_con(script)
        self.assertEqual(res.get("setloadmusicfilename"), "music/vehicle4.bik")
        self.assertEqual(res.get("setbackgroundmusic"), "music/custom_theme.bik")

    def test_ignore_comments_and_blanks(self):
        script = (
            "\n"
            "   \n"
            "rem game.setLoadPicture Load/Western.tga\n"
            "REM ** Some comment **\n"
            "game.setLoadPicture Load/Desert.tga rem Desert map\n"
        )
        res = ela.parse_menu_init_con(script)
        self.assertEqual(res.get("setloadpicture"), "Load/Desert.tga")


class TestTitleFormatter(unittest.TestCase):
    """Test in-game map title formatting and canonical overrides."""

    def test_basic_formatting(self):
        self.assertEqual(ela.format_map_title("Aberdeen"), "ABERDEEN")
        self.assertEqual(ela.format_map_title("Battle_of_the_Bulge"), "BATTLE OF THE BULGE")
        self.assertEqual(ela.format_map_title("el_alamein"), "EL ALAMEIN")

    def test_canonical_overrides(self):
        self.assertEqual(ela.format_map_title("Wake"), "WAKE ISLAND")
        self.assertEqual(ela.format_map_title("wake"), "WAKE ISLAND")
        self.assertEqual(ela.format_map_title("Coral_sea"), "CORAL SEA")
        self.assertEqual(ela.format_map_title("invasion_of_the_philippines"), "INVASION OF THE PHILIPPINES")

    def test_roman_numerals(self):
        self.assertEqual(
            ela.format_map_title("Operation_Linebacker_II"),
            "OPERATION LINEBACKER II",
        )
        self.assertEqual(
            ela.format_map_title("operation_linebacker_ii"),
            "OPERATION LINEBACKER II",
        )

    def test_abbreviations_and_quotes(self):
        self.assertEqual(ela.format_map_title("m_i_a"), "M.I.A.")
        self.assertEqual(ela.format_map_title("M_I_A"), "M.I.A.")
        self.assertEqual(ela.format_map_title("pow"), "P.O.W.")
        self.assertEqual(ela.format_map_title("POW"), "P.O.W.")
        self.assertEqual(ela.format_map_title("Charlie_Don't_Surf"), "CHARLIE DON'T SURF")


class TestLevelAssetResolver(unittest.TestCase):
    """Test level loading resolution hierarchy."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.base = Path(self.tmp_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_resolve_theater_mapping(self):
        # Create synthetic level RFA pointing to Pacific2.tga
        rfa_bytes = make_mock_rfa({
            "bf1942/levels/Wake/Menu/init.con": b"game.setLoadPicture Load/Pacific2.tga\n"
        })
        rfa_dir = self.base / "Mods" / "bf1942" / "Archives" / "bf1942" / "levels"
        rfa_dir.mkdir(parents=True)
        (rfa_dir / "Wake.rfa").write_bytes(rfa_bytes)

        extractor = ela.LoadingAssetExtractor(
            bf1942_dir=self.base,
            output_dir=self.base / "viewer" / "maps",
        )
        bg_ref, source_bg = extractor.resolve_level_background(
            "Wake", "bf1942", [self.base / "Mods" / "bf1942"]
        )
        self.assertEqual(bg_ref, "_shared/load/pacific2.webp")
        self.assertIsNone(source_bg)

    def test_resolve_level_override(self):
        # Create synthetic level RFA with custom override
        dummy_tga = make_dummy_tga(800, 600)
        rfa_bytes = make_mock_rfa({
            "bf1942/levels/Battle_of_Britain/Menu/init.con": (
                b"game.setLoadPicture ../../bf1942/levels/battle_of_britain/menu/texture/Load/Britain_Load.tga\n"
            ),
            "bf1942/levels/Battle_of_Britain/Menu/Texture/Load/Britain_Load.tga": dummy_tga,
        })
        rfa_dir = self.base / "Mods" / "bf1942" / "Archives" / "bf1942" / "levels"
        rfa_dir.mkdir(parents=True)
        (rfa_dir / "Battle_of_Britain.rfa").write_bytes(rfa_bytes)

        extractor = ela.LoadingAssetExtractor(
            bf1942_dir=self.base,
            output_dir=self.base / "viewer" / "maps",
        )
        bg_ref, source_bg = extractor.resolve_level_background(
            "Battle_of_Britain", "bf1942", [self.base / "Mods" / "bf1942"]
        )
        self.assertEqual(bg_ref, "battle_of_britain/load.webp")
        self.assertIsNotNone(source_bg)
        self.assertEqual(source_bg[0], dummy_tga)
        self.assertEqual(source_bg[1], Path("battle_of_britain") / "load.webp")

    def test_resolve_eod_loader_tga(self):
        # Create synthetic EoD level RFA containing loader.tga
        dummy_tga = make_dummy_tga(800, 600)
        rfa_bytes = make_mock_rfa({
            "bf1942/levels/a_shau/Menu/loader.tga": dummy_tga,
        })
        rfa_dir = self.base / "Mods" / "EoD" / "archives" / "bf1942" / "levels"
        rfa_dir.mkdir(parents=True)
        (rfa_dir / "A_Shau.rfa").write_bytes(rfa_bytes)

        extractor = ela.LoadingAssetExtractor(
            bf1942_dir=self.base,
            output_dir=self.base / "viewer" / "maps",
        )
        bg_ref, source_bg = extractor.resolve_level_background(
            "A_Shau", "eod", [self.base / "Mods" / "EoD"]
        )
        self.assertEqual(bg_ref, "a_shau/load.webp")
        self.assertIsNotNone(source_bg)
        self.assertEqual(source_bg[0], dummy_tga)

    def test_resolve_fallback_defaults(self):
        extractor = ela.LoadingAssetExtractor(
            bf1942_dir=self.base,
            output_dir=self.base / "viewer" / "maps",
        )
        bg_ref, source_bg = extractor.resolve_level_background(
            "Unknown_Map", "bf1942", []
        )
        self.assertEqual(bg_ref, "_shared/load/western.webp")
        self.assertIsNone(source_bg)


class TestImageConversion(unittest.TestCase):
    """Test image decoding, DDS cropping, and WebP conversion."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.base = Path(self.tmp_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_dds_crop_to_png(self):
        # 512x64 DDS should be cropped to 290x64
        dds_bytes = make_dummy_dds(512, 64)
        out_png = self.base / "menu_loading.png"
        size = ela.convert_ui_chrome_dds(dds_bytes, out_png, crop_active=True)
        self.assertEqual(size, (290, 64))
        self.assertTrue(out_png.is_file())
        with Image.open(out_png) as im:
            self.assertEqual(im.size, (290, 64))

    def test_dds_no_crop_bar(self):
        # 256x16 bar DDS should remain 256x16
        dds_bytes = make_dummy_dds(256, 16)
        out_png = self.base / "loading_bar.png"
        size = ela.convert_ui_chrome_dds(dds_bytes, out_png, crop_active=False)
        self.assertEqual(size, (256, 16))
        self.assertTrue(out_png.is_file())
        with Image.open(out_png) as im:
            self.assertEqual(im.size, (256, 16))

    def test_tga_to_webp(self):
        # 800x600 TGA should encode to 800x600 WebP
        tga_bytes = make_dummy_tga(800, 600)
        out_webp = self.base / "pacific2.webp"
        size = ela.convert_background_to_webp(tga_bytes, out_webp, quality=85)
        self.assertEqual(size, (800, 600))
        self.assertTrue(out_webp.is_file())
        with Image.open(out_webp) as im:
            self.assertEqual(im.size, (800, 600))
            self.assertEqual(im.format, "WEBP")


class TestAudioTranscoder(unittest.TestCase):
    """Test audio transcoding and file lookup."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.base = Path(self.tmp_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_case_insensitive_lookup(self):
        mod_dir = self.base / "Mods" / "bf1942"
        music_dir = mod_dir / "Music"
        music_dir.mkdir(parents=True)
        target_file = music_dir / "Vehicle4.bik"
        target_file.write_bytes(b"dummy bik content")

        found = ela.find_mod_music_file([mod_dir], "music/vehicle4.bik")
        self.assertIsNotNone(found)
        self.assertEqual(found.resolve(), target_file.resolve())

    def test_missing_source_raises_filenotfound(self):
        non_existent = self.base / "nonexistent.bik"
        dest_mp3 = self.base / "out.mp3"
        with self.assertRaises(FileNotFoundError):
            ela.transcode_bik_to_mp3(non_existent, dest_mp3)

    @patch("subprocess.run")
    @patch("shutil.which", return_value="/usr/bin/ffmpeg")
    def test_ffmpeg_arg_construction(self, mock_which, mock_run):
        def fake_ffmpeg(cmd, **kwargs):
            Path(cmd[-1]).write_bytes(b"mock mp3 data")
            return MagicMock(returncode=0)

        mock_run.side_effect = fake_ffmpeg
        bik_file = self.base / "test.bik"
        bik_file.write_bytes(b"dummy")
        dest_mp3 = self.base / "out.mp3"

        ela.transcode_bik_to_mp3(bik_file, dest_mp3, bitrate="192k")

        self.assertTrue(mock_run.called)
        cmd = mock_run.call_args[0][0]
        self.assertIn("-vn", cmd)
        self.assertIn("-c:a", cmd)
        self.assertIn("libmp3lame", cmd)
        self.assertIn("-b:a", cmd)
        self.assertIn("192k", cmd)
        self.assertIn("-ar", cmd)
        self.assertIn("44100", cmd)
        self.assertIn("-ac", cmd)
        self.assertIn("2", cmd)
        self.assertTrue(dest_mp3.is_file())


class TestManifestUpdater(unittest.TestCase):
    """Test updating maps.json preserving fields, idempotency, and sorting."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.manifest_file = Path(self.tmp_dir) / "maps.json"
        initial_data = [
            {
                "name": "Wake",
                "mod": "bf1942",
                "glb": "wake/scene.glb",
                "report": "wake/scene.json",
                "worldSize": 2048.0,
                "tiles": 16,
                "objects": 736,
            },
            {
                "name": "Aberdeen",
                "mod": "bf1942",
                "glb": "aberdeen/scene.glb",
                "report": "aberdeen/scene.json",
                "worldSize": 1024.0,
                "tiles": 16,
                "objects": 193,
            },
        ]
        self.manifest_file.write_text(json.dumps(initial_data, indent=2))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_manifest_loading_injection_and_preservation(self):
        records = {
            "wake": {
                "title": "WAKE ISLAND",
                "background": "_shared/load/pacific2.webp",
                "music": "_shared/music/vehicle4.mp3",
                "theme": "vanilla",
            },
            "aberdeen": {
                "title": "ABERDEEN",
                "background": "_shared/load/desert.webp",
                "music": "_shared/music/vehicle4.mp3",
                "theme": "vanilla",
            },
        }
        updated = ela.update_manifest(self.manifest_file, records)
        self.assertEqual(updated, 2)

        data = json.loads(self.manifest_file.read_text())
        self.assertEqual(len(data), 2)
        # Verify alphabetical sorting (Aberdeen before Wake)
        self.assertEqual(data[0]["name"], "Aberdeen")
        self.assertEqual(data[1]["name"], "Wake")

        # Verify preserved original fields
        self.assertEqual(data[1]["glb"], "wake/scene.glb")
        self.assertEqual(data[1]["worldSize"], 2048.0)
        self.assertEqual(data[1]["objects"], 736)

        # Verify injected loading block
        self.assertEqual(data[1]["loading"]["title"], "WAKE ISLAND")
        self.assertEqual(data[1]["loading"]["background"], "_shared/load/pacific2.webp")
        self.assertEqual(data[1]["loading"]["music"], "_shared/music/vehicle4.mp3")
        self.assertEqual(data[1]["loading"]["theme"], "vanilla")

    def test_manifest_idempotency(self):
        records = {
            "wake": {
                "title": "WAKE ISLAND",
                "background": "_shared/load/pacific2.webp",
                "music": "_shared/music/vehicle4.mp3",
                "theme": "vanilla",
            },
        }
        ela.update_manifest(self.manifest_file, records)
        first_pass = self.manifest_file.read_text()
        ela.update_manifest(self.manifest_file, records)
        second_pass = self.manifest_file.read_text()
        self.assertEqual(first_pass, second_pass)


class TestPipelineSynthetic(unittest.TestCase):
    """Synthetic end-to-end extraction test with mock Wine filesystem."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.base = Path(self.tmp_dir)
        self.game_dir = self.base / "mock_bf1942"
        self.output_dir = self.base / "viewer" / "maps"

        # Build mock vanilla structure
        vanilla_dir = self.game_dir / "Mods" / "bf1942"
        v_archives = vanilla_dir / "Archives"
        v_levels = v_archives / "bf1942" / "levels"
        v_music = vanilla_dir / "Music"
        v_levels.mkdir(parents=True)
        v_music.mkdir(parents=True)

        # menu.rfa with chrome and theater backgrounds
        menu_entries = {
            "menu/Texture/Briefing/menu_loading.dds": make_dummy_dds(512, 64),
            "menu/Texture/loading_full_256x16.dds": make_dummy_dds(256, 16),
            "menu/Texture/Load/Pacific2.tga": make_dummy_tga(800, 600),
            "menu/Texture/Load/Desert.tga": make_dummy_tga(800, 600),
            "menu/Texture/Load/Western.tga": make_dummy_tga(800, 600),
        }
        (v_archives / "menu.rfa").write_bytes(make_mock_rfa(menu_entries))

        # Wake.rfa
        wake_entries = {
            "bf1942/levels/Wake/Menu/init.con": b"game.setLoadPicture Load/Pacific2.tga\n"
        }
        (v_levels / "Wake.rfa").write_bytes(make_mock_rfa(wake_entries))

        # Battle_of_Britain.rfa (with override Britain_Load.tga)
        bob_entries = {
            "bf1942/levels/Battle_of_Britain/Menu/init.con": (
                b"game.setLoadPicture ../../bf1942/levels/battle_of_britain/menu/texture/Load/Britain_Load.tga\n"
            ),
            "bf1942/levels/Battle_of_Britain/Menu/Texture/Load/Britain_Load.tga": make_dummy_tga(800, 600),
        }
        (v_levels / "Battle_of_Britain.rfa").write_bytes(make_mock_rfa(bob_entries))

        # Music BIK
        (v_music / "Vehicle4.bik").write_bytes(b"dummy bik")

        # Mock maps.json
        self.output_dir.mkdir(parents=True)
        manifest_data = [
            {"name": "Wake", "mod": "bf1942", "glb": "wake/scene.glb"},
            {"name": "Battle_of_Britain", "mod": "bf1942", "glb": "battle_of_britain/scene.glb"},
        ]
        (self.output_dir / "maps.json").write_text(json.dumps(manifest_data, indent=2))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    @patch.object(ela, "transcode_bik_to_mp3", return_value=True)
    def test_full_pipeline_mock_wine(self, mock_transcode):
        extractor = ela.LoadingAssetExtractor(
            bf1942_dir=self.game_dir,
            output_dir=self.output_dir,
            mods=["bf1942"],
            dry_run=False,
            verbose=False,
        )
        summary = extractor.run()

        # Check chrome
        chrome_plate = self.output_dir / "_shared" / "load" / "menu_loading.png"
        chrome_bar = self.output_dir / "_shared" / "load" / "loading_bar.png"
        self.assertTrue(chrome_plate.is_file())
        self.assertTrue(chrome_bar.is_file())
        with Image.open(chrome_plate) as im:
            self.assertEqual(im.size, (290, 64))
        with Image.open(chrome_bar) as im:
            self.assertEqual(im.size, (256, 16))

        # Check theater backgrounds
        pacific_bg = self.output_dir / "_shared" / "load" / "pacific2.webp"
        self.assertTrue(pacific_bg.is_file())
        with Image.open(pacific_bg) as im:
            self.assertEqual(im.size, (800, 600))

        # Check override background
        bob_bg = self.output_dir / "battle_of_britain" / "load.webp"
        self.assertTrue(bob_bg.is_file())
        with Image.open(bob_bg) as im:
            self.assertEqual(im.size, (800, 600))

        # Check manifest updates
        manifest = json.loads((self.output_dir / "maps.json").read_text())
        self.assertEqual(len(manifest), 2)
        wake_entry = next(e for e in manifest if e["name"] == "Wake")
        self.assertEqual(wake_entry["loading"]["title"], "WAKE ISLAND")
        self.assertEqual(wake_entry["loading"]["background"], "_shared/load/pacific2.webp")

        bob_entry = next(e for e in manifest if e["name"] == "Battle_of_Britain")
        self.assertEqual(bob_entry["loading"]["title"], "BATTLE OF BRITAIN")
        self.assertEqual(bob_entry["loading"]["background"], "battle_of_britain/load.webp")


class TestRealWineIntegration(unittest.TestCase):
    """Optional live Wine installation integration tests."""

    @unittest.skipUnless(ela.DEFAULT_GAME_DIR.is_dir(), "Local Wine install not found")
    def test_auto_detect_real_install(self):
        detected = ela.auto_detect_bf1942_dir()
        self.assertTrue(detected.is_dir())
        self.assertTrue((detected / "Mods").is_dir())

    @unittest.skipUnless(ela.DEFAULT_GAME_DIR.is_dir(), "Local Wine install not found")
    def test_real_menu_chrome_exists(self):
        v_dir = ela.resolve_mod_dir(ela.DEFAULT_GAME_DIR, "bf1942")
        self.assertIsNotNone(v_dir)
        menu_rfa = ela.resolve_case_insensitive(v_dir, "Archives/menu.rfa")
        self.assertIsNotNone(menu_rfa)

        with ela.ArchiveReader(menu_rfa) as reader:
            plate_entry = reader.find("menu_loading.dds")
            self.assertIsNotNone(plate_entry)
            bar_entry = reader.find("loading_full_256x16.dds")
            self.assertIsNotNone(bar_entry)


if __name__ == "__main__":
    unittest.main()
