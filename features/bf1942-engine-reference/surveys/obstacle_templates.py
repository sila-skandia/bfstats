"""Census every `ObjectTemplate.create Obstacle` across the installed mods.

Run from the repository root. Backs ledger rows OBS-1 and OBS-5: which
templates are `Obstacle`s (the class barbed wire is), which of them override
the class's one field `ObjectTemplate.damage` (default 5.0,
`ObstacleTemplate` ctor 0x08315e8a), and whether any soldier template sets
`ObjectTemplate.slowDownMod` (default 0.4, `BFSoldierTemplate` ctor
0x0827a3ae). Only `Objects*.rfa` is read: both words are template settings.

Result 2026-09-26, 16 installs: vanilla 2 Obstacles (`stebarbwire_m1`,
`stebarbwire2_m1`), XPack1 0, XPack2 4 (`Milifence_*barb*_xp2_m1`, each the
Obstacle child of a Bundle); the other mods' Obstacles all keep the default
except GCMOD's `ShieldBlock` (`damage 0`); FH 30, FHSW 50, bf1918 15,
EoD 5, GCMOD 5, Pirates 4, DC 2, bg42 2, FinnWars 1. `slowDownMod` is set
nowhere.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
from bf42.rfa import RfaArchive  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
CREATE = re.compile(r"^\s*ObjectTemplate\.create\s+(\w+)\s+(\S+)", re.I)
DAMAGE = re.compile(r"^\s*ObjectTemplate\.damage\s+(\S+)", re.I)
SLOW = re.compile(r"^\s*ObjectTemplate\.slowDownMod\b", re.I)

obstacles = defaultdict(list)     # mod -> [(template, damage or None)]
slow = defaultdict(int)
for mod in sorted((GAME / "Mods").iterdir()):
    for rfa in sorted(mod.rglob("*.rfa")):
        if not rfa.name.lower().startswith("objects"):
            continue
        try:
            archive = RfaArchive(rfa)
        except Exception:
            continue
        for name in list(archive.entries):
            if not name.lower().endswith((".con", ".inc")):
                continue
            try:
                text = archive.read(name).decode("latin-1", "replace")
            except Exception:
                continue
            current = None
            for line in text.splitlines():
                m = CREATE.match(line)
                if m:
                    current = None
                    if m.group(1).lower() == "obstacle":
                        current = [m.group(2), None]
                        obstacles[mod.name].append(current)
                    continue
                if SLOW.match(line):
                    slow[mod.name] += 1
                d = DAMAGE.match(line)
                if d and current is not None:
                    current[1] = d.group(1)

for mod in sorted(set(obstacles) | set(slow)):
    listed = obstacles.get(mod, [])
    overrides = [(t, d) for t, d in listed if d is not None]
    print(f"{mod}: {len(listed)} Obstacle(s), damage overridden on {overrides or 'none'}, "
          f"slowDownMod lines {slow.get(mod, 0)}")
    if mod.lower() in ("bf1942", "xpack1", "xpack2"):
        for t, _ in listed:
            print(f"    {t}")
