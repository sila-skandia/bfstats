# Level ambience: shorelines, rivers and building beds at retail level (2026-09-26)

Owner's report: "The ambient environment sounds are too loud. Or potentially not
fading out when expected. Like on Wake all I can hear is crashing waves no matter
where I am, and they overwhelm a lot of the battle noises."

## Root cause

`page-audio.js` played every placed ambience emitter (shoreline, river, lake,
building hum, flag) at `volume * ramp`, where `ramp` was the script's
`Volume <- Distance` fade and nothing else: the panner's rolloff was 0 and no
DirectSound fall-off was applied. Wake's coastline script
(`levels/Wake/Sounds/Coastline.ssc`) says `volume .6`, `minDistance 1`, ramp
`40 80 1 -1`, so the surf sat at 0.6 anywhere within 40 m of the shore and only
faded out by 80 m. Wake is a narrow atoll: that is almost every square metre of
it. The rest of the page's voices (engines, gunfire, impacts) have followed the
engine's `minDistance / d` law since 2026-09-25 (ledger SND-6); the ambience
path was the one left behind.

Three smaller departures on the same path:

- the outline was walked as an open polyline; the engine closes it;
- 45 barbed-wire fences on Wake (621 depots were fixed the same way before)
  looped `e_Barbwire`'s scrape, a one-shot (`loop` absent), for ever;
- building sounds ignored `relativePosition` (the guard tower's wind is 15 m up).

## What retail does (binary evidence)

`AreaObject::handleFrameUpdate`, `bf1942_lnxded.static` `0x08269f30`, decompiled
with `features/bf1942-engine-reference/lnxded/decompile.sh` (ledger SND-8, SND-9):

1. camera position from `ObjectManager::getCamera` (vtable `+0x70`, confirmed with
   `lnxded/vt.py`);
2. nothing happens with fewer than three line points (`if (2 < n)`);
3. each segment runs from point `i` to point `(i + 1) % n`: a closed outline;
4. points are added straight to the object's x and z, no rotation;
5. distance to the outline is measured in XZ only;
6. inside `triggerRadius` (template `+0x15c`) the sound's transform is set to
   (nearest x, object y, nearest z) and it plays; outside, it is stopped.

The voice is then an ordinary DirectSound voice (SND-6): `minDistance / d` past
its minimum distance, no maximum, the `.ssc` ramp on top at the true distance
(SND-10). Wake's coastline minimum distance is 1 m, which is also DirectSound's
own default, so the Wake figures below do not rest on the one inferred link in
SND-6 (which descriptor word feeds `SetMinDistance`).

## Retail data, vanilla + XPack1 + XPack2

Survey of every level archive's `Sounds/*.con` + `.ssc` (scratch script, one run):
AreaObject coast/river/lake scripts use `minDistance` 0.1..50 (Wake 1, most
coastlines 5), trigger radii 20..150 m, and every one authors its distance ramp
as a 1 -> 0 fade. Wake has three AreaObjects (`island1..3`, 87 / 74 / 131
points) all at y 95 = the water level, trigger radius 40. Every placed instance
is at rotation `0/0/1.5e-5`. Two XPack2 levels (Peenemunde, Telemark) say
`volume 10` on `Ocean.wav`; it is clamped to 1 like every other voice.

## Fix

- `viewer/area-sound.js` (new, pure): `nearestOnOutline` (the closed XZ walk),
  `emitterAt` (radius gate, voice position, `min(1, volume * ramp) * min/d`),
  `loudestEmitter` (a same-sample group plays its loudest member: the one-voice-
  per-sample rule stays), `isBed` (one-shots are not beds).
- `viewer/page-audio.js`: `updateAudio` uses it with the camera's world point;
  flags carry `minDistance`; non-looping emitters stay out of the pool.
- `bf42/level.py` / `extract_map.py`: each `sounds.areas` entry now ships `kind`
  (`area` / `point`), `loop`, `minDistance`, `distanceVolume` (the script's ramp)
  and, for AreaObjects, `triggerRadius`; AreaObjects are not rotated and need 3+
  points; building sounds take `relativePosition`'s height; flags ship
  `distanceVolume`. All additive: the deployed viewer ignores the new keys.
- An older `scene.json` still gets the fall-off (`minDistance` defaults to 1, the
  near/far pair is the ramp), so the published trees were already fixed by the
  code alone; the re-extract adds the radius, the real minimum distances and the
  one-shot flag.

## Measured

`python3 tools/bf1942-models/tests/ambient_level_measure.py Wake` (offline: the
level's heightmap for listener height, the shipped `scene.json`, decoded
samples' RMS, the page's old law against `area-sound.js`; the K98 at 20 m is its
real `weapons.json` layers through `ssc-curves` + `distanceRolloff` +
`WEAPON_HEADROOM`, loudest 100 ms). Levels in dB re full scale; the bed is
`windcalm` x 0.6 = -34.2 dB throughout; the K98 at 20 m is -19.3 dB.

| Wake position | from coast | waves before | waves after | bus before | bus after | shot over bus, before | after |
|---|---|---|---|---|---|---|---|
| shoreline | 5 m | -22.8 | -38.2 | -22.5 | -32.7 | +3.2 | +13.4 |
| The_beach flag | 10 m | -22.8 | -43.3 | -22.5 | -33.7 | +3.2 | +14.4 |
| ~50 m inland | 50 m | -26.8 | silent | -26.1 | -34.2 | +6.8 | +14.9 |
| ALLIES_north_village | 41 m | -23.7 | silent | -23.3 | -34.2 | +4.0 | +14.9 |
| The_Airfield | 82 m | silent | silent | -34.2 | -34.2 | +14.9 | +14.9 |
| furthest inland | 113 m | silent | silent | -34.2 | -34.2 | +14.9 | +14.9 |

Before, the surf was 11-12 dB over the wind across the whole south of the island
and a rifle 20 m away cleared it by 3 dB. After, surf is loud only at the
waterline (0.6 / d: -6 dB at 2 m, -19 dB at 10 m relative to the old level),
gone past 40 m, and the same rifle is 13-15 dB over everything.

Other levels, same script: Guadalcanal's shoreline is unchanged at 2 m (-24.4)
and its surf is gone 50 m inland (was -29.3); Omaha's beach flag (37 m) drops
from -22.8 to -40.2; Peenemunde's church (25 m) from -21.9 to -37.8.

Live page check (headless, `map.html?map=wake&mod=bf1942`, camera on the beach
flag): the Water_waves voice at 0.0399 (0.6 / 10.5 m x master 0.7), anchored on
the outline at y 95; at the airfield 0; four groups (the barbed wire gone); no
page errors.

## Pinned by

`tools/bf1942-models/tests/test_area_sound.mjs` (run by `test_area_sound.py`,
so `unittest discover` and `verify.sh` pick it up): the closed walk, the radius
gate in XZ, the height only in `d`, 3-point minimum, ramp x fall-off, the
volume clamp, legacy data still attenuating, point emitters, one-shots, group
arbitration, a sweep of every shipped vanilla emitter at six distances, and Wake
itself (no surf at the airfield, beach surf under 0.1). `tests/test_sound.py`
covers the extractor fields, no-rotation and the 3-point rule.

## Re-extracted and published

`patch_scene.py --layer sounds --mod bf1942|XPack1|XPack2 --all`: 21 + 27 + 30
`scene.json` rewritten (coral_sea and truk unchanged). Published from a scratch
root holding only those 78 files (`publish-mesh-delta.py maps --hash --root ...`),
because the shared tree also held another agent's unpublished `effects.glb` and
`patron*.mp3`. Live sizes match (wake 655306, guadalcanal 808406,
xpack1/baytown 546718, xpack2/peenemunde 870291) and carry `triggerRadius`.

## Open

- **SND-11 EnvironmentSound.** The wind bed is still a flat 2D loop at its
  script volume (Wake `windcalm` 0.6, now the loudest ambience almost
  everywhere). Its placement is client-only and untraced; if the owner still
  finds the ambience loud away from the shore, this is where to look next.
- SND-6's `SetMinDistance` feed is still inferred (see SND-10 for how far the
  parser join got). It matters for rivers and lakes with `minDistance` 3..50,
  not for Wake.
- Building sounds' `relativePosition` x/z is not applied (needs the static's
  rotation convention); only the height is.
- The `#templateLevel MEDIUM` tiers (Wake's coastline MEDIUM ramps 5 -> 15) are
  not offered; HIGH is used, as for every other script.
- Level `SimpleObject` sounds with volume 0 (Battle of Britain's siren) are
  script-driven in retail and still fall back to the ramp's start value here.
