# Infantry, kits, hand weapons and the gameplay loop — parity gap report

Vanilla BF1942 (`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942`) against
`tools/bf1942-models/` and `tools/bf1942-models/viewer/` as of this working tree.

Every count below is reproducible. Unless stated otherwise the setup is:

```bash
cd /home/dylan/projects/skandia/bfstats/tools/bf1942-models
python3 -c "from bf42.rfa import RfaArchive; a=RfaArchive(<archive>); ..."
# RfaArchive(path) -> .entries: dict[name, (c_size, uc_size, offset)], .read(name) -> bytes
```

A convenience dump used repeatedly below:

```bash
python3 - <<'EOF'
from pathlib import Path; from bf42.rfa import RfaArchive
A=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
a=RfaArchive(A/'Objects.rfa')
out=[]
for n in sorted(a.entries):
    if n.lower().endswith(('.con','.inc')):
        out.append(f'===== {n} =====\n'+a.read(n).decode('latin-1')+'\n')
open('/tmp/vanilla_objects_dump.txt','w').write(''.join(out))
EOF
```

---

## 0. Headline numbers

| measure | value | how |
|---|---|---|
| `Kit` templates in vanilla `Objects.rfa` | **45** | `grep -c "ObjectTemplate.create Kit " /tmp/vanilla_objects_dump.txt` |
| …bound by a vanilla level via `game.setKit` (case-folded) | **40** | §1.2 |
| `KitPart` declarations / distinct names | **66 / 52** | `grep -ic "create KitPart"`; dedupe by lowercase name |
| worn geometries reachable from a `Kit`, head / back / hip | **50 — 25 / 14 / 11** | §1.1 |
| …worn by one of the 40 **live** kits | **43 — 20 / 13 / 10** | §1.1 |
| …that resolve to a `.sm` in `standardMesh.rfa` | **48 of 50** | §1.1 |
| **KitPart meshes extracted today** | **0** | `ls viewer/models \| grep -ci '^kit'` → 0; no helmet/bacpac/hippack/radio glb exists |
| soldier figures currently rendering bare-headed | **232 of 232** (8 `*.glb` + 224 `*.pose.glb`) | `ls viewer/models/poses/*.pose.glb \| wc -l` → 224 |
| `HandFireArms` templates in vanilla | **28** | §2.1 |
| …browsable in `models.json` | **26** | missing `K98Sniper`, `No4Sniper` |
| …with a pose file | **28** (× 8 soldiers = 224) | `ls viewer/models/poses/ \| sed 's/.*__//;s/\.pose\.glb//' \| sort -u` |
| …that can be fired anywhere in the viewer | **0** | `fireArms: []` in every handweapon report; poses.html has no GunFire import |
| `.baf` animation clips in `animations.rfa` | **1,154** | §3.4 |
| …sampled by the pipeline | **6 per (soldier, weapon)** — 3 stances × (lower, upper), **frame 0 only** | `extract_pose.py:55-60`, `extract_pose.py:190-191`, `--frame` default 0 at `extract_pose.py:633` |

---

## 1. Kits and soldier appearance

### 1.0 Verifying `kits.md`'s core claims — three hold, two do not

`kits.md` is an unimplemented design doc. Its mechanism claims are **correct**;
two of its *liveness* claims are **refuted** by measurement, and both refutations
change what the design would build.

| claim | verdict | evidence |
|---|---|---|
| 45 `Kit` templates in vanilla | **CONFIRMED** | `grep -c "ObjectTemplate.create Kit "` → 45 |
| 66 `KitPart`s, three properties only | **CONFIRMED** | `grep -ic "create KitPart"` → 66 |
| "50 worn geometries — 25 / 14 / 11" | **CONFIRMED exactly**, once you count geometries *reachable from a `Kit`* rather than `KitPart` declarations | §1.1 |
| `setBoneName` takes exactly `A` / `backpack` / `HipPack` | **CONFIRMED** in vanilla — 28 / 21 / 17 = 66 | `grep -io "setBoneName.*" \| awk '{print tolower($2)}' \| sort \| uniq -c` |
| `A`, `backpack`, `HipPack` are real bones in `UsSoldier.ske` | **CONFIRMED** — bone 17 (parent 16 `Bip01 Head`), 65 (parent 13), 66 (parent 11), 67 bones total | §1.3 |
| `JapSoldier.ske` has `Bip01 Head` and no `A`, referenced by nothing | **CONFIRMED** — 60 bones, no `A`/`backpack`/`HipPack`; all 8 vanilla `BFSoldier`s `createSkeleton animations/UsSoldier.ske` | §1.3 |
| `con.py` parses no `setBoneName` | **CONFIRMED** — `grep -ric setBoneName bf42/ *.py` → **0** | §1.4 |
| `roster.py:78` `KIT_SOURCE` misses theatre-suffixed folders | **CONFIRMED** — `objects/items/gerkitdesert/scout/objects.con` does not match | §1.4 |
| "**no vanilla level binds a Canadian kit**" | **REFUTED** | §1.2 |
| "**One soldier per team, enforced by the engine** … no level ever binds two skins to one team" | **REFUTED** | §1.2 |
| "bf1942: 35 bound / 35 browsable" | **REFUTED** — 40 bound | §1.2 |

### GAP 1.1 — No kit part is extracted; every extracted soldier is bare, backpack-less and hip-pack-less

**Gap.** The extractor walks `BFSoldier` and `HandFireArms` and never walks
`Kit`, so none of the 43 live `KitPart` geometries — helmets, backpacks,
hip packs, the scout's radio — reaches a `.glb`, and all 232 rendered soldier
figures are bare-headed.

**Ground truth.** `Objects.rfa`, `Objects/Items/<Nation>Kit/<Class>/Objects.con`
(+ `Objects/Items/BaseKit/Objects.con`, `Objects/Items/Common/Objects.con`).
45 `Kit` blocks, 66 `KitPart` declarations collapsing to 52 distinct names, each
with exactly `geometry` / `setBoneName` / `setCopyLinksCount`:

```con
ObjectTemplate.create KitPart Medic_helm_ger
ObjectTemplate.geometry Medic_helm_ger
ObjectTemplate.setBoneName A
ObjectTemplate.setCopyLinksCount 0
```

**Three nested counts, and the unit matters.** 52 distinct `KitPart` *names* are
declared, but two are never `addTemplate`d by any kit (`GB_Medic_hippack` →
`brit_Medic_hippack`, and `Medic_helm_brit` as declared inside `CanadianKit`),
so **50 geometries are reachable from a `Kit`** — split `A` 25 / `backpack` 14 /
`HipPack` 11, which is `kits.md`'s figure exactly. Filtering to the 40 live kits
(§1.2) leaves **43 — 20 / 13 / 10**. The extraction job is those 43; the other
seven are the five dead `BaseKit` `Soldier/*Helmet` plus `BackPack` and `HipPack`.

Reachable geometry names per bone:

- **head (25)** — `Us_Helmet`, `UsMarine_Helmet`, `Brit_helmet`, `Canadian_helmet`,
  `German_Helmet`, `Germ_DesertHelmet`, `Jap_Helmet`, `Russ_Helmet`,
  `Medic_helm_us`, `Medic_helm_brit`, `Medic_helm_ger`, `Medichelm_Desert_ger`,
  `Medichelm_jap`, `medichelm_Russ`, `US_Scout_Helm`, `Brit_Scout_helm`,
  `ger_Scout_helm`, `Germ_ScoutHelm_Desert`, `Jap_ScoutHelm`, `Russ_ScoutHelm`,
  plus 5 dead `Soldier/*Helmet` from `BaseKit`.
- **back (14)** — `Radio`, `BackPack`, `US_Assult_Bacpac`, `US_Britt_Bacpac`,
  `brit_Assult_Bacpac`, `Bacpac_Big_ger`, `BacpacBig_Desert_ger`, `BacpacBig_jap`,
  `BacpacBig_rus`, `Bacpac_rus`, `Bacpac_Big_us_Bri`, `USMC_Backpack`,
  `USMC_Eng_Backpack`, `USMC_Med_Backpack`.
- **hip (11)** — `Us_Hip_Pack`, `UsMarine_Hip_Pack`, `British_hippack`,
  `German_hippack`, `German_Medic_hippack`, `Jap_Hip_Pack`, `Jap_Medic_hippack`,
  `Russian_hippack`, `Russian_Medic_hippack`, `US_Medic_hippack`, `US_Grenades`,
  plus dead `HipPack`.

**48 of 50 resolve to a real `.sm`** through `GeometryTemplate.file` in
`Objects/Items/*/Common/Geometries.con` + `Objects/Items/Common/Geometries.con`
(e.g. `Medic_helm_ger` → `Medichelm_ger_m1` → `standardMesh/Medichelm_ger_m1.sm`,
18,690 B). The two that dangle are `BackPack` and `HipPack`, both from the dead
`BaseKit`, so **all 43 live geometries resolve**. The one declared-and-unusable
`KitPart` worth noting is `GB_Medic_hippack` → `brit_Medic_hippack`, which has no
mesh and is never used — the British twin of the Canadian `Medic_helm_brit`
anomaly `kits.md` already documents.

Total worn-mesh payload is small: the 43 live `.sm` sum to roughly 0.9 MB
uncompressed before textures.

**Current state.** `viewer/models/` contains **zero** kit glbs (`ls viewer/models
| grep -ci '^kit'` → 0; no `*helm*`, `*bacpac*`, `*hippack*`, `*Radio*` entry).
`USSoldier.report.json` `partTree` is exactly four parts —
`USSoldierComplexHead1`, `USSoldier3PBody`, `USSoldierRightHand`,
`USSoldierLeftHand` — and `models.json` carries 8 `category: "soldier"` rows with
`kitClasses: []` on every one. The viewer never mentions bone `A`, `backpack` or
`HipPack` anywhere (audited across `map.html`, `index.html`, `poses.html`,
`flight.js`, `gunfire.js` — zero hits; the only bone name referenced in the whole
viewer is the `Bip01 R Hand` regex at `viewer/poses.html:429`).

**Size.** **M.** `bf42/con.py` gains `bone_name` (one field, §1.4); a new
`bf42/kit.py` resolves `Kit` → `KitPart` → geometry; `extract_kits.py` emits 43
small glbs + `kits.json`; `poses.html` (or a new `kits.html`) grafts them at the
named joint. `extract_pose.py:428` already welds a weapon to `Bip01 R Hand`, so
the runtime operation is prior art at a different joint.

**Impact.** **Highest in this report.** It is the single most visible parity
defect: a medic is currently indistinguishable from a rifleman, a scout has no
radio and no netted helmet, and the Afrika Korps is indistinguishable from the
Wehrmacht. Viewer-scope.

---

### GAP 1.2 — `kits.md`'s liveness filter would delete five kits that a vanilla level does bind

**Gap.** `kits.md` states no vanilla level binds a Canadian kit and puts vanilla
at 35 browsable kits. Measured, **40 of 45 are bound**, and all five Canadian
kits are among them — bound by `Liberation_of_Caen`. Building the prescribed
`game.setKit` liveness filter on that premise would silently drop a live nation.

**Ground truth.** Sweep of all 57 vanilla level archives:

```bash
python3 - <<'EOF'
import re, collections
from pathlib import Path; from bf42.rfa import RfaArchive
L=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/bf1942/levels'
kits=collections.Counter(); where=collections.defaultdict(set)
for p in sorted(L.glob('*.rfa')):
    a=RfaArchive(p)
    for n in a.entries:
        if not n.lower().endswith('.con'): continue
        t=a.read(n).decode('latin-1')
        for m in re.finditer(r'(?im)^\s*game\.setKit\s+(\d+)\s+(\d+)\s+(\S+)', t):
            kits[m.group(3).lower()]+=1; where[m.group(3).lower()].add(p.stem)
print(len(kits), 'distinct kits bound');  print(sorted(k for k in kits if 'canadian' in k))
print({k: sorted(where[k]) for k in kits if 'canadian' in k})
EOF
```

→ **415 `game.setKit` lines, 40 distinct kits (case-folded)**. The only five
never bound are `BritKit` / `GerKit` / `JapKit` / `RussKit` / `USKit`, i.e.
exactly the dead `BaseKit` set `kits.md` correctly identifies. All five
`Canadian_*` kits appear once each, in `Liberation_of_Caen`.

`bf1942/Levels/Liberation_of_Caen/Init.con`:

```con
game.setTeamSkin 2 CanadianSoldier
game.setKit 2 0 Canadian_Scout
game.setKit 2 1 Canadian_Assault
game.setKit 2 2 Canadian_AT
game.setKit 2 3 Canadian_Medic
game.setKit 2 4 Canadian_Engineer
game.setTeamSkin 2 BritishSoldier
game.setKit 2 0 GB_Scout
game.setKit 2 1 GB_Assault
game.setKit 2 2 GB_AT
game.setKit 2 3 GB_Medic
game.setKit 2 4 GB_Engineer
```

This single block refutes two `kits.md` claims at once:

1. **The Canadian kits are textually bound.** A `game.setKit` liveness filter —
   the exact test `kits.md` prescribes — returns 40, not 35, and *keeps* the five
   Canadians the doc expects it to remove. The doc's stated proof target
   ("removes 10 dead vanilla kits") is unreachable with this rule.
2. **A level can bind two skins to one team.** `game.setTeamSkin 2` is issued
   twice. Last-write-wins, so at runtime team 2 is British and the Canadians are
   effectively dead — but *the data does not say that*, and any extractor that
   assumes one skin per team will mis-attribute five kits. The rule that actually
   holds is **last binding per (team, slot) wins**, not "one binding exists".

Corroboration: `game.setTeamSkin` counts across vanilla are `GermanSoldier` 18,
`USSoldier` 15, `BritishSoldier` 12, `JapaneseSoldier` 12, `GermanDesertSoldier`
11, `RussianSoldier` 8, `USMarineSoldier` 6, `CanadianSoldier` **1**.

**Current state.** Nothing consumes `game.setKit` for kits today; `bf42/roster.py`
derives kit facets from folder paths only (`roster.py:78`). So this is a
pre-emptive correction to an unbuilt design rather than a live bug.

**Size.** **S.** Change the liveness rule to "last `setKit` per (level, team,
slot) wins, evaluated in file order" and re-measure. Decide explicitly whether
Canada is browsable (recommend yes — it has its own soldier, its own helmet
`Can_helmet_M1`, and its own `JohnsonLMG` assault kit found nowhere else).

**Impact.** **High** — it is a correctness precondition for GAP 1.1, and it is
cheap. Viewer-scope.

---

### GAP 1.3 — `Soldier/Common/Geometries.con` and the three bones (verification, no gap)

Reproduced with the project's own parser:

```bash
python3 -c "
from pathlib import Path; from bf42.rfa import RfaArchive; from bf42.ske import parse
A=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
a=RfaArchive(A/'animations.rfa')
for f in ['animations/UsSoldier.ske','animations/JapSoldier.ske']:
    sk=parse(a.read(f)); print(f, len(sk.bones))
    for i,b in enumerate(sk.bones):
        if b.name.lower() in ('a','backpack','hippack') or 'Head' in b.name:
            print('  ',i,'parent',b.parent,repr(b.name))"
```

```
animations/UsSoldier.ske 67
   16 parent 15 'Bip01 Head'
   17 parent 16 'A'
   65 parent 13 'backpack'
   66 parent 11 'HipPack'
animations/JapSoldier.ske 60      <- no A / backpack / HipPack
```

All 8 vanilla `BFSoldier`s declare `createSkeleton animations/UsSoldier.ske`
(`grep -A2 "create BFSoldier" /tmp/vanilla_objects_dump.txt | grep -i createskeleton`
→ 8 hits, spelling varies only in case). `kits.md` is correct on every point here.

---

### GAP 1.4 — `con.py` has no `setBoneName`; `roster.py`'s kit regex misses the Afrika Korps

**Gap.** The parser cannot see the appearance channel, and the roster's kit-source
regex silently drops the desert kits that `GermanDesertSoldier` actually wears.

**Ground truth.**
`grep -ric "setBoneName" bf42/ *.py` → **0**. The only bone binding `con.py`
understands is `bindToSkeletonPart` (`ChildRef.skeleton_part`, the weapon path).

`bf42/roster.py:78`:
```python
KIT_SOURCE = re.compile(r"objects/items/(\w+?)kit/(\w+)/objects\.con$")
```
The nation segment must *end* in `kit`, and exactly two path segments are
required. Tested:

| path | matches |
|---|---|
| `objects/items/britkit/antitank/objects.con` | True |
| `objects/items/usmarinekit/medic/objects.con` | True |
| `objects/items/canadiankit/medic/objects.con` | True |
| `objects/items/gerkitdesert/scout/objects.con` | **False** |
| `objects/items/basekit/objects.con` | **False** |

`GerKitdesert/` holds 5 kits — `German_AT_Desert`, `German_Assault_Desert`,
`German_Engineer_Desert`, `German_Medic_Desert`, `German_Scout_Desert` — bound
**50 times** across 10 vanilla levels (El Alamein, Gazala, Tobruk, Battleaxe,
Kasserine Pass …). Theatre is already a first-class facet in the manifest, so
these are exactly the rows the facet needs.

**Current state.** `bf42/roster.py:78`; `bf42/con.py` (no `setBoneName` branch —
the property block runs `con.py:595-700`).

**Size.** **S.** One regex (allow a theatre suffix and an optional unit segment),
one `ObjectTemplate` field accepting an optionally-quoted argument.

**Impact.** **Medium** — blocks GAP 1.1 and fixes a live facet defect. Viewer-scope.

---

### GAP 1.5 — Two of three faces per nation are never extracted

**Gap.** Every soldier declares three head variants; the extractor always picks
variant 1, so 10 of 15 vanilla face meshes and their textures never ship.

**Ground truth.** `Objects/Soldiers/USSoldier/Objects.con`:

```con
ObjectTemplate.addTemplate USSoldierComplexHead
ObjectTemplate.setRandomGeometries 3
ObjectTemplate.bindToSkeletonPart Bip01_Spine3 3
...
ObjectTemplate.create AnimatedBundle USSoldierComplexHead1
ObjectTemplate.geometry Soldier/USComplexHead1
ObjectTemplate.create AnimatedBundle USSoldierComplexHead2
ObjectTemplate.create AnimatedBundle USSoldierComplexHead3
```

All 8 soldiers carry `setRandomGeometries 3` on their complex head
(`grep -B1 -A1 setRandomGeometries /tmp/vanilla_objects_dump.txt`). 15 face
textures exist — `texture/face_{ame,bri,ger,jap,rus}{1,2,3}_h.dds`, 43,832 B each.

**Current state.** `bf42/con.py:224-241` `instance_template_name()` —
`if ref.random_geometries: return f"{ref.template}1"`. Always index 1.
`USSoldier.report.json` `partTree` confirms only `USSoldierComplexHead1`.

**Size.** **S** to expose (emit all N as sibling nodes with a `headVariant` extra,
or a `--head N` flag); **S** in the viewer (a cycle control).

**Impact.** **Low–Medium.** Cosmetic, but it is the cheapest way to make a squad
of soldiers not look like clones — which matters the moment GAP 6.1 lands.
Viewer-scope.

---

### GAP 1.6 — First-person body and hands exist as separate meshes and are deliberately dropped

**Gap.** Every soldier declares a 1P body and 1P left/right hands. The extractor
filters them out by design, so no viewmodel asset exists for a future on-foot mode.

**Ground truth.** `Objects/Soldiers/USSoldier/Objects.con`:

```con
ObjectTemplate.addTemplate USSoldier1PBody
ObjectTemplate.setIsFirstPersonPart 1
ObjectTemplate.addTemplate 1pUSSoldierRightHand
ObjectTemplate.setIsFirstPersonPart 1
ObjectTemplate.addTemplate 1pUSSoldierLeftHand
ObjectTemplate.setIsFirstPersonPart 1
```

16 first-person soldier meshes ship in `standardMesh.rfa`:
`1PUsBody.sm` (45,436 B), `1pUsLeftHand.sm`, `1pUsRightHand.sm`,
`1pBritBody/LeftHand/RightHand`, `1pGerBody/LeftHand/RightHand`,
`1PDesGerBody.sm`, `1pJapBody/…`, `1pRussBody/…`. Hand textures
`Hand01_r.dds` / `Hand02_r.dds` / `Hand03_r.dds` / `HandGB1_z.dds` (87,536 B each).

The `1p` animation set is equally complete: `1pStand`, `1pStandAim`, `1pRun`,
`1pCrawl`, `1pIdle1/2/3`, `1pDeploy`, `1pFire`, `1pFireEnd`, `1pReload`,
`1pLieAim`, `1pLieFire`, `1pLieReload`, `1pEjectClip`, `1pPickup` —
roughly 300 of the 1,154 clips (§3.4).

**Current state.** Filtered at `bf42/assemble.py:41` `geometry_is_first_person()`
and `extract_pose.py:93` / `extract_pose.py:159`;
`bf42/con.py:235` returns `None` for any child with `first_person_part not in
(None, 0)`. `extract_models.py:404` exports a `.cockpit.glb` only when
`reaches_first_person(library, name)` and only for **vehicles** — no soldier
gets one.

**Size.** **S** to extract (`extract_pose.py --first-person` reusing the cockpit
path); **L** to use (needs GAP 3.1).

**Impact.** **Low today, blocking later.** Documented so the choice is informed.
Viewer-scope.

---

### GAP 1.7 — The parachute is a soldier part, not a kit part, and is not extracted

**Gap.** The parachute is a skinned `AnimatedMesh` declared by every soldier and
has never been exported.

**Ground truth.** `Objects/Soldiers/Common/CommonSoldierData.inc`:

```con
ObjectTemplate.setParachuteDrag 24.00
ObjectTemplate.setParachuteSpeed 30.00
ObjectTemplate.addTemplate Parachute
ObjectTemplate.setPosition 0/0.3/0
```

`Objects/Soldiers/Common/Parachute/Objects.con` / `Geometries.con`:
```con
ObjectTemplate.create AnimatedBundle Parachute
ObjectTemplate.createSkeleton animations/Parachute.ske
GeometryTemplate.create AnimatedMesh Parachute
GeometryTemplate.setSkin animations/Parachute.skn
GeometryTemplate.file Parachute_m1
GeometryTemplate.setLodRange 0 0 1 500 2 1000
```

Ten parachute clips exist: `3PParachuteJump/Open/Fall/Glide/Ground/Splat/Die/
GlideDie/GroundDie` × Lower+Upper, plus `ParachuteIdle` and `ParachuteOpen`.
Spawn points can request one — `ObjectTemplate.setSpawnAsParaTroper` appears in
level `SoldierSpawnTemplates.con`.

**Current state.** Not in `models.json` (94 rows, none named Parachute), not in
any pose file. The extractor only walks the soldier's non-first-person mesh
children; `Parachute` is an `AnimatedBundle` with its own skeleton and is not
reached — nothing errors, it simply never appears.

**Size.** **S.** One more armoury row via the existing `AnimatedMesh`/`.skn` path
(`bf42/skin.py` already handles skinned meshes; `Parachute.ske` is one of the 64
`.ske` files).

**Impact.** **Medium.** It is a named, recognisable, fully-rigged asset with ten
animation clips and zero coverage — the largest single missing soldier mesh.
Viewer-scope.

---

### GAP 1.8 — No winter/pacific uniform variants exist in vanilla (non-gap, recorded)

Searched `texture.rfa` + `texture_001.rfa` for `winter` / `snow` → **zero hits**.
Vanilla ships exactly two theatre bodies (`GermanSoldier`, `GermanDesertSoldier`)
and both are already extracted. Pacific is handled by `USMarineSoldier` +
`JapaneseSoldier`, also extracted. **There is no vanilla winter uniform gap.**
Winter kits are an FH/FHSW/FinnWars concern (`kits.md` appendix) and out of scope.

Likewise **no rank or insignia textures** exist as separate assets — rank is
baked into the body texture. `menu/Texture/Menu/serverinfo/menu_icon_ranking_16x16.dds`
is a scoreboard icon, not a uniform decal. Recorded so nobody hunts for them.

---

### GAP 1.9 — The 16 kit pickup meshes are not extracted

**Gap.** Every live kit declares a ground-pickup mesh; none is exported, so there
is no thumbnail for a future kit browser and no "dropped kit" prop for a level scene.

**Ground truth.** `ObjectTemplate.geometry` on the `Kit` itself, e.g.
`Kit_Allies_Medic`, `Kit_Axis_Scout`, `Kit_Canadian_Assault`,
`Kit_USMarine_Engineer`. 16 meshes in `standardMesh.rfa` /
`StandardMesh_001.rfa`: `Kit_Allies{AntiTank,Assault,Engineer,Medic,Scout}_m1`,
`Kit_Axis{…}_m1`, `Kit_CanAssault_M1`, `Kit_JapaneseAssault_m1`,
`Kit_JapEngineer_m1`, `Kit_RussianAssault_m1`, `Kit_USEngineer_m1`,
`kit_allied_grenade.sm`. Sizes 31–68 KB.

**Current state.** Absent from `models.json` and from `viewer/models/`.

**Size.** **S.** Ordinary `StandardMesh` extraction — no new machinery.

**Impact.** **Medium** — it is the natural card image for a kit browser and
`kits.md` already nominates it. Viewer-scope.

---

## 2. Hand weapons

### 2.1 Catalogue coverage

28 `HandFireArms` templates exist in vanilla:

```bash
grep -i "ObjectTemplate.create HandFireArms" /tmp/vanilla_objects_dump.txt | wc -l   # 28
```

| category | templates | in `models.json` | posed | fires |
|---|---|---|---|---|
| rifle | `K98`, `No4`, `M1Garand`, `Type5` | 4/4 | 4/4 | 0 |
| **sniper** | **`K98Sniper`, `No4Sniper`** | **0/2** | 2/2 | 0 |
| SMG | `Thompson`, `Mp40`, `Mp18` | 3/3 | 3/3 | 0 |
| LMG / auto | `Bar1918`, `DP`, `JohnsonLMG`, `Sg44`, `Type99` | 5/5 | 5/5 | 0 |
| pistol | `Colt`, `WalterP38` | 2/2 | 2/2 | 0 |
| AT | `Bazooka`, `Panzershreck` | 2/2 | 2/2 | 0 |
| grenade | `GrenadeAllies`, `GrenadeAxis` | 2/2 | 2/2 | 0 |
| explosive | `ExpPack`, `Landmine`, `Detonator` | 3/3 | 3/3 | 0 |
| knife | `KnifeAllies`, `KnifeAxis` | 2/2 | 2/2 | 0 |
| tool | `MedPack`, `RepairPack`, `Binoculars` | 3/3 | 3/3 | 0 |
| **total** | **28** | **26** | **28** | **0** |

(`models.json` has a 27th `handweapon` row, `riflebulletclip_m1`, which is a
`SimpleObject` prop, not a `HandFireArms`.)

### GAP 2.1 — The two sniper rifles are missing from the armoury

**Gap.** `K98Sniper` and `No4Sniper` are the only two scoped weapons in the game
and the primary weapon of all eight Scout kits, and neither has a `models.json`
row — although both *are* posed.

**Ground truth.** Both are declared inside their parent's folder, which is why a
per-folder walk misses them:

```
Objects/HandWeapons/K98/Objects.con   -> HandFireArms K98,  HandFireArms K98Sniper
Objects/HandWeapons/No4/Objects.con   -> HandFireArms No4,  HandFireArms No4Sniper
```

Each has its own full render bundle — `K98SniperSimple` / `K98SniperComplex` /
`K98SniperLod`, likewise `No4Sniper*` — plus a dedicated scope child
(`SimpleObject K98Scope`, `SimpleObject No4Scope`) whose meshes ship separately:
`standardMesh/K98_Scope_m1.sm` (46,918 B), `standardMesh/NO4_Scope_m1.sm`
(46,918 B), with shadow twins `Shad_K98_Scope_m1.sm` / `Shad_No4_Scope_m1.sm`.

Every vanilla Scout kit carries one (`US_Scout`, `GB_Scout`, `Rus_Scout`,
`Canadian_Scout`, `USMarine_Scout` → `No4Sniper`; `German_Scout`,
`German_Scout_Desert`, `Jap_Scout` → `K98Sniper`).

**Current state.** `viewer/models/models.json` — 26 `HandFireArms` rows, neither
sniper present. But `viewer/models/poses/*__K98Sniper.pose.glb` and
`*__No4Sniper.pose.glb` **do** exist for all 8 soldiers, and
`USSoldier__K98Sniper.pose.report.json` reports `weaponParts: 5` against the plain
`K98`'s 4 — the scope geometry is in there. So the mesh pipeline handles them
fine; only the armoury enumeration misses them.

**Size.** **S.** Whatever enumerates `Objects/HandWeapons/*/` for `models.json`
must enumerate `HandFireArms` *templates*, not folders.

**Impact.** **High.** Two weapons, eight kits, and the only scoped optic in the
game are invisible in the armoury while their geometry already extracts cleanly.
Viewer-scope.

---

### GAP 2.2 — Every weapon behaviour field in the `.con` is unparsed

**Gap.** `con.py` reads 5 of ~30 ballistics/handling properties. Magazine
capacity, reload time, zoom, scope, deviation and recoil are all present in the
data and all discarded.

**Ground truth.** A single template, `Objects/HandWeapons/No4/Objects.con`:

```con
ObjectTemplate.magSize 5
ObjectTemplate.numOfMag 5
ObjectTemplate.reloadtime 1.6
ObjectTemplate.roundOfFire 0.37
ObjectTemplate.fireOnce 1
ObjectTemplate.zoomFov 0.4
ObjectTemplate.soldierZoomFov 0.6
ObjectTemplate.soldierZoomPosition -0.07/0/0
ObjectTemplate.soldierCameraPosition -0.02/-0.03/0.01
ObjectTemplate.velocity 1000
ObjectTemplate.setRecoilForceUp        CRD_UNIFORM/1.2/1.2/0
ObjectTemplate.setRecoilForceLeftRight CRD_UNIFORM/-0.1/-0.3/0
ObjectTemplate.setHasRecoilForce 1
ObjectTemplate.setGoBackOnRecoil 1
ObjectTemplate.setFireDev  0 0 0
ObjectTemplate.setDevMod   1 0.7 0.5
ObjectTemplate.setMinDev   0.25
ObjectTemplate.setTurnDev  0 0 0 0
ObjectTemplate.setSpeedDev 1.5 0.4 0.4 0.1
ObjectTemplate.setMiscDev  2.5 2.5 0.1
ObjectTemplate.setHudAmmoType ATAmmoBar
ObjectTemplate.setAmmoBar "Ingame/Magbar_Rifle_empty_32x64.tga"
ObjectTemplate.setCrossHairType CHTIcon
ObjectTemplate.addTemplate e_MuzzGun
ObjectTemplate.setPosition 0/0.045/0.745     <- muzzle offset, metres
ObjectTemplate.addTemplate e_Shell792D
ObjectTemplate.setPosition 0/0.03/0.39       <- shell ejection port
```

and the sniper adds the scope channel:

```con
ObjectTemplate.zoomFov 0.1
ObjectTemplate.unZoomBetweenFireTime 3.0
ObjectTemplate.useScope 1
ObjectTemplate.setSniperSight 1
ObjectTemplate.setScopeIcon "sniper.tga"
ObjectTemplate.setCrossHairType CHTNone
ObjectTemplate.velocity 2000        <- vs the plain K98's 1000
```

Measured coverage — `grep -ric <key> bf42/ *.py`:

| parsed (5) | value |
|---|---|
| `magSize` | `con.py:656` |
| `roundOfFire`, `velocity`, `recoilSize`, `recoilSpeed`, `tracerScaler` | `con.py:643-655` |
| `projectileTemplate`, `projectilePosition` | `con.py:605-620` |

| **unparsed (0 hits each)** |
|---|
| `numOfMag`, `magType`, `autoReload`, `allowReloadOnEmptyClipOnly`, `ejectClipTime` |
| `zoomFov`, `soldierZoomFov`, `soldierZoomPosition`, `soldierCameraPosition`, `useScope`, `setSniperSight`, `setScopeIcon`, `unZoomBetweenFireTime` |
| `setMinDev`, `setFireDev`, `setDevMod`, `setTurnDev`, `setSpeedDev`, `setMiscDev`, `minDeviation`, `maxDeviation`, `addDevRun/Walk/Jump/Crouch/…`, `subDev*` |
| `setRecoilForceUp`, `setRecoilForceLeftRight`, `setHasRecoilForce`, `setGoBackOnRecoil` |
| `setCrossHairType`, `setHudAmmoType`, `setAmmoBar`, `setAmmoIcon`, `aiTemplate` |
| `throwSpeed`/`rotationalSpeed`/`heatAddWhenFire`/`velocityDependentOnHeat` (grenades), `hitpoints`/`material`/`hasArmor` (ExpPack, Landmine) |

Note `reloadtime` gets 2 grep hits but no assignment — it is not in any `elif cmd`
branch of `con.py:595-700`.

Selected values worth having, all measured from the dump:

| weapon | mag × mags | reload s | rps | muzzle m/s | zoomFov | scope |
|---|---|---|---|---|---|---|
| `No4` | 5 × 5 | 1.6 | 0.37 | 1000 | 0.4 | — |
| `No4Sniper` | 5 × 3 | 1.6 | 0.30 | 1000 | **0.1** | **yes** |
| `K98` | 5 × 5 | 1.6 | 0.37 | 1000 | 0.4 | — |
| `K98Sniper` | 5 × 3 | 1.6 | 0.30 | **2000** | **0.1** | **yes** |
| `M1Garand` | 8 × 4 | 4.0 | 3.2 | 1000 | 0.6 | — |
| `Thompson` | 30 × 5 | 4.8 | 10 | 1000 | 0.5 | — |
| `Mp40` | 32 × 5 | 4.3 | 9 | 1000 | 0.6 | — |
| `Sg44` | 30 × 5 | 3.8 | 9 | 1000 | 0.5 | — |
| `Type99` | 20 × 6 | 4.0 | 8 | 1000 | 0.6 | — |
| `Type5` | 10 × 3 | 5.0 | 3.2 | 1000 | 0.6 | — |
| `Panzershreck` | 1 × 6 | 5.6 | 1 | **50** | 0.5 | — |
| `Bar1918` | 20 × 6 | 4.0 | 8 | 1000 | 0.5 | — |
| `DP` | 47 × 3 | 3.6 | 9 | 1000 | 0.6 | — |
| `JohnsonLMG` | 30 × 5 | 5.4 | 7.5 | 1000 | 0.5 | — |
| `Mp18` | 32 × 5 | 4.3 | 9 | 1000 | 0.6 | — |
| `Colt` | 8 × 4 | 4.0 | 6 | 400 | 0.7 | — |
| `Bazooka` | 1 × 6 | 5.6 | 1 | **50** | 0.5 | — |
| `GrenadeAllies` / `Axis` | 3 × 1 | 2.0 | 1 | 25 | — | — |
| `ExpPack` | 4 × 1 | 1.0 | 1 | 6 | — | — |
| `Landmine` | 4 × 1 | 1.0 | 1 | 3 | — | — |
| `MedPack` | 1800 × 1 (`magType 1` = heat bar) | 1.5 | 10 | — | — | — |
| `Binoculars` | −1 × 1 (`magType 2`) | — | — | — | **0.2** | **yes** (`binocular.tga`) |
| `KnifeAllies` / `Axis` | −1 × 4 | 1.0 | 2 | 50 | — | — |

**Current state.** `bf42/con.py:595-700`. The viewer surfaces the little that is
parsed as a display string only — `viewer/index.html:2741` renders
`` `mag ${stats.magSize}` ``.

**Size.** **S** to parse and publish into `models.json` (a `stats` block per
weapon); **M** to *use* any of it (see GAP 2.3).

**Impact.** **High for a catalogue, low for a renderer.** This is the data that
would make the armoury a reference rather than a mesh browser, and it is pure
parsing. Viewer-scope.

---

### GAP 2.3 — No hand weapon can be fired anywhere in the viewer

**Gap.** `gunfire.js` is complete and wired to vehicles in both `map.html` and
`index.html`, but **no hand weapon has a muzzle node**, and `poses.html` never
imports `GunFire`. Zero of 28 hand weapons can fire.

**Ground truth.** The muzzle *position* is authored — it is the `setPosition` on
the weapon's `e_Muzz*` child (`No4` → `0/0.045/0.745`; `K98` → `0/0.05/0.84`;
`Colt` → `0/0.001/0.14`; `Bar1918` → `0/0.06/0.675`; `DP` → `0/0.03/0.70`;
`JohnsonLMG` → `0/0.03/0.675`). Shell ejection ports are authored the same way
(`e_Shell792D`, `e_Shell9mm`, `e_shellM1Garand`).

**Current state.**
- Every handweapon report has `fireArms: []` — checked `K98`, `Thompson`,
  `Bazooka`, `GrenadeAllies`, `Binoculars`, `MedPack`. By contrast
  `Sherman.report.json` reports three armed groups with muzzle counts, rps,
  velocity and tracer interval.
- `viewer/gunfire.js` finds barrels via mesh-less `muzzle` nodes stamped by the
  extractor (`gunfire.js:173-320`, `gunfire.js:406-419`). With `fireArms: []`
  there is nothing to find.
- `viewer/poses.html` — grep for `gunfire` / `GunFire` / `guns.` → **zero hits**.
  Soldier weapons are static props.
- `gunfire.js` also has no deviation (`gunfire.js:412` fires exactly along the
  authored muzzle direction), no magazine, no reload, no hit detection and no
  impact effect — see §4.

**Size.** **M.** (a) extract `e_Muzz*` child offsets into `fireArms` for
`HandFireArms` the same way vehicles already get them; (b) import `GunFire` into
`poses.html`; (c) optionally drive recoil from the parsed `setRecoilForceUp` and
spread from `setMinDev`/`setSpeedDev` once GAP 2.2 lands.

**Impact.** **Medium-High.** `poses.html` exists to judge whether the grip looks
right; a muzzle flash at the authored point is the strongest possible evidence
that it does. Viewer-scope.

---

### GAP 2.4 — No scoped view, and the scope overlay art is never extracted

**Gap.** `useScope` / `setSniperSight` / `setScopeIcon` are unparsed, and the
full-screen scope textures the engine names are not exported.

**Ground truth.** `setScopeIcon "sniper.tga"` (both snipers) and
`"binocular.tga"` (`Binoculars`) resolve to:

| asset | archive | bytes |
|---|---|---|
| `menu/Texture/sniper.tga` | `menu.rfa` | 262,188 |
| `menu/Texture/binocular.tga` | `menu.rfa` | 262,188 |
| `texture/scope_Rifle.dds` | `texture.rfa` | 22,000 |
| `menu/Texture/Weapon/icon_no4_scope.dds` | `menu.rfa` | 4,224 |
| `menu/Texture/Weapon/icon_m98_scope.dds` | `menu.rfa` | 4,224 |
| `menu/Texture/Weapon/icon_binoculars.dds` | `menu.rfa` | 4,224 |

Plus the 14 magazine-bar HUD textures named by `setAmmoBar` —
`menu/Texture/Ingame/magbar_{rifle,smg,pistol,bar,sg44}_{empty,full}_32x64.dds`
and `ammobar_{empty,full}_32x64.dds` — and 23 per-nation soldier stance icons
(`menu/Texture/Soldier/icon_{us,brit,ger,jap,rus,can,us_marine}_soldier_{standing,crouching,lying}.dds`).

**Current state.** Nothing reads `menu.rfa` in the model pipeline (the
`bf1942-map-images` skill reads it for map thumbnails only). No scope overlay in
`index.html` or `poses.html`; `zoomFov` is unparsed (§2.2).

**Size.** **S** to extract the art; **S** to add a "scoped view" toggle in
`poses.html` (set the camera FOV to `zoomFov` and overlay the tga).

**Impact.** **Medium.** It is the one hand-weapon behaviour that is *visual*
rather than numeric, so it belongs in a viewer more than magazine counts do.
Viewer-scope.

---

### GAP 2.5 — Weapon-specific mechanisms with no representation

Recorded compactly; all share one root cause (§2.2) and one consumer gap (§2.3).

| mechanism | ground truth | state |
|---|---|---|
| **bolt cycling** | `fireOnce 1` + `roundOfFire 0.37`; clips `3PDeploy<W>` / `1pDeploy<W>` (19 + 19) are the bolt-work animations | neither parsed nor played |
| **reload** | `reloadtime`, plus 10 `1pReload<W>`, 10 `1pLieReload<W>`, 8 `3PReload<W>`, 8 `3PReloadLie<W>`, and per-weapon `K98Reload`, `No4Reload`, `M1GarandReload`, `Mp40Reload`, `SG44Reload`, `Type99Reload`, `BazookaReload`, `PanzershreckReload`, `DPReload`, `ThompsonReload`, `Bar1918Reload`, `ColtReload`, `WalterP38Reload`, `JohnsonLMGReload`, `MP18Reload`, `Type5reload` | zero; `grep -ri reload viewer/*.html viewer/*.js` finds only a browser-reload comment at `index.html:4769` |
| **Garand ping / clip eject** | `M1Garand`: `ejectClipTime`, `allowReloadOnEmptyClipOnly`, child `M1GarandClip`; clips `M1GarandEjectClip`, `1PEjectClip`, `ThompsonEjectClip`; prop mesh `riflebulletclip_m1` already in `models.json` | unparsed, unplayed |
| **out of ammo** | clips `Bar1918OutOfAmmo`, `ColtOutOfAmmo`, `MP18OutOfAmmo`, `MP40OutOfAmmo`, `ThompsonOutOfAmmo`, `WlaterP38OutOfAmmo` | no ammo state exists |
| **deviation / recoil** | 6 deviation commands + 4 recoil commands per weapon (§2.2) | unparsed; `gunfire.js` has no spread at all |
| **projectile spawn point** | `projectilePosition` (parsed) + the `e_Muzz*` child offset (not extracted for hand weapons) | GAP 2.3 |
| **throwing arc** | `GrenadeAllies`: `velocity 25`, `rotationalSpeed`, `heatAddWhenFire`, `velocityDependentOnHeat`, `setHudAmmoType ATIconAndStrengthBar` (the cook-and-throw power bar); clips `GrenadeAlliesDeploy/Fire/FireReset/Idle1/Run/Stand` | unparsed. `gunfire.js:656` applies `GRAVITY = 9.81` to projectiles already, so the arc is nearly free once a grenade can be thrown |
| **remote detonation** | `Detonator` (`magSize -1`, `numOfMag -1`, `DetonatorFire` clip) paired with `ExpPack` (`ExpPackProjectile`, `hitpoints`, `material`, `hasArmor` — the pack is a shootable object) | neither modelled |
| **mines** | `Landmine` `velocity 3`, `LandmineProjectile`, `projectileVisible`; soldier `disarmMinesDistance 2.0` | unparsed |
| **medkit / repair wrench** | `MedPack` `magSize 1800`, `magType 1` (heat bar), `roundOfFire 10`; soldier `healDistance 10.0`, `healFactor 0.25`, `selfHealFactor 0.15`, `repairDistance 2.0`, `repairFactor 0.15` | unparsed |
| **binocular spotting** | `Binoculars` has **two** projectiles (`BinocularsProjectile`, `projectile2Template BinocularsProjectile2`) and `projectilePosition 0/0/2` | unparsed |
| **knife** | `fireOnce c_True`, `KnifeProjectile`, `velocity 50`; five swing variants each side (`1pFireKnifeAllies{A..E}`, `3PFireKnifeAlliesA/B`) | unparsed |

**Size.** **M** overall (one parsing pass, one `stats` block, one viewer panel).
**Impact.** **Medium** as catalogue data; **Low** as simulation. Viewer-scope for
the data, game-scope for actually ticking any of it.

---

## 3. First-person / on-foot

### GAP 3.1 — There is no walkable mode; `map.html` is free-fly plus a flyable plane

**Gap.** `map.html` has exactly two control modes and neither has gravity, ground
contact or a body.

**Ground truth (what a walk mode needs).**
`Objects/Soldiers/Common/CommonSoldierData.inc` — the entire infantry physics
block, all of it already in an archive the pipeline reads:

```con
ObjectTemplate.setPoseCameraPos c_BfSoldierStanding  0/0.65/0
ObjectTemplate.setPoseCameraPos c_BfSoldierCrouching 0/0.12/0
ObjectTemplate.setPoseCameraPos c_BfSoldierLying     0/-0.7/0
ObjectTemplate.setCharacterHeight -1.00
ObjectTemplate.set1pFov 0.47
ObjectTemplate.setTurnLeftRightAngle 20.0 14.0
ObjectTemplate.setPointUpDownAngle   38.0 38.0
ObjectTemplate.setLiePointUpDownAngle 0.0 -6.0
ObjectTemplate.HitPoints 30
ObjectTemplate.MaxHitPoints 30
ObjectTemplate.mass 100
ObjectTemplate.drag 1.0
ObjectTemplate.SpeedMod 0.5
ObjectTemplate.hasMobilePhysics 1
ObjectTemplate.hasCollisionPhysics 1
ObjectTemplate.geometry BodyCollision
ObjectTemplate.setSkeletonCollisionBone Bip01_Head       0.02  2   40
ObjectTemplate.setSkeletonCollisionBone Bip01_Spine2     0.08 -0.45 41
ObjectTemplate.setSkeletonCollisionBone Bip01_L_Forearm  0.02  0.0 42
ObjectTemplate.setSkeletonCollisionBone Bip01_R_Forearm  0.02  0.0 42
ObjectTemplate.setSkeletonCollisionBone Bip01_L_Calf     0.03  0.3 42
ObjectTemplate.setSkeletonCollisionBone Bip01_R_Calf     0.03  0.3 42
ObjectTemplate.setSkeletonCollisionBone Bip01_L_Foot     0.035 0  42
ObjectTemplate.setSkeletonCollisionBone Bip01_R_Foot     0.035 0  42
```

Movement speed is in `Objects/Soldiers/Common/AI/Objects.con`:
`aiTemplatePlugIn.maxSpeed 5.0`, `turnRadius 0.1`, `coverSearchRadius 20.0`.

Camera: `ObjectTemplate.create Camera SoldierCamera` with `CVMInside 1` and every
other view mode 0 (`Objects/Soldiers/Common/Objects.con`) — i.e. the soldier is
first-person only, which `viewer/flight.js:781-783` already documents in a comment.

**Exists already, could be reused:**

| need | status |
|---|---|
| terrain height query | **PRESENT** — `viewer/map.html:1934-1941` `groundHeight(x,z)` raycasts the baked terrain; already used by `Aircraft` (`map.html:1961`) and `VehicleCamera` (`map.html:1968`). `fly()` at `map.html:520-532` simply never calls it. One line. |
| gravity integration | **PRESENT in the aircraft path** — `flight.js:520` `gravity: 9.81`, applied `flight.js:637`, hard floor `flight.js:652-660` |
| eye height / crouch / prone | **data exists** (above), **not extracted, not used** |
| stance poses | **PRESENT** — `poses.html:301` `STANCE_KEYS = ['stand','crouch','lie']`, blended at `poses.html:322-351` |
| viewmodel arms | **assets exist**, filtered out — GAP 1.6 |
| view bob | **ABSENT** — no clip is sampled past frame 0 (GAP 3.4) |

**Not present at all:**

| need | status |
|---|---|
| eye-height constant, crouch/prone height | **ABSENT** — grepped `eyeHeight`, `EYE_HEIGHT`, `crouch`, `prone`, `viewBob`, `headbob`, `viewmodel` across `map.html`/`flight.js`/`gunfire.js` → zero hits |
| walk/sprint controls | **ABSENT** — grepped `walk`, `footstep`, `sprint`, `stamina` → only the English word in comments |
| building collision | **ABSENT** in level scenes — GAP 3.2 |

**Current state.** `viewer/map.html:239` (the `#pilot` checkbox is the only mode
switch), `map.html:520-532` (`fly()`, unconstrained 6-DOF, no gravity, no clamp),
`map.html:287-291` (`FLY_KEYS`), `flight.js:1035-1050` (vehicle discovery).
`viewer/flight.js:652-653` states in a comment that building collision is
unimplemented.

**Size.** **M** for a credible walk (clamp `fly()` to `groundHeight()`, apply the
three `setPoseCameraPos` offsets, gate speed at `maxSpeed 5.0`, add a stance key);
**L** for one that does not walk through walls (needs GAP 3.2).

**Impact.** **High**, and the cheapest version is nearly free — the height query
already exists and is already called from two other places in the same file.
Viewer-scope.

---

### GAP 3.2 — Level scenes carry no collision geometry at all

**Gap.** `bf42/stdmesh.py` parses collision layers correctly and `assemble.py`
emits them for *model* exports, but `extract_map.py` builds every level with
`include_collision=False`. A walkable camera therefore has nothing to collide with.

**Ground truth.** Collision is embedded in `.sm`, not a separate file. Across
vanilla `standardMesh.rfa` (1,285 `.sm`, 0 parse failures): **704 meshes have 0
collision layers, 415 have 1, 166 have 2 — 55,381 collision triangles in total.**

```bash
python3 -c "
from bf42.rfa import RfaArchive; from bf42 import stdmesh; import collections
a=RfaArchive('/home/dylan/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/standardMesh.rfa')
c=collections.Counter(); tot=0
for n in [x for x in a.entries if x.lower().endswith('.sm')]:
    m=stdmesh.parse(a.read(n),n); c[len(m.collision_layers)]+=1
    tot+=sum(l.triangle_count for l in m.collision_layers)
print(c, tot)"
```

Separately, `aiMeshes.rfa` (181,367 B) holds **90 `.sm` + 90 `.rs` AI proxy hulls**
— one per static world prop, named `<object>_a1` against the visible `<object>_m1`
(houses, bunkers, bridges, railroad pieces, ruins, repair pads). They parse with
the project's own `stdmesh.parse` as ordinary v9/v10 StandardMeshes. These are
deliberately simplified collision shells and would be a much cheaper collision
set than the full `.sm` collision layers. Nothing in any `.con` references the
`_a1` suffix — the binding is naming convention only (verified: zero `.con` files
in `Objects.rfa` contain the literal `_a1`).

**Current state.**
- Parser: `bf42/stdmesh.py:117-134` (dataclasses), `:211-261` (the loop),
  `:146-147` (`collision_blocks`).
- Exported for models: `extract_models.py:304` `include_collision=not first_person`;
  `bf42/assemble.py:483` `_collision_mesh_indices`, `:1458-1466` node emission.
- **Not exported for levels:** `extract_map.py:1565` `include_collision=False`.
- **Only one layer survives:** `bf42/assemble.py:492-510` iterates
  `reversed(list(enumerate(mesh.collision_layers)))` and `break`s on the first
  non-degenerate layer, so the 166 two-layer meshes lose one.
- Viewer: `map.html:1744` `isCollision(obj)` exists solely to *exclude*
  collision-tagged meshes from the wireframe toggle. No BVH, no octree, no
  physics — `grep -i "bvh\|octree\|physics"` across the viewer returns comments only.

**Size.** **L.** Exporting is **S** (flip a flag, or import `aiMeshes.rfa`); making
it usable at runtime needs a BVH or grid over tens of thousands of triangles per
level, which is the real work.

**Impact.** **Medium.** Blocks a *good* walk mode but not a first one — clamping
to terrain alone already gives a soldier's-eye tour. Viewer-scope.

---

### GAP 3.3 — The heightmap is read and then thrown away

**Gap.** `Heightmap.raw` is decoded during map extraction and only a lossy
water-depth PNG survives, so the viewer must raycast the baked terrain mesh
instead of sampling heights.

**Ground truth.** Every vanilla level archive contains
`bf1942/levels/<Map>/Heightmap.raw` at **524,288 bytes = 262,144 uint16 = 512×512**
(identical on Omaha, El Alamein, Berlin, Wake), plus `MaterialMap.raw` at 262,144 B
(the per-sample surface material, which drives footstep sounds via
`Objects/Soldiers/Common/Sounds/MaterialToSound.con`, 5,255 B).

**Current state.** Read at `extract_map.py:189-190` → `decode_heightmap` at
`bf42/level.py:980-989`; sampler `Heightmap.height_at` at `bf42/level.py:369-379`.
Consumed only by `bf42/terrain.py:29-68` (baked grid mesh) and
`bf42/terrain.py:125-147` `depth_map`, written as `water/depth.png`
(`extract_map.py:801`, `:825-826`) — which stores *metres of water above* each
sample, so everything above water is 0 and unrecoverable, and it is downscaled to
`--max-texture` on top (`extract_map.py:822-824`).

**Size.** **S.** Write a 16-bit PNG (or the raw `.r16`) beside `water/depth.png`
with `worldSize` and `yScale` in the manifest. Everything needed is already in
memory at `extract_map.py:189`.

**Impact.** **Medium.** Raycasting works but costs a ray per frame per query and
cannot answer "what is the slope here" or "what material am I standing on".
Viewer-scope.

---

### GAP 3.4 — Only frame 0 of every clip is sampled; 1,154 animations reduce to 3 static poses

**Gap.** `baf.py` decodes full multi-frame clips, and `extract_pose.py` samples a
single frame of six of them. No locomotion, no fire, no reload, no death animation
ever reaches a glb.

**Ground truth.** `animations.rfa` holds **1,154 `.baf`, 88 `.skn`, 64 `.ske`,
25 `.con`**. The third-person locomotion set is complete and weapon-specific:

| family | count |
|---|---|
| `3PRunUpper<W>` / `3PRunBackUpper<W>` / `3PWalkUpper<W>` | 20 / 20 / 21 |
| `3PRunLower`, `3PWalkLower`, `3PRunStopLower`, `3PTurnLower`, `3PCrouchTurnLeft/RightLower` | 6 |
| `3PCrouchForwardUpper<W>`, `3PCrouchBreathUpper<W>`, `3PLieForwardUpper<W>`, `3PLieBreathUpper<W>`, `3PLieTurnLeft/RightUpper<W>` | 20–21 each |
| `3PJumpStandUpper<W>`, `3PJumpRunUpper<W>`, `3PJump2LieUpper<W>`, `3PStand2Crouch*`, `3PCrouch2Lie*` | 20 each |
| `3PSwim{Forward,Backward,Floating,Start}{Lower,Upper}` | 8 |
| `3PClimbLadder*` (start / loop / idle / end / exit, Lower+Upper) | 20 |
| `3PDie*` (back, chest, head, hit, slow, crouch, lie, swim) | 26 |
| `3PHit*` (chest, back, leg, crouch, lie, stand) | 14 |
| `3PExplosion*` (bounce, flip, fly, land, get-up) | 18 |
| `3PParachute*` | 18 |
| `3PHandSign_{Come,Down,Freeze,Medic,Negative,Roger,Shout}` | 7 |
| `3PSit{Willy,Hanomag,M3A1,Kubelwagen}Pass{Lower,Upper}`, `3PGoInTankHatch*`, `3PGoInMustang{Left,Right}*`, `3PCruch2Hatch*` | 18 |
| face: `USFace*` (17), `Speak_*` (11) | 28 |
| first-person set (`1p*`) | ~300 |
| **total** | **1,154** |

**Current state.** `extract_pose.py:55-60` defines exactly three stances;
`extract_pose.py:190-191` calls `lower.local_pose(frame)` / `upper.local_pose(frame)`
with `frame` from `--frame`, default **0** (`extract_pose.py:633`). The resulting
glb carries "one constant clip per stance" (`extract_pose.py:451`), so
`poses.html:479-492` blends between three frozen poses. `bf42/baf.py:107-120`
already exposes `Animation.frames` and `local_pose(frame)` — the machinery to
bake a real clip is present and unused.

**Size.** **M.** Bake N sampled frames per clip into a glTF animation instead of
one; the joint node set and the weapon weld are already stance-independent
(`extract_pose.py:451-460`), so the weld needs no change. Start with
`3PRunUpper<W>` + `3PRunLower` (one clip, immediately legible).

**Impact.** **High.** A single looping run cycle would transform `poses.html` from
a mannequin stand into an animation viewer, and it is the prerequisite for any
soldier that moves in a level. Viewer-scope.

---

## 4. The simulation loop

**What ticks today** — `viewer/map.html:2639-2656` `frame(dt)`, `dt` capped at
0.1 s (`map.html:2658`):

| ticking | where |
|---|---|
| aircraft flight physics | `map.html:2641` → `flight.js` integrate |
| free-fly camera translation | `map.html:2643-2644` |
| tracers / projectiles / muzzle flash / recoil | `map.html:2649` → `gunfire.js:589-678` |
| distance culling | `map.html:2650` |
| flag cloth (`flagMixer`), water scroll, cloud drift | `map.html:1208-1216` |
| positional audio, engine envelopes, Doppler | `map.html:2652`, `engine-audio.js:274-309` |
| minimap / full map paint | `map.html:2655-2656` |

**What does not tick — and what data exists for it.**

| state | present? | ground truth (data that exists) | extracted? |
|---|---|---|---|
| **health** | **ABSENT** (`grep -i health\|hitpoints map.html` → no functional hits) | soldier `HitPoints 30` / `MaxHitPoints 30`; 8 `setSkeletonCollisionBone` hitboxes with material ids 40/41/42; `bf42/damage.py` already models vehicle armour | soldier hitpoints: **no** (`USSoldier.report.json` → `armor: {hasArmor:false}`) |
| **ammo / magazine** | **ABSENT** (`magSize` is a display string at `index.html:2741`; `gunfire.js:341` increments `group.shots` unbounded) | `magSize`, `numOfMag`, `magType` per weapon; 14 magbar HUD textures | `magSize` only (`con.py:656`) |
| **reload** | **ABSENT** (`grep -ri reload viewer/` → one unrelated comment) | `reloadtime` + ~50 reload clips (§2.5) | **no** |
| **respawn timer (soldier)** | **ABSENT** | `SpawnPoint.setSpawnPreventionDelay`, `spawnPointManager.group*` | positions only (`_soldier_spawn_report`) |
| **control-point capture progress** | **ABSENT** — `cp.team` is read at `map.html:2250/2273/2360/2378` and **never assigned** (`grep "\.team\s*=" map.html` → zero) | `timeToGetControl 10`, `timeToLoseControl 10`, `radius 50`, `areaValue 50`, `disableIfEnemyInsideRadius`, `disableWhenLosingControl`, `loseControlWhenEnemyClose`, `loseControlWhenNotClose`, `unableToChangeTeam` | **partial** — `time_to_get_control` is parsed into `ControlPointTemplate` (`bf42/level.py:78`) but **not emitted** by `_control_point_report` (`extract_map.py:1138-1158`); `timeToLoseControl` and the four boolean modifiers are not parsed at all |
| **flag ownership change** | **ABSENT** | `setTeamGeometry 1 flagge_m1` / `2 flaguk_m1` per control point — both team flags are named | `flag_mesh(team)` exists (`bf42/level.py:84`) but the report calls `tpl.flag_mesh()` with no team, so only the starting owner's cloth is emitted |
| **team tickets** | **ABSENT** (`grep -ri ticket viewer/` → zero) | `<Map>/GameTypes/Conquest.con`: `Game.setNumberOfTickets 1 100`, `Game.setNumberOfTickets 2 100`, `Game.setTicketLostPerMin 1 15`, `Game.setTicketLostPerMin 2 15`; plus per-nation `setTicketIcon "flag_ticket_us.tga"` on each soldier | **no** — `grep -ric ticket bf42/level.py extract_map.py bf42/con.py` → 0 |
| **vehicle respawn (`ObjectSpawner`)** | **ABSENT** — `spawnersRoot` (`map.html:338`, `:1785-1790`) is used only for a visibility toggle | `<Map>/Conquest/ObjectSpawnTemplates.con`: `MinSpawnDelay 40`, `MaxSpawnDelay 80`, `SpawnDelayAtStart 0`, `TimeToLive 45`, `Distance 40`, `DamageWhenLost 10`, and `setObjectTemplate <team> <vehicle>` giving the **per-team** vehicle (`setObjectTemplate 2 sherman` / `1 panzeriv`) | **no** — `grep -ric MinSpawnDelay\|MaxSpawnDelay\|SpawnDelayAtStart bf42/level.py extract_map.py` → 0. Only `setObjectTemplate` gets 1 hit |
| **day/night** | **ABSENT** — sun set once from `extras.sunDirection` (`map.html:2546-2553`), never moved | `Init.con` `renderer.*Color` / `shadow.shadowColor` are static per level; **no vanilla time-of-day data exists** | n/a — **not a gap** |

### GAP 4.1 — Control-point capture parameters are parsed but not published — **viewer-scope**

**Gap.** `timeToGetControl` reaches `ControlPointTemplate` and dies there;
`timeToLoseControl` and the four capture-behaviour booleans are never parsed. The
map HUD draws a capture ring with no idea how long capture takes.

**Ground truth.** `bf1942/levels/El_Alamein/Conquest/ControlPointTemplates.con`:

```con
ObjectTemplate.create ControlPoint SouthOpenBase
ObjectTemplate.setControlPointName South_outpost
ObjectTemplate.radius 50
ObjectTemplate.team 0
ObjectTemplate.spawnGroupId 2
ObjectTemplate.objectSpawnerId 1
ObjectTemplate.areaValue 50
ObjectTemplate.timeToGetControl 10
ObjectTemplate.timeToLoseControl 10
ObjectTemplate.disableIfEnemyInsideRadius 0
ObjectTemplate.disableWhenLosingControl 0
ObjectTemplate.loseControlWhenEnemyClose 1
ObjectTemplate.loseControlWhenNotClose 0
ObjectTemplate.setTeamGeometry 1 flagge_m1
ObjectTemplate.setTeamGeometry 2 flaguk_m1
```

**Current state.** `bf42/level.py:78` (`time_to_get_control` field),
`extract_map.py:1138-1158` (`_control_point_report` — emits `radius`, `areaValue`,
`spawnGroupId`, `objectSpawnerId`, `unableToChangeTeam`, `flagMesh`, `flagHeight`,
`visible`; **not** the timers or the modifiers, and `flag_mesh()` is called with
no team so the other side's cloth is dropped).

**Size.** **S.** Four more parsed fields, six more emitted keys, plus
`flagMesh: {1: …, 2: …}`.

**Impact.** **Medium.** A tooltip reading "50 m, 10 s to capture, lost when an
enemy is close" is asset-parity data, not simulation. Viewer-scope.

### GAP 4.2 — `ObjectSpawner` timers and per-team vehicle mapping are unparsed — **viewer-scope**

**Gap.** The level already tells you which vehicle each side gets at each pad and
how often; none of it is extracted, so `map.html` shows parked vehicles with no
provenance.

**Ground truth.** As quoted above. Note `setObjectTemplate 2 sherman` /
`setObjectTemplate 1 panzeriv` on one spawner — the same pad is a Sherman or a
PanzerIV depending on who owns the linked control point (`objectSpawnerId`).

**Size.** **S** to parse and publish (`spawner: {minDelay, maxDelay, timeToLive,
byTeam: {1: 'panzeriv', 2: 'sherman'}}`); **M** to actually simulate.

**Impact.** **Medium** as data, **Low** as simulation. Viewer-scope for the data.

### GAP 4.3 — Tickets, health, ammo, reload, respawn, capture progress are unsimulated — **game-scope**

Grouped deliberately: these are the items a *game* has and a *viewer* does not.
The data exists (above) and is worth extracting and displaying; **ticking it is
explicitly out of scope for an asset viewer** and should be ranked last.

The one exception worth arguing: **flag ownership as a toggle**, not a
simulation. Both team cloth meshes are named per control point, and `map.html`
already has a `flagMixer` playing `FlagBlow` (`map.html:1210`, `:2512-2524`). A
"show as: Axis / Allied / as-authored" control would exercise real extracted
assets with no clock at all. **S**, viewer-scope, and it is the cheapest thing in
§4.

---

## 5. Bots / AI

### GAP 5.1 — Nothing from the AI subsystem is extracted; `aiMeshes.rfa` is free collision geometry

**Gap.** Six AI file families ship in every level and 90 AI proxy hulls ship
globally; the pipeline reads none of them.

**Ground truth.**

**`ai.rfa` (5,853 B, 18 `.con`)** is *not* gameplay AI — it is the dev bot-spawn
harness plus the global behaviour registry. `ai/Behaviours.con` (3,632 B):

```con
ai.setNBehaviours 6
ai.setBehaviour 0 Avoid / 1 MoveTo / 2 Idle / 3 Fire / 4 Roam / 5 Scout
ai.setNVehiclesTypes 4
ai.setVehicle 0 Tank / 1 Plane / 2 Boat / 3 Infantery
ai.setVehicleBehaviour Infantery Roam Roam2d 8 0
ai.setVehicleBehaviour Tank MoveTo GotoWaypoint2d 4 0
ai.addInterpreterEntry Tank TankMoveTo
```

**`aiMeshes.rfa` (181,367 B)** — 90 `.sm` + 90 `.rs`. **These are ordinary
StandardMeshes, not pathfinding rasters**; `bf42/stdmesh.parse` reads all 90
without error. Naming is `<object>_a1` against the visible `<object>_m1`, one per
static world prop (houses, bunkers, bridges, railroad, ruins, repair pads,
`Oma_conc`, `hospital`). `aiMeshes/Hut_A1.sm` is 891 B: v10, 1 collision layer
(4 verts / 2 faces), 6 LODs. The largest, `Oma_conc_a1.sm` (90,771 B), is v9 with
2 collision layers, the second 631 verts / 631 faces. Shaders are a debug-green
`materialDiffuse 0 0.7 0.3` with an empty texture.

**Per-level AI** — six scripts plus a binary pathfinding tree in *every* map.
Omaha Beach: `AI.con` 1,478 B, `AIpathFinding.con` 1,138 B,
`ai/StrategicAreas.con` 9,009 B, `ai/Strategies.con` 4,320 B,
`ai/conditions.con` 1,971 B, `ai/prerequisites.con` 1,223 B. Wake's
`AI/StrategicAreas.con` is 10,527 B, the largest in vanilla.

`ai/StrategicAreas.con` is a named-region graph with world coordinates —
directly usable as viewer annotation:

```con
aiStrategicArea.create EastWallBunker 1000/1139.5 1015/1153 120 land
aiStrategicArea.create Beach          917/984     977/1010  100 land
AILandingZone.createLandingZone CentreLanding 816/816 1066.5/992 LZZMax
aiStrategicArea.setActive EastWallBunker
AIStrategicArea.addNeighbour EastRamp
AIStrategicArea.setOrderPosition Infantry 1016/1160
```

`Pathfinding/` binaries: `<Class>.raw` is **always 16,392 B** (an 8-byte
`(32,32)` header + a 32×32 grid of 16-byte records, matching
`aiSettings.setInformationGridDimension 32`); `<Class><N>Level<L>Map.raw` is a
quadtree of traversability bitmaps whose size tracks map openness (Omaha's
`Tank0Level0Map.raw` 20,512 B vs El Alamein's 317,984 B). Per-class, named
against `AIpathFinding.con`'s `ai.addSearchMap Tank0 … / Infantry1 … / Boat2 … /
LandingCraft3 … / Car4 …`. **Format is undocumented** — the level-0 map decodes
to a mostly `0xFF`/`0x00` byte raster after a 9-u32 header, but the exact layout
is UNVERIFIED.

Per-object AI also lives in `Objects.rfa`: **195 objects carry an `Ai/`
subdirectory** (138 `Ai/Objects.con`, 60 `Ai/Weapons.con`, zero
`Ai/Geometries.con`). `Objects/Soldiers/Common/AI/Objects.con` gives the soldier
`maxSpeed 5.0`, `coverSearchRadius 20.0` and per-target battle strengths;
`Objects/Vehicles/Land/Sherman/AI/Weapons.con` gives
`weaponTemplate.minRange 2.0 / maxRange 250.0` and a target-preference matrix.
Buildings get `aiTemplatePlugIn.create Cover … coverValue 50.0`.

**Current state.** `grep -ric "ai\.rfa\|aiMeshes\|aiTemplate\|StrategicArea\|Pathfinding"`
across `bf42/` and the extract scripts → **zero**. No AI archive is added to any
`ArchivePool`; `bf42/rfa.py`'s `add_dir` patterns do not include them.

**Size.**
- **S** — extract `ai/StrategicAreas.con` regions as named boxes for the full map
  overlay. Pure text parsing of coordinates already in world space.
- **S** — import `aiMeshes.rfa` as the collision set for GAP 3.2. 90 small hulls
  beats 55,381 triangles of per-mesh collision by a wide margin.
- **M** — `<Class>Info.raw` / `Level0Map.raw` as a walkable-area overlay, gated on
  reverse-engineering the format (UNVERIFIED).
- **L** — actual bot movement.

**Impact.** **Medium.** The strategic-area overlay is a genuinely new map facet
for almost no work, and the AI hulls are the single cheapest route to collision.
Bot *behaviour* is game-scope and should be ranked last. Viewer-scope for the
first two.

---

## 6. Multi-soldier / scene composition

### GAP 6.1 — The viewer can show exactly one figure, in a void, never in a vehicle, never on terrain

**Gap.** `poses.html` and `index.html` each hold one model and dispose the
previous one. `map.html` loads no soldier at all.

**Ground truth (what exists to compose with).**
- Soldier spawn positions are already exported and drawn:
  `map.html:2354-2366` paints `extras.soldierSpawns` as dots on the full map,
  with a count in the caption (`map.html:2540`). Placing a figure at one is a
  lookup, not an extraction.
- Vehicle seating animations exist: `3PSitWillyPassLower/Upper`,
  `3PSitHanomagPassLower/Upper`, `3PSitM3A1PassLower/Upper`,
  `3PSitKubelwagenPassLower/Upper`, `3PWillySitLower`, `3PSitBreathWillyUpper`,
  `3PSitIdle01WillyUpper`, `3PGoInTankHatchLower/Upper`,
  `3PGoInMustangLeft/RightLower/Upper`, `3PCruch2HatchLower/Upper` — 18 clips.
- Seat geometry is already parsed: `index.html:3052-3100` `collectStations()`
  derives seats from the vehicle's own rigged parts, gun groups and camera nodes,
  and labels roles at `index.html:3008-3050`. The anchor points exist; nothing is
  ever parented to them.
- Hand-sign clips exist for a posed squad: `3PHandSign_{Come,Down,Freeze,Medic,
  Negative,Roger,Shout}`.

**Current state.**
- `poses.html:466-474` — `disposeModel(current); scene.remove(current); current =
  gltf.scene`. One `.pose.glb` at a time, URL is a single (soldier, weapon) pair
  (`poses.html:456`).
- `index.html:3750-3755`, `:3855` — same single-model discipline.
- `map.html` — `grep -i "soldier\|pose\|kit\|bip01"` finds only
  `extras.soldierSpawns` (dots) and the English word "pose". **No `.pose.glb`
  fetch, no soldier mesh, no `Bip01` anywhere.** The only link to the poses page
  is a nav anchor at `map.html:218`.
- Seats are a UI console listing only — no soldier is loaded or parented.

**Size.**
- **S** — allow N `.pose.glb` in `poses.html` on a grid (the loader already
  handles one; the change is not disposing).
- **M** — place a soldier on level terrain in `map.html`: fetch one
  `.pose.glb`, drop it at a `soldierSpawns` entry, clamp with the existing
  `groundHeight()` (`map.html:1934-1941`). This is the single highest
  demonstration-value item in the report.
- **M** — soldier in a seat: parent a pose glb to a station node from
  `collectStations()` and apply the matching `3PSit*` clip, which needs GAP 3.4.

**Impact.** **High.** A soldier standing at a real spawn point, at correct scale,
on real terrain is the first moment the extraction reads as a *game* rather than
a parts catalogue — and it needs no new extraction at all. Viewer-scope.

---

## 7. Coverage table — nation × class

Vanilla, live kits only (the 40 bound by a level; `BaseKit`'s five excluded).
Columns: **T** kit template found · **P** kit parts extracted · **H** soldier
renders with headgear · **W** weapon held (a `.pose.glb` exists) · **F** weapon
can be fired in the viewer. Primary weapon in brackets; **bold** = not in the
armoury (GAP 2.1).

| nation (soldier) | class | T | P | H | W | F |
|---|---|---|---|---|---|---|
| **US** (`USSoldier`) | Anti-tank [Bazooka] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Assault [Bar1918] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Engineer [No4] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Medic [Thompson] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Scout [**No4Sniper**] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| **US Marine** (`USMarineSoldier`) | Anti-tank [Bazooka] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Assault [Bar1918] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Engineer [M1Garand] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Medic [Thompson] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Scout [**No4Sniper**] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| **British** (`BritishSoldier`) | Anti-tank [Bazooka] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Assault [Bar1918] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Engineer [No4] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Medic [Thompson] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Scout [**No4Sniper**] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| **Canadian** (`CanadianSoldier`) ¹ | Anti-tank [Bazooka] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Assault [JohnsonLMG] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Engineer [No4] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Medic [Thompson] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Scout [**No4Sniper**] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| **German** (`GermanSoldier`) | Anti-tank [Panzershreck] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Assault [Sg44] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Engineer [K98] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Medic [Mp40] | ✓ | ✗ 0/1 | ✗ | ✓ | ✗ |
| | Scout [**K98Sniper**] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| **German desert** (`GermanDesertSoldier`) ² | Anti-tank [Panzershreck] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Assault [Sg44] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Engineer [K98] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Medic [Mp40] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Scout [**K98Sniper**] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| **Japanese** (`JapaneseSoldier`) | Anti-tank [Panzershreck] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Assault [Type99] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Engineer [Type5] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Medic [Mp18] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Scout [**K98Sniper**] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| **Soviet** (`RussianSoldier`) | Anti-tank [Bazooka] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Assault [DP] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Engineer [No4] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| | Medic [Mp18] | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ |
| | Scout [**No4Sniper**] | ✓ | ✗ 0/3 | ✗ | ✓ | ✗ |
| **totals (40 kits)** | | **40/40** | **0/102** | **0/40** | **40/40** | **0/40** |

¹ Bound only by `Liberation_of_Caen`, and overwritten by the British binding two
lines later — see GAP 1.2. The templates are complete and the mesh
(`Can_helmet_M1`) exists; `JohnsonLMG` is unique to this nation.
² `GerKitdesert/` — invisible to `roster.py:78` today (GAP 1.4).

102 = total `KitPart` slots across the 40 live kits (a shared part counted once
per kit that wears it). Distinct geometries to extract: **43** — 20 head, 13 back,
10 hip. Verify with:

```bash
python3 - <<'EOF'   # against the kit table built in §1.1
import re, collections
from pathlib import Path
DEAD={'BritKit','GerKit','JapKit','RussKit','USKit'}
live=collections.defaultdict(set); slots=0
for b in re.split(r'\n\n', Path('kit_table.txt').read_text()):
    m=re.match(r'KIT (\S+)', b)
    if not m or m.group(1) in DEAD: continue
    for w in re.finditer(r'WORN\s+\w+:(\S+)\[bone=(\w+)\]->geo=(\S*)', b):
        slots+=1; live[w.group(2).lower()].add(w.group(3))
print(slots, {k:len(v) for k,v in live.items()}, sum(len(v) for v in live.values()))
EOF
# -> 102 {'a': 20, 'backpack': 13, 'hippack': 10} 43
```

Kit-part slot counts per class, for sizing: AT 2–3, Assault 2–3, Engineer 2–3,
Medic 1–3, Scout 3. `German_Medic` is the only vanilla kit with **one** worn part.

---

## 8. Viewer-scope vs game-scope

**Viewer-scope** — makes the extracted assets look and behave right. Every one of
these is about a mesh, a texture, a clip or a number that already exists in an
archive.

GAP 1.1 (kit parts) · 1.2 (liveness rule) · 1.4 (parser + regex) · 1.5 (head
variants) · 1.6 (1P meshes) · 1.7 (parachute) · 1.9 (kit pickups) · 2.1
(snipers) · 2.2 (weapon stats) · 2.3 (hand-weapon muzzles) · 2.4 (scope art) ·
2.5 (mechanism data) · 3.1 (walk mode) · 3.2 (collision export) · 3.3 (heightmap
export) · 3.4 (real animation clips) · 4.1 (capture params) · 4.2 (spawner data) ·
5.1 (strategic areas, AI hulls) · 6.1 (multi-soldier, soldier on terrain)

**Game-scope** — simulating a match. Documented because the data exists and the
choice should be informed, ranked last because the project is a viewer.

GAP 4.3 in full: ticking health, ammo, reload, respawn timers, capture progress,
tickets, `ObjectSpawner` respawn, bot movement (the behaviour half of 5.1).
The one boundary case worth pulling forward is **flag ownership as a display
toggle** (both team cloth meshes are named per control point) — that is
viewer-scope and **S**.

**Non-gaps, recorded so they are not re-investigated:**
- No winter/snow uniform exists in vanilla (GAP 1.8).
- No rank/insignia decals exist as separate assets (GAP 1.8).
- No day/night data exists in vanilla — the sun is a static per-level constant.
- `bf42/stdmesh.py` parses collision layers correctly and completely; the gap is
  export-side, not parse-side (GAP 3.2).
- `JapSoldier.ske` is a genuinely dead file (GAP 1.3).

---

## 9. Priority table

Sorted by impact ÷ size.

| # | gap | scope | size | impact | blocked by |
|---|---|---|---|---|---|
| 1 | **2.1** Sniper rifles absent from `models.json` | viewer | S | High | — |
| 2 | **1.2** Fix the kit liveness rule (last-write-wins; Canada is live) | viewer | S | High | — |
| 3 | **1.4** Parse `setBoneName`; widen `KIT_SOURCE` for `GerKitdesert` | viewer | S | High | — |
| 4 | **6.1a** Place one soldier on level terrain in `map.html` | viewer | M | High | — (`groundHeight()` + `soldierSpawns` both exist) |
| 5 | **3.1** Ground-clamp the free-fly camera; add eye/crouch/prone heights | viewer | M | High | — |
| 6 | **1.1** Extract the 43 live kit geometries; graft at `A`/`backpack`/`HipPack` | viewer | M | **Highest** | 1.2, 1.4 |
| 7 | **3.4** Bake real animation clips (start: one run cycle) | viewer | M | High | — |
| 8 | **2.2** Parse and publish the weapon stat block | viewer | S | Medium-High | — |
| 9 | **1.9** Extract the 16 kit pickup meshes | viewer | S | Medium | — |
| 10 | **1.7** Extract the parachute | viewer | S | Medium | — |
| 11 | **3.3** Export a sampleable heightmap | viewer | S | Medium | — |
| 12 | **4.1** Publish capture timers + both teams' flag meshes | viewer | S | Medium | — |
| 13 | **5.1a** `StrategicAreas.con` regions as a full-map overlay | viewer | S | Medium | — |
| 14 | **4.3\*** Flag ownership as a display toggle (not a sim) | viewer | S | Medium | 4.1 |
| 15 | **2.3** Hand-weapon muzzle nodes + `GunFire` in `poses.html` | viewer | M | Medium | 2.2 |
| 16 | **2.4** Scope overlay art + scoped view | viewer | S | Medium | 2.2 |
| 17 | **4.2** Parse `ObjectSpawner` timers and per-team vehicles | viewer | S | Medium | — |
| 18 | **1.5** Emit all three head variants | viewer | S | Low-Medium | — |
| 19 | **6.1b** Multiple soldiers in `poses.html` | viewer | S | Low-Medium | — |
| 20 | **5.1b** Import `aiMeshes.rfa` as the level collision set | viewer | S | Medium | 3.2 |
| 21 | **3.2** Export + index level collision (BVH) | viewer | L | Medium | 5.1b |
| 22 | **6.1c** Soldier in a vehicle seat | viewer | M | Medium | 3.4 |
| 23 | **1.6** Extract first-person body/hands | viewer | S | Low | — (useful only with 3.1) |
| 24 | **2.5** Weapon mechanism data in the UI | viewer | M | Low-Medium | 2.2 |
| 25 | **5.1c** Decode `Pathfinding/*.raw` as a walkable overlay (UNVERIFIED format) | viewer | M | Low | — |
| 26 | **4.3** Simulate health / ammo / reload / respawn / capture / tickets | **game** | L | Low | everything above |
| 27 | **5.1d** Bot movement | **game** | L | Low | 3.2, 3.4, 5.1c |

---

## 10. Already covered — do not re-do

- **Weapon weld.** 224 of 224 (soldier × weapon) pairs ship; `palmR` median ~2.7 cm
  against a ~0.80 m naive control (`USSoldier__No4Sniper.pose.report.json`
  `metrics`). `extract_pose.py:428`, `weapon-grip.md`.
- **Three stances.** `stand` / `crouch` / `lie` resolve through the real animation
  state machine including the `copyState` donor sharing (`bf42/animstates.py`,
  `extract_pose.py:55-60`), and blend in the viewer at `poses.html:322-351`.
- **All 8 soldiers + 26 of 28 hand weapons** extract cleanly —
  `texturesNotFound: []`, `missingMeshFiles: []`, `unresolvedTemplates: []` on
  `USSoldier.report.json`; `texturesMissing: []` on every pose report sampled.
- **`setRandomGeometries` resolution.** Implemented at `bf42/con.py:224-241`,
  correctly handles the "bare name deliberately absent" case (though it always
  picks variant 1 — GAP 1.5).
- **First-person filtering.** Deliberate and consistent
  (`bf42/assemble.py:41`, `bf42/con.py:235`, `extract_pose.py:93/159`).
- **Collision parsing.** `bf42/stdmesh.py:211-261` reads every collision layer in
  all 1,285 vanilla `.sm` with zero failures; `bf42/damage.py` already consumes
  the per-face material ids; `index.html:1893-1986` paints armour regions.
- **Vehicle gunfire.** `gunfire.js` is a complete effects system — per-barrel
  muzzle nodes, alternating barrels, tracers with a sub-pixel width floor,
  `sizeOverTime`/`colorOverTime` flash curves, recoil ease-back, rocket motor
  accel, gravity, smoke trails. Wired to both `map.html` and `index.html`.
- **Control points and spawn points geometry.** Positions, radii, team, flag mesh,
  visibility and the pole/cloth distinction all ship (`spawn-points.md`,
  `extract_map.py:1128-1158`); `map.html` draws them on the minimap and full map.
- **Terrain height *query*.** `map.html:1934-1941` `groundHeight(x,z)` works today
  and is already used by two callers.
- **Aircraft flight.** Real gravity, heightfield clamping, landing-gear AGL logic,
  and four data-driven camera modes with rotation limits read from the `.con`
  (`flight.js:520/637/652-668/726/795`).
- **`kits.md` itself.** Its mechanism analysis (KitPart, the three bones, the
  `setRandomGeometries` trap, `setCopyLinksCount` being inert, the medic helmet
  being a duplicate mesh rather than a texture override, the graft-not-more-files
  output decision) is sound and should be built as written — with the two
  liveness corrections in GAP 1.2 applied first.
