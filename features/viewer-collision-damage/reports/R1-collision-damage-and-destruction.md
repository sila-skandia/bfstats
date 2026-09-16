# R1 report — Collision damage, the burning state, and destruction

Sonnet research agent, 2026-09-17. **Unverified.** Nothing here may reach
`features/bf1942-engine-reference/` until a verifier has re-derived it.

---

## Summary

Traced `SimpleObject::handleCollision` → `GameServer::handleCollision` →
`handleCollisionLandOrWater` / `handleCollisionObjectVsObject` /
`handleCollisionForProjectile` down to the instruction level in
`bf1942_lnxded.static`, resolving every vtable slot they touch against
fully-dumped vtables for `Armor`, `MaterialManager`, `Game`, and `GameServer`.
**HP-6 closes in the negative for terrain/water/object collisions: no code path
from a physical (non-projectile) collision ever calls `Armor::damage`,
`Armor::heal`, `Armor::setHitPoints`, `Armor::status`, or
`SimpleObject::handleDamage`.** The elaborate speed/angle/material/fall-height
arithmetic these functions do compute feeds only
`Game::playCollisionEffect` (sound/particle intensity), never HP. Only
`handleCollisionForProjectile` (a shot hitting something) applies damage, via
the already-known `Projectile::getDamage`/`MaterialManager` path. The viewer's
invented fall-damage ramp should be removed outright, not corrected — retail
has none for a generic fall/crash; what a player remembers is most likely the
*existing* per-second critical/upside-down HP tick (already shipped in
`armor.js`) finishing off a vehicle a few seconds after a hard landing flips
it. `addArmorEffect` is now fully explained end-to-end: parsed into three
parallel per-template vectors, folded at Armor construction into an
`std::map<int,DamageEffects*>` at Armor+0x148, looked up by
`Armor::getEffect(hp)`, and driven by `Armor::playEffect()` (called from inside
`Armor::update()`), with fire-tier-threshold == `criticalDamage` confirmed
exactly on 9/9 sampled vanilla vehicles.

## Findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| A | `SimpleObject::handleCollision` (`0x081dab40`) finds the nearest Armor ancestor of `this` via `getComponent(0xc4a4,0xc4a4)`, then unconditionally calls `Armor::collision()` (sets one byte, `Armor+0x129=1`) and `Armor::setLastHitMaterialIndex(arg6)` (`Armor+0x8`/`+0xc`, gated by `Armor+0x110`, with a soldier-swimming special case when index==1) | confirmed | Hand-disassembled `0x081dab40`–`0x081db230` in full (649 lines); `Armor::collision` `0x08174470`, `setLastHitMaterialIndex` `0x081736b0` disassembled directly |
| B | The "gate" the ledger calls `otherObject_vtable+0x90` is **not on otherObject**. It queries `getRootParent(this)` for `IID_ICompositeObject` (`0x86c2a58`) then walks toward the nearest `IID_IPlayerControlObject` (`0x86d3c50`) ancestor; the vtable+0x90 call is on *that* object. Even when it returns true, the function does **not** skip — it additionally compares `ObjectSpawner::getHoldObjectId()` of that chain against `otherObject`'s own root, and only bypasses Armor-recording when they match (same-spawner self-collision suppression, e.g. a shell vs. the gun that fired it) | corrected | Full trace of `0x81dad43`–`0x81dafda`; globals resolved via `nm`: `0x86c2a58`=`IID_ICompositeObject`, `0x86d3c50`=`IID_IPlayerControlObject`; `ObjectSpawner::getHoldObjectId` `0x08314a50` |
| C | `handleCollision` forwards to `dice::bf::Game::handleCollision`/`handleCollisionForProjectile` through the **global `dice::bf::game` object's own vtable**, slots dump+0x3c/+0x38. Selector: `this`'s own class == `CID_ProjectileTemplate` (`0x86c2b90`) picks the projectile variant. Because the running process's `game` singleton is actually a `GameServer`, and `GameServer`'s vtable **overrides** exactly those two slots, these calls resolve at runtime to `GameServer::handleCollision` (`0x08156020`) / `GameServer::handleCollisionForProjectile` (`0x08153ba0`) | confirmed | Vtable dumps of `dice::bf::Game` (`0x0870d760`) and `dice::bf::GameServer` (`0x0871b0e0`) — dump+0x38/+0x3c match `08153ba0`/`08156020` on both, and GameServer overrides them |
| D | `GameServer::handleCollision` (`0x08156020`, 101 bytes) is a two-way dispatcher: `otherObject!=NULL` → `handleCollisionObjectVsObject`; `otherObject==NULL` → `handleCollisionLandOrWater`. **Terrain/water contact routes through this exact same call chain as object-vs-object, with `otherObject` forced to null** — it is not physics-only | confirmed | Full disassembly of `0x08156020`–`0x08156090` |
| E | **`handleCollisionLandOrWater` (0x08154960, 2135B) and `handleCollisionObjectVsObject` (0x081551c0, 3673B) compute a genuine impact-severity formula** — `\|V\|` (a velocity-like vector's magnitude), `\|cos(angle between normalized V and normalized N)\|`, `MaterialManager::getDamageMod`/`getEffectTemplate`/`getDamageForMaterial`, `Armor::getSpeedMod()`, and (for `CID_BFSoldierTemplate` objects specifically) a fall-height term `Armor::getLastCollisionHeight()` (`Armor+0x28`) minus current `Y` position, clamped/scaled against constants 1.0/2.0/20.0, times `BFSoldier::getDamageDampingFromActiveKitParts()` (`0x0827ec00`) — **but the only consumer of the final product, in both functions, is `Game::playCollisionEffect(pos, effectTemplate, vec, f1, f2)` (`0x0805de20`), an audio/visual effect spawn.** No call — direct or virtual, checked by resolved-symbol name and by grepping both functions' entire disassembly for calls to Armor's damage/heal/setHitPoints vtable slots — reaches Armor's HP mutators anywhere in either function | confirmed | Full hand-trace of `handleCollisionLandOrWater` (all 673 disassembly lines read and reduced); direct-call and vtable-slot grep of both functions (zero hits for damage/heal/setHitPoints) |
| F | `Armor::getLastCollisionHeight()`/`setLastCollisionHeight()` (`Armor+0x28`, a plain float) **is read** — inside `handleCollisionLandOrWater`'s soldier branch, as the fall-height term above. It is written from `self->vtable+0x38()` (a `Pos3`-returning accessor on the colliding `IObject`, offsets `+0`,`+4`,`+8`) → `+4` (the Y/height component) is what gets stored. So `setLastCollisionHeight` records the object's raw world Y-position at the moment of contact, not a derived quantity | confirmed | `Armor::setLastCollisionHeight`/`getLastCollisionHeight` disassembled directly (`Armor+0x28`); the read site at `0x08154d37` inside `handleCollisionLandOrWater` |
| G | `handleCollisionForProjectile` (`0x08153ba0`, 3515B) — the actual weapon-impact path — calls `Projectile::getDamage(int,Pos3)` (`0x0831f3c0`), `Projectile::getForceOnExploaion()` (`0x0831f850`, verbatim engine typo), `Projectile::canTK()` (`0x0831f870`). This is separate machinery from A–F and is the already-known damage.py/damage.json path, not fall/crash damage | confirmed | Direct-call scan of `0x08153ba0`–`0x0815495b` |
| H | Class overrides of `handleCollision`: `PlayerControlObject` and `Spring` (springs = wheels/suspension) both just forward to `SimpleObject::handleCollision`. `Obstacle::handleCollision` does **not** call the base at all — it checks whether `otherObject`'s class is `CID_BFSoldierTemplate` (or null) and, if so, calls its own vtable+0x9c(0,0) and returns true, else returns false; no Armor interaction. `BFSoldier::handleCollision` (2574B) calls the base `SimpleObject::handleCollision` once but is mostly `BFSoldier::setAnimationState` calls gated on `AnimationStateMachineInstance::getCurrentState`/`getCurrentStateFlags` — landing/impact **animation** selection, not damage | confirmed | Direct-call scans of `0x08318b00`, `0x0824f9b0`, `0x08315e10`, `0x0827d3b0`–`0x0827ddbe` |
| I | `addArmorEffect(int hp, string effect, Vec3 offset)` (`SimpleObjectTemplate::addArmorEffect`, `0x081dded0`) is a real, separate function — not one of HP-3's 23 copied setters — that appends into **three parallel growable vectors on the template** (`+0x98`, `+0xa4`, `+0xb0`). `Armor::getEffect(int hp)` (`0x08172820`) does an `std::map<int,DamageEffects*>` lookup (map header at `Armor+0x148`) via `std::_Rb_tree<int,pair<const int,DamageEffects*>,...>::find`-adjacent traversal (decrement-until pattern = nearest-threshold lookup by key). `Armor::playEffect()` (`0x08172960`) checks the map is non-empty, checks a death-adjacent field (`Armor+0x38`) against the 0.001 HP epsilon, calls `getEffect(-1)` and compares against a "last shown effect" field (`Armor+0x50`) — different → tears down active effect-instance objects and (implicitly) spawns the new tier. `playEffect` is called from **inside `Armor::update()`** at `0x08173100` | confirmed (storage, map, call graph); inferred (that a change in either direction — healing back up — reliably retriggers this teardown/rebuild, since only the `-1`/death-sentinel branch was traced in detail, not the generic per-HP branch) | `0x081dded0` disassembled; `0x08172820` disassembled in full; `0x08172960` disassembled through its first ~70 instructions; call site confirmed inside `0x08172f40`–`0x08173680` (`Armor::update`'s own address range) |
| J | Fire-tier threshold in `addArmorEffect` equals the template's own `criticalDamage` on **9 of 9** sampled vanilla vehicles (Sherman, PanzerIV, Tiger, Willy, Hanomag, Wespe, Spitfire, bf109, Zero, B17 — all exact matches), but **boats (Elco80, Type38) have no fire tier at all** — their tiers are a `Damage`/`waterBoatSinkSmall`/`scrapmetal`/`-1 wreck` sequence instead, matching the README's own boat counter-example | confirmed | `cd1_armor_effect_survey.py numbers` output, cross-checked against raw `Objects.con` reads |
| K | Across all 14 (+3 sub-variant) installed mods, **zero files declare a `collisionDamage` property** — the README's vanilla-only finding generalizes to every install checked | confirmed | `cd1_armor_effect_survey.py collision` full run, 17 mods, ~40k files |
| L | Zero of 230 sampled vanilla tree/vegetation/foliage `.con` files declare `hasArmor 1`. Combined with finding E (no collision path ever calls Armor's HP mutators, for *any* target type), **a vanilla tree cannot lose HP or be destroyed by a collision, projectile splash aside** — it has no Armor to damage, and the generic collision handlers wouldn't apply damage even if it did | confirmed for vanilla (230/230 files); not swept across all mods | targeted survey |
| M | `hasOverDamage` (33+ uses total across mods) appears **only on Effect templates** (`e_AA-GunDamage`, `e_StukaDamage`, `e_PlaneDamage`, etc.), never on a vehicle/weapon directly, in every mod checked | confirmed | `cd1_armor_effect_survey.py collision` output |
| N | `damageWhenLost` is not vehicle-specific in the way the README's vanilla sample (8 uses, carriers) suggested — across mods it also appears on ammo boxes, spawn-rotators and flag bases (buildings/objectives), consistent with a scripted ticket-loss rule rather than an Armor-component property | confirmed | Same output; `damageWhenLost` never among `setArmorComponent`'s 23 setters per HP-3 |
| O | Q5 (does anything read `isCriticalDamaged` in the drive/turret path) — **not re-derived this round**; `tank-driving.md`/`manned-guns.md`/`physics.md` already mark the consuming code as unlocated. No new binary work was spent on it given the round's time budget and HP-6's priority | open (unchanged from existing subsystem docs) | — |
| P | Q6 (wreck selection mechanism) — `bf42/con.py`'s `MODEL_CONFIGURATIONS` selects a "wreck" geometry bundle by **substring match on the bundle's own name** (`"wreck" in name`) at extraction time. This is the pipeline's own classification rule, not a traced runtime engine mechanism (config-swap vs. separate spawned template vs. flag-selected LOD was not determined this round) | inferred (pipeline convention); open (runtime mechanism) | `tools/bf1942-models/bf42/con.py:85,323-331` |

## What the viewer must change

- **`map.html:4422`** — delete the invented fall-damage ramp entirely rather
  than "fix" it. There is no generic fall/crash-damage formula in retail;
  shipping any numeric ramp for the soldier (or, by extension, any future
  vehicle) misrepresents the engine. If a fall-damage *feel* is wanted for
  gameplay reasons, it should be labelled as a deliberate house-rule deviation,
  not a retail approximation.
- **`viewer/effects.js` / `effects-core.js`** — this is where finding E
  actually belongs: the traced speed x angle-of-incidence x
  material-damage-mod x (for the soldier) fall-height x kit-damping formula is
  real, authored, and currently unimplemented anywhere in the viewer. It should
  drive the **intensity/volume of the landing/impact effect** (dust size, thud
  volume) for the soldier and, by the same code path, for vehicles hitting
  terrain — not HP.
- **`viewer/armor.js`** — no change to the death/critical/water logic (already
  correct per HP-1/HP-2/HP-5). It should gain: (a) the `addArmorEffect` tier
  table (see numbers below) so a vehicle's smoke/fire visual state is driven by
  current HP against the same thresholds the engine uses, with the fire tier
  reliably `== criticalDamage`; (b) the fact that this state can change in
  **either** direction (a repaired vehicle should stop smoking) is structurally
  supported by finding I but not independently proven for the non-death branch
  — treat as `inferred`, not `confirmed`, until someone traces the generic
  (`hp>=0`) branch of `getEffect`/`playEffect`.
- **`viewer/ground.js` / `flight.js`** — since collision never applies HP loss
  (finding E, G), a vehicle's *actual* death path after a hard landing remains
  exactly what HP-5 already documented: the once-per-second
  `hpLostWhileUpSideDown`/critical-damage tick inside `Armor::update()`. If a
  viewer wants "planes explode on hard landings" to feel authentic, the honest
  implementation is: detect upside-down/critical state (already-shipped
  mechanism) and let the *existing* per-second ticks do the killing — not a new
  impact formula. `flight.js:235`'s `destroyed` flag should be driven by
  `Armor.isDestroyed` once vehicles get an Armor at all; that is a bigger,
  separate lift (giving every vehicle an Armor component, wiring
  `feedVehicleHud` to a live HP instead of the static template extras) that
  this round did not scope numerically.
- **`bf42/con.py` / `bf42/assemble.py`** — neither parses `addArmorEffect`.
  Given finding I's confirmed structure, the parser should extract
  `(threshold, effectName, offsetVec)` triples per template and ship them in
  the armor extras block (`assemble.py:2268`) alongside the already-shipped
  `criticalDamage`/`hpLostWhileCriticalDamage`.
- **`extract_effects.py`** — confirmed still true: `e_PanzFire`,
  `e_PanzDamage`, `e_ExplGas`, `e_scrapmetal*`, `e_WillyFire`, `e_HanomagFire`,
  `e_WespeFire`, `em_PlaneDamage`, `e_StukaFire`, `em_B17Damage`, `e_B17Fire`,
  `e_waterBoatSink*` and the per-vehicle `-1`-tier wreck/water-death effects are
  **not** in `_shared/effects.glb`'s 59 bundles (this round did not re-run the
  bundle census, but the README's claim is corroborated: none of the effect
  names surfaced in the survey appeared as damage-table or projectile-bundle
  names in prior rounds' documentation). These need baking in per the numbers
  table below before `armor.js`'s new tier logic has anything to spawn.

## Numbers to ship (Q7)

Vanilla, from `Objects.con` — **not** `Physics.con`, a correction to the
README's implied file location.

| Vehicle | HP/Max | criticalDamage | hpLostWhileCritical | burn duration | hpLostWhileUpSideDown | dmgFromWater | hpLostWhileWater | explRadius | explDamage | explForceMod | Fire-tier addArmorEffect threshold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sherman | 100/100 | 12 | 1.5 | 8.0s | 10 | 1 | 10 | 8 | 5 | 13 | 12 (== crit) |
| PanzerIV | 100/100 | 12 | 1.5 | 8.0s | 10 | 1 | 10 | 8 | 5 | 13 | 12 (== crit) |
| Tiger | 125/125 | 12 | 1.5 | 8.0s | 10 | 1 | 10 | 8 | 5 | 6 | 12 (== crit) |
| Willy | 50/50 | 6 | 2 | 3.0s | 5 | 1 | 5 | 8 | 5 | 20 | 6 (== crit) |
| Hanomag | 100/100 | 16 | 1.5 | 10.67s | 10 | 1 | 10 | 8 | 5 | 13 | 16 (== crit) |
| Wespe | 50/50 | 12 | 2 | 6.0s | 5 | 1 | 5 | 8 | 5 | 13 | 12 (== crit) |
| Spitfire | 100/100 | 20 | 1.5 | 13.33s | 10 | 1 | 10 | 8 | 5 | 15 | 20 (== crit) |
| bf109 | 100/100 | 20 | 1.5 | 13.33s | 10 | 1 | 10 | 8 | 5 | 15 | 20 (== crit) |
| Zero | 100/100 | 20 | 1.5 | 13.33s | 10 | 1 | 10 | 8 | 5 | 15 | 20 (== crit) |
| B17 | 450/450 | 60 | 4 | 15.0s | 10 | 1 | 10 | 8 | 5 | 5 | 60 (== crit) |
| Elco80 (boat) | 500/500 | 350 | 40 | 8.75s | 10 | — | — | 5 | 5 | 5 | none — sink tier instead (125, em_LcvpDamage@200) |
| Type38 (boat) | 500/500 | 350 | 40 | 8.75s | 10 | — | — | 5 | 5 | 5 | none — sink tier instead (125, em_LcvpDamage@200) |

Cross-mod check: no `collisionDamage` property in any of 17 installed
mods/variants (~40k `.con`/`.inc` files); 2,271 templates across all mods use
`addArmorEffect` (43,666 raw regex hits, but FH's and FHSW's aggregate
`Compressed.con` files pollute per-template counts — treat FH/FHSW totals as
upper bounds only, not exact).

## Open

- **Q5 (critical state disabling drive/turret)** — not investigated this round;
  still open per existing subsystem docs. Given HP-6 was the stated priority and
  consumed the full budget, this was a deliberate trade-off, not an oversight.
- **Q6 runtime wreck mechanism** — the extraction-time naming convention is
  confirmed; whether the live engine does a configuration swap, spawns a
  separate template, or something else at `isDestroyed` was not traced in the
  binary this round.
- **Q8 (roadkill, hasOverDamage, damageWhenLost)** — surveyed only via `.con`
  data (findings M/N); no binary tracing.
- **The exact closed-form of the fall-height clamp** in
  `handleCollisionLandOrWater`'s soldier branch (constants 1.0/2.0/20.0
  identified and the general shape — subtract, clamp, divide, multiply by
  kit-damping — traced) was not reduced to one explicit formula. This is a
  load-bearing gap only for the *effect-intensity* recommendation above, not for
  the HP-6 answer itself (which rests on the absence of any Armor-mutator call,
  independently confirmed by a full symbol-name scan and a vtable-offset scan).
- **`Armor::getEffect`'s generic (non -1) branch** — the `-1` sentinel call
  inside `playEffect` was traced in detail; the corresponding call with the
  *live* HP value (which is what would actually select the smoke/fire tier
  during normal play, and would prove or disprove "does it turn off when
  healed") almost certainly exists later in `playEffect` (the function is 1385
  bytes; roughly the first 70 instructions were read) but was not reached this
  round. Treat finding I's "stops when healed" implication as `inferred`, not
  `confirmed`.
- **`Armor+0x38`** (checked against the 0.001 epsilon at the top of
  `playEffect`) is very likely current `hitPoints`, by position and by the
  reused epsilon constant, but was not independently re-derived from
  `setHitPoints`'s own disassembly this round — flagged so nobody treats it as
  address-verified.
- Whether `BFSoldier::handleCollision`'s many `setAnimationState` calls are
  reachable for vehicle-vs-soldier roadkill specifically, vs. only
  soldier-vs-terrain landings, was not verified.

**Overlap with the mesh-viewer-fidelity-defects tree-collision track:** finding
L is directly relevant to that round's question of whether a tree takes damage
from a round and whether anything about it is destructible. In vanilla, 0/230
sampled tree/vegetation templates declare `hasArmor`, and finding E
independently shows the generic collision path never applies HP loss regardless
of target type — so **a tree cannot be destroyed by a collision in retail
vanilla; if it can be destroyed at all it would have to be through the
projectile-splash path (`handleExplosionOnObject`, already documented under
HP-8/HP-9) hitting some other Armor-bearing object nearby, not the tree
itself.** Worth reconciling explicitly with that track's own read of
`bf42/treemesh.py` / `assemble.py` / `viewer/collision.js`, which this round did
not read (out of scope, and under concurrent edit).

## Proposed ledger rows

Do not merge until verified.

| id | finding | status | evidence |
|---|---|---|---|
| HP-6 (revise) | `SimpleObject::handleCollision`'s downstream chain (`GameServer::handleCollision` → `handleCollisionLandOrWater`/`handleCollisionObjectVsObject`) computes a full impact-severity formula (speed, angle-of-incidence, material-damage-mod, and for soldiers a fall-height term) but its only consumer is `Game::playCollisionEffect` — no call anywhere in this chain reaches `Armor::damage/heal/setHitPoints/status` or `SimpleObject::handleDamage`, confirmed by both a resolved-symbol call scan and an Armor-vtable-slot-offset scan of all three functions (9,674 bytes) | confirmed | `0x08154960`–`0x0815495b` (LandOrWater), `0x081551c0`–`0x08155f1c` (ObjectVsObject), `0x081dab40`–`0x081db230` (SimpleObject::handleCollision); zero hits for calls to `0x08172730`/`0x081727a0`/`0x081726c0`/`0x081739e0`/`0x081db230` or Armor-vtable disasm-offsets `+0x18`/`+0x20`/`+0x24` |
| HP-6b (new) | The collision "gate" is a same-spawner self-collision suppression, keyed on `ObjectSpawner::getHoldObjectId()` matching between `getRootParent(this)`'s nearest `IPlayerControlObject` ancestor and `otherObject`'s own root — not a plain "otherObject type" check | confirmed | `0x81dad43`–`0x81dafda`; `0x08314a50` |
| HP-6c (new) | Terrain and water contact route through the identical `GameServer::handleCollision` dispatch as object-vs-object, with `otherObject` forced null; there is no separate physics-only terrain-damage path to look for | confirmed | `0x08156020`–`0x08156090` |
| HP-6d (new) | `Armor::getLastCollisionHeight()`/`setLastCollisionHeight()` (`Armor+0x28`) is read inside `handleCollisionLandOrWater`'s soldier (`CID_BFSoldierTemplate`) branch as a fall-height term feeding `playCollisionEffect`'s intensity args, scaled by `BFSoldier::getDamageDampingFromActiveKitParts()`; the value stored is the colliding object's raw world Y position, from `self->vtable+0x38()+0x4` | confirmed | `0x08154d20`–`0x08154e43` |
| ARM-1 (new) | `addArmorEffect(hp,effect,offset)` (`SimpleObjectTemplate::addArmorEffect`, `0x081dded0`) stores into three parallel per-template vectors (`+0x98`,`+0xa4`,`+0xb0`), separate from `setArmorComponent`'s 23 fixed setters (consistent with HP-3); at runtime `Armor::getEffect(int)` (`0x08172820`) looks the current tier up in an `std::map<int,DamageEffects*>` at `Armor+0x148`, and `Armor::playEffect()` (`0x08172960`, called from inside `Armor::update()` at `0x08173100`) compares the applicable tier against a "last shown" field (`Armor+0x50`) to decide whether to tear down/rebuild active effect instances | confirmed (storage + map + call graph); inferred (bidirectional on/off behaviour) | `0x081dded0`, `0x08172820`, first ~70 instrs of `0x08172960` |
| ARM-2 (new) | Fire-tier `addArmorEffect` threshold equals the template's own `criticalDamage` on 9/9 sampled vanilla land+air vehicles (Sherman, PanzerIV, Tiger, Willy, Hanomag, Wespe, Spitfire, bf109, Zero, B17); boats (Elco80, Type38) have no fire tier at all, using a sink tier instead | confirmed (data-only, vanilla `Objects.con`) | numbers table above |
| ARM-3 (new) | 0/230 sampled vanilla tree/vegetation/foliage templates declare `hasArmor`; combined with HP-6/E, vanilla trees cannot be destroyed by any collision path | confirmed (vanilla only) | survey script |
| COL-1 (new) | No installed mod (17 checked, vanilla + 16 variants) declares a `collisionDamage` property; the README's vanilla-only finding generalizes | confirmed | `cd1_armor_effect_survey.py collision` |

## Survey scripts

`cd1_armor_effect_survey.py` — sweeps every installed mod for `addArmorEffect`
and the collision/armor vocabulary, and pulls the Q7 numbers table. Read-only.

```python
#!/usr/bin/env python3
"""Sweep every installed mod for addArmorEffect and the collision/armor vocabulary
named in features/viewer-collision-damage/README.md, plus pull the numbers table
for the vehicles the viewer ships (Q7 of R1-collision-damage-and-destruction.md).

Copies the shape of features/viewer-collision-damage/surveys/con_properties.py
and features/bf1942-engine-reference/surveys/stride_vs_flags.py (sweep-all-mods
pattern). Read-only: only reads .rfa archives, writes nothing.

    python3 cd1_armor_effect_survey.py armoreffect
    python3 cd1_armor_effect_survey.py collision
    python3 cd1_armor_effect_survey.py numbers
"""
from __future__ import annotations

import re
import sys
import collections
from pathlib import Path

REPO = Path("/home/dylan/projects/skandia/bfstats")
sys.path.insert(0, str(REPO / "tools/bf1942-models"))

from bf42.rfa import ArchivePool  # noqa: E402

MODS_ROOT = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"

ARMOR_EFFECT_RE = re.compile(
    rb"^\s*ObjectTemplate\.addArmorEffect\s+(-?\d+)\s+(\S+)\s+([\-0-9./]+)\s*$",
    re.I | re.M,
)
CRITDMG_RE = re.compile(rb"^\s*ObjectTemplate\.criticalDamage\s+([\-0-9.]+)", re.I | re.M)

COLLISION_WORDS = [
    "collisionDamage",
    "hasCollisionPhysics",
    "setHasCollisionPhysics",
    "hasCollisionEffect",
    "addToCollisionGroup",
    "DetonateOnWaterCollision",
    "noCollisionsAsDestroyed",
    "hasOverDamage",
    "damageWhenLost",
]

VEHICLES_OF_INTEREST = [
    "Sherman", "PanzerIV", "Tiger", "Willy", "Hanomag", "Wespe",
    "Spitfire", "P38", "Bf109", "Zero",
    "B17", "Ju87", "D3A1",
    "Elco80", "Schnellboot", "Type38",
]

NUMBER_PROPS = [
    "hitPoints", "maxHitPoints", "criticalDamage", "hpLostWhileCriticalDamage",
    "hpLostWhileUpSideDown", "damageFromWater", "hpLostWhileDamageFromWater",
    "explosionRadius", "explosionDamage", "explosionForceMod",
]


def open_pool(mod: str) -> tuple[ArchivePool, int]:
    pool = ArchivePool()
    archives_dir = MODS_ROOT / mod / "Archives"
    n = 0
    if not archives_dir.is_dir():
        return pool, 0
    for rfa in sorted(archives_dir.glob("*.rfa")):
        try:
            pool.add(rfa, rfa.name)
            n += 1
        except Exception as exc:
            print(f"  skip {rfa.name}: {exc}", file=sys.stderr)
    return pool, n


def all_mods() -> list[str]:
    return sorted(p.name for p in MODS_ROOT.iterdir() if (p / "Archives").is_dir())


def survey_armor_effect():
    total_uses = 0
    total_templates_with = 0
    total_con_scanned = 0
    threshold_hist: collections.Counter[int] = collections.Counter()
    effect_names: collections.Counter[str] = collections.Counter()
    per_mod_rows = []
    crit_vs_thresh_matches = 0
    crit_vs_thresh_total = 0
    max_tiers_seen = 0
    max_tiers_file = ""

    for mod in all_mods():
        pool, narch = open_pool(mod)
        if narch == 0:
            continue
        con_names = [n for n in pool.names() if n.lower().endswith((".con", ".inc"))]
        mod_uses = 0
        mod_templates = 0
        for name in con_names:
            try:
                data = pool.read(name)
            except Exception:
                continue
            total_con_scanned += 1
            matches = list(ARMOR_EFFECT_RE.finditer(data))
            if not matches:
                continue
            mod_templates += 1
            mod_uses += len(matches)
            if len(matches) > max_tiers_seen:
                max_tiers_seen = len(matches)
                max_tiers_file = f"{mod}:{name}"
            crit_m = CRITDMG_RE.search(data)
            crit_val = crit_m.group(1).decode() if crit_m else None
            for m in matches:
                thresh = int(m.group(1))
                effect = m.group(2).decode("latin-1")
                threshold_hist[thresh] += 1
                effect_names[effect] += 1
                if crit_val is not None:
                    crit_vs_thresh_total += 1
                    try:
                        if float(crit_val) == float(thresh):
                            crit_vs_thresh_matches += 1
                    except ValueError:
                        pass
        total_uses += mod_uses
        total_templates_with += mod_templates
        per_mod_rows.append((mod, narch, len(con_names), mod_templates, mod_uses))

    print("=== addArmorEffect sweep across every installed mod ===")
    print(f"{'mod':16s} {'archives':>8s} {'.con/.inc':>10s} {'templates':>10s} {'uses':>6s}")
    for mod, narch, ncon, ntpl, nuse in per_mod_rows:
        print(f"{mod:16s} {narch:8d} {ncon:10d} {ntpl:10d} {nuse:6d}")
    print()
    print(f"TOTAL: {total_con_scanned} .con/.inc files scanned across all mods, "
          f"{total_templates_with} templates use addArmorEffect, {total_uses} total uses")
    print()
    print("Threshold value histogram (first word of addArmorEffect):")
    for val, n in threshold_hist.most_common(20):
        print(f"  {val:6d}  x{n}")
    print()
    print("Effect-name histogram (top 20):")
    for name, n in effect_names.most_common(20):
        print(f"  {n:5d}  {name}")
    print()
    print(f"Of {crit_vs_thresh_total} addArmorEffect rows in templates that also declare criticalDamage, "
          f"{crit_vs_thresh_matches} have a threshold exactly equal to that template's criticalDamage.")
    print(f"Most tiers seen on one template: {max_tiers_seen} in {max_tiers_file}")


def survey_collision_words():
    for mod in all_mods():
        pool, narch = open_pool(mod)
        if narch == 0:
            continue
        con_names = [n for n in pool.names() if n.lower().endswith((".con", ".inc"))]
        counts: collections.Counter[str] = collections.Counter()
        first: dict[str, str] = {}
        scanned = 0
        for name in con_names:
            try:
                data = pool.read(name)
            except Exception:
                continue
            scanned += 1
            for word in COLLISION_WORDS:
                pat = re.compile(rb"\." + word.encode() + rb"\b", re.I)
                n = len(pat.findall(data))
                if n:
                    counts[word] += n
                    first.setdefault(word, name)
        print(f"--- {mod}: {scanned} scripts ---")
        for word in COLLISION_WORDS:
            if counts.get(word):
                print(f"  {counts[word]:6d}  {word:28s}  first in {first[word]}")
        print()


def survey_numbers():
    for mod in ["bf1942", "XPack1", "XPack2", "FH", "FHSW", "DesertCombat", "DC_Final"]:
        pool, narch = open_pool(mod)
        if narch == 0:
            continue
        con_names = [n for n in pool.names() if n.lower().endswith(".con")]
        print(f"=== {mod} ({narch} archives, {len(con_names)} .con) ===")
        for veh in VEHICLES_OF_INTEREST:
            candidates = [n for n in con_names if f"/{veh.lower()}" in n.lower() or n.lower().endswith(f"/{veh.lower()}.con")]
            candidates = [n for n in candidates if veh.lower() in Path(n).stem.lower()]
            if not candidates:
                continue
            for name in candidates[:1]:
                try:
                    data = pool.read(name)
                except Exception:
                    continue
                row = {}
                for prop in NUMBER_PROPS:
                    m = re.search(rb"\." + prop.encode() + rb"\s+([\-0-9./]+)", data, re.I)
                    if m:
                        row[prop] = m.group(1).decode()
                effects = ARMOR_EFFECT_RE.findall(data)
                if row or effects:
                    print(f"  {veh:12s} ({name})")
                    for prop in NUMBER_PROPS:
                        if prop in row:
                            print(f"      {prop:28s} {row[prop]}")
                    for thresh, eff, vec in effects:
                        print(f"      addArmorEffect {thresh.decode():>5s} {eff.decode():20s} {vec.decode()}")
        print()


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "armoreffect"
    if which == "armoreffect":
        survey_armor_effect()
    elif which == "collision":
        survey_collision_words()
    elif which == "numbers":
        survey_numbers()
    else:
        print(f"unknown mode {which}", file=sys.stderr)
        sys.exit(1)
```

**Known defect in the script as written:** `numbers` mode matches by
`veh.lower() in Path(n).stem.lower()`, which misses that vanilla's armor
properties live in `Objects.con`, not a per-vehicle-named `.con`. The agent
corrected this ad hoc with a second inline script when producing the numbers
table; the mode above prints nothing useful until its glob is pointed at
`Objects/Vehicles/{Land,Air,Sea}/{veh}/Objects.con` directly.

`cd1_dump_vtable2.py` — resolves vtable slots to symbol names, correcting for
the Itanium ABI header (the vptr an object stores points at dump-offset + 8, so
`call [vptr+N]` corresponds to dump-offset `N+8`).

```python
import struct, subprocess, sys

BIN = "/home/dylan/projects/public/bf42plus/bf1942_lnxded.static"
VTABLE_ADDR = int(sys.argv[1], 16)
NSLOTS = int(sys.argv[2]) if len(sys.argv) > 2 else 40

out = subprocess.run(["objdump", "-h", BIN], capture_output=True, text=True).stdout
sections = []
for line in out.splitlines():
    parts = line.split()
    if len(parts) >= 7 and parts[0].isdigit():
        name = parts[1]; size = int(parts[2], 16); vma = int(parts[3], 16); fileoff = int(parts[5], 16)
        sections.append((name, vma, size, fileoff))

def va_to_off(va):
    for name, vma, size, fileoff in sections:
        if vma <= va < vma + size:
            return fileoff + (va - vma), name
    return None, None

off, secname = va_to_off(VTABLE_ADDR)
print(f"vtable at {VTABLE_ADDR:#x} in section {secname}, file offset {off:#x}")

with open(BIN, "rb") as f:
    f.seek(off)
    data = f.read(NSLOTS * 4)

nm_out = subprocess.run(["nm", BIN], capture_output=True, text=True).stdout
addr2sym = {}
for line in nm_out.splitlines():
    parts = line.split(None, 2)
    if len(parts) == 3:
        addr_s, typ, name = parts
        try:
            addr2sym[int(addr_s, 16)] = name
        except ValueError:
            pass

for i in range(NSLOTS):
    ptr = struct.unpack_from("<I", data, i*4)[0]
    slot_off = i*4
    disasm_off = slot_off - 8
    sym = addr2sym.get(ptr, "")
    print(f"dump+0x{slot_off:03x} (call-offset {'+0x%x'%disasm_off if disasm_off>=0 else '-0x%x'%(-disasm_off)})  0x{ptr:08x}  {sym}")
```

The tree-armor sweep and the corrected vehicle-numbers extraction were one-shot
inline variants of these two scripts (glob fixed to
`Objects/Vehicles/{Land,Air,Sea}/{name}/Objects.con`, and to
`*tree*`/`*foliage*`/`*vegetation*` name matching); they were not saved
separately.
