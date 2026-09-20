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

Arms and minimap are pixel-identical. `burst`/`settled` were read here as "a
handful of pixels on the muzzle flash's first rendered frame, not a new
regression". **That reading was wrong, and it was a regression** — warm-up was
building its pooled decals opaque. See "Rule 6 is closed" below: against
`93105a2`, the commit before warm-up, the fixed build is pixel-identical on all
four captures. Workload counters
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
multi-second stall that used to come with it. That one program has since been identified and
fixed — an opaque decal, not a missing material — and rule 6 is now closed;
see "Rule 6 is closed" below.

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
(`pointerLocked()`) standing the query param in for real pointer lock the same
way `canFire` already stands it in for `captured`. (That bypass was added
because headless Chromium was believed never to grant pointer lock. It does —
the headless shell without a gesture, new headless on a real click — and the
chord has since been re-checked under real pointer lock.) **A release is not gated** (`bedcfc2`,
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
Still not live-tested against a real Ctrl+W: this stayed a logic check rather than a live one,
on the belief that Playwright merely auto-dismisses such a dialog. **That
belief was wrong** — `page.on('dialog')` with `page.close({ runBeforeUnload:
true })` reads it, and the guard has since been driven through Chrome's own
Ctrl+W accelerator, 12/12. **Dylan should confirm the "Leave site?"
prompt appears while firing/crouched and does not appear before capture or
in fly mode.**

## Second pass: the open items, measured

Five agents took one open item each, in their own worktrees, sharing a lock so
that only one timed run had the GPU at a time. Every claim below was re-checked
by the coordinator on the merged tree before it landed.

### Rule 6 is closed: the mid-burst program was a decal, and an opaque one

`EffectPlayer.warm()` handed `#acquire` the *emitter* spec where a spawn hands it
the emitter's `particle` block. Every decal was therefore pre-built opaque, and
every sprite pooled under a key no sprite spawn ever looks up: 300 pooled meshes,
none of them in the sprite pools. The program that still linked mid-burst was
`Decal_metal_m1_Material0`, whose key differed from the warmed one in exactly one
field, `opaque`.

That also settles the misdiagnosis above. Those burst/settled pixels were not the
muzzle flash's first frame; they were warm-up rendering decals opaque. Against
`93105a2` — the commit before warm-up — the fixed build is pixel-identical on all
four captures, so the fix removes a regression rather than adding one.

A survey of every gameplay path the `?shots` hooks reach found four more first-use
classes: level materials and textures, bone textures, the cockpit graft, and the
third-person muzzle flash. Warm-up now covers all of them.

| | before | after |
|---|---|---|
| cold first burst | 1 program, 3 first-uses | **0 programs, 0 textures** |
| all 59 library bundles, cold | 1 program | 0 |
| level switch to Aberdeen | 14 programs, 10 on drawn frames | 17, all inside the warm-up compile |
| enter the Corsair, fire from chase | 1 program each | 0 |

Warm-up's own span grows by about 170 ms. `worldReady` does not move, so the
loading bar is unchanged; the extra time lands after it.

Two premises this document stated were wrong. `first-burst-4s` runs *before* the
stepped firing phases in both modes, so the headless "flat 25 → 25" was never a
cold burst reading — it was length-based counting with frame 0 dropped. Count
programs by id and key, never by `renderer.info.programs.length`: three releases a
program whose `usedTimes` reaches 0, so one release plus one link reads as flat.

### Renderer settings are a 20% lever, not the cause

`EXT_disjoint_timer_query_webgl2` turns out to be exposed here with no flags, so
both passes can be timed on the GPU directly. At DPR 2 the whole GPU frame — level
pass, arms pass, resolve, present — is 2.0-3.4 ms, of which roughly 0.15 ms/MP is
fill. The main pass is about 1.3 ms fixed plus 0.15 ms/MP, the near pass 5-8% of
the GPU frame, and firing adds at most 0.6 ms of overdraw.

| ratio | MP | frame, MSAA off | frame, MSAA on |
|---|---|---|---|
| 1 | 1.32 | 2.29 ms | 2.58 ms |
| 1.5 | 2.97 | 2.67 ms | 3.18 ms |
| 2 | 5.27 | 3.44 ms | 3.84 ms |

The frame is CPU-bound at every setting: unthrottled, the page's own loop callback
is 2.08-3.47 ms of a 2.29-3.84 ms frame. The defaults stay as they are; `?aa=0`
and `?dpr=<ratio>` exist now so the trade can be measured, and a "low" preset would
buy about 1.1 ms unthrottled at DPR 2.

**Every DPR 2 number in this document describes a hi-DPI visitor, not this
machine.** Dylan's displays are all `<scale>1</scale>` with text scaling 1.0, so his
own `devicePixelRatio` is 1.

MSAA does nothing for palm fronds or barbed wire — they are glTF `MASK` cutouts,
where only the pixel ratio helps. It does visible work on shallow silhouettes:
ridge lines, the hangar roof, the Thompson's rear sight.

**Dynamic resolution through `setPixelRatio` is not an option here.** Each switch
cost a 38-78 ms frame, and 2 of 4 runs lost the WebGL context. Doing it properly
means rendering to a resizable target and blitting.

### Rule 7's gate, finally measured

0.30 ms/frame while the player stands still, 1-2 ms with the full map open, and
nothing in pacing: while the view turns, 91-100% of frames repaint anyway. The
gate's own key costs 0.013 ms. Keep it; do not expect frames from it.

### The instanced sprite pool is not worth building

Effects are 42.6 of 503 draw calls while firing, 8.5%. Removing them entirely is
worth 2.66 ms at the heaviest moment measured — 190 live sprites under a Bazooka's
`e_rocketFume` — and an instanced pool would capture only part of that.

Most of it is available for one line instead. Three renders a transparent
`DoubleSide` material in two passes, bumping `material.version` before each, so
every sprite draws twice and re-resolves its program each time. `forceSinglePass`
on sprite materials removes half the sprite draws and all that churn: 1.91 ms of
the 2.66, pixel-identical across four captures. It is **not** safe on level
transparent geometry, where 151 pixels differ.

The bigger prize is the level itself. 430 opaque draws per firing frame collapse to
115 instancing keys or 66 merge keys, vegetation alone is 185.7 draws, and every
level draw is currently a material switch because `bindDynamicShading` builds a new
material per mesh. That is a build, not a flag: it needs per-instance range and
frustum culling.

### Audio is not a pacing problem

0.4-1.3% of frame JS (30-280 µs/frame) across idle, firing, driving and flying, and
a headed A/B with audio removed at the source shows no pacing difference. The audio
render thread peaks at 13% of its callback budget — six panners in the Corsair,
where `PannerHandler::Process` is 61% of the thread — with no underruns. Nothing
grows while the context runs: five minutes firing, five driving and three flying
leave calls per frame, live nodes, JS heap and both RSS figures flat.

This document's "on foot there is no engine or weapon patch running, only
`Audio.setVolume` per area audio per frame" was wrong. Of the 24 automation calls a
frame on foot, 21 are three's own ramps — 9 from `AudioListener.updateMatrixWorld`,
12 from two area `PositionalAudio`s — and 3 are `setVolume`.

One real defect was found and fixed: `soundBuffer`/`modelSoundBuffer` looked the
cache up before their `await` and stored only the finished buffer, so two
overlapping setups both missed and fetched the same wav twice — nine of the
Corsair's engine wavs on a re-entry. The pending decode now goes into the cache.

One growth mechanism was measured and deliberately **not** fixed. While the
AudioContext is *suspended* — which is what a page is before its first click —
Chromium retires no automation events, so the per-frame ramps pile up at about
150 B each with insertion cost rising: roughly +0.14 ms/frame and +16 MB per minute
on the gate screen. The obvious fix (keep the listener and area anchors out of the
graph while suspended) made the resume transient consistently worse in the
prototype, unexplained, so it needs repeating before it ships.

### Keyboard Lock, prototyped behind `?kblock`

`navigator.keyboard.lock()` can reserve Ctrl+W, but only inside a fullscreen
session the page requests itself. Measured in both Chromium 141 and Chrome 149:

- `requestFullscreen()` consumes the click's transient activation while
  `requestPointerLock()` and `keyboard.lock()` do not — and Chrome 149 rejects a
  pointer lock requested after fullscreen in the same gesture, so pointer-first
  ordering is mandatory.
- `keyboard.lock()` resolves when the browser *registers* the request, fullscreen
  or not, so the promise is no evidence that any key is reserved.
- `requestFullscreen({ keyboardLock })` is documented but not implemented.
- With Escape locked, a short Escape reaches the page and fullscreen survives; a
  1.5 s hold exits. A tab switch drops the lock for good.

`?kblock`, off by default, asks for pointer, then fullscreen, then the lock, on
on-foot capture only. `beforeunload` is untouched and stays the guard everywhere
else, including Firefox and Safari, which have no Keyboard Lock at all.

### Both input fixes, re-checked as deeply as automation reaches

- The chord now runs through Playwright's real mouse API into the renderer **under
  real pointer lock**: 19/19 on the fixed build against 14/19 on the pre-fix build,
  failing exactly the symptoms the fix targets. The checks discriminate.
- The Ctrl+W prompt was driven through **Chrome's own Ctrl+W accelerator** actually
  closing the tab: 12/12 across the gate, fly mode, mid-play, crouch-walking while
  firing, the deploy screen and after Escape, including rows with no `?shots` on the
  page at all.

Also worth knowing for any future check here: `page.evaluate` carries
`userGesture: true`, so a hook-driven read silently creates user activation. Raw
CDP `Runtime.evaluate` does not.

### A frozen vehicle, and a graft that never composed

The post-merge rule 2 sweep found two bugs older than this work:

1. `Vehicle`'s constructor reparents the driven seat out of `spawners` before
   `setPilot` thaws it, and `thawVehicle`/`freezeVehicle` looked the vehicle up
   through `spawners` alone. A driven vehicle was therefore never thawed and never
   re-frozen: propeller spin and control surfaces reached the screen a frame late,
   and the pose a parked vehicle is left in was never committed at all.
   `__matrixDrift` read 1.7694 on a parked Corsair's propeller.
2. `attachCockpit` grafts the interior into the vehicle's tree and then only
   toggles `visible`. Nothing composes a matrix, so an interior arriving after the
   seat was vacated keeps the cockpit glb's own world matrix — on Wake, 1441 m from
   its own seat. Hidden, but one `setFirstPerson(true)` from being drawn there.

Both are fixed. The second matters beyond itself: a standing drift of 1441 masks
every smaller drift underneath it, which is how the propeller lag stayed hidden.

### `__matrixDrift` has false positives

Found independently by two agents. The visible-only matrix walks leave parked
pooled emitters and the hidden soldier rig under the viewmodel root carrying stale
matrices, and neither is a frozen static that moved. A drift named `Em_*` or `Mesh`,
or sitting under `vm/Scene/viewmodel root`, is noise. The hook should skip hidden
pool children, and the viewmodel scene when the rig is not drawn.

### The cockpit was grafted once per `Vehicle`, and the page builds one per entry

Entering and leaving a vehicle leaked GPU resources in a straight line: on a Wake
Willys, 6 geometries and 4 textures per cycle (`renderer.info.memory` 357, 363, 369,
375, 381 and 364, 368, 372, 376, 380 over five warm cycles). The suspects were what
an exit rebuilds, the soldier and the hand-weapon rig. Neither is rebuilt: the rig is
hidden on entry and shown on exit. The leak was on the way **in**.

`leaveVehicle` nulls `occupancy`, so every E back into the same jeep constructs a new
`VehicleOccupancy` and a new `GroundVehicle` on the same node, and `Vehicle`'s
constructor started its own `loadCockpit`: another fetch of `Willy.cockpit.glb` (6
primitives, 4 textures — the leak's exact size), another `prepareCockpit` warm-up
uploading its textures, another interior grafted under `lodWillyCockpit` and
`lodWillySteering` beside the last one. The old interior's `CockpitSwap` had died with
its `Vehicle`, so nothing would ever show it or free it. Textures landed whenever the
fetch did, even after the exit; the geometries uploaded once the new copy was drawn in
cockpit view. It also cost a fetch, a glb parse and a `compileAsync` per entry, and
put a second steering wheel in `parts`.

Fixed in `flight.js`: the graft belongs to the node (`cockpitGrafts`, a `WeakMap` of
the promise of the node's swaps), and a `Vehicle` adopts it. A seat retaken mid-fetch
waits on the fetch in the air; a failed fetch is not remembered; whatever the graft
leaves behind in the glb (a B17's four unflown gunner stations, already uploaded by
the warm-up) is disposed. One thing had to come with it: a kept interior is indexed by
the next `Vehicle` wherever the last driver left it, so `CockpitSwap` records its
rigged nodes' rest poses off the glb and `adoptCockpit` restores them as the parts'
bases. The exterior has always had that problem — get out with the wheels turned and
the next `Vehicle` takes the turned pose for neutral — and still does.

`disposeHandWeapon` disposing only `material.map` was checked and is not a leak: all
277 materials across the 36 viewmodel glbs carry `baseColorTexture` and nothing else.

`tests/perf/leakcheck.cjs` is the standing check; `test_flight.py` pins the graft
(one load, one interior, rest pose, mid-fetch race, failed fetch, remainder disposal)
without a browser.

## Fourth pass: the audit's small items

A profile-led audit of one on-foot frame found six page-code costs small enough
to fix without a build, and they were taken one commit each. All six are
behavioural no-ops — the point was to stop paying for work whose answer never
changes within a frame, a level, or a lookup.

### What was fixed

| | before | after |
|---|---|---|
| `inRange` (846 distance tests a frame) | 106 ms, 1.28% | 6 ms, 0.07% |
| `applyVisibility` | 54 ms, 0.65% | 12 ms, 0.14% |
| `updateTextureFade` | 49 ms, 0.59% | off the profile |
| `feedTicketVars` + `nationFromVehicles` + `teamNation` | 51 ms, 0.61% | 1 ms, 0.01% |
| `frame`'s own self time | 194 ms, 2.33% | 85 ms, 1.02% |
| **`map.html`, all of it** | **672 ms, 8.07%** | **264 ms, 3.15%** |
| **every viewer module together** | **1,042 ms, 12.50%** | **622 ms, 7.42%** |

`zoombench.cjs --seconds 8 --uncap --scenarios stand-hip-fire`, headed, Wake /
`The_Airfield` / Thompson, DPR 1, before = `acd5f72` and after = this branch's
tip, served side by side and run minutes apart. Total self time was 8,332 ms
against 8,381 ms — the same frame's worth of work either way, with the workload
counters flat (199.9 against 200.6 draw calls a frame, 131,071 against 131,076
triangles, 65 shots, 86 against 85 live particles). **Read the shares, not the
milliseconds**: 1-minute load average was 32-40 throughout, several other
sessions were running timed captures on the same GPU, and the harness's own
2x-run-to-run caveat stands. three.js's share *rises* (56.0% to 59.1%) for the
same reason `projectObject`'s did in the first pass: the total it is a share of
did not move while the page's own half of it shrank.

The six, and what each one actually was:

1. **The ticket counter recomputed four level constants twice a frame.**
   `feedTicketVars` runs before every early return of `updateSoldierHud`, so it
   is on the frame path in fly, foot and seat alike. `nationFromVehicles`
   lowercased all 32 of Wake's spawner names into a Set and spread that Set once
   per nation stem inside a `.some`; `teamNationRule` built a Map and rescanned
   the control points. All of it is level data, memoised now on the level
   directory, the `extras` object, `hudPack.nations` and the spawners group —
   exactly as `stanceNation` already memoises the same rule for the stance icon.
   It is also a fix: `Vehicle` reparents the driven vehicle out of `spawners`,
   so the per-frame form swapped Wake's Axis ticket flag from Japanese to German
   once its Japanese hulls were being driven.
2. **The darkness planes faded whether or not the camera had moved.** 33 meshes
   a frame, each allocating two arrays for `[obj.material].flat()` and writing
   `.opacity` and `.visible` unconditionally. `bindTextureFade` now keeps the
   fading materials in the record, both writes are compared first, and the whole
   loop is skipped while the camera is still. The square root stays: squared band
   edges are *not* exactly equivalent — `sqrt` is correctly rounded, so
   `sqrt(400 + 2^-44)` rounds back to exactly 20 and the two tests disagree by
   one ULP just past the near edge.
3. **The level's distance test chased 814 `userData` bags.** The centres and
   radii `tagCull` fixes at `indexScene` time are hoisted into four
   `Float64Array`s parallel to `cull`, and `.visible` is written only when it
   flips. Float64 and not Float32 deliberately: rounding a centre to single
   precision moves it by up to ~4e-5 m at Wake's coordinates, enough to flip one
   object at the range boundary, and this had to be a no-op. The 32 spawner
   children keep the object-based path, because that list's membership moves
   during play.
4. **The occupied hull was found by scanning every Armored object, twice a
   frame.** `World.occupiedDamageable` is the same answer through the
   `nodeOwners` WeakMap `registerDamageables` fills from the same array. Not a
   straight swap: `addPlayer` runs only from `setOnFoot(true)`, so a player who
   entered a hull from free fly has no world player record and the world would
   have answered null — the scan stays behind a guard for him. Counted in-page:
   an on-foot entry takes the world lookup 63-157 times per vehicle against a
   single scan; a free-fly entry takes the scan every time.
5. **A cached canvas width of 0 read as "not measured yet".** `cssWidthOf`
   tested truthiness, so a hidden surface's 0 fell through to
   `getBoundingClientRect` (rule 3) on every call that got one. Honest about the
   size of this one: with `getBoundingClientRect` wrapped and tallied from before
   the document runs, the pre-change build makes exactly **one** call between
   page load and a spawned on-foot frame and none per frame after that — both
   painters return early while their own box is hidden. It is a correctness fix
   on a hot-path rule, not a frame.
6. **A live particle's look allocated about ten objects.** `evalParticle` built
   a `scale` array, usually a `color` array, a result object, and up to four
   `sampleCurve` samples of three arrays each — per particle per frame, with
   `integrateParticle` adding three more samples for its gravity, drag and
   flipbook ramps. `sampleCurveInto`/`evalParticleInto` are the same arithmetic
   into module scratch, and only the per-frame path uses them. Measured directly
   under node over 684,000 calls (190 sprites x 60 fps x 60 s, the heaviest
   moment the second pass measured): **1,166 ns/call to 261 ns/call, 4.5x**, with
   the consumed results bit-identical. It does **not** show in the browser
   profile above, because `stand-hip-fire` carries 85 live particles rather than
   190 and effects sit inside the run-to-run noise there — the browser evidence
   for this one is pixel parity, not time.

`sampleCurveInto` and `evalParticleInto` are pinned by
`tests/effects_harness.mjs` + `test_effects.py`: eleven ramps across
before-the-first-point, on it, interpolating, a zero-width segment, past the
last, missing, empty, single-point, multi-component, a shorter later point (NaN
on both sides, deliberately preserved) and points with no components at all; and
four particles across every branch of `evalParticle`, each read at six points of
life. The new assertions discriminate — dropping the `color` reset breaks 12
rows, dropping the interior truncation breaks the no-components row.

**Equivalence, per fix.** The ticket variables were read back through
`window.__hudVars()` on two levels and across a level switch in both directions;
the fade and cull sets were captured for every one of the 33 fade meshes, 816
level-root children and 32 spawner children at 17 camera positions on Wake and
on Aberdeen, and again across both option checkboxes, a driven Willy and a level
switch; the occupied hull was read 30 ways across a jeep, a plane, a nested tank
gunner seat and two bare stationary guns, entered from foot and from free fly,
before and after damage. Every one identical to the pre-change build, except the
detached-hulls ticket flag, where the new answer is the correct one.
`perfbench.cjs shot`/`compare` over the whole branch: **arms, burst, minimap and
settled all 0 differing pixels, max channel delta 0**, workload counters equal
(7 shots, 2 particles, 2 decals).

### `forceSinglePass` had already shipped

The open item below said "measured, not applied". It was applied on 2026-09-18
in `aa2820c`, two days after the item was written, and the README was never
updated. Confirmed on this branch: all 116 of the effects materials that are
transparent and `DoubleSide` carry `forceSinglePass`, and turning it off on
those materials alone at runtime, mid-burst with 29 live particles, takes one
firing frame from **208 to 238 draw calls** — one extra draw per live sprite,
which is the mechanism the second pass described. The level's own 1,114
transparent `DoubleSide` materials are correctly left alone; that is where the
151 pixels differed.

### What the audit found already fine

The page's own code is no longer where this frame goes. Outside
`renderer.render`, every viewer module together is **7.4%** of the frame's JS
self time after this pass. Inside it, `projectObject` plus `intersectsObject` is
**15.8%**, `updateMatrixWorld` **4.8%**, and per-draw material binding
(`setProgram`, `needsUpdate`, `setup`, `refreshUniformsCommon`,
`refreshFogUniforms`) **15.0%** — for about 200 main-pass draws, because Wake carries **3,942
distinct materials across 4,244 meshes** and `bindDynamicShading` gives every
level mesh its own. That is the shape of the remaining headroom, and none of it
is reachable by tightening another page function: it is the two structural open
items below, material sharing and instancing.

Deliberately not done, having been measured and found worthless or wrong:
pausing the ambient flag mixer, gating the lens flare, and guarding
`updateProjectionMatrix`.

## Open items

- **A new `Vehicle` takes a parked vehicle's current rig pose for its rest pose.**
  `RiggedPart` and `Wheel` capture `node.quaternion` on construction and map.html
  constructs a `Vehicle` per entry, so an exit with the steering held compounds into
  the next drive. The grafted interior is now protected from it (above); the exterior
  parts are not. Rest poses want to belong to the node.
- **The real-hardware pass is Dylan's, and it is the last thing standing.** The
  14-step list is in `MANUAL-CHECK.md` beside this file: the chord with a real
  mouse (the view snap especially — CDP cannot produce the bogus `movementX` a real
  mouse did), the Ctrl+W prompt in and out of scope, and whether `?kblock` actually
  holds Ctrl+W. Automation cannot close that last one: CDP injects below the layer
  that marks locked keys, so a native-keycode Ctrl+W closes the tab even with the
  lock held.
- **Instancing or merging the level's repeated statics and vegetation** — the
  biggest measured win (430 draws to about 115 keys) and a real build: per-instance
  range culling, frustum culling, `textureFade`. Needs a decision before anyone
  starts.
- **Sharing materials in `bindDynamicShading`**, level meshes only — the effects
  path must keep per-mesh materials or per-particle opacity breaks. 430 material
  switches a frame down to about 65. Inferred; the arm was built but never run.
- **Suspended-context automation growth** — fix known, prototype made the resume
  transient worse for reasons nobody explained. Repeat before shipping.
- **Gating the deploy SPAWN button on warm-up** — `worldReady` enables SPAWN about
  520 ms before warm-up lands, so a player who spawns and fires inside that window
  can still link a program. A UX change, so it needs a decision.
- **Parked vehicles draw their tracer streaks** — `show()` hides `effect`,
  `projectileMesh` and `projectileTrail`, but not `tracerMesh`. Looks like a
  one-line omission.
- **Hand-weapon projectile bodies, trails and baked streaks never appear in the
  world** — they are cloned from rig nodes carrying `VIEWMODEL_LAYER`, which the
  main camera does not draw, so a bazooka rocket and its puffs are invisible.
- **`__matrixDrift`'s false positives** want fixing in the hook, so the canary stays
  readable.
- **Texture memory**, if this ever runs on a smaller GPU: warm-up now uploads every
  level texture (Wake: 290 textures, about 116 MB, +58 MB over the old lazy path).
