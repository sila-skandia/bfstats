# V4 - adversarial verification of R4 (data survey + `.con` binding)

Verifier scripts (all mine, none of the author's re-used for a number): `SP/v4-conword.py`
(con word -> ConsoleClass -> executeObjectMethod), `SP/v4-find.py`, `SP/v4-grep.py`,
`SP/v4-mmfiles.py`, `SP/v4-dump.py`, `SP/v4-cells.py` (engine-semantics replay of
`MaterialManagerSettings.con`), `SP/v4-query.py`, `SP/v4-query2.py`, `SP/v4-veh.py`,
`SP/v4-props.py`, `SP/v4-sm.py` / `SP/v4-smscan.py` (own `.sm` collision reader),
`SP/v4-allmods.py`. Extracted data: `SP/v4-data/`. All addresses lnxded; every binary
claim below was read in `objdump`, not in a decompile, unless marked.

## Verdict table

| # | R4 claim | Verdict |
|---|---|---|
| 1 | Armor defaults speedMod 0.05 / angleMod 0.0 / damageMod 1.0 | CONFIRMED (and sourced more strongly than R4 did) |
| 2 | getters +0x4c/+0x44/+0x3c return those fields | CONFIRMED |
| 3 | PhysicsNode template defaults mass 1, inertiaModifier (1,1,1), drag 0 | CONFIRMED |
| 4 | `speedDamageMod` 0.1, `defaultDamageMod` 0.0 | CONFIRMED |
| 5 | absent (att,def) cell returns `defaultDamageMod` | CONFIRMED |
| 6 | "`getDamageMod` calls `getCreateCell` (vtable +0x44)" | **REFUTED** - +0x44 is `getCell`; a lookup never creates a cell |
| 7 | (not stated by R4) a CREATED cell's damageMod | **ADDED**: `MMCell::MMCell` sets 1.0, not 0.0 |
| 8 | (not stated by R4) table keyed by group, not id | **ADDED**: key = (attacker material's attGroup, defender material's defGroup) |
| 9 | "`damageMod` is the `.con` property bound to `setCell`" | CORRECTED - separate words, separate handlers |
| 10 | `ObjectTemplate.speedMod/angleMod/damageMod/mass/inertiaModifier` binding | CONFIRMED - but R4 never showed the word->field step; shown here |
| 11 | `setSpeedDamageMod`/`setDefaultDamageMod` "never authored" | CONFIRMED and strengthened: no such console word exists in the binary |
| 12 | O4 (Material ctor defaults unknown) | **CLOSED**: friction 1.0, elasticity 0.0, resistance 0.01, damage 0.0, groups -1 |
| 13 | material values 45/50/60/61/63/90, 16 terrain rows, 20 friction-authoring materials | CONFIRMED |
| 14 | "155 materials" | CORRECTED: 155 in define.con, **158 loaded** (73, 129, 134 come from run files) |
| 15 | "materialAtt/DefGroup = id always" | CORRECTED: 120 -> group 119, 166 -> group 165 |
| 16 | 5,928 writes / 5,165 distinct pairs | CORRECTED: **5,897 writes / 5,153 cells** (author's parser reads inside `beginrem...endrem`, ignores `setCell`) |
| 17 | all quoted collision cells | CONFIRMED (none touched by the parser bug) |
| 18 | vehicle table rows Willy / Sherman / Spitfire / B17 / Fletcher / Enterprise | CONFIRMED |
| 19 | "50 roots; 12/12 air, 0/35 land, 0/13 sea" | CORRECTED: 53 PCO roots; 13/13 air, 0/22 land, 0/18 sea (R4's own three numbers sum to 60) |
| 20 | "damageMod authored twice, one object" | CORRECTED: DC `SA-3GuidedRocket` 0.1 + `AS-7` (Projectile) 0; DC_Final `SA-3GuidedRocket` + `PatriotGuidedRocket` 0.1 |
| 21 | collision FACE histograms Willy / Spitfire / Sherman, wheel 37, wreck 85 | CONFIRMED |
| 22 | "`CollisionFace.material_id` is the byte the engine calls matSelf/matOther" | **CORRECTED**: only for the face side. The vertex side is a **u16 at vertex+0xc** that R4's reader discards as "unknown float" |
| 23 | Spitfire `_L1`/`_M1` collision sections "byte-identical" | CORRECTED: vertex+face arrays identical, trailing acceleration data differs (2,387 of 22,416 bytes) |
| 24 | material 37 undefined, falls back to material 0 | CONFIRMED - and the damage fallback is never exercised (engine skips 37) |
| 25 | three worked examples (victim side) | CONFIRMED numerically; attacker-material assumption for the Sherman corrected; missing half added below |

---

## 1. Engine defaults

### 1.1 Armor speedMod / angleMod / damageMod - CONFIRMED, from BOTH constructors; the template always wins, with the same numbers

Getters (objdump `0x08173f70`, `0x08173fa0`, `0x08173fc0`), each a bare `flds`:
`getDamageMod` (vtable +0x3c) -> `flds 0x44(%eax)`; `getAngleMod` (+0x44) -> `flds 0x48(%eax)`;
`getSpeedMod` (+0x4c) -> `flds 0x4c(%eax)`. Setters `0x08173f60/90/b0` (+0x38/+0x40/+0x48)
store to the same three offsets. So **Armor +0x44 damageMod, +0x48 angleMod, +0x4c speedMod**
(+0x40 is `get/setMaterial`).

`Armor::Armor(std::map<int,DamageEffects*>&)` `0x08172280` (C1; C2 twin `0x08172130`):
`0x81722ff movl $0x3f800000,0x44(%eax)` = 1.0; `0x81722c4 mov %edx,0x48(%eax)` with
`%edx = 0` (0x8172281) = 0.0; `0x8172306 movl $0x3d4ccccd,0x4c(%eax)` = 0.05; also
`0x81722f8 movl $0,0x40(%eax)` (material 0). The no-arg `Armor::Armor()` `0x081724c0/0x081723d0`
is a Debug-message stub that sets none of them. The map ctor has exactly one caller in the
whole binary: `setArmorComponent` at `0x81ddc14`.

`SimpleObjectTemplate::SimpleObjectTemplate()` `0x081dbc70`: `0x81dbd07 mov %esi,0x8c(%ebx)`
(`%esi = 0x3f800000`, 0x81dbcda) = damageMod 1.0; `0x81dbd10 mov %ecx,0x90(%ebx)` (`%ecx = 0`)
= angleMod 0.0; `0x81dbd56 movl $0x3d4ccccd,0x94(%ebx)` = speedMod 0.05. The second ctor
variant `0x081dbf00` stores the same three (0x81dbf97, 0x81dbfa0, 0x81dbfe6).

`SimpleObjectTemplate::setArmorComponent` `0x081ddae0`: constructs the Armor (0x81ddc14) and
then, with **no branch in between**, `0x81ddc62 mov 0x8c(%edi)` -> `call *0x38` (setDamageMod),
`0x81ddc82 mov 0x94(%edi)` -> `call *0x48` (setSpeedMod), `0x81ddca0 mov 0x90(%edi)` ->
`call *0x40` (setAngleMod). So when a `.con` authors nothing the value comes from the
**template** constructor (written last, unconditionally); the Armor constructor holds the same
literals and is always overwritten. R4 read only the template constructor and `Armor::init`;
its numbers are right.
None of `setArmorComponent`'s virtual calls on the new Armor (slots 0xc, 0x10, 0x18, 0x38, 0x50, 0x48, 0x28, 0x40, 0x98, 0xa0, 0x140, 0xa8, 0xb0, 0xb8, 0xd0, 0xd8, 0xe0, 0xec, 0x58, 0x108, 0x110, 0x100, 0x118, 0x24) is `+0x30` (`Armor::setMaterial`) - R4's O3
observation is CONFIRMED (Armor +0x40 stays 0 from its ctor on this path).

### 1.2 PhysicsNode template defaults - CONFIRMED
Ctor `0x081dbc70`: `0x81dbcd0 movl $0,0x44(%ebx)` drag 0; `0x81dbceb movl $0x3f800000,0x54(%ebx)`
mass 1.0; `0x81dbcfb/fe/01 mov %esi,0x64/0x68/0x6c` inertiaModifier (1,1,1); `+0x48..`, `+0x58..`
zeroed. `setPhysicsNodeComponent` `0x081dd490` copies `+0x44 -> *0x94`, `+0x48 -> *0x88`,
`+0x54 -> *0x9c`, `+0x64 -> *0xac` in both mobile branches (0x81dd501-0x81dd536 and
0x81dd664-0x81dd6a8); only the second branch also copies `+0x58 -> *0xa4`
(centerOfMassOffset). No `*0xb4` call anywhere in the function (R4 C2 CONFIRMED).

### 1.3 MaterialManager globals - CONFIRMED
`MaterialManager::MaterialManager()` `0x081747f0`: `0x8174857 movl $0x3dcccccd,0x20(%ebx)` = 0.1,
`0x817485e movl $0,0x24(%ebx)` = 0.0; current material / defGroup / attGroup (+0x14/+0x18/+0x1c)
= -1. `getSpeedDamageMod` `0x08176180` = `flds 0x20`, `getDefaultDamageMod` `0x081761a0` =
`flds 0x24`. R4's vtable text is muddled: the vtable slots are **+0x20 getSpeedDamageMod and
+0x28 getDefaultDamageMod** (briefing is right); `0x24` is the FIELD offset.

### 1.4 `getDamageMod(att, def)` `0x08175040` - fallback CONFIRMED, mechanism CORRECTED
Read instruction by instruction:
1. `call *0x14` = `getMaterialPtr(att)`; if NULL -> `getMaterialPtr(0)`; if still NULL -> `flds 0x24(%ebx)`.
2. same for `def` (0x8175066 / 0x817509c).
3. `0x8175073 mov (%edx),%ecx` = **defMaterial->+0x0**, `0x8175078 mov 0x4(%esi),%edx` =
   **attMaterial->+0x4**, `0x817507d call *0x44(%eax)`.
4. non-NULL -> `flds (%eax)` (cell +0x0); NULL -> `0x8175090 flds 0x24(%ebx)` = defaultDamageMod.

Vtable `0x0871d3a0` (own `vt.py` dump): **+0x3c getCreateCell(uint,uint), +0x40 getCreateCell(),
+0x44 getCell(uint,uint), +0x48 getCell()**. R4 says the lookup "calls `getCreateCell` (vtable
+0x44)" - **REFUTED**: +0x44 is `getCell` `0x08174f90`, two `_Rb_tree::find`s (outer map at
`this+0x28` keyed by arg 1, inner keyed by arg 2), returns 0 when either is missing or either
key is -1, inserts nothing. This matters because of the next point.

**A created cell is 1.0, not 0.0.** `MMCell::MMCell()` `0x081745f0`: `0x81745fb movl
$0x3f800000,(%ebx)`. Cells are created only by the script words: `MaterialManager.damageMod`
(ConsoleClass37 exec `0x08179c10`: `call *0x40` = `getCreateCell()`, then `mov %ebx,(%eax)`),
`MaterialManager.setEffectTemplate` (`0x0817a4c0`: `call *0x40`, then `MMCell::setEffectTemplate`),
and `setCell` (`0x081752b0`: `call *0x3c`). So a block that authors `setEffectTemplate` with no
`damageMod` would yield **1.0**. I measured vanilla: **0 such cells** (every one of the 5,153
cells has an authored damageMod), so R4's numbers survive - but a port must not model
"effect-only cell" as 0, and mods should be re-checked.

**Group, not id, keys the table.** Material struct from the word handlers: `materialDefGroup`
-> +0x0 (`0x8177d3d`), `materialAttGroup` -> +0x4 (`0x817814d`), `materialDamage` +0x8,
`materialFriction` +0xc, `materialElasticity` +0x10, `materialResistance` +0x14. So the lookup is
`cell[attMat.attGroup][defMat.defGroup]`. In vanilla the groups equal the id for every material
except **120 (groups 119) and 166 (groups 165)** (define.con:553-555, 563-565) - irrelevant to
vehicles, but R4's "always" is wrong.

**O4 closed.** `Material::Material()` `0x08174550`: defGroup -1, attGroup -1, damage 0.0,
friction **1.0**, elasticity **0.0**, resistance **0.01** (`0x3c23d70a`). Every vehicle material
(45, 50-52, 55, 57, 60-63, 85, 90) therefore has friction 1.0 / elasticity 0 / resistance 0.01.
`getDamageForMaterial/Friction/Elasticity/Resistance` `0x08175170..0x08175230`: material ->
material 0 -> `fldz` (damage) / `fld1` (the other three). CONFIRMED in objdump.

## 2. `.con` word binding

Every word is a `ConsoleClassNN` static object whose name pointer is stored next to its vtable
in `__static_initialization_and_destruction_0`; vtable slot +0x4c is `executeObjectMethod`.
`v4-conword.py` finds `movl $<string>,<obj+0xc>` and the paired `movl $<vtable>,<obj>`.

| word (string VA) | registered at | handler | effect (objdump) |
|---|---|---|---|
| `damageMod` 0x086c2393 (ONE merged string, two users) | 0x81b77da | ConsoleClass107 `0x081c20e0` | `getActiveTemplate(0x947e)`; `mov %ebx,0x8c(%eax)` |
| `speedMod` 0x086c57ff | 0x81b7709 | ConsoleClass108 `0x081c24f0` | `mov %ebx,0x94(%eax)` (0x81c252e) |
| `angleMod` 0x086c57f6 | 0x81b7638 | ConsoleClass109 `0x081c2900` | `mov %ebx,0x90(%eax)` (0x81c293e) |
| `mass` 0x086c5874 | 0x81b81fc | ConsoleClass92 `0x081becc0` | `mov %ebx,0x54(%eax)` |
| `inertiaModifier` 0x086c5851 | 0x81b8046 | ConsoleClass94 `0x081bf540` | stores to +0x64/+0x68/+0x6c |
| `material` 0x086c2417 | 0x81b7a4d | ConsoleClass104 `0x081c1410` | `mov %ebx,0x88(%eax)` |
| `MaterialManager.damageMod` (same string) | 0x8176b1a | ConsoleClass37 `0x08179c10` | `getCreateCell()`; cell+0 = value |
| `attGroup` / `defGroup` | 0x8176caa / 0x8176be2 | `0x08179460` / `0x08179830` | `call *0x2c` setAttGroup (this+0x1c) / `*0x34` setDefGroup (this+0x18) |
| `material` | 0x8177222 | `0x081778f0` | `call *0xc` setMaterial (creates a `Material` if absent) |
| `materialDefGroup/AttGroup/Damage/Friction/Elasticity/Resistance` | 0x817715a ... 0x8176d72 | `0x08177d00` ... `0x08179090` | `getMaterialPtr()` (+0x18) then store +0x0/+0x4/+0x8/+0xc/+0x10/+0x14 |
| `setCell`, `setEffectTemplate`, `getDamageMod`, `dumpMaterialList` | 0x81767ca, 0x817690e, 0x8176a14, 0x817673f | | all four are real console words |

All CONFIRMED. R4 inferred the three Armor words from name similarity plus the template->Armor
copy; the table above is the missing word->field evidence. The full MaterialManager word list
in `.rodata` (0x086c235b-0x086c2417) is: dumpMaterialList, setCell, setEffectTemplate,
getDamageMod, damageMod, defGroup, attGroup, materialResistance, materialElasticity,
materialFriction, materialDamage, materialAttGroup, materialDefGroup, material. **There is no
`speedDamageMod` / `defaultDamageMod` word of any spelling** (`strings | grep -i` finds only the
mangled symbols), and a heuristic scan for `call *0x1c/0x20/0x24/0x28` within 6 instructions of
a load of the `materialManager` global (`0x0871d43c`) finds no caller. So 0.1 is dead data and
0.0 is a constant of the engine, not just "unauthored"; my own 17-mod scan
(`v4-allmods.out`) also finds 0 hits. (7 archives/entries in DC_Final, FHSW and FHSWEurope are
unreadable by the RFA reader - not covered by anyone's count.)
R4 CORRECTED on one detail: `damageMod` is not "bound to `setCell`"; they are two words with two
handlers (vanilla uses `setCell` 9 times: bombs.con, Big_bombs.con, wespe.con lines 9-11).
All `dumpMaterialList` format-string addresses R4 cites check out byte for byte.

## 3. Material table (own extraction and replay)

Files: only `Archives/bf1942/Game.rfa` holds `Bf1942/Game/materialManagerdefine.con` (26,221 B) and
`materialManagerSettings.con` (102,341 B); 72 archives scanned, 0 unreadable. The engine opens
`Bf1942/Game/MaterialManagerSettings.con` by name (string in the binary); nothing in any archive
`run`s it. Line 1 is `Run materialManagerdefine.con`; 49 more `run` lines sit at the tail
(4523-4572) so they override the inline cells; 10 targets are missing (R4's list CONFIRMED).
`collision_Armor/RaftArmor.con`, `ObjectiveArmor.con`, `damage_system/Shotgun|Throwknife|C47|WasserFall|...`
exist but are never run. Overrides: XPack1/XPack2 ship their own Settings, DesertCombat and FH
both files (DC_Final none). Inside vanilla, `Battle_of_Britain.rfa .../Ju88A/Objects.con:2-9`
writes cells (202,63)=10 and (242,63)=20 at level load (bombs, not collision); the
`Liberation_of_Caen` level-local `damage_system/AT.con` is referenced by nothing.
Also: `Kasserine_Pass.rfa` carries level copies of Willy/Sherman/Spitfire with different numbers
(Sherman mass 30300 HP 110, Willy HP 40, Spitfire HP 145 drag 0.105) - R4's table is the
Objects.rfa one.

Counts: **158 materials loaded** (155 distinct ids in define.con - 160 `material` lines, ids
96/97/98/115/116 defined twice - plus 73 from PTRaftArmor.con and 129/134 from AT.con); **5,888
live `damageMod` + 9 `setCell` = 5,897 writes, 5,153 cells**, 291 overwrites with a different
value. R4's 5,928 / 5,165: its regexes `search` anywhere in a line and know nothing of
`beginRem`/`endRem` (both are engine keywords - strings present), so it counts 40 `damageMod`
lines inside comment blocks (katyusha, bazooka:879, destroyer:469, Torpedo:353, NoArmor:998/1649,
PlaneArmor:1902) = 18 phantom cells such as (227,90), (250,90), (252,90), and misses the 6
`setCell`-only cells. 5,928-40 = 5,888 and 5,165-18+6 = 5,153: fully reconciled. Its BFS `run`
order and per-file context reset happen to be harmless here. The `0.1.0` typo is on **six**
lines (2132-2148 def 45-49, and 2192 def 72); how the engine parses it is NOT VERIFIABLE from
what was read (R4's "atof" is an assumption) and moot for 45-49 (Big_bombs.con overwrites them).

Values (material: damage, all with friction 1 / elasticity 0 / resistance 0.01 from the ctor):
45, 50, 51, 52, 55, 57, 60, 61, 62, 63, 85, 90 -> **1.0**. 37 and 99 undefined. CONFIRMED.
Terrain rows 0-15: identical to R4's table (damage 30 everywhere). CONFIRMED.

| cell (att,def) | value | last write |
|---|---|---|
| (45,60) (45,61) (45,63) | 0.1 | LightArmor.con:132/137/147 |
| (45,90) | **no cell -> 0.0** | - |
| (45,50) (45,51) (45,52) | 0.1 | LightArmor.con:73/78/83 |
| (50,60) (50,61) (50,63) | 0.1 | HeavyArmor.con:132/137/147 |
| (50,90), (51,90), (52,90) | no cell -> 0.0 | - |
| (60,45) (61,45) (63,45) | 0.1 | PlaneArmor.con:44/505/1461 |
| (50,45) (51,45) (52,45) | 0.1 | HeavyArmor.con:44/475/905 |
| **(90,45) (90,50) (90,51) (90,52)** | **0.1** | materialManagerSettings.con:2714/3510/... (no effect template) |
| (61,52) (63,52) | no cell -> 0.0 | - |
| (45,55) | 0.0 authored; (55,45) = 2.0, (55,60) = 1.0 | Light/HeavyArmor |

Terrain as attacker (what a ground crash uses): def 45 -> 0.01 for every terrain id except water
(1) 0.5; def 50/51/52 -> 0.01 all; **def 60 -> 0.01 all** (Settings:87 says 5, PlaneArmor.con:187
overrides to 0.01 - the run order is load-bearing); **def 61 -> 0.1** (rock id 12: 0.5);
**def 63 -> 0.1**; def 90 -> no cell, 0.0; def 55 -> 10.0 on ids 2,4-11, else 0; def 178
(Spitfire wheels) -> no cell. Vehicle as attacker vs terrain: no cells at all (0.0).
Material 90: 19 cells as attacker (all 0.1 except 73), only 2 as defender ((240,90), (241,90), both 0).

## 4. Vehicle table - CONFIRMED (raw text, `create` + `active` contexts, rem/beginrem honoured; none of the six directories contains a `run`/`include`)

| vehicle | mass | inertiaModifier | speedMod | angleMod | damageMod | HP | material |
|---|---|---|---|---|---|---|---|
| Willy (Objects.con:15-25) | 2500 | - (1,1,1) | 1 | - (0) | - (1) | 50 | 45 |
| Sherman (:15-24) | 25000 | - | 1 | - | - | 100 | 50 |
| Spitfire (:10-23) | 2500 | 0.85/0.833/0.84 | 2 | 1 | - | 100 | 60 |
| B17 (:12-25) | 25000 | 0.6/0.6/0.3 | 2 | 1 | - | 450 | 60 |
| Fletcher (:13-19) | 2,500,000 | - | - (**0.05**) | - | - | 300 | 55 |
| Enterprise (:9-17) | 25,000,000 | - | - (0.05) | - | - | 600 | 55 |

Only the root PlayerControlObject of each carries `hasArmor`; no child part does, so every
contact resolves to the root Armor. Vanilla census (own): 13 air / 22 land / 18 sea PCO roots;
angleMod and inertiaModifier on 13/13 air (R4 missed `Aichival-T`, `SBD-T`; BF109 authors
`1/1/1`), 0/22, 0/18. Every other row of R4's table I spot-checked matches.

## 5. Collision-mesh materials

Face histograms (own reader, `standardMesh.rfa`; `StandardMesh_001.rfa` overrides none of them):
Willy_Hul_M1 {45:22} / {45:73}; Willy_WheL_M1 {37:2}; Wreck_Willy {85:34}; Spitfire_Fus_M1
{60:4, 61:13, 63:11} / {60:8, 61:37, 63:20, 90:32}; Sherman_Hull_M1 {50:10, 51:9, 52:5} /
{50:21, 51:20, 52:5}. All CONFIRMED.

**What R4 missed.** The 16-byte collision vertex is `f32 x,y,z; u16 material; u16 ?`. The engine
reads it: `checkObjectVsObject` `SP/decomp/08259690.c:455`
`uVar13 = *(ushort*)(vertexArray + 0xc + i*0x10)`, and passes `(matSelf = uVar13 vertex,
matOther = face)` to A's `handleCollision` (lines 492-493) and the swap to B's (522-523).
Vertex histograms: Willy {45} only; Spitfire L0 {60:4, 61:5, 63:7}, L1 {60:4, 61:29, 63:18,
90:32}; **Sherman L0 {50:7, 51:6, 52:1}, L1 {50:10, 51:18}**; Spitfire wheel 178. So the
moving object contributes a VERTEX material and the struck one a FACE material, and "Sherman =
material 50" is a simplification (it is 50, 51 or 52). In all 1,514 vanilla `.sm` files the
vertex-material set of a layer is a subset of its face-material set. Caveat inherited from the
briefing (not re-verified here): B's face layer is LOD 1 only when A's root radius < 4 or A is
a soldier, else LOD 0 - and the Spitfire's LOD 0 has **no material-90 faces**, so R4's "one
third of hits do nothing" holds for a Willy-sized attacker and possibly not for a Sherman.

**Special ids vs data - they agree.** 37: on 77 vanilla meshes, all wheels/tyres (119 faces,
259 vertices), never defined, no material carries group 37; the engine's
`SimpleObject::handleCollision` `0x081dab40` (`decomp/081dab40.c:135`,
`param_6 != 0x25 && param_7 != 0x25`) skips the whole damage dispatch, so R4's "falls back to
damage 30" is true of the getter but never reached on this path; only the
friction/elasticity/resistance fallback to material 0 (1.0 / 0 / 0.02) is live. 90: a defined
"Basic Materials" id on 98 meshes (buildings, crates, plane and ship hulls; 3,392 faces) with
19 attacker cells and effectively no defender cells - consistent with the engine ignoring it
for projectiles (`0x5a`, `decomp/08259690.c:449`): whoever owns a 90 face takes nothing, whoever
hits it still pays. 99: also engine-special (`081dab40.c:124`), also undefined, on 47
house/ruin meshes. Other undefined ids in meshes: 16, 26, 38, 140, 146, 173.

## 6. Worked examples, recomputed, with the missing half

`damage = attacker.Armor.damageMod * (am + (1-am)*sin(|c|*pi/2)) * victim.speedMod * V^2
* getDamageMod(matAttacker, matVictim) * getDamageForMaterial(matAttacker)`, V = 15 m/s,
c = 1 (factor 1 for any angleMod), every damageMod 1.0, every `getDamageForMaterial` 1.0.
Victim's material = its own side of the contact; moving object = vertex, parked = face.

| case | parked victim takes | **moving vehicle takes** |
|---|---|---|
| Willy -> Spitfire | 2*225*0.1 = **45.0** on face 60/61/63; **0** on face 90 (R4 CONFIRMED) | 1*225*(60\|61\|63\|**90**,45 = 0.1) = **22.5** on every face incl. 90 -> 45 % of 50 HP, 27.5 left (critical 6) |
| Willy -> Sherman | 1*225*0.1 = **22.5** (R4 CONFIRMED) | (50\|51\|52,45) = 0.1 -> **22.5**, 45 % of the jeep |
| Sherman -> Spitfire | **45.0** for vertex 50, 51 or 52 on face 60/61/63; 0 on 90 (R4 CONFIRMED, attacker material generalised) | **22.5** (22.5 % of 100 HP); **0** when a material-52 vertex meets a 61/63 face (no cell) |

So the rammer is never free: the jeep loses as much as the tank it hits, and it pays even on
the Spitfire's "dead" material-90 faces. Contacts through a wheel (37) cost neither side.
Thresholds for the `> 1.0` gate, square hit: Spitfire 2.24 m/s, Willy/Sherman 3.16 m/s, a ship
(speedMod 0.05) 14.1 m/s.

**Spitfire into flat ground, 40 m/s, 30 deg below the horizon.** Angle between velocity and the
surface normal = 60 deg, |c| = 0.5, c^3 = 0.125; speedMod 2; V^2 = 1600; terrain material 0
(any of 0-15 gives the same cells except rock) damage 30:
contact vertex 60 -> 0.125*2*1600*0.01*30 = **120**; vertex 61 or 63 -> *0.1 -> **1200**
(rock id 12 vs 61: 6000); vertex 90 or a wheel (178) -> **0**. The aircraft has 100 HP: fatal
on any hull vertex, and 61/63 vertices are 12 of 16 (LOD 0) or 47 of 83 (LOD 1).
Assumes V is the full contact-point speed as in C9 of L0, not its normal component.

## 7. Not checked
A1 flag bits, the explosion*/water rows of A2, O1, the DC/FH narrative numbers beyond the
damageMod census, the LOD-selection rule, how the console parses `0.1.0`.
