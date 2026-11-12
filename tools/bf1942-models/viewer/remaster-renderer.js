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
    // No MSAA on the canvas path: the frame comes from the post chain (SMAA),
    // and the overlay passes must load the very framebuffer the frame was
    // drawn into, which a multisampled one does not keep between draws.
    antialias: false,
    powerPreference: 'high-performance',
    // `?gpuTiming`: timestamp queries, read by tests/perf/remastershot.mjs.
    trackTimestamp: new URLSearchParams(location.search).has('gpuTiming'),
    // The page reads frames back for the replay's chapter strip and for
    // headless captures; WebGPU canvases keep the last presented frame for
    // `drawImage`/`toDataURL` only inside the task that drew it, which is
    // where both readers already sit.
  });
  await renderer.init();
  // Khronos PBR Neutral's highlight shoulder without its black-level offset.
  // Neutral subtracts up to 0.04, taken from the smallest channel, from all
  // three; BF1942's art is warm and dark, its blue channel smaller than that
  // offset, so the ground's ochre was crushed to orange (Wake's bunker field
  // drew 96/71/19 against the art's 108/89/54). Without the offset, a colour
  // under the shoulder passes through with its hue.
  const tsl = await import('three/tsl');
  const { Fn, float, max, mix, select, vec3 } = tsl;
  const remasterToneMapping = Fn(([color, exposure]) => {
    const start = float(0.76);
    const desat = float(0.15);
    const c = color.mul(exposure);
    const peak = max(c.r, max(c.g, c.b));
    const d = float(1).sub(start);
    const newPeak = float(1).sub(d.mul(d).div(peak.add(d.sub(start))));
    const shoulder = c.mul(newPeak.div(peak));
    const g = float(1).sub(float(1).div(desat.mul(peak.sub(newPeak)).add(1)));
    return select(peak.lessThan(start), c, mix(shoulder, vec3(newPeak), g));
  }).setLayout({
    name: 'remasterToneMapping', type: 'vec3',
    inputs: [{ name: 'color', type: 'vec3' }, { name: 'exposure', type: 'float' }],
  });
  renderer.library.addToneMapping(remasterToneMapping, THREE.CustomToneMapping);
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.isRemaster = true;
  installWebglShims(renderer);
  // WebGPU skins from the bone matrices as a uniform array sized by the bone
  // count. `computeBoneTexture` is WebGL's: it pads the matrices out to a
  // square texture (20 bones become 36), and the padded array then overran
  // the 20-matrix buffer every frame (Wake's flag cloths, ~70 validation
  // errors a second). Under WebGPU it does nothing; an array padded before
  // this ran is trimmed where the remaster meets the mesh.
  THREE.Skeleton.prototype.computeBoneTexture = function computeBoneTexture() { return this; };
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
  const { createShadowProxies, SHADOW_LAYER } = await import('./remaster-shadow-proxies.js');
  const smaaMod = await import('three/addons/tsl/display/SMAANode.js');
  const shaftMod = await import('three/addons/tsl/display/radialBlur.js');
  const { REMASTER_OFF: off } = await import('./remaster-mode.js');
  const atmosphere = createRemasterSky({ renderer, scene, camera, sun, hemi });
  remasterHooks.materials = remasterMaterials;
  // The generated normal and roughness maps' index (remaster_texture_maps.py);
  // none generated is no relief, not an error.
  try {
    const index = await fetch('./remaster-textures/index.json').then(r => (r.ok ? r.json() : null));
    (await import('./remaster-materials.js')).setTextureMaps(index?.hashes);
  } catch { /* no maps */ }
  remasterHooks.provingFloor = (await import('./remaster-materials.js')).provingFloor;
  remasterHooks.water = water.remasterWaterMaterial;
  remasterHooks.off = off;
  remasterHooks.foliage = remasterFoliage;
  remasterHooks.cloudMaterial = (tex, uniforms) => atmosphere.cloudMaterial(tex, uniforms);
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
  // Light from a flash or a blast (effects.js `play`): a pool of point lights
  // that is always in the scene, dark until used, since adding or removing a
  // light recompiles every lit material. A muzzle flash lights its
  // surroundings for a few hundredths of a second, an explosion for half a
  // second, fading as the square of the time left.
  // Intensities against the sun's (a flat sunlit patch takes about 1.2 of
  // its albedo): a muzzle flash adds ~0.4 at 1.5 m and fades within a few
  // metres, an explosion ~1.5 at 10 m. By night they would be all the light
  // there is; by day a flash is a lift, not a floodlight (at 70 cd the
  // player's own rifle bleached the sand at their feet white).
  // A round's impact (`e_ExplDrySand`, `e_ExplWindow`, ricochets) is dust,
  // not fire, and lights nothing: matched first and dropped.
  const FLASH_KINDS = [
    { test: /expl(drysand|frozensnow|window|small)|collision|richo|ricoch|scrap/i, intensity: 0 },
    { test: /bomb|granadeexpl|groundexpl|waterexpl|expl(armor|bazooka|boatarmor|gas|ani)|torpedo/i, intensity: 150, range: 60, life: 0.45, color: 0xffb070 },
    { test: /muzz|fire$/i, intensity: 1.2, range: 8, life: 0.05, color: 0xffc890 },
  ];
  const flashes = [];
  if (!off.has('noflash')) {
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb070, 0, 60, 2);
      l.castShadow = false;
      l.userData.remasterFlash = true;
      scene.add(l);
      flashes.push({ light: l, t: 0, life: 1, peak: 0 });
    }
  }
  let flashNext = 0;
  const _flashAt = new THREE.Vector3();
  remasterHooks.flash = (name, position, object = null) => {
    if (!flashes.length || !name || (!position && !object)) return;
    const kind = FLASH_KINDS.find(k => k.test.test(name));
    if (!kind?.intensity) return;
    const f = flashes[flashNext++ % flashes.length];
    // A muzzle bundle plays attached to its gun, with no position of its own.
    if (!position) { object.updateWorldMatrix(true, false); object.getWorldPosition(_flashAt); }
    const p = !position ? _flashAt : position.isVector3 ? position : { x: position[0], y: position[1], z: position[2] };
    f.light.position.set(p.x, p.y + 0.6, p.z);
    f.light.updateMatrixWorld();
    f.light.color.set(kind.color);
    f.light.distance = kind.range;
    f.peak = kind.intensity;
    f.life = kind.life;
    f.t = kind.life;
  };
  let lastFlashTick = performance.now();
  function tickFlashes() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFlashTick) / 1000);
    lastFlashTick = now;
    for (const f of flashes) {
      if (f.t <= 0) { f.light.intensity = 0; continue; }
      f.t -= dt;
      const left = Math.max(0, f.t / f.life);
      f.light.intensity = f.peak * left * left;
    }
  }

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
  // Statics cast through their merged proxies (remaster-shadow-proxies.js)
  // at every distance the cascades reach; what is left here is what moves.
  const FOLIAGE_REACH = Number(new URLSearchParams(location.search).get('leafReach')) || 120;
  const SOLID_REACH = Number(new URLSearchParams(location.search).get('solidReach')) || 450;
  const proxies = off.has('noproxies') ? null : createShadowProxies(scene);
  const casters = [];
  // A skinned mesh's bone matrices (a batch's instance data likewise) are a
  // uniform array whose size the compiled graph fixes, and three shares one
  // compiled graph between materials of the same shape: two skeletons of
  // different bone counts behind one material would write the larger array
  // into the smaller buffer. One material per count, its graph made distinct
  // by the count itself (below), so each compiles its own.
  const byBones = new Map();
  function ownBoneMaterial(obj) {
    const sk = obj.skeleton;
    if (sk && sk.boneMatrices && sk.boneMatrices.length > sk.bones.length * 16) {
      sk.boneMatrices = sk.boneMatrices.slice(0, sk.bones.length * 16);
      sk.boneTexture?.dispose?.();
      sk.boneTexture = null;
    }
    // Bones for a skinned mesh, the instance capacity for a batch: both size
    // a per-object uniform array from the first object that built the graph.
    const n = obj.isBatchedMesh ? (obj.maxInstanceCount ?? obj._maxInstanceCount ?? 0) + 100000
      : obj.skeleton?.bones?.length ?? 0;
    const swap = m => {
      if (!m) return m;
      const key = `${m.uuid}|${n}`;
      let c = byBones.get(key);
      if (!c) {
        c = m.clone();
        for (const k of Object.keys(m)) if ((/Node$/.test(k) || /^bf/.test(k)) && m[k]) c[k] = m[k];
        c.userData = m.userData;
        // three's node renderer keys its compiled graph by the graph, not by
        // `customProgramCacheKey`: the bone count goes into the graph itself
        // as a zero-weight constant, so each count compiles its own.
        c.opacityNode = tsl.materialOpacity.add(tsl.float(n).mul(0));
        byBones.set(key, c);
      }
      return c;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(swap) : swap(obj.material);
  }

  // Any other scene this renderer draws (the first-person rig's, a replay's,
  // a preview's) gets the same split of its skinned and batched materials,
  // looked at once a second.
  const otherScenes = new WeakMap();
  const render = renderer.render.bind(renderer);
  renderer.render = (s, c) => {
    if (s && s !== scene && s.isScene !== false) {
      const now = performance.now();
      if (!(now - (otherScenes.get(s) ?? -1e9) < 1000)) {
        otherScenes.set(s, now);
        s.traverse?.(o => {
          if ((o.isSkinnedMesh || o.isBatchedMesh) && !o.userData.rmBones) { o.userData.rmBones = true; ownBoneMaterial(o); }
        });
      }
    }
    return render(s, c);
  };

  function flagShadows(root) {
    root.traverse(obj => {
      if (!obj.isMesh || obj.userData.rmShadow) return;
      obj.userData.rmShadow = true;
      if ((obj.isSkinnedMesh || obj.isBatchedMesh) && !obj.userData.rmBones) { obj.userData.rmBones = true; ownBoneMaterial(obj); }
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
      if (k.proxied) continue;
      // The sun's shadow cameras see only SHADOW_LAYER (remaster-sky.js), so
      // a mesh casting for itself is on that layer as well as its own.
      if (!k.layered) { k.obj.layers.enable(SHADOW_LAYER); k.layered = true; }
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
  let earlyFrames = 0;

  // The light shafts' sun on the screen, set each frame (`updateShafts`).
  const shaftCenter = tsl.uniform(new THREE.Vector2(0.5, 0.5));
  const shaftStrength = tsl.uniform(0);
  const shaftThreshold = tsl.uniform(0.9);
  const _sunPoint = new THREE.Vector3();
  const _view = new THREE.Vector3();
  function updateShafts() {
    const toward = atmosphere.uniforms.sunDir.value;
    camera.getWorldDirection(_view);
    const facing = _view.dot(toward);
    _sunPoint.copy(camera.position).addScaledVector(toward, 1000).project(camera);
    // Screen UV, y down (the pass texture's own).
    shaftCenter.value.set(_sunPoint.x * 0.5 + 0.5, 0.5 - _sunPoint.y * 0.5);
    // Full with the sun in view, gone a little past the screen's edge.
    const edge = Math.max(Math.abs(_sunPoint.x), Math.abs(_sunPoint.y));
    shaftStrength.value = facing <= 0 ? 0 : 0.35 * Math.min(1, facing * 3) * Math.max(0, Math.min(1, (1.8 - edge) / 0.8));
  }

  // The post chain, built once the camera is final.
  let pipeline = null;
  function buildPipeline() {
    const { pass, mix, float, vec4, clamp } = tsl;
    // One sample: the ambient occlusion reads the depth, which a multisampled
    // pass cannot hand it; the edges are smoothed by SMAA instead.
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
    // Light shafts: the bright, open sky radially blurred toward the sun's
    // place on the screen, so the sun breaks through tree crowns, eaves and
    // the girders of a bridge. Faded out as the sun leaves the view.
    if (!off.has('noshafts')) {
      const sky = depth.r.greaterThanEqual(0.99999).select(float(1), float(0));
      const bright = tsl.max(color.rgb.dot(tsl.vec3(0.2126, 0.7152, 0.0722)).sub(shaftThreshold), 0);
      const mask = vec4(color.rgb.mul(bright).mul(sky), 1);
      const rays = shaftMod.radialBlur(mask, { center: shaftCenter, weight: float(0.9), decay: float(0.955), count: tsl.int(40), exposure: float(1.2) });
      out = vec4(out.rgb.add(rays.rgb.mul(shaftStrength)), out.a);
    }
    // SMAA on the HDR frame, its edges found on values held under 4 so a
    // flash's core does not swamp the luma test.
    if (!off.has('nosmaa')) out = smaaMod.smaa(vec4(clamp(out.rgb, 0, 4), 1));
    // The frame is drawn as one full-screen quad through the renderer's own
    // output path, NOT a RenderPipeline. A RenderPipeline turns tone mapping
    // off and writes straight to the canvas; the page's overlay passes (the
    // first-person arms, a replay's first person and spotlight, the proving
    // ground's inset) then draw with autoClear off into the renderer's own
    // tone-mapping framebuffer, which the world never reached, and copy it
    // over the canvas: a black world with the rifle smeared across it, the
    // moment a player spawned. Through the output path the quad fills that
    // framebuffer with the world in HDR, the overlays land on top of it, and
    // each draw tone-maps the whole thing to the canvas once.
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec4(out.rgb, 1);
    material.fog = false;
    material.depthTest = false;
    material.depthWrite = false;
    pipeline = new THREE.QuadMesh(material);
    return pipeline;
  }

  const api = {
    atmosphere,
    /** After a level is up: its sky, sun, fog and shadow flags. */
    levelLoaded(extras, root, waterLevel) {
      atmosphere.apply(extras, waterLevel);
      flagShadows(root ?? scene);
      if (proxies) {
        const t = performance.now();
        const r = proxies.build(casters, atmosphere.uniforms.sunDir.value);
        console.info(`[remaster] shadow proxies: ${r.sources} static meshes as ${r.proxies} proxies in ${(performance.now() - t).toFixed(0)} ms`);
      }
      judgeCasters();
      lastFlag = performance.now();
    },
    /** An overlay pass's scene (the first-person arms) lit like the world:
     *  the sky's image-based light, at the world's strength. */
    lightOverlay(overlay) {
      if (!overlay) return;
      overlay.environment = scene.environment;
      overlay.environmentIntensity = scene.environmentIntensity;
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
      tickFlashes();
      updateShafts();
      const now = performance.now();
      // Every frame while a level is coming up (its flag cloths draw from
      // the first loading frame, and their bone materials must be split
      // before then), then once a second.
      earlyFrames++;
      if (earlyFrames < 600) flagShadows(scene);
      if (now - lastFlag > 1000) { lastFlag = now; flagShadows(scene); proxies?.refresh(casters); }
      if (now - lastJudge > 200 || camera.position.distanceToSquared(_lastEye) > 400) {
        lastJudge = now;
        _lastEye.copy(camera.position);
        judgeCasters();
      }
      if (off.has('nopost')) { renderer.render(scene, camera); return; }
      const autoClear = renderer.autoClear;
      renderer.autoClear = true;
      (pipeline ?? buildPipeline()).render(renderer);
      renderer.autoClear = autoClear;
    },
  };
  remasterHooks.scene = api;
  // A side view's own renderer (a tank's sight, the controls preview, the
  // proving ground's card, the schools): the WebGPU build has no
  // WebGLRenderer, so these get a WebGPU one, initialised in the background
  // (a render before it is up is queued by three), with the same shims.
  remasterHooks.sideRenderer = (options = {}) => {
    const side = new THREE.WebGPURenderer({
      canvas: options.canvas, antialias: options.antialias ?? true, alpha: options.alpha ?? false,
      powerPreference: options.powerPreference ?? 'high-performance',
    });
    side.isRemaster = true;
    installWebglShims(side);
    side.init().catch(err => console.warn('[remaster] side renderer', err));
    return side;
  };
  if (new URLSearchParams(location.search).has('shots')) window.__remaster = api;
  return api;
}
