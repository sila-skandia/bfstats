"""Count the RotationalBundles that bind both mouse-look axes on one template.

Run from the repository root. Backs ledger row GUN-20: the engine runs one
servo per axis of a RotationalBundle and poses the bundle from all three
angles at once, so a gun may traverse and elevate on a single bundle. Vanilla
mostly splits the two over a yaw parent and a pitch child (GUN-10's shape);
Forgotten Hope puts both on one bundle for most of its bow, hull and tripod
machine guns.

A bundle counts when two different slots of its `setInputToYaw/Pitch/Roll`
name `c_PIMouseLookX` (or its raw id 4) and `c_PIMouseLookY` (5), and its
`setMaxSpeed` is non-zero in both slots (an undeclared `setMaxSpeed` is the
template default 1/1/1, GUN-1). Reads each mod's own archives, level archives
included; a template a mod inherits is counted in the mod that declares it,
and one several archives of a mod declare is counted once.

Result 2026-10-11, 16 installs: see GUN-20.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
from bf42.rfa import RfaArchive  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
LINE = re.compile(r"^\s*ObjectTemplate\.(\w+)\s*(.*?)\s*$", re.I)
LOOK = {"c_pimouselookx": "x", "4": "x", "c_pimouselooky": "y", "5": "y"}
SLOT = {"setinputtoyaw": 0, "setinputtopitch": 1, "setinputtoroll": 2}


def vec(text):
    try:
        parts = [float(p) for p in text.split()[0].split("/")]
    except (ValueError, IndexError):
        return None
    return (parts + [0.0, 0.0, 0.0])[:3]


def bundles(text, table):
    current = None
    for raw in text.splitlines():
        line = raw.split("rem ", 1)[0] if raw.lstrip().lower().startswith("rem") else raw
        m = LINE.match(line)
        if not m:
            continue
        word, args = m.group(1).lower(), m.group(2)
        if word == "create":
            parts = args.split()
            if len(parts) >= 2:
                current = None
                if parts[0].lower() == "rotationalbundle":
                    current = table.setdefault(parts[1].lower(), {"inputs": {}, "speed": None})
        elif word == "active":
            current = table.get(args.split()[0].lower()) if args else None
        elif current is not None:
            if word in SLOT and args:
                current["inputs"][SLOT[word]] = args.split()[0].lower()
            elif word == "setmaxspeed":
                current["speed"] = vec(args)


total_both = total_look = 0
for mod in sorted((GAME / "Mods").iterdir()):
    arch = next((d for d in mod.iterdir() if d.is_dir() and d.name.lower() == "archives"), None)
    if arch is None:
        continue
    table = {}
    # Level archives too: a level may carry object scripts of its own
    # (vanilla's Ju88A is Battle of Britain's).
    for rfa in sorted(arch.rglob("*.rfa")):
        try:
            archive = RfaArchive(rfa)
        except Exception:
            continue
        for entry in archive.entries:
            if not entry.lower().endswith((".con", ".inc")):
                continue
            try:
                bundles(archive.read(entry).decode("latin-1"), table)
            except Exception:
                continue
    look = both = 0
    for spec in table.values():
        speed = spec["speed"] or [1.0, 1.0, 1.0]
        live = {LOOK[name] for slot, name in spec["inputs"].items()
                if name in LOOK and speed[slot] != 0.0}
        look += bool(live)
        both += live == {"x", "y"}
    total_both += both
    total_look += look
    print(f"{mod.name:14s} mouse-aimed bundles {look:5d}   both axes on one bundle {both:5d}")
print(f"{'all':14s} mouse-aimed bundles {total_look:5d}   both axes on one bundle {total_both:5d}")
