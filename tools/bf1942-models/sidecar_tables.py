#!/usr/bin/env python3
"""The tables the UDP sidecar derives from the install, as one JSON line.

    python3 sidecar_tables.py --mod bf1942                       # anim table
    python3 sidecar_tables.py --mod bf1942 --level wake --mode coop.con

Prints `{"mod", "animStates": [[index, name, flags], ...], "cpNames":
{template: word} | null, "inputs": [archive paths read]}`. `sidecar/game-tables.mjs`
runs it and caches the answer against the inputs' sizes and times. What the
two tables are, and where the engine builds them, is `bf42/game_tables.py`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import game_tables  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", required=True, help="the server's mod (serverInfo), e.g. bf1942, desertcombat")
    ap.add_argument("--level", help="setLevel's level, e.g. bf1942/levels/wake/")
    ap.add_argument("--mode", default="conquest.con", help="setLevel's mode, e.g. coop.con")
    ap.add_argument("--no-anim", action="store_true", help="skip the animation table")
    args = ap.parse_args()

    if not (args.game_dir / "Mods").is_dir():
        print(f"no BF1942 install at {args.game_dir}", file=sys.stderr)
        return 2
    chain = mod_chain(args.game_dir, args.mod)
    warn = lambda msg: print(f"[sidecar_tables] {msg}", file=sys.stderr)  # noqa: E731
    out: dict = {"mod": chain[0].name, "animStates": None, "cpNames": None, "inputs": []}
    inputs: list[Path] = []
    if not args.no_anim:
        # The machine is rebuilt at every level load with the level mounted
        # (bf42/game_tables.py anim_state_table), so a level's own
        # `animations/` files count.
        level = (game_tables.level_archives(args.game_dir, args.mod, chain, args.level)
                 if args.level else None)
        rows, read = game_tables.anim_state_table(chain, warn, level)
        out["animStates"] = rows
        inputs += read
    if args.level:
        names, read = game_tables.control_point_names(
            args.game_dir, args.mod, chain, args.level, args.mode)
        out["cpNames"] = names
        inputs += read
    out["inputs"] = [str(p) for p in dict.fromkeys(inputs)]
    json.dump(out, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
