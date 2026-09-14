# Map audio: dedup first, then MP3

**Status: implemented 2026-09-14** in `extract_map.py` (`extract_sounds`,
`transcode_to_mp3`) behind `--shared-sounds` / `--audio-format`, with
`tests/test_map_sounds.py` and a re-extraction of all 239 EoD levels. What
follows is the measurement that chose the approach; the section at the end
records what shipped and what the investigation missed.

Publishing Eve of Destruction put 16 GB of one mod's maps on a PVC that shares a
single 4000m/7741Mi Hetzner node with the API, UI, Seq, Neo4j and Redis. 3.21 GB
of that is wav. This is the measurement of what to do about it.

The short answer: **deduplicate, then transcode to MP3 -V2.** As storage levers
the two are interchangeable — either alone recovers ~2.8 GB of the 3.29 GB — but
only transcoding touches what a visitor actually waits for, and only dedup is
free of audio risk. They are independent, they multiply, and both are worth
doing, in that order.

## The corpus

239 levels ship 8,801 wav files, 3,287.76 MB. By md5 there are only **253
distinct payloads, 400.06 MB** — 34.8x as many files as there are payloads, but
only **8.2x the bytes**, which is the figure dedup actually recovers.
`extract_sounds` writes every referenced sample into the level's own `sounds/`
directory, and 31 maps reference `windall.wav`.

The two ratios diverge because duplication is concentrated in the small files:
the short engine layers are copied into dozens of maps, while the 30 MB music
beds appear once or twice. Quoting the file ratio next to a byte total
overstates the prize by 4x — see the same trap in `README.md`, where an
`xargs`-based measurement of the same tree undercounted unique audio because 239
EoD level names include `Charlie_don't_surf`.

The premise this investigation started from put the deduped figure at 0.09 GB.
It is 0.39 GB. That matters: 400 MB of unique audio is worth compressing, where
90 MB would not have been.

Almost all of it is one format, which makes the codec question simple:

| | files | MB | duration |
|---|---|---|---|
| 44.1 kHz 16-bit mono | 240 | 393.98 | 78.1 min |
| 22.05 kHz 16-bit mono | 11 | 2.45 | 1.0 min |
| 44.1 kHz 16-bit stereo | 2 | 3.63 | 0.4 min |

Note what that says about `AMBIENT_RATES = ("22khz", "44khz", "11khz")`: the
22 kHz-first preference almost never fires for EoD. Only 11 of 253 payloads came
back at 22 kHz, because EoD ships its own sounds at 44 kHz in level-local paths
rather than behind the engine's `@RTD` sample-rate directories, so
`resolve_sound` finds them at step 1 and the rate list never gets consulted. The
preference is still right for vanilla; it simply has no purchase here.

Splitting by playback role decides where the risk is, and it lands opposite to
where the bytes are:

| role | files | MB | duration each |
|---|---|---|---|
| ambient beds + positional areas | 105 | 368.64 | 87–346 s |
| vehicle and weapon engine layers | 148 | 31.42 | median 2.1 s |

The 368 MB is long-form material — EoD's per-map radio and music beds, up to
`PreludeToOmega.wav` at 5.8 minutes and 30.5 MB. The gapless-critical content,
the short RPM-crossfaded engine layers that loop every two seconds, is 31 MB.
Compression pays where the loop risk is lowest.

## What the Playwright Chromium will actually decode

Measured in `ui/node_modules/playwright`'s Chromium 141 (HeadlessChrome
141.0.7390.37), by `decodeAudioData` on the real files, not by `canPlayType`
alone.

| | `canPlayType` | `decodeAudioData` |
|---|---|---|
| Opus in Ogg | `probably` | works |
| Vorbis in Ogg | `probably` | works |
| MP3 | `probably` | works |
| FLAC | `probably` | works |
| AAC in MP4 | **`no`** | **`Unable to decode audio data`** |

AAC is confirmed absent, the same wall the wrapped-page music hit. It is ruled
out and needs no further thought.

## Sizes, measured on the real 253 files

| variant | MB | vs wav | avg kbps |
|---|---|---|---|
| wav (deduped baseline) | 400.06 | 1.00x | 688.0 |
| FLAC -8 | 156.20 | 2.56x | 268.6 |
| **MP3 -V2** | **49.19** | **8.13x** | **84.6** |
| MP3 -V3 | 44.65 | 8.96x | 76.8 |
| MP3 -V4 | 39.53 | 10.12x | 68.0 |
| MP3 -V5 | 33.53 | 11.93x | 57.7 |
| MP3 64k CBR | 36.49 | 10.96x | 62.8 |
| Opus 96k | 53.73 | 7.45x | 92.4 |
| Opus 64k | 36.75 | 10.89x | 63.2 |
| Opus 48k | 27.54 | 14.53x | 47.4 |
| Vorbis q2 | 30.63 | 13.06x | 52.7 |
| AAC 96k | 53.80 | 7.44x | — (cannot decode) |

## Gapless looping: Vorbis is disqualified, MP3 is sample-exact

The test decodes each transcode in the real Chromium alongside its PCM original
and compares the returned `AudioBuffer`: length delta, onset index, head/tail
RMS, and best cross-correlation lag. Length delta is the one that matters — a
buffer longer than the original has padding inside the loop, and
`AudioBufferSourceNode.loop` wraps at `buffer.length`, so that padding is played
every cycle.

| | length delta | best lag | verdict |
|---|---|---|---|
| FLAC | **0 samples** | 0 | bit-exact, `corr = 1.000000` |
| MP3 (every rate V2–V5, 64k, 96k) | **0 samples** | 0 | sample-exact |
| Opus | **+1 sample** (+20.8 µs) | 0 at 64k/96k, −2 at 48k | pre-skip honoured |
| Vorbis | **+34 to +592 samples** (0.7–12.3 ms) | 0 | **padding retained** |

Chromium honours Opus's pre-skip: onset stays at sample 0, head RMS matches the
original to three figures, and there is no leading silence. The residual +1
sample is a 21 µs lengthening, not a seam.

Vorbis is the one that fails. Chromium does not apply the granulepos end-trim,
so the decoded buffer keeps up to 12.3 ms of encoder padding. On a 2.1-second
engine layer that is a tick every 2.1 seconds, and it showed up independently in
the mix test below as a ~0 dB result: looped for 8 seconds against the PCM
reference, the extra samples per cycle walk the layer out of phase entirely.
**Vorbis is ruled out for this corpus regardless of how well it compresses.**

MP3 being sample-exact is the load-bearing surprise. LAME writes a Xing/LAME
gapless header, ffmpeg's `libmp3lame` emits it by default, and Chromium applies
both the encoder delay and the end padding precisely — length delta is exactly
zero on all 253 files at every rate tested. **This is a dependency on metadata:
any later step that rewrites or strips ID3/Xing tags silently reintroduces
LAME's encoder delay — 1,105 samples, ~25 ms at 44.1 kHz — as leading silence.**
Whatever does the transcode must not be followed by a tag stripper.

## Quality, and how confident I am

Two measurements, both in the actual decoder.

**Isolated codec error.** Non-looped, rate 1.0, cross-correlation-aligned, SNR
against the PCM original. The obvious confound is that Opus lowpasses harder
than LAME and time-domain SNR punishes that disproportionately, so SNR was also
computed through 8 kHz and 3 kHz lowpasses. It is not the explanation — band-
limited SNR tracks full-band SNR within about 0.4 dB for every codec, so MP3's
advantage here is real and not a cutoff artefact:

| file (role) | MP3 -V2 | MP3 -V4 | Opus 96k | Opus 64k | Vorbis q2 |
|---|---|---|---|---|---|
| `cyltnk` (engine) | **28.7** | 26.2 | 25.6 | 22.9 | 21.7 |
| `t54_engine_hi_rpm` | **26.5** | 21.4 | 23.4 | 19.7 | 16.7 |
| `WillyHiRPM2` (engine) | **25.6** | 23.0 | 22.4 | 19.5 | 17.9 |
| `shermhirpm` (engine) | **19.6** | 17.1 | 17.7 | 14.9 | 13.9 |
| `Environment6` (bed) | **26.1** | 23.0 | 19.7 | 15.8 | 12.7 |
| `windall` (bed) | 24.1 | 21.2 | 23.7 | 21.4 | 16.4 |
| `crickets1` (area) | **17.1**¹ | 14.5¹ | 16.8¹ | 14.0¹ | 12.6¹ |

¹ 8 kHz band figure; `crickets1` is dense stochastic transients and every codec
scores poorly full-band. It is the corpus's worst case and it is heard at
distance through a panner, which is the mitigating circumstance rather than a
measurement.

MP3 -V2 wins on every file. Opus 96k is *dominated* — worse SNR and 4.5 MB
larger than MP3 -V2. The likely mechanism is resampling: these are 44.1 kHz
sources, Opus must resample to 48 kHz inside the encoder, and MP3 encodes 44.1
natively and leaves the single 44.1→48 conversion to Chromium's resampler, the
same one the wav path already goes through. One fewer resampling stage.

**Layered mix.** The stated worry was that artefacts inaudible solo could beat
against a layered crossfade. Tested by rendering a real 8-layer engine spec (the
`k63` on `khe_sanh`) through `OfflineAudioContext` at distinct per-layer gains
and playback rates — the topology `engine-audio.js` builds — and comparing the
summed mix against the same sum of PCM:

| | solo SNR | 8-layer mix SNR | delta |
|---|---|---|---|
| MP3 -V2 | 24.4 dB | **28.7 dB** | **+4.3 dB** |
| MP3 64k | 19.1 dB | 22.2 dB | +3.1 dB |
| Opus 96k | 14.8 dB | 12.8 dB | −2.0 dB |
| Opus 64k | 13.8 dB | 12.5 dB | −1.3 dB |
| Vorbis q2 | −0.6 dB | 0.0 dB | (drift, see above) |

For MP3 the mix is *better* than the solo: quantisation noise across the eight
layers is uncorrelated and partially cancels. The specific fear — that layering
compounds the artefact — is not borne out, and is inverted. The Opus rows lose
1–2 dB in the mix, but those numbers are dominated by the +1-sample loop drift
over an 8-second render rather than by codec error, so they should not be read
as a perceptual verdict either.

**Confidence.** High on everything structural: the AAC failure, the Vorbis
padding, MP3's sample-exactness, FLAC's bit-exactness, the sizes, the decode
cost. Lower on absolute perceptual transparency at any given rate — time-domain
SNR ranks codecs reliably but is a poor proxy for audibility in a transform
codec, which deliberately shapes noise under the masking threshold, and I have
not auditioned these. That uncertainty is the reason to recommend -V2 rather than
the -V5 knee: the whole V2→V5 saving is 15.7 MB out of a 12 GB tree, which is
not worth buying risk that can only be settled by listening.

## Decode cost is not a reason to hesitate

`ho_chi_temple`, one of the heaviest maps: 70 files, 542 s of audio, decoded
serially with fetch excluded, so this is pure main-thread decode CPU.

| | download | decode |
|---|---|---|
| wav | 45.59 MB | 645 ms |
| FLAC -8 | 19.32 MB | 838 ms |
| MP3 -V2 | 5.75 MB | 861 ms |
| Opus 64k | 4.05 MB | 772 ms |

MP3 costs **216 ms more decode** and saves **39.8 MB of download**. Even on a
gigabit link the transfer saving is an order of magnitude larger than the decode
penalty; on anything realistic it is not close. Note the wav path is not free
either — Chromium resamples 44.1→48 kHz regardless, which is most of that
645 ms. Load feel improves.

## The number that justifies transcoding

Dedup and transcoding fix different problems, and only one of them is visible to
a visitor.

**Storage on the PVC**, EoD wavs:

| | files | size | recovers |
|---|---|---|---|
| today | 8,801 | 3,287.76 MB | — |
| dedup only | 253 | 400.06 MB | 2.82 GB |
| transcode only | 8,801 | 426.04 MB | 2.79 GB |
| dedup + MP3 -V2 | 253 | **49.19 MB** | **3.16 GB** |

Neither dominates: as storage levers they land within 1% of each other, because
the heavily-duplicated files are the small engine layers while the 30 MB music
beds appear once or twice. Either one alone recovers ~2.8 GB of the 3.29 GB.
They are not alternatives, though — they attack orthogonal redundancy, so
whichever runs second still recovers ~350 MB on top, and the pair gets to
49 MB where neither gets below 400 MB alone.

The storage argument alone would still let you stop after dedup: 400 MB out of a
~12.3 GB tree is 3.3%, and shaving it to 49 MB is close to a rounding error.
That argument measures the wrong thing. **Dedup does nothing for a cold-cache map
load.** A visitor opening one map downloads that map's audio either way:

| per-map audio payload | p50 | p90 | max |
|---|---|---|---|
| wav (today, and after dedup) | **11.5 MB** | 24.9 MB | **61.3 MB** (`infinite`, 91 files) |
| FLAC -8 | 6.1 MB | 12.0 MB | 27.0 MB |
| **MP3 -V2** | **1.5 MB** | 3.2 MB | 7.8 MB |
| Opus 64k | 1.1 MB | 2.3 MB | 5.7 MB |

**11.5 MB of wav per map load, 61.3 MB worst case, and dedup does not move those
numbers by a single byte.** That is what transcoding buys, and it is the reason
to do it after dedup rather than instead of it.

Dedup does help the repeat visitor, and more than it first appears. `soundBuffer`
keys its cache on `` `${dir}/${relPath}` `` and `dir` changes per map, so today
the same `windall.wav` is a different URL *and* a different cache key in each of
the 31 maps that use it — refetched and re-decoded every time. A shared
directory makes it one URL, one HTTP cache entry, and one decode for the whole
browsing session.

## Recommendation

1. **Dedup to a shared directory.** 3,287.76 MB → 400.06 MB, no audio risk, and
   it collapses 31 refetches of `windall.wav` into one. Do this first because it
   is the step that cannot go wrong, and because it makes the transcode 34x
   cheaper to run and re-run.
2. **Then MP3 -V2 on everything.** 400.06 MB → 49.19 MB, and the per-map figure
   a visitor pays from 11.5 MB to 1.5 MB.

MP3 rather than Opus because in this corpus MP3 measured better on every file
*and* smaller than Opus 96k, it is sample-exact where Opus is +1 sample, and it
is the codec already proven to survive this Chromium. Opus 64k remains the
fallback if 49 MB ever needs to be 37 MB; it is a real 3–5 dB of SNR.

No role split. The hybrid — FLAC the 148 engine layers, MP3 the beds — costs
62.91 MB against 49.19 MB to de-risk the content that MP3 already measured
sample-exact and highest-SNR on. It buys nothing the measurements say is needed.

### Ruled out

* **AAC** — `decodeAudioData` fails outright in the verification Chromium.
* **Vorbis** — up to 12.3 ms of retained encoder padding inside every loop.
* **FLAC as the primary format** — 156.20 MB, and 6.1 MB per map load. Correct
  and riskless, but it leaves the per-map number four times worse than MP3 for
  no benefit the ear can collect. It is the right answer only if a listening
  test rejects MP3 -V2.
* **Chasing the MP3 VBR knee** (-V4/-V5) — 15.7 MB of a 12 GB tree, against
  3–5 dB of measured SNR and an audibility question I cannot close.

## What the change would touch

Nothing in the viewer assumes a format. `soundBuffer(dir, relPath)` in
`viewer/map.html:1123` builds `` `${MAPS_BASE}/${dir}/${relPath}` `` and hands it
to `THREE.AudioLoader` → `decodeAudioData`; the extension arrives from
`scene.json` as opaque string data. `engine-audio.js` never sees a URL, only the
caller's `getBuffer`. A relative `../_shared/sounds/x.mp3` in `relPath` resolves
correctly as a URL, so **dedup needs no viewer change at all**.

Extraction side:

* **`extract_map.py:349` `extract_sounds`** — its inner `write()` at line 364 is
  the single place a sound path enters `scene.json`, returning
  `f"sounds/{basename}"`. Both changes land here: the shared destination, and the
  rewritten extension. It is the one function that must change.
* **`extract_map.py:186` `resolve_sound`** — unchanged. It resolves *source*
  names inside the archives, which stay `.wav` whatever gets written out.
* **`extract_map.py:317` `_SILENCE`, `bf42/level.py:1131,1172`** — the
  `silence.wav` filters are likewise source-side archive-name matches. Unchanged.
* **`bf42/level.py` `discover_level_sounds`, `parse_sound_scripts`,
  `resolve_ssc_path`** — all parse `.con`/`.ssc` script text. Unchanged.
* **Republish** — every existing `scene.json` embeds the old paths, so all 239
  levels need re-extracting or a manifest rewrite; the two cannot be deployed
  independently.

One operational constraint, repeated because it is the quiet failure mode: the
transcode must not be followed by anything that rewrites ID3 or Xing tags. MP3's
sample-exact looping is entirely a property of the LAME gapless header.

## Two notes beyond audio

**This is EoD-specific.** Vanilla's 23 maps ship 971 wav refs, 115.48 MB, 133
unique payloads at 19.40 MB — a 6x duplication over a corpus 20x smaller. Audio
was never a problem for vanilla, and EoD's per-map custom radio and music beds
are the entire difference. A mod-by-mod judgement is the right granularity.

**Dedup should probably be global, not per-mod.** 67 of vanilla's 133 payloads
are byte-identical to one of EoD's 253 — EoD inherits much of the base game's
sound library. A single shared pool across all mods holds 319 distinct payloads
at 407.97 MB, against 419.46 MB for two per-mod pools. The 12 MB is not the
point; one URL for a sample shared by vanilla and EoD is, because it is one HTTP
cache entry and one decode for a visitor who browses both.

**The same analysis generalises to textures, where the prize is larger.** The
8.55 GB of textures embedded across the 239 `scene.glb` files is 55,188 images
of which 7,956 are unique, 3.05 GB deduped. The mechanism is identical —
per-level self-containment duplicating a shared library — but the fix is not, and
it is strictly harder: audio is already separate files referenced by path from
`scene.json`, so dedup is a destination change in one function, while textures
are *inside* the glb binary and pulling them out means external image URIs, a
change to the glTF the viewer loads, and giving up the single-request property
that makes `scene.glb` cheap to fetch. Worth its own investigation, on the
strength of 5.5 GB.

## What shipped, and what this investigation got wrong

Implemented 2026-09-14, as recommended: shared directory *and* MP3 -V2.

`extract_sounds`'s inner `write()` is the whole change, as predicted. Samples go
to `--shared-sounds` (default `<out>/_shared/sounds`) and `scene.json` gets a
relative `../_shared/sounds/x.mp3`. The viewer needed no change, also as
predicted. Three things the investigation did not anticipate:

**No wav fallback.** The first implementation fell back to writing the wav when
ffmpeg was missing or failed. That is wrong on its own terms: a run that lost
its encoder would report success while producing the 3.2 GB tree this exists to
prevent, and you would find out when the PVC filled. It does not even help on a
per-file failure — ffmpeg choking on a sample means a corrupt source, so the wav
written in its place is corrupt too. Now: a missing ffmpeg fails the run before
any extraction work, and a per-file failure raises `TranscodeError` and fails
that level, which `extract_maps_all.py` already handles by counting it,
finishing the rest and listing it for a re-run. `--audio-format wav` remains as
the deliberate opt-out.

**`-f mp3` is not optional.** Samples are written to a temp name and
`os.replace`d, because levels extract in parallel and several resolve the same
sample at once; a half-written file in a shared directory would be served as a
truncated buffer. ffmpeg picks its muxer from the output extension, so a temp
name ending `.part` fails with "unable to choose an output format" — every
transcode, silently, until the format is named explicitly.

**The relative path must be measured from where the level will live.**
`extract_maps_all.py` writes each level to `<staging>/<level>/<level>` and moves
it into the tree afterwards. Measuring against the write location produced
`../../../_shared/sounds/x.mp3` for a path that has to be `../_shared/...` —
resolving correctly on the extracting machine and 404ing for every sample once
published. That is the failure mode this pipeline is worst at catching, because
nothing local is wrong. Hence `--final-out`, and a regression test named after
it.

### Verified, not assumed

The sample-exactness claim was re-measured against real pipeline output in the
browser, decoding the shipped `.mp3` and the same sample extracted with
`--audio-format wav` through the same `AudioContext`:

| | wav samples | mp3 samples | delta | SNR |
|---|---|---|---|---|
| `PattonStart` (1.0 s engine layer) | 50,335 | 50,335 | **0** | 31.0 dB |
| `Environment20` (27.3 s ambient bed) | 1,310,151 | 1,310,151 | **0** | 28.2 dB |

Zero delta, and zero leading silent samples on the engine layer. The loop seam
risk is closed.

Two levels as a smoke test: A_Shau 47 MB → 34 MB, Aberdeen 33 MB → 25 MB, with
80 shared samples totalling 4.5 MB where the wavs had been roughly 7 MB *per
level*.

### Still open

`counts.maps` and the publishing order are unaffected, but a `scene.json`
carrying old `sounds/x.wav` paths and a tree carrying only `_shared/sounds/x.mp3`
cannot be deployed independently — republish both together, then delete the
orphaned per-level `sounds/` directories from the volume.

Global-rather-than-per-mod dedup is still unimplemented, and still the right
idea; it is held back by wanting `viewer/maps/mods/<id>/` to stay a
self-contained subtree so publishing a mod is one recursive upload.
