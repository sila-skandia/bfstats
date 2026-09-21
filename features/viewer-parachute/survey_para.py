import sys, re, os
from pathlib import Path
sys.path.insert(0, '/home/dylan/projects/skandia/bfstats/.claude/worktrees/agent-a8212180d1888f2ab/tools/bf1942-models')
from bf42.rfa import RfaArchive

GAME = Path("/home/dylan/.wine/drive_c/EA Games/Battlefield 1942")
WORDS = ("setparachutespeed", "setparachutedrag")
pat = re.compile(r'^\s*(?:ObjectTemplate\.)?(setParachuteSpeed|setParachuteDrag)\s+(\S+)', re.I)

mods = sorted(p for p in (GAME / "Mods").iterdir() if p.is_dir())
for mod in mods:
    arch = None
    for c in mod.iterdir():
        if c.is_dir() and c.name.lower() == "archives":
            arch = c
    if arch is None:
        continue
    for rfa in sorted(arch.rglob("*.rfa")):
        try:
            a = RfaArchive(str(rfa))
        except Exception as e:
            continue
        for name in a.entries:
            if not name.lower().endswith(".con") and not name.lower().endswith(".inc"):
                continue
            try:
                data = a.read(name)
            except Exception:
                continue
            low = data.lower()
            if b"parachute" not in low:
                continue
            txt = data.decode("latin1")
            ctx = None
            for line in txt.splitlines():
                ls = line.strip()
                m = re.match(r'^\s*ObjectTemplate\.create\s+(\S+)\s+(\S+)', ls, re.I)
                if m:
                    ctx = m.group(2)
                m2 = pat.match(ls)
                if m2:
                    print(f"{mod.name}\t{rfa.name}\t{name}\t{ctx}\t{m2.group(1)}\t{m2.group(2)}")
