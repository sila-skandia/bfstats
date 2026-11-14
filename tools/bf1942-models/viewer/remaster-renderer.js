// The remaster renderer (features/remaster-browser): three r186's
// WebGPURenderer in place of r169's WebGLRenderer, under the remaster only.
// map.html imports this module dynamically, because it resolves
// 'three/webgpu' and 'three/tsl', which only the remaster import map names.

import * as THREE from 'three/webgpu';
import { FIRE, fireFlicker, flashKind, isFire } from './remaster-lights.js';

/**
 * A WebGPU renderer, initialised (its device is up) before the page goes on.
 * HDR through the whole pipeline: the scene pass renders to half float and
 * the output pass tone-maps once, with the curve below, so a flash's core
 * (a muzzle's, a fire's) rolls off to white instead of clipping.
 */
export async function createRemasterRenderer() {
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
 * Pipelines built during play are built off the main thread, and what needs
 * one is drawn from the frame it is ready.
 *
 * three builds a pipeline it meets in a frame with `createRenderPipeline`,
 * and the GPU process compiles its shaders before that frame can be shown.
 * The warm-up (`warmPipelines`) covers what the scene holds when a level
 * comes up. It cannot cover what does not exist yet: an effect's debris and
 * sprites are made when the effect plays, a wreck is loaded when its vehicle
 * dies, a tree's blend band is cloned as it crosses a range, and no warm-up
 * reaches the shadow passes. Each of those froze the frame that first drew
 * it: "very laggy at key moments, when I shoot something that explodes" (the
 * owner, 2026-11-13; 440 to 630 ms on Wake for the first gun emplacement
 * destroyed). So once a level is up, a pipeline asked for inside a frame is
 * asked for with `createRenderPipelineAsync` (three's own path for
 * `compileAsync`), and `draw` skips an object whose pipeline is still being
 * built: it appears a few frames late, once, and nothing stops.
 *
 * Full-screen quads (the post chain's passes) stay synchronous: a frame
 * without its output quad is a black frame. These are three's internals
 * (r186): if either is not where it was, nothing is installed and pipelines
 * are built in the frame that meets them, as three does by itself.
 */
function installAsyncPipelines(renderer) {
  const state = { on: false, pending: 0, built: 0, installed: false };
  const pipelines = renderer._pipelines;
  const backend = renderer.backend;
  if (typeof pipelines?._getRenderPipeline !== 'function' || typeof backend?.draw !== 'function'
      || typeof backend.get !== 'function') return state;
  const build = pipelines._getRenderPipeline.bind(pipelines);
  pipelines._getRenderPipeline = (renderObject, vertex, fragment, cacheKey, promises) => {
    if (promises !== null || !state.on || renderObject.object?.isQuadMesh) {
      return build(renderObject, vertex, fragment, cacheKey, promises);
    }
    const waiting = [];
    const pipeline = build(renderObject, vertex, fragment, cacheKey, waiting);
    if (waiting.length) {
      state.pending += waiting.length;
      state.built += waiting.length;
      Promise.all(waiting).then(() => { state.pending -= waiting.length; });
    }
    return pipeline;
  };
  const draw = backend.draw.bind(backend);
  backend.draw = (renderObject, info) => {
    // Still being built: drawn from the frame it is ready.
    if (backend.get(renderObject.pipeline).pipeline === undefined) return undefined;
    return draw(renderObject, info);
  };
  state.installed = true;
  return state;
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
 * The remaster's frame: the sky, sun and fog (remaster-sky.js), the surfaces
 * (remaster-materials.js, through `remasterHooks`), every mesh casting and
 * taking the sun's shadow, and the post chain: ambient occlusion on the
 * scene's depth, bloom on what is brighter than white, sun shafts, SMAA, and
 * the tone curve on the HDR result.
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
  const { createShadowProxies, SHADOW_LAYER, isVehicle } = await import('./remaster-shadow-proxies.js');
  const { createShadowBatch } = await import('./remaster-shadow-batch.js');
  const smaaMod = await import('three/addons/tsl/display/SMAANode.js');
  const shaftMod = await import('three/addons/tsl/display/radialBlur.js');
  const atmosphere = createRemasterSky({ renderer, scene, camera, sun, hemi });
  const { viewGain } = await import('./remaster-materials.js');
  const overlays = new WeakMap();
  const asyncPipelines = installAsyncPipelines(renderer);
  remasterHooks.materials = remasterMaterials;
  remasterHooks.provingFloor = (await import('./remaster-materials.js')).provingFloor;
  remasterHooks.water = water.remasterWaterMaterial;
  remasterHooks.foliage = remasterFoliage;
  remasterHooks.cloudMaterial = (tex, uniforms) => atmosphere.cloudMaterial(tex, uniforms);
  // Light, not surface: an additive flame, flash or tracer drawn GLOW times
  // brighter than its texture, so its core passes the bloom's threshold and
  // spills over what is around it. The tone mapping brings it back under
  // white; the texture's own falloff gives the halo its shape.
  //
  // Only what the data blends additively (`blendDest one`, the page's
  // AdditiveBlending or a D3D pair whose destination is One). The hook is
  // called for every material an effect makes, and until 2026-11-13 it
  // tripled all of them: a destroyed gun's flying parts and an explosion's
  // smoke drew three times as bright as their textures.
  //
  // The amount of light is shaped as the engine's blend shaped it. The
  // client added `texel * alpha` to the frame in display space, where a
  // faint texel adds next to nothing; this frame is linear, where the same
  // texel is a visible veil. An explosion's fireball (`e_fire4`, a 16 x 16
  // texture on a 21 m quad, its border texels at a tenth alpha) drew as a
  // hard-edged yellow rectangle over the scene behind it. So the product is
  // taken in display space and brought to linear, `EOTF(OETF(rgb) * alpha *
  // opacity)`, which is the engine's own result over black, and that is
  // what is multiplied by GLOW. That is for a particle's quad (`sprite`,
  // effects.js), where the whole quad is on screen. A flash that is a mesh
  // (a muzzle's, a tracer) keeps the plain multiple: its shape is its
  // geometry, and the owner called the AA gun's "beautiful" as it is.
  const GLOW = 3;
  const TRACER_GLOW = 12;
  const addsLight = m => m.blending === THREE.AdditiveBlending
    || (m.blending === THREE.CustomBlending && m.blendDst === THREE.OneFactor);
  // Smoke is the other half. A particle that covers what is behind it
  // (SrcAlpha / InvSrcAlpha) is blended by the engine in display space,
  // where black smoke at half alpha halves the picture. In this frame's
  // linear light the same alpha takes the wall behind it from 0.8 to 0.58:
  // a burning jeep's column was a faint grey veil, and its flames, with
  // nothing dark behind them, were washed out. A dark texel's alpha is
  // raised to `1 - (1 - a)^2.2`, which over any background is what the
  // engine's blend shows for black; a texel as bright as a typical
  // background (0.45 and up) keeps its own, where the two blends agree.
  // A sprite the art cuts (an `alphaTestRef` of its own) is left as it is.
  // Every sprite carries the engine's floor, which drops alpha 0 alone
  // (effects.js `SPRITE_ALPHA_REF`, 0.5/255) and is not a cut.
  const cut = m => m.alphaTest > 0.01;
  const coversDark = m => m.blending === THREE.NormalBlending
    || (m.blending === THREE.CustomBlending && m.blendSrc === THREE.SrcAlphaFactor && m.blendDst === THREE.OneMinusSrcAlphaFactor);
  function smoke(m) {
    m.remasterGlow = true;
    // Asked in the opacity node, where three asks for the material's
    // opacity itself: read inside a colour node it came back as some other
    // sprite's, and a death's smoke at 0.03 drew as a black square.
    const d = tsl.diffuseColor;
    const a = d.a.mul(tsl.materialOpacity).clamp(0, 1);
    const dark = tsl.float(1).sub(tsl.float(1).sub(a).pow(2.2));
    const lum = tsl.sRGBTransferOETF(d.rgb.max(0)).dot(tsl.vec3(0.2126, 0.7152, 0.0722)).clamp(0, 1);
    m.opacityNode = tsl.mix(dark, a, tsl.smoothstep(0, 0.45, lum)).div(d.a.max(1e-4));
    m.needsUpdate = true;
  }
  remasterHooks.glow = (m, { sprite = false, gain = GLOW } = {}) => {
    if (!m || m.remasterGlow) return;
    if (!addsLight(m)) {
      if (sprite && m.transparent && coversDark(m) && !cut(m)) smoke(m);
      return;
    }
    m.remasterGlow = true;
    const c = tsl.materialColor;
    const byAlpha = m.blending === THREE.AdditiveBlending || m.blendSrc === THREE.SrcAlphaFactor;
    if (sprite && byAlpha && !cut(m)) {
      // The light is carried as colour over coverage, the coverage in the
      // alpha the blend multiplies by, so the frame gets the same light and
      // the fog's tint is weighted by the coverage too. With the alpha held
      // at 1 the fog tinted the whole quad, its empty corners included, and
      // the blend added that tint to the sky: a flak burst 300 m out drew as
      // a pale rectangle (2026-11-14, Battleaxe's AA guns in a replay).
      // The texture's coverage shapes the light in display space, as the
      // engine's blend did; the material's fade is applied by the opacity
      // node alone (a material's opacity read in a colour node is not
      // always its own: "A material's opacity read inside a colour node",
      // below).
      const a = c.a.clamp(1 / 255, 1);
      const display = tsl.sRGBTransferOETF(c.rgb).mul(a).clamp(0, 1);
      m.colorNode = tsl.vec4(tsl.sRGBTransferEOTF(display).mul(gain).div(a), 1);
      m.opacityNode = c.a.mul(tsl.materialOpacity).clamp(0, 1);
    } else {
      m.colorNode = tsl.vec4(c.rgb.mul(gain), c.a);
    }
    m.needsUpdate = true;
  };
  // Tracers (round-launch.js, projectile-flight.js). The engine's streak is
  // a 6 cm spike eight metres long, and the page keeps the light it puts on
  // screen honest: widened to stay visible, it is dimmed by as much, so a
  // burst from a fighter was faint specks, and each round's own copy of the
  // streak had lost the glow its gun's template was given. Here a round's
  // streak glows hotter than a flame (its core blooms), keeps at least
  // `coverage` of its light however far it is, is never thinner on screen
  // than `minPx`, and trails `stretch` times the engine's length: a line
  // of fire from the guns to the target.
  // `everyRound` (2026-11-14, the owner: the stationary MG's firing on
  // Battleaxe "the most stunning", roll it out "even [to] hand held
  // weapons"): every bullet is drawn as that line of light, the rounds
  // between a gun's tracers and a hand weapon's too, which retail never
  // draws. Those take the finer floor `litPx`, so a rifleman's shot is a
  // thread of fire and a gun's own tracers stay the boldest lines.
  remasterHooks.tracer = {
    glow: m => remasterHooks.glow(m, { gain: TRACER_GLOW }),
    stretch: 1.6,
    coverage: 0.3,
    minPx: 3.2,
    litPx: 2,
    everyRound: true,
    // A round fired from the eye has its streak drawn from the muzzle,
    // closing onto its line over this many metres (projectile-flight.js
    // `bendFromMuzzle`).
    fromMuzzle: 40,
  };
  // Light from a flash, a blast or a fire (effects.js `play`): a pool of
  // point lights that is always in the scene, dark until used, since adding
  // or removing a light recompiles every lit material. Which bundle lights
  // what, and how strongly, is remaster-lights.js.
  const flashes = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffb070, 0, 60, 2);
    l.castShadow = false;
    l.userData.remasterFlash = true;
    scene.add(l);
    flashes.push({ light: l, t: 0, life: 1, peak: 0 });
  }
  // Fires: two lights, given each frame to the two fires nearest the eye.
  const fireLights = [];
  for (let i = 0; i < 2; i++) {
    const l = new THREE.PointLight(FIRE.color, 0, FIRE.range, 2);
    l.castShadow = false;
    l.userData.remasterFlash = true;
    scene.add(l);
    fireLights.push(l);
  }
  const fires = new Set();
  /** A run effects.js has just started: kept while it burns, if it is a fire. */
  remasterHooks.fire = run => {
    if (!run?.origin || !isFire(run.name)) return;
    run.remasterFlicker ??= Math.random() * 100;
    fires.add(run);
  };
  const _nearest = [];
  const _eye = new THREE.Vector3();
  function tickFires(seconds) {
    _nearest.length = 0;
    _eye.setFromMatrixPosition(camera.matrixWorld);
    for (const run of fires) {
      // A pooled run is reused under another name once its fire is out.
      if (!run.alive || run.stopped || !isFire(run.name)) { fires.delete(run); continue; }
      const d2 = run.origin.distanceToSquared(_eye);
      if (d2 < FIRE.reach * FIRE.reach) _nearest.push({ run, d2 });
    }
    _nearest.sort((a, b) => a.d2 - b.d2);
    fireLights.forEach((light, i) => {
      const pick = _nearest[i];
      if (!pick) { light.intensity = 0; return; }
      const { run } = pick;
      light.position.set(run.origin.x, run.origin.y + 1.2, run.origin.z);
      light.updateMatrixWorld();
      light.intensity = FIRE.intensity * fireFlicker(seconds + run.remasterFlicker);
    });
  }
  // A big gun's flash is also a burst of light at the muzzle itself: a soft
  // disc `burst` metres across, hotter than white for the bloom, gone with
  // the flash's light. The engine's own flash sprites add up in display
  // space, where two half-bright layers are white; in this frame's linear
  // light they are a dull orange, and a tank's main gun read as weaker than
  // on the retail page. Four discs, as there are four flash lights.
  const BURST_PEAK = 6;
  const bursts = flashes.map(() => {
    const strength = tsl.uniform(0);
    const material = new THREE.SpriteNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.fog = false;
    const edge = tsl.float(1).sub(tsl.uv().sub(0.5).length().mul(2)).clamp(0, 1);
    material.colorNode = tsl.vec4(tsl.vec3(1, 0.8, 0.5).mul(edge.mul(edge).mul(edge)).mul(strength), 1);
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.frustumCulled = false;
    sprite.userData.remasterFlash = true;
    scene.add(sprite);
    return { sprite, strength, size: 0 };
  });
  let flashNext = 0;
  const _flashAt = new THREE.Vector3();
  remasterHooks.flash = (name, position, object = null) => {
    if (!position && !object) return;
    const kind = flashKind(name);
    if (!kind) return;
    const slot = flashNext++ % flashes.length;
    const f = flashes[slot];
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
    const b = bursts[slot];
    b.size = kind.burst ?? 0;
    b.sprite.visible = false;
    if (!b.size) return null;
    // The bundle's first particle says where the muzzle is: the object a
    // muzzle bundle rides is the gun's mount, a barrel's length behind it.
    // The flash's clock starts again there, so the light and the burst are
    // seen with the flash's own sprites however long the emitter waited.
    const claim = f.claim = (f.claim ?? 0) + 1;
    return at => {
      if (f.claim !== claim) return;
      f.t = f.life;
      b.sprite.position.set(at[0], at[1], at[2]);
      b.sprite.scale.setScalar(b.size);
      b.sprite.updateMatrixWorld();
      b.sprite.visible = true;
    };
  };
  let lastFlashTick = performance.now();
  function tickFlashes() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFlashTick) / 1000);
    lastFlashTick = now;
    flashes.forEach((f, i) => {
      const b = bursts[i];
      if (f.t <= 0) { f.light.intensity = 0; b.sprite.visible = false; b.size = 0; return; }
      f.t -= dt;
      const left = Math.max(0, f.t / f.life);
      f.light.intensity = f.peak * left * left;
      // The disc swells a little as it fades, as a puff of burning gas does.
      b.strength.value = BURST_PEAK * left * left;
      if (b.size) { b.sprite.scale.setScalar(b.size * (1.25 - 0.25 * left)); b.sprite.updateMatrixWorld(); }
    });
    tickFires(now / 1000);
  }

  // The tracer material is a module constant, built before this renderer.
  import('./round-visuals.js').then(r => remasterHooks.tracer.glow(r.tracerMaterial)).catch(() => {});

  renderer.toneMappingExposure = 0.58;
  // The engine-combine surfaces are display-referred: handed the exposure to undo.
  viewGain.value = 1 / renderer.toneMappingExposure;

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
  const FOLIAGE_REACH = 120;
  const SOLID_REACH = 450;
  // A caster's reach grows with its size: 300 m a metre of radius (a
  // helmet's 0.2 m casts to 60 m, where it is a texel or two of the middle
  // cascade), and never under 30 m, where the near cascade shows a hand's.
  const REACH_PER_METRE = 300;
  const SMALL_REACH_MIN = 30;
  const proxies = createShadowProxies(scene);
  const casters = [];
  // What moves and is rigid casts as an instance of one batch
  // (remaster-shadow-batch.js): a tank's 74 caster meshes are one object to
  // a cascade, each at its own matrix. In the proxies' group, which a
  // cascade's walk takes whole.
  const shadowBatch = createShadowBatch(THREE, proxies.root, { layer: SHADOW_LAYER });
  /** True once this level's statics have gone to their proxies: what is
   *  left, and what turns up later, is the batch's. */
  let proxiesBuilt = false;
  let batchSynced = false;
  function batchCasters() {
    if (!proxiesBuilt) return;
    const fresh = [];
    for (const k of casters) {
      if (k.batchId != null) continue;
      // A static keeps its proxy; a parked vehicle's part leaves its proxy
      // the moment it moves, and is an instance from then on.
      if (k.proxied && !isVehicle(k.obj)) { k.batchId = -1; continue; }
      fresh.push(k);
    }
    if (fresh.length) shadowBatch.addAll(fresh);
  }
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
  // The performance pass's switches, each on; a rig turns one off through
  // `__remaster.tune` to measure it in the same page, the same second.
  const tune = { cascadeMatrices: true, cascadeWalk: true, quietShadowMaterial: true, reachPerMetre: REACH_PER_METRE, shadowBatch: true,
    // The post chain's passes (`buildPipeline`), each rebuilt on a change.
    ao: true, bloom: true, shafts: true, smaa: true,
    // The soft passes sized by the CSS pixel (`sizePost`); off, by the device pixel.
    cssPost: true,
    // The level's frozen statics drawn as three's `static` objects (`holdStatics`).
    staticObjects: true };
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
    // A shadow cascade is drawn from inside the main pass, after that pass
    // has brought every world matrix up to date; three would walk the whole
    // scene again to update them for each cascade (about 0.7 ms a cascade on
    // a level of 7,000 objects). The cascade's own camera and light are
    // updated by the shadow node itself.
    if (s === scene && c !== camera && c?.isOrthographicCamera && scene.matrixWorldAutoUpdate && tune.cascadeMatrices) {
      scene.matrixWorldAutoUpdate = false;
      // And it walks only the branches that hold a caster (`markCasters`).
      cascadeWalk = castStamp > 0 && tune.cascadeWalk;
      quietShadowMaterial(scene.overrideMaterial, tune.quietShadowMaterial);
      // The batch's instances at this frame's matrices, which the main pass
      // has just brought up to date: once, before the frame's first cascade.
      if (!batchSynced) { batchSynced = true; shadowBatch.sync(scene); }
      try { return render(s, c); } finally { scene.matrixWorldAutoUpdate = true; cascadeWalk = false; }
    }
    return render(s, c);
  };
  // three draws every caster of a cascade with one shadow material, handed
  // each caster's `alphaTest` in turn, and `Material.alphaTest`'s setter
  // counts a change between cut and uncut as a new version of the material.
  // Cut and uncut casters alternate (a palm, a wall, a fence), so every
  // caster found the material "changed" and re-derived its whole cache key,
  // every cascade, every frame: half the cost of a shadow draw. A caster's
  // own draw record is built once with its own cut and does not depend on
  // that counter, so on this one material the setter stops counting.
  function quietShadowMaterial(material, quiet) {
    if (!material?.isShadowPassMaterial || !!material.rmQuiet === !!quiet) return;
    material.rmQuiet = !!quiet;
    if (quiet) {
      Object.defineProperty(material, 'alphaTest', {
        configurable: true,
        get() { return this._alphaTest; },
        set(value) { this._alphaTest = value; },
      });
    } else {
      delete material.alphaTest;
    }
  }
  // three projects a scene by visiting every object in it, for every pass.
  // A cascade draws a few hundred casters out of some 14,000 objects, and
  // there are up to three cascades a frame; here its walk leaves every
  // branch that `markCasters` did not stamp. The proxies' own group is
  // walked whole: its members come and go between judgements.
  const PROXY_ROOT = 'remaster shadow proxies';   // remaster-shadow-proxies.js
  let cascadeWalk = false;
  let castStamp = 0;
  const projectObject = renderer._projectObject;
  if (typeof projectObject === 'function') {
    renderer._projectObject = function (object, cam, groupOrder, renderList, clippingContext) {
      if (cascadeWalk) {
        if (object.name === PROXY_ROOT) {
          cascadeWalk = false;
          try { return projectObject.call(this, object, cam, groupOrder, renderList, clippingContext); }
          finally { cascadeWalk = true; }
        }
        if (object.rmCastStamp !== castStamp) return;
      }
      return projectObject.call(this, object, cam, groupOrder, renderList, clippingContext);
    };
  }
  /** Stamp each casting mesh and the branch above it, after a judgement. */
  function markCasters() {
    castStamp++;
    scene.rmCastStamp = castStamp;
    for (const k of casters) {
      if (k.proxied || !k.obj.castShadow) continue;
      for (let a = k.obj; a && a.rmCastStamp !== castStamp; a = a.parent) a.rmCastStamp = castStamp;
    }
  }

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
      obj.receiveShadow = true;
      // Terrain never casts (the art carries its own relief shadows), nor do
      // its copies past the world's edge (level-edge.js, `edgeOf`).
      // A far tree's billboard neither: the tree's own parts cast near, and
      // a card turned to the sun shadows as its whole strip.
      const cast = !blended && obj.userData?.kind !== 'terrain' && !obj.userData?.edgeOf
        && !obj.userData?.treeImpostor;
      if (!cast) return;
      const leafy = mats.some(m => m.alphaTest || m.remasterSprite);
      if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      // A small part casts only where a cascade can resolve it: a helmet,
      // a hand or a wheel is under a shadow texel long before SOLID_REACH,
      // and a soldier is thirteen such parts, each a draw in every cascade.
      const r = obj.geometry.boundingSphere?.radius ?? 1;
      casters.push({ obj, reach: leafy ? FOLIAGE_REACH : SOLID_REACH, r });
      obj.castShadow = false;
    });
  }
  const _p = new THREE.Vector3();
  const _lastEye = new THREE.Vector3(1e9, 0, 0);
  function judgeCasters() {
    const c = camera.position;
    let n = 0;
    for (let i = casters.length - 1; i >= 0; i--) {
      const k = casters[i];
      if (!k.obj.parent) { shadowBatch.remove(k); casters.splice(i, 1); continue; }
      if (k.proxied) continue;
      // The sun's shadow cameras see only SHADOW_LAYER (remaster-sky.js), so
      // a mesh casting for itself is on that layer as well as its own.
      if (!k.layered) { k.obj.layers.enable(SHADOW_LAYER); k.layered = true; }
      _p.setFromMatrixPosition(k.obj.matrixWorld);
      const reach = Math.min(k.reach, Math.max(SMALL_REACH_MIN, k.r * tune.reachPerMetre)) + k.r;
      const on = _p.distanceToSquared(c) < reach * reach;
      // An instance of the batch is shown by this judgement; the mesh
      // itself casts only when it is not one.
      const batched = k.batchId >= 0 && tune.shadowBatch;
      k.on = batched && on;
      k.obj.castShadow = on && !batched;
      if (on) n++;
    }
    markCasters();
    return n;
  }
  // The hull the Inside view takes away (vehicle-base.js `CockpitSwap`): it
  // leaves the eye's layer and stays on the shadow cameras', so the plane a
  // pilot sits in still casts its whole shadow. Hidden outright it cast
  // none, and what fell on the ground was the shadow of the few cockpit
  // pieces the view draws: a small, broken copy of the plane's.
  remasterHooks.viewHidden = (node, hidden) => {
    node.visible = true;
    if (!!node.userData.rmViewHidden === !!hidden) return;
    node.userData.rmViewHidden = !!hidden;
    node.traverse(obj => {
      if (!obj.isMesh && !obj.isLine && !obj.isPoints && !obj.isSprite) return;
      // Counted: one hidden node may hold another.
      const n = (obj.userData.rmViewHides || 0) + (hidden ? 1 : -1);
      obj.userData.rmViewHides = Math.max(0, n);
      if (hidden && n === 1) {
        obj.userData.rmEyeLayer = obj.layers.isEnabled(0);
        obj.layers.disable(0);
      } else if (!hidden && n === 0 && obj.userData.rmEyeLayer) {
        obj.layers.enable(0);
      }
    });
  };
  let lastFlag = 0;
  let lastJudge = 0;
  let lastNodeFrame = -1;
  let earlyFrames = 0;

  // The level's frozen statics as three's `static` objects. For every object
  // it draws, three compares the object's world matrix, its material's
  // properties, its geometry and the lights' shadow maps against what it drew
  // last (`NodeMaterialObserver.equals`), to know whether its bindings need
  // building again; a `static` object skips the comparison. A frozen static
  // (level-statics.js `freezeStatics`) never moves, and on a level of
  // lightmapped buildings the comparison was a millisecond of a frame
  // (Liberation of Caen, 600 static draws; features/remaster-browser, "A replay
  // that slowed as it played"). What the page does change on a static is left
  // out: the texture-fade planes and the alpha-LOD cards (their materials
  // change with the camera), batches, and the spawners' vehicles. For what
  // is left, once a second one frame draws them without the flag, so any
  // other change reaches the GPU within a second; and a change of SHADOWS
  // (which builds or drops the sun's shadow maps the bindings name) drops the
  // flag for a few frames at once. Only once the level's textures are all up
  // (`uploadSome`): a texture uploaded after the flag would not be rebound.
  let levelRoot = null;
  let statics = null;     // the meshes, once marked
  let staticsOn = false;
  let staticsAt = 0;
  let staticsShadows = null;
  let staticsHold = 0;
  function markStatics() {
    statics = [];
    for (const child of levelRoot.children) {
      if (!Object.hasOwn(child, 'updateMatrixWorld') || child.userData?.kind === 'spawners') continue;
      child.traverse(o => {
        if (!o.isMesh || o.isSkinnedMesh || o.isBatchedMesh || o.isInstancedMesh) return;
        const mats = [o.material].flat();
        if (mats.some(m => !m || m.userData?.textureFade || m.userData?.alphaTestRef !== undefined
          || m.userData?.additive)) return;
        statics.push(o);
      });
    }
  }
  function setStatics(on) {
    if (on === staticsOn || !statics) return;
    staticsOn = on;
    for (const o of statics) o.static = on;
  }
  function holdStatics(shadows, now) {
    if (!tune.staticObjects) { setStatics(false); return; }
    if (!levelRoot || textureQueue.length || earlyFrames < 600) return;
    if (!statics) markStatics();
    if (shadows !== staticsShadows) {
      staticsShadows = shadows;
      staticsHold = earlyFrames + 5;
      setStatics(false);
      return;
    }
    if (earlyFrames < staticsHold) return;
    if (now - staticsAt > 1000) { staticsAt = now; setStatics(false); } else setStatics(true);
  }

  // The light shafts' sun on the screen, set each frame (`updateShafts`).
  const shaftCenter = tsl.uniform(new THREE.Vector2(0.5, 0.5));
  const shaftStrength = tsl.uniform(0);
  const shaftThreshold = tsl.uniform(0.9);
  const _sunPoint = new THREE.Vector3();
  const _view = new THREE.Vector3();
  function updateShafts() {
    const toward = atmosphere.sunDir;
    camera.getWorldDirection(_view);
    const facing = _view.dot(toward);
    _sunPoint.copy(camera.position).addScaledVector(toward, 1000).project(camera);
    // Screen UV, y down (the pass texture's own).
    shaftCenter.value.set(_sunPoint.x * 0.5 + 0.5, 0.5 - _sunPoint.y * 0.5);
    // Full with the sun in view, gone a little past the screen's edge.
    const edge = Math.max(Math.abs(_sunPoint.x), Math.abs(_sunPoint.y));
    shaftStrength.value = facing <= 0 ? 0 : 0.35 * Math.min(1, facing * 3) * Math.max(0, Math.min(1, (1.8 - edge) / 0.8));
  }

  // The warm-up (retail's is level-warmup.js, rule 6 of
  // features/mesh-viewer-performance, which the WebGL build runs and this
  // one skips). Without it the first frame to see a building builds its
  // pipeline on the main thread, and the first to bind a texture uploads it
  // and makes its mips: the owner's "a little stuttery at the start"
  // (2026-11-12), 140 to 500 ms frames while the camera first turns. So once
  // a level is drawing, every pipeline the scene pass can need is built off
  // the thread (`compileAsync`, frustum culling lifted for its one
  // synchronous walk), and every texture a material binds is uploaded, a few
  // a frame. Twice: a few frames after the level is up, and again when the
  // vehicles and soldiers it spawns have arrived.
  let scenePassRef = null;
  const warmAt = [];
  const textureQueue = [];
  const queuedTextures = new WeakSet();
  let lastWarm = null;
  function queueTextures(root) {
    root.traverse(o => {
      for (const m of [o.material].flat()) {
        if (!m) continue;
        for (const v of Object.values(m)) {
          if (v?.isTexture && !v.isRenderTargetTexture && !queuedTextures.has(v)) {
            queuedTextures.add(v);
            textureQueue.push(v);
          }
        }
      }
    });
  }
  function uploadSome(budgetMs = 4) {
    const t0 = performance.now();
    while (textureQueue.length && performance.now() - t0 < budgetMs) {
      const t = textureQueue.shift();
      const img = t.image;
      // Pixels not arrived yet: dropped for now (the next warm-up queues it
      // again, or its first draw uploads it, as before).
      if (!img || (img.width === 0 && !img.data) || t.version === 0) {
        queuedTextures.delete(t);
        continue;
      }
      try { renderer.initTexture(t); } catch { /* drawn as before */ }
    }
  }
  /** Hidden things play can show are built too, as the WebGL warm-up's
   *  `compile` builds them (level-warmup.js): the effect pool's parked
   *  sprites, a vehicle not spawned yet, a wreck, a gun's flash. three's
   *  WebGPU walk skips a hidden node and everything under it, so the first
   *  explosion of a session built its sprites' pipelines on the main thread
   *  in the frame that drew them: "very laggy at key moments, when I shoot
   *  something that explodes" (the owner, 2026-11-13; 444 ms on Wake for the
   *  first `BombBig_Expl`, nothing for any after it). A collision hull is
   *  never drawn and stays hidden. `within` is the scene whose lights, fog
   *  and sky `target` draws under, when `target` is a part of one. */
  const NEVER_DRAWN = /collision/i;
  function warmPipelines(target, cam, why, within = null) {
    const flipped = [];
    const shown = [];
    const lift = o => {
      if (o.visible === false) {
        if (NEVER_DRAWN.test(o.name) || o.userData?.remasterNoWarm) return;
        o.visible = true;
        shown.push(o);
      }
      if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.frustumCulled) { o.frustumCulled = false; flipped.push(o); }
      for (const c of o.children) lift(c);
    };
    lift(target);
    const t0 = performance.now();
    let job;
    const rt = renderer.getRenderTarget();
    const mrt = renderer.getMRT();
    try {
      // The scene pass's own target and MRT: a pipeline is keyed by them.
      if ((within ?? target) === scene && scenePassRef) {
        renderer.setRenderTarget(scenePassRef.renderTarget);
        renderer.setMRT(scenePassRef._mrt ?? null);
      }
      // Synchronous up to its first wait: the walk, and every pipeline
      // asked for. The target, culling and hidden nodes are put back before
      // any frame.
      job = renderer.compileAsync(target, cam, within && within !== target ? within : null);
    } catch (err) {
      console.warn('[remaster] warm-up', why, err);
    } finally {
      renderer.setRenderTarget(rt);
      renderer.setMRT(mrt);
      for (const o of flipped) o.frustumCulled = true;
      for (const o of shown) o.visible = false;
    }
    queueTextures(target);
    const walk = performance.now() - t0;
    lastWarm = Promise.resolve(job).then(() => {
      const ms = performance.now() - t0;
      // The level is built: from here a new pipeline never holds a frame.
      if (target === scene) asyncPipelines.on = asyncPipelines.installed;
      console.info(`[remaster] warm-up (${why}): ${flipped.length} objects (${shown.length} hidden roots shown), walk ${walk.toFixed(0)} ms, pipelines ready in ${ms.toFixed(0)} ms, ${textureQueue.length} textures to upload`);
    }, err => console.warn('[remaster] warm-up', why, err));
    return lastWarm;
  }

  // The post chain, built once the camera is final.
  //
  // Its soft passes are sized by the CSS pixel, not the device pixel. The
  // look was judged at 1600 x 900 and a pixel ratio of 1 (AO at 800 x 450,
  // the shafts from 800 x 450); on a laptop's own screen at a ratio of 2 the
  // same fractions of the drawing buffer are four times the pixels for a
  // blur that looks the same, and they were most of the GPU's frame
  // (features/remaster-browser, "A replay that slowed as it played").
  // The scene pass and SMAA stay at the device pixel: they are the detail.
  // So does the bloom: from a quarter-size source the sun's glint on the
  // water lost its glow, its sparkles averaged under the threshold.
  let pipeline = null;
  let builtFor = '';
  let post = null;   // { ao, bloom, shaftMask, shaftRays } of the built chain
  const postKey = () => `${tune.ao}${tune.bloom}${tune.shafts}${tune.smaa}`;
  const softScale = () => tune.cssPost ? 1 / Math.max(1, renderer.getPixelRatio()) : 1;
  function sizePost() {
    if (!post) return;
    const k = softScale();
    if (post.ao) post.ao.resolutionScale = 0.5 * k;
    // The shafts: drawn only while the sun is near the view (their strength
    // is zero otherwise, and a zero times 40 taps a pixel is still 40 taps).
    const on = shaftStrength.value > 0 || !tune.cssPost;
    for (const node of [post.shaftMask, post.shaftRays]) {
      if (!node) continue;
      node._resolutionScale = 0.5 * k;
      node.autoUpdate = on;
    }
  }
  function buildPipeline() {
    const { pass, mix, float, vec4, clamp } = tsl;
    // One sample: the ambient occlusion reads the depth, which a multisampled
    // pass cannot hand it; the edges are smoothed by SMAA instead.
    builtFor = postKey();
    post = {};
    const scenePass = pass(scene, camera, { samples: 0 });
    scenePassRef = scenePass;
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const open = depth.r.greaterThanEqual(0.99999);
    let out = color.rgb;
    // Ambient occlusion at half resolution; the sky has no surface to occlude.
    if (tune.ao) {
      const aoPass = post.ao = gtao.ao(depth, null, camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 1.6;
      aoPass.distanceExponent.value = 1.4;
      aoPass.scale.value = 1.1;
      aoPass.thickness.value = 1.5;
      const occlusion = open.select(float(1), aoPass.getTextureNode().r);
      // At 0.85 the contact darkening took the detail out of a soldier's or
      // a hull's shaded side along with the shadow (owner, 2026-11-14);
      // 0.55 keeps the grounding under a wheel and a sandbag.
      out = out.mul(mix(float(1), occlusion, 0.55));
    }
    if (tune.bloom) {
      post.bloom = bloomMod.bloom(color, 0.3, 0.35, 2.4);
      out = out.add(post.bloom.rgb);
    }
    // Light shafts: the bright, open sky radially blurred toward the sun's
    // place on the screen, so the sun breaks through tree crowns, eaves and
    // the girders of a bridge. Faded out as the sun leaves the view. The
    // mask and the blur are each their own half-size target (in CSS pixels):
    // inline, the 40 taps ran for every device pixel of the frame.
    if (tune.shafts) {
      const bright = tsl.max(color.rgb.dot(tsl.vec3(0.2126, 0.7152, 0.0722)).sub(shaftThreshold), 0);
      const mask = post.shaftMask = tsl.rtt(vec4(color.rgb.mul(bright).mul(open.select(float(1), float(0))), 1),
        null, null, { resolutionScale: 0.5 });
      const rays = post.shaftRays = tsl.rtt(
        shaftMod.radialBlur(mask, { center: shaftCenter, weight: float(0.9), decay: float(0.955), count: tsl.int(40), exposure: float(1.2) }),
        null, null, { resolutionScale: 0.5 });
      out = out.add(rays.rgb.mul(shaftStrength));
    }
    sizePost();
    // SMAA on the HDR frame, its edges found on values held under 4 so a
    // flash's core does not swamp the luma test.
    if (tune.smaa) out = smaaMod.smaa(vec4(clamp(out, 0, 4), 1));
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
    tune,
    /** For the captures and tests: the moving casters batched and the batch's room. */
    shadowBatch: () => ({ count: shadowBatch.count, ...shadowBatch.capacity,
      shown: shadowBatch.mesh?._multiDrawCount ?? 0, casters: casters.length }),
    /** For the captures and tests: the fires alight and each light's strength. */
    lights: () => ({ fires: [...fires].map(r => r.name), fire: fireLights.map(l => +l.intensity.toFixed(1)),
      flash: flashes.map(f => +f.light.intensity.toFixed(1)), bursts: bursts.map(b => b.sprite.visible) }),
    /** After a level is up: its sky, sun, fog and shadow flags. */
    levelLoaded(extras, root) {
      setStatics(false);
      statics = null;
      levelRoot = root ?? null;
      atmosphere.apply(extras);
      flagShadows(root ?? scene);
      const t = performance.now();
      // The last level's casters go with it. Its root left the scene with
      // every mesh still under it, so none looks detached by itself; left
      // in the list, its statics were merged into this level's proxies
      // (their shadows on ground they never stood on) and its vehicles
      // took instances. One that is only out of the scene for now (a round
      // back in its pool) is flagged afresh when it returns.
      for (let i = casters.length - 1; i >= 0; i--) {
        let top = casters[i].obj;
        while (top.parent) top = top.parent;
        if (top === scene) continue;
        casters[i].obj.userData.rmShadow = false;
        casters.splice(i, 1);
      }
      shadowBatch.reset();
      for (const k of casters) k.batchId = null;
      const r = proxies.build(casters, atmosphere.sunDir);
      proxiesBuilt = true;
      batchCasters();
      console.info(`[remaster] shadow proxies: ${r.sources} static meshes as ${r.proxies} proxies in ${(performance.now() - t).toFixed(0)} ms`);
      judgeCasters();
      lastFlag = performance.now();
      // Five frames in (the scene pass is set up, the cascades fitted), and
      // again three seconds on.
      // A request the old level left is answered, not left waiting.
      for (const w of warmAt.splice(0)) w.resolve?.();
      warmAt.push({ frame: earlyFrames + 5, why: 'level' }, { at: performance.now() + 3000, why: 'spawned' });
    },
    /** An overlay pass's scene (the first-person arms and weapon). Its
     *  materials are the engine's own combine (remaster-materials.js
     *  `viewMaterial`) and read no light; they are handed the exposure to
     *  undo. Anything else in the scene still lit (an ejected case, a
     *  muzzle's smoke) takes the sky's light at the world's strength. */
    lightOverlay(overlay) {
      if (!overlay) return;
      overlay.environment = scene.environment;
      overlay.environmentIntensity = scene.environmentIntensity;
      viewGain.value = 1 / Math.max(0.1, renderer.toneMappingExposure);
      // The arms and the gun, built before their first frame: once for each
      // rig the scene holds (a weapon change swaps it), not once a frame.
      // Until 2026-11-13 this asked for a warm-up on every frame the rig
      // drew, a `compileAsync` walk of the overlay sixty times a second.
      let rig = '';
      for (const a of overlay.children) for (const b of a.children) rig += `${b.id}:${b.children.length},`;
      if (rig !== overlays.get(overlay)) {
        overlays.set(overlay, rig);
        warmAt.push({ frame: earlyFrames + 1, why: 'overlay', target: overlay });
      }
    },
    /** The page's own warm points (level-warmup.js `warmSubtree`: a rig, a
     *  seat's cockpit, a replay's models, the level and its effect pool):
     *  `root` built for the pass that draws it, a few frames on (the scene
     *  pass and the cascades must exist first). Resolves when its pipelines
     *  are ready. One request a root: a second before the first has run
     *  rides on it. */
    warm(root, cam = camera, within = scene) {
      if (!root) return Promise.resolve();
      const queued = warmAt.find(w => (w.target ?? scene) === root);
      if (queued) {
        queued.promise ??= new Promise(resolve => { queued.resolve = resolve; });
        return queued.promise;
      }
      const entry = { frame: earlyFrames + 5, why: root === scene ? 'page: scene' : `page: ${root.name || root.type}`, target: root, cam, within };
      entry.promise = new Promise(resolve => { entry.resolve = resolve; });
      warmAt.push(entry);
      return entry.promise;
    },
    /** Pipelines built off the thread during play: `{ on, pending, built }`. */
    asyncPipelines: () => ({ ...asyncPipelines }),
    /** One frame. `shadows` is OPTIONS > VIDEO's SHADOWS row. */
    render({ shadows = true } = {}) {
      atmosphere.setShadows(shadows);
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
      if (now - lastFlag > 1000) { lastFlag = now; flagShadows(scene); proxies.refresh(casters); batchCasters(); }
      batchSynced = false;
      holdStatics(shadows, now);
      if (now - lastJudge > 200 || camera.position.distanceToSquared(_lastEye) > 400) {
        lastJudge = now;
        _lastEye.copy(camera.position);
        judgeCasters();
      }
      const autoClear = renderer.autoClear;
      renderer.autoClear = true;
      if (pipeline && builtFor !== postKey()) { pipeline.material.dispose(); pipeline = null; }
      sizePost();
      (pipeline ?? buildPipeline()).render(renderer);
      renderer.autoClear = autoClear;
      for (let i = warmAt.length - 1; i >= 0; i--) {
        const w = warmAt[i];
        if ((w.frame != null && earlyFrames >= w.frame) || (w.at != null && now >= w.at)) {
          warmAt.splice(i, 1);
          const done = warmPipelines(w.target ?? scene, w.cam ?? camera, w.why, w.within ?? null);
          w.resolve?.(done);
        }
      }
      if (textureQueue.length) uploadSome();
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
