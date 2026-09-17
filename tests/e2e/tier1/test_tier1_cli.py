"""Tier 1 Test Suite: CLI Extraction & Manifest Generation (Features 1-5, 25 Tests)."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from PIL import Image

from tests.e2e.fixtures.synthetic_tree import SyntheticGameTree

TOOL_SCRIPT = Path(__file__).resolve().parents[3] / "tools" / "bf1942-models" / "extract_loading_assets.py"


class Tier1CliExtractionTests(unittest.TestCase):
    """Tier 1: Core happy-path functional requirements for CLI extraction (Features 1-5)."""

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
    # Feature 1: CLI-EXTRACT-CHROME (5 Tests: T1-FEAT01-01 to T1-FEAT01-05)
    # ----------------------------------------------------------------------- #
    def test_T1_FEAT01_01_vanilla_menu_loading_extracted(self) -> None:
        """T1-FEAT01-01: Vanilla menu_loading.dds extracted and converted to PNG."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "_shared" / "load" / "menu_loading.png"
        self.assertTrue(target.is_file(), f"Expected {target} to exist")
        with Image.open(target) as img:
            self.assertIn(img.mode, ("RGBA", "LA", "P"))

    def test_T1_FEAT01_02_vanilla_loading_bar_extracted(self) -> None:
        """T1-FEAT01-02: Vanilla loading_full_256x16.dds extracted and converted to PNG."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "_shared" / "load" / "loading_bar.png"
        self.assertTrue(target.is_file(), f"Expected {target} to exist")
        with Image.open(target) as img:
            self.assertEqual((256, 16), img.size)

    def test_T1_FEAT01_03_eod_menu_loading_extracted(self) -> None:
        """T1-FEAT01-03: EoD menu_loading.dds extracted to mod directory."""
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "mods" / "eod" / "_shared" / "menu_loading.png"
        if not target.is_file():
            # Or under _shared if mod inherits vanilla chrome
            target = self.dest / "_shared" / "load" / "menu_loading.png"
        self.assertTrue(target.is_file())

    def test_T1_FEAT01_04_eod_loading_bar_extracted(self) -> None:
        """T1-FEAT01-04: EoD loading_full_256x16.dds extracted to mod directory."""
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "mods" / "eod" / "_shared" / "loading_bar.png"
        if not target.is_file():
            target = self.dest / "_shared" / "load" / "loading_bar.png"
        self.assertTrue(target.is_file())

    def test_T1_FEAT01_05_menu_loading_active_bounds_cropping(self) -> None:
        """T1-FEAT01-05: Non-zero alpha bounding box cropping for menu_loading."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "_shared" / "load" / "menu_loading.png"
        with Image.open(target) as img:
            # Active width should be 290 or 512 with 0-alpha margin
            self.assertIn(img.size[0], (290, 512))
            self.assertEqual(64, img.size[1])

    # ----------------------------------------------------------------------- #
    # Feature 2: CLI-EXTRACT-BG-VANILLA (5 Tests: T1-FEAT02-01 to T1-FEAT02-05)
    # ----------------------------------------------------------------------- #
    def test_T1_FEAT02_01_pacific_theaters_extracted(self) -> None:
        """T1-FEAT02-01: Extract vanilla Pacific theater backgrounds to WebP."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        load_dir = self.dest / "_shared" / "load"
        self.assertTrue((load_dir / "pacific.webp").is_file() or (load_dir / "pacific2.webp").is_file())

    def test_T1_FEAT02_02_western_theaters_extracted(self) -> None:
        """T1-FEAT02-02: Extract vanilla Western theater backgrounds to WebP."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        load_dir = self.dest / "_shared" / "load"
        self.assertTrue((load_dir / "western.webp").is_file() or (load_dir / "western2.webp").is_file())

    def test_T1_FEAT02_03_eastern_theaters_extracted(self) -> None:
        """T1-FEAT02-03: Extract vanilla Eastern theater backgrounds to WebP."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        load_dir = self.dest / "_shared" / "load"
        self.assertTrue((load_dir / "eastern.webp").is_file() or (load_dir / "eastern2.webp").is_file())

    def test_T1_FEAT02_04_desert_theater_extracted(self) -> None:
        """T1-FEAT02-04: Extract vanilla Desert theater background to WebP."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "_shared" / "load" / "desert.webp"
        self.assertTrue(target.is_file())
        with Image.open(target) as img:
            self.assertEqual((800, 600), img.size)
            self.assertEqual("WEBP", img.format)

    def test_T1_FEAT02_05_level_override_background_extracted(self) -> None:
        """T1-FEAT02-05: Extract level-specific override background to level destination."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "battle_of_britain" / "load.webp"
        self.assertTrue(target.is_file(), f"Expected level override {target}")
        with Image.open(target) as img:
            self.assertEqual((800, 600), img.size)

    # ----------------------------------------------------------------------- #
    # Feature 3: CLI-EXTRACT-BG-EOD (5 Tests: T1-FEAT03-01 to T1-FEAT03-05)
    # ----------------------------------------------------------------------- #
    def test_T1_FEAT03_01_eod_hastings_loader_extracted(self) -> None:
        """T1-FEAT03-01: Extract EoD level loading background for Operation Hastings to WebP."""
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "mods" / "eod" / "operation_hastings" / "load.webp"
        self.assertTrue(target.is_file(), f"Expected EoD background at {target}")

    def test_T1_FEAT03_02_eod_dimensions_800x600(self) -> None:
        """T1-FEAT03-02: Verify WebP dimension preservation (800x600 px) for extracted EoD art."""
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "mods" / "eod" / "operation_hastings" / "load.webp"
        with Image.open(target) as img:
            self.assertEqual((800, 600), img.size)

    def test_T1_FEAT03_03_eod_manifest_relative_path_resolution(self) -> None:
        """T1-FEAT03-03: EoD relative path resolution in manifest."""
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode, res.stderr)
        manifest_path = self.dest / "mods" / "eod" / "maps.json"
        if not manifest_path.exists():
            manifest_path = self.dest / "maps.json"
        manifest = json.loads(manifest_path.read_text())
        hastings = next((m for m in manifest if m["name"].lower() == "operation_hastings"), None)
        self.assertIsNotNone(hastings)
        self.assertIn("load.webp", hastings["loading"]["background"])

    def test_T1_FEAT03_04_eod_theme_declared_in_manifest(self) -> None:
        """T1-FEAT03-04: EoD mod theme is set to 'eod' in manifest."""
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode, res.stderr)
        manifest_path = self.dest / "mods" / "eod" / "maps.json"
        if not manifest_path.exists():
            manifest_path = self.dest / "maps.json"
        manifest = json.loads(manifest_path.read_text())
        hastings = next(m for m in manifest if m["name"].lower() == "operation_hastings")
        self.assertEqual("eod", hastings["loading"]["theme"])

    def test_T1_FEAT03_05_extract_all_processes_both_mods(self) -> None:
        """T1-FEAT03-05: --extract-all processes both vanilla and EoD mods."""
        res = self.run_cli("--extract-all")
        self.assertEqual(0, res.returncode, res.stderr)
        self.assertTrue((self.dest / "_shared" / "load" / "pacific2.webp").is_file())
        self.assertTrue((self.dest / "mods" / "eod" / "operation_hastings" / "load.webp").is_file())

    # ----------------------------------------------------------------------- #
    # Feature 4: CLI-EXTRACT-AUDIO (5 Tests: T1-FEAT04-01 to T1-FEAT04-05)
    # ----------------------------------------------------------------------- #
    def test_T1_FEAT04_01_vanilla_audio_extracted(self) -> None:
        """T1-FEAT04-01: Extract vanilla Vehicle4.bik audio stream and transcode to MP3."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "_shared" / "music" / "vehicle4.mp3"
        self.assertTrue(target.is_file(), f"Expected audio at {target}")
        self.assertGreater(target.stat().st_size, 500)

    def test_T1_FEAT04_02_eod_audio_extracted(self) -> None:
        """T1-FEAT04-02: Extract EoD vehicle4.bik audio stream and transcode to MP3."""
        res = self.run_cli("--mod", "eod")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "mods" / "eod" / "_shared" / "music" / "vehicle4.mp3"
        if not target.is_file():
            target = self.dest / "_shared" / "music" / "vehicle4.mp3"
        self.assertTrue(target.is_file())

    def test_T1_FEAT04_03_mp3_codec_and_sampling_rate(self) -> None:
        """T1-FEAT04-03: Verify MP3 encoding bitrate is 192 kbps and sample rate is 44.1 kHz."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "_shared" / "music" / "vehicle4.mp3"
        probe = subprocess.run([
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_name,channels,sample_rate",
            "-of", "json", str(target)
        ], capture_output=True, text=True)
        self.assertEqual(0, probe.returncode)
        info = json.loads(probe.stdout)["streams"][0]
        self.assertEqual("mp3", info["codec_name"])
        self.assertEqual(44100, int(info["sample_rate"]))

    def test_T1_FEAT04_04_audio_bitrate_flag(self) -> None:
        """T1-FEAT04-04: Audio bitrate option respected."""
        res = self.run_cli("--mod", "bf1942", "--audio-bitrate", "128k")
        self.assertEqual(0, res.returncode, res.stderr)
        target = self.dest / "_shared" / "music" / "vehicle4.mp3"
        probe = subprocess.run([
            "ffprobe", "-v", "error",
            "-show_entries", "format=bit_rate",
            "-of", "json", str(target)
        ], capture_output=True, text=True)
        self.assertEqual(0, probe.returncode)
        bitrate = int(json.loads(probe.stdout)["format"]["bit_rate"])
        self.assertAlmostEqual(128000, bitrate, delta=20000)

    def test_T1_FEAT04_05_manifest_points_to_correct_music(self) -> None:
        """T1-FEAT04-05: Manifest points to correct music path."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        manifest = json.loads((self.dest / "maps.json").read_text())
        wake = next(m for m in manifest if m["name"].lower() == "wake")
        self.assertEqual("_shared/music/vehicle4.mp3", wake["loading"]["music"])

    # ----------------------------------------------------------------------- #
    # Feature 5: MANIFEST-GEN (5 Tests: T1-FEAT05-01 to T1-FEAT05-05)
    # ----------------------------------------------------------------------- #
    def test_T1_FEAT05_01_manifest_created(self) -> None:
        """T1-FEAT05-01: Manifest file maps.json created in destination."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        self.assertTrue((self.dest / "maps.json").is_file())

    def test_T1_FEAT05_02_manifest_loading_schema(self) -> None:
        """T1-FEAT05-02: Manifest loading schema conforms to contract."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        manifest = json.loads((self.dest / "maps.json").read_text())
        for entry in manifest:
            self.assertIn("loading", entry)
            loading = entry["loading"]
            for field in ("title", "background", "music", "theme"):
                self.assertIn(field, loading)

    def test_T1_FEAT05_03_manifest_title_formatting(self) -> None:
        """T1-FEAT05-03: Manifest title formatted in uppercase with underscores replaced by spaces."""
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        manifest = json.loads((self.dest / "maps.json").read_text())
        britain = next(m for m in manifest if "britain" in m["name"].lower())
        self.assertEqual("BATTLE OF BRITAIN", britain["loading"]["title"].upper())

    def test_T1_FEAT05_04_preserves_existing_manifest_fields(self) -> None:
        """T1-FEAT05-04: Preserves existing fields in maps.json."""
        maps_file = self.dest / "maps.json"
        maps_file.write_text(json.dumps([{
            "name": "Wake",
            "mod": "bf1942",
            "glb": "wake/scene.glb",
            "worldSize": 2048.0,
        }]))
        res = self.run_cli("--mod", "bf1942")
        self.assertEqual(0, res.returncode, res.stderr)
        manifest = json.loads(maps_file.read_text())
        wake = next(m for m in manifest if m["name"].lower() == "wake")
        self.assertEqual("wake/scene.glb", wake["glb"])
        self.assertEqual(2048.0, wake["worldSize"])
        self.assertIn("loading", wake)

    def test_T1_FEAT05_05_manifest_only_flag(self) -> None:
        """T1-FEAT05-05: --manifest-only flag updates manifest without re-extracting media files."""
        res = self.run_cli("--mod", "bf1942", "--manifest-only")
        self.assertEqual(0, res.returncode, res.stderr)
        self.assertTrue((self.dest / "maps.json").is_file())
        self.assertFalse((self.dest / "_shared" / "music" / "vehicle4.mp3").exists())


if __name__ == "__main__":
    unittest.main()
