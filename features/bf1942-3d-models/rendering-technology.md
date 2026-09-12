# Rendering technology: how close can a browser get, and is WebAssembly worth it

The question was whether in-game parity needs a technology pivot — WebGPU, a
WASM renderer, something native. The measurements say no. **Stay on Three.js
over WebGL2. Spend the effort on shader stages and payload, not on a runtime.**

The number that decides it: the worst frame the current Tobruk scene can
produce — the entire 4096 m world in the frustum, 2,578 draw calls, 692k
triangles — costs **9.7 ms of GPU time on a 2022 laptop iGPU** (Intel Iris Xe,
the low end of what visitors bring). The median flythrough frame costs 2.4 ms
GPU and 1.5 ms CPU against a 16.7 ms budget at 60 fps. Rendering is not the
bottleneck, so a faster language for the rendering loop buys nothing: WASM
accelerates CPU-side JS, which is 1.5 ms of a 16.7 ms frame. The actual gap to
in-game parity is (a) shader stages that are cheap to run and merely unwritten
— one was measured below at +0.3–0.5 ms — and (b) payload: 66 MB for one level,
which a format pass cuts to 9.3 MB with no pipeline redesign.

Everything below is measured on this machine unless marked otherwise. Hardware:
Intel Iris Xe (ADL GT2) via ANGLE/Mesa GLES 3.2, Chrome 148, WebGL2, GPU timing
via `EXT_disjoint_timer_query_webgl2`. Headless caveat: the pane was not
composited, so frames were driven manually through `renderer.render` — numbers
exclude compositor overhead and vsync, which is the correct basis for
comparing render cost against the frame budget.

## Measured baseline (Tobruk, commit `4e13cde` viewer + existing extracts)

Scene composition, read straight from the glb (script in the appendix):

| | Tobruk | Wake | Bocage |
|---|---|---|---|
| file size | 66.2 MB | 36.3 MB | 88.3 MB |
| of which PNG textures | 54.2 MB | 30.4 MB | 73.0 MB |
| geometry bytes | 11.2 MB | 5.3 MB | 14.5 MB |
| images | 184 (94 at 512x512) | 150 | 276 |
| est. GPU texture bytes, RGBA8+mips | 153 MB | 112 MB | 227 MB |
| nodes / mesh instances | 1,427 / 1,249 | 1,394 / 1,126 | 889 / 697 |
| primitives if everything drew | 2,464 | 2,351 | 1,623 |
| triangles (terrain + objects) | 685k | 363k | 661k |

Runtime, Tobruk, 1280x800, 8 compass yaws from the spawn camera, median of 64
frames (GPU = timer query, CPU = wall time around `renderer.render`):

| Scenario | draw calls (med/max) | tris med | CPU med | GPU med | GPU p95 |
|---|---|---|---|---|---|
| Defaults: 700 m draw limit, vehicles off | 284 / 884 | 142k | 1.5 ms | 2.36 ms | 5.6 ms |
| Vehicles on | 628 / 1,415 | 162k | 2.0 ms | 3.54 ms | 6.1 ms |
| Entire map + vehicles | 630 / 1,424 | 179k | 1.9 ms | 2.66 ms | 7.2 ms |
| Entire map at 640x400 | 630 | 179k | 1.8 ms | 2.07 ms | 6.9 ms |
| Entire map at 3840x2160 | 643 | 198k | 2.9 ms | 3.98 ms | 6.9 ms |
| Bird's eye, whole world in frustum (worst frame) | 2,578 | 692k | 5.3 ms | 9.7 ms | — |
| + object lightmaps on 393 meshes (see below) | 630 | 179k | 2.3 ms | 3.14 ms | 7.5 ms |

Other numbers: load = 66.2 MB fetch + **332 ms** parse/scene-build
(GLTFLoader); JS heap 40 MB; 186 textures and 454 geometries resident after a
full sweep; 11 shader programs; the per-frame distance cull over ~800 roots
rounds to 0 ms.

### Where the frame budget goes — and does not

The crux question was whether the bottleneck is CPU (draw calls, JS), GPU fill
rate, or bandwidth, because a WASM port addresses only the first.

- **Not fill rate.** 32x the pixels (640x400 to 3840x2160) moves GPU time 2.07
  to 3.98 ms. The fragment work is nearly free; there is room for several more
  texture stages per fragment before it shows.
- **Not CPU.** The whole JS side — culling, matrix updates, draw submission for
  630 calls — is 1.8–2.9 ms. The worst measured frame spent 5.3 ms CPU at
  2,578 calls. That is the ceiling WASM could attack, and it fits inside the
  budget three times over.
- **Not GPU otherwise.** 9.7 ms worst case on an iGPU, ~2.4 ms typical.
- **Bandwidth is the real cost.** 66.3 MB before the first frame. At 50 Mbps
  that is 10.6 s staring at a black canvas; at 25 Mbps, 21 s. Parse is 0.3 s —
  the wait is the wire, and no renderer choice changes it. (Phones and weak
  GPUs scale these frame times up maybe 2–4x — estimated, not measured — which
  still clears 60 fps for the default view.)

## Parity is authoring, not capability

BF1942 is a DirectX 8.1, fixed-function-era engine: base texture, then
lightmap, detail, and environment stages multiplied/added in a cascade of at
most a handful of texture ops. WebGL2 guarantees 16 fragment texture units and
arbitrary shader arithmetic; every stage the engine ever ran is expressible in
a Three.js `onBeforeCompile` patch (which `map.html` already uses for
lightmaps) or a `ShaderMaterial`. Nothing in the engine's material model is out
of reach of the current stack — the README's "no PBR equivalent" is a statement
about the glTF *export format*, not about what the viewer can render once the
stage data is carried in extras the way `userData.lightmap` already is.

Measured proof that a stage is cheap: binding the object-lightmap multiply on
393 meshes (44 unique lightmap textures, 827 KB) moved the default-scenario GPU
median from 2.36 to 2.69 ms and the entire-map one from 2.66 to 3.14 ms.
**A full extra texture stage across the visible set costs ~0.3–0.5 ms.** Detail
and environment stages are the same shape of work; terrain detail is already
baked at export.

Two findings the parity work should pick up:

- **The lightmap pass has never run.** `bindLightmaps` requires
  `obj.isMesh`, but on all three extracted maps every `userData.lightmap`
  extra sits on a `Group` — the multi-material-part-becomes-a-Group trap the
  README already documents for `setAnimatedTextureSpeed`. Measured: Tobruk 44
  extras, 0 on meshes; Bocage 38/0; Wake 40/0; lightmap HTTP requests on load:
  0, 0 and 0. Descending one level to the Group's mesh children (as the
  measurement harness did) binds all 393 meshes that carry `uv1`.
- The viewer under-draws nothing else structurally: sky cubemap, linear fog,
  water plane and distance cull all function. With vanilla `texture.rfa` now
  restored on the install, the texture-coverage sections of the README (6.2%,
  `--texture-fallback`) are stale, and the remaining visual gap is the stage
  list above plus whatever the parallel map-parity pass finds from the inside.

## Payload: the 7x that is lying on the table

Measured with `gltf-transform` on Tobruk's `scene.glb`:

| Variant | size | worst-case draws | notes |
|---|---|---|---|
| baseline (PNG textures) | 66.2 MB | 2,464 | |
| WebP textures only | 18.7 MB | 2,464 | lossless pipeline change; GLTFLoader r169 already decodes `EXT_texture_webp` |
| + meshopt geometry | 9.3 MB | 2,464 | needs `MeshoptDecoder` vendored (~30 KB) |
| `optimize` join/instance, no simplify, WebP | 19.1 MB | **261** | loads in the stock viewer today; measured below |
| full `optimize` (adds lossy simplify) | 9.5 MB | 261 | 685k -> 329k tris; visual review needed |

The joined WebP variant was loaded into the running viewer and re-measured:
**141–145 draw calls median, 0.7 ms CPU, 1.7–2.1 ms GPU, 389 ms parse.** That
is the draw-call headroom answer: if scenes ever grow 10x, batching inside the
current stack already covers it — no API change required. (Culling granularity
coarsens from 800 roots to 135; acceptable for a flythrough, worth a look
before adopting wholesale.)

KTX2/Basis (ETC1S) would also cut *GPU* texture memory roughly 8x (153 MB to
~20 MB, staying compressed on-device) and is the right long-term texture
format; not measured here because the `ktx` encoder binary is not on this
machine — transfer size lands in the same range as WebP. Estimated, not
measured.

One serving fact to carry into go-live, but not before:

- **`map.html` and `index.html` cache-bust every asset fetch**
  (`?t=${Date.now()}`), which defeats the browser cache *and* any edge cache
  keyed on the full URL. That is the right behaviour while iterating locally —
  a stale `.glb` after a re-extract is a worse bug than a re-download — but it
  makes the nginx `max-age=300, s-maxage=86400` dead letter the moment the site
  is public. Key the URL on the extractor's content hash instead of the clock
  before going live, so re-extracts still bust and unchanged assets still cache.

These figures are all local, and deliberately so: **mesh.bfstats.io is not live
yet** — it resolves to nothing (A, AAAA and CNAME all NODATA, checked
2026-09-12) because the DNS record has not been created, not because anything
broke. The mesh-site README's go-live runbook has been corrected to say so.
Nothing here was measured against production, and nothing needs to be: payload
and frame cost are properties of the scene and the client, so the numbers move
to the cluster unchanged. The one figure that will not carry over is
time-to-first-frame, which gains a real network path.

## The alternatives, in order of disruption

**1. Three.js + custom shader stages (recommended).** Buys full DX8-era
material parity at a measured ~0.5 ms per stage; costs authoring effort only;
changes nothing about deployment (same static files behind the 64Mi nginx,
commit `122a47a`'s measured serving budget still holds — the client keeps doing
every expensive thing). The vendored three r169 (2024-09-26) still supports
everything used; upgrading to current r186 (2026-09-08, verified against the
npm registry) is optional hygiene, not a prerequisite.

**2. WebGPU via three's `WebGPURenderer`.** What it buys is lower per-draw CPU
overhead and compute shaders. Measured per-draw CPU cost today is 1.5–5.3 ms a
frame; there is nothing to save, and a 2002 fixed-function engine has no
compute workload. Support (gpuweb implementation-status, checked Sept 2026):
Chromium 113+ desktop / 121+ Android, but Linux only on Intel Gen12+ (144+) and
NVIDIA-Wayland (147+); Firefox 141+ Windows, 145–147 macOS, Linux still
nightly; Safari only on macOS/iOS 26. WebGL2 is universal; WebGPU still is
not. Migration would also force the `onBeforeCompile` patches to TSL (node
materials), i.e. rewriting exactly the shader work option 1 produces. Wrong
order: write the stages first; they port to TSL later if a reason appears.

**3. WASM renderer (Rust+wgpu, C++ +Emscripten, Bevy).** Addresses the 1.5 ms
CPU slice of a 16.7 ms budget, ships a 2–20 MB runtime on top of the assets it
was supposed to make cheaper, reimplements glTF loading, culling and the
material system from scratch, and hits the same GPU through the same browser
APIs — the fidelity ceiling is identical to option 1 by construction.
Deployment stays static files, but the build chain grows a toolchain the repo
does not have. No existing Refractor renderer exists to borrow: the closest
project, BattlefieldRespawn (C++/OpenGL, Refractor 2 targeted), is pre-alpha
with no terrain rendering; community tooling (BfMeshView, BGA, the Blender
add-on) is import/export, not rendering. This repo's own format knowledge is
already ahead of what could be imported.

**4. Native viewer or server-side rendering.** A native viewer abandons the
one property that makes mesh.bfstats.io worth having — a shareable URL.
Server-side rendering is arithmetic: the production node is 4 cores / 7741 Mi
with 0.81 Gi headroom and no GPU; software-rasterizing 685k-triangle scenes
per viewer on shared CPU is a non-starter, and pre-baked video/stills answer a
different product question than a flythrough.

## Recommendation, and what would flip it

Stay on Three.js/WebGL2. In order of value per effort:

1. Fix the lightmap Group/Mesh binding bug (the pass is written, it just never
   fires) — belongs to the in-flight map-parity work.
2. Add the remaining stages (detail, env) the same way; ~0.5 ms each,
   measured.
3. Re-encode payloads: WebP now (7x, zero new dependencies), KTX2 when the
   encoder is available; vendor `MeshoptDecoder` for the geometry half. Worth
   doing now even though the site is local-only — 66 MB is a slow reload while
   iterating too, and the win is larger than any other single change here.
4. At go-live only: swap clock-based cache-busting for a content hash. Leave it
   alone while the site is local.

Flip conditions, stated so a future decision has a trigger:

- **To WebGPU** (still inside three.js): if scene draw calls grow past ~10k
  *after* join/instancing — measured headroom says that is 40x today's median
  — or if a feature genuinely needs compute (GPU terrain clipmaps for all 20
  maps streamed at once, large-scale animation). Revisit once Firefox Linux
  ships and the Safari 26 floor covers the audience.
- **To WASM**: only if the project pivots from *viewing* to *simulating* —
  physics, soldiers, netcode in the browser. Then a Rust/C++ core earns its
  runtime, and it should still present through WebGPU.
- **Away from the browser**: no measured path leads there.

## Appendix: instrumentation, so the numbers can be re-taken

Offline composition: `analyze_glb.py` (scratch) parses the glb container
directly — JSON chunk for node/mesh/material/image counts, PNG/JPEG headers in
the bin chunk for dimensions, `w*h*4*4/3` for resident RGBA8+mip bytes,
primitives summed over node->mesh references for worst-case draw calls.

Runtime: a scratch copy of `map.html` (assets from the existing extracts;
viewer HTML unmodified except one appended block) exposing
`window.__bench = { renderer, scene, camera, look, opts, applyVisibility,
applyFar, applyFog, placeCamera, show, manifest }`. The harness then drives
frames manually — which also works headless where rAF never fires:

- per frame: `gl.createQuery()` + `beginQuery(TIME_ELAPSED_EXT)` around
  `renderer.render`, resolved later via `QUERY_RESULT_AVAILABLE` polling with
  a `GPU_DISJOINT_EXT` check; `performance.now()` around the same call for
  CPU; `renderer.info.render.{calls,triangles}` read after each render.
- sampling: 8 camera yaws at the spawn point, 10 frames each, first 2
  discarded as upload warmup; the bird's-eye worst case is the whole world in
  frustum from 500 m over map centre.
- bottleneck attribution: rerun at 640x400 / 2560x1600 / 3840x2160 for fill
  rate; toggle vehicles and entire-map for draw-call scaling; CPU vs GPU split
  from the two timers.
- payload variants: `npx @gltf-transform/cli` — `webp`, `meshopt`, and
  `optimize --compress false --texture-compress webp --simplify false` for the
  join-without-loss variant, verified loadable by pointing `__bench.show()` at
  the staged file.

Sources for external claims: WebGPU status from the
[gpuweb Implementation-Status wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status);
three.js versions/dates verified against the
[npm registry](https://registry.npmjs.org/three) (r169 2024-09-26, r186
2026-09-08); prior-art survey via
[BattlefieldRespawn](https://github.com/rigred/BattlefieldRespawn),
[BGA](https://github.com/yann-papouin/bga) and the BF1942 Blender add-on.
Everything else in this document is a local measurement, reproducible with the
appendix above.
