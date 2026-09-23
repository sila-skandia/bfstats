#!/usr/bin/env python3
"""Alias for `patch_scene.py --layer ai` (kept for the commands in the docs).

    python3 patch_ai_extras.py --mod bf1942 el_alamein wake ...
    python3 patch_ai_extras.py --mod bf1942 --all

Rebuilds the `ai` block of already-extracted levels' scene.json (and their
`pathfinding/` folder) exactly as a full `extract_map.py` bake writes it. Every
argument is passed through; see `patch_scene.py`.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import patch_scene  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(patch_scene.main(["--layer", "ai", *sys.argv[1:]]))
