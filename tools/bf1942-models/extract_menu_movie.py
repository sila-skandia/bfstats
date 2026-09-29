#!/usr/bin/env python3
"""Transcode each mod's front-end background movie to WebM, for `play/index.html`.

Retail's `menu/Background` - the page every front-end screen is drawn over -
holds the still `menu/Texture/Menu/Background.tga` and a `BfBinkNode` on the
same 800x450 rect, gated on `PlayBink` and off while a game is running
(`Join/Disconnect/ShowDisconnect`). The movie it plays is `Movies/background.bik`
(320x180, 25 fps, no audio, about 75 s), looked up along the mod's own
`game.addModPath` chain nearest first, as `extract_menu_music.py` finds the
menu loop: vanilla, XPack1 and XPack2 each ship their own.

The menu MemeFile names no file (the node carries only its gate), so the path
is the engine's fixed one rather than a directive to read.

Output is one VP9 WebM per mod, silent, at the movie's own size - the page
scales it to the plate as the engine did. VP9 rather than H.264 because the
headless Chromium the tests run in decodes no proprietary codecs:

    viewer/maps/_shared/movies/background.webm            vanilla
    viewer/maps/mods/<id>/_shared/movies/background.webm  every other mod

`play/menu-movie.js` reads it at `${MAPS}/_shared/movies/background.webm`. A
mod with none keeps its still.

With no `--mod`, vanilla and every mod with levels under `--out` are
transcoded (`extract_menu_music.default_mods`).

Usage:
    python3 tools/bf1942-models/extract_menu_movie.py --mod bf1942 --mod xpack1 --mod xpack2
    python3 tools/bf1942-models/extract_menu_movie.py --mod xpack1 --force
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_loading_assets import (  # noqa: E402
    auto_detect_bf1942_dir, find_mod_music_file, resolve_mod_dir,
)
from extract_menu_music import default_mods, search_path  # noqa: E402

HERE = Path(__file__).resolve().parent
VIEWER_MAPS_DIR = HERE / "viewer" / "maps"

#: Where the engine looks for the front end's movie, in each mod directory.
MOVIE_REL_PATH = "movies/background.bik"


def movie_dest(out: Path, mod: str) -> Path:
    base = out if mod == "bf1942" else out / "mods" / mod
    return base / "_shared" / "movies" / "background.webm"


def transcode_bik_to_webm(bik_path: Path, dest: Path, *, crf: int = 30,
                          overwrite: bool = False, dry_run: bool = False) -> bool:
    """VP9, constant quality, no audio. False when `dest` is already there."""
    if dest.is_file() and dest.stat().st_size > 0 and not overwrite:
        return False
    if dry_run:
        return True
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg executable not found in PATH")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".tmp_{dest.name}")
    cmd = [ffmpeg, "-y", "-nostats", "-loglevel", "error", "-i", str(bik_path),
           "-an", "-c:v", "libvpx-vp9", "-crf", str(crf), "-b:v", "0",
           "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
           "-pix_fmt", "yuv420p", "-f", "webm", str(tmp)]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"ffmpeg failed (code {res.returncode}): {res.stderr.strip()}")
        tmp.replace(dest)
        return True
    finally:
        if tmp.exists():
            tmp.unlink()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bf1942-dir", type=Path, default=None)
    ap.add_argument("--mod", action="append", dest="mods", default=None,
                    help="Repeatable. Defaults to vanilla and every mod with levels under --out.")
    ap.add_argument("--out", type=Path, default=VIEWER_MAPS_DIR)
    ap.add_argument("--force", action="store_true", help="re-transcode an existing movie")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    mods = [m.lower() for m in (args.mods or default_mods(args.out))]
    bf1942_dir = auto_detect_bf1942_dir(args.bf1942_dir, mods)
    vanilla_dir = resolve_mod_dir(bf1942_dir, "bf1942")
    if not vanilla_dir:
        sys.exit(f"no Mods/bf1942 under {bf1942_dir}")

    ok = 0
    for mod in mods:
        chain = search_path(bf1942_dir, mod, vanilla_dir)
        if not chain:
            print(f"warning: no Mods/{mod} under {bf1942_dir}", file=sys.stderr)
            continue
        bik_file = find_mod_music_file(chain, MOVIE_REL_PATH)
        if not bik_file:
            print(f"warning: [{mod}] {MOVIE_REL_PATH} not found", file=sys.stderr)
            continue
        dest = movie_dest(args.out, mod)
        transcoded = transcode_bik_to_webm(
            bik_file, dest, overwrite=args.force, dry_run=args.dry_run)
        print(f"[{mod}] {bik_file.relative_to(bf1942_dir)} -> {dest}"
              + ("" if transcoded else " (already present)"), file=sys.stderr)
        ok += 1

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
