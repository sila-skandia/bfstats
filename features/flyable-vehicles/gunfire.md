# Gunfire: tracers you can see, guns you can hear

What the flown Corsair's guns looked and sounded like before this, why, and
what the data actually says. Code: `bf42/rs.py`, `bf42/assemble.py`,
`extract_map.py`, `viewer/gunfire.js`, `viewer/engine-audio.js`,
`viewer/map.html`.

## The speed-scale theory was wrong

The reported symptom was "barely visible little lines", and the standing theory
was that `TRACER_SPEED_SCALE = 0.15` was slowing 400 m/s rounds to 60 m/s
against an aircraft doing 55, so they crawled ahead instead of streaking away.

Measured, that is not what happens. `map.html` has always passed `speedScale: 1`
to `GunFire.collect`, and a round leaves the muzzle at its declared speed:

| quantity | measured |
| --- | --- |
| round speed relative to the aircraft | 399.9 m/s |
| round speed in world space | 455 m/s (400 + the airframe's 55) |
| time to the convergence point | 0.29 s |

`TRACER_SPEED_SCALE` applies only to the model browser, where a parked model is
watched from a fixed camera. Nothing about the flown path was slowed.

The convergence geometry was already correct too. Both muzzle nodes carry their
authored toe-in, and the two lines meet where the `.con` says:

| muzzle | local position | toe-in | crosses the centreline |
| --- | --- | --- | --- |
| `CorsairGuns_muzzle_1` | 2.229 / -0.245 / -2.6 | -1.1 deg | 116.1 m |
| `CorsairGuns_muzzle_2` | -2.229 / -0.245 / -2.6 | +1.1 deg | 116.1 m |

## The real cause: 2 cm of geometry

The streak was a synthetic `CylinderGeometry(0.01, 0.01, 1)` — 0.02 m across.
Stretched to the 50 m the data asks for, it was a fifty-metre thread. At 60 deg
vertical FOV over 620 px, 0.02 m at the 116 m convergence subtends **0.25 px**.
Fired down the boresight the streak is seen end-on, so its cross-section is all
there is to see, and a quarter-pixel triangle is dropped by the rasteriser
whenever it misses a pixel centre.

## What the game actually draws

`setTracerTemplate Tracer_Projectile` resolves to a `Projectile` with
`geometry TLight_m1`, `timeToLive 3`, `gravityModifier 0`, `tracerScaler 50.0`.

`TLight_m1` is a tapered spike: a four-sided pyramid 0.0061 m across at the head
(the round's own position) narrowing to a point 1.0 m behind it. Its `.rs` is
the whole appearance in four lines:

```
lighting false;        -> unlit: the streak is light, not a lit surface
transparent true;
blendSrc sourceAlpha;  -> additive
blendDest one;
depthWrite false;
texture "texture/tracklight_s";
```

`tracklight_s` is a 16x16 head-to-tail gradient, opaque and bright at the head
fading to transparent at the tail.

**`tracklight_m1` is not the tracer.** It belongs to `Fx_Tracer01` inside the
`e_Tracer01` bundle, and nothing in vanilla references `e_Tracer01` — it is dead
data. Its `sizeOverTime 0/0|16/0.110004|41/0.430006|47/1|100/1` ramp therefore
never runs, and `Tracer_Projectile` declares no ramp of its own. The only
authored scaling a vanilla tracer has is `tracerScaler`.

## `tracerScaler` is uniform (overturned 2026-10-09, see below)

One scalar, applied bodily: at 50 the streak is 0.305 m across and 50 m long.
Reading it as length alone leaves a 6 mm thread, which is the bug above wearing
a different mesh. At 400 m/s and a tracer every third of twelve rounds a second,
consecutive streaks are 100 m apart and 50 m long — the dashed receding line the
game draws.

## What `tracerScaler` really does (2026-10-09, ledger TRC-1..TRC-3)

The section above was inferred from one capture and is wrong. Read out of
`BF1942.exe` (`Projectile::handleUpdate` 0x00542870, cross-checked in lnxded
0x0831e940): every update of a projectile whose template has `tracerScaler >
0` sets its geometry's scale to

    (10, 10, min(20 x distance flown, |v| / tracerScaler))

about the mesh's own origin, along its own axes, with no translation (TRC-2).
`tracerScaler` is a **divisor of the round's speed**, X and Y are a flat x10,
and the ramp caps within a millisecond. Default 0, block skipped at 0.

| Tracer | mesh (Refractor Z) | speed / scaler | drawn |
|---|---|---|---|
| vanilla `Tracer_Projectile`, `TLight_m1` at 400 m/s (Spitfire) | 0.006 x 1.0 m, head at the origin, tail at -Z | 400 / 50 = 8 | an 8 m tail behind the round, 0.06 m across |
| the same at 1000 m/s | | 20 | a 20 m tail |
| EoD `Tracer_Projectile20mm`, `tracklight_m1` at 1000 m/s | 0.021 m x 3.1 m, CENTRED (z -1.55..+1.55) | 1000 / 60 = 16.7 | 51.7 m, 25.8 m ahead of the round and 25.8 m behind, 0.21 m across |
| EoD `Tracer_ProjectileUS/VC` (rifles), `tracklight_m1` at 1000 m/s | centred | 1000 / 100 = 10 | 31 m, straddling the round |

So the retail streak of an EoD cannon round does straddle the round, and at
the muzzle half of it is behind the gun: that is the data. What the viewer
drew before was a uniform x60 about the origin: 186 m long, 1.3 m wide,
starting 93 m behind the muzzle and through the pilot's camera (the owner's
Skyraider screenshot, 2026-10-09). Vanilla was off too, in the other
direction: x50 uniform made the Spitfire's 8 m tail a 50 m one.

Two changes in `round-launch.js` `spawnTracer`:

- the baked streak is scaled `(10, 10, authored speed / scaler)` in `data`
  mode (`lengthScale` Z, `acrossScale` 10; the turntable keeps its 1..4 m
  stand-in); `advanceTracers` floors the cross-section against `acrossScale`.
- the node's -Z goes down the line of flight. The glb's forward is -Z (the
  exporter's Z mirror puts TLight_m1's tail at +Z), and `Object3D.lookAt`
  points a plain object's +Z at its target, so the old `lookAt(pos +
  direction)` led the round with its tail: the bright head at the gun and the
  fade running ahead. Now `lookAt(pos - direction)`.

`tests/test_tracer_scale.py` (node harness `tracer_scale_harness.mjs`) pins
the EoD centred case, the vanilla trailing case and the turntable stand-in.
The width-floor table below is now against a 0.06 m real streak, not 0.3 m;
the floor still bites from a few tens of metres out.

## The width floor

0.305 m at 116 m is 1.1 px. Refractor's fixed-function rasteriser kept that
sub-pixel triangle as one bright additive pixel; modern GL drops it. So the
streak's *apparent* cross-section is floored at `TRACER_MIN_SCREEN_PX = 2.5`,
scaled per frame by its own distance, never below the real mesh, and never
touching its length:

| distance | width | on screen |
| --- | --- | --- |
| 36.8 m | 0.30 m (the real mesh) | 4.9 px |
| 136.8 m | 0.55 m | 2.5 px |
| 736.7 m | 2.97 m | 2.5 px |

**The floor dims what it widens (2026-09-26).** At full opacity the floor drew
a converged stream as two bright 2.5 px lines running on for hundreds of metres
past the crossing. The owner's retail capture of a Zero's burst shows them going
to faint specks there. Each streak now owns its materials (`tracerClone`,
`round-launch.js`), and `advanceTracers` scales opacity by `real width / floored
width`, so the light on screen is the real sub-pixel streak's. Measured in a
flown Zero: opacity 0.92 at 82 m, 0.35 at 215 m, 0.15 at 500 m.

The floor is measured against the template's **geometry** bounding box, not
`Box3.setFromObject`. That one works in world space, and the AABB of a thin
spike rotated by the airframe reads 0.42 m across instead of 0.0061 — 68x too
wide, which silently pinned the floor below the streak's own scale and made the
whole mechanism a no-op. That bug cost an hour; the symptom was a floor that
computed cleanly and never bit.

## Convergence, measured

Lateral offset of the live stream during a held burst, aircraft frame. The sign
flip between 36.8 m and 236.8 m is the two toed-in streams crossing:

| ahead | lateral |
| --- | --- |
| 36.8 m | -1.59 m |
| 136.8 m | -0.33 m |
| 236.8 m | +2.25 m |
| 436.8 m | +6.09 m |

Zero falls at ~116 m, which is where the muzzle geometry says it should.

## The cockpit cannot see its own gun line

Pre-existing, and not a tracer problem: the pilot's eye sits **1.45 m above** the
gun line, so the convergence point is 0.7 deg below the eye — dead ahead, behind
the engine cowling. A ray from the eye to every streak is blocked by
`1P_Corsair`. Hiding the 1P shell shows the stream exactly where it should be,
beside the propeller hub. Judge tracers from the chase camera or from off the
wing; the cockpit is a Corsair.

## Extraction

- `rs.py` parses `lighting`, defaulting true. `lightingSpecular` deliberately
  does not match it.
- `assemble.py` bakes the tracer projectile's geometry as a hidden
  `tracerMesh` node under the FireArms node, the same way projectile bodies and
  trail sprites are baked, and adds `tracer.geometry` to the stats so a stale
  GLB is distinguishable from a gun whose tracer genuinely has no mesh.
- `gunfire.js` clones the baked streak per round from a per-group pool and falls
  back to the old cylinder when a GLB predates this.

## Gun sound

`CorsairGuns` carries `loadSoundScript Sounds/CorsairMG.ssc` directly — on the
FireArms itself, not on a child, which is the one way the walk differs from
`find_engine_script`. A vehicle has one Engine but several guns, so
`find_weapon_scripts` collects instead of stopping at the first hit; the
Corsair's bomb rack has no script and simply does not appear.

Every vanilla weapon script declares six patches — Fire, Reload, Release, Shell
Bounce, MG distance, Fire Loop — and an MG fills only the last, the rest being
`silence.wav` at volume 0. `_firing_patch` takes the first patch with a
non-silence sample, which lands on the Fire Loop for a machine gun and on the
Fire patch for a single-shot weapon without needing to know which it has.

The Fire Loop's four layers are two pairs that hand over on distance, and the
ramps do all the work:

| layer | volume | `Volume <- Distance` |
| --- | --- | --- |
| `CAMG1` / `CAMG2` | 0.7 | 1 -> 0 over 2..4 m |
| `CAMGdist` / `BFMGdist` | 1.0 | 0 -> 1 at 4 m, 1 -> 0 over 130..250 m |

So the cockpit hears the gun and a chase camera hears the same gun from
outside, and `map.html` decides nothing — `EngineAudio` already evaluates
`Distance` and `Default`, which is all a weapon patch reads. No new machinery
was needed; the module was always a generic `.ssc` player.

Measured, master 0.7:

| state | listener distance | layer gains |
| --- | --- | --- |
| cockpit, firing | 1.2 m | CAMG1 0.7, CAMG2 0.7, dist pair 0 |
| chase, firing | 17.5 m | near pair 0, CAMGdist 1.0, BFMGdist 1.0 |
| released | — | bus 0.7 -> 0.001, voices unchanged at 4 |

Loops run from the moment the patch is built and are muted by gain alone — the
one-voice-per-role rule from the hall-echo postmortem
(`bf1942-3d-models/map-sounds.md`). Starting a buffer source per trigger pull
would restart its loop phase against the other layer every time and comb.
Holding Space for 290 frames and 58 rounds left the voice count at 4.

`WEAPON_HEADROOM = 0.75` rather than the engine's `BUS_HEADROOM = 0.28`: a gun
patch is a four-layer stack of which two are ever up, so the engine's
eleven-layer divisor would bury it. 0.75 puts the close pair's 1.4 at 1.05,
level with the engine bus's own peak, which for something as transient as
gunfire reads as sitting on top of the engine. Judged on the graph — headless
Chromium will not let anyone listen.

Lifecycle rides on the engine's generation counter, because guns are only ever
set up and torn down with the vehicle they are bolted to. Verified: leaving the
cockpit and changing map both leave zero weapon patches.

## Tests

`tests/test_assemble.py::TracerBakeTests` (the baked streak node, and a tracer
with no geometry baking none), `tests/test_rs.py` (`lighting false`, and that
`lightingSpecular` does not clear it), `tests/test_sound.py::WeaponPatchTests`
(patch selection past the silent patches, and the single-shot case).
