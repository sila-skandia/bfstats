# Handoff: map page frame pacing while firing

Written when the run was cut short. The README this feature still owes
(problem, before/after tables, hot-path rules, "not a crash" entry, open
items) is not written; everything it needs is below and in the commits.

## Where things are

- Worktree: `/home/dylan/projects/skandia/bfstats/.claude/worktrees/agent-a3ba8f779c4486430`,
  branch `worktree-agent-a3ba8f779c4486430`, based on main at `6485f09`.
  Not pushed, not merged.
- Asset symlinks (`viewer/maps`, `viewer/models/*`, `viewer/models/viewmodels/*`)
  point at the main checkout's trees. Gitignored; never committed; never write
  through them.
- My server: `python3 -m http.server 5573 --directory <worktree>/tools/bf1942-models/viewer`,
  PID 3592193. Frozen per-step snapshot builds were served from the session
  scratchpad on 5574-5583 (before, near pass, freeze, layout, particles,
  bisect variants, warm); all are stopped at the end of this run. 5273, 5299,
  5473, 45589, 46769 belong to other sessions.
- Harness: `tools/bf1942-models/tests/perf/perfbench.cjs` (+ README there).
  ```bash
  cd tools/bf1942-models/tests/perf
  node perfbench.cjs bench --base http://localhost:5573 --out x.json            # stepped counters + profile, headless
  node perfbench.cjs bench --headed --skip-stepped --dpr 2 --throttle 4 --realtime 60 --out x.json   # pacing
  node perfbench.cjs shot --dir shots/a; node perfbench.cjs compare shots/a shots/b   # pixel parity
  ```
  Playwright resolves from the main checkout's `ui/node_modules` (a worktree has none).

## Commits (all on the branch, oldest first)

| commit | what | verified |
|---|---|---|
| `93105a2` test(mesh): harness + hooks (`__refill`, `__seedRandom`, `&nopreserve`, `guns.rand`) | harness only | captures deterministic to the pixel run-to-run |
| `c87fcbe` perf(mesh): near pass renders `vmScene` (rig on a camera-following `vmRoot`, light proxies, shared fog) | `updateMatrixWorld` 19.7% -> 14.1%, stepped total 11.0 s -> 9.2 s | pixel-identical captures |
| `4327379` perf(mesh): `freezeStatics` — static subtrees' `updateMatrixWorld` is a no-op unless forced; scene/level root/spawners stop re-composing; driven vehicles thawed/frozen | `updateMatrixWorld` -> off the profile, total 9.2 s -> 6.4 s, 832 subtrees frozen | pixel-identical; `__matrixDrift` 0 after 60 s (radar-dish bug found and fixed by it) |
| `e6ce563` perf(mesh): no forced layout (stage size cached, canvas widths by ResizeObserver, DOM writes on change) | `getBoundingClientRect` 2.4% -> gone; total 6.4 -> 6.6 s (noise) | pixel-identical |
| `29a3b8c` perf(mesh): particles pooled in place under an `effects` group with a visible-only walk; clone only what `onMesh` leaves shared; no per-spawn quaternion | not measured in isolation (stepped run of this build never completed clean) | pixel-identical once the dice were the guns'/effects' own |
| `bbb16d8` perf(mesh): scratch vectors on the shot/flash paths | below noise | not separately captured |
| `19f9b2d` perf(mesh): warm-up — `EffectPlayer.warm()/flush()`, `GunFire.warm()`, `warmEffects()` after applyFog, rig compiled on load via `compileAsync` | pending (see below) | burst capture differs 0.008% of pixels (flash first frame); arms/decals/minimap identical |
| `dd165c5` perf(mesh): map surfaces repaint on change / 250 ms ceiling | not measured | not captured |

`python -m pytest tools/bf1942-models/tests -q` was NOT run after these
commits. Nothing outside `tools/bf1942-models` and `features/` was touched
except `features/bf1942-3d-models/README.md` (a link row, committed with this
file).

The commit split was mechanical: the working tree held everything, and each
commit's index was built by staging the full files and reverse-applying the
later steps' `-U0` hunks (`scratchpad/splithunks.py` + `stepmap.py`). The
intermediate commits were not individually re-captured after the split; the
per-step snapshots they were measured from differ only in the dice plumbing
and the radar fix.

## Numbers

Baseline (headless, Wake, The_Airfield, Thompson, DPR 1): fly-through 709
draw calls / 325k tris; on foot idle 191 / 134k; firing + walking + panning
77-1,474 draw calls; 5,075 objects (3,529 meshes), 5,059 under the level
root (spawners 1,913 across 32 vehicles, controlPoints 116 with 100 bones,
terrain 64, other statics ~2,130).

Stepped firing, 900 frames, profile self time (before -> near pass ->
freeze -> layout): total 11.0 s -> 9.2 s -> 6.4 s -> 6.6 s;
`updateMatrixWorld` 19.7% -> 14.1% -> gone -> gone; `projectObject` 4.3 ->
4.0 -> 6.8 -> 6.4% (share of a smaller total); `getBoundingClientRect` 1.5 ->
1.8 -> 2.4 -> gone. Heaviest phase mean frame 8.9 -> 7.7 -> 6.4 -> 6.4 ms.

Real-time pacing, headed (system GL), DPR 2, 4x CDP throttle, 60 s of held
trigger + W + crouch toggles + panning, cold page (no stepped phases):
- before: 23.7 fps, p50 41.7, p95 59.7, p99 68.3 ms, 1,335/1,422 frames over
  33 ms, jitter 6.6 ms, draw calls mean 280 (`hd-before.log`).
- near pass / freeze: 25.2 / 30.2 fps but both runs hit a 9.5 s frame and
  lost the WebGL context (see below), so not comparable.
- layout: 26.7 fps, 980/1,601 over 33 ms, but draw calls mean 515 (the
  soldier walked somewhere heavier) — the protocol now teleports him back
  every 10 s; re-run all builds (`scratchpad/stage5.sh` was doing exactly
  that when cut short; `hd5-*.log` will hold whatever finished).
- An earlier headed before run WITH the stepped phases first (warm pools):
  42.5 fps, 787/2,549 over 33 ms, jitter 9 ms, max 75 ms.

Headless unthrottled DPR 1 real time is vsync-capped (58-59 fps, 22-29
frames over 33 ms in 30 s) for every build — not a discriminating measure.

## Suspects: confirmed, rejected, unmeasured

Confirmed and fixed: near-pass double walk (1), static matrices (2), forced
layout (3), particle churn add/remove and the discarded clones (5), mid-burst
program links/texture uploads (the coordinator's "material setup on pool
misses" — evidence: an 8.5 s `getProgramInfoLog` = 71% of a run's self time
in `hd-nearpass.log`'s first version; 3 of 5 headed unwarmed runs lost the
context after an 8-9.5 s frame, at frames with `spawned` 14 and programs
19-20).

Kept, below noise: gunfire allocations (6). Implemented, unmeasured: minimap
repaint (4). Rejected as a cause: the CDP-throttle runaway (headless-only —
probe 11/13: the static page with its loop stopped still ran away; the
control page did not; headed was flat), preserveDrawingBuffer (nopreserve
grew the same), per-frame network (0 requests), heap growth (flat 45-70 MB).
Unmeasured: audio automation (7 — on foot there is no engine/weapon patch;
only `Audio.setVolume` per area audio per frame), fixed-step catch-up (8 —
bounded: dt clamp 0.1 s = 6 ticks max, `ticksPerFrameMax` 6, casts <= 61 per
frame in every run), applyVisibility (9 — `inRange` 0.4-1.0%), renderer
settings (10 — MSAA + DPR 2 fill never isolated), dev cache-busting (11 — note
only), draw-call count itself (an instanced sprite pool was designed, not
built: needs per-instance opacity via onBeforeCompile and per-pool depth sort).

"Not a crash": Dylan's browser closing was Ctrl+W (crouch + W). Separately,
this machine's Iris Xe under system GL loses the WebGL context after an
8-9.5 s GPU-side stall during a burst at DPR 2 in 3 of 5 headed runs of the
unwarmed builds; the page has no `webglcontextlost` handling, so it goes
black. Whether the warm-up build stops it is the pending measurement. The
kernel log showed nothing (journalctl may need privileges).

## Half-done, next steps

1. Run `scratchpad/stage5.sh` again (or its headed loop) for before/near
   pass/freeze/layout/particles/warm with the teleport protocol; report fps,
   p95/p99, over-33 ms, jitter, and whether `warm` still stalls. Then
   `perfbench.cjs bench` headless on the final build for the stepped profile
   and the `first-burst-4s` line (programs/textures deltas should be 0).
2. Re-capture parity per commit from git-built snapshots (`git show
   <commit>:tools/bf1942-models/viewer/<file>`), all against commit
   `93105a2` as the before build (same dice).
3. Measure the minimap commit in isolation (stepped `drawImage` share, headed
   pacing at DPR 2) and confirm the deploy screen and M key still repaint
   (`drawFullMap(true)`), including sprite arrival via `paintDeploySoon`.
4. Warm-up: check `renderer.compileAsync` really links every pooled material
   (`renderer.info.programs.length` should not grow during a burst); check a
   level switch (`flush()` then `warmEffects()`); check the rig appears after
   its compile (`rig.visible` gated on `armsShown`).
5. Write `features/mesh-viewer-performance/README.md` (problem, tables,
   rules 1-7 as the code comments cite them, crash log, open items) and run
   `python -m pytest tools/bf1942-models/tests -q`.
6. Add `webglcontextlost`/`restored` handling to map.html (open item).

## Things to trip on

- Headless + CDP throttle runs away on this page; measure pacing headed
  (`--headed` drops the ANGLE flags, which fail in a window here).
- Captures must be fully stepped from before the spawn, and seeded through
  `guns.rand`/`effects.rand` only; a global `Math.random` seed makes any
  allocation-count change look like a rendering change.
- `__matrixDrift` after every real-time run: anything frozen that moves shows
  up by name. `neverFrozen` holds vehicles an ambient clip animates.
- Stepped phases at DPR 2 headed with `gl.finish()` per frame have also
  triggered the GPU stall; `--skip-stepped` for headed runs.
- The replay-viewer branch adds `replayController?.update(dt)` after
  `updateSky()` in `frame()`; the near-pass edits are inside the
  `if (handWeapon?.rig.visible)` block and should merge.
