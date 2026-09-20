# Map ambient sound: findings and fixes

Findings from the 2026-09-13 investigation into "hall echo" and "only Wake has
sound", verified against the vanilla level archives. Code: `bf42/level.py`
(`discover_level_sounds`), `extract_map.py`, `viewer/map.html`.

## Ground truth in the game data

All 21 stock maps except Truk define ambient wind via
`Sounds/Environment.con` -> `Environment.ssc` (wind / windall / windcalm), and
15 also place area sounds (coastlines, rivers, sirens). Wake is not special.
Quirks:

- **Kasserine_Pass** ships its config in `Sound/` (singular) with a custom
  `Sound\ambfx.wav` inside the level rfa. Discovery now falls back to
  `Sound/` for the environment con, ssc lookups, and the area-con scan.
- **Truk** genuinely has no sound entries — the one legitimately silent map.
- Battle_of_Britain's air-raid siren wav contains baked-in reverb; that is
  the game's own asset, not a pipeline artifact.

## The "only Wake" symptom

Pipeline was fine; outputs were stale. Every `viewer/maps/*/scene.json` except
wake / omaha_beach / battle_of_britain predated the sound feature and had no
`sounds` key, and nothing sound-related had been published to
mesh.bfstats.io. `setupSounds` silently no-ops on a missing `sounds` key, so a
stale map, a soundless map, and an unpublished wav are indistinguishable to
the user. Remedy is operational: re-extract after any sound-pipeline change,
and publish the whole maps tree.

## The "hall echo" symptom

No reverb existed anywhere; the audio path is source -> gain -> panner. The
echo was multiple staggered copies of the same loop:

1. One `PositionalAudio` per placed area, even when areas share a wave. Wake
   has 3 shoreline polylines all playing `Water_waves.wav` (2.54 s mono
   loop); two are audible at once from spawn and both track the camera along
   their polylines.
2. The buffer cache key included the dev cache-buster (`?t=Date.now()`), so
   each copy decoded separately and `play()` started them 50-200 ms apart —
   identical loops locked at that offset through HRTF panners is a slapback
   echo.

Fixes in `map.html`: one looping voice per unique wave file (closest point to
camera computed across all polylines in the group, ramp taken from the area
that produced it); cache keyed on the un-busted path; the always-true
staleness guard (`cfg === report.sounds`) replaced with a generation counter
so a superseded async setup cannot leak a loop past `disposeSounds`;
`setRolloffFactor(0)` so the `.ssc` near/far ramp owns distance volume alone
(the panner's inverse rolloff was double-attenuating; `setMaxDistance` was
inert — it only applies to the 'linear' distance model).

Tests: `tests/test_sound.py` covers the `Sound/` singular fallback. The
grouping logic is inline JS in map.html and is not unit-tested.

## Where samples live, and in what format

Superseded 2026-09-14. Samples no longer go to a per-level `sounds/` directory
as wav. They go to `<maps-root>/_shared/sounds` as MP3, and `scene.json`
references them relatively (`../_shared/sounds/x.mp3`), which the viewer
resolves as a URL with no change to `soundBuffer` — the extension arrives from
`scene.json` as opaque string data.

Extracting all 239 Eve of Destruction levels is what forced it: 8,828 wav files
that were 260 distinct payloads, 3.24 GB of the same ambient beds and engine
layers re-copied per level. Sharing also means one browser cache entry and one
decode per sample across every level that uses it, which the one-decode-per-wav
rule above already wanted.

MP3 -V2 rather than Opus or Vorbis, and the reason is looping rather than size.
Measured through Chromium's `decodeAudioData` on real pipeline output, MP3
returns exactly the source sample count — `PattonStart` 50,335 against 50,335,
`Environment20` 1,310,151 against 1,310,151, zero delta, zero leading silent
samples. Vorbis retains up to 12.3 ms of encoder padding *inside* the loop,
which on a 2.1 s engine layer is an audible tick every 2.1 seconds; AAC does
not decode in the Playwright Chromium at all. The gapless property is entirely
a property of LAME's Xing header, so **nothing downstream may rewrite or strip
ID3/Xing tags**.

The directory is per-mod, not global, even though 67 of vanilla's payloads are
byte-identical to EoD's. `viewer/maps/mods/<id>/` has to stay a self-contained
subtree or publishing a mod stops being one recursive upload of one directory.

The operational remedy above still applies and now has a second edge: a
`scene.json` carrying the old per-level `sounds/x.wav` paths and a tree carrying
only `_shared/sounds/x.mp3` cannot be deployed independently. Re-extract and
republish together.

Code: `extract_sounds` / `transcode_to_mp3` in `extract_map.py`, driven by
`--shared-sounds`, `--audio-format` and `--final-out`. Tests:
`tests/test_map_sounds.py`. Measurements:
`features/mesh-mod-assets/audio-compression.md`.

## 2026-09-17: no vehicle gun has ever made a sound

Reported from play: the Sherman's shell and machine gun are both silent. The
patches were not missing and nothing failed to load — `scene.json` carries all
three of the Sherman's guns (`ShermanGunBarrel` with twenty layers,
`Coaxial_browning`, `Browning`), every wav decoded, every panner was built and
`started: true`. What the live snapshot showed was `voices: 0` and every layer
`playing: false`, and the reason is one line of shape:

**Every layer of every vehicle weapon on the map is `loop: false`.** The gun
path was written on the assumption that they are loops:

> The vehicle guns hold a muted loop and gate it with gain because their fire
> is authored as a loop patch on a vehicle that outlives any burst

That is true of an engine and of nothing else here. `EngineAudio.start()`
plays every non-`release` voice once, immediately, which for a one-shot means
it fired at the moment the patch was built — inaudibly, because the gun's
master is held at 0 until the trigger — and `onended` then cleared each voice.
After that there was nothing running for a gain gate to un-mute, ever, and
`setMaster(firing ? master : 0)` was toggling silence against silence.

Fixed by giving a gun what it actually is, a one-shot event patch:

- `EngineAudio` takes `oneShotsOnTrigger`. With it set, `start()` holds every
  non-looping layer back, and a new `trigger()` plays them. An engine patch
  leaves it false, so a starter cough still fires when the engine does.
- `trigger()` restarts the patch's own clock, because a gun `.ssc` sequences
  itself off `Time`: a Sherman's twenty layers are the muzzle blast, the
  casing, the crew reloading and the breech closing, each with its own ramp
  measured from the shot. Layers that declare `trigger Volume` are left to
  `update`'s own gate, which that clock reset re-arms — which is why the
  reload comes in a beat after the bang rather than on top of it.
- A round in flight is not cut short by the next one: the previous source is
  orphaned to play out while a new one takes the voice's slot, so a burst
  stacks. Same reasoning as the hand weapon's own shared bus.
- `map.html` splices `trigger()` onto `guns.onShot` beside the ammo/heat
  bookkeeping, so the round is what plays the sound — the shot that leaves the
  muzzle and the sound are the same event, as they already are for a soldier's
  rifle. The master gate now applies only to a patch that `hasLoops`; holding a
  one-shot patch at 0 between rounds would mute the shot it had just started.

Measured after, counting real `AudioBufferSourceNode.start()` calls: one shell
starts **13** sources (the cannon's immediate layers; the rest arrive on their
own `Time` ramps), and an eight-round burst on the coaxial starts **8**.
Before, both were 0.

`tests/test_engine_audio_default.mjs` covers the new behaviour — and now runs:
it was the only `test_*` in that directory with no Python wrapper, so
`unittest discover` and `verify.sh` had been walking straight past it.
`tests/test_engine_audio.py` is that wrapper.

## 2026-09-20: an effect that plays also sounds

Before this, a round that hit sand, stone, water or armour played its authored
`EffectBundle` and made no noise. The bundles were extracted; their
`loadSoundScript` was not. Impacts, ricochets, explosions, a grenade's blast,
a vehicle's death and a wreck's fire were all silent, and so was a round
hitting a man.

Code: `bf42/effects.py` (`bundle_sound_script`, `sound_layers`),
`extract_effects.py` (`build_sound_manifest`), `viewer/effect-audio.js`
(the pool and the budget), the `onSound` hook in `viewer/effects.js`,
`randomPlay` and live-source accounting in `viewer/engine-audio.js`, one hook
in `map.html`. Tests: `tests/test_effects.py::BundleSoundTests`,
`tests/test_effect_audio.mjs` (+ its Python wrapper).

### The survey

**The script is on the EffectBundle and effectively never on the emitter.**
Across all 18 installed mods: **2,419** `loadSoundScript` bindings on
`EffectBundle` templates against **2** on `Emitter` (both FH/FHSW one-offs,
and both reachable anyway through the synthetic single-emitter bundle
`bundle_tree` already wraps a bare emitter in). So a bundle plays one script,
and there is no per-emitter mixing to model.

| mod | EffectBundle | Emitter | distinct `.ssc` |
|---|---|---|---|
| `FHSW` | 480 | 1 | 171 |
| `bf1918` | 193 | 0 | 141 |
| `DC_Final` | 151 | 0 | 107 |
| `FH` | 140 | 1 | 95 |
| `DesertCombat` | 137 | 0 | 96 |
| `EoD` | 135 | 0 | 88 |
| `bfheroes` | 132 | 0 | 79 |
| `bg42` | 127 | 0 | 94 |
| `WarFront` | 109 | 0 | 79 |
| `GCMOD` | 107 | 0 | 80 |
| `FinnWars` | 99 | 0 | 72 |
| `Pirates` | 93 | 0 | 68 |
| `XPack2` | 91 | 0 | 67 |
| `interstate` | 90 | 0 | 65 |
| `XPack1` | 86 | 0 | 62 |
| `bf1942`, `FHSWEurope`, `STFHSWE` | 83 | 0 | 61 |

435 distinct effect `.ssc` paths across the whole set. Reproduce with
`survey_effect_sounds.py`'s shape: build each mod's library and count
`sound_script` by `kind`.

**But the script is often on a bundle the material table never names.** Of
vanilla's 70 sounding impact bundles, **22 carry no script of their own** and
inherit it from a nested child. Reading only the named template finds 48 of
70. `bundle_sound_scripts` walks the `addTemplate` tree depth-first and
resolves each path against the **owner's** `.con`, not the named bundle's —
`RichoStoneDecal` lives in its own directory and `e_richoStone`, which owns
`richostone.ssc`, in another.

**And a tree can carry two** (corrected 2026-09-20; the first version of this
said nothing in vanilla did). **10** of the 159 named bundles have two
distinct scripts under them, and in every case neither is on the parent:

| bundle | first script | second |
|---|---|---|
| `MajorImpact_Sand` | `e_Explani02` / `ExplAni02.ssc` | `e_ExplDrySand` / `ExplDrySand.ssc` |
| `MajorImpact_Metal`, `MajorImpact_Stone` | `e_ExplBoatArmor` | `e_RichoCascadesMetal` / `…Stone` |
| `BazookaCascades{Metal,Stone,Wood}` | `e_ExplBazooka` | `e_RichoCascades{Metal,Stone,Wood}` |
| `Exp2Cascades{Metal,Stone,Wood}` | `e_ExplSmall2` | `e_RichoCascades{Metal,Stone,Wood}` |
| `WaterExplosionTorpedo` | `e_waterimpact` | `e_ExplBoatArmor` |

Both children are ordinary `addTemplate` instances, so the engine stands both
up and both sound: a blast *and* its rain of debris. Taking only the first
silenced the second half of every cascade and every major impact. The manifest
now gives a bundle a list of scripts (`scripts`, with `script` kept as the
first of them so an older published tree still plays), and vanilla goes from
43 scripts / 661 layers / 190 samples to **46 / 677 / 192** (2,283,777 B).
Reproduce the count with `bundle_sound_scripts` over `effect_names`, taking
the entries of length > 1.

Vanilla, by where the name comes from:

| group | bundles | with sound | on a nested child | distinct `.ssc` | distinct wav |
|---|---|---|---|---|---|
| impact (`damage.json` `effects`) | 73 | 70 | 22 | 38 | 177 |
| projectile trails and end effects | 9 | 4 | 1 | 4 | 25 |
| `addArmorEffect` tiers (smoke, fire, death) | 80 | 27 | 2 | 7 | 17 |
| **union** | **147** | **83** | **25** | **43** | **190** |

The 73 impact bundles by family: 26 ricochet, 21 explosion, 13 collision,
6 cascade, 3 major impact, 3 water, 1 other. 64 of the 147 are silent, and
almost all legitimately — 61 have no `loadSoundScript` anywhere in their tree
(they are the damage-smoke and building-dust emitters, which are pictures
only). The other three are shipped data bugs, recorded in
[`impact-effects.md`](impact-effects.md).

**Nine of the thirteen bundles the bake calls "missing" are pure sound.**
`e_collision_Soldier` — a round hitting a man, two `randomPlay` patches of
twelve alternates — is one of them, and it is the most-heard impact in the
game. So the sound hook fires *before* the geometry lookup, or the bundles
that are nothing but sound would be exactly the ones that stayed silent.

### The byte cost, and the command

```
python3 extract_effects.py --mod bf1942 --out viewer/maps/_shared
```

Run from `tools/bf1942-models`. It writes `_shared/effects.glb` and
`_shared/effects.report.json` exactly as before, and now also
`_shared/effects.sounds.json` plus the samples into `_shared/sounds` — the
same directory `extract_map.py` fills, through the same `transcode_to_mp3`
(LAME -V2) and the same "already there, leave it alone" dedup. `--no-sound`
gets the old behaviour; `--shared-sounds` and `--audio-format` exist for the
same reasons `extract_map.py` has them.

Measured on vanilla:

```
131 bundles, 474 emitters, 1647 KB, 13 missing, 0 missing textures
83 bundles with sound, 43 scripts, 661 layers, 190 samples
  (190 new, 2233541 B added), 64 silent
```

**190 files, 2,233,541 B = 2.13 MiB**, and **every one of them is new**: zero
of the 190 overlap the 155 samples already in `viewer/maps/_shared/sounds`,
because the effect corpus and the vehicle/ambient corpus are disjoint sets.
The shared tree goes 155 to 345 files. Against a 14 GB `viewer/maps` that is
0.015% for the sound of everything landing.

### How it plays

**An explosion is a one-shot patch, so it is `EngineAudio` in one-shot mode,
not a second player beside it.** A gun `.ssc` and an explosion `.ssc` are the
same document — layers sequenced off `Time`, distant ones held back by
`trigger Volume` against a step ramp so they arrive a speed-of-sound delay
late, `Volume <- Distance` ramps owning the volume with the panner's own
rolloff at 0, `stereo` layers unpanned, `randomStartPitch` breaking the phase
lock. The `oneShotsOnTrigger` mode added for the Sherman's cannon (the
2026-09-17 section above) is exactly those semantics, and the per-round latch
it introduced is what makes a distant layer fire once rather than loop.

**A patch is pooled per script, not per impact.** 70 impact bundles share 38
`.ssc`, so the pool keys on the script: up to three `EngineAudio` instances
per script, repositioned and re-triggered. Building a graph per hit would
allocate a panner and eight gains for a 200 ms sound, ten times a second
under a Thompson.

**`randomPlay` means pick one.** 244 vanilla scripts say it, 114 of the 136
EffectBundle patches among them. It is now honoured in `EngineAudio`: layers
carry their patch index, a `randomPlay` patch contributes exactly one voice
per trigger, and the pick is re-rolled every round along with the
`randomStartPitch` jitter. Played as layers instead of alternates, the
8-alternate stone ricochet is eight simultaneous cracks.

That the word means *pick one* is a reading of the data, not something read
out of the engine: the corpus has `randomPlay` only as index 18 of
`SoundScript__registerCommands`' 23-keyword table, with no note on what the
mixer does with it. Marked as such rather than as engine behaviour.

**G12 is closed for effect bundles only.** The runtime half is done, but the
extractor half is not: `extract_map._sound_layers` — the path that ships
every vehicle engine, vehicle gun and ambient bed — still emits no `patch`
and no `randomPlay`, so no shipped vehicle layer carries either key and every
one of them groups under the same `patch: -1` and plays exactly as before.
Closing G12 for FireArms (11 of 171 patches) and HandFireArms (20 of 113)
means changing `_sound_layers` and re-extracting every level.

### The voice budget is the game's own number

`.ssc` has **no instance-limit word at all**. A census of every directive in
vanilla's 985 scripts:

| | | | |
|---|---|---|---|
| `param` 39,140 | `beginEffect` 9,892 | `load` 4,768 | **`priority` 4,180** |
| `minDistance` 4,126 | `randomStartPitch` 2,714 | `dopplerOff` 2,525 | `volume` 2,416 |
| `newPatch` 1,596 | `loop` 1,354 | `trigger` 1,346 | `relativePosition` 954 |
| `stop` 417 | `randomPlay` 244 | `stereo` 186 | `addGroup` 16 |

`priority` (range -12..11) is the only word that arbitrates, and nothing
matching `max` / `instance` / `limit` / `voice` / `channel` occurs anywhere.

The cap lives in the settings. `Mods/bf1942/Settings/Default.con`:

```
rem Do _not_ change these unless you know exactly what you're doing.
rem Ie. Do not change these. Vec order is lo/med/hi and 16/24/32
Sound.soundStreamUpdateFrequency 20
Sound.soundBufferCacheSize 200
Sound.reserve2dMonoChans 4/4/4
Sound.reserve2dStereoChans 2/2/2
Sound.relaxHwReservations 0/0/0
Sound.setHardwareVoiceLimit 32
```

The file's own comment gives the three quality tiers: 16 / 24 / 32. And 32 is
the constructor's own default before any `.con` is read —
`dice::bf::SoundSetup::SoundSetup` (lnxded `0x080d51c0`) does
`mov DWORD PTR [ebx+0x50],0x20` at `0x080d520a`, and
`setHardwareVoiceLimit` (`0x080d5470`) stores to that same `+0x50` and
refuses a negative (`test edx,edx; js 0x080d5480`). Reproduce with

```
objdump -d -M intel --start-address=0x080d5120 --stop-address=0x080d5260 \
  /home/dylan/Downloads/bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static
```

(The path here is the patched binary the corpus is pinned to. An earlier
draft cited `~/Downloads/bf1942_lnxded (1).static`; the two differ in 90
bytes, none of them in this function, so the addresses hold in both. Both
`SoundSetup` constructors — `C2` at `0x080d5120`, `C1` at `0x080d51c0` —
store the same `0x20`, which is why the range above starts at the earlier
one.)

(This user's own profile also carries `game.setChannels 48`, not the 64 the
2026-09-14 audit recorded — `Settings/Profiles/skandia/Sound.con`.)

**What the 26 is, and is not.** 32 is proven. The subtraction is not: nothing
in lnxded computes a budget from the reservations, because a dedicated server
has no mixer. `getHardwareVoiceLimit` `0x080d5460`, `setHardwareVoiceLimit`
`0x080d5470`, `getReserve2dMonoChans` `0x080d53c0` and
`getReserve2dStereoChans` `0x080d5400` have **zero call sites in the whole
binary** — they are console-variable accessors and nothing else
(`objdump -d -M intel <binary> | grep -c 'call.*80d5460'` returns 0 for each).
Two further things are open with it: whether a *stereo* reservation costs one
hardware voice or two (32 − 4 − 2 = 26 against 32 − 4 − 4 = 24), and how
`Sound.setHardwareVoiceLimit` relates to the separate, larger
`game.setChannels` — `Settings/Default/SoundLow.con` and `SoundMedium.con`
say 16, `SoundHigh.con` 32, `Profiles/Default/Sound.con` and
`Profiles/Custom/Sound.con` 64. On the DirectSound reading those are software
mixer channels and the 32 is only the hardware-accelerated subset, in which
case the real concurrency ceiling is 64, not 26.

So: **26 is the viewer's choice, derived from two proven settings by an
unproven subtraction.** It is what `effects.sounds.json` carries (as
`voiceLimit: 32` and `reserved2d: 6`, so the arithmetic stays visible and
changeable) and what `effect-audio.js` spends. Arbitration is the engine's
word: `priority` decides, and between equals the furthest from the listener
loses. That a full mixer *drops* rather than steals is also a viewer choice —
`.ssc` has the word `priority` and no word for what happens when the mixer is
full, and the client-side mixer that does the arbitrating has not been read.

Two refinements the page forced, both now unit-tested:

- **The budget is spent against *committed* voices, not sounding ones.** A
  speed-of-sound-delayed layer is promised the moment its patch plays.
  Counting only what was audible let a burst overshoot — measured 27 live
  against a cap of 26.
- **A latch that will never fire must be spent anyway.** An explosion played
  at 4 m arms its 100/200/400 m layers and none of them ever rises, because
  their *distance* gates are shut from there. Left armed they were three
  voices of 26 permanently gone (a first 200-round burst measured 186 drops
  against 14 plays), and they were also an old bang waiting to go off if the
  listener later walked into the band. `disarmPending` spends them when the
  round's own window closes.

### Measured on the page

wake, this worktree served on 5354, Playwright with the **default autoplay
policy** and a real `page.mouse.click` before anything sounds, counting
`AudioBufferSourceNode.prototype.start` calls patched in `addInitScript`.
Every source reported `ctx=running`, which is the assertion the missing
`--autoplay-policy=no-user-gesture-required` flag buys: with that flag a
suspended context would have gone unnoticed.

Impact 4.00 m from the listener, 40 frames stepped inside one `page.evaluate`
so the tab's own rAF loop cannot advance the sim between round trips:

| | bundle | sources | sample seconds |
|---|---|---|---|
| rifle round into sand | `e_richoGround` | 1 | 0.387 |
| rifle round into stone | `RichoStoneDecal` | 1 | 0.052 |
| **rifle round into a man** | `e_collision_Soldier` | 2 | 0.594, 0.413 |
| rifle round into metal | `RichoMetalDecal` | 1 | 0.251 |
| rifle round into water | `e_RichoWater` | 1 | 0.327 |
| shell into armour | `e_ExplArmor` | 1 | 2.249 |
| grenade fuse blast | `e_ExplGranade` | 5 | 1.616, 1.616, 2.18, 1.338, 1.338 |
| grenade bounce on concrete | `e_Collision_Granade_Concrete` | 4 | 0.132, 2.203, 1.407, 1.338 |
| vehicle death | `e_ExplGas` | 2 | 2.229, 1.799 |
| wreck fire | `e_PanzFire` | 1 loop | 3.788 |

The two sources on `e_collision_Soldier` are its two `randomPlay` patches
picking one alternate each — the script is 2 patches of 7 and 5. Twelve
consecutive stone ricochets started 12 sources across **7 distinct sample
lengths** of its 8 alternates, so the pick genuinely moves. The same ricochet
played 400 m away starts nothing and is counted `inaudible`, because its own
`Distance Ramp 6 25 1 -1` is spent at 25 m.

**200 rounds into a wall**, two ways:

| | sources started | peak concurrent | dropped | stolen |
|---|---|---|---|---|
| paced 6 ms apart, so the browser retires finished sources | **200** | **9** | 0 | 0 |
| in a tight loop that never yields, so `onended` never fires and **nothing is ever reclaimed** | 26 | **26** (= the budget) | 174 | 1 |

The second row is the adversarial bound and the one that matters: with every
source pinned live, the cap holds at exactly 26 and never at 27. The first is
what a player gets — every round audible, nine voices at the peak.

### What else is an event sound the viewer still never plays

Measured the same way, vanilla, ranked by how often a player would hear it.
Rows 1, 5 and 10 are what this round closed.

| # | event | data | state |
|---|---|---|---|
| 1 | **impact / ricochet per material** | 70 bundles, 38 `.ssc`, 177 wav | **done** |
| 2 | **footsteps per surface** | `SoldierRun` + `SoldierWalk`, 10 surface patches each, 39 wav each, every one `randomPlay`; `MaterialToSound.con` maps 104 materials to 8 surface names | missing — needs a gait, not just audio |
| 3 | **bullet whizz-by** | `Objects/Common/Sounds/Projectile_High.ssc`, 7 `bulletair*` alternates, `randomPlay`, `trigger Volume` on a 0.075 s step; **24** of the 45 `Projectile` bindings name it | missing; `gunfire.js` already has every round's position each frame, so it is a closest-approach test |
| 4 | **reload, bolt, shell bounce, distant report** | 27 hand weapons × 6 patches = **104 patches / 144 wav**; `extract_weapon_sounds.py` ships one sample per weapon | missing |
| 5 | **explosions, near/far layered** | the 21 explosion bundles above | **done** |
| 6 | **jump and landing** | `SoldierJump` 3 patches / 8 wav, `SoldierJumpLand` 11 patches / 18 wav | missing |
| 7 | **pain and death** | `SoldierHitDamage` 6, `SoldierKilled` 8, `SoldierVoice` 28, `SoldierFFHitDamage` 9, `SoldierCharge` 3 — **all `@Language`**, which `resolve_sound` does not substitute (G10), so all five resolve to nothing today | missing, blocked on one substitution |
| 8 | **water entry and swimming** | `SoldierToSwim` 7, `SoldierSwim` 16, `SoldierSwimStand` 3 | missing |
| 9 | **distant machine-gun rattle** | `mgdist_High.ssc`, **20** alternates, `randomPlay` | missing |
| 10 | **a wreck's fire** | `e_PanzFire` and the `addArmorEffect` tiers | **plays**, but see below |
| 11 | **crouch, prone, ladder** | `SoldierCrouchMove` 10, `SoldierCrawlMove` 6, `SoldierClimbLadder` 13 wav, plus four transition scripts | missing |
| 12 | **ammo refill** | `Objects/Common/Sounds/SupplyDepot.ssc`, 1 wav | missing |

Soldier audio is 24 scripts / 98 patches / 108 non-voice wav plus the
`@Language` lines, and it is correctly deprioritised: most of it needs a gait
and a damage model the map viewer does not have.

### Known limits of what now plays

- **The first round into a new surface is silent.** A hit cannot wait for a
  fetch and a decode, so `play` primes the pool in the background and returns
  0. Every round after it sounds. `__primeEffectSound` exists for a caller
  that knows what is coming.
- **`stop FinishSample`** is extracted and still ignored (G14), and
  **`addGroup Volume Menu`** is still unhandled — neither occurs on an effect
  script.

## 2026-09-20 (S4): a wreck's fire ends, a suspended context stops piling up, and attach finally sounds

Three gaps the review above left open, closed:

**1. A wreck's fire used to have no end.** `showDamageTier`'s
`effects.play(name, { attach: { object: anchor } })` returns a handle whose
`stop()` now also silences the sound that play started —
`EffectPlayer.play()` mints a `Symbol` token per call, threads it to
`EffectAudio` as `{ follow, token }`, and `EffectAudio.stop(token)` finds and
silences only the slot that token's own play claimed, never another bundle's
turn on the same pooled script (`e_PanzFire`, `e_TankSmoke` and the rest of
the `addArmorEffect` tiers pool the same handful of scripts). Every place
`map.html` already called `handle.stop()` — `showDamageTier` on a tier
change, `stepWrecks` when a wreck fades out, `respawnVehicle`,
`clearDamageVisuals` on a level's own teardown, and `window.__stopEffects()`
— now actually cuts the voice, not just the picture. Belt and braces:
`disposeSounds()` (both of `show()`'s own teardown points) calls
`effectAudio.silence()` unconditionally, so a level change hits zero
committed voices regardless of what handle chain did or did not run for the
level being left.

Measured on the page (Wake, a `Defgun`'s `e_ExplGas`/`e_scrapmetal` death
tier, real `__damageVehicle` calls): `__stopEffects()` on a primed
`e_PanzFire` loop drops `pool.sources`/`pool.committed` from 1/1 to 0/0, and
one real `AudioBufferSourceNode.stop()` call is observed. Switching levels
(the `#maps` select, a real `show()` run) leaves `__effectAudio()` at
`sources: 0, committed: 0`, matching the bound. Regression tests:
`test_effect_audio.mjs`'s "stopping one loop leaves another of the same kind
alone" and "silence() must not leave a stale token" cases;
`test_engine_audio_default.mjs` gained a `silence()`-clears-`pendingLoops`
case for the same reason at the `EngineAudio` layer.

**2. Sounds queued while the `AudioContext` was suspended used to all fire at
once on resume.** Fixed in `EngineAudio.#play` (`engine-audio.js`), shared by
every caller (effect sounds, vehicle guns, vehicle engines): a request that
arrives while `ctx.state !== 'running'` is dropped if it is a one-shot
(counted in `suspended`, aggregated onto `EffectAudio.snapshot().suspended`
too) and remembered in `pendingLoops` if it is a loop. `EngineAudio.update()`
calls the new private `#wake()` first, which starts every pending loop for
real the first frame it sees the context running — no `statechange`
listener, since `update()` already runs every simulation tick. `silence()`
clears `pendingLoops`, so a patch cut while still waiting to wake (a level
change, a voice steal) does not spring to life later.

Verified under node with a stub context modelling `state`/`resume()`: a
suspended gun patch drops both layers of a two-layer round (`suspended: 2`,
zero sources) and plays normally once `state` flips to `'running'`; a
suspended engine loop starts zero sources at `start()`,
`snapshot().pendingLoops === 1`, and starts exactly one real source on the
first `update()` after the context wakes — frame-rate independent (the same
holds at 15/30/120 fps, re-checked in a throwaway sweep alongside the
delayed-`trigger Volume`-layer case the 2026-09-17 section already covers).
**Not reproduced live**: this Playwright/Chromium build
(`chromium_headless_shell` 1194 under Playwright 1.56.1) reports the
`AudioContext` as already `'running'` before any `page.mouse.click`, with or
without `--autoplay-policy=user-gesture-required` — an environment
characteristic, not something this fix controls, so the suspended path could
only be exercised at the node level.

**3. A bundle attached to a moving object used to be silent.**
`EffectPlayer.play()` had no world point for `attach` at all — `onSound` was
only ever called when a literal `position` was passed, and `showDamageTier`
never passes one. Fixed: `play()` now reads the attached object's current
world position for the initial sound call, and hands `EffectAudio` a
`follow` callback in the same `[x, y, z]` shape; `EffectAudio.update()`
re-reads it once a frame (bounded by the slot count already being walked
there, not by anything proportional to particles) and keeps the claimed
slot's `position`/`distance` current, so a tier's fire tracks the hull it
burns on instead of freezing at the point it started.

Measured on the page: before this fix, `EffectPlayer.play()`'s own guard
(`if (this.onSound && position)`) meant an attach-only call never invoked
`onSound` at all, so none of `EffectAudio`'s `plays`/`inaudible`/`dropped`
counters could ever move for a tier effect, regardless of distance. After
the fix, damaging a real vehicle's registered `Armor` down through its tiers
via `__damageVehicle` moves `dropped` (a cold, unprimed script) or
`plays`/`inaudible` (once primed) every time — proving the call reaches
`EffectAudio.play()` — and once the tier's scripts are primed ahead of time
(`__primeEffectSound`), the death tier's `e_ExplGas`/`e_scrapmetal` bundles
start a real source exactly as a position-based impact would (`plays: 1,
sources: 1, committed: 6` — the other five are `e_ExplGas`'s own delayed
`trigger Volume` layers, armed and counted the same way a position-based
explosion's are). Regression test: `test_effect_audio.mjs`'s "a moving
attachment's sound follows it" case plays a bundle with a `follow` callback
that changes value between two `update()` calls and asserts the pooled
slot's own `position`/`distance` moved with it.

**Also re-checked, unchanged:** the dev panel's sound checkbox still gates
master gain only (a source still starts, silently: `starts=1` with the
checkbox off, matching the 2026-09-17 review's own finding); `?sound=off`
and `?shots&noaudio` still start nothing. The review's own 200-rounds
measurement reproduces to the number: pinned (never yields) **26 started,
26 peak committed, never 27, 174 dropped**; paced 6 ms apart, **200
started, peak 8 concurrent**.

Code: `viewer/engine-audio.js` (`#wake`, `pendingLoops`, `suspended`),
`viewer/effect-audio.js` (`Slot.follow`/`Slot.token`, `EffectAudio.play`'s
new options, `EffectAudio.stop`, the `suspended` getter), `viewer/effects.js`
(`EffectPlayer.play`'s attach-position/follow/token wiring, `onSoundStop`),
`map.html` (`disposeSounds` calls `effectAudio.silence()`, `onSoundStop`
wired to `effectAudio.stop`). Tests: `tests/test_engine_audio_default.mjs`,
`tests/test_effect_audio.mjs`.
