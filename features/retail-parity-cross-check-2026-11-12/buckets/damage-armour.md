# damage-armour

## Summary

Verdict counts: CODE-WRONG 6, LEDGER-WRONG 2, SETTLED 1, DELIBERATE 1, INCONCLUSIVE 2, MATCH 34 groups.

All of it was read on our `bf1942_lnxded.static` with objdump and readmem. The linux 1.61 dump was the second reader for `calcDamage` and `SkeletonCollisionMesh::getDistanceToGeometry`. Data surveys came from the live `maps/_shared/damage.json` and the 73 vanilla vehicle `*.report.json` files on mesh.bfstats.io, fetched read-only into the scratchpad `dl/`.

Not reached:
- `idle-vehicle.js` GUN-12 (recoil home time). It is a weapon citation, outside damage.
- `vehicle-hits.js` proximity-fuse addresses `0x0831eafb`/`b82`/`d1f`. They belong to the fuse bucket, so I checked them by name only.
- The client-side addresses in `soldier-armor-effects.js` (`0x004bc413`...). I checked them against the lnxded twin `Armor::playEffect`, not on the PE.
- The deep-water branch of `Armor::update` (`+0x130/+0x138/+0x13c/+0x140`). No code models it. See F9.

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [medium] An unwritten `hpLostWhileUpSideDown` / `hpLostWhileDamageFromWater` is 1.0 HP/s in retail, but none in our code
- Code:
  - `viewer/vehicle-damage.js:140-142` sets `this.hpLostWhileUpSideDown = Number.isFinite(...) ? ... : null`.
  - `vehicle-damage.js:137-139` does the same for `hpLostWhileDamageFromWater`, and `:338` reads `&& this.hpLostWhileDamageFromWater !== null`.
  - `vehicle-damage.js:361` and `viewer/world-damage.js:103` both read `hpLostWhileUpSideDown > 0.01`, so null means never.
  - The extractor writes null when the word is unauthored (`bf42/con.py:1625-1626`).
- Ledger: HP-22 found the 1.0 constructor stores at template `+0xfc` and `+0x100` and left them "not named here". HP-18 has no default.
- Third-party: not needed. The constructor is plain stores.
- Our binary:
  - `SimpleObjectTemplate` ctor: `movl $0x3f800000,%esi` at `0x081dbcda`, then `movl %esi,0xfc(%ebx)` at `0x081dbe3b` and `movl %esi,0x100(%ebx)` at `0x081dbe41`.
  - `setArmorComponent`: `movl 0xfc(%edi),%edx; call *0xd8(%eax)` at `0x081ddd2d`/`0x081ddd38`, and `movl 0x100(%edi),%ecx; call *0xe0(%eax)` at `0x081ddd3f`/`0x081ddd4a`.
  - Armor vtable `0x0871d220`, +8+0xd8 is `setHpLostWhileUpSideDown` (writes `+0x120`, `0x081743a9`). +8+0xe0 is `setHpLostWhileDamageFromWater` (writes `+0x124`, `0x081743d9`).
  - `+0x120` is the upside-down rate `Armor::update` tests against 0.01 (`0x08173320`) and multiplies at `0x081734af`. `+0x124` is the water amount at `0x081732a3`.
- Data: 32 of the 73 armoured vanilla templates author no `hpLostWhileUpSideDown`. They include the Pak40, flak38, Defgun, AA_Allies, the MGs, every ship and the subs. In retail these lose 1 HP/s while upside down; ours lose nothing. Five radar towers set `damageFromWater` with no rate, so retail bills them 1 HP/s wet.
- Fix: default both to `HP_LOST_WHILE_CRITICAL_DEFAULT`'s value. Add `HP_LOST_WHILE_UPSIDE_DOWN_DEFAULT = 1` and `HP_LOST_WHILE_DAMAGE_FROM_WATER_DEFAULT = 1` in `armor.js`. Use them in `vehicle-damage.js:137-142` instead of null. The `> 0.01` gate in `world-damage.js:103` then works unchanged. Update HP-22 to name `+0xfc` = hpLostWhileUpSideDown and `+0x100` = hpLostWhileDamageFromWater.

### F2 [CODE-WRONG] [medium] Vehicle water damage has no `WaterDamageDelay` and starts 1 s late; retail bills on the first wet frame by default
- Code: `vehicle-damage.js:334-346` adds `waterAccumulator += dt`, bills a flat rate each whole second and resets to 0 when dry. So the first bill lands 1 s after entering the water, and a dip under 1 s costs nothing. The extractor does not read `WaterDamageDelay` for vehicles at all (no `waterdamagedelay` in `bf42/con.py`).
- Ledger: HP-5 says "water/deep-water use independent countdowns, first delay honoured, every fire after is a flat 1.0s". The code drifts from its own row.
- Our binary: `Armor::update` `0x08172f40` runs every frame on the server.
  - In water (`+0x10`) with `damageFromWater` (`+0xe0`): `+0xe4 -= dt` (`0x8173167`-`0x817317c`). When the result is `< 0` (`je 0x8173253`) it does `giveDamage(+0x124)`, a flat amount, then `movl $0x3f800000,0xe4(%edi)` (`0x81732b8`, 1.0 s).
  - Dry: `+0xe4 = +0xec` (the delay, `0x81732c7`).
  - `setWaterDamageDelay` (`0x08174050`) writes both `+0xe4` and `+0xec`. It is fed from template `+0xc0` (`setArmorComponent` vt+0x58). The template ctor stores `ecx`=0 there (`0x081dbdc0`; `movl $0x0,%ecx` at `0x081dbcc4`), so the default delay is 0.0.
- Fix: in `update`, keep a `waterTimer`, initialised and reset (when dry or not `damageFromWater`) to `waterDamageDelay` (default 0). Each wet step: `waterTimer -= dt; if (waterTimer < 0) { damage(rate); waterTimer = 1; }`. Ship `WaterDamageDelay` from the extractor. `swim.js` already does this for soldiers.

### F3 [CODE-WRONG] [medium] A missing damage-table cell prices a round at x1 instead of x0
- Code:
  - `viewer/vehicle-hits.js:550` `botRoundDamage`: `return base * (mod === null ? 1 : mod) * ...`, with `mod = page.guns.modifiers?.[attGroup]?.[defGroup] ?? null`.
  - The same expression is at `viewer/round-impact.js:95`. That file is in another bucket, but `applyVehicleHit` prices every direct hit through it.
  - The comment there says null means "no table loaded", but a loaded table with no cell is also null.
- Ledger: DMG-1 says no cell means 0.0 for the life of the process, and an unlisted pair does no damage. `crash-damage.js` `damageModifier` already returns 0.0.
- Our binary: `getDamageMod` `0x08175040` falls back to `fld [ebx+0x24]` at `0x08175090`, and both MaterialManager constructors write 0 there (`0x0817485e`, `0x0817491e`). DMG-1 records this. I re-read only the projectile site: `call *0x4c(%edx)` at `0x0815416d` is multiplied straight into the product (`0x815415c`-`0x81541cf`), with no null branch.
- Data: in vanilla `damage.json`, the Bayonet (257) has cells only against def group 73. Against the soldier capsules 40/41/42 and the armour groups 45-60 it has none, so ours does 12 HP where retail does 0. The landmine (230) has no cell against 60, aircraft. Mods are likely to have more such pairs. An undefined attacker id should also fall back to material 0's `attGroup` (DMG-1's retry on id 0). Ours keys the row by the raw id.
- Fix: `const mod = modifiers ? (modifiers[attGroup]?.[defGroup] ?? 0) : 1;` in both places. Resolve `attGroup`/`defGroup` through material 0 when the id is not in the table, as `crash-damage.js` `lookupMaterial` does.

### F4 [CODE-WRONG] [low] The critical bleed uses its own whole-second accumulator; retail bills the shared `+0xe8` bank x rate
- Code: `vehicle-damage.js:319-332` keeps a separate `criticalAccumulator`. It starts at 0 when the hull goes critical and is reset on recovery. It bills a flat `hpLostWhileCriticalDamage` per whole second, carrying the remainder (`-= 1`). The comment cites HP-5, "not scaled by dt".
- Ledger: HP-17 says it bills "accumulated seconds x hpLostWhileCriticalDamage", which is right. HP-5's "flat" wording describes the water countdowns, not this one.
- Our binary: in `Armor::update`, the bank is `fadds 0xe8(%edi)` at `0x8173135`. It runs from spawn, whatever the hull's state.
  - When it is `>= 1` (`je 0x81732d8`), for a non-soldier with `hp <= criticalDamage` (`0x81732f2`-`0x8173302`) and a nonzero rate: `flds 0xe8(%edi); fmuls 0x11c(%edi)` (`0x8173640`-`0x8173649`), then `giveDamage`.
  - The upside-down test follows (`0x8173320`) on the same bank.
  - Then `movl $0x0,0xe8(%edi)` (`0x817336d`). The bank is zeroed with no carry.
- Effect: totals agree, but the phase does not. Retail's first tick comes 0-1 s after the crossing, with spawn-phase-locked ticks shared with the upside-down bill. Ours comes exactly 1 s after, and a hitch splits into flat ticks.
- Fix: delete `criticalAccumulator`. Inside the existing `upsideDownAccumulator >= 1` block, bill `bank * hpLostWhileCriticalDamage` first when `this.critical`, then the upside-down bill, then zero the bank. Correct the comment's HP-5 citation to HP-17.

### F5 [CODE-WRONG] [low] Skeleton hit: retail reports the struck BONE's world position and distance -0.1, not the closest point on the round
- Code: `viewer/skeleton-hit.js:96-102` returns `t = near.s * maxT` and `at` as the round's closest point. `vehicle-hits.js:615-618` uses `at` as the impact point (effect and `lastHit`), and `bestT` to pick the nearest of several soldiers.
- Ledger: DIE-10 is silent on the output.
- Third-party: `decompiled_functions_bf42linuxServer/getDistanceToGeometry_083B5B80.c:150-185` shows `if (lVar19 < fVar1) break;`. After the break it writes param_6 as `bone+0x78` through the matrix plus its translation, `*param_9 = -0.1; *param_8 = *param_9;` and the material from `+0xd8`.
- Our binary: `SkeletonCollisionMesh::getDistanceToGeometry` `0x083aeb10`. `call checkCapsuleCollision` at `0x83aef8e`, `flds 0x78(%ecx)` (bone origin) at `0x83af00b`, `fadds 0x30(%esi)` (translation) at `0x83af069`, `fildl 0xd8(%eax,%ebx)` (material) at `0x83af0a0`, `movl $0xbdcccccd,(%esi)` (-0.1) at `0x83af0d4`.
- The capsule construction, first-wins order, strict `<` and stretch-0 case all MATCH (see the MATCH list).
- Fix: return `at` = the hit bone's world position (`cap.bone`'s position, which `buildCapsules` would need to keep). The ordering is F10.

### F6 [CODE-WRONG] [low] Death-tier key ignores the last-hit material
- Code: `vehicle-damage.js` `deathTier` (lines 89-97) keys -1 when `inWater`, else 0. `vehicle-wrecks.js:538-546` decides `inWater` by height. `soldier-armor-effects.js` `deathKey`/`tierAt` already has the right rule.
- Ledger: ARM-11 says "0 with no hit material (+0x8 == -1), minus the material, or -1 in water (+0x10)". That is correct.
- Our binary: `Armor::playEffect` `0x08172960`, at `0x817299f`-`0x81729c4` and `0x8172e55`-`0x8172e68`:
  - `[+8]==-1` gives `getEffect(0)`.
  - Otherwise `+0x10==0` gives `getEffect(-material)`, and `+0x10!=0` gives `getEffect(-1)`.
  - `getEffect` for key <= 0 does `find(key)`, falling back to `find(0)` (`0x81728fc`-`0x817295c`).
- Divergences: a hull dying in water with no recorded hit material plays tier 0, not -1. A hull whose last hit material was water (1) plays -1 even when `+0x10` is clear. No exported glb authors a negative key other than -1 (5721 rows scanned), so only those two cases differ.
- Fix: make `deathTier` take `{ lastHitMaterial, inWater }` and delegate to `soldier-armor-effects.js` `deathKey` + `tierAt`.

### F7 [LEDGER-WRONG] [low] ARM-1 and hitpoints-and-damage.md §8 call `getEffect` "nearest threshold below"; it is the smallest threshold at or above `ceil(hp)`
- Ledger:
  - ARM-1 says "read by `Armor::getEffect(int)` `0x08172820` as a nearest-threshold-below lookup".
  - `subsystems/hitpoints-and-damage.md:632-633` says "nearest-threshold-below lookup", and `:667` says "takes the nearest authored threshold at or below `ceil(hitPoints)`".
  - §8 also says the death path is "the `push $0xffffffff` that makes the call `getEffect(-1)`". That is one of three keys (F6).
- Our binary: `getEffect` `0x08172820`, key > 0.
  - It returns null when `rightmost.key < key` (`0x8172853`-`0x8172864`).
  - Otherwise it walks back from `end` while `prev.key >= key` (`0x8172890`-`0x81728da`) and returns that node's value (`0x81728dc`-`0x81728f4`): the smallest key >= key.
  - The key is `ceil(hp)`: `or $0x800`, `frndint`, `fistpl` at `0x8172e6d`-`0x8172ec0`.
- Fix: correct both texts to "the smallest authored threshold at or above ceil(hitPoints), nothing above the highest; at death 0 / -material / -1, falling back to 0". Code already follows the true rule (F8).

### F8 [SETTLED] The `vehicle-damage.js` "OPEN" on `activeTier` is closed; the code is right
- Code: `vehicle-damage.js:62-73` (the OPEN comment) and `activeTier` take the lowest threshold `>= hitPoints`.
- Our binary: as F7. For an integer threshold k, `ceil(hp) <= k` is the same as `hp <= k`, so `activeTier` is exact.
- Fix: replace the OPEN paragraph with the F7 rule. No logic change.

### F9 [INCONCLUSIVE] [low] Deep-water damage (`damageFromDeepWater`, `deepWaterDamageDelay`, `hpLostWhileDamageFromDeepWater`, `deepWaterLevel`) is not modelled
- Our binary:
  - `Armor::update` `0x8172f9d`-`0x8172fcc` sets `+0x10` and `+0x130` when the water height is above `pos.y - deepWaterLevel(+0x144)`.
  - With `+0x138` it counts `+0x13c` down and bills `+0x134` flat (`0x81731a7`-`0x8173233`, timer reset to 1.0).
  - `setArmorComponent` feeds them from template `+0x118`/`+0x11c`/`+0x120`/`+0x124` (vt+0x108/0x110/0x100/0x118). The ctor gives `+0x11c` (the bool) 0, so by default it is off.
- Would settle: a survey of which templates author `damageFromDeepWater`. If none do in the exported trees, keep it unmodelled.

### F10 [INCONCLUSIVE] [low] Which of several soldiers on one round's segment is met
- Code: `vehicle-hits.js` `roundBodyCast` keeps the soldier with the smallest `t`.
- Our binary: every skeleton hit reports distance -0.1 (F5). How `PointResponsePhysics` orders a soldier contact against other candidates was not read.
- Would settle: read the candidate loop's choice in `ResponsePhysicsManager::checkObjectVsObjects` `0x0825d820` and `PointResponsePhysics::checkObjectVsObject` `0x08257030`.

### F11 [DELIBERATE] Bot hold-fire (`friendly-fire.js:86-216`)
- It is documented as an invention against FF-7 (features/bot-friendly-fire "Decisions"). Keep it.

### F12 [LEDGER-WRONG] [low] `soldier-armor-effects.js:14` cites "ledger ARM-8..ARM-10", rows that do not exist
- ARM-11 already notes this. The behaviour that comment describes is correct (F6, F7). Point it at ARM-1/ARM-11.

## MATCH list

- HP-1 `setMaxHitPoints` min(v, 128) (`0x08173680`, `0x086c1fe8`=128.0) -> armor.js:122-124
- HP-1/HP-2 `setHitPoints` <= 0.001 gives 0, and a value above the max raises the max (`0x081726c0`, `0x086c0308`) -> armor.js:133-139
- `Armor::damage` epsilon snap (`0x08172730`) -> armor.js:148-155. Its server gate (IID_IGameServer, `0x08172743`) is where hit points live: the page's remoteDamage split.
- `Armor::heal` min(hp+amt, max) (`0x081727a0`) -> armor.js:162-167
- `status()` double epsilon (`0x086c0b90` = 0.001) -> armor.js DEATH_EPSILON
- HP-17 spawn order, setMax then setHit (`0x081ddc43`/`0x081ddc5e`) -> armor.js constructor, vehicle-damage.js:123-124
- HP-17 template words are ceil(v) uint, default 10 (ctor) -> armor.js templateHitPoints
- HP-22 critical-rate default 1.0 (`0x081dbe35`, `0x081ddd26`) -> armor.js HP_LOST_WHILE_CRITICAL_DEFAULT
- HP-17 bleed test `hp <= criticalDamage` inclusive (`0x81732f2`) -> vehicle-damage.js `critical`
- HP-18 upside-down: rate > 0.01 (`0x086c08a4`), tilt 0.3 (`0x086c030c`), terrain + 0.1 (`0x086b1ca0`), bank x rate, bank zeroed, bank a float -> vehicle-damage.js:356-366, world-damage.js:57-120
- HP-15 critical input x0.2 (`0x086c8678` = 0.2 double) and a wreck blocked -> vehicle-damage.js inputGate
- ARM-1 `+0x128` death latch tested before playEffect (`0x8172fe0`) -> vehicle-damage.js announce-once
- PHY-3 submarineData: 6th > 0 enables it (`0x8318da8`), crush deeper than the 6th x 7th (`0x8318de1`-`0x8318e3e`), deeper than the 5th drains by the 1st and below 0 clamps and bills the crew bank x 3rd (`0x8318e4d`-`0x8318eae`), otherwise refills by the 2nd capped at 1 (`0x8318eb8`-`0x8318edd`), 0.5 s bank (`0x086b05e8`) -> vehicle-damage.js stepSubmarine
- DMG-3/DMG-4 direct-hit law: `(1-angleMod)*sin(|c|*pi/2)+angleMod` (`0x86c08bc` = pi/2, `0x08154115`-`0x08154156`) x damageMod (`0x0815416d`) x getDamage (`0x081541aa`) -> crash-damage.js angleFactor, tank-armour.js, armour-damage.js, model-armour.js
- DMG-4 angleMod default 0, damageMod 1.0 (`0x081dbd10`, `0x081dbd07`) -> crash-damage.js register defaults
- speedMod default 0.05 (`movl $0x3d4ccccd,0x94(%ebx)` at `0x081dbd56`) -> crash-damage.js register
- COL-4 land |c|^3 with the > 1 gate, water |c|^2 with no gate (`0x8154a93`-`0x8154ab2`, `0x8154e60`; gate `fld1` at `0x8154c55`) -> crash-damage.js terrainCollisionDamage
- HP-14 soldier 8.0 floor (`0x086c08c0` = 8.0) -> crash-damage.js SOLDIER_SPEED_FLOOR
- COL-5 collision list `timer = max(0, 1 - sum)`, 16-slot ring, evict on wrap (`Armor::addColObject` `0x08173740`), aging with carry (`0x8172fed`-`0x817303d`) -> crash-damage.js CollisionList
- Kill material 1e10 (`0x501502f9`) -> crash-damage.js KILL_DAMAGE
- DMG-1 a missing cell is 0 -> crash-damage.js damageModifier (but see F3 for vehicle-hits/round-impact)
- FF-3 `calcDamage` (`0x0814b520`): team 1 or 2, root PCO team equal, a soldier root's ratio `+0x2c8`, otherwise `+0x2cc` (splash `+0x2d0`/`+0x2d4`, linux dump calcDamage.c) -> friendly-fire.js friendlyDamage. The `+0x2ec` branch zeroes damage to the local player's own object only, so it is not a vanilla server path.
- FF ratio clamp [0, 2] (`setSoldierFFRatio` `0x081572d0`, `0x086c08c4` = 2.0) -> friendly-fire.js friendlyFireRatio
- FF-1, FF-4, FF-5, FF-7 (rows read; FF-1 `0x08257708` not re-read) -> friendly-fire.js comments, roundPasses
- DIE-10 capsule `[parent+d, bone+d]`, stretch-0 `[bone, parent]`, first hit wins, strict `<` (linux dump lines 116-150, our `0x083aef8e`) -> skeleton-hit.js capsuleSegment/skeletonHit
- HP-19 after-death: ttl 10 (`movl $0x41200000,0xc4` at `0x081dbdc6`), fade on (`0xc8`=1), fade start 8 (`0x41000000` at `0xcc`), alpha = timer/(ttl-start) applied when timer < ttl-start (`0x81db40c`-`0x81db42f`) -> after-death.js, vehicle-wrecks.js
- HP-20 clearWorld (`0x081578f0`) by name -> vehicle-wrecks.js
- ARM-11 effects as children at the authored offset -> vehicle-wrecks.js playTier, soldier-armor-effects.js
- `soldier-armor-effects.js` deathKey/tierAt, the alive key ceil(hp) and smallest >= -> matches `0x08172820`/`0x08172960` (F6, F7)
- HP-9 explosion distance with Y-only yMod, 0.1 m off the surface, origin distance -> vehicle-damage.js applySplash comments (rows read; the cutoff is in effects-core, another bucket)
- HP-10 soldier-only exposure, 0 short-circuits -> vehicle-damage.js applySplash
- ARM-3, DMG-2, COL-20, HP-4, PHY-25, AI-76, KILLSTAMP-1 -> comment-only citations, consistent with their rows
- mass default 1.0 (`0x081dbceb` `movl $0x3f800000,0x54`) -> vehicle-hits.js proximityObjects comment
- HP-21 wet test origin below water + deepWaterLevel (`0x8172f9d`-`0x8172fc8`; ours `<=` against `<` with deepWaterLevel 0) -> world-damage.js inWaterOwners

## Fix-phase investigations

### F9 survey (deep water): authored, so implemented
I scanned every `.con`/`.inc` in every `Archives/**/*.rfa` (`scratchpad/deepwater.py`) for `damageFromDeepWater`, `deepWaterLevel`, `deepWaterDamageDelay`, `hpLostWhileDamageFromDeepWater` and `WaterDamageDelay`.
- **Vanilla, XPack1, XPack2:** no deep-water word anywhere. `WaterDamageDelay 90` appears once, on the soldier.
- **DC_Final, DesertCombat:** the soldier's `WaterDamageDelay 90` only.
- **EoD:** `WaterDamageDelay` 90/20/6/6/6.
- **FH:** `WaterDamageDelay 45` x3.
- **GCMOD:** `WaterDamageDelay 90` x4.
- **bf1918:** `damageFromDeepWater 1` on 137 templates (0 on 2), and `hpLostWhileDamageFromDeepWater` 5 (88), 10 (38), 7.5 (11), 230 (1) and 0 (1). There is no `deepWaterLevel` or `deepWaterDamageDelay` anywhere, so those stay at their defaults of 0 and 1.0 s.
- FHSW is not installed under `~/.cache/vimpact-game/Mods`, so it was not scanned.

The runtime is implemented (below). **Follow-up outside my files:** the extractor does not ship these words. `bf42/con.py` and `bf42/assemble.py`'s `armor` block (assemble.py:84-86, :4521-4525) need `waterDamageDelay`, `damageFromDeepWater`, `hpLostWhileDamageFromDeepWater`, `deepWaterDamageDelay` and `deepWaterLevel`. Then the exported bf1918, EoD and FH trees need their `armor` blocks re-patched. Until that happens, the new code runs on the template defaults.

### Air-sea F7: `Armor::status` sends 0x15 without 0x14. Settled: retail leaves a ship killed outright from above its threshold unarmed
- `status(float v)` at `0x081739e0` first compares v with the double 0.001 (`fldl 0x86c0b90`; `fucompp`; `testb $0x1,%ah`; `je 0x8173c70` at `0x08173a06`). For v <= 0.001 it jumps straight to the death block. That block does `movb $0x1,0x110` and `movb $0x1,0x111` (`0x08173c72`/`0x08173c79`), sends `0x15` (`0x08173d62`) and leaves through `0x08173af7`. No jump from it reaches the only `push $0x14` (`0x08173ad6`), which sits on the alive branch (v > 0.001, new value <= `criticalDamage`, current safe or destroyed).
- `FloatingBundle::handleMessage` `0x082402b0`:
  - `0x14` (`0x082402d9`) sets `+0xee` (`0x08240493`) and arms the float's sink rate `+0xb0` (`0x08240557`).
  - `0x15` (`0x08240375`) sets only `+0xed` (`0x082403fa`).
  - `0x13` clears `+0xee` (`0x08240365`).
  - So a ship destroyed in one blow from above its threshold never arms its floats.
- **The viewer got this wrong, outside my files.** `viewer/hull-bodies.js:1094` (`if (!record?.critical) continue;`) and `viewer/effect-objects.js:214` (`... && record.damageable?.critical) record.hull.arm()`) arm on the float test `hp <= criticalDamage`. A destroyed hull at 0 HP passes that test, so a one-blow kill sinks in our viewer and floats in retail.
- **Fix for their owner:** read `criticalFlagged` instead of `critical` on both lines. It is the new message-driven byte on `DamageableVehicle`. Also update the "UNVERIFIED" note in `viewer/body-float.js:410-414`.
- **Inside my files:** `DamageableVehicle.criticalFlagged` now models `+0x111`/`+0xee`. `0x14` sets it on a living crossing to <= the threshold, `0x13` clears it on rising above, death leaves it, and respawn takes the full hull's own answer. `inputGate`'s 0.2 scale (HP-15, the `+0xee` byte) reads it, so DC's `flagkill`, authored under its own threshold, now turns at full rate while it bleeds.

## Fixes applied

All paths are under `tools/bf1942-models/`.

- **F1:** `viewer/armor.js` adds `HP_LOST_WHILE_UPSIDE_DOWN_DEFAULT` and `HP_LOST_WHILE_DAMAGE_FROM_WATER_DEFAULT` = 1, with the constructor evidence. `viewer/vehicle-damage.js` `DamageableVehicle` constructor uses them instead of null. `world-damage.js:103`'s `> 0.01` gate now passes for an unwritten rate.
- **F2:** `armor.js` adds `WATER_DAMAGE_DELAY_DEFAULT` = 0. `vehicle-damage.js` `update` replaces `waterAccumulator` with the float countdown `waterTimer`:
  - it starts at and is reset to the delay while dry;
  - while wet it does `-= dt`, and when it falls below 0 it bills the flat rate once and reloads 1.0;
  - it reads `extras.waterDamageDelay` when present.
- **F3:**
  - `viewer/vehicle-hits.js` `botRoundDamage` now prices through `crash-damage.js` `materialDamage`/`damageModifier`, which resolve an unknown id through material 0 and return 0.0 for a missing cell. A missing table still multiplies by 1. One new import line.
  - `viewer/round-impact.js:95`, the one line, now reads `base * (mod ?? (guns.modifiers ? 0 : 1)) * ...`.
  - **Left for that file's owner:** round-impact.js:25-27 still keys `attGroup`/`defGroup` by raw id with no material-0 fallback. Pricing it through `damageModifier` would need its import line too.
- **F4:** `vehicle-damage.js` `update` drops `criticalAccumulator`. The single float `bank` (`+0xe8`) bills `bank x hpLostWhileCriticalDamage` when critical and the rate is not 0, then `bank x hpLostWhileUpSideDown`, then zeroes, in `Armor::update`'s order. The doc comment is rewritten with HP-17/HP-18 citations.
- **F5:** `viewer/skeleton-hit.js`:
  - `buildCapsules` keeps each bone's world position as `origin`.
  - `skeletonHit` returns `at` = that position and `distance` = `SKELETON_HIT_DISTANCE` (-0.1). A hand-made capsule with no origin falls back to the round's own point.
  - `t` is kept for the caller's ordering between bodies; that ordering is still F10.
- **F6:** `vehicle-damage.js` now owns `deathKey` and `tierAt`, moved from `soldier-armor-effects.js`, which re-exports them so there is one copy. `deathTier(effects, { inWater, lastHitMaterial })` keys through them. With no material passed it is the old water rule. No caller tracks the material yet: the body world does not hand the contact's material to the damage record.
- **F7:** `features/bf1942-engine-reference/subsystems/hitpoints-and-damage.md` §8 is corrected in place. It now gives the smallest threshold at or above `ceil(hp)`, the key <= 0 fallback, and the three death keys. The ARM-1 text is in "Ledger edits" below.
- **F8:** `vehicle-damage.js` `activeTier`'s OPEN paragraph is replaced with the settled rule (ARM-1).
- **F12:** `soldier-armor-effects.js` now cites ARM-1 and ARM-11 instead of ARM-8..ARM-10.
- **F9:** `armor.js` adds the deep-water defaults. `vehicle-damage.js` adds the `damageFromDeepWater` fields and a float `deepWaterTimer` with the same law (`deepWater` also counts as wet). `world-damage.js` adds `deepWaterOwners(world)` (`water > y - deepWaterLevel`), and `VehicleDamageSet.update` takes `deepWaterOwners`.

Tests:
- **`tests/vehicle_damage_harness.mjs` and `tests/test_vehicle_damage.py`** were updated where they encoded the old law:
  - water ticks are now at 30 Hz, on the first frame and then every 30 frames;
  - a 2 s wet frame bills once (it was twice);
  - leaving water gives back an authored delay;
  - the repair test now shows the bank is not reset by a heal (it asserted the old per-burn accumulator was 0);
  - the AC-130 burn uses an almost-equal check, because the float bank times the rate gives 359.99999.
- **New cases in those two files:** the template defaults, deep water, the critical byte (a one-blow kill is never flagged, a `flagkill` turns at full rate), and the death keys.
- **`tests/test_skeleton_hit.py`** gains a test for the bone-position contact and the -0.1 distance.

Results: these pass:
- test_armor, test_vehicle_damage (66), test_skeleton_hit (8), test_crash_damage, test_damage
- test_world, test_world_damage, test_vehicle_wrecks, test_effect_objects, test_seaplane_water, test_server_hull_wreck, test_vehicle_entry_wreck
- test_friendly_fire, test_hit_indication, test_knockback, test_supply, test_seats, test_hull_wash
- test_bot_ai, test_soldier_death, test_soldier_body, test_vehicle_bodies, test_vehicle_kill_credit
- test_body_contact, test_body_ground, test_bomb_release, test_effect_runtime, test_flight, test_fuse_round_rest, test_gunfire_layers, test_idle_vehicle, test_kit_level_js, test_loaded_rounds, test_pose_compose, test_proximity_fuse, test_random_items, test_rocket_flight, test_soldier_outfit

`test_room` fails twice (`test_the_room_restarts_ten_seconds_after_the_end`, `test_a_blast_prices_and_throws_a_soldier_on_foot`). It fails the same way with all seven of my files at HEAD in a copy of the tree (`scratchpad/roomcheck`), so it is other sessions' work in progress, not these fixes.

## Ledger edits

- **ARM-1**: replace "read by `Armor::getEffect(int)` `0x08172820` as a nearest-threshold-below lookup" with:
  > read by `Armor::getEffect(int)` `0x08172820`: for a key > 0 the smallest authored threshold >= the key, null above the highest (`0x08172853`-`0x08172864`, the walk back from `end` at `0x08172890`-`0x081728da`); for a key <= 0 `find(key)`, falling back to `find(0)` (`0x081728fc`-`0x0817295c`). A living object's key is `ceil(hitPoints)`; a dead one's is 0 with no hit material, -material out of water, -1 in it (ARM-11)
- **HP-22**: replace "and to `+0xfc` and `+0x100` beside it (`0x081dbe3b`, `0x081dbe41`; those two words not named here)" with:
  > and to `+0xfc` (hpLostWhileUpSideDown: `setArmorComponent` `0x081ddd2d`/`0x081ddd38`, vt+0xd8, Armor `+0x120`) and `+0x100` (hpLostWhileDamageFromWater: `0x081ddd3f`/`0x081ddd4a`, vt+0xe0, Armor `+0x124`) beside it (`0x081dbe3b`, `0x081dbe41`), so both unwritten rates are 1.0 a second as well
- **HP-5**: append:
  > Defaults (ctor `0x081dbc70`, through `setArmorComponent`): `WaterDamageDelay` 0 (template `+0xc0`, `0x081dbdc0`; vt+0x58 `setWaterDamageDelay` `0x08174050` writes `+0xe4` and `+0xec`), so a `damageFromWater` object is billed on its first wet frame, then every 1.0 s (`+0xe4 = 1.0`, `0x081732b8`). Deep water: `damageFromDeepWater` 0 (`+0x11c`, vt+0x110, Armor `+0x138`), `hpLostWhileDamageFromDeepWater` 1.0 (`+0x118`, vt+0x108, `+0x134`), `deepWaterLevel` 0 (`+0x120`, vt+0x100, `+0x144`), `deepWaterDamageDelay` 1.0 (`+0x124`, vt+0x118, `+0x13c`/`+0x140`). Deep is `water(x,z) > pos.y - deepWaterLevel` (`0x08172f9d`-`0x08172fc8`) and also sets wet `+0x10`. The critical bleed and the upside-down bill share one bank `+0xe8` (HP-17), not a separate flat-per-second clock. BF1918 authors `damageFromDeepWater 1` on 137 templates; vanilla, RtR and SW author none
- **HP-13**: append:
  > Death sends `0x15` alone: `status()` takes `je 0x8173c70` at `0x08173a06` for any value <= 0.001, and that branch never reaches the `push $0x14` at `0x08173ad6`. So a hull killed outright from above its threshold is never sent `0x14`. `FloatingBundle::handleMessage` `0x082402b0` arms its sink rate (`+0xb0`, `0x08240557`) and `+0xee` only on `0x14`, sets `+0xed` alone on `0x15` (`0x082403fa`) and clears `+0xee` on `0x13` (`0x08240365`). A ship destroyed in one blow from above its threshold does not sink by its floats
- **DIE-10**: append:
  > The contact `getDistanceToGeometry` reports is the struck bone's own world position (`flds 0x78(%ecx)` at `0x083af00b`, through the mesh's matrix plus translation, `0x083af069`) and a literal distance of -0.1 (`movl $0xbdcccccd` at `0x083af0d4`, to both distance outputs), not a point on the round (linux dump `getDistanceToGeometry_083B5B80.c:153-185`)

## Follow-ups (round 2)

### 1. F6 wired: the death tier reads the hull's own last hit material
Retail: `SimpleObject::handleCollision` gives the Armor the other side's material, `setLastHitMaterialIndex(arg 0x20)` (vtable +0x60, `0x081dae4d`).
- It runs after the 99/37 tests (`0x081dacf7`..`0x081dad0b`) and after the destroyed skip (`0x081dae32`).
- It runs before the one-second collision list (`isInColList` +0x12c, `0x081dae59`) and before the damage dispatch.
- The Armor constructor stores `+0x8` = -1 (`0x081722be`).

Changes:
- **`viewer/crash-damage.js`:** `CrashDamage.hitMaterials` and `drainHitMaterials(apply)`. Every object and terrain contact past the 99/37 tests records `matAttacker`/`matTerrain` for its victim, the rate-limited repeat included. Damaging results also carry `material`.
- **`viewer/vehicle-damage.js`:**
  - `DamageableVehicle.lastHitMaterial` starts at -1 and is reset on respawn.
  - `noteHitMaterial(m)` does nothing once the hull is destroyed, so it keeps the material it died with.
  - `update` notes material 1 while the hull is in the water. The wet byte `+0x10` is itself the sea contact's (`0x081736c7`..`0x0817370a`; HP-21's wet parts send material 1 every tick).
  - The death tier is `deathTier(effects, { inWater, lastHitMaterial: inWater ? 1 : this.lastHitMaterial })`.
- **`viewer/world-damage.js`:**
  - `onBodyDamage` notes the contact's material before it deals the damage, so the killing contact names the key.
  - `damageTick` drains `bodyWorld.crash`'s materials and notes 1 for every `inWaterOwners` hull. This matters for ships, which are not in the body world.
- **`viewer/vehicle-wrecks.js:546`:** the crash-death tier passes `vehicle.lastHitMaterial`.
- Not wired: `vehicle-wrecks.js:414`, which only asks whether a tier exists, and `replay-hulls.js:759`, which is not my file and replays a recorded hull. Round hits do not record a material: whether a projectile contact reaches the victim's `handleCollision` was not read.
- Visible change: a hull whose last contact was the sea and that dies beached now plays its -1 tier, where it used to play 0. Every other case is as before.

Tests:
- `tests/vehicle_damage_harness.mjs` + `tests/test_vehicle_damage.py` `test_the_death_tier_reads_the_hulls_own_last_material`: sea then beached gives -1, grass 0, never touched 0, in the water -1, and the material is kept after death.
- `tests/crash_damage_harness.mjs` + `tests/test_crash_damage.py` `HitMaterialTests`: the rate-limited repeat is recorded, a 37 contact is not, and the drain empties the record.

### 2. Air-sea F7 fixed in `viewer/hull-bodies.js:1096` (re-read first)
- The sink gate now reads `record?.criticalFlagged` (the `0x14` byte), not `record?.critical`. The comment cites `0x08240557` and `0x08173a06` (HP-13).
- `carrierDown` (`:602`, `:609`) still reads `critical`. That gates deck spawns, not sinking, and was not part of the approval.
- `effect-objects.js:214` is left for the projectiles verifier as instructed. It needs the same one-word change.
- Test: `tests/deck_spawn_host_harness.mjs` + `tests/test_deck_spawn_host.py` `test_a_ship_killed_in_one_blow_never_arms_her_sink_rate` uses a Fletcher with `sinkingSpeedMod 1` stepped for 20 s:
  - shot to critical: flagged, sinks 18 m;
  - destroyed in one blow from 500: not flagged, drop 0;
  - shot to critical then killed: sinks.

Results:
- These pass: test_deck_spawn_host, test_vehicle_damage, test_crash_damage, test_world_damage, test_world, test_effect_objects, test_vehicle_wrecks, test_seaplane_water, test_server_hull_wreck, test_body_contact, test_body_ground, test_vehicle_bodies, test_hull_wash, test_gun_recoil, test_proximity_fuse.
- `test_body_float` fails twice: drafts of 20.22496 against 20.225. It loads only `body-float.js` and `rigid-body.js`, none of my files, so it comes from the air-sea verifier's edits in progress.

## Extractor change (pending)

I did not edit `bf42/con.py` or `bf42/assemble.py`. The runtime already reads every key below (`vehicle-damage.js` `DamageableVehicle`), and when a key is absent it applies the defaults shown.

### `bf42/con.py`
- **Template fields**, beside `damage_from_water` / `hp_lost_while_damage_from_water` (around con.py:1630):
  ```python
  water_damage_delay: float | None = None              # WaterDamageDelay; engine default 0.0 (template +0xc0)
  damage_from_deep_water: bool | None = None           # damageFromDeepWater; default off (+0x11c)
  hp_lost_while_damage_from_deep_water: float | None = None  # default 1.0 (+0x118)
  deep_water_damage_delay: float | None = None         # default 1.0 (+0x124)
  deep_water_level: float | None = None                # default 0.0 (+0x120)
  ```
- **The float-word tuple** (con.py ~3193, where `"hplostwhiledamagefromwater", "hplostwhileupsidedown"` sit): add `"waterdamagedelay", "hplostwhiledamagefromdeepwater", "deepwaterdamagedelay", "deepwaterlevel"`. Add their entries to the dict below it: `"waterdamagedelay": "water_damage_delay"`, `"hplostwhiledamagefromdeepwater": "hp_lost_while_damage_from_deep_water"`, `"deepwaterdamagedelay": "deep_water_damage_delay"`, `"deepwaterlevel": "deep_water_level"`. The lookup is case-insensitive (HP-4), so `WaterDamageDelay` matches.
- **The bool-word tuple** (con.py ~3279, `"damagefromwater", ...`): add `"damagefromdeepwater"`, and `"damagefromdeepwater": "damage_from_deep_water"` in its dict.
- If a physics block also lists these words (con.py:2251-2252 lists `damageFromWater`/`hpLostWhileDamageFromWater`), add the five there too. Otherwise they belong only in the armor dicts.

### `bf42/assemble.py`
- Add the five to the `armor` dict at assemble.py:81-89, after `"damageFromWater"`, and to the `report.armor` dict at assemble.py:~4512-4527, under the same names. Keep the existing `if value is not None` filter, so an unwritten word stays absent:
  ```python
  "waterDamageDelay": template.water_damage_delay,
  "damageFromDeepWater": template.damage_from_deep_water,
  "hpLostWhileDamageFromDeepWater": template.hp_lost_while_damage_from_deep_water,
  "deepWaterDamageDelay": template.deep_water_damage_delay,
  "deepWaterLevel": template.deep_water_level,
  ```
- A test in `tests/test_con.py` beside the existing hpLostWhile... case (test_con.py:1416-1432): parse `ObjectTemplate.WaterDamageDelay 20`, `damageFromDeepWater 1`, `hpLostWhileDamageFromDeepWater 5`, and assert the five keys.

### Which trees author the words
Census of every archive (`scratchpad/deepwater.py`, `scratchpad/dw2.py`):
- **Vanilla, XPack1 (RtR), XPack2 (SW): none.** The only `WaterDamageDelay` is the soldier's 90 in `CommonSoldierData.inc`, and `swim.js` already carries it. No change to the vanilla or xpack trees.
- **bf1918:**
  - `damageFromDeepWater 1` / `hpLostWhileDamageFromDeepWater` on 137 templates: 88 in `objects/Vehicles/Land`, 1 in Air, 24 stationary MGs and AA, 1 destroyable rail bridge, and level-local templates in 7 level archives (gaza_town, Kosovo, Sarikamis, brusilov_offensive, chateau-thierry, ramskapelle, roye).
  - One land vehicle authors `WaterDamageDelay`.
  - The models tree, the bake of every exported bf1918 level (vehicles placed in scene.glb) and the level-local templates all need the new keys. Those keys are con-derived values in a glb's node extras, so check `features/level-bake-layers/README.md` for which layer they ride.
- **EoD:** `WaterDamageDelay` on 3 land vehicles and 1 aircraft; the rest are soldiers.
- **GCMOD:** `WaterDamageDelay` on one Dantooine building template and in two level archives (GC_Alaris_Prime, GC_Endor).
- **FH, DC_Final, DesertCombat:** only the soldier's `WaterDamageDelay`. No vehicle tree change.
- **FHSW** is not installed under `~/.cache/vimpact-game/Mods`, so it was not scanned.

## Extractor change applied (round 3)

I re-read `con.py` after the seats verifier's changes; the armor words' plumbing was unchanged. Paths are under `tools/bf1942-models/`.

- **`bf42/con.py`:**
  - The `_OBJECT_TEMPLATE_PROPERTIES` word set gains `damagefromdeepwater`, `deepwaterdamagedelay`, `deepwaterlevel`, `hplostwhiledamagefromdeepwater` and `waterdamagedelay`. Their `set`-prefixed twins resolve through `_set_twin`.
  - `ObjectTemplate` gains five fields after `hp_lost_while_upside_down`, each defaulting to None, with the engine defaults cited (HP-5).
  - The four float words join the float tuple and its word-to-field dict; `damagefromdeepwater` joins the bool tuple and its dict.
- **`bf42/assemble.py`:** `armor_extras` and the report's `armor` dict carry `waterDamageDelay`, `damageFromDeepWater`, `hpLostWhileDamageFromDeepWater`, `deepWaterDamageDelay` and `deepWaterLevel`. An unwritten word stays absent.
- **`tests/test_con.py`:** new `test_the_water_delay_and_deep_water_words_reach_the_armor_block`. An FT17 that authors all five gets all five; a template that authors none gets none of the keys.
- No re-extract, as instructed.

Results:
- These 35 suites pass: test_con (136, the new test included), test_assemble, test_audit_play, test_barrel_launch, test_bf1918_area_damage, test_bind, test_camera_dof, test_cockpit_overrides, test_control_points, test_dc_engine_reads, test_delta_extract, test_effect_objects, test_effects, test_engine_texture, test_extract_collision_meshes, test_extract_kits, test_extract_map, test_ground, test_killer_charge, test_patch_engine_limits, test_patch_held_axes, test_patch_round_spawners, test_patch_weapon_stats, test_plane_bombs, test_remote_levels, test_rocket_flight, test_round_spawners, test_seats, test_sonar, test_spin, test_spotter, test_vehicle_bodies, test_verify, test_verify_false_alarms, test_viewmodel_level_skin.
- `test_weapon_words` errored once in a first batch run, then passed on its own rerun.
- **`test_con_words`, 4 failures, none from these words:**
  - `setpcoid` is still in `ORPHAN_WORDS` but is now read by someone else's change.
  - `setliepointupdownangle` appears as a new unread word in bf1942, XPack1 and XPack2.
- **`test_verify_mutations`, 7 errors:** a `FileNotFoundError` for `viewer/models/Bar1918.glb`, `BritishSoldier.glb` and `Sherman.glb`. Those glbs are not in this checkout's local models tree, which holds two glbs.

## F3 regression fix (round 4): a bot round with no weapon data

### Why the bot's material was null
- The bot round carries its real material only when the weapon's data is loaded.
- The exporter always writes a round's `template` into `fireArms.projectile`, and writes `material` when the template authors one (`bf42/assemble.py` `_projectile_spec`, :2795).
- Both the page (`map.html` `botWeaponData`, through `bot-barrels.js`) and the runner (`sim/level.mjs` `weaponFire`) read that block out of the weapon's glb, and `GunFire.attackerMaterial` then resolves it, as it does for the page's own rounds.
- The null comes from missing weapon data, not from a missing material:
  - `sim/level.mjs` indexes only `models/*.glb`. The DICE cache (`~/.cache/bfstats-mesh-remote/models`) holds no hand-weapon glbs: `models.json` lists `K98.glb`, but the file is absent. So every bot's fire data is null, `botRoundDamage(null)` gets no spec, and F3 read that as material 0 (x0.001 against the chest).
  - The live page has the same gap until a bot's weapon glb fetch resolves.
- There is no other source for a weapon's projectile in that cache: `kits.json` and the reports name no projectile. So the runner cannot carry the real material without the glbs. That is the cache's content, not code.

### What an absent material means in the engine (lnxded)
- `Projectile::handleCollision` takes the template's material (`+0x88`) unless it is -1: `movl 0x88(%edi),%eax; cmpl $-0x1,%eax; je; movl %eax,%ebx` at `0x0831eeda`..`0x0831eee5`. Otherwise it keeps the contact's material (arg `0x1c`, `0x0831ee92`).
- The template default is -1: `SimpleObjectTemplate` ctor `movl $0xffffffff,0x88(%ebx)` at `0x081dbd4c`.
- A round's own contact material is 0: `PointResponsePhysics::checkObjectVsObject` does `movl $0x0,0x68(%edx)` at `0x08257540` and `0x082579e5`. The linux dump agrees: `checkObjectVsObject.c:208` `*(undefined4 *)(param_1 + 0x68) = 0;`.
- So a round whose template authors no `material` really does hit as material 0. That is retail, and the Bayonet half of F3 stands.
- What is NOT material 0 is our plumbing gap: no spec, or a template `damage.json`'s projectile table does not list.

### Fix
- **`viewer/crash-damage.js`:** new `roundAttackerMaterial(guns, spec)`. It returns the spec's or table's material, 0 for a template the table lists without one, and null for no spec or an unlisted template. The evidence above is in its comment.
- **`viewer/vehicle-hits.js` `botRoundDamage`:** a null from the helper prices the stand-in `BOT_FALLBACK_DAMAGE` (30) at full modifier, which was the behaviour before F3. A resolved material goes through `materialDamage`/`damageModifier` as before. So DICE's bots go back to 30 HP a hit, and the live page's bots get the template's damage once their glb loads.
- **`bot-referee.js`:** needs no change. It calls `env.roundDamage(stats, material, distance)`, which is `vehicleHits.botRoundDamage` on the page (`map.html:1998`) and on a staged runner (`sim/match.mjs:270`).

### Other callers checked
- **`round-impact.js` (projectiles verifier's file, not edited):** `impact` now resolves `attacker = guns.attackerMaterial(spec)` through `materialOf(tables, attacker)` (its lines 15-31). A null attacker therefore becomes material 0, priced 30 x 0.001, the same plumbing trap. Today it is reached only when a human weapon's spec names neither a material nor a template the table lists, which no vanilla weapon does.
  - Suggested fix: `const attacker = roundAttackerMaterial(guns, spec);` (import it from `crash-damage.js`), and when it is null keep `base = null`, so the record carries no direct damage, as before.
- **`crash-damage.js` crash law:** every caller passes a contact's own vertex/face material. An id the table lacks falling back to material 0 is DMG-1's retry on id 0, which is right there.
- **`effects-core.js` splash:** not on the shared lookup. `applySplash` returns early unless `material2` and the victim's `splashMaterial` are finite. No null path.
- **`sim/level.mjs:475` (not edited):** the runner's no-stage `roundDamage` is a fourth copy with the pre-F3 law: x1 for a missing cell, and material resolution without the material-0 rule. It is used only when a match has no stage. Bringing it onto `roundAttackerMaterial` would move non-stage traces, so I left it for the bots verifier to decide.

### Tests
- New `tests/round_damage_parity_harness.mjs` + `tests/test_round_damage_parity.py`, run against vanilla's own table rows for 219, 40-42 and 0:
  - the page's own K98 round (`round-impact.js impact`) does 50/20/10 on head, chest and limbs;
  - a bot's K98 round (`botRoundDamage`) does the same, and 20 by template alone;
  - no weapon data, or an unlisted template, does the 30 stand-in;
  - a listed template with no material does the engine's 30 x 0.001.
- Run and passing:
  - bot: all `test_bot_*` (23 suites, including test_bot_bars, test_bot_judge_*, test_bot_retail_parity, test_bot_weapons)
  - room: test_room, test_room_seat_spawn, test_sim_match
  - damage: test_vehicle_damage, test_crash_damage, test_damage, test_armor, test_friendly_fire, test_hit_indication, test_knockback, test_effect_objects, test_world_damage, test_world, test_skeleton_hit, test_hull_wash, test_vehicle_kill_credit, test_soldier_death, test_server_hull_wreck, test_round_damage_parity
- The bot bars were not rebuilt.

## round-impact.js on the shared material lookup (round 5)

- **Change, in `viewer/round-impact.js` `impact`:**
  - It now takes `attacker = roundAttackerMaterial(guns, spec)` from `crash-damage.js`. The import line is extended.
  - When the result is null, `attMat` is null, so the record's `damage` is null: no direct damage. That is how `impact` priced this case before F3 (`materials[null]?.damage ?? null`).
  - A listed template with no material stays the engine's material 0 (IMP-2; `0x0831eeda`, `0x081dbd4c`, `0x08257540`).
  - The effect lookup uses the same attacker.
  - `detonate` only records `attacker` and prices no direct hit, so it is unchanged.
- **Test:** `tests/round_damage_parity_harness.mjs` + `test_round_damage_parity.py` `test_the_pages_round_keeps_our_gap_out_of_material_zero`. An unlisted template with no material gives null damage; a listed template with no material gives 30 x 0.001.
- **Results:** 78 of 78 suites OK. They are every test that references round-impact, gunfire or projectile, plus test_room, test_room_seat_spawn, test_sim_match and the damage suites (vehicle_damage, crash_damage, damage, armor, friendly_fire, hit_indication, knockback, effect_objects, world_damage, world, skeleton_hit, round_damage_parity).
- `test_world_fire` errored once in a batch run, then passed on its rerun in the full pass.
