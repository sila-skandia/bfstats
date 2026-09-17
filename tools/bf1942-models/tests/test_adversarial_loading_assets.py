"""Adversarial stress-testing suite for BF1942 loading asset extraction.

Challenges tools/bf1942-models/extract_loading_assets.py across:
1. Pathological CON script parsing (line endings, whitespace, comments, quotes, mixed case, 'rem' in paths)
2. Title formatting edge cases (apostrophes, Roman numerals, abbreviations, long strings, punctuation)
3. CLI argument combinations, flags, isolation, and error handling
4. Idempotency, atomic write integrity, and recovery from failure
5. ArchiveReader matching precedence (substring vs exact/suffix)
"""

from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
MODELS_DIR = REPO_ROOT / "tools" / "bf1942-models"
if str(MODELS_DIR) not in sys.path:
    sys.path.insert(0, str(MODELS_DIR))

import extract_loading_assets as ela


# --------------------------------------------------------------------------- #
# Synthetic Fixture Helpers
# --------------------------------------------------------------------------- #

def make_mock_rfa(entries: dict[str, bytes]) -> bytes:
    """Generate an uncompressed Refractor Flat Archive (RFA) binary blob."""
    header = b"Refractor2 FlatArchive 1.1  "
    data_payload = bytearray()
    offsets: dict[str, int] = {}
    curr_offset = 8
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
        index_payload += b"\x00" * 12

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
    """Generate a minimal DDS byte stream using Pillow."""
    im = Image.new("RGBA", (width, height), color)
    buf = io.BytesIO()
    im.save(buf, format="DDS")
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# 1. Pathological CON Script Parsing Suite
# --------------------------------------------------------------------------- #

class TestPathologicalConParsing(unittest.TestCase):
    """Stress-test CON script command parsing against malformed and edge-case inputs."""

    def test_line_ending_variations(self):
        """Unix LF, Windows CRLF, and old Mac CR must all be parsed identically."""
        script_lf = "game.setLoadPicture Load/Pacific2.tga\ngame.setBackgroundMusic music/track.bik\n"
        script_crlf = "game.setLoadPicture Load/Pacific2.tga\r\ngame.setBackgroundMusic music/track.bik\r\n"
        script_cr = "game.setLoadPicture Load/Pacific2.tga\rgame.setBackgroundMusic music/track.bik\r"
        script_mixed = "game.setLoadPicture Load/Pacific2.tga\r\ngame.setBackgroundMusic music/track.bik\n"

        for s in [script_lf, script_crlf, script_cr, script_mixed]:
            res = ela.parse_menu_init_con(s)
            self.assertEqual(res.get("setloadpicture"), "Load/Pacific2.tga")
            self.assertEqual(res.get("setbackgroundmusic"), "music/track.bik")

    def test_whitespace_and_tab_delimiters(self):
        """Multiple consecutive tabs and spaces between command, quotes, and arguments."""
        scripts = [
            "\t\tgame.setLoadPicture\t\t\tLoad/Pacific2.tga\t\t",
            "   game.setLoadPicture   \t  Load/Pacific2.tga   ",
            "\t game.setLoadPicture \t \t \"Load/Pacific2.tga\" \t ",
        ]
        for s in scripts:
            res = ela.parse_menu_init_con(s)
            self.assertEqual(
                res.get("setloadpicture"),
                "Load/Pacific2.tga",
                f"Failed on input: {s!r}",
            )

    def test_case_insensitivity_and_prefix_variations(self):
        """Commands with arbitrary casing, with or without 'game.' prefix."""
        test_cases = [
            ("GAME.SETLOADPICTURE Load/Pacific2.tga", "Load/Pacific2.tga"),
            ("gAmE.sEtLoAdPiCtUrE Load/Pacific2.tga", "Load/Pacific2.tga"),
            ("setLoadPicture Load/Pacific2.tga", "Load/Pacific2.tga"),
            ("SETLOADPICTURE Load/Pacific2.tga", "Load/Pacific2.tga"),
            ("game.setloadpicture Load/Pacific2.tga", "Load/Pacific2.tga"),
            ("GAME.SETLOADMUSICFILENAME music/theme.bik", "music/theme.bik"),
            ("setLoadMusicFilename music/theme.bik", "music/theme.bik"),
        ]
        for line, expected in test_cases:
            res = ela.parse_menu_init_con(line)
            cmd = "setloadpicture" if "picture" in line.lower() else "setloadmusicfilename"
            self.assertEqual(res.get(cmd), expected, f"Failed on command: {line!r}")

    def test_quoting_variations(self):
        """Single quotes, double quotes, mismatched or partial quotes."""
        cases = [
            ('game.setLoadPicture "Load/Pacific2.tga"', "Load/Pacific2.tga"),
            ("game.setLoadPicture 'Load/Pacific2.tga'", "Load/Pacific2.tga"),
            ('game.setLoadPicture "Load/Pacific2.tga', "Load/Pacific2.tga"),
            ('game.setLoadPicture Load/Pacific2.tga"', "Load/Pacific2.tga"),
            ('game.setLoadPicture "Load/Pacific 2.tga"', "Load/Pacific 2.tga"),
        ]
        for line, expected in cases:
            res = ela.parse_menu_init_con(line)
            self.assertEqual(res.get("setloadpicture"), expected, f"Failed on quote case: {line!r}")

    def test_inline_comments(self):
        """Inline 'rem' comments with various separators and text."""
        cases = [
            ("game.setLoadPicture Load/Pacific2.tga rem this is a comment", "Load/Pacific2.tga"),
            ("game.setLoadPicture Load/Pacific2.tga\trem tab comment", "Load/Pacific2.tga"),
            ("game.setLoadPicture Load/Pacific2.tga   REM uppercase comment", "Load/Pacific2.tga"),
            ("game.setLoadPicture \"Load/Pacific2.tga\" rem comment after quotes", "Load/Pacific2.tga"),
            ("game.setLoadPicture Load/Pacific2.tga rem", "Load/Pacific2.tga"),
            ("game.setLoadPicture Load/Pacific2.tga REM: notice colon", "Load/Pacific2.tga"),
        ]
        for line, expected in cases:
            res = ela.parse_menu_init_con(line)
            self.assertEqual(res.get("setloadpicture"), expected, f"Failed on comment case: {line!r}")

    def test_path_containing_rem_substring(self):
        """CRITICAL CHALLENGE: Filename or directory containing 'rem' (e.g. remagen, bremen, remember).

        In Refractor scripts, 'rem' is only a comment keyword when separated as a token.
        If the path itself contains 'rem' (e.g. 'levels/remagen/loader.tga'), a naive
        regex matching 'rem.*' will erroneously truncate the argument.
        """
        cases = [
            ("game.setLoadPicture ../../bf1942/levels/remagen/menu/texture/load/remagen_load.tga",
             "../../bf1942/levels/remagen/menu/texture/load/remagen_load.tga"),
            ("game.setLoadPicture ../../bf1942/levels/bremen/menu/loader.tga",
             "../../bf1942/levels/bremen/menu/loader.tga"),
            ("game.setLoadPicture \"levels/remagen/loader.tga\"",
             "levels/remagen/loader.tga"),
            ("game.setLoadPicture Load/remember.tga",
             "Load/remember.tga"),
            ("game.setLoadMusicFilename \"music/rem_theme.bik\"",
             "music/rem_theme.bik"),
            ("game.setLoadPicture ../../bf1942/levels/remagen/loader.tga rem actual comment",
             "../../bf1942/levels/remagen/loader.tga"),
        ]
        for line, expected in cases:
            res = ela.parse_menu_init_con(line)
            cmd = "setloadpicture" if "picture" in line.lower() else "setloadmusicfilename"
            self.assertEqual(
                res.get(cmd),
                expected,
                f"FAILURE: 'rem' substring in path corrupted argument in line {line!r}",
            )


# --------------------------------------------------------------------------- #
# 2. Title Formatting Edge Cases Suite
# --------------------------------------------------------------------------- #

class TestTitleFormattingEdgeCases(unittest.TestCase):
    """Stress-test format_map_title with punctuation, roman numerals, apostrophes, and abbreviations."""

    def test_canonical_overrides_and_apostrophes(self):
        """Apostrophes in titles must be preserved accurately according to Refractor conventions."""
        self.assertEqual(ela.format_map_title("charlie_don't_surf"), "CHARLIE DON'T SURF")
        self.assertEqual(ela.format_map_title("Charlie_Don't_Surf"), "CHARLIE DON'T SURF")
        self.assertEqual(ela.format_map_title("CHARLIE_DON'T_SURF"), "CHARLIE DON'T SURF")
        self.assertEqual(ela.format_map_title("charly's_nest"), "CHARLY'S NEST")
        self.assertEqual(ela.format_map_title("Charly's_Nest"), "CHARLY'S NEST")

    def test_roman_numerals(self):
        """Roman numerals must remain uppercase and properly spaced."""
        self.assertEqual(ela.format_map_title("operation_linebacker_ii"), "OPERATION LINEBACKER II")
        self.assertEqual(ela.format_map_title("Operation_Linebacker_II"), "OPERATION LINEBACKER II")
        self.assertEqual(ela.format_map_title("battle_of_the_bulge"), "BATTLE OF THE BULGE")
        self.assertEqual(ela.format_map_title("world_war_i"), "WORLD WAR I")
        self.assertEqual(ela.format_map_title("map_iii"), "MAP III")
        self.assertEqual(ela.format_map_title("sector_iv"), "SECTOR IV")

    def test_abbreviations_and_dots(self):
        """Abbreviations with periods must be preserved."""
        self.assertEqual(ela.format_map_title("m_i_a"), "M.I.A.")
        self.assertEqual(ela.format_map_title("M_I_A"), "M.I.A.")
        self.assertEqual(ela.format_map_title("pow"), "P.O.W.")
        self.assertEqual(ela.format_map_title("POW"), "P.O.W.")
        self.assertEqual(ela.format_map_title("P.O.W."), "P.O.W.")
        self.assertEqual(ela.format_map_title("M.I.A."), "M.I.A.")

    def test_long_names_and_extreme_separators(self):
        """Long titles, multiple underscores, and leading/trailing separators."""
        self.assertEqual(
            ela.format_map_title("invasion_of_the_philippines"),
            "INVASION OF THE PHILIPPINES",
        )
        self.assertEqual(
            ela.format_map_title("operation_market_garden"),
            "OPERATION MARKET GARDEN",
        )
        # Multiple underscores collapsed
        self.assertEqual(
            ela.format_map_title("foo____bar___baz"),
            "FOO BAR BAZ",
        )
        # Leading and trailing underscores and whitespace
        self.assertEqual(
            ela.format_map_title("  __wake__  "),
            "WAKE ISLAND",
        )
        # Empty and whitespace strings
        self.assertEqual(ela.format_map_title(""), "")
        self.assertEqual(ela.format_map_title("   "), "")
        self.assertEqual(ela.format_map_title("___"), "")


# --------------------------------------------------------------------------- #
# 3. CLI Argument Combinations Suite
# --------------------------------------------------------------------------- #

class TestCliArgumentCombinations(unittest.TestCase):
    """Test CLI flags, isolation constraints, error handling, and exclusivity."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.base = Path(self.tmp_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_invalid_game_directory_handling(self):
        """Invalid --bf1942-dir must exit with code 1 and a clean stderr message."""
        bogus_dir = self.base / "does_not_exist"
        cmd = [
            sys.executable,
            str(MODELS_DIR / "extract_loading_assets.py"),
            "--bf1942-dir",
            str(bogus_dir),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 1)
        self.assertIn("does not exist", res.stderr + res.stdout)
        self.assertNotIn("Traceback", res.stderr)

    def test_dry_run_absolute_isolation(self):
        """--dry-run must never create output directories or write files."""
        out_dir = self.base / "dry_out"
        cmd = [
            sys.executable,
            str(MODELS_DIR / "extract_loading_assets.py"),
            "--output-dir",
            str(out_dir),
            "--dry-run",
            "--mod",
            "bf1942",
            "--levels",
            "wake",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertFalse(out_dir.exists(), "--dry-run created the output directory!")

    def test_chrome_only_isolation(self):
        """--chrome-only must extract ONLY chrome PNGs, 0 WebP backgrounds, 0 MP3s, and not touch maps.json."""
        out_dir = self.base / "chrome_out"
        manifest_file = out_dir / "maps.json"
        out_dir.mkdir(parents=True)
        manifest_file.write_text(json.dumps([{"name": "Wake", "mod": "bf1942"}]))

        cmd = [
            sys.executable,
            str(MODELS_DIR / "extract_loading_assets.py"),
            "--output-dir",
            str(out_dir),
            "--chrome-only",
            "--mod",
            "bf1942",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)

        # Check created files
        created = [p.relative_to(out_dir).as_posix() for p in out_dir.rglob("*") if p.is_file()]
        self.assertIn("_shared/load/menu_loading.png", created)
        self.assertIn("_shared/load/loading_bar.png", created)
        # Ensure NO webp backgrounds and NO mp3 files
        self.assertFalse(any(f.endswith(".webp") for f in created))
        self.assertFalse(any(f.endswith(".mp3") for f in created))

        # Check manifest was NOT modified
        data = json.loads(manifest_file.read_text())
        self.assertNotIn("loading", data[0])

    def test_audio_only_isolation(self):
        """--audio-only must transcode only MP3 audio, 0 PNG chrome, 0 WebP backgrounds, and not touch manifest."""
        out_dir = self.base / "audio_out"
        manifest_file = out_dir / "maps.json"
        out_dir.mkdir(parents=True)
        manifest_file.write_text(json.dumps([{"name": "Wake", "mod": "bf1942"}]))

        cmd = [
            sys.executable,
            str(MODELS_DIR / "extract_loading_assets.py"),
            "--output-dir",
            str(out_dir),
            "--audio-only",
            "--mod",
            "bf1942",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)

        created = [p.relative_to(out_dir).as_posix() for p in out_dir.rglob("*") if p.is_file()]
        self.assertIn("_shared/music/vehicle4.mp3", created)
        self.assertFalse(any(f.endswith(".png") for f in created))
        self.assertFalse(any(f.endswith(".webp") for f in created))

        # Manifest untouched
        data = json.loads(manifest_file.read_text())
        self.assertNotIn("loading", data[0])

    def test_manifest_only_isolation(self):
        """--manifest-only must update maps.json but write 0 PNG, 0 WebP, and 0 MP3 files."""
        out_dir = self.base / "manifest_out"
        manifest_file = out_dir / "maps.json"
        out_dir.mkdir(parents=True)
        manifest_file.write_text(json.dumps([{"name": "Wake", "mod": "bf1942"}]))

        cmd = [
            sys.executable,
            str(MODELS_DIR / "extract_loading_assets.py"),
            "--output-dir",
            str(out_dir),
            "--manifest-only",
            "--mod",
            "bf1942",
            "--levels",
            "wake",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)

        created = [p.relative_to(out_dir).as_posix() for p in out_dir.rglob("*") if p.is_file()]
        self.assertEqual(created, ["maps.json"])

        data = json.loads(manifest_file.read_text())
        self.assertIn("loading", data[0])
        self.assertEqual(data[0]["loading"]["title"], "WAKE ISLAND")

    def test_conflicting_cli_flags_behavior(self):
        """Challenging CLI behavior when conflicting filters are supplied simultaneously.

        E.g. --chrome-only AND --audio-only.
        Currently, flags do not use argparse mutually exclusive groups and result in 0 extracted items.
        """
        cmd = [
            sys.executable,
            str(MODELS_DIR / "extract_loading_assets.py"),
            "--chrome-only",
            "--audio-only",
            "--dry-run",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("UI Chrome extracted:        0", res.stdout)
        self.assertIn("Audio tracks transcoded:    0", res.stdout)


# --------------------------------------------------------------------------- #
# 4. Idempotency and Atomic Writes Suite
# --------------------------------------------------------------------------- #

class TestIdempotencyAndAtomicWrites(unittest.TestCase):
    """Verify that multiple successive runs produce byte-identical output without corruption."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.base = Path(self.tmp_dir)
        self.output_dir = self.base / "maps"
        self.output_dir.mkdir(parents=True)

        self.initial_manifest = [
            {
                "name": "Wake",
                "mod": "bf1942",
                "glb": "wake/scene.glb",
                "worldSize": 2048.0,
                "customProperty": {"key": "value", "id": 42},
            },
            {
                "name": "Aberdeen",
                "mod": "bf1942",
                "glb": "aberdeen/scene.glb",
                "worldSize": 1024.0,
                "customProperty": {"key": "ab_value"},
            },
        ]
        self.manifest_path = self.output_dir / "maps.json"
        self.manifest_path.write_text(json.dumps(self.initial_manifest, indent=2) + "\n")

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_triple_run_manifest_idempotency(self):
        """Executing update_manifest 3 times consecutively must produce byte-identical files."""
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

        # Run 1
        ela.update_manifest(self.manifest_path, records)
        hash_1 = hashlib.sha256(self.manifest_path.read_bytes()).hexdigest()

        # Run 2
        ela.update_manifest(self.manifest_path, records)
        hash_2 = hashlib.sha256(self.manifest_path.read_bytes()).hexdigest()

        # Run 3
        ela.update_manifest(self.manifest_path, records)
        hash_3 = hashlib.sha256(self.manifest_path.read_bytes()).hexdigest()

        self.assertEqual(hash_1, hash_2)
        self.assertEqual(hash_2, hash_3)

        # Check preserved custom properties
        data = json.loads(self.manifest_path.read_text())
        wake = next(e for e in data if e["name"] == "Wake")
        self.assertEqual(wake["customProperty"], {"key": "value", "id": 42})

    def test_atomic_write_rollback_on_write_error(self):
        """Simulate failure during file generation: target file must remain intact, no orphaned .tmp files."""
        original_content = "original-untouched-content"
        target_file = self.base / "menu_loading.png"
        target_file.write_text(original_content)

        # Corrupt DDS bytes to force decode exception
        corrupt_dds = b"DDS NOT A REAL DDS DATA"
        with self.assertRaises(ValueError):
            ela.convert_ui_chrome_dds(
                corrupt_dds,
                target_file,
                crop_active=True,
                overwrite=True,
            )

        # Original file must NOT have been overwritten
        self.assertEqual(target_file.read_text(), original_content)

        # No temporary files left behind
        tmp_files = list(self.base.glob(".tmp_*"))
        self.assertEqual(tmp_files, [], f"Orphaned temporary files found: {tmp_files}")


# --------------------------------------------------------------------------- #
# 5. Archive Reader & Resolution Hierarchy Suite
# --------------------------------------------------------------------------- #

class TestArchiveReaderAdversarial(unittest.TestCase):
    """Stress-test ArchiveReader against substring ambiguity and collision edge cases."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.base = Path(self.tmp_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_reloader_vs_loader_matching_precedence(self):
        """CHALLENGE: 'loader.tga' search must NOT prematurely match 'reloader.tga'."""
        rfa_bytes = make_mock_rfa({
            "bf1942/levels/foo/texture/reloader.tga": b"reloader_data",
            "bf1942/levels/foo/menu/loader.tga": b"correct_loader_data",
        })
        rfa_file = self.base / "collision.rfa"
        rfa_file.write_bytes(rfa_bytes)

        with ela.ArchiveReader(rfa_file) as reader:
            found = reader.find("loader.tga")
            # Must return the file actually named loader.tga, not reloader.tga
            self.assertEqual(
                found,
                "bf1942/levels/foo/menu/loader.tga",
                f"ArchiveReader.find('loader.tga') matched substring 'reloader.tga' instead of 'loader.tga'!",
            )

    def test_remagen_level_resolution_and_extraction(self):
        """CHALLENGE: Level containing 'rem' in name and init.con override path must extract correctly."""
        dummy_tga = make_dummy_tga(800, 600)
        rfa_bytes = make_mock_rfa({
            "bf1942/levels/remagen/menu/init.con": (
                b"game.setLoadPicture ../../bf1942/levels/remagen/menu/texture/load/remagen_load.tga\n"
            ),
            "bf1942/levels/remagen/menu/texture/load/remagen_load.tga": dummy_tga,
        })
        rfa_dir = self.base / "Mods" / "bf1942" / "Archives" / "bf1942" / "levels"
        rfa_dir.mkdir(parents=True)
        (rfa_dir / "remagen.rfa").write_bytes(rfa_bytes)

        extractor = ela.LoadingAssetExtractor(
            bf1942_dir=self.base,
            output_dir=self.base / "viewer" / "maps",
            mods=["bf1942"],
            levels=["remagen"],
        )

        bg_ref, source_bg = extractor.resolve_level_background(
            "remagen", "bf1942", [self.base / "Mods" / "bf1942"]
        )

        self.assertEqual(bg_ref, "remagen/load.webp")
        self.assertIsNotNone(source_bg, "source_bg should not be None for level override")
        # Ensure source bytes match actual TGA, not text of init.con
        self.assertEqual(source_bg[0], dummy_tga, "source_bg returned wrong file bytes!")


if __name__ == "__main__":
    unittest.main()
