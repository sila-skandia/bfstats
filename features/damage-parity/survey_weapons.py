"""Every vanilla hand weapon: its round's price per hit capsule and range,
from the raw .con (projectile templates, the material manager), checked
against the viewer's extracted tables (damage.json, the weapon glbs).

    python3 features/damage-parity/survey_weapons.py

Reads the installed game (`BF1942_DIR`, default the wine install) and the
viewer's asset tree (`tools/bf1942-models/viewer`). `ext` says the extracted
damage.json row matches the .con, `glb` that the weapon glb's round carries
the same falloff. Ledger DMG-3.
"""
import os, sys, re, json, struct
from pathlib import Path

def num(v):
    """`istream >> float`: the longest leading number, as the console parses it."""
    m = re.match(r'[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?', v)
    return float(m.group(0)) if m else float('nan')

TOOLS = Path(__file__).resolve().parents[2] / 'tools' / 'bf1942-models'
sys.path.insert(0, str(TOOLS))
from bf42.rfa import RfaArchive
GAME = os.path.join(os.environ.get('BF1942_DIR', os.path.expanduser('~/.wine/drive_c/EA Games/Battlefield 1942')),
                    'Mods', 'bf1942', 'Archives')
VIEWER = str(TOOLS / 'viewer')

def texts(rfa):
    a = RfaArchive(os.path.join(GAME, rfa))
    for n in a.entries:
        if n.lower().endswith(('.con', '.inc')):
            yield n, a.read(n).decode('latin-1')

# --- raw: projectile templates ------------------------------------------------
proj = {}
for n, t in texts('Objects.rfa'):
    cur = None
    for line in t.splitlines():
        s = line.strip()
        m = re.match(r'ObjectTemplate\.create\s+(\S+)\s+(\S+)', s, re.I)
        if m:
            cur = m.group(2).lower() if m.group(1).lower() == 'projectile' else None
            if cur: proj.setdefault(cur, {'file': n})
            continue
        if not cur: continue
        m = re.match(r'ObjectTemplate\.(material|minDamage|distToStartLoseDamage|distToMinDamage|damageType|radius)\s+(\S+)', s, re.I)
        if m: proj[cur][m.group(1).lower()] = num(m.group(2))

# --- raw: hand weapons (HandFireArms) -> projectile, rate, once ---------------
hand = {}
for n, t in texts('Objects.rfa'):
    if 'handweapons' not in n.lower(): continue
    cur = None
    for line in t.splitlines():
        s = line.strip()
        m = re.match(r'ObjectTemplate\.create\s+(\S+)\s+(\S+)', s, re.I)
        if m:
            cur = m.group(2) if m.group(1).lower() == 'handfirearms' else None
            if cur: hand.setdefault(cur, {'file': n})
            continue
        if not cur: continue
        m = re.match(r'ObjectTemplate\.(projectileTemplate|roundOfFire|fireOnce|magSize)\s+(\S+)', s, re.I)
        if m: hand[cur][m.group(1).lower()] = m.group(2)

# --- raw: the material manager, in the order materialManagerSettings.con runs it ---
mdamage, attg, defg, mods = {}, {}, {}, {}
game = RfaArchive(os.path.join(GAME, 'bf1942/Game.rfa'))
byname = {n.lower(): n for n in game.entries}
def gtext(rel):
    n = byname.get(('bf1942/game/' + rel).lower().replace('\\', '/'))
    if n is None and not rel.lower().endswith('.con'):
        n = byname.get(('bf1942/game/' + rel + '.con').lower())
    return game.read(n).decode('latin-1') if n else None
order = []
for line in gtext('materialManagerSettings.con').splitlines():
    m = re.match(r'\s*run\s+(\S+)', line, re.I)
    if m: order.append(m.group(1))
for rel in order:
    t = gtext(rel)
    if t is None:
        continue
    mat = cella = celld = None
    for line in t.splitlines():
        m = re.match(r'\s*MaterialManager\.(\w+)\s+(\S+)', line)
        if not m: continue
        k, v = m.group(1), m.group(2)
        if k == 'material': mat = int(v)
        elif k == 'materialDamage' and mat is not None: mdamage[mat] = num(v)
        elif k == 'materialAttGroup' and mat is not None: attg[mat] = int(v)
        elif k == 'materialDefGroup' and mat is not None: defg[mat] = int(v)
        elif k == 'attGroup': cella = int(v)
        elif k == 'defGroup': celld = int(v)
        elif k == 'damageMod' and cella is not None and celld is not None: mods[(cella, celld)] = num(v)
print('ran', len(order), 'scripts')

# --- the viewer's extracted tables ----------------------------------------------
dj = json.load(open(os.path.join(VIEWER, 'maps/_shared/damage.json')))
def glb_projectile(name):
    p = os.path.join(VIEWER, 'models', f'{name}.glb')
    if not os.path.exists(p): return None
    b = open(p, 'rb').read(); ln = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + ln])
    for node in j.get('nodes', []):
        fa = node.get('extras', {}).get('fireArms')
        if fa: return fa.get('projectile')
    return None

def falloff(p, d):
    mn, st, en = p.get('mindamage', 1), p.get('disttostartlosedamage', 0), p.get('disttomindamage', 0)
    if mn >= 1 or st <= 0 or d <= st: return 1.0
    if d > en: return mn
    return (1 - mn) * (en - d) / (en - st) + mn

rows = []
for w, h in sorted(hand.items()):
    pn = (h.get('projectiletemplate') or '').lower()
    p = proj.get(pn)
    if not p or 'material' not in p: continue
    mat = int(p['material']); a = attg.get(mat, mat)
    base = mdamage.get(mat)
    mh, mc, ml = (mods.get((a, d)) for d in (40, 41, 42))
    g = glb_projectile(w)
    vd = dj['materials'].get(str(mat), {}).get('damage')
    vm = dj['modifiers'].get(str(a), {})
    ext_ok = (vd == base and vm.get('40') == mh and vm.get('41') == mc and vm.get('42') == ml)
    gd = (g or {}).get('damage', {}) if isinstance(g, dict) else {}
    glb_ok = None if g is None else (gd.get('minDamage', 1) == p.get('mindamage', 1)
                                     and gd.get('distToStartLoseDamage', 0) == p.get('disttostartlosedamage', 0)
                                     and gd.get('distToMinDamage', 0) == p.get('disttomindamage', 0))
    rows.append((w, pn, mat, base, mh, mc, ml, p.get('mindamage'), p.get('disttostartlosedamage'), p.get('disttomindamage'),
                 h.get('roundoffire'), h.get('fireonce'), ext_ok, glb_ok,
                 [round(base * f * m, 2) if base is not None and m is not None else None
                  for f in (falloff(p, 10), falloff(p, 30), falloff(p, 60)) for m in (mh, mc, ml)]))
print(f"{'weapon':16s} {'mat':>4s} {'base':>5s} {'mods h/c/l':>14s} {'falloff min@start-end':>22s} {'rof':>5s} {'once':>4s} ext glb  price h/c/l @10m | @30m | @60m")
for r in rows:
    w, pn, mat, base, mh, mc, ml, mn, st, en, rof, once, eok, gok, pr = r
    fo = f"{mn}@{st}-{en}" if mn is not None else '-'
    print(f"{w:16s} {mat:4d} {base!s:>5s} {f'{mh}/{mc}/{ml}':>14s} {fo:>22s} {rof!s:>5s} {once!s:>4s} {'ok' if eok else 'BAD':3s} {('ok' if gok else 'BAD') if gok is not None else '-':3s}  "
          f"{pr[0]}/{pr[1]}/{pr[2]} | {pr[3]}/{pr[4]}/{pr[5]} | {pr[6]}/{pr[7]}/{pr[8]}")
