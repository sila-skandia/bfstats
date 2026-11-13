// Remaster mode's surfaces (features/remaster-browser). The retail page draws
// every static, vehicle and soldier as an unlit MeshBasicMaterial with the
// engine's fixed-function combine injected through `onBeforeCompile`
// (level-shading.js). The WebGPU renderer runs no GLSL patches, so these
// builders make the same combines as node materials, and add to them what
// the remaster adds: the sun's real-time shadow in the combine's sun term
// (`EngineMaterial`). Nothing is relit: the art is painted for these combines.
//
// level-shading.js calls in here through `remasterHooks.materials`, at the
// same three points it builds the retail materials: the terrain's detail
// combine, the lightmapped statics and the dynamically lit meshes.

import * as THREE from 'three/webgpu';
import {
  abs, clamp, cubeTexture, diffuseColor, dot, float, fract, fwidth, materialColor, materialReference, max,
  min, mix, positionWorld, step, normalView, normalWorld, reference, reflectView, uniform, normalize,
  sRGBTransferEOTF, sRGBTransferOETF, smoothstep, uv, vec2, vec3, vec4, normalMap, transformNormalToView,
} from 'three/tsl';
import { REMASTER_OFF } from './remaster-mode.js';
import { ENVMAP_SWITCH } from './envmap.js';

// Every texture in these graphs is read through the material being drawn
// (`materialReference`), never baked into the graph with `texture(t)`: three
// shares one compiled graph between materials whose graphs have the same
// shape, so a baked texture drew the first terrain patch's tile on every
// patch, and the first lightmap on every lightmapped static.
/**
 * A shadow pass's cut by `material`'s own map alpha. Bound to the material
 * object, as three's own shadow alpha is: in the shadow pass the material
 * being drawn is the depth material, which has no map.
 */
export function shadowCut(material, threshold = 0.5) {
  return reference('map', 'texture', material).a.greaterThan(threshold);
}

export function matTexture(name) {
  const ref = materialReference(name, 'texture');
  // The inner texture node exists before the build so `at` can clone it; the
  // build must then still point the reference at the material being built
  // (three only does that itself when the inner node does not exist yet).
  ref.reference = { [name]: null };
  ref.setNodeType('texture');
  const setup = ref.setup.bind(ref);
  ref.setup = builder => {
    ref.updateReference(builder);
    return setup(builder);
  };
  return {
    /** Sampled at the mesh's own UV, as `map` is. */
    ref,
    /** Sampled at `uvNode`: a clone that follows the reference's texture. */
    at: uvNode => ref.node.sample(uvNode),
    /** Zero, but keeps the reference (and so its per-material update) in a
     *  graph that only samples it at another UV. */
    keep: ref.x.mul(0),
  };
}

const TERRAIN_DETAIL_MIP_BIAS = -1.5;
const remasterDebug = REMASTER_OFF;

// The generated normal and roughness maps (remaster_texture_maps.py): one
// packed WebP a store texture (RG normal, B roughness) under
// `remaster-textures/`, listed in its index, which remaster-renderer.js
// loads before the first level (`setTextureMaps`).
let mapIndex = new Set();
const mapCache = new Map();
const mapLoader = new THREE.TextureLoader();
export function setTextureMaps(hashes) { mapIndex = new Set(hashes || []); }

/** The packed map for `map`'s store texture, or null when none was generated. */
function packedMapFor(map) {
  const hash = map?.userData?.storeHash;
  if (!hash || !mapIndex.has(hash) || !REMASTER_OFF.has('maps')) return null;
  let t = mapCache.get(hash);
  if (!t) {
    t = mapLoader.load(`./remaster-textures/${hash.slice(0, 2)}/${hash}.webp`);
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = map.flipY;
    t.wrapS = map.wrapS;
    t.wrapT = map.wrapT;
    t.anisotropy = 8;
    mapCache.set(hash, t);
  }
  return t;
}

/**
 * Relief and roughness on a lit material from its texture's generated map:
 * the normal perturbed in the texture's own space (three derives the
 * tangent frame from the UVs), the roughness read per texel and scaled by
 * the material's own (`roughness`: shinier materials stay shinier).
 */
function applyPackedMap(mat, map, strength = 1) {
  const packed = packedMapFor(map);
  if (!packed) return;
  mat.bfPacked = packed;
  const nr = matTexture('bfPacked').ref;
  const x = nr.r.mul(2).sub(1);
  const y = nr.g.mul(2).sub(1);
  const z = float(1).sub(x.mul(x)).sub(y.mul(y)).max(0).sqrt();
  mat.normalNode = normalMap(vec3(nr.r, nr.g, z.mul(0.5).add(0.5)), vec2(strength, strength));
  if (mat.isMeshStandardMaterial) mat.roughnessNode = nr.b.mul(materialReference('roughness', 'float').div(0.82)).clamp(0.05, 1);
}

/** Every node slot, `bf*` texture slot and remaster mark of `from`, onto `to`. */
export function copyRemasterProps(from, to) {
  for (const k of Object.keys(from)) {
    if (/Node$/.test(k) || /^bf/.test(k) || /^remaster/.test(k)) to[k] = from[k];
  }
  return to;
}

/** `Material.clone` keeps only three's own slots: a remaster material's
 *  clone (a texture fade, a tree's blend band, a skeleton's own copy) keeps
 *  its graphs and the textures they read too. */
function cloneWithNodes(mat) {
  const base = Object.getPrototypeOf(mat).clone;
  mat.clone = function clone() {
    const c = base.call(this);
    // three r186's `NodeMaterial.copy` copies what it can enumerate, and
    // `alphaTest` is an accessor on Material's prototype with an underscored
    // field behind it: neither is reached, so a node material's clone comes
    // back with no alpha cut. A palm in its fade band (tree-foliage.js
    // clones its materials to fade them) drew its fronds as whole white
    // blades, the cards' uncut corners.
    c.alphaTest = this.alphaTest;
    copyRemasterProps(this, c);
    c.clone = this.clone;
    return c;
  };
  return mat;
}

/**
 * The engine's combine, with the sun's real-time shadow in it.
 *
 * Every static, vehicle, soldier and tree in the world is drawn with the
 * combine the retail page draws it with (level-shading.js, ledger DL-5,
 * LM-4; tree-foliage.js), in display space, at the art's own brightness:
 *
 *     lit        2 * tex * clamp(floor + sun * materialDiffuse * k)
 *     frond      the same, a tree's branch card (k from either side)
 *     lightmap   2 * tex * lightmap'
 *     terrain    art * shade                (the ground, retail unlit)
 *     leaf       2 * tex * shade            (a leaf sprite, retail unlit)
 *     card       tex * shade                (the far tree card, retail unlit)
 *
 * What the remaster adds is `k`: the sun's N.L against the sun the player
 * sees, times the cascaded shadow map. A face in another object's shadow
 * draws at the combine's own floor, which is where the engine put its shaded
 * side, so a cast shadow and a shaded face are the same tone and both keep
 * the whole texture.
 *
 * Until 2026-11-13 these were physically based surfaces under the sun and
 * the sky's image-based light. A shaded face was lit by the sky's blue alone:
 * a palm against the sun was a grey cut-out, the Shokaku's masts grey blobs,
 * a bunker a flat pale box, and a sunlit hull lost its paint to the specular.
 * The owner: "the dark shadows have that gel grey feeling", "overly darkened
 * and grey contrast", "ugly and lacking light and detail". The art is painted
 * to be seen under the engine's combine (the same finding as the weapon in
 * hand, below), so it gets that combine, and the remaster keeps what it adds:
 * the shadows.
 *
 * A lighting model, not a colour graph: three hands `direct` each light's
 * colour with its shadow already multiplied in, so the sun's term over the
 * light's own colour (`engineSunLin`) is `k`. The sky's image-based light and
 * the hemisphere are not read.
 */
export const viewGain = uniform(1);
const engineSunLin = uniform(new THREE.Vector3(1, 1, 1));
/** The DirectionalLight whose colour and intensity `k` is measured against. */
let engineSunLight = null;
export function bindEngineSun(light) {
  engineSunLight = light;
  engineSunLin.onRenderUpdate(() => {
    const c = light.color, i = Math.max(1e-3, light.intensity);
    engineSunLin.value.set(Math.max(1e-3, c.r * i), Math.max(1e-3, c.g * i), Math.max(1e-3, c.b * i));
  });
}
/** What a leaf in shade keeps of its texture, against one in the sun. */
export const LEAF_SHADE = 0.66;
/** The share of the sun a leaf or a frond takes whichever way it faces. */
export const FOLIAGE_THROUGH = 0.6;
/**
 * The lightmap value a real-time shadow takes a sunlit texel down to. The
 * bake's own shadowed texels read 0.06 to 0.12 (Wake: half of every map sits
 * there, the sunlit peak at 0.62), so a soldier's shadow on a wall lands
 * where the palm's baked shadow beside it already is.
 */
export const LIGHTMAP_SHADE = 0.12;

// OPTIONS > VIDEO's ENVIRONMENT MAPPING (ledger VID-3), read each frame.
const viewEnvOn = uniform(1).onRenderUpdate(() => (ENVMAP_SWITCH.value ? 1 : 0));
// One node for the level's cube, re-pointed at each level's own.
let viewCube = null;
function levelCube(cube) {
  // three's cube lookup mirrors x for a loaded cube; the engine's stage,
  // as the retail page's shader samples it, does not.
  if (!viewCube) viewCube = cubeTexture(cube, vec3(reflectView.x.negate(), reflectView.y, reflectView.z));
  viewCube.value = cube;
  return viewCube;
}
/** `envmap true`'s stage over `display` (envmap.js): `lit * A + cube * (1 - A)`. */
function envStage(display, alpha) {
  const staged = mix(sRGBTransferOETF(viewCube.rgb), display, alpha.clamp(0, 1));
  return mix(display, min(vec3(1), staged), viewEnvOn);
}

class EngineLightingModel extends THREE.LightingModel {
  constructor(kind, env) {
    super();
    this.kind = kind;
    this.env = env;
  }

  direct({ lightDirection, lightColor, lightNode, reflectedLight }) {
    const ndl = normalView.dot(lightDirection);
    if ((this.kind === 'lightmap' || this.kind === 'terrain') && lightNode?.light === engineSunLight) {
      // The bake (a wall's lightmap, the ground's painted art) holds the
      // surface's own N.L, its own shade and the sky's light on the side
      // turned from the sun; only a sun-facing texel is asked whether
      // something stands between it and the sun. (A wall turned away is in
      // its own shadow in the shadow map, and taking that darkened every
      // building's far side to the bake's cast-shadow tone.)
      //
      // The ground casts no shadow (its art has the relief's painted in), so
      // a palm's shadow would otherwise fall through a hill onto the slope
      // behind it. A slope turned from the sun takes none; level ground
      // takes a cast shadow whole whatever the sun's height.
      const flat = transformNormalToView(vec3(0, 1, 0)).dot(lightDirection).max(0.05);
      const facing = this.kind === 'terrain'
        ? smoothstep(0, flat.mul(0.5), ndl)
        : smoothstep(0, 0.25, ndl);
      reflectedLight.directDiffuse.addAssign(mix(engineSunLin, lightColor, facing));
      return;
    }
    // lit: Lambert. Foliage passes light: a frond or a leaf with the sun
    // behind it glows, so the sun's share is taken from either side, and
    // never under FOLIAGE_THROUGH of it. (Lit as an opaque wall, a palm
    // against the sun was a black cut-out.)
    const share = this.kind === 'lit' || this.kind === 'lightmap' || this.kind === 'terrain' ? ndl.clamp()
      : ndl.abs().mul(1 - FOLIAGE_THROUGH).add(FOLIAGE_THROUGH);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(share));
  }

  indirect() {}

  finish({ context }) {
    const k = context.reflectedLight.directDiffuse.div(engineSunLin).clamp(0, 1);
    const tex = sRGBTransferOETF(diffuseColor.rgb);
    let display;
    if (this.kind === 'lit' || this.kind === 'frond') {
      // D3D clamps the vertex diffuse to [0, 1] before the stage's
      // modulate-2x, and saturates again after the multiply.
      const lit = min(vec3(1), materialReference('bfEngineFloor', 'vec3')
        .add(materialReference('bfEngineSun', 'vec3').mul(k))).mul(2);
      display = min(vec3(1), tex.mul(lit));
      if (this.env) display = envStage(display, matTexture('map').ref.a);
    } else if (this.kind === 'lightmap') {
      const lmTex = matTexture('bfLightmap');
      const lm = vec3(lmTex.keep).add(lmTex.at(uv(1)).rgb);
      const shaded = min(lm, vec3(LIGHTMAP_SHADE));
      display = min(vec3(1), tex.mul(mix(shaded, lm, k).mul(2)));
    } else if (this.kind === 'terrain') {
      display = tex.mul(mix(materialReference('bfEngineFloor', 'vec3'), vec3(1), k));
    } else {
      const shade = mix(vec3(LEAF_SHADE), vec3(1), k);
      display = min(vec3(1), tex.mul(shade).mul(this.kind === 'leaf' ? 2 : 1));
    }
    // `?remaster=showk`: the sun's share alone, for checking it.
    if (remasterDebug.has('showk')) display = k;
    context.outgoingLight.rgb.assign(sRGBTransferEOTF(display).mul(viewGain));
  }
}

/**
 * A world surface drawn with the engine's combine. `bfKind` picks the
 * combine and is part of three's program key (a string property), so the
 * kinds never share a compiled graph.
 */
export class EngineMaterial extends THREE.MeshLambertNodeMaterial {
  constructor(parameters) {
    super(parameters);
    this.bfKind = 'lit';
    this.bfEnv = false;
    this.bfEngineFloor = new THREE.Vector3(0.4, 0.4, 0.4);
    this.bfEngineSun = new THREE.Vector3(0.5, 0.5, 0.5);
    this.remaster = true;
  }

  setupLightingModel() {
    return new EngineLightingModel(this.bfKind, this.bfEnv === true);
  }

  setupEnvironment() {
    return null;
  }

  copy(source) {
    super.copy(source);
    // NodeMaterial.copy carries every enumerable slot (the `bf*` ones too)
    // but not the alpha test (see `cloneWithNodes`).
    if (source.alphaTest !== undefined) this.alphaTest = source.alphaTest;
    return this;
  }
}

/** An engine-combine stand-in for a retail material, of `kind`. */
function engineFrom(m, kind, extra = {}) {
  const mat = new EngineMaterial({
    map: m.map || null,
    color: m.color ? m.color.clone() : 0xffffff,
    side: m.side,
    alphaTest: m.alphaTest || 0,
    transparent: m.transparent,
    opacity: m.opacity ?? 1,
    depthWrite: m.depthWrite ?? true,
    ...extra,
  });
  mat.name = m.name;
  // The exporter's extras marks (additive, textureFade) ride in userData; a
  // rebuild that drops them un-marks the material for every later pass.
  mat.userData = m.userData;
  mat.bfKind = kind;
  // A cut-out (wire, foliage, nets): its shadow cut by the same alpha, not
  // the whole card (barbed wire cast a solid rectangle across Wake).
  if ((mat.alphaTest > 0 || mat.transparent) && mat.map) mat.maskShadowNode = shadowCut(mat);
  return cloneWithNodes(mat);
}

/**
 * The terrain: the tile art and the detail map combined the engine's way
 * (`tile + detail - 0.5` in display space, ledger TERR-15), drawn unlit as
 * the engine draws it, since the art carries the level's light. The remaster
 * adds the sun's real-time shadow: a sun-facing patch something stands over
 * keeps `shade` of its art, the level's own `lighting.shadowColor` (0.3 to
 * 0.6 across the levels).
 *
 * Until 2026-11-13 the ground was the remaster's one relit surface: the
 * painted light estimated from the slope and divided out, then the real sun
 * and the sky put back. Every slope turned from the sun came out darker and
 * browner than its art (Wake's beach hill lost its grass), which is the
 * same "overly darkened" the owner saw on the vehicles.
 */
export function terrainMaterial(source, detail, repeats, shade = 0.5) {
  const mat = engineFrom(source, 'terrain', { alphaTest: 0, transparent: false });
  mat.maskShadowNode = null;
  mat.bfEngineFloor = new THREE.Vector3(shade, shade, shade);
  if (!source.map || !detail) return mat;
  mat.bfDetail = detail;
  mat.bfDetailRepeats = repeats;
  const tile = matTexture('map').ref;
  const detailTex = matTexture('bfDetail');
  const grain = detailTex.at(uv().mul(materialReference('bfDetailRepeats', 'float'))).bias(TERRAIN_DETAIL_MIP_BIAS);
  // `keep` first: the reference must be built (and point at this
  // material's texture) before the sample that follows it.
  const display = clamp(detailTex.keep.add(sRGBTransferOETF(tile.rgb)).add(grain.rgb).sub(0.5), 0, 1);
  mat.colorNode = vec4(sRGBTransferEOTF(display), 1);
  return mat;
}

/**
 * A lightmapped static: the bake (`2 * lightmap * texture`, ledger LM-4) as
 * the retail page draws it, and the sun's real-time shadow taking a sunlit
 * texel down to where the bake's own shadows sit (`LIGHTMAP_SHADE`).
 */
const lightmapCache = new WeakMap();
export function lightmapMaterial(source, lightmap) {
  // One remaster material per source material and lightmap, not per mesh:
  // a level's few hundred glTF materials would otherwise become thousands,
  // each with its own bindings to set up and keep per draw.
  let byMap = lightmapCache.get(source);
  if (!byMap) lightmapCache.set(source, byMap = new Map());
  if (byMap.has(lightmap)) return byMap.get(lightmap);
  const mat = engineFrom(source, 'lightmap');
  byMap.set(lightmap, mat);
  mat.bfLightmap = lightmap;
  return mat;
}

/**
 * A vehicle, a soldier, a tree's trunk or a bare static: the engine's lit
 * combine. `light` is the level's `{ floor, sun }` (the clamp's constant
 * part and the sun's diffuse, each `[r, g, b]`); `materialDiffuse` (ledger
 * DL-9) scales the sun's term; `cube` is the level's reflection cube for an
 * `envmap true` material, or null.
 */
const dynamicCache = new WeakMap();
export function dynamicMaterial(source, { light, materialDiffuse = null, cube = null } = {}) {
  const floor = light?.floor ?? [0.4, 0.4, 0.4];
  const sun = (light?.sun ?? [0.5, 0.5, 0.5]).map((c, i) => c * (materialDiffuse ? materialDiffuse[i] : 1));
  const key = `${floor.join(',')}|${sun.join(',')}|${!!cube}`;
  if (cube) levelCube(cube);
  let byKey = dynamicCache.get(source);
  if (!byKey) dynamicCache.set(source, byKey = new Map());
  if (byKey.has(key)) return byKey.get(key);
  const mat = engineFrom(source, 'lit');
  byKey.set(key, mat);
  // Relief from the generated map (`?remaster=maps`), which turns the
  // normal the sun's term reads; a leaf card takes none (its normal is the
  // canopy's, remaster-foliage.js).
  if (!/^sprite_\d+$/.test(source.name || '')) applyPackedMap(mat, source.map);
  mat.bfEngineFloor = new THREE.Vector3(...floor);
  mat.bfEngineSun = new THREE.Vector3(...sun);
  mat.bfEnv = !!cube;
  return mat;
}

/**
 * The first-person rig: the arms and the weapon in hand.
 *
 * These are NOT lit by the remaster's sun and sky. They draw with the
 * engine's own combine for a lit mesh, the one the retail page draws them
 * with (level-shading.js `bindDynamicShading`, ledger DL-5):
 *
 *     2 * tex * clamp(ambient + globalAmbient + diffuse * materialDiffuse * N.L)
 *
 * in display space, then `envmap true`'s stage over it where the level has a
 * cube (envmap.js: `lit * A + cube * (1 - A)`, the cube indexed by the
 * view-space reflection vector), with the level's light direction as the
 * retail page aims it.
 *
 * The first cut lit the rig as a physically based surface under the world's
 * sun and sky, like a vehicle. Facing the sun, every face the player looks
 * at was in shade and drew by the sky's blue light alone: the hands grey,
 * the steel flat and dark. With the sun behind, the same faces took the
 * whole sun and washed out. The owner (2026-11-13): "it makes everything
 * look rubbery and low detail. In the retail the gun still renders
 * beautifully even when in our sun... technically cool but provides
 * nothing." The weapon's art is painted to be seen under the engine's
 * combine, so it gets that combine. Nothing in the world reads the rig's
 * light: it is an overlay pass, with no shadow to cast or take.
 *
 * `viewGain` undoes the renderer's exposure, as the painted sky's does
 * (`skyGain`), so the rig's colours reach the screen as the combine left
 * them; remaster-renderer.js sets it.
 */
const viewFloor = uniform(new THREE.Vector3(0.4, 0.4, 0.4));
const viewSun = uniform(new THREE.Vector3(0.5, 0.5, 0.5));
const viewDir = uniform(new THREE.Vector3(0, 1, 0));

/**
 * `light` is the level's: `{ floor, sun, toward }`, the clamp's constant
 * part, the sun's diffuse and the direction to the light, each `[x, y, z]`.
 * `cube` is the level's reflection cube, or null when it shipped none (the
 * engine's own gate, 0x005bfa8b).
 */
const viewCache = new WeakMap();
export function viewMaterial(source, { light, materialDiffuse = null, cube = null } = {}) {
  viewFloor.value.fromArray(light.floor);
  viewSun.value.fromArray(light.sun);
  viewDir.value.fromArray(light.toward).normalize();
  if (cube) levelCube(cube);
  const key = `${materialDiffuse ? materialDiffuse.join(',') : ''}|${!!cube}`;
  let byKey = viewCache.get(source);
  if (!byKey) viewCache.set(source, byKey = new Map());
  if (byKey.has(key)) return byKey.get(key);
  const mat = new THREE.MeshBasicNodeMaterial({
    map: source.map || null,
    color: source.color ? source.color.clone() : 0xffffff,
    side: source.side,
    alphaTest: source.alphaTest || 0,
    transparent: source.transparent,
    opacity: source.opacity ?? 1,
    depthWrite: source.depthWrite ?? true,
  });
  mat.name = source.name;
  mat.userData = source.userData;
  mat.remaster = true;
  mat.remasterView = true;
  byKey.set(key, mat);
  mat.bfViewDiffuse = new THREE.Vector3(...(materialDiffuse ?? [1, 1, 1]));
  const ndl = max(dot(normalWorld, viewDir), 0);
  // D3D clamps the vertex diffuse to [0, 1] before the stage's modulate-2x,
  // and saturates again after the multiply.
  const lit = min(vec3(1), viewFloor.add(viewSun.mul(materialReference('bfViewDiffuse', 'vec3')).mul(ndl))).mul(2);
  let display = min(vec3(1), sRGBTransferOETF(materialColor.rgb).mul(lit));
  if (cube) display = envStage(display, materialColor.a);
  mat.colorNode = vec4(sRGBTransferEOTF(display).mul(viewGain), materialColor.a);
  mat.bfEnv = !!cube;
  // What this material is once its mesh leaves the hand for the world (a
  // thrown grenade is a clone of the rig's own projectile node): the world's
  // combine, which takes the sun's shadow. See `worldMaterials`.
  mat.remasterWorld = () => dynamicMaterial(source, {
    light: { floor: light.floor, sun: light.sun }, materialDiffuse, cube,
  });
  return cloneWithNodes(mat);
}

/**
 * Every first-person material under `root`, swapped for its world one.
 *
 * round-launch.js clones a thrown round out of the hand rig, first-person
 * materials and all. In the world such a material is wrong twice: it reads
 * no shadow, and the sun's shadow pass, which draws every caster with its
 * own depth material, could not resolve the rig material's per-material
 * light and threw on every frame from the moment a grenade left the hand
 * ("the game hangs, I can still hear it", the owner, 2026-11-13).
 */
export function worldMaterials(root) {
  root?.traverse?.(obj => {
    if (!obj.isMesh || !obj.material) return;
    const swap = m => (m?.remasterView && m.remasterWorld ? m.remasterWorld() : m);
    obj.material = Array.isArray(obj.material) ? obj.material.map(swap) : swap(obj.material);
  });
  return root;
}

export const remasterMaterials = {
  terrainMaterial, lightmapMaterial, dynamicMaterial, viewMaterial, worldMaterials, EngineMaterial, vec3,
};

/**
 * The proving ground's floor (proving-ground.js `floorMaterial`) as a node
 * material: a world-space grid, finer lines every 10 m, heavier every 50 m,
 * range lines every 50 m down range of the firing line, the firing line and
 * the lane's centre, each about a pixel wide at any distance.
 */
export function provingFloor(c, PG) {
  const v = a => vec3(a[0], a[1], a[2]);
  const p = positionWorld.xz;
  const grid = (period, width) => {
    const q = p.div(period);
    const d = abs(fract(q.sub(0.5)).sub(0.5)).div(fwidth(q));
    return float(1).sub(clamp(min(d.x, d.y).sub(width), 0, 1));
  };
  let col = mix(v(c.floor), v(c.minor), grid(10, 0).mul(0.6));
  col = mix(col, v(c.major), grid(50, 0.5).mul(0.7));
  const down = float(PG.LINE_Z).sub(p.y);
  const q = down.div(50);
  const dr = abs(fract(q.sub(0.5)).sub(0.5)).div(fwidth(q));
  col = mix(col, v(c.range), float(1).sub(clamp(dr.sub(1), 0, 1)).mul(0.85).mul(step(1, down)));
  const line = float(1).sub(clamp(abs(p.y.sub(PG.LINE_Z)).div(max(fwidth(p.y), 1e-4)).sub(2), 0, 1));
  col = mix(col, v(c.range), line);
  const lane = float(1).sub(clamp(abs(p.x.sub(PG.LINE_X)).div(max(fwidth(p.x), 1e-4)).sub(0.5), 0, 1));
  col = mix(col, v(c.major), lane.mul(step(0, down)).mul(0.8));
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = 'provingGroundFloor';
  mat.colorNode = vec4(col, 1);
  mat.remaster = true;
  return mat;
}
