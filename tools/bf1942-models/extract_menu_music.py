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

The same `init.con` names the three cues a round's end plays, and they are
transcoded the same way beside `menu.mp3` (`--role`, all four by default):

    win.mp3         `Game.setWinMusicFilename`         `music/vehicle3.bik`
    lose.mp3        `Game.setLoseMusicFilename`        `music/menu.bik`
    debriefing.mp3  `Game.setDebriefingMusicFilename`  `music/briefing.bik`

`BfMenu::setMusic` (BF1942.exe 0x006a5da0) plays one cue at a time: 1 the
menu loop, 2 the loading music, 3 the win cue, 4 the campaign's lose cue,
5 the lose cue, 6 the debriefing cue (the handles `0x006a59b0` loads at
`BfMenu+0x708`, `+0x704`, `+0x70c`, `+0x714`, `+0x710`, `+0x718`). The round's
debriefing (0x006aad90) calls it with 3 when the local side won and 5 when
it lost, once per round, and a draw changes nothing (ledger ROUND-8). Desert
Combat and DC Final set all three and ship none of the files, so theirs are
vanilla's recordings, found along the chain like the menu loop is. A role no
mod in the chain names is skipped: the engine then has no file to play.

Usage:
    python3 tools/bf1942-models/extract_menu_music.py
    python3 tools/bf1942-models/extract_menu_music.py --mod dc_final --force
    python3 tools/bf1942-models/extract_menu_music.py --role win --role lose
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
def music_directive_re(directive: str) -> re.Pattern:
    """`Game.<directive> "music/x.bik"`, with the case, quoting and trailing
    `rem` variations the menu loop's directive shows."""
    return re.compile(
        rf'(?im)^\s*(?:game\.)?{directive}\s+["\']?([^"\'\r\n]+?)["\']?'
        r'(?:\s+rem\b.*)?\s*$')


MENU_MUSIC_RE = music_directive_re("setMenuMusicFilename")

#: role -> the directive naming it, and the file a mod that names none falls
#: back to (only the menu loop has one: `play/index.html` always plays it).
ROLES = {
    "menu": ("setMenuMusicFilename", "music/slaughter4.bik"),
    "win": ("setWinMusicFilename", None),
    "lose": ("setLoseMusicFilename", None),
    "debriefing": ("setDebriefingMusicFilename", None),
}


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


def find_music_path(mod_dirs: list[Path], role: str = "menu") -> str | None:
    """A role's directive value, from the first mod in the chain that sets
    it - `mod_dirs` is nearest first, as `find_mod_music_file` walks it."""
    pattern = music_directive_re(ROLES[role][0])
    for mod_dir in mod_dirs:
        init_con = resolve_case_insensitive(mod_dir, "init.con")
        if not init_con or not init_con.is_file():
            continue
        match = pattern.search(init_con.read_text(encoding="latin-1"))
        if match:
            return match.group(1).strip().replace("\\", "/")
    return None


def find_menu_music_path(mod_dirs: list[Path]) -> str | None:
    """The menu loop's directive (`find_music_path`'s first role)."""
    return find_music_path(mod_dirs, "menu")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bf1942-dir", type=Path, default=None)
    ap.add_argument("--mod", action="append", dest="mods", default=None,
                    help="Repeatable. Defaults to vanilla and every mod with levels under --out.")
    ap.add_argument("--out", type=Path, default=VIEWER_MAPS_DIR)
    ap.add_argument("--role", action="append", dest="roles", default=None,
                    choices=list(ROLES),
                    help="Repeatable. Defaults to every role: menu, win, lose, debriefing.")
    ap.add_argument("--force", action="store_true", help="re-transcode an existing file")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    mods = [m.lower() for m in (args.mods or default_mods(args.out))]
    bf1942_dir = auto_detect_bf1942_dir(args.bf1942_dir, mods)
    vanilla_dir = resolve_mod_dir(bf1942_dir, "bf1942")
    if not vanilla_dir:
        sys.exit(f"no Mods/bf1942 under {bf1942_dir}")

    roles = args.roles or list(ROLES)
    ok = 0
    for mod in mods:
        chain = search_path(bf1942_dir, mod, vanilla_dir)
        if not chain:
            print(f"warning: no Mods/{mod} under {bf1942_dir}", file=sys.stderr)
            continue

        for role in roles:
            rel_path = find_music_path(chain, role) or ROLES[role][1]
            if not rel_path:
                print(f"[{mod}] no {ROLES[role][0]} along the chain; no {role} cue",
                      file=sys.stderr)
                continue
            bik_file = find_mod_music_file(chain, rel_path)
            if not bik_file:
                print(f"warning: [{mod}] {rel_path} not found", file=sys.stderr)
                continue

            leaf = f"{role}.mp3"
            dest = (args.out / "_shared" / "music" / leaf if mod == "bf1942"
                    else args.out / "mods" / mod / "_shared" / "music" / leaf)
            transcoded = transcode_bik_to_mp3(
                bik_file, dest, bitrate="192k", overwrite=args.force, dry_run=args.dry_run)
            print(f"[{mod}] {role}: {bik_file.relative_to(bf1942_dir)} -> {dest}"
                  + ("" if transcoded else " (already present)"), file=sys.stderr)
            ok += 1

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
