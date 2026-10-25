#!/usr/bin/env python3
"""The game types each of a mod's levels ships, as one JSON line.

    python3 sidecar_level_modes.py --mod xpack2

Prints `{"mod", "levels": {level: [mode, ...]}}`: a level ships a game type
when its root holds that type's script (`bf1942/levels/<level>/<mode>.con`,
which the level load runs last; `bf42/template_table.py`), as the mod chain's
archives mount it. `sidecar/bake-tables.mjs` bakes one table per pair.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.template_table import PLAY_MODES, MountedFiles, mod_chain  # noqa: E402

DEFAULT_GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
ROOT_SCRIPT = re.compile(r"^bf1942/levels/([^/]+)/([^/]+)\.con$")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", required=True)
    args = ap.parse_args()
    if not (args.game_dir / "Mods").is_dir():
        print(f"no BF1942 install at {args.game_dir}", file=sys.stderr)
        return 2
    try:
        chain = mod_chain(args.game_dir, args.mod)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 3
    files = MountedFiles(chain)
    levels: dict[str, set[str]] = {}
    try:
        for path in files.list("bf1942/levels/"):
            m = ROOT_SCRIPT.match(path)
            if m and m.group(2) in PLAY_MODES:
                levels.setdefault(m.group(1), set()).add(m.group(2))
    finally:
        files.close()
    out = {"mod": chain[0].name, "levels": {k: sorted(v) for k, v in sorted(levels.items())}}
    json.dump(out, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
