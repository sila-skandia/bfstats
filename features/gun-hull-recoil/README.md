# A gun's shove on its own hull (`fireingForce`)

**Status:** built, tested and live 2026-10-18. The exporter reads the word, the
viewer applies it, and 23 tests pin it; 3,057 glbs across nine trees carry it and
both trees are published, with the counts and the read-back off the volume in
[RUN.md](RUN.md).

Two things are open. The hull has never been seen to move in a browser, because
no input of any kind reaches a vehicle in the headless harness — RUN.md's last
section has the measurement that showed it is the harness and not this change.
And nothing is measured against a retail clip: the numbers are the game's own
data put through the engine's own arithmetic, not a fit to a recording.

## The report

> I notice in the retail client the physics on the Sherman are more detailed
> than in our browser implementation. For example, in retail if you fire the
> Sherman with the gun perpendicular to the body it pushes the tank over in the
> opposite direction of where you fire. In ours, it doesn't move at all. It's
> not specifically the Sherman, but a missing item in our implementation related
> to physics.

Right on both counts. It is one `.con` word, and it is not the Sherman's: eleven
vanilla guns and the Yamato's two turrets declare it, and the Sherman declares
the most.

## What the engine does

`ObjectTemplate.fireingForce <float>` on a `FireArms` (the engine's own
spelling, missing an `r`). Ledger **FA-19** has the full reading with every
address; the short version, out of `FireArms::Fire` (lnxded `0x0828a090`, the
block at `0x0828a43f`..`0x0828a4cf`):

```
if (template->fireingForce > 0) {              // 0x0828a293, a > 0 test
    node = getRootParent(this)->physicsNode;   // 0x0828a448, root + 0x60
    node->setIsAwake();                        // 0x0828a44e, vtable +0xd4
    M = this->getAbsoluteTransformation();     // 0x0828a45c, vtable +0x40
    a = -(M.row2) * template->fireingForce;    // 0x0828a470..0x0828a48f
    p = this->getAbsolutePosition();           // 0x0828a4c5, vtable +0x38
    node->addAccelerationAtAbsolutePosition(p, a);   // 0x0828a4cc, vtable +0x68
}
```

Four things in that are the whole behaviour, and getting any of them wrong
gives something that looks like recoil and is not:

1. **It is an acceleration, not a force or an impulse.** Mass-independent, and
   spent over exactly one 30 Hz tick, because `updatePhysics` re-seeds the
   accumulator every tick. One shot is `fireingForce / 30` m/s of hull velocity:
   the Sherman's 110 is **3.67 m/s**. A 30-tonne tank and a 2-tonne car with the
   same word would take the same velocity change, which is why the Yamato's
   turrets are 10 and the Sherman's gun is 110.
2. **It goes in at the gun, not at the centre of mass.**
   `addAccelerationAtAbsolutePosition` sums `(p - pos - comOffset) x a` into the
   rotational accumulator, so the arm from the hull's origin out to the mantlet
   turns a side-on shot into roll and yaw as well as a slide. This is the half
   that makes the tank *lean*, and it is what the report is describing.
3. **It is the root parent that takes it**, not the turret the gun hangs under:
   a traversing turret's shot moves the tank.
4. **It is posted once per trigger pull**, outside the barrel dispatch — the
   block is reached only after `code_r0x0828a230`. A four-barrel salvo fires
   four rounds and shoves the hull once.

The hull is woken first (`setIsAwake`). For every vanilla force that is belt and
braces, because `updatePhysics`' own automatic wake test fires at
`|acc|² >= 2.5` and the weakest vanilla word is 10; it is the whole story for a
mod's gun under 1.58 m/s².

### The vanilla table

`Objects.rfa` of the shipped game, read 2026-10-18:

| Gun | Force | | Gun | Force |
|---|---:|---|---|---:|
| `ShermanGunBarrel` | 110 | | `SextonCannon` | 60 |
| `T34GunBarrel` | 100 | | `PriestCannon` | 60 |
| `M10Cannon` | 90 | | `Chi-ha_GunBarrel` | 60 |
| `Pak40Gun` | 90 | | `KatyushaFireArmsBundle` | 30 |
| `T34-85GunBarrel` | 90 | | `YamatoFatCannon` | 10 |
| `TigerGunBarrel` | 90 | | `YamatoMediumCannon` | 10 |
| `WespeCannon` | 80 | | | |
| `PanzerIVGunBarrel` | 70 | | | |

The Fletcher's `40` and the Hatsuzuki's `2` are commented out with `rem`, so the
two destroyers push nothing. No aircraft, no hand weapon and no MG declares it —
a Sherman's coaxial Browning fires and the hull stands still.

The packs and the mods add more: XPack1 19 guns, XPack2 24 (its heaviest is the
`M4A1MortarFirearm` at 120), EoD 43. `patch_fireing_force.py --census` prints
the list per installed mod.

## What was built

| Layer | Change |
|---|---|
| `bf42/con.py` | `fireingForce` read onto `ObjectTemplate.fireing_force`, and listed in `_OBJECT_TEMPLATE_PROPERTIES` so `setFireingForce` resolves to it (the console object at `0x087a34c0` is type 1, a read-write property, like `recoilSize`'s) |
| `bf42/assemble.py` | `extras.fireArms.fireingForce` on the gun node, written only where the template's value is `> 0` — the engine's own gate, so a gun that declares `0` and one that declares nothing carry the same extras |
| `viewer/gun-recoil.js` | `fireingPush(matrixElements, force, out)`: the engine's `-forward * force` at `getAbsolutePosition`, in the viewer's mirrored frame (glTF forward is `-Z`, so the push is `+Z`). Framework-free, no per-shot allocation |
| `viewer/gunfire.js` | `fireShot` posts it after the barrels, once per pull, through the optional `guns.hullRecoil` hook |
| `viewer/hull-bodies.js` | `recoilOnHull(node, push)`: the gun's owner through the static index, the driven body under a crew or the parked one otherwise, `wake()`, then `addAccelerationAt` |
| `viewer/map.html` | `guns.hullRecoil` wired to it |
| `patch_fireing_force.py` | The word into already-baked glbs, JSON chunk only |

Nothing new was needed in the physics: `viewer/rigid-body.js` already ports
`PhysicsNode::addAccelerationAtAbsolutePosition` exactly (its `addAccelerationAt`),
and `DrivenBody` (`viewer/vehicle-bodies.js`) already forwards the accumulators
into the drive model's state on `flush`. The gap was only that nobody ever
called it from a gun.

## How it was checked

`tests/test_gun_recoil.py` drives `tests/gun_recoil_harness.mjs` under node
through the real `gun-recoil.js`, `gunfire.js`, `rigid-body.js` and
`hull-bodies.js` — 23 tests over seven questions:

| | Question | Answer |
|---|---|---|
| R-1 | Is the push backwards along the gun, at the gun's position? | `+Z * force` at the node's translation; a scaled node does not scale the force; nothing, `0` and a negative push nothing |
| R-2 | Once per trigger pull? | 1 barrel → 1 push; a 4-barrel salvo → 4 rounds, 1 push; 3 pulls → 3 pushes |
| R-3 | A gun with no word? | Fires, pushes nothing. `GunFire.flash` (a round the bot referee already resolved) carries no recoil either |
| R-4 | One tick's worth? | `110 / 30 = 3.667` m/s, and the 1.6 m arm above the centre of mass pitches the nose |
| R-5 | Across the hull? | **3.667 m/s sideways and −0.97 rad/s of roll** (56 °/s) off one shot, roll larger than yaw |
| R-6 | A parked, sleeping hull? | Moves: woken explicitly, and `WAKE_ACCEL_SQ` would catch a vanilla force anyway. A 1 m/s² push needs the explicit wake and gets it |
| R-7 | Does the page find the right body? | The driven body under a crew, the parked one otherwise, nothing for a gun on no placed object or with no body world |

`tests/test_assemble.py` covers the extras (the `> 0` gate and the `set`
spelling); `tests/test_patch_fireing_force.py` the patch pass (idempotent, and
it corrects or removes a key that has drifted); `tests/test_weapon_words.py`
no longer lists the word as unread.

## Delivering it to the baked trees

A tank gun is baked into two places — the vehicle's own model glb and every
level `scene.glb` that places it (Bocage alone carries 56 gun nodes). A full
bake of both to add one float is minutes a tree for vanilla and hours for the
big mods, and would re-send geometry nothing touched. So this rides the same
JSON-chunk rewrite `patch_engine_limits.py` and `patch_round_depots.py` use:

```bash
python3 tools/bf1942-models/patch_fireing_force.py --mod bf1942 --mod xpack1 ...
python3 scripts/publish-mesh-delta.py models maps --hash
```

`patch_fireing_force.py` looks each gun node's template up by name in the mod's
own chain, writes what a fresh extract would write, leaves the BIN chunk alone
and refreshes the `.glb.gz`. A second run changes nothing, and a key that
disagrees with the template is corrected rather than left — so the pass
converges whichever way a tree has drifted. A full bake from here writes the
same bytes, because `assemble.py` is the source of both.

What was patched and published on 2026-10-18 is in [RUN.md](RUN.md).

## Open

- **Nothing is fitted to a retail recording.** The arithmetic is the engine's
  and the numbers are the game's, so the result should be retail's by
  construction — but no clip has been measured for how far a Sherman actually
  slides, and a parity round could check the lean against one.
- **The suspension's answer is the viewer's, not retail's.** The push is exact;
  what the wheel springs then do with 0.97 rad/s of roll is
  `viewer/body-ground.js`, whose own parity is tracked in
  `features/vehicle-collision-physics`.
- `addRootSpeed` is the neighbouring unread word on the same templates
  (`tests/test_weapon_words.py`): 949 FHSW templates write it, and what the
  engine does with it has not been read.
