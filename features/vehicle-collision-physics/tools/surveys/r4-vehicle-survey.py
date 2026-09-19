#!/usr/bin/env python3
"""Survey PlayerControlObject vehicle-body templates: physics + Armor fields.

Walks every Objects/Vehicles/**/Objects.con (and top-level vehicle .con files),
finds each `ObjectTemplate.create PlayerControlObject <Name>` block (root body
only, i.e. the first block in the file — sub-objects like turrets/seats are
skipped by stopping at the next `.create`), and pulls out the physics/armor
console words this track cares about.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path("/home/dylan/projects/skandia/bfstats/tools/bf1942-models")))
from bf42.rfa import ArchivePool

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"

FIELDS = [
    "mass", "drag", "dragOffset", "inertiaModifier", "centerOfMassOffset",
    "gravityModifier", "hasArmor", "speedMod", "angleMod", "damageMod",
    "hitpoints", "maxhitpoints", "material", "criticalDamage",
    "hpLostWhileCriticalDamage", "explosionForceMod",
]
FIELD_RE = {f: re.compile(rf"^\s*ObjectTemplate\.{f}\s+(.+?)\s*$", re.I | re.M) for f in FIELDS}
CREATE_RE = re.compile(r"^\s*ObjectTemplate\.create\s+PlayerControlObject\s+(\S+)", re.I | re.M)
ANY_CREATE_RE = re.compile(r"^\s*ObjectTemplate\.create\s+\S+\s+\S+", re.I | re.M)


def first_pco_block(text: str) -> tuple[str, str] | None:
    m = CREATE_RE.search(text)
    if not m:
        return None
    name = m.group(1)
    start = m.end()
    nxt = ANY_CREATE_RE.search(text, start)
    end = nxt.start() if nxt else len(text)
    return name, text[start:end]


def main() -> int:
    mod = sys.argv[1] if len(sys.argv) > 1 else "bf1942"
    pool = ArchivePool()
    for rfa in sorted((MODS / mod / "Archives").rglob("*.rfa")):
        try:
            pool.add(rfa, rfa.name)
        except Exception as exc:
            print(f"skip {rfa.name}: {exc}", file=sys.stderr)

    seen = set()
    rows = []
    for n in pool.names():
        if not re.search(r"Objects/Vehicles/.+\.con$", n, re.I):
            continue
        if not n.lower().endswith("objects.con"):
            continue
        try:
            data = pool.read(n)
        except Exception:
            continue
        text = data.decode("latin-1")
        blk = first_pco_block(text)
        if not blk:
            continue
        name, body = blk
        if name in seen:
            continue
        seen.add(name)
        row = {"name": name, "path": n}
        for f in FIELDS:
            mm = FIELD_RE[f].search(body)
            row[f] = mm.group(1) if mm else None
        rows.append(row)

    rows.sort(key=lambda r: r["path"])
    for r in rows:
        vals = "  ".join(f"{f}={r[f]}" for f in FIELDS if r[f] is not None)
        print(f"{r['name']:20s} {r['path']:55s} {vals}")
    print(f"\n{len(rows)} vehicle root templates found in {mod}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
