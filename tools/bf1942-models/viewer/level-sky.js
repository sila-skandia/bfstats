// The level's sky and atmosphere: the SkyBox mesh or cubemap, the cloud
// layer, the water shader, the level's environment cubemap, the light rig,
// fog and the far plane. Out of level-load.js; `createLevel` builds one and
// drives it from `show()`.

import * as THREE from 'three';
import { cubeFaceUrls } from './envmap.js';
import { scaledViewDistance, viewDistanceFog } from './video-settings.js';
import { RING } from './level-edge.js';
// Remaster mode's hooks (features/remaster-browser, remaster-mode.js):
// one registry on the global, so this module needs no import for it and
// stays loadable by the harnesses that copy it alone. Empty without
// the remaster.
const remasterHooks = globalThis.bfRemasterHooks ?? (globalThis.bfRemasterHooks = {});

/** The spacing of the water grid's vertices, metres: `WaterGeometry1` is 17 x
 *  17 vertices over a 256 m tile (0x00653eb0 and 0x006546e0 step by the float
 *  at 0x008eb640, 16.0). The far tiles' 9 x 9 `LodWaterGeom` (32 m, tile
 *  `+0x50` = 1) is not drawn apart: at that range the fog has the shoreline. */
export const WATER_GRID_M = 16;
/** `water.waterAlphaDepth` and `waterColorDepth` where a level sets neither:
 *  the water object's constructor, 0x00654ffe (0x3fd9999a) and 0x00655008
 *  (0x40a00000). */
export const WATER_ALPHA_DEPTH = 1.7;
export const WATER_COLOR_DEPTH = 5;

/**
 * Built once by `createLevel` (level-load.js). `page` hands in what it reads,
 * as getters (a value the level reassigns is read live):
 * `bust`, `camera`, `cubeLoader`, `DEFAULT_DRAW`, `extras`, `hemi`,
 * `MAPS_BASE`, `optEntire`, `optGameFog`, `scene`, `simTime`, `sun`,
 * `texLoader`, `vmScene`.
 */
export function createLevelSky(page) {
  const sky = {};
  sky.skybox = null;
  sky.skyRoot = null;       // the level's SkyBox mesh, reparented to the scene
  sky.cloudMesh = null;
  sky.cloudUniforms = null;
  sky.waterUniforms = null;
  sky.waterAssets = [];     // textures owned by the water/cloud shaders
  // The level's environment cubemap. The engine loads it once per level into the
  // StandardMesh draw context's +0x18 (0x005c01dd) and binds it to texture stage
  // 1 for every `envmap true` material (0x005bfab3) — it is not the water's, the
  // water shader just happens to want the same six faces. Owned here so a level
  // with no water still reflects, and disposed with `waterAssets`.
  sky.levelEnvCube = null;

  function disposeSky() {
    if (sky.skybox) {
      sky.skybox.dispose();
      sky.skybox = null;
    }
    if (sky.skyRoot) {
      sky.skyRoot.traverse(obj => {
        obj.geometry?.dispose();
        for (const m of [obj.material].flat().filter(Boolean)) {
          m.map?.dispose();
          m.dispose();
        }
      });
      page.scene.remove(sky.skyRoot);
      sky.skyRoot = null;
    }
    if (sky.cloudMesh) {
      sky.cloudMesh.geometry.dispose();
      sky.cloudMesh.material.dispose();
      page.scene.remove(sky.cloudMesh);
      sky.cloudMesh = null;
      sky.cloudUniforms = null;
    }
    for (const tex of sky.waterAssets) tex.dispose();
    sky.waterAssets = [];
    sky.waterUniforms = null;
    sky.levelEnvCube = null;
  }

  // The level cubemap, loaded once and shared by the envmap materials and the
  // water's fresnel term. Called before either wants it.
  function setupEnvCube(dir) {
    const urls = cubeFaceUrls(page.extras, `${page.MAPS_BASE}/${dir}`);
    if (!urls) { sky.levelEnvCube = null; return null; }
    sky.levelEnvCube = page.cubeLoader.load(urls.map(u => `${u}${page.bust()}`));
    sky.levelEnvCube.colorSpace = THREE.SRGBColorSpace;
    sky.waterAssets.push(sky.levelEnvCube);
    return sky.levelEnvCube;
  }

  function srgb(rgb, fallback) {
    const [r, g, b] = rgb || fallback;
    // Level .con colours are display values from a pre-colour-managed engine.
    return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  }

  // The engine draws the SkyBox mesh camera-centred with no fog and no lighting
  // (`lighting false` in every Sky_*.rs). Reparent it out of the level root so
  // distance culling never touches it, and swap its lit materials for unlit ones.
  function setupSky(root, dir) {
    root.traverse(obj => {
      if (obj.userData?.kind === 'sky') sky.skyRoot = obj;
    });
    if (!sky.skyRoot) return;
    sky.skyRoot.parent.remove(sky.skyRoot);
    page.scene.add(sky.skyRoot);
    sky.skyRoot.traverse(obj => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      obj.renderOrder = -100;
      const mats = [obj.material].flat().map(m => new THREE.MeshBasicMaterial({
        map: m.map || null,
        color: m.map ? 0xffffff : 0x9db4c0,
        fog: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }));
      obj.material = Array.isArray(obj.material) ? mats : mats[0];
    });
    // Remaster mode keeps this painted sky, lifted into its HDR frame and
    // used for its ambient light (remaster-sky.js `paintedSky`).
    remasterHooks.scene?.atmosphere.paintedSky(sky.skyRoot);
    setupClouds(dir);
  }

  // `Sky.addCloud`: one alpha-blended layer scrolling at Cloud.setSpeed,
  // repeated Cloud.setTexScale times across the sky span. Drawn camera-locked
  // like the sky box, with a radial fade standing in for the engine's
  // cloud-distance falloff.
  function setupClouds(dir) {
    const clouds = page.extras.sky?.clouds;
    if (!clouds?.texture) return;
    const tex = page.texLoader.load(`${page.MAPS_BASE}/${dir}/${clouds.texture}${page.bust()}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    sky.waterAssets.push(tex);
    sky.cloudUniforms = {
      map: { value: tex },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uSpan: { value: 500 },
      uCam: { value: new THREE.Vector2(0, 0) },
      uFadeStart: { value: 400 },
      uFadeEnd: { value: 900 },
    };
    // Remaster mode: the same layer as a node material, its uniforms the
    // same `.value` holders this module drives (remaster-sky.js).
    const remasterClouds = remasterHooks.cloudMaterial?.(tex, sky.cloudUniforms);
    const material = remasterClouds ?? new THREE.ShaderMaterial({
      uniforms: sky.cloudUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
      fragmentShader: `
      uniform sampler2D map;
      uniform vec2 uOffset, uCam;
      uniform float uSpan, uFadeStart, uFadeEnd;
      varying vec3 vWorld;
      void main() {
        vec2 uv = vWorld.xz / uSpan + uOffset;
        vec4 c = texture2D(map, uv);
        float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, distance(vWorld.xz, uCam));
        gl_FragColor = vec4(c.rgb, c.a * fade);
        #include <colorspace_fragment>
      }`,
    });
    sky.cloudMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    sky.cloudMesh.frustumCulled = false;
    sky.cloudMesh.renderOrder = -99;
    page.scene.add(sky.cloudMesh);
  }

  // Everything the engine's PatchTerrain/Water shader does with the level's
  // `water.*` block: two scrolling colour layers combined modulate-2x, a
  // scrolling normal map feeding a sun specular, and colour/alpha ramps driven
  // by real water depth sampled from the exported heightmap-derived depth map.
  function setupWater(root, dir) {
    const w = page.extras.water;
    if (!w) return;
    let waterObj = null;
    root.traverse(obj => {
      if (obj.userData?.kind === 'water' && obj.isMesh) waterObj = obj;
    });
    if (!waterObj) return;
    const load = rel => {
      const tex = page.texLoader.load(`${page.MAPS_BASE}/${dir}/${rel}${page.bust()}`);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      sky.waterAssets.push(tex);
      return tex;
    };
    const texs = w.textures || {};
    const layer1 = texs.layer1 ? load(texs.layer1) : null;
    const layer2 = texs.layer2 ? load(texs.layer2) : null;
    const normal = texs.normal ? load(texs.normal) : null;
    const depth = texs.depth ? load(texs.depth) : null;
    if (layer1) layer1.colorSpace = THREE.SRGBColorSpace;
    if (layer2) layer2.colorSpace = THREE.SRGBColorSpace;
    if (depth) {
      // The engine's water is a grid of 256 m tiles masked by `n - 1` like the
      // terrain it lies on (`0x006557a0`, ledger WATER-1), so past the world's
      // edge the sea is the in-world sea again, depth and all: the map repeats.
      depth.wrapS = depth.wrapT = THREE.RepeatWrapping;
      // The depth map's row 0 is z = 0 (`bf42.terrain.depth_map`), and the
      // shader looks it up at v = -worldZ / worldSize, so row 0 must be
      // v = 0. TextureLoader's default flipY puts the PNG's first row at
      // v = 1, which read every level's depth mirrored north-south: M.I.A.'s
      // 56 m river sampled the dry hill across the map and drew at the
      // shallow alpha (0.5) over its own bed, while the shore read as deep.
      // The two colour layers and the normal map tile and scroll, so their
      // orientation is not observable; only the depth map addresses the world.
      depth.flipY = false;
    }
    // The retail water never samples the shader-manager envmap parameter: its
    // only reader is the StandardMesh sub-shader (ShaderManager vt+0x38 is
    // called once, 0x005c01cf), the PatchTerrain/Water passes (0x00651de0)
    // bind its layers and a half-vector cube it builds from the light
    // direction (0x0066d0d0), and `envMapEnable` / `envmapColor` (+0x6e,
    // +0x7c) are stored and read back only by their console getters. The
    // fresnel term below is the viewer's stand-in, calibrated against
    // captures, and borrows the level's cube for it. Where the level's cube
    // failed to load and the slot holds `texture/defaultTexture`
    // (`scene.json` `envmapTexture`), the six faces are that one grey: the
    // water's look does not change with the cube in retail, so it takes no
    // reflection term rather than a grey one.
    // Remaster mode: the node-material water (remaster-water.js) from the
    // same textures and words.
    if (remasterHooks.water) {
      waterObj.material = remasterHooks.water({
        w, layer1, layer2, normal, depthTex: depth,
        worldSize: w.worldSize || page.extras.worldSize || 2048, maxDepth: w.maxDepth || 0,
      });
      // Before every other transparent object, as the retail water is
      // (below). Left at 0 until 2026-11-13, the sea was drawn after a far
      // tree's card, which writes no depth, and painted over the middle of
      // every palm that stood against it: the crown above the horizon and
      // the foot on the sand, and water where the trunk met the sea.
      waterObj.renderOrder = -1;
      return;
    }
    const env = page.extras.envmapTexture === 'texture/defaultTexture'
      ? null : sky.levelEnvCube;
    const ld = w.lightDirection || [-0.3, 0.5, 0.65];
    // `water.envmapColor` (level-content.md Gap 17), a registered client
    // property: the tint multiplies the reflected-cube term before the
    // fresnel mix — Raid_on_Agheila's warm 0.5/0.4/0.3 versus the shared green
    // 0.7/0.8/0.7 is the visible case. A level that declares none keys none.
    //
    // `GeometryTemplate.waveHeight` (Santo_Croce and Eagles_Nest, 0.1) moves
    // nothing (WATER-4): the client fills each tile's 17 x 17 dynamic grid
    // once, flat, y = 0 and normal (0, 1, 0) (0x00653eb0, behind the
    // once-only flag 0x00959c5c, cleared at 0x0065443c), and reads the word
    // only to widen the tile's cull sphere to 2 * sqrt(waveHeight^2 + 32768)
    // (0x00655906..0x00655917). So the sea here is flat too.
    const envColor = w.envmapColor || null;
    sky.waterUniforms = {
      tLayer1: { value: layer1 },
      tLayer2: { value: layer2 },
      tNormal: { value: normal },
      tDepth: { value: depth },
      tEnv: { value: env },
      uTime: { value: 0 },
      uWorldSize: { value: w.worldSize || page.extras.worldSize || 2048 },
      uMaxDepth: { value: w.maxDepth || 0 },
      uDir1: { value: new THREE.Vector2(...(w.scrollDir1 || [1, 0])) },
      uDir2: { value: new THREE.Vector2(...(w.scrollDir2 || [0, 1])) },
      uDirN: { value: new THREE.Vector2(...(w.scrollDirNormal || [1, 1])) },
      uScroll1: { value: w.scroll1 || 0 },
      uScroll2: { value: w.scroll2 || 0 },
      uScrollN: { value: w.scrollNormal || 0 },
      uTile1: { value: w.tile1 || 0.5 },
      uTile2: { value: w.tile2 || 0.5 },
      uTileN: { value: w.tileNormal || 1 },
      uShallow: { value: srgb(w.shallowColor, [0.4, 0.5, 0.55]) },
      uDeep: { value: srgb(w.deepColor, [0.3, 0.38, 0.42]) },
      uSpec: { value: srgb(w.specular ? w.specularColor : [0, 0, 0], [0, 0, 0]) },
      uLightDir: { value: new THREE.Vector3(ld[0], ld[1], ld[2]).normalize() },
      uShininess: { value: Math.min(120, Math.max(20, 0.06 / Math.max(w.streakFactor || 0.001, 1e-4))) },
      uShallowAlpha: { value: w.shallowAlpha ?? 0.5 },
      uAlphaDepth: { value: w.alphaDepth || WATER_ALPHA_DEPTH },
      uColorDepth: { value: w.colorDepth || WATER_COLOR_DEPTH },
      uEnvColor: { value: envColor ? srgb(envColor, [1, 1, 1]) : null },
      fogColor: { value: new THREE.Color(0x808080) },
      fogNear: { value: 400 },
      fogFar: { value: 900 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: sky.waterUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
      varying vec3 vWorld;
      void main() {
        // A flat sea: the engine's water grid has y = 0 at every vertex
        // (0x00653eb0, WATER-4), whatever the level's waveHeight.
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
      fragmentShader: `
      uniform sampler2D tLayer1, tLayer2, tNormal, tDepth;
      uniform samplerCube tEnv;
      uniform float uTime, uWorldSize, uMaxDepth;
      uniform vec2 uDir1, uDir2, uDirN;
      uniform float uScroll1, uScroll2, uScrollN, uTile1, uTile2, uTileN;
      uniform vec3 uShallow, uDeep, uSpec, uLightDir, uEnvColor;
      uniform float uShininess, uShallowAlpha, uAlphaDepth, uColorDepth;
      uniform vec3 fogColor;
      uniform float fogNear, fogFar;
      varying vec3 vWorld;
      vec3 bfToSrgb( vec3 c ) {
        return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ),
            c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
      }
      vec3 bfFromSrgb( vec3 c ) {
        return mix( pow( c * ( 1.0 / 1.055 ) + vec3( 0.055 / 1.055 ),
                vec3( 2.4 ) ),
            c * ( 1.0 / 12.92 ),
            vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
      }
      #ifdef HAS_DEPTH
      // One vertex of the engine's water grid (0x006546e0, ledger WATER-2):
      // the tile's colour block is a 17 x 17 lattice every 16 m (0x008eb640),
      // filled once from the terrain height under each vertex. A vertex over
      // ground above the water level takes the shallow colour at
      // waterShallowAlpha (+0x74); one under it takes
      // shallow + (deep - shallow) * min(depth / waterColorDepth, 1) (+0x78)
      // at alpha min(depth / waterAlphaDepth, 1) (+0x70). Bytes, so display
      // space. cell is the lattice index; the lookup lands on the height
      // sample's own texel (LOD 0: the stepped coordinate has no derivative).
      vec4 bfWaterVertex( vec2 cell, vec3 shallow, vec3 deep ) {
        vec2 uv = cell * ( WATER_GRID_M / uWorldSize ) + 0.5 / vec2( textureSize( tDepth, 0 ) );
        float d = textureLod( tDepth, uv, 0.0 ).r * uMaxDepth;
        if ( d <= 0.0 ) return vec4( shallow, uShallowAlpha );
        return vec4( mix( shallow, deep, min( d / max( uColorDepth, 0.001 ), 1.0 ) ),
            min( d / max( uAlphaDepth, 0.001 ), 1.0 ) );
      }
      #endif
      void main() {
        vec2 wuv = vec2(vWorld.x, -vWorld.z);
        vec3 tex = vec3(1.0);
        #ifdef HAS_LAYERS
        // The engine's fixed-function MODULATE2X runs in 8-bit DISPLAY space,
        // like every other combine in this viewer (terrain detail, lightmaps,
        // dynamic shading). The old l1*l2*4.0 did it in linear, which squares
        // the layers' slight teal tint into the saturated turquoise the game
        // never shows - the water07/08 texels are a near-neutral grey
        // (mean 140/150/153).
        vec3 l1 = bfToSrgb(texture2D(tLayer1, wuv * uTile1 + uDir1 * uScroll1 * uTime).rgb);
        vec3 l2 = bfToSrgb(texture2D(tLayer2, wuv * uTile2 + uDir2 * uScroll2 * uTime).rgb);
        tex = min(vec3(1.0), l1 * l2 * 2.0);
        #endif
        #ifdef HAS_DEPTH
        // The four lattice vertices round this pixel, blended as the
        // rasteriser blends a quad's vertex colours: the shore's gradient
        // runs over the 16 m cell it falls in, not over the bed's own slope.
        vec3 sShallow = bfToSrgb(uShallow), sDeep = bfToSrgb(uDeep);
        vec2 grid = wuv / WATER_GRID_M;
        vec2 cell = floor(grid);
        vec2 gf = grid - cell;
        vec4 lit = mix(
            mix(bfWaterVertex(cell, sShallow, sDeep), bfWaterVertex(cell + vec2(1.0, 0.0), sShallow, sDeep), gf.x),
            mix(bfWaterVertex(cell + vec2(0.0, 1.0), sShallow, sDeep), bfWaterVertex(cell + vec2(1.0, 1.0), sShallow, sDeep), gf.x),
            gf.y);
        vec3 col = bfFromSrgb(min(vec3(1.0), lit.rgb * tex));
        #else
        // A level with no depth map is all deep water.
        vec3 col = bfFromSrgb(min(vec3(1.0), bfToSrgb(uDeep) * tex));
        #endif
        vec3 N = vec3(0.0, 1.0, 0.0);
        #ifdef HAS_NORMAL
        // The DX8-era normal map is not 0.5-centred; two offset samples
        // subtracted give a zero-mean, still-animated perturbation.
        vec2 nuv = wuv * uTileN + uDirN * uScrollN * uTime;
        vec2 dn = texture2D(tNormal, nuv).rg
                - texture2D(tNormal, nuv * 1.31 + vec2(0.5)).rg;
        N = normalize(vec3(dn.x * 0.6, 1.0, dn.y * 0.6));
        #endif
        vec3 V = normalize(cameraPosition - vWorld);
        #ifdef HAS_ENV
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        // Deliberately blurred (fixed coarse mip): the ENVMAP_G_.rcm faces
        // bake the island and its clouds, and a sharp per-pixel lookup mirrors
        // them as structured smudges marching across the mid-distance - shapes
        // the in-game water never shows. What the reference shots do show is a
        // soft brightness wash toward the horizon, which is exactly what the
        // cubemap's low mip is. LOD 4 of a 128px face is 8px - directional
        // light distribution kept, all structure gone. (A texture bias can't
        // do this: MAX_TEXTURE_LOD_BIAS may clamp as low as 2.) Calibrated
        // against the Wake defgun reference, same spirit as the fresnel
        // shaping below - not a decompiled engine behaviour.
        vec3 sky = textureLod(tEnv, R, 4.0).rgb;
        #ifdef HAS_ENVCOLOR
        // water.envmapColor tints the reflected cube (the engine's registered
        // property between envMapEnable and specularStreakFactor). Multiplied
        // before the fresnel mix so the rim term carries the same cast.
        sky *= uEnvColor;
        #endif
        // A plain Schlick fresnel (exponent 5, scaled to reach 1.0) turned the
        // lagoon into a near-perfect cloud mirror the moment the camera got low
        // and the view raked across open water -- exactly the case a flythrough
        // spends most of its time in, and not what the live-game reference
        // screenshots show even at the shoreline: the water keeps its own
        // shallow/deep tint and a soft sun-glint, not a crisp sky reflection.
        // The peak was 0.55 (steep exponent, Wake calibration). Measured on a
        // retail Ghost Town (EoD) capture from a soldier standing in the river,
        // 2026-10-10: the deep brown water reads (26..33, 20..26, 10..14) from
        // 18 m out to 100 m, which is 0.4 x deepColor plus almost no neutral --
        // the reflected cube contributes a few percent, not a third. With 0.55
        // the same view in the viewer read (62,58,56): grey, no ripple texture,
        // and the bed showing through the fresnel-boosted alpha. 0.06 lands the
        // viewer at (43,38,34) there (features/level-reflection-cube-and-water-
        // depth, "The water's own look"). The term stays for the rim glint.
        float fresnel = 0.02 + 0.06 * pow(1.0 - max(dot(N, V), 0.0), 10.0);
        col = mix(col, sky, clamp(fresnel, 0.0, 1.0));
        #endif
        vec3 H = normalize(normalize(uLightDir) + V);
        col += uSpec * pow(max(dot(N, H), 0.0), uShininess);
        #ifdef HAS_DEPTH
        float alpha = lit.a;
        #else
        float alpha = 1.0;
        #endif
        #ifdef HAS_ENV
        alpha = max(alpha, clamp(fresnel, 0.0, 1.0));
        #endif
        // LINEAR, not smoothstep: THREE.Fog on the terrain and the engine's
        // DX8 vertex fog are both linear ramps. An S-curve here under-fogs
        // the sea ahead of the midpoint and over-fogs it past it (up to ~9%
        // of the ramp), so the waterline would read differently hazed than
        // the shore it touches at the same distance.
        float fogF = clamp((length(cameraPosition - vWorld) - fogNear)
            / max(fogFar - fogNear, 0.001), 0.0, 1.0);
        col = mix(col, fogColor, fogF);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
      defines: {
        ...(layer1 && layer2 ? { HAS_LAYERS: '' } : {}),
        ...(normal ? { HAS_NORMAL: '' } : {}),
        ...(depth ? { HAS_DEPTH: '', WATER_GRID_M: WATER_GRID_M.toFixed(1) } : {}),
        ...(env ? { HAS_ENV: '' } : {}),
        ...(envColor ? { HAS_ENVCOLOR: '' } : {}),
      },
    });
    waterObj.material.dispose();
    waterObj.material = material;
    if (depth) extendWater(waterObj);
    // Draw the water before every other transparent object. three sorts
    // transparents by the projected depth of the object's ORIGIN, and this
    // plane's origin is the world corner, which is usually beside or behind
    // the camera and so sorts as the nearest thing in the frame: the water
    // then painted over every splash, spray and ring that an impact raised
    // on it, leaving only the part above the horizon (Black Water, 2026-10-10,
    // "no splash on the sunny side": the dark water let 4% through, the
    // specular streak none). Clouds are -99 and the sky -100, so -1 keeps the
    // water above both and below everything that floats, flies or splashes.
    waterObj.renderOrder = -1;
  }

  // The sea does not stop at the heightmap's edge: the engine's tile loop runs
  // around the camera to the far plane and wraps into the same tile table
  // (level-edge.js, ledger WATER-1). The plane grows by the ring of worlds the
  // terrain copies cover (level-edge.js `RING`); the shader's depth lookup is
  // periodic, so each fragment out there shades as the in-world fragment it
  // wraps to. Only a level with a depth map has any water to repeat: a dry
  // level's tiles are all skipped by the engine.
  function extendWater(waterObj) {
    const geo = waterObj.geometry;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const b = geo.boundingBox;
    const W = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const E = RING * W;
    const y = b.min.y;
    const x0 = b.min.x - E, x1 = b.max.x + E, z0 = b.min.z - E, z1 = b.max.z + E;
    const big = new THREE.BufferGeometry();
    big.setAttribute('position', new THREE.Float32BufferAttribute(
      [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3));
    big.setAttribute('normal', new THREE.Float32BufferAttribute(
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    big.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    big.setIndex([0, 2, 1, 0, 3, 2]);
    big.computeBoundingSphere();
    geo.dispose();
    waterObj.geometry = big;
  }

  function syncWaterFog() {
    if (!sky.waterUniforms || !page.scene.fog) return;
    sky.waterUniforms.fogColor.value.copy(page.scene.fog.color);
    sky.waterUniforms.fogNear.value = page.scene.fog.near;
    sky.waterUniforms.fogFar.value = page.scene.fog.far;
  }

  // The sky box is 4000 m across but our far plane is much closer, so it is
  // drawn scaled down around the camera — with depth writes off and everything
  // overdrawing it, only its angular content matters, and that is scale-free.
  function updateSky() {
    if (sky.skyRoot) {
      const half = sky.skyRoot.userData.halfExtent || 2000;
      const s = page.camera.far * 0.95 / (half * 1.7320508);
      sky.skyRoot.scale.setScalar(s);
      // changeOfsSkyHeight lowers the box so the painted horizon sits below
      // eye level - Tobruk (150) shows sand-fade everywhere with the sign the
      // other way, and Wake (0) is indifferent.
      sky.skyRoot.position.set(
        page.camera.position.x,
        page.camera.position.y - (page.extras.sky?.heightOffset || 0) * s,
        page.camera.position.z,
      );
      if (sky.cloudMesh && sky.cloudUniforms) {
        const clouds = page.extras.sky?.clouds || {};
        const rise = ((clouds.height ?? 3500) - (clouds.ofsHeight ?? 0)) * s;
        const span = 4 * half * s / (clouds.texScale || 8);
        sky.cloudMesh.scale.set(page.camera.far * 4, 1, page.camera.far * 4);
        sky.cloudMesh.position.set(
          page.camera.position.x, page.camera.position.y + rise, page.camera.position.z);
        sky.cloudUniforms.uSpan.value = span;
        sky.cloudUniforms.uCam.value.set(page.camera.position.x, page.camera.position.z);
        sky.cloudUniforms.uFadeStart.value = page.camera.far * 1.2;
        sky.cloudUniforms.uFadeEnd.value = page.camera.far * 2.4;
      }
    }
  }

  /** The water's clock and the clouds' scroll, off the level's sim time. */
  function advanceSky() {
    if (sky.waterUniforms) sky.waterUniforms.uTime.value = page.simTime;
    if (sky.cloudUniforms) {
      const speed = page.extras.sky?.clouds?.speed || [0, 0];
      sky.cloudUniforms.uOffset.value.set(page.simTime * speed[0], page.simTime * speed[1]);
    }
  }

  function applyLighting() {
    const light = page.extras.lighting;
    if (!light) {
      page.hemi.color.set(0xe8dcc0);
      page.hemi.groundColor.set(0x5a4a32);
      page.hemi.intensity = 1.35;
      page.sun.color.set(0xfff1d0);
      page.sun.intensity = 2.4;
      return;
    }
    // renderer.diffuseColor is the sun's tint; keep overall exposure by
    // normalising it and carrying the magnitude into intensity.
    const diffuse = light.diffuse || [0.5, 0.5, 0.5];
    const peak = Math.max(...diffuse, 0.01);
    const tint = diffuse.map(c => c / peak);
    page.sun.color.setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace);
    page.sun.intensity = 2.4 * Math.min(1.4, peak / 0.5);
    // The engine has no sky-dome light: its only ambient terms are
    // renderer.ambientColor / globalAmbientColor, and neither is ever blue.
    // Tinting the hemisphere with the raw fog colour injected atmosphere blue
    // into the shading on marine maps - on Wake (fog 0.71/0.74/0.79 against sun
    // 1/.95/.9) the two cancelled to a dead-grey total and every vehicle picked
    // up a cool cast the game never shows. Keep the fog's LUMINANCE as the size
    // of the ambient bounce, but give it the sun's hue so the hemisphere can
    // never fight the level's declared light colour.
    const fog = page.extras.fogColor || [0.7, 0.7, 0.7];
    const atmos = 0.2126 * fog[0] + 0.7152 * fog[1] + 0.0722 * fog[2];
    page.hemi.color.setRGB(atmos * tint[0], atmos * tint[1], atmos * tint[2],
                      THREE.SRGBColorSpace);
    const ground = light.ambient || [0.2, 0.2, 0.2];
    page.hemi.groundColor.setRGB(
      Math.min(1, ground[0] * 2.5), Math.min(1, ground[1] * 2.5),
      Math.min(1, ground[2] * 2.5), THREE.SRGBColorSpace);
    page.hemi.intensity = 1.15;
  }

  // OPTIONS > VIDEO's VIEW DISTANCE: the client draws to the level's view
  // distance times the row's percentage (ledger VID-6), and the same call
  // rewrites the fog to the view distance's own law (FOG-4), so under 100 %
  // a level's declared fog words are gone. At 100 % nothing is called and
  // the level keeps what it declared.
  const viewPercent = () => {
    const p = page.viewDistancePercent?.() ?? 100;
    return p > 0 && p < 100 ? p : 100;
  };
  // `game.viewDistance v` typed at the console: the client's setter
  // (0x004427f0 -> 0x00462b30) draws to `v` itself, unscaled, and rewrites
  // the fog to the view distance's law (FOG-4), as VIEW DISTANCE does. It
  // lasts until the row moves or a level loads, both of which call the same
  // setter with the level's own distance times the row's percentage (VID-6).
  sky.viewOverride = null;
  // Whether the fog is the view distance's law rather than the level's words.
  const fogByLaw = () => sky.viewOverride !== null || viewPercent() < 100;

  function drawDistance() {
    if (sky.viewOverride !== null) return sky.viewOverride;
    return scaledViewDistance(page.extras.drawDistance || page.DEFAULT_DRAW, viewPercent());
  }

  function applyFar() {
    const world = page.extras.worldSize || 2048;
    const draw = drawDistance();
    // The engine's far plane IS the view distance: with fog saturating there,
    // the world ends in a completed haze wall that meets the sky painting.
    // Drawing past it (the old draw*1.6 with a 900 m floor) rasterised
    // fog-saturated terrain as crisp silhouettes against the paler sky band —
    // the "distant mountain ridge" the game never shows. The baked fogEnd is
    // the client's resolved word (ledger FOG-4: `renderer.fogEnd` is kept only
    // under the view distance, `scene_layers.py`), so it never passes `draw`
    // on a current bake; the max only matters for a scene.json baked before
    // 2026-10-12. 1.05 keeps the last fog-saturated metres from z-fighting
    // the plane.
    page.camera.far = page.optEntire.checked
      ? Math.max(4000, world * 1.5)
      : Math.max(draw, fogByLaw() ? 0 : page.extras.fogEnd || 0) * 1.05;
    page.camera.updateProjectionMatrix();
  }

  function applyFog() {
    const color = page.extras.fogColor || [0.8, 0.72, 0.53];
    const draw = drawDistance();
    let start, end;
    if (page.optGameFog.checked) {
      // Nullish, not falsy: Berlin authors `fogstart 0` — fog from the eye
      // out — and a || default replaced that 0 with 150 against its declared
      // end of 100, which inverts the ramp and paints the whole world as one
      // fog wall.
      start = page.extras.fogStart ?? 150;
      end = page.extras.fogEnd ?? 300;
      if (fogByLaw()) ({ start, end } = viewDistanceFog(draw));
    } else if (!page.optEntire.checked) {
      start = draw * 0.55;
      end = draw;
    } else {
      start = 250;
      end = Math.max(1400, page.extras.worldSize || 2000);
    }
    // Declared fog colours are display values from a pre-colour-managed engine.
    const fogColor = new THREE.Color().setRGB(
      color[0], color[1], color[2], THREE.SRGBColorSpace);
    page.scene.fog = new THREE.Fog(fogColor, start, end);
    // The near pass's scene shares the object, so the arms' materials compile
    // against the same fog the world does — here, before the rig's warm-up
    // compile, and not per frame, or that compile would be for a fogless
    // program the first drawn frame then replaces.
    page.vmScene.fog = page.scene.fog;
    page.scene.background = sky.skybox || fogColor;
    syncWaterFog();
  }

  async function loadSky(entry) {
    disposeSky();
    const faces = page.extras.skybox;
    if (!faces || faces.length !== 6) return;
    const dir = entry.glb.replace(/\/[^/]+$/, '');
    const tex = await page.cubeLoader.loadAsync(
      faces.map(f => `${page.MAPS_BASE}/${dir}/${f}${page.bust()}`),
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    sky.skybox = tex;
  }

  Object.assign(sky, {
    advanceSky,
    applyFar,
    applyFog,
    applyLighting,
    disposeSky,
    drawDistance,
    loadSky,
    setupEnvCube,
    setupSky,
    setupWater,
    updateSky,
  });
  return sky;
}
