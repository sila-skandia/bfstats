# The mix: weapons against the level's bed (2026-10-11)

Two reports, one day. The sections down to "Open" are the bed drowning the
guns; [The pan](#the-pan-a-gun-beside-the-seat-2026-10-11) is the tank's
machine gun playing out of one speaker.

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

## The pan: a gun beside the seat (2026-10-11)

Status: built 2026-10-11, viewer code only. No extracted file changed; nothing
to re-bake, and nothing to publish beyond the viewer's own modules.

Owner's report, after the mix above landed: inside a tank the machine gun has a
distinct left or right bias, as if it played out of one speaker, in most tanks
on the Forgotten Hope maps. Retail does not sound like that.

### Cause

Every placed voice on the page went through an HRTF `PannerNode` at its own
point. The game never asks for a head. A layer that says `stereo` plays on a
2D DirectSound voice, and every other layer on a mono 3D voice made with
`DS3DALG_NO_VIRTUALIZATION`, which is an amplitude pan between two speakers
(ledger SND-30, SND-31).

That only shows where a 3D voice stands close beside the camera, and Forgotten
Hope's coaxial guns are where it does. Their script hands over from the
`stereo` layer to the 3D one at 1 m and gives neither a `relativePosition`, so
the 3D layer is at the gun's own origin; the driver's eye is 1.02 to 1.57 m
from it and well off to one side. Vanilla's coaxial guns say
`relativePosition -1/0/1`, which stands the voice 0.35 to 0.63 m from the eye,
inside the hand-over: a 2D voice, never panned. So the mechanism is general
and the data that meets it is FH's.

It is not new. The HRTF panner dates from 2026-09-14 (`d5a2e61c`). Until
today the gun bus was 2.5 dB down and Road to Ramelle's bed was pulling the
whole mix into the limiter, which is why it went unheard. Commit `f2d260a7`
(two-axis bundles traverse) did not move it either: a seat's own gun and its
Camera hang off the same innermost bundle in the tanks read (the M4A1's
`Coaxial_browning` and `M4A1ShermanCamera` are both children of
`M4A1ShermanGunBase`, its bow gun and bow camera both of `M4A1Sherman_BowMG`,
the Tiger's the same), so no pose of the rig changes one against the other.
That is read off the node tree; the page was not run with the commit reverted.

Ruled out, with the reason:

- **FH's guns attached to the listener.** No FireArms carries
  `setAttachToListener` in FH, FHSW, DC, vanilla or either expansion
  (`surveys/firearms_attach_and_3d_samples.py`). The mods that flag guns flag
  aircraft guns, and the extractor already ships each weapon's own flag.
- **A rule that centres a voice near the listener, or in the player's own
  vehicle.** The per-voice update (`0x00802330`) has no such test: an attached
  sample goes to the listener, every other to its owner's origin.
- **A two-channel file played 3D.** The 3D layers' files are mono
  (`30calmono`, `mg34mono`); 0.3% of FH's 3D loads name a two-channel wav.
- **Web Audio's own `equalpower` model as it comes.** Right idea, another
  curve: up to 5 dB wider than DirectSound's at a wide angle, 14.0 dB against
  8.3 on the PanzerIV H.

### Measured

`node tests/sound_pan_measure.cjs --scene maps/mods/fh/road_to_ramelle/scene.json mods/fh/M4A1Sherman.glb mods/fh/Tiger.glb mods/fh/PanzerIVH.glb`:
each seat's own guns, the voices of their script that sound there, and a mono
noise burst from each place rendered by Chromium's `OfflineAudioContext`. dB
is right over left; "far" is the far channel against the same voice dead
ahead. `law` is `ds3dGains`, and the page now equals it.

| Driver's seat, coaxial gun | distance | off the median plane | before (HRTF): R/L, far | after: R/L, far | law |
|---|---|---|---|---|---|
| FH M4A1 Sherman, `30calmono` | 1.15 m | 37 deg left, behind | -9.2, -8.5 | -3.8, -2.3 | -3.8 |
| FH Tiger, `mg34mono` | 1.57 m | 54 deg right, behind | +11.3, -10.0 | +6.0, -4.0 | +6.0 |
| FH PanzerIV H, `mg34mono` | 1.02 m | 67 deg right, behind | +12.6, -10.1 | +8.3, -5.9 | +8.3 |

The HRTF figures are broadband RMS, so they leave out what a head does to the
far ear besides turning it down (it filters it and delays it). After, the gun
leans 4 to 8 dB, which is what the game's own DirectSound does with it.

In the page (`map.html?mod=fh&map=road_to_ramelle&shots=1`, a bot in the M4A1,
the camera stood at `M4A1ShermanCamera`): the coaxial gun's 3D panner is
`equalpower`, one channel, 9.95 m out in the listener's level plane, at the
azimuth that pans -3.7 dB against the law's -3.8 for that frame's pose; the
near layer has no panner; no page error.

Every other in-seat voice measured, same tool:

- Vanilla Sherman, PanzerIV, T-34 and Tiger coaxial guns; every tank's top and
  bow gun from its own seat, vanilla and FH; the M3A1's Browning; Spitfire,
  BF109 and Ju88A guns: 2D voices at those distances. Never panned, before or
  after.
- FH's tank cannons: `stereo`, 2D.
- Vanilla's tank cannons: the report (`shrmfire`, `t34fire`, `tigerfire`) is
  within about 10 degrees of dead ahead by its own `relativePosition`; the
  `aafire` pair is authored 1.4 m to either side and leans 3 to 14 dB each
  way, the spread it was written for. The reload and shell-case voices stand
  0.4 m off and lean 5 dB (11 to 12 through the HRTF).
- Hand weapons in first person are 2D on their bus (`playHandFire`).
- A tank's engine is attached for its driver (SND-2) and stands dead ahead.

### Built

- `viewer/ds3d-pan.js` (new, pure): `ds3dGains` (the law), `ds3dRenderPoint`
  (where a Web Audio equal-power panner must stand to give those gains: the
  azimuth `asin(2 lambda / pi)` in front of the listener, level),
  `configureDs3dPanner` (`equalpower`, one channel), `standDs3dPanner` for a
  one-shot.
- `viewer/engine-audio.js`: every panner is configured, and an unattached
  group is stood at the render point each frame, from the listener's own
  world matrix. That is every vehicle engine, gun and part, every bot's
  weapon (`world-fire.js`) and every effect (`effect-audio.js`). The script's
  `Distance` and the fall-off still read the real point.
- `viewer/page-audio.js`, `viewer/comms.js`: the scrape, the refill, the
  placed one-shots and the radio voice are stood once with `standDs3dPanner`;
  the looping area ambience (`THREE.PositionalAudio`) is configured.

A 3D voice dead ahead is now 0.707 a side where the HRTF gave 0.564: placed
voices are 2 dB up on 2D ones. That is DirectSound's relation too (a 3D voice
at the centre is 3 dB under a 2D one at pan 0, SND-31).

### Checked

- `tests/test_ds3d_pan.mjs` (run by `test_ds3d_pan.py`): the law and its
  ends, the render azimuth against Web Audio's curve over the whole range, the
  three FH guns to 0.15 dB, the render point in a turned and a scaled listener
  frame, a gun patch end to end through `EngineAudio` (the 2D layer has no
  panner, the 3D layer is `equalpower` mono at the render point, attached is
  dead ahead, no listener pose falls back to the real point), and that no
  module of the viewer assigns `HRTF` or makes a panner it does not configure.
- `python3 -m unittest discover -s tools/bf1942-models/tests`: 5,676 tests.
  The 5 failures and 17 errors left are in `test_replay_models` (17),
  `test_mouse_look_key` (4) and `test_sim_vehicles` (1), the three modules the
  mix change above found failing without it; clean main was not re-run here.
- The car-horn invariant, since every gun voice moved:
  `node tests/sound_coherence_measure.cjs aberdeen sherman Coaxial_browning 1.4`
  arbitrated tonality 61.6..62.9 (unarbitrated 61.5..93.2), peak 0.81;
  `... bocage sherman Coaxial_browning+Browning 16` arbitrated 61.5..62.9
  (each patch alone 37.7..84.7). As before.
- Not listened to. The owner's ear in an FH tank is the test.

### Open

- **The curve between the ends is Wine's.** The owner's copy runs on Wine's
  DirectSound and that is what was read (SND-31). Windows' own documents the
  two ends only. If a Windows capture ever disagrees, `ds3dPanAmount` is the
  one function to change.
- **The PanzerIV H's coaxial gun is 2 cm past its hand-over.** 1.02 m against
  1 m: the 3D layer sounds on the page. Whether retail's eye is those 2 cm
  nearer (and the gun 2D) was not measured; the camera is the Camera node plus
  its pivot (`camera-pivot.js`), not checked against a capture here.
- **The area ambience** stands at its emitter on Web Audio's own curve, not at
  a render point: a few dB wider than DirectSound's at a wide angle.
- **A one-shot's render point is fixed for its life.** A listener that turns
  hard inside a one-second sample hears it pan on a slightly different curve.
- **A two-channel file on a 3D voice** is mixed to one channel here. What the
  engine does with one was not read (0.3% of FH's 3D loads).
- **DirectSound's hardware path.** With hardware acceleration on, the game
  asks for a hardware buffer and the card pans it. Wine has none.
- The client's Ghidra copy was open in the GUI again (`annotate.py` could not
  lock the project), so SND-30 and SND-31 are not annotated:
  `./annotate.py ~/ghidra-annotated bf1942-mp-enabler` with the GUI closed.
