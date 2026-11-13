// Remaster mode's trees (features/remaster-browser): the retail tree
// renderer's two vertex tricks (tree-foliage.js), as node graphs the WebGPU
// renderer runs, plus wind.
//
// - Leaf sprites: each card is rebuilt around its centre facing the camera
//   (TreeRenderer's Sprite.vso). Retail does it in view space; here it is
//   done in the mesh's own space from the drawing camera's axes, because a
//   shadow pass reads `positionNode` and not `vertexNode`. The sun's shadow
//   camera is then the camera, so a leaf faces the sun in its own shadow
//   pass and casts its full shape.
// - The far billboard: the card turned about Y toward the camera, showing
//   the two strip frames nearest the camera's azimuth, blended.
// - Wind: the whole tree leans with a slow, gusting sway that grows with
//   height, and each leaf card flutters on its own phase. Trunks, branch
//   cards and leaves share one sway, so nothing tears apart.
// - Light: a leaf is drawn as retail draws it, unlit at twice its texture,
//   then shaded by the sun's shadow and by a rounded canopy normal (out
//   from the trunk, tipped up) instead of the card's flat one, which would
//   shade a card by which way it happened to face.

import {
  attribute, atan, cameraPosition, cameraWorldMatrix, cos, float, floor, materialReference, mix, mod, modelScale,
  modelWorldMatrix, modelWorldMatrixInverse, normalize, positionLocal, pow, sin, time,
  transformNormalToView, uv, vec2, vec3, vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { copyRemasterProps, EngineMaterial, matTexture, shadowCut } from './remaster-materials.js';

// One wind for the level: a direction and a gust, slowly varying.
const WIND = vec3(0.86, 0, 0.5);

/** The sway of a point `h` metres up a tree whose root is `root` (world). */
function sway(root, h) {
  const phase = root.x.mul(0.071).add(root.z.mul(0.053));
  const t = time;
  const gust = sin(t.mul(0.31).add(phase.mul(0.2))).mul(0.5).add(0.5);
  const lean = sin(t.mul(1.15).add(phase)).mul(0.65).add(sin(t.mul(2.37).add(phase.mul(1.9))).mul(0.25)).add(0.35);
  const amp = h.mul(h).div(h.mul(h).add(30)).mul(0.22).mul(float(0.45).add(gust.mul(0.55)));
  const cross = cos(t.mul(0.93).add(phase.mul(1.3))).mul(0.3);
  return WIND.mul(lean.mul(amp)).add(vec3(WIND.z.negate(), 0, WIND.x).mul(cross.mul(amp)));
}

const treeRoot = () => modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;

/** Wind on a trunk or a branch card: the vertex leans with its height. */
export function windNodes(material) {
  if (material.remasterWind) return;
  material.remasterWind = true;
  // A branch card: cut, not blended (see spriteNodes), its shadow cut too.
  if (material.alphaTest > 0) {
    material.transparent = false;
    material.depthWrite = true;
    material.alphaTest = 0.4;
    if (material.map) material.maskShadowNode = shadowCut(material, 0.42);
    // A frond passes light: the engine's lit combine, the sun's share taken
    // from either side of the card (`EngineMaterial`'s `frond`).
    material.bfKind = 'frond';
  }
  const h = positionLocal.y.max(0);
  const worldSway = sway(treeRoot(), h);
  const localSway = modelWorldMatrixInverse.mul(vec4(worldSway, 0)).xyz;
  material.positionNode = positionLocal.add(localSway);
  material.needsUpdate = true;
}

/** A leaf sprite: camera-facing about its centre, swaying, lit with a canopy normal. */
export function spriteNodes(material) {
  if (material.remasterSprite) return;
  material.remasterSprite = true;
  material.remasterWind = true;
  // Cut, not blended: a blended leaf writes no depth (the occlusion pass
  // then sees through the canopy), sorts badly, and takes the renderer's
  // coloured-shadow path, which cost ~30 ms a frame on Wake's palms.
  material.transparent = false;
  material.depthWrite = true;
  material.alphaTest = 0.4;
  const center = attribute('treeCenter', 'vec3');
  const offset = attribute('treeOffset', 'vec2');
  const right = cameraWorldMatrix.element(0).xyz;
  const up = cameraWorldMatrix.element(1).xyz;
  const s = modelScale;
  const worldCenter = modelWorldMatrix.mul(vec4(center, 1)).xyz;
  const flutterPhase = center.x.mul(1.7).add(center.z.mul(2.3)).add(center.y);
  const flutter = vec3(sin(time.mul(3.1).add(flutterPhase)), sin(time.mul(2.3).add(flutterPhase.mul(1.3))), 0).mul(0.035);
  const world = worldCenter
    .add(sway(treeRoot(), center.y.max(0)))
    .add(right.mul(offset.x.mul(s.x).add(flutter.x)))
    .add(up.mul(offset.y.mul(s.y).add(flutter.y)));
  material.positionNode = modelWorldMatrixInverse.mul(vec4(world, 1)).xyz;
  material.normalNode = transformNormalToView(normalize(vec3(center.x, center.y.mul(0.35).add(1.5), center.z)));
  // The shadow: a firm cut of the leaf texture's alpha, not the soft
  // blend's 0.004, or every card shadows as a square.
  // Through the material being drawn, not baked into the shared graph
  // (remaster-materials.js has the story).
  if (material.map) material.maskShadowNode = shadowCut(material, 0.42);
  // Retail draws a leaf unlit, `2 * texture` (tree-foliage.js
  // `patchSpriteMaterial`); the remaster keeps that and shades it by the
  // sun's shadow and the canopy's turn from the sun (`EngineMaterial`).
  material.bfKind = 'leaf';
  material.needsUpdate = true;
}

const IMPOSTOR_ALBEDO = 1;

/**
 * The far card: about Y toward the camera, two frames of the strip blended
 * by azimuth (Billboard.pso). `frames` is the strip's count; `eighth` the
 * angle between frames.
 */
export function impostorNodes(material, frames, eighth) {
  const cam = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
  const dir = normalize(cam.xz.add(vec2(1e-6, 0)));
  const right = vec3(dir.y, 0, dir.x.negate());
  material.positionNode = right.mul(positionLocal.x).add(vec3(0, positionLocal.y, 0));
  const az = atan(dir.x, dir.y.negate());
  const f = mod(az.div(eighth), frames);
  const f0 = floor(f);
  const w = f.sub(f0);
  const u0 = uv();
  const strip = matTexture('map');
  const a = strip.at(vec2(u0.x.add(f0).div(frames), u0.y));
  const b = strip.at(vec2(u0.x.add(mod(f0.add(1), frames)).div(frames), u0.y));
  // `keep` first keeps the reference, and its per-material update, in the
  // graph ahead of the samples (remaster-materials.js `matTexture`).
  const col = vec4(strip.keep).add(mix(a, b, w));
  // The strip is the tree as the art drew it, light and all, and retail
  // draws it unlit; so does the remaster (`EngineMaterial`'s `card`), with
  // the sun's shadow over it where the cascades reach.
  //
  // The alpha is firmed for this frame's blend. Retail blended the card over
  // the sky in display space, where a half-covered texel of a dark frond is
  // a mid tone; this frame blends in linear light, where the same half is
  // mostly sky, and every far palm drew as a pale grey wisp ("the grey blob",
  // and the remaster's far trees since its first cut). `1 - (1 - a)^2.2` is
  // the linear coverage that lands a dark texel over a bright sky where the
  // display-space blend put it.
  const cover = float(1).sub(pow(float(1).sub(col.a.clamp(0, 1)), 2.2));
  material.colorNode = vec4(col.rgb.mul(IMPOSTOR_ALBEDO), cover);
  material.normalNode = transformNormalToView(vec3(0, 1, 0));
  material.needsUpdate = true;
}

/** The far card's material: the strip `tex` of `frames` frames, `eighth` apart. */
export function impostorMaterial(tex, frames, eighth, alphaTest) {
  const material = new EngineMaterial({
    map: tex, alphaTest, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  material.name = 'tree impostor';
  material.bfKind = 'card';
  impostorNodes(material, frames, eighth);
  return material;
}

const NODE_KEYS = ['positionNode', 'colorNode', 'normalNode', 'maskShadowNode', 'castShadowPositionNode',
  'opacityNode', 'emissiveNode', 'aoNode', 'remasterSprite', 'remasterWind', 'remaster', 'bfKind'];

/** `Material.clone` drops the node slots of a plain material; carry them across. */
export function carryNodes(from, to) {
  for (const k of NODE_KEYS) if (from[k] !== undefined) to[k] = from[k];
  return copyRemasterProps(from, to);
}

export const remasterFoliage = { windNodes, spriteNodes, impostorNodes, impostorMaterial, carryNodes };
