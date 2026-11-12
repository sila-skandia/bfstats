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
  clamp, float, materialReference, max, mix, normalView, reference, normalize, sRGBTransferEOTF, sRGBTransferOETF, smoothstep,
  transformNormalToView, uv, vec3, vec4,
} from 'three/tsl';

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
const remasterDebug = new Set((new URLSearchParams(location.search).get('remaster') || '').split(','));

/**
 * A lit stand-in for a retail material, keeping the slots and marks the page
 * reads. Physical, for `specularIntensity`: the art's albedo carries baked
 * light and is dark, so a full 4 % white specular is a large share of what
 * a matte wall reflects and greys it; the remaster keeps a third of it.
 */
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
  return mat;
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
    flat.colorNode = vec4(albedo, 1);
    flat.remaster = true;
    return flat;
  }
  mat.colorNode = remasterDebug.has('greyterrain') ? vec4(0.15, 0.10, 0.037, 1)
    : remasterDebug.has('tileonly') ? vec4(tile.rgb, 1) : vec4(albedo, 1);
  terrainLight(mat, albedo);
  if (remasterDebug.has('greyterrain')) mat.emissiveNode = vec3(0);
  if (remasterDebug.has('nomapslot')) mat.map = null;
  if (remasterDebug.has('nonormal')) mat.normalNode = null;
  return mat;
}

/**
 * The terrain art already carries its slopes' light and the statics' baked
 * shadows, so lighting it again at full strength darkens every slope that
 * faces away from the sun twice. The remaster lights it with a normal 60 %
 * of the way to straight up (the real sun still models the ground, at 40 % of the
 * contrast) and a fill of the art itself, so a shaded slope keeps the
 * colour the artist painted into it; what the real-time light adds is the
 * moving shadows and the sky's colour.
 */
function terrainLight(mat, albedo) {
  // Fill: 42 % of the art itself, so a slope away from the sun (or in a
  // shadow) keeps the brown it was painted, not the sky's blue alone.
  mat.normalNode = normalize(mix(normalView, transformNormalToView(vec3(0, 1, 0)), 0.6));
  mat.emissiveNode = albedo.mul(0.42);
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
