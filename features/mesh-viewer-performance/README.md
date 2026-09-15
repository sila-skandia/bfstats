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
| **final (all 9 commits, fresh same-session A/B)** | **5.3 s** | **2.7%** | **7.0%** | **off profile** | **5.4 ms** |

\* `projectObject`'s *share* rose because the total it is a share of got much
smaller, not because it got slower.

The intermediate rows are the previous agent's, one commit at a time, on
different hardware/session conditions than the final row — read the trend,
not a direct ms-for-ms comparison against the last row. The final row is a
fresh `before`/`final` pair captured back to back in the same session
(`perfbench.cjs bench --base http://localhost:557{4,5}`, before = `93105a2`,
final = this branch's tip): before came out to **8.75 s** self time this
session (`updateMatrixWorld` 17.3%, `getBoundingClientRect` 1.5%, heaviest
phase mean 7.26 ms) against final's 5.3 s — a 39% cut, with
`updateMatrixWorld` down to 2.7% and `getBoundingClientRect` gone from the
top-25 self-time list entirely. `renderer.info.programs.length` in the
`first-burst-4s` phase stayed flat (25 → 25) on the final build headless;
see the real-time section below for the headed number, which is not quite
as clean.

Baseline scene: fly-through 709 draw calls / 325k tris; on-foot idle 191 / 134k;
firing + walking + panning 77-1,474 draw calls; 5,075 objects (3,529 meshes),
5,059 under the level root (spawners 1,913 across 32 vehicles, control points
116 with 100 bones, terrain 64, other statics ~2,130).

### Real-time pacing (headed, system GL, DPR 2, 4x CPU throttle, 60 s of held trigger + W + crouch toggles + panning)

Re-measured once the machine cleared (the map extraction that held this off
had finished; a few other sessions' background load stayed in the 3-15
1-minute-load range throughout — not idle in the strictest sense, but nothing
pushed a run itself over budget, and `before`/`final` ran back to back under
the same conditions, minutes apart, teleport-back protocol built into
`perfbench.cjs`'s own `realtime()`):

```
node perfbench.cjs bench --headed --skip-stepped --base http://localhost:557{4,5} \
  --dpr 2 --throttle 4 --realtime 60 --out ...
```

| build | fps | p50 | p95 | p99 | max | frames over 33 ms | jitter | context lost? |
|---|---|---|---|---|---|---|---|---|
| `93105a2` (before) | 39.5 | 16.8 ms | 33.5 ms | 50.1 ms | 66.8 ms | 1,124 / 2,368 (47.5%) | 11.52 ms | no |
| final (this branch, `53f420d`) | 51.9 | 16.7 ms | 33.4 ms | 33.4 ms | 50.1 ms | 474 / 3,112 (15.2%) | 4.36 ms | no |

`first-burst-4s` (the opening 4 s of the burst, where the historical stall
happened): before 77/160 frames over 33 ms, max 66.7 ms; final 1/238 over
33 ms, max 33.3 ms — the burst opening in particular got much smoother, not
just the 60 s average.

Both today's numbers are noticeably better across the board than the
previous agent's own `before` capture (23.7 fps / p95 59.7 / p99 68.3 ms) —
plausibly a quieter desktop that day vs. this one, per the harness's own
2x-run-to-run-swing caveat; read the *shape* of before-vs-final (fps up
~31%, p99 down 33%, jitter down 62%, frames-over-budget down two-thirds),
not the absolute fps, as the result. Neither run lost the WebGL context or
hit a multi-second stall — see the next section for what that does and does
not prove about the Iris Xe finding specifically.

For scale, the previous agent's unwarmed intermediate builds (not comparable
to each other — the walk protocol changed mid-run — but illustrative of the
range): before 23.7 fps / p95 59.7 / p99 68.3 ms, 1,335 of 1,422 frames over
33 ms; near-pass and freeze both improved fps (25.2, 30.2) but both also hit
the 8-9.5 s stall and lost the WebGL context on that run.

### Pixel parity

`perfbench.cjs shot`/`compare`, final build (`53f420d`) against `93105a2`,
same seeded dice (`__seedRandom`), headless:

| capture | pixels differing | pixels over an 8/255 channel delta | max channel delta |
|---|---|---|---|
| `arms.png` (1600x900, before any shot) | 0 (0.000%) | 0 (0.000%) | 0 |
| `burst.png` (mid-burst) | 482 (0.033%) | 114 (0.008%) | 83 |
| `minimap.png` (188x188) | 0 (0.000%) | 0 (0.000%) | 0 |
| `settled.png` (240 frames after release) | 18 (0.001%) | 18 (0.001%) | 178 |

Arms and minimap are pixel-identical. `burst`/`settled` carry the same tiny,
already-diagnosed discrepancy the previous agent found isolating the warm-up
commit alone (HANDOFF.md: "burst capture differs 0.008% of pixels (flash
first frame)") — a handful of pixels on the muzzle flash's first rendered
frame, not a new regression from anything landed since. Workload counters
matched exactly between the two captures (7 shots, 5 particles, 3 decals),
which is the part that has to be exact for the pixel diff to mean anything.

### Functional checks: repaint gate, deploy screen, warm-up on a level switch

HANDOFF steps 3-4, `scratchpad/s-repaint-warm-check.mjs`, 12/12 checks:

- **The repaint gate (rule 7) still lets M and the deploy screen force a
  paint.** M opens the full map from fly mode and the canvas actually
  repaints (grows from a stale ~33 KB PNG to ~670 KB once the map art and
  sprites land); requesting on-foot opens the deploy screen with its own
  distinct repaint (dim, spawn rings); pressing M again mid-life (after
  spawning, canceling back out of a reopened deploy screen) reopens it
  rather than silently no-op'ing behind the staleness check.
- **The arms rig appears once its own compile lands.** After a spawn settles,
  `rig.visible` is true and the weapon has a viewmodel mixer — it does not
  get stuck hidden waiting on a compile that already finished.
- **A level switch re-warms.** Switching the `<select>` from Wake to
  Aberdeen, then spawning fresh (different kit, different weapon — `Sg44`
  in the German desert loadout, not the Thompson) and firing a burst:
  `renderer.info.programs.length` stayed flat (21 → 21) across the new
  level's own first burst, and the burst actually fired (7 shots) rather
  than silently failing. First attempt at this check chained the level
  switch straight off an already-mid-life state left by the deploy-screen
  check above and got 0 shots on the new level — not a bug in the fix, an
  artifact of the check switching levels from a state a real level switch
  doesn't start from; leaving foot mode first before switching fixed it.

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

**What today's re-measurement does and does not show.** Neither the
`93105a2` before build nor the final build lost the context or hit a
multi-second stall in this session's headed runs — but *neither did the
before build*, which the previous agent's own historical data (above) did
lose context on in 3 of 5 runs. That means today's clean run is not
independent confirmation that warm-up fixed it; it is equally consistent
with today's hardware/driver/thermal conditions simply not reproducing the
stall for either build. The headed `first-burst-4s` program count is the
one number that moved in the fix's favor either way: before, `programs`
stayed flat at 19 through the burst (this session); final grew 24 → 25 — one
program still linked mid-burst even after warm-up, though without the
multi-second stall that used to come with it. So warm-up is not linking
*everything* the pool needs before the first shot; it is closer than before,
and nothing this session stalled because of it, but rule 6 is not fully
closed out. Worth another look at which single material is still missing
from `EffectPlayer.warm()`/`GunFire.warm()`'s pooled set.

Independently of whether warm-up holds up, `map.html` no longer goes
silently black when a context loss happens anyway. Verified with a forced
loss (`gl.getExtension('WEBGL_lose_context').loseContext()` under `?shots`,
`scratchpad/s-gllost-check.mjs`, 7/7 checks, screenshot saved alongside it):
the card is hidden before the loss, `position: absolute` (the 6b04669 fix —
it was missing and the card sat in the stage's normal flow instead of over
the canvas), visible and covering the stage center after the loss, and a
forced `restoreContext()` afterward switches the message to the reload
prompt rather than making the card disappear (three's own `onContextLost`
already calls `preventDefault()`, so `restored` fires regardless of this
page's own redundant call — see 6b04669).

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
entirely for a button-change event. A fresh press is gated as before —
captured, on foot, a live soldier, pointer-locked, with a `?shots` bypass
(`pointerLocked()`) standing the query param in for real pointer lock the
same way `canFire` already stands it in for `captured`, since headless
Chromium never grants pointer lock. **A release is not gated** (`bedcfc2`,
found in review): the original code gated both directions identically, so a
release arriving after death or a redeploy nulled `soldier` out from under
it (see the `soldier = null` sites) and `triggerHeld` stuck true into the
next life; a release now always clears its button's state and never
re-touches the zoom toggle.

Verified with a new `__chordEvent` hook that dispatches real
pointerdown/pointerup/pointermove events at the real listeners
(`scratchpad/s-chordcheck.mjs`, 10/10 checks passing): chorded press toggles
zoom and applies no look, chorded release does not re-toggle zoom and
applies no look, left-up clears the trigger, a plain move still turns the
view, and a release after `__setOnFoot(false)` nulls `soldier` mid-hold
still clears `triggerHeld`. **Not yet confirmed with a real mouse — Dylan
should verify the snap is gone.**

**Closing the tab mid-play now asks first.** Crouch stays on left Ctrl for
game parity; the browser owns Ctrl+W outright by default, so there was no fix
on the page's own binding short of Keyboard Lock (see Open items — Chromium's
`navigator.keyboard.lock()` can reserve it, but only inside a fullscreen
session the page would have to request, which this pass didn't add). A
`beforeunload` handler now asks for confirmation, scoped to mid-play
(captured, on foot, a live soldier) so it never fires over the gate screen or
a free-fly pan. Logic-verified against the same gate `footButtonChange` uses.
Still not live-tested against a real Ctrl+W: a native `beforeunload`
confirmation dialog is the one check in this pass genuinely awkward to
assert headless (Playwright treats it as a browser-level dialog it
auto-dismisses rather than page state to read back), so this one stayed a
logic check rather than a live one. **Dylan should confirm the "Leave site?"
prompt appears while firing/crouched and does not appear before capture or
in fly mode.**

## Open items

- **Live confirmation of the mouse-chord fix and the Ctrl+W prompt with real
  hardware.** Everything else in this pass that needed a browser was
  re-verified this session (real-time pacing, pixel parity, the repaint/
  deploy/warm-up functional checks, a forced context loss) — these two are
  the ones only a person at a real keyboard and mouse can close out.
- **Rule 6 (warm-up) is not fully closed.** The headed final build's first
  burst still linked one program mid-burst (`programs` 24 → 25) — see The
  Iris Xe context loss above. Worth finding which material `EffectPlayer.warm()`/
  `GunFire.warm()`'s pooled set is still missing.
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
