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
