"""Count the FireArms multi-barrel words across every installed mod's archives.

Run from the repository root. Backs ledger rows BOMB-2 and BOMB-3: how many
barrels a rack declares (`addFireArmsPosition`), which racks fire them one at a
time (`asynchronyFire`), and whether the second single-round flag at
`FireArmsTemplate+0x348` is ever set in shipped data (`fireAllAtOnce`).

Result 2026-09-22, 14 installs: addFireArmsPosition 24,540 / asynchronyFire
3,343 (7 in vanilla) / fireAllAtOnce **0**.
"""
import re, sys
from pathlib import Path
sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
from bf42.rfa import RfaArchive

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
WORDS = ("fireAllAtOnce", "asynchronyFire", "addFireArmsPosition")
pats = {w: re.compile(rf"ObjectTemplate\.(?:set)?{w}\b", re.I) for w in WORDS}

tally = {w: {} for w in WORDS}
for mod in sorted((GAME / "Mods").iterdir()):
    arch = mod / "Archives"
    if not arch.is_dir():
        continue
    for rfa in sorted(arch.rglob("*.rfa")):
        try:
            a = RfaArchive(rfa)
        except Exception:
            continue
        for entry in a.entries:
            if not entry.lower().endswith((".con", ".inc")):
                continue
            try:
                text = a.read(entry).decode("latin-1")
            except Exception:
                continue
            for w, pat in pats.items():
                n = len(pat.findall(text))
                if n:
                    tally[w].setdefault(mod.name, 0)
                    tally[w][mod.name] += n
for w in WORDS:
    total = sum(tally[w].values())
    print(f"{w}: {total} declarations across {len(tally[w])} installs")
    for m, n in sorted(tally[w].items(), key=lambda kv: -kv[1]):
        print(f"    {m}: {n}")
