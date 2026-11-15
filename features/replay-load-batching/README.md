# Replay load batching

The owner, 2026-11-15: "when loading a replay it's really quick to begin with,
then it has this long tail where it seems to download small files. Could we
figure out what those will need to be upfront and batch them all. In general
look at loading times."

## What the tail was

A headless Chromium opened the newest shared recording on the live site
(`play.bfstats.io/map.html?replay=/stats/recordings/kcn7x3n6mj.ndjson`, Kursk,
41 players) and logged every request until the network had been quiet for
6 s.

- The replay showed at 55 s; requests went on until **180 s**.
- After the first burst, **1 to 14 requests were in flight** at any moment. The
  tail was not bandwidth: each late request took ~1.3 s and the next one was
  asked for only once it landed.
- 252 requests after 90 s: 121 sounds, 80 textures, 18 soldier recipes
  (`poses/*.pose.json`), 17 glbs, a few kit glbs.

Three loaders made chains of one-at-a-time fetches:

| Chain | Where | Shape on the live trace |
|---|---|---|
| A sound's layers | `engine-audio.js` `loadEngineAudio`, `effect-audio.js` `#grow`, `world-fire.js` `#grow`, `page-audio.js` (wire scrapes, ambient beds) | `mgdist1` ... `mgdist14`, `explrev1` ... `explrev6`, `collstone1..N`: one round trip per variant, two scripts at a time |
| Hull sounds | `vehicle-audio.js` `_build`, on each hull's first claim | `tnkstrt`, `t34eng2`, `wspfire`...: a hull's engine, then each gun, then each gun's edges, then each part |
| Soldier bodies | `replay-bodies.js` `warmAt`, four workers | recipe JSON, then rig and weapon glbs, then their textures: about 4 s a body, 50 kit items |

What was not the tail: the 635 HUD files (all asked for at once, done before
the replay shows) and the page's 495 modules (preloaded together on the live
site; the dev server on :5273 has no preload list and loads them by import
depth).

## What changed

- **`loadLayerBuffers(layers, getBuffer)`** (`engine-audio.js`): every distinct
  sample of a patch fetched and decoded together. Used by all four layer
  loops; the ambient beds ask for every bed before awaiting the first.
- **`VehicleAudioRack.prime(templates)`**: every sample named anywhere in the
  templates' sound entries (`sampleFiles`: engine, guns, burst edges, parts),
  from the level's report or the tree's shared table, all at once. `_build`
  also asks for its whole entry up front before awaiting patch by patch.
- **`EffectAudio.primeAll()`**: every effect script's samples and first slot,
  six scripts at a time (2.3 MB for all 223 vanilla samples).
- **The replay primes both** (`replay.js` `load`, through `primeVehicleAudio`
  and `primeEffectAudio` on the map's context) once the models are in, not
  waited for. Primed alongside the models it pushed the opening later (213
  sounds in the same 5 s as the opening bodies).
- **Bodies warm ten at a time** (`WARM_AT_ONCE`), the men alive at the opening
  still first.

## Checked

`waterfall.cjs` (a Playwright run logging every request) against the local
viewer on :5273 with the Bocage recording `replays/feed/zz4g8tz9ph.ndjson`,
Chrome's network emulation at 150 ms latency and 5 MB/s, the same build with
the change taken out and put back:

| | Shown at | Requests after it showed | Last request landed |
|---|---|---|---|
| Before (run 1) | 77.0 s | 336 | 155.3 s (+78 s) |
| Before (run 2) | 92.7 s | 281 | 176.1 s (+83 s) |
| After (run 1, primes during models) | 89.7 s | 96 | 96.6 s (+7 s) |
| After (run 2, primes during models) | 82.9 s | 96 | 88.3 s (+5 s) |
| After (primes after models) | 88.7 s | 137 | 105.7 s (+17 s) |

The opening time moves 77-93 s between runs of the same build (other
sessions' Unreal jobs had the CPU; the dev server loads modules by import
depth), so it is noise here; the tail is not. In all three runs after, the last
sound had landed before the replay showed; before, it landed 73 s and 84 s
after.
