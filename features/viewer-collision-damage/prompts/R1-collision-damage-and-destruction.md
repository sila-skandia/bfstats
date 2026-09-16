# R1 — Collision damage, the burning state, and what a destroyed vehicle is

You are a research agent on the map viewer. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` first — sections 2 (the
engine corpus and `xref.py`), 3 (the shipped data and `ArchivePool`), 4 (the
viewer's modules), 5 (running it headlessly), 6 (how to report) and 7 (house
rules) are round-agnostic and apply to you unchanged. Section 1 and its defect
list belong to a different round; ignore them. Then read
`features/viewer-collision-damage/README.md`, which holds the current state of
the viewer and the data leads already pulled for you.

**You read the engine and the shipped data. You do not change the viewer.**

---

## What we are trying to be able to build

The viewer today has no damage model for anything but the on-foot soldier.
Nothing that flies into terrain, drives into a wall, or is shot at ever loses a
hit point, catches fire, stops working or dies. The end state we want is the
retail one, and the request that started this names four behaviours:

1. An aircraft that hits the ground or a tree explodes, or takes enough damage
   to start burning.
2. Most vehicles have a hit-point threshold below which they burn and cannot be
   driven, until they explode.
3. A burning vehicle (Willys, Sherman, Panzer, Tiger were the examples) has
   limited turret movement.
4. The burn is not instant — a Sherman burns from something like 8 HP down.

**Treat all four as hypotheses to test, not as a specification.** They are a
player's memory of the game, which is good evidence about what retail *looks*
like and weak evidence about what the engine *does*. Item 3 in particular has
no obvious mechanism in what the corpus has read so far, and item 4's exact
number is contradicted by the data (`criticalDamage 12` on a Sherman, not 8).
If a behaviour does not exist in vanilla Refractor, saying so with the evidence
is a better result than finding a plausible place it could live. If it exists
only in a mod (FH and FHSW rewrite a great deal), say which.

---

## What is already settled — do not re-derive it

From `features/bf1942-engine-reference/subsystems/hitpoints-and-damage.md`,
already verified and already shipping in `viewer/armor.js`:

- **HP-1/HP-2.** One `Armor` component per Armor-bearing object. `damage`,
  `heal` and `setHitPoints` all route through `Armor::status(float)`
  (`0x081739e0`), which decides death at `pendingHP <= 0.001`, sets
  `isDestroyed` **and** `isCriticalDamaged`, credits the killer, and fires the
  dying object's own explosion when `explosionDamage > 0.001`.
- **HP-3.** `SimpleObjectTemplate::setArmorComponent` (`0x081ddae0`) copies a
  fixed 23 setters into a pooled `Armor`. `material` is not among them — an
  Armor's material is always the constructor's hardcoded `0`.
- **HP-5.** `Armor::update(float dt)` (`0x08172f40`) gates critical-damage and
  upside-down HP loss behind a `+=dt` accumulator at `+0xe8` that fires at
  1.0 s, and skips that path **entirely for soldiers**. The loss is a flat
  amount per firing, not scaled by `dt`.
- **HP-7.** `SimpleObject::handleDamage(float)` (`0x081db230`) walks the
  composite chain for the nearest Armor and dispatches on the sign of its one
  argument. No per-body-part or per-material scaling in that function.
- **HP-9/HP-10.** Splash: hard cutoff at `explosionRadius`, a material-pair
  multiplier from `MaterialManager::getDamageMod` (`0x08175040`) into
  `calcDamage` (`0x0814b520`); soldiers are sampled at 3/9/9 points with
  standing dividing by 18.
- **HP-12.** Sherman 100/100, `criticalDamage 12`,
  `hpLostWhileCriticalDamage 1.5`, `hpLostWhileUpSideDown 10`,
  `hpLostWhileDamageFromWater 10`, `explosionRadius 8`, `explosionDamage 5`,
  `explosionForceMod 13`. HP is on the **root object**, shared by every seat —
  never per seat (VHUD-8, R2-31).
- The damage arithmetic for a *shot* is already modelled in
  `tools/bf1942-models/bf42/damage.py` and shipped as
  `viewer/maps/_shared/damage.json`: `materialDamage(att) * damageMod(att,def)
  * cos(angle) * distanceMod`.

**And the one thing the corpus explicitly does not know, which is the centre of
this round:**

> **HP-6 (open).** `SimpleObject::handleCollision` (`0x081dab40`) walks the
> composite chain for the nearest Armor and calls its `collision()` (vtable
> `+0xe8`) and `setLastCollisionHeight` (vtable `+0xf8`) on physical contact —
> but a gate at `0x81dae30` (`call [otherObject_vtable+0x90]`) can bypass the
> whole block and was never traced past `0x81daf32`. **No fall-damage formula
> exists anywhere `handleCollision`, Armor's own code, or `handleDamage`
> reach.** Leads named but not followed: `ResponsePhysics::addFriction`
> (`0x0825b6e0`) and `PhysicsNode::updatePhysics` (`0x082543d0`).

`map.html:4422` is honest about the consequence: the soldier's fall damage
there is an invented ramp between a safe height and a lethal one, flagged as an
approximation, because nobody has found the real rule. **If you find it, you
close HP-6 and you correct a shipped guess.** That alone justifies the round.

---

## Questions, in priority order

### 1. What converts an impact into hit-point loss?

Close HP-6 or prove it cannot be closed from these binaries. Specifically:

- Trace `handleCollision`'s pre-gate at `0x81dae30` — what is
  `otherObject_vtable+0x90`, which classes return what, and does the gate
  routinely skip the block?
- Follow `Armor::collision()` (vtable `+0xe8`, get the real address out of the
  82-slot vtable dump at `0x0871d220`) and `setLastCollisionHeight`
  (`+0xf8`). What do they store, and **who reads what they stored?** A stored
  height that nothing consumes is itself a finding.
- Follow the two physics leads. If the damage is applied from inside the
  physics response rather than from `handleCollision`, name the call site.
- **What quantity drives it**: closing speed, speed along the contact normal,
  fall height, kinetic energy, or a fixed amount per contact? Is there a
  threshold below which a contact is free, and is it per-template or global?
- Is mass involved? Is the material of either surface involved (remember HP-3:
  an Armor's own material is always 0, so a material term would have to come
  from the struck face, not the Armor)?
- **Is it symmetric?** Does a plane hitting a tree damage the tree, and does a
  tank ramming a jeep damage both?

### 2. Why does a plane explode where a jeep bumps and survives?

The user's first behaviour. Find out whether that is one formula with a speed
term, a per-template flag, a collision-group rule, or a separate aircraft-only
path.

Data lead already run for you: across vanilla's 1,799 scripts there is **no
`collisionDamage` property of any kind** (see README's survey). The nearest
candidates are `hasCollisionEffect` (71 uses), `hasCollisionPhysics` /
`setHasCollisionPhysics` (533/529), `addToCollisionGroup` (47, values like
`c_CGLadders`), `DetonateOnWaterCollision` (5) and `noCollisionsAsDestroyed`
(1). **Re-run that survey across all 14 mods** before you rely on "no such
property" — vanilla being silent about something is exactly the trap this
codebase keeps falling into.

### 3. Which contacts count at all?

The viewer has three collidable kinds (`viewer/collision.js` header): the
terrain heightfield, the sea plane, and static hulls. For each, and for
object-vs-object:

- Does the engine route it through `handleCollision` at all, or is terrain
  contact handled purely inside physics with no damage path?
- What does `hasCollisionPhysics 0` mean for damage specifically — no contact,
  or contact without damage?
- What do the `c_CG*` collision groups do, and is there a group that suppresses
  damage?
- Water: `damageFromWater` / `hpLostWhileDamageFromWater` /
  `WaterDamageDelay 90` are already known to be a timed drown tick (HP-5), not
  an impact. Confirm a plane ditching in the sea takes the impact path, the
  drown path, or both.

### 4. `addArmorEffect` — the burning mechanic

This is almost certainly what the user is describing, and it is authored data
we already have but have never parsed. A Sherman declares:

```
ObjectTemplate.addArmorEffect 50 e_PanzDamage    0/0.9/-1.8
ObjectTemplate.addArmorEffect 12 e_PanzFire      0/1.2/-1.4
ObjectTemplate.addArmorEffect  0 e_ExplGas       0/0/0
ObjectTemplate.addArmorEffect  0 e_scrapmetal    0/0/0
ObjectTemplate.addArmorEffect  0 e_scrapmetalsmoke 0/0/0
ObjectTemplate.addArmorEffect -1 WaterWaterExplosion 0/0/0
```

430 uses in vanilla. Note that `12` is exactly the Sherman's `criticalDamage`.
Establish:

- Is the first word an HP threshold, and is the rule "active while `hp <=
  threshold`"? What are `0` and `-1` — literal thresholds, or sentinels for
  "on death" and "on water death"?
- **Who reads it?** HP-3 says `setArmorComponent`'s 23 copied setters do not
  include it, so the list lives somewhere else — find the owner, the storage,
  and the per-frame or per-event code that starts and stops these effects.
- Is the vector an object-space attach offset? Does the effect follow the
  object, or spawn at a world position once?
- Does an effect stop when HP goes back **up** (a repaired tank stops smoking)?
  Does it survive onto the wreck?
- Is it one effect at a time or all matching thresholds at once?
- Survey all 14 mods: how many templates use it, the distribution of thresholds
  against each template's own `criticalDamage`, and whether any mod uses more
  than the vanilla 3-tier smoke/fire/death shape.

### 5. What does the critical state actually disable?

The user reports "cannot be driven" and "limited turret movement". Test both.

`isCriticalDamaged` is set in `status()` alongside `isDestroyed` at death, and
HP-13 says the non-death branches send message ids `0x13`/`0x14`/`0x15` to the
player on entering, leaving and reviving into critical. So the flag exists and
is broadcast. The question is **who reads it**:

- Does anything in `PhysicsEngine::updatePhysics` or the drive path consult it
  (engine power, max speed, a hard stop)?
- Does anything in the turret/rotational-bundle path consult it (rotation
  speed, angle limits)? `subsystems/tank-driving.md` and `manned-guns.md` are
  where the confirmed turret code lives — check there before the binary.
- Does seat entry check it (can you get into a burning tank)?
- Does the **client** do something with `0x13`/`0x14`/`0x15` that the dedicated
  server has no equivalent for — a HUD state, a sound, a camera shake? That
  would have to come out of `BF1942.exe`, not lnxded.

If no code reads it beyond effects and the HP tick, **say so plainly**. "The
engine does not restrict a critically damaged vehicle; what the player
remembers as 'it won't drive' is X" is a valid and valuable answer — and then
find X (candidates: the tank is simply dead within 8 s at 1.5 HP/s, or the
mobility loss is a mod behaviour).

### 6. Death, the explosion, and the wreck

- What happens after `status()` sets `isDestroyed`, in order: the on-death
  explosion (HP-8's `sourceArmor = NULL` problem is already open — do not spend
  the round on it), the effects, the model change.
- **How does the wreck appear?** `bf42/con.py:85` knows
  `MODEL_CONFIGURATIONS = ("complex", "wreck")`, so a template can carry a
  wreck geometry alternative. Is the wreck a configuration swap on the same
  object, a separate spawned template, or an LOD-style alternative selected by
  a flag? Name the selector.
- Is the wreck collidable? `noCollisionsAsDestroyed` exists exactly once in
  vanilla — what is its default, and what does the engine do with it?
- What ejects the occupants, and do they take damage on the way out?
- How long does a wreck live, and what removes it? Is respawn a property of the
  spawner rather than the vehicle?

### 7. The numbers to ship

A data table the implementer can paste, for the vehicles the viewer actually
ships (start from `viewer/maps/*/models.json`, and cover at least Sherman,
PanzerIV, Tiger, Willys, Hanomag, Wespe, and a fighter, a bomber and a boat):
`hitpoints`, `maxHitpoints`, `criticalDamage`, `hpLostWhileCriticalDamage`,
`hpLostWhileUpSideDown`, `damageFromWater`, `hpLostWhileDamageFromWater`,
`explosionRadius`, `explosionDamage`, `explosionForceMod`, plus every
`addArmorEffect` row. Vanilla first, then say which of the 14 mods disagree
materially.

State the burn duration each row implies (Sherman: 12 HP at 1.5/s = 8.0 s) and
check it against the accumulator semantics in HP-5 — the first tick's timing
versus every tick after it.

### 8. Secondary, only if the above is done

- **Roadkill.** Is a soldier run over by a tank damaged through the same
  collision path, or a separate one? Same question for a soldier standing where
  a plane lands.
- **`hasOverDamage`** (33 uses, all on effect templates like `e_AA-GunDamage`)
  — what is it, and is it related to any of the above?
- **`damageWhenLost 10`** (8 uses, carriers) — a scripted ticket rule, or an
  Armor one?

---

## Deliverable

The report shape in BRIEFING §6, plus:

1. **Survey scripts** written under the session scratchpad with a `cd1_` prefix
   (a sibling agent will overwrite a generic name), with their full source in
   the report. Copy the shape of
   `features/bf1942-engine-reference/surveys/stride_vs_flags.py`.
2. **An explicit "what the viewer must change" section, file by file**, with
   numbers. The likely surface, for orientation, is: `viewer/armor.js` (the
   component exists and is correct — does it need the critical/upside-down
   tick, currently omitted as soldier-only?), `viewer/ground.js` and
   `viewer/flight.js` (nothing has an Armor, and `flight.js:235`'s `destroyed`
   flag is never set), `viewer/collision.js` (has `cast` and `sweepSphere`;
   does a body-vs-static sweep exist at all for vehicles?), `map.html`'s
   `drive()`/`pilot()`/`feedVehicleHud`, `viewer/effects.js` and
   `effects-core.js` (one-shot impact bundles today — can they run a persistent
   attached emitter?), `bf42/con.py` and `bf42/assemble.py` (neither parses
   `addArmorEffect`; the armor extras block at `assemble.py:2268` would need
   it), and `extract_effects.py` (which collects only damage-table and
   projectile bundle names, so `e_PanzFire`, `e_PanzDamage`, `e_ExplGas` and
   `e_scrapmetal*` are **not** in `_shared/effects.glb` today — confirm that
   and say exactly which templates the round needs baked in).
3. **Proposed ledger rows**, including an explicit verdict on HP-6 — closed
   with an address, or still open with what you eliminated. Do not edit the
   corpus.
4. **An explicit verdict on each of the four reported behaviours**: confirmed
   in vanilla / confirmed in a named mod only / not in the engine, with the
   evidence for each.

---

## What would make this report wrong

- Asserting a fall-damage or crash-damage formula that you fitted to observed
  behaviour rather than read out of the binary. The existing `map.html` ramp is
  already that, and it is labelled as a guess. A second guess is worth nothing.
- Answering question 5 with "the flag exists, so presumably the engine
  restricts it". The question is who reads the flag.
- Reading `addArmorEffect`'s first word as a threshold because 12 happens to
  equal the Sherman's `criticalDamage` — one coincidence across 430 uses.
- Any "always" or "never" claim about the `.con` data derived from vanilla
  alone. Sweep all 14 mods and say how many files you read.
- Using `bf1942_lnxded.static` for anything about drawing. The burning effect,
  the wreck's appearance, the HUD's reaction to `0x13`/`0x14`/`0x15` and the
  camera's behaviour on death can only come from `BF1942.exe` through
  `xref.py`. Say which binary each claim came from.
- Reporting the player's four behaviours back as confirmed because the data
  looks compatible with them. Item 3 especially: if nothing reads
  `isCriticalDamaged` in the turret path, the honest finding is that it does
  not exist.
