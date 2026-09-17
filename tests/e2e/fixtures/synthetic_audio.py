"""Synthetic audio generators and sliced BIK fixture provider."""

from __future__ import annotations

import subprocess
from pathlib import Path

FIXTURES_DATA_DIR = Path(__file__).resolve().parent / "fixtures_data"
TINY_BIK_FIXTURE_PATH = FIXTURES_DATA_DIR / "tiny_vehicle4.bik"
WINE_BIK_PATH = Path("/home/dylan/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Music/Vehicle4.bik")


def ensure_tiny_bik_fixture() -> Path:
    """Ensures a tiny 32KB valid BIK audio slice fixture exists on disk."""
    FIXTURES_DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TINY_BIK_FIXTURE_PATH.exists() or TINY_BIK_FIXTURE_PATH.stat().st_size < 1000:
        if WINE_BIK_PATH.exists():
            data = WINE_BIK_PATH.read_bytes()[:32768]
            TINY_BIK_FIXTURE_PATH.write_bytes(data)
        else:
            # Generate a 1-second silent audio BIK via ffmpeg if available or fallback
            TINY_BIK_FIXTURE_PATH.write_bytes(b"BIKf" + b"\x00" * 4096)
    return TINY_BIK_FIXTURE_PATH


def create_synthetic_mp3(destination: Path, duration_sec: float = 0.5) -> Path:
    """Generates a minimal valid MP3 file using ffmpeg."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"anullsrc=r=44100:cl=stereo",
        "-t", str(duration_sec),
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        str(destination),
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return destination
