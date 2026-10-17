# WebGL context restore

How the map page (`tools/bf1942-models/viewer/map.html`) keeps a round going
when the GPU takes its WebGL context, without a reload.

## The problem

Under GPU load (other apps or tabs rendering) Chrome loses the page's WebGL
context. On this PC headless it reads `GL_CONTEXT_LOST_KHR ... Internal Vulkan
error (-4)`, a device lost; the twelve-bot sweep saw the GPU process exit
(features/twelve-bot-performance-sweep). The native game rides the same load
out. On a sidecar session a reload costs the whole level load: the sidecar
keeps the server-side player, but the player sits through the load again.

## What the page did before

- `webglcontextlost`: `preventDefault()`, `pageInput.release()` (pointer lock
  and held keys dropped), and the full-screen "Graphics context lost" card
  straight away; a forced `WEBGL_lose_context.restoreContext()` 1.5 s in.
- `webglcontextrestored`: hid the card. Nothing was rebuilt. three r169
  (`initGLContext` in `onContextRestore`) builds a fresh state and forgets
  every program, buffer and texture, so the next frame linked every program
  the level draws and uploaded every texture inside one frame: the stall
  rule 6 of features/mesh-viewer-performance exists to keep out of play.
- The frame loop itself kept calling `frame()` (three's `render` is a no-op
  while lost), so the world did tick through the loss.

## What it does now

`viewer/gl-context.js` owns the lifecycle; `map.html` wires it.

| state | what draws | what the player sees |
|---|---|---|
| live | everything | the game |
| lost | the 2D surfaces only (HUD, comms, minimap, spawn screen, scoreboard) | a small "Graphics reset: restoring" line, no input taken |
| warming | the 2D surfaces only | the same line |
| fallback (no restore in 10 s) | the 2D surfaces only | the Reload card; input released |

- The world, bots, room or sidecar link and audio run through every state:
  they never touched GL. Only `draw3d()` (the main pass, the viewmodel pass,
  a replay's viewmodel and timeline capture) waits on `glContext.drawing()`.
- Input is no longer released on the loss, only on the fallback, so a short
  blip does not cost the player his pointer lock or held keys.
- On restore, `rewarmAfterRestore()` re-runs the load's warm-up into the new
  context (`level.warmSubtree` over the scene, the gun stand-ins and the
  first-person scene: `compileAsync`, texture uploads, first program use),
  and drawing resumes when it settles, or after 20 s whatever happens.
- `restoreContext()` is asked at 1.5 s and every 3 s after. It only applies
  to a loss `loseContext()` made; a real one comes back by Chrome's own
  restore, which the `preventDefault()` opts into. If Chrome has blocked
  WebGL for the site after repeated guilty losses, no restore comes and the
  card is the right answer.
- A restore after the card has gone up still resumes and takes it down.

What the page creates outside three's tracking was checked: no render targets
or PMREM in page code; one `CanvasTexture` (the 64 px impact disc, whose
canvas survives); data textures and GLTF `ImageBitmap`s keep their sources
(nothing closes them after upload), so three can re-upload them.

## Measured

`tools/bf1942-models/tests/perf/contextloss.cjs`, headless Chromium on Vulkan
ANGLE, Wake CoOp, on foot on the carrier deck, 2026-10-17. "HEAD" is a11c4ae0's
viewer served with `--code`; "new" is this change. `--crash` is a real GPU
process crash (CDP `Browser.crashGpuProcess`); without it the loss is
`WEBGL_lose_context.loseContext()` and `restoreContext()` a second later.

| | HEAD, simulated | new, simulated | HEAD, GPU crash | new, GPU crash |
|---|---|---|---|---|
| world ticks through the loss | yes (192 -> 260) | yes (204 -> 267) | yes (191 -> 226) | yes (172 -> 206) |
| shown while lost | full card, input released | the quiet line, input kept | (sampled after the restore) | (sampled after the restore) |
| `restored` after the loss | 0.98 s | 1.01 s | 1.03 s (Chrome's own) | 1.02 s (Chrome's own) |
| drawing again after the loss | at once | 1.74 s (warm-up 0.72 s) | at once | 1.89 s (warm-up 0.86 s) |
| programs / textures on the GPU after | 10 / 47 | 36 / 453 | 10 / 47 | 36 / 453 |
| full turn while firing after: programs linked in-frame | (not run) | 0 | 10 | 0 |
| ... worst frame of that turn | (not run) | 17 ms | 62 ms | 15 ms |
| picture after vs before | same (mean RGB 91,90,96) | same | same | same |
| page errors | none | none | none | none |

So on this PC both builds get the picture back: three r169 rebuilds its state
and the page's textures keep their sources. What the old build did wrong was
around that: a modal card and a dropped pointer lock for a one-second blip,
and a cold renderer afterwards that linked each program the first time play
reached it, inside that frame (62 ms here with the driver's shader cache warm;
on the Iris Xe a cold link is the multi-second stall that took the context in
the first place). The new build pays that once, off the frame, before it draws.

The GPU memory side (task item 3, optional) was not changed: there was no
measured, cheap win to take in this pass.

## Tests

- `tools/bf1942-models/tests/test_gl_context.py` (node harness
  `gl_context_harness.mjs`): the state machine on a fake canvas and clock, and
  the page's wiring (only the 3D passes gated, input released only on the
  fallback, the warm-up covering the scene, the guns and the viewmodel).
- `tools/bf1942-models/tests/perf/contextloss.cjs`: the headless proof above
  (listed in `tests/perf/README.md`, short page probes).

## Open

- Chrome blocks WebGL for a site after repeated guilty context losses; then
  no restore comes and the card (with Reload) is all the page can do. Not
  reproduced here.
- A replay's own first-person scene and the OPTIONS > CONTROLS preview (its
  own renderer) are not re-warmed; they relink lazily on their next draw.
- Geometry buffers re-upload on first draw (171 before, 58 right after); that
  costs microseconds, not a link, so it was left to three.
- Not tested on the owner's hardware or under a real driver device-lost; the
  GPU-process crash is the nearest headless stand-in.
