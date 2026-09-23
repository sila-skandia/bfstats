// The level's sky and atmosphere: the SkyBox mesh or cubemap, the cloud
// layer, the water shader, the level's environment cubemap, the light rig,
// fog and the far plane. Out of level-load.js; `createLevel` builds one and
// drives it from `show()`.

import * as THREE from 'three';
import { cubeFaceUrls } from './envmap.js';

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
    const material = new THREE.ShaderMaterial({
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
    if (depth) depth.wrapS = depth.wrapT = THREE.ClampToEdgeWrapping;
    // The engine reflects ENVMAP_G_.rcm off the water via the shader-manager
    // envmap parameter; the same six faces feed the fresnel term here. Shared
    // with the `envmap true` mesh materials (see setupEnvCube), one cube per
    // level rather than one per consumer.
    const env = sky.levelEnvCube;
    const ld = w.lightDirection || [-0.3, 0.5, 0.65];
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
      uAlphaDepth: { value: w.alphaDepth || 1.5 },
      uColorDepth: { value: w.colorDepth || 10 },
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
      uniform vec3 uShallow, uDeep, uSpec, uLightDir;
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
        float depth = uMaxDepth;
        #ifdef HAS_DEPTH
        depth = texture2D(tDepth, wuv / uWorldSize).r * uMaxDepth;
        #endif
        vec3 base = mix(uShallow, uDeep, clamp(depth / max(uColorDepth, 0.001), 0.0, 1.0));
        vec3 col = bfFromSrgb(min(vec3(1.0), bfToSrgb(base) * tex));
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
        // A plain Schlick fresnel (exponent 5, scaled to reach 1.0) turned the
        // lagoon into a near-perfect cloud mirror the moment the camera got low
        // and the view raked across open water -- exactly the case a flythrough
        // spends most of its time in, and not what the live-game reference
        // screenshots show even at the shoreline: the water keeps its own
        // shallow/deep tint and a soft sun-glint, not a crisp sky reflection.
        // Steepening the exponent and capping the peak keeps the mirror term a
        // rim highlight at true grazing incidence instead of the dominant term
        // from ten degrees off horizontal outward.
        float fresnel = 0.03 + 0.55 * pow(1.0 - max(dot(N, V), 0.0), 10.0);
        col = mix(col, sky, clamp(fresnel, 0.0, 1.0));
        #endif
        vec3 H = normalize(normalize(uLightDir) + V);
        col += uSpec * pow(max(dot(N, H), 0.0), uShininess);
        float alpha = mix(uShallowAlpha, 0.96, clamp(depth / max(uAlphaDepth, 0.001), 0.0, 1.0));
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
        ...(depth ? { HAS_DEPTH: '' } : {}),
        ...(env ? { HAS_ENV: '' } : {}),
      },
    });
    waterObj.material.dispose();
    waterObj.material = material;
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

  function drawDistance() {
    return page.extras.drawDistance || page.DEFAULT_DRAW;
  }

  function applyFar() {
    const world = page.extras.worldSize || 2048;
    const draw = drawDistance();
    // The engine's far plane IS the view distance: with fog saturating there,
    // the world ends in a completed haze wall that meets the sky painting.
    // Drawing past it (the old draw*1.6 with a 900 m floor) rasterised
    // fog-saturated terrain as crisp silhouettes against the paler sky band —
    // the "distant mountain ridge" the game never shows. Extend only to a
    // declared fogEnd beyond the view distance (Gazala: fog 500-850 vs VD 500)
    // so the wall always completes before the clip; 1.05 keeps the last
    // fog-saturated metres from z-fighting the plane.
    page.camera.far = page.optEntire.checked
      ? Math.max(4000, world * 1.5)
      : Math.max(draw, page.extras.fogEnd || 0) * 1.05;
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
