# The loop seam: a jeep's engine dipping at every wrap

Status: fixed in the page 2026-11-11 (`viewer/gapless-decode.js`), measured
in headless Chromium and WebKit. Nobody has listened to it, and the real
Safari was not run, only Playwright's WebKit build. No re-publish is needed.

## The report

> On that same map [FHSW Tunis 1943], and I've noticed this issue in many
> other places, the sound is hard looping. The jeep plays a repeated driving
> sound, and as the loop ends it cuts back to the start. It makes it feel
> stuttery. In retail there's a smoothing applied.

## What retail does: nothing at the wrap (ledger SND-46, SND-47)

Retail applies no smoothing. The client reads a sample's `fmt ` and `data`
chunks and nothing else: it never reads `smpl` loop points, and it never
trims or fades the data. A loop starts at byte 0 of the data. The software
mixer copies the data into a running DirectSound voice, and at the end of the
data it carries on from byte 0 with a plain copy: no crossfade, no overlap,
no ramp. The addresses are in SND-46. The `.ssc` language has no word for a
loop point or a fade.

So a loop wraps exactly as smoothly as its wav was cut, and the jeep's wavs
are cut to loop. These are the source wavs (`sound.rfa`, `sound/44kHz/`).
The step is the jump from the last sample back to the first, in full scale:

| wav | frames | step across the wrap | mean step inside the sample |
|---|---|---|---|
| `Willyengine3` | 26924 | 0.0004 | 0.0071 |
| `willyngnhi` | 56298 | 0.0056 | 0.0321 |
| `WillyLoRPMcyl` | 29902 | 0.0144 | 0.0179 |
| `WillyHiRPM2` | 14936 | 0.0036 | 0.0075 |
| `kblwgnngn` | 33630 | 0.0101 | 0.0155 |
| `kblwgnngn2` | 18802 | 0.0074 | 0.0079 |

Every step across the wrap is smaller than an ordinary step inside the same
sample. None of these wavs has a `smpl` chunk; each has `fmt `, `data` and
`LIST`. What the owner hears as smoothing in retail is simply the wav played
back with nothing added to it.

## What ours did: encoder padding inside the loop

The published trees carry the samples as MP3, written by ffmpeg's libmp3lame
at -V2 (`extract_map.py` `transcode_to_mp3`;
`features/mesh-mod-assets/audio-compression.md`). An MP3 is built from whole
frames of 1152 samples. The encoder adds 576 samples of delay before the
signal, then pads the last frame out with silence. The LAME header in the
first frame records both counts. Every one of the 909 MP3s in the local
bf1918 tree has that header, with a delay of 576.

The page loops a sample with `AudioBufferSourceNode.loop`, which wraps at the
end of the buffer. So the loop is only seamless if the decoded buffer is
exactly the wav's length:

- **Chromium** applies the header: the decoded length equals the wav's, to
  the sample, at both 44.1 and 48 kHz. The 2026-09-14 study measured only
  Chromium, and that is why it called the seam risk closed.
- **WebKit** ignores the header. It decodes every frame: the signal starts
  576 samples in, and the padding is left at the end. `Willyengine3.mp3`
  decodes to 28800 samples where the wav has 26924. Every pass of the loop
  carried those 1876 extra samples as near-silence, which is 42.5 ms at the
  sample's own rate and 58.8 ms at the patch's pitch of 0.725.

Across the corpus that comes to between 26 and 143 ms a pass. It falls on
every loop, so the engine dips once each time any of its layers wraps. That
is the stutter in the report.

## The fix

`decodeGapless` (`viewer/gapless-decode.js`) reads the frame count, delay and
padding from the header, before `decodeAudioData` takes the bytes. It then
cuts what the browser hands back down to the samples the encoder was given.

The cut window is worked out from what is left. The padding comes off the
end, and the head is whatever remains (`length - samples - padding`), scaled
to the context's rate. So the cut is right whether a decoder keeps the whole
delay, part of it, or the Info frame as well. A buffer that is already the
right length, as Chromium's is, is handed back untouched. A file with no
LAME header (a wav, an Ogg) is decoded as before.

The fix covers every game sample the page plays, because they all come
through two places, `page-audio.js` `fetchAndDecode` and `pageAudio.audioLoader`:

- **Through `fetchAndDecode`:** engines, vehicle parts, vehicle guns, world
  guns, hand-weapon fire, effects, area sounds and the level's bed.
- **Through `pageAudio.audioLoader`:** the radio and the heartbeat loop.
  This loader replaces three's `AudioLoader`.

`replay-music.js` decodes a song the user picks, from their own file, and is
left alone.

## Measured

`tools/bf1942-models/tests/loop_seam_measure.cjs` renders a hull's loops
through `engine-audio.js`'s own `EngineAudio`, in an OfflineAudioContext at
48 kHz, from the driver's seat at rpm 0.5. Every loop starts at byte 0, as
retail starts one. It renders three decodes of the same samples:

- **wav**: the source wav, which is what retail loops.
- **plain**: the published MP3, decoded the way the page did before the fix.
- **gapless**: the published MP3 through `decodeGapless`.

Each render is measured past the gains' settling, over 3.4 s:

- the quietest 5 ms window against the median one;
- the number of 5 ms windows 12 dB or more under the median;
- the longest run of near-silence.

Measured 2026-11-11 for the Willy and the KubelwagenDAK on Tunis.

| browser | layers | decode | quietest window | dips | longest silence |
|---|---|---|---|---|---|
| WebKit | `Willyengine3` alone | wav | -8.2 dB | 0 | 0.4 ms |
| WebKit | `Willyengine3` alone | plain | silent | **44** | **58.8 ms** |
| WebKit | `Willyengine3` alone | gapless | -8.3 dB | 0 | 0.7 ms |
| WebKit | the Willy's five loops | wav | -11.8 dB | 0 | 0.2 ms |
| WebKit | the Willy's five loops | plain | **-16.6 dB** | **22** | 0.3 ms |
| WebKit | the Willy's five loops | gapless | -11.1 dB | 0 | 0.2 ms |
| WebKit | `kblwgnngn2` alone | plain | silent | **64** | **58.0 ms** |
| WebKit | `kblwgnngn2` alone | gapless | -6.4 dB | 0 | 0.3 ms |
| WebKit | the Kubelwagen's five loops | plain | **-15.7 dB** | **19** | 0.3 ms |
| WebKit | the Kubelwagen's five loops | gapless | -11.3 dB | 0 | 0.3 ms |
| Chromium | every case above | plain and gapless | as the wav, within 0.8 dB | 0 | under 1 ms |

After the fix, WebKit's renders match the wav reference in every measure. A
cut buffer can be one sample longer than Chromium's, from rounding when
resampling to 48 kHz.

## How widespread

Every published sample is one of these MP3s, so in WebKit every looping
sample in every tree carried the gap. The census below takes the distinct
looping files in each tree's exported levels (live `scene.json`, plus the
tree's `effects.sounds.json`). The census script is not committed. A file can
fall under more than one kind, so the kind columns do not sum to the total.

| tree | levels | looping files | engine | part | vehicle gun | area | bed | effect | flag |
|---|---|---|---|---|---|---|---|---|---|
| bf1942 | 100 | 166 | 87 | 20 | 22 | 25 | 5 | 13 | 1 |
| xpack1 | 29 | 182 | 102 | 22 | 22 | 23 | 6 | 13 | 1 |
| xpack2 | 32 | 172 | 101 | 19 | 22 | 15 | 5 | 14 | 1 |
| fh | 10 | 203 | 118 | 19 | 30 | 22 | 5 | 13 | 1 |
| fhsw | 140 | 679 | 293 | 36 | 197 | 111 | 23 | 39 | 1 |
| fhsweurope | 274 | 837 | 320 | 37 | 213 | 221 | 44 | 39 | 1 |
| desertcombat | 35 | 192 | 102 | 22 | 44 | 15 | 3 | 11 | 1 |
| eod | 239 | 352 | 158 | 22 | 50 | 88 | 45 | 6 | 1 |
| bf1918 | 133 | 301 | 146 | 27 | 41 | 60 | 25 | 16 | 1 |

That is 3,084 looping files across the nine trees. Engine loops make up
1,427 of them, and they are where the gap is easiest to hear: a short loop
wraps most often, and an engine runs for as long as anyone drives. The census
leaves out two loops that the fix also covers: hand-weapon fire loops (from
the models tree) and the heartbeat. One-shots were padded too, which made a
gunshot start 13 ms late in WebKit. A one-shot has no wrap, so nobody heard a
seam there.

## A re-publish would add nothing the page now needs

The fix lives in the playback path, so the assets stay as they are. A
re-publish could take one of two forms:

- **Re-encode every sample as FLAC** (bit-exact; the 2026-09-14 study
  measured a length delta of 0) or as wav. WebKit would then need no cut, at
  the cost of more bytes (the study has the sizes).
- **Keep MP3 and change nothing.** The header is what `decodeGapless`
  reads. This is the cheaper choice and it works. Keep the study's warning:
  any step that strips the LAME/Xing tag removes the counts, and the cut then
  falls back to no cut.

The first would mean re-running the sound extraction over every tree and
publishing every `_shared/sounds/`. It is not worth it for this defect.

## Open

- **Not listened to.** The real Safari was not run, only Playwright's WebKit
  build. That Safari decodes MP3 the same way is inferred from WebKit's
  shared decoder.
- **Firefox was not measured.** The Playwright install here has no Firefox.
  Whichever way it decodes, the cut leaves a right-length buffer alone and
  cuts a long one.
- **The page starts a loop at a random offset** (`engine-audio.js` `#play`),
  where retail starts at 0 (SND-47). The page keeps this so that two hulls
  of one template never phase-lock. It has no effect on the wrap.
- **Retail stops a loop whose volume reaches 0** and restarts it from byte 0
  when the volume rises again (SND-47). The page keeps silent loops running
  (SND-38).
