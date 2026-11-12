// Remaster mode's water (features/remaster-browser). The retail water is a
// GLSL ShaderMaterial (level-sky.js `setupWater`), which the WebGPU
// renderer cannot run; this is its node-material successor, built from the
// same level data (`scene.json` `water`: the two colour layers, the normal
// map and its scroll, the shallow and deep colours, the baked depth map,
// features/level-reflection-cube-and-water-depth) and lit like everything
// else in the remaster:
// - the level's normal map scrolled as retail scrolls it, with a finer
//   procedural ripple over it, as the surface normal;
// - the sky's image-based light and the sun as the reflection, through the
//   PBR fresnel, so the sea mirrors the sky at grazing angles and looks into
//   itself from above;
// - the bed seen through the water, absorbed by the depth in front of it
//   (red first, then green): the blend's alpha comes from the baked depth
//   and the slant of the view, so a beach shows sand under a hand of water
//   and the lagoon deepens to the level's deep colour;
// - foam where the water is thin against the shore.

import * as THREE from 'three/webgpu';
import {
  clamp, exp, float, max, mix, mx_noise_vec3, normalize, positionWorld, pow, smoothstep, texture, time,
  transformNormalToView, vec2, vec3, dot, positionViewDirection, sRGBTransferEOTF, sRGBTransferOETF,
} from 'three/tsl';

const lin = (rgb, fallback) => {
  const c = new THREE.Color().setRGB(...(rgb || fallback), THREE.SRGBColorSpace);
  return vec3(c.r, c.g, c.b);
};

/**
 * The water material for a level. `w` is scene.json's `water`; the
 * textures are the ones level-sky.js loaded for it (any may be null).
 */
export function remasterWaterMaterial({ w, layer1, layer2, normal, depthTex, worldSize, maxDepth }) {
  // Physical, for water's own reflectance (IOR 1.33: 2 % head-on).
  const mat = new THREE.MeshPhysicalNodeMaterial();
  mat.ior = 1.333;
  // A little over water's 2 %: retail's stand-in reflection was stronger,
  // and the sea read dark from a height against it.
  mat.specularIntensity = 1.6;
  mat.name = 'remaster-water';
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.roughness = 0.18;
  mat.metalness = 0;
  mat.remaster = true;

  const wuv = vec2(positionWorld.x, positionWorld.z.negate());
  const t = time;
  const v2 = (a, fb) => vec2(...(a || fb));

  // The colour layers, retail's MODULATE2X in display space.
  let tex = vec3(1);
  if (layer1 && layer2) {
    const l1 = texture(layer1, wuv.mul(w.tile1 || 0.5).add(v2(w.scrollDir1, [1, 0]).mul((w.scroll1 || 0)).mul(t))).rgb;
    const l2 = texture(layer2, wuv.mul(w.tile2 || 0.5).add(v2(w.scrollDir2, [0, 1]).mul((w.scroll2 || 0)).mul(t))).rgb;
    tex = sRGBTransferEOTF(clamp(sRGBTransferOETF(l1).mul(sRGBTransferOETF(l2)).mul(2), 0, 1));
  }
  // The baked depth under each point of the sea.
  const bedDepth = depthTex
    ? texture(depthTex, wuv.div(worldSize)).r.mul(maxDepth)
    : float(maxDepth || 20);
  const shallow = lin(w.shallowColor, [0.4, 0.5, 0.55]);
  const deep = lin(w.deepColor, [0.3, 0.38, 0.42]);
  const base = mix(shallow, deep, clamp(bedDepth.div(max(w.colorDepth || 10, 0.001)), 0, 1)).mul(tex);

  // The surface normal: the level's map, zero-meaned the retail way (two
  // offset samples subtracted), and a procedural ripple a few times finer.
  let dn = vec2(0, 0);
  if (normal) {
    const nuv = wuv.mul(w.tileNormal || 1).add(v2(w.scrollDirNormal, [1, 1]).mul(w.scrollNormal || 0).mul(t));
    dn = texture(normal, nuv).rg.sub(texture(normal, nuv.mul(1.31).add(0.5)).rg);
  }
  const ripple = mx_noise_vec3(vec3(wuv.mul(0.45), t.mul(0.5))).xy.mul(0.1)
    .add(mx_noise_vec3(vec3(wuv.mul(1.7), t.mul(0.9))).xy.mul(0.04));
  const slope = dn.mul(0.3).add(ripple);
  const nWorld = normalize(vec3(slope.x, 1, slope.y));
  mat.normalNode = transformNormalToView(nWorld);

  // The water between the eye and the bed: the baked depth under this
  // point, lengthened by the slant of the view through it. (Reading the
  // scene's depth buffer inside the post chain's pass came back empty on
  // this three build, so the bake, which every level ships, stands in.)
  const ndv = clamp(dot(transformNormalToView(nWorld), positionViewDirection), 0, 1);
  const path = bedDepth.div(max(ndv, 0.18));
  // Beer-Lambert: red goes within a few metres, blue lasts. What is left
  // is how much of the bed shows through, which is the blend's alpha.
  const absorb = exp(vec3(0.75, 0.28, 0.2).mul(path).negate());
  const seeThrough = absorb.x.mul(0.3).add(absorb.y.mul(0.5)).add(absorb.z.mul(0.2));
  // The fresnel: the sea mirrors the sky at a grazing look and shows its
  // depths from above. The reflection itself is the PBR specular.
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(ndv), 5)));
  // Foam on a thin edge (the shore's last third of a metre), broken up by noise.
  const foamNoise = mx_noise_vec3(vec3(wuv.mul(0.9), t.mul(0.35))).x.mul(0.5).add(0.5);
  const foam = smoothstep(0.35, 0.02, bedDepth).mul(smoothstep(0.45, 0.8, foamNoise)).mul(0.5);
  // The colour the water scatters back, the level's own shallow-to-deep
  // ramp, lit by the sky.
  const scatter = base.mul(1.5);
  mat.colorNode = mix(vec3(0), vec3(0.8), foam);
  mat.emissiveNode = scatter.mul(float(1).sub(fresnel)).mul(float(1).sub(foam));
  mat.opacityNode = clamp(float(1).sub(seeThrough).max(fresnel).max(foam), 0.35, 0.97);
  // `?waterDebug=n`: one term as the colour, unlit, for checking the graph.
  const dbg = Number(new URLSearchParams(location.search).get('waterDebug')) || 0;
  if (dbg) {
    const terms = [null, base, vec3(bedDepth.div(20)), vec3(fresnel), vec3(foam), vec3(mat.opacityNode), tex, scatter];
    mat.colorNode = vec3(0);
    mat.emissiveNode = terms[dbg] ?? vec3(1, 0, 1);
    mat.opacityNode = float(1);
    mat.roughness = 1;
    mat.specularIntensity = 0;
  }
  return mat;
}
