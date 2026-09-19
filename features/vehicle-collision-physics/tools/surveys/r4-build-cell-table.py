#!/usr/bin/env python3
"""Recursively load MaterialManagerSettings.con + every `run X` include and
build the full (attGroup,defGroup)->damageMod cell table, plus the material
identity table from materialManagerdefine.con. Vanilla bf1942 only.
"""
import re, sys
from pathlib import Path
sys.path.insert(0, str(Path("/home/dylan/projects/skandia/bfstats/tools/bf1942-models")))
from bf42.rfa import ArchivePool

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"


def load_pool(mod):
    pool = ArchivePool()
    for rfa in sorted((MODS / mod / "Archives").rglob("*.rfa")):
        try:
            pool.add(rfa, rfa.name)
        except Exception:
            pass
    return pool


RUN_RE = re.compile(r"^\s*[Rr]un\s+(\S+)", re.M)
ATT_RE = re.compile(r"MaterialManager\.attGroup\s+(-?\d+)", re.I)
DEF_RE = re.compile(r"MaterialManager\.defGroup\s+(-?\d+)", re.I)
MOD_RE = re.compile(r"MaterialManager\.damageMod\s+([\d.eE+-]+)", re.I)
EFFECT_RE = re.compile(r"MaterialManager\.setEffectTemplate\s+(\S+)", re.I)
# atof()-style: some vanilla lines are malformed ("0.1.0" - a literal typo at
# attGroup 203 / defGroup 45-49 in materialManagerSettings.con). The engine's
# C string->float parser stops at the second '.', so mimic that instead of
# rejecting the line.
FLOAT_TOKEN_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?")


def parse_engine_float(raw: str) -> float:
    m = FLOAT_TOKEN_RE.match(raw)
    if not m:
        raise ValueError(f"not a float: {raw!r}")
    return float(m.group(0))


def resolve_run_path(base_dir: str, ref: str) -> str:
    # base_dir like "Bf1942/Game"; ref like "damage_system/Sherman" (no extension)
    ref = ref.strip()
    if not ref.lower().endswith(".con"):
        ref = ref + ".con"
    return f"{base_dir}/{ref}"


def load_cells(pool, start="Bf1942/Game/materialManagerSettings.con", base_dir="Bf1942/Game"):
    names_lower = {n.lower(): n for n in pool.names()}
    cells = {}          # (att,def) -> damageMod (last write wins, matching engine's setCell overwrite semantics)
    effects = {}         # (att,def) -> effect template name
    visited = set()
    queue = [start]
    file_count = 0
    cell_writes = 0
    missing = []
    while queue:
        path = queue.pop(0)
        key = path.lower()
        if key in visited:
            continue
        visited.add(key)
        real = names_lower.get(key)
        if not real:
            missing.append(path)
            continue
        data = pool.read(real)
        text = data.decode("latin-1")
        file_count += 1
        cur_att = None
        cur_def = None
        # Walk line by line, tracking current att/def context like the engine's
        # console dispatcher does (each MaterialManager.attGroup / .defGroup
        # sets the "current" context used by the next .damageMod / .setCell).
        for line in text.splitlines():
            m = ATT_RE.search(line)
            if m:
                cur_att = int(m.group(1))
                continue
            m = DEF_RE.search(line)
            if m:
                cur_def = int(m.group(1))
                continue
            m = MOD_RE.search(line)
            if m and cur_att is not None and cur_def is not None:
                cells[(cur_att, cur_def)] = parse_engine_float(m.group(1))
                cell_writes += 1
                continue
            m = EFFECT_RE.search(line)
            if m and cur_att is not None and cur_def is not None:
                effects[(cur_att, cur_def)] = m.group(1)
        for m in RUN_RE.finditer(text):
            queue.append(resolve_run_path(base_dir, m.group(1)))
    return cells, effects, file_count, cell_writes, missing


def load_materials(pool, path="Bf1942/Game/materialManagerdefine.con"):
    names_lower = {n.lower(): n for n in pool.names()}
    real = names_lower[path.lower()]
    text = pool.read(real).decode("latin-1")
    blocks = re.split(r"\n(?=MaterialManager\.material )", text)
    mats = {}
    last_comment = None
    for b in blocks:
        m = re.search(r"MaterialManager\.material (\d+)", b)
        if not m:
            continue
        mid = int(m.group(1))
        att = re.search(r"materialAttGroup\s+(\d+)", b, re.I)
        de = re.search(r"materialDefGroup\s+(\d+)", b, re.I)
        dmg = re.search(r"materialDamage\s+([\d.eE+-]+)", b, re.I)
        fric = re.search(r"materialFriction\s+([\d.eE+-]+)", b, re.I)
        elas = re.search(r"materialElasticity\s+([\d.eE+-]+)", b, re.I)
        resi = re.search(r"materialResistance\s+([\d.eE+-]+)", b, re.I)
        # pull the nearest preceding "rem" comment for a human label
        pre = b.split("MaterialManager.material")[0]
        comments = re.findall(r"rem\s+(.+)", pre, re.I)
        label = comments[-1].strip() if comments else None
        mats[mid] = dict(
            attGroup=int(att.group(1)) if att else None,
            defGroup=int(de.group(1)) if de else None,
            damage=float(dmg.group(1)) if dmg else None,
            friction=float(fric.group(1)) if fric else None,
            elasticity=float(elas.group(1)) if elas else None,
            resistance=float(resi.group(1)) if resi else None,
            label=label,
        )
    return mats


if __name__ == "__main__":
    mod = sys.argv[1] if len(sys.argv) > 1 else "bf1942"
    pool = load_pool(mod)
    cells, effects, file_count, cell_writes, missing = load_cells(pool)
    mats = load_materials(pool)
    print(f"mod={mod}: {file_count} cell files loaded, {cell_writes} cell writes, "
          f"{len(cells)} distinct (att,def) pairs, {len(missing)} 'run' targets missing")
    if missing:
        print("missing:", missing[:20])
    print(f"materials defined: {len(mats)}")

    pairs = [(45, 60), (45, 61), (45, 63), (45, 90), (45, 50),
             (50, 60), (50, 61), (50, 63), (50, 90),
             (60, 45), (60, 50)]
    print("\nRequested cells:")
    for att, de in pairs:
        v = cells.get((att, de))
        eff = effects.get((att, de))
        print(f"  ({att:3d},{de:3d}) damageMod={v!r}  effect={eff!r}")

    for mid in (45, 50, 60, 61, 63, 90):
        print(f"material {mid}: {mats.get(mid)}")
