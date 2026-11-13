# render

## Summary

Rows (29): BUILT 15, NOT-GAME 10, PARTIAL 2 (TERR-8, WATER-3), DIFFERENT 1 (WATER-2), MISSING 0, UNREAD 1 (FHR-9).
Sweep (no ledger row, or only VID-7's "not built"): MISSING 4, DIFFERENT 1, PARTIAL 1, UNREAD 2.

Top findings by impact:

1. MISSING, high: **every authored ambient and motion emitter baked into a vehicle or a static is hidden on the play page and never runs**: tank and jeep wheel dust, aircraft wheel dust and water-touch spray, boats' bow waves and wakes, Stalingrad's ten and Omaha's four burning-building smoke columns, factory chimney smoke on El Alamein, Tobruk, Gazala, Anzio and Peenemunde. `idle-vehicle.js` `idleFirePose` hides every node carrying `userData.effect`.
2. MISSING, high: **dynamic shadows**. Soldiers, vehicles and hand weapons cast none. 244 `hasDynamicShadow 1` lines in vanilla, plus `shadow.shadowColor` on 39 levels. VID-7 records the gap, and nothing has been built.
3. MISSING, medium: **wind sway of trees**. 23 vanilla tree geometries set `swayEnable 1`. `tree-foliage.js` has no sway.
4. MISSING, medium for mods (none for vanilla): **weather**. 42 mod levels place rain or snow statics. Vanilla places none. The rain and snow statics carry an effect bundle (`e_snowfall` and the like), so they fall under finding 1's hide. The client's `WeatherParticleSystem`, `RainParticle` and `SnowParticle` are never reached.
5. DIFFERENT, low: the sea's swell (`waveHeight`) is a made-up two-sine wave, and the depth colour (WATER-2) is per pixel where retail uses a per-vertex 17 x 17 grid.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [MISSING] [impact: high] [effort: M] Vehicle motion emitters and placed-static smoke never run on the play page
- Retail: a vehicle's Physics.con and Objects.con hang EffectBundles on its wheels, tracks and hull as children. Vanilla census of Objects.rfa `addTemplate e_*` under Vehicles:
  - land vehicles: `e_wdustPanz`/`e_wdustPanzL` 27 each (tank tracks), `e_wdustWheelF`/`FL` 19 each, `e_wdirtWheel` 4
  - aircraft: `e_wdustPlane`/`PlaneL` 26 each, `e_WaterTouchPlane` 24
  - ships: `e_waterBoatSvall`/`Narrow`/`Sub` 5/9/4 (wakes), `e_WaterFront*` and `e_WaterBack*` (bow and stern wash on Elco, Daihatsu, Enterprise, Fletcher, Gato and the rafts), `e_water*dive` (Gato)

  Each of these is an emitter driven by speed (`intensityAtSpeed`), filtered by surface (`addWorkOnMaterial`, a dozen terrain ids on `e_wdustPanz`) and gated by depth (`min/maxDistanceUnderwaterSurface`). The engine's clock is `Emitter::handleUpdate` (lnxded 0x081e3200), with intensity scaled by speed. Statics carry the same kind of bundle: `factory_m1` has `e_ExFumeFact` (2 each on El Alamein, Tobruk and Gazala, 1 each on Anzio and Peenemunde), `BuildingSmokeIdleDark` (Stalingrad 10, Omaha Beach 4), plane wrecks and scrap metal carry `e_ScrapMetalSmoke`, and `WaterShoreSvall` (shore surf) exists but no vanilla level places it.
- Ours: the bake keeps these bundles in the vehicle and level glbs (`bf42/assemble.py` `_effect_bundle_node`, extras `effect: {kind: "bundle"}`). On load, `level-load.js` calls `idleFirePose` (`idle-vehicle.js`, `IDLE_PAYLOAD_KEYS = ['effect', ...]`), which hides every one of them. The comment there reads "only the model viewer animates them". Nothing plays them afterwards. A grep for `wdust`, `waterfront`, `workOnMaterial` or `intensityAtSpeed` callers finds only `effects-core.js` `EmitterClock.interval`, which already scales by speed. `effects.play(..., {attach})` is called only for damage tiers (`vehicle-wrecks.js`), soldier armour effects, trails, rocket flames and spawn effects. Only `e_WaterTorpedo` is played (`torpedo-run.js`).
- A player notices: on every map. Tanks and jeeps raise no dust trail, a landing plane throws no dust or spray, a boat leaves no wake or bow wave on Wake, Midway or Coral Sea, and Stalingrad's burning city and the factory chimneys stand without smoke.
- To build: at vehicle and level load, collect the baked bundle nodes instead of hiding them. Give each one an attached `EffectPlayer` run, as `vehicle-wrecks.js` does for damage tiers. Feed the run the host's speed: the wheel's or hull's tangent speed for `intensityAtSpeed`. Gate it on the ground material under a wheel (`collision-materials.js`, from `addWorkOnMaterial`) and on the depth below the sea plane for water bundles. Placed statics' bundles loop from level start. Files: `idle-vehicle.js`, `vehicle-base.js` or `vehicle-instance.js` (a per-tick speed hook), `level-load.js`/`level-statics.js` (placed bundles), `effects.js` (attach a looping bundle with a live speed getter; it already has an `attach.velocity` getter). Before building, check how many of the baked bundles the shared library resolves by name.

### [MISSING] [impact: high] [effort: M] Dynamic object shadows
- Retail: `fx::ShadowManager` (Mac dump: `init` builds a pool of 128x128 render-target shadow textures; `drawVisible` gathers objects flagged `0x2000082` within 50 m (`0x4049000000000000`) of the camera, then `generate` renders each into its texture with fog off and `apply` projects it onto the ground). The pass is gated by SHADOWS (game `+0x4d0`, VID-7, client frame `0x00466b28` -> `0x005b8a00` light direction, `0x005b93d0` shadow texture build). Each object opts in with `hasDynamicShadow 1`: 244 lines in vanilla (ObjectTemplate 149, GeometryTemplate 117; vehicles, soldiers and hand weapons). The level sets the colour with `shadow.shadowColor` (39 lines). VideoHigh turns it on; VideoLow turns it off (VID-8).
- Ours: none. `console-commands.js:348` registers `setShadows` as a no-op ("the viewer draws no dynamic shadows (VID-7)"). The renderer's `shadowMap` is never enabled on the play page; only `ctf-page.js` sets `castShadow`. Statics' shadows come only from the lightmaps and the terrain shade bits (DL-10/DL-11, built).
- A player notices: at once and everywhere. A plane low over the sand, a tank or a running soldier has no shadow under it, so heights and contact with the ground read poorly. With SHADOWS on (the HIGH preset), retail draws these.
- To build: the cheap close match is one projected blob or silhouette per `hasDynamicShadow` object within 50 m: render the object's silhouette from the sun direction into a small texture and project it onto the terrain, as retail does. A three.js directional shadow map that follows the camera, receive-only on the terrain, would also do. Read the `hasDynamicShadow` flag into the bake extras and `shadow.shadowColor` into scene.json, then tie the effect to the SHADOWS row in `video-settings.js`. Before tuning, confirm the 50 m radius and the 128 px size in our client: the numbers above come from the Mac dump, not yet from BF1942.exe (VID-7 calls the pass "unread").

### [MISSING] [impact: medium] [effort: S] Tree wind sway
- Retail: `geom::Swayer::update` (Mac dump) builds a sway matrix per tree. It adds two sines: `sin(2pi * period * t + phase)` times `swayRangeDegrees`, and a second force term (`swayForcePeriodSeconds`, `swayForceRangeDegrees`) along `swayDirection`, scaled by `swayWindFactor`. `TreeRenderer` holds `swayEnable`, `swayLodDistance` and `swayFadeFactor`, so the sway fades out with distance. Vanilla sets `swayEnable 1` on 23 tree geometries (`EU_pine1_M1` and others), and 22 of them `swayRangeDegrees 1.1`. `CollisionSwayer::applySwayForce` exists too, but no vanilla template sets `collisionSwayEnable` or `bushSwayEnable`.
- Ours: `tree-foliage.js` and `bf42/treemesh.py` have no sway. A `git grep -i sway` over the viewer finds nothing.
- A player notices: on the European maps' pines, which stand perfectly still where the game rocks them about a degree. Subtle.
- To build: export the `sway*` words into the tree extras, then add a vertex-shader rotation about the trunk base in `tree-foliage.js` using the two-sine law, faded by `swayLodDistance`. Read the Swayer in BF1942.exe (find it by its string names) before fixing the constants.

### [MISSING] [impact: medium (mods), none (vanilla)] [effort: M] Weather: rain and snow
- Retail: `fx::WeatherParticleSystem` (`setType`, `setNumParticles`, `setCenterAroundObject`), `fx::RainParticle` and `fx::SnowParticle` (streaks and flakes, `setSpeed`), and `fx::WeatherDB` (`initWeather`, `crossFade`). In shipped mods, weather is mostly a placed static whose child is a large-box emitter: FHSW 18 levels (739 placements), bf1918 13, bg42 6, FH 2 (Battle_Of_Foy 299). See parity-audit/effects-materials.md C5. No vanilla, Road to Rome or Secret Weapons level has weather (replay-feature-sweep-2026-11-01).
- Ours: the weather statics' bundles are baked and then hidden by the same `idleFirePose` sweep (finding 1). `Weather.*` console words are data-only. `WeatherParticleSystem` is not emulated.
- A player notices: on the mod maps the site serves. Battle_Of_Foy and FHSW's winter levels play as clear days where the game snows.
- To build: this mostly falls out of finding 1, since a looping placed bundle with a large spawn box is the mods' weather. A camera-centred `WeatherParticleSystem` (streaks or flakes kept around the listener) is needed only if a mod uses `Weather.initWeather` directly. Survey the mods for that first.

### [DIFFERENT] [impact: low] [effort: S] The sea's swell is an invented wave
- Retail: `geom::WaterPatch::getWaveHeight` returns the patch's `+0x20` (the `waveHeight` word), and `fillDynamicVertexBlock` moves the water's own vertex grid. The wave function itself is unread.
- Ours: `level-sky.js` (vertex shader, about line 262) uses `uWaveHeight * sin(x * 2pi/256 + 1.1t) * cos(0.63 z * 2pi/256 - 0.7t)`. The wavelength and speeds are ours, uncited.
- A player notices: only on the two levels that set `waveHeight` (Santo_Croce, Eagles_Nest), and only as a gentle swell.
- To build: read `WaterPatch::fillDynamicVertexBlock` in BF1942.exe and port its law. Record it as a WATER row.

### [DIFFERENT] [impact: low] [effort: S] WATER-2: the sea's depth colour is per pixel, not per vertex
- Retail: WATER-2 (refined 2026-10-10). `0x006546e0` computes the shallow-to-deep colour and alpha once per vertex of a 17 x 17 grid every 16 m, from the terrain height, and the hardware interpolates between vertices. A tile with all 289 samples dry is skipped.
- Ours: `level-sky.js` samples a per-pixel depth map (`water/depth.png`, `bf42/terrain.py` `depth_map`). The ledger's "Where" cell still names it.
- A player notices: hardly at all. Retail's shoreline gradient is blockier at 16 m and ours is smoother. Visible only on a close look at a beach.
- To build: optional. Sample `depth.png` at 16 m vertex spacing, or bake the per-vertex colours.

### [PARTIAL] [impact: low] [effort: M] TERR-8: terrain detail by distance, and cells far under the sea skipped
- Retail: TERR-8. A cell 10 m or more under the sea plane is not drawn (`0x006830e6`..`0x0068310b`). The detail level is `int(3 d^2 fov / lodRange^2)`, clamped 0..3 (`0x006831b0`..`0x006831e3`).
- Ours: `level-terrain.js`/`level-edge.js` draw the full-detail patch at every distance (the row says "read, not built").
- A player notices: barely. Retail's far hills are coarser and pop in detail as you approach. Ours are sharper than retail and cost more triangles. The skipped deep cells are hidden under the sea in both.
- To build: per-patch LOD indices at 1/2/4/8 strides chosen by the law, with skirts at LOD seams. The performance gain is the real reason to build it.

### [PARTIAL] [impact: low] [effort: S] WATER-3: whether the sea is drawn per tile
- Retail: WATER-3. Tiles with no wet sample are skipped.
- Ours: `level-sky.js` `extendWater` draws one plane and lets the terrain hide it over land.
- A player notices: no visual difference. It is only a saving.
- To build: not worth it on its own.

### [UNREAD] [impact: low] Dynamic environment map (`Setup::getUseDynamicEnvmap`)
- Retail: the Mac `bf::Setup` has a `useDynamicEnvmap` switch. What it renders (a cubemap re-rendered at run time instead of the level's static one, EM-1/EM-2) is unread.
- Ours: the static level cubemap only (`envmap.js`, `level-sky.js`).
- Settle: read who calls the getter in BF1942.exe, and whether any shipped .con sets it. Vanilla Init files do not (census found none).

### [UNREAD] [impact: low] Underwater camera view
- Retail: no fog or tint path for a camera below the sea plane was found in the fx and geom classes. The submarine's deep view is built separately (`SUB` rows).
- Ours: no underwater look for a free or chase camera below the water plane.
- Settle: read `geom::Water::draw` and `setCurrentEyePosition` for a below-surface branch.

### [UNREAD] [impact: low] FHR-9: an FH level's CoOp layer and `v_is_coop`
- Retail: the CoOp mode's object scripts would see `v_is_coop` True, and their templates could differ (FHR-3).
- Ours: one shared library, the Conquest arm. The row is open, and none of the six levels first picked is affected.
- Settle: survey the FH levels' object scripts for `v_is_coop` tests (`fh_mode_rules.py --census` style) before building a library per mode.

## From the sweep: retail behaviour with no ledger row

- **Ambient and motion emitters on vehicles and statics** (MISSING, finding 1). No row records that a speed-driven emitter attached to a vehicle plays, or that the world plays a placed static's bundle. The client classes are `world::Emitter` (attached to a host) and `ObjTemplFxModule`.
- **`fx::ShadowManager`** (MISSING, finding 2). Only VID-7's gate has a row. The pass itself (pool, 50 m gather, 128 px textures, `shadowColor`) has none.
- **`geom::Swayer` / `TreeRenderer` sway** (MISSING, finding 3). No row.
- **`fx::WeatherParticleSystem`, `RainParticle`, `SnowParticle`, `WeatherDB`** (MISSING for mods, finding 4). No row.
- **`fx::Sky` and `fx::CloudLayer`** (BUILT, `level-sky.js` `setupClouds`): one alpha-blended scrolling layer. `Sky.setCloudFog 0` (22 levels) and `Cloud.setSrc/DstBlend` are not parsed (parity-audit C6), but every vanilla level uses the alpha pair the viewer hard-codes. `Sky::updateSun` places the sun object 4096 units along its direction from the camera. The lens flare (`lens-flare.js`, `level-flare.js`) is built.
- **`TreeRenderer.billboardLightScale`** (PARTIAL, low; 7 vanilla levels set 0.5, the constructor value unread): not read by `tree-foliage.js`, so far tree cards may be brighter than retail on those levels. Settle with `TreeRenderer::drawBillboards`.
- **`world::DecalManager` / `DecalEmitter`** (BUILT): bullet-hole and impact decals, 127 per emitter ring (`effects.js`).
- **`world::LightTemplate`** (NOT-GAME for vanilla): no vanilla template creates a `Light` object, so no dynamic lights or night lighting is authored. Vanilla, Road to Rome and Secret Weapons have no night maps.

## BUILT and NOT-GAME, one line each

- SM-3 NOT-GAME: the D3D primitive type, `bf42/stdmesh.py`.
- SM-4 NOT-GAME: descriptor and payload order, `stdmesh.py`.
- SM-5 NOT-GAME: reserved words.
- SM-7 BUILT: a collision face's material is the armour region, `bf42/damage.py`, read by the viewer through `collision-materials.js` and `model-armour.js`.
- SM-9 NOT-GAME: collision layer header, `stdmesh.py`.
- SM-10 NOT-GAME: vertex format bit 29, never seen in data.
- SM-15 BUILT: the default alpha test drops alpha-0 texels, `bf42/assemble.py` `ENGINE_ALPHA_FLOOR`.
- TERR-4 NOT-GAME: template defaults, moot for shipped levels.
- TERR-7 BUILT: outside patches take the wrapped tile, `bf42/terrain.py` `default_patches`, `viewer/terrain-tile-wrap.js`.
- TERR-10 BUILT: water depth past the edge wraps, `bot-pose.js` `waterDepthAt` and `Heightfield.height`.
- TERR-11 BUILT (matches retail): objects, spawns and the nav grid are not repeated past the edge, `nav-map.js`.
- TERR-13 BUILT: shared edge vertices, `bf42/terrain.py` `_grid_mesh`.
- EM-1 BUILT: `lit*A + cube*(1-A)`, `viewer/envmap.js`.
- EM-2 BUILT: a camera-space reflection, `envmap.js`.
- EM-3 BUILT: an envmap material gives up the texture-fade stage, `envmap.js` and `level-shading.js`.
- DL-2 BUILT: fixed-function vertex lighting, `level-shading.js` (the combine for lit meshes).
- DL-4 NOT-GAME: a warning about a function that is not the mesh path.
- LM-2 BUILT: a lightmapped material draws unlit, `level-shading.js` (`bindLightmaps`: an unlit base and the bake doing the shading), and the LIGHTMAPS row is `level-load.js` (VID-4).
- LM-3 BUILT: stage 1 samples uv2, the lightmap UVs in `level-shading.js`.
- TM-3 NOT-GAME: one collision LOD per TreeMesh, `bf42/treemesh.py`.
- TM-6 BUILT: a billboarded tree keeps its collider. Draw and collision are separate in the viewer (`tree-foliage.js` swaps only the draw).
- VID-10 BUILT: console words store and apply, `console-commands.js`, `level-load.js` `setConsoleViewDistance`, `level-sky.js` `viewOverride`.
- FHR-6 BUILT (matches retail): unregistered FH words are ignored, `parse_control_point_templates`.
- FHR-7 NOT-GAME: a census.
- FHR-8 NOT-GAME: a census showing digit-prefixed kit names resolve as written. The extractor needs no special case.
