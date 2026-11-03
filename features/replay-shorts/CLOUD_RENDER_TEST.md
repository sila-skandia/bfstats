# Replay Shorts: cloud render test (2026-11-02)

Can a GPU-less cloud container film a replay kill as a 9:16 Short from the live
site, by stepping the replay clock frame by frame instead of recording in real
time? **Yes.** The picture is right, and a 10.5 s Short in the creator's Shorts
look took **13 minutes** to film plus **~2.5 minutes** to load the page. Real-time
recording is not viable here (under 1 fps).

Measurement only: no production change, nothing uploaded, no viewer file changed.

## Scripts

`shorts-example.mjs` became `scripts/shorts-runner.mjs` (2026-11-03), which
films and uploads the picked kills the same way; it is not kept here.

- `cloud-render-test.mjs`: load, memory, real-time fps, then 450 hand-stepped
  frames (kill - 8 s to kill + 7 s at 30 fps) at 1080x1920 and 1280x720 through
  `window.__renderOnce`, the default chase camera, PNG frames, ffmpeg H.264.
- `shorts-example.mjs`: the example Short. The creator's own one-click short
  (`creator.recordShort(creator.killAt(t, victim))`) with the studio's Shorts
  recipe applied, recorded through its real recording path; only the encoder
  and the wall clock are swapped from outside the page (see "Stepped creator").

```
node features/replay-shorts/cloud-render-test.mjs <outDir> [--swiftshader] [--frames=N] [--sizes=1080x1920,1280x720] [--jpeg]
node features/replay-shorts/shorts-example.mjs <outDir> [--kill=1664.892] [--victim=6]
```

## Environment

| | |
|---|---|
| CPU | 4 vCPU, Intel Xeon @ 2.10 GHz |
| RAM | 16 GB, no swap |
| GPU | none (`/dev/dri` absent) |
| WebGL | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`, WebGL2, default launch flags |
| ffmpeg | `/usr/bin/ffmpeg`, libx264 |
| play.bfstats.io | reachable (map.html, the 26.8 MB recording in 1.7 s) |
| mesh.bfstats.io | reachable |

Target: FHSW Meuse River Line, recording `xhf8sfkt7k`, a StuH42 (victim pid 6,
rafal_pl) killed by a Sherman's 76 mm AP (killer pid 13, Chief-H.E.M.P) at
t = 1664.892 s, 192 m. The slug was live; no fallback needed.

`--use-angle=swiftshader --enable-unsafe-swiftshader` gives the same renderer
string as the defaults (an earlier session checked both), so the timed runs used
the defaults.

## Numbers

| | |
|---|---|
| Page load to `replay.statusLine` | 149-189 s (three loads; 755 vehicles) |
| Browser RSS after load | 3.9-4.2 GB |
| Browser peak RSS (whole run) | **5.1 GB** (sum over every Chromium process) |
| Real-time play, 1280x720 | **0.78-0.88 fps**; the page clamps a frame's step at 0.1 s, so 10 s of wall clock played 0.9 s of round |

Stepped, default chase camera, 450 frames (15 s of video at 30 fps):

| Size | `__renderOnce` (JS) | Readback (`toDataURL` PNG) | Wall per frame | 450 frames | ffmpeg encode |
|---|---|---|---|---|---|
| 1080x1920 | 72 ms avg (p95 84) | 1143 ms | **1.36 s** | 10.2 min | 22 s |
| 1280x720 | 57 ms avg (p95 73) | 1079 ms | **1.21 s** | 9.1 min | 11 s |

`__renderOnce` only queues the GL calls; SwiftShader draws when the canvas is
read (`gl.finish()` returns at once under ANGLE, so the draw shows up in the
readback). The draw, not the pixel count, is the cost: 2.25x the pixels costs
12 % more. The PNG encode is a small part; the 9:16 run below used JPEG.

Example Short (creator kill shot, Shorts recipe, 1080x1920, JPEG q95 frames):

| | |
|---|---|
| Video | 315 frames, 10.5 s, 1080x1920 H.264, 12.8 MB |
| Round time covered | 1661.43-1667.36 s (6 s of round; bullet time stretches it to 10.5 s) |
| Wall per frame | **2.4 s** avg (1.2 s on the lead-in, 2-4.5 s around the hit: smoke, fire, debris, plus the 2D compose) |
| Wall to film | **13.1 min** + 2.5 min load |

### Minutes per Short

- 15 s Short, plain camera: ~10 min stepping + ~3 min load + 20 s encode.
- 10-15 s Short, creator kill shot: ~13-18 min stepping + ~3 min load.
- One page load can film several kills from the same recording, so the load is
  paid once per recording, not per Short. With 4 vCPUs one browser at a time is
  the sensible ceiling (one SwiftShader page uses all cores).

A nightly batch of 10 Shorts is therefore ~2.5-3 hours on this box. A GPU, or
more cores for SwiftShader, would cut that roughly linearly.

## The picture

Correct in every frame looked at: snow terrain, buildings, fences, benches,
fog, the Sherman, the StuH, the AP round in flight, the hit's fire and debris,
the vivid grade, the lower third (`Chief-H.E.M.P · M4A1(76mm)Gun Barrel AP ·
kills rafal_pl · 192 m`) and the hit flash. Nothing blank or broken. Frame
contents match the real-time screenshot of the same moment.

One creative note, not a render fault: the example's last ~second has the end
camera drifting into the smoke, so the closing frames are mostly sky and puffs.
The tag is on in the recipe but empty, so nothing is drawn for it.

## Stepped creator: what follows a hand-stepped clock

Driving `__renderOnce(w, h, 1/30)` with the page's own loop stopped
(`__renderer.setAnimationLoop(null)`):

- **Follows the stepped clock already:** the replay clock (`replay.update(dt)`:
  `time += dt * speed`), the round cam and bullet time (`ReplayCreator.lead` ->
  `rounds.step(t, dt)` eases `player.speed`; measured: speed fell to 0.17 on the
  round's flight and came back to 1), the cameras, the guns and effects (their
  `timeScale` is the feed rate), the clip's span and the recorder's start/stop
  (`runRecorder` keys on round time), and the compose (grade, lower third,
  flash: `composeFrame` -> `overlayAt(..., player.time)`).
- **Real time, needs changing for a stepped job:**
  1. The freeze on the kill: `replay-creator.js` sets
     `frozen.until = performance.now() + freeze * 1000` and releases on
     `performance.now() >= frozen.until`. At 2 s a frame a 0.5 s freeze lasts
     one frame. Fix: count the frame's `dt` into the hold instead of reading the
     wall clock. (The example swapped `performance.now` for a virtual clock
     moved 1/30 s a frame; the freeze then held 16 frames, ~0.5 s, as designed.)
  2. The recorder: `ClipRecorder` (`replay-clip.js`) is `captureStream` +
     MediaRecorder, real time by construction. Fix: a stepped sink, e.g.
     `ClipRecorder` with a `frames` mode that hands each composed
     `recorder.source` frame to a callback (or exposes it for the harness to
     read after `__renderOnce`), with the encode done by ffmpeg outside the
     page. The example stubbed MediaRecorder from outside and read
     `creator.recorder.source` after each step; the creator's compose path ran
     unchanged.
  3. Sound: MediaRecorder's audio tap does not apply. A stepped Short is silent
     unless the job mixes sound offline (the round's events at their video
     times). Out of scope here.
  4. Small: the creator is admin-gated (`creatorAccess`); the harness calls
     `creator.grant(true)` in its own page. A job running as a service would
     want a proper path (a `&creator` test flag under `&shots`, or a service
     token) rather than poking `grant`.

## Not committed

Frames and MP4s stay out of the repo. The example Short and contact sheets
were produced in the session's scratch space.
