# Where the browser game is slower than retail, measured per mod

Skandia's report (2026-11-05): the browser BF1942 is noticeably more sluggish
than the retail client, bots make it worse, and the suspicion is that it is
the mods, FHSW and EoD in particular. This pass recorded the numbers on his
current machine, vanilla first and then the mods, and names what the frame is
spent on where it is slow.

Every number here is from an Apple M5 Max MacBook Pro (40-core GPU, 48 GB),
Google Chrome 157 driven by Playwright through `channel: 'chrome'`, on the
built-in 120 Hz display. The earlier performance documents
([mesh-viewer-performance](../mesh-viewer-performance/README.md),
[bot-fight-performance](../bot-fight-performance/README.md),
[twelve-bot-performance-sweep](../twelve-bot-performance-sweep/README.md))
measured a thermally throttled Intel Iris Xe laptop; none of their frame
times transfer to this machine, and none of this document's transfer back.

## The short version

- **Vanilla is not slow here.** El Alamein with 16 bots fighting at close
  quarters, or a natural 12-bot match, holds a locked 120 fps (mean 8.3 ms,
  p95 9-10 ms, no frame over 16.7 ms in 20 s) at 1280x800 and at 3400x2000
  (DPR 2). The main thread is 55 % idle. EoD is the same: its heaviest export
  (Operation Linebacker) and Khe Sanh hold 120 fps with 12 bots.
- **FHSW's big levels are slow, on the CPU.** Operation Varsity (the heaviest
  FHSW export, 31,915 placements) with 12 bots runs at a mean of 20 ms
  (~50 fps) with p95 58 ms, p99 108 ms and ~95 frames over 33 ms in 20 s,
  and the same at DPR 1 and DPR 2: the GPU is not the limit, the main thread
  is, at 0 % idle. A typical FHSW level (Omaha Charlie Sector, 1,857
  placements) holds 120 fps at 49 % idle.
- **Half of Varsity's frame is three.js submitting 126,041 meshes
  (4,676 draw calls)**, a quarter is the bots' path search over a 2048 m
  level, and the rest is everything else. Taking the repeated statics out of
  the draw (a what-if, below) halves the frame: that is the bound for an
  instancing fix, the top lever.
- Skandia can now read these numbers inside any session: `console.showStats 1`
  (the `~` console) prints the display's p50 / p95 / worst frame interval and
  the page's own cost split into sim / present / draw / HUD.

## How it was measured

`tools/bf1942-models/tests/perf/botfight.cjs`, the harness from
[bot-fight-performance](../bot-fight-performance/README.md), in its headed
real-time mode (the page's own loop in a Chrome window, rAF intervals, a CPU
profile). Four flags were added for this pass:

- `--channel chrome`: Playwright drives the installed Google Chrome (a Mac has
  no Playwright Chromium unless one is installed, and Chrome is what Skandia
  plays in).
- `--dpr <n>`: the window's device scale factor (was fixed at 1).
- `--mod <id>`: the mod the level belongs to (`mod=` was hard-wired to
  `bf1942`).
- `--follow`: before each 10 s slice of a real-time run the fly camera is
  parked 30 m from the thickest cluster of living bots, 8 m up, looking at
  it, so a natural match on a level whose flags the harness does not know is
  measured where the fighting is. The staged fight keeps its El Alamein
  camera.
- `--uncap`: no vsync and no frame-rate limit (not used below; every run here
  sat on the display's 120 Hz cap or well under it).

The harness's per-thread CPU readings come from `/proc` and are empty on
macOS; the CPU profile's self-time shares are the breakdown used here. The
level assets came through `serve_viewer.py`'s remote cache from
mesh.bfstats.io; the harness's `loadS` (75-308 s) is its own `networkidle`
wait on top of that first fetch and the page's asset retries against an API
that was not running, not what a player waits.

Each run is 20 s of real time, 12 bots at skill 0.75 unless the row says
otherwise, audio on, window 1700x1000 unless the row says otherwise.

## Vanilla

| run | window | frames | mean | p50 | p95 | p99 | max | >16.7 ms | >33 ms | draws | meshes | idle |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| El Alamein, 16 bots staged fight | 1280x800, DPR 1 | 2401 | 8.33 | 8.3 | 10.1 | 10.3 | 10.4 | 0 | 0 | 441 | 9,384 | 55 % |
| same, every bot's AI emptied | 1280x800, DPR 1 | 2401 | 8.33 | 8.3 | 10.1 | 10.3 | 10.4 | 0 | 0 | 409 | 9,359 | 65 % |
| same level, no bots | 1280x800, DPR 1 | 2400 | 8.33 | 8.3 | 10.1 | 10.3 | 10.4 | 0 | 0 | 79 | 8,407 | 86 % |
| El Alamein, 12 bots natural | 1700x1000, DPR 1 | 2407 | 8.31 | 8.3 | 9.2 | 9.3 | 9.4 | 0 | 0 | 482 | 9,063 | |
| El Alamein, 12 bots natural | 1700x1000, DPR 2 | 2391 | 8.37 | 8.3 | 9.2 | 9.3 | 83 | 1 | 1 | 511 | 9,351 | |
| El Alamein, 16 bots staged fight | 1700x1000, DPR 2 | 2400 | 8.33 | 8.3 | 9.3 | 9.4 | 9.4 | 0 | 0 | 759 | 9,311 | |

8.33 ms is the 120 Hz display's interval: every vanilla run is vsync-bound.
In the 16-bot fight's profile three.js's own scene walk is the biggest JS
cost (`projectObject` 5.4 %, `updateMatrixWorld` + `multiplyMatrices` 6 %,
about 2.3 ms a frame in all) and the bots' AI is under 0.5 ms a frame
(`nav-search.js` 0.8 %, `static-index.js` 0.7 %). The one 83 ms frame in the
DPR 2 natural match was a single hitch in 20 s.

## Mods

| run | mod, level (placements) | frames | mean | p50 | p95 | p99 | max | >16.7 ms | >33 ms | draws | meshes | heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 12 bots natural, DPR 1 | FHSW Operation Varsity (31,915) | 986 | **20.31** | 16.6 | **58.3** | 108.3 | 116.7 | 450 | 88 | 4,676 | 126,041 | 1.9 GB |
| 12 bots natural, DPR 2 | FHSW Operation Varsity | 1043 | **19.19** | 16.7 | **41.5** | 65.4 | 75.6 | 471 | 102 | 4,681 | 126,052 | 1.3 GB |
| 12 bots natural, DPR 1 | FHSW Omaha Charlie Sector (1,857) | 2400 | 8.34 | 8.3 | 10.1 | 10.3 | 16.6 | 0 | 0 | 425 | 16,468 | 528 MB |
| 12 bots natural, DPR 1 | EoD Operation Linebacker (4,199) | 2397 | 8.35 | 8.3 | 10.1 | 10.3 | 33.3 | 1 | 1 | 117 | 24,245 | 268 MB |
| 12 bots natural, DPR 1 | EoD Khe Sanh (1,938) | 2399 | 8.34 | 8.3 | 10.1 | 10.3 | 16.6 | 0 | 0 | 902 | 15,377 | 421 MB |
| 12 bots, every bot's AI emptied, DPR 1 | FHSW Operation Varsity | 1460 | 13.71 | 15.8 | 18.1 | 18.5 | 50 | 383 | 2 | 4,677 | 126,043 | 1.3 GB |
| no bots, DPR 1 (the harness's fixed camera) | FHSW Operation Varsity | 2055 | 9.74 | 8.4 | 16.8 | 17.6 | 67 | 121 | 1 | 3,579 | 125,830 | 1.1 GB |

The last two rows split the 20 ms frame: the level alone is 9.7 ms (three.js
76 % of the profile, about 7.6 ms a frame of draw submission: the floor),
twelve bots' bodies, vehicles and rigs with their AI emptied add 4 ms and
leave the p95 at 18 ms, and the AI switched back on adds 6.6 ms to the mean
and takes the p95 from 18 ms to 58 ms and the p99 from 18.5 ms to 108 ms.
**The draw is the floor; the bots' path search is the spikes.** On El Alamein
the same AI costs under 0.5 ms a frame: it is the 2048 m level's nav grid
that makes a search expensive, not the bot count.

"Placements" is the registry's `objects` count (`maps/mods/<mod>/maps.json`);
"meshes" is what three.js holds in the scene (every glTF primitive is a
`Mesh`, plus the bots, vehicles and effect pools). FHSW's registry has 140
exported levels; Varsity is the heaviest and Westwall-1945 (24,226),
Fall_of_Singapore (23,953) and ilomantsi-1944 (22,121) are its class. The
median FHSW level is 1,960 placements, the median EoD level 1,359, and EoD's
heaviest is Linebacker at 4,199: nothing in EoD is in Varsity's class.

## Where Varsity's frame goes

From the DPR 1 run's profile, 20.7 s of wall time over 986 frames, the main
thread 0 % idle:

| cost | ms / frame | what |
|---|---|---|
| three.js | 11.6 | `renderBufferDirect` 2.1 (4,676 draws), `projectObject` 1.6 (the walk over 126k objects), fog + common + material uniform refresh 1.9 (a material per draw), `setProgram` 0.6, `intersectsObject` 0.4 (frustum tests), `updateMatrixWorld` + `multiplyMatrices` 1.1, the rest in smaller pieces |
| `nav-search.js` | 4.9 | `findLocalPath` 3.4, its open-list `pop` 0.8, `findStrategicPath` 0.7 (`cellOpen` 0.7 in the DPR 2 run) |
| `(program)` | 0.9 | V8 itself |
| garbage collector | 0.4 | a 1.3-1.9 GB heap |
| `level-statics.js` | 0.4 | `applyVisibility` over the cull list, `lod.update` |
| `static-index.js` | 0.4 | the collider's casts |
| `tree-foliage.js` | 0.35 | `scene.onBeforeRender` |

The DPR 2 run moved nothing in the draw's share, so none of this is fill or
the GPU: the M5 Max's GPU is waiting on a main thread that submits 4,700
draws and visits 126,000 objects a frame in JavaScript.

### What the 126,041 meshes are

The scene glb's own census (`scene.glb`'s JSON chunk): 85,703 nodes, 78,744
of them carrying a mesh, 3,002 distinct meshes, 5,631 primitives, 1,344
materials, 1,038 images. 1,111 meshes are placed once; **72,549 of the
78,744 placements are copies of a mesh placed ten or more times.** The most
copied: `pega_grassbush01` 3,206, `pega_grassbush02` 2,335, the `EU_asp1/2/3`
road pieces 2,801 + 2,743 + 1,500 (each with its collision twin at the same
count), `FHstonewallL_part1` 1,640, `o_sbag_3a` sandbags 1,524, then
`sidewalkL2`, `stecrate1`, `wdfence1`, `RailRoad`, `HedgerowGold1Part1` in
the 1,100-2,400 range. The level is a few hundred shapes stamped seventy
thousand times, and the page draws every stamp inside the draw distance as
its own `Mesh` with its own matrix, frustum test, uniform refresh and draw
call.

### The what-if: the repeated statics out of the draw

In the page, on the same level with the same 12 bots and the camera at the
harness's follow spot: every non-skinned mesh whose `BufferGeometry` is
shared by ten or more meshes was moved to a layer the camera does not draw
(which is what one batched draw per geometry would cost, near nothing), and
rAF intervals sampled for 10 s, control first, then the change, then the
control again:

| | moved | left | draws | tris | mean | p50 | p95 | p99 | max | >16.7 | >33 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| control | 0 | 126,014 | 4,545 | 334k | 17.08 | 16.7 | 33.4 | 41.8 | 50.2 | 205 / 586 | 41 |
| shared-by-10+ undrawn | 115,528 | 10,486 | 256 | 98k | **9.21** | 8.3 | **16.6** | 25.2 | 41.8 | 40 / 1087 | 7 |
| control again | 0 | 126,014 | 4,541 | 334k | 17.73 | 16.7 | 33.5 | 43.1 | 66.7 | 204 / 565 | 47 |

(The browser pane was hidden for this, which throttles its page; the ratio is
the finding, not the absolute, and it agrees with the harness's 20 ms frame.)
The frame halves and the p95 lands on the 60 Hz line. What is left (9 ms) is
the bots' path search, the 10,486 one-off meshes, the vehicles and the sim,
so instancing alone does not reach the 120 Hz cap on this level; it takes the
frame from "sluggish" to "fine" and leaves the path search as the next cost.

## Why a browser build is slower than the retail client

Nothing here is a mystery of the platform; each is a specific thing the
retail engine does not pay for:

1. **One thread does everything.** The world step, the bots' sensing and
   path search, the bodies, the collider and the whole draw submission run on
   the page's main thread, in the one rAF callback. Retail's renderer and
   its AI are C++ on a CPU with nothing else to do; its draw submission is
   a few hundred calls to a driver, not several thousand JavaScript calls
   through ANGLE to Metal.
2. **A general scene graph, per object.** three.js composes a world matrix,
   runs a frustum test, refreshes a material's uniforms and issues a draw
   for every `Mesh` the camera can see. That is 2-3 µs an object on this
   machine, which is nothing at 9,000 objects (vanilla, 2.3 ms) and
   everything at 126,000 (Varsity, 11.6 ms). Retail draws a level's repeated
   statics from vertex buffers it built once, with no per-object JavaScript.
3. **Bot AI that does a full pass per bot per tick.** The engine's AI is a
   time budget shared by all its bots (ledger AI-6: more bots means each
   senses and plans less often); ours searches every bot's route legs every
   tick it needs one, up to four legs of 8,192 node expansions each
   (`bot-route.js` `extendRoute`), and on a 2048 m level with a 512x512 nav
   grid that is 5 ms a frame for 12 bots.
4. **Memory.** The loader keeps the glTF document and a JavaScript object
   per node; Varsity's page holds a 1.3-1.9 GB heap, and the collector's
   pauses are the p99.
5. **Not fill, not the GPU, not the display.** DPR 2 moved nothing; MSAA and
   pixel ratio were a 20 % lever on the Iris Xe and are not measurable here.

## The levers, in order

*Added 2026-11-06: levers 1 and 2 were built the same night.
[batched-level-statics](../batched-level-statics/README.md) draws the
repeated statics as batches and [bot-path-budget](../bot-path-budget/README.md)
slices the bots' path search; their READMEs carry the after numbers
(Varsity, 12 bots: 20 ms mean / 58 ms p95 to about 9 ms / 16 ms).*

1. **Batch the level's repeated statics.** three r169 ships `BatchedMesh`
   (per-instance visibility, per-instance frustum culling, one draw per
   material): at load, every static placement whose mesh is shared by N or
   more placements goes into one batch per (geometry, material), and the
   page's per-placement features keep working through the batch's
   per-instance API: `applyVisibility`'s range cull becomes
   `setVisibleAt`, `textureFade` and `updateAlphaLod` need a per-instance
   attribute or a batch per rung, `bindDynamicShading` is already per
   material. The bound is the table above: Varsity 17 ms to 9 ms, 4,500
   draws to a few hundred. The same work done in the bake (`bf42/gltf.py`
   writing `EXT_mesh_gpu_instancing`, which three's loader turns into
   `InstancedMesh`) saves the loader's heap as well but means a full
   re-bake of every tree (`features/level-bake-layers`). This was the open
   item in [mesh-viewer-performance](../mesh-viewer-performance/README.md)
   ("needs a decision before anyone starts"); the decision now has numbers.
2. **A path-search budget per tick, shared by all bots** (AI-6). A cap on
   total node expansions a tick, round-robin over the bots that need a leg,
   with the ones that miss carrying their search to the next tick as
   `r.widen` already does. 5 ms a frame on Varsity, under 0.5 on El Alamein;
   it changes a seeded match's trace, so it is a design decision like the
   referee's cadence was.
3. **The loader's heap.** After batching, the per-node objects for 115,000
   placements can be dropped once their matrices are in the batch.
4. **Keep measuring in real sessions** with `console.showStats 1` (below):
   this pass found the problem on levels the harness had to be pointed at,
   and Skandia's own sessions will say which levels and which moments are
   actually bad.

## The in-game readout

`console.showStats 1` in the `~` console (`console.showfps 1`, or the
retail alias `fps 1`, gives the plain rate) now prints, under the draw calls
and triangles:

```
frame ms  p50 8.3  p95 9.3  max 12.1
page ms  3.9  = sim 1.1  present 0.4  draw 2.2  hud 0.2
```

`frame ms` is the display's frame interval over the last second (the p95 and
the worst are what "laggy" is; the mean fps hides them). `page ms` is the
page's own callback, split by the phases of `frame()` in `map.html`
(`frameCost`): `sim` is the devices and the world step with the bots' pass,
`present` the cameras and the world's presentation, `draw` the 3D passes and
the 2D surfaces, `hud` the HUD and the shell. The gap between `page` and
`frame` is the browser's: vsync, the compositor, or a GPU still busy with the
last frame, which shows up as `draw` growing while `sim` does not. The phase
costs are smoothed over about ten frames so the digits hold still.

The readout reads `frameCost` through the console's `get()`, so a page
without it (a test's stand-in) prints the old two lines.

## Changed files

- `tools/bf1942-models/viewer/map.html`: `frameCost`, timed in `frame()`
  and offered to the console as `frameCost`.
- `tools/bf1942-models/viewer/console-commands.js`: the two new readout
  lines under `showStats`.
- `tools/bf1942-models/tests/perf/botfight.cjs`: `--channel`, `--dpr`,
  `--mod`, `--follow`, `--uncap`.
- `tools/bf1942-models/tests/test_replay_resilience.py`: `frameCost` among
  the stand-ins the page's `frame` is run over.
- `tools/bf1942-models/extract_models.py`: `available_bytes()` falls back
  to `vm_stat` on macOS. Without it every extractor's job cap read "no
  memory free" on a Mac and ran one worker, and
  `test_viewmodel_level_skin.test_workers_decode_the_same_bytes` failed.

## Verification

`./scripts/verify.sh --skip-e2e` selects 31 tool tests for `map.html` and
`console-commands.js` and runs the whole tool suite with them (811 tests).
The resilience tests failed on the first run because the stand-in frame had
no `frameCost`; the stand-in fixed it. The skin-cache worker test failed on
the macOS memory probe; the `vm_stat` fallback fixed it. One pre-existing
error remains when `test_viewmodel_level_skin.py` is run on its own
(`test_a_cutout_texture_is_baked_as_mask`, `KeyError: 'alphaMode'`); it
passes in the full suite, so it is order-dependent and not this pass's.

The runs' records (`summary.json`, `.cpuprofile`, a frame of each fight) are
in the session scratchpad, not the repo; the tables above are the record.
