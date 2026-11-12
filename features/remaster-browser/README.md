# Remaster mode for the browser game (`?remaster`)

Status: first pass built 2026-11-12 on the throwaway branch
`claude/remaster-browser-c4f0dd`, as a what-if. It is not for main. The same
sim, levels, models and sounds, shown the way a game made today would look
and sound. Without `?remaster` the page is the retail-parity build it always
was, so the two can be compared on the same level from the same camera.

Audio has its own notes: [AUDIO.md](AUDIO.md).

## Plan and progress

| Step | State |
|---|---|
| `?remaster` switches three to r186's WebGPU build through the import map, default path untouched | done |
| WebGPU renderer up under the whole game: shims for the WebGL-only calls, warm-up, node frame | done |
| Lit materials: terrain, lightmapped statics, vehicles and soldiers | done |
| Real-time cascaded sun shadows | done (3 cascades, culled by reach, staggered) |
| Ambient occlusion (GTAO), HDR, tone mapping, SMAA | done |
| Physical sky, calibrated to the level and blended into its haze | done |
| Height fog driven by `fogColor` / `fogStart` / `fogEnd` | done |
| Water from the level's own water words and depth bake | done |
| Foliage: leaf sprites, billboards and wind as node graphs | done |
| Bloom on muzzle flashes, explosions and tracers | done |
| Audio: HRTF, reverb by surroundings, occlusion, air absorption, the crack before the report | done ([AUDIO.md](AUDIO.md)) |
| Generated normal and roughness maps from `viewer/textures/` | not started |
| Two levels with before/after captures and frame times | done: Wake, Battle of Britain |

## How to look at it

```
map.html?map=wake&remaster
map.html?map=wake&remaster=noao,nobloom      # parts off, comma-separated
```

The parts that can be turned off: `noshadow`, `noao`, `nobloom`, `nosmaa`,
`nopost` (no post chain at all), `nofog`, `nowater`, `noglow` (effects at
their texture brightness), `nostagger` (every cascade every frame),
`notonemap`. Tuning knobs: `&exposure=`, `&cascades=`, `&shadowFar=`,
`&shadowSize=`, `&leafReach=`, `&solidReach=`, `&glow=`, `&gpuTiming`.

The before/after harness, one headless Google Chrome with WebGPU on the Mac's
GPU (`apple metal-3`), both modes, named views per level, frame times and
captures:

```
cd tools/bf1942-models
python3 serve_viewer.py 5390 &
node tests/perf/remastershot.mjs --map wake --out /tmp/shots --modes 'retail;remaster' --frames 60
node tests/perf/remastershot.mjs --map wake --views bunker --effect 'BombBig_Expl@1328,107.5,-1192@4'
```

It stops the page's own animation loop and steps frames with `__renderOnce`,
waiting for the GPU queue after each one, so a frame time is CPU and GPU
together.

## Before and after

Same camera, same level, retail on the left, remaster on the right, 1600 x 900.

Wake, the airfield ridge across the lagoon:
![Wake airfield](shots/wake_airfield.jpg)

Wake, the supply bunker:
![Wake bunker](shots/wake_bunker.jpg)

Wake, the beach below the hill (the backlit hill is worse, see below):
![Wake beach](shots/wake_beach.jpg)

Battle of Britain, the Allied base. The tower and the posts throw real shadows:
![Battle of Britain base](shots/bob_base.jpg)

Battle of Britain, the bridge over the valley. The girders shadow the deck:
![Battle of Britain approach](shots/bob_approach.jpg)

Battle of Britain, the airfield and the overview:
![Battle of Britain airfield](shots/bob_airfield.jpg)
![Battle of Britain overview](shots/bob_overview.jpg)

An explosion (`BombBig_Expl`, 4/30 s in) and a muzzle flash (`e_MuzzHeavy`):
![Explosion](shots/wake_explosion.jpg)
![Muzzle flash](shots/wake_muzzle_flash.jpg)

Full-size remaster frames: [Wake](shots/wake_airfield_remaster_full.jpg),
[Battle of Britain](shots/bob_base_remaster_full.jpg).

## Frame time on this M5 Max

1600 x 900, device pixel ratio 1, no bots, median of 60 frames, CPU and GPU
together (`tests/perf/remastershot.mjs`). Before the change the same views
drew in the same times as "retail" here (the retail column is the default
path on this branch).

| Level | View | Retail | Remaster | Remaster CPU |
|---|---|---|---|---|
| Wake | airfield | 7.2 ms | 20.1 ms | 14.5 ms |
| Wake | beach | 6.4 ms | 16.0 ms | 10.8 ms |
| Wake | hill (aerial) | 5.6 ms | 13.3 ms | 8.9 ms |
| Wake | bunker | 4.6 ms | 16.2 ms | 12.2 ms |
| Battle of Britain | base | 5.5 ms | 22.5 ms | 17.8 ms |
| Battle of Britain | approach | 6.7 ms | 19.3 ms | 13.6 ms |
| Battle of Britain | airfield | 4.8 ms | 20.5 ms | 16.7 ms |
| Battle of Britain | overview | 5.7 ms | 11.7 ms | 7.4 ms |

Where it goes (one run each, about 2 ms of noise between runs):

| | Wake airfield | Battle of Britain base |
|---|---|---|
| everything | 17.0 ms | 19.9 ms |
| `noshadow` | 11.3 ms | 10.2 ms |
| `noao` | 16.3 ms | 18.6 ms |
| `nobloom` | 18.2 ms | 20.0 ms |
| `nopost` (no AO, bloom, SMAA) | 15.8 ms | 17.4 ms |
| `nofog` / `nowater` | 19.1 / 17.5 ms | |

So: the shadows are 6 to 10 ms, almost all of it CPU (three's WebGPU
renderer walks the scene once per cascade and pays per draw in JS), the post
chain 1 to 2.5 ms, the rest is the WebGPU renderer's own overhead over r169's
WebGL one (about 4 to 5 ms of CPU with shadows off). Every view stays under
the 33 ms of a 30 fps frame and most under 16.7 ms; none of it is GPU-bound.

What took the shadows from 140 ms to this, in order:

1. The harness measured the page's animation loop, not its own frames,
   until three's node frame was advanced per draw (below). The real
   starting point was 24 to 26 ms.
2. Casters are culled by reach: foliage casts within 70 m, solid statics
   within 250 m, re-judged five times a second. Past that the terrain art's
   own baked shadows carry on.
3. The cascades are staggered: the near one every frame, the middle one
   every second frame, the far one every fourth. A skipped map keeps the
   matrix it was drawn with, so its shadows do not swim.
4. One remaster material per source material, not per mesh: a level's few
   hundred glTF materials had become thousands, each with its own bindings.

## How it is built

The page imports `'three'` everywhere. A small classic script in `map.html`
writes the import map before any module resolves it: the vendored r169 WebGL
build without `?remaster`, three r186's `three.webgpu.js` with it
(`viewer/vendor/three-webgpu/`, copied from `ui/node_modules/three` 0.186.1,
MIT, with the addons used: GTAO, bloom, SMAA, CSM, SkyMesh). `three.webgpu.js`
re-exports the whole core, so every module runs unchanged on it; the only
r169 names it lacks are `WebGLRenderer` (other pages), `UniformsUtils` and
`UniformsLib` (the proving ground).

The static import map stays exactly as it was (the image's
`mesh/stamp-viewer.mjs` rewrites it); under `?remaster` a script ahead of it
inserts a map of its own, and where import maps merge the first definition
of `three` wins.

The remaster modules resolve `three/webgpu` and `three/tsl`, which only the
remaster import map names, so the page loads them with dynamic `import()`
and the rest of the page reaches them through one registry,
`remasterHooks`, which is empty without `?remaster`. It lives on the global
(`globalThis.bfRemasterHooks`), so the retail modules that call into it need
no new import and stay loadable by the test harnesses that copy a module
and its listed neighbours into a temporary folder.

| File | What it does |
|---|---|
| `remaster-mode.js` | the flag, the parts turned off, the hook registry |
| `remaster-renderer.js` | the WebGPU renderer, its WebGL shims, shadow casters, the post chain, the glow on additive effects |
| `remaster-sky.js` | physical sky, its calibration, image-based light, haze, cascaded shadows |
| `remaster-materials.js` | terrain, lightmapped statics, dynamic surfaces |
| `remaster-water.js` | the water |
| `remaster-foliage.js` | leaf sprites, billboards, wind |
| `remaster-audio*.js` | the audio chain ([AUDIO.md](AUDIO.md)) |

The retail modules call in at the points where they build their own look:
`level-shading.js` (terrain detail, lightmaps, dynamic shading),
`level-sky.js` (the painted sky is hidden, the water swapped),
`tree-foliage.js`, `effects.js`, `gun-groups.js`, `arms-rig.js`,
`level-load.js` (the level's atmosphere once it is up),
`level-warmup.js` and `texture-quality.js` (skipped under WebGPU).

### What each level word drives

| `scene.json` | Retail | Remaster |
|---|---|---|
| `sunDirection` | the vehicles' N.L (and the bake) | the sun, its shadows, the sky's sun |
| `lighting.diffuse` | the sun's colour and the 2x combine | the sun's tint; its strength against the ambient pair |
| `lighting.ambient` + `globalAmbient` | the floor of the combine | sets the sun-to-sky contrast |
| `fogColor` | the fog and the background | two thirds of the haze colour (one third the sky's horizon), the sky's tint |
| `fogStart` | where the linear ramp starts | clear air to 60 % of it |
| `fogEnd` | where the world is wholly fogged | the same wall (the far plane and the culling still end there); the haze's density and the sky's turbidity |
| `water` (layers, normal map, scroll, shallow/deep colours, `colorDepth`, depth bake) | the GLSL water | the node water: same textures and scroll, PBR reflection, absorption by the bake |
| lightmaps | `2 * lightmap * texture`, unlit | occlusion on the sky's light; the sun lights the wall for real |
| terrain detail | `tile + detail - 0.5` | the same combine, as the albedo |

### The pieces

**Shadows.** `CSMShadowNode`, three cascades over 350 m, practical splits,
2048 maps, faded edges. Terrain does not cast (its art has the relief's
shadows painted in); its copies past the world's edge do not; far tree
billboards do not. Cut-outs (wire, leaves, branch cards) cast through their
map's alpha. The cascades are refit whenever the camera's projection
changes, since CSM fits them once at init.

**Materials.** Terrain is Lambert (no specular: the art's albedo is dark
pre-lit paint, and a 4 % white specular greyed its ochre to olive), lit with a
normal 60 % of the way to straight up and a fill of 42 % of the art, so a
slope keeps the light its artist painted and the real light adds moving
shadows and the sky's colour. Statics and vehicles are physical with a third
of the default specular; `envmap true` materials are smoother and reflect the
sky. A lightmap becomes occlusion on the sky's light.

**Sky.** three's SkyMesh (Preetham, with its procedural clouds) lit by the
level's sun, calibrated so its mean brightness is the same on every level
(its raw output swings tenfold with turbidity and sun height), its range
compressed and its blue eased toward grey, and faded into the haze colour
toward the horizon so the fogged world meets it without a seam. Cloud cover
comes from the fog's greyness and length. The image-based light is a PMREM of
the same sky, less blue still.

**Haze.** Distance and exponential height fog in one: clear to 60 % of
`fogStart`, the integral of a haze that halves every ~70 m up, and the
retail wall at `fogEnd`. Its colour is computed once a level on the CPU (a
per-pixel lookup of the sky's light looked the same and cost 16 ms).

**Water.** The level's two colour layers and normal map scrolled as retail
scrolls them, a finer procedural ripple, PBR reflection at water's IOR, the
bed seen through Beer-Lambert absorption over the baked depth and the slant
of the view, foam on the last third of a metre at the shore.

**Foliage.** Leaf sprites rebuilt around their centres from the drawing
camera's axes in the mesh's own space, so the sun's shadow pass (which reads
`positionNode`, not `vertexNode`) turns them to the sun and they cast their
full shape. Leaves and branch cards are cut at 0.4 instead of blended, so
they write depth for the occlusion pass. A slow gusting sway grows with
height; each leaf flutters on its own phase. The far billboard is the same
two-frame azimuth blend, lit.

**Post.** A one-sample scene pass (the occlusion needs a readable depth),
GTAO at half resolution masked off the sky, bloom over 2.4 in HDR, Khronos
PBR Neutral tone mapping at exposure 0.58, SMAA after it. Additive effects
(flames, flashes, tracers) are drawn three times brighter than their texture,
so their cores cross the bloom threshold.

## Bugs found on the way

- **three r186 shares one compiled node graph between materials whose graphs
  have the same shape**, and with it the texture a `texture(t)` node was
  built with: every terrain patch drew the first patch's tile, every
  lightmapped static the first lightmap. Every texture in a remaster graph is
  read through `materialReference` (`remaster-materials.js` `matTexture`),
  and a shadow cut through a reference bound to its own material, because in
  the shadow pass the material being drawn is the depth material.
- **three's node frame only advances inside `setAnimationLoop`.** A frame
  drawn outside it (`__renderOnce`, a replay's scrub) re-used the last
  frame's passes and shadow maps. `remaster.render()` advances it when the
  loop has not.
- **`compileAsync` with cascaded shadows** sizes their uniform buffers before
  the cascades exist and fails every pipeline it builds, so the warm-up is
  skipped under WebGPU (pipelines build on first draw instead).
- **Retail's material passes share `userData` between the per-mesh materials
  made from one glTF material**, and `tree-foliage.js` guards on it: only the
  first mesh's branch cards were processed. The remaster hooks run ahead of
  those guards. Whether the retail path loses anything by it was not checked.
- **The sun's side.** On Wake the terrain art is lit from `+sunDirection`
  (the slopes facing the eye from (1000, 108, -1080) along (0.67, -0.12,
  -0.73) are its brightest), while `level-load.js` aims the retail
  DirectionalLight, and `bindDynamicShading` its N.L, at `(-x, y, -z)`: the
  opposite side in plan. The remaster follows the art. If the retail vehicles
  are lit from the wrong side, that is a parity bug for the retail path; it
  was not investigated here (ledger DL rows, `features/level-lighting-laws`).
- **A skinned mesh's material shared between skeletons of different bone
  counts** (Wake's flag cloths, 20 and 36 bones) wrote a 2304-byte bone
  buffer into a 1280-byte one under WebGPU, every frame. Each bone count now
  gets its own material; one error is left at load, before the level's pass
  swaps them.

## What looks better

- Light has a direction: buildings, towers, girders, palms and vehicles cast
  real, moving shadows (the Battle of Britain tower and bridge most of all).
- Depth: haze that thickens low down and with distance, coloured by the sky
  behind it, instead of one flat colour wall.
- The water reflects the sky, shows the sand in the shallows and deepens to
  the level's deep colour; foam marks the shoreline.
- Explosions and muzzle flashes are light: HDR cores, bloom, tone-mapped
  instead of clipped.
- Trees sway, leaves flutter, and leaves cast leaf-shaped shadows.
- Contact shadows under eaves, in doorways and where objects meet the ground.

## What looks worse

- **The painted skies are gone.** Wake's and Battle of Britain's skyboxes are
  hand-painted cumulus with character; the procedural clouds are thinner and
  generic. The physical sky is still a little too dark and blue at the zenith.
- **Shaded slopes go dark.** A hill turned away from the sun (Wake's beach
  view) reads near-black brown where retail shows its painted mid-brown: the
  terrain art is pre-lit, and lighting it again is a compromise either way.
- **Grass reads flatter** at distance than the retail tile art.
- The lagoon is greyer than retail's turquoise from low angles.
- Shadows stop at 70 m for foliage and 250 m for statics, which shows from a
  plane or a hilltop.
- The frame costs two to four times as much (still well inside 60 fps for
  most views on this machine; an Iris Xe would struggle).

## What is next

1. **Generated normal and roughness maps** from `viewer/textures/` (scope
   item 3, not started): a Sobel height-to-normal pass and a luminance-based
   roughness, stored beside the texture store, read through
   `materialReference` like everything else.
2. **Keep the painted sky's clouds**: blend the level's own sky texture over
   the physical sky's gradient instead of replacing it.
3. **Un-bake the terrain**: divide the tile art by an estimate of its baked
   N.L from the heightmap, so the real sun can light it at full strength.
4. **Shadow cost**: static shadow caching (the far cascade only redrawn when
   something in it moves), merged tree casters, and a look at three's per
   draw JS cost in the shadow passes.
5. Muzzle flashes as real point lights for a frame (lighting the
   surroundings), and volumetric light shafts through the haze.
6. The other pages that build their own `WebGLRenderer` (tank sights,
   control previews, the proving ground's inset) do not work under
   `?remaster` yet.
7. The play front end (`play/`) does not carry `?remaster` into the game.

## Files

- `tools/bf1942-models/viewer/remaster-*.js`, `vendor/three-webgpu/`
- `tools/bf1942-models/tests/perf/remastershot.mjs`
- `features/remaster-browser/shots/` (the composites above),
  `features/remaster-browser/AUDIO.md`
