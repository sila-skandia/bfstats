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
