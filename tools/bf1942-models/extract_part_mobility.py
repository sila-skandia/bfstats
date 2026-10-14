#!/usr/bin/env python3
"""Write `<out>/part-mobility.json`: which vehicle parts meet the sea.

`{"mobility": {<lowercase template name>: 0|1}}` for every template with a
geometry that a vehicle or emplacement tree of the mod chain reaches: 1 when it
writes `hasMobilePhysics 1`, else 0 (`extract_collision_meshes.py`
`collect_part_mobility`, ledger HP-21). Only a mobile part's `checkVsTerrain`
sends the water contact that wets a hull: FHSWEurope Biak's Catfish rides with
its static pontoon 0.6 m under and is never billed.

The same table rides in `collision-meshes.json` (`mobility`) when the
`collision` step runs; this is the chain's half of it on its own, in seconds,
for a tree whose sidecar predates the table. A level's own templates are not
read here, and the viewer takes a template the table does not name as mobile.

    python3 extract_part_mobility.py --mod FHSWEurope --out viewer/maps/mods/fhsweurope/_shared
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_collision_meshes import collect_part_mobility  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, mod_chain  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    chain = mod_chain(args.game_dir, args.mod)
    _meshes, _textures, objects, _game = build_pools(chain, [])
    mobility = collect_part_mobility(build_library(objects))
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / "part-mobility.json"
    path.write_text(json.dumps({"mobility": dict(sorted(mobility.items()))},
                               separators=(",", ":")) + "\n")
    static = sum(1 for v in mobility.values() if not v)
    print(f"{len(mobility)} parts, {static} static -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
