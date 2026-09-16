# Collision damage, burning vehicles, and destruction — research round

The map viewer (`tools/bf1942-models/viewer/`) has no damage model for anything
but the on-foot soldier. Fly into a hill, drive into a wall, shoot a tank: the
hit registers as an effect and nothing else happens. This folder holds the
**agent prompt** for finding out what the engine does, precisely enough to
implement it.

**Round 1 is done — see [Outcome](#outcome).** R1 researched, V1 verified, and
the confirmed rows are merged into `features/bf1942-engine-reference/`
(`3b46e88`). A follow-up track is running on the two questions R1 could not
answer from the dedicated server.

The shape is the one the two previous rounds used
(`features/bf1942-engine-reference/README.md`,
`features/mesh-viewer-fidelity-defects/README.md`): **a researcher reads the
engine, a separate verifier re-derives every claim, only confirmed claims reach
the plan.** Verifiers found real errors in eleven of thirteen reports in the
first round and in all ten of the second, several load-bearing. They are not
optional.

---

## The behaviours to explain

As reported, and treated as hypotheses rather than a spec. The last column is
where round 1 left each one:

| # | Reported | Verdict |
|---|---|---|
| 1 | A plane that hits the ground or a tree explodes, or takes enough damage to start burning | **Not in the engine.** A collision never costs hit points — ledger HP-6, closed in the negative. Only a projectile damages anything. What kills a crashed plane is the once-per-second upside-down tick after it comes to rest |
| 2 | Most vehicles burn below a hit-point threshold and cannot be driven, until they explode | **Burning is real** (`criticalDamage` plus the 1 Hz tick — Sherman 12 HP at 1.5/s, 8.0 s). "Cannot be driven" still has no known mechanism — R2 is on it |
| 3 | A burning tank has limited turret movement | **Still unanswered.** Nothing found so far reads `isCriticalDamaged` outside the effects and the tick — R2 is on it |
| 4 | A Sherman burns from about 8 HP | **12**, not 8 — and 8.0 is the burn's duration in seconds. `criticalDamage 12`, `hpLostWhileCriticalDamage 1.5` |

---

## Outcome

[R1](reports/R1-collision-damage-and-destruction.md) researched;
[V1](reports/V1-verification-of-R1.md) re-derived it independently — 13 of 18
claims confirmed, 4 corrected, none refuted. Merged into the corpus in
`3b46e88`: ledger rows HP-6 (rewritten), HP-6b, HP-6c, HP-6d, ARM-1, ARM-2,
ARM-3, COL-1; `subsystems/hitpoints-and-damage.md` §3 and §8; 11 new symbols
and 3 rewritten notes, 790 total.

What it settled:

- **A collision never costs hit points.** The chain below `handleCollision`
  computes a real impact-severity number and spends all of it on
  `Game::playCollisionEffect`. Confirmed by enumerating every indirect
  call-site offset in both handlers, not just the direct calls.
- **`addArmorEffect` is the burning mechanic**, fully mapped — but on the
  dedicated server the tier is evaluated **once per Armor lifetime**, behind a
  latch at `Armor+0x128` that nothing resets. The viewer cannot copy that and
  look right, which is R2's first question.
- **The fire tier is authored at exactly `criticalDamage`**, 10 of 10 vanilla
  land and air vehicles. Boats do not burn; they sink.
- **FHSW ships 76 `BreakableTree` templates with armour.** Vanilla ships none —
  relevant to the tree-collision track, which should not conclude "trees are
  indestructible" without the mod caveat.

### Open decision for a human

R1 recommends **deleting** the invented fall-damage ramp at `map.html:4422`
rather than correcting it, since retail has no such rule. That is a gameplay
change, not a fidelity fix, and has not been made. The options are: delete it
for engine fidelity, or keep it and relabel the comment as a deliberate house
rule. Nobody has decided.

---

## What the viewer does today

- `viewer/armor.js` is the engine's own `Armor` arithmetic, verified, and
  **only the on-foot soldier has one**. It deliberately omits the
  critical-damage, upside-down and water ticks because the engine skips those
  for soldiers.
- `map.html:4422` applies fall damage to the soldier through an **invented**
  safe-height/lethal-speed ramp, labelled as an approximation because the real
  rule was never found.
- No vehicle has an Armor. `feedVehicleHud` (`map.html:3967`) prints
  `Vehicle/VehicleHitPoints` straight from the glb's static template extras, so
  the HUD shows a number that can never move.
- `flight.js:235` carries a `destroyed` flag that nothing ever sets.
  `flight.js:1186` clamps an aircraft to the terrain floor and zeroes its
  vertical velocity — a landing and a crash are the same event.
- Ground vehicles have no hull collision at all
  (`features/bf1942-3d-models/ground-vehicles.md`, "Vertical-ray suspension and
  no hull collision"); wheels sample the ground function and the body sees
  nothing.
- `collision.js` has `cast` (rounds) and `sweepSphere` (bodies), and only the
  soldier and projectiles use them.
- `extract_effects.py` bakes `_shared/effects.glb` from the damage table's
  impact bundles plus projectile bundles. The **burning and death effects are
  not in it** — no `e_PanzFire`, `e_PanzDamage`, `e_ExplGas`, `e_scrapmetal*`
  among its 59 bundles.
- Neither `bf42/con.py` nor `bf42/assemble.py` parses `addArmorEffect`. The
  armor extras block (`assemble.py:2268`) carries `hasArmor`, `hitpoints`,
  `maxHitpoints`, `splashMaterial`, `criticalDamage` and
  `hpLostWhileCriticalDamage`, and nothing reads the last two.
- `replay.js` already paints smoke/fire HP-bar states from recorded server data
  and swaps in a `.wreck` model — the visual vocabulary exists; the simulation
  behind it does not.

---

## Leads already pulled

Run with `surveys/con_properties.py` (vanilla, 1,799 scripts):

- **There is no `collisionDamage` property.** Nothing in vanilla authors a
  per-vehicle crash-damage value, so whatever produces it is engine-internal or
  derived from material. This wants re-running across all 14 mods before it is
  trusted.
- The collision-adjacent vocabulary is `hasCollisionPhysics` /
  `setHasCollisionPhysics` (533/529), `hasCollisionEffect` (71),
  `addToCollisionGroup` (47, `c_CG*` values), `DetonateOnWaterCollision` (5),
  `noCollisionsAsDestroyed` (1).
- **`addArmorEffect <hp> <effect> <x/y/z>` — 430 uses — is very likely the
  burning mechanic**, and nothing in this pipeline parses it. A Sherman:

      ObjectTemplate.addArmorEffect 50 e_PanzDamage      0/0.9/-1.8
      ObjectTemplate.addArmorEffect 12 e_PanzFire        0/1.2/-1.4
      ObjectTemplate.addArmorEffect  0 e_ExplGas         0/0/0
      ObjectTemplate.addArmorEffect  0 e_scrapmetal      0/0/0
      ObjectTemplate.addArmorEffect -1 WaterWaterExplosion 0/0/0

  `12` is exactly its `criticalDamage`. Boats use `100 e_waterBoatSink`, so the
  first word is not always a critical threshold. `0` and `-1` look like
  on-death and on-water-death sentinels. All of that is a hypothesis; §4 of the
  prompt is where it gets settled.

```bash
python3 features/viewer-collision-damage/surveys/con_properties.py 'armorEffect' --values --mod FH
```

---

## Dispatch

One research track, because the questions share their sources: the impact path
and the critical/destroyed lifecycle both live inside `Armor`,
`SimpleObject::handleCollision` and `MaterialManager`, and both need the same
cross-mod `.con` survey. If it needs splitting for parallelism, the natural cut
is prompt questions 1-3 (impact to hit-point loss) against 4-7 (the burning,
death and wreck lifecycle).

The verifier is
`features/mesh-viewer-fidelity-defects/prompts/V-verifier-template.md`. Its job
description is round-agnostic; only its two path references are not, so tell
the verifier the report lives in `features/viewer-collision-damage/reports/`
and that its briefing is that round's BRIEFING sections 2-7.

```
Agent({
  subagent_type: 'general-purpose',
  description: 'R1 collision damage',
  prompt: 'Read features/mesh-viewer-fidelity-defects/BRIEFING.md (sections 2-7; ' +
          'section 1 belongs to a different round), then ' +
          'features/viewer-collision-damage/README.md, then ' +
          'features/viewer-collision-damage/prompts/' +
          'R1-collision-damage-and-destruction.md, and carry out R1. ' +
          'Return your report as your final message.'
})
```

Before dispatching:

1. `cd features/bf1942-engine-reference && ./xref.py check` — the Ghidra bridge
   must be up and the sha256 must MATCH, or every client-side claim is
   worthless.
2. Reports come back as the agent's **final text message** — subagents cannot
   use the Write tool. Save it under `reports/` here.
3. Run the verifier over the report before a single row reaches
   `features/bf1942-engine-reference/`.
