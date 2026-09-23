// The model browser's `envmap true` stage: which level's sky cube the page
// reflects (the picker, `?env=`, the remembered choice), the shader patch that
// binds it to a flagged material, and the readout under the picker. The engine
// side of it is `envmap.js`. Lifted out of index.html
// (features/vehicle-instance-refactor, Part 2c).

import * as THREE from 'three';
import { cubeFaceUrls, envmapFragmentApply, envmapFragmentPatch, envmapVertexBody, envmapVertexPatch, reflectivityRange, wantsEnvmap } from './envmap.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `activeMod`, `startAnimating`.
 */
export async function createEnvReflection(page) {
  const envReflection = {};

  /* `envmap true` — the environment reflection stage, reproduced from the
   * retail client. What the engine does, and why the strength is not a number
   * anyone picks, is in `envmap.js`; the short version is that texture stage 1
   * samples a cubemap through the camera-space reflection vector and blends it
   * under the lit surface with D3DTOP_BLENDCURRENTALPHA, whose factor is the
   * diffuse texture's own alpha channel.
   *
   * The engine's cubemap is the LEVEL's. This page has no level, so there is no
   * engine-true answer to "whose sky" — the honest thing is to make the choice
   * explicit rather than bake one in. The picker lists the extracted levels for
   * the active mod, remembers the choice, and `?env=<level>` carries it in a
   * link. With no maps tree at all the picker stays hidden and flagged
   * materials draw plain, which is exactly what the engine does when its own
   * gate (`ctx+0x18 != NULL`, 0x005bfa8b) fails.
   */
  const MAPS_BASE = page.activeMod.paths.maps;
  const ENV_STORE_KEY = 'bf42-mesh-envmap-level';
  const cubeLoader = new THREE.CubeTextureLoader();
  const envState = { cube: null, level: null, levels: [] };

  envState.levels = await fetch(`${MAPS_BASE}/maps.json?t=${Date.now()}`)
    .then(r => (r.ok ? r.json() : []))
    .then(list => (Array.isArray(list) ? list : []))
    .catch(() => []);

  function envLevelDir(entry) {
    return entry?.glb ? entry.glb.replace(/\/[^/]+$/, '') : null;
  }

  /** Load one level's six faces, or null when that level shipped none. */
  async function loadEnvCube(entry) {
    const dir = envLevelDir(entry);
    if (!dir) return null;
    const report = await fetch(`${MAPS_BASE}/${entry.report}?t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
    const urls = cubeFaceUrls(report, `${MAPS_BASE}/${dir}`);
    if (!urls) return null;
    const cube = cubeLoader.load(urls);
    cube.colorSpace = THREE.SRGBColorSpace;
    return cube;
  }

  // Every live `tBfEnv` uniform, so a level change swaps the faces without a
  // shader recompile: the program does not depend on which cube it samples.
  const envUniforms = new Set();

  async function selectEnvLevel(name, { remember = true } = {}) {
    const entry = envState.levels.find(e => e.name === name) || null;
    const cube = entry ? await loadEnvCube(entry) : null;
    envState.cube = cube;
    envState.level = cube ? entry.name : null;
    if (remember && cube) {
      try { localStorage.setItem(ENV_STORE_KEY, entry.name); } catch { /* private mode */ }
    }
    // Every already-bound material gets the new faces without a recompile; the
    // program itself does not depend on which cube it is.
    for (const uniform of envUniforms) uniform.value = cube;
    return cube;
  }

  // Pick the level whose sky this page reflects: `?env=`, then the remembered
  // choice, then the first extracted level that actually shipped six faces.
  {
    const params = new URLSearchParams(location.search);
    let wanted = params.get('env');
    if (!wanted) { try { wanted = localStorage.getItem(ENV_STORE_KEY); } catch { wanted = null; } }
    // Matched case-insensitively: `maps.json` names a level `Wake`, while every
    // other link into this viewer spells it the way `map.html?map=` does, in
    // lower case. An exact match silently fell through to whichever level
    // happened to ship a cubemap first, so `?env=wake` reflected Aberdeen.
    const key = wanted ? String(wanted).toLowerCase() : null;
    const order = envState.levels.slice().sort((a, b) => {
      if (a.name.toLowerCase() === key) return -1;
      if (b.name.toLowerCase() === key) return 1;
      return 0;
    });
    for (const entry of order) {
      if (await selectEnvLevel(entry.name, { remember: false })) break;
    }
  }

  /* Bind the stage to one material. Called for every material on a freshly
   * loaded model; a no-op unless the exporter flagged it and a cube is chosen.
   *
   * Unlike map.html — which rebuilds lit materials as MeshBasicMaterial and
   * paints the engine's own stage-0 combine into them — the browser keeps
   * GLTFLoader's MeshStandardMaterial under a neutral three-point rig, on
   * purpose: the point of this page is to see what the extraction produced, not
   * to reproduce a level's lighting. So the reflection is applied to
   * `outgoingLight`, after this page's own shading has finished, which is the
   * same position in the pipeline the engine's stage 1 occupies relative to its
   * stage 0. */
  function bindEnvmap(material) {
    if (!wantsEnvmap(material) || !envState.cube) return false;
    // One material is shared by many meshes, so this is reached once per mesh.
    // Patching twice redefines every varying and function in the shader and the
    // program fails to compile, silently dropping the material to three's error
    // shader — bind once and report bound thereafter.
    if (material.userData.__bfEnvmapBound) return true;
    material.userData.__bfEnvmapBound = true;
    const previous = material.onBeforeCompile;
    material.customProgramCacheKey = () => 'bf-envmap';
    material.onBeforeCompile = (shader, renderer) => {
      if (previous) previous.call(material, shader, renderer);
      shader.uniforms.tBfEnv = { value: envState.cube };
      envUniforms.add(shader.uniforms.tBfEnv);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `${envmapVertexPatch()}void main() {`)
        .replace('#include <begin_vertex>',
          `${envmapVertexBody()}
         #include <begin_vertex>`);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${envmapFragmentPatch()}\nvoid main() {`)
        // `<opaque_fragment>` is where three writes outgoingLight into
        // gl_FragColor, so this is the last point the lit colour exists.
        .replace('#include <opaque_fragment>',
          `${envmapFragmentApply('outgoingLight', 'diffuseColor.a')}
         #include <opaque_fragment>`);
    };
    material.needsUpdate = true;
    return true;
  }

  // The flagged materials on the model currently shown, for the readout.
  const envmapBound = new Set();

  /* The picker, and the line under it. The line matters: a material can declare
   * `envmap true` and still reflect nothing, because the strength is `1 - alpha`
   * of its own diffuse texture and some of the flagged art ships a flat opaque
   * alpha (`militable_m1_Material0`, `stebarrel1_m1_Material0` and
   * `planeeng_m1_Material0` on Wake are all like this). That is the engine's own
   * result, not a failed binding, and without saying so the page looks broken. */
  const envField = document.getElementById('envmap-field');
  const envSelect = document.getElementById('envmap-level');
  const envSummary = document.getElementById('envmap-summary');

  if (envState.levels.length && envState.cube) {
    envField.hidden = false;
    for (const entry of envState.levels) {
      const option = document.createElement('option');
      option.value = entry.name;
      option.textContent = entry.name.replace(/_/g, ' ');
      envSelect.append(option);
    }
    envSelect.value = envState.level || '';
    envSelect.addEventListener('change', async () => {
      const chosen = envSelect.value;
      const cube = await selectEnvLevel(chosen);
      if (!cube) {
        // That level shipped no faces. Say so and go back to the one that works.
        envSummary.hidden = false;
        envSummary.textContent = `${chosen.replace(/_/g, ' ')} has no extracted sky cubemap.`;
        envSelect.value = envState.level || '';
        await selectEnvLevel(envSelect.value, { remember: false });
        return;
      }
      updateEnvSummary();
      page.startAnimating();
    });
  }

  function alphaRangeOf(material) {
    // The glb's own texture is the authority; reading its pixels back needs a
    // canvas, so this reports the range three already knows about instead:
    // whether the material is transparent at all, and its opacity. A precise
    // per-texel range is what `reflectivityRange` is for, and the extractor's
    // report is where it belongs — see the feature doc.
    return material?.map?.image || null;
  }

  function updateEnvSummary() {
    if (!envField || envField.hidden) return;
    const flagged = [...envmapBound];
    if (!flagged.length) {
      envSummary.hidden = false;
      envSummary.textContent = 'No material on this model declares envmap.';
      return;
    }
    const measured = flagged
      .map(m => reflectivityRange(alphaHistogram(alphaRangeOf(m))))
      .filter(Boolean);
    const peak = measured.length ? Math.max(...measured.map(r => r.max)) : null;
    envSummary.hidden = false;
    envSummary.textContent = peak === null
      ? `${flagged.length} material${flagged.length === 1 ? '' : 's'} reflect `
        + `${(envState.level || '').replace(/_/g, ' ')}'s sky.`
      : `${flagged.length} material${flagged.length === 1 ? '' : 's'} reflect `
        + `${(envState.level || '').replace(/_/g, ' ')}'s sky, up to `
        + `${Math.round(peak * 100)}% at the shiniest texel`
        + (peak === 0 ? ' — this art ships a flat opaque alpha, so the engine reflects nothing on it.' : '.');
  }

  /** Read a decoded image's alpha channel back through a scratch canvas.
   *  Returns null for an image the browser has not decoded yet. */
  const alphaHistogramCache = new WeakMap();
  function alphaHistogram(image) {
    if (!image || !image.width || !image.height) return null;
    if (alphaHistogramCache.has(image)) return alphaHistogramCache.get(image);
    let out = null;
    try {
      const canvas = document.createElement('canvas');
      // One row in 16 is plenty for a range, and keeps a 1024x1024 fuselage
      // texture off the main thread for more than a frame.
      const step = Math.max(1, Math.floor(image.height / 64));
      canvas.width = image.width;
      canvas.height = Math.ceil(image.height / step);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, image.width, image.height,
        0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      out = new Array(256).fill(0);
      for (let i = 3; i < data.length; i += 4) out[data[i]]++;
    } catch {
      out = null;   // a tainted or undecoded image
    }
    alphaHistogramCache.set(image, out);
    return out;
  }

  /** The outgoing model's flagged materials and the uniforms its shaders held. */
  function forgetModelMaterials() {
    envmapBound.clear();
    // The uniform objects belong to the outgoing model's materials, which go
    // with it; kept, the set would grow by a handful of entries for every model
    // browsed and hold a cube texture alive behind each one.
    envUniforms.clear();
  }

  /** Bind one material of a freshly loaded model, and count it for the readout. */
  function bindModelEnvmap(m) {
    if (bindEnvmap(m)) envmapBound.add(m);
  }

  Object.assign(envReflection, {
    bindModelEnvmap,
    forgetModelMaterials,
    updateEnvSummary,
  });
  return envReflection;
}
