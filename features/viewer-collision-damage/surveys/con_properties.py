#!/usr/bin/env python3
"""Count `<Section>.<property>` uses matching a regex across an installed mod.

The lead's own leads in ../README.md came out of this. Run it per mod — a
property that vanilla never writes is usually written by FH or FHSW, and
"vanilla is silent" is the trap this pipeline keeps falling into.

    python3 features/viewer-collision-damage/surveys/con_properties.py 'damage|critical|collision|explos|hpLost|wreck'
    python3 features/viewer-collision-damage/surveys/con_properties.py 'armorEffect' --mod FH
"""

from __future__ import annotations

import argparse
import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools/bf1942-models"))

from bf42.rfa import ArchivePool  # noqa: E402

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("pattern", help="regex matched against the property name, case-insensitive")
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--values", action="store_true", help="print every distinct value, not one sample")
    args = ap.parse_args()

    pool = ArchivePool()
    for rfa in sorted((MODS / args.mod / "Archives").glob("*.rfa")):
        try:
            pool.add(rfa, rfa.name)
        except Exception as exc:  # a mod ships archives this reader cannot open
            print(f"skip {rfa.name}: {exc}", file=sys.stderr)

    prop = re.compile(
        rb"^\s*([A-Za-z_]+)\.([A-Za-z_]*(?:" + args.pattern.encode() + rb")[A-Za-z_]*)\s+(.*)$",
        re.I | re.M,
    )
    counts: collections.Counter[str] = collections.Counter()
    values: dict[str, collections.Counter[str]] = {}
    where: dict[str, str] = {}
    scanned = 0

    for name in pool.names():
        if not name.lower().endswith((".con", ".inc")):
            continue
        try:
            data = pool.read(name)
        except Exception:
            continue
        scanned += 1
        for match in prop.finditer(data):
            key = f"{match.group(1).decode()}.{match.group(2).decode()}"
            value = match.group(3).decode("latin-1").strip()
            counts[key] += 1
            values.setdefault(key, collections.Counter())[value] += 1
            where.setdefault(key, name)

    print(f"{args.mod}: {scanned} scripts")
    for key, count in counts.most_common():
        print(f"{count:6d}  {key:52s}  first in {where[key]}")
        if args.values:
            for value, seen in values[key].most_common(12):
                print(f"          {seen:5d}  {value[:80]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
