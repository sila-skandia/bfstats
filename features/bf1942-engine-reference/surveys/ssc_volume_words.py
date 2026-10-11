"""Census the `.ssc` words that set a voice's level, across the installed mods.

Run from the repository root. Backs ledger rows SND-27 (a sample's `volume`
is clamped to 0..1 before anything else reads it, client 0x008024f0) and
SND-28 (the two volume groups, `Default` and `Menu`, and the `addGroup` word):

  - how many `volume` lines there are per mod, and how many say more than 1
    (the engine plays every one of those at exactly 1);
  - the `EnvironmentSound` bed of each level (`Sounds/Environment.ssc`): its
    volume as written;
  - every `addGroup` line, by its arguments.

Every line is counted as written: `#templateLevel` tiers and `beginSkip`
regions are not resolved, so a figure here is "lines in the files", not
"voices the engine builds". Only the line's own tier would change a count.

Result 2026-10-11, 15 installs with scripts, 48,484 `.ssc` files: 86,572
`volume` lines, 3,529 above 1 (4.1%). Vanilla 60 of 2,947 (largest 10), XPack1
0, XPack2 82, DC_Final 50, FH 402 (largest 29000), FHSW 1,132, EoD 828,
FinnWars 352, bf1918 391.

The level beds are where it bites. Vanilla writes 0.25..0.6 on 21 beds and 1.4
on Aberdeen. FH writes above 1 on 17 of its 54 beds: 80 on six (Road to
Ramelle, Supercharge, Valirisk, ...), 90 on The Storm, 75, 68, 62, 40. FHSW
has 24 such beds (up to 80), FinnWars three at 300, bf1918 32 (5 and 9), EoD
39 (1.4..8). bg42 writes exactly 1 on 199 of 200.

`addGroup` appears as `addGroup Volume Menu` only: 16 lines in vanilla and 16
in FHSW, all menu scripts. Every other voice of every mod is in `Default`.
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
from bf42.rfa import RfaArchive  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
VOLUME = re.compile(r"^\s*volume\s*([-+0-9.eE]+)", re.I)
GROUP = re.compile(r"^\s*addGroup\b(.*)", re.I)

files = Counter()
lines = Counter()
over = Counter()
largest = defaultdict(lambda: (0.0, ""))
groups = Counter()
beds = defaultdict(list)          # mod -> [(level, volume)]
for mod in sorted((GAME / "Mods").iterdir()):
    for rfa in sorted(mod.rglob("*.rfa")):
        try:
            archive = RfaArchive(rfa)
        except Exception:
            continue
        for name in list(archive.entries):
            if not name.lower().endswith(".ssc"):
                continue
            try:
                text = archive.read(name).decode("latin-1", "replace")
            except Exception:
                continue
            files[mod.name] += 1
            is_bed = name.lower().replace("\\", "/").endswith("/environment.ssc")
            bed = None
            for line in text.splitlines():
                g = GROUP.match(line)
                if g:
                    groups[(mod.name, g.group(1).strip())] += 1
                m = VOLUME.match(line)
                if not m:
                    continue
                try:
                    v = float(m.group(1))
                except ValueError:
                    continue
                lines[mod.name] += 1
                if v > 1:
                    over[mod.name] += 1
                    if v > largest[mod.name][0]:
                        largest[mod.name] = (v, f"{rfa.name}:{name}")
                if is_bed and bed is None:
                    bed = v
            if is_bed and bed is not None:
                beds[mod.name].append((rfa.stem, bed))

print(f"{'mod':14}{'files':>7}{'volume':>8}{'> 1':>6}  largest")
for mod in sorted(files):
    v, where = largest[mod]
    print(f"{mod:14}{files[mod]:7}{lines[mod]:8}{over[mod]:6}  "
          f"{v:g} {where}" if v else f"{mod:14}{files[mod]:7}{lines[mod]:8}{over[mod]:6}")
print(f"{'total':14}{sum(files.values()):7}{sum(lines.values()):8}{sum(over.values()):6}")
print()
print("EnvironmentSound beds, volume as written (count per value):")
for mod in sorted(beds):
    hist = Counter(v for _, v in beds[mod])
    loud = sorted(((v, lv) for lv, v in beds[mod] if v > 1), reverse=True)[:4]
    print(f"  {mod:14}", " ".join(f"{v:g}x{n}" for v, n in sorted(hist.items())),
          ("| above 1: " + ", ".join(f"{lv} {v:g}" for v, lv in loud)) if loud else "")
print()
print("addGroup lines:", dict(groups) or "none")
