# Remaster mode for the browser game (`?remaster`)

Status: built 2026-11-12 on the throwaway branch `claude/remaster-browser-c4f0dd`,
as a what-if. It is not for main. The same sim, levels, models and sounds,
shown the way a game made today would look and sound. Without `?remaster` the
page is the retail-parity build it always was, so the two can be compared on
the same level from the same camera.

Audio has its own notes: [AUDIO.md](AUDIO.md).

**What `?remaster` is now (2026-11-12).** The owner played it and kept the
sun and the water: "I'd keep the sun and the water, but I'm not sold on
anything else." The Sherman's generated relief read as hail damage, and the
audio was "too muffled... like having headphones on", inside a tank most of
all. So `?remaster` is the lighting (sun, sky, shadows, haze, AO, bloom) and
the water. The relief maps are `?remaster=maps`, and the spatial audio is
`&remasterAudio=1`. Both were fixed after the verdict (below), but they stay
off unless asked for.

**And what it is now (2026-11-13).** The owner played it again: the weapon
in the hand lit by the remaster's sun "makes everything look rubbery and low
detail... technically cool but provides nothing"; and of the world, "the dark
shadows have that gel grey feeling", vehicles in the sun "overly darkened
and grey", "in general our rendering of the shadows is ugly and lacking light
and detail", the fog "dirty, not atmospheric". Every one of those was the
physically based relighting. BF1942's art is painted to be seen under the
engine's own combines, so the remaster now draws every surface with the
combine the retail page draws it with, at the art's own brightness, and adds
to it what it adds: the sun's real-time shadow in the combine's sun term,
the water, the HDR frame (bloom, shafts, occlusion). The fog is the level's
own. Nothing is relit.

## Plan and progress

| Step | State |
|---|---|
| `?remaster` switches three to r186's WebGPU build through the import map; the default path untouched | done |
| The setting carries from the play menu into every game it starts, for the tab | done |
| WebGPU renderer under the whole game: shims for the WebGL-only calls, warm-up, node frame, overlay passes (first-person arms, replays), side views (tank sights, previews, the proving ground) | done |
| Every surface drawn with the engine's own combine, the sun's real-time shadow in its sun term: terrain, lightmapped statics, vehicles, soldiers, trees | done (the owner's call, 2026-11-13; physically based until then) |
| Real-time cascaded sun shadows out to the fog wall | done (static casters merged into shadow proxies) |
| Ambient occlusion (GTAO), HDR, tone mapping, SMAA | done |
| Each level's own painted sky (or cube), lifted into HDR, as the sky and as the ambient light | done (a physical sky only for a level with neither) |
| The level's own fog (`fogColor` / `fogStart` / `fogEnd`), mixed as the retail page mixes it | done (2026-11-13; the height haze it replaced is `?remaster=haze`) |
| Water from the level's own water words and depth bake | done |
| Foliage: leaf sprites, billboards and wind as node graphs | done |
| Bloom on muzzle flashes, explosions and tracers; flashes and blasts light their surroundings; sun shafts | done |
| Audio: reverb by surroundings, occlusion, air absorption, the crack before the report | done, behind `remasterAudio=1` ([AUDIO.md](AUDIO.md)); no longer forces Chromium's HRTF |
| Generated normal and roughness maps from the texture store | done, behind `?remaster=maps` (`remaster_texture_maps.py`, 3,367 maps); edges only, no paint mottle |
| Pipelines and textures warmed before play, not on first sight | done (worst frame while turning: 141-501 ms down to 26-83 ms) |
| The first-person arms and weapon drawn by the engine's own combine, not the remaster's sun | done (the owner's call, 2026-11-13) |
| Nothing built during play holds a frame: hidden effects and vehicles warmed, later pipelines built off the thread | done (first kill of a kind: 283-486 ms down to 36-52 ms) |
| A round thrown from the hand takes the world's material (a grenade no longer stops the frame) | done |
| The sea drawn before every other transparent thing (far palms no longer cut at the waterline) | done |
| Two levels with before/after captures and frame times | done: Wake, Battle of Britain |

## How to look at it

```
map.html?map=wake&remaster
play/index.html?remaster                     # the menu: every game it starts is remastered, in this tab
map.html?map=wake&remaster=0                 # off again for the tab
map.html?map=wake&remaster=noao,nobloom      # parts off, comma-separated
map.html?map=wake&remaster=maps              # with the generated relief maps
map.html?map=wake&remaster&remasterAudio=1   # with the spatial audio chain
```

The setting lives in the tab's `sessionStorage` (`bfRemaster`): the menu and
the game write it from the address and read it when the address says nothing.
Instant battle, campaign, multiplayer, replays and the proving ground all
start the game their own way; this covers all of them.

The parts that can be turned off: `noshadow`, `noproxies` (statics cast for
themselves), `noao`, `nobloom`, `nosmaa`, `nopost` (no post chain at all),
`nofog`, `nowater`, `noglow` (effects at their texture brightness),
`noflash` (no flash lights), `noshafts`, `nostagger` (every cascade every
frame), `notonemap`, `syncpipes` (a pipeline met during play is built in
the frame that meets it, as before 2026-11-13). Parts that are off unless
named: `maps` (the generated normal and roughness maps), `haze` (the height
haze, in place of the level's own fog). A check: `showk` draws each surface
as the share of the sun its combine was given (white in the sun, black in a
shadow or turned away). Tuning
knobs: `&exposure=`, `&cascades=`, `&shadowFar=`, `&shadowSize=`,
`&leafReach=`, `&solidReach=`, `&glow=`, `&gpuTiming`, `&pipelineSalt=`
(a measurement's: a number folded into every fogged shader so the OS's
shader cache has seen none of them). `remasterAudio=1`
adds the spatial audio chain; without it the sound is retail's.

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

The normal and roughness maps are generated, not committed (150 MB for the
two local levels and the whole models tree; 3.5 minutes):

```
python3 -m venv tools/bf1942-models/.venv-remaster
tools/bf1942-models/.venv-remaster/bin/pip install numpy pillow
cd tools/bf1942-models
.venv-remaster/bin/python remaster_texture_maps.py viewer/maps/wake/scene.glb \
    viewer/maps/battle_of_britain/scene.glb 'viewer/models/**/*.glb'
```

A level whose textures have no map (a level fetched from mesh.bfstats.io
that was never run through the generator) draws without the relief; the page
reads the generator's index and asks only for maps that exist.

## Before and after

Same camera, same level, retail on the left, remaster on the right, 1600 x 900.

Wake, the airfield ridge across the lagoon:
![Wake airfield](shots/wake_airfield.jpg)

Wake, looking into the sun: the painted sky kept, the sun's glint across the
water, and the shafts:
![Wake into the sun](shots/wake_sun.jpg)

Wake, the supply bunker:
![Wake bunker](shots/wake_bunker.jpg)

Wake, the beach below the hill. The ridge's palms throw long shadows down the
slope toward the eye:
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

The first-person weapon at three headings on Wake (toward the sun, across
it, away from it): the original game, the remaster lighting it with its own
sun, and the remaster now, drawing it with the engine's combine:
![The first-person weapon](shots/wake_first_person_weapon.jpg)

An explosion's fireball, a frame after a gun emplacement dies off the left
edge: the original game, the remaster's hard-edged rectangle, and now:
![Explosion glow](shots/wake_explosion_glow.jpg)

What the owner pointed at on 2026-11-13, each as the original game, the
remaster before that day and the remaster now. The Shokaku's island and
masts against the sun, a Sherman's shaded side at the north village, and the
north base (the palm in the last row is in its fade band, drawn before as
white blades):
![Ships and vehicles](shots/wake_ships_vehicles_3up.jpg)

Far palms and a bunker at 200 m (grey ghosts, the hill washed out, and the
sea drawn over the palms' trunks at the right edge), the village across the
lagoon at 300 m, and a palm against the sun:
![Trees and fog](shots/wake_trees_fog_3up.jpg)

On foot, remaster only: [Wake](shots/wake_on_foot_remaster.jpg),
[Battle of Britain](shots/bob_on_foot_remaster.jpg). Full-size frames:
[Wake](shots/wake_airfield_remaster_full.jpg),
[Battle of Britain](shots/bob_base_remaster_full.jpg).

## Frame time on this M5 Max

1600 x 900, device pixel ratio 1, no bots, median of 60 frames, CPU and GPU
together (`tests/perf/remastershot.mjs`), the machine otherwise quiet. The
retail column is the default path on this branch, unchanged by it.

| Level | View | Retail | Remaster | Remaster CPU |
|---|---|---|---|---|
| Wake | airfield | 5.8 ms | 13.9 ms | 9.0 ms |
| Wake | beach | 5.2 ms | 12.0 ms | 7.5 ms |
| Wake | hill (aerial) | 4.7 ms | 9.9 ms | 6.1 ms |
| Wake | bunker | 3.8 ms | 9.6 ms | 6.3 ms |
| Wake | into the sun (the whole island in view) | 6.9 ms | 18.7 ms | 11.9 ms |
| Battle of Britain | base | 4.7 ms | 11.0 ms | 7.0 ms |
| Battle of Britain | approach | 5.4 ms | 13.9 ms | 8.5 ms |
| Battle of Britain | airfield | 4.0 ms | 9.6 ms | 6.0 ms |
| Battle of Britain | overview | 4.8 ms | 10.4 ms | 6.4 ms |

Every view is inside a 60 fps frame. The table is from 2026-11-12, before
the surfaces went back to the engine's combines; that change did not move it
(the two builds served side by side and timed back to back on 2026-11-13,
with the machine busy: 17.3, 15.4, 11.1, 12.7 and 20.2 ms before, 16.4, 15.4,
13.2, 12.3 and 19.8 ms after, the five Wake views in the table's order).
Where it goes (about 1 ms of noise):

| | Wake airfield | Battle of Britain base |
|---|---|---|
| everything | 13.9 ms | 11.1 ms |
| `noshadow` | 9.8 ms | 8.3 ms |
| `nopost` (no AO, bloom, shafts, SMAA) | 12.0 ms | 10.4 ms |
| `nomaps` | 12.9 ms | 12.2 ms |
| `noproxies` (every static casting for itself) | | 23.7 ms |

The shadows are 3 to 4 ms with the range at the fog wall, the post chain 1 to
2 ms, the generated maps about 1 ms; the rest is three's WebGPU renderer's
own JS cost per draw over r169's WebGL one. None of it is GPU-bound.

How the shadows got here from 140 ms:

1. The harness had been timing the page's animation loop, not its own
   frames, until three's node frame was advanced per draw (below). The real
   starting point was 24 to 26 ms at a 70 m reach.
2. **Shadow proxies** (`remaster-shadow-proxies.js`): at load every static
   caster (buildings, walls, props, trunks, branch cards and leaf sprites,
   and parked vehicles) is merged into one mesh per 128 m tile and texture,
   drawn only by the sun's shadow cameras (layer 1), and the originals stop
   casting. Wake's ~4,000 caster meshes become ~160 proxies (820k
   triangles); leaf cards are baked facing the sun, which is the face that
   shadows. A vehicle part is watched: once it moves or hides (driven,
   turned, wrecked) it leaves its proxy and casts for itself, and a vehicle
   that shows and stands still joins one. A rebuilt tile is a few
   milliseconds, one tile a second at most.
3. The cascades are staggered: the near one every frame, the middle one
   every second frame, the far one every fourth. A skipped map keeps the
   matrix it was drawn with, so its shadows do not swim.
4. One remaster material per source material, not per mesh: a level's few
   hundred glTF materials had become thousands, each with its own bindings.

## How it is built

The page imports `'three'` everywhere. `map.html`'s static import map names the
vendored r169 WebGL build, as it always has (the image's
`mesh/stamp-viewer.mjs` rewrites it). With the remaster on, a classic script
ahead of it inserts a map of its own naming three r186's `three.webgpu.js`
(`viewer/vendor/three-webgpu/`, copied from `ui/node_modules/three` 0.186.1,
MIT, with the addons used: GTAO, bloom, SMAA, CSM, SkyMesh, radial blur);
where import maps merge, the first definition of `three` wins.
`three.webgpu.js` re-exports the whole core, so every module runs unchanged
on it.

The remaster modules resolve `three/webgpu` and `three/tsl`, which only the
remaster import map names, so the page loads them with dynamic `import()`
and the rest of the page reaches them through one registry, `remasterHooks`,
which is empty without the remaster. It lives on the global
(`globalThis.bfRemasterHooks`), so the retail modules that call into it need
no new import and stay loadable by the test harnesses that copy a module and
its listed neighbours into a temporary folder.

| File | What it does |
|---|---|
| `remaster-mode.js` | the setting (address, else the tab's), the parts turned off, the hook registry |
| `remaster-renderer.js` | the WebGPU renderer, its WebGL shims, the custom tone curve, shadow casters, the frame and its post chain, flash lights, sun shafts, side renderers |
| `remaster-sky.js` | the painted sky in HDR, the physical sky's fallback, image-based light, the fog, cascaded shadows, the retail cloud layer |
| `remaster-materials.js` | `EngineMaterial` and its lighting model (the engine's combines with the sun's shadow in them), the first-person rig's material, the generated maps, the proving ground's floor |
| `remaster-shadow-proxies.js` | the merged static shadow casters |
| `remaster-water.js` | the water |
| `remaster-foliage.js` | leaf sprites, billboards, wind |
| `remaster-audio*.js` | the audio chain ([AUDIO.md](AUDIO.md)) |
| `../remaster_texture_maps.py` | the normal and roughness map generator |

The retail modules call in where they build their own look:
`level-shading.js` (terrain detail, lightmaps, dynamic shading),
`level-sky.js` (the painted sky, the cloud layer, the water), `tree-foliage.js`,
`effects.js` (glow, flash lights), `gun-groups.js`, `arms-rig.js`,
`hand-weapon.js` and `replay-viewmodel.js` (the first-person rig, drawn
by the engine's combine: `viewMaterial`),
`level-load.js` (the level's atmosphere once it is up), `proving-ground.js`,
`glb-loader.js` (each texture's store hash), the seven side views that build
their own renderer, `level-warmup.js` (its warm points hand their roots to
the remaster's warm-up, below) and `texture-quality.js` (skipped under
WebGPU).

### What each level word drives

| `scene.json` | Retail | Remaster |
|---|---|---|
| `sunDirection` | the vehicles' N.L (and the bake) | the sun: its shadows, the N.L of the vehicles' combine, the water's glint |
| `lighting.diffuse` | the sun's colour and the 2x combine | the same, in the same combine (the real light's tint and strength reach only the water) |
| `lighting.ambient` + `globalAmbient` | the floor of the combine | the same floor, which is also what a cast shadow leaves |
| `lighting.shadowColor` | not read | what the ground keeps of its art in a cast shadow |
| `sky` (the SkyBox mesh), `skybox` (six faces) | drawn unlit | drawn lifted into HDR; reflected by the water |
| `sky.clouds` | the GLSL cloud layer | the same layer as a node material |
| `fogColor` | the fog and the background | the fog's colour |
| `fogStart` | where three's fog ramp starts | the same |
| `fogEnd` | where the world is wholly fogged | the same; the shadows' reach |
| `water` (layers, normal map, scroll, shallow/deep colours, `colorDepth`, depth bake) | the GLSL water | the node water: same textures and scroll, PBR reflection, absorption by the bake |
| lightmaps | `2 * lightmap * texture`, unlit | the same; a sun-facing texel in a real-time shadow is taken down to the bake's own shadow tone |
| terrain tile and detail | `tile + detail - 0.5`, unlit | the same, times `shadowColor` in a cast shadow |

### The pieces

**Shadows.** `CSMShadowNode`, three cascades out to the level's `fogEnd`,
practical splits, 2048 maps, faded edges, refit whenever the camera's
projection changes (CSM fits them once at init). Static casters through the
proxies above; moving ones (vehicles in use, soldiers, flags) cast for
themselves within 450 m. Terrain does not cast (its art has the relief's
shadows painted in), nor its copies past the world's edge, nor far tree
billboards. Cut-outs cast through their map's alpha.

**Sky.** The level's own painted SkyBox (or its cube of six faces), drawn at
its painted brightness through the exposure and tone curve, down to its own
painted horizon, and rendered once into the image-based light the water
reflects. A level with neither gets three's SkyMesh (Preetham) lit by its
sun, calibrated to the same mean brightness and eased toward grey.

**Surfaces.** One material class, `EngineMaterial`
(`remaster-materials.js`), whose lighting model is the engine's combine for
the kind of surface, in display space, with one number from the renderer in
it: `k`, the sun's N.L against the real sun times the cascaded shadow.

| Kind | Combine | What `k` does |
|---|---|---|
| vehicles, soldiers, bare statics, trunks | `2 * tex * clamp(floor + sun * materialDiffuse * k)`, then `envmap true`'s stage | a face in shadow or turned from the sun draws at the floor, where the engine put its shaded side |
| fronds (a tree's branch cards) | the same | `k` is taken from either side of the card and never under 0.6 of the sun: a frond passes light |
| lightmapped statics | `2 * tex * lightmap` | a sun-facing texel in shadow is taken down to 0.12, where the bake's own cast shadows sit (Wake's read 0.06 to 0.12) |
| terrain | the tile art and detail, unlit | level ground in a cast shadow keeps `lighting.shadowColor` of its art; a slope turned from the sun takes no cast shadow (the ground casts none, so one would fall through the hill) |
| leaf sprites | `2 * tex`, unlit | shaded to 0.66 by the shadow and the canopy's turn |
| far tree cards | the strip, unlit | the same; its alpha is firmed for linear blending |

`floor` is `ambient + globalAmbient`, `sun` is `lighting.diffuse`. Three
hands a lighting model each light's colour with its shadow multiplied in, so
`k` is the sun's term over the light's own colour, and a flash light or an
explosion's adds to it. The sky's image-based light and the hemisphere are
not read by these surfaces. The result is handed the exposure to undo, so it
reaches the screen as the combine left it. The first-person arms and weapon
use the same combine with the retail page's light direction and no shadow
(`viewMaterial`).

Each texture's generated map (below, `?remaster=maps`) turns the normal the
vehicles' N.L reads.

**Generated maps.** `remaster_texture_maps.py` reads every store texture the
given glbs name and writes one WebP per texture: the normal (RG) of a height
taken from the texture's luminance, high-passed at a sixty-fourth of the
texture, with only its steepest slopes kept (panel lines, hatch rims, rivets,
plank edges, mortar; not paint mottle or weathering), and roughness (B) from
brightness and that kept detail (broad bright paint smoother, edges and dark
paint rougher). Drawn at strength 1. The page tags each texture with its store hash as the glb loads
(`glb-loader.js`) and finds its map through the generator's index.

**Fog.** The level's own, as the retail page draws it: three's fog between
`fogStart` and `fogEnd` (a smoothstep of the view depth) in `fogColor`,
mixed in display space as the retail page's is and the engine's was. What is
brighter than white (a flame's glow) is carried past the mix. `?remaster=haze`
draws what this replaced: an exponential haze thinning with height, floored
at 70 % of a linear ramp, with a wall over the last fifth of `fogEnd` and a
glow toward the sun.

**Water.** Drawn before every other transparent thing, as the retail water
is. The level's two colour layers and normal map scrolled as retail
scrolls them, a finer procedural ripple, PBR reflection a little over water's
2 %, the bed seen through Beer-Lambert absorption over the baked depth and the
slant of the view, foam on the last third of a metre at the shore.

**Foliage.** Leaf sprites rebuilt around their centres from the drawing
camera's axes in the mesh's own space, so in the sun's shadow pass (which
reads `positionNode`, not `vertexNode`) they face the sun. Leaves and branch
cards are cut at 0.4 instead of blended, so they write depth for the occlusion
pass. A slow gusting sway grows with height; each leaf flutters on its own
phase. The far billboard is the same two-frame azimuth blend, unlit as retail
draws it. The swap between a tree and its card is judged from the player's
camera only (the renderer also calls the hook for each shadow cascade).

**The frame.** A one-sample scene pass (the occlusion reads its depth), GTAO
at half resolution masked off the sky, bloom over 2.4 in HDR, sun shafts (the
bright open sky radially blurred toward the sun's place on the screen), SMAA,
drawn as one full-screen quad through the renderer's own tone-mapped output,
so the overlay passes that follow (the first-person arms, a replay's first
person and spotlight, the proving ground's inset) land on the world and are
tone-mapped with it. The tone curve is Khronos PBR Neutral's highlight
shoulder without its black-level offset, at exposure 0.58. Additive effects
(flames, flashes, tracers) are drawn three times brighter than their texture,
so their cores bloom, and an explosion, a muzzle flash or a fire lights its
surroundings through a pool of four point lights.

## Bugs found on the way

- **The arms smeared over a black world the moment a player spawned.** A
  `RenderPipeline` writes the frame straight to the canvas with tone mapping
  off; the arms pass then drew, with `autoClear` off, into the renderer's own
  tone-mapping framebuffer (which the world never reached and nothing
  cleared) and copied it over the canvas. The frame is now a full-screen quad
  through that same output path (see "The frame"). Found by the owner on
  first play.
- **three r186 shares one compiled node graph between materials whose graphs
  have the same shape**, and with it the texture a `texture(t)` node was
  built with: every terrain patch drew the first patch's tile, every
  lightmapped static the first lightmap. Every texture in a remaster graph is
  read through `materialReference` (`remaster-materials.js` `matTexture`); a
  shadow cut through a reference bound to its own material, because in the
  shadow pass the material being drawn is the depth material; `Material.clone`
  of a remaster material carries its graphs and texture slots.
- **`Skeleton.computeBoneTexture` padded the flag cloths' bone matrices** from
  20 to 36 (WebGL's square bone texture), and WebGPU's 20-matrix uniform
  buffer took 36 every frame (~70 validation errors a second). It is a no-op
  under WebGPU, and a padded array is trimmed.
- **Khronos PBR Neutral's black-level offset** subtracts up to 0.04, taken from
  the smallest channel, from all three, which crushed the low blue of
  BF1942's warm dark art: Wake's ochre field drew orange (96/71/19 against the
  art's 108/89/54). The remaster's own curve keeps the shoulder and drops the
  offset.
- **three's node frame only advances inside `setAnimationLoop`.** A frame
  drawn outside it (`__renderOnce`, a replay's scrub) re-used the last
  frame's passes and shadow maps. `remaster.render()` advances it when the
  loop has not.
- **`compileAsync` with cascaded shadows** sizes their uniform buffers before
  the cascades exist and fails every pipeline it builds. So retail's warm-up
  is skipped under WebGPU, and for a while nothing took its place: every
  building's pipeline was built, and every texture uploaded, by the first
  frame to see it. The owner felt it ("a little stuttery at the start"); a
  camera turning on Wake took 141 to 501 ms frames. The remaster now warms
  its own (`warmPipelines` in `remaster-renderer.js`): five frames after the
  level is up (the cascades exist by then), the whole scene is compiled off
  the main thread against the scene pass's own target, with frustum culling
  lifted for the one synchronous walk. Every texture a material binds is
  then uploaded, 4 ms of it a frame. It runs again three seconds later for
  what the level spawns, and on the first-person overlay when it is built.
  The same turn now peaks at 26 to 83 ms; the build takes about 2.6 s in the
  background on Wake.
- **The first-person weapon was lit by the remaster's sun, and should not
  have been.** The arms and the gun were physically based surfaces under the
  world's sun and sky, like a vehicle. Facing the sun, every face the player
  looks at is in shade and drew by the sky's blue light alone: grey hands,
  flat dark steel. With the sun behind, the same faces took the whole sun
  and washed out (the BAR's receiver on Wake at two to three times the
  retail page's brightness). The owner, twice: "the weapons can look very
  washed out at the peak of the sun", then of the shaded case, "it makes
  everything look rubbery and low detail. In the retail the gun still
  renders beautifully even when in our sun... technically cool but provides
  nothing" (2026-11-13). The rig now draws with the engine's own combine,
  the one the retail page uses, as a node material
  (`remaster-materials.js` `viewMaterial`): `2 * tex * clamp(ambient +
  globalAmbient + diffuse * materialDiffuse * N.L)` in display space, then
  `envmap true`'s stage where the level has a cube, with the light aimed as
  the retail page aims it. `arms-rig.js` marks the rig (`firstPerson`) when
  it asks for its shading. Nothing in the world reads the rig's light: it is
  an overlay pass with no shadow to cast or take. Over eight headings on
  Wake the weapon's mean brightness is retail's (60 against 60 of 255).
  A first attempt kept the real sun at a smaller share and cast a ray from
  the eye to shade the weapon indoors; it was dropped, since the complaint
  was the real sun on the weapon at all.
- **The first-person overlay asked for a warm-up on every frame it drew.**
  `lightOverlay` queued one each call, so a `compileAsync` walk of the rig
  ran sixty times a second for as long as the player was on foot. It is
  asked for once per rig now (a weapon change swaps the rig).
- **The first explosion of a session froze the game** ("very laggy at key
  moments, when I shoot something that explodes", the owner, 2026-11-13).
  Three causes, all the same kind: a pipeline built in the frame that first
  needs it, which waits for the GPU process to compile its shaders.
  1. three's WebGPU `compileAsync` skips a hidden node and everything under
     it, where the WebGL `compile` the retail warm-up relies on walks them.
     The effect pool's parked sprites, vehicles not spawned yet and guns'
     flashes were never built. `warmPipelines` now shows hidden nodes for
     its one synchronous walk (collision hulls excepted) and puts them back.
     The first `BombBig_Expl` on Wake: 444 ms down to 43.
  2. `level-warmup.js` returned early under WebGPU, so the page's own warm
     points (the level once its effect pool is built, a rig, a seat's
     cockpit, a replay's models) reached nothing. `warmSubtree` now hands
     its root to the remaster (`remaster.warm`), which builds it for the
     pass that draws it a few frames on.
  3. Some things do not exist until they are needed: an effect's debris and
     its sprite materials are made when it plays, a wreck is loaded when its
     vehicle dies, a tree's blend band is cloned as it crosses a range, and
     no warm-up reaches the shadow passes. No warm-up can build those. So
     once a level is up, a pipeline met inside a frame is built with
     `createRenderPipelineAsync` (three's own path for `compileAsync`) and
     `draw` skips an object whose pipeline is not ready
     (`installAsyncPipelines`): it appears a few frames late, once, and no
     frame waits. Full-screen quads stay synchronous.
  Measured with `tests/perf/remaster_explosions.mjs`, a cold shader cache
  each run (`pipelineSalt`: macOS keeps compiled shaders between runs, which
  made every run after the first read as already fixed): destroying one
  vehicle of each of eight kinds, four more, and fourteen explosion effects,
  the worst frame was 283 to 486 ms before and 36 to 52 ms now.
- **An explosion's glow drew as a hard-edged rectangle**, and debris and
  smoke glowed with it. The glow hook tripled every material an effect
  made, not only the additive ones, so a destroyed gun's flying parts and an
  explosion's smoke were three times their textures. And the engine added
  `texel * alpha` to the frame in display space, where a faint texel adds
  next to nothing, while this frame is linear, where it is a veil: the
  fireball (`e_fire4`, 16 x 16 on a 21 m quad, a tenth alpha at its border)
  showed its whole quad. The hook now takes only what the data blends
  additively, and a particle's quad adds `EOTF(OETF(rgb) * alpha * opacity)`
  times the glow: the engine's own result over black. A flash that is a
  mesh (a muzzle's, a tracer) is as it was.
- **The generated relief read as hail damage** on the Sherman. The first
  generator took everything finer than an eighth of the texture as height,
  so painted mottle, weathering and camo blotches became dents, and the page
  drew them at 1.8 times. It now high-passes at a sixty-fourth and keeps a
  slope only where it is among the texture's steepest (a soft knee between
  its 70th and 97th percentiles): panel lines, hatch rims, rivets, plank
  edges and mortar keep a bevel, paint stays flat. Drawn at 1.
- **The spatial audio forced Chromium's HRTF on every voice.** Against equal
  power on white noise it lifts the bottom 3 dB and takes 2.5 to 3.5 dB off
  the top ahead and 7.5 to 10 dB behind: the owner's "like having headphones
  on". The chain now pans with the player's own model (equal power, or HRTF
  with HARDWARE ACCELERATION ticked). Its air absorption was a Q 0.5 corner,
  -6 dB at the cutoff, moving from 15 m. It is now a Butterworth from 25 m,
  13 kHz at 50 m and 8.7 kHz at 100 m. Full occlusion is 1.5 kHz and -5 dB,
  where it was 700 Hz and -7 dB.
- **In a tank the spatial audio was still fully muffled**, which is what the
  owner heard on the second try. Its occlusion rays hit the listener's own
  hull: every voice blocked, the reverb's survey reading "inside a room".
  Measured in the page, in the Sherman: 22.5 dB down from 4 to 10 kHz against
  retail in the same seat. The rays now pass through vehicles and the
  listener's own engine is measured from the ear; the seat is within 0.2 dB
  of retail in every band ([AUDIO.md](AUDIO.md), "Second pass").
- **Everything in the world was relit, and looked worse for it.** Statics,
  vehicles, soldiers, trees and the ground were physically based surfaces
  under the sun and the sky's image-based light. A face out of the sun was
  lit by the sky's blue alone, flattened by the tone curve: a palm against
  the sun was a grey cut-out, the Shokaku's masts grey blobs, a bunker a
  flat pale box, a sunlit hull darker and greyer than its paint, a shaded
  hillside brown where its art is green. The owner (2026-11-13): "the dark
  shadows have that gel grey feeling", "overly darkened and grey contrast",
  "ugly and lacking light and detail". The art is painted for the engine's
  combines, so every surface is drawn with its own (`EngineMaterial`, "The
  pieces"), and the remaster's part is the cast shadow inside the combine's
  sun term. The two entries below this one (`envByAlpha`, the sky's share)
  were tunings of the relighting and went with it.
- **A thrown grenade stopped the picture.** The game ran on and could be
  heard; the frame was frozen. `round-launch.js` clones a thrown round out of
  the hand rig, and since the weapon in the hand got its own material the
  clone carried it into the world. The sun's shadow pass draws every caster
  with a depth material, against which the rig material's per-material
  light could not be resolved (`materialReference` read an undefined
  vector), and the frame threw on every draw from the moment the round left
  the hand. A first-person material now carries its world counterpart
  (`remasterWorld`) and `worldMaterials` swaps it as the round is launched.
  `tests/perf/remaster_explosions.mjs` now ends by spawning on foot and
  throwing what the kit throws, and fails on a frame that throws.
- **Far palms were cut at the waterline.** The remaster's branch of
  `setupWater` returned before the line that gives the water
  `renderOrder = -1`. three sorts transparent things by their origin, the
  sea's is the world's corner, and a far tree card writes no depth: the sea
  was drawn after the card and painted over every palm that stood against
  it, leaving the crown above the horizon and the foot on the sand.
- **Far tree cards were grey wisps.** Their alpha blends in linear light
  here and blended in display space in retail, where a half-covered texel of
  a dark frond is a mid tone and not mostly sky. The card's alpha is firmed,
  `1 - (1 - a)^2.2`.
- **The fog was a quarter thick at 150 m**, where retail's is a few percent,
  in a colour up to 1.8 times brighter toward the sun, and it was mixed in
  linear light, where half fog over a dark thing is mostly fog. Then the
  world shut in a wall over the last fifth of `fogEnd`. It is the level's
  own fog now, mixed in display space ("The pieces").
- **A flat band of fog under the sky.** The painted sky was faded to the fog
  colour in its last degrees above the horizon; from the air that was a
  fifth of the frame where retail shows sky. The paint is drawn to its own
  horizon.
- **The tree swap was judged from the sun.** The WebGPU renderer calls
  `scene.onBeforeRender` for every shadow cascade, each with its own
  orthographic camera, in the middle of the main pass; `tree-foliage.js`
  judged every tree's swap again from there, after the frame had picked what
  to draw. The hook now answers the player's camera only.
- **A cloned node material loses its alpha cut.** three r186's
  `NodeMaterial.copy` copies what it can enumerate; `alphaTest` is an
  accessor with an underscored field and is not reached. A palm in its fade
  band, whose materials `tree-foliage.js` clones to fade them, drew its
  fronds as whole white blades. `cloneWithNodes` and `EngineMaterial.copy`
  carry it.
- **`envmap true` made a whole material shiny.** The engine reflects the
  level's cube by the texture's alpha, `lit * A + cube * (1 - A)`
  (`envmap.js`); the remaster gave every such material roughness 0.5,
  metalness 0.15 and full specular whatever its alpha. The Sherman's
  Browning and its ammunition box (alpha 0.94: paint) mirrored the sky from
  the gunner's seat, "washed out and too white". Reflection is now by
  `1 - A` (`envByAlpha`).
- **The sky lit a vehicle as brightly as the sun did.** Measured on that
  gun: 0.068 linear from the sky alone, 0.05 from the sun alone, so no hull
  had a lit side and a shaded side. The engine's own numbers for these
  meshes on Wake are 0.24 ambient to 0.40 sun. Vehicles and soldiers now
  take a quarter of the sky's image-based light (`DYNAMIC_SKY_FILL`, through
  `aoNode`), which puts a sunlit face at 1.29 times its texture against
  retail's 1.28. Trees take 0.6 (`FOLIAGE_SKY_FILL`): at a quarter a backlit
  palm was a black cut-out.
- **Far palms were pale ghosts.** The far tree card is lit with a
  straight-up normal and always seen from the side, the angle at which a
  specular surface mirrors the horizon. It was made a Lambert material, and
  is now drawn unlit as retail draws it (above).
- **The dev server dropped modules.** `serve_viewer.py` listened with
  socketserver's backlog of 5; the page asks for about 600 modules at once,
  and on macOS 27 some of that burst was reset, so the page never booted.
  The backlog is 1024.
- **Seven side views build a `WebGLRenderer`**, which the WebGPU build does not
  have (the tank sight, the controls preview, the proving ground's card, the
  dogfight and tank schools, tank snapshots); under the remaster they get a
  WebGPU renderer with the same shims. The proving ground's floor was a GLSL
  grid built with r169's uniform helpers; it has a node version.
- **Retail's material passes share `userData` between the per-mesh materials
  made from one glTF material**, and `tree-foliage.js` guards on it: only the
  first mesh's branch cards were processed. The remaster hooks run ahead of
  those guards. Whether the retail path loses anything by it was not checked.
- **The sun's side.** On Wake the terrain art is lit from `+sunDirection`
  (the slopes facing the eye from (1000, 108, -1080) along (0.67, -0.12,
  -0.73) are its brightest), while `level-load.js` aims the retail
  DirectionalLight, and `bindDynamicShading` its N.L, at `(-x, y, -z)`: the
  opposite side in plan. The lightmaps agree with the art (on Wake a wall
  facing `+sunDirection` reads 0.31 on average, one facing the other way
  0.15; El Alamein 0.38 and 0.22). The remaster follows the art, so its
  vehicles are lit from the side their shadows fall away from, the opposite
  side to the retail page's. Whether the retail
  vehicles are lit from the wrong side is a question for the retail path
  (ledger DL rows, `features/level-lighting-laws`), not this branch.

## What looks better

- Light has a direction: buildings, towers, girders, palms and vehicles cast
  real shadows out to the fog, and things that move cast moving ones, onto
  the ground, onto walls and onto each other.
- A shadow is the tone the art already uses for shade, so a shaded face and
  a cast shadow keep the whole texture.
- Palms pass light: fronds glow with the sun behind them.
- The water reflects the sky and the sun, shows the sand in the shallows,
  deepens to the level's deep colour, and foams at the shore.
- Explosions and muzzle flashes are light: HDR cores, bloom, a flash of light
  on the ground and walls around them.
- With `maps`: panel lines, rivets and planks turn the sun's light on vehicles.
- Trees sway, leaves flutter, and leaves cast leaf-shaped shadows.
- Contact shadows under eaves, in doorways and where objects meet the ground.

## What is still different from retail, and why

These are choices, not open faults.

- **Vehicles, soldiers and trees are lit from the other side** than on the
  retail page: from the side the level's art and lightmaps are lit from
  (see "The sun's side"), which is the side their shadows fall away from.
- **The sea is darker from the air** than retail's, which fogs its water on
  a linear ramp of its own; the remaster's water takes the scene's fog.
- **The first-person arms and weapon take no shadow**, and are lit from the
  retail page's side (the owner's call; see the bugs above).
- **A frame costs about twice retail's** (9.6 to 18.7 ms against 3.8 to 6.9
  on this machine).

## Files

- `tools/bf1942-models/viewer/remaster-*.js`, `vendor/three-webgpu/`
- `tools/bf1942-models/remaster_texture_maps.py` (its venv and output are
  gitignored)
- `tools/bf1942-models/tests/perf/remastershot.mjs`,
  `tools/bf1942-models/tests/perf/remaster_explosions.mjs`
- `features/remaster-browser/shots/` (the composites above),
  `features/remaster-browser/AUDIO.md`
