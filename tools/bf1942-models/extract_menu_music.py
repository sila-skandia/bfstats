#!/usr/bin/env python3
"""Transcode each mod's own main-menu music to MP3, for `play/index.html`.

Not the loading music `extract_loading_assets.py` already pulls
(`Game.setLoadMusicFilename`, `vehicle4.bik` for every mod on disk) and not
the well-known "Theme2" battle theme either. The main menu - and the exit
confirmation dialog, which is still the main menu underneath it - loops
whatever a mod's own `init.con` names with `Game.setMenuMusicFilename`.
Every mod installed here happens to point that at `music/slaughter4.bik`,
but a mod is free to name a different file, so this script reads the
directive rather than assuming the name - the same reason
`extract_custom_game_layout.py` reads each mod's `setCustomGameVersion`
instead of guessing at one.

A mod that does not set the directive at all (XPack2) inherits vanilla's,
because the game itself loads an expansion's mod path chained on top of
`Mods/bf1942/` (its own `init.con`'s `game.addModPath` lines) - the same
chain `find_mod_music_file` already walks for the loading music.

Output is one `menu.mp3` per mod, named for the *role* rather than the
source file (`vehicle4.mp3` is named for its source because every mod's
loading cue is the same file; a mod's menu cue is not guaranteed to be):

    viewer/maps/_shared/music/menu.mp3            vanilla
    viewer/maps/mods/<id>/_shared/music/menu.mp3  every other mod

`play/index.html` reads it at `${MAPS}/_shared/music/menu.mp3`, where
`MAPS` is already the active mod's own maps root - no manifest entry
needed, the path convention alone is enough.

Usage:
    python3 tools/bf1942-models/extract_menu_music.py
    python3 tools/bf1942-models/extract_menu_music.py --mod eod --force
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_loading_assets import (  # noqa: E402
    auto_detect_bf1942_dir, find_mod_music_file, resolve_mod_dir,
    transcode_bik_to_mp3,
)

HERE = Path(__file__).resolve().parent
VIEWER_MAPS_DIR = HERE / "viewer" / "maps"

#: `Game.setMenuMusicFilename "music/slaughter4.bik"` - case varies (`Game.`
#: vs `game.`), quoting varies, and a trailing `rem ...` comment sometimes
#: follows on the same line.
MENU_MUSIC_RE = re.compile(
    r'(?im)^\s*(?:game\.)?setMenuMusicFilename\s+["\']?([^"\'\r\n]+?)["\']?'
    r'(?:\s+rem\b.*)?\s*$')

DEFAULT_MODS = ["bf1942", "eod", "xpack1", "xpack2"]


def find_menu_music_path(mod_dirs: list[Path]) -> str | None:
    """The directive's own value, from the first mod in the chain that sets
    it - `mod_dirs` is the mod's own directory, then vanilla's, matching
    `find_mod_music_file`'s fallback order."""
    for mod_dir in mod_dirs:
        init_con = mod_dir / "init.con"
        if not init_con.is_file():
            continue
        match = MENU_MUSIC_RE.search(init_con.read_text(encoding="latin-1"))
        if match:
            return match.group(1).strip()
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bf1942-dir", type=Path, default=None)
    ap.add_argument("--mod", action="append", dest="mods", default=None,
                    help="Repeatable. Defaults to bf1942, eod, xpack1, xpack2.")
    ap.add_argument("--out", type=Path, default=VIEWER_MAPS_DIR)
    ap.add_argument("--force", action="store_true", help="re-transcode an existing menu.mp3")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    mods = [m.lower() for m in (args.mods or DEFAULT_MODS)]
    bf1942_dir = auto_detect_bf1942_dir(args.bf1942_dir, mods)
    vanilla_dir = resolve_mod_dir(bf1942_dir, "bf1942")
    if not vanilla_dir:
        sys.exit(f"no Mods/bf1942 under {bf1942_dir}")

    ok = 0
    for mod in mods:
        mod_dir = resolve_mod_dir(bf1942_dir, mod)
        if not mod_dir:
            print(f"warning: no Mods/{mod} under {bf1942_dir}", file=sys.stderr)
            continue
        chain = [mod_dir] if mod_dir == vanilla_dir else [mod_dir, vanilla_dir]

        rel_path = find_menu_music_path(chain) or "music/slaughter4.bik"
        bik_file = find_mod_music_file(chain, rel_path)
        if not bik_file:
            print(f"warning: [{mod}] {rel_path} not found", file=sys.stderr)
            continue

        dest = (args.out / "_shared" / "music" / "menu.mp3" if mod == "bf1942"
               else args.out / "mods" / mod / "_shared" / "music" / "menu.mp3")
        transcoded = transcode_bik_to_mp3(
            bik_file, dest, bitrate="192k", overwrite=args.force, dry_run=args.dry_run)
        print(f"[{mod}] {bik_file.name} -> {dest}"
              + ("" if transcoded else " (already present)"), file=sys.stderr)
        ok += 1

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
