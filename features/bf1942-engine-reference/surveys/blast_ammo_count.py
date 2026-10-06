"""Which shipped FireArms does `blastAmmoCount` reach, in every installed mod?

Run from the repository root. Backs ledger rows BOMB-4 and BOMB-4b.

`blastAmmoCount` (`FireArmsTemplate+0x348`, a bool) changes a pull only for a
FireArms that fires a salvo: more than one `addFireArmsPosition` barrel and no
`asynchronyFire`. Its value is read with `std::istream >> bool`, which accepts
only "0" and "1"; anything else fails the read and leaves the word's one static
argument holding whatever the previous good read put there (BOMB-4b). This
prints, per install, every template that declares the word (with its value and
whether it fires a salvo at all) and every salvo FireArms that does not.

Result 2026-10-06, 17 installs: see the ledger rows.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
from bf42.rfa import RfaArchive

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
LINE = re.compile(r'^\s*objecttemplate\.(\w+)\s*(.*?)\s*$', re.I)


def templates(text):
    """Yield (kind, name, {word: [values]}) per FireArms-like template block."""
    cur = None
    in_rem = False
    for raw in text.splitlines():
        low = raw.strip().lower()
        if low.startswith('beginrem'):
            in_rem = True
            continue
        if low.startswith('endrem'):
            in_rem = False
            continue
        if in_rem or low.startswith('rem'):
            continue
        m = LINE.match(raw)
        if not m:
            continue
        word, rest = m.group(1).lower(), m.group(2)
        if word in ('create', 'activesafe'):
            if cur:
                yield cur
            parts = rest.split()
            cur = (parts[0].lower(), parts[1] if len(parts) > 1 else '?', {}) \
                if parts and parts[0].lower() in ('firearms', 'handfirearms') else None
            continue
        if cur is None:
            continue
        if word.startswith('set') and word[3:] in ('blastammocount', 'asynchronyfire'):
            word = word[3:]
        cur[2].setdefault(word, []).append(rest)
    if cur:
        yield cur


def main():
    for mod in sorted((GAME / "Mods").iterdir()):
        arch = mod / "Archives"
        if not arch.is_dir():
            continue
        declared, salvo_without = [], []
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
                for kind, name, words in templates(text):
                    barrels = len(words.get('addfirearmsposition', []))
                    asyn = (words.get('asynchronyfire') or ['0'])[-1].strip() == '1'
                    blast = words.get('blastammocount')
                    salvo = barrels > 1 and not asyn
                    if blast:
                        declared.append((kind, name, blast[-1], barrels, asyn, entry))
                    elif salvo:
                        salvo_without.append((kind, name, barrels, entry))
        if not declared and not salvo_without:
            continue
        print(f"== {mod.name}")
        for kind, name, val, barrels, asyn, entry in declared:
            effect = 'salvo' if barrels > 1 and not asyn else 'no salvo (moot)'
            parse = 'read' if val in ('0', '1') else 'FAILS the bool read'
            print(f"   declares {kind:12s} {name:32s} {val!r:5s} {parse:20s} "
                  f"barrels={barrels} async={int(asyn)} -> {effect}   {entry}")
        hand = [s for s in salvo_without if s[0] == 'handfirearms']
        veh = [s for s in salvo_without if s[0] == 'firearms']
        print(f"   salvo FireArms without the word: {len(veh)} vehicle, {len(hand)} hand")
        for kind, name, barrels, entry in hand:
            print(f"      hand {name:32s} barrels={barrels}   {entry}")


if __name__ == '__main__':
    main()
