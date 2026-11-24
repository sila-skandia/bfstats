"""Where the Battlefield 1942 install is, for every extractor.

`BF42_GAME_DIR` wins when set. Otherwise the default is the Wine prefix path
the extractors have always used, except on Windows, where the usual install
folders are probed. stdlib only.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ENV_VAR = "BF42_GAME_DIR"
WINE_GAME_DIR_REL = ".wine/drive_c/EA Games/Battlefield 1942"


def wine_game_dir() -> Path:
    return Path.home() / WINE_GAME_DIR_REL


def windows_candidates() -> list[Path]:
    roots = [os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"),
             r"C:\Program Files (x86)", r"C:\Program Files", "C:\\"]
    names = ("EA GAMES", "EA Games", "EAGames")
    out: list[Path] = []
    for root in roots:
        if root:
            out += [Path(root) / n / "Battlefield 1942" for n in names]
    return out


def default_game_dir() -> Path:
    """`$BF42_GAME_DIR`, else the install this platform keeps (the first
    existing Windows candidate on Windows; the Wine prefix elsewhere)."""
    env = os.environ.get(ENV_VAR)
    if env:
        return Path(env).expanduser()
    if os.name == "nt":
        for cand in windows_candidates():
            if cand.is_dir():
                return cand
        return windows_candidates()[0]
    return wine_game_dir()


def candidate_game_dirs() -> list[Path]:
    """Every place an install is probed, the default first."""
    first = default_game_dir()
    rest = windows_candidates() if os.name == "nt" else []
    seen, out = set(), []
    for p in [first, *rest]:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


DEFAULT_GAME_DIR = default_game_dir()
