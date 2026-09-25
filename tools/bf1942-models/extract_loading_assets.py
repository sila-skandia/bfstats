#!/usr/bin/env python3
"""Extract authentic Battlefield 1942 and mod loading screen assets.

Extracts UI chrome (metallic frame plate cropped to active 290x64 and 256x16 fill bar),
800x600 loading screen background artwork (DDS/TGA -> WebP at quality=85), and Bink
loading music (vehicle4.bik -> 192k MP3 via FFmpeg). Generates or updates the loading
metadata schema in maps.json for vanilla and mods (e.g. Eve of Destruction).

CLI Usage:
    python3 tools/bf1942-models/extract_loading_assets.py \\
        --bf1942-dir "/path/to/Battlefield 1942" \\
        --output-dir tools/bf1942-models/viewer/maps \\
        --mod bf1942 eod \\
        --levels all
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import io
import json
import logging
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import time
from typing import Any

from PIL import Image

# Ensure tools/bf1942-models is in sys.path to import bf42 modules
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    from bf42.rfa import RfaArchive
except ImportError:
    # Fallback to claude skill path if not yet in sys.path
    skill_scripts = Path.home() / ".claude/skills/bf1942-map-images/scripts"
    if skill_scripts.is_dir() and str(skill_scripts) not in sys.path:
        sys.path.insert(0, str(skill_scripts))
    from extract_map_images import RfaArchive

logger = logging.getLogger("extract_loading_assets")


# --------------------------------------------------------------------------- #
# Constants & Defaults
# --------------------------------------------------------------------------- #

CANDIDATE_PATHS: list[Path] = [
    Path.home() / ".wine/drive_c/EA Games/Battlefield 1942",
    Path.home() / ".wine/drive_c/EAGames/Battlefield 1942",
    Path.home() / ".wine/drive_c/Program Files (x86)/EA Games/Battlefield 1942",
    Path.home() / ".wine/drive_c/Program Files/EA Games/Battlefield 1942",
    Path.home() / ".wine/drive_c/Program Files (x86)/EA GAMES/Battlefield 1942",
    Path.home() / ".wine/drive_c/Program Files/EA GAMES/Battlefield 1942",
]

DEFAULT_GAME_DIR: Path = CANDIDATE_PATHS[0]

STANDARD_THEATERS: set[str] = {
    "desert",
    "eastern",
    "eastern2",
    "pacific",
    "pacific2",
    "western",
    "western2",
}

THEATER_MAP: dict[str, str] = {
    "desert": "_shared/load/desert.webp",
    "eastern": "_shared/load/eastern.webp",
    "eastern2": "_shared/load/eastern2.webp",
    "pacific": "_shared/load/pacific.webp",
    "pacific2": "_shared/load/pacific2.webp",
    "western": "_shared/load/western.webp",
    "western2": "_shared/load/western2.webp",
}

CANONICAL_TITLES: dict[str, str] = {
    "wake": "WAKE ISLAND",
    "coral_sea": "CORAL SEA",
    "el_alamein": "EL ALAMEIN",
    "battle_of_britain": "BATTLE OF BRITAIN",
    "battle_of_the_bulge": "BATTLE OF THE BULGE",
    "liberation_of_caen": "LIBERATION OF CAEN",
    "invasion_of_the_philippines": "INVASION OF THE PHILIPPINES",
    "kasserine_pass": "KASSERINE PASS",
    "market_garden": "MARKET GARDEN",
    "omaha_beach": "OMAHA BEACH",
    "charlie_don't_surf": "CHARLIE DON'T SURF",
    "charly's_nest": "CHARLY'S NEST",
    "cs_minimetzel": "CS MINIMETZEL",
    "de_dust": "DE DUST",
    "m_i_a": "M.I.A.",
    "pow": "P.O.W.",
}

# `rem` opens a comment only as a word of its own. Matching the bare letters cut
# `levels/remagen/...` off at `levels/`, which lost Remagen its load picture.
CON_COMMAND_RE = re.compile(
    r'^\s*(?:game\.)?(?P<cmd>setLoadPicture|setBackgroundMusic|setLoadMusicFilename)\s+["\']?(?P<arg>[^"\'\r\n]+?)["\']?(?:\s+rem\b.*)?\s*$',
    re.IGNORECASE | re.MULTILINE,
)
_REM_LINE_RE = re.compile(r"rem\b", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# Filesystem Resolution Utilities (Case-Insensitive Linux Support)
# --------------------------------------------------------------------------- #

def resolve_case_insensitive(base: Path, rel_path: str | Path) -> Path | None:
    """Resolve a relative path against a base directory case-insensitively on Linux.

    Traverses path components step-by-step, matching entries by lowercase comparison.
    Returns the exact resolved Path on disk, or None if not found.
    """
    curr = Path(base)
    for part in Path(rel_path).parts:
        if not curr.is_dir():
            return None
        target = part.lower()
        matched: Path | None = None
        for child in curr.iterdir():
            if child.name.lower() == target:
                matched = child
                break
        if matched is None:
            return None
        curr = matched
    return curr


def resolve_mod_dir(game_dir: Path, mod_name: str) -> Path | None:
    """Locate the root directory of a mod under <game_dir>/Mods/<mod_name>."""
    mods_dir = resolve_case_insensitive(game_dir, "Mods")
    if not mods_dir or not mods_dir.is_dir():
        return None
    return resolve_case_insensitive(mods_dir, mod_name)


def auto_detect_bf1942_dir(
    explicit: Path | None = None,
    requested_mods: list[str] | None = None,
) -> Path:
    """Auto-detect Battlefield 1942 root directory across environment and Wine paths.

    Scores candidate paths based on the presence of requested mods and total mod count.
    """
    if explicit:
        p = explicit.expanduser().resolve()
        if not p.is_dir():
            raise FileNotFoundError(f"Specified --bf1942-dir does not exist: {p}")
        return p

    env_dir = os.environ.get("BF1942_DIR") or os.environ.get("BF1942_GAME_DIR")
    if env_dir:
        p = Path(env_dir).expanduser().resolve()
        if p.is_dir():
            return p

    valid_candidates: list[tuple[int, Path]] = []
    for cand in CANDIDATE_PATHS:
        if cand.is_dir():
            mods_dir = resolve_case_insensitive(cand, "Mods")
            if mods_dir and mods_dir.is_dir():
                mods_on_disk = {d.name.lower() for d in mods_dir.iterdir() if d.is_dir()}
                score = len(mods_on_disk)
                if requested_mods:
                    if all(m.lower() in mods_on_disk for m in requested_mods):
                        score += 100
                valid_candidates.append((score, cand))

    if not valid_candidates:
        raise FileNotFoundError(
            "Could not auto-detect Battlefield 1942 installation directory. "
            "Please specify --bf1942-dir."
        )

    valid_candidates.sort(key=lambda x: x[0], reverse=True)
    return valid_candidates[0][1]


def find_mod_music_file(
    mod_dirs: list[Path],
    rel_music_path: str = "music/vehicle4.bik",
) -> Path | None:
    """Search for a music file across a chain of mod directories (e.g. EoD -> bf1942)."""
    for mod_dir in mod_dirs:
        found = resolve_case_insensitive(mod_dir, rel_music_path)
        if found and found.is_file():
            return found
    return None


def find_level_archives(levels_dir: Path | None, level_name: str) -> list[Path]:
    """Find all RFA archives matching a level name, sorted patch-first (e.g. _003, _000, base)."""
    if not levels_dir or not levels_dir.is_dir():
        return []
    target = level_name.lower()
    matches: list[Path] = []
    for f in levels_dir.iterdir():
        if f.is_file() and f.suffix.lower() == ".rfa":
            stem = f.stem.lower()
            if stem == target or stem.startswith(f"{target}_"):
                matches.append(f)
    # Sort reverse so patches (e.g. _003) precede base archive
    return sorted(matches, key=lambda p: p.stem.lower(), reverse=True)


# --------------------------------------------------------------------------- #
# Archive Reader Wrapper
# --------------------------------------------------------------------------- #

class ArchiveReader:
    """Case-insensitive wrapper around bf42.rfa.RfaArchive."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.archive = RfaArchive(self.path)
        self._index: dict[str, str] = {}
        for name in self.archive.entries:
            norm = name.replace("\\", "/").lower()
            self._index[norm] = name

    def find(self, pattern: str) -> str | None:
        """Find an entry by exact path, then whole trailing path, then substring.

        Strictest first, each as its own pass: one loop that accepted any
        suffix let `reloader.tga` answer for `loader.tga` whenever the archive
        happened to list it earlier.
        """
        needle = pattern.replace("\\", "/").lower()
        if needle in self._index:
            return self._index[needle]
        tail = "/" + needle.lstrip("/")
        for accept in (lambda norm: norm.endswith(tail),
                       lambda norm: norm.endswith(needle),
                       lambda norm: needle in norm):
            for norm, real in self._index.items():
                if accept(norm):
                    return real
        return None

    def read(self, entry_name: str) -> bytes:
        norm = entry_name.replace("\\", "/").lower()
        real = self._index.get(norm)
        if real is None:
            real = self.find(entry_name)
        if real is None:
            raise KeyError(f"Entry {entry_name!r} not found in archive {self.path.name}")
        return self.archive.read(real)

    def entries(self) -> list[str]:
        return list(self.archive.entries.keys())

    def close(self) -> None:
        if hasattr(self.archive, "close"):
            self.archive.close()

    def __enter__(self) -> "ArchiveReader":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


# --------------------------------------------------------------------------- #
# Script Parsing & Title Formatting
# --------------------------------------------------------------------------- #

def parse_menu_init_con(content: str) -> dict[str, str]:
    """Extract loading commands from Menu/init.con.

    Handles setLoadPicture, setBackgroundMusic, and setLoadMusicFilename,
    stripping comments and quotes, and normalizing slashes.
    """
    results: dict[str, str] = {}
    for line in content.splitlines():
        line = line.strip()
        if not line or _REM_LINE_RE.match(line):
            continue
        match = CON_COMMAND_RE.match(line)
        if match:
            cmd = match.group("cmd").lower()
            arg = match.group("arg").strip().replace("\\", "/")
            arg = arg.strip("\"'")
            results[cmd] = arg
    return results


def format_map_title(name: str) -> str:
    """Format map directory name into authentic in-game uppercase loading title."""
    cleaned = name.strip()
    tokens = cleaned.replace("_", " ").split()
    # Look the name up the way it will be spoken, so stray separators around a
    # directory name (`__wake__`) still find `wake`.
    for key in (cleaned.lower(), "_".join(tokens).lower()):
        if key in CANONICAL_TITLES:
            return CANONICAL_TITLES[key]
    return " ".join(tokens).upper()


# --------------------------------------------------------------------------- #
# Image Decoding, Cropping, and WebP/PNG Conversion
# --------------------------------------------------------------------------- #

def decode_image_bytes(raw: bytes) -> Image.Image:
    """Decode raw texture bytes (DDS or TGA) into a PIL Image.

    Supports DDS (DXT1/DXT3/DXT5/uncompressed) and TGA (24/32-bit uncompressed/RLE).
    """
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
        return im
    except Exception as exc:
        if raw.startswith(b"DDS "):
            try:
                scripts_dir = SCRIPT_DIR.parent.parent / "scripts"
                if str(scripts_dir) not in sys.path:
                    sys.path.insert(0, str(scripts_dir))
                from extract_hud_assets import decode_dds
                w, h, rgba = decode_dds(raw)
                return Image.frombytes("RGBA", (w, h), rgba)
            except Exception:
                pass
        raise ValueError(f"Failed to decode image bytes: {exc}") from exc


def convert_ui_chrome_dds(
    dds_bytes: bytes,
    out_png_path: Path,
    crop_active: bool = True,
    overwrite: bool = False,
    dry_run: bool = False,
    crop_to_content: bool = False,
) -> tuple[int, int]:
    """Decode UI chrome DDS and save as PNG.

    If crop_active is True and image is 512x64, crops to (0, 0, 290, 64) to
    discard the 222px transparent power-of-two padding. If crop_to_content is
    True the image is cropped to its alpha bounding box instead — the briefing
    dialog plate is drawn 512x512 but paints only its top 334 rows.
    """
    out_png_path = Path(out_png_path)
    if out_png_path.is_file() and not overwrite and not dry_run:
        with Image.open(out_png_path) as im:
            return im.size

    im = decode_image_bytes(dds_bytes).convert("RGBA")
    if crop_active and im.size == (512, 64):
        im = im.crop((0, 0, 290, 64))
    elif crop_to_content:
        bbox = im.getchannel("A").getbbox()
        if bbox:
            im = im.crop(bbox)

    final_size = im.size
    if not dry_run:
        out_png_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = out_png_path.with_name(f".tmp_{out_png_path.name}")
        try:
            im.save(tmp_path, format="PNG", optimize=True)
            tmp_path.replace(out_png_path)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink()
            raise

    return final_size


def convert_background_to_webp(
    raw_bytes: bytes,
    out_webp_path: Path,
    quality: int = 85,
    overwrite: bool = False,
    dry_run: bool = False,
) -> tuple[int, int]:
    """Decode 800x600 background texture (TGA or DDS) and encode to WebP."""
    out_webp_path = Path(out_webp_path)
    if out_webp_path.is_file() and not overwrite and not dry_run:
        with Image.open(out_webp_path) as im:
            return im.size

    im = decode_image_bytes(raw_bytes)
    if im.mode == "RGBA":
        extrema = im.getextrema()
        if extrema[3] == (255, 255):
            im = im.convert("RGB")
    elif im.mode != "RGB":
        im = im.convert("RGB")

    final_size = im.size
    if not dry_run:
        out_webp_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = out_webp_path.with_name(f".tmp_{out_webp_path.name}")
        try:
            im.save(tmp_path, format="WEBP", quality=quality, method=6)
            tmp_path.replace(out_webp_path)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink()
            raise

    return final_size


# --------------------------------------------------------------------------- #
# Audio Extraction & Transcoding Pipeline (BIK -> MP3)
# --------------------------------------------------------------------------- #

def transcode_bik_to_mp3(
    bik_path: Path,
    out_mp3_path: Path,
    bitrate: str = "192k",
    overwrite: bool = False,
    dry_run: bool = False,
) -> bool:
    """Extract audio stream from BIK and transcode to 192k MP3 via FFmpeg."""
    bik_path = Path(bik_path)
    out_mp3_path = Path(out_mp3_path)

    if not bik_path.is_file():
        raise FileNotFoundError(f"Source BIK file not found: {bik_path}")

    if out_mp3_path.is_file() and out_mp3_path.stat().st_size > 0 and not overwrite:
        return False

    if dry_run:
        return True

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg executable not found in PATH. Audio transcoding requires ffmpeg.")

    out_mp3_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_mp3_path.with_name(f".tmp_{out_mp3_path.name}")

    cmd = [
        ffmpeg_bin,
        "-y",
        "-nostats",
        "-loglevel", "error",
        "-i", str(bik_path),
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", bitrate,
        "-ar", "44100",
        "-ac", "2",
        str(tmp_path),
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res.returncode != 0:
            if tmp_path.exists():
                tmp_path.unlink()
            raise RuntimeError(f"FFmpeg transcoding failed (code {res.returncode}): {res.stderr.strip()}")
        tmp_path.replace(out_mp3_path)
        return True
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise


# --------------------------------------------------------------------------- #
# Manifest Generation & Updating
# --------------------------------------------------------------------------- #

def update_manifest(
    manifest_path: Path,
    level_records: dict[str, dict[str, Any]],
    dry_run: bool = False,
) -> int:
    """Update maps.json in place with loading metadata, preserving all existing keys."""
    manifest_path = Path(manifest_path)
    if not manifest_path.is_file():
        logger.warning("Manifest not found: %s", manifest_path)
        return 0

    content = manifest_path.read_text(encoding="utf-8")
    data = json.loads(content)
    if not isinstance(data, list):
        raise ValueError(f"Expected list in manifest at {manifest_path}, got {type(data)}")

    updated_count = 0
    for entry in data:
        name = entry.get("name")
        if not name:
            continue
        key = name.lower()
        if key in level_records:
            entry["loading"] = level_records[key]
            updated_count += 1
        elif "loading" not in entry:
            mod = entry.get("mod", "bf1942")
            theme = "eod" if str(mod).lower() == "eod" else "vanilla"
            entry["loading"] = {
                "title": format_map_title(name),
                "background": "_shared/load/western.webp",
                "music": "_shared/music/vehicle4.mp3",
                "theme": theme,
            }
            updated_count += 1

    # Sort entries alphabetically by name
    data.sort(key=lambda x: str(x.get("name", "")).lower())

    if not dry_run:
        tmp_path = manifest_path.with_name(f".tmp_{manifest_path.name}")
        try:
            tmp_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            tmp_path.replace(manifest_path)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink()
            raise

    return updated_count


# --------------------------------------------------------------------------- #
# Main Extractor Orchestrator
# --------------------------------------------------------------------------- #

@dataclass
class ExtractionSummary:
    chrome_extracted: int = 0
    backgrounds_extracted: int = 0
    audio_extracted: int = 0
    manifest_entries_updated: int = 0
    skipped_existing: int = 0
    errors: list[str] = field(default_factory=list)


class LoadingAssetExtractor:
    """Orchestrates asset extraction across vanilla BF1942 and mods."""

    def __init__(
        self,
        bf1942_dir: Path,
        output_dir: Path,
        mods: list[str] | None = None,
        levels: list[str] | None = None,
        chrome_only: bool = False,
        backgrounds_only: bool = False,
        audio_only: bool = False,
        manifest_only: bool = False,
        dry_run: bool = False,
        verbose: bool = False,
    ):
        self.bf1942_dir = Path(bf1942_dir)
        self.output_dir = Path(output_dir)
        self.mods = [m.lower() for m in (mods or ["bf1942", "eod"])]
        self.levels = [l.lower() for l in (levels or ["all"])]
        self.chrome_only = chrome_only
        self.backgrounds_only = backgrounds_only
        self.audio_only = audio_only
        self.manifest_only = manifest_only
        self.dry_run = dry_run
        self.verbose = verbose
        self.summary = ExtractionSummary()

        self.vanilla_dir = resolve_mod_dir(self.bf1942_dir, "bf1942")

    def run(self) -> ExtractionSummary:
        """Run extraction according to configured flags."""
        logger.info("Starting loading asset extraction from: %s", self.bf1942_dir)
        logger.info("Output directory: %s", self.output_dir)
        logger.info("Target mods: %s", self.mods)

        # 1. UI Chrome extraction
        if not (self.backgrounds_only or self.audio_only or self.manifest_only):
            self.extract_chrome()

        # 2. Audio extraction
        if not (self.chrome_only or self.backgrounds_only or self.manifest_only):
            self.extract_audio()

        # 3. Theater backgrounds extraction
        if not (self.chrome_only or self.audio_only or self.manifest_only):
            self.extract_theater_backgrounds()

        # 4. Levels background extraction and manifest generation
        if not (self.chrome_only or self.audio_only):
            for mod in self.mods:
                self.process_mod_levels(mod)

        return self.summary

    def extract_chrome(self) -> None:
        """Extract menu_loading.png (290x64) and loading_bar.png (256x16) for each mod."""
        for mod in self.mods:
            mod_dir = resolve_mod_dir(self.bf1942_dir, mod)
            if not mod_dir:
                msg = f"Mod directory not found for {mod}"
                logger.warning(msg)
                self.summary.errors.append(msg)
                continue

            archives_dir = resolve_case_insensitive(mod_dir, "Archives")
            if not archives_dir:
                continue

            menu_rfa = resolve_case_insensitive(archives_dir, "menu.rfa")
            if not menu_rfa or not menu_rfa.is_file():
                continue

            dest_dir = (
                self.output_dir / "_shared" / "load"
                if mod == "bf1942"
                else self.output_dir / "mods" / mod / "_shared" / "load"
            )

            with ArchiveReader(menu_rfa) as reader:
                # 1. Beveled box container: menu/Texture/Briefing/menu_loading.dds -> 290x64 PNG
                plate_entry = reader.find("menu_loading.dds")
                if plate_entry:
                    raw_plate = reader.read(plate_entry)
                    dest_plate = dest_dir / "menu_loading.png"
                    size = convert_ui_chrome_dds(
                        raw_plate,
                        dest_plate,
                        crop_active=True,
                        overwrite=True,
                        dry_run=self.dry_run,
                    )
                    logger.info("[%s] Extracted menu_loading.png (%dx%d) -> %s", mod, size[0], size[1], dest_plate)
                    self.summary.chrome_extracted += 1

                # 2. Fill bar: menu/Texture/loading_full_256x16.dds -> 256x16 PNG
                bar_entry = reader.find("loading_full_256x16.dds")
                if bar_entry:
                    raw_bar = reader.read(bar_entry)
                    dest_bar = dest_dir / "loading_bar.png"
                    size = convert_ui_chrome_dds(
                        raw_bar,
                        dest_bar,
                        crop_active=False,
                        overwrite=True,
                        dry_run=self.dry_run,
                    )
                    logger.info("[%s] Extracted loading_bar.png (%dx%d) -> %s", mod, size[0], size[1], dest_bar)
                    self.summary.chrome_extracted += 1

                # 3. The mission-briefing dialog plate: the screen the game
                # puts up over the loaded level, with the map name, teams,
                # settings and the objectives/comments boxes on it. Painted
                # 1:1 in the 800x600 stage; only its top 334 rows carry pixels.
                plate_entry = reader.find("mp_briefing_512x512.dds")
                if plate_entry:
                    raw_plate = reader.read(plate_entry)
                    dest_plate = dest_dir / "mp_briefing.png"
                    size = convert_ui_chrome_dds(
                        raw_plate,
                        dest_plate,
                        crop_active=False,
                        overwrite=True,
                        dry_run=self.dry_run,
                        crop_to_content=True,
                    )
                    logger.info("[%s] Extracted mp_briefing.png (%dx%d) -> %s", mod, size[0], size[1], dest_plate)
                    self.summary.chrome_extracted += 1

    def extract_theater_backgrounds(self) -> None:
        """Extract the 7 standard vanilla theater backgrounds to _shared/load/*.webp."""
        if not self.vanilla_dir:
            return

        archives_dir = resolve_case_insensitive(self.vanilla_dir, "Archives")
        if not archives_dir:
            return

        menu_rfa = resolve_case_insensitive(archives_dir, "menu.rfa")
        if not menu_rfa or not menu_rfa.is_file():
            return

        dest_dir = self.output_dir / "_shared" / "load"

        with ArchiveReader(menu_rfa) as reader:
            for theater in STANDARD_THEATERS:
                tga_entry = reader.find(f"menu/texture/load/{theater}.tga") or reader.find(f"{theater}.tga")
                if tga_entry:
                    raw = reader.read(tga_entry)
                    out_path = dest_dir / f"{theater}.webp"
                    size = convert_background_to_webp(
                        raw,
                        out_path,
                        quality=85,
                        overwrite=True,
                        dry_run=self.dry_run,
                    )
                    logger.info("Extracted theater background %s (%dx%d) -> %s", theater, size[0], size[1], out_path)
                    self.summary.backgrounds_extracted += 1

                    # Also ensure western.webp exists in mod _shared/load/ if EoD is processed
                    if "eod" in self.mods:
                        eod_fallback = self.output_dir / "mods" / "eod" / "_shared" / "load" / f"{theater}.webp"
                        convert_background_to_webp(
                            raw,
                            eod_fallback,
                            quality=85,
                            overwrite=True,
                            dry_run=self.dry_run,
                        )

    def extract_audio(self) -> None:
        """Extract vehicle4.bik to 192k MP3 for each mod."""
        for mod in self.mods:
            mod_dir = resolve_mod_dir(self.bf1942_dir, mod)
            mod_dirs = [mod_dir] if mod_dir else []
            if self.vanilla_dir and self.vanilla_dir not in mod_dirs:
                mod_dirs.append(self.vanilla_dir)

            bik_file = find_mod_music_file(mod_dirs, "music/vehicle4.bik")
            if not bik_file:
                logger.warning("[%s] vehicle4.bik not found in music directory", mod)
                continue

            dest_mp3 = (
                self.output_dir / "_shared" / "music" / "vehicle4.mp3"
                if mod == "bf1942"
                else self.output_dir / "mods" / mod / "_shared" / "music" / "vehicle4.mp3"
            )

            try:
                transcoded = transcode_bik_to_mp3(
                    bik_file,
                    dest_mp3,
                    bitrate="192k",
                    overwrite=True,
                    dry_run=self.dry_run,
                )
                if transcoded:
                    logger.info("[%s] Transcoded loading audio -> %s", mod, dest_mp3)
                    self.summary.audio_extracted += 1
                else:
                    self.summary.skipped_existing += 1
            except Exception as exc:
                msg = f"Failed to transcode audio for {mod}: {exc}"
                logger.error(msg)
                self.summary.errors.append(msg)

    def process_mod_levels(self, mod: str) -> None:
        """Process level backgrounds and update maps.json for a given mod."""
        mod_dir = resolve_mod_dir(self.bf1942_dir, mod)
        mod_dirs: list[Path] = [mod_dir] if mod_dir else []
        if self.vanilla_dir and self.vanilla_dir not in mod_dirs:
            mod_dirs.append(self.vanilla_dir)

        is_vanilla = (mod == "bf1942")
        theme = "eod" if mod == "eod" else "vanilla"

        mod_output_dir = self.output_dir if is_vanilla else self.output_dir / "mods" / mod
        manifest_path = mod_output_dir / "maps.json"

        # Determine target levels
        filter_levels = (
            None
            if "all" in self.levels
            else {lvl.lower() for lvl in self.levels}
        )

        # Collect map names from manifest if manifest exists, plus levels on disk
        target_maps: set[str] = set()
        if manifest_path.is_file():
            try:
                data = json.loads(manifest_path.read_text(encoding="utf-8"))
                for e in data:
                    if "name" in e:
                        target_maps.add(e["name"])
            except Exception as exc:
                logger.warning("Could not read manifest at %s: %exc", manifest_path, exc)

        # Also probe levels directory on disk
        levels_dir = None
        if mod_dir:
            archives_dir = resolve_case_insensitive(mod_dir, "Archives")
            if archives_dir:
                levels_dir = resolve_case_insensitive(archives_dir, "bf1942/levels")
                if levels_dir and levels_dir.is_dir():
                    for p in levels_dir.glob("*.rfa"):
                        clean_stem = p.stem.split("_00")[0]
                        target_maps.add(clean_stem)

        level_records: dict[str, dict[str, Any]] = {}

        for map_name in sorted(target_maps, key=lambda s: s.lower()):
            slug = map_name.lower()
            if filter_levels and slug not in filter_levels:
                continue

            title = format_map_title(map_name)
            bg_ref, source_bg = self.resolve_level_background(map_name, mod, mod_dirs)

            # Extract level override background if source bytes are found and not manifest_only
            if source_bg and not self.manifest_only:
                raw_bytes, dest_file = source_bg
                out_path = mod_output_dir / dest_file
                size = convert_background_to_webp(
                    raw_bytes,
                    out_path,
                    quality=85,
                    overwrite=True,
                    dry_run=self.dry_run,
                )
                logger.info("[%s] Extracted level background %s (%dx%d) -> %s", mod, map_name, size[0], size[1], out_path)
                self.summary.backgrounds_extracted += 1

            music_ref = "_shared/music/vehicle4.mp3"

            record = {
                "title": title,
                "background": bg_ref,
                "music": music_ref,
                "theme": theme,
            }
            level_records[slug] = record

        # Update manifest
        if manifest_path.is_file():
            updated = update_manifest(manifest_path, level_records, dry_run=self.dry_run)
            logger.info("[%s] Updated %d entries in manifest %s", mod, updated, manifest_path)
            self.summary.manifest_entries_updated += updated

    def resolve_level_background(
        self,
        map_name: str,
        mod: str,
        mod_dirs: list[Path],
    ) -> tuple[str, tuple[bytes, Path] | None]:
        """Resolve background image path and raw source bytes for a level.

        Returns (bg_ref, (raw_bytes, dest_rel_path) | None).
        """
        slug = map_name.lower()

        # Search level archives across mod directory chain (nearest mod first)
        found_rfas: list[Path] = []
        for mdir in mod_dirs:
            archives_dir = resolve_case_insensitive(mdir, "Archives")
            if archives_dir:
                levels_dir = resolve_case_insensitive(archives_dir, "bf1942/levels")
                if levels_dir:
                    rfas = find_level_archives(levels_dir, map_name)
                    if rfas:
                        found_rfas.extend(rfas)
                        break  # Highest-priority mod containing this level wins

        for rfa_path in found_rfas:
            try:
                with ArchiveReader(rfa_path) as reader:
                    # Check Menu/init.con
                    init_entry = reader.find("menu/init.con")
                    if init_entry:
                        con_text = reader.read(init_entry).decode("latin-1", errors="replace")
                        cmds = parse_menu_init_con(con_text)
                        if "setloadpicture" in cmds:
                            arg = cmds["setloadpicture"]
                            arg_lower = arg.lower()

                            # Theater background (e.g. Load/Desert.tga, Load/Pacific2.tga)
                            if arg_lower.startswith("load/"):
                                stem = Path(arg).stem.lower()
                                if stem in STANDARD_THEATERS:
                                    return (f"_shared/load/{stem}.webp", None)

                            # Relative / level override path
                            leaf = Path(arg).name.lower()
                            override_entry = reader.find(leaf)
                            if override_entry:
                                raw = reader.read(override_entry)
                                return (f"{slug}/load.webp", (raw, Path(slug) / "load.webp"))

                    # EoD standard or generic level loader: loader.tga
                    loader_entry = reader.find("loader.tga") or reader.find("load.tga")
                    if loader_entry:
                        raw = reader.read(loader_entry)
                        return (f"{slug}/load.webp", (raw, Path(slug) / "load.webp"))

            except Exception as exc:
                logger.debug("Error reading archive %s: %s", rfa_path, exc)

        # Fallback default
        return ("_shared/load/western.webp", None)


# --------------------------------------------------------------------------- #
# CLI Entry Point
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    default_output = Path("tools/bf1942-models/viewer/maps")
    if not default_output.is_dir() and Path("viewer/maps").is_dir():
        default_output = Path("viewer/maps")

    parser = argparse.ArgumentParser(
        description="Extract authentic BF1942 and mod loading screen assets."
    )
    parser.add_argument(
        "--bf1942-dir", "--game-dir",
        dest="bf1942_dir",
        type=Path,
        default=None,
        help="Path to Battlefield 1942 game installation root (auto-probed if omitted).",
    )
    parser.add_argument(
        "--output-dir", "--out",
        dest="output_dir",
        type=Path,
        default=default_output,
        help="Target base directory for viewer maps (default: %(default)s).",
    )
    parser.add_argument(
        "--mod",
        nargs="+",
        default=["bf1942", "eod"],
        help="Target mod(s) to process (default: bf1942 eod).",
    )
    parser.add_argument(
        "--levels",
        nargs="+",
        default=["all"],
        help="Specific level names to process, or 'all' (default: all).",
    )
    parser.add_argument(
        "--chrome-only",
        action="store_true",
        help="Only extract UI chrome textures (menu_loading.png, loading_bar.png).",
    )
    parser.add_argument(
        "--backgrounds-only",
        action="store_true",
        help="Only extract loading backgrounds (WebP).",
    )
    parser.add_argument(
        "--audio-only",
        action="store_true",
        help="Only extract loading music (MP3).",
    )
    parser.add_argument(
        "--manifest-only",
        action="store_true",
        help="Only scan assets and update maps.json without re-extracting binaries.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan and report actions without modifying filesystem.",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging output.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    try:
        game_dir = auto_detect_bf1942_dir(args.bf1942_dir, requested_mods=args.mod)
    except FileNotFoundError as err:
        logger.error("%s", err)
        return 1

    extractor = LoadingAssetExtractor(
        bf1942_dir=game_dir,
        output_dir=args.output_dir,
        mods=args.mod,
        levels=args.levels,
        chrome_only=args.chrome_only,
        backgrounds_only=args.backgrounds_only,
        audio_only=args.audio_only,
        manifest_only=args.manifest_only,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )

    summary = extractor.run()

    print("\n--- Extraction Summary ---")
    print(f"UI Chrome extracted:        {summary.chrome_extracted}")
    print(f"Backgrounds extracted:      {summary.backgrounds_extracted}")
    print(f"Audio tracks transcoded:    {summary.audio_extracted}")
    print(f"Manifest entries updated:   {summary.manifest_entries_updated}")
    print(f"Skipped existing:           {summary.skipped_existing}")
    if summary.errors:
        print(f"Errors encountered:         {len(summary.errors)}")
        for err in summary.errors:
            print(f"  - {err}")
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
