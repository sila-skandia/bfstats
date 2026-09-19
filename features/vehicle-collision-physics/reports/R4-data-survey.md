# R4 — data survey: authored data for collision response/damage, and the `.con` -> engine binding

All addresses `bf1942_lnxded.static` unless marked `client`. Decompiles: the
pre-existing `SP/decomp/*.c` (from the shared project) plus my own copy
`SP/r4-proj` -> `SP/r4-decomp1/*.c`, `SP/r4-decomp2/*.c` (8 + 2 functions I
decompiled for this track — listed in the symbol table). Scripts I wrote are
all under `SP/`, prefixed `r4-`; every number in Part B below was produced by
one of them, not copied by hand. `SP=` the scratchpad path in the briefing.

## Part A — binding: `.con` word -> template field -> engine setter

### A1. `PhysicsNode` fields — verified

**Anchor**: `SimpleObjectTemplate::setPhysicsNodeComponent(ICompositeObject*)`
`0x081dd490` (pre-existing decomp) copies template fields straight into a
freshly-constructed node, and `SimpleObjectTemplate::makeScript(IStream*)`
`0x081dc190` (decompiled this track) prints the same fields back out under
their `.con` names, guarded by an "is this the default" comparison. I read
both, then cross-checked every numeric default against
`SimpleObjectTemplate::SimpleObjectTemplate()` `0x081dbc70` (the constructor,
decompiled this track), which stores the literal default into the same
struct offset. All three sources agree except one field, noted below.

`PhysicsNode` vtable `0x0872df00` (dumped fresh with `vt.py` for this track —
the briefing's slot list is right but I needed exact byte offsets to match
setter calls):
`+0x94` `setDrag(float)`, `+0x9c` `setMass(float)`, `+0x88` `setDragOffset(Vec3&)`,
`+0xa4` `setCenterOfMassOffset(Vec3&)`, `+0xac` `setInertiaModifier(Vec3&)`,
`+0xb4` `setGravityModifier(float)` (present on the vtable, **never called**
from `setPhysicsNodeComponent`).

| `.con` word | template field (byte offset) | PhysicsNode setter | default | evidence |
|---|---|---|---|---|
| `ObjectTemplate.drag` | `+0x44` float | `setDrag` `0x0824d2b0` (vtable+0x94) | **0.0** | ctor `param_1[0x11]=0`; makeScript compares `==0.0`, prints `.drag ` (string `0x086cc6f9`) |
| `ObjectTemplate.dragOffset` | `+0x48` Vec3 | `setDragOffset` `0x0824d3a0` (vtable+0x88) | **(0,0,0)** | ctor `param_1[0x12..0x14]=0,0,0`; makeScript compares each component `==0.0`, prints `.dragOffset ` (string `0x086c8e37`) |
| `ObjectTemplate.mass` | `+0x54` float | `setMass` `0x0824d2d0` (vtable+0x9c) | **1.0** | ctor `param_1[0x15]=0x3f800000`; makeScript compares `==1.0`, prints `.mass ` (string `0x086c8d4e`) |
| `ObjectTemplate.centerOfMassOffset` | `+0x58` Vec3 | `setCenterOfMassOffset` `0x0824d2f0` (vtable+0xa4) | **(0,0,0)** | ctor `param_1[0x16..0x18]=0,0,0`. **makeScript never prints this field at all** — a genuine round-trip gap in the game's own script dumper, not evidence the property doesn't exist (it does — `bfstats`/FHSW author it, see A5). |
| `ObjectTemplate.inertiaModifier` | `+0x64` Vec3 | `setInertiaModifier` `0x0824d320` (vtable+0xac) | **(1,1,1)** | ctor `param_1[0x19..0x1b]=0x3f800000` x3; makeScript compares each `==1.0`, prints `.inertiaModifier ` (string `0x086c8e25`) |
| — (`ObjectTemplate.gravityModifier` exists as a word, see A6) | — | `setGravityModifier` `0x0824d3d0` (vtable+0xb4) | n/a for vehicle bodies | **`setPhysicsNodeComponent` never calls this setter** — read directly in the decompile, no call at vtable+0xb4 anywhere in the function. See correction C2. |
| flags byte `+0x70`, bit 0 | `ObjectTemplate.hasMobilePhysics` | selects `StaticPhysicsNode` (bit clear) vs a real `PhysicsNode`/`PointPhysicsNode` (bit set) | **false** | ctor: `*(byte*)(p+0x70) = (old&0x90)\|0x10` — bit 0 zeroed; makeScript prints `.hasMobilePhysics ` (string `0x086c8e44`) only when the bit is set |
| flags byte `+0x70`, bit 1 | `ObjectTemplate.hasCollisionPhysics` | (consumed by `ResponsePhysics`/`ObjectManager`, not traced this round) | **false** | makeScript prints `.hasCollisionPhysics ` (string `0x086c8e0f`) when set |
| flags byte `+0x70`, bit 2 | `ObjectTemplate.hasResponsePhysics` | ditto | **false** | makeScript prints `.hasResponsePhysics ` (string `0x086c8dfa`) when set |
| flags byte `+0x70`, bit 3 | `ObjectTemplate.hasPointPhysics` (**read, not proven**) | selects `PointPhysicsNode` vs full `PhysicsNode` inside `setPhysicsNodeComponent` | **false** | `"hasPointPhysics"` sits in `.rodata` immediately beside `"hasCollisionPhysics"`/`"hasMobilePhysics"` in the same string family (confirmed with `objdump -s`), and is genuinely authored in 6 of 14 installed mods (0 in vanilla/DC — see A7 counts) always as `hasPointPhysics 0`. I did not find the literal concatenated print string for this specific bit in `makeScript`'s decompiled range, so the bit-index binding is **read**, not objdump-verified against a `test`/`and` instruction. |
| flags byte `+0x70`, bit 6 | `ObjectTemplate.hasDecalEmitter` | unrelated to physics, noted for completeness | **false** | makeScript prints `.hasDecalEmitter ` (string `0x086c8de8`) when set |

Confidence: **verified** for drag/dragOffset/mass/centerOfMassOffset/inertiaModifier
and the hasMobilePhysics/hasCollisionPhysics/hasResponsePhysics bits (two
independent decompiles — constructor literal store and makeScript's
runtime-computed "is this the default" comparison — agree on every value, and
the string names were read byte-for-byte out of `.rodata` with `objdump`, not
guessed from a decompiler string literal). **Read** for the `hasPointPhysics`
bit index and for "gravityModifier is never wired for a vehicle body" (a
confirmed absence, not a positive binding).

### A2. `Armor` fields — verified

**Anchor**: `SimpleObjectTemplate::setArmorComponent(IObject*)` `0x081ddae0`
(decompiled this track) — the best "prints/copies fields back out with their
target" function the briefing asked for, except it's a *copy* anchor rather
than a *print* anchor: it constructs a fresh `Armor` and calls **22** of its
setters, each fed from a fixed `SimpleObjectTemplate` byte offset. I matched
every vtable offset against a fresh `vt.py` dump of `Armor`'s vtable
(`0x0871d220`, 0x164 bytes / 89 slots) to get the setter name, then
cross-checked defaults against the constructor `0x081dbc70` and, where
present, `makeScript`.

| `.con` word | template offset | `Armor` setter (vtable slot) | default | evidence |
|---|---|---|---|---|
| `ObjectTemplate.hasArmor` | `+0x7c` byte | gates whether `setArmorComponent` even builds an `Armor` (this offset itself, read directly in `makeScript`'s own gate at line "`*(byte*)(param_1+0x1f) != 0`") | **false** | ctor `*(byte*)(p+0x7c)=0`; makeScript prints `.hasArmor ` (string `0x086c8d85`) when true |
| `ObjectTemplate.hitPoints`/`hitpoints` | `+0x80` **int** | `setHitPoints(float)` `0x081726c0` (+0x18) | **10** | ctor `param_1[0x20]=10`; makeScript prints `.hitpoints ` (string `0x086c8d90`) when `!=10`. Stored as an integer in the template (cast to float only when handed to `Armor`) |
| `ObjectTemplate.maxHitPoints`/`maxhitpoints` | `+0x84` **int** | `setMaxHitPoints(float)` `0x08173680` (+0x10) | **10** | ctor `param_1[0x21]=10`; makeScript `.maxHitPoints ` (`0x086c8d9c`) when `!=10` |
| `ObjectTemplate.material` | `+0x88` int | not copied into `Armor` by this function at all (see open item O3) | **-1** | ctor `param_1[0x22]=0xffffffff`; makeScript `.material ` (`0x086e1bdf`) when `!=-1` |
| `ObjectTemplate.damageMod` | `+0x8c` float | **`setDamageMod(float)` `0x08173f60` (vtable +0x38)** — the setter behind `Armor::getDamageMod` `+0x3c` | **1.0** | ctor `param_1[0x23]=0x3f800000`. **Never printed by makeScript** (round-trip gap) |
| `ObjectTemplate.angleMod` | `+0x90` float | **`setAngleMod(float)` `0x08173f90` (vtable +0x40)** — the setter behind `Armor::getAngleMod` `+0x44` | **0.0** | ctor `param_1[0x24]=0`. **Never printed by makeScript** |
| `ObjectTemplate.speedMod` | `+0x94` float | **`setSpeedMod(float)` `0x08173fb0` (vtable +0x48)** — the setter behind `Armor::getSpeedMod` `+0x4c` | **0.05** | ctor `param_1[0x25]=0x3d4ccccd` (IEEE-754 0.05). **Never printed by makeScript** |
| `ObjectTemplate.damageFromWater` | `+0xbc` byte | `setDamageFromWater(bool)` (+0x50) | false | ctor 0; makeScript `.damageFromWater ` (`0x086c8fe0`) |
| `ObjectTemplate.waterDamageDelay` | `+0xc0` float | `setWaterDamageDelay(float)` (+0x58) | 0.0 | ctor `param_1[0x30]=0` |
| `ObjectTemplate.criticalDamage` | `+0xd4` float | `setCriticalDamage(float)` (+0x28) | **0.0** | ctor `param_1[0x35]=0`; makeScript `.criticalDamage ` (`0x086c8dd7`) when `!=0` |
| `ObjectTemplate.explosionRadius` | `+0xdc` float | `setExplosionRadius(float)` (+0x98) | **15.0** | ctor `0x41700000`; makeScript checks `!=15.0` |
| `ObjectTemplate.explosionDamage` | `+0xe0` float | `setExplosionDamage(float)` (+0x140) | **10.0** | ctor `0x41200000`; makeScript checks `!=10.0` |
| `ObjectTemplate.explosionMaterial` | `+0xe4` int | `setExplosionMaterial(int)` (+0xa0) | **204** | ctor `0xcc`; makeScript checks `!=10` (decimal) [material id, no effect at these damage numbers per Part B] |
| `ObjectTemplate.explosionForce` | `+0xe8` float | `setExplosionForce(float)` (+0xa8) | **150.0** | ctor `0x43160000` |
| `ObjectTemplate.explosionForceMod` | `+0xec` float | `setExplosionForceMod(float)` (+0xb0) | **1.0** | ctor `0x3f800000` |
| `ObjectTemplate.explosionForceMax` | `+0xf0` float | `setExplosionForceMax(float)` (+0xb8) | **300.0** | ctor `0x43960000` |
| `ObjectTemplate.hpLostWhileCriticalDamage` | `+0xf8` float | `setHpLostWhileCriticalDamage(float)` (+0xd0) | **see note** | ctor stores `0x3f800000` = **1.0** literally, but `makeScript`'s "is this the default" test compares against **`0.1/g_simulationFps`** (≈0.00333) — the two sources disagree; see open item O1 |
| `ObjectTemplate.hpLostWhileUpSideDown` | `+0xfc` float | `setHpLostWhileUpSideDown(float)` (+0xd8) | **1.0** | ctor `0x3f800000`; not printed by makeScript's excerpt |
| `ObjectTemplate.hpLostWhileDamageFromWater` | `+0x100` float | `setHpLostWhileDamageFromWater(float)` (+0xe0) | **1.0** | ctor `0x3f800000` |
| `ObjectTemplate.canBeRepairedAndDestroyed`(name inferred from setter) | `+0x106` byte | `setCanBeRepairedAndDestroyed(bool)` (+0xec) | false | ctor zeroes `+0x105..+0x107` |
| `ObjectTemplate.hpLostWhileDamageFromDeepWater` | `+0x118` float | `setHpLostWhileDamageFromDeepWater(float)` (+0x108) | 0.0 (inferred, not individually confirmed) | field present in copy list |
| `ObjectTemplate.damageFromDeepWater` | `+0x11c` byte | `setDamageFromDeepWater(bool)` (+0x110) | false | field present in copy list |
| `ObjectTemplate.deepWaterLevel` | `+0x120` float | `setDeepWaterLevel(float)` (+0x100) | 0.0 (inferred) | field present in copy list |
| `ObjectTemplate.deepWaterDamageDelay` | `+0x124` float | `setDeepWaterDamageDelay(float)` (+0x118) | 0.0 (inferred) | field present in copy list |

**This directly answers the briefing's named targets**: `Armor::getDamageMod`
`+0x3c` <- `ObjectTemplate.damageMod` (default **1.0**); `Armor::getAngleMod`
`+0x44` <- `ObjectTemplate.angleMod` (default **0.0**); `Armor::getSpeedMod`
`+0x4c` <- `ObjectTemplate.speedMod` (default **0.05**).

Confidence: **verified** for damageMod/angleMod/speedMod/hitPoints/maxHitPoints/
hasArmor/criticalDamage/the explosion\* block (constructor and, where
makeScript covers the field, the print-skip comparison agree — cross-checked
by two independently-decompiled functions, per the briefing's own
discipline). **Read** for the four water/deep-water fields at the tail of the
copy list — their default is inferred from "constructor never touches this
word explicitly after the block zero" rather than an isolated literal I
individually confirmed.

### A3. `Armor::update` in `giveDamage`'s dispatch — not part of this track's binding, cross-referenced

`GameServer::giveDamage` `0x0814b2e0` and `GameServer::handleCollisionObjectVsObject`
`0x081551c0` are shared ground with the lead's own reading (`SP/reports/L0-lead-response-and-damage.md`,
claim C8, objdump-checked at `0x815585a-0x8155867` and `0x8155870-0x81558d6`).
I independently decompiled and read `0x081551c0` for this track (see A4) and
it matches L0's C8 formula exactly, term for term — good cross-confirmation,
not a duplicate claim.

### A4. The object-vs-object collision damage formula — read, cross-confirmed against an objdump-checked independent report

I decompiled and read `GameServer::handleCollisionObjectVsObject`
`0x081551c0` myself (it was already in the shared `SP/decomp/`). It resolves
the **VICTIM's** nearest `Armor` (`queryComponent(0xc4a4)` walked up the
composite-object tree); if none, or `isDestroyed()`, only the collision
*effect* plays (`materialManager.getEffectTemplate(matAttacker, matVictim, c)`,
vtable `+0x50`) and the function returns — **no hit-point cost**. Otherwise,
for a non-soldier victim (soldier victims take a separate branch with an
8 m/s floor and kit-damping, not this track's focus):

```
c      = |normalize(speed) . normalize(normal)|      // fStack_1b0
V      = |speed|                                     // fStack_1b4, speed = the
                                                       // relative closing-speed
                                                       // vector handed to
                                                       // handleCollision, NOT
                                                       // scaled by mass share
angleFactor = victimArmor.angleMod
            + (1 - victimArmor.angleMod) * sin(clamp(c * pi/2, -1000, 1000))
attackerDamageMod = attackerArmor ? attackerArmor.getDamageMod() : 1.0
damage = attackerDamageMod
       * angleFactor
       * victimArmor.getSpeedMod() * V * V
       * MaterialManager.getDamageMod(matAttacker, matVictim)   // vtable+0x4c
       * MaterialManager.getDamageForMaterial(matAttacker)      // vtable+0x54
if damage > 1.0:
    giveDamage(victimArmor.getObject(), damage, attackerPlayerId, attackerTeam,
               -1, (0,0,0), matVictim, true, true)   // GameServer vtable+0x15c
```

`matAttacker`/`matVictim` are the collision-vertex/collision-face material ids
at the actual hit point (Part B.3), **not** a single per-object scalar — see
the Spitfire/Sherman collision-mesh survey below.

**A clean consequence worth flagging for the JS port**: for a perfectly
square hit (`c = 1`, velocity parallel to the face normal),
`angleFactor = angleMod + (1-angleMod)*sin(pi/2) = angleMod + (1-angleMod) = 1`
**for every value of `angleMod`** — the victim's `angleMod` only matters for
glancing hits, never for a square one. And **damage does not depend on either
object's mass at all** — mass only feeds the separate physical-push formula
(`impulseOn`/`solveImpulse`, briefing 4.2-4.5, and L0 claims C1-C5), which is
a genuinely different code path from this one. A re-implementation that
scales damage by a mass ratio would be inventing a term the engine does not
have.

Confidence: **read**, cross-confirmed term-for-term against L0's independently
objdump-verified C8 (same formula, same vtable offsets, same `>1.0` gate,
same swapped-argument `giveDamage` call). I did not re-run objdump myself on
this function; L0 already did the sign/branch-direction work the briefing
requires, and I did not find a discrepancy.

### A5. `MaterialManager` — verified

**Anchor**: `MaterialManager::dumpMaterialList()` `0x08175360` (decompiled
this track) — the actual "print fields back out with their `.con` names"
function the briefing asked for. It writes a *replayable script* to
`Logs/materialList.con` (string `0x086c2093`, confirmed with `objdump`), one
block per material and one block per populated cell. I resolved every format
string it uses directly out of `.rodata` with `objdump -s`:

```
MaterialManager.material %d\n            (0x086c20a9)
MaterialManager.attGroup %d\n            (0x086c20c6)   -- also the *cell* selector
MaterialManager.materialDefGroup %d\n    (0x086c2100)
MaterialManager.materialAttGroup %d\n    (0x086c2140)
MaterialManager.materialDamage %f\n      (0x086c2180)
MaterialManager.materialFriction %f\n    (0x086c21c0)
MaterialManager.materialElasticity %f\n  (0x086c2200)
MaterialManager.materialResistance %f\n  (0x086c2240)
MaterialManager.setCell %d %f\n          (0x086c2280)   -- (defGroup, damageMod) under the current attGroup
MaterialManager.setEffectTemplate %s %f\n(0x086c22a0)
```

I then pulled the **real** files the engine actually loads
(`Bf1942/Game/materialManagerdefine.con`, `Bf1942/Game/materialManagerSettings.con`,
found by recursively globbing `Archives/**/*.rfa` — a shallow `Archives/*.rfa`
glob, which is what the existing `con_properties.py` template uses, **misses
these**, since they live one directory deeper at `Archives/bf1942/Game.rfa`;
see corrections C1) and they use **`MaterialManager.damageMod`**, not
`setCell`, as the actual authored word — `setCell` is the C++ method name,
`damageMod` is the `.con` property bound to it (the same
"different-name-than-the-method" pattern as `Armor.material` vs the
`Armor::setMaterial` C++ method). Structure, confirmed by reading the files:

```
MaterialManager.material <id>            -- selects "current material" context
MaterialManager.materialAttGroup <id>    -- (defaults to <id> itself, always, in every file)
MaterialManager.materialDefGroup <id>    -- (ditto)
MaterialManager.materialDamage <f>
MaterialManager.materialFriction <f>     -- terrain materials 0-15 only, see Part B.1
MaterialManager.materialElasticity <f>
MaterialManager.materialResistance <f>

MaterialManager.attGroup <att>           -- selects "current attGroup" context
MaterialManager.defGroup <def>           -- cell key
MaterialManager.damageMod <f>            -- writes cell(att, def) = f
MaterialManager.setEffectTemplate <name> -- writes the effect for cell(att, def)
```

`MaterialManager` vtable `0x0871d3a0` (briefing table, cross-checked):
`+0x20 getSpeedDamageMod`, `+0x24`-equivalent field (**`+9`th word = byte
offset `0x24`**) `getDefaultDamageMod`, `+0x4c getDamageMod(att,def)`, `+0x50
getEffectTemplate(att,def,severity)`, `+0x54 getDamageForMaterial(id)`, `+0x58
getFrictionForMaterial(id)`, `+0x5c getElasticityForMaterial(id)`, `+0x60
getResistanceForMaterial(id)`.

`getDamageMod`/`getFrictionForMaterial`/`getElasticityForMaterial`/
`getDamageForMaterial` (`0x08175040`, `0x081751b0`, `0x081751f0`, `0x08175170`,
all decompiled/read, pre-existing) share one fallback shape:
`getMaterialPtr(id)` (vtable `+0x14`) -> if not found, `getMaterialPtr(0)`
(the always-present terrain "Default" material) -> if that fails too, a
**hardcoded** literal (`1.0` for friction/elasticity/resistance, `0.0` for
damage). `getDamageMod(att,def)` additionally calls `getCreateCell` (vtable
`+0x44`) on the two materials' looked-up records; if the *cell itself* is
absent (materials exist, but no `(att,def)` entry was ever written) it
returns **`MaterialManager::getDefaultDamageMod()`** (`param_1[9]`, byte
offset `0x24`), not the material's own damage.

`MaterialManager::MaterialManager()` `0x081747f0` (decompiled this track) —
the global singleton's constructor — gives the two engine-wide defaults the
briefing asked for directly as literal stores:

```
+0x20  speedDamageMod    default 0x3dcccccd = 0.1     (param_1[8])
+0x24  defaultDamageMod  default 0x00000000 = 0.0     (param_1[9])
```

**`defaultDamageMod = 0.0` is the load-bearing number for Part B.4**: any
`(attGroup, defGroup)` pair nobody ever tabulated a cell for deals **zero**
object-vs-object collision damage, by construction, in vanilla and in every
installed mod (`speedDamageMod`/`defaultDamageMod` are never authored
anywhere — Part B.1's cross-mod count). I did not, in the time available,
trace where `getSpeedDamageMod()` (`+0x20`) is actually *consumed* — it is
never called from `handleCollisionObjectVsObject` (A4), so it is not part of
the object-vs-object vehicle-collision formula; open item O2.

Confidence: **verified** for the `.con` word list (read directly out of
`.rodata`, cross-checked against the real shipped `.con` files, which use
exactly these words) and for the two `MaterialManager` global defaults
(single literal store in the constructor, no ambiguity). **Read** for the
fallback chain shape (I did not objdump the branch structure, but it has no
sign-sensitive comparisons — only pointer-null checks).

## Part A — symbol table

| Address | Name | Note |
|---|---|---|
| `0x081dc190` | `SimpleObjectTemplate::makeScript(IStream*)` | decompiled this track; prints `.con` names, guarded by default-comparisons |
| `0x081ddae0` | `SimpleObjectTemplate::setArmorComponent(IObject*)` | decompiled this track; the template->Armor field-copy anchor |
| `0x081dbc70` | `SimpleObjectTemplate::SimpleObjectTemplate()` (ctor, primary) | decompiled this track; literal field defaults |
| `0x081dbf00` | `SimpleObjectTemplate::SimpleObjectTemplate()` (ctor, delegating) | decompiled this track; not separately useful |
| `0x081dd020` | `SimpleObjectTemplate::createObject() const` | decompiled this track; not used in the end |
| `0x081dd100` | `SimpleObjectTemplate::setPhysicsComponent(IObject*) const` | decompiled this track; sets `ResponsePhysics`, not `Armor`/`PhysicsNode` — not used |
| `0x081dd490` | `SimpleObjectTemplate::setPhysicsNodeComponent(ICompositeObject*) const` | pre-existing decomp; the mass/drag/inertia/centerOfMass binding anchor |
| `0x08173f10` | `Armor::init(IObject*)` | decompiled this track; just stores the owning object pointer, no defaults |
| `0x08175360` | `MaterialManager::dumpMaterialList()` | decompiled this track; the material print anchor |
| `0x081747f0` | `MaterialManager::MaterialManager()` (ctor) | decompiled this track; `speedDamageMod`/`defaultDamageMod` literal defaults |
| `0x08174c60` | `MaterialManager::getCreateCell(uint att, uint def)` | pre-existing decomp; the (att,def)->MMCell nested-map lookup/insert |
| `0x08174f60` | `MaterialManager::getCreateCell()` | pre-existing decomp; no-arg overload using "current" att/def context fields (`param_1[6]`/`param_1[7]`) |
| `0x081752b0` | `MaterialManager::setCell(uint, float)` | pre-existing decomp; the `.con` `setCell`/`damageMod` writer |
| `0x08175040` | `MaterialManager::getDamageMod(uint,uint)` | pre-existing decomp; fallback chain ending at `defaultDamageMod` |
| `0x081751b0`/`0x081751f0`/`0x08175230`/`0x08175170` | `getFrictionForMaterial`/`getElasticityForMaterial`/`getResistanceForMaterial`/`getDamageForMaterial` | pre-existing decomp; shared fallback shape |
| `0x081761a0`/`0x08176180` | `getDefaultDamageMod()`/`getSpeedDamageMod()` | pre-existing decomp; one-line field reads |
| `0x081551c0` | `GameServer::handleCollisionObjectVsObject(...)` | pre-existing decomp, read this track; the damage formula, cross-confirmed vs L0 C8 |
| `0x0872df00` | `PhysicsNode` vtable | dumped fresh with `vt.py` for exact offsets |
| `0x0871d220` | `Armor` vtable | dumped fresh with `vt.py` for exact offsets (89 slots) |
| `0x0871d3a0` | `MaterialManager` vtable | briefing table, cross-used |
| `0x0824d2b0`..`0x0824d410` | `PhysicsNode::set/getDrag/Mass/DragOffset/CenterOfMassOffset/InertiaModifier/GravityModifier/HasSeparatePhysicsUpdate` | weak (`W`) symbols, read via `nm`, confirmed against the vtable dump |

## Part A — corrections to the briefing / existing corpus

**C1. `Archives/*.rfa` globs miss nested archives.** The existing
`features/viewer-collision-damage/surveys/con_properties.py` template (and
by extension its README's "leads already pulled") globs
`(MODS/mod/"Archives").glob("*.rfa")` — non-recursive. `bf1942`'s `Game.rfa`
(which holds `Bf1942/Game/materialManagerdefine.con`,
`materialManagerSettings.con`, and every `damage_system/*.con`/
`Collision_Armor/*.con` cell-table file) lives at
`Archives/bf1942/Game.rfa`, one directory deeper, and is silently skipped.
Every script in this report uses `.rglob("*.rfa")` instead. This means the
existing README's material-table absence claim ("There is no `collisionDamage`
property... whatever produces it is engine-internal or derived from
material") was drawing on an incomplete file set — the material damage-mod
table *is* authored, in a file the survey tool never opened.

**C2. `gravityModifier` is authored 12,009 times across the installed mods
(Part B.1) but is never wired into a `SimpleObjectTemplate`-driven vehicle's
`PhysicsNode`** — confirmed by reading `setPhysicsNodeComponent` and finding
no call to the vtable `+0xb4` setter anywhere in the function, for any of its
three branches (static/full/point). Every example I found (`e_OilFire`,
generic `effects.con`) is a `ParticleTemplate`, which has its own, unrelated
`setGravityModifier(ContRandDist, float, float, bool)` (different arity — a
random-distributed *effect* property, not a physics-node scalar). This is
not a correction to a specific existing claim, but it forecloses a plausible
guess ("vehicles can author reduced gravity") that a browser port might
otherwise reach for.

**C3. `handleCollisionObjectVsObject` does cost hit points** — this is the
same correction the briefing's section 4 item 7 already flags against
`features/viewer-collision-damage/README.md`'s behaviour-#1 verdict ("A
collision never costs hit points... ledger HP-6, closed in the negative")
and `subsystems/hitpoints-and-damage.md` §3. I independently decompiled and
read `0x081551c0` for this track (A4) without first reading the briefing's
own claim in detail, and reached the identical conclusion, then found it
matches L0's objdump-verified C8 exactly. Three independent readings
(briefing lead, L0, this track) now agree; the existing corpus row (HP-6)
needs to flip, as the briefing already says.

## Part A — open items

**O1. `hpLostWhileCriticalDamage`'s default is inconsistent between its own
two sources.** `SimpleObjectTemplate`'s constructor stores the literal `1.0`
into the field (`+0xf8`); `makeScript`'s print-skip test instead compares the
live value against `0.1 / g_simulationFps` (≈0.00333, i.e. "no HP loss in a
tenth of a real second" at the fixed 30 Hz tick) to decide whether to print
it. I have not resolved which one actually gates the console `Armor` field's
runtime default when the property is never authored, and it matters — every
vanilla vehicle I surveyed authors this property explicitly (Part B.2), so
resolving it needs either a non-vanilla template that omits it, or tracing
`Armor::update`'s use of the field directly. Best next step: `nm`/decompile
whichever function reads `Armor+`(the byte offset behind
`getHpLostWhileCriticalDamage`) inside the 1 Hz critical-damage tick the
existing corpus already found (`hitpoints-and-damage.md` §3/§8), and read the
literal it compares against, in `objdump`.

**O2. `MaterialManager::getSpeedDamageMod()` (`+0x20`, default `0.1`) is never
called from the object-vs-object collision path** (A4/A5). Its `.con` word is
never authored anywhere (Part B.1), so I don't have a live example to grep
for its call site. Best next step: `xrefs 0x08176180` (the getter) via the
Ghidra bridge/`nm` xref search over the whole binary — I did not do this
within budget; it is very likely used in `GameServer::handleCollisionLandOrWater`
(0x08154960, L0's C9 — the terrain-collision branch, not the object-vs-object
one this track covered) or in the projectile-splash-damage path.

**O3. `ObjectTemplate.material` (template offset `+0x88`, default `-1`) is
copied into nothing by `setArmorComponent`** — it is read by *some* other
function (not traced this round) that plainly makes it act as the object's
"own" collision material, since it correlates almost perfectly with the
Willy hull's single collision material id (Part B.3: Willy's mesh is 100%
material 45, matching `ObjectTemplate.material 45`), but *not* with Sherman's
or Spitfire's (whose meshes carry 3-4 distinct per-face material ids while
the scalar authors just one of them). Best next step: `xrefs` on the field
read (I don't have its address — would need Ghidra's structure-field xref,
not a symbol xref) or decompiling `SimpleObject::createObject`/geometry-load
path to see if it's a per-vertex-material fallback for faces that don't
specify their own.

**O4. Friction/elasticity/resistance for the ~135 "damage-class" materials
(ids 39+, i.e. every vehicle/weapon material) are never authored** — only
the 16 terrain materials (0-15) and a handful of "Basic"/"Building" ones set
them (Part B.1: 20 of 155 materials total). Since `getMaterialPtr(45)`
*succeeds* (material 45 exists, just with unset friction fields), the
fallback-to-material-0 path in `getFrictionForMaterial` etc. is **not**
taken — the returned value is whatever `Material`'s own C++ constructor
default-initializes those fields to. I did not decompile the `Material`
class's constructor (distinct from `MaterialManager`'s) to pin this down; it
matters for the physical push (`impulseOn` averages friction/elasticity/
resistance over the two materials, briefing 4.3/L0 C3) in any vehicle-vehicle
collision, though not for the damage number itself.

**O5. `hasPointPhysics`'s bit index (bit 3 of the `+0x70` flags byte) is
positional/`nm`-string-family inference, not an `objdump`-confirmed `test`
instruction.** It is real — genuinely authored in FH/FHSW/GCMOD/WarFront/
bf1918/bfheroes/bg42 (31 occurrences, Part B.1) — I just didn't trace the
`and`/`test` mask in `setPhysicsNodeComponent`'s branch (`bVar2 = ...&1`,
`(...>>3&1)`) down to a byte-for-byte proof that this specific word sets that
specific bit versus one of the neighbouring undocumented flags in the same
byte.

## Part A — JS re-implementation notes (30 Hz fixed tick)

- Store `mass`, `drag`, `dragOffset` (Vec3), `centerOfMassOffset` (Vec3),
  `inertiaModifier` (Vec3) per physics node, defaulting to `1, 0, (0,0,0),
  (0,0,0), (1,1,1)` respectively when a vehicle template doesn't author them
  — **do not** default `dragOffset` to anything but zero (a plausible
  "matches inertiaModifier's (1,1,1)" guess is wrong, per A1).
- Store `hitPoints`/`maxHitPoints` (10/10 default, but every real vehicle
  authors both), `speedMod` (**0.05** default — very small; almost every
  vehicle overrides it, see Part B.2's spread of 0.05-2.0), `angleMod`
  (**0.0** default), `damageMod` (**1.0** default) per `Armor`.
- Collision-damage formula (A4) needs, per contact: the two collision-face
  material ids (not a per-object scalar — build a per-face material table
  from the `.sm` collision layer, Part B.3), the relative closing speed
  vector at the hit point, and the hit normal. It does **not** need either
  object's mass.
- The `(attGroup, defGroup) -> damageMod` cell table is sparse by design —
  missing pairs are **zero damage**, not "some sensible fallback". Any
  browser reimplementation that fills gaps with `1.0` or with the attacker's
  `materialDamage` will over-damage real gaps like Spitfire's material 90
  (Part B.4).
- `angleFactor` collapses to exactly `1.0` for a square hit regardless of
  `angleMod` — cheap to special-case (`if (Math.abs(cosTheta) >= 1) return 1`)
  instead of running `Math.sin` every contact.
- Mass only feeds the impulse/push math (out of this track's scope, see
  briefing 4.2-4.5 and L0 C1-C5), computed completely separately from
  damage. Keep them as two independent functions in the port; conflating
  them is the most likely place to introduce a wrong-feeling "heavy vehicles
  hit harder" rule the real engine does not have.

---

## Part B — game data survey

All numbers below came out of scripts under `SP/`, run against
`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/*/Archives/**/*.rfa` via
`tools/bf1942-models/bf42/rfa.py` + `bf42/stdmesh.py`. Scripts (all
`SP/r4-*.py`, prefixed per the briefing):

- `r4-dump-file.py <mod> <archive-path>` — dumps one file's raw bytes (used to
  pull `materialManagerdefine.con`, `materialManagerSettings.con`, vehicle
  `Objects.con`/`Physics.con`).
- `r4-find-vehicles.py`, `r4-find-materials.py`, `r4-list-all-material-files.py`,
  `r4-grep-content.py` — file-listing/content-grep helpers used to locate the
  real material-settings files (correction C1).
- `r4-build-cell-table.py <mod>` — recursively follows every `run <file>`
  directive starting at `materialManagerSettings.con`, replaying the
  engine's own "current attGroup/defGroup context" console semantics to
  build the full `(att,def)->damageMod`/`effect` cell table, plus parses
  `materialManagerdefine.con` into a material-identity table.
- `r4-vehicle-survey.py <mod>` — walks every `Objects/Vehicles/**/Objects.con`,
  isolates the first `ObjectTemplate.create PlayerControlObject <Name>`
  block (root vehicle body only — stops at the next `.create`), and
  regex-extracts the physics/Armor fields from Part A.
- `r4-collision-materials.py <mod> <sm-file>...` — parses `.sm` files with
  `bf42.stdmesh` and histograms `CollisionFace.material_id` per collision
  layer.
- `r4-cross-mod-count.py` — counts `ObjectTemplate.<field>` occurrences
  across all 16 installed mod directories (the "measure, don't assume"
  requirement).

### B1. The complete vanilla material table

`Bf1942/Game/materialManagerdefine.con` (via `Game.rfa`, found only after
fixing the `Archives/**` glob, C1) defines **155 materials**, ids 0-257
(non-contiguous — gaps exist, e.g. no 16-38, no 71, no 73-78, no 99, no
120-164 except none, etc.). Only **20 of 155** author
friction/elasticity/resistance — the 16 terrain surfaces plus grenades (70)
and three "stairs" materials (96/97/98). Every other material (vehicles,
weapons, splash damage, buildings — ids 39-255ish, 135 of them) authors only
`materialDamage`, and exists purely as a key into the `(attGroup,defGroup)`
cell table (open item O4 on what friction/elasticity/resistance actually
resolve to for those).

The 16 terrain materials in full (id, name from the file's own `rem`
comments, damage, friction, elasticity, resistance):

| id | name | damage | friction | elasticity | resistance |
|---|---|---|---|---|---|
| 0 | Default/ground | 30.0 | 1.0 | 0.0 | 0.02 |
| 1 | Water | 30.0 | 0.1 | 0.0 | 0.1 |
| 2 | Dry grass | 30.0 | 0.8 | 0.0 | 0.06 |
| 3 | Juicy grass | 30.0 | 0.8 | 0.0 | 0.08 |
| 4 | Dry dirt | 30.0 | 1.0 | 0.0 | 0.04 |
| 5 | Wet dirt | 30.0 | 0.8 | 0.0 | 0.06 |
| 6 | Mud | 30.0 | 0.5 | 0.0 | 0.1 |
| 7 | Reserved (outside map) | 30.0 | 0.5 | 0.0 | 0.08 |
| 8 | Gravel | 30.0 | 1.1 | 0.0 | 0.02 |
| 9 | Frozen ground | 30.0 | 0.8 | 0.0 | 0.05 |
| 10 | Dry sand (El Alamein) | 30.0 | 0.8 | 0.0 | 0.05 |
| 11 | Wet sand | 30.0 | 0.8 | 0.0 | 0.04 |
| 12 | Rock (Omaha beach) | 30.0 | 0.6 | 0.0 | 0.01 |
| 13 | Sand road | 30.0 | 1.0 | 0.0 | 0.02 |
| 14 | Dirt road | 30.0 | 1.0 | 0.0 | 0.02 |
| 15 | Paved road | 30.0 | 1.1 | 0.0 | 0.01 |

Selected "damage-class" materials relevant to Part B.3/B.4's vehicles (id,
section label from the file, `materialDamage` — friction/elasticity/
resistance all unauthored, O4):

| id | section | damage |
|---|---|---|
| 45 | Armor (light — Willy's own `ObjectTemplate.material`) | 1.0 |
| 50 | Armor (Sherman's own material) | 1.0 |
| 51, 52 | Armor (also on Sherman's hull mesh, undocumented individually) | 1.0 |
| 55 | Armor (naval — Enterprise/Yamato-class) | 1.0 |
| 57 | Armor (submarine) | 1.0 |
| 60, 61, 63 | Armor (aircraft — Spitfire's own material + two more on its mesh) | 1.0 |
| 85 | (Willy's wreck mesh material — distinct from the live vehicle's 45) | 1.0 |
| 90 | Basic Materials (on 33% of Spitfire's outer fuselage faces, no damage-mod cell exists against 45/50 — B4) | 1.0 |
| 37 | (Willy's wheel collision material — **never defined anywhere in vanilla**, falls back to material 0) | n/a |

**Default damage mod / speed damage mod**: `MaterialManager.damageMod`
(the property; `setCell` is the underlying C++ method, A5) and
`MaterialManager.setSpeedDamageMod`/`setDefaultDamageMod` are **never
authored** — measured with `r4-cross-mod-count.py` extended to those two
literal words across all 16 mod directories: **zero hits everywhere**. Both
stay at their engine constructor defaults (A5): `speedDamageMod = 0.1`,
`defaultDamageMod = 0.0`.

**The cell table**: starting from `materialManagerSettings.con` and
following every `run <file>` directive (41 files total in vanilla —
`damage_system/*.con` per weapon class plus `Collision_Armor/{Light,Heavy,No,
Plane,PTRaft}Armor.con`, 10 of the 51 `run` targets referenced don't
actually exist in vanilla's archives, e.g. `damage_system/BF110.con` —
leftover from an "Expack" block that ships with `WarFront`/`XPack2` instead),
`r4-build-cell-table.py` recorded **5,928 `MaterialManager.damageMod` writes**
across **5,165 distinct `(attGroup,defGroup)` pairs** (some pairs get
overwritten more than once by different `run` files — last-write-wins,
matching the engine's own `setCell` semantics, which just overwrites the
map entry).

One data quirk worth flagging: `materialManagerSettings.con` line 2132
(`attGroup 203`/`defGroup 45-49`) authors **`MaterialManager.damageMod
0.1.0`** — a literal typo in the shipped vanilla file. The engine's C
string-to-float parser (`atof`/`strtod`) stops at the second `.` and yields
`0.1`; my parser mimics that (`FLOAT_TOKEN_RE`) rather than rejecting the
line.

### B2. Vehicle survey: mass / inertiaModifier / drag / Armor fields / hit points

`r4-vehicle-survey.py` found **50 vanilla root vehicle bodies** (land/air/sea),
**57 DesertCombat**, and a large FH set (sea sample shown below, truncated).
Full vanilla table (mass kg, drag, inertiaModifier if authored, Armor
speedMod/angleMod, hitPoints, material, criticalDamage,
hpLostWhileCriticalDamage):

| Vehicle | Category | mass | drag | inertiaModifier | speedMod | angleMod | HP | material | criticalDamage | hpLost/crit |
|---|---|---|---|---|---|---|---|---|---|---|
| Willy | Land | 2500 | 1.5 | — (default 1,1,1) | 1 | — (default 0) | 50 | 45 | 6 | 2 |
| Kubelwagen | Land | 2500 | 1.5 | — | 1 | — | 50 | 45 | 6 | 2 |
| KettenKrad | Land | 2500 | 3.5 | — | 1 | — | 50 | 45 | 8 | 2 |
| Lynx | Land | 3600 | 1.5 | — | 1 | — | 60 | 45 | 8 | 2 |
| m3a1 | Land | 15000 | 2 | — | 2 | — | 100 | 45 | 16 | 1.5 |
| Hanomag | Land | 15000 | 2 | — | 2 | — | 100 | 45 | 16 | 1.5 |
| Ho-Ha | Land | 15000 | 2 | — | 2 | — | 100 | 45 | 16 | 1.5 |
| Katyusha | Land | 4500 | 2 | — (dragOffset 0/0/0 explicit) | 2 | — | 50 | 45 | 6 | 1 |
| Wespe | Land | 25000 | 8 | — | 2 | — | 50 | 45 | 12 | 2 |
| Priest | Land | 25000 | 2 | — | 2 | — | 50 | 45 | 12 | 2 |
| Sexton | Land | 25000 | 2 | — | 2 | — | 50 | 45 | 12 | 2 |
| Sherman | Land | 25000 | 2 | — | 1 | — | 100 | 50 | 12 | 1.5 |
| PanzerIV | Land | 25000 | 2 | — | 1 | — | 100 | 50 | 12 | 1.5 |
| Chi-ha | Land | 25000 | 2 | — | 1 | — | 100 | 50 | 12 | 1.5 |
| M10 | Land | 25000 | 2 | — | 0.75 | — | 100 | 50 | 12 | 1.5 |
| T34 / T34-85 | Land | 25000 | 2 | — | 0.75 | — | 100 | 50 | 12 | 1.5 |
| Tiger | Land | 25000 | 2 | — | 0.75 | — | **125** | 50 | 12 | 1.5 |
| BlackMedal (motorcycle) | Land | 2500 | 1.5 | — | 1 | — | 50 | 45 | 6 | 2 |
| AA_Allies, Defgun, flak38 | Land (static defense) | **none authored** | **none authored** | — | — | — | 50-100 | 45/50 | 0-12 | 0-1.5 |
| Spitfire | Air | 2500 | 0.09 | **0.85/0.833/0.84** | **2** | **1** | 100 | 60 | 20 | 1.5 |
| Mustang, Corsair, BF109, Yak9, Zero | Air | 2500 | 0.061-0.105 | authored | 2 | 1 | 100 | 60 | 20 | 1.5 |
| AichiVal, Ilyushin, Stuka, SBD | Air | 3000 | 0.061-0.08 | authored | 2 | 1 | 130 | 60 | 20 | 1.5 |
| B17 | Air | **25000** | 0.125 | 0.6/0.6/0.3 | 2 | 1 | **450** | 60 | 60 | 4 |
| Enterprise, Shokaku (carriers) | Sea | **25,000,000** | 2.6/1.97 | — | — | — | 600 | 55 | 100 | 1.5 |
| Yamato, PrinceOW (battleships) | Sea | **35,000,000** | 2.6-3.25 | — | — | — | 500-600 | 55 | 100 | 5 |
| Fletcher, Hatsuzuki (destroyers) | Sea | 2,500,000 | 0.92-3 | — | — | — | 300 | 55 | 50 | 5-10 |
| Gato, Sub7C (submarines) | Sea | **800,000** | 0.2-0.5 | — | **0.05** | — | 200 | 57 | 100 | 1.5 |
| Elco80, Type38 (PT boats) | Sea | 40000/20450 | 0.6/1.2 (dragOffset `0/0/-1` explicit) | — | 0.7 | — | 500 | 45 | 350 | 40 |
| Elco80Raft, Type38Raft | Sea | 5000 | 0.999 | — | 1.0 | — | 35 | 45 | 10 | 0.75 |
| Lcvp, Daihatsu | Sea | 30000 | 0.42-0.488 | — | — | — | 150 | 45 | 50 | 1.5 |

**Outliers flagged, per the briefing's "flag outliers" instruction:**

- **`mass`/`drag` missing entirely** on `AA_Allies`, `Defgun`, `flak38`,
  `AA_Enterprise` — these are static defense guns; without `hasMobilePhysics`
  they get the `StaticPhysicsNode` branch of `setPhysicsNodeComponent` (A1),
  which never calls `setMass`/`setDrag`/etc. at all — the fields are
  irrelevant, not merely defaulted.
- **`angleMod` and `inertiaModifier` are authored on every air vehicle and
  zero land/sea vehicles in vanilla.** All 12/12 vanilla aircraft author both;
  0/35 land vehicles and 0/13 sea vehicles do. This is a real structural
  split, not a sampling artifact — confirmed by the cross-mod count (B1's
  DC/FH sample below shows the same split, with only 2 DC land exceptions,
  both guided-rocket *projectiles*, not driveable vehicles).
- **`damageMod` is authored twice in all of vanilla+DC/DesertCombat/FH
  combined for vehicle-shaped objects, both on the same object**:
  `SA-3GuidedRocket` (DC/DC_Final), `damageMod 0.1` — a self-propelled
  guided missile, presumably to blunt its own collision self-damage while
  it burns through its own booster stage. Every other vehicle in all three
  mods leaves it at the 1.0 default.
- **Mass spans 8 orders of magnitude** (2500 kg Willy to 52,000,000 kg
  Bismarck/Tirpitz in FH) with **no corresponding spread in the damage
  formula**, because mass never enters it (A4) — a design choice, not
  something the port needs to reconcile.

DesertCombat sample (57 found; land/air shown, sea overlaps heavily with
vanilla's own ids reused): modern aircraft keep the same 0.061-ish drag/
`inertiaModifier≈0.95,0.94,0.97` shape as vanilla's WW2 fighters almost
exactly (A10 `0.95/0.943/0.968`, identical to vanilla's AichiVal/Ilyushin/
Stuka/SBD) — strongly suggests these values were copy-pasted from a shared
"generic fighter" template rather than tuned per-aircraft.

FH sample (naval-heavy tail of the listing, 51 sea vehicles found): FH's
Bismarck/Tirpitz reach **mass 52,000,000 kg**, hitPoints **22,900**,
criticalDamage **2,290** — FH scales the whole damage envelope up roughly
10x over vanilla's battleship-class Yamato (35,000,000 kg / 600 HP), while
keeping the same `damageMod`/`angleMod` authoring pattern (never authored on
ships) as vanilla.

### B3. Collision-mesh materials — Willy and Spitfire specifically

`bf42.stdmesh.parse()` already exposes `CollisionFace.material_id` per face,
per collision LOD layer (the `.sm` reader's own docstring: "per face: i16
vertex[3], u8 defensiveMaterial, u8 flags" — this is the exact byte the
engine calls `matSelf`/`matOther` in `handleCollision`). `r4-collision-materials.py`
histograms it directly, no reader changes needed.

**Willy** (`standardMesh/Willy_Hul_M1.sm`, both collision LODs):

| layer | verts | faces | materials |
|---|---|---|---|
| 0 | 16 | 22 | **{45: 22}** — 100% |
| 1 | 56 | 73 | **{45: 73}** — 100% |

Single material across the whole hull, and it's exactly `ObjectTemplate.material
45` from `Objects.con` — the cleanest possible case. The wheel
(`Willy_WheL_M1.sm`) uses a *different* material, **37**, which (checked with
`r4-grep-content.py`) **is never defined anywhere in vanilla's `.con` data** —
every lookup against it falls through `getMaterialPtr`'s not-found path to
material 0 (terrain default: damage 30, friction 1.0, elasticity 0,
resistance 0.02). The wreck mesh (`Wreck_Willy_m1.sm`) uses material **85**,
distinct from the live vehicle's 45.

**Spitfire** (`standardMesh/Spitfire_Fus_M1.sm`, both collision LODs — the
level-of-detail-0 file `spitfire_fus_L1.sm` is byte-identical in its
collision section):

| layer | verts | faces | materials |
|---|---|---|---|
| 0 | 16 | 28 | {60: 4, 61: 13, 63: 11} |
| 1 | 83 | 97 | {60: 8, 61: 37, 63: 20, **90: 32**} |

Unlike Willy, the Spitfire's fuselage is **not** uniformly material 60 (its
own `ObjectTemplate.material`) — material 61 is the plurality (37/97 = 38%
of the outer LOD's faces), and material **90** covers 32/97 = 33% of it, with
**no damage-mod cell defined against either 45 or 50** anywhere in vanilla's
5,165-pair cell table (B1/B4) — a real, measurable "one third of a hit on
this specific fuselage mesh, from either sampled attacker, currently deals
zero object-collision damage" fact, not a hypothesis.

**Sherman** (`standardMesh/Sherman_Hull_M1.sm`, for the third worked example):
{50: 31, 51: 29, 52: 10} across both layers combined (70 faces total) —
same multi-material pattern as the Spitfire, all three of which **do** have
cells defined against both 45 and 50 (B4).

What it would take if the reader didn't already expose this: nothing extra —
`bf42/stdmesh.py`'s `CollisionFace` dataclass already carries `material_id`
and `flags` per face; this survey needed zero changes to the reader.

### B4. Worked examples

All three use the same collision geometry: attacker moving at **15 m/s**,
hitting a **parked** target (`v_target = 0`) **square on**, so the relative
closing-speed vector is parallel to the hit normal (`c = |cos θ| = 1`) and,
per A4, `angleFactor = 1.0` regardless of either vehicle's `angleMod`. Every
input is cited to its source above; nothing here is assumed.

**Mass shares** (briefing 4.2 / L0 C1 — feeds the *physical push*, not
damage, A4): `shareA = massB/(massA+massB)`, `shareB = -(1-shareA)`, snapped
to `1.0/0.0` above 0.95 and `0.0/+1.0` below 0.05 (L0's objdump-confirmed
sign, `0x8259908-0x82599a4`/`0x825a3be-0x825a3e5`).

#### Willy (attacker, 2500 kg) vs parked Spitfire (2500 kg)

- Masses equal -> `shareA = 2500/(2500+2500) = 0.5`, `shareB = -0.5` (no
  snap): the physical push splits the relative-velocity change 50/50.
- Damage: `attackerDamageMod` = Willy's Armor `damageMod`, unauthored ->
  **1.0** default (A2). `angleFactor` = **1.0** (square hit). Victim Armor
  `speedMod` = Spitfire's authored **2** (B2). `V² = 15² = 225`.
  `matAttacker` = Willy's hull material, **45** uniformly (B3).
  `getDamageForMaterial(45) = 1.0` (B1). `matVictim` depends on where on the
  fuselage the hit lands (B3):
  - On a material-60/61/63 face (67% of the outer collision mesh):
    `getDamageMod(45, X) = 0.1` for all three (B1/B4, `r4-build-cell-table.py`
    output, effect `e_collision_metal`).
    `damage = 1.0 × 1.0 × 2 × 225 × 0.1 × 1.0 = 45.0` HP.
  - On a material-90 face (33% of the mesh): no cell -> `defaultDamageMod =
    0.0` (A5). `damage = 0`.
- Against Spitfire's 100 HP / criticalDamage 20: a single square hit costs
  **45%** of its health on 2/3 of its fuselage, and **nothing** on the other
  third — it survives either way (55 HP remaining is still above the 20-HP
  critical threshold), but two such hits on the "live" materials would push
  it into critical/burning state, while any number of hits confined to the
  material-90 patch would never do so under the current vanilla data.

#### Willy (attacker, 2500 kg) vs parked Sherman (25,000 kg)

- `shareA = 25000/(2500+25000) = 0.9091`, `shareB = -0.0909` (below the 0.95
  snap threshold, so unsnapped): Willy absorbs ~91% of the relative-velocity
  change (bounces back hard), Sherman ~9% (barely nudged) — matches the
  intuitive "jeep bounces off tank" picture.
- Damage: `attackerDamageMod = 1.0` (Willy, default). `angleFactor = 1.0`.
  Victim (Sherman) `speedMod` = authored **1** (B2, not the 0.05 default —
  Sherman does author it). `V² = 225`. `matAttacker = 45`,
  `getDamageForMaterial(45) = 1.0`. Sherman's hull carries materials
  {50, 51, 52} (B3); `getDamageMod(45,50) = getDamageMod(45,51) =
  getDamageMod(45,52) = 0.1` (all three checked, B4 — same flat 0.1 as
  against the Spitfire's materials, no gap here).
  `damage = 1.0 × 1.0 × 1 × 225 × 0.1 × 1.0 = 22.5` HP.
- Against Sherman's 100 HP / criticalDamage 12: **22.5%** of its health,
  leaving 77.5 HP, well above critical.

#### Sherman (attacker, 25,000 kg) vs parked Spitfire (2500 kg)

- `shareA = 2500/(25000+2500) = 0.0909`, `shareB = -0.9091`: Sherman barely
  deflects, the Spitfire gets thrown hard — the mirror image of the previous
  case, as expected from `shareA`'s definition depending only on masses, not
  which side is "attacker".
- Damage: `attackerDamageMod` = Sherman's Armor `damageMod`, unauthored ->
  **1.0** default (same as Willy's). `angleFactor = 1.0`. Victim (Spitfire)
  `speedMod = 2`. `V² = 225`. `matAttacker = 50` (Sherman's material),
  `getDamageForMaterial(50) = 1.0` (B1 — identical to material 45's value).
  `matVictim` = Spitfire's 60/61/63/90 mix again; `getDamageMod(50,60) =
  getDamageMod(50,61) = getDamageMod(50,63) = 0.1`, `getDamageMod(50,90)`
  undefined -> 0.
  `damage (on 60/61/63 faces) = 1.0 × 1.0 × 2 × 225 × 0.1 × 1.0 = 45.0` HP —
  **identical to Willy's hit on the Spitfire**, despite Sherman being 10x
  heavier and, in the fiction, far more solidly built. The formula genuinely
  does not distinguish them: both attackers get the engine-default `1.0`
  `damageMod`, both attacking materials (45 and 50) carry the same
  `materialDamage 1.0`, and the cell value against the Spitfire's live
  materials is the same flat `0.1` for both. This is not a bug in my
  arithmetic — it's a direct, measured consequence of how sparse and
  coarse-grained vanilla's authored data actually is once you trace every
  factor to its source.

---

## Summary of confidence

**Verified** (two independent decompiled sources agree, or cross-confirmed
against an objdump-checked independent report): the `PhysicsNode`
mass/drag/dragOffset/centerOfMassOffset/inertiaModifier bindings and
defaults; the `Armor` hitPoints/maxHitPoints/damageMod/angleMod/speedMod/
hasArmor/criticalDamage/explosion\* bindings and defaults; the
`MaterialManager` `.con` word list and the two global defaults
(`speedDamageMod=0.1`, `defaultDamageMod=0.0`); the object-vs-object damage
formula itself (A4, matches L0 C8 term for term); every Part B count (they
are direct script output over the real archives, not estimates).

**Read** (decompile-level, not objdump-confirmed): the fallback-chain shape
in `MaterialManager`'s getters; `hasPointPhysics`'s exact bit index (O5);
"`gravityModifier` is never wired for a vehicle body" (a confirmed absence of
a call, not a positive claim needing a sign check).

**Open**: `hpLostWhileCriticalDamage`'s true default (O1, two sources
disagree); where `getSpeedDamageMod()` is actually consumed (O2);
`ObjectTemplate.material`'s consumer beyond `Armor` (O3); the `Material`
class's own constructor defaults for friction/elasticity/resistance on
damage-class materials (O4).
