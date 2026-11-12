// The remaster renderer (features/remaster-browser): three r186's
// WebGPURenderer in place of r169's WebGLRenderer, under `?remaster` only.
// map.html imports this module dynamically, because it resolves
// 'three/webgpu' and 'three/tsl', which only the remaster import map names.

import * as THREE from 'three/webgpu';

/**
 * A WebGPU renderer, initialised (its device is up) before the page goes on.
 * HDR through the whole pipeline: the scene pass renders to half float and
 * the output pass tone-maps once, with AgX, which keeps saturated highlights
 * (muzzle flashes, fire) from clipping to white the way ACES does.
 */
export async function createRemasterRenderer({ antialias = true } = {}) {
  const renderer = new THREE.WebGPURenderer({
    antialias,
    powerPreference: 'high-performance',
    // `?gpuTiming`: timestamp queries, read by tests/perf/remastershot.mjs.
    trackTimestamp: new URLSearchParams(location.search).has('gpuTiming'),
    // The page reads frames back for the replay's chapter strip and for
    // headless captures; WebGPU canvases keep the last presented frame for
    // `drawImage`/`toDataURL` only inside the task that drew it, which is
    // where both readers already sit.
  });
  await renderer.init();
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.isRemaster = true;
  installWebglShims(renderer);
  return renderer;
}

/**
 * The few WebGLRenderer members the game's modules reach for that the
 * WebGPU renderer does not have, as harmless stand-ins: the warm-up asks
 * `properties.get(material)` for linked programs (none: WebGPU builds its
 * pipelines in `compileAsync`), the texture lists ask `capabilities` for the
 * anisotropy cap, and TEXTURE QUALITY's GL sampler pokes are skipped
 * (texture-quality.js checks `isRemaster`).
 */
function installWebglShims(renderer) {
  const none = Object.freeze({});
  if (!renderer.properties) renderer.properties = { get: () => none };
  if (!renderer.capabilities) {
    renderer.capabilities = {
      getMaxAnisotropy: () => renderer.getMaxAnisotropy(),
      isWebGL2: false,
      maxTextures: 16,
    };
  }
  if (!renderer.extensions) renderer.extensions = { get: () => null, has: () => false };
}

/**
 * The remaster's frame: the sky and atmosphere (remaster-sky.js), the
 * surfaces (remaster-materials.js, through `remasterHooks`), every mesh
 * casting and taking the sun's shadow, and the post chain: ground-truth
 * ambient occlusion on the scene's depth, bloom on what is brighter than
 * white, and AgX tone mapping on the HDR result.
 *
 * `?remaster=noao`, `=nobloom`, `=nopost` (comma-separated) turn parts off
 * for the before/after and the frame-time table.
 */
export async function createRemasterScene({ renderer, scene, camera, sun, hemi }) {
  const [{ createRemasterSky }, { remasterMaterials }, { remasterHooks }, tsl, gtao, bloomMod, water] = await Promise.all([
    import('./remaster-sky.js'),
    import('./remaster-materials.js'),
    import('./remaster-mode.js'),
    import('three/tsl'),
    import('three/addons/tsl/display/GTAONode.js'),
    import('three/addons/tsl/display/BloomNode.js'),
    import('./remaster-water.js'),
  ]);
  const { remasterFoliage } = await import('./remaster-foliage.js');
  const smaaMod = await import('three/addons/tsl/display/SMAANode.js');
  const { REMASTER_OFF: off } = await import('./remaster-mode.js');
  const atmosphere = createRemasterSky({ renderer, scene, camera, sun, hemi });
  remasterHooks.materials = remasterMaterials;
  remasterHooks.water = water.remasterWaterMaterial;
  remasterHooks.off = off;
  remasterHooks.foliage = remasterFoliage;
  // Light, not surface: an additive flame, flash or tracer drawn GLOW times
  // brighter than its texture, so its core passes the bloom's threshold and
  // spills over what is around it. The tone mapping brings it back under
  // white; the texture's own falloff gives the halo its shape.
  const GLOW = Number(new URLSearchParams(location.search).get('glow')) || 3;
  remasterHooks.glow = m => {
    if (!m || m.remasterGlow || off.has('noglow')) return;
    m.remasterGlow = true;
    m.colorNode = tsl.vec4(tsl.materialColor.rgb.mul(GLOW), tsl.materialColor.a);
    m.needsUpdate = true;
  };
  // The tracer material is a module constant, built before this renderer.
  import('./round-visuals.js').then(r => remasterHooks.glow(r.tracerMaterial)).catch(() => {});

  renderer.toneMappingExposure = Number(new URLSearchParams(location.search).get('exposure')) || 0.58;
  if (off.has('notonemap')) renderer.toneMapping = THREE.NoToneMapping;

  // Shadow flags on everything that can take them, walked in slices as the
  // scene grows (bots, vehicles, effects arrive after the level). A level
  // has thousands of separate tree and prop meshes; drawn into every cascade
  // they cost the GPU tens of milliseconds in draw overhead alone, so a
  // caster only casts within a reach of the eye: foliage (alpha-tested)
  // within FOLIAGE_REACH, everything else within SOLID_REACH, re-judged a
  // few times a second. Past those the terrain art's baked shadows carry on.
  const SKIP = new Set(['sky', 'water', 'effects']);
  const FOLIAGE_REACH = Number(new URLSearchParams(location.search).get('leafReach')) || 70;
  const SOLID_REACH = Number(new URLSearchParams(location.search).get('solidReach')) || 250;
  const casters = [];
  // A skinned mesh's bone matrices are a uniform array sized by the first
  // skeleton that built its material's graph; a flag cloth's material shared
  // between a 20-bone and a 36-bone skeleton then wrote 2304 bytes into a
  // 1280-byte buffer every frame. One material per bone count, keyed apart.
  const byBones = new Map();
  function ownBoneMaterial(obj) {
    const n = obj.skeleton?.bones?.length ?? 0;
    const swap = m => {
      if (!m) return m;
      const key = `${m.uuid}|${n}`;
      let c = byBones.get(key);
      if (!c) {
        c = m.clone();
        for (const k of Object.keys(m)) if (/Node$/.test(k) && m[k]) c[k] = m[k];
        c.userData = m.userData;
        c.customProgramCacheKey = () => `bones:${n}`;
        byBones.set(key, c);
      }
      return c;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(swap) : swap(obj.material);
  }

  function flagShadows(root) {
    root.traverse(obj => {
      if (!obj.isMesh || obj.userData.rmShadow) return;
      obj.userData.rmShadow = true;
      if (obj.isSkinnedMesh) ownBoneMaterial(obj);
      if (obj.userData.remasterSky || SKIP.has(obj.userData?.kind)) return;
      const mats = [obj.material].flat().filter(Boolean);
      const lit = mats.some(m => m.isMeshStandardMaterial || m.remaster);
      const blended = mats.every(m => m.transparent && !m.alphaTest);
      // Only lit surfaces: an unlit alpha-tested material is an effect
      // sprite (smoke, a muzzle flash) parked in the pool, not a caster.
      if (!lit) return;
      obj.receiveShadow = lit && !(off.has('noleafreceive') && mats.some(m => m.alphaTest));
      // Terrain never casts (the art carries its own relief shadows), nor do
      // its copies past the world's edge (level-edge.js, `edgeOf`).
      // A far tree's billboard neither: the tree's own parts cast near, and
      // a card turned to the sun shadows as its whole strip.
      const cast = !blended && obj.userData?.kind !== 'terrain' && !obj.userData?.edgeOf
        && !obj.userData?.treeImpostor
        && !(off.has('noleafshadow') && mats.some(m => m.alphaTest));
      if (!cast) return;
      const leafy = mats.some(m => m.alphaTest || m.remasterSprite);
      if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      casters.push({ obj, reach: leafy ? FOLIAGE_REACH : SOLID_REACH, r: obj.geometry.boundingSphere?.radius ?? 1 });
      obj.castShadow = false;
    });
  }
  const _p = new THREE.Vector3();
  const _lastEye = new THREE.Vector3(1e9, 0, 0);
  function judgeCasters() {
    if (api.frozenCasters) return -1;
    const c = camera.position;
    let n = 0;
    for (let i = casters.length - 1; i >= 0; i--) {
      const k = casters[i];
      if (!k.obj.parent) { casters.splice(i, 1); continue; }
      _p.setFromMatrixPosition(k.obj.matrixWorld);
      const reach = k.reach + k.r;
      const on = _p.distanceToSquared(c) < reach * reach;
      k.obj.castShadow = on;
      if (on) n++;
    }
    return n;
  }
  let lastFlag = 0;
  let lastJudge = 0;
  let lastNodeFrame = -1;

  // The post chain, built once the camera is final.
  let pipeline = null;
  function buildPipeline() {
    const { pass, mix, float, vec4, renderOutput } = tsl;
    // One sample: the ambient occlusion reads the depth, which a multisampled
    // pass cannot hand it; the edges are smoothed by SMAA after tone mapping.
    const scenePass = pass(scene, camera, { samples: 0 });
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    let out = color;
    if (!off.has('noao')) {
      const aoPass = gtao.ao(depth, null, camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 1.6;
      aoPass.distanceExponent.value = 1.4;
      aoPass.scale.value = 1.1;
      aoPass.thickness.value = 1.5;
      // The sky has no surface to occlude.
      const occlusion = depth.r.greaterThanEqual(0.99999).select(float(1), aoPass.getTextureNode().r);
      out = vec4(color.rgb.mul(mix(float(1), occlusion, 0.85)), color.a);
    }
    if (!off.has('nobloom')) {
      const glow = bloomMod.bloom(color, 0.3, 0.35, 2.4);
      out = vec4(out.rgb.add(glow.rgb), out.a);
    }
    pipeline = new THREE.RenderPipeline(renderer);
    if (off.has('nosmaa')) {
      pipeline.outputNode = out;
    } else {
      pipeline.outputColorTransform = false;
      pipeline.outputNode = smaaMod.smaa(renderOutput(out));
    }
    return pipeline;
  }

  const api = {
    atmosphere,
    /** After a level is up: its sky, sun, fog and shadow flags. */
    levelLoaded(extras, root, waterLevel) {
      atmosphere.apply(extras, waterLevel);
      flagShadows(root ?? scene);
      judgeCasters();
      lastFlag = performance.now();
    },
    /** How many meshes cast now, of how many could. */
    casters: () => ({ casting: judgeCasters(), of: casters.length }),
    render() {
      // Every call is a frame: three's node frame (which gates each pass
      // and shadow map to once a frame) only advances inside the animation
      // loop, so a frame drawn outside it (`__renderOnce`, a replay's
      // scrub) would re-use the last one's passes.
      const nodeFrame = renderer._nodes?.nodeFrame;
      if (nodeFrame) {
        if (nodeFrame.frameId === lastNodeFrame) nodeFrame.update();
        lastNodeFrame = nodeFrame.frameId;
      }
      atmosphere.update();
      const now = performance.now();
      if (now - lastFlag > 1000) { lastFlag = now; flagShadows(scene); }
      if (now - lastJudge > 200 || camera.position.distanceToSquared(_lastEye) > 400) {
        lastJudge = now;
        _lastEye.copy(camera.position);
        judgeCasters();
      }
      if (off.has('nopost')) { renderer.render(scene, camera); return; }
      (pipeline ?? buildPipeline()).render();
    },
  };
  remasterHooks.scene = api;
  if (new URLSearchParams(location.search).has('shots')) window.__remaster = api;
  return api;
}
