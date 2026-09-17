## Summary

A TreeMesh collider is a `SimpleCollisionMesh` created during `TreeMeshTemplate::load` (lnxded `0x083bd85d`) and stored on the template; `TreeMesh::getDistanceToGeometry` (`0x083bad80`) forwards every query to it. That path is shared by projectile `ObjectManager::raycast` and soldier/static response physics, so one exported hull covers both. The viewer must stop skipping TreeMesh hulls in `assemble.py`, parse the `.tm` collision block, and emit `extras.collision` primitives only for templates with `setHasCollisionPhysics 1` and a non-zero collider — matching retail palms while leaving bushes/ferns fly-through.

## Findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Tree collider participates in **both** projectile rays and body/static collision | confirmed | Collider created at lnxded `TreeMeshTemplate::load` `0x083bd85d` into template vector `+0x154`. `TreeMesh::getDistanceToGeometry` `0x083bad80` indexes `template+0x150` (LOD) / `+0x154` and calls `IVectorCollider` vtable `+0xc` (= SCM `getDistanceToGeometry`). `ObjectManager::raycast` `0x081a1000` → `getCollisionMesh` `0x0818d5b0` (IID_ICollisionMesh) → `IID_IVectorCollider` → same distance call. Soldier side: `simulatePlayerCollisions` → `performMobileCollisionUpdate`; SimpleObjects with HCP get `StaticResponsePhysics` via `SimpleObjectTemplate::setResponsePhysicsComponent` `0x081dd1d0` → `0x081dd330`. |
| 2 | Tree is a `SimpleObject` with geometry `TreeMesh`; collider is **not** a separate world structure | confirmed | Palm `Objects.con`: `ObjectTemplate.create SimpleObject` + `geometry` + `setHasCollisionPhysics 1`. `TreeMesh::queryInterface` answers `IID_IGeometry`, `IID_IVectorCollider` (`this+8`), `IID_ICollisionMesh` (`this+0x10`). Hull lives on the geometry instance. |
| 3 | `setHasCollisionPhysics 1` sets template byte `+0x70` **bit 1**; SimpleObject ctor then `updateFlags(0x200)` on the instance | confirmed | ConsoleClass83 `executeObjectMethod` `0x081bcd20` writes bit 1 of active template `+0x70`. Ctor `0x081da190`–`0x081da431`: if bit 1 set → `BCompositeObject::updateFlags(..., 0x200)`. `ObjectManager::updateObjectInCuller` tests object flags including `$0x200`. |
| 4 | Face `u16` material is the same SM-6 material word (low 8 used as MaterialManager id); tree verts bake face material in the 4th word low 16 | confirmed | Layout: face = `3×u16 index + u16 material`. Survey: **4034/4034** SCM verts match face material low16 (SM-6). Face material histogram (all mods): 166 (most), 165, 45, 80, 81, 82, … Full u16 words are `0x00A6` etc. (high byte 0). |
| 5 | MaterialManager: 166 → att/def group **165**; rifle `218` vs 165 → `e_RichoWood`; 80/81 → `RichoWoodDecal`; 82 → `e_richoWood` | confirmed | `Bf1942/Game/materialManagerdefine.con` via `Game.rfa`; `damage.json` / `load_tables`. 166 has `attGroup=165, defGroup=165, damage=1`. No per-id rem names for 80–82/165–166 beyond section `rem *** Basic Materials ***`. |
| 6 | Trees do not declare hitpoints; a hit is an impact effect, not destruction | confirmed | Palm/pine `Objects.con` are only create/geometry/HCP (no `Hitpoints`). Impact chain from settled `projectiles-and-impacts.md` (client-verified): `handleCollision` → `MaterialManager::getEffectTemplate(att, def)` → `playCollisionEffect`. |
| 7 | Zero-collider meshes are mostly bushes/ferns/plants/grass/canopy tops — not solid trunks | confirmed | This install, nested RFAs: **321** `.tm`, **101** zero, **220** SCM (TM-1’s 401/126/275 was a broader/different count). bf1942 zeros: bush 9, fern 3, plant 17, and named “tree” like `Jungle_tree15*` / canopy tops. Ferns: `FERNSMAL_M1` HCP 0. |
| 8 | HCP and collider can disagree — exporter must use **both** | confirmed | bf1942 TreeMesh objects: HCP=1+collider **48**; HCP=0+no collider **31**; **HCP=0+collider 27** (e.g. `Afri_bush1` faces=36 mat=82; `Jungle_tree11` faces=20 mat=80); HCP=1+no collider **2** (`Jungle_plant7/8`). Emitting every SCM would make bushes solid. |
| 9 | Placement transform: engine keeps hull in local space; world `Mat4` on the TreeMesh is what SCM uses | confirmed | `getDistanceToGeometry` passes `TreeMesh+0xa0` (not the caller’s Mat4) into SCM. SCM copies that Mat4 and transforms the query (`0x083c9f70`). Wake `StaticObjects.con`: **0** non-uniform `absoluteScale` on vegetation creates. |
| 10 | Billboard is visual-only; trees have a single collision LOD; no far-tree collision disable found | confirmed | All bf1942 TreeMesh geoms: `billboard 1`, distance **50** (one at 150). `TreeMeshTemplate::loadBillboard` lnxded is a stub `ret`. Load resizes collider vectors to **one** element; `getNumCollisionLods` is that vector size. |
| 11 | Collision block layout validates on every installed `.tm` | confirmed | Survey (rglob all mods): version always 5; **0** bad face indices; **0** tail misalignments; **0** parse failures; **6358** collision faces / **4034** verts across 220 SCMs. Soft AABB-vs-header mismatch on some files is authoring slack, not a parse break. |
| 12 | Budget is small | confirmed | All SCM faces this install: **6358** (unique geometries). bf1942 HCP=1 TreeMesh templates: **48** geoms, **751** faces. Wake HCP=1 tree placements: **324**, unique geometry faces **117**. Guadalcanal: 663 placements / 145 unique faces. Hulls are per geometry, not per instance. |

## What the viewer must change

**`bf42/treemesh.py`**
- Promote `_skip_collision` to a real parser returning vertices `(x,y,z)`, faces `(i0,i1,i2, material_u16)`, optional BSP skip-after-parse.
- Keep rejecting any class id other than `0` / `CID_SimpleCollisionMesh` (`0xEB97C2FA`).
- `defenseMaterial` = `material_u16 & 0xFF` (same as StandardMesh).

**`bf42/assemble.py`**
- In `_collision_for_geometry` / `_collision_layer_faces`: stop returning empty for `treemesh`.
- When `include_collision` and geometry kind is TreeMesh: if `.tm` has SCM **and** the owning object template has `setHasCollisionPhysics 1`, emit one glTF primitive per distinct face material with `extras: { collision: true, defenseMaterial: <id> }` under the same node transform as the visible tree (identical to SM statics).
- Do **not** emit for zero-collider files or HCP=0 templates (even if the `.tm` contains an SCM).
- Re-extract maps (`extract_map.py` already defaults collision on).

**`viewer/collision.js`**
- **No change** if exporter emits the same `extras.collision` / `defenseMaterial` primitives already indexed for buildings/vehicles. `cast` and `sweepSphere` will pick up palms automatically.

**Impact / damage**
- No special tree code: existing `(attackerMaterial, defenseMaterial)` → effect table already yields wood ricochets (`e_RichoWood` / `RichoWoodDecal` / `e_richoWood`) for palm materials 165/166/80–82.
- Do not invent tree destruction; retail palms ship no hitpoints.

## Open

- Exact rem display names for materials 80/81/82/165/166 are not in `materialManagerdefine.con` (only section headers). Impact routing via defGroup is solid; pretty labels are not load-bearing.
- Whether HCP=0 objects that still receive `StaticResponsePhysics` can body-block a soldier without object flag `0x200` was not fully closed; projectile/culler path is clearly HCP/`0x200`-gated. Exporter rule “HCP=1 AND SCM” matches the defect (palms) and avoids bush regressions.
- TM-1 counted 401 meshes; this Wine install with nested `Archives/**/*.rfa` yields **321**. Counts above are from this install. Re-run the survey on a fuller mod set before treating 321 as universal.
- Soft hull-vs-header AABB outliers (~dozens of files): do not hard-fail the parser on bounds; indices + tail alignment are the ship criteria.
- Client binary was bridge-MATCH (`60c9452d…`); drawing of impact sprites was not re-decompiled this round — effect **selection** is data + the already client-verified collision→effect chain in `projectiles-and-impacts.md`.

## Proposed ledger rows

| id | finding | status | evidence |
|---|---|---|---|
| TM-2 | TreeMesh collision queries go through `TreeMesh::getDistanceToGeometry` → template `SimpleCollisionMesh` in `+0x154[lod]` | verified | lnxded `0x083bad80`, create at `0x083bd85d`, raycast `0x081a1000`/`0x0818d5b0` |
| TM-3 | TreeMesh answers `IID_ICollisionMesh` / `IID_IVectorCollider`; one collision LOD | verified | `queryInterface` `0x083bbde0`; load resizes collider vectors to 1 |
| TM-4 | `.tm` face `u16` is MaterialManager defense material (SM-6 encoding); 100% vert low16 match on surveyed SCMs | verified | r1 survey 4034/4034; face hist 166/165/80–82 dominant |
| TM-5 | Export tree hulls only when SCM present **and** `ObjectTemplate.setHasCollisionPhysics 1` | verified | bf1942: 27 HCP=0+SCM bushes/trees; palm HCP=1; flag bit1 → object `0x200` |
| TM-6 | Billboard distance does not remove the collider; billboard loader is not a second hull | verified | `billboardDistance` 50 on geoms; `loadBillboard` stub; single LOD |
| TM-7 | Tree collision layout (class id, ver 5, 16-byte verts, 8-byte faces, BSP) parses clean on all installed `.tm` | verified | 321/321; 0 index/tail/parse failures; 6358 faces |

---

### Script: `r1_tm_collision_survey.py`

```python
#!/usr/bin/env python3
"""R1 survey: parse (do not skip) every installed TreeMesh collision block.

Validates the layout walked by bf42/treemesh.py::_skip_collision across all
mods (nested Archives/**/*.rfa): version always 5; face indices in range;
BSP walk lands exactly before visible verts; SM-6 material bake on verts.

    python3 r1_tm_collision_survey.py
"""

from __future__ import annotations

import collections
import struct
import sys
from pathlib import Path

REPO = Path("/home/dylan/projects/skandia/bfstats")
sys.path.insert(0, str(REPO / "tools/bf1942-models"))

from bf42.rfa import ArchivePool  # noqa: E402
from bf42.stdmesh import MeshError, _Cursor  # noqa: E402

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
COL_MAGIC = 0xEB97C2FA
SLACK = 1e-2

def classify_name(name: str) -> str:
    n = name.lower().rsplit("/", 1)[-1]
    for key, label in (
        ("fern", "fern"), ("bush", "bush"), ("grass", "grass"),
        ("plant", "plant"), ("palm", "palm"), ("treetop", "canopy"),
        ("ptreetop", "canopy"), ("tree", "tree"), ("pine", "tree"),
        ("spruce", "tree"), ("oak", "tree"), ("birch", "tree"),
        ("birtch", "tree"), ("aspen", "tree"), ("monstrea", "plant"),
    ):
        if key in n:
            return label
    return "other"

def parse_header(c: _Cursor, name: str):
    version = c.u32()
    if version != 3:
        raise MeshError(f"{name}: unexpected TreeMesh version {version}")
    c.u32()
    angle_count = c.u32()
    if angle_count < 1 or angle_count > 16:
        raise MeshError(f"{name}: implausible angle count {angle_count}")
    mesh_min = c.f32x3()
    mesh_max = c.f32x3()
    c.pos += 24
    for _ in range(4):
        count = c.u32()
        if count > 64:
            raise MeshError(f"{name}: implausible mesh count {count}")
        for _ in range(count):
            c.u32(); c.u32(); c.string()
    return mesh_min, mesh_max

def skip_bsp_node(c: _Cursor, depth: int = 0) -> None:
    if depth > 64:
        raise MeshError("collision BSP too deep")
    c.pos += 24
    facenum = c.u32()
    c.pos += facenum * 4
    for _ in range(2):
        if c.u8() == 1:
            skip_bsp_node(c, depth + 1)

def parse_collision(c: _Cursor, name: str, mesh_min, mesh_max):
    start = c.pos
    if c.pos + 4 > len(c.data):
        return {"kind": "eof"}
    magic = c.u32()
    if magic == 0:
        return {"kind": "none", "end": c.pos, "faces": 0, "verts": 0,
                "mat_hist": collections.Counter(), "bad_idx": 0,
                "in_bounds": True, "sm6_match": 0, "sm6_total": 0}
    if magic != COL_MAGIC:
        raise MeshError(f"{name}: unsupported collider class id 0x{magic:08X}")
    version = c.u32()
    if version != 5:
        raise MeshError(f"{name}: unexpected collision version {version}")
    vert_count = c.u32()
    verts = []
    for _ in range(vert_count):
        x, y, z = c.f32x3()
        raw4 = struct.unpack_from("<I", c.data, c.pos)[0]
        c.pos += 4
        verts.append((x, y, z, raw4))
    face_count = c.u32()
    faces = []
    materials = []
    for _ in range(face_count):
        i0, i1, i2, mat = struct.unpack_from("<4H", c.data, c.pos)
        c.pos += 8
        faces.append((i0, i1, i2, mat))
        materials.append(mat)
    c.u32(); c.u32()
    num_faces = c.u32()
    c.pos += num_faces * 32
    skip_bsp_node(c)
    end = c.pos
    bad_idx = sum(
        1 for f in faces
        if f[0] >= vert_count or f[1] >= vert_count or f[2] >= vert_count
    )
    if verts:
        lo = [min(v[i] for v in verts) for i in range(3)]
        hi = [max(v[i] for v in verts) for i in range(3)]
        in_bounds = all(
            lo[i] >= mesh_min[i] - SLACK and hi[i] <= mesh_max[i] + SLACK
            for i in range(3)
        )
    else:
        in_bounds = True
    face_mats = {m & 0xFFFF for m in materials}
    sm6_total = len(verts)
    sm6_match = sum(1 for v in verts if (v[3] & 0xFFFF) in face_mats)
    return {
        "kind": "scm", "version": version, "end": end, "start": start,
        "verts": vert_count, "faces": face_count, "bad_idx": bad_idx,
        "in_bounds": in_bounds, "sm6_match": sm6_match, "sm6_total": sm6_total,
        "mat_hist": collections.Counter(m & 0xFF for m in materials),
        "mat_word_hist": collections.Counter(materials),
    }

def verify_tail(c: _Cursor, col_end: int) -> bool:
    c.pos = col_end
    vertex_count = c.u32()
    c.pos += vertex_count * 44  # VertexDifNormal2SetTex2D
    index_count = c.u32()
    c.pos += index_count * 2
    return c.pos == len(c.data)

def mount_mod(mod: str) -> ArchivePool | None:
    root = MODS / mod / "Archives"
    if not root.is_dir():
        return None
    pool = ArchivePool()
    n = 0
    for rfa in sorted(root.rglob("*.rfa")):
        try:
            pool.add(rfa, str(rfa.relative_to(root)))
            n += 1
        except Exception:
            pass
    return pool if n else None

def main() -> int:
    total = zero = scm = 0
    total_faces = 0
    sm6_match = sm6_total = 0
    mat_global: collections.Counter = collections.Counter()
    failures = []
    idx_fail = []
    tail_fail = []
    bounds_fail = []
    zero_samples: dict[str, list[str]] = collections.defaultdict(list)
    per_mod = {}

    for mod in sorted(p.name for p in MODS.iterdir() if p.is_dir()):
        pool = mount_mod(mod)
        if pool is None:
            continue
        stats = {"tm": 0, "zero": 0, "scm": 0, "faces": 0, "fail": 0}
        for name in (n for n in pool.names() if n.lower().endswith(".tm")):
            total += 1
            stats["tm"] += 1
            cls = classify_name(name)
            try:
                c = _Cursor(pool.read(name))
                mesh_min, mesh_max = parse_header(c, name)
                col = parse_collision(c, name, mesh_min, mesh_max)
                if col["kind"] == "none":
                    zero += 1
                    stats["zero"] += 1
                    if len(zero_samples[cls]) < 6:
                        zero_samples[cls].append(f"{mod}:{name}")
                elif col["kind"] == "scm":
                    scm += 1
                    stats["scm"] += 1
                    stats["faces"] += col["faces"]
                    total_faces += col["faces"]
                    mat_global.update(col["mat_hist"])
                    sm6_match += col["sm6_match"]
                    sm6_total += col["sm6_total"]
                    if col["bad_idx"]:
                        idx_fail.append(f"{mod}:{name}")
                    if not col["in_bounds"]:
                        bounds_fail.append(f"{mod}:{name}")
                if not verify_tail(c, col["end"]):
                    leftover = c.data[c.pos:]
                    if any(leftover):
                        tail_fail.append(f"{mod}:{name} remaining={len(leftover)}")
            except Exception as e:
                stats["fail"] += 1
                failures.append(f"{mod}:{name}: {e}")
        per_mod[mod] = stats

    print("=== TreeMesh collision survey (R1) ===")
    print(f"total .tm: {total}  zero: {zero}  scm: {scm}  faces: {total_faces}")
    if sm6_total:
        print(f"SM-6 match: {sm6_match}/{sm6_total} ({100*sm6_match/sm6_total:.2f}%)")
    print(f"index/tail/parse failures: {len(idx_fail)}/{len(tail_fail)}/{len(failures)}")
    print(f"soft bounds mismatches: {len(bounds_fail)}")
    for mod, s in per_mod.items():
        if s["tm"]:
            print(f"  {mod:16} tm={s['tm']:4} zero={s['zero']:3} "
                  f"scm={s['scm']:3} faces={s['faces']:5}")
    print("face material byte hist:", dict(mat_global.most_common(12)))
    print("zero-collider samples:")
    for cls, samples in sorted(zero_samples.items()):
        print(f"  [{cls}]")
        for s in samples:
            print(f"    {s}")
    return 0 if not failures and not idx_fail and not tail_fail else 1

if __name__ == "__main__":
    raise SystemExit(main())
```

### Script: `r1_tm_hcp_and_placement.py` (core checks)

```python
#!/usr/bin/env python3
"""R1: HCP vs collider correlation, materials/effects, Wake tree budget."""

from __future__ import annotations

import collections
import re
import struct
import sys
from pathlib import Path

REPO = Path("/home/dylan/projects/skandia/bfstats")
sys.path.insert(0, str(REPO / "tools/bf1942-models"))

from bf42.rfa import ArchivePool
from bf42.stdmesh import _Cursor, MeshError
from bf42 import damage as dmgmod

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
COL_MAGIC = 0xEB97C2FA

def mount(mod: str) -> ArchivePool:
    pool = ArchivePool()
    root = MODS / mod / "Archives"
    for rfa in sorted(root.rglob("*.rfa")):
        try:
            pool.add(rfa, str(rfa.relative_to(root)))
        except Exception:
            pass
    return pool

def tm_collider(data: bytes):
    c = _Cursor(data)
    if c.u32() != 3:
        raise MeshError("ver")
    c.u32(); c.u32(); c.pos += 48
    for _ in range(4):
        cnt = c.u32()
        for __ in range(cnt):
            c.u32(); c.u32(); c.string()
    magic = c.u32()
    if magic == 0:
        return False, 0, -1
    if magic != COL_MAGIC:
        raise MeshError(f"id {magic:#x}")
    assert c.u32() == 5
    vc = c.u32(); c.pos += vc * 16
    fc = c.u32()
    mat0 = -1
    if fc:
        _a, _b, _c, mat0 = struct.unpack_from("<4H", c.data, c.pos)
        mat0 &= 0xFF
    return True, fc, mat0

def parse_objects(text: str):
    out = {}; cur = None
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r"ObjectTemplate\.create\s+\S+\s+(\S+)", s, re.I)
        if m:
            cur = m.group(1)
            out[cur] = {"geometry": None, "hcp": None}
            continue
        if not cur:
            continue
        m = re.match(r"ObjectTemplate\.geometry\s+(\S+)", s, re.I)
        if m:
            out[cur]["geometry"] = m.group(1)
        m = re.match(r"ObjectTemplate\.setHasCollisionPhysics\s+(\S+)", s, re.I)
        if m:
            out[cur]["hcp"] = m.group(1) in ("1", "true", "True")
    return out

def parse_geoms(text: str):
    out = {}; cur = None
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r"GeometryTemplate\.create\s+(\S+)\s+(\S+)", s, re.I)
        if m:
            cur = m.group(2)
            out[cur] = {"kind": m.group(1), "file": cur, "billboard": None,
                        "billboardDistance": None}
            continue
        if not cur:
            continue
        m = re.match(r"GeometryTemplate\.file\s+(\S+)", s, re.I)
        if m:
            out[cur]["file"] = m.group(1)
        m = re.match(r"GeometryTemplate\.billboard\s+(\S+)", s, re.I)
        if m:
            out[cur]["billboard"] = m.group(1) in ("1", "true", "True")
        m = re.match(r"GeometryTemplate\.billboardDistance\s+(\S+)", s, re.I)
        if m:
            out[cur]["billboardDistance"] = float(m.group(1))
    return out

def main() -> int:
    pool = mount("bf1942")

    def resolve(path: str):
        try:
            return pool.read(path)
        except Exception:
            low = path.lower().replace("\\", "/")
            for n in pool.names():
                if n.lower().replace("\\", "/") == low:
                    return pool.read(n)
            return None

    tables = dmgmod.load_tables(resolve)
    print("=== materials / rifle effects ===")
    for mid in (80, 81, 82, 165, 166, 118):
        print(mid, tables.materials.get(mid))
        dg = tables.materials[mid].def_group if mid in tables.materials else mid
        print("  218 vs", dg, "->", tables.effects.get((218, dg)))

    objs, geoms = {}, {}
    for name in pool.names():
        if not name.lower().endswith(".con"):
            continue
        t = pool.read(name).decode("latin-1", "replace")
        if "ObjectTemplate.create" in t:
            objs.update(parse_objects(t))
        if "GeometryTemplate.create" in t:
            geoms.update(parse_geoms(t))
    tm_index = {Path(n).stem.lower(): n for n in pool.names() if n.lower().endswith(".tm")}

    combo = collections.Counter()
    examples = collections.defaultdict(list)
    for oname, o in objs.items():
        gname = o.get("geometry") or oname
        g = geoms.get(gname) or geoms.get(oname)
        if not g or g["kind"].lower() != "treemesh":
            continue
        stem = Path(g["file"]).stem.lower()
        tm = tm_index.get(stem)
        if not tm:
            continue
        has, fc, mat = tm_collider(pool.read(tm))
        key = (has, o.get("hcp"))
        combo[key] += 1
        if len(examples[key]) < 5:
            examples[key].append(f"{oname} faces={fc} mat={mat}")
    print("=== HCP vs collider ===")
    for k, n in sorted(combo.items(), key=lambda x: -x[1]):
        print(f"collider={k[0]} hcp={k[1]}: {n}")
        for e in examples[k]:
            print(" ", e)

    wake = [n for n in pool.names()
            if "wake" in n.lower() and n.lower().endswith("staticobjects.con")][0]
    text = pool.read(wake).decode("latin-1", "replace")
    placed = collections.Counter(
        re.findall(r"(?im)^Object\.create\s+(\S+)", text))
    scales_nu = re.findall(
        r"(?im)^Object\.absoluteScale\s+([\d.\-eE]+)\s+([\d.\-eE]+)\s+([\d.\-eE]+)",
        text)
    used, uniq, hcp1 = set(), 0, 0
    for tmpl, cnt in placed.items():
        gname = (objs.get(tmpl) or {}).get("geometry") or tmpl
        g = geoms.get(gname) or geoms.get(tmpl)
        if not g or g["kind"].lower() != "treemesh":
            continue
        stem = Path(g["file"]).stem.lower()
        tm = tm_index.get(stem)
        if not tm:
            continue
        has, fc, mat = tm_collider(pool.read(tm))
        hcp = (objs.get(tmpl) or {}).get("hcp")
        if has and hcp:
            hcp1 += cnt
            if stem not in used:
                used.add(stem)
                uniq += fc
        if "palm" in tmpl.lower():
            print(f"  {tmpl}: x{cnt} has={has} faces={fc} mat={mat} hcp={hcp}")
    print(f"Wake hcp1 placements={hcp1} unique faces={uniq}")
    print(f"non-uniform absoluteScale lines in Wake statics: "
          f"{sum(1 for a,b,c in scales_nu if abs(float(a)-float(b))>1e-4 or abs(float(b)-float(c))>1e-4)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

Bridge check before client claims: `./xref.py check` → sha256 `60c9452d…` **MATCH**. All engine addresses above are from `bf1942_lnxded.static` except the already-settled client impact chain cited from `projectiles-and-impacts.md`.
