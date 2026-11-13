#!/usr/bin/env python3
"""Which object templates cast a dynamic shadow: `<models tree>/dynamic-shadows.json`.

Retail's `fx::ShadowManager` (BF1942.exe `drawVisible` 0x005b93d0) gathers the
objects within 50 m of the camera whose flags carry `hasDynamicShadow`
(`ObjectFlagPredicator(0x2000082)`, 0x005b9416), and walks each one's tree
taking the geometry of every part that carries the flag itself
(`gatherGeometries`). The flag is the `.con` word `ObjectTemplate.hasDynamicShadow
1`: vanilla writes it on 143 object templates (32 `PlayerControlObject` roots,
the land vehicles and aircraft; their hull and turret parts; the soldiers'
bodies and heads; 25 hand weapons) and on none of the ships, landing craft or
emplaced guns, so a destroyer casts no shadow in the game.

The viewer's parts keep their template's name (`userData.name`), so the page
needs only the set of names:

    { "format": 1, "mod": "bf1942", "templates": ["aichival", "b17", ...] }

lower-cased and sorted. A `GeometryTemplate.hasDynamicShadow 0` (the `Shad_*`
meshes of the hand weapons) is listed under `geometriesOff` for the record;
the object flag alone decides what the pass gathers.

    python3 extract_dynamic_shadows.py --game-dir ~/.cache/vimpact-game \\
        --mod bf1942 --out viewer/models/dynamic-shadows.json
    python3 extract_dynamic_shadows.py --mod xpack1 --out viewer/models/mods/xpack1/dynamic-shadows.json

A mod's file holds its whole chain (the mod's own templates over vanilla's),
read the way the engine mounts it: the nearest mod's copy of a file wins.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod  # noqa: E402
from extract_models import build_pools, mod_chain  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"

_CREATE = re.compile(r"^\s*(object|geometry)template\.create\s+(\S+)\s+(\S+)", re.I)
_ACTIVE = re.compile(r"^\s*(object|geometry)template\.active\s+(\S+)", re.I)
_FLAG = re.compile(r"^\s*(object|geometry)template\.hasdynamicshadow\s+(\S+)", re.I)


def scan(text: str, objects: dict[str, bool], geometries: dict[str, bool]) -> None:
    """Read one `.con`'s `hasDynamicShadow` lines into the two tables.

    The word is a plain bool setter on the active template of its namespace;
    a later line for the same template overwrites an earlier one, as the
    console does. A template named by an include's argument (`v_arg1`) is the
    including file's to name and is skipped here.
    """
    active: dict[str, str | None] = {"object": None, "geometry": None}
    for line in con_mod.strip_comments(text).splitlines():
        m = _CREATE.match(line)
        if m:
            active[m.group(1).lower()] = m.group(3)
            continue
        m = _ACTIVE.match(line)
        if m:
            active[m.group(1).lower()] = m.group(2)
            continue
        m = _FLAG.match(line)
        if not m:
            continue
        ns = m.group(1).lower()
        name = active[ns]
        if not name or "v_arg" in name.lower():
            continue
        value = con_mod.engine_bool(m.group(2))
        if value is None:
            continue
        (objects if ns == "object" else geometries)[name.lower()] = bool(value)


def extract(mod: str, game_dir: Path = GAME) -> dict:
    chain = mod_chain(game_dir, mod)
    _meshes, _textures, objects, _game = build_pools(chain, [])
    flagged: dict[str, bool] = {}
    geometries: dict[str, bool] = {}
    for name in sorted(objects.names()):
        if not name.lower().endswith((".con", ".inc")):
            continue
        blob = objects.try_read(name)
        if blob is None or b"DYNAMICSHADOW" not in blob.upper():
            continue
        scan(blob.decode("latin-1"), flagged, geometries)
    return {
        "format": 1,
        "mod": mod.lower(),
        "templates": sorted(n for n, on in flagged.items() if on),
        "geometriesOff": sorted(n for n, on in geometries.items() if not on),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--game-dir", type=Path, default=GAME, help="the install (the folder that holds Mods/)")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent / "viewer" / "models" / "dynamic-shadows.json")
    a = ap.parse_args()
    data = extract(a.mod, a.game_dir)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    print(f"{a.mod}: {len(data['templates'])} templates cast a shadow -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
