#!/usr/bin/env python3
"""Extract bot name lists from Game.rfa.

The research document §2.1: bot names come from
`Bf1942/Game/common/{American,British,German,Japanese,Russian}Names.con`
in `Game.rfa`, loaded by `GameServer::loadBots(int mode)` 0x08131ef0.

Usage:
    python3 extract_bot_names.py [--game-dir ~/.wine/drive_c/EA\ Games/Battlefield\ 1942]
                                 [--out data/bot-names.json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow importing bf42 from the parent directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bf42.rfa import RfaArchive, find_archives_dir, find_game_dir

DEFAULT_GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"

NATION_FILES = {
    "American": "Bf1942/Game/common/AmericanNames.con",
    "British": "Bf1942/Game/common/BritishNames.con",
    "German": "Bf1942/Game/common/GermanNames.con",
    "Japanese": "Bf1942/Game/common/JapaneseNames.con",
    "Russian": "Bf1942/Game/common/RussianNames.con",
}


def extract_names(game_rfa: Path) -> dict[str, list[str]]:
    """Read the five name lists from Game.rfa.

    Each .con file is a series of `game.addBotName <name>` lines.
    """
    result: dict[str, list[str]] = {}
    archive = RfaArchive(game_rfa)

    for nation, path in NATION_FILES.items():
        try:
            data = archive.read(path)
            text = data.decode("latin-1")
            names = []
            for line in text.splitlines():
                line = line.strip()
                # Strip comments
                if line.lower().startswith("rem"):
                    continue
                # `game.addBotName <name>`
                if line.lower().startswith("game.addbotname"):
                    parts = line.split(None, 2)
                    if len(parts) >= 2:
                        names.append(parts[1].strip().strip('"'))
            result[nation] = names
        except Exception as exc:
            print(f"  warning: {path}: {exc}", file=sys.stderr)
            result[nation] = []

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract bot name lists from Game.rfa")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR,
                        help="BF1942 install directory")
    parser.add_argument("--out", type=Path, default=None,
                        help="Output JSON file (default: stdout)")
    args = parser.parse_args()

    archives_dir = find_archives_dir(args.game_dir / "Mods/bf1942")
    if archives_dir is None:
        print(f"error: no Archives directory in {args.game_dir}", file=sys.stderr)
        sys.exit(1)

    game_dir = find_game_dir(archives_dir)
    if game_dir is None:
        print(f"error: no bf1942/ subdirectory in {archives_dir}", file=sys.stderr)
        sys.exit(1)

    game_rfa = game_dir / "Game.rfa"
    if not game_rfa.exists():
        print(f"error: {game_rfa} not found", file=sys.stderr)
        sys.exit(1)

    print(f"Extracting bot names from {game_rfa}...", file=sys.stderr)
    names = extract_names(game_rfa)

    total = sum(len(v) for v in names.values())
    for nation, name_list in names.items():
        print(f"  {nation}: {len(name_list)} names", file=sys.stderr)
    print(f"  total: {total} names", file=sys.stderr)

    output = json.dumps(names, indent=2, ensure_ascii=False)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output + "\n", encoding="utf-8")
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
