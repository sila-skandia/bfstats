# rendering-level

## Summary

- MATCH: 24 groups (listed below)
- CODE-WRONG: 2 (1 medium, 1 low)
- LEDGER-WRONG: 1 (low)
- DELIBERATE: 4 (F6 and F7 also carry stale comments to rewrite)
- INCONCLUSIVE: 3

Not reached (time): the server-side citations in `level-statics.js` / `static-index.js`
(ObjectSpawner, SupplyDepot, Obstacle, ResponsePhysicsManager; SPAWN-*, COL-*, FF-*, OBS-*)
and `test-hooks-world.js` (HP-*, DMG-1, CA-5, SUP-*) were checked by symbol name only
(all names match lnxded.static); their laws belong to the spawn/collision/damage buckets.
Most of `bfmap.js` / `map-surfaces.js` (minimap, MMAP/MEME rows) checked for constants only.
`sample-instances.js` (sound, 0x008xxxxx sound code) not checked: sound bucket.

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [medium] Tree billboard swap uses 3D distance; retail uses horizontal (XZ) distance times the view's FOV factor
- Code: `tools/bf1942-models/viewer/tree-foliage.js:371-373` —
  `const dx = e[12] - camPos.x, dy = e[13] - camPos.y, dz = e[14] - camPos.z;`
  `const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * inv;`
- Ledger: VID-1 (swap distance = template `+0x108` x instance `+0x94` x renderer `+0x80`, band x `+0x84`) says nothing about the distance metric; features/tree-foliage-billboards/README.md "Engine render state" silent too.
- Third-party: `decompiled_functions_MacClient/dice_ref2_geom_TreeRenderer_drawTree.c:75-84` —
  `local_78 = tree.x - cam.x; local_70 = tree.z - cam.z; ... local_74 = 0.0;`
  `dVar10 = _sqrt(local_70*local_70 + local_78*local_78 + 0.0);` then `dVar11 = dist * renderView vt+0x18()`.
- Our binary: BF1942.exe `0x0064ddbd`..`0x0064ddfe` (TreeRenderer draw-tree, winpc address range of 0x0064dd10):
  `flds 0x30(%ecx); fsubs 0x30(%eax)` (dx), `flds 0x8(%ecx)` with ecx=+0x30 -> `+0x38`, `fsubs 0x8(%eax)` (dz); no `+0x34` (y) term;
  `calll *0x18(%edx)` (render view); `fmul dz,dz; fmul dx,dx; faddp; fsqrt; fmulp` (x the view's factor).
- Verdict reasoning: both dumps and our binary agree: the tree LOD/billboard distance ignores height. A camera high above a forest (aircraft, a hilltop) keeps full trees beneath it in retail; the viewer turns them to cards. The FOV factor (render view vt+0x18) is also missing (zoomed scopes keep geometry further out in retail).
- Fix: in `tree-foliage.js` `installHook`, `const d = Math.hypot(dx, dz) * fovFactor * inv;` (drop `dy`). For the FOV factor, reuse `mesh-cull.js` `fovModifier(camera.fov, camera.zoom)` if vt+0x18 is the same term as the mesh cull's vt+0x20 — that identity is unread; at minimum drop `dy`.

### F2 [CODE-WRONG] [low] Alpha-LOD (DL-12) near test uses plain d^2; retail compares selectLod's radius-adjusted `d^2/m - r^2`
- Code: `tools/bf1942-models/viewer/level-shading.js:781-782` — `const near = dx*dx + dy*dy + dz*dz <= entry.reach2;`
- Ledger: DL-12 — "whether the squared distance `StandardMesh_selectLod` `0x005adfd0` returned is at most the template's `+0x104` squared".
- Third-party: winpc dump has no function at 0x005adfd0 (recorpus: none); not used.
- Our binary: `0x005ae042`..`0x005ae056` selectLod's out-parameter: `fstps (%ebp)` d^2, `fdivs 0x60(%esi)` (m), `fsts (%ebp)`, `flds 0x4c(%esi)` (r), `fmul st1`, `fsubr %st(2),%st`, `fstps (%ebp)` -> out = d^2/m - r^2. drawLod `0x005aef09` passes `&[esp+8]` as that out; `0x005af10b`..`0x005af137`: `flds 0x104` (alphaLodDistance), squared, `fcompp` with the out, `jne` -> `push 1` (near) when out <= D^2.
- Verdict reasoning: retail's "near" is `d^2 <= m*(D^2 + r^2)`, i.e. slightly further than D for any mesh with a radius. For a 10 m fence at D=100 the edge moves ~0.5 m; m (max scale) can matter on scaled geometry.
- Fix: in `bindAlphaLod` keep `r` (origin radius, `mesh-cull.js` `originRadius`) and `m` per entry and test `d2 / m - r*r <= reach2`. DL-12 should say "selectLod's `d^2/m - r^2`" (see F3).

### F3 [LEDGER-WRONG] [low] DL-12 calls selectLod's output "the squared distance"
- Ledger: DL-12 (line 137) — "the squared distance `StandardMesh_selectLod` returned".
- Our binary: as F2 — the value is `d^2/m - r^2` (the same `e` LOD-7 and `mesh-cull.js` use).
- Fix: reword DL-12 to "`e = d^2/m - r^2`, the term selectLod writes to its out-parameter (`0x005ae056`)". Code does not follow either form exactly (F2).

### F4 [INCONCLUSIVE] [medium] Lens-flare sprite size: lnxded `buildFlare` multiplies `setFlareSize` by 25.0; the viewer multiplies it by the texture's pixel size
- Code: `tools/bf1942-models/viewer/lens-flare.js:122-131` — "`setFlareSize` multiplies the sprite's OWN texture size ... INFERRED", then `/600` virtual screen scaling (also INFERRED).
- Ledger: LOAD-28 — "writes each corner's position (the flare's screen position, size x 25)".
- Third-party: `decompiled_functions_bf42linuxServer/buildFlare.c` — `local_124 = *(float *)(iVar7 + 100) * _DAT_08680fe0; local_128 = _DAT_08680fe0 * *(float *)(iVar7 + 0x68);`
- Our binary: lnxded.static `LensFlare::buildFlare` 0x0820f8c0: `0x0820f94b flds 0x86ccce0` = **25.0** (readmem), `fmul` with size `+0x64` / `+0x68`. The client's flare region (0x0056f000..0x00571200) holds no 25.0 literal, so the client's own builder was not found.
- What would settle it: find the client's buildFlare (LensFlare::update's callee from vtable 0x008fca54's object) and read `shaders/FlareShader.vso` to learn the units the 25 is in (pixels of 800x600, clip units, or world). Placement (`screen = centre + (sun - centre) * scale`) is still not read either; same route.

### F5 [INCONCLUSIVE] [low] `StandardMesh_selectLod` early-outs not modelled
- Code: `tools/bf1942-models/viewer/mesh-cull.js` `selectLod` (whole function).
- Our binary: `0x005adfd4`..`0x005adffa`: `+0x134 != -1` returns `+0x134` (a forced LOD), and `+0xf0 == -1.0` (`0x00905434`) returns LOD 0 before any distance test.
- Reasoning: neither field's writer was read; if nothing on a static sets them they are inert (+0x134 initialised -1). Settle by reading the writers of mesh `+0x134` / `+0xf0`.

### F6 [DELIBERATE] [low] Tree fade band: code matches retail, but the FADE_SPAN doc comment is stale
- Code: `tree-foliage.js:59-62` — "Not an engine number: the engine cuts. 0.4 is the narrowest band ... centred on it." while the value is 0.5 and `:508-510` uses `[D*(1-0.5), D)`, and the README "Transition" section still says 40 %.
- Our binary: `0x0064dd82`..`0x0064de57`: band F = D x `+0x84` (0.5, ctor 0x0064ca30 per VID-1), f = (dist - (D-F))/F clamped 0..1; `vt+0x88` (= byte `+0x98`, getter `0x0064cb30`, ctor sets 1 at `0x0064cace`, i.e. `useNewBillboardFadeFunc` on) selects the sin/cos path (`fmuls 0x9182f0` pi, `fmull 0x8d1a58` 0.5, `0x0040bc70`); off it would be card f, geometry 1 - f^3 (`0x0064de8c`..`0x0064dea1`, pow 3.0 at 0x008eaa50). Mac `TreeRenderer_drawTree.c:97-117` agrees.
- Fix: keep the law; rewrite the FADE_SPAN comment and the README "Transition" paragraph (comment-only).

### F7 [DELIBERATE] [low] Stale Gazala example in `applyFar`
- Code: `level-sky.js:545` — "declared fogEnd beyond the view distance (Gazala: fog 500-850 vs VD 500)".
- Our binary: `renderer.fogEnd` `0x0045f530` stores only when `value < VD` (FOG-4); scene.json fog is now the client's resolved pair (`scene_layers.py:607-621`), so `fogEnd > drawDistance` cannot arrive and the `Math.max(draw, fogEnd)` is a no-op. Harmless; comment out of date.

### F8 [DELIBERATE] TEXTURE QUALITY 100 % as max anisotropy (no sampler LOD bias in WebGL) — `texture-quality.js:1-20`; documented in VID-5. Keep.
### F9 [DELIBERATE] `optGameFog` off / `optEntire` viewer-only fog and far-plane modes (`level-sky.js` applyFog/applyFar) — viewer aids, not game paths. Keep.

### F10 [INCONCLUSIVE] [low] `textureFade` band 20..55 m marked PROVISIONAL [free]
- Code: `level-shading.js:792-800`. Not attempted; the fade source (`+0x31` textureFade branch of `applyRenderState`, `0x005bfbcc`) would be the start.

## MATCH list
- VID-1 GRAPHICS (lodPercent 1/0.8/0.6, billboard scale 2/1.5/1, lodObjectFactor 1/0.5/0.3) -> `video-settings.js` GRAPHICS; binary `0x006b0e0d`..`0x006b0e82` (immediates 0x40000000/0x3fc00000/0x3f800000, 0x3f800000/0x3f000000/0x3e99999a, 0x3f800000/0x3f4ccccd/0x3f19999a).
- VID-2 EFFECTS 1/0.5/0.3 -> `video-settings.js` EFFECTS; `0x006b0eb5`/`0x006b0ec6`/`0x006b0ed8`.
- VID-3 env-map switch `0x9abf7a` -> `envmap.js` ENVMAP_SWITCH; `0x005bfaa6`.
- VID-4 lightmaps toggle -> `level-load.js:662`; `0x006b0e88`..`0x006b0ea0`, `0x006aef75`..`0x006aef8e`.
- VID-5 mip skip 3/2/1/0/0, bias -1.5 at 100 % -> `video-settings.js` TEXTURE, `texture-quality.js`; jump table `0x006aefb8` -> 0x6aef03/12/21/30/38, `0xbfc00000`.
- View distance setter caps at 100 (`0x006af061` `cmpl $0x64`) -> `video-settings.js:247` (50 lower bound is the edit box, UI).
- VID-6 level VD kept at +0x1c while -1 (`0x004427fc`..`0x00442809`) -> `level-sky.js` drawDistance/viewOverride.
- VID-8 presets -> `video-settings.js` PRESETS (per ledger; files not re-read).
- FOG-4 law (0.25 at 0x008d5c04, 50.0 at 0x008c3f48, `test ah,0x41` = strictly over 50) -> `video-settings.js` viewDistanceFog, `level-sky.js` applyFog.
- LOD-7 / mesh-cull law: e = d^2/m - r^2, k = percent x sizeFactor x fov, loop `test ah,5; jnp` (strict <), cull pad 2500 (0x009057b8), r < globalLodRadius gate (`0x005ae146` `test ah,0x41`), sizeFactor r/(scale x cullFactor) (`0x005ae0a6`..`0x005ae0af`), cullFactor 0.03 (`0x005b5c5c` 0x3cf5c28f), renderer ctor globalLodPercent 1.0 (`0x00640329`) -> `mesh-cull.js`.
- DL-1 / non-envmap stage 1 MODULATE(CURRENT, TFACTOR) (`0x005bfdcb`..`0x005bfe35`), stage 0 MODULATE2X(TEXTURE, DIFFUSE) and alpha SELECTARG1(TEXTURE) (`0x005c01e6`..`0x005c0201`) -> `level-shading.js`, `envmap.js`.
- EM envmap stage: gates `+0x30`, ctx+0x18, 0x9abf79, 0x9abf7a; TTFF 3, TCI 0x30000; COLOROP 0x10 BLENDCURRENTALPHA(CURRENT, TEXTURE); ALPHAOP SELECTARG1(CURRENT) (`0x005bfa80`..`0x005bfcfd`) -> `envmap.js`, `model-envmap.js`.
- Envmap left out while shaded: `0x9abf79` = 1 unless intensity +0x138 >= 255 (`0x005af032`..`0x005af046`) -> `level-shading.js` bfShade.w (set only when intensity < 255, `:702`, `:710`).
- LM-4 lightmap combine stage 1 MODULATE2X(CURRENT, TEXTURE), skipped when textureFade (`0x005bfbcc`..`0x005bfc49`) -> `level-shading.js`.
- DL-10/DL-11 getObjectIntensity: origin >= 100 (0x008c3e80) -> 255 (0x008d1a70); fan of 5 at 1.1 radii (0x008eb638) at -22.5/-13.5/-4.5/4.5/13.5 deg (`0x00504c1e`..`0x00504da7` immediates); mean of shadowed by integer division only when dark > lit (`0x00506a14`..`0x00506a2a`) -> `terrain-shade.js` objectIntensity.
- DL-12 default alphaLodDistance 100 (`0x005b5c28` 0x42c80000) -> `level-shading.js:734`.
- TERR-15 terrain stages: stage 1 ADDSIGNED (op 8) TEXTURE/CURRENT, only with a detail texture (`+0x15c`), lighting off (`0x00683609`) -> `level-shading.js` bindTerrainDetail.
- TERR-14 detail mip bias -1.5 on stage 1 (`0x006836a3`..`0x006836ad`) -> `level-shading.js:112`.
- TERR-12 stage 0 address CLAMP (3), stage 1 WRAP (`0x00683610`, `0x00683648`) -> `terrain-tile-wrap.js`.
- TERR-6 HeightMap::getSample wraps by mask (`0x0062f9f0`: `and +0x28`, `shl +0x24`) -> `level-edge.js`.
- TERR-3 32 detail repeats per patch -> `level-shading.js:111` (per ledger; 0x00699650 not re-read).
- MMAP-1 open ease -9.0 (0x008d6294), zoom ease -6.0 (0x008d628c) with snap |d| < 0.01 (`0x00469226`..`0x00469243`), crop base 2.3 (double 0x008d62a0), 0.5 (0x008c4220), 1.0 (0x008c53c8), 0.8 (0x008d6290), art offset tables 0x0095771c / 0x009576f8 -> `bfmap.js`, `map-surfaces.js`.
- Tree fade law (sin/cos with useNewBillboardFadeFunc on by default; band [D - D/2, D)) -> `tree-foliage.js` (only the distance metric is wrong, F1).
- Server symbol names: 0x083140a0 spawnObject, 0x083138c0 handleFrameUpdate, 0x08314880 reset, 0x08323dc0 workOnSoldiers, 0x08323f10 workOnVehicles, 0x08315e10 Obstacle::handleCollision, 0x0825d820 checkObjectVsObjects, 0x0820f8c0 buildFlare, 0x08212720 setFlareSize, 0x08212990 setCoronaSize -> `level-statics.js`, `static-index.js`, `level-load.js`, `lens-flare.js`.

## Fix-phase results (2026-11-12)

### F1 fixed — and the FOV term is getFieldOfView, not the mesh cull's modifier
Render view vtable `0x00905c98`: slot +0x18 = `0x005b7cb0` `flds [ecx+0x24]; ret` (the raw FOV, radians, that `setFieldOfView` 0x005b7b40 stores at `0x005b7c89`), slot +0x20 = `0x00836030` `flds [ecx+0x1c]` (the modifier the mesh cull uses). Mac dump agrees by name: `dice_ref2_rend_RenderView_getFieldOfView.c` returns `this+0x24`, `getFieldOfViewModifier.c` returns `this+0x1c`. So the tree swap distance is `hypot(dx, dz) x fov_radians` (1 at VideoDefault's 1 rad lens; a zoomed lens keeps trees whole further out).

### F4 still INCONCLUSIVE — new evidence
- `shaders/FlareShader.vso` (Mods/bf1942/Archives/shaders.rfa), vs_1_1, decoded: `r5.xy = v7.xy; r7 = r5*v8.y; r8 = r5*v8.x; r9.x = r7.x + r8.y; r9.y = r7.y - r8.x; oPos.xy = v0.xy + r9.xy; oPos.z = v0.z; oT0.xy = v9.xy; oD0 = v5`. No constants, no transform: the vertex position is already in clip space and the corner offset (vertex +0x10/+0x14) is added to it after a rotation by (sin, cos) at +0x18/+0x1c; oPos.w is never written.
- lnxded `buildFlare` fills those: corner = +-(size x 25.0) (0x086ccce0), position = the flare's +0x18..+0x20 (written by `updateScreenPos`, a stub on the server, `0x082167D0` in the 1.61 dump), colour x intensity `+0x148`.
- Corner offsets of 25 x size (12.5 to 125) cannot be clip units with w = 1, so either the client's builder differs or the client's position/w carries a pixel scale. The client's own builder was not found: no `fsin`, no 25.0 literal (`0x41c80000` immediates exist only far from flare code) in 0x0056e000..0x00571400, and Mac `LensFlare::handleUpdate` is an empty stub. Still unread: the client's flare vertex writer (search for writes into `[LensFlareGeom+0x108] + i*0xa0`; LensFlare holds its geom at +0x120, `0x0056f57e`). No code change.

### F5 SETTLED (no code change) — and my first reading of +0xf0 was backwards
- `+0xf0`: the StandardMesh ctor writes -1.0 (`0x005afbb7` `mov ecx,[0x905434]`, `0x005afbc4`). selectLod `0x005adfe3`..`0x005adff4`: `fcomps -1.0; test ah,0x44; jnp continue` — selection runs when `+0xf0 == -1` (the default) and returns LOD 0 otherwise. drawLod (`0x005aef80`..`0x005aef9a`, `0x005af44a`..`0x005af466`) treats a non-(-1) `+0xf0` as "this mesh carries its own transform at +0xf4" and loads it on the device. No other writer in the StandardMesh code (0x005a0000..0x005c0000). Inert for level statics.
- `+0x134`: ctor -1 (`0x005afbd1`). Written only inside the mesh's other draw `0x005b06d0` (the object-lightmap/shadow pass, needs `+0x18c` and template `+0x298`): `0x005b0758` and `0x005b07da` (selectLod at percent x 0.05), and put back to -1 on every exit that set it (`0x005b0f9f`, `0x005b1019`, `0x005b10b3`, `0x005b1410`). Transient within that pass; the colour pass sees -1. Nothing for the viewer to model.

### F10 SETTLED and fixed — the textureFade law
- `StandardMesh_drawLod` `0x005af13a` `testb $0x4,0x48(%ebx)` takes the textureFade branch; `0x005af140`..`0x005af194`: `D = [template+0xa0]`, if `e > D^2` the TFACTOR alpha is 255, else `trunc(255 x max(e, 0) x [template+0xa4])`, with `e` selectLod's out-parameter (`d^2/m - r^2`, as F2) and `+0xa4 = 1/D^2`.
- `+0xa0` is `GeometryTemplate.textureFadeMaxDist`: console property name `0x00907c9c` (object ctor `0x005c8fb0`), getter via template slot +0x38 `0x005b5e40` `flds [ecx+0xa0]`, setter slot +0x34 `0x005cd100` (`+0xa0 = D`, `+0xa4 = 1/(D*D)`), constructor default **200.0** (`0x005b5bd9` `0x43480000`, `+0xa4` from it at `0x005b5cc8`..`0x005b5cd8`).
- .con survey (Mods/bf1942/Archives/Objects.rfa): 65 geometries set it: 57 at 70, 4 at 80, 4 at 100 (the houses: `afr_house1_ste_M1` ...).
- The old viewer band (linear in d, clear under 20 m, sealed past 55 m) was free; retail is linear in d^2 from 0 to D.

## Fixes applied

- **F1** `tools/bf1942-models/viewer/tree-foliage.js`: new exports `viewFieldOfView(fovDeg, zoom)` (three's vertical FOV narrowed by zoom, radians) and `billboardJudgedDistance(dx, dz, fovRad, scale)` = `hypot(dx, dz) x fov / scale`, cited to 0x0064ddbd..0x0064ddfe and 0x005b7cb0; `installHook` uses them (no `dy`). Test: `tests/video_settings_harness.mjs` + `tests/test_video_settings.py` `test_the_tree_swap_distance` (new).
- **F6** `tree-foliage.js` FADE_SPAN comment rewritten (band [D - D x billboardFadeScale, D), sin/cos path, addresses); `features/tree-foliage-billboards/README.md` "Transition" section rewritten (cross-fade not cut, [D/2, D), horizontal distance x FOV, the 1 - t^3 alternative).
- **F2** `tools/bf1942-models/viewer/level-shading.js`: new export `alphaLodNear(d2, m, r2, reach2)` = `d2/m - r2 <= reach2`; `bindAlphaLod` takes `r`, `m` from `level-statics.js` `meshCullSpec` on the geometry node (fallback: the mesh's own box radius, m = 1) and the geometry node's origin; `updateAlphaLod` uses it. Imports `originRadius` (mesh-cull.js) and `meshCullSpec` (level-statics.js). Test: `tests/level_lod_shading_harness.mjs` + `tests/test_level_lod_shading.py` `test_the_alpha_lod_reach_is_on_selectlods_e` (new).
- **F10** `level-shading.js`: FADE_NEAR / FADE_FAR [free] removed; new export `textureFadeAlpha(d2, m, r2, maxDist)` = `trunc(255 x clamp(e/D^2))/255`; `bindTextureFade` records `r`, `m` (as F2) and `D` = `page.extras.textureFadeMaxDist[geometry]` when the scene carries that key, the engine's 200 when the key exists but names no such geometry, and **70 when the key is absent** (every current bake) — an interim documented in the comment as the vanilla buildings' own setting, not an engine number. Test: `test_a_texture_fade_plane_is_linear_in_selectlods_e` (new). **Follow-up outside my files:** `scene_layers.py` should write `textureFadeMaxDist` (lower-cased geometry -> metres) the way it writes `alphaLodDistance`; then the 70 fallback goes.
- **F7** `tools/bf1942-models/viewer/level-sky.js` applyFar comment: the Gazala example replaced by the FOG-4 reason the max is a no-op on current bakes.
- **F3** ledger text below. **F4**, **F5**: no code change (above).

Tests run (from `tools/bf1942-models`):
- `python3 -m unittest tests.test_video_settings tests.test_level_lod_shading tests.test_cockpit_light tests.test_terrain_shade tests.test_proving_ground tests.test_treemesh tests.test_lens_flare` — 127 tests OK (1 skipped).
- `python3 -m unittest tests.test_chase_camera tests.test_deploy_spots tests.test_hud tests.test_hud_layout tests.test_idle_vehicle tests.test_lift_lods tests.test_mesh_cull tests.test_replay_resilience tests.test_room tests.test_round_spawners tests.test_soldier_skin tests.test_swim tests.test_test_hook_vehicles tests.test_vehicle_pads tests.test_vehicle_respawn tests.test_viewmodel_level_skin tests.test_scene_layers tests.test_terrain_heightmap` (everything that loads level-shading / level-statics / tree-foliage / level-sky) — 395 tests OK (4 skipped).
No existing test expectation changed.

## Ledger edits

**DL-12** (replace the phrase in the evidence column):
> ... sets the shader context's byte `+0xa8` ... to whether **the `e = d^2/m - r^2` that `StandardMesh_selectLod` `0x005adfd0` writes to its out-parameter (`0x005ae042`..`0x005ae056`: d^2, divided by the mesh's `+0x60`, minus its `+0x4c` squared)** is at most the template's `+0x104` squared (`0x005af108`..`0x005af137`).
Code column: `viewer/level-shading.js` `alphaLodNear` (since 2026-11-12; before, the plain squared distance).

**VID-1** (append to the evidence column):
> Tree distance (2026-11-12): `0x0064ddbd`..`0x0064ddfe` takes `sqrt(dx^2 + dz^2)` (translation +0x30 and +0x38, no +0x34) times the render view's `getFieldOfView` (vt `+0x18` of vtable `0x00905c98` = `0x005b7cb0`, `flds [+0x24]`, the raw FOV in radians; not the `+0x1c` modifier at vt `+0x20`). Band `F = D x [+0x84]`; with `[+0x98]` (`useNewBillboardFadeFunc`, getter `0x0064cb30` = vt `+0x88`, ctor 1 at `0x0064cace`) geometry `cos(pi/2 t)`, card `sin(pi/2 t)`; otherwise card `t`, geometry `1 - t^3` (`0x0064de8c`..`0x0064dea1`). Mac `TreeRenderer::drawTree` lines 75-117 agree. Code: `tree-foliage.js` `billboardJudgedDistance`.

**New row DL-13** (or append under DL-12):
> | DL-13 | (new, 2026-11-12) **A `textureFade true` material's alpha is `clamp(e / textureFadeMaxDist^2, 0, 1)`: clear at the mesh, solid from `GeometryTemplate.textureFadeMaxDist` out (200 m unless a script says otherwise; vanilla's houses say 70), linear in selectLod's `e = d^2/m - r^2`** | `viewer/level-shading.js` `textureFadeAlpha`, `bindTextureFade` (70 m for every plane until scene.json carries the per-geometry key) | **verified** (code read) | `StandardMesh_drawLod` `0x005af13a` (material flag bit 4 of `+0x48`) -> `0x005af140`..`0x005af194`: `e > D^2` gives TFACTOR alpha 255, else `trunc(255 x max(e,0) x [template+0xa4])`. Template `+0xa0` = `textureFadeMaxDist` (name `0x00907c9c`, property object `0x005c8fb0`; getter slot +0x38 `0x005b5e40`; setter slot +0x34 `0x005cd100` writes `+0xa0 = D`, `+0xa4 = 1/D^2`); ctor `0x005b5bd9` 200.0, `+0xa4` from it at `0x005b5cc8`. Objects.rfa: 65 geometries set it (57 x 70, 4 x 80, 4 x 100). |

**LOAD-28** (append): `shaders/FlareShader.vso` decoded (vs_1_1): `oPos.xy = v0.xy + rot(v7.xy by v8 = (sin, cos))`, `oPos.z = v0.z`, `oT0 = v9`, `oD0 = v5`; no constants, oPos.w unwritten — the position arrives in clip space. lnxded `buildFlare` writes corner = +-(size x 25.0) (`0x086ccce0`). The client's own vertex writer is still unread; 25 x size in clip units would be off screen, so its units are open.

**LOD-7** (append): selectLod's early-outs: mesh `+0x134 != -1` returns it (a forced LOD written only inside the shadow/lightmap pass `0x005b06d0`, `0x005b0758` / `0x005b07da`, and reset to -1 before that pass returns); mesh `+0xf0 != -1.0` returns LOD 0 (ctor -1.0 at `0x005afbc4`; drawLod reads a non-(-1) `+0xf0` as an own transform at `+0xf4`, `0x005aef80`). Neither applies to a level static.

## Fix-phase 2 (2026-11-12)

### F10 interim removed: `textureFadeMaxDist` exported, viewer fallback 200
- `tools/bf1942-models/scene_layers.py`: `materials` layer now also writes `textureFadeMaxDist` (lower-cased geometry -> metres, only where a `.con` sets `GeometryTemplate.textureFadeMaxDist`; first declaration wins, as `alphaLodDistance`), new `texture_fade_max_distances(objects)`; key appended to `REPORT_ORDER` (after `fireOnce`).
- `tools/bf1942-models/viewer/level-shading.js`: the 70 m interim is gone; a geometry the key does not list, and every plane of a scene without the key, takes the engine's 200 (`0x005b5bd9`).
- `features/level-bake-layers/README.md`: `materials` row and the change -> layer table list the key.
- Tests: `tests/test_scene_layers.py` new `test_lists_each_geometrys_texture_fade_distance`, `layer_materials` empty-case expectation gains `"textureFadeMaxDist": {}`, `REPORT_ORDER[-4:]` -> `[-5:]` with the new key; `tests/test_terrain_heightmap.py` `REPORT_ORDER[-9:]` -> `[-10:]` with the new key. These three expectations encoded the key list/order and changed only because a key was added.

### Blast radius
Layer: **`materials`, scene.json only** (no glb, no image). Measured with `<scratch>/findings/rendering-level-blast.py` (per maps.json row: the level's placed objects from `StaticObjects.con`/`ObjectSpawns.con`, children expanded, geometries whose `.rs` says `textureFade true`, grouped by D; an approximation of what the bake places, by geometry not by instance):
- vanilla `viewer/maps` (100 rows): 70 levels place textureFade planes; **57 carry a geometry whose D is not 70** (80, 100, or the default 200): _o_Jka__BIG A_Sliver_of_Hope Aberdeen Attack_on_Pearl_Harbor Battle_of_Britain Battle_of_the_Bulge beinbrekkbakken Bocage Coral_sea Densloe_Practice downhill_to_the_beach_two El_Alamein Gazala giza GuadalCanal Highway_Tampa Invasion_of_the_Philippines Iwo_Jima Jeep_Race___ Jeep_Racing JeepRace Kharkov kingof_thehill KoH Kursk Liberation_of_Caen Market_Garden Midway Oahu Omaha_Beach Omaturi_Channel_Cannon Omaturi_Channel_Sniper Omaturi_Channel_Sniper_day2 parcours_challenge parcours_challenge_simplified quest_for_adventure RallyRace Rennpiste_Gebirge shigaisen_A shigaisen_B shigaisen_D sniper_challenge Stalingrad Tanquilizer The_AirPort The_Fortress The_Room The_Street The_Street_day2 The_Street_G TL_Race Tobruk vxf_stunts_one Wake waterworld XhAOS_KART_RACE Xhaos_Lake (3 rows have no archive in the install: Kasserine_Pass, strasbourg, Truk).
- `mods/bf1918` (133 rows): 124 with planes, **104 with a D != 70** (list in the script's output; nearly every level).
- `mods/fhsw` (140 rows, all with `loading`): 133 with planes, **123 with a D != 70**.
- `mods/gcmod` (30 rows): no textureFade planes; nothing changes.
- Against what the page drew before this session (the free 20..55 m band), every level with a plane changes: 70 vanilla, 124 bf1918, 133 FHSW.
- Not measurable here: XPack1, XPack2, EoD, DC, DC Final, FH, FHSWEurope, bf1919 — this checkout's `viewer/maps/mods/` has no `maps.json` for them (the local tree holds only bf1942 metadata + 2 levels, bf1918, fhsw metadata, gcmod, and empty eod/desertcombat). Their published trees need the same patch where they are kept.

## Scene patches
- **Patched** (from the repo root, `--layer materials`, the only key changed in each file was `textureFadeMaxDist`, appended last):
  - `python3 tools/bf1942-models/patch_scene.py --layer materials --mod bf1942 --all` -> 2 scene.json written: `viewer/maps/wake/scene.json`, `viewer/maps/battle_of_britain/scene.json` (the only vanilla levels with a scene.json in this checkout; the other 98 maps.json rows have no level directory here). Wake's key: 65 geometries, values {70, 80, 100}.
  - `python3 tools/bf1942-models/patch_scene.py --layer materials --mod bf1918 --all` -> 133 of 133 scene.json written, 136.6 s (`viewer/maps/mods/bf1918/*/scene.json`).
- **Not patched**:
  - `mods/fhsw`: no level directories in this checkout (maps.json only). Run where the FHSW tree lives: `python3 tools/bf1942-models/patch_scene.py --layer materials --mod FHSW --all` (and `--mod FHSWEurope --all`).
  - `mods/gcmod`: no planes, and another session's `mod_pipeline.py run --mod GCMOD` was writing that tree while I worked; not touched.
  - The 98 vanilla levels absent here, XPack1, XPack2, EoD, DC, DC_Final, FH: same command with their `--mod`, wherever those trees are.
- **Publish** (not run): `python3 scripts/publish-mesh-delta.py maps --hash` (from the repo root) for the bf1942 and bf1918 trees, after any further patching.
- Caution for the coordinator: the vanilla tree in this checkout was rewritten at 07:55-07:58 today by another process (only Wake and Battle of Britain present) — check that is intended before publishing from it.

### Step 2: SUP-4 depot phase wired
- `tools/bf1942-models/viewer/level-load.js`: imports `depotPhase`; new export `depotStartPhase(random = Math.random)` = `depotPhase(() => floor(random() * 0x8000))` (`(rand() % 30) / 30`, rand's 15-bit range); `collectSupplyDepots` passes `phase: depotStartPhase(page.random ?? Math.random)` to every `SupplyDepot`, once per depot per level load. Deterministic under the headless runner, which seeds `Math.random` (`sim/env.mjs` `seedMathRandom`); the sim builds no depots itself (`sim/stage.mjs`, `sim/level.mjs` have none), so no baseline moves.
- Test: new `tools/bf1942-models/tests/test_level_depot_phase.py` (phase on the 1/30 grid in [0, 29/30], 30 wraps to 0, a seed repeats and spreads, every level depot is given one).

Tests run (from `tools/bf1942-models`): `tests.test_scene_layers tests.test_terrain_heightmap tests.test_level_lod_shading` 49 OK (1 skipped); `tests.test_level_depot_phase tests.test_supply tests.test_foot_rearm tests.test_depot_rearm tests.test_bot_level_switch tests.test_proving_ground tests.test_level_lod_shading` OK; `tests.test_world tests.test_kit_ammo tests.test_round_spawners tests.test_room tests.test_swim tests.test_idle_vehicle tests.test_vehicle_pads tests.test_scene_layers tests.test_terrain_heightmap tests.test_supply` 252 OK (1 skipped).

### Ledger edits (additions)
- **DL-13** (the row drafted above): code column -> `scene_layers.py` `texture_fade_max_distances` (the `materials` layer's `textureFadeMaxDist` key); `viewer/level-shading.js` `textureFadeAlpha`, `bindTextureFade` (200 where the key names no such geometry). Drop "70 m ... until scene.json carries the per-geometry key".
- **SUP-4** (append): "`level-load.js` `collectSupplyDepots` gives every level depot `depotStartPhase()` (2026-11-12): the page's `random`, else `Math.random`, seeded in the headless runner."

## Fix-phase 3: fallback refinement
- `viewer/level-shading.js`: new export `textureFadeMaxDistFor(table, geometry, fallback = 200, unpatched = 70)`. A scene that carries the `textureFadeMaxDist` table: the geometry's value, else the engine's 200 (`0x005b5bd9`); a scene with no table: the 70 m interim (`FADE_MAX_DIST_UNPATCHED`), commented as an interim for trees not yet patched (FHSW, FHSWEurope; installs on the Linux PC). `bindTextureFade` uses it.
- Test: `tests/level_lod_shading_harness.mjs` + `tests/test_level_lod_shading.py` (`listed` 80, `unlisted` 200, `emptyTable` 200, `noTable` 70). `tests.test_level_lod_shading tests.test_cockpit_light tests.test_proving_ground tests.test_scene_layers`: 109 OK (1 skipped).

## Live stage
Staging root: **`<scratch>/fade-stage`** (holds `maps/` with 6 `maps.json` and 568 `scene.json`, nothing else).
Publish (not run): `scripts/publish-mesh-delta.py --root <scratch>/fade-stage maps --hash`

Method: `fade-fetch.sh` (scratchpad) curls each tree's `maps.json` from https://mesh.bfstats.io and every row's `<dir>/scene.json` (dir from the row's `glb`), keeping a pristine copy under `fade-orig/`. The `materials` layer reads only `scene.json` plus the install's archives, so nothing else was fetched. `patch_scene.py --tree <stage tree> --mod <M> --layer materials --all` (default wine install; vanilla's 79 community levels with `--game-dir ~/.cache/vimpact-game`, which holds them), then `fade-diff.py` json-diffs each pair key by key.

| Tree | Levels fetched | scene.json changed | Only the new key? | Not patched (no level archive in the install, left as fetched) |
|---|---|---|---|---|
| `maps` (bf1942, incl. community) | 100 | 97 | yes | Kasserine_Pass, strasbourg, Truk |
| `maps/mods/xpack1` | 29 | 27 | yes | kasserine_pass, truk |
| `maps/mods/xpack2` | 32 | 30 | yes | kasserine_pass, truk |
| `maps/mods/bf1918` | 133 | 133 | yes | none |
| `maps/mods/eod` | 239 | 237 | yes | kasserine_pass, truk |
| `maps/mods/desertcombat` | 35 | 35 | 32 yes; 3 also carry the materials layer's ordering fix (see Held trees, staged) | none |
| `maps/mods/fh` | 10 | (9 would change) | **no: held, not in the stage** (`fade-held/fh`) | road_to_ramelle |

Skipped: dc_final (deleted remotely), gcmod (no textureFade planes; another session writing it), community (no tree of its own: its levels are rows of vanilla's `maps.json`, staged there), FHSW / FHSWEurope (installs not on this Mac). Those unpatched trees draw with the viewer's 70 m interim.

## Held trees

### desertcombat — (a) a deliberate exporter fix live never got; STAGED with the full materials layer
- Differences: `dc_weapon_bunkers` (`mil_fence1_m1_material2/3` in live `alphaBlend` and `depthWriteOff`), `dc_operation_bragg` and `dc_sea_rigs` (`materialDiffuse`, e.g. `nfz-clouds1_m1_material0` 1.0 live vs 0.5 now).
- Cause: two level archives declare the same `.rs` block. `DC_Weapon_Bunkers.rfa` has its own `mil_fence1_m1.rs`, where Material2 is opaque. `DC_No_Fly_Zone.rfa` has one where Material2 is `transparent true; depthWrite false`. `DC_Operation_Bragg.rfa` has `NFZ-clouds1_m1.rs` at `materialDiffuse .5`, No Fly Zone's at 1. Before **a6616d7ed** (2026-10-17, "fix(extract): a level's tree meshes mount like its standard meshes ..."), `layer_materials`'s `nearest_first` ranked every `/levels/` block alphabetically, so `dc_no_fly_zone` beat the level's own archive. The commit says: "layer_materials now ranks a block the level's own archive declares ahead of another level's". Live DC was baked before it and was never re-patched for that layer.
- Proof: the three live files patched with the pre-a6616d7ed key (`(0 if "/levels/" not in low else 2, low)`, exec'd into a copy of the module, nothing edited) differ from live ONLY by `textureFadeMaxDist`. So every other difference is exactly that commit.
- Action: `fade-held/desertcombat` moved back into the stage. All 35 levels publish with the current materials layer: 32 gain only the key, 3 also get a6616d7ed's ordering.

### fh — neither (a) nor (b): this Mac's FH install is smaller than the one live was baked from; HELD
- Differences in 9 levels: 171 material entries that live has and the current bake does not (`alphaBlend`, `depthWriteOff`, `materialDiffuse`; e.g. pegasus' `nightvisionscope_m1_material0`, `sdkfz251-1nightvision_m1_material0`, `su85_*`, `su122_*`, `krupp_*`, `vampyre_m1`). The bake produced **no** entry live lacks, and no value disagrees: live is a strict superset.
- Cause: those blocks come from "other levels' archives" (`extract_map.mount_level_pools` mounts every level archive of the chain to fill names nothing nearer declares). This install's `Mods/FH/Archives/bf1942/levels` holds 60 level archives. `features/fh-mod-extraction/README.md` records the bake's install at 80. None of the missing `.rs` files exists in any FH or bf1942 archive here (searched the whole install: `nightvision*.rs` nowhere, `krupp_smkstk_m1.rs` only in XPack2, FHSW and bf1918). No exporter commit is involved: the shader-order code that would matter is a6616d7ed, and it only reorders, never drops.
- Action: none here. Re-run `patch_scene.py --layer materials --mod FH --all` on the machine with the full FH install (the Linux PC), or bring that install's 20 missing level archives here. Publishing this Mac's FH patch would delete 171 live material entries. A key-only merge (add `textureFadeMaxDist`, keep live's other keys) is possible, but its values would still come from this install's `objects.rfa`. Not done without the owner's call.

### Ledger / doc notes
- None for the ledger.
- `features/fh-mod-extraction/README.md` should note that the Mac's FH install has 60 of the 80 level archives, so FH layer patches belong on the Linux PC. Not edited: outside the fix list.
