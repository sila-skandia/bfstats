# Map page frame-pacing bench

`perfbench.cjs` drives `viewer/map.html` through its `?shots` hooks and reports
what a frame costs while a soldier walks, crouches, turns and holds the trigger.
It is not a pytest: it needs a static server in front of `viewer/`, a GPU, and
for real-time pacing a display. The findings it produced, and the hot-path rules
they became, are in `features/mesh-viewer-performance/README.md`.

```bash
cd tools/bf1942-models/viewer && python3 -m http.server 5573 --directory "$PWD" &
cd ../tests/perf

# Stepped counters and a CPU profile, headless: draw calls across both
# render passes, triangles, particles, ticks, casts, self-time shares.
node perfbench.cjs bench --base http://localhost:5573 --out before.json

# Real-time pacing the way a power-save laptop sees it: a window, DPR 2,
# 4x CPU throttle, 60 s of firing while walking and turning.
node perfbench.cjs bench --headed --dpr 2 --throttle 4 --realtime 60 --out before-headed.json

# Pixel parity between two builds: seeded, fully stepped captures of the
# arms, a burst, the decals that outlive it, and the HUD minimap.
node perfbench.cjs shot --dir shots/before
node perfbench.cjs shot --base http://localhost:5574 --dir shots/after
node perfbench.cjs compare shots/before shots/after
```

Playwright comes from `ui/node_modules` (the main checkout's when run from a
worktree; `PLAYWRIGHT_MODULES` overrides). Every phase prints one JSON line;
`--out` keeps the whole record with per-frame counters.

## Frame-cadence check

`cadencecheck.cjs` answers a different question from `perfbench.cjs`: not what a
frame costs, but whether what the player sees moves on every frame. The world
ticks at 30 Hz (world.js, THE TICK LAW), so a page that drew raw tick state gave
a 60 Hz display a new pose on half its frames and a repeat on the rest — which
reads as "the frame rate feels bad" while the renderer sits at 57-60 fps. The
findings and the presentation design they became are in
`features/mesh-viewer-performance/README.md`, "Third pass: the 30 Hz presentation".

```bash
node cadencecheck.cjs --base http://localhost:5573
node cadencecheck.cjs --base http://localhost:5573 --only foot-zoom-pan
node cadencecheck.cjs --base http://localhost:5573 --uncap --out after.json
```

Eight scenarios — hip / aiming / prone-and-firing pans, walking, a Corsair's
cockpit, a Willys, a Sherman tower and a Defgun — each panned, walked, flown or
driven at a steady rate for `--frames` (180) rendered frames. Per scenario:

- `movedPct`, the share of frames on which the camera's rotation (or its world
  position) changed at all. 100 is a page drawing its own instant; ~50 is a page
  drawing the last tick. A scenario fails below `--min` (95).
- `cv`, the coefficient of variation of the per-frame steps, zeros included. A
  page alternating a step with a stall sits near 1.0 whatever its mean.

It is headed and nothing else: headless Chromium and the hidden preview pane do
not tick `requestAnimationFrame` usefully, and every count would be noise.
`--uncap` adds the vsync-off flags, which is the proof that the motion is a
function of elapsed time rather than of the tick. Every run ends with
`__matrixDrift` (its documented false positives apply — a name like `Em_*` is
noise; compare against the base build rather than against zero). Exit 0 all
pass, 1 one or more fail, 2 a scenario could not be staged.

The panning scenarios feed `__lookDelta` once per rendered frame from inside the
measuring loop, which is what pointer lock delivers; driving it off a timer
measures the timer's jitter instead. The walking scenario stands the soldier on
open ground and probes several headings first, because a body walking into a
wall stands still for an honest reason.

## GPU leak check

`leakcheck.cjs` walks the real E key in and out of a vehicle and fails when
`renderer.info.memory` climbs across warm cycles. Same server, same Playwright.

```bash
node leakcheck.cjs --base http://localhost:5573                  # Willys on Wake
node leakcheck.cjs --base http://localhost:5573 --software       # SwiftShader, no GPU
node leakcheck.cjs --base http://localhost:5573 --vehicle '^Corsair' --cycles 8
```

`--warm` cycles (2) are free, `--cycles` (5) are counted, every sample is taken on
foot outside the vehicle, and each entry waits on `__cockpitReady()` so an
interior lands in the cycle that asked for it. A leak is a slope: the check fails
when a count ends at least one resource per counted cycle above the last warm
sample, and then lists what the counted cycles uploaded and never released, by
scene path. A pool that uploads one mesh late is a step and passes. Exit 0 flat,
1 climbing, 2 the run could not be staged (no such vehicle, E refused).

Renderer settings and the map repaint gate, for isolating what a frame's
pixels cost (`--dpr` stays the window's device scale factor):

```bash
# Uncapped, GPU-timed: MSAA off, the WebGL canvas at ratio 1.5 in a DPR 2 window.
node perfbench.cjs bench --headed --uncap --gpu-timer --skip-stepped --dpr 2 \
  --pixel-ratio 1.5 --aa 0 --realtime 20 --out x.json
```

- `--aa 0` / `--pixel-ratio <r>` load the page with `?aa=0` / `?dpr=<r>`; the
  `renderer` line records what the context actually came up with (MSAA
  samples, `preserveDrawingBuffer`, pixel ratio, drawing-buffer size).
- `--uncap` adds `--disable-gpu-vsync --disable-frame-rate-limit`, so a frame's
  interval is its cost rather than the next vsync.
- `--gpu-timer` wraps both render passes in `EXT_disjoint_timer_query_webgl2`
  queries: `gpuMs.main` (level), `near` (arms), `tail` (from the arms pass to
  the next frame: MSAA resolve, compositors, idle). Every real-time run also
  reports `loopCpuMs` (the page's whole loop callback), CPU inside each
  render call, and per-thread CPU from `/proc` (`cpu`).
- `--fire 0` releases the trigger; `--still` stops walking, turning and
  crouching. `--mapgate 0` calls `__mapGate(false)`: the minimap and full map
  repaint every frame, as before rule 7; `mapRepaints` counts repaints either way.
- `--cpuprofile <file>` saves the stepped phases' raw profile for DevTools or
  for inclusive time under one function.
- The stepped phases resize the renderer to `--width` x `--height`, so the
  real-time phase draws `width x height x ratio^2` pixels whatever the stage is.

What to compare, and what not to:

- **Workload counters** (draw calls, triangles, particles, spawns, ticks,
  casts, programs) are deterministic run to run. So are the parity captures.
- **Profile shares** are stable to about a point. The `(program)` row is
  native time: GL calls, the driver, GC.
- **Frame times** in the stepped phases swing 2x between back-to-back runs of
  identical code on this hardware. Read them as a trend across several runs.
- **Real-time pacing** (fps, p95/p99 interval, frames over 33 ms, jitter) is
  the number that matches "choppy", and it is only meaningful headed:
  headless Chromium under CDP CPU throttling runs away on this page (frames
  grow from 0.2 s to 5 s over a minute with the renderer's RSS climbing)
  even with the page's own loop stopped, while a window under the same
  throttle holds a steady 35-38 fps. `--headed` takes the system GL, because
  a window on this machine cannot create a WebGL context under the ANGLE
  flags headless runs use.
- Every real-time run ends with `__matrixDrift`: every world matrix in the
  scene against a fresh recompute, which is how a frozen static subtree that
  something still moves gets caught (it caught the Hatsuzuki's radar).
