# Map page frame pacing while firing

Performance pass on the mesh viewer's map page (`tools/bf1942-models/viewer/map.html`)
plus two input bugs found along the way. Driven by Dylan's report: firing feels
choppy, and the browser once "crashed" while playing.

## The problem

**Firing was genuinely slow, not just perceived that way.** A stepped 900-frame
firing profile (headless, deterministic) spent 11.0 s of self time before any of
the fixes below, 19.7% of it in three.js's `updateMatrixWorld`. Real-time pacing
headed (system GL, DPR 2, 4x CPU throttle — a rough stand-in for a laptop on
power save) held 23.7 fps with 1,335 of 1,422 frames over the 33 ms/frame budget.

**Two things turned out not to be the bug they looked like:**

- **The frame rate complaint was partly the laptop being on power save.**
  Headless Chromium under CPU throttling is not a usable proxy for this — it
  runs away on this page (frame times grow from 0.2 s to 5 s over a minute,
  renderer RSS climbing, even with the page's own render loop stopped) while a
  real window under the same throttle holds a steady 35-38 fps. Every
  real-time number in this document is from a headed run for that reason.
- **The browser "crash" was Ctrl+W.** Crouch is left Ctrl (`c_PICrouch`,
  matching the game's own binding); walk is W. Holding both to crouch-walk
  while also pulling the trigger is `Ctrl+W`, which the browser owns outright.
  There was nothing to hunt on the rendering side; see Input fixes below for
  what was actually done about it.

**What was real:** three.js's per-frame `scene.updateMatrixWorld()` walks and
recomposes every object's world matrix regardless of whether it moved, the arms
render pass walked the entire level a second time to find one rig, particles
and gunfire allocated and churned the scene graph every shot, DOM reads forced
synchronous layout every frame, and a shader program linked mid-burst could
stall a frame long enough to lose the WebGL context outright (see below).

## Before / after

### Stepped firing profile (headless, deterministic workload + CPU profile)

900 frames of scripted firing/walking/panning, `Wake`/`The_Airfield`/`Thompson`,
DPR 1. Per-commit numbers from the pass that made each change; not re-profiled
individually after the later commits landed on top, since the workload counters
below are deterministic and the profile shares move together.

| build | total self time | `updateMatrixWorld` | `projectObject` | `getBoundingClientRect` | heaviest phase mean frame |
|---|---|---|---|---|---|
| before | 11.0 s | 19.7% | 4.3% | 1.5% | 8.9 ms |
| + arms near pass draws the rig only | 9.2 s | 14.1% | 4.0% | 1.8% | 7.7 ms |
| + static subtrees frozen out of the matrix walk | 6.4 s | off profile | 6.8%* | 2.4% | 6.4 ms |
| + no forced layout | 6.6 s | off profile | 6.4%* | off profile | 6.4 ms |

\* `projectObject`'s *share* rose because the total it is a share of got much
smaller, not because it got slower.

Particles, allocation, warm-up and the minimap repaint (the remaining four
commits) were not individually re-profiled this way — HANDOFF.md has each
one's own before/after where it exists. A final cumulative run of this same
profile against the merged build is pending (see Open items); it should
mainly confirm `updateMatrixWorld` and `getBoundingClientRect` both stay off
the profile and check that `renderer.info.programs.length` does not grow
during the first burst (proving the warm-up actually linked everything the
pool needs).

Baseline scene: fly-through 709 draw calls / 325k tris; on-foot idle 191 / 134k;
firing + walking + panning 77-1,474 draw calls; 5,075 objects (3,529 meshes),
5,059 under the level root (spawners 1,913 across 32 vehicles, control points
116 with 100 bones, terrain 64, other statics ~2,130).

### Real-time pacing (headed, system GL, DPR 2, 4x CPU throttle, 60 s of held trigger + W + crouch toggles + panning)

*Pending re-measurement with the teleport-back protocol against the final
merged build. The machine was mid-extraction (`extract_maps_all.py`) when this
section was drafted; browser-based benchmarking was held off rather than
taking numbers a concurrent CPU hog would have made meaningless. See Open
items for the exact commands.*

| build | fps | p50 | p95 | p99 | frames over 33 ms | jitter | context lost? |
|---|---|---|---|---|---|---|---|
| `93105a2` (before, harness only) | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| final (this branch) | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

For scale, the previous agent's unwarmed intermediate builds (not comparable
to each other — the walk protocol changed mid-run — but illustrative of the
range): before 23.7 fps / p95 59.7 / p99 68.3 ms, 1,335 of 1,422 frames over
33 ms; near-pass and freeze both improved fps (25.2, 30.2) but both also hit
the 8-9.5 s stall and lost the WebGL context, so their numbers aren't a fair
comparison until the warm-up commit is confirmed to stop it.

### Pixel parity

*Pending: `perfbench.cjs shot`/`compare`, final build against `93105a2` as the
seeded baseline, once the machine is free for headed/GPU work again.*

## The hot-path rules

Seven rules came out of this pass. The code cites each by number
(`features/mesh-viewer-performance, rule N`); the numbering here matches.

1. **Render only what a pass needs, not the whole scene a second time.**
   `WebGLRenderer.render` walks every node of whatever scene it's handed —
   `updateMatrixWorld` and `projectObject` across all ~5,100 level objects —
   before a layer mask drops any of them. The arms/near pass used to hand it
   the main scene with a layer filter; finding the one rig that way was 9% of
   the frame. It now gets its own scene (`vmScene`, just the rig, light
   proxies and shared fog) instead of a mask over everything else.
   (`c87fcbe`, `tools/bf1942-models/viewer/map.html` around the `VIEWMODEL_LAYER` pass.)

2. **Static subtrees opt out of the per-frame matrix walk.** Three r169's
   `scene.updateMatrixWorld()` recomposes and multiplies every auto-updating
   object's world matrix every frame, whether or not anything under it moved.
   Over ~5,100 nodes, twice a frame, that was 18-21% of the frame's JS time.
   The level is mostly furniture — terrain, buildings, palms, parked vehicles
   — that never moves once `show()` places it; those subtrees now leave the
   walk (`updateMatrixWorld` becomes a no-op unless a genuine ancestor force
   cascades down), and driven vehicles thaw for the frames they actually move.
   (`4327379`, `freezeStatics`; 832 subtrees frozen. `__matrixDrift()` checks
   every real-time run for anything frozen that a bug still moves — it once
   caught the Hatsuzuki's radar dish.)

3. **No DOM read forces a layout mid-frame.** `getBoundingClientRect` and
   `clientHeight`, read after that frame's own DOM writes, force a synchronous
   layout — 1.4-2.4% of the on-foot frame for something that changes only on
   resize. The stage size and the two map canvases' CSS widths are now cached
   and kept current by a `ResizeObserver` instead of asked for every frame.
   (`e6ce563`, the `stageWidth`/`stageHeight` cache and `canvasCssWidth` map.)

4. **Pooled objects stay parented in place, hidden, not added and removed.**
   `scene.add`/`scene.remove` per particle — an `indexOf`, a `splice` and two
   events each, 20-30 times a frame under a Thompson — was the churn. Pooled
   particles now sit under one `effects` group and stay there between lives;
   the group's matrix walk already skips what's hidden, so a parked pool costs
   nothing. (`29a3b8c`, `EffectPlayer`'s `root` group in `effects.js`.)

5. **No allocation on a path that runs every frame or every shot.** A flash's
   roll, a gun's recoil offset, a round's unit direction were each a fresh
   allocation before — per emitter per frame, per shot — and an allocating
   frame pays for it later at the GC's convenience. Scratch vectors and a
   scratch quaternion, module-level and reused, replace them.
   (`bbb16d8`, the `_spin`/`_recoil`/`_direction` scratch in `gunfire.js`.)

6. **Every program a burst can need is compiled before the first shot.**
   Three's first-use shader check blocks the frame on the link the first time
   a material is actually drawn — a stall of unknown length. On this Iris Xe
   under system GL, the perf harness watched one such link block a frame for
   8-9.5 s and take the WebGL context with it (see below). One pooled mesh per
   emitter, for every effect and gun the level can fire, is now built and
   parked before the level even finishes loading, and `renderer.compileAsync`
   + `initTexture` upload and link all of them together while the loading bar
   is still up — so the first real shot never links anything new. Runs after
   `applyFog()`, so the compiled programs are the fogged ones the frame will
   actually ask for; a level switch re-warms (`flush()` then `warmEffects()`
   again); the arms rig itself compiles the same way and stays hidden
   (`rig.visible` gated on `armsShown`) until its own compile lands.
   (`19f9b2d`, `EffectPlayer.warm()`/`flush()`, `GunFire.warm()`, `warmEffects()`.)

7. **A surface repaints only when what it draws has changed.** The minimap
   and full map are 2D canvases — the art plus every sprite, at DPR 2, was a
   full repaint and a texture upload to the compositor every frame regardless
   of whether the soldier had moved. Each surface now tracks a key (player
   position to the backing pixel, heading to a hundredth of a radian, canvas
   size, whether the art/sprites have loaded, the flown vehicle's position in
   fly-by) and skips the repaint when nothing in it changed, with a 250 ms
   ceiling so a slow drift still catches up.
   (`dd165c5`, the map-surface repaint gate.)

## The Iris Xe context loss

Confirmed cause of the "8 s freeze" symptom, distinct from the Ctrl+W
non-crash above. Real hardware: this machine's integrated Iris Xe, system GL
(not SwANGLE/software), headed, DPR 2, under a sustained firing burst.

Raw evidence from a headed real-time run (`scratchpad/hd-nearpass.log`):

```
{"label":"realtime-firing-walk-pan-60s", ..., "max":9521.5, ...,
 "programs":{"start":19,"end":20}, ...}
--- console errors/warnings: 2
pageerror: The root document of this element is not valid for pointer lock.
warning: WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost
```

A single frame took 9.5 seconds — three orders of magnitude over budget —
during the window where `programs` grew from 19 to 20, i.e. a material was
linked for the first time mid-burst. `scratchpad/hd-freeze.log` shows the
same shape independently (`max:9498.2`, the same console warning). The
previous agent's earlier capture of the stepped (not real-time) profile found
`getProgramInfoLog` at 71% of that run's self time — the driver compiling and
linking a shader is exactly what three's first-use check blocks a frame on.
3 of 5 headed runs of the unwarmed builds lost the context this way. The
kernel log showed nothing (`journalctl` may need privileges beyond what was
available).

Rule 6 (warm-up, above) exists specifically to make this impossible: every
program the burst can need is linked before the first shot, not during it.
Whether it actually stops the stall is the pending real-time re-measurement
above. Independently of whether warm-up holds up, `map.html` no longer goes
silently black when a context loss happens anyway — see Input fixes.

## Input fixes

Two bugs unrelated to frame pacing, found and fixed on this branch.

**A second mouse button while the trigger is held now still zooms, and the
view no longer snaps.** Holding left mouse (fire) and pressing right (zoom)
never reached `pointerdown` — confirmed against real Chromium event order
(`scratchpad/chord.cjs`): a second button joining one already held fires a
`pointermove` carrying the changed button (`e.button`) and the new chord
(`e.buttons`), plus a `mousedown` nothing here listened for, but no
`pointerdown`/`pointerup` at all for that button. Two symptoms followed: the
zoom toggle never ran, and the pointer-move handler fed that event's
(possibly large, synthetic) `movementX` into `lookDelta`, which at
`LOOK_SENS` 0.0022 is enough for one bogus delta to read as a ~90 degree
turn — the "random-feeling" snap. Releasing one of two held buttons is the
same story on `pointerup`'s side, so the trigger could also get stuck held.

Fix: `pointerdown`, `pointerup`, and a chorded `pointermove` (`e.button !==
-1`) all now funnel through one `footButtonChange(e)`, which derives
press/release from `e.buttons` via a button-to-bit lookup rather than
trusting which listener fired. The pointer-move handler skips `lookDelta`
entirely for a button-change event. Gating is unchanged: captured, on foot,
pointer-locked; a `?shots` bypass (`pointerLocked()`) stands the query param
in for real pointer lock, matching the existing `canFire` precedent, since
headless Chromium never grants it. Verified with a new `__chordEvent` hook
that dispatches real events at the real listeners (`scratchpad/s-chordcheck.mjs`,
9/9 checks passing: chorded press toggles zoom and applies no look, chorded
release does not re-toggle zoom and applies no look, left-up clears the
trigger, a plain move still turns the view). **Not yet confirmed with a real
mouse — Dylan should verify the snap is gone.**

**Closing the tab mid-play now asks first.** Crouch stays on left Ctrl for
game parity; the browser owns Ctrl+W outright by default, so there was no fix
on the page's own binding short of Keyboard Lock (see Open items — Chromium's
`navigator.keyboard.lock()` can reserve it, but only inside a fullscreen
session the page would have to request, which this pass didn't add). A
`beforeunload` handler now asks for confirmation, scoped to mid-play
(captured, on foot, a live soldier) so it never fires over the gate screen or
a free-fly pan. Logic-verified against the same gate `footButtonChange` uses;
not live-tested against a real Ctrl+W (native `beforeunload` dialogs are
awkward to assert headless, and browser checks were on hold for this pass —
see Open items). Dylan should confirm the "Leave site?" prompt appears while
firing/crouched and does not appear before capture or in fly mode.

## Open items

- **Real-time pacing re-measurement** against the final merged build, with
  the teleport-back protocol (`scratchpad/stage5.sh`), and a final headless
  stepped run checking `renderer.info.programs.length` stays flat during the
  first burst. Held off because the machine was running a map extraction;
  see the table above for the exact commands once it's free.
- **Pixel parity** of the final build against `93105a2`, all commits'
  captures re-seeded through the same dice (`perfbench.cjs shot`/`compare`).
- **Live confirmation of both input fixes** with a real mouse and a real
  Ctrl+W, and live confirmation of the `webglcontextlost` banner against
  either a real repeat of the stall or a forced loss
  (`WEBGL_lose_context` extension).
- **Instanced sprite pool** for draw-call count itself was designed during
  this pass but not built — needs per-instance opacity via
  `onBeforeCompile` and a per-pool depth sort.
- **Renderer settings** (MSAA, DPR 2 fill cost) were never isolated from
  everything else measured at DPR 2.
- **Keyboard Lock in fullscreen** (`navigator.keyboard.lock(['ControlLeft',
  ...])`) could reserve Ctrl+W from the browser entirely, but only inside a
  fullscreen session the page would have to request; noted, not built.
- **Audio automation cost** (engine/weapon patches) was flagged as
  unmeasured going in and stayed that way — on foot there is no engine or
  weapon patch running, only `Audio.setVolume` per area audio per frame.
