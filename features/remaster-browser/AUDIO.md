# Remaster mode: the audio half

`map.html?remaster&remasterAudio=1` (`remaster-mode.js`). Off by default
since 2026-11-12: the owner played it and heard it as "too muffled... like
having headphones on", inside a tank most of all, so `?remaster` alone keeps
the retail sound. What was muffling it was fixed the same day (below, "The
owner's verdict"). Our own BF1942 implementation
presented the way a game made today would sound. Without `?remaster`, nothing
in this note runs: the chain is built only when `REMASTER_AUDIO` is set, and
every hook it uses is null in the retail build (checked headless:
`map.html?map=wake&shots=1&mute` never installs it).

## Design

One choke point. Every placed voice of the page is set up by
`ds3d-pan.js` (`configureDs3dPanner`, `standDs3dPanner`, `ds3dRenderPoint`):
`engine-audio.js` (engines, vehicle guns and parts, every bot's and replayed
soldier's gunfire through `world-fire.js`, every impact and passing-round
script through `effect-audio.js`), `page-audio.js` (area and flag beds,
barbed wire's scrape, the refill), `comms.js` (placed radio). `ds3d-pan.js`
now carries a spatial hook (`setDs3dSpatialHook`); `page-audio.js` installs
`remaster-audio.js` as that hook in `ensureListener`, under `REMASTER_AUDIO`
only. With the hook in:

1. **The real point.** `ds3dRenderPoint` returns the voice's own position,
   height included (the hardware path the page already had for OPTIONS >
   SOUND > HARDWARE ACCELERATION), so the occlusion rays leave from where the
   sound is. The panning model stays the player's: equal power, or HRTF
   with HARDWARE ACCELERATION ticked. The chain forced HRTF at first; see
   "The owner's verdict". The distance law stays
   the script's: each layer's `Volume <- Distance` ramps times DirectSound's
   `min(1, minDistance / d)`, which is an inverse law with
   `refDistance = minDistance`. The panners keep `rolloffFactor 0` so the two
   never multiply; the near/far layer hand-overs the game authored are kept.
2. **A chain behind every panner.** The hook's `adopt` wraps the panner's
   `connect`/`disconnect`, so no caller changed how it builds its graph:

   ```
   source -> gain -> panner -> air LP -> occlusion LP -> occlusion gain -> caller's node
                                       \-> per-voice wet  (caller's node is the listener input)
   caller's node (a patch bus, a PositionalAudio gain) -> tap -> reverb in
   reverb in -> send[space] -> convolver[space] -> return (0.8) -> listener input -> limiter
   ```

   The tap is taken after the caller's node because that node is where a
   patch's master lives (`EngineAudio.bus`): a send before it would let a
   muted patch ring in the reverb. The player's own hand-weapon bus is tapped
   the same way (`tapBus`, at the 1.5 m send). The wind bed (a 2D
   `THREE.Audio`) gets two filters (`bedFilters`): muffled under a roof.
   Position changes are heard as they are written (the position params'
   `setValueAtTime`/`.value` are wrapped), because a pooled gun slot moved to
   a new shooter must be filtered for that shooter's distance from its first
   sample, not for the last one's.
3. **Speed of sound.** `world-fire.js` asks the hook `arrivalDelay(position)`
   (d / 343) and holds the round until it is within 50 ms of the ear, then
   triggers it with the remainder as a sample-exact `lead`
   (`EngineAudio.trigger(lead)`, which sets the patch clock back by as much so
   its `Time` gates count from arrival). Finding: the shipped scripts already
   delay the far report in steps: the K98's and the Garand's 100-200,
   200-300 and 300-380 m layers wait on `Volume <- Time` gates of 0.33, 0.66
   and 0.99 s, d / 343 at each band's floor. The hold is therefore what the
   gate leaves (`scriptDelayAt`): exact d / 343 at any distance, never doubled.
4. **The crack.** `passing-rounds.js` hands every flown round to the hook's
   `roundFlown`. For a supersonic round passing within 40 m, the shock reaches
   the ear at `t = (along + miss * sqrt(M^2 - 1)) / v` from the point
   `along - miss / sqrt(M^2 - 1)` down the line (`crackArrival`). A
   synthesised N-wave (Whitham: length 0.2 ms x miss^0.25, level
   miss^-0.75, a ground bounce 4 ms later, a 4 ms whip of high-passed noise)
   is scheduled there and then, through the same HRTF chain and reverb, on top
   of the game's own `Projectile_High.ssc` crack (`bulletair1..7`, which still
   plays inside 10 m).

## Laws and parameters (`remaster-audio-law.js`)

| Law | Value |
| --- | --- |
| Air absorption | Butterworth low-pass (Q 0.707, -3 dB at the corner), `fc = 20 kHz` to 25 m, then `20 kHz x (25 / d)^0.6`, floor 2 kHz: 13 kHz at 50 m, 8.7 kHz at 100 m, 3.8 kHz at 400 m. Gentler than ISO 9613-1 on purpose: the game's sounds were mixed for a chain with no air at all. (First cut: Q 0.5 from 15 m, `^0.75`, floor 1 kHz, 4.8 kHz at 100 m.) |
| Reverb send | `0.3 x clamp(sqrt(d / 10), 0.5, 3.5)`: 0.15 at 1 m, 0.3 at 10 m, 0.95 at 100 m. Gives back about half of the direct sound's 6 dB per doubling, since a reverberant field barely falls with distance. |
| Occlusion | 0 / 0.5 / 1 from two rays: the line ear to source, and ear to 3 m over the source (a wall the sound can come over is half). Full: low-pass 1.5 kHz and gain 0.55 (-5 dB; first cut 700 Hz and -7 dB); between, log-frequency interpolation. Smoothed with a 0.15 s time constant. Terrain alone is 1 (a hill). The wet send drops by half what the dry drops (sound comes round). |
| Surroundings | survey 4 Hz, reverb crossfade time constant 0.6 s. |

### Impulse responses (generated at install, nothing downloaded)

`generateImpulse`: two decorrelated seeded-noise channels under an exponential
decay (-60 dB at RT60), through a one-pole low-pass gliding from `bright` to
`dark` across the tail, faded in over `onset`, plus discrete early taps
(time, gain, equal-power pan), normalised to energy `level`.

| Space | RT60 | predelay | onset | bright -> dark | early reflections | level |
| --- | --- | --- | --- | --- | --- | --- |
| open | 0.7 s | 2 ms | 30 ms | 5000 -> 1200 Hz | 4 ms (0.2), slaps at 140 ms (0.3) and 310 ms (0.18); tail energy 0.6 | 0.4 |
| woods | 1.6 s | 6 ms | 60 ms | 4500 -> 1100 Hz | six scatter taps 4-48 ms | 1.4 |
| built-up | 1.3 s | 8 ms | 40 ms | 8000 -> 2500 Hz | house-front slaps 18, 31, 47, 66, 90, 125, 170 ms, alternating sides | 2.0 |
| inside | 0.55 s | 1 ms | 8 ms | 7000 -> 3000 Hz | seven taps 2-12 ms | 3.5 |

Measured (rendered return alone against the dry render, a K98 4.2 m away):
the reverb sits 21 dB under the report in the open, 14 in woods, 12 built-up,
6 inside.

### The classifier (`classifySurroundings`, `surveyProbe`)

One survey: a hull ray straight up (40 m), eight horizontal hull rays at ear
height (45 m), eight terrain probes (6, 15, 28, 45 m out), and the placed
trees within 30 m.

- **inside**: a roof within 14 m and walls within 12 m on more than 35 % of
  the sides, fully inside at 75 %;
- **built-up**: hulls met on more than 20 % of the sides within 45 m (terrain
  rising over the ear counts half), fully at 60 %; a roof with open sides (a
  hangar, a porch) is at least half built-up;
- **woods**: 4 to 16 trees within 30 m ramps 0 to 1;
- **open**: the rest. The four weights sum to 1.

Hulls are the extracted collision meshes the sim already places
(`WorldCollider.statics`, `static-index.js`), asked with `CG_PROJECTILES` so
fences, wire and nets (which a round passes, FF-2) do not count as walls, and
never the moved owners or dynamic bodies, so a listener in a tank is not
occluded by his own hull. Trees: `SimpleObject` nodes of the level scene whose
geometry reads as one (`isTreeTemplate`: palms, pines, aspens, jungle plants,
bushes, hedges...), bucketed in a 32 m grid once per level, 1.5 s after the
level appears (`remaster-audio-world.js`). Wake's beach classifies 0.83 open,
0.17 woods (6 palms within 30 m).

## Ray budget and cost

- Occlusion: 10 passes a second, at most 6 voices a pass, ranked by audibility
  (the caller node's gain: a silent pooled slot is never rayed), nearness, and
  how long since the voice's last ray (a far voice climbs and is never starved).
  Each voice: a 16-sample terrain march, then one hull ray, and a second only
  when the first hits. No hull ray past 300 m. A voice under 2 m (attached,
  the listener's own hull) is never occluded.
- Surroundings: 4 surveys a second, 9 hull rays and up to 32 height samples each.
- Measured on `map.html?map=wake&remaster&shots=1&mute`, headless Chrome on
  the M5 Max, a 10 s window with 14 adopted voices (8 of them occluded):
  **0.047 ms per frame** for the whole `update` (occlusion, survey, filters,
  crossfade), 342 hull rays in 10 s (34 a second). The convolvers run on the
  audio thread; a space weighted to nothing for longer than its tail is
  unplugged, so normally one or two convolve.

## The WAVs (`features/remaster-browser/audio/`)

Rendered by `tools/bf1942-models/tests/remaster_audio_render.mjs` (serve the
viewer with `serve_viewer.py 5391` first) through an `OfflineAudioContext`
with the page's own modules (`WorldFire`, `EngineAudio`, `PassingRounds`,
`area-sound.js`, `ds3d-pan.js`, `remaster-audio.js`), the page's limiter and
real samples (`models/sounds/weapons.json`, `maps/_shared/vehicle-sounds.json`,
Wake's `scene.json`). 48 kHz stereo 16-bit. Levels, onsets and spectral
centroids per window are in `measurements.json`. The rig's buildings are
boxes (`remaster_audio_rig.html` `boxCaster`); the real collider is exercised
by the page check above.

| File | What it shows |
| --- | --- |
| `a_rifle_20m_left_retail.wav` | K98 fired twice 20 m to the left, retail: DirectSound's pan, hard left (right ear -25 dB), no room, no delay. |
| `a_rifle_20m_left_remaster.wav` | The same: retail's pan (far ear -33.6 dB peak against retail's -34.8), as bright as retail (centroid 4212 Hz against 4065), the open-field return, the report 58 ms after the shot (onset 0.568 s against 0.510). The first cut, through HRTF, was 3063 Hz. |
| `b_rifle_350m_retail.wav` | K98 at 350 m firing past the listener, retail: silence, then the script's 0.99 s band delay, a thin report. No crack in this render (the game's own `bulletair` crack is an `EffectAudio` script the rig does not load). |
| `b_rifle_350m_crack_then_report_remaster.wav` | The same: the N-wave crack from up-range on the right at 0.96 s (0.5 + 0.445), the report at 1.59 s, d / 343 exact, low-passed by 350 m of air, with its echo. |
| `c_tank_passby_retail.wav` | Sherman engine (its own `.ssc`) driving past at 45 m, 20 m/s, retail. |
| `c_tank_passby_remaster_occlusion_off.wav` | The remaster chain with no house: air absorption only. Centroid 1493 Hz at the pass, as retail's (1252-1507); the first cut was 617. |
| `c_tank_passby_remaster_behind_house.wav` | A 28 x 14 x 9 m house between the road and the listener: occlusion ramps in at x = -30 and out at x = +40; behind it the note is 5 dB down and its centroid 622 Hz against 1493 in the clear (first cut: 7 dB, 308 against 617). |
| `d_gunshot_dry_remaster_reference.wav` | K98 4.2 m away, remaster chain with the reverb muted: the reference for the four below. |
| `d_gunshot_open_remaster.wav` | The same shot in open ground. |
| `d_gunshot_woods_remaster.wav` | ...in woods: long dark diffuse tail. |
| `d_gunshot_builtup_remaster.wav` | ...in a street: slaps off the house fronts, bright tail. |
| `d_gunshot_inside_remaster.wav` | ...in a 10 x 8 x 3.5 m room: dense early reflections, short loud tail. |
| `e_ambient_wake_beach_retail.wav` | Wake: the level's wind bed and island1's surf (its own `scene.json` areas, placed by `area-sound.js`), 8 s, retail. |
| `e_ambient_wake_beach_then_bunker_remaster.wav` | The same, remaster; at 4 s the listener steps into a bunker: the wind muffled, the surf occluded and the room's return on it (-5 dB, centroid 1894 to 815 Hz). |

## The owner's verdict, and what it fixed (2026-11-12)

The owner played Wake with the chain on: "The sound is too muffed. Inside a
tank it takes away from the atmosphere too much... It's like having
headphones on." Measured afterwards:

- **HRTF everywhere.** The chain had switched every panner to Chromium's
  HRTF. Against equal power, on white noise at 5 m, it lifts 50-500 Hz by
  3-4 dB and takes 2.5 dB off 3-12 kHz and 3.4 dB off 8-20 kHz ahead, 1.3
  and 2.2 dB to the side, and 7.5 and 9.7 dB behind. That tilt is a closed
  pair of headphones, and in a tank, where the fight is all round, half of
  it is behind. The chain now leaves the model to the player's sound option.
- **The air filter's corner.** At Q 0.5 a biquad is 6 dB down at its cutoff
  and already falling an octave below it, so everything past 15 m lost
  about twice the top the law meant. It is now a Butterworth and moves from
  25 m, more slowly.
- **Occlusion.** A hull between the ear and the source took everything down
  to 700 Hz. The hulls are outlines (no windows or doors), so in a village
  most of the fight went under a blanket. Full occlusion is now 1.5 kHz and
  -5 dB.

The renders below are from after the fix.

## What sounds better, what worse (from the numbers)

Better, by measurement: distance reads as distance (a little air at range,
the reverb ratio rising, the exact delay); a wall between you and a tank
takes 5 dB and the top off it; a rifle in a room rings. Direction is
retail's pan again, and near sounds are as bright as retail's.

Worse or open:
- The reverb is a send per space, not per source position: a gun fired in the
  street while you stand inside rings with the room's IR.
- The near shots peak just over 0 dBFS (+1.5) before the limiter catches them;
  that is the game's own mix at 4 m (the retail chain does it too), but the
  reverb adds a little on top.
- A pooled gun slot handed to a new shooter while the last shooter's delayed
  tail is still sounding moves that tail to the new place (the slot's hold
  covers it in practice).
- Air absorption also lands on the game's far layers, which were already
  recorded dull. Since the gentler law, a report at 350 m loses the top
  above about 4 kHz, where it lost everything above 1.7.

## Left as it is (the owner set the audio aside, 2026-11-12)

- Vehicle guns (`vehicle-audio.js`) are not delayed by distance: their fire
  loops are gated by a held trigger, not one trigger a round, so the delay
  needs its own design. They do get air, occlusion and reverb.
- Explosions keep the scripts' own `trigger Volume` + `Time` band delays (they
  already model the speed of sound in steps); not made exact.
- The player's own hand-weapon report is 2D at the shoulder (retail rule); it
  gets the reverb but no pan.
- Occlusion ignores vehicles and soldiers as blockers, and material (a wooden
  hut stops as much as a bunker).
- No early-reflection direction from the real walls the survey found; a next
  step is to steer the built-up and inside taps' pan from the survey's hits.
- Doppler is still `engine-audio.js`'s playback-rate shift, not a delay line.

## Tests

- `tools/bf1942-models/tests/test_remaster_audio.mjs` (wrapped by
  `test_remaster_audio.py`, run by `verify.sh`): the cutoff law, the send, the
  occlusion amounts and filter, the terrain march, the classifier on open,
  woods, street, room, hangar and cutting, a box-room survey, the tree grid,
  the crack timing (before the report, from up-range, and none subsonic,
  beside the muzzle or past the round's end), the N-wave, the IRs (energy,
  decay, decorrelation, repeatable), and the chain's insertion, tap refcount
  and release, and that removing the hook gives the retail pan back.
- `test_ds3d_pan.mjs` still passes unchanged: no module writes an HRTF
  panning model literally, and the retail pan is untouched. The chain test
  checks that installing it keeps the player's panning model.
