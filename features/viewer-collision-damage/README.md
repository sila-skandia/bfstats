# Collision damage, burning vehicles, and destruction — research round

The map viewer (`tools/bf1942-models/viewer/`) has no damage model for anything
but the on-foot soldier. Fly into a hill, drive into a wall, shoot a tank: the
hit registers as an effect and nothing else happens. This folder holds the
**agent prompt** for finding out what the engine does, precisely enough to
implement it.

Nothing here has been dispatched. Dispatch is a separate, deliberate act — see
[Dispatch](#dispatch). The model is deliberately unspecified.

The shape is the one the two previous rounds used
(`features/bf1942-engine-reference/README.md`,
`features/mesh-viewer-fidelity-defects/README.md`): **a researcher reads the
engine, a separate verifier re-derives every claim, only confirmed claims reach
the plan.** Verifiers found real errors in eleven of thirteen reports in the
first round and in all ten of the second, several load-bearing. They are not
optional.

---

## The behaviours to explain

As reported, and to be treated as hypotheses rather than a spec:

| # | Reported | First read |
|---|---|---|
| 1 | A plane that hits the ground or a tree explodes, or takes enough damage to start burning | No crash-damage formula is known to exist anywhere — this is corpus open item **HP-6** |
| 2 | Most vehicles burn below a hit-point threshold and cannot be driven, until they explode | The threshold is real and authored (`criticalDamage`); "cannot be driven" has no known mechanism |
| 3 | A burning tank has limited turret movement | No known mechanism. May be a mod behaviour, or a misremembering |
| 4 | A Sherman burns from about 8 HP | The authored number is **12** (`criticalDamage 12`, `hpLostWhileCriticalDamage 1.5` — 8.0 seconds of burn) |

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
