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

Both the directive and the file are looked up along the mod's own
`game.addModPath` chain, nearest first (`mod_search_path`), as the engine
does: a mod that does not set the directive (XPack2) inherits its parent's,
and DC_Final would find DesertCombat's recording before vanilla's if it did
not ship its own. DesertCombat, DC_Final and FHSW each do ship their own.

With no `--mod`, vanilla and every mod with levels under `--out` are
transcoded, so a mod baked for the play front end picks up its own menu
loop instead of falling back to vanilla's.

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
    python3 tools/bf1942-models/extract_menu_music.py --mod dc_final --force
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_loading_assets import (  # noqa: E402
    auto_detect_bf1942_dir, find_mod_music_file, mod_search_path,
    resolve_case_insensitive, resolve_mod_dir, transcode_bik_to_mp3,
)

HERE = Path(__file__).resolve().parent
VIEWER_MAPS_DIR = HERE / "viewer" / "maps"

#: `Game.setMenuMusicFilename "music/slaughter4.bik"` - case varies (`Game.`
#: vs `game.`), quoting varies, and a trailing `rem ...` comment sometimes
#: follows on the same line.
MENU_MUSIC_RE = re.compile(
    r'(?im)^\s*(?:game\.)?setMenuMusicFilename\s+["\']?([^"\'\r\n]+?)["\']?'
    r'(?:\s+rem\b.*)?\s*$')


def default_mods(out: Path) -> list[str]:
    """Vanilla plus every mod with levels under `out` (a `maps.json`) - the
    mods the play front end can open. A `_shared`-only tree does not count."""
    mods_dir = out / "mods"
    built = sorted(d.name for d in mods_dir.iterdir()
                   if (d / "maps.json").is_file()) if mods_dir.is_dir() else []
    return ["bf1942", *built]


def search_path(bf1942_dir: Path, mod: str, vanilla_dir: Path) -> list[Path]:
    """The mod's directories nearest first, always ending at vanilla."""
    chain = mod_search_path(bf1942_dir, mod)
    if not chain:
        mod_dir = resolve_mod_dir(bf1942_dir, mod)
        chain = [mod_dir] if mod_dir else []
    if chain and vanilla_dir not in chain:
        chain.append(vanilla_dir)
    return chain


def find_menu_music_path(mod_dirs: list[Path]) -> str | None:
    """The directive's own value, from the first mod in the chain that sets
    it - `mod_dirs` is nearest first, as `find_mod_music_file` walks it."""
    for mod_dir in mod_dirs:
        init_con = resolve_case_insensitive(mod_dir, "init.con")
        if not init_con or not init_con.is_file():
            continue
        match = MENU_MUSIC_RE.search(init_con.read_text(encoding="latin-1"))
        if match:
            return match.group(1).strip().replace("\\", "/")
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bf1942-dir", type=Path, default=None)
    ap.add_argument("--mod", action="append", dest="mods", default=None,
                    help="Repeatable. Defaults to vanilla and every mod with levels under --out.")
    ap.add_argument("--out", type=Path, default=VIEWER_MAPS_DIR)
    ap.add_argument("--force", action="store_true", help="re-transcode an existing menu.mp3")
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

        rel_path = find_menu_music_path(chain) or "music/slaughter4.bik"
        bik_file = find_mod_music_file(chain, rel_path)
        if not bik_file:
            print(f"warning: [{mod}] {rel_path} not found", file=sys.stderr)
            continue

        dest = (args.out / "_shared" / "music" / "menu.mp3" if mod == "bf1942"
               else args.out / "mods" / mod / "_shared" / "music" / "menu.mp3")
        transcoded = transcode_bik_to_mp3(
            bik_file, dest, bitrate="192k", overwrite=args.force, dry_run=args.dry_run)
        print(f"[{mod}] {bik_file.relative_to(bf1942_dir)} -> {dest}"
              + ("" if transcoded else " (already present)"), file=sys.stderr)
        ok += 1

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
