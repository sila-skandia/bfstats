// Remaster mode's surfaces (features/remaster-browser). The retail page draws
// every static, vehicle and soldier as an unlit MeshBasicMaterial with the
// engine's fixed-function combine injected through `onBeforeCompile`
// (level-shading.js). The WebGPU renderer runs no GLSL patches, and the
// remaster wants real lights anyway: these builders give the same meshes
// physically based materials lit by the sun (with its cascaded shadows), the
// sky's image-based light, and the post chain's ambient occlusion.
//
// level-shading.js calls in here through `remasterHooks.materials`, at the
// same three points it builds the retail materials: the terrain's detail
// combine, the lightmapped statics and the dynamically lit meshes.

import * as THREE from 'three/webgpu';
import {
  abs, clamp, dot, float, fract, fwidth, materialReference, max, min, mix, positionWorld, step, normalView, normalWorldGeometry, reference, uniform, normalize, sRGBTransferEOTF, sRGBTransferOETF, smoothstep,
  transformNormalToView, uv, vec2, vec3, vec4, normalMap,
} from 'three/tsl';
import { REMASTER_OFF } from './remaster-mode.js';

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

/**
 * A lit stand-in for a retail material, keeping the slots and marks the page
 * reads. Physical, for `specularIntensity`: the art's albedo carries baked
 * light and is dark, so a full 4 % white specular is a large share of what
 * a matte wall reflects and greys it; the remaster keeps a third of it.
 */
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
    copyRemasterProps(this, c);
    c.clone = this.clone;
    return c;
  };
  return mat;
}

function litFrom(m, extra = {}, Kind = THREE.MeshPhysicalMaterial) {
  const mat = new Kind({
    map: m.map || null,
    color: m.color ? m.color.clone() : 0xffffff,
    side: m.side,
    alphaTest: m.alphaTest || 0,
    transparent: m.transparent,
    opacity: m.opacity ?? 1,
    depthWrite: m.depthWrite ?? true,
    ...(Kind === THREE.MeshLambertMaterial ? {} : { roughness: 0.82, metalness: 0, specularIntensity: 0.35 }),
    ...extra,
  });
  mat.name = m.name;
  // The exporter's extras marks (additive, textureFade) ride in userData; a
  // rebuild that drops them un-marks the material for every later pass.
  mat.userData = m.userData;
  mat.remaster = true;
  return cloneWithNodes(mat);
}

/**
 * The terrain: the tile art and the detail map combined the engine's way
 * (`tile + detail - 0.5` in display space, ledger TERR-15) as the albedo,
 * then lit. The tile art carries the level's baked light, so the albedo is
 * that bake: the real-time sun adds the shadows of everything that moves
 * and the slope's own shading, and the lights are balanced (remaster-sky.js)
 * so a flat, sunlit patch draws at about its retail brightness.
 */
export function terrainMaterial(source, detail, repeats) {
  // Lambert: ground is matte, and its specular greyed the ochre art.
  const mat = litFrom(source, { alphaTest: 0, transparent: false }, THREE.MeshLambertMaterial);
  if (source.map && !detail) terrainLight(mat, matTexture('map').ref.rgb);
  if (!source.map || !detail) return mat;
  mat.bfDetail = detail;
  mat.bfDetailRepeats = repeats;
  const tile = matTexture('map').ref;
  const detailTex = matTexture('bfDetail');
  const grain = detailTex.at(uv().mul(materialReference('bfDetailRepeats', 'float'))).bias(TERRAIN_DETAIL_MIP_BIAS);
  // `keep` first: the reference must be built (and point at this
  // material's texture) before the sample that follows it.
  const display = clamp(detailTex.keep.add(sRGBTransferOETF(tile.rgb)).add(grain.rgb).sub(0.5), 0, 1);
  const albedo = sRGBTransferEOTF(display);
  if (remasterDebug.has('unlitterrain')) {
    const flat = new THREE.MeshBasicNodeMaterial();
    flat.map = source.map;
    flat.bfDetail = detail;
    flat.bfDetailRepeats = repeats;
    flat.colorNode = vec4(albedo, 1);
    flat.remaster = true;
    return flat;
  }
  terrainLight(mat, albedo);
  if (remasterDebug.has('greyterrain')) mat.colorNode = vec4(0.15, 0.10, 0.037, 1);
  if (remasterDebug.has('tileonly')) mat.colorNode = vec4(tile.rgb, 1);
  if (remasterDebug.has('greyterrain')) mat.emissiveNode = vec3(0);
  if (remasterDebug.has('nomapslot')) mat.map = null;
  if (remasterDebug.has('nonormal')) mat.normalNode = null;
  return mat;
}

/** The direction toward the sun, set by remaster-sky.js for each level. */
export const terrainSunDir = uniform(new THREE.Vector3(0, 1, 0));

/**
 * The terrain art already carries its slopes' light and the statics' baked
 * shadows (ledger TERR-15: the engine draws it unlit), so lighting it again
 * darkens every slope away from the sun twice. The remaster un-bakes it:
 * the painted light is estimated from the ground's own normal against the
 * level's sun, `(0.45 + 0.55 N.L) / (0.45 + 0.55 L.y)`, which is 1 on flat
 * open ground, and divided out of the art. The real sun then lights the
 * result with the real normal (a fifth of the way to straight up, for the
 * heightfield's coarse facets), so a sunlit slope and a shaded one keep
 * the contrast the artist painted, the real-time shadows of everything
 * standing on the ground fall on it, and the sky colours its shade. A fill
 * of 30 % of the un-baked art keeps a shadowed slope from going to the
 * sky's blue alone.
 */
function terrainLight(mat, painted) {
  const ndl = max(dot(normalWorldGeometry, terrainSunDir), 0);
  const flat = max(terrainSunDir.y, 0.15);
  const baked = float(0.45).add(ndl.mul(0.55)).div(float(0.45).add(flat.mul(0.55)));
  const albedo = painted.div(clamp(baked, 0.55, 1.7));
  mat.colorNode = vec4(albedo, 1);
  mat.normalNode = normalize(mix(normalView, transformNormalToView(vec3(0, 1, 0)), 0.2));
  mat.emissiveNode = albedo.mul(0.3);
}

/**
 * A lightmapped static. The bake (`2 * lightmap * texture`, ledger LM-4)
 * holds the sun's term and its shadows, which the real-time sun now draws;
 * what the remaster keeps of it is the bake's darkening of corners, eaves
 * and interiors, as occlusion on the sky's light. A texel the bake left at
 * its ambient floor keeps 45 % of the sky; anything the sun reached keeps it all.
 */
const lightmapCache = new WeakMap();
export function lightmapMaterial(source, lightmap) {
  // One remaster material per source material and lightmap, not per mesh:
  // a level's few hundred glTF materials would otherwise become thousands,
  // each with its own bindings to set up and keep per draw.
  let byMap = lightmapCache.get(source);
  if (!byMap) lightmapCache.set(source, byMap = new Map());
  if (byMap.has(lightmap)) return byMap.get(lightmap);
  const mat = litFrom(source);
  byMap.set(lightmap, mat);
  applyPackedMap(mat, source.map);
  mat.bfLightmap = lightmap;
  const lmTex = matTexture('bfLightmap');
  const lm = vec4(lmTex.keep).add(lmTex.at(uv(1)));
  const bake = max(lm.r, max(lm.g, lm.b));
  mat.aoNode = mix(float(0.45), float(1), smoothstep(0.04, 0.32, bake));
  return mat;
}

/**
 * A vehicle, a soldier or a bare static. `materialDiffuse` (ledger DL-9)
 * scales the sun's term in the engine; a lit PBR surface folds it into the
 * albedo. `envmap true` materials (the shiny ones: vehicles' paint and
 * glass) get a smoother surface that reflects the sky.
 */
const dynamicCache = new WeakMap();
export function dynamicMaterial(source, { materialDiffuse = null, env = false } = {}) {
  const key = `${materialDiffuse ? materialDiffuse.join(',') : ''}|${env}`;
  let byKey = dynamicCache.get(source);
  if (!byKey) dynamicCache.set(source, byKey = new Map());
  if (byKey.has(key)) return byKey.get(key);
  const mat = litFrom(source, env ? { roughness: 0.5, metalness: 0.15, specularIntensity: 1 } : {});
  byKey.set(key, mat);
  // Relief and roughness from the generated map; a leaf card takes none
  // (its normal is the canopy's, remaster-foliage.js).
  if (!/^sprite_\d+$/.test(source.name || '')) applyPackedMap(mat, source.map);
  // A cut-out (wire, foliage, nets): its shadow cut by the same alpha, not
  // the whole card (barbed wire cast a solid rectangle across Wake).
  if ((mat.alphaTest > 0 || mat.transparent) && mat.map) {
    mat.maskShadowNode = shadowCut(mat);
  }
  if (materialDiffuse) {
    mat.color.multiply(new THREE.Color(materialDiffuse[0], materialDiffuse[1], materialDiffuse[2]));
  }
  mat.bfEnv = env;
  return mat;
}

export const remasterMaterials = { terrainMaterial, lightmapMaterial, dynamicMaterial, vec3 };

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
