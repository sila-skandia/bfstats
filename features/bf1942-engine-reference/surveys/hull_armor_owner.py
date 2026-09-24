"""Where the Armor sits in each vehicle, and which PlayerControlObject a hit on it washes.

Run from the repository root. Backs ledger row HFD-9.

`_giveDamage` walks up from the damaged object to the first PlayerControlObject
(the object itself included) and washes every occupant of that PCO's
`getPcos()` map. Only a ROOT PCO fills that map (`PlayerControlObject::init`,
`+0x50 == 0`); a child seat's map is empty. A direct hit's damaged object is the
owner of the nearest Armor (`Armor::getObject`), and a template owns an Armor
exactly when it says `ObjectTemplate.hasArmor 1` (template `+0x7c`). So for each
vehicle, the question the data answers is: is every `hasArmor 1` template the
root PCO or a non-PCO part under it, or does one sit at/under a child seat?

Only `PlayerControlObject` templates are seats here: `BFSoldier` and
`FreeCamera` are the other two classes answering IID 0xc4c5, and neither is a
vehicle part.
"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
import extract_models as em  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
MODS = sys.argv[1:] or ["bf1942", "XPack1", "XPack2"]


def walk(lib, name, depth=0, seen=()):
    tmpl = lib.objects.get(name.lower())
    if tmpl is None or name.lower() in seen or depth > 40:
        return
    yield tmpl, depth
    for ref in tmpl.children:
        yield from walk(lib, ref.template, depth + 1, seen + (name.lower(),))


def survey(mod):
    chain = em.mod_chain(GAME, mod)
    _, _, objects, _ = em.build_pools(chain, [])
    lib = em.build_library(objects)
    children = {ref.template.lower() for t in lib.objects.values() for ref in t.children}
    is_pco = lambda t: t.kind.lower() == "playercontrolobject"
    roots = sorted((t for t in lib.objects.values() if is_pco(t) and t.name.lower() not in children),
                   key=lambda t: t.name.lower())
    tally = Counter()
    odd = []
    for root in roots:
        # (template, nearest PCO at or above it) for every node, depth-first
        stack = []
        seats = 0
        armored = []
        for tmpl, depth in walk(lib, root.name):
            del stack[depth:]
            stack.append(tmpl)
            seat = next((t for t in reversed(stack) if is_pco(t)), None)
            seats += is_pco(tmpl)
            if tmpl.has_armor:
                armored.append((tmpl, seat))
        if not armored:
            tally["no armor anywhere"] += 1
            continue
        for tmpl, seat in armored:
            if tmpl is root:
                kind = "root PCO"
            elif seat is root:
                kind = "part under the root PCO"
            else:
                kind = "at/under a child seat"
                odd.append(f"{root.name}: {tmpl.name} ({tmpl.kind}) -> seat {seat.name}")
            tally[kind] += 1
        if len(armored) > 1:
            odd.append(f"{root.name}: {len(armored)} armored templates: "
                       + ", ".join(f"{t.name}({t.kind})" for t, _ in armored))
        tally[f"vehicles with {seats} seat(s)"] += 1
    print(f"== {mod}: {len(roots)} root PlayerControlObjects")
    for k, n in sorted(tally.items()):
        print(f"   {n:4d}  {k}")
    for line in odd:
        print("   ", line)


for m in MODS:
    survey(m)
