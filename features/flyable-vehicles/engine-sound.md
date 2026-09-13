# Engine sound: the `.ssc` format, the RPM crossfade, and a Web Audio recipe

How a BF1942 aircraft's engine note rises with throttle, read out of the
vanilla game data, and how to reproduce it in the map flythrough viewer.
Focus vehicle: **the Corsair** (US fighter on Wake).

Every claim below was verified against the installed game
(`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/` —
`Objects.rfa`, `sound.rfa`, `sound_001.rfa`) or against this repo. Survey
scope: **all 981 `.ssc` files in vanilla Objects.rfa**, not just aircraft.
Confidence markers: `confirmed` (read directly from data / multiple
consistent occurrences), `strong inference` (single consistent
interpretation of the data), `speculative` (plausible, unverified).

Companion docs: [flight-model.md](flight-model.md),
[README.md](README.md). Existing audio plumbing this must reuse:
`tools/bf1942-models/viewer/map.html` (`setupSounds` / `updateAudio`),
`tools/bf1942-models/extract_map.py` (`resolve_sound`),
`tools/bf1942-models/bf42/level.py` (`parse_ssc`), and the lessons in
`features/bf1942-3d-models/map-sounds.md`.

---

## 1. The `.ssc` sound-script format

A `.ssc` is a line-oriented text script attached to an object template with
`ObjectTemplate.loadSoundScript <path>` (e.g. the Corsair engine:
`Objects/Vehicles/Air/Corsair/Physics.con` ->
`ObjectTemplate.loadSoundScript Sounds/CorsairEngine.ssc`). A census of
`loadSoundScript` across Objects.rfa shows which classes carry sound:
EffectBundle 83, RotationalBundle 82, FireArms 56, Engine 51, Projectile 46,
HandFireArms 27, AnimatedBundle 22, Wing 22, LandingGear 14, plus a handful
of others (`confirmed`).

### 1.1 Structure

```
preprocessor lines (#include / #templateLevel / #beginMap)
newPatch                <- starts event slot 1
  load <wav>            <- sample (voice) 1 of the patch
    ...sample directives...
    beginEffect ... endEffect     <- zero or more modulation effects
  load <wav>            <- sample 2, plays SIMULTANEOUSLY with sample 1
    ...
newPatch                <- event slot 2
  ...
```

- A **patch** is one event slot on the owning object. Patch order is the
  binding: for `FireArms`/`HandFireArms` the six slots are, in order,
  **Fire, Reload, Release, Shell Bounce, MG distance, Fire Loop**
  (`confirmed` — the section comments in
  `Objects/Vehicles/Air/Corsair/Sounds/FireHigh.ssc` and
  `Objects/HandWeapons/Bar1918/Sounds/High.ssc` agree, and
  CorsairMG silences exactly the first five with `silence.wav`). For
  `LandingGear` the two slots are **Gear Out, Gear In**
  (`Objects/Vehicles/Air/Common/Sounds/LandingGearHighMed.ssc`,
  `confirmed`). An `Engine` uses a single patch: triggered while the engine
  runs, released when it stops (`strong inference` from the
  `Time`-attack / `TimeRelease`-fade / `trigger Release` shape of every
  engine script).
- All `load`ed samples in a patch play **together** (layers), except when
  `randomPlay 1` closes the patch — then one sample is picked at random per
  trigger (`confirmed`: `Objects/Effects/Common/Sounds/fire_High.ssc` has
  three crackle loops + `randomPlay 1`; Bomb.ssc's release patch has two
  alternates + `randomPlay 1`).
- The engine's parser is extremely tolerant: the shipped data contains
  typos (`oad` x4, `pram` x2, `endeffec`, `volume.2`, decorative
  `####...` banner lines) that are simply ignored (`confirmed` by survey).

### 1.2 Preprocessor directives

| Directive | Meaning | Evidence |
|---|---|---|
| `#include <relpath>` | Textual include, relative to the including file. 1006 uses. | `CorsairEngine.ssc`, `EngineHigh.ssc` (`confirmed`) |
| `#templateLevel HIGH\|MEDIUM\|LOW` | Everything until the next `#templateLevel` only applies at that **sound-detail setting** (Options -> Sound). 283/277/254 uses. This is *not* the RPM layering — see section 2. | `confirmed` structurally; the mapping to `game.setSoundDetail` (1/2/3 in `Settings/Profiles/skandia/Sound.con`) is `strong inference` |
| `#beginMap <Name> ... #endMap` | Declares an extern control map: named channels the owning object feeds at runtime. Exactly two exist in vanilla: `Engine` (`Rpm`, `DiveAngle`) in `Objects/Vehicles/Common/Sounds/EngineMap.ssc` and `Effect` (`Speed`, `Angle`) in `Objects/Effects/Common/Sounds/SoundMap.ssc`. | `confirmed` |
| `beginSkip` | Comment-out block. Occurs once in vanilla (`Objects/Vehicles/Sea/Common/Sounds/Mid/AAfire.ssc`). | `confirmed` it exists; semantics `strong inference` |

### 1.3 Sample directives (complete vanilla vocabulary, by frequency)

| Directive | Count | Args / meaning |
|---|---|---|
| `load <path>` | 4699 | Starts a new sample. Path template is `@ROOT/Sound/@RTD/<name>.wav`; `@ROOT` = mod root, `@RTD` = the sample-rate directory for the current quality setting (`sound/11khz`, `sound/22khz`, `sound/44kHz` inside sound.rfa — `confirmed`; the `game.setQuality 0/1/2` mapping is `strong inference`). |
| `minDistance <m>` | 4125 | DirectSound3D minimum distance — the radius inside which the voice is at full volume and beyond which the API's own rolloff would begin. Values 1-300. In practice the explicit `Distance` ramps do the audible attenuation work (section 4). |
| `priority <n>` | 4117 | Voice-stealing priority, observed range -9..10, higher wins. Matters because the game mixes into a fixed pool (`Sound.setHardwareVoiceLimit 32`, `game.setChannels 48` in Settings). |
| `randomStartPitch <a>/<b>` | 2709 | Per-play random pitch offset (e.g. `.05/.05`, `0.25 / 0.0`). Two-sided range, `a` up / `b` down (`strong inference`; unambiguous that it is a start-time pitch randomiser — DICE's own anti-phasing trick for identical loops on multiple vehicles). |
| `dopplerOff` | 2524 | Disables doppler for this sample. Global doppler is on (`Sound.setDopplerFactor 1`). Note: the engine *loops* do NOT set it — plane engines are dopplered; the start/stop one-shots and gunfire mostly do set it (`confirmed`). |
| `volume <0..1>` | 2413 | Base linear gain (default 1). |
| `newPatch` | 1538 | New event slot (section 1.1). |
| `loop` | 1354 | Sample loops until the patch is released. |
| `trigger Volume\|Release` | 1244 / 98 | `Release`: sample plays when the patch is *released* (engine-stop clunks, gear-stop clunks). `Volume`: the sample only starts once its computed volume becomes non-zero — the delayed-start gate. Used with a step `Time` ramp to delay distant explosion layers by the speed of sound: `e_ExplGas/Sounds/High.ssc` delays its 100 m layer 0.3 s, 200 m layer 0.55 s, 400 m layer 0.75 s (~340 m/s — `confirmed`). |
| `relativePosition <x>/<y>/<z>` | 954 | Voice offset from the owning object's origin, in its local frame (x right, y up, z forward). E.g. Corsair cockpit layer `-.9/.3/-4.2` — 4.2 m behind the Engine node, which itself sits at z +4.149 on the plane. |
| `stop FinishSample\|Immediate` | 415 / 2 | On patch release: let the sample finish its current pass (loop iteration) vs. cut instantly. The MG fire loops all use `FinishSample` so a burst ends on a bullet boundary, not mid-crack (`confirmed` usage; exact loop-boundary semantics `strong inference`). |
| `randomPlay 1` | 238 | Patch plays one randomly selected sample instead of all (section 1.1). |
| `stereo` | 185 | Marks the sample for non-spatialised (2D) playback. Correlates exactly with the 2-channel wavs — `CAMG1/2.wav` are the only stereo files in the Corsair's set and both carry it (`strong inference`). |

`ObjectTemplate.setAttachToListener 1` (con-side, e.g. ShermanEngine) glues
the object's voices to the listener; the Corsair does not use it
(`confirmed`).

### 1.4 Effects (modulators)

```
beginEffect
	controlDestination Volume | Pitch
	controlSource <source>
	envelope Ramp | Linear
	param <p1> ... param <pN>
endEffect
```

Survey totals: destination `Volume` 8562 / `Pitch` 1326; envelope `Ramp`
9102 (8526 with 4 params, 573 with 6, 2 malformed with 3) / `Linear` 786
(always 2 params). Control sources (`confirmed`, with units):

| Source | Count | Value fed to the envelope |
|---|---|---|
| `Distance` | 4699 | metres from listener to the voice |
| `Time` | 1958 | seconds since the patch triggered |
| `Default` | 1398 | see note below |
| `TimeRelease` | 683 | seconds since the patch released |
| `Extern #map<Engine::Rpm>` | 442 | normalised engine RPM 0..1 (section 2.2) |
| `Speed` | 348 | object speed, m/s (ramps span 0..40) |
| `Extern #map<Effect::Speed>` | 194 | effect-supplied speed channel |
| `Extern #map<Effect::Angle>` | 148 | effect-supplied angle channel |
| `Acceleration` | 16 | object acceleration, m/s^2 (ramps span 0..40) |
| `Extern #map<Engine::DiveAngle>` | 2 | normalised dive angle (Dive.ssc ramps 0.2..1) |

**Envelope semantics** (`confirmed` by consistent use in ~9000 instances):

- `Ramp p1 p2 p3 p4`: piecewise-linear map of the control value `x`:
  `out = p3` for `x <= p1`; `out = p3 + p4` for `x >= p2`; linear
  in between. `p4` may be negative (fade-out) and `p1 == p2` makes a step.
  All destinations are multiplicative factors (volume gain, pitch/playback
  ratio).
- `Ramp p1 p2 p3 p4 p5 p6` (6-param, 573 uses): first four as above. The
  extra pair is dominated by `(2, 2)` on Effect::Speed volume ramps and
  `(1, 2)` on Engine::Rpm pitch ramps, with scattered `(2, 0.16..6)` on
  `Default` pitch ramps. Meaning unresolved — plausibly curve shaping or
  slew limiting (`speculative`; the engine also has a global
  `Sound.setPitchChangeRate 15`, so pitch is slewed regardless). Safe to
  ignore: treating all ramps as linear reproduces the audible design.
- `Linear p1 p2`: `out = p1 + p2 * x`. With `controlSource Default` and
  `p2 = 0` this is the "Offset Pitch" idiom — a constant pitch multiplier
  (e.g. every distant MG layer runs at 0.9).
- Multiple effects on the same destination multiply (`strong inference`:
  the med engine layer has both a fade-in and a fade-out volume ramp whose
  product is the audible trapezoid; distance ramps stack on top).
- `Default` as a *source*: for one-shots it behaves as a constant
  (the Linear idiom above). A handful of car scripts
  (`Objects/Vehicles/Land/BlackMedal/Sounds/High/BlackMedalEngine.ssc`)
  use `Ramp` on `Default` spanning 0.55..1.2 as if it tracked the engine's
  primary channel. Unresolved (`speculative`), and irrelevant to the
  Corsair, whose engine effects all use `Extern #map<Engine::Rpm>`.

### 1.5 Existing parser in this repo

`parse_ssc` in `tools/bf1942-models/bf42/level.py:747` already tokenises
`#templateLevel`, `newPatch`, `load`, `loop`, `volume`, `minDistance` and
extracts the `Distance -> Volume` ramp — enough for map ambience, not for
engines. Known gaps for this feature (`confirmed` by reading the code):

- One sample per patch: a second `load` in the same patch **overwrites**
  `SoundPatch.file`, so all engine layers past the first are lost.
- No `#include` following (the Corsair's real script is four files deep).
- No Pitch effects, no `Extern`/`Time`/`TimeRelease`/`Speed` sources, no
  `trigger`/`stop`/`randomPlay`/`relativePosition`/`priority`/`stereo`/
  `randomStartPitch`/`dopplerOff`.

A vehicle-grade parser needs: include resolution (relative to the including
file), templateLevel filtering (pick one level), a `Sample` record per
`load` carrying all sample directives, and an `Effect` list per sample of
`(destination, source, envelope, params)`.

Wav path resolution already exists: `resolve_sound` in
`tools/bf1942-models/extract_map.py:175` strips `@ROOT/`, substitutes
`@RTD`, and searches the sound archive pool — it pulled every map-ambience
wav. One flag: its preference order is `["22khz", "44khz", "11khz"]`
(line 192); for vehicle close-ups pass or reorder to prefer `44khz`
(the archive dir is spelled `44kHz` in sound.rfa and `44khz` in
sound_001.rfa; the pool lookup handles the casing).

---

## 2. The RPM crossfade

### 2.1 First, a correction: Low/Medium/High files are quality tiers, not RPM bands

`CorsairEngine.ssc` is only a dispatcher (`confirmed`):

```
#templateLevel HIGH
	#include EngineHigh.ssc
#templateLevel MEDIUM
	#include EngineMedium.ssc
#templateLevel LOW
	#include EngineLow.ssc
```

`EngineLow.ssc` is the *low sound-detail* variant (3 voices),
`EngineMedium.ssc` adds start/stop one-shots and three enrichment loops
(9 voices), `EngineHigh.ssc` adds two cockpit layers on top (11 voices +
the Dive include). **The actual RPM layering lives inside each file**: all
three contain the same three-band `mstngnrun / mstngnrunmed / mstngnrunhi`
core.

### 2.2 What drives it: `Engine::Rpm`, normalised 0..1

The scripts modulate on `controlSource Extern #map<Engine::Rpm>`, the
channel declared in `Objects/Vehicles/Common/Sounds/EngineMap.ssc` and fed
by the owning `Engine` object (`confirmed`). From
`Objects/Vehicles/Air/Corsair/Physics.con`:

```
ObjectTemplate.setMinRotation -0.3/0/-3000
ObjectTemplate.setMaxRotation 0.3/0/5000
ObjectTemplate.setMaxSpeed 1000/0/500
ObjectTemplate.setAcceleration 500/0/1000
ObjectTemplate.setInputToRoll c_PIThrottle
```

Reading (`strong inference`, consistent with the Camera template's use of
the same triplet commands as yaw/pitch/roll): the throttle input drives the
**roll channel** of the Engine object toward `input * 5000` units
("engine rotation", the value that also spins the propeller LOD), slewing
at up to `maxSpeed.roll = 500` units/s (so idle to full power takes
~10 s — the audible spool), with reverse braking down to -3000.
`Rpm = rotation / maxRotation.roll`, i.e. **normalised 0..1** (negative
when windmilling in reverse). Evidence that Rpm is normalised rather than
raw: every vanilla plane — Corsair, Mustang, Yak9, SBD, Spitfire, Zero,
Stuka, AichiVal, bf109 — uses ramps over the identical 0..1.05 span while
sharing the exact same `-3000/5000` engine numbers (`confirmed` for the
identical numbers on Corsair/Zero; sampled across the rest). All effects
saturate at their ramp bounds, so an implementation can clamp Rpm to
[0, 1].

The physics-side numbers `setTorque 15`, `setDifferential 5`,
`setNoPropellerEffectAtSpeed 70` (thrust cutoff at 70 m/s airspeed) do not
feed the sound; sound reads only Rpm, DiveAngle, Speed, Acceleration,
Distance (`confirmed` — those are the only sources in any engine script).

### 2.3 The three-band core (identical in Low/Medium/High)

From `EngineLow.ssc` (canonical archive path
`Objects/Vehicles/Air/Corsair/Sounds/EngineLow.ssc`; also extracted at the
scratchpad `objects/Objects/Vehicles/Air/Corsair/Sounds/`):

| Layer | Sample | Volume vs Rpm | Pitch vs Rpm |
|---|---|---|---|
| idle | `mstngnrun.wav` (2.46 s loop) | 1 -> 0 over Rpm 0 -> 0.6 | 0.70 -> 1.00 over Rpm 0 -> 0.6 |
| mid | `mstngnrunmed.wav` (1.48 s loop) | 0 -> 1 over 0 -> 0.6, then 1 -> 0 over 0.6 -> 0.99 (two multiplying ramps) | 0.70 -> 1.00 over Rpm 0.4 -> 0.99 |
| high | `mstngnrunhi.wav` (2.14 s loop) | 0 -> 1 over Rpm 0.6 -> 1.0 | 0.70 -> 1.00 over Rpm 0.6 -> 1.05 |

So the crossfade points are **Rpm 0.6** (idle fully out, mid at peak) and
**Rpm ~1.0** (mid out, high at peak), and each layer sweeps its own sample
from pitch 0.70 up to 1.00 across its active band — at a handover the
outgoing layer sits at pitch 1.0 while the incoming one restarts the climb
near 0.8, which is what produces the characteristic gear-change-like rise
(`confirmed`). Every layer also carries: attack `Volume <- Time` ramp
0 -> 1 over t 0.4 -> 1.2 s (engine-start fade-in), release
`Volume <- TimeRelease` 1 -> 0 over 0 -> 0.2 s, distance ramp 1 -> 0 over
30 -> 180 m, `minDistance 20`, `randomStartPitch .05/.05`, `loop`,
no `dopplerOff`.

The same table holds for every vanilla aircraft with only the wav names and
two idle-band edges changing (SBD/Spitfire/Zero/Stuka fade idle over
0 -> 0.7; Stuka/Zero start the idle pitch ramp at 0.2) (`confirmed` by
survey of all nine `EngineLow.ssc`).

### 2.4 The enrichment layers (Medium adds, High keeps)

From `EngineMedium.ssc` / `EngineHigh.ssc` (`confirmed`):

| Sample | Role | Key params |
|---|---|---|
| `mstngnstrt.wav` 1.14 s one-shot | starter cough at engine-on | plays at patch trigger; audible to 80 m; High marks it `dopplerOff` |
| `willyenginestp.wav` 1.94 s one-shot | shut-down rattle | `trigger Release`; audible to 100 m |
| `veadaurun.wav` 3.81 s loop | mid-distance body | vol .5; in 0 -> 1 over Rpm 0.2 -> 1; pitch 0.65 -> 1.0 over Rpm 0.3 -> 1.2; distance 150 -> 400 m |
| `tom.wav` 1.42 s loop | idle piston thump | vol .35; out 1 -> 0 over Rpm 0 -> 0.3; pitch .95 -> 1.0 over Rpm 0 -> .8; distance 3 -> 8 m only |
| `prop.wav` 3.63 s loop | far prop drone | in 0 -> 1 over Rpm 0.3 -> 1; pitch 0.65 -> 1.0 over Rpm 0.3 -> 1.2; distance **300 -> 600 m** |
| `b17hirpm.wav` 0.80 s loop x2 (High only) | cockpit whine L/R | `relativePosition ±.9/.3/-4.2`; volume 0 -> 1 over **Speed** 0 -> 40 m/s; distance 3 -> 8 m |
| `airplanedive.wav` 1.18 s loop (via `../../Common/Sounds/Dive.ssc`) | dive scream | vol = ramp(Speed 20 -> 40) x ramp(DiveAngle 0.2 -> 0.7); pitch 0.95 -> 1.0 over DiveAngle 0.2 -> 1; distance 100 -> 400 m |

Layering by listener distance is deliberate: `tom`/cockpit layers die by
8 m, the core by 180 m, `veadaurun` covers 150-400 m, `prop` 300-600 m — a
distance-based timbre LOD, not just attenuation.

---

## 3. The audio files

All located in `sound.rfa` under `sound/11khz|22khz|44kHz/` (the `@RTD`
directories); every file exists at all three rates, PCM 16-bit, mono except
the two cockpit-gun samples (`confirmed`, headers read from the archive):

| File | 44 kHz format | Length | Loop? |
|---|---|---|---|
| `mstngnrun.wav` | PCM mono 16-bit | 2.46 s | yes |
| `mstngnrunmed.wav` | PCM mono 16-bit | 1.48 s | yes |
| `mstngnrunhi.wav` | PCM mono 16-bit | 2.14 s | yes |
| `mstngnstrt.wav` | PCM mono 16-bit | 1.14 s | one-shot |
| `willyenginestp.wav` | PCM mono 16-bit | 1.94 s | one-shot |
| `veadaurun.wav` (`VEADAURUN.wav`) | PCM mono 16-bit | 3.81 s | yes |
| `tom.wav` | PCM mono 16-bit | 1.42 s | yes |
| `prop.wav` | PCM mono 16-bit | 3.63 s | yes |
| `b17hirpm.wav` | PCM mono 16-bit | 0.80 s | yes |
| `airplanedive.wav` | PCM mono 16-bit | 1.18 s | yes |
| `arplcrnk.wav` | PCM mono 16-bit | 2.01 s | yes |
| `lg1/lg2/lg3/lg5.wav` | PCM mono 16-bit | 0.36/0.69/0.35/0.20 s | one-shots |
| `lghi.wav`, `lcvphirpm.wav` | PCM mono 16-bit | 0.62 / 1.39 s | yes |
| `CAMG1.wav`, `CAMG2.wav` | PCM **stereo** 16-bit | 0.09 s | yes |
| `CAMGdist.wav`, `BFMGdist.wav` | PCM mono 16-bit | 0.09 / 0.10 s | yes |
| `silence.wav` | PCM mono 16-bit | ~0 s | placeholder |

Loop seams: the engine loops are authored for looping — end/start sample
discontinuities are small (mstngnrun 0.049, mstngnrunmed 0.019, tom 0.002,
veadaurun 0.024 full-scale) though not all zero (mstngnrunhi 0.17,
arplcrnk 0.27 will click faintly if looped raw; inaudible under the
multi-layer mix, and fixable with a 5 ms crossfade at decode time)
(`confirmed`, PCM inspected).

Extraction: **the existing path already works.** `resolve_sound`
(`extract_map.py:175`) resolves `@ROOT/Sound/@RTD/...` against the
`sound` + `sound_001` archive pool exactly as it did for map ambience —
only the 22 kHz-first rate preference deserves a `44khz`-first override for
vehicle sound (section 1.5).

Oddities for the record: the Corsair reuses the *Mustang's* engine
recordings (`mstng*`) — only MG (`CAMG*`) samples are Corsair-specific;
`sound/11khz/Shellair.wav` is a corrupt RIFF in the shipped archive
(22/44 kHz copies are fine) (`confirmed`).

---

## 4. 3D positioning and falloff

What the game does (`confirmed` from data):

- Global DS3D settings, `Settings/Profiles/<name>/Sound.con`:
  `Sound.setDopplerFactor 1`, `Sound.setRolloffFactor 1`,
  `Sound.setDistanceFactor 1`, `Sound.setPitchChangeRate 15` (global pitch
  slew), `Sound.setHardwareVoiceLimit 32` (Settings/Default.con).
- Per sample: `minDistance` sets the API's full-volume radius, but the
  audible falloff design is the explicit `Volume <- Distance` ramp — a
  linear near/far fade (engine core 30 -> 180 m, prop 300 -> 600 m,
  cockpit 3 -> 8 m). Distant one-shot layers additionally gate ON with
  distance (`Start Volume` 0 -> 1 ramps) and delay with `trigger Volume` +
  step `Time` ramps (speed-of-sound, section 1.3).
- Doppler applies to engine loops (no `dopplerOff`); gunfire, starts/stops
  and explosion layers switch it off.
- `relativePosition` offsets voices in the object frame; `priority`
  arbitrates the 32-voice budget.

What our viewer already does (`viewer/map.html:1140-1156`,
`features/bf1942-3d-models/map-sounds.md`): one
`THREE.PositionalAudio` (PannerNode, HRTF) per unique wav,
`setRolloffFactor(0)` so the hand-computed `.ssc` near/far ramp owns
distance volume exclusively, `setRefDistance(near)`, no `setMaxDistance`
(inert outside the linear model), buffer cache keyed on the un-busted
path. **Vehicle sound should keep exactly these conventions** — panner for
direction only, gain node driven by the `.ssc` ramp for distance — so the
two systems never double-attenuate differently.

---

## 5. The other sounds a flying plane makes

All bindings read from `Objects/Vehicles/Air/Corsair/{Objects,Physics,Weapons}.con`
and the effect cons in Objects.rfa (`confirmed` unless marked):

- **Airframe wind / manoeuvre creak** — `../Common/Sounds/HullLeft.ssc` /
  `HullRight.ssc`, loaded by the *outer wing flap* `Wing` templates
  (`CorsairFlapLeftOuter/RightOuter`). One `arplcrnk.wav` loop each at
  `relativePosition ±2/0/0`, vol .28, HIGH detail only. Volume =
  ramp(**Acceleration** 10 -> 30) x ramp(**Speed** 20 -> 40 m/s); hard
  distance step at 7 m. It is the cockpit-only airframe strain/wind-rush
  that swells when you pull hard — not a control-surface servo.
- **Landing gear** — `../Common/Sounds/LandingGear.ssc` on
  `CorsairLandingGearLeft/Right` (HIGH and MEDIUM identical, silent on
  LOW). Patch 1 Gear Out: `lg3` start clunk + `lghi` (vol .2) and
  `lcvphirpm` (vol .9) motor loops with rising Time-pitch ramps +
  `lg2` end clunk on `trigger Release`. Patch 2 Gear In: `lg5` /
  same loops quieter / `lg1`. Audible to 10 m only. The *trigger
  condition* comes from the gear template: retracts when throttle input
  >= `setGearUpEngineInput 0.7` above `setGearUpHeight 23` m, extends
  when <= 0.4 below 25 m.
- **Wheels touching ground** — nothing scripted: the wheel `Spring`
  templates attach only visual effects (`e_wdustPlane`, `e_wdustPlaneL` —
  no `loadSoundScript`). Touchdown noise in game comes from generic
  material collision effects, not the plane (`confirmed` for the absence;
  attribution of the residual noise `strong inference`).
- **Water touch** — `e_WaterTouchPlane` (on the wheels) is spray only, no
  sound script. A water *crash* is `WaterWaterExplosion` ->
  `e_waterImpact` -> `Sounds/e_waterimpact.ssc`: layered
  `explwater1`/`VESTEXPLW` + distance-gated, speed-of-sound-delayed
  `explwaterdst1`/`explwaterfar1`/`explrev*` layers.
- **Guns** — `Sounds/CorsairMG.ssc` on the `CorsairGuns` FireArms
  (2 x MG, 12 rounds/s, tracer every 3rd). Patches Fire/Reload/Release/
  Shell Bounce/MG distance are `silence.wav` at volume 0; everything lives
  in the **Fire Loop** patch: `CAMG1.wav` + `CAMG2.wav` (stereo, 2D,
  vol .7, pitch x0.9, random start pitch, audible to 4 m — the cockpit
  brrrt) + `CAMGdist.wav` (mono, gated ON beyond 4 m, off by 250 m) +
  `BFMGdist.wav` (same, HIGH only). All `loop` + `stop FinishSample` +
  `dopplerOff`.
- **Bombs** — `CorsairBombDummy` fires `FighterBomb`; the *projectile*
  loads `../air/common/Sounds/Bomb.ssc`
  (`Objects/Vehicles/Common/Weapons.con`): patch 1 = falling whistle
  (`shellair` + `Shellwhine` + `haxxar` loops, fade in over ~0.5 s);
  patch 2 = release clack (`bmbreal1`/`bmbreal3`, `randomPlay 1`, only
  audible to 9 m); patch 3 = `bmbreal2` shackle follow-up delayed 0.3 s via
  `trigger Volume`.
- **Damage and fire** — `Objects.con` armor thresholds: at <= 65 hp smoke
  effects (`em_CorsairDamage`, `em_PlaneDamage` — no sound); at <= 20 hp
  `e_CorsairFire`, which loads `../Common/Sounds/fire.ssc`: three
  `vefr1/2/3.wav` crackle loops, `randomPlay 1`, pitch x0.8, audible to
  15 m.
- **Crash / explosion** — at 0 hp: `e_ExplGas` -> `Sounds/ExplGas.ssc`
  (`explgas.wav` main + `explnrmsemi1`/`explnrmdst1`/`explnrmfar1` layers
  gated on at 100/200/400 m and delayed 0.3/0.55/0.75 s + two `explrevdist`
  tails — the full distance-layered boom) plus `e_ScrapMetal_Corsair`
  debris (no own sound; debris impacts route to
  `e_Collision_Debrie_Metal` -> `debrie_metal.ssc`). Wreck burn:
  `e_FireMedPlane` loads its own `fire.ssc`.

---

## 6. Web Audio implementation spec (Corsair)

### 6.1 Buffers

Extract once at map/asset build time via `resolve_sound` (44 kHz
preference) into the shipped assets. Minimum set (7 files, ~1.1 MB as
16-bit wav; encode as before):

```
mstngnrun.wav  mstngnrunmed.wav  mstngnrunhi.wav      # RPM core
mstngnstrt.wav willyenginestp.wav                     # start/stop
airplanedive.wav                                      # dive scream
CAMG1.wav CAMGdist.wav                                # guns (optional tier)
```

Optional distance-timbre tier: `veadaurun.wav`, `prop.wav`; cockpit tier:
`tom.wav`, `b17hirpm.wav`, `arplcrnk.wav`; events: `lg3/lghi/lcvphirpm/lg2/
lg5/lg1.wav`, `explgas.wav`, `explwater1.wav`, `vefr1.wav`. Decode each
file **once** and cache by un-busted path, exactly like `getBuffer` in
`setupSounds` (`map.html:1089`).

### 6.2 Graph (per aircraft instance)

```
srcIdle(loop) --> gIdle ---\
srcMid (loop) --> gMid ----+--> gEngine --> gDistance --> panner(HRTF, rolloff 0) --> master
srcHigh(loop) --> gHigh ---/
srcDive(loop) --> gDive ------> gDistDive ---------------^ (same panner)
one-shots (start/stop) --> gOneShot ---------------------^
```

- One `PannerNode` per aircraft (all engine voices are co-located at the
  engine; skip `relativePosition` at flythrough scale), positioned at the
  plane's engine node each frame, `panningModel 'HRTF'`,
  `rolloffFactor 0`, `refDistance 20` — identical conventions to
  `map.html` so distance volume is owned by our own ramp.
- Start **all three core loops at the same `ctx.currentTime`** and never
  stop them while the engine runs; do the crossfade purely in the gain
  nodes. Give each loop a random start offset
  (`src.start(t0, Math.random() * buf.duration)`) and a per-instance
  detune of ±5 % (`randomStartPitch .05/.05` — DICE's own fix) so two
  Corsairs never phase-lock.

### 6.3 Control curves (drive from throttle each frame)

```js
// spool: rpm chases throttle at the game's slew rate (Physics.con:
// maxSpeed.roll 500 of maxRotation.roll 5000 => 0.1 rpm units/s)
rpm += clamp(throttle - rpm, -0.1 * dt, 0.1 * dt);   // rpm, throttle in [0,1]

const r = clamp01(rpm);
// volumes (linear, straight from EngineLow.ssc)
gIdle.gain = 1 - clamp01(r / 0.6);
gMid.gain  = r < 0.6 ? r / 0.6 : 1 - clamp01((r - 0.6) / 0.39);
gHigh.gain = clamp01((r - 0.6) / 0.4);
// pitches (playbackRate; each layer climbs 0.70 -> 1.00 over its band)
srcIdle.playbackRate = 0.70 + 0.30 * clamp01(r / 0.6);
srcMid.playbackRate  = 0.70 + 0.30 * clamp01((r - 0.4) / 0.59);
srcHigh.playbackRate = 0.70 + 0.30 * clamp01((r - 0.6) / 0.45);
// dive (needs airspeed in m/s and diveAngle normalised 0..1)
gDive.gain = clamp01((speed - 20) / 20) * clamp01((diveAngle - 0.2) / 0.5);
srcDive.playbackRate = 0.95 + 0.05 * clamp01((diveAngle - 0.2) / 0.8);
// distance ramp (core 30 -> 180 m, dive 100 -> 400 m), replaces panner rolloff
gDistance.gain = master * rampDown(dist, 30, 180);
gDistDive.gain = master * rampDown(dist, 100, 400);
```

Apply every gain/rate with `setTargetAtTime(v, t, 0.05)` (and ~0.1 s for
pitch, echoing `Sound.setPitchChangeRate`) — never `.value =`, which zipper-
clicks. Keep the curves linear: the game's own crossfade is linear, and
equal-power here would double the loudness bump at Rpm 0.6.

Lifecycle: on engine-on play `mstngnstrt` once through `gOneShot` and ramp
`gEngine` 0 -> 1 between t+0.4 and t+1.2 (the `Time` ramp); on engine-off
ramp `gEngine` -> 0 over 0.2 s (`TimeRelease`), then stop the sources and
play `willyenginestp` (`trigger Release`). Doppler (the game has it on for
these loops): multiply all three engine `playbackRate`s by
`clamp(340 / (340 + dRadialVelocity), 0.85, 1.2)` — cheap, and clamped so
manoeuvres never chipmunk the mix (`speculative` tuning; the factor-1
doppler itself is `confirmed`).

Guns (if wired to the existing `fireShot` path in `viewer/index.html`):
loop `CAMG1` (playbackRate 0.9, gain .7, non-positional — it is the
`stereo` cockpit layer) plus positional `CAMGdist` (playbackRate 0.9,
gated to distances > 4 m, ramp off 130 -> 250 m); start both on trigger
down; on release let the current loop pass finish (`stop FinishSample`):
`src.loop = false` and let it end, rather than `src.stop()`.

### 6.4 Avoiding the `319a794` failure modes

The hall-echo postmortem (`features/bf1942-3d-models/map-sounds.md`)
reduces to three rules, restated for vehicles:

1. **One decode per wav** — cache key is the un-busted asset path; a
   cache-busted key re-decodes and re-starts identical loops 50-200 ms
   apart, which reads as slapback.
2. **One voice per role, not per data row** — here: per *aircraft*, one
   voice per layer. If several aircraft idle in view, that is legitimately
   N sources — but detuned ±5 % and offset randomly (6.2) so they beat
   like real engines instead of flanging. A cap of ~4 audible aircraft
   (drop the quietest by `gDistance`) mirrors the game's `priority`
   system under its 32-voice limit.
3. **Generation-guard async setup** — bump a generation counter in
   `disposeSounds` and re-check it after every `await` so a superseded
   setup cannot leak a loop; the pattern is already in
   `setupSounds`/`disposeSounds` (`map.html:1054-1075`).

One new hazard specific to engines: pausing/restarting the three core
loops independently (e.g. muting layers with `src.stop()`) desyncs their
loop phase and produces audible combing when a layer returns. Keep all
three running and mute with gain only.

---

## 7. What was built

Shipped 2026-09-14. The one architectural departure from §6: **nothing in the
runtime hard-codes the Corsair's numbers.** The extractor ships the parsed
script — every layer with its own modulator list — and `engine-audio.js`
evaluates the same curves the engine evaluates. That was cheaper than baking
§6.3's formulas (the ramp evaluator is nine lines), it made the `Time` attack,
the `TimeRelease` fade and the distance falloff fall out for free instead of
being three more special cases, and it means a Zero, a Sherman or a destroyer
needs no new code. Every vanilla aircraft already works.

### 7.1 Parser (`bf42/level.py`)

`parse_ssc(text, *, level=None, include=None, source="")`. Two new records,
`SoundSample` (one per `load`, with every sample directive) and `SoundEffect`
(`destination`, `source`, `extern`, `envelope`, `params`); `SoundPatch` grows
`samples` and `random_play`. The old scalar view (`file`, `loop`, `volume`,
`min_distance`, the distance ramp) is now projected from `samples[0]` at patch
close, so the map-ambience path is untouched — verified against all 23
extracted maps, whose `ambient` and `areas` output is byte-identical, and
against the 93 level-root ambient/area scripts in vanilla, none of which is
multi-load.

`#include` is expanded **textually** into the line stream, which is what makes
`airplanedive.wav` a layer of the engine patch (`EngineHigh.ssc` includes
`Dive.ssc` *between* `newPatch` and the next `load`) and what lets
`EngineLow.ssc`, which declares no `#templateLevel` of its own, inherit LOW
from the dispatcher that included it. `resolve_ssc_path` resolves relatives
against the including file. Depth cap 12; the Corsair's real chain is 4.
`#beginMap`/`#endMap` and `beginSkip` are skipped, and the vanilla typos
(`endeffec`, `pram`, `volume.2`, `####` banners) are tolerated deliberately:
`endeffec` is matched on the short prefix so a mistyped block cannot swallow
the rest of a patch.

All 981 vanilla `.ssc` files parse. 12 new tests in `tests/test_sound.py`
(277 pass, up from 265).

`parse_sound_scripts(text)` is new and separate: `loadSoundScript` binds to a
*template*, not a vehicle, and one `Physics.con` binds four scripts to four
children, so the engine's script can only be found by matching the engine's own
name.

### 7.2 Extraction (`extract_map.py`)

`find_engine_script` walks the vehicle's template tree for its `Engine` child,
then reads the `.con` that declared it. `extract_vehicle_sounds` parses at
`#templateLevel HIGH` and writes `sounds.vehicles[]` into `scene.json`:
`{template, engine, script, level, layers[]}`, each layer carrying
`file/loop/volume/minDistance/priority/trigger/stop/stereo/doppler/
randomStartPitch/relativePosition/modulators[]`. `Extern #map<Engine::Rpm>` is
flattened to the source string `engine::rpm`, and `relativePosition` is
converted to glTF coordinates at extraction time so the viewer never learns
that Refractor is left-handed.

§1.5's note about the 22 kHz preference was right: `resolve_sound` now takes a
rate order, `VEHICLE_RATES = 44/22/11`, with ambience unchanged on 22/44/11.

Cost: 5.4 MB of wavs for Wake's eight engines, 109 MB across all 23 extracted
maps. Only the flown vehicle's layers are ever fetched (the Corsair's eleven
are ~1.8 MB), so this is a publish-volume cost, not a page-weight one — but
it is a real one, and `viewer/maps` is gitignored, so it only shows up when
the assets tree is synced.

### 7.3 Runtime (`viewer/engine-audio.js`)

```
per layer:  BufferSource(loop) -> GainNode ─┐
                                            ├─> PannerNode (per relativePosition)
                                            │     HRTF, rolloffFactor 0
                                            └──> busGain (master x headroom)
                                                   -> AudioListener.getInput()
```

- **One panner per distinct `relativePosition`**, not per layer. The Corsair's
  eleven voices collapse to three groups: nine at the engine node, and the two
  cockpit whines at ±0.9 m. Those two are the stereo width you hear in first
  person, and they are why §6.2's "skip `relativePosition`" was not taken —
  it costs two extra panners and it is the most audible thing in the cockpit.
- `rolloffFactor 0` so the script's own `Volume <- Distance` ramp owns distance
  volume alone, exactly as the area sounds do.
- **The patch clock is the simulation clock, not `ctx.currentTime`.** They
  diverge whenever the context is suspended, which is the state the page is in
  before any click, and a `Time` attack ramp read off a frozen clock holds
  every layer at zero forever.
- **Doppler** from the frame-to-frame change in distance (one subtraction, and
  it picks up a moving listener for free), clamped to 0.85..1.2. The first
  frame is primed rather than differenced against an initial zero — doing it
  the naive way reads as a 250 m/s recession and starts every layer at the
  clamped doppler floor, audible as a lurch on engine start. That bug was real
  and is fixed.
- **Bus headroom 0.28.** The `.ssc` mix is authored against a game mixer with
  its own headroom; summed straight into `destination`, a Corsair at full
  throttle heard from the cockpit is hi 1.0 + veadaurun 0.5 + prop 1.0 + two
  cockpit whines at 0.64 ≈ 3.8 and clips flat. Scaling the bus rather than the
  voices keeps every per-voice gain reporting the value its script asks for,
  which is what makes the crossfade checkable.
- `setTargetAtTime` everywhere (0.05 s gain, 0.1 s pitch, echoing
  `Sound.setPitchChangeRate 15`), skipped when the value has not moved.
- Anti-phasing: shared decode cache (`soundBuffer` in `map.html`, keyed on the
  un-busted path, now used by ambient, area *and* engine paths), one random
  start offset per loop, and a per-instance `randomStartPitch` jitter.

### 7.4 Wiring (`viewer/map.html`)

`setPilot(true)` calls `ensureAudioContext()` — ticking the checkbox *is* the
user gesture — then `setupEngineAudio()`. Loading is inert and `start()` is a
separate synchronous call made only after re-checking `engineGeneration`, so a
superseded load cannot leak a loop. `setPilot(false)` calls `release()` (the
`TimeRelease` fade falls out of the curves; the `trigger Release` rattle
starts) and schedules teardown 2.4 s later behind the same generation guard.
`disposeSounds()` disposes the engine too, so a map change takes it.
`updateAudio(dt)` feeds the control channels and applies the sound checkbox and
volume slider to the bus.

Two control channels are derived rather than read, because `flight.js`
publishes neither:

- `Acceleration` — differenced from `state.velocity` with one-pole smoothing
  (raw frame differences are mostly numerical noise). The Corsair's *right*
  cockpit whine pitches off this while the left pitches off `Speed`; that
  asymmetry is in the data, not a transcription error.
- `Engine::DiveAngle` — read as the sine of the flight path's descent angle
  (1 straight down, 0.2 ≈ 12° nose-down). **Inferred**, not read out of the
  data; the vanilla ramps span 0.2..1 and this is the only reading that makes
  those bounds mean anything.

`Engine::Rpm` is **`state.throttle`, not `inputs.get('c_PIThrottle')`** — the
flight model already spools at `throttleRate 0.1`, which is exactly
`maxSpeed.roll 500` over `maxRotation.roll 5000`. No change to `flight.js` was
needed.

### 7.5 Measured

Headless Chromium will not let anyone listen, so `__getAudioState().engine`
exposes a snapshot and the check asserts on the graph. Stepping the sim at
1/60 with W held, sampling every 0.5 s (scratch `engine-audio-test.mjs`):

| Rpm | idle gain | mid gain | hi gain | idle rate | mid rate | hi rate |
|---|---|---|---|---|---|---|
| 0.00 | 1.000 | 0.000 | 0.000 | 0.700 | 0.700 | 0.700 |
| 0.242 | 0.597 | 0.403 | 0.000 | 0.821 | 0.700 | 0.700 |
| 0.484 | 0.193 | 0.807 | 0.000 | 0.942 | 0.743 | 0.700 |
| 0.605 | 0.000 | 0.987 | 0.013 | 1.000 | 0.804 | 0.703 |
| 0.787 | 0.000 | 0.521 | 0.467 | 1.000 | 0.897 | 0.825 |
| 0.968 | 0.000 | 0.056 | 0.921 | 1.000 | 0.988 | 0.945 |
| 1.00 | 0.000 | 0.000 | 1.000 | 1.000 | 1.000 | 0.967 |

(rates with the `randomStartPitch` jitter divided back out). Every sample
matches §2.3's bands to within 0.02. The crossfade points land exactly where
the script says — idle out and mid at peak at Rpm 0.6, mid out and hi at peak
by 0.99 — and each layer sweeps 0.70 -> 1.00 across its own band. Note hi tops
out at **0.967, not 1.00**: its pitch ramp runs to Rpm **1.05**, which a
throttle clamped to [0, 1] never reaches. §6.3's formula has this right; §2.3's
prose ("each layer sweeps ... up to 1.00") slightly overstates it.

Throttling back reverses the crossfade symmetrically over the same ten seconds.
The dive scream was checked separately by nosing over at full power: gain
0 -> 0.24 -> 0.77 -> 1.00 as the flight path steepens, playback rate 0.939 ->
0.985.

Invariants: **looping voice count constant at 9** across the whole sweep, the
dive, a ground impact, a pilot toggle inside the release tail, and a map change
— the count the `319a794` bug moved. Three panner groups. Engine-node-to-ear
distance 4.18 m, and the cockpit voices land at 1.25 m (their −4.2 offset is
relative to the Engine node at z +4.149, which puts them in the cockpit — §1.3
called this and the measurement confirms it). A separate lifecycle check
instruments every `AudioBufferSourceNode` the page creates: live-source counts
return exactly to the map's own two after `release()`, and to the new map's
after a map change. No console errors.

### 7.6 Corrections to the research above

- **§2.3 is wrong that the Dive include is HIGH-only.** `EngineMedium.ssc`
  includes it too; MEDIUM parses to 9 voices *including* `airplanedive.wav`,
  HIGH to 11 including it. §2.4 has it right (it lists dive under "Medium
  adds"); only §2.3's parenthetical double-counts.
- **§2.4's "veadaurun covers 150-400 m, prop 300-600 m" overstates the
  gating.** Those are fade-*out* ramps: both layers are at full volume
  everywhere inside 150 m and 300 m respectively, so with `rolloffFactor 0`
  they are as loud in the cockpit as at 150 m. That is faithful to the data —
  DirectSound3D is also flat inside `minDistance` — but it is what makes the
  bus headroom necessary, and it is not "a distance-based timbre LOD" in the
  sense of layers switching on and off.
- **§6.3's `gIdle`/`gMid`/`gHigh` formulas are exactly right** and were used
  unchanged as the test's expected values.
- Everything else checked out, including the `#templateLevel` trap, the
  `Extern #map<...>` syntax, the voice counts per tier (3/9/11), the 44 kHz
  rate preference, and the `Engine::Rpm` = `rotation / maxRotation.roll`
  reading.
