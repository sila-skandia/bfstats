#!/usr/bin/env python3
"""A level's object template id table, computed from the install, as one JSON line.

    python3 sidecar_tid_table.py --mod bf1942 --level bf1942/levels/wake/ --mode coop.con

Prints `{"mod", "level", "mode", "names": [name of id 0, id 1, ...],
"inputs": [archive paths read], "missing": [scripts a run named that no
archive holds]}`. `sidecar/template-table.mjs` runs it and caches the answer
against the inputs' sizes and times. How the ids are assigned, and why the
table is a function of the install, mod, level and game type alone, is
`bf42/template_table.py`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.template_table import template_table  # noqa: E402

DEFAULT_GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", required=True, help="the server's mod (ServerInfo), e.g. bf1942")
    ap.add_argument("--level", required=True, help="SetLevel's level, e.g. bf1942/levels/wake/")
    ap.add_argument("--mode", default="conquest.con", help="SetLevel's game type script, e.g. coop.con")
    args = ap.parse_args()
    if not (args.game_dir / "Mods").is_dir():
        print(f"no BF1942 install at {args.game_dir}", file=sys.stderr)
        return 2
    try:
        table = template_table(args.game_dir, args.mod, args.level, args.mode)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 3
    json.dump({"mod": table.mod, "level": table.level, "mode": table.mode, "names": table.names,
               "inputs": [str(p) for p in table.inputs], "missing": table.missing},
              sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
