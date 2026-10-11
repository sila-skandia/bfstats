# The mix: weapons against the level's bed (2026-10-11)

Status: built 2026-10-11, viewer code only. No `scene.json` field changed, so
nothing was re-baked and the published trees are fixed by the code.

Owner's report, comparing with retail on Forgotten Hope: weapon sounds are far
quieter than in the game, where they are crisp and powerful; the background bed
is overwhelming and drowns everything, Road to Ramelle the worst.

## Cause

Three departures from the engine, in order of size. The engine side is ledger
SND-11, SND-27, SND-28 and SND-29.

1. **The bed's `volume` was played as a gain.** Road to Ramelle's
   `Sound/Environment.ssc` says `volume 80`. `page-audio.js` set the bed's Web
   Audio gain to `80 x master`, +38 dB, and the page's limiter (20:1 above
   -1 dB) pulled the whole mix down to hold it. The engine clamps a sample's
   volume to 0..1 before anything reads it (SND-27), so in the game that bed is
   `windcalm` at 1. Every other voice on the page was already clamped; the bed
   was the one path that was not.

   It is not one map. `surveys/ssc_volume_words.py`: FH writes more than 1 on
   17 of its 54 level beds (80 on six, 90, 75, 68, 62, 40), FHSW on 24,
   FinnWars 300 on three, bf1918 5 on 31, EoD on 39. Vanilla writes 1.4 on
   Aberdeen and 0.25..0.6 everywhere else, which is why it went unnoticed.

2. **Guns, effects and soldiers were 2.5 dB under everything else.** Their
   buses carried `WEAPON_HEADROOM = 0.75`, a figure from before the limiter,
   while the bed, the placed ambience and the engines played at 1. The game has
   one volume group for all of them (`Default`, SND-28): no ambience level, no
   effects level, one options slider. The constant is now 1 and
   `effect-audio.js` takes it instead of its own 0.75.

3. **The bed was ducked to 0.12 in a piloted vehicle, and so was the placed
   ambience.** That was a viewer invention. The engine triggers the bed while
   the player is on foot or in a seat whose SeatObject says `c_SeatIsOutside`,
   and releases it in every other seat (SND-29); shorelines, buildings and
   flags are ordinary world voices with no such rule. `environmentPlays(seat)`
   is that test, on the seat's own `seatObjects` (`seat-survey.js`), and
   `pageAudio.bedGate` eases it over 80 ms so the gain does not click.

Ruled out, with the reason:

- **A `volume` in decibels or percent.** It is a linear factor: the wrapper
  converts with `600 x log2(v)` hundredths of a decibel (SND-27).
- **Separate mixer groups for ambience and effects, or a default options
  balance.** One group, one slider (SND-28).
- **Level lost in the mp3 transcode.** `transcode_to_mp3` applies no gain or
  normalisation.
- **The player's own weapon attenuated by distance.** `playHandFire` is 2D on
  its bus at `min(volume, 1)`.
- **Vanilla's 0.6 being a viewer default.** It is the script's: 18 vanilla
  beds say `volume .6`. The page's `?? 0.6` fallback for a bed with no volume
  is now 1, the sample constructor's default.

## Measured

`python3 tools/bf1942-models/tests/sound_mix_measure.py <level> [mod] [weapon]`:
the bed's long-term RMS and the K98's loudest 100 ms out of the shipped files,
through the old and the new gains and the limiter's static curve, master 0.7.
dB re full scale.

| Level | bed, script | bed gain old -> new | shot gain old -> new | bed out old -> new | shot out old -> new | shot over bed old -> new |
|---|---|---|---|---|---|---|
| FH Road to Ramelle | windcalm, 80 | 56.0 -> 0.70 | 0.525 -> 0.70 | -0.7 -> -32.8 | -12.9 -> -4.5 | **-12.2 -> +28.4** |
| FH Gold Beach | goldambience, 1 | 0.70 -> 0.70 | 0.525 -> 0.70 | -19.1 -> -19.1 | -7.0 -> -4.5 | +12.2 -> +14.7 |
| Bocage | windcalm, 0.6 | 0.42 -> 0.42 | 0.525 -> 0.70 | -37.3 -> -37.3 | -12.9 -> -10.4 | +24.4 -> +26.9 |
| Aberdeen | wind, 1.4 | 0.98 -> 0.70 | 0.525 -> 0.70 | -30.0 -> -32.9 | -12.9 -> -10.4 | +17.2 -> +22.6 |

On Ramelle the bed arrived at the limiter at +5.2 dB RMS and left at -0.7; the
5.9 dB it took off the bed it took off the rifle too, which came out 12 dB
under the wind. The figure is from RMS, so the real reduction on the bed's
peaks was larger. After, the rifle is 28 dB over the bed, the same order as
Bocage.

Gold Beach's bed is a battle recording at -16 dB RMS and `volume 1`: loud by
authoring, and now what the game plays.

## Built

- `viewer/environment-sound.js` (new, pure): `scriptVolume` (0..1, default 1)
  and `environmentPlays(seat)`.
- `viewer/page-audio.js`: the bed is `scriptVolume(volume) x master x bedGate`
  at load and each frame; `AMBIENT_DUCK` is gone, and the placed ambience is no
  longer scaled by it.
- `viewer/engine-audio.js`: `WEAPON_HEADROOM` 1. `viewer/effect-audio.js`
  defaults to it.
- `features/bf1942-engine-reference/surveys/ssc_volume_words.py`: the census.
- `tools/bf1942-models/tests/sound_mix_measure.py`: the table above.

## Checked

- `tests/test_environment_sound.mjs` (run by `test_environment_sound.py`, so
  `unittest discover` and `verify.sh` pick it up): the clamp and its default,
  the seat rule (on foot, no SeatObject, a cockpit, an outside seat),
  `WEAPON_HEADROOM` 1, that the page sets the bed through both rules and has no
  duck left, and every shipped bed of every extracted tree at or below 1.
- `python3 -m unittest discover -s tools/bf1942-models/tests`: 5,539 tests.
  The 5 failures and 18 errors left with `node_modules` linked
  (`test_replay_models` 17, `test_audit_completeness` 1, `test_mouse_look_key`
  4, `test_sim_vehicles` 1) are the same with this change reverted.
- The car-horn invariant, since the gun bus moved:
  `node tests/sound_coherence_measure.cjs aberdeen sherman Coaxial_browning 1.4`
  arbitrated tonality 61.5..62.6 (unarbitrated 42.0..87.8), peak 0.81;
  `... bocage sherman Coaxial_browning+Browning 16` arbitrated 61.4..62.5 (each
  patch alone 53.4..88.9). Both as before the change.
- Not checked in a browser. The bed's gate and the louder buses were not
  listened to on the page; the owner's ear on Road to Ramelle is the test.

## Open

- **The limiter is ours.** DirectSound sums and clips; the page limits at
  -1 dB, 20:1. With every bus at 1 a tank cannon or a close machine gun reaches
  it more often than before. Nothing was heard or measured to be wrong with
  that, but it is the first place to look if loud moments pump.
- **A dead or unspawned player.** The engine leaves the bed as it was (SND-29);
  the page treats "no seat" as on foot and plays it.
- **Replays.** The replay page has no local seat, so the bed always plays,
  whichever seat the followed player is in.
- **`#templateLevel MEDIUM` tiers** are still not offered; HIGH is used.
- SND-28's open ends: what the menu passes the master volume, and which group
  the music stream takes. Neither touches a round's mix.
- The client's Ghidra copy (`~/ghidra-annotated/bf1942-mp-enabler`) was open in
  the GUI when this landed, so the new rows are annotated in `linux-server`
  only. `./annotate.py ~/ghidra-annotated bf1942-mp-enabler` with the GUI
  closed writes the rest.
