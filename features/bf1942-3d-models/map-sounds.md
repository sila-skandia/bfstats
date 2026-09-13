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
