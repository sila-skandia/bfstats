# Combat playtest fixes

Four things the owner reported from play on 2026-09-25. Three of them are
fixed here. The fourth, the B17's takeoff, is measured and the mechanism
identified, but the fix is left out on purpose and the numbers are below so
whoever takes it next does not have to re-derive them.

## 1. The hand weapon kept firing after you died

What was happening: hold the trigger, die, and the Fire Loop sample keeps
playing until the weapon is torn down at respawn.

The loop is a trigger-held voice, not a per-round one. `hand-fire.js` releases
it on the trigger's falling edge (`if (!firing) page.releaseHandFireLoop()`),
and that code only runs while the body is alive: `soldier-view.js` stops
calling `footFire` the moment `soldierDead` latches, because a dead body
cannot fire. So the last thing the trigger did was start the loop, and nothing
left alive was ever going to release it.

Retail's rule is that the item stops with the holder. `holster()` had the same
gap for a different reason, since it claimed "the trigger lets go" but only
stopped the gun group, not the loop voice, so climbing into a seat while
firing left the hand weapon's loop ringing too.

The fix is one function, `soldierKit.releaseFireTrigger`, that releases the
loop, stops the gun group, clears the pulse and drops the banked click. Both
callers use it: `dieOnFoot` calls it directly (the death paths that happen in
a seat are already covered, because the weapon was holstered on the way in),
and `holster` calls it in place of its own `setFiring` line.

Files: `viewer/hand-weapon.js`, `viewer/local-player.js`, `viewer/map.html`.

## 2. A plane shot down in the air hung where it was hit

What was happening: the wreck appeared at the kill position and faded there.

`wreckVehicle` did the same thing for every kind of death. It killed the crew,
retired the hull's physics body and swapped in the wreck glb, all at the
position the hull happened to be in. A tank on the ground is fine with that.
An aircraft at 200 m is not, because retiring the body freezes it: a vehicle is
only integrated by the tick of an occupant (`world-vehicle-tick.js`), and a dead
one has none.

The engine does not work that way. HP-15 says a destroyed
`PlayerControlObject` receives no input at all
(`PlayerControlObject::handlePlayerInput`, lnxded 0x08318920), and the hull
still integrates and coasts in the same tick. The input gate is forced false
rather than early-returning, which is why the page's own comment on that line
reads that way. So a shot-down plane in the retail game is still being flown
by its own flight model with no pilot, which is what makes it descend instead
of stopping.

What landed:

- A hull whose crew dies in the air keeps its body, joins `world.falling`, and
  gets one `integrate` a tick from `stepFallingWrecks`
  (`world-vehicle-tick.js`). Every control word is forced to the engine's zero
  every tick, because the surfaces are servos with their own rates and a kill
  mid-turn would otherwise hold that deflection all the way down.
- `releaseDrivenBody` and `freezeVehicle` skip a falling wreck by its own flag.
  Parking it would replace the flight model with a body world drop, and
  freezing it swaps `updateMatrixWorld` for a no-op, which would draw the fall
  at the kill position again.
- The crash runs where the hull comes down. `landWreck` plays the impact
  effect at the landing point, retires the body, frees the hull back into the
  level's frozen scenery and puts the wreck model in place.
- The wreck's own clock still starts at the kill, so a fall that outlasts the
  10 s linger and 2.5 s fade is faded out in the air. That is the other half of
  what the owner described: sometimes it drifts down and fades, sometimes it
  reaches the ground and fades there.

Two house constants frame the flight model's own floor clamp
(`Aircraft.integrate` settles a hull at `floor + groundClearance`):
`AIRBORNE_MARGIN` of 1.5 m decides whether a death is a fall or a wreck in
place, so a plane taxiing or parked on a strip is never read as airborne, and
`LANDING_MARGIN` of 0.25 m is the contact that ends the fall.

Water counts as a surface, so a plane that comes down at sea has its crash at
the waterline. A level change clears the falling list with the rest of the
level's visuals.

Files: `viewer/vehicle-wrecks.js`, `viewer/world-vehicle-tick.js`,
`viewer/world.js`, `viewer/hull-bodies.js`, `viewer/level-statics.js`,
`viewer/map.html`.

Test: `tests/test_world.py` pins the cadence (one integration per world tick,
none on a frame that owes no tick, none when the list is empty) and the zeroed
input word, through a scenario added to `tests/world_harness.mjs`.

The sim exercises the whole path on its own: a bot plane in the 600 s Bocage
match dies in the air within 90 s, falls, and lands.

## 3. The B17 takes off like a fighter

Not fixed here. The measurement and the mechanism are below.

Flying the real extracted glbs through `aircraftSpec` and `Aircraft` on a
takeoff run, the B17 out-accelerates every vanilla fighter:

| aircraft | to 20 m/s | to 40 m/s | to 60 m/s | top speed | mass | engines | total ratio |
|---|---|---|---|---|---|---|---|
| B17 | 6.55 s | 9.28 s | 13.02 s | 70.3 | 25000 | 4 | 28.3 |
| Corsair | 7.62 s | 11.28 s | 64.93 s | 82.6 | 2500 | 1 | 18.6 |
| Spitfire | 7.63 s | 11.40 s | 74.33 s | 87.7 | 2500 | 1 | 18.6 |
| Yak9 | 7.62 s | 11.32 s | never | 55.7 | 2500 | 1 | 18.6 |

The B17 is quicker off the line than any fighter and reaches 60 m/s five times
sooner. That is the report exactly.

The reason it can be is in the engine's arithmetic. Thrust is an acceleration
applied at the engine node, so mass never enters linear motion, and the B17's
four engines each carry `setDifferential 1.9`, which comes to 28.3 against the
Corsair's single engine at 18.6. Nothing in the model opposes four engines to
one, and the flight model's own header names the missing piece: `Engine::handleUpdate`
(`0x0823e120`) runs the gearbox for every engine type, and the aircraft path
skips it. `ship.js` implements it, which is why a destroyer has a top speed.

Turning it on for aircraft is a five-line change, because `engine-revs.js`
already holds the filter, the load mean and both authored curves. Measured with
it on (`apply_gearbox.py` in the scratch probe directory, which patches a copy
of `aircraft.js`):

| aircraft | to 20 m/s | to 40 m/s | to 60 m/s | top speed |
|---|---|---|---|---|
| B17 | 8.57 s | 12.52 s | 21.2 s | 66.0 |
| Corsair | 8.20 s | 12.25 s | 49.27 s | 88.6 |
| Spitfire | 8.22 s | 12.40 s | 55.83 s | 85.7 |
| Yak9 | 8.22 s | 12.28 s | 20.97 s | 76.4 |

The ordering then matches the game. The B17 is the slowest airframe in the
set and every fighter leaves it standing, which is the behaviour the owner
describes. The load feedback is what does it, and the authored data makes that
plausible: the B17's engines declare `setTorque 2.6` against the Corsair's 15,
and `getCurrentTorque` is the divisor of the load, so four low-torque engines
get pulled down much harder than one high-torque one.

Why it is not landed: it moves every calibrated number in the flight model.
The fighters gain speed under the gearbox (the Yak9's top speed goes from 55.7
to 76.4 m/s) because their revs settle on the filter's 1.2 clamp rather than at
the pedal's 1.0, and `tests/test_flight.py` holds 54 expectations measured
against retail. Rewriting those needs a measurement to move them to, not this
table. The next step is to reconstruct the aircraft side of `Engine::handleUpdate`
and `PhysicsEngine::feedbackLoop` (`0x0823e120`, `0x0824c850`) from the binary,
confirm the load's divisor and the type branches for `c_ETPlane`, and then
re-baseline `test_flight.py` deliberately rather than by drift.

## 4. Boarding a vehicle needed you in exactly the right spot

Two things were wrong, and only one of them was the entry radius.

The radius is not too small. Reading every `EntryPoint` in the Wake scene, an
authored `setEntryRadius` is generous and the reach is measured from the door
point, which sits inside the hull:

| vehicle | radius (m) |
|---|---|
| Corsair | 5.0 |
| SBD / SBD-T | 5.4 / 5.8 |
| Shokaku / Hatsuzuki | 3.2 to 7.5 |
| Sherman | 3.6 |
| Chi-ha | 3.1 |
| AA guns, flak38 | 3.2 |
| Defgun | 3.5 |
| M3A1 | 2.6 / 3.5 |
| Ho-Ha | 2.3 / 2.8 |
| Willy, BlackMedal | 2.3 |
| Stationary_Browning | 1.1 |

The aircraft carry the largest entry radius of anything in the level, so
walking up to a plane was never the tight case.

What was actually tight is when the lookup happened. `E` entered the cached
offer from the HUD's proximity sweep, and that sweep runs at 4 Hz
(`ENTRY_SCAN_PERIOD = 0.25`), so pressing the key the moment you arrived did
nothing until a sweep latched it, and there was a window where it could seat
you in a door you had already walked away from. The engine searches on the
press: `c_PIUse`'s rising edge runs `checkPlayerTriggers` then
`toggleEntryPoint` then `BFfindEntryPoint` (lnxded 0x0831d770, ledger SEAT-1
and SEAT-2), with the player's position as it stands at that instant.

`useKey` and the mobile ENTER button now call `nearestEntry()` on the press.
That is the same question the sweep asks, asked at the instant of the press,
and the cached offer is only the fallback for a page whose door list is not
indexed yet. Standing still for a fifth of a second is no longer part of
getting in.

If boarding still feels tight after this, the next thing to measure is the
distance the check uses for the soldier, which is currently his feet plus 1 m
against the door's own height. `vehicle-entry.js` measures that; nothing else
does.

Files: `viewer/page-input.js`, `viewer/touch-controls.js`, `viewer/map.html`.

## What was not run

`./scripts/verify.sh` has not been run. It covers the API and the bfstats.io UI
through Playwright, and neither loads this viewer, so it would say nothing about
any of the four items above; the browser check that does is described next.

## How the two landed fixes were checked in a browser

With `./scripts/verify.sh` inapplicable, the two behavioural fixes were driven
in a real Chromium against the real extracted Wake scene, on an Instant Battle
(`map.html?map=wake&team=1&shots=1`), through the page's own `window.__*` hooks.

Death while holding the trigger, at the Corsair's hardstand:

| step | `firing` | `shots` |
|---|---|---|
| on foot | false | 0 |
| trigger held | true | 5 |
| just killed (`hp 0`) | false | 6 |
| killed, two and a half seconds later | false | 6 |

The gun stops cycling on the frame the body dies, and `shots` never advances
again. Before the change there was no release on that path at all.

Entering the Corsair, pressing `E` once at each offset from its hull, reading
the page's own `nearEntry` offer at the moment of the press:

| offset from the hull | sweep's offer | seated |
|---|---|---|
| 1 m, +x | none | no (the teleport put the man inside the fuselage and physics ejected him) |
| 1 m, ±z | none | yes |
| 5.6 m | none | no |
| 12 m | none | no |

Every press that boarded did so with the sweep's offer empty, which is the
reported bug in one line: the old code entered the cached offer, so `E` did
nothing until a 4 Hz sweep latched one. The two misses are correct, both
outside the plane's 5.0 m radius.

The control run for the first table (the same probe with `releaseFireTrigger`
taken back out) did not complete. The deploy screen would not hold a spawn long
enough to place a man, so the "shots keep climbing" half of the pair is
established by the code path rather than measured.

The viewer's own suite (3.4 k tests, `python3 -m unittest` over
`tests/test_*.py`) is green apart from `test_meme`'s clean-page floor, which
counts what the installed game archives read and touches nothing here.