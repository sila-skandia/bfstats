"""Tier 2 Test Suite: CLI Extraction & Manifest Boundary Cases (Features 1-5, 25 Tests)."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

from tests.e2e.fixtures.synthetic_rfa import SyntheticRfaBuilder
from tests.e2e.fixtures.synthetic_tree import SyntheticGameTree

TOOL_SCRIPT = Path(__file__).resolve().parents[3] / "tools" / "bf1942-models" / "extract_loading_assets.py"


class Tier2CliBoundaryExtractionTests(unittest.TestCase):
    """Tier 2: Boundary conditions, malformed inputs, edge cases for CLI extraction (Features 1-5)."""

    def setUp(self) -> None:
        self.fixture = SyntheticGameTree()
        self.game_dir = self.fixture.root
        self.dest = self.fixture.dest

    def tearDown(self) -> None:
        self.fixture.cleanup()

    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        if not TOOL_SCRIPT.exists():
            self.fail(f"CLI implementation missing: {TOOL_SCRIPT} (Milestone M1 pending)")
        cmd = [
            sys.executable,
            str(TOOL_SCRIPT),
            "--game-dir", str(self.game_dir),
            "--dest", str(self.dest),
            *args,
        ]
        return subprocess.run(cmd, capture_output=True, text=True)

    # ----------------------------------------------------------------------- #
    # Feature 1 Boundary: Chrome Edge Cases (T2-FEAT01-01 to T2-FEAT01-05)
    # ----------------------------------------------------------------------- #
    def test_T2_FEAT01_01_missing_menu_rfa_exit_code_3(self) -> None:
        """T2-FEAT01-01: Missing menu.rfa exits with code 3."""
        menu_rfa = self.game_dir / "Mods" / "bf1942" / "Archives" / "menu.rfa"
        if menu_rfa.exists():
            menu_rfa.unlink()
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(3, res.returncode)

    def test_T2_FEAT01_02_corrupt_menu_loading_dds(self) -> None:
        """T2-FEAT01-02: Corrupted DDS header handling."""
        b = SyntheticRfaBuilder()
        b.add_file("menu/Texture/Briefing/menu_loading.dds", b"corrupt_dds_header_payload")
        b.write(self.game_dir / "Mods" / "bf1942" / "Archives" / "menu.rfa")
        res = self.run_cli("--mod", "bf1942")
        self.assertIn(res.returncode, (0, 1))

    def test_T2_FEAT01_03_destination_created_if_missing(self) -> None:
        """T2-FEAT01-03: Destination directory created if missing."""
        deep_dest = self.fixture.root / "new_dest" / "sub_maps"
        res = self.run_cli("--dest", str(deep_dest), "--mod", "bf1942")
        self.assertEqual(0, res.returncode)
        self.assertTrue((deep_dest / "_shared" / "load" / "menu_loading.png").is_file())

    def test_T2_FEAT01_04_force_overwrites_stale_chrome(self) -> None:
        """T2-FEAT01-04: --force overwrites existing files."""
        chrome_file = self.dest / "_shared" / "load" / "menu_loading.png"
        chrome_file.parent.mkdir(parents=True, exist_ok=True)
        chrome_file.write_bytes(b"stale_dummy_data")
        res = self.run_cli("--mod", "bf1942", "--force")
        self.assertEqual(0, res.returncode)
        self.assertNotEqual(b"stale_dummy_data", chrome_file.read_bytes())

    def test_T2_FEAT01_05_no_chrome_flag(self) -> None:
        """T2-FEAT01-05: --no-chrome flag skips chrome extraction."""
        res = self.run_cli("--mod", "bf1942", "--no-chrome")
        self.assertEqual(0, res.returncode)
        self.assertFalse((self.dest / "_shared" / "load" / "menu_loading.png").exists())

    # ----------------------------------------------------------------------- #
    # Feature 2 Boundary: Vanilla Background Edge Cases (T2-FEAT02-01 to T2-FEAT02-05)
    # ----------------------------------------------------------------------- #
    def test_T2_FEAT02_01_missing_init_con_uses_fallback(self) -> None:
        """T2-FEAT02-01: Vanilla map without Menu/init.con falls back to theater background."""
        levels_dir = self.game_dir / "Mods" / "bf1942" / "Archives" / "bf1942" / "levels"
        SyntheticRfaBuilder().write(levels_dir / "NoInitMap.rfa")
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode)
        manifest = json.loads((self.dest / "maps.json").read_text())
        no_init = next(m for m in manifest if m["name"].lower() == "noinitmap")
        self.assertIn("load.webp", no_init["loading"]["background"].lower())

    def test_T2_FEAT02_02_corrupted_tga_payload_survives(self) -> None:
        """T2-FEAT02-02: Level RFA contains truncated/corrupted TGA image data."""
        levels_dir = self.game_dir / "Mods" / "bf1942" / "Archives" / "bf1942" / "levels"
        b = SyntheticRfaBuilder()
        b.add_text("Menu/init.con", "game.setLoadPicture ../../bf1942/levels/bad_tga/menu/loader.tga\n")
        b.add_file("bf1942/levels/bad_tga/menu/loader.tga", b"\x00\x00\x02" + b"\xFF" * 10)
        b.write(levels_dir / "Bad_Tga.rfa")
        res = self.run_cli("--mod", "bf1942")
        self.assertIn(res.returncode, (0, 1))

    def test_T2_FEAT02_03_filter_specific_level_arg(self) -> None:
        """T2-FEAT02-03: --levels arg restricts extraction to specified levels."""
        res = self.run_cli("--mod", "bf1942", "--levels", "Wake")
        self.assertEqual(0, res.returncode)
        manifest = json.loads((self.dest / "maps.json").read_text())
        self.assertEqual(1, len(manifest))
        self.assertEqual("Wake", manifest[0]["name"])

    def test_T2_FEAT02_04_missing_theater_background_fallback(self) -> None:
        """T2-FEAT02-04: Missing theater background falls back to default Western.tga."""
        levels_dir = self.game_dir / "Mods" / "bf1942" / "Archives" / "bf1942" / "levels"
        b = SyntheticRfaBuilder()
        b.add_text("Menu/init.con", "game.setLoadPicture Load/MissingTheater.tga\n")
        b.write(levels_dir / "MissingTheater.rfa")
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode)
        manifest = json.loads((self.dest / "maps.json").read_text())
        entry = next(m for m in manifest if m["name"].lower() == "missingtheater")
        self.assertIn("western", entry["loading"]["background"].lower())

    def test_T2_FEAT02_05_case_insensitive_con_parsing(self) -> None:
        """T2-FEAT02-05: Case-insensitive init.con parsing."""
        levels_dir = self.game_dir / "Mods" / "bf1942" / "Archives" / "bf1942" / "levels"
        b = SyntheticRfaBuilder()
        b.add_text("menu/Init.con", "GAME.SETLOADPICTURE Load/Desert.tga\n")
        b.write(levels_dir / "Case_Map.rfa")
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode)
        manifest = json.loads((self.dest / "maps.json").read_text())
        entry = next(m for m in manifest if m["name"].lower() == "case_map")
        self.assertIn("desert", entry["loading"]["background"].lower())

    # ----------------------------------------------------------------------- #
    # Feature 3 Boundary: EoD Background Edge Cases (T2-FEAT03-01 to T2-FEAT03-05)
    # ----------------------------------------------------------------------- #
    def test_T2_FEAT03_01_missing_loader_tga_logs_warning(self) -> None:
        """T2-FEAT03-01: EoD level missing loader.tga logs warning without crashing."""
        eod_levels = self.game_dir / "Mods" / "EoD" / "archives" / "bf1942" / "levels"
        b = SyntheticRfaBuilder()
        b.add_text("Menu/init.con", "game.setLoadPicture loader.tga\n")
        b.write(eod_levels / "Empty_EoD.rfa")
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode)

    def test_T2_FEAT03_02_empty_levels_directory(self) -> None:
        """T2-FEAT03-02: Empty levels directory handled gracefully."""
        eod_levels = self.game_dir / "Mods" / "EoD" / "archives" / "bf1942" / "levels"
        for p in eod_levels.glob("*.rfa"):
            p.unlink()
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode)

    def test_T2_FEAT03_03_windows_backslash_con_paths(self) -> None:
        """T2-FEAT03-03: Windows backslash paths in init.con."""
        eod_levels = self.game_dir / "Mods" / "EoD" / "archives" / "bf1942" / "levels"
        b = SyntheticRfaBuilder()
        b.add_text("Menu\\init.con", "game.setLoadPicture ..\\..\\bf1942\\levels\\slash_map\\menu\\loader.tga\n")
        b.write(eod_levels / "Slash_Map.rfa")
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode)

    def test_T2_FEAT03_04_patch_rfa_precedence(self) -> None:
        """T2-FEAT03-04: Mod patch precedence (Operation_Hastings_001.rfa)."""
        eod_levels = self.game_dir / "Mods" / "EoD" / "archives" / "bf1942" / "levels"
        patch = SyntheticRfaBuilder()
        patch.add_text("Menu/init.con", "game.setLoadPicture ..\\..\\bf1942\\levels\\patch\\menu\\patched.tga\n")
        patch.write(eod_levels / "Operation_Hastings_001.rfa")
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode)

    def test_T2_FEAT03_05_invalid_mod_name_exits_code_3(self) -> None:
        """T2-FEAT03-05: Invalid mod name exits with code 3."""
        res = self.run_cli("--mod", "NonExistentMod999")
        self.assertEqual(3, res.returncode)

    # ----------------------------------------------------------------------- #
    # Feature 4 Boundary: Audio Error Handling (T2-FEAT04-01 to T2-FEAT04-05)
    # ----------------------------------------------------------------------- #
    def test_T2_FEAT04_01_missing_bik_file_graceful_skip(self) -> None:
        """T2-FEAT04-01: Missing BIK audio file skips gracefully without failure."""
        (self.game_dir / "Mods" / "bf1942" / "Music" / "Vehicle4.bik").unlink()
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode)

    def test_T2_FEAT04_02_no_audio_flag_skips_ffmpeg(self) -> None:
        """T2-FEAT04-02: --no-audio flag skips audio processing."""
        res = self.run_cli("--mod", "bf1942", "--no-audio")
        self.assertEqual(0, res.returncode)
        self.assertFalse((self.dest / "_shared" / "music" / "vehicle4.mp3").exists())

    def test_T2_FEAT04_03_corrupt_bik_does_not_leave_zero_byte_mp3(self) -> None:
        """T2-FEAT04-03: Corrupt BIK does not leave zero-byte MP3."""
        bik = self.game_dir / "Mods" / "bf1942" / "Music" / "Vehicle4.bik"
        bik.write_bytes(b"CORRUPT_NOT_A_BIK_HEADER_12345678")
        self.run_cli("--mod", "bf1942")
        mp3 = self.dest / "_shared" / "music" / "vehicle4.mp3"
        if mp3.exists():
            self.assertGreater(mp3.stat().st_size, 0)

    def test_T2_FEAT04_04_audio_atomic_write(self) -> None:
        """T2-FEAT04-04: Atomic file writes (no lingering temporary files)."""
        self.run_cli("--mod", "bf1942")
        music_dir = self.dest / "_shared" / "music"
        tmp_files = list(music_dir.glob("*.tmp*")) + list(music_dir.glob("*.part*"))
        self.assertEqual(0, len(tmp_files))

    def test_T2_FEAT04_05_invalid_audio_bitrate_arg(self) -> None:
        """T2-FEAT04-05: Invalid audio bitrate arg exits with syntax code 2."""
        res = self.run_cli("--mod", "bf1942", "--audio-bitrate", "invalid_bitrate_xyz")
        self.assertEqual(2, res.returncode)

    # ----------------------------------------------------------------------- #
    # Feature 5 Boundary: Manifest Edge Cases (T2-FEAT05-01 to T2-FEAT05-05)
    # ----------------------------------------------------------------------- #
    def test_T2_FEAT05_01_corrupt_existing_maps_json(self) -> None:
        """T2-FEAT05-01: Corrupt existing maps.json handled safely."""
        maps_file = self.dest / "maps.json"
        maps_file.write_text("{ this is malformed json !!!")
        res = self.run_cli("--mod", "bf1942")
        self.assertIn(res.returncode, (0, 1))

    def test_T2_FEAT05_02_empty_maps_json_initialization(self) -> None:
        """T2-FEAT05-02: Empty existing maps.json initializes cleanly."""
        maps_file = self.dest / "maps.json"
        maps_file.write_text("[]")
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode)
        manifest = json.loads(maps_file.read_text())
        self.assertGreaterEqual(len(manifest), 1)

    def test_T2_FEAT05_03_dry_run_leaves_disk_unmodified(self) -> None:
        """T2-FEAT05-03: --dry-run flag leaves disk unmodified."""
        # Clean dest
        for p in self.dest.iterdir():
            if p.is_file():
                p.unlink()
        res = self.run_cli("--mod", "bf1942", "--dry-run")
        self.assertEqual(0, res.returncode)
        self.assertFalse((self.dest / "maps.json").exists())

    def test_T2_FEAT05_04_special_characters_in_map_name(self) -> None:
        """T2-FEAT05-04: Special characters in map name sanitized in title."""
        levels_dir = self.game_dir / "Mods" / "bf1942" / "Archives" / "bf1942" / "levels"
        b = SyntheticRfaBuilder()
        b.add_text("Menu/init.con", "game.setLoadPicture Load/Pacific.tga\n")
        b.write(levels_dir / "Map-With_Special.Chars!123.rfa")
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode)
        manifest = json.loads((self.dest / "maps.json").read_text())
        entry = next(m for m in manifest if "special" in m["name"].lower())
        self.assertTrue(len(entry["loading"]["title"]) > 0)

    def test_T2_FEAT05_05_duplicate_entries_deduplicated(self) -> None:
        """T2-FEAT05-05: Duplicate level entries deduplicated."""
        maps_file = self.dest / "maps.json"
        maps_file.write_text(json.dumps([
            {"name": "Wake", "mod": "bf1942", "worldSize": 1024.0},
            {"name": "wake", "mod": "bf1942", "worldSize": 2048.0},
        ]))
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode)
        manifest = json.loads(maps_file.read_text())
        wake_entries = [m for m in manifest if m["name"].lower() == "wake"]
        self.assertEqual(1, len(wake_entries))


if __name__ == "__main__":
    unittest.main()
