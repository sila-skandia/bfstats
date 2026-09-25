#!/usr/bin/env python3
"""Extract a mod's `ScoreManagerSettings` into the viewer's HUD pack.

The engine's score table is `Bf1942/Game/ScoreManagerSettings*.con` inside the
mod's `Game.rfa`, one file per gameplay mode, and the commands are one line each:

    ScoreManager.kill 1
    ScoreManager.death 0
    ScoreManager.capture 10
    ScoreManager.attack 2
    ScoreManager.defence 5
    ScoreManager.TK -2

Vanilla ships three files: the base one, `...CTF.con` and `...TDM.con`. Keys a
file leaves out keep the value the `ScoreManager` constructor set
(`ScoreManager::ScoreManager`, lnxded `0x08161440`: death -1, kill 3, capture
20, attack 5, defence 5, TK -3, objective 5, objectiveTK -15). Those defaults are
the viewer's (`round-state.js`), not this extractor's: nothing in the game files
carries them.

Output, into the pack directory the rest of the interface data lives in:

    viewer/maps/_shared/hud/score-settings.json          vanilla
    viewer/maps/mods/<mod>/_shared/hud/score-settings.json   a mod's own copy

    {"source": "...",
     "files": {"ScoreManagerSettings.con": {"kill": 1, ...},
               "ScoreManagerSettingsCTF.con": {...},
               "ScoreManagerSettingsTDM.con": {...}}}

Keys are the command's suffix lowercased (`TK` -> `tk`, `objectiveTK` ->
`objectivetk`), which is the spelling `round-state.js` reads.

Read through the mod chain, nearest first, so a mod that replaces `Game.rfa`
(or a file in it) wins and one that does not still gets vanilla's table. That
also makes this a step `extract_hud_mods.py` can run: a mod whose table matches
vanilla's byte for byte writes nothing.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.rfa import RfaArchive, find_archives_dir, find_game_dir  # noqa: E402
from extract_hud_pack import hud_dir_for  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402

#: `ScoreManager.<key> <int>`. `rem` lines are comments, as everywhere in a con.
_COMMAND = re.compile(r"^scoremanager\.([a-z]+)\s+(-?\d+)", re.IGNORECASE)
#: The settings file, whatever case a mod's archive spells it in.
_SETTINGS_FILE = re.compile(r"^scoremanagersettings(.*)\.con$", re.IGNORECASE)


def parse_score_settings(text: str) -> dict[str, int]:
    """`ScoreManager.<key> <int>` lines as `{key: value}`, lowercased keys.

    A line whose value is not an integer is skipped rather than guessed at, and
    the last declaration of a key wins, which is how a con file behaves.
    """
    out: dict[str, int] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.lower().startswith("rem"):
            continue
        match = _COMMAND.match(line)
        if match:
            out[match.group(1).lower()] = int(match.group(2))
    return out


def _game_archive(mod_dir: Path) -> Path | None:
    """`Archives/bf1942/Game.rfa` under a mod, whatever case it uses."""
    archives = find_archives_dir(mod_dir)
    if archives is None:
        return None
    game = find_game_dir(archives)
    if game is None:
        return None
    for child in game.iterdir():
        if child.is_file() and child.name.lower() == "game.rfa":
            return child
    return None


def read_score_settings(chain: list[Path]) -> dict[str, dict[str, int]]:
    """Every settings file along the chain, nearest mod first.

    Keyed by the file's basename as the nearest archive spells it. A file a
    nearer mod ships replaces the further one's outright: the engine loads one
    file, not a merge.
    """
    files: dict[str, dict[str, int]] = {}
    for mod_dir in chain:
        archive_path = _game_archive(mod_dir)
        if archive_path is None:
            continue
        archive = RfaArchive(archive_path)
        for name in archive.entries:
            basename = name.replace("\\", "/").rsplit("/", 1)[-1]
            if not _SETTINGS_FILE.match(basename):
                continue
            if any(k.lower() == basename.lower() for k in files):
                continue
            files[basename] = parse_score_settings(
                archive.read(name).decode("latin-1", "replace"))
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR,
                        help=f"BF1942 install (default: {DEFAULT_GAME_DIR})")
    parser.add_argument("--mod", default="bf1942",
                        help="mod whose Game.rfa to read (default: bf1942)")
    parser.add_argument("--out", type=Path, default=None,
                        help="output directory (default: the mod's own pack "
                             f"dir, {hud_dir_for('bf1942')} for vanilla)")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    chain = mod_chain(game_dir, args.mod)
    out = args.out or hud_dir_for(chain[0].name.lower())
    files = read_score_settings(chain)
    if not files:
        sys.exit(f"no ScoreManagerSettings*.con in any Game.rfa of "
                 f"{[d.name for d in chain]}")
    out.mkdir(parents=True, exist_ok=True)
    (out / "score-settings.json").write_text(json.dumps({
        "source": "Bf1942/Game/ScoreManagerSettings*.con in the mod chain's "
                  "Game.rfa, nearest mod first; keys are the con command "
                  "suffixes lowercased, and a key a file omits keeps the "
                  "ScoreManager constructor's value (round-state.js)",
        "files": files,
    }, indent=1) + "\n")
    print(f"{chain[0].name.lower()}: {len(files)} score settings file(s) "
          f"{sorted(files)} -> {out / 'score-settings.json'}")


if __name__ == "__main__":
    main()
