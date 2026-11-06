# Repeated level statics drawn as batches

FHSW Operation Varsity places 78,744 meshes from 3,002 distinct ones, and
72,549 of those placements are copies of a mesh placed ten or more times:
grass bushes, road segments, stone walls, sandbags, fences, crates,
hedgerows. The page drew every stamp inside the draw distance as its own
`Mesh` with its own frustum test, uniform refresh and draw call, 4,700
draws and 11 ms of a 20 ms frame with twelve bots; a what-if that took the
repeated statics out of the draw halved the frame
([mod-level-frame-cost](../mod-level-frame-cost/README.md)). Retail draws
a level's statics from vertex buffers it built once. This pass (2026-11-06)
draws them as batches.

## The design

`tools/bf1942-models/viewer/level-batching.js`, called by
`statics.batchStatics` (`level-statics.js`) from `show()` (`level-load.js`)
after `indexScene` has tagged, lifted and frozen the placements and the
terrain pass has read the scene for the collider.

Every placement (a static child of the level root, a `cull` entry) whose
meshes all qualify has them put into one `THREE.BatchedMesh` (three r169)
per material and geometry layout: one multi-draw per material, the
instances' matrices in a texture. The rules the page kept per placement or
per mesh are kept per instance:

| rule | was | is |
|---|---|---|
| draw-distance cull | `applyVisibility`'s sphere test writes `.visible` | the same test over flat arrays, `setVisibleAt` |
| small-mesh cull | `buildSmallMeshCull`'s `d^2 > a x fov + b` on the part | the same terms per instance |
| LOD chain | `liftLods`' wrapper picks a rung per frame (`selectLod` on the part's cull spec, else the rungs' authored distances) | every rung's meshes are instances; the chosen rung's are shown |
| alpha LOD | `updateAlphaLod` flips a material between blended-near and cut-far | the far state (a cut, no order between faces) is the instance; the near state stays the mesh itself, shown inside its reach, because three sorts a blended mesh against the trees' cards mesh by mesh and a batch sorts as one object |
| terrain shade | `bindTerrainShade` sets the mesh's `bfShade` uniform | a per-instance colour; `bindDynamicShading`'s combine multiplies it where the uniform went (`#ifdef USE_BATCHING_COLOR`) |
| the normal | `vBfNormal = mat3(modelMatrix) * normal` | `mat3(batchingMatrix)` first, under `#ifdef USE_BATCHING` |

The placement's own node stays in the tree: hidden when nothing of it is
drawn as a mesh any more (its collision twin is what the collider indexed,
and `projectObject` skips a hidden subtree), else kept with its batched
meshes hidden one by one so a near alpha-LOD mesh can still draw under it.
It leaves the cull list and the small-mesh list. The batches hang on the
level root, frozen like it, and go with it on a level switch.

Two things in three r169 that cost a program lookup per batch per frame,
found in the profile and answered here: `setProgram` reads
`object.colorTexture`, which `BatchedMesh` never defines, so a colourless
batch looked re-keyed every frame (the batch now answers the property);
and a transparent two-sided material is drawn in two passes, each marking
the material changed, so a cut far batch is `forceSinglePass`.

What stays a `Mesh`: a placement that moves (bones, cloth, a rig, a clip's
target), a tree (`tree-foliage.js` rebinds those by material name: the
sprite cards face the camera from a vertex shader and the far card is an
impostor the tree's own hook swaps in), a texture-fade plane, a lightmapped
mesh (the other combine), an envmapped one (its reflection reads the mesh's
own matrix), an effect, a kinded node (water, a flag cloth, a control
point), a mesh with a material array, and a placement any of whose
geometries fewer than `minShare` (10) meshes share. `?nobatch` leaves
everything a `Mesh`, `?batch=N` sets the share, and `?shots` pages offer
`window.__batching()` for the counts.

Batches are not frustum-culled per instance (`perObjectFrustumCulled`
false: that is a JavaScript loop over every instance a frame, which is what
this pass is removing) and not sorted, except a blended near batch, which
keeps three's back-to-front order over the few instances it shows. The
draw-distance cull bounds what the GPU is handed.

## Measured

What Varsity batches (`?shots`, `window.__batching()`): 20,288 of 20,768
qualifying placements, 48,701 instances in 228 batches (228 material and
layout groups), 3,839 LOD chains among them. Left as meshes: 9,744 tree
placements, 3,930 chains with a blocked rung (a lightmapped or tree part),
1,038 lightmapped, 480 under the share, 213 envmapped, 62 texture-fade
planes, 64 kinded, 26 that move, 21 alpha-LOD chains. El Alamein batches
253 placements (996 instances, 7 batches): its statics are mostly one-offs
and trees, which is why vanilla never had the problem.

Browser (the `botfight.cjs` harness, Chrome 157 on the M5 Max, 12 bots in a
natural match, the camera following the bots, 20 s, 1700x1000, the
[bot-path-budget](../bot-path-budget/README.md) fixes in every row):

| Varsity, 12 bots | frames | mean | p50 | p95 | p99 | max | >16.7 | >33 | draws |
|---|---|---|---|---|---|---|---|---|---|
| unbatched | 1216 | 16.47 | 16.6 | 25.4 | 26.6 | 49.9 | 529 | 3 | 4,679 |
| plain placements batched | 2113 | 9.47 | 8.4 | 16.7 | 18.2 | 50 | 100 | 2 | 1,631 |
| LOD chains too | 2143 | 9.34 | 8.4 | 16.7 | 18.2 | 26.8 | 100 | 0 | 1,494 |
| the program-lookup fix | 2318 | 8.64 | 8.3 | 10.3 | 17.0 | 25.7 | 37 | 0 | 1,500 |
| per-instance frustum test, wrapper fix | 2240 | 8.93 | 8.3 | 16.3 | 18.0 | 33.4 | 68 | 1 | 1,341 |
| **the near state as the mesh (shipped)** | 2187 | **9.16** | **8.3** | **16.6** | 18.2 | 66.6 | 78 | 1 | 1,464 |

Against the 20.3 ms mean / 58 ms p95 / 88 frames over 33 ms the pass
started from ([mod-level-frame-cost](../mod-level-frame-cost/README.md)),
the frame's p50 is the 120 Hz line and its p95 the 60 Hz line. The runs
after the fourth row differ in what the bots did, not in the batches (the
camera follows them); the one 66 ms frame in the last run is a single
hitch. In the shipped profile three.js is 57 % of the main thread
(`projectObject` 0.7 ms a frame over the 50,000 unbatched objects,
`updateMatrixWorld` 0.7 for the bots' rigs, `renderBufferDirect` 0.6 for
1,464 draws), the bots' path search 11 % and the trees' hook 3 %.

Pixel parity (`parity.cjs`, a scratch Playwright script: the same level
loaded with `?nobatch` and batched, the fly camera at the same spots,
`__renderOnce` eight times, the canvases compared in a blank page):

| level, spot | calls | pixels differing at all | by more than 8 levels | worst |
|---|---|---|---|---|
| Varsity, by the bot cluster (grass, walls, trees) | 4,401 to 1,286 | 0.30 % | 248 (0.024 %) | 89 |
| Varsity, open ground | 49 to 49 | 20.8 % | 1 | 9 |
| Varsity, a road | 160 to 188 | 5.5 % | 109 (0.011 %) | 28 |
| Varsity, a village edge | 2,449 to 555 | 0.21 % | 108 (0.011 %) | 41 |
| El Alamein, the depot | 77 to 63 | 0.44 % | 265 (0.026 %) | 146 |
| El Alamein, two other spots | 41 to 40, 17 to 17 | 0 | 0 | 0 |

The wide, shallow differences (a fifth of the pixels by at most 9 levels
on open ground) are the normal's two matrix multiplies rounding
differently from one; the few hundred pixels past 8 levels are the order
of blended pixels at silhouettes, where a batch's far cut and a mesh's
near blend meet. Two earlier states of the pass were caught by the same
captures and fixed: the hidden rungs of chains `liftLods` keeps unlifted
were being instanced (extra grass tufts), and a blended near batch sorted
as one object drew over the trees' cards (12,970 pixels past 8 levels at
the first spot, now 248).

Plain-mesh counts do not compare directly with batched ones: three draws a
transparent two-sided mesh in two passes (back faces, then front) and
counts both, and a far batch is one pass.

## Verification

- The route the numbers took is above: every row is a `botfight.cjs` run
  on the same level with the same bots, and every parity row a capture
  pair; the harness, the captures and the profiles are in the session
  scratchpad, the tables here are the record.
- `./scripts/verify.sh --skip-e2e` selects 4,297 tool tests for the viewer
  files this pass touches. `test_terrain_shade.mjs` pinned the shading
  combine's text and now pins the batched form of it too. The failures
  left on this Mac are environmental, as recorded in
  [mod-level-frame-cost](../mod-level-frame-cost/README.md), plus three
  node harnesses (`test_load_settle_terrain`, `test_video_settings`,
  `test_ticket_blink`) that resolve the `three` package or a local
  `viewer/maps` tree, neither of which this checkout has.
- `?nobatch` is the control; `window.__batching()` the counts;
  `statics.batching.debug(x, z, radius)` what the frame decided for the
  instances near a point.

## Open

- **Trees** (9,744 placements on Varsity): the sprite cards are a vertex
  shader of their own, the far card an impostor the tree's hook swaps in,
  and the dissolve between them a per-tree opacity; batching them means
  teaching that module about instances. They are the largest group left,
  and the hook's own loop over every tree is 0.3 ms a frame.
- **Chains with one blocked rung** (3,930) keep every rung a mesh; a rung
  that is lightmapped or a tree part could leave the chain's other rungs
  batched.
- **The heap** (1.3 GB on Varsity): the hidden placements' nodes and
  materials are still held; what a batch has copied could be let go.
- **A shaded batch** (`setColorAt`) is untested against a level with a
  `terrainShade` block: Varsity and El Alamein have none, so `shaded` reads
  0 in every report here.
