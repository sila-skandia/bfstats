// Remaster mode's sky, sun and fog (features/remaster-browser).
//
// - The sky is the level's own: its painted SkyBox mesh, or its cube of six
//   faces, drawn at its painted brightness in the HDR frame and rendered
//   once into the image-based light the water reflects.
// - The sun stands where scene.json's `sunDirection` puts it, the side the
//   terrain art and the lightmaps are lit from, and casts three cascades of
//   shadow out to the level's `fogEnd`. The surfaces' combines read only
//   its shadow and its angle (remaster-materials.js `EngineMaterial`); its
//   colour and strength reach the water's glint and the flash lights.
// - The fog is the level's own, as the retail page draws it.

import * as THREE from 'three/webgpu';
import {
  float, materialColor, min, mix, output, positionView, positionWorld, sRGBTransferEOTF, sRGBTransferOETF,
  smoothstep, texture, uniform, vec3, vec4,
} from 'three/tsl';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { bindEngineSun } from './remaster-materials.js';
import { SHADOW_LAYER } from './remaster-shadow-proxies.js';

const SHADOW_MAP = 2048;
const CASCADES = 3;
/** The cascades' refresh: the near one every frame, the middle one every
 *  second frame, the far one every fourth, staggered. */
const CASCADE_PERIODS = [1, 2, 4];

/**
 * The direction toward the sun from scene.json's `sunDirection`, which in
 * the viewer's coordinates already points at the sun. Checked against the
 * terrain art's baked light on Wake: from (1000, 108, -1080) looking along
 * (0.67, -0.12, -0.73) the slopes facing the eye are the art's brightest,
 * so the sun is behind the eye, along +sunDirection. (level-load.js aims the
 * retail DirectionalLight at (-x, y, -z), the opposite side in plan.)
 */
export function sunToward(sd = [-0.35, 0.8, 0.45]) {
  const v = new THREE.Vector3(sd[0], sd[1], sd[2]);
  if (v.lengthSq() < 1e-6) v.set(0.3, 0.8, 0.4);
  return v.normalize();
}

/**
 * The level's numbers the remaster reads, pure: the sun's tint and strength
 * (the level's diffuse over its ambient floor, the contrast its bake was
 * made with: Wake 0.4 over 0.24) and its fog.
 */
export function atmosphereFor(extras = {}) {
  const lit = extras.lighting || {};
  const diffuse = lit.diffuse || [0.5, 0.5, 0.5];
  const amb = (lit.ambient || [0.2, 0.2, 0.2]).map((a, i) => a + ((lit.globalAmbient || [0, 0, 0])[i] || 0));
  const fogEnd = Math.max(80, extras.fogEnd ?? 450);
  const peak = Math.max(...diffuse, 0.05);
  const ambLum = 0.2126 * amb[0] + 0.7152 * amb[1] + 0.0722 * amb[2];
  const contrast = Math.min(4, Math.max(0.6, peak / Math.max(0.05, ambLum)));
  return {
    sunTint: diffuse.map(c => c / peak),
    sunIntensity: 4 + 2 * contrast,
    // The water's share of the sky's image-based light.
    skyIntensity: 0.72,
    fogColor: extras.fogColor || [0.75, 0.75, 0.75],
    fogStart: Math.min(fogEnd * 0.9, Math.max(0, extras.fogStart ?? fogEnd * 0.3)),
    fogEnd,
  };
}

/**
 * The sky, sun and fog for one page: `apply(extras)` on each level,
 * `update()` each frame.
 */
export function createRemasterSky({ renderer, scene, camera, sun, hemi }) {
  const u = {
    start: uniform(150),
    end: uniform(450),
    /** The fog's colour, linear, lifted as the sky's paint is. */
    fog: uniform(new THREE.Color(0.6, 0.65, 0.7)),
  };
  /** Toward the sun, for the shafts and the shadow proxies. */
  const sunDir = new THREE.Vector3(0, 1, 0);
  // Display-referred colours (the sky's paint, the fog's) are lifted by this
  // into the HDR frame, so they show as painted through the exposure.
  const gain = uniform(1);

  sun.castShadow = true;
  // The engine combine's sun term is measured against this light.
  bindEngineSun(sun);
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 2000;
  // The shadow cameras see only the shadow layer: the static casters' merged
  // proxies and whatever moving caster enabled it. Set before the cascades
  // clone this shadow.
  sun.shadow.camera.layers.set(SHADOW_LAYER);
  const csm = new CSMShadowNode(sun, { cascades: CASCADES, maxFar: 350, mode: 'practical', lightMargin: 300 });
  csm.fade = true;
  sun.shadow.shadowNode = csm;
  if (!sun.target.parent) scene.add(sun.target);

  /**
   * The level's own fog, exactly as the retail page draws it: three's Fog
   * between fogStart and fogEnd (a smoothstep of the view depth) in the
   * level's fog colour, mixed in display space, as the retail page's is
   * (three's WebGL fog runs after the colour-space conversion) and as the
   * engine's fixed-function fog was. Mixed in linear light, half fog over a
   * dark palm is mostly fog, and the same ramp reads twice as thick on
   * everything dark. What is brighter than white (a flame's glow) is
   * carried past the mix and thinned by the fog's share.
   */
  function fogNode() {
    // `?pipelineSalt=<n>` (tests/perf/remaster_explosions.mjs): a number
    // folded into every fogged shader, so the OS's shader cache has seen
    // none of them and a run pays for its pipelines as a first visit does.
    const salt = Number(new URLSearchParams(location.search).get('pipelineSalt')) || 0;
    let ramp = smoothstep(u.start, u.end, positionView.z.negate());
    if (salt) ramp = ramp.add(float(salt * 1e-9)).clamp(0, 1);
    const shown = output.rgb.div(gain);
    const low = min(shown, vec3(1));
    const fogged = mix(sRGBTransferOETF(low), sRGBTransferOETF(min(u.fog.div(gain), vec3(1))), ramp);
    return vec4(sRGBTransferEOTF(fogged).add(shown.sub(low).mul(float(1).sub(ramp))).mul(gain), output.a);
  }
  scene.fogNode = fogNode();

  // The level's painted SkyBox root (level-sky.js `setupSky`), when it has one.
  let painted = null;
  function paintedSky(root) {
    painted = root;
    if (!root) return;
    root.visible = true;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      for (const m of [obj.material].flat()) {
        if (!m || m.remasterSky) continue;
        m.remasterSky = true;
        // The paint at its painted brightness, down to its own horizon,
        // which is what the level's fog colour was chosen to meet.
        m.colorNode = vec4(materialColor.rgb.mul(gain), 1);
        m.fog = false;
        m.needsUpdate = true;
      }
    });
  }

  /**
   * The retail cloud layer (`Sky.addCloud`, level-sky.js `setupClouds`) as a
   * node material. `U` is level-sky.js's uniform table: its entries are
   * swapped for uniform nodes, which carry the same `.value` the module
   * keeps writing each frame.
   */
  function cloudMaterial(tex, U) {
    for (const k of ['uOffset', 'uSpan', 'uCam', 'uFadeStart', 'uFadeEnd']) U[k] = uniform(U[k].value);
    const m = new THREE.MeshBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    m.side = THREE.DoubleSide;
    m.fog = false;
    const c = texture(tex, positionWorld.xz.div(U.uSpan).add(U.uOffset));
    const fade = float(1).sub(smoothstep(U.uFadeStart, U.uFadeEnd, positionWorld.xz.distance(U.uCam)));
    m.colorNode = vec4(c.rgb.mul(gain), c.a.mul(fade));
    m.remasterSky = true;
    return m;
  }

  // The image-based light the water reflects: the level's sky, rendered once
  // a level from a scene that holds nothing else.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  let envSky = null;
  let envTarget = null;
  function rebuildEnv(fogLinear) {
    envTarget?.dispose();
    if (envSky) { envScene.remove(envSky); envSky = null; }
    if (painted) {
      envSky = painted.clone();
      envSky.position.set(0, 0, 0);
      envSky.scale.setScalar(3000 / ((painted.userData.halfExtent || 2000) * 1.7320508));
      envSky.visible = true;
      envScene.add(envSky);
      envScene.background = null;
      envTarget = pmrem.fromScene(envScene, 0, 0.5, 8000);
    } else if (scene.background?.isCubeTexture) {
      envTarget = pmrem.fromCubemap(scene.background);
    } else {
      // A level with no sky of its own draws its fog colour, as retail does.
      envScene.background = fogLinear.clone().multiplyScalar(gain.value);
      envTarget = pmrem.fromScene(envScene, 0, 0.5, 8000);
    }
    scene.environment = envTarget.texture;
  }

  function apply(extras = {}) {
    const a = atmosphereFor(extras);
    sunDir.copy(sunToward(extras.sunDirection));
    sun.color.setRGB(a.sunTint[0], a.sunTint[1], a.sunTint[2], THREE.SRGBColorSpace);
    sun.intensity = a.sunIntensity;
    sun.position.copy(sunDir).multiplyScalar(400);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    // No surface reads the hemisphere; the water takes the sky's light.
    hemi.intensity = 0;
    scene.environmentIntensity = a.skyIntensity;
    gain.value = 1 / Math.max(0.1, renderer.toneMappingExposure);
    // A cube sky or a plain background colour is drawn by the renderer
    // itself, and is lifted the same way.
    scene.backgroundIntensity = gain.value;
    u.start.value = a.fogStart;
    u.end.value = a.fogEnd;
    const fogLinear = new THREE.Color().setRGB(a.fogColor[0], a.fogColor[1], a.fogColor[2], THREE.SRGBColorSpace);
    u.fog.value.copy(fogLinear).multiplyScalar(gain.value);
    // The cascades reach the fog's end: past it nothing is drawn.
    csm.maxFar = Math.min(800, a.fogEnd);
    projectionKey = '';
    rebuildEnv(fogLinear);
    return a;
  }

  // Each cascade is a walk of the whole scene on the CPU (~2.5 ms each on
  // Wake, plus its casters), and a far cascade's picture barely moves between
  // frames. A skipped map keeps the matrix it was drawn with, so its shadows
  // stay put.
  let frameNo = 0;
  function staggerCascades() {
    frameNo++;
    csm.lights?.forEach((l, i) => {
      const period = CASCADE_PERIODS[Math.min(i, CASCADE_PERIODS.length - 1)];
      l.shadow.autoUpdate = period === 1;
      if (period > 1 && (frameNo + i) % period === 0) l.shadow.needsUpdate = true;
    });
  }

  // CSM fits its splits to the camera's projection once, at init; a resize,
  // a zoom or a level's draw distance changes it afterwards, and the stale
  // fit left the near ground outside the near cascade, drawn as one hard
  // shadow. Refit whenever the projection moves.
  let projectionKey = '';
  function refitCascades() {
    if (!csm.camera) return;
    const key = `${camera.fov.toFixed(3)}|${camera.aspect.toFixed(4)}|${camera.near}|${camera.far.toFixed(1)}|${camera.zoom}`;
    if (key === projectionKey) return;
    projectionKey = key;
    csm.updateFrustums();
  }

  function update() {
    refitCascades();
    staggerCascades();
  }

  return { apply, update, paintedSky, cloudMaterial, sunDir };
}
