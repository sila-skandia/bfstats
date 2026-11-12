// Remaster mode's sky and atmosphere (features/remaster-browser): a physical
// sky lit by the level's own sun, the image-based light taken from it, the
// sun's cascaded shadows, and a height fog shaped by the level's fog words.
//
// Every number starts from the level's scene.json, so a dawn level, a
// desert and a grey Normandy morning stay themselves:
// - `sunDirection` places the sun (the same vector level-load.js aims the
//   retail DirectionalLight with), so the real-time shadows fall the way the
//   baked ones in the terrain art do;
// - `lighting.diffuse` tints the sun and sets its strength against the
//   ambient pair (`ambient` + `globalAmbient`), which sets the sky's share;
// - `fogColor` tints the haze and, with `fogStart`/`fogEnd`, sets the
//   sky's turbidity (a short fog is a hazy day) and the fog's density;
// - `fogEnd` stays the distance where the world is wholly fogged, because
//   the far plane and the statics' culling still end there (ledger FOG-4);
//   what changes is the curve up to it: clear near the eye, thicker low down
//   than on a ridge, and coloured by the sky behind it instead of one flat
//   colour (features/level-lighting-laws has the retail law it replaces).

import * as THREE from 'three/webgpu';
import {
  cameraPosition, clamp, exp, float, materialColor, max, mix, normalize, positionWorld, smoothstep,
  uniform, vec3, vec4, output, dot, pow, texture,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { REMASTER_OFF } from './remaster-mode.js';
import { terrainSunDir } from './remaster-materials.js';

/**
 * The direction toward the sun from scene.json's `sunDirection`, which in
 * the viewer's coordinates already points at the sun. Checked against the
 * terrain art's baked light on Wake: from (1000, 108, -1080) looking along
 * (0.67, -0.12, -0.73) the slopes facing the eye are the art's brightest,
 * so the sun is behind the eye, along +sunDirection. (level-load.js aims the
 * retail DirectionalLight at (-x, y, -z), the opposite side in plan; the
 * retail statics are lit by their lightmaps and that light reaches only
 * vehicles, so the difference never showed against the bake.)
 */
export function sunToward(sd = [-0.35, 0.8, 0.45]) {
  const v = new THREE.Vector3(sd[0], sd[1], sd[2]);
  if (v.lengthSq() < 1e-6) v.set(0.3, 0.8, 0.4);
  return v.normalize();
}

/**
 * The level's atmosphere numbers, pure (tests/test_remaster_sky.mjs):
 * the sky's turbidity and rayleigh, the fog's ground density and height
 * falloff, the sun's and the sky's intensity, and the colours.
 */
export function atmosphereFor(extras = {}) {
  const lit = extras.lighting || {};
  const diffuse = lit.diffuse || [0.5, 0.5, 0.5];
  const amb = (lit.ambient || [0.2, 0.2, 0.2]).map((a, i) => a + ((lit.globalAmbient || [0, 0, 0])[i] || 0));
  const fog = extras.fogColor || [0.75, 0.75, 0.75];
  const fogEnd = Math.max(80, extras.fogEnd ?? 450);
  const fogStart = Math.min(fogEnd * 0.9, Math.max(0, extras.fogStart ?? fogEnd * 0.3));
  const peak = Math.max(...diffuse, 0.05);
  const ambLum = 0.2126 * amb[0] + 0.7152 * amb[1] + 0.0722 * amb[2];
  // A short fog is a hazy, overcast day; a long one a clear sky. Wake's
  // 450 m reads as turbidity ~5, a 1000 m fog as ~2.4, Berlin's 100 m as 10.
  const turbidity = Math.min(10, Math.max(2, 2400 / fogEnd));
  // A grey fog (low saturation) scatters less blue: rayleigh down.
  const fogMax = Math.max(...fog), fogMin = Math.min(...fog);
  const saturation = fogMax > 0 ? (fogMax - fogMin) / fogMax : 0;
  const rayleigh = 0.5 + 1.5 * Math.min(1, saturation * 3);
  // Ground density: optical depth ~1.6 (80 % fogged) at fogEnd at the fog's
  // base height; the retail start, where its ramp begins, has ~10 %.
  const density = 1.2 / fogEnd;
  // Height falloff: the haze halves every ~70 m up, a bit less in a deep fog.
  const falloff = Math.LN2 / Math.max(40, Math.min(160, fogEnd / 6));
  // The sun against the sky: the level's diffuse over its ambient floor,
  // which is the contrast its bake was made with (Wake 0.4 over 0.24).
  const contrast = Math.min(4, Math.max(0.6, peak / Math.max(0.05, ambLum)));
  return {
    sunTint: diffuse.map(c => c / peak),
    sunIntensity: 4 + 2 * contrast,
    skyIntensity: 0.45,
    fogColor: fog,
    fogStart,
    fogEnd,
    turbidity,
    rayleigh,
    density,
    falloff,
    // Cloud cover from the fog's greyness and length: a grey, short fog is a
    // cloudy day.
    clouds: Math.min(0.75, Math.max(0.15, 0.25 + (1 - saturation * 5) * 0.25 + (fogEnd < 300 ? 0.2 : 0))),
  };
}

/**
 * The physical sky's radiance toward `dir` (unit, y up) for a sun toward
 * `sunDir`: SkyMesh's Preetham model ported to JS, the sun disc and clouds
 * left out. Used to calibrate the sky to a known brightness, since its raw
 * output swings by an order of magnitude with turbidity and sun height.
 */
export function skyRadiance(dir, sunDir, { turbidity = 2, rayleigh = 1, mieCoefficient = 0.005, mieDirectionalG = 0.8 } = {}) {
  const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const zc = Math.max(-1, Math.min(1, sunDir.y));
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - Math.acos(zc)) / 1.5));
  const betaR = totalRayleigh.map(v => v * rayleigh);
  const c = 0.2 * turbidity * 10e-18;
  const betaM = MieConst.map(v => 0.434 * c * v * mieCoefficient);
  const zenith = Math.acos(Math.max(0, dir.y));
  const inverse = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - zenith * 180 / Math.PI, -1.253));
  const sR = 8.4e3 * inverse, sM = 1.25e3 * inverse;
  const Fex = [0, 1, 2].map(i => Math.exp(-(betaR[i] * sR + betaM[i] * sM)));
  const cosT = dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z;
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g2 = mieDirectionalG * mieDirectionalG;
  const mPhase = 0.07957747154594767 * (1 - g2) / Math.pow(1 - 2 * mieDirectionalG * cosT + g2, 1.5);
  const out = [0, 1, 2].map(i => {
    const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex[i]), 1.5);
    const k = Math.min(1, Math.max(0, Math.pow(1 - sunDir.y, 5)));
    Lin *= (1 - k) + k * Math.pow(sunE * ratio * Fex[i], 0.5);
    return (Lin + 0.1 * Fex[i]) * 0.04;
  });
  out[1] += 0.0003; out[2] += 0.00075;
  return out;
}

/** Mean luminance of the sky around the horizon band and up to the zenith, away from the sun. */
export function skyLuminance(sunDir, params) {
  let sum = 0, n = 0;
  for (let az = 0; az < 12; az++) {
    for (const el of [0.08, 0.25, 0.5, 0.9]) {
      const a = az / 12 * Math.PI * 2;
      const ce = Math.cos(el);
      const d = { x: ce * Math.cos(a), y: Math.sin(el), z: ce * Math.sin(a) };
      const r = skyRadiance(d, sunDir, params);
      sum += 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
      n++;
    }
  }
  return sum / n;
}

/**
 * The atmosphere for one page: `apply(extras, waterLevel)` on each level,
 * `update(camera)` each frame.
 */
export function createRemasterSky({ renderer, scene, camera, sun, hemi }) {
  // The fog's uniforms, read by the fog node below.
  const u = {
    density: uniform(0.005),
    falloff: uniform(0.01),
    base: uniform(0),
    end: uniform(450),
    tint: uniform(new THREE.Color(1, 1, 1)),
    sunDir: uniform(new THREE.Vector3(0, 1, 0)),
    sunColor: uniform(new THREE.Color(1, 1, 1)),
    horizon: uniform(new THREE.Color(0.6, 0.65, 0.7)),
    glow: uniform(0.8),
    clear: uniform(45),
    start: uniform(150),
  };
  const sky = new SkyMesh();
  sky.name = 'remaster-sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.userData.remasterSky = true;
  sky.cloudSpeed.value = 0.00004;
  scene.add(sky);
  // The sky's brightness, calibrated per level (`apply`): its raw radiance
  // times this is a sky whose mean is SKY_TARGET.
  const skyScale = uniform(1);
  const SKY_TARGET = 0.75;

  // A separate scene the image-based light is rendered from: the same sky,
  // without the world in front of it.
  const envScene = new THREE.Scene();
  const envSky = new SkyMesh();
  envSky.scale.setScalar(1000);
  envScene.add(envSky);
  // A remaster of a painted sky, not a sky simulator: the Preetham blue is
  // eased toward its own brightness so it sits with the level's art.
  // Toward the horizon it fades into the haze colour the fog uses, so the
  // world's fogged edge meets the sky without a seam, as retail's does.
  const skySat = uniform(0.5);
  // The sky the image-based light is taken from: less blue still, or every
  // surface out of the sun turns blue (the ambient is most of their light).
  const envSat = uniform(0.25);
  const skyDir = normalize(positionWorld.sub(cameraPosition));
  for (const s of [sky, envSky]) {
    const sat = s === sky ? skySat : envSat;
    const raw = s.material.colorNode.mul(skyScale);
    const lum = raw.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
    // ...and its range compressed (zenith to horizon), so a low sun does
    // not read as dusk: luminance pulled 40 % of the way to the mean in log.
    const flat = pow(max(lum, 1e-4).div(SKY_TARGET), -0.4);
    const eased = mix(vec3(lum), raw.rgb, sat).mul(flat);
    s.material.colorNode = vec4(mix(eased, u.horizon, smoothstep(0.16, -0.02, skyDir.y)), 1);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;



  // The shadows: four cascades over the first 600 m, which is past every
  // level's fog end. Sized by the light's own shadow camera; the cascades
  // fit themselves to the view each frame.
  sun.castShadow = !REMASTER_OFF.has('noshadow');
  const shadowSize = Number(new URLSearchParams(location.search).get('shadowSize')) || 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0004;
  // The shadow cameras see only the shadow layer: the static casters' merged
  // proxies and whatever moving caster enabled it (remaster-renderer.js).
  // Set before the cascades clone this shadow.
  if (!REMASTER_OFF.has('noproxies')) sun.shadow.camera.layers.set(1);
  sun.shadow.normalBias = 0.6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 2000;
  const qp = new URLSearchParams(location.search);
  const cascades = Number(qp.get('cascades') ?? 3);
  let csm = null;
  if (cascades > 0) {
    csm = new CSMShadowNode(sun, { cascades, maxFar: Number(qp.get('shadowFar')) || 350, mode: 'practical', lightMargin: 300 });
    csm.fade = new URLSearchParams(location.search).get('csmFade') !== '0';
    sun.shadow.shadowNode = csm;
  } else {
    const c = sun.shadow.camera;
    c.left = c.bottom = -150; c.right = c.top = 150;
  }
  if (!sun.target.parent) scene.add(sun.target);

  function fogNode() {
    // Distance and the height integral of an exponential haze between the
    // eye and the fragment (density `d * exp(-falloff * (y - base))`).
    const toFrag = positionWorld.sub(cameraPosition);
    // Clear air to 60 % of the level's fogStart, as retail is clear to it.
    const dist = max(toFrag.length().sub(u.clear), 0);
    const dy = toFrag.y;
    const k = u.falloff;
    const eyeH = max(cameraPosition.y.sub(u.base), 0);
    const heightTerm = exp(k.mul(eyeH).negate());
    const kdy = k.mul(dy);
    const shape = mix(float(1), float(1).sub(exp(kdy.negate())).div(kdy), smoothstep(0.001, 0.01, kdy.abs()));
    const optical = u.density.mul(dist).mul(heightTerm).mul(shape);
    const haze = float(1).sub(exp(optical.negate()));
    // The world still ends at fogEnd: the far plane and the culling do.
    const wall = smoothstep(u.end.mul(0.8), u.end, toFrag.length());
    // Never less than 70 % of retail's own linear ramp (fogStart to fogEnd):
    // from altitude the height haze is thin, and without the floor the
    // world met the wall at 80 % of fogEnd as one hard band.
    const ramp = clamp(toFrag.length().sub(u.start).div(max(u.end.sub(u.start), 1)), 0, 1).mul(0.7);
    // `?pipelineSalt=<n>` (a measurement's, tests/perf): a number folded
    // into every fogged shader, so the OS's shader cache has seen none of
    // them and a run pays for its pipelines as a first visit does.
    const salt = Number(qp.get('pipelineSalt')) || 0;
    const mixed = max(max(haze, ramp), wall);
    const factor = clamp(salt ? mixed.add(float(salt * 1e-9)) : mixed, 0, 1);
    // The haze's colour: the sky's own horizon (computed on the CPU from
    // the same model, `apply`), tinted by the level's fog colour, with the
    // sun's forward glow. A per-pixel lookup of the sky's image-based light
    // looked the same and cost ~16 ms a frame at 1600 x 900.
    const dir = normalize(toFrag);
    const glow = pow(max(dot(dir, u.sunDir), 0), 6).mul(u.glow);
    const hazeCol = u.horizon.mul(float(1).add(glow));
    return vec4(mix(output.rgb, hazeCol, factor), output.a);
  }

  let built = false;
  // The level's own sky (features/remaster-browser, "The sky"): its painted
  // SkyBox mesh, or its cube of six faces, kept as the sky the player sees
  // and the source of the ambient light. The physical sky stays only for a
  // level that ships neither. `painted` is the level's SkyBox root (set by
  // level-sky.js `setupSky` through `paintedSky`), `cube` its cube texture.
  let painted = null;
  let paintedEnv = null;
  const horizonY = uniform(0.06);
  const skyGain = uniform(1);
  function paintedSky(root) {
    painted = root;
    if (!root) return;
    root.visible = true;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      for (const m of [obj.material].flat()) {
        if (!m || m.remasterSky) continue;
        m.remasterSky = true;
        // Display-referred paint, lifted into the HDR frame so it shows at
        // its painted brightness through the exposure and tone mapping, and
        // faded into the haze in the last few degrees above the horizon,
        // where the fogged world meets it.
        const dirY = normalize(positionWorld.sub(cameraPosition)).y;
        const paint = materialColor.rgb.mul(skyGain);
        m.colorNode = vec4(mix(paint, u.horizon, smoothstep(horizonY, horizonY.mul(-0.3), dirY)), 1);
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
    m.colorNode = vec4(c.rgb.mul(skyGain), c.a.mul(fade));
    m.remasterSky = true;
    return m;
  }

  function rebuildEnv() {
    envTarget?.dispose();
    if (painted) {
      // The painted sky at the origin of the light probe's own scene.
      if (paintedEnv) envScene.remove(paintedEnv);
      paintedEnv = painted.clone();
      paintedEnv.position.set(0, 0, 0);
      const half = painted.userData.halfExtent || 2000;
      paintedEnv.scale.setScalar(3000 / (half * 1.7320508));
      paintedEnv.visible = true;
      envScene.add(paintedEnv);
      envSky.visible = false;
      envTarget = pmrem.fromScene(envScene, 0, 0.5, 8000);
    } else if (scene.background?.isCubeTexture) {
      envTarget = pmrem.fromCubemap(scene.background);
    } else {
      if (paintedEnv) { envScene.remove(paintedEnv); paintedEnv = null; }
      envSky.visible = true;
      envTarget = pmrem.fromScene(envScene, 0, 0.5, 4000);
    }
    scene.environment = envTarget.texture;
    // `nofog`: a fog node that changes nothing, which also outranks the
    // retail THREE.Fog level-sky.js keeps setting.
    scene.fogNode = REMASTER_OFF.has('nofog') ? output : fogNode();
    built = true;
  }

  function apply(extras = {}, waterLevel = null) {
    const a = atmosphereFor(extras);
    const toward = sunToward(extras.sunDirection);
    for (const s of [sky, envSky]) {
      s.turbidity.value = a.turbidity;
      s.rayleigh.value = a.rayleigh;
      s.mieCoefficient.value = 0.005;
      s.mieDirectionalG.value = 0.8;
      s.sunPosition.value.copy(toward).multiplyScalar(1000);
      s.cloudCoverage.value = a.clouds;
      s.cloudDensity.value = 0.5;
    }
    envSky.showSunDisc.value = 0;
    skyScale.value = SKY_TARGET / Math.max(1e-4, skyLuminance(toward, {
      turbidity: a.turbidity, rayleigh: a.rayleigh, mieCoefficient: 0.005, mieDirectionalG: 0.8,
    }));
    sun.color.setRGB(a.sunTint[0], a.sunTint[1], a.sunTint[2], THREE.SRGBColorSpace);
    sun.intensity = a.sunIntensity;
    sun.position.copy(toward).multiplyScalar(400);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    // The sky's image-based light carries the ambient; the hemisphere goes.
    hemi.intensity = 0;
    scene.environmentIntensity = a.skyIntensity;
    u.density.value = a.density;
    u.falloff.value = a.falloff;
    u.end.value = a.fogEnd;
    u.clear.value = a.fogStart * 0.6;
    u.start.value = a.fogStart;
    u.base.value = Number.isFinite(waterLevel) ? waterLevel : 0;
    const f = a.fogColor;
    const lum = Math.max(0.05, 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]);
    u.tint.value.setRGB(
      0.5 + 0.5 * f[0] / lum, 0.5 + 0.5 * f[1] / lum, 0.5 + 0.5 * f[2] / lum);
    u.sunDir.value.copy(toward);
    terrainSunDir.value.copy(toward);
    // The cascades reach the fog wall: past it nothing is drawn.
    if (csm && !qp.get('shadowFar')) {
      csm.maxFar = Math.min(800, a.fogEnd);
      projectionKey = '';
    }
    // The horizon's mean colour, a little above the line, all round.
    const params = { turbidity: a.turbidity, rayleigh: a.rayleigh, mieCoefficient: 0.005, mieDirectionalG: 0.8 };
    const h = [0, 0, 0];
    for (let az = 0; az < 16; az++) {
      const ang = az / 16 * Math.PI * 2;
      const r = skyRadiance({ x: Math.cos(ang) * 0.996, y: 0.09, z: Math.sin(ang) * 0.996 }, toward, params);
      for (let i = 0; i < 3; i++) h[i] += r[i] / 16;
    }
    // The haze is two thirds the level's own fog colour (at the sky
    // horizon's brightness) and one third the sky's horizon: the physical
    // sky's horizon is bluer than any level's fog, and the fog colour is
    // the level's mood (Wake's warm grey, Bocage's milk, Berlin's soot).
    const k = skyScale.value;
    const skyH = [h[0] * k, h[1] * k, h[2] * k];
    const skyLum = 0.2126 * skyH[0] + 0.7152 * skyH[1] + 0.0722 * skyH[2];
    const fogLin = new THREE.Color().setRGB(f[0], f[1], f[2], THREE.SRGBColorSpace);
    const fogLum = Math.max(1e-3, 0.2126 * fogLin.r + 0.7152 * fogLin.g + 0.0722 * fogLin.b);
    const fogAt = [fogLin.r, fogLin.g, fogLin.b].map(c => c * skyLum / fogLum);
    u.horizon.value.setRGB(...skyH.map((c, i) => c / 3 + fogAt[i] * 2 / 3));
    // A level's own sky: the haze is its fog colour at the painted sky's
    // brightness (retail's fog was chosen to meet that paint at the
    // horizon), and the physical sky is not drawn.
    skyGain.value = 1 / Math.max(0.1, renderer.toneMappingExposure);
    const own = painted || scene.background?.isCubeTexture;
    sky.visible = !own;
    if (own) {
      u.horizon.value.setRGB(fogLin.r * skyGain.value, fogLin.g * skyGain.value, fogLin.b * skyGain.value);
      scene.environmentIntensity = a.skyIntensity * 1.6;
    }
    rebuildEnv();
    return a;
  }

  // The cascades' refresh: the near one every frame, the middle one every
  // second frame and the far ones every fourth, staggered. Each cascade is a
  // walk of the whole scene on the CPU (~2.5 ms each on Wake, plus its
  // casters), and a far cascade's picture barely moves between frames. A
  // skipped map keeps the matrix it was drawn with, so its shadows stay put.
  let frameNo = 0;
  const PERIODS = [1, 2, 4, 4];
  function staggerCascades() {
    frameNo++;
    const lights = csm?.lights;
    if (!lights?.length || REMASTER_OFF.has('nostagger')) return;
    lights.forEach((l, i) => {
      const period = PERIODS[Math.min(i, PERIODS.length - 1)];
      l.shadow.autoUpdate = period === 1;
      if (period > 1 && (frameNo + i) % period === 0) l.shadow.needsUpdate = true;
    });
  }

  /** Each frame: the sky box on the eye, inside the far plane. */
  // CSM fits its splits to the camera's projection once, at init; a resize,
  // a zoom or a level's draw distance changes it afterwards, and the stale
  // fit left the near ground outside the near cascade, drawn as one hard
  // shadow. Refit whenever the projection moves.
  let projectionKey = '';
  function refitCascades() {
    if (!csm?.camera) return;
    const key = `${camera.fov.toFixed(3)}|${camera.aspect.toFixed(4)}|${camera.near}|${camera.far.toFixed(1)}|${camera.zoom}`;
    if (key === projectionKey) return;
    projectionKey = key;
    csm.updateFrustums();
  }

  function update() {
    refitCascades();
    staggerCascades();
    sky.position.copy(camera.position);
    sky.scale.setScalar(camera.far * 0.5);
    sky.updateMatrixWorld();
  }

  return {
    sky, csm, apply, update, paintedSky, cloudMaterial, uniforms: u,
    get built() { return built; },
  };
}
